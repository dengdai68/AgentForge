import { createDesktopNotifications } from './notifications.mjs';
import { app, BrowserWindow, Menu, Tray, nativeImage, shell, session, screen, ipcMain, clipboard, net, Notification } from "electron";
import { fork, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname, isAbsolute } from "node:path";
import { userInfo, homedir } from "node:os";
import { lstat, mkdir, rename, unlink, writeFile, readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { isConsoleURL, isExternalURL, isPreferencesSender, isCliSender, isUpdateSender, health, initialRoute } from "./policy.mjs";
import { desktopBrowserPaths, desktopControlPlaneEnvironment, desktopStoragePaths, legacyDesktopDataRoot, resolveDesktopDataRoot,defaultDesktopLocation } from "./runtime-paths.mjs";
import {readStorageLocation,writeStorageLocation} from '../../server/storage-layout.mjs';
import {relocateStorage,finishStorageRelocation} from './storage-relocation.mjs';
import { diagnostic, diagnostics, installProcessDiagnostics } from "../../server/diagnostics.mjs";
import { legacyDataRequiresMigration, migrationGuidance } from "../../server/data-home.mjs";
import { createInterface } from "node:readline";
import { closeModes, readCloseMode, saveCloseMode } from "./preferences.mjs";
import { loadLoginShellEnvironment } from "./login-shell-env.mjs";
import { confirmCliInstallation } from "./cli-confirmation.mjs";
import { createCliInstallation } from "./cli-installation.mjs";
import { showAppDialog } from "./app-dialog.mjs";
import { createApplicationUpdates, fetchLatestRelease, downloadReleaseInstaller } from "./updates.mjs";

// Shared dialog context: every app-styled dialog gets the screen work area so
// it can size to its content without ever clipping (no parent-ratio cap).
function workAreaHeight() {
  const display = window && !window.isDestroyed() ? screen.getDisplayMatching(window.getBounds()) : screen.getPrimaryDisplay();
  return display.workAreaSize.height;
}
const appDialog = (options) => showAppDialog({ BrowserWindow, workAreaHeight, ...options });

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
let window, child, tray, childBootstrapToken = null, controlOrigin = null, childInstanceId = null, connecting = false, quitting = false, closeMode = null, savingCloseMode = false, closingPrompt = false;
let shellEnvironment;
let installingCli = false;
let applicationUpdates = null, restartReservation = null;
const shellEnvironmentAbort = new AbortController();
const desktopNotifications=createDesktopNotifications({
  Notification,
  authorized:async()=>{
    if(quitting||!controlOrigin||!window||window.isDestroyed())return false;
    const origin=controlOrigin;
    const response=await session.defaultSession.fetch(origin+'/api/auth/session',{credentials:'include',redirect:'error',signal:AbortSignal.timeout(5000)});
    return response.ok && origin===controlOrigin && !quitting;
  },
  openTarget:async route=>{
    if(!controlOrigin||quitting||!window||window.isDestroyed())return;
    const origin=controlOrigin,instance=childInstanceId;
    if(window.webContents.getURL()===origin+route){showWindow();return;}
    // A notification click never silently discards an in-progress form.
    if(isConsoleURL(window.webContents.getURL(),controlOrigin)) {
      const open=await window.webContents.executeJavaScript('Boolean(document.querySelector("dialog[open] form"))');
      if(open){showWindow();const choice=await appDialog({parent:window,kind:'question',title:'打开通知',message:'当前有未关闭的编辑窗口，前往通知对应页面？',buttons:['保留编辑','前往'],defaultIndex:0,cancelIndex:0});if(choice!==1)return;}
    }
    if(origin!==controlOrigin||instance!==childInstanceId||quitting)return;
    showWindow();await window.loadURL(origin+route);
  },
  onDiagnostic:(event,fields)=>diagnostic('desktop.notification_'+event,fields)
});
app.setName("AgentForge");
const controlRoot=resolveDesktopDataRoot({ packaged: app.isPackaged, env: process.env });
let storage = desktopStoragePaths(controlRoot,{controlRoot,instance:app.isPackaged?'desktop':'desktop-dev'});
const previousUserData = app.getPath('userData');
// Set before the single-instance lock and before any Electron session exists.
for(const [name,path] of Object.entries(desktopBrowserPaths(controlRoot))) { mkdirSync(path,{recursive:true,mode:0o700}); app.setPath(name,path); }
const endpointFile = join(controlRoot, "desktop-endpoint.json");
const cliSessionFile = join(controlRoot, "desktop-cli-session.json");
let cliSessionSync = Promise.resolve(), publishedCliParent = null;
const preferencesFile = join(controlRoot, "desktop-preferences.json");
installProcessDiagnostics("desktop", { instancePath: storage.AGENTFORGE_AUTH_DB_PATH });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showWindow);
  app.whenReady().then(start).catch(async error => {
    diagnostic("desktop.start_failed", { error });
    // Documented last resort: if even the app-styled error window cannot be
    // created (process-level failure), exit with the diagnostic log only.
    try { await appDialog({ kind: "error", title: "AgentForge 启动失败", message: "桌面客户端启动失败。", detail: `日志：${diagnostics().status().filePath}`, buttons: ["退出"], cancelIndex: 0 }); }
    catch (dialogError) { diagnostic("desktop.start_dialog_failed", { error: dialogError }); }
    app.quit();
  });
}

