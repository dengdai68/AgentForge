import {RUNTIME_IDS} from "../client/runtime-providers.mjs";
import { closeExecutionBudget } from './execution-budget.mjs';
import { attachmentThumbnail } from './attachment-thumbnails.mjs';
import { collaborationRecords } from "../client/console-projections.mjs";
import { createAutomationScheduler } from "./automation-scheduler.mjs";
import { previewSchedule } from "./automation-schedule.mjs";
import { createServer } from "node:http";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { diagnostic, diagnostics, installProcessDiagnostics } from "./diagnostics.mjs";
import { readFile, realpath, stat, access, mkdir, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, normalize, isAbsolute, parse, sep } from "node:path";
import { fileURLToPath } from "node:url";
import hljs from "highlight.js";
import { createTaskPatrol } from "./task-patrol.mjs";
import { createStore } from "./store.mjs";
import { executeRun, isRunExecuting, pauseRun, resumeRun, terminateRun, stopInquiries } from "./orchestrator.mjs";
import { createRunFiles } from "./run-files.mjs";
import { hasActiveExecution } from "./runtime/registry.mjs";
import { createAuth } from "./auth.mjs";
import { createRuntimeConfiguration } from "./runtime/configuration.mjs";
import { desktopServiceStoragePaths } from "./data-home.mjs";
import { createMarketplace } from "./runtime/marketplace.mjs";
import { probeRuntime } from "./runtime/probe.mjs";
import { runtimeInstalled } from "./runtime/cli-environment.mjs";
import { runtimeModelCatalog, assertModelEffort } from "./runtime/model-catalog.mjs";
import { createCommunicationService } from "./communication.mjs";
import { queryHistory } from "./history/bridge.mjs";
import { createDataReset } from "./data-reset.mjs";
import {createPluginUpdates} from './plugin-updates.mjs';
import {validateStorageDestination} from './storage-layout.mjs';
import {createConfigurationStore} from './configuration-store.mjs';

const root = fileURLToPath(new URL("..", import.meta.url));
const webRoot = join(root, "web");
const clientRoot = join(root, "client");
const x6Bundle = join(root, "node_modules", "@antv", "x6", "dist", "x6.min.js");
const elkBundle = join(root, "node_modules", "elkjs", "lib", "elk.bundled.js");
const markedBundle = join(root, "node_modules", "marked", "lib", "marked.umd.js");
const domPurifyBundle = join(root, "node_modules", "dompurify", "dist", "purify.min.js");
const highlightStylesheet = join(root, "node_modules", "highlight.js", "styles", "github.min.css");
const candidateBootstrapToken = process.env.AGENTFORGE_BOOTSTRAP_TOKEN;
delete process.env.AGENTFORGE_BOOTSTRAP_TOKEN;
if (!candidateBootstrapToken || !process.send || process.env.AGENTFORGE_DESKTOP_PORT !== "0") throw new Error("本机服务只能由 AgentForge 客户端启动；请运行 npm start 或打开应用。");
const bootstrapToken = candidateBootstrapToken;
const port = 0;
const host = "127.0.0.1";
const instanceId = randomUUID();
const storage = desktopServiceStoragePaths();
const databasePath = storage.databasePath;
installProcessDiagnostics("server", { instancePath: storage.authDatabasePath });
const runFilesRoot = storage.runFilesRoot;
const workspaceRoot = storage.workspaceRoot;
const runtimeConfigRoot = storage.runtimeConfigRoot;
// The default instance data root is private; explicit AGENTFORGE_* override
// targets stay exactly as the operator configured them.
const usesDefaultRoot = [storage.databasePath, storage.authDatabasePath, storage.runFilesRoot, storage.runtimeConfigRoot, storage.workspaceRoot].some(path => path === storage.dataRoot || path.startsWith(storage.dataRoot + sep));
const authOptions = { databasePath: storage.authDatabasePath, origins: [], bootstrapToken };
const dataReset = createDataReset({workspaceRoot,configurationRoot:storage.controlRoot,protectedPaths:[root,diagnostics().status().directory]});
let auth;
const storeOptions = { databasePath, workspaceRoot,workspaceRootAuthoritative:true, configurationDirectory:storage.controlRoot, runtimeInstalled, onSaveDiagnostic: (record) => {
  if (record.outcome === "error" || record.elapsedMs >= 250) diagnostic("persistence.save", record);
}, onLoadDiagnostic: record => diagnostic('persistence.collection_loaded',record) };
let store = null, businessInitialization = null, businessFailure = null;
let configurationPreview = null;
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const communicationFiles=()=>createRunFiles({root:runFilesRoot,communicationsRoot:join(workspaceRoot,'communications'),resolveCommunicationWorkspace:key=>store.getCommunicationWorkspace(key)});
let runFiles = null, communications = null, taskPatrol = null, automationScheduler = null;
const taskDeletionLocks = new Set();
const automationDeletionLocks = new Set();
const eventStreams = new Set();
let runtimeTestActive = false;
let resettingData = false, resetCommitted = false, writeRequests = 0;
let updateRestartLease = null;
const runtimeConfiguration = createRuntimeConfiguration(runtimeConfigRoot);
const marketplace = createMarketplace(runtimeConfigRoot);
// Serialize manual imports through preparation and commit, so simultaneous
// first imports cannot both miss the existing catalog entry.
let extensionImportTail=Promise.resolve();
function importExtensions(prepare) {
  const operation=extensionImportTail.then(async()=>{
    const targetStore=store, result=await prepare();
    const candidates=result.plugins?[...result.plugins,...result.mcps]:[result];
    try {
      const plan=targetStore.planExtensionImport(candidates,targetStore.listExtensions());
      const bindings=await Promise.all(plan.bindings.map(async binding=>({
        agentId:binding.agentId,previousRuntime:binding.previousRuntime,
        runtime:{profileId:binding.previousRuntime.profileId,...await marketplace.resolve(binding.selection,binding.previousRuntime.provider)}
      })));
      if(store!==targetStore || resettingData)throw new Error('实例正在重置，本次导入未应用');
      const roleBindings=await marketplace.resolveRoleReplacements(targetStore.listRoles(),plan.replacements);
      return targetStore.transaction(()=>{ targetStore.registerExtensions(candidates); return {...result,...targetStore.replaceImportedExtensions(plan.replacements,bindings,roleBindings)}; });
    } catch(error) {
      if(error.committed)throw error;
      for(const item of candidates)try{targetStore.removeExtension(item);}catch(cleanupError){diagnostic('extensions.import_cleanup_failed',{error:cleanupError});}
      throw error;
    }
  });
  extensionImportTail=operation.catch(()=>{});
  return operation;
}
const pluginUpdates=createPluginUpdates({getStore:()=>store,marketplace,canRun:()=>!resettingData && !updateRestartLease && !store.configurationBlocked()});
const runExecutionOptions = { runFilesRoot, resolveGitCredential: (url) => runtimeConfiguration.resolveGitCredential(url) };
// Subscribe only to future committed metadata. No history scan or polling.
function subscribeDesktopNotifications(current) {
  current.subscribeNotifications(notice=>{
    if(store!==current || resettingData || !process.connected)return;
    try { process.send({type:'agentforge-notification',notice},error=>{if(error)diagnostic('desktop.notification_send_failed',{error});}); }
    catch(error){diagnostic('desktop.notification_send_failed',{error});}
  });
}
const wakeCommunication = (id) => setImmediate(() => { if (!resettingData && !updateRestartLease && !store.configurationBlocked()) communications.kick(id).catch(error => diagnostic("communication.dispatch_error", { conversationId: id, error })); });

