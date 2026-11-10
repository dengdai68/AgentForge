// Isolated desktop presentation/IPC acceptance. Provider fixture is not a real-model test.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {_electron as electron} from 'playwright-core';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStore} from '../server/store.mjs';
import {createAuth} from '../server/auth.mjs';
import {writeStorageLocation} from '../server/storage-layout.mjs';
import {testEnvironment} from './run-tests.mjs';
const root=await mkdtemp(join(tmpdir(),'af-desktop-notifications-')),home=join(root,'home'),data=join(home,'.agentforge/desktop'),workspace=join(root,'work');
await mkdir(home,{recursive:true});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('notice-qa',password);auth.close();
const real=process.env.AGENTFORGE_NOTIFICATIONS_REAL==='1',native=process.env.AGENTFORGE_NOTIFICATIONS_NATIVE==='1';
const bin=join(home,'.local/bin');await mkdir(bin,{recursive:true});const executable=join(bin,'claude');
if(!real)await writeFile(join(home,'.zshrc'),"export PATH='"+bin+"':$PATH\n");
if(!real)await writeFile(executable,`#!${process.execPath}
if(process.argv.includes('--version')){console.log('2.1.296');process.exit();}
const text=process.argv.join(' '),chat=process.argv.includes('--json-schema');
const result=chat?{reply:'PRIVATE_REPLY_NOT_FOR_NOTIFICATION',...(text.includes('mentionAgentIds')?{mentionAgentIds:[]}:{} )}:{summary:'隔离通知验收已完成',managerDecision:{nextNodeId:null,nextAgentId:null}};
console.log(JSON.stringify({type:'system',subtype:'init',session_id:process.argv[process.argv.indexOf(process.argv.includes('--session-id')?'--session-id':'--resume')+1]}));
console.log(JSON.stringify({type:'result',subtype:'success',result:JSON.stringify(result)}));
`,{mode:0o755});
const store=createStore({databasePath:join(workspace,'records/agentforge.sqlite'),workspaceRoot:workspace,configurationDirectory:data});store.setPluginUpdateSettings({enabled:false});
const agent=store.createAgent({name:'通知验收员工',systemPrompt:'通知测试。任务由你自行完成，完成后按协议提交人类验收；沟通简短答复即可，不联系其他人。',runtime:real?{provider:'claude-code'}:{provider:'claude-code',executable}});
const privateChat=store.openCommunication({kind:'agent',targetId:agent.id}),group=store.openCommunication({kind:'group',name:'通知验收群',memberAgentIds:[agent.id]});
// Pre-existing completed history must never replay as new notifications.
const oldTask=store.createTask({title:'历史通知不重放',objective:'isolated',memberAgentIds:[agent.id],managerAgentId:agent.id}),oldRun=store.createRun(oldTask.id);store.requestHumanAcceptance(oldRun.id);store.confirmRunCompletion(oldRun.id);store.close();
await writeStorageLocation(data,{version:1,workspaceRoot:workspace,previousRuntimeRoots:[]});
const bundle=process.env.AGENTFORGE_NOTIFICATIONS_APP;
const app=await electron.launch({...(bundle?{executablePath:join(resolve(bundle),'Contents/MacOS/AgentForge')} : {}),args:bundle?[]:['apps/electron/main.mjs'],env:{...testEnvironment({...process.env,HOME:home,PATH:real?process.env.PATH:bin+':'+process.env.PATH,AGENTFORGE_LOG_DIR:join(root,'logs')}),AGENTFORGE_DESKTOP_DATA_ROOT:data,...(real?{CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')}:{})},timeout:60000});
const evidence={root,packaged:Boolean(bundle),realModel:real,native,cases:[],pageErrors:[]};console.log('EVIDENCE '+root);
const wait=async(fn,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,150));}throw Error('Acceptance wait timed out');};
try{
 await app.evaluate(({Notification},native)=>{
  globalThis.__noticeQA=[];const show=Notification.prototype.show;
  Notification.prototype.show=function(){const item={ref:this,title:this.title,body:this.body,shown:false,error:null};globalThis.__noticeQA.push(item);this.on('show',()=>item.shown=true);this.on('failed',(_event,error)=>item.error=String(error));if(native)show.call(this);else this.emit('show');};
 },native);
 const notices=()=>app.evaluate(()=>globalThis.__noticeQA.map(({title,body,shown,error})=>({title,body,shown,error})));
 const page=await app.firstWindow({timeout:120000});page.on('pageerror',error=>evidence.pageErrors.push(error.message));await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:120000});const origin=new URL(page.url()).origin;
 const api=(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await r.json();if(!r.ok)throw Error(result.error||'HTTP '+r.status);return result;},{path,body});
 await page.goto(origin+'/login');await page.locator('#username').fill('notice-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();await api('/api/tasks');assert.deepEqual(await notices(),[]);
 for(const [theme,width] of [['minimal',1280],['warm',760]]){
  await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,850),{origin,width});
  await page.goto(origin+'/agents');await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.locator('[data-action="new-agent"]').click();const form=page.locator('#agent-form');await form.locator('[name="name"]').fill('保留的编辑草稿');
  // Force a real UI request error, without creating or changing an employee.
  await page.route('**/api/agents',route=>route.request().method()==='POST'?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'隔离验证：通知必须显示在弹窗上方'})}):route.continue());
  await form.getByRole('button',{name:'创建数字员工',exact:true}).click();const toast=page.locator('#toast');await toast.waitFor({state:'visible'});assert.equal(await toast.evaluate(el=>el.matches(':popover-open')),true);
  const assertAbove=async()=>{
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('#toast')).opacity==='1');
   const m=await toast.evaluate(el=>{const r=el.getBoundingClientRect();return {x:Math.floor(r.x+8),y:Math.floor(r.y+8),background:getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0,3).map(Number),open:el.matches(':popover-open')};});
   assert.equal(m.open,true);const pixel=await sharp(await page.screenshot({scale:'css'})).extract({left:m.x,top:m.y,width:1,height:1}).removeAlpha().raw().toBuffer();assert.ok(m.background.every((value,i)=>Math.abs(pixel[i]-value)<4),'feedback must paint above backdrop/later modal/popover');
  };
  await assertAbove();assert.equal(await form.locator('[name="name"]').inputValue(),'保留的编辑草稿');assert.equal(await toast.getAttribute('role'),'alert');
  // A later native modal and later popover must not dim or cover active feedback.
  await page.evaluate(()=>{const d=document.createElement('dialog');d.id='notice-qa-modal';d.innerHTML='<input aria-label="验证焦点" value="保持焦点">';document.body.append(d);d.showModal();});await assertAbove();
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'验证焦点');
  await page.evaluate(()=>{const p=document.createElement('div');p.id='notice-qa-popover';p.setAttribute('popover','manual');p.style.cssText='position:fixed;inset:auto 0 0 auto;width:500px;height:200px;background:red;margin:0';document.body.append(p);p.showPopover();});await assertAbove();
  await page.screenshot({path:join(root,'toast-'+theme+'.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{document.querySelector('#notice-qa-popover').remove();document.querySelector('#notice-qa-modal').remove();});await page.locator('#modal-close').click();await page.unroute('**/api/agents');evidence.cases.push('error toast above dialogs/popovers; draft/focus preserved; '+theme+' '+width);
 }
 const task=(await api('/api/tasks',{title:'隔离通知任务',objective:'请计算 23 加 19，将计算结果直接写在本轮 summary 中，并按协议提交人类验收；不创建文件、不调用外部服务。',memberAgentIds:[agent.id],managerAgentId:agent.id})).task;
 const run=(await api('/api/tasks/'+task.id+'/run',{})).run;
 await wait(async()=>{const state=await api('/api/runs/'+run.id+'/workspace?view=compact');if(['failed','awaiting_human'].includes(state.run.status))throw Error('Task '+state.run.status);return state.run.status==='awaiting_acceptance';},real?240000:60000);
 if(real)assert.match((await api('/api/runs/'+run.id+'/workspace?view=compact')).run.summary,/42/);
 await wait(async()=>(await notices()).some(row=>row.title==='任务待验收'));await app.evaluate(()=>globalThis.__noticeQA.find(row=>row.title==='任务待验收').ref.emit('click'));await page.waitForURL(origin+'/runs/'+run.id);
 await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await wait(async()=>(await notices()).some(row=>row.title==='任务已完成'));evidence.cases.push('new task acceptance + explicit visible human completion → native metadata; click opens exact Run');
 await page.goto(origin+'/agents');await page.locator('[data-action="new-agent"]').click();await page.locator('#agent-form [name="name"]').fill('系统通知不丢弃编辑');
 const confirmationReady=app.waitForEvent('window');await app.evaluate(()=>globalThis.__noticeQA.find(row=>row.title==='任务已完成').ref.emit('click'));const confirmation=await confirmationReady;await confirmation.getByRole('button',{name:'保留编辑',exact:true}).click();await page.locator('#agent-form').waitFor();assert.equal(await page.locator('#agent-form [name="name"]').inputValue(),'系统通知不丢弃编辑');assert.equal(page.url(),origin+'/agents');await page.locator('#modal-close').click();evidence.cases.push('notification navigation confirmation preserves open form draft');
 for(const [chat,background] of [[privateChat,false],[group,true]]){
  await page.goto(origin+'/communication/'+chat.id);if(background)await app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).hide(),origin);const count=(await notices()).length;
  await api('/api/communications/'+chat.id+'/messages',{content:'PRIVATE_HUMAN_MESSAGE：简短回复一句即可。',clientRequestId:randomBytes(16).toString('hex')});
  await wait(async()=>(await notices()).length>count,real?180000:60000);const item=(await notices()).at(-1);assert.match(item.title,/发来新消息/);assert.equal(item.body,background?'通知验收群':'通知验收员工');assert.ok(!JSON.stringify(item).includes('PRIVATE_'));
  await page.goto(origin+'/tasks');await app.evaluate(()=>globalThis.__noticeQA.at(-1).ref.emit('click'));await page.waitForURL(origin+'/communication/'+chat.id);await wait(()=>app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin))?.isVisible(),origin));evidence.cases.push((background?'background group':'foreground private')+' committed reply → native metadata → click restores exact chat');
 }
 await page.reload();await page.locator('#communication-input').waitFor();assert.equal((await notices()).length,4,'no replay from page reload/history reads');
 if(native){await wait(async()=>{const items=await notices();if(items.some(row=>row.error))throw Error('Native notification rejected: '+items.find(row=>row.error).error);return items.every(row=>row.shown);},20000);}
 evidence.notifications=await notices();assert.deepEqual(evidence.pageErrors,[]);evidence.status='passed';console.log(JSON.stringify(evidence));
}catch(error){evidence.status='failed';evidence.error=error.message;throw error;}
finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.evaluate(()=>{for(const row of globalThis.__noticeQA||[])row.ref.close();}).catch(()=>{});await app.close();}