async function startControlPlane() {
  if (child) throw new Error("后台仍在启动或退出，请稍后重试。");
  shellEnvironment ||= loadLoginShellEnvironment({ signal: shellEnvironmentAbort.signal, onDiagnostic: fields => diagnostic("desktop.shell_environment", fields) });
  const inherited = await shellEnvironment;
  if (quitting) return;
  const root = app.isPackaged ? app.getAppPath() : sourceRoot;
  if (quitting) return;
  const bootstrapToken = randomBytes(32).toString("hex");
  const environment = desktopControlPlaneEnvironment({ environment: inherited, storage, electronExecutable: process.execPath, bootstrapToken });
  childBootstrapToken = bootstrapToken;
  child = fork(join(root, "server/index.mjs"), [], {
    cwd: controlRoot, env: { ...environment, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  const owned = child;
  owned.on('message',message=>{
    if(owned!==child)return;
    if(message?.type==='agentforge-notification') { void desktopNotifications.receive(message.notice,()=>owned===child&&!quitting);return; }
    if(message?.type!=='agentforge-storage-restart'||typeof message.workspaceRoot!=='string')return;
    void changeStorageRoot(message.workspaceRoot).catch(error=>diagnostic('desktop.storage_restart_failed',{error})).finally(()=>{if(child===owned&&owned.connected)owned.send({type:'agentforge-update-release',id:message.id},()=>{});});
  });
  for (const stream of ["stdout", "stderr"]) createInterface({ input: owned[stream] }).on("line", text => diagnostic(`desktop.server_${stream}`, { text, childPid: owned.pid }));
  owned.once("exit", (code, signal) => { diagnostic("desktop.server_exit", { code, signal }); if (child === owned) { desktopNotifications.clear(); child = null; childBootstrapToken = null; controlOrigin = null; childInstanceId = null; } });
  owned.once("error", error => { diagnostic("desktop.server_error", { error }); if (child === owned) { desktopNotifications.clear(); child = null; childBootstrapToken = null; controlOrigin = null; childInstanceId = null; } });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("本地后台启动超时，请检查服务日志。")), 30000);
    const onMessage = message => { if (message?.type === "agentforge-ready") finish(null, message); };
    const onExit = () => finish(new Error("本地后台启动失败，请检查服务日志。"));
    const finish = (error, message) => { clearTimeout(timer); owned.off("message", onMessage); owned.off("exit", onExit); error ? reject(error) : resolve(message); };
    owned.on("message", onMessage); owned.once("exit", onExit);
  }).catch(error => { owned.kill(); throw error; });
  if (!Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535 || typeof ready.instanceId !== "string") { owned.kill(); throw new Error("本地后台返回了无效连接信息。"); }
  controlOrigin = `http://127.0.0.1:${ready.port}`;
  childInstanceId = ready.instanceId;
  if (!await health(controlOrigin, childInstanceId)) { owned.kill(); throw new Error("本地后台身份校验失败。"); }
  try {
    const existing = await lstat(endpointFile).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("桌面连接文件不是常规文件");
    const temporary = `${endpointFile}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ origin: controlOrigin, instanceId: childInstanceId }), { flag: "wx", mode: 0o600 });
      await rename(temporary, endpointFile);
    } finally { await unlink(temporary).catch(() => {}); }
  } catch (error) { owned.kill(); throw new Error(`无法安全保存桌面连接信息：${error.message}`); }
}

async function changeStorageRoot(workspaceRoot){
  if(connecting||quitting)throw new Error('客户端正在连接或退出，数据目录未更改');
  connecting=true;const previous=storage;let moved;
  try{
    if(applicationUpdates?.snapshot().phase==='downloading')throw new Error('安装包正在下载，请下载完成后再更换数据目录');
    window?.setTitle('AgentForge · 正在整理数据目录…');
    const owned=child;if(!owned)throw new Error('没有可停止的本机服务');
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('本机服务未退出，未搬运数据')),15000);owned.once('exit',()=>{clearTimeout(timer);resolve();});owned.kill();});
    moved=await relocateStorage({sourceRoot:previous.dataRoot,controlRoot,workspaceRoot,instance:app.isPackaged?'desktop':'desktop-dev',previousRuntimeRoots:JSON.parse(previous.AGENTFORGE_RUNTIME_PREVIOUS_ROOTS),onProgress:entry=>diagnostic('desktop.storage_copy',{entry})});
    storage=desktopStoragePaths(controlRoot,{controlRoot,instance:app.isPackaged?'desktop':'desktop-dev',workspaceRoot:moved.location.workspaceRoot,previousRuntimeRoots:moved.location.previousRuntimeRoots});
    await startControlPlane();
    await moved.cleanup().catch(error=>diagnostic('desktop.storage_source_cleanup_failed',{error}));
  }catch(error){
    diagnostic('desktop.storage_move_failed',{error});
    if(moved&&child){const failed=child;await new Promise(resolve=>{const timer=setTimeout(resolve,5000);failed.once('exit',()=>{clearTimeout(timer);resolve();});failed.kill();});}
    if(!child&&moved){await writeStorageLocation(controlRoot,{version:1,workspaceRoot:previous.AGENTFORGE_WORKSPACE_ROOT,previousRuntimeRoots:JSON.parse(previous.AGENTFORGE_RUNTIME_PREVIOUS_ROOTS)});storage=previous;}
    await appDialog({parent:window,kind:'error',title:'数据目录未切换',message:'未能完成数据目录整理，原始资料已保留。',detail:error.message,buttons:['好'],cancelIndex:0});
  }finally{connecting=false;}
  await connect('/settings/workspace');
}

function syncCliSession() {
  // Serial publication prevents a late login result surviving a later logout.
  cliSessionSync = cliSessionSync.catch(() => {}).then(async () => {
    if (!controlOrigin || quitting) return;
    const origin = controlOrigin, instanceId = childInstanceId;
    const cookies = await session.defaultSession.cookies.get({ url: origin, name: 'agentforge_session' });
    const cookie = cookies.find(item => item.path === '/' && /^[a-f0-9]{64}$/.test(item.value));
    if (!cookie) { desktopNotifications.clear(); publishedCliParent = null; await unlink(cliSessionFile).catch(error => { if (error.code !== 'ENOENT') throw error; }); return; }
    const parentKey = `${instanceId}:${cookie.value}`;
    if (publishedCliParent === parentKey) return;
    desktopNotifications.clear();
    const response = await fetch(`${origin}/api/auth/cli-session`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `agentforge_session=${cookie.value}` }, body: '{}' });
    if (!response.ok) { await unlink(cliSessionFile).catch(() => {}); return; }
    const grant = await response.json();
    if (!/^agentforge_session=[a-f0-9]{64}$/.test(grant.cookie) || origin !== controlOrigin || instanceId !== childInstanceId || quitting) return;
    const temporary = `${cliSessionFile}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ origin, instanceId, cookie: grant.cookie, expiresAt: grant.expiresAt }), { flag: 'wx', mode: 0o600 });
      await rename(temporary, cliSessionFile);
      publishedCliParent = parentKey;
    } finally { await unlink(temporary).catch(() => {}); }
  }).catch(error => diagnostic('desktop.cli_session_sync_failed', { code: error.code || 'unknown' }));
  return cliSessionSync;
}
async function installDefaultCli() {
  const installer = cliInstallation();
  if (!installer || installingCli) return;
  installingCli = true;
  try {
    const status = await installer.status();
    if (status.canInstall && !status.installed) await installer.install(status.profilePaths);
  } catch (error) { diagnostic('desktop.cli_install_failed', { code: error.code || 'unknown' }); }
  finally { installingCli = false; }
}