// Authentication and the owned-service handshake never open the business DB.
// The first business request or ten-second background tick initializes it once.
function ensureBusiness() {
  if (businessInitialization) return businessInitialization;
  businessInitialization = (async () => {
    const started = performance.now();
    let phase = 'workspace';
    try {
      diagnostic('business.starting', { phase });
      if (usesDefaultRoot) { await mkdir(storage.dataRoot, { recursive: true, mode: 0o700 }); await chmod(storage.dataRoot, 0o700); }
      phase = 'reset_recovery'; await dataReset.recover();
      phase = 'store'; diagnostic('business.starting', { phase });
      store = createStore(storeOptions); subscribeDesktopNotifications(store); runFiles = communicationFiles();
      phase = 'deletion_recovery';
      try {
        const recovery = await runFiles.recoverStagedTaskDeletions(runId => store.hasRun(runId));
        if (recovery.failed) diagnostic('business.deletion_recovery_incomplete', { failed: recovery.failed });
      } catch (error) { diagnostic('business.deletion_recovery_failed', { error }); }
      phase = 'execution_recovery';
      communications = createCommunicationService(store, { root: join(workspaceRoot, 'communications'), files: runFiles });
      communications.recover();
      for (const runId of store.listRecoveryRunIds()) {
        const plan = store.getRunRecoveryPlan(runId);
        if (plan.interruptedTraceIds.length || plan.recoveredDispatchIds.length) store.recoverInterruptedRun(runId);
        if (store.getRunRecoveryPlan(runId).shouldExecute) void executeRun(store, runId, runExecutionOptions).catch(error => diagnostic('task.recovery_error', { error, runId }));
      }
      pluginUpdates.start(); startSchedulers();
      void communications.poll().catch(error => diagnostic('communication.recovery_error', { error }));
      diagnostic('business.ready', { elapsedMs: performance.now() - started });
      return store;
    } catch (error) {
      businessFailure = error;
      diagnostic('business.start_failed', { phase, elapsedMs: performance.now() - started, error });
      throw error;
    }
  })();
  return businessInitialization;
}
async function employeeInput(request, agentId = null) {
  const input = await readJson(request);
  const allowed = ['name', 'kind', 'description', 'systemPrompt', 'capabilities', 'status', 'runtime', 'roleIds'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new Error('员工配置字段无效，请按当前配置协议提交');
  if (input.runtime !== undefined && (!input.runtime || typeof input.runtime !== 'object' || Array.isArray(input.runtime) || Object.keys(input.runtime).some(key => !['profileId', 'extensionSelection'].includes(key)))) throw new Error('员工Runtime仅接受profileId和extensionSelection；扩展只选择已安装插件和MCP');
  const previous = agentId ? store.listAgents().find(agent => agent.id === agentId)?.runtime : undefined;
  if (agentId && !previous) throw new Error('数字员工不存在');
  if(agentId && input.runtime===undefined && input.roleIds===undefined)return input;
  const profileId = Object.hasOwn(input.runtime || {}, 'profileId') ? input.runtime.profileId : previous?.profileId ?? store.listRuntimeProfiles().find(item => item.provider === 'claude-code')?.id;
  const profile = store.listRuntimeProfiles().find(item => item.id === profileId);
  if (!profile) throw new Error('请选择固定 Runtime 的有效 profileId');
  if (!profile.enabled && profileId !== previous?.profileId) throw new Error('Runtime 已停用，请先在设置中启用');
  const selection = Object.hasOwn(input.runtime || {}, 'extensionSelection') ? input.runtime.extensionSelection : previous?.extensionSelection ?? {pluginIds:[], mcpIds:[]};
  for (const [kind,ids] of [['plugin',selection.pluginIds],['mcp',selection.mcpIds]]) {
    if (!Array.isArray(ids)) throw new Error('插件/MCP 选择无效');
    if (ids.some(id=>!store.getExtension(kind,id))) throw new Error('所选插件或 MCP 未安装或已删除，请刷新选择');
  }
  const resolved = await marketplace.resolve(selection, profile.provider);
  const {provider, model, executable, profile: cliProfile, effort} = profile;
  input.runtime = {profileId, provider, model, executable, profile: cliProfile, effort, ...resolved};
  await validateInheritedExtensions({...input,roleIds:input.roleIds ?? store.listAgents().find(item=>item.id===agentId)?.roleIds ?? []});
  return input;
}

async function validateInheritedExtensions(employee,roles=null) {
  const currentRoles=roles===null;roles ||= store.listRoles();
  if(!Array.isArray(employee.roleIds))throw new Error('roleIds 必须是角色 ID 数组');
  const selections=[employee.runtime.extensionSelection];
  for(const id of employee.roleIds){const role=roles.find(item=>item.id===id);if(!role)throw new Error('绑定的角色不存在');selections.push(role.extensionSelection);}
  await marketplace.resolve(Object.fromEntries(['pluginIds','mcpIds'].map(key=>[key,[...new Set(selections.flatMap(item=>item?.[key] || []))]])),employee.runtime.provider);
  // A newly selected Runtime can derive its missing role plan from the same
  // immutable IDs. Existing target plans and frozen Task/Run facts stay intact.
  if(currentRoles){const provider=employee.runtime.provider;for(const id of employee.roleIds){const role=roles.find(item=>item.id===id);if((role.extensionSelection.pluginIds.length || role.extensionSelection.mcpIds.length) && !store.hasRoleRuntimeBinding(id,provider))store.ensureRoleRuntimeBinding(id,provider,role.extensionSelection,await marketplace.resolve(role.extensionSelection,provider));}}
}

function extensionPage(kind, searchParams) {
  if ([...searchParams.keys()].some(key=>!['page','search'].includes(key)) || ['page','search'].some(key=>searchParams.getAll(key).length>1)) throw new Error('目录查询只接受 page 与 search');
  const rawPage = searchParams.get('page') ?? '1';
  if (!/^[1-9][0-9]*$/.test(rawPage)) throw new Error('page 必须为正整数');
  const input = {page:Number(rawPage),search:searchParams.get('search') || ''};
  if (!Number.isSafeInteger(input.page) || input.search.length > 200) throw new Error('目录查询参数无效');
  const businessAvailable = store && !businessFailure;
  if (!businessAvailable) configurationPreview ||= createConfigurationStore({directory:storage.controlRoot,databasePath,readOnly:true});
  const {items,...pagination} = businessAvailable ? store.queryExtensions(kind,input) : configurationPreview.query(kind,input);
  return {...pagination,[kind==='plugin'?'plugins':'entries']:items};
}
async function roleInput(request,roleId=null) {
  const input = await readJson(request);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['name', 'prompt','extensionSelection'].includes(key))) throw new Error('角色配置字段无效，请按当前配置协议提交');
  if(input.extensionSelection!==undefined) {
    const selection=input.extensionSelection;
    if(!selection || ['pluginIds','mcpIds'].some(key=>!Array.isArray(selection[key])))throw new Error('角色扩展选择无效');
    for(const [kind,key] of [['plugin','pluginIds'],['mcp','mcpIds']])for(const id of selection[key])if(!store.getExtension(kind,id))throw new Error('角色所选扩展未安装或已删除');
    Object.assign(input,await marketplace.resolveRole(selection));
    const roles=store.listRoles().map(role=>role.id===roleId?{...role,...input}:role);
    for(const employee of store.listAgents().filter(item=>item.roleIds.includes(roleId)))await validateInheritedExtensions(employee,roles);
  }
  return input;
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};
const languageFor = (name = "") => ({ js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript", json: "json", yml: "yaml", yaml: "yaml", toml: "ini", sql: "sql", py: "python", java: "java", go: "go", rs: "rust", sh: "bash", css: "css", html: "xml", htm: "xml", xml: "xml", md: "markdown", mdx: "markdown", diff: "diff", patch: "diff" }[extname(name).slice(1).toLowerCase()] || null);
const rasterImageType = (mediaType = "") => /^image\/(png|jpeg|gif|webp)$/.test(mediaType);
function attachmentImageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && /^(avif|avis)$/.test(bytes.toString('ascii', 8, 12))) return 'image/avif';
  return null;
}
function artifactPresentation(artifact, content) { const language = languageFor(artifact.name); return { language, highlightedHtml: language ? hljs.highlight(content, { language, ignoreIllegals: true }).value : null }; }
function artifactReadError(error) {
  const message = error instanceof Error ? error.message : "";
  if (message === "产物路径不合法" || message === "Artifact 必须是常规文件" || message === "Artifact 快照完整性无法验证" || message === "Artifact 快照完整性校验失败" || /^产物大于 \d+ 字节，请在本地文件系统中查看$/.test(message)) return error;
  return new Error("Artifact 文件不可读取或已不存在");
}
async function readArtifactSafely(read) {
  try { return await read(); }
  catch (error) { throw artifactReadError(error); }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

const maxJsonBodyBytes = 1024 * 1024;
class RequestBodyTooLargeError extends Error {
  constructor(message = "请求体超过 1 MiB 上限") { super(message); }
}

async function readJson(request) {
  let body = "", bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    if (bytes > maxJsonBodyBytes) throw new RequestBodyTooLargeError();
    body += chunk;
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("请求体不是有效 JSON");
  }
}

async function withTaskDeletionLock(locks, taskId, work) {
  if (locks.has(taskId)) throw new Error("Task 正在删除，请稍候");
  locks.add(taskId);
  try { return await work(); }
  finally { locks.delete(taskId); }
}

