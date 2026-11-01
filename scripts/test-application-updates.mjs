// Isolated real Electron renderer/IPC and streamed-file QA. Native signed
// installation is an injected fixture, never a replacement of the operator app.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';
import { createCatalogFixtureStore } from '../tests/fixture-store.mjs';

await mkdir('.data',{recursive:true});
const root=await mkdtemp(resolve('.data/application-updates-')),home=join(root,'home'),bundle=process.env.AGENTFORGE_UPDATES_APP;
const data=bundle?join(home,'.agentforge/desktop'):join(root,'client');
await mkdir(home,{recursive:true});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});
await auth.setAdministrator('updates-qa',password);auth.close();
const store=createCatalogFixtureStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});store.close();
const desktop=await electron.launch({...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/AgentForge')}:{args:['apps/electron/main.mjs']}),env:{...process.env,HOME:home,AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:90000});
const evidence={root,bundle:bundle||'source',cases:[]};
try{
  const page=await desktop.firstWindow();await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});
  const origin=new URL(page.url()).origin;
  await page.goto(origin+'/login');await page.locator('#username').fill('updates-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
  await page.goto(origin+'/tasks');
  assert.match(await page.evaluate(()=>window.agentforgeDesktop.checkAppUpdate().then(()=>'',e=>e.message)),/设置.*更新/,'production command rejects wrong route');
  const moduleRoot=bundle?resolve(bundle,'Contents/Resources/app.asar'):resolve('.');
  // Inject fixture adapters into the real controller, not replacement DOM.
  await desktop.evaluate(async({ipcMain,BrowserWindow},{moduleRoot,root,origin})=>{
    const {join}=process.getBuiltinModule('node:path');
    const load=process.getBuiltinModule('node:module').createRequire(join(moduleRoot,'package.json'));
    const {createApplicationUpdates,downloadReleaseInstaller,RELEASE_ROOT}=load('./apps/electron/updates.mjs');
    if(typeof load('electron-updater').MacUpdater!=='function')throw Error('Native updater dependency is not packaged');
    const {isUpdateSender,isConsoleURL}=load('./apps/electron/policy.mjs');
    const {createHash}=process.getBuiltinModule('node:crypto');
    const bytes=Buffer.from('isolated fake DMG for update UI, never executed'),digest=createHash('sha256').update(bytes).digest('hex');
    const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)),contents=window.webContents;
    const state=globalThis.agentforgeUpdateFixture={mode:'stable',native:false,busy:true,installed:0,opened:null,finish:null,controller:null};
    const send=contents.send.bind(contents);
    contents.send=(channel,...args)=>{
      if(channel==='desktop:updates:changed' && args[0]?.currentVersion!=='1.0.0-beta.1')return;
      return send(channel,...args);
    };
    state.reset=()=>{
      state.controller?.stop();
      const controller=createApplicationUpdates({currentVersion:'1.0.0-beta.1',packaged:true,arch:'arm64',nativeInstall:state.native,cacheRoot:join(root,'updates'),
        readLatest:async()=>{
          if(state.mode==='offline')throw Error('离线检查失败');
          if(state.mode==='none')return null;
          const version=state.mode==='beta'?'2.0.0-beta.2':'1.0.0';
          return {tag_name:'v'+version,draft:false,prerelease:state.mode==='beta',assets:[`AgentForge-${version}-arm64.dmg`,'latest-mac.yml'].map(name=>({name,state:'uploaded',size:bytes.length,digest:'sha256:'+digest,browser_download_url:`${RELEASE_ROOT}/download/v${version}/${name}`}))};
        },
        downloadInstaller:async(release,cache,progress,options)=>{
          progress({percent:25});await new Promise(resolve=>{state.finish=resolve;});
          return downloadReleaseInstaller(release,cache,progress,{...options,fetcher:async()=>new Response(bytes)});
        },
        openInstaller:async path=>{state.opened=path;return '';},
        createNativeUpdater:(_release,progress)=>({download:async()=>{progress({percent:50});await new Promise(resolve=>{state.finish=resolve;});},install(){state.installed++;}}),
        prepareRestart:async()=>{if(state.busy)throw Error('仍有任务执行，请结束后再重启安装');}
      });
      state.controller=controller;controller.subscribe(value=>contents.send('desktop:updates:changed',value));
      return controller;
    };
    state.reset();
    for(const [command,method] of [['status','snapshot'],['check','check'],['download','download'],['install','install']]){
      ipcMain.removeHandler('desktop:updates:'+command);
      ipcMain.handle('desktop:updates:'+command,event=>{
        const allowed=command==='status'?event.sender===contents && event.senderFrame===contents.mainFrame && isConsoleURL(event.senderFrame.url,origin):isUpdateSender(event,contents,origin);
        if(!allowed)throw Error('请在设置 → 更新中操作');return state.controller[method]();
      });
    }
  },{moduleRoot,root,origin});
  await page.goto(origin+'/settings/updates');await page.locator('[data-app-version]').filter({hasText:'1.0.0-beta.1'}).waitFor();
  assert.equal(await page.locator('[data-settings-page="updates"]').innerText(),'更新');
  assert.equal(await page.locator('[data-settings-page="plugins"]').count(),0);
  await page.getByRole('heading',{name:'应用更新',exact:true}).waitFor();
  await page.getByRole('heading',{name:'插件更新',exact:true}).waitFor();
  await page.locator('[data-plugin-update-form] [name=intervalMinutes]:not(:disabled)').waitFor();
  await page.locator('[data-plugin-update-form] [name=intervalMinutes]').fill('7');
  await page.locator('[data-plugin-update-form] [type=submit]').click();
  await page.locator('[data-plugin-update-note]').filter({hasText:'已保存'}).waitFor();
  assert.equal(await page.evaluate(async()=> (await (await fetch('/api/runtime/marketplace/updates')).json()).intervalMinutes),7);
  await page.locator('[data-plugin-update-form] [name=intervalMinutes]').fill('2');
  await page.locator('[data-plugin-update-form] [type=submit]').click();
  await page.locator('[data-plugin-update-note]').filter({hasText:'已保存'}).waitFor();
  assert.equal(await page.locator('[data-app-release]').count(),0);
  assert.equal(await page.locator('[data-app-github]').innerText(),'https://github.com/dengdai68/AgentForge-App');
  assert.equal(await page.locator('[data-app-github]').getAttribute('href'),'https://github.com/dengdai68/AgentForge-App');
  assert.equal(await page.locator('[data-app-github].small-button').count(),0);
  const check=()=>page.getByRole('button',{name:'检查更新',exact:true}).click();
  for(const mode of ['beta','none','offline']){
    await desktop.evaluate((_electron,mode)=>{globalThis.agentforgeUpdateFixture.mode=mode;},mode);await check();
    await page.locator('[data-app-update-status]').filter({hasText:mode==='offline'?'离线检查失败':mode==='none'?'尚未发布正式版':'没有可用'}).waitFor();
    assert.equal(await page.locator('[data-app-update-download]').isVisible(),false);evidence.cases.push(mode);
  }
  await desktop.evaluate(()=>{globalThis.agentforgeUpdateFixture.mode='stable';});await check();
  await page.locator('[data-app-update-status]').filter({hasText:'发现正式版 1.0.0'}).waitFor();
  assert.equal(await page.locator('.app-update-notice').count(),0,'available update is displayed only in update settings');
  await page.getByRole('button',{name:'任务中心',exact:true}).click();
  await desktop.evaluate(()=>globalThis.agentforgeUpdateFixture.controller.check());
  assert.equal(await page.locator('.app-update-notice').count(),0,'background check never inserts a notification card');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'下载更新',exact:true}).waitFor();
  await page.getByRole('button',{name:'下载更新',exact:true}).click({noWaitAfter:true});
  await page.locator('progress:visible').waitFor();assert.equal(await page.locator('progress').getAttribute('value'),'25');
  await page.screenshot({path:join(root,'downloading.png')});
  await desktop.evaluate(()=>globalThis.agentforgeUpdateFixture.finish());
  await page.getByRole('button',{name:'打开安装包',exact:true}).waitFor();
  assert.equal(await page.locator('.app-update-notice').count(),0,'download completion stays inside update settings');
  await page.getByRole('button',{name:'打开安装包',exact:true}).click();
  const opened=await desktop.evaluate(()=>globalThis.agentforgeUpdateFixture.opened);
  assert.equal(createHash('sha256').update(await readFile(opened)).digest('hex'),createHash('sha256').update('isolated fake DMG for update UI, never executed').digest('hex'));
  evidence.cases.push('verified manual download/open');
  await desktop.evaluate(()=>{const s=globalThis.agentforgeUpdateFixture;s.native=true;s.reset();});
  await page.goto(origin+'/settings/updates');await check();
  await page.getByRole('button',{name:'下载更新',exact:true}).click({noWaitAfter:true});await page.locator('progress:visible').waitFor();
  await desktop.evaluate(()=>globalThis.agentforgeUpdateFixture.finish());await page.getByRole('button',{name:'重启并安装',exact:true}).waitFor();
  await page.getByRole('button',{name:'重启并安装',exact:true}).click();await page.locator('[data-app-update-status]').filter({hasText:'仍有任务'}).waitFor();
  assert.equal(await desktop.evaluate(()=>globalThis.agentforgeUpdateFixture.installed),0);
  await desktop.evaluate(()=>{globalThis.agentforgeUpdateFixture.busy=false;});await page.getByRole('button',{name:'重启并安装',exact:true}).click();
  assert.equal(await desktop.evaluate(()=>globalThis.agentforgeUpdateFixture.installed),1);evidence.cases.push('native adapter busy/idle');
  for(const theme of ['minimal','warm'])for(const width of [1320,760]){
    await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value=${theme}]`).check();
    await desktop.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,760),{origin,width});
    await page.goto(origin+'/settings/updates');await page.locator('[data-app-version]').filter({hasText:'1.0.0-beta.1'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:join(root,`${theme}-${width}-updates.png`)});evidence.cases.push(`${theme}-${width}`);
  }
  evidence.result='PASS';await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('PASS application updates:',root);
}catch(error){console.error('Evidence:',root);throw error;}
finally{await desktop.close();}