async function connect(preferredRoute=null) {
  if (connecting || quitting) return;
  connecting = true;
  window?.setTitle("AgentForge · 正在连接本机服务…");
  try {
    if (!child || !await health(controlOrigin, childInstanceId)) await startControlPlane();
    if (!quitting) {
      const route = await initialRoute(controlOrigin);
      if (route === "/setup") await window.loadURL(`${controlOrigin}/setup`, { extraHeaders: `X-AgentForge-Bootstrap: ${childBootstrapToken}\n` });
      else await window.loadURL(controlOrigin+(preferredRoute||''));
      window.setTitle("AgentForge");
      publishedCliParent = null;
      await syncCliSession();
      await finishStorageRelocation({businessRoot:storage.dataRoot,previousRuntimeRoots:JSON.parse(storage.AGENTFORGE_RUNTIME_PREVIOUS_ROOTS)}).catch(error=>diagnostic('desktop.storage_source_cleanup_failed',{error}));
    }
  } catch (error) {
    diagnostic("desktop.connection_failed", { error });
    if (!quitting && window && !window.isDestroyed()) {
      const response = await appDialog({ parent: window, kind: "error", title: "无法连接 AgentForge", message: "无法连接本机服务。", detail: `日志：${diagnostics().status().filePath}`, buttons: ["重试", "关闭"], defaultIndex: 0, cancelIndex: 1 });
      connecting = false;
      if (response === 0) return connect();
      app.quit();
    }
  } finally { connecting = false; }
}