async function routeApi(request, response, pathname, searchParams = new URLSearchParams()) {
  if (request.method === 'GET' && pathname === '/api/bootstrap' && searchParams.get('view') === 'connection') {
    sendJson(response,200,{settings:{workspaceRoot,source:'startup'},businessReady:Boolean(communications && !businessFailure)});
    return true;
  }
  if(!['GET','HEAD','OPTIONS'].includes(request.method)) {
    const runId=pathname.match(/^\/api\/runs\/([^/]+)/)?.[1],taskId=pathname.match(/^\/api\/tasks\/([^/]+)/)?.[1];
    if(taskDeletionLocks.has(taskId) || (runId && taskDeletionLocks.has(store.getRun(runId)?.taskId)))throw new Error('任务正在删除，请稍候');
  }
  if (pathname === "/api/settings/reset" && request.method === "POST") {
    const input = await readJson(request);
    if (input.confirmation !== "清除所有数据") throw new Error("请输入「清除所有数据」确认");
    await auth.reauthenticate(request, input.password);
    if (resettingData || writeRequests !== 1 || runtimeTestActive || pluginUpdates.status().running || communications.isActive() || taskDeletionLocks.size || store.listRecoveryRunIds().some(hasActiveExecution)) { sendJson(response, 409, { error: "仍有执行或保存操作，请停止后重试" }); return true; }
    const workspaces = store.prepareDataReset();
    resettingData = true;
    try {
      await dataReset.begin(workspaces);
      resetCommitted = true;
      for (const stream of eventStreams) stream.end();
      eventStreams.clear();
      closeExecutionBudget(store);store.close();
      await dataReset.recover();
      store = createStore(storeOptions); subscribeDesktopNotifications(store); runFiles=communicationFiles();
      pluginUpdates.reset();
      communications = createCommunicationService(store, { root: join(workspaceRoot, "communications"), files: runFiles });
      startSchedulers();
      diagnostic("instance.reset_completed");
      resetCommitted = false;
      sendJson(response, 200, { ok: true, next: "/" });
    } catch (error) {
      if (resetCommitted) { diagnostic("instance.reset_incomplete", { error }); sendJson(response, 503, { error: "清除尚未完成，请重启 AgentForge 后继续清除；正常使用已暂停。" }); }
      else throw error;
    } finally { resettingData = resetCommitted; }
    return true;
  }
  const attachmentRoute = pathname.match(/^\/api\/(communications|runs)\/([^/]+)\/attachments(?:\/([^/]+))?$/);
  const chatAttachment = attachmentRoute && [attachmentRoute[0], attachmentRoute[2], attachmentRoute[3]];
  const taskAttachment = attachmentRoute?.[1] === 'runs';
  if (chatAttachment && request.method === 'POST' && !chatAttachment[2]) {
    if (!/^application\/octet-stream(?:;|$)/i.test(request.headers['content-type'] || '')) throw new Error('附件上传需要 application/octet-stream');
    const key = chatAttachment[1]; if (taskAttachment) store.assertRunAttachmentUpload(key); else store.prepareCommunicationWorkspace(key,join(workspaceRoot,"communications"));
    let record;
    try { record=await runFiles[taskAttachment?'writeRunAttachment':'writeCommunicationAttachment'](key,searchParams.get('name'),request.iterator({destroyOnReturn:false})); }
    catch(error){if(error.code==='ATTACHMENT_TOO_LARGE')throw new RequestBodyTooLargeError(error.message);throw error;}
    finally{if(!request.readableEnded)request.resume();}
    try { sendJson(response, 201, { attachment: store[taskAttachment ? 'registerRunAttachment' : 'registerCommunicationAttachment'](key, record) }); }
    catch (error) { await runFiles[taskAttachment ? 'discardRunAttachment' : 'discardCommunicationAttachment'](key, record).catch(cleanup => diagnostic('communication.attachment_cleanup_failed', { error: cleanup })); throw error; }
    return true;
  }
  if (chatAttachment && ['GET','HEAD'].includes(request.method) && chatAttachment[2]) {
    const key=chatAttachment[1],scope=taskAttachment?'runs':'communications',record=store[taskAttachment?'getRunAttachment':'getCommunicationAttachment'](key,chatAttachment[2]);
    const preview=searchParams.get('preview')==='1',thumbnail=preview&&searchParams.get('thumbnail')==='1';
    const etag='"'+record.sha256+(thumbnail?'-thumbnail-v1':'')+'"';
    try{await runFiles.validateAttachment(scope,key,record);}catch(error){diagnostic('communication.attachment_read_failed',{error});sendJson(response,409,{error:'附件不可读取或完整性校验失败；请核对原文件。'});return true;}
    const headers={'Cache-Control':'private, no-cache',ETag:etag,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"};
    if(request.headers['if-none-match']===etag){response.writeHead(304,headers);response.end();return true;}
    if(request.method==='HEAD'){response.writeHead(200,{...headers,'Content-Length':record.bytes});response.end();return true;}
    if(thumbnail){
      try{const content=await attachmentThumbnail(record.sha256,()=>runFiles.openAttachment(scope,key,record));response.writeHead(200,{...headers,'Content-Type':'image/png','Content-Length':content.length});response.end(content);}
      catch(error){diagnostic('attachment.thumbnail_failed',{error});sendJson(response,415,{error:'此图片无法生成缩略图，请打开或下载原文件。'});}
      return true;
    }
    let file;try{file=await runFiles.openAttachment(scope,key,record);}catch(error){diagnostic('communication.attachment_read_failed',{error});sendJson(response,409,{error:'附件不可读取或完整性校验失败；请核对原文件。'});return true;}
    const mediaType=preview?attachmentImageType(file.head):'application/octet-stream';
    if(!mediaType){file.stream.destroy();sendJson(response,415,{error:'此附件不是可预览的图片，请下载原文件。'});return true;}
    const filename=encodeURIComponent(record.name).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    response.writeHead(200,{...headers,'Content-Type':mediaType,'Content-Length':file.bytes,'Content-Disposition':preview?'inline':`attachment; filename="download"; filename*=UTF-8''${filename}`});
    try{await pipeline(file.stream,response);}catch(error){if(!response.destroyed)response.destroy(error);}return true;
  }
  const chatConsole = pathname.match(/^\/api\/communications\/([^/]+)\/console$/);
  if (chatConsole && request.method === 'GET') {
    sendJson(response, 200, store.getCommunicationConsole(chatConsole[1], { agentId: searchParams.get('agentId'), before: searchParams.get('before'), limit: Number(searchParams.get('limit') || 50) })); return true;
  }
  const chatContent = pathname.match(/^\/api\/communications\/([^/]+)\/(console-content\/([^/]+)|traces\/([^/]+)\/prompt)$/);
  if (chatContent && request.method === 'GET') {
    const reference = store.getCommunicationContentReference(chatContent[1], chatContent[3] || chatContent[4], { prompt: Boolean(chatContent[4]) });
    try { sendJson(response, 200, await runFiles.readConsoleContent(reference)); }
    catch (error) { diagnostic('communication.console_content_failed', { error }); sendJson(response, 409, { error: '执行内容不可读取或完整性校验失败；未恢复旧内容。' }); }
    return true;
  }
  const readChat = pathname.match(/^\/api\/communications\/([^/]+)\/read$/);
  if (readChat && request.method === "POST") { sendJson(response, 200, { conversation: store.markCommunicationRead(readChat[1], (await readJson(request)).messageId) }); return true; }
  if (pathname === "/api/notifications" && request.method === "GET") { sendJson(response, 200, store.getNavigationNotifications()); return true; }
  if (request.method === "GET" && pathname === "/api/settings/log-files") {
    sendJson(response, 200, diagnostics().status());
    return true;
  }
  if (request.method === "GET" && pathname === "/api/settings/execution-logs") {
    sendJson(response, 200, store.getExecutionLogs({ source: searchParams.get("source") || "all", level: searchParams.get("level") || "all", before: searchParams.get("before"), limit: Number(searchParams.get("limit") || 100) }));
    return true;
  }
  if (pathname === "/api/communications" && request.method === "GET") { sendJson(response, 200, (()=>{const {items,...page}=store.listCommunications({page:Number(searchParams.get('page')||1)});return {conversations:items,...page};})()); return true; }
  if (pathname === "/api/communications" && request.method === "POST") { sendJson(response, 200, { conversation: store.openCommunication(await readJson(request)) }); return true; }
  const chat = pathname.match(/^\/api\/communications\/([^/]+)(?:\/(messages|deliveries)(?:\/([^/]+)\/(retry|cancel|events))?)?$/);
  if (chat) {
    const [, key, action, deliveryId, operation] = chat;
    const pagination = { before: searchParams.get("before"), limit: Number(searchParams.get("limit") || 100), since:searchParams.get("since") };
    if (!action && request.method === "GET") { sendJson(response, 200, store.getCommunication(key, pagination)); return true; }
    if (!action && request.method === "PUT") { sendJson(response, 200, { conversation: store.updateCommunication(key, await readJson(request)) }); return true; }
    if (action === "messages" && request.method === "POST") {
      const message = store.sendCommunication(key, await readJson(request));
      sendJson(response, 202, { message }); wakeCommunication(key); return true;
    }
    if (operation === "retry" && request.method === "POST") { store.retryCommunication(key, deliveryId); sendJson(response, 202, { ok: true }); wakeCommunication(key); return true; }
    if (operation === "cancel" && request.method === "POST") { store.cancelCommunication(key, deliveryId); sendJson(response, 200, { ok: true }); wakeCommunication(key); return true; }
    if (operation === "events" && request.method === "GET") { sendJson(response, 200, store.getCommunicationEvents(key, deliveryId, pagination)); return true; }
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return true;
  }
  if(request.method==='GET' && pathname==='/api/catalog-references'){sendJson(response,200,store.getCatalogReferences());return true;}
  if(request.method==='GET' && pathname==='/api/overview'){sendJson(response,200,store.getOverview());return true;}
  const directoryPaths={'/api/tasks':['tasks','tasks'],'/api/agents':['agents','agents'],'/api/roles':['roles','roles'],'/api/teams':['teams','teams'],'/api/workflow-templates':['workflowTemplates','workflowTemplates']};
  if(request.method==='GET' && directoryPaths[pathname] && searchParams.has('page')) {
    const [name,key]=directoryPaths[pathname],query=Object.fromEntries(searchParams);
    const allowed=['page','pageSize','search','status','role','workflow','archived'];
    if(Object.keys(query).some(key=>!allowed.includes(key)))throw new Error('目录查询参数无效');
    if(query.archived!==undefined && !['true','false'].includes(query.archived))throw new Error('archived 必须为 true 或 false');
    const {items,...pagination}=store.queryDirectory(name,{...query,archived:query.archived==='true'});
    sendJson(response,200,{[key]:items,...pagination});return true;
  }
  const directoryDetail=pathname.match(/^\/api\/(tasks|agents|roles|teams|workflow-templates)\/([^/]+)$/);
  if(request.method==='GET' && directoryDetail){
    const names={tasks:['tasks','task'],agents:['agents','agent'],roles:['roles','role'],teams:['teams','team'],'workflow-templates':['workflowTemplates','workflowTemplate']};
    const [name,key]=names[directoryDetail[1]];sendJson(response,200,{[key]:store.getDirectoryItem(name,directoryDetail[2])});return true;
  }
  if (request.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(response, 200, { ...store.getBootstrap({light:searchParams.get("view")==="shell"}), settings: store.getWorkspaceSettings() });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/workflow-templates") {
    sendJson(response, 200, { workflowTemplates: store.listWorkflowTemplates() });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/workflow-templates") {
    sendJson(response, 201, { workflowTemplate: store.createWorkflowTemplate(await readJson(request)) });
    return true;
  }
  const workflowMatch = pathname.match(/^\/api\/workflow-templates\/([^/]+)$/);
  if (workflowMatch && request.method === "PUT") {
    sendJson(response, 200, { workflowTemplate: store.updateWorkflowTemplate(workflowMatch[1], await readJson(request)) });
    return true;
  }
  if (workflowMatch && request.method === "DELETE") {
    sendJson(response, 200, { workflowTemplate: store.deleteWorkflowTemplate(workflowMatch[1]) });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/agents") {
    sendJson(response, 200, { agents: store.listAgents() });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/roles") {
    sendJson(response, 200, { roles: store.listRoles() });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/roles") {
    sendJson(response, 201, { role: store.createRole(await roleInput(request)) });
    return true;
  }
  const roleMatch = pathname.match(/^\/api\/roles\/([^/]+)$/);
  if (roleMatch && request.method === "PUT") {
    sendJson(response, 200, { role: store.updateRole(roleMatch[1], await roleInput(request,roleMatch[1])) });
    return true;
  }
  if (roleMatch && request.method === "DELETE") {
    await readJson(request);
    sendJson(response, 200, { role: store.deleteRole(roleMatch[1]) });
    return true;
  }
  const historyMatch = pathname.match(/^\/api\/agents\/([^/]+)\/history\/([a-z_]+)$/);
  if (request.method === "POST" && historyMatch) {
    sendJson(response, 200, await queryHistory(store,historyMatch[1],historyMatch[2],await readJson(request),runFiles));
    return true;
  }
  if (pathname === "/api/settings/workspace" && request.method === "GET") {
    sendJson(response, 200, { workspaceRoot,source:'startup',version,businessRoot:storage.dataRoot,databasePath,runFilesRoot,runtimeConfigRoot,configurationRoot:storage.controlRoot,configurationFile:join(storage.controlRoot,'configuration.json'),authenticationRoot:storage.controlRoot,logDirectory:diagnostics().status().directory }); return true;
  }
  if (pathname === "/api/settings/workspace" && request.method === "PUT") {
    const input = await readJson(request);
    if(!input||Object.keys(input).some(key=>key!=='workspaceRoot'))throw new Error('数据目录仅接受 workspaceRoot');
    if(updateRestartLease||resettingData||writeRequests!==1||runtimeTestActive||taskDeletionLocks.size||pluginUpdates.status().running||communications.isActive()||store.pendingCommunications().length||store.listPatrolRunIds().length||store.listRecoveryRunIds().some(hasActiveExecution)){sendJson(response,409,{error:'仍有执行、排队任务或保存操作，请暂停执行并等待沟通结束后更换数据目录'});return true;}
    updateRestartLease={id:randomUUID(),purpose:'storage',timer:null};
    try{
      const target=await validateStorageDestination({sourceRoot:storage.dataRoot,workspaceRoot:input.workspaceRoot,instance:process.env.AGENTFORGE_INSTANCE_KIND||'desktop',configurationRoot:storage.controlRoot});
      if(target.unchanged){updateRestartLease=null;sendJson(response,200,{workspaceRoot:target.workspaceRoot,source:'startup',restarting:false,version});return true;}
      response.once('finish',()=>process.send?.({type:'agentforge-storage-restart',id:updateRestartLease.id,workspaceRoot:target.workspaceRoot}));
      sendJson(response,200,{workspaceRoot:target.workspaceRoot,businessRoot:target.businessRoot,restarting:true,version});return true;
    }catch(error){updateRestartLease=null;throw error;}
  }
  // CLI paths are executed via execFile without a shell, so spaces and
  // non-ASCII are legitimate; only control characters/newlines are rejected.

  if (pathname === "/api/settings/runtime-profiles/models" && request.method === "GET") {
    const provider = searchParams.get("provider") || "";
    if (!RUNTIME_IDS.includes(provider)) throw new Error("provider 必须是已支持的 Runtime ID");
    if (searchParams.has("executable")) throw new Error("固定 Runtime 不接受自定义 executable");
    if (!runtimeInstalled(provider)) throw new Error("Runtime 未安装或当前客户端找不到可执行文件；安装并配置 PATH 后重新打开客户端");
    if(searchParams.has('refresh') && searchParams.get('refresh')!=='true')throw new Error('refresh 必须为 true');
    sendJson(response, 200, await runtimeModelCatalog({ provider },{refresh:searchParams.get('refresh')==='true'}));
    return true;
  }
  if (pathname === "/api/settings/runtime-profiles" && request.method === "GET") {
    sendJson(response, 200, { profiles: store.listRuntimeProfiles() }); return true;
  }
  // Per-model effort validation uses the real catalog when the saved model is
  // listed; manual models and catalog outages keep capability unknown (no
  // invented rejection). Store still enforces the provider vocabulary.
  async function assertRuntimeEffortSupport(input) {
    const effort = typeof input?.effort === "string" ? input.effort.trim() : "";
    const model = typeof input?.model === "string" ? input.model.trim() : "";
    const provider = input?.provider || "claude-code";
    if (!effort || !model || !RUNTIME_IDS.includes(provider) || !runtimeInstalled(provider)) return;
    const catalog = await runtimeModelCatalog({ provider }).catch(error => { diagnostic("settings.model_catalog_validation_skipped", { error }); return null; });
    assertModelEffort(catalog, model, effort);
  }
  if (pathname === "/api/settings/runtime-profiles" && request.method === "POST") {
    const input = await readJson(request);
    throw new Error("Runtime 固定为 Claude Code、Codex 和 DeepSeek Harness，不支持新增");
  }
  const runtimeProfileMatch = pathname.match(/^\/api\/settings\/runtime-profiles\/([^/]+)(\/test)?$/);
  if (runtimeProfileMatch && request.method === "PUT" && !runtimeProfileMatch[2]) {
    const input = await readJson(request);
    const previous = store.listRuntimeProfiles().find(item => item.id === runtimeProfileMatch[1]);
    if (previous && (Object.hasOwn(input, "model") || Object.hasOwn(input, "effort")) && Object.keys(input).every(key => ["model", "effort", "enabled"].includes(key))) await assertRuntimeEffortSupport({ ...previous, ...input, provider: previous.provider });
    sendJson(response, 200, store.saveRuntimeProfile(input, runtimeProfileMatch[1])); return true;
  }
  if (runtimeProfileMatch && request.method === "DELETE" && !runtimeProfileMatch[2]) {
    throw new Error("固定 Runtime 不能删除，请使用 enabled 开关");
  }
  if (runtimeProfileMatch?.[2] && request.method === "POST") {
    const profile = store.listRuntimeProfiles().find(item => item.id === runtimeProfileMatch[1]);
    if (!profile) throw new Error("Runtime 配置不存在");
    store.assertRuntimeEnabled(profile);
    if (runtimeTestActive) { sendJson(response, 409, { error: "已有连接测试正在执行，请等待完成" }); return true; }
    runtimeTestActive = true;
    try { sendJson(response, 200, await probeRuntime(profile)); }
    finally { runtimeTestActive = false; }
    return true;
  }
  if (request.method === "GET" && pathname === "/api/runtime/git-credentials") {
    sendJson(response, 200, await runtimeConfiguration.listGitCredentials());
    return true;
  }
  const gitCredentialMatch = pathname.match(/^\/api\/runtime\/git-credentials\/(github|gitlab)$/);
  if (gitCredentialMatch && request.method === "PUT") {
    sendJson(response, 200, await runtimeConfiguration.saveGitCredential(gitCredentialMatch[1], (await readJson(request)).token));
    return true;
  }
  if (gitCredentialMatch && request.method === "DELETE") {
    await readJson(request);
    sendJson(response, 200, await runtimeConfiguration.removeGitCredential(gitCredentialMatch[1]));
    return true;
  }
  if(pathname==='/api/runtime/marketplace/updates' && ['GET','POST'].includes(request.method)) {
    if(request.method==='POST'){await readJson(request);void pluginUpdates.check();}
    sendJson(response,request.method==='POST'?202:200,pluginUpdates.status());return true;
  }
  if(pathname==='/api/runtime/marketplace/updates/settings' && request.method==='PUT') {
    const input=await readJson(request);
    sendJson(response,200,pluginUpdates.configure(input));return true;
  }
  if (pathname === "/api/runtime/mcp-marketplace" && ["GET", "POST"].includes(request.method)) {
    response.setHeader("Cache-Control", "no-store");
    const input=request.method==='POST'?await readJson(request):null;
    const result = request.method === "GET" ? extensionPage("mcp", searchParams) : await importExtensions(()=>marketplace.add({...input, kind:"mcp", visibility:"market"}));

    sendJson(response, request.method === "GET" ? 200 : 201, result);
    return true;
  }
  if (pathname === "/api/runtime/marketplace" && ["GET", "POST"].includes(request.method)) {
    response.setHeader("Cache-Control", "no-store");
    const input=request.method==='POST'?await readJson(request):null;
    const result = request.method === "GET" ? extensionPage("plugin", searchParams) : await importExtensions(()=>marketplace.import(input));

    sendJson(response, request.method === "GET" ? 200 : 201, result);
    return true;
  }
  const compatibilityMatch=pathname.match(/^\/api\/runtime\/(marketplace|mcp-marketplace)\/([^/]+)\/compatibility$/);
  if(compatibilityMatch && request.method==='POST'){
    const kind=compatibilityMatch[1]==='marketplace'?'plugin':'mcp',id=compatibilityMatch[2];
    if(!store.getExtension(kind,id)){sendJson(response,404,{error:'扩展未安装或已删除'});return true;}
    const input=await readJson(request);if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)throw new Error('兼容性检查不接受配置字段');
    const detail=await marketplace.detail(id,kind);
    sendJson(response,200,store.refreshExtensionCompatibility(kind,id,detail));return true;
  }
  const mcpToolsMatch=pathname.match(/^\/api\/runtime\/mcp-marketplace\/([^/]+)\/tools$/);
  if(mcpToolsMatch && request.method==='POST') {
    response.setHeader('Cache-Control','no-store');
    if(!store.getExtension('mcp',mcpToolsMatch[1])){sendJson(response,404,{error:'此 MCP 未安装或已删除'});return true;}
    const input=await readJson(request);
    if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>key!=='refresh') || (input.refresh!==undefined && typeof input.refresh!=='boolean'))throw new Error('工具读取仅接受可选 refresh 布尔值');
    sendJson(response,200,await marketplace.tools(mcpToolsMatch[1],input));return true;
  }
  const extensionDetail = pathname.match(/^\/api\/runtime\/(marketplace|mcp-marketplace)\/([^/]+)$/);
  if(extensionDetail?.[1]==='mcp-marketplace' && request.method==='PUT') {
    const previousId=extensionDetail[2];
    if(!store.getExtension('mcp',previousId)){sendJson(response,404,{error:'此 MCP 未安装或已被更新，请刷新列表'});return true;}
    const input=await marketplace.mcpEditInput(previousId,await readJson(request));
    const replacement=await marketplace.add(input);
    try {
      const users=store.listAgents().filter(item=>item.runtime?.extensionSelection?.mcpIds?.includes(previousId));
      const bindings=await Promise.all(users.map(async item=>({agentId:item.id,previousRuntime:item.runtime,runtime:{profileId:item.runtime.profileId,...await marketplace.resolve({...item.runtime.extensionSelection,mcpIds:item.runtime.extensionSelection.mcpIds.map(id=>id===previousId?replacement.id:id)},item.runtime.provider)}})));
      const roleBindings=await marketplace.resolveRoleReplacements(store.listRoles(),[{kind:'mcp',previousId,id:replacement.id}]);
      sendJson(response,200,store.transaction(()=>{ store.registerExtensions([replacement]); return store.replaceMcpExtension(previousId,replacement,bindings,roleBindings); }));
    } catch(error) {
      if(error.committed)throw error;
      // Failed candidates are hidden, not used to rewrite any frozen files.
      try{store.removeExtension({kind:'mcp',id:replacement.id,name:replacement.name});}catch(cleanupError){diagnostic('mcp.edit_cleanup_failed',{error:cleanupError});}
      throw error;
    }
    return true;
  }
  if(extensionDetail && ['GET', 'DELETE'].includes(request.method)) {
    response.setHeader("Cache-Control", "no-store");
    const kind = extensionDetail[1] === 'marketplace' ? 'plugin' : 'mcp', extensionId = extensionDetail[2];
    const entry = store.getExtension(kind, extensionId);
    if (!entry) { sendJson(response, 404, { error: "此插件或 MCP 未安装或已删除" }); return true; }
    if (request.method === 'DELETE') {
      await readJson(request);
      const key=kind==='plugin'?'pluginIds':'mcpIds';
      const roles=await Promise.all(store.listRoles().filter(role=>role.extensionSelection[key].includes(entry.id)).map(async role=>({roleId:role.id,...await marketplace.resolveRole({...role.extensionSelection,[key]:role.extensionSelection[key].filter(id=>id!==entry.id)})})));
      sendJson(response, 200, store.transaction(()=>{const result=store.removeExtension({ kind, id: entry.id, name: entry.name });for(const role of roles)store.updateRole(role.roleId,role);return result;}));
    } else sendJson(response, 200, await marketplace.detail(extensionId, kind));
    return true;
  }
  if (request.method === "POST" && pathname === "/api/agents") {
    sendJson(response, 201, { agent: store.createAgent(await employeeInput(request)) });
    return true;
  }
  const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (agentMatch && request.method === "PUT") {
    sendJson(response, 200, { agent: store.updateAgent(agentMatch[1], await employeeInput(request, agentMatch[1])) });
    return true;
  }
  if (agentMatch && request.method === "DELETE") {
    sendJson(response, 200, { agent: store.deleteAgent(agentMatch[1]) }); return true;
  }
  if (request.method === "GET" && pathname === "/api/teams") {
    sendJson(response, 200, { teams: store.listTeams() });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/teams") {
    sendJson(response, 201, { team: store.createTeam(await readJson(request)) });
    return true;
  }
  const teamMatch = pathname.match(/^\/api\/teams\/([^/]+)$/);
  if (teamMatch && request.method === "PUT") {
    sendJson(response, 200, { team: store.updateTeam(teamMatch[1], await readJson(request)) });
    return true;
  }
  if (teamMatch && request.method === "DELETE") {
    sendJson(response, 200, { team: store.deleteTeam(teamMatch[1]) }); return true;
  }
  if (pathname === "/api/automations/preview" && request.method === "POST") {
    const input = await readJson(request);
    if (Object.keys(input).some(key => key !== "cron")) throw new Error("只接受 cron，自动使用本机时区");
    sendJson(response, 200, { times: previewSchedule(input.cron) }); return true;
  }
  if (pathname === "/api/automations" && request.method === "GET") {
    sendJson(response, 200, store.listAutomations(Object.fromEntries(searchParams))); return true;
  }
  if (pathname === "/api/automations" && request.method === "POST") {
    sendJson(response, 201, { automation: store.saveAutomation(await readJson(request)) }); return true;
  }
  const automationMatch = pathname.match(/^\/api\/automations\/([^/]+)(?:\/(triggers|trigger))?$/);
  if (automationMatch) {
    const [, automationId, action] = automationMatch;
    if(automationDeletionLocks.has(automationId) && request.method!=='GET')throw new Error('自动化正在删除，请稍候');
    if (request.method === "GET" && action === "triggers") { sendJson(response, 200, store.listAutomationTriggers(automationId, Object.fromEntries(searchParams))); return true; }
    if (request.method === "POST" && action === "trigger") {
      const record = store.triggerAutomation(automationId);
      if (record.runId && record.outcome === "started") void executeRun(store, record.runId, runExecutionOptions).catch(error => diagnostic("automation.execute_failed", {error, runId: record.runId}));
      sendJson(response, 201, { trigger: record }); return true;
    }
    if (!action && request.method === "GET") { sendJson(response, 200, { automation: store.getAutomation(automationId) }); return true; }
    if (!action && request.method === "PUT") { sendJson(response, 200, { automation: store.saveAutomation(await readJson(request), automationId) }); return true; }
    if (!action && request.method === "DELETE") {
      const plan=store.automationDeletionPlan(automationId);
      if(plan.taskIds.some(id=>taskDeletionLocks.has(id)))throw new Error('任务正在删除，请稍候');
      automationDeletionLocks.add(automationId);plan.taskIds.forEach(id=>taskDeletionLocks.add(id));
      let staged,deleted;
      try {
        for(const runId of plan.runIds)terminateRun(store,runId,'删除已停用自动化');
        const deadline=Date.now()+15000;
        while(plan.runIds.some(id=>isRunExecuting(store,id) || hasActiveExecution(id))) {
          if(Date.now()>deadline)throw new Error('任务仍在退出，请稍后重试删除；记录尚未删除');
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        staged=await runFiles.stageRunsForDeletion(plan.runIds);
        try { deleted=store.deleteAutomation(automationId); }
        catch(error){if(staged)await runFiles.restoreStagedRuns(staged);throw error;}
        try { if(staged)await runFiles.finalizeStagedRuns(staged); }
        catch { sendJson(response,202,{...deleted,runFileCleanup:'pending'});return true; }
        sendJson(response,200,deleted);return true;
      } finally { automationDeletionLocks.delete(automationId);plan.taskIds.forEach(id=>taskDeletionLocks.delete(id)); }
    }
  }
  if (request.method === "GET" && pathname === "/api/tasks") {
    sendJson(response, 200, { tasks: store.listTasks() });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/tasks") {
    const task = store.createTask(await readJson(request));
    // Directory preparation is retriable during Run startup; task creation is metadata-only.
    sendJson(response, 201, { task });
    return true;
  }
  const taskArchiveMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/archive$/);
  const taskUnarchiveMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/unarchive$/);
  if (request.method === "POST" && taskArchiveMatch) {
    sendJson(response, 200, { task: store.archiveTask(taskArchiveMatch[1]) });
    return true;
  }
  if (request.method === "POST" && taskUnarchiveMatch) {
    sendJson(response, 200, { task: store.unarchiveTask(taskUnarchiveMatch[1]) });
    return true;
  }
  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (request.method === 'PUT' && taskMatch) {
    sendJson(response,200,{task:store.updateTask(taskMatch[1],await readJson(request))});
    return true;
  }
  if (request.method === "DELETE" && taskMatch) {
    const taskId = taskMatch[1];
    return withTaskDeletionLock(taskDeletionLocks, taskId, async () => {
      store.assertTaskDeletionAllowed(taskId);
      const relatedRuns = store.taskRunIds(taskId).map(id=>({id}));
      const staged = await runFiles.stageRunsForDeletion(relatedRuns.map((run) => run.id));
      let deleted;
      try { deleted = store.deleteTask(taskId); }
      catch (error) {
        if (staged) {
          try { await runFiles.restoreStagedRuns(staged); }
          catch { console.error("Task deletion was rejected; retained Run files await safe recovery."); }
        }
        throw error;
      }
      try { if (staged) await runFiles.finalizeStagedRuns(staged); }
      catch {
        console.error("Task metadata was deleted; isolated Run files await cleanup recovery.");
        sendJson(response, 202, { ...deleted, runFileCleanup: "pending" });
        return true;
      }
      sendJson(response, 200, deleted);
      return true;
    });
  }
  const runMembersMatch = pathname.match(/^\/api\/runs\/([^/]+)\/members$/);
  if (request.method === "PUT" && runMembersMatch) {
    sendJson(response, 200, store.updateRunMembers(runMembersMatch[1], await readJson(request)));
    return true;
  }
  const runMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
  if (request.method === "POST" && runMatch) {
    const run = store.createRun(runMatch[1]);
    executeRun(store, run.id, runExecutionOptions).catch((error) => console.error(`Run ${run.id} dispatch failed: ${error.message}`));
    sendJson(response, 202, { run });
    return true;
  }
  const timelineMatch = pathname.match(/^\/api\/runs\/([^/]+)\/timeline$/);
  if (request.method === "GET" && timelineMatch) {
    sendJson(response, 200, { events: store.timeline(timelineMatch[1]), run: store.getRunSummary(timelineMatch[1]).run });
    return true;
  }
  const artifactList=pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
  if(request.method==='GET'&&artifactList){sendJson(response,200,store.getRunArtifacts(artifactList[1],{before:searchParams.get('before'),limit:Number(searchParams.get('limit')||20)}));return true;}
  const collaborationMatch=pathname.match(/^\/api\/runs\/([^/]+)\/collaboration$/);
  if(request.method==='GET'&&collaborationMatch){
    const {workspace,selected,...pagination}=store.getRunCollaboration(collaborationMatch[1],{before:searchParams.get('before'),limit:Number(searchParams.get('limit')||30),human:searchParams.get('human')==='true'});
    const ids=new Set(selected);sendJson(response,200,{...pagination,items:collaborationRecords(workspace).filter(item=>ids.has(item.id))});return true;
  }
  const traceDetail=pathname.match(/^\/api\/runs\/([^/]+)\/traces\/([^/]+)$/);
  if(request.method==='GET'&&traceDetail){sendJson(response,200,{trace:store.getRunTrace(traceDetail[1],traceDetail[2])});return true;}
  const workspaceMatch = pathname.match(/^\/api\/runs\/([^/]+)\/workspace$/);
  if (request.method === "GET" && workspaceMatch) {
    sendJson(response, 200, searchParams.get("view")==="compact" ? store.getRunSummary(workspaceMatch[1]) : store.getRunWorkspace(workspaceMatch[1], { summary: searchParams.get("view") === "summary" }));
    return true;
  }
  const consoleContentMatch = pathname.match(/^\/api\/runs\/([^/]+)\/console-content\/([^/]+)$/);
  if (request.method === "GET" && consoleContentMatch) {
    const reference = store.getConsoleContentReference(consoleContentMatch[1], consoleContentMatch[2]);
    try { sendJson(response, 200, await runFiles.readConsoleContent(reference)); }
    catch { sendJson(response, 409, { error: "执行内容不可读取或完整性校验失败；未恢复旧内容。" }); }
    return true;
  }
  const promptSnapshotMatch = pathname.match(/^\/api\/runs\/([^/]+)\/traces\/([^/]+)\/prompt$/);
  if (request.method === "GET" && promptSnapshotMatch) {
    const reference = store.getTracePromptReference(promptSnapshotMatch[1], promptSnapshotMatch[2]);
    try { sendJson(response, 200, await runFiles.readConsoleContent(reference)); }
    catch { sendJson(response, 409, { error: "提示词快照不可读取或完整性校验失败；未恢复旧内容。" }); }
    return true;
  }
  const consoleMatch = pathname.match(/^\/api\/runs\/([^/]+)\/console$/);
  if (request.method === "GET" && consoleMatch) {
    sendJson(response, 200, store.getConsoleEvents(consoleMatch[1], { agentId: searchParams.get("agentId"), traceId: searchParams.get("traceId"), before: searchParams.get("before"), limit: Number(searchParams.get("limit") || 200) }));
    return true;
  }
  const repositoryTreeMatch = pathname.match(/^\/api\/runs\/([^/]+)\/repository-tree$/);
  const workingChangesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/working-directory\/(changes|diff)$/);
  if (request.method === "GET" && workingChangesMatch) {
    const task = {...store.getRunTask(workingChangesMatch[1]), runId: workingChangesMatch[1]};
    sendJson(response, 200, workingChangesMatch[2] === "changes"
      ? await runFiles.listWorkingChanges(task)
      : await runFiles.readWorkingDiff(task, searchParams.get("path") || "", { full: searchParams.get("full") === "1" }));
    return true;
  }
  const workingDirectoryMatch = pathname.match(/^\/api\/runs\/([^/]+)\/working-directory(?:\/(content))?$/);
  if ((request.method === "GET" || request.method === 'HEAD' && searchParams.get('media')==='1') && workingDirectoryMatch) {
    const task = store.getRunTask(workingDirectoryMatch[1]);
    if (!workingDirectoryMatch[2]) sendJson(response, 200, await runFiles.listWorkingDirectory(task,{path:searchParams.get('path') || '',offset:Number(searchParams.get('offset') || 0)}));
    else {
      if(searchParams.get('media')==='1'){
        if(searchParams.get('raw')==='1' || searchParams.get('download')==='1')throw new Error('视频播放不能与其他读取模式同时使用');
        const file=await runFiles.openWorkingVideo(task,searchParams.get('path') || '');
        let transferred=false;
        try {
          const headers={'Content-Type':file.mediaType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Security-Policy':"default-src 'none'; sandbox"};
          let start=0,end=file.bytes-1,status=200;
          if(request.headers.range){
            const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
            const a=match?.[1]?Number(match[1]):null,b=match?.[2]?Number(match[2]):null;
            if(match && a===null && Number.isSafeInteger(b) && b>0){start=Math.max(0,file.bytes-b);}
            else if(match && Number.isSafeInteger(a) && a>=0 && (b===null || Number.isSafeInteger(b) && b>=a)){start=a;end=b===null?end:Math.min(end,b);}
            else start=file.bytes;
            if(start>=file.bytes || end<start){response.writeHead(416,{...headers,'Content-Range':`bytes */${file.bytes}`,'Content-Length':0});response.end();return true;}
            status=206;headers['Content-Range']=`bytes ${start}-${end}/${file.bytes}`;
          }
          response.writeHead(status,{...headers,'Content-Length':end-start+1});
          if(request.method==='HEAD'){response.end();return true;}
          const stream=file.handle.createReadStream({start,end});transferred=true;
          try{await pipeline(stream,response);}catch(error){if(!request.destroyed)diagnostic('http.working_video_stream_failed',{runId:workingDirectoryMatch[1],error});response.destroy();}
        }finally{if(!transferred)await file.handle.close();}
        return true;
      }
      const raw = searchParams.get("raw") === "1";
      const download = searchParams.get("download") === "1";
      const file = await runFiles.readWorkingFile(task, searchParams.get("path") || "", { raw, download });
      if (download) {
        const filename = encodeURIComponent(file.fileName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
        response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${filename}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
        try { await pipeline(file.content, response); }
        catch (error) { diagnostic("http.working_file_download_failed", { runId: workingDirectoryMatch[1], error }); response.destroy(); }
      }
      else if (raw) { response.writeHead(200, { "Content-Type": file.mediaType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" }); response.end(file.content); }
      else sendJson(response, 200, { ...file, ...(file.content == null ? {} : artifactPresentation({ name: file.path }, file.content)) });
    }
    return true;
  }
  if (request.method === "GET" && repositoryTreeMatch) {
    const task = store.getRunTask(repositoryTreeMatch[1]);
    const repositoryPath = searchParams.get("path") || "";
    const assignedRepository = task.repositoryMode === "agent" ? task.repositorySources.some((source) => source.path === repositoryPath) : task.workflowSnapshot.nodes.some((node) => node.repositoryPath === repositoryPath);
    if (!assignedRepository) throw new Error("该仓库不属于当前 Task 工作流");
    sendJson(response, 200, await runFiles.listRepositoryTree(task.workspacePath, repositoryPath));
    return true;
  }
  const artifactMatch = pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/([^/]+)\/content$/);
  if (request.method === "GET" && artifactMatch) {
    const artifact = store.getRunArtifact(artifactMatch[1], artifactMatch[2]);
    if (!artifact) throw new Error("Artifact 不存在");
    if (!artifact.storagePath) throw new Error(artifact.unavailableReason || "该 Artifact 没有可读取的真实文件");
    const file = await readArtifactSafely(() => runFiles.readArtifact(artifact.storagePath, { expected: artifact }));
    sendJson(response, 200, { artifact, ...file, ...artifactPresentation(artifact, file.content) });
    return true;
  }
  const artifactRawMatch = pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/([^/]+)\/raw$/);
  if (request.method === "GET" && artifactRawMatch) {
    const artifact = store.getRunArtifact(artifactRawMatch[1], artifactRawMatch[2]);
    if (!artifact?.storagePath) throw new Error("Artifact 不存在或不可读取");
    if (!rasterImageType(artifact.mediaType)) throw new Error("raw 预览仅支持 PNG、JPEG、GIF 和 WebP 图片");
    const content = await readArtifactSafely(() => runFiles.readArtifactBytes(artifact.storagePath, { expected: artifact }));
    response.writeHead(200, { "Content-Type": artifact.mediaType || "application/octet-stream", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; sandbox" });
    response.end(content);
    return true;
  }
  const confirmMatch = pathname.match(/^\/api\/runs\/([^/]+)\/confirm-completion$/);
  if (request.method === "POST" && confirmMatch) {
    sendJson(response, 200, { run: store.confirmRunCompletion(confirmMatch[1]) });
    return true;
  }
  const stopInquiryMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stop-inquiries$/);
  if (request.method === "POST" && stopInquiryMatch) {
    sendJson(response, 200, { run: stopInquiries(store, stopInquiryMatch[1]) });
    return true;
  }
  const messageMatch = pathname.match(/^\/api\/runs\/([^/]+)\/messages$/);
  if (request.method === "POST" && messageMatch) {
    const runId = messageMatch[1]; const input = await readJson(request);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key=>!['content','recipientAgentId','replyToMessageId','attachmentIds'].includes(key))) throw new Error('协作消息字段无效');
    store.initializeDispatches(runId);
    const result = store.submitHumanMessage(runId, { content: input.content, recipientAgentId: input.recipientAgentId, replyToMessageId: input.replyToMessageId, attachmentIds: input.attachmentIds });
    executeRun(store, runId, runExecutionOptions).catch((error) => console.error(`Run ${runId} dispatch failed: ${error.message}`));
    sendJson(response, 201, { ...result, replanRequested: false });
    return true;
  }
  const terminateMatch = pathname.match(/^\/api\/runs\/([^/]+)\/terminate$/);
  const pauseMatch = pathname.match(/^\/api\/runs\/([^/]+)\/pause$/);
  const resumeMatch = pathname.match(/^\/api\/runs\/([^/]+)\/resume$/);
  const retryNowMatch = pathname.match(/^\/api\/runs\/([^/]+)\/retry-now$/);
  const retryMatch = pathname.match(/^\/api\/runs\/([^/]+)\/retry-failed-node$/);
  const retryManagerMatch = pathname.match(/^\/api\/runs\/([^/]+)\/retry-orchestration$/);
  if (request.method === "POST" && retryNowMatch) {
    await readJson(request);
    const result = store.retryScheduledDispatches(retryNowMatch[1]);
    executeRun(store, result.run.id, runExecutionOptions).catch((error) => console.error(`Run ${result.run.id} dispatch failed: ${error.message}`));
    sendJson(response, 202, result);
    return true;
  }
  if (request.method === "POST" && retryManagerMatch) {
    const run = store.retryFailedOrchestration(retryManagerMatch[1]);
    executeRun(store, run.id, runExecutionOptions).catch((error) => console.error(`Run ${run.id} dispatch failed: ${error.message}`));
    sendJson(response, 202, { run });
    return true;
  }
  if (request.method === "POST" && retryMatch) {
    const run = store.retryFailedNode(retryMatch[1], (await readJson(request)).workflowNodeId);
    executeRun(store, run.id, runExecutionOptions).catch((error) => console.error(`Run ${run.id} dispatch failed: ${error.message}`));
    sendJson(response, 202, { run });
    return true;
  }
  if (request.method === "POST" && pauseMatch) {
    const input = await readJson(request);
    sendJson(response, 200, { run: pauseRun(store, pauseMatch[1], input.reason || "用户暂停") });
    return true;
  }
  if (request.method === "POST" && resumeMatch) {
    const run = resumeRun(store, resumeMatch[1]);
    store.addEvent({ type: "run.manager_patrol_requested", runId: run.id, message: "用户继续 Run；项目经理立即基于当前状态重新评估。", data: { trigger: "manual_resume" } });
    executeRun(store, run.id, runExecutionOptions).catch((error) => console.error(`Run ${run.id} resume failed: ${error.message}`));
    sendJson(response, 202, { run });
    return true;
  }
  if (request.method === "POST" && terminateMatch) {
    const input = await readJson(request);
    sendJson(response, 200, { run: terminateRun(store, terminateMatch[1], input.reason || "用户终止") });
    return true;
  }
  const streamMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (request.method === "GET" && streamMatch) {
    const runId = streamMatch[1];
    store.getRun(runId);
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    eventStreams.add(response);
    response.write(`event: ready\ndata: ${JSON.stringify({ runId })}\n\n`);
    // A slow reader reconnects and reads persisted pages; never accumulate an
    // unbounded per-client queue in the control-plane process.
    let congested=false;
    const write=chunk=>{
      if(response.writableEnded||response.destroyed)return;
      if(congested||response.writableLength+Buffer.byteLength(chunk)>256*1024){response.destroy();return;}
      congested=!response.write(chunk);
    };
    response.on('drain',()=>{congested=false;});
    const authorized = () => { if (response.writableEnded) return false; if (auth.session(request)) return true; response.write("event: auth-expired\ndata: {}\n\n"); response.end(); return false; };
    const unsubscribe = store.subscribe((event) => { if (event.runId === runId && authorized()) write(`event: run-event\ndata: ${JSON.stringify(event)}\n\n`); });
    const heartbeat = setInterval(() => { if (authorized()) write(": heartbeat\n\n"); }, 15000);
    request.on("close", () => { eventStreams.delete(response); clearInterval(heartbeat); unsubscribe(); });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "agentforge-control-plane", instanceId, time: new Date().toISOString() });
    return true;
  }
  return false;
}

