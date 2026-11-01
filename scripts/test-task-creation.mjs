// Isolated UI/HTTP task-creation acceptance. Run launch is deliberately rejected;
// this script does not claim Provider execution or human acceptance.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';

await mkdir('.data',{recursive:true});
const root=await mkdtemp(resolve('.data/task-creation-')),home=join(root,'home');
const bundle=process.env.AGENTFORGE_TASK_CREATION_APP;
const data=bundle?join(home,'.agentforge/desktop'):join(root,'client');
await mkdir(home,{recursive:true,mode:0o700});
const password=randomBytes(24).toString('hex');
const auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('task-form-qa',password);auth.close();
const store=createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});
const manager=store.createAgent({name:'创建界面经理',kind:'manager'}),worker=store.createAgent({name:'创建界面成员'});
const teams=[0,1].map(i=>store.createTeam({name:'创建界面团队 '+i,managerAgentId:manager.id,memberAgentIds:[worker.id]}));
const flows=[0,1].map(i=>store.createWorkflowTemplate({name:'创建界面流程 '+i,nodes:[{id:'work',title:'不应在创建表单展开的节点 '+i,staffingGuidance:'不应在创建表单展开的人员说明'}]}));
store.close();
const app=await electron.launch({...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/AgentForge')} :{}),args:bundle?[]:['apps/electron/main.mjs'],env:{...process.env,HOME:home,AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:90000});
const evidence={root,bundle:bundle||'source',cases:[],geometry:[]},errors=[];
try{
 const page=await app.firstWindow({timeout:90000});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});const origin=new URL(page.url()).origin;
 await page.goto(origin+'/login');await page.locator('#username').fill('task-form-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 const api=path=>page.evaluate(async path=>{const r=await fetch(path);assertResponse(r);return r.json();function assertResponse(r){if(!r.ok)throw Error('HTTP '+r.status);}},path);
 const launchIds=[];await page.route('**/api/tasks/*/run',async route=>{launchIds.push(route.request().url().split('/').at(-2));await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'隔离界面验收不启动 Provider'})});});
 for(const theme of ['minimal','warm'])for(const [width,height] of [[1320,1000],[760,760],[800,560]]){
  await app.evaluate(({BrowserWindow},{origin,width,height})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,height),{origin,width,height});
  await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
  await page.goto(origin+'/settings/appearance');await page.locator(`[name="theme"][value="${theme}"]`).check();await page.goto(origin+'/tasks');
  await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
  const form=page.locator('#task-form'),criteria=form.locator('[name="acceptanceCriteria"]'),details=form.locator('.task-acceptance');await form.waitFor();
  await page.evaluate(()=>document.getAnimations().filter(animation=>Number.isFinite(animation.effect.getComputedTiming().endTime)).forEach(animation=>animation.finish()));
  assert.ok(await criteria.isHidden());assert.equal(await form.locator('input,textarea,select').count(),5);
  assert.equal(await form.locator('#node-assignment-panel,[data-task-execution-boundary]').count(),0);
  const geometry=await form.evaluate(form=>{const box=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};const textarea=form.elements.objective,style=getComputedStyle(textarea);return{modal:box(form.closest('.modal')),textarea:box(textarea),line:parseFloat(style.lineHeight),padding:parseFloat(style.paddingTop)+parseFloat(style.paddingBottom),team:box(form.elements.teamId),flow:box(form.elements.workflowTemplateId),submit:box(form.querySelector('[type="submit"]')),overflow:document.documentElement.scrollWidth>innerWidth};});
  evidence.geometry.push({theme,width,height,...geometry});
  await page.screenshot({path:join(root,`initial-${theme}-${width}x${height}.png`)});
  assert.ok(geometry.textarea.height>=geometry.line*6+geometry.padding,'six complete text lines fit');
  assert.ok(geometry.textarea.height<=geometry.line*12+geometry.padding+2,'description never exceeds twelve text lines');
  if(height===1000)assert.ok(Math.abs(geometry.textarea.height-geometry.line*12-geometry.padding)<3,'large windows show twelve text lines');
  assert.ok(Math.abs(geometry.team.y-geometry.flow.y)<1,'team and workflow share one footer row');assert.ok(geometry.submit.bottom<=height,'submit stays in the window');assert.equal(geometry.overflow,false);
  await form.getByRole('button',{name:'创建并开始',exact:true}).click();await form.getByText('请填写任务标题。',{exact:true}).waitFor();await form.getByText('请描述任务目标、范围或关键约束。',{exact:true}).waitFor();
  const title=`任务创建 ${theme} ${width}x${height}`,description=Array.from({length:6},(_,i)=>`第 ${i+1} 行：描述任务内容、背景和要求。`).join('\n');
  await form.locator('[name="title"]').fill(title);await form.locator('[name="objective"]').fill(description);
  await form.locator('[name="teamId"]').selectOption(teams[1].id);await form.locator('[name="workflowTemplateId"]').selectOption(flows[1].id);
  assert.equal(await form.locator('[name="objective"]').inputValue(),description);
  await details.locator('summary').click();await criteria.fill(Array.from({length:21},(_,i)=>'标准 '+i).join('\n'));await details.locator('summary').click();
  await form.getByRole('button',{name:'创建并开始',exact:true}).click();await form.getByText('验收标准最多 20 条。',{exact:true}).waitFor();assert.ok(await criteria.isVisible(),'invalid hidden criteria reopen');
  await criteria.fill(height===1000?'第一项验收\n第二项验收':'');await details.locator('summary').click();await details.locator('summary').click();assert.equal(await criteria.inputValue(),height===1000?'第一项验收\n第二项验收':'');await details.locator('summary').click();
  await form.locator('.modal-scroll').evaluate(body=>{body.scrollTop=0;});
  await page.screenshot({path:join(root,`${theme}-${width}x${height}.png`)});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/tasks')&&r.request().method()==='POST');await form.getByRole('button',{name:'创建并开始',exact:true}).click();const createdResponse=await response;assert.ok(createdResponse.ok());const {task}=await createdResponse.json();await form.waitFor({state:'detached'});
  await page.locator(`[data-run-task="${task.id}"]`).waitFor();
  const saved=(await api('/api/tasks')).tasks.find(t=>t.id===task.id);assert.equal(saved.objective,description);assert.equal(saved.teamId,teams[1].id);assert.equal(saved.workflowTemplateId,flows[1].id);assert.deepEqual(saved.acceptanceCriteria,height===1000?['第一项验收','第二项验收']:[]);assert.equal(saved.status,'backlog');assert.ok(launchIds.includes(task.id));
 }
 evidence.cases.push('two themes at 1320x1000, 760x760 and 800x560; six to twelve visible description lines, fixed same-row selectors and submit; optional criteria retain drafts and reopen on validation errors; real HTTP creation persists selected team/workflow and empty or supplied criteria; rejected launch retains backlog task');
 assert.deepEqual(errors,[]);console.log('PASS '+root);
}catch(error){evidence.error=String(error.stack||error);throw error;}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