async function external(url) {
  if (!isExternalURL(url, controlOrigin)) return;
  const response = await appDialog({ parent: window, kind: "question", title: "打开外部链接", message: "在系统浏览器打开外部链接？", detail: new URL(url).origin, buttons: ["取消", "打开"], defaultIndex: 0, cancelIndex: 0 });
  if (response === 1) await shell.openExternal(url);
}

function showWindow() {
  if (!window || window.isDestroyed()) return;
  app.dock?.show(); window.restore(); window.show(); window.focus();
}

function showWindowFromTray() {
  if (!window || window.isDestroyed()) return;
  window.webContents.send("desktop:tray-restore");
  showWindow();
}

function ensureTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(join(sourceRoot, 'web/icons/trayTemplate.png'));
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("AgentForge");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 AgentForge", click: showWindowFromTray },
    { label: "设置…", click: openSettings },
    { type: "separator" },
    { label: "退出 AgentForge", click: () => app.quit() }
  ]));
}

async function changeCloseMode(mode) {
  if (typeof mode !== "string" || !Object.hasOwn(closeModes, mode)) throw new Error("关闭行为无效");
  if (savingCloseMode) throw new Error("正在保存，请稍后重试");
  savingCloseMode = true;
  try {
    if (mode === "tray") ensureTray();
    await saveCloseMode(preferencesFile, mode);
    closeMode = mode;
    if (mode === "quit") { showWindow(); tray?.destroy(); tray = null; }
    diagnostic("desktop.close_mode_changed", { closeMode });
    return desktopPreferences();
  } catch (error) {
    diagnostic("desktop.close_mode_failed", { error });
    if (closeMode !== "tray") { tray?.destroy(); tray = null; }
    showWindow();
    throw new Error("关闭行为未保存，保留原设置。请查看运行日志。");
  } finally { savingCloseMode = false; }
}