async function serveStatic(response, pathname) {
  async function presented(content, extension) {
    if (extension !== ".html") return content;
    const css = await readFile(join(root, "apps/electron/compact.css"), "utf8");
    return content.toString("utf8").replace("</head>", `<style id="agentforge-desktop-style">${css}</style></head>`);
  }
  const bundles = { "/vendor/marked.js": markedBundle, "/vendor/dompurify.js": domPurifyBundle, "/vendor/highlight.css": highlightStylesheet, "/vendor/x6.js": x6Bundle, "/vendor/elk.js": elkBundle };
  if (bundles[pathname]) {
    try {
      const content = await readFile(bundles[pathname]);
      response.writeHead(200, { "Content-Type": contentTypes[extname(bundles[pathname])] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
      response.end(content);
    } catch { sendJson(response, 503, { error: "local_visual_runtime_unavailable" }); }
    return;
  }
  const clientModule = pathname.startsWith("/client/");
  const staticRoot = clientModule ? clientRoot : webRoot;
  const requested = clientModule ? pathname.slice("/client".length) : pathname === "/login" ? "/login.html" : pathname === "/setup" ? "/setup.html" : pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(join(staticRoot, requested));
  if (!(safePath === staticRoot || safePath.startsWith(`${staticRoot}/`))) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }
  try {
    const content = await readFile(safePath);
    const body = await presented(content, extname(safePath));
    response.writeHead(200, { "Content-Type": contentTypes[extname(safePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    if (clientModule) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    const fallback = await readFile(join(webRoot, "index.html"));
    const body = await presented(fallback, ".html");
    response.writeHead(200, { "Content-Type": contentTypes[".html"], "Cache-Control": "no-store" });
    response.end(body);
  }
}

const server = createServer(async (request, response) => {
  if (!auth) { sendJson(response, 503, { error: "服务正在启动" }); return; }
  const write = !["GET", "HEAD"].includes(request.method);
  if (write && updateRestartLease) { sendJson(response, 503, { error: "应用正在准备重启更新，请稍后重试" }); return; }
  if (resettingData) { sendJson(response, 503, { error: "正在清除数据，请稍后重试" }); return; }
  if (write) ++writeRequests;
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (await auth.guard(request, response, url)) return;
    const connectionRead = request.method === 'GET' && url.pathname === '/api/bootstrap' && url.searchParams.get('view') === 'connection';
    const configurationRead = request.method === 'GET' && ['/api/settings/workspace','/api/settings/log-files','/api/runtime/git-credentials','/api/runtime/marketplace','/api/runtime/mcp-marketplace'].includes(url.pathname);
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health' && !connectionRead && !configurationRead) {
      try { await ensureBusiness(); }
      catch (error) { sendJson(response, 503, { error: `业务数据未就绪：${error.message}` }); return; }
      if(store.configurationBlocked()){sendJson(response,503,{error:'配置发布尚未完成，请修复配置目录后重启恢复；不要重复提交'});return;}
    }
    const handled = await routeApi(request, response, url.pathname, url.searchParams);
    if (handled) return;
    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    diagnostic("http.request_failed", { method: request.method, pathname: (request.url || "").split("?")[0], error });
    sendJson(response, error.committed ? 503 : error instanceof RequestBodyTooLargeError ? 413 : 400, { error: error.message || "请求处理失败" });
  } finally { if (write) --writeRequests; }
});

server.listen(port, host, () => {
  const listeningPort = server.address().port;
  authOptions.origins = [`http://127.0.0.1:${listeningPort}`];
  auth = createAuth(authOptions);
  console.log(`AgentForge is running at http://${host}:${listeningPort}`);
  process.send({ type: "agentforge-ready", port: listeningPort, instanceId });
});

server.on('close',()=>pluginUpdates.stop());
process.once('disconnect',()=>process.kill(process.pid,'SIGTERM'));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  if (store) closeExecutionBudget(store);
  // Abort owned Git work before preserving the service's exit semantics.
  const finish=()=>process.exit(signal==='SIGINT'?130:143);
  setTimeout(finish,3000).unref();
  void pluginUpdates.stop().finally(finish);
});
// Only the owning parent can reserve an idle restart. Reserve synchronously,
// before acknowledging it, so no new HTTP write or scheduler can slip through.
process.on('message', async message => {
  if (!message || !/^[a-f0-9-]{36}$/.test(message.id || '')) return;
  if (message.type === 'agentforge-update-release' && updateRestartLease?.id === message.id) {
    clearTimeout(updateRestartLease.timer); updateRestartLease = null;
    process.send?.({type:'agentforge-update-released',id:message.id}); return;
  }
  if (message.type !== 'agentforge-update-prepare') return;
  try { await ensureBusiness(); }
  catch { process.send?.({ type: 'agentforge-update-readiness', id: message.id, ready: false }); return; }
  const busy = Boolean(updateRestartLease || resettingData || writeRequests || runtimeTestActive || taskDeletionLocks.size || pluginUpdates.status().running || communications.isActive()
    || store.listPatrolRunIds().length || store.listRecoveryRunIds().some(hasActiveExecution));
  if (!busy) {
    const timer = setTimeout(() => { updateRestartLease = null; }, 30000); timer.unref();
    updateRestartLease = { id: message.id, timer };
  }
  process.send?.({ type: 'agentforge-update-readiness', id: message.id, ready: !busy });
});
const backgroundBootstrap = setInterval(() => {
  if (!businessInitialization && auth?.configured()) void ensureBusiness().catch(() => {});
}, 10000);
backgroundBootstrap.unref();
const communicationPoll = setInterval(() => { if (communications && !businessFailure && !resettingData && !updateRestartLease && !store.configurationBlocked()) communications.poll().catch(error => diagnostic("communication.poll_error", { error })); }, 15000);
communicationPoll.unref();
function startSchedulers() {
  taskPatrol?.stop(); automationScheduler?.stop();
  taskPatrol = createTaskPatrol({
    store, execute: runId => executeRun(store, runId, runExecutionOptions),
    isExecuting: runId => isRunExecuting(store, runId) || hasActiveExecution(runId),
    blocked: () => resettingData || Boolean(updateRestartLease) || store.configurationBlocked(),
    onError: (error, runId) => diagnostic('task.patrol_failed', { error, runId })
  });
  automationScheduler = createAutomationScheduler({ getStore: () => store, execute: (current, runId) => executeRun(current, runId, runExecutionOptions), blocked: () => resettingData || Boolean(updateRestartLease) || store.configurationBlocked(), onError: (error, runId) => diagnostic('automation.scheduler_failed', { error, runId }) });
  taskPatrol.start(); automationScheduler.start();
}
server.on('close', () => { clearInterval(backgroundBootstrap); clearInterval(communicationPoll); taskPatrol?.stop(); automationScheduler?.stop(); });
