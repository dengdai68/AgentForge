// Isolated real Electron UI/API/CLI acceptance; no Provider is invoked.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
await mkdir('.data',{recursive:true});
const root=await mkdtemp(resolve('.data/automations-ui-')),home=join(root,'home'),data=join(root,'client');await mkdir(home,{recursive:true});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('automation-qa',password);auth.close();
const store=createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});
const input={title:'验收自动化',objective:'只用于隔离界面检查',memberAgentIds:['system_project_manager','agent_analyst'],workflowTemplateId:'content_delivery',cron:'0 9 * * 1-5',timeZone:'Asia/Shanghai',enabled:false};
const automation=store.saveAutomation(input);const first=store.triggerAutomation(automation.id);assert.ok(first.runId,first.reason);store.requestHumanAcceptance(first.runId);
store.updateAgent('agent_analyst',{status:'inactive'});for(let i=0;i<24;i++)store.triggerAutomation(automation.id);store.updateAgent('agent_analyst',{status:'active'});
for(let i=0;i<24;i++)store.saveAutomation({...input,title:`分页自动化 ${i}`});
const task=store.createTask({title:'唯一普通任务',objective:'普通流程保持',memberAgentIds:input.memberAgentIds,workflowTemplateId:input.workflowTemplateId});const run=store.createRun(task.id);store.requestHumanAcceptance(run.id);
store.close();
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:90000});
const errors=[],evidence={root,cases:[]};
try {
  const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);const origin=new URL(page.url()).origin;
  await page.goto(origin+'/login');await page.locator('#username').fill('automation-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
  const api=(path,body,method)=>page.evaluate(async({path,body,method})=>{const response=await fetch(path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};},{path,body,method});
  assert.equal((await api('/api/health')).status,200);
  assert.equal((await api('/api/tasks')).data.tasks.length,1);
  assert.equal((await api('/api/bootstrap')).data.runs.length,1);
  await page.goto(origin+'/tasks');await page.getByText('唯一普通任务',{exact:true}).waitFor();assert.equal(await page.getByText('验收自动化',{exact:true}).count(),0);
  await page.goto(origin+`/runs/${run.id}`);await page.locator('#instruction-form').waitFor();
  for(const [theme,width,height] of [['minimal',1320,1000],['warm',760,760],['minimal',800,560]]){
    await app.evaluate(({BrowserWindow},{origin,width,height})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,height),{origin,width,height});await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
    await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value=${theme}]`).check();
    await page.goto(origin+'/automations');await page.locator('[data-auto-new]').click();const form=page.locator('#task-form');await form.waitFor();
    assert.equal(await form.locator('[name=priority]').count(),0);
    await form.locator('[name=title]').fill('自动化草稿');await form.locator('[name=objective]').fill('先保存规则，等待定时执行。');
    await form.locator('[name=cron]').fill('invalid');await page.locator('.automation-preview').filter({hasText:'Cron'}).waitFor();
    await form.locator('[name=cron]').fill('0 9 * * 1-5');await page.locator('.automation-preview').filter({hasText:'接下来 5 次'}).waitFor();
    const box=await form.locator('[type=submit].primary-button').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=height,'submit reachable');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:join(root,`modal-${theme}-${width}.png`)});await form.getByRole('button',{name:'取消',exact:true}).click();
    await page.locator('.nav-item[data-view=tasks]').click();await page.locator('[data-action="new-task"]').click();assert.equal(await page.locator('.modal.automation-create-modal').count(),0);await page.locator('#task-form').getByRole('button',{name:'取消',exact:true}).click();await page.goto(origin+'/automations');await page.locator('[data-auto-new]').waitFor();
    await page.locator('[data-pagination=automations] [data-page="2"]').click();await page.locator('[data-pagination=automations]').filter({hasText:'2/2'}).waitFor();
    await page.goto(origin+`/automations/${automation.id}`);await page.locator('[data-pagination=automation-triggers]').waitFor();
    const tabStyle=await page.locator('[data-auto-tab=records]').evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,border:s.borderBottomWidth,background:s.backgroundColor};});assert.equal(tabStyle.border,'2px');assert.equal(tabStyle.background,'rgba(0, 0, 0, 0)');
    await page.locator('[data-pagination=automation-triggers] [data-page="2"]').click();await page.locator('[data-auto-run]').click();await page.locator('#collaboration-panel').waitFor();
    assert.equal(await page.locator('#instruction-form').count(),0);assert.equal(await page.getByRole('button',{name:'涉及人类',exact:true}).count(),0);
    await page.getByRole('tab',{name:'控制台',exact:true}).click();await page.locator('#console-panel').waitFor();await page.getByRole('tab',{name:'协作记录',exact:true}).click();
    await page.getByRole('button',{name:'返回触发记录',exact:true}).click();await page.locator('[data-pagination=automation-triggers]').filter({hasText:'2/2'}).waitFor();
    await page.screenshot({path:join(root,`records-${theme}-${width}.png`)});evidence.cases.push({theme,width,height});
  }
  await page.locator('[data-auto-tab=config]').click();await page.locator('.nav-item[data-view=automations]').click();
  await page.locator('#automation-search [name=search]').fill('分页自动化 1');await page.locator('#automation-search').getByRole('button',{name:'搜索',exact:true}).click();await page.locator('[data-auto-open]').first().click();await page.locator('#automation-record-filter').waitFor();assert.equal(await page.locator('#automation-record-filter [name=status]').inputValue(),'all');
  const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,[resolve('cli/main.mjs'),'automations',...args,'--endpoint-file',join(data,'desktop-endpoint.json'),'--json'],{env:{...process.env,HOME:home}})).stdout);
  assert.equal((await cli('list','--page','2')).data.items.length,5);assert.equal((await cli('triggers',automation.id,'--page','2')).data.items.length,5);
  await page.goto(origin+'/automations');await page.locator('[data-auto-new]').click();
  const createForm=page.locator('#task-form');await createForm.locator('[name=title]').fill('App 新建自动化');await createForm.locator('[name=objective]').fill('保存输入与选择，不执行模型');
  for(const [id,name] of [['system_project_manager','项目经理'],['agent_analyst','内容编辑']]){await createForm.locator('#task-members').fill(name);await createForm.locator(`[data-add-extension="${id}"]`).click();}
  await createForm.locator('#task-members').press('Escape');await createForm.getByRole('button',{name:'保存为停用',exact:true}).click();await page.locator('#modal-backdrop.open').waitFor({state:'hidden'});
  const saved=await cli('list','--search','App 新建自动化');assert.equal(saved.data.items.length,1);assert.equal(saved.data.items[0].enabled,false);await cli('delete',saved.data.items[0].id,'--yes');
  const file=join(root,'create.json');await writeFile(file,JSON.stringify({...input,title:'CLI 创建自动化'}));const created=await cli('create','--file',file);assert.ok(created.ok);
  await page.goto(origin+`/automations/${created.data.automation.id}`);await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('#task-form [name=title]').fill('App 编辑自动化');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.locator('.automation-heading h3').filter({hasText:'App 编辑自动化'}).waitFor();assert.equal((await cli('get',created.data.automation.id)).data.automation.title,'App 编辑自动化');
  await writeFile(file,JSON.stringify({enabled:false}));assert.ok((await cli('update',created.data.automation.id,'--file',file)).ok);assert.ok((await cli('delete',created.data.automation.id,'--yes')).ok);
  assert.deepEqual(errors,[]);evidence.passed=true;console.log('PASS '+root);
}finally{evidence.errors=errors;await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