function desktopPreferences() { return { platform: process.platform, closeMode }; }
function cliInstallation() {
  if (!app.isPackaged || process.platform !== 'darwin') return null;
  const launcher = join(dirname(app.getAppPath()), 'cli/agentforge');
  if (launcher.startsWith('/Volumes/') || launcher.includes('/AppTranslocation/')) return null;
  return createCliInstallation({ home: homedir(), launcher, shell: userInfo().shell || '/bin/zsh', zdotdir: process.env.ZDOTDIR });
}
const cliUnavailable = () => ({ supported: false, canInstall: false, installed: false, message: '请先将 Mac 安装包移到持久位置（建议应用程序），从打包客户端打开；Web/源码模式不安装 Shell 命令。' });
function openSettings() { showWindow(); if (controlOrigin) void window.loadURL(`${controlOrigin}/settings/general`); else void connect(); }
function applyCloseMode() {
  if (closeMode === "quit") { app.quit(); return; }
  if (closeMode !== "tray") return;
  try { ensureTray(); window.hide(); app.dock?.hide(); diagnostic("desktop.window_hidden"); }
  catch (error) { diagnostic("desktop.tray_failed", { error }); showWindow(); }
}
async function closeWindow() {
  if (savingCloseMode || closingPrompt) return;
  if (closeMode) { applyCloseMode(); return; }
  closingPrompt = true;
  try {
    const response = await appDialog({ parent: window,
      kind: "question", title: "关闭 AgentForge", message: "关闭主窗口时，你希望如何处理？",
      detail: "选择会保存，可随时在「设置 → 常规」修改。保留在菜单栏会继续运行本机后台；Cmd+Q 始终退出。",
      buttons: ["退出程序", "保留在菜单栏", "取消"], defaultIndex: 2, cancelIndex: 2
    });
    if (quitting || ![0, 1].includes(response)) return;
    await changeCloseMode(response === 0 ? "quit" : "tray");
    if (!quitting) applyCloseMode();
  } catch (error) {
    diagnostic("desktop.close_failed", { error }); showWindow();
    if (!quitting) await appDialog({ parent: window, kind: "error", title: "关闭行为未保存", message: "关闭行为未保存，窗口保持打开。", detail: `日志：${diagnostics().status().filePath}`, buttons: ["知道了"], cancelIndex: 0 });
  } finally { closingPrompt = false; }
}

// App-styled About window reusing the app-dialog system; the macOS menu no
// longer triggers the system About panel (orderFrontStandardAboutPanel).
function showAboutDialog() {
  const parent = window && !window.isDestroyed() ? window : null;
  void appDialog({ parent, kind: "question",
    title: "关于 AgentForge", message: `AgentForge 桌面客户端\n版本 ${app.getVersion()}`,
    detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    buttons: ["好"], cancelIndex: 0
  }).catch(error => diagnostic("desktop.about_failed", { error }));
}

