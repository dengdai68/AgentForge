// Isolated Electron/App/CLI draft acceptance. Optional real Claude round trip.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
const baseline=process.env.AGENTFORGE_DRAFT_BASELINE==='1',real=process.env.AGENTFORGE_DRAFT_REAL==='1';
await mkdir('.data',{recursive:true});
const root=await mkdtemp(resolve('.data/task-drafts-')),home=join(root,'home'),data=join(root,'client');await mkdir(home,{recursive:true});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('draft-qa',password);auth.close();
const store=createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});
store.updateWorkspaceSettings({workspaceRoot:join(root,'work')});
const profile=store.listRuntimeProfiles().find(item=>item.provider==='claude-code');
const manager=store.createAgent({name:'草稿验收经理',kind:'manager',systemPrompt:'本次仅验证草稿启动。按任务目标自然回答即可，无需操作文件、咨询或派工。回答后用 managerDecision nextNodeId:null,nextAgentId:null 提交人类验收，不要重复执行。',runtime:{profileId:profile.id}});store.close();
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,...(real?{CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')} :{}),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
const evidence={root,real,cases:[]};console.log('EVIDENCE '+root);
try {
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});const origin=new URL(page.url()).origin;
 await page.goto(origin+'/login');await page.locator('#username').fill('draft-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 const api=path=>page.evaluate(async path=>{const response=await fetch(path);if(!response.ok)throw Error('HTTP '+response.status);return response.json();},path);
 const openForm=async title=>{await page.goto(origin+'/tasks');await page.locator('[data-action=new-task]').click();await page.locator('#task-title').fill(title);await page.locator('#task-objective').fill('请回复：草稿只有在点击启动后才执行。完成后提交人类验收。');await page.locator('#task-members').fill(manager.name);await page.locator(`[data-add-extension="${manager.id}"]`).click();await page.locator('#task-members').press('Escape');};
 await openForm('草稿验收');
 if(baseline){evidence.buttons=await page.locator('#task-form [type=submit]').allTextContents();await page.screenshot({animations:'disabled',path:join(root,'before.png')});}
 else {
 const launches=[];const block=async route=>{launches.push(route.request().url());await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'隔离验收：Runtime 暂不可用'})});};await page.route('**/api/tasks/*/run',block);
 for(const [theme,width] of [['minimal',1280],['warm',760]]){
  await page.locator('#modal-close').click();await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);
  await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value=${theme}]`).check();await openForm('草稿 '+theme);
  await page.locator('#task-title').fill('');await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('请填写任务标题。',{exact:true}).waitFor();await page.locator('#task-title').fill('草稿 '+theme);
  await page.screenshot({animations:'disabled',path:join(root,`form-${theme}.png`)});
  const before=launches.length;
  const created=page.waitForResponse(r=>r.url().endsWith('/api/tasks')&&r.request().method()==='POST');
  if(theme==='warm')await page.locator('#task-title').press('Enter');else await page.getByRole('button',{name:'保存草稿',exact:true}).click();const {task}=await(await created).json();await page.locator('#task-form').waitFor({state:'detached'});
  assert.equal(task.status,'backlog');assert.equal(launches.length,before);
  await page.reload();const row=page.locator('tr').filter({has:page.locator(`[data-run-task="${task.id}"]`)});await row.waitFor();assert.match(await row.textContent(),/草稿/);
  assert.equal((await api('/api/bootstrap')).runs.some(run=>run.taskId===task.id),false);
  await page.locator('#task-search-form [name=status]').selectOption('backlog');await page.locator('#task-search-form [type=submit]').click();await row.waitFor();
  await page.screenshot({animations:'disabled',path:join(root,`list-${theme}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await row.locator('[data-run-task]').click();await page.getByText('隔离验收：Runtime 暂不可用',{exact:true}).waitFor();assert.equal(launches.length,before+1);
  assert.equal((await api('/api/bootstrap')).tasks.find(item=>item.id===task.id).status,'backlog');
  evidence.cases.push({theme,width,taskId:task.id});await openForm('即存即启 '+theme);
  const immediate=page.waitForResponse(r=>r.url().endsWith('/api/tasks')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存并开始',exact:true}).click();await immediate;await page.locator('#task-form').waitFor({state:'detached'});
  await page.getByText(/任务已创建，但未能启动 Run：隔离验收/).waitFor();assert.equal(launches.length,before+2);await openForm('待关闭');
 }
 await page.locator('#modal-close').click();await page.unroute('**/api/tasks/*/run',block);
 const cli=async args=>{const result=await new Promise((done,reject)=>{const child=spawn(process.execPath,[resolve('cli/main.mjs'),...args,'--endpoint-file',join(data,'desktop-endpoint.json'),'--session-file',join(root,'session.json'),'--json'],{stdio:['pipe','pipe','pipe']});let stdout='';child.stdout.on('data',chunk=>stdout+=chunk);child.once('error',reject);child.once('close',code=>done({code,stdout}));child.stdin.end(args.includes('--password-stdin')?password+'\n':'');});assert.equal(result.code,0,result.stdout);return JSON.parse(result.stdout).data;};
 await cli(['auth','login','--username','draft-qa','--password-stdin']);const listed=await cli(['tasks','list','--status','backlog']);assert.ok(listed.items.some(item=>item.id===evidence.cases[0].taskId));
 const input=join(root,'task.json');await writeFile(input,JSON.stringify({managerAgentId:manager.id,title:'CLI 草稿',objective:'保存但不启动',memberAgentIds:[manager.id]}));const {task:cliTask}=await cli(['tasks','create','--file',input]);assert.equal(cliTask.status,'backlog');await page.goto(origin+'/tasks');await page.locator(`[data-run-task="${cliTask.id}"]`).waitFor();
 if(real){
  const taskId=evidence.cases[0].taskId;await page.locator(`[data-run-task="${taskId}"]`).click();await page.waitForURL(/\/runs\//);const runId=page.url().split('/').at(-1);evidence.runId=runId;
  const deadline=Date.now()+240000;let workspace;
  while(Date.now()<deadline){workspace=await api(`/api/runs/${runId}/workspace`);if(['failed','awaiting_acceptance'].includes(workspace.run.status))break;await new Promise(resolve=>setTimeout(resolve,1000));}
  assert.equal(workspace.run.status,'awaiting_acceptance',JSON.stringify(workspace.run.failure));
  await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await page.waitForFunction(async runId=>(await(await fetch(`/api/runs/${runId}/workspace`)).json()).run.status==='completed',runId);evidence.completed=true;
 }
 evidence.status='passed';
 }
 console.log(JSON.stringify(evidence));
} catch(error){evidence.error=error.message;throw error;}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
