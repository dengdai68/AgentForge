// Isolated App/HTTP/CLI draft-edit acceptance. REAL=1 additionally invokes Claude
// and verifies the edited task through visible human confirmation.
import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright-core';
import {mkdtemp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createStore} from '../server/store.mjs';
import {createAuth} from '../server/auth.mjs';
import {writeStorageLocation} from '../server/storage-layout.mjs';
import {testEnvironment} from './run-tests.mjs';
const real=process.env.AGENTFORGE_TASK_DRAFTS_REAL==='1',bundle=process.env.AGENTFORGE_TASK_DRAFTS_APP;
const root=await mkdtemp(join(tmpdir(),'agentforge-task-drafts-')),home=join(root,'home'),data=bundle?join(home,'.agentforge/desktop'):join(root,'config');await mkdir(home,{mode:0o700});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('draft-qa',password);auth.close();
const options={databasePath:join(root,'work/records/agentforge.sqlite'),workspaceRoot:join(root,'work'),configurationDirectory:data};
const store=createStore(options);
const a=store.createAgent({name:'草稿成员 A'}),b=store.createAgent({name:'草稿成员 B',systemPrompt:'你具备文本编辑能力。被本任务选为经理时，自行完成简单文本文件操作并读取核对，完成后按协议提交人类验收，不派工、不咨询。'}),c=store.createAgent({name:'草稿成员 C'}),off=store.createAgent({name:'停用成员'});
const team=store.createTeam({name:'草稿替换团队',memberAgentIds:[b.id,c.id]});
const flow=store.createWorkflowTemplate({name:'草稿可选流程',nodes:[{id:'delivery',title:'完成目标'}]});
const draft=store.createTask({title:'待编辑草稿',objective:'原始目标',memberAgentIds:[a.id,b.id],managerAgentId:a.id,workflowTemplateId:flow.id,acceptanceCriteria:['原始标准']});
const stale=store.createTask({title:'成员失效的草稿',objective:'重新选择可用成员',memberAgentIds:[a.id,off.id],managerAgentId:off.id});store.updateAgent(off.id,{status:'inactive'});
const started=store.createTask({title:'已启动不可编辑',objective:'仅校验已启动任务拒绝编辑',memberAgentIds:[a.id],managerAgentId:a.id});const paused=store.createRun(started.id);store.pauseRun(paused.id);store.close();
await writeStorageLocation(data,{version:1,workspaceRoot:join(root,'work'),previousRuntimeRoots:[]});
const env={...testEnvironment({...process.env,HOME:home,AGENTFORGE_LOG_DIR:join(root,'logs')}),AGENTFORGE_DESKTOP_DATA_ROOT:data,...(real?{CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')}:{})};
const app=await electron.launch({...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/AgentForge')} :{}),args:[...(bundle?[]:[resolve('apps/electron/main.mjs')]),'--user-data-dir='+join(root,'browser')],env,timeout:120000});
const evidence={root,realModel:real,cases:[]},errors=[];console.log('EVIDENCE '+root);
try{
 const page=await app.firstWindow();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});const origin=new URL(page.url()).origin;
 await page.goto(origin+'/login');await page.locator('#username').fill('draft-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator(`[data-run-task="${draft.id}"]`).waitFor();
 const api=(path,body,method=body===undefined?'GET':'PUT')=>page.evaluate(async({path,body,method})=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};},{path,body,method});
 const task=async()=>(await api('/api/tasks/'+draft.id)).data.task;
 const cli=async(args,input)=>{
  let file=[];if(input!==undefined){const path=join(root,'input-'+randomBytes(6).toString('hex')+'.json');await writeFile(path,JSON.stringify(input));file=['--file',path];}
  const r=await promisify(execFile)(bundle?join(resolve(bundle),'Contents/Resources/cli/agentforge'):process.execPath,[...(bundle?[]:[resolve('cli/main.mjs')]),...args,...file,'--endpoint-file',join(data,'desktop-endpoint.json'),'--json'],{env:{...testEnvironment(process.env),HOME:home},timeout:60000});const out=JSON.parse(r.stdout);assert.equal(out.ok,true);return out.data;
 };
 await page.getByRole('button',{name:'待编辑草稿',exact:true}).click();let form=page.locator('#task-form');await form.waitFor();assert.equal(await form.locator('[name=title]').inputValue(),draft.title);assert.equal(await form.locator('[name=objective]').inputValue(),draft.objective);assert.equal(await form.locator('[name=acceptanceCriteria]').inputValue(),'原始标准');assert.equal(await form.locator('[name=workflowTemplateId]').inputValue(),flow.id);assert.equal(await form.locator(`[data-select-manager="${a.id}"]`).getAttribute('aria-pressed'),'true');await form.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await task()).title,draft.title);evidence.cases.push('title opens editor; full prefill; cancellation has no write');
 await page.locator(`button.small-button[data-edit-task="${stale.id}"]`).click();form=page.locator('#task-form');await form.getByText('不可用',{exact:true}).waitFor();await form.getByRole('button',{name:'保存修改',exact:true}).click();await form.getByText('已选成员不可用，请移除后重新选择。',{exact:true}).waitFor();await form.locator(`[data-remove-extension="${off.id}"]`).click();await form.locator(`[data-select-manager="${a.id}"]`).click();await form.getByRole('button',{name:'保存修改',exact:true}).click();await page.locator('#task-form').waitFor({state:'detached'});assert.deepEqual((await api('/api/tasks/'+stale.id)).data.task.memberAgentIds,[a.id]);evidence.cases.push('unavailable saved members remain visible and can be replaced');
 assert.equal(await page.locator(`[data-edit-task="${started.id}"]`).count(),0);assert.equal((await api('/api/tasks/'+started.id,{title:'拒绝'})).status,400);
 for(const [theme,width] of [['minimal',1320],['warm',760]]){
  await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,820),{origin,width});
  await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value="${theme}"]`).check();await page.goto(origin+'/tasks');await page.locator(`button.small-button[data-edit-task="${draft.id}"]`).click();form=page.locator('#task-form');await form.waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(root,'draft-'+theme+'-'+width+'.png')});await form.getByRole('button',{name:'取消',exact:true}).click();
 }
 await page.locator(`button.small-button[data-edit-task="${draft.id}"]`).click();form=page.locator('#task-form');await form.locator('[name=title]').fill('');await form.getByRole('button',{name:'保存修改',exact:true}).click();await form.getByText('请填写任务标题。',{exact:true}).waitFor();assert.equal((await task()).title,draft.title);
 await form.locator('[name=title]').fill('App 已编辑草稿');await form.locator('[name=objective]').fill('App 修改后的完整目标');await form.locator('[name=acceptanceCriteria]').fill('修改标准一\n修改标准二');await form.locator('[name=workflowTemplateId]').selectOption('');
 await form.locator(`[data-remove-extension="${a.id}"]`).click();await form.locator('#task-members').fill(c.name);await form.locator(`[data-add-extension="${c.id}"]`).click();await form.locator(`[data-select-manager="${b.id}"]`).click();
 let fail=true,putCount=0;await page.route('**/api/tasks/'+draft.id,async route=>{if(route.request().method()!=='PUT')return route.continue();putCount++;if(fail)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'隔离保存失败'})});return route.continue();});
 await form.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByText('隔离保存失败',{exact:true}).waitFor();assert.equal(await form.locator('[name=objective]').inputValue(),'App 修改后的完整目标');assert.equal((await task()).title,draft.title);
 fail=false;await form.evaluate(form=>{const button=form.querySelector('[value=draft]');form.requestSubmit(button);form.requestSubmit(button);});await page.locator('#task-form').waitFor({state:'detached'});assert.equal(putCount,2);await page.unroute('**/api/tasks/'+draft.id);
 const saved=await task();assert.equal(saved.id,draft.id);assert.equal(saved.workspacePath,draft.workspacePath);assert.equal(saved.createdAt,draft.createdAt);assert.equal(saved.status,'backlog');assert.deepEqual(saved.runs,[]);assert.equal(saved.managerAgentId,b.id);assert.deepEqual(saved.memberAgentIds,[b.id,c.id]);assert.equal(saved.workflowTemplateId,null);assert.deepEqual(saved.acceptanceCriteria,['修改标准一','修改标准二']);await assert.rejects(access(saved.workspacePath),{code:'ENOENT'});
 assert.equal((await cli(['tasks','get',draft.id])).objective,saved.objective);await cli(['tasks','update',draft.id],{title:'CLI 编辑草稿',objective:'CLI 修改目标',teamIds:[team.id],managerAgentId:c.id,workflowTemplateId:flow.id,acceptanceCriteria:[]});
 await page.goto(origin+'/tasks');await page.getByRole('button',{name:'CLI 编辑草稿',exact:true}).click();form=page.locator('#task-form');assert.equal(await form.locator('[name=objective]').inputValue(),'CLI 修改目标');assert.equal(await form.locator('[name=acceptanceCriteria]').inputValue(),'');assert.equal(await form.locator('[name=workflowTemplateId]').inputValue(),flow.id);assert.equal(await form.locator(`[data-select-manager="${c.id}"]`).getAttribute('aria-pressed'),'true');evidence.cases.push('App ↔ CLI edits, member/team/manager/workflow/criteria, no Run or directory; failure/double submit');
 await page.route('**/api/tasks/*/run',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'隔离启动失败'})}));await form.locator('[name=title]').fill('启动失败仍保留修改');await form.getByRole('button',{name:'保存并开始',exact:true}).click();await page.getByText(/任务修改已保存，但未能启动 Run/).waitFor();assert.equal((await task()).title,'启动失败仍保留修改');assert.equal((await task()).runs.length,0);evidence.cases.push('save/start failure retains edited draft and task ID');
 await page.unroute('**/api/tasks/*/run');
 assert.equal((await api('/api/settings/runtime-profiles/runtime_claude-code',{enabled:false})).status,200);
 await assert.rejects(cli(['tasks','update',draft.id,'--start'],{title:'CLI 启动失败仍保留修改'}),error=>{const result=JSON.parse(error.stdout);return result.ok===false&&result.error.code==='TASK_UPDATED_START_FAILED'&&result.error.taskId===draft.id;});assert.equal((await task()).title,'CLI 启动失败仍保留修改');assert.equal((await task()).runs.length,0);evidence.cases.push('real HTTP CLI save/start rejection returns taskId in JSON and keeps edits');
 if(real){
  assert.equal((await api('/api/settings/runtime-profiles/runtime_claude-code',{enabled:true})).status,200);
  const token='EDITED_DRAFT_'+randomBytes(10).toString('hex');await cli(['tasks','update',draft.id],{title:'编辑草稿真实执行',objective:`请在当前任务工作目录创建 draft-result.txt，内容必须恰好为 ${token}，用工具读取核对。任务经理自行完成这个简单文件操作，不派工；随后提交人类验收。`,memberAgentIds:[b.id],managerAgentId:b.id,workflowTemplateId:null,acceptanceCriteria:['文件内容与目标一致']});
  await page.goto(origin+'/tasks');await page.getByRole('button',{name:'编辑草稿真实执行',exact:true}).click();await page.locator('#task-form').getByRole('button',{name:'保存并开始',exact:true}).click();await page.waitForURL(/\/runs\//);const runId=new URL(page.url()).pathname.split('/').at(-1),deadline=Date.now()+360000;let done;
  while(Date.now()<deadline){const w=(await api('/api/runs/'+runId+'/workspace?view=compact')).data;if(w.run.status==='failed')throw Error(w.run.failure?.message||'real Run failed');if(w.run.status==='awaiting_acceptance'){done=w;break;}await new Promise(r=>setTimeout(r,1000));}
  assert.ok(done,'real edited draft timed out');assert.equal((await readFile(join(done.run.workspacePath,'draft-result.txt'),'utf8')).trim(),token);await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await page.waitForFunction(async id=>(await (await fetch('/api/runs/'+id+'/workspace?view=compact')).json()).run.status==='completed',runId);evidence.runId=runId;evidence.cases.push('real edited draft → same Task Run → real file/read verification → client human acceptance');
 }
 assert.deepEqual(errors,[]);evidence.status='passed';console.log(JSON.stringify(evidence));
}catch(error){evidence.status='failed';evidence.error=error.message;throw error;}
finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