async function prepareUpdateRestart() {
  if (installingCli || savingCloseMode || closingPrompt || connecting) throw new Error('客户端仍在保存或连接，请稍后再重启安装');
  const owned = child;
  if (!owned?.connected) throw new Error('无法确认当前执行状态，请重新连接后再更新');
  const id = randomBytes(18).toString('hex');
  await new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); owned.off('message', receive); error ? reject(error) : resolve(); };
    const receive = message => {
      if (message?.type !== 'agentforge-update-readiness' || message.id !== id || owned !== child) return;
      if (message.ready === true) { restartReservation = { child: owned, id }; finish(); }
      else finish(new Error('仍有任务、沟通或保存操作正在执行，请结束后再重启安装'));
    };
    const timer = setTimeout(() => { if (owned.connected) owned.send({type:'agentforge-update-release',id},()=>{}); finish(new Error('无法确认后台已空闲，未重启，请稍后重试')); }, 5000);
    owned.on('message', receive);
    owned.send({ type:'agentforge-update-prepare', id }, error => { if (error) finish(new Error('后台连接已断开，未重启')); });
  });
}
function releaseUpdateRestart() {
  if (restartReservation?.child.connected) restartReservation.child.send({type:'agentforge-update-release',id:restartReservation.id},()=>{});
  restartReservation = null;
}
async function startApplicationUpdates() {
  let nativeInstall = false;
  if (app.isPackaged && process.platform === 'darwin') {
    try {
      const {stderr} = await promisify(execFile)('/usr/bin/codesign',['-dv','--verbose=4',app.getPath('exe')],{timeout:5000});
      nativeInstall = /^Authority=Developer ID Application:/m.test(stderr) && /^TeamIdentifier=[A-Z0-9]{10}$/m.test(stderr);
    } catch (error) { diagnostic('desktop.update_signature_check_failed',{error}); }
  }
  const currentVersion = app.isPackaged ? app.getVersion() : JSON.parse(await readFile(join(sourceRoot,'package.json'),'utf8')).version;
  applicationUpdates = createApplicationUpdates({ currentVersion, packaged: app.isPackaged && process.platform === 'darwin',
    nativeInstall, cacheRoot: () => join(controlRoot,'updates'), prepareRestart: prepareUpdateRestart, releaseRestart: releaseUpdateRestart,
    readLatest: () => fetchLatestRelease((url, options) => net.fetch(url, options)),
    downloadInstaller: (release, cache, progress, options) => downloadReleaseInstaller(release, cache, progress, { ...options, fetcher: (url, init) => net.fetch(url, init) }),
    openInstaller: path => shell.openPath(path), onDiagnostic: error => diagnostic('desktop.update_failed',{error}),
    createNativeUpdater(release, onProgress, onFailure) {
      let updater;
      return {
        async download(version) {
          const {default: module} = await import('electron-updater');
          updater = new module.MacUpdater({provider:'generic',url:release.feedUrl});
          updater.channel = 'latest'; updater.allowPrerelease = false; updater.allowDowngrade = false;
          updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
          updater.on('error', onFailure);
          updater.on('download-progress', onProgress);
          const result = await updater.checkForUpdates();
          if (!result || result.updateInfo.version !== version) throw new Error('正式版更新元数据不一致，请前往 Release 核对');
          await updater.downloadUpdate();
        },
        install() { if (!updater) throw new Error('原生更新器尚未就绪'); updater.quitAndInstall(false,true); }
      };
    }
  });
  applicationUpdates.subscribe(value => {
    if (window && !window.isDestroyed() && isConsoleURL(window.webContents.getURL(),controlOrigin)) window.webContents.send('desktop:updates:changed',value);
  });
  window.webContents.on('did-finish-load', () => {
    if (isConsoleURL(window.webContents.getURL(),controlOrigin)) window.webContents.send('desktop:updates:changed',applicationUpdates.snapshot());
  });
  if (isConsoleURL(window.webContents.getURL(),controlOrigin)) window.webContents.send('desktop:updates:changed',applicationUpdates.snapshot());
  applicationUpdates.start();
}
async function checkApplicationUpdates() {
  showWindow();
  if (controlOrigin) await window.loadURL(controlOrigin + '/settings/updates');
  await applicationUpdates?.check();
}

function installMenu() {
  const contents = window.webContents;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ label: "AgentForge", submenu: [
      { id: "about-agentforge", label: "关于 AgentForge", click: showAboutDialog }, { type: "separator" },
      { label: "设置…", accelerator: "Command+,", click: openSettings },
      { label: "检查更新…", click: () => { void checkApplicationUpdates().catch(error => diagnostic('desktop.update_check_failed',{error})); } },
      { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" }, { label: "退出 AgentForge", accelerator: "Command+Q", click: () => app.quit() }
    ] }] : []),
    { role: "editMenu" },
    { label: "导航", submenu: [
      { label: "首页 / 重新连接", accelerator: "CmdOrCtrl+0", click: () => { showWindow(); void connect(); } },
      { label: "刷新", accelerator: "CmdOrCtrl+R", click: () => contents.reload() },
      { label: "后退", accelerator: "CmdOrCtrl+[", click: () => { if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); } },
      { label: "前进", accelerator: "CmdOrCtrl+]", click: () => { if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); } },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }
    ] }, { role: "windowMenu" }
  ]));
}

async function start() {
  const location=await readStorageLocation(controlRoot,defaultDesktopLocation({controlRoot,packaged:app.isPackaged,env:process.env}));
  storage=desktopStoragePaths(controlRoot,{controlRoot,instance:app.isPackaged?'desktop':'desktop-dev',workspaceRoot:location.workspaceRoot,previousRuntimeRoots:location.previousRuntimeRoots});
  if(controlRoot!==storage.dataRoot&&await legacyDataRequiresMigration({legacyRoot:controlRoot,currentDatabasePath:storage.AGENTFORGE_DB_PATH}))throw new Error('旧位置仍有实例资料。请先退出 AgentForge，显式整理到配置的数据根目录；未创建空实例。参见 docs/30-storage-layout.md。');
  // A saved locator is authoritative. A disconnected data volume must never
  // look like a fresh instance on the system disk.
  const savedLocator=await lstat(join(controlRoot,'storage.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(savedLocator&&!(await lstat(storage.dataRoot).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))?.isDirectory())throw new Error('配置的数据盘或实例目录不可访问，请重新连接原数据盘；未创建新实例。');
  await mkdir(storage.dataRoot,{recursive:true,mode:0o700});
  await writeStorageLocation(controlRoot,location);
  // Hard protection: a legacy default location with real instance data must
  // never be silently replaced by a fresh instance under the new data home.
  const legacyRoot = legacyDesktopDataRoot({ packaged: app.isPackaged, userData: previousUserData, env: process.env, sourceRoot });
  if (legacyRoot && await legacyDataRequiresMigration({ legacyRoot, currentDatabasePath: storage.AGENTFORGE_DB_PATH })) {
    const command = app.isPackaged
      ? `ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${join(process.resourcesPath, "scripts", "migrate-data-home.mjs")}" --yes`
      : "node scripts/migrate-data-home.mjs --yes";
    diagnostic("desktop.legacy_data_detected", { legacyRoot, dataRoot: storage.dataRoot });
    await appDialog({ kind: "error", title: "需要先搬迁实例数据", message: "检测到旧默认位置的应用数据，客户端未按新实例启动。",
      detail: migrationGuidance({ legacyRoot, targetRoot: storage.dataRoot, command }), buttons: ["退出"], cancelIndex: 0 });
    app.quit();
    return;
  }
  try { closeMode = await readCloseMode(preferencesFile); }
  catch (error) { diagnostic("desktop.preferences_read_failed", { error }); }
  session.defaultSession.cookies.on('changed', (_event, cookie) => {
    if (cookie.name === 'agentforge_session' && cookie.domain === '127.0.0.1') void syncCliSession();
  });
  void installDefaultCli();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.dock?.setIcon(join(sourceRoot, 'web/icons/application-dock.png'));
  window = new BrowserWindow({ width: 1320, height: 860, minWidth: 760, minHeight: 560, title: "AgentForge", icon: join(sourceRoot, 'web/icons/application-dock.png'), backgroundColor: "#f7f9ff",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)) }
  });
  const contents = window.webContents;
  ipcMain.handle('desktop:updates:status', (event, ...args) => {
    if (args.length || event.sender !== contents || event.senderFrame !== contents.mainFrame || !isConsoleURL(event.senderFrame?.url,controlOrigin)) throw new Error('仅允许应用主窗口读取更新状态');
    return applicationUpdates?.snapshot() || {phase:'idle',currentVersion:app.getVersion(),message:'更新器正在启动…'};
  });
  for (const [command, method] of [['check','check'],['download','download'],['install','install']]) {
    ipcMain.handle('desktop:updates:' + command, (event, ...args) => {
      if (args.length || connecting || !isUpdateSender(event,contents,controlOrigin) || !applicationUpdates) throw new Error('请在设置 → 更新中操作');
      return applicationUpdates[method]();
    });
  }
  ipcMain.handle("desktop:preferences:get", event => {
    if (!isPreferencesSender(event, contents, controlOrigin)) throw new Error("仅允许客户端常规设置访问");
    return desktopPreferences();
  });
  ipcMain.handle("desktop:preferences:set", (event, mode) => {
    if (!isPreferencesSender(event, contents, controlOrigin) || process.platform !== "darwin") throw new Error("仅允许 Mac 客户端常规设置修改");
    return changeCloseMode(mode);
  });
  ipcMain.handle("desktop:workspace:open-directory", async (event, ...args) => {
    const pageURL = event.senderFrame?.url;
    if (args.length || event.sender !== contents || event.senderFrame !== contents.mainFrame
      || !isConsoleURL(pageURL, controlOrigin)) throw new Error("无法打开工作目录");
    const match = new URL(pageURL).pathname.match(/^\/runs\/([^/]+)$/);
    if (!match) throw new Error("仅允许打开当前任务工作目录");
    const response = await contents.session.fetch(`${controlOrigin}/api/runs/${encodeURIComponent(match[1])}/workspace?view=summary`, {
      credentials: "include", redirect: "error", signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("无法读取当前任务工作目录，请确认已登录");
    const workspace = await response.json(), directory = workspace.run?.task?.workspacePath;
    if (workspace.run?.id !== match[1] || typeof directory !== "string" || !isAbsolute(directory)
      || contents.mainFrame.url !== pageURL || !(await lstat(directory)).isDirectory()) throw new Error("当前任务工作目录不可用");
    const error = await shell.openPath(directory);
    if (error) throw new Error(`打开工作目录失败：${error}`);
    return true;
  });
  ipcMain.handle("desktop:workspace:copy-path", (event, text) => {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame
      || !isConsoleURL(event.senderFrame?.url, controlOrigin)
      || !new URL(event.senderFrame.url).pathname.startsWith("/runs/")
      || typeof text !== "string" || !text || text.length > 32768) throw new Error("无法复制工作目录");
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle('desktop:cli:status', async (event, ...args) => {
    if (args.length || !isCliSender(event, contents, controlOrigin)) throw new Error('仅允许客户端 CLI 设置读取 CLI 安装状态');
    return cliInstallation()?.status() || cliUnavailable();
  });
  ipcMain.handle('desktop:cli:install', async (event, ...args) => {
    if (args.length || !isCliSender(event, contents, controlOrigin) || quitting) throw new Error('仅允许客户端 CLI 设置安装 CLI');
    if (installingCli) throw new Error('CLI 安装正在进行，请稍后重试');
    const installer = cliInstallation();
    if (!installer) return cliUnavailable();
    installingCli = true;
    try {
      const status = await installer.status();
      if (!status.canInstall) return status;
      const accepted = await confirmCliInstallation({ BrowserWindow, parent: window, status, signal: shellEnvironmentAbort.signal });
      if (!accepted || quitting || !isCliSender(event, contents, controlOrigin)) return { ...status, cancelled: true };
      const result = await installer.install(status.profilePaths);
      diagnostic('desktop.cli_installed', { installed: result.installed });
      return result;
    } catch (error) {
      diagnostic('desktop.cli_install_failed', { code: error.code || 'unknown' });
      return { ...(await installer.status()), installed: false, message: error.code?.startsWith('CLI_') ? error.message : 'CLI 安装未完成，请检查安装目录和配置文件权限后重试；不使用 sudo。' };
    } finally { installingCli = false; }
  });
  // Presentation only: the authenticated server includes desktop CSS before
  // first paint, including login redirects. This marker grants no authority.
  contents.setUserAgent(`${contents.getUserAgent()} AgentForgeDesktop/1`);
  contents.on("will-navigate", (event, url) => { if (!isConsoleURL(url, controlOrigin)) { event.preventDefault(); void external(url); } });
  contents.on("will-redirect", (event, url) => { if (!isConsoleURL(url, controlOrigin)) event.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => {
    if (isConsoleURL(url, controlOrigin)) void window.loadURL(url);
    else void external(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("render-process-gone", (_event, details) => { diagnostic("desktop.renderer_gone", { details }); if (!quitting) void connect(); });
  contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    diagnostic("desktop.load_failed", { code, description, isMainFrame });
    if (isMainFrame && code !== -3 && !connecting && !quitting) void connect();
  });
  window.on("close", event => {
    if (quitting || process.platform !== "darwin") return;
    event.preventDefault();
    void closeWindow();
  });
  if (process.platform === "darwin" && closeMode === "tray") {
    try { ensureTray(); } catch (error) { diagnostic("desktop.tray_failed", { error }); }
  }
  installMenu();
  await connect();
  await startApplicationUpdates();
}

app.on("window-all-closed", () => app.quit());
app.on("activate", showWindow);
app.on("before-quit", () => { quitting = true; desktopNotifications.stop(); applicationUpdates?.stop(); shellEnvironmentAbort.abort(); tray?.destroy(); tray = null; child?.kill(); });
