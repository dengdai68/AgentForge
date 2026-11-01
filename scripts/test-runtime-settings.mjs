// Isolated Electron settings and CLI authorization acceptance. Opt-in real
// Providers: AGENTFORGE_SETTINGS_REAL=1. Never modifies the installed instance.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStore } from '../server/store.mjs';
import { createAuth } from '../server/auth.mjs';

await mkdir('.data',{recursive:true});
const root = await mkdtemp(resolve('.data/runtime-settings-')), home = join(root,'home');
const bundle = process.env.AGENTFORGE_SETTINGS_APP, data = bundle ? join(home,'.agentforge/desktop') : join(root,'client');
const real = process.env.AGENTFORGE_SETTINGS_REAL === '1', password = randomBytes(20).toString('hex');
await mkdir(home,{recursive:true,mode:0o700});
await mkdir(join(home,'.agentforge'),{recursive:true,mode:0o700});
const auth = createAuth({databasePath:join(data,'auth.sqlite')}); await auth.setAdministrator('settings-qa',password); auth.close();
const store = createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});
const profiles = Object.fromEntries(store.listRuntimeProfiles().map(item=>[item.provider,item]));
const manager = store.createAgent({name:'配置验收经理',kind:'manager',systemPrompt:'仅执行一次最小验收：将 check 节点派给配置验收成员。成员文字交接后直接 request_acceptance；不需要文件，不需要向人类澄清。',runtime:{profileId:profiles['claude-code'].id}});
const worker = store.createAgent({name:'配置验收成员',systemPrompt:'直接用一句中文回复：固定 Runtime 配置验证成功。无需工具和文件。',runtime:{profileId:profiles.codex.id}});
const team = store.createTeam({name:'配置验收团队',managerAgentId:manager.id,memberAgentIds:[worker.id]});
const flow = store.createWorkflowTemplate({name:'配置验收流程',nodes:[{id:'check',title:'配置验收',staffingGuidance:'配置验收成员使用 Codex',deliverable:'一句文字交接即可；无需文件。'}]});
const task = store.createTask({title:'Runtime 固定配置与 CLI 登录验收',objective:'将 check 节点交给配置验收成员，一句文字交接后经理直接提交人类验收。无需文件或额外验证。',teamId:team.id,workflowTemplateId:flow.id});
const chat = store.openCommunication({kind:'agent',targetId:worker.id});
// Presentation fixture only: no Provider execution is claimed by this lifecycle.
const completedTask = store.createTask({title:'已完成任务的直接操作',objective:'仅验收操作展示与确认流程。',teamId:team.id,workflowTemplateId:flow.id});
const completedRun = store.createRun(completedTask.id);
store.updateRun(completedRun.id,{status:'running'}); store.setTaskStatus(completedTask.id,'running');
store.updateRun(completedRun.id,{status:'review'}); store.setTaskStatus(completedTask.id,'review');
store.updateRun(completedRun.id,{status:'awaiting_acceptance'}); store.setTaskStatus(completedTask.id,'awaiting_acceptance'); store.confirmRunCompletion(completedRun.id);
store.close();
await mkdir(completedRun.workspacePath,{recursive:true});
if (real) {
  const bin = join(home,'test-bin'); await mkdir(bin);
  const quote = value => "'"+value.replaceAll("'","'\\''")+"'";
  for (const command of ['claude','codex']) {
    const actual = execFileSync('/usr/bin/which',[command],{encoding:'utf8'}).trim();
    await writeFile(join(bin,command),'#!/bin/sh\nHOME='+quote(homedir())+' exec '+quote(actual)+' "$@"\n',{mode:0o700});
  }
  await writeFile(join(home,'.zprofile'),'export PATH='+quote(bin)+':"$PATH"\n');
  await writeFile(join(home,'.zshrc'),'export PATH='+quote(bin)+':"$PATH"\n');
}
const app = await electron.launch({...(bundle ? {executablePath:resolve(bundle,'Contents/MacOS/AgentForge')} : {}),args:bundle ? [] : ['apps/electron/main.mjs'],env:{...process.env,HOME:home,...(real ? {CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')} : {}),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:90000});
const evidence = {root,bundle:bundle||'source',real,cases:[]}, errors = [];
const poll = async (label,check,timeout=30000) => {const started=Date.now();for(;;){const value=await check();if(value)return value;if(Date.now()-started>timeout)throw Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,500));}};
try {
  const page = await app.firstWindow({timeout:90000}); page.setDefaultTimeout(30000); page.on('pageerror',error=>errors.push(error.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000}); const origin = new URL(page.url()).origin;
  const api = (path,body,method=body===undefined?'GET':'POST') => page.evaluate(async({path,body,method})=>{const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,value:await response.json()};},{path,body,method});
  await page.goto(origin+'/login'); await page.locator('#username').fill('settings-qa'); await page.locator('#password').fill(password); await page.getByRole('button',{name:'登录',exact:true}).click(); await page.locator('#account-name').waitFor();
  const endpoint = join(data,'desktop-endpoint.json');
  const cli = async (args,success=true) => {try {const result=await promisify(execFile)(bundle ? resolve(bundle,'Contents/Resources/cli/agentforge') : process.execPath,bundle ? [...args,'--endpoint-file',endpoint,'--json'] : [resolve('cli/main.mjs'),...args,'--endpoint-file',endpoint,'--json'],{env:{...process.env,HOME:home},timeout:15000});assert.ok(success);return JSON.parse(result.stdout).data;}catch(error){if(success)throw error;assert.equal(error.code,3);return null;}};
  await poll('host delegation',()=>stat(join(data,'desktop-cli-session.json')).catch(()=>null));
  assert.equal((await stat(join(data,'desktop-cli-session.json'))).mode&0o777,0o600);
  assert.equal((await cli(['auth','status'])).username,'settings-qa');
  assert.equal((await cli(['runtimes','list'])).total,2);
  assert.equal((await cli(['runtimes','get','codex'])).id,profiles.codex.id);
  const logout = await cli(['auth','logout']); assert.equal(logout.loggedOut,false); assert.equal((await cli(['auth','status'])).username,'settings-qa');
  console.log('PASS desktop shared login'); evidence.cases.push('CLI uses desktop authorization without separate login; CLI logout leaves desktop signed in');
  if(bundle){await poll('default installation',()=>stat(join(home,'.local/bin/agentforge')).catch(()=>null));assert.match(await readFile(join(home,'.zshrc'),'utf8'),/AgentForge CLI PATH/);const shellResult=await promisify(execFile)('/bin/zsh',['-ilc','agentforge auth status --json'],{env:{...process.env,HOME:home,ZDOTDIR:home,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'},timeout:30000});assert.equal(JSON.parse(shellResult.stdout).data.username,'settings-qa');evidence.cases.push('packaged startup installs CLI automatically; a fresh shell authenticates without flags or login');}
  await page.goto(origin+'/settings/runtime'); await page.locator('.runtime-provider-row').first().waitFor();
  assert.equal(await page.locator('.runtime-provider-row').count(),2); assert.equal(await page.getByText('新增 Runtime',{exact:true}).count(),0);
  const codex = page.locator(`[data-runtime-profile="${profiles.codex.id}"]`);
  await codex.getByRole('switch').uncheck(); await codex.getByText('已停用；',{exact:false}).waitFor();
  assert.equal((await api(`/api/tasks/${task.id}/run`,{})).status,400);
  assert.equal((await api(`/api/communications/${chat.id}/messages`,{content:'disabled probe',clientRequestId:randomBytes(12).toString('hex')})).status,400);
  assert.equal(await page.locator('.runtime-config[open]').count(),0);
  for (const theme of ['minimal','warm']) for (const width of [1320,760]) {
    await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,760),{origin,width});
    await page.waitForFunction(width=>innerWidth===width,width);
    await page.goto(origin+'/settings/appearance'); await page.locator(`[name="theme"][value="${theme}"]`).check();
    await page.goto(origin+'/settings/general');
    const closeOptions=page.locator('.settings-radio-option');await closeOptions.first().waitFor();
    assert.ok(await closeOptions.first().evaluate(node=>Math.abs(node.getBoundingClientRect().y-node.nextElementSibling.getBoundingClientRect().y)<1),'close choices share one row');
    await page.screenshot({path:join(root,`general-${theme}-${width}.png`)});
    await page.goto(origin+'/settings/repositories'); await page.locator('.repository-access-card h4').first().waitFor();
    assert.equal(await page.locator('.settings-section:not([hidden])').evaluate(section=>[...section.querySelectorAll('h4')].every(h=>parseFloat(getComputedStyle(h).fontSize)<parseFloat(getComputedStyle(section.querySelector('h3')).fontSize))),true);
    assert.equal(await page.locator('.repository-access-card').first().evaluate(card=>getComputedStyle(card).paddingTop),'12px');
    for(const card of await page.locator('.repository-access-card').all()) {
      assert.ok(await card.evaluate(node=>{const input=node.querySelector('input'),button=node.querySelector('[type=submit]');return Math.abs(input.getBoundingClientRect().y-button.getBoundingClientRect().y)<1&&Math.abs(input.getBoundingClientRect().height-button.getBoundingClientRect().height)<1;}),'Token input and save share one row');
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(root,`repositories-${theme}-${width}.png`)});
    await page.goto(origin+'/settings/runtime'); await codex.waitFor();
    assert.equal(await codex.evaluate(row=>getComputedStyle(row).paddingTop),'10px');
    assert.equal(await page.locator('.runtime-config[open]').count(),0);
    assert.equal(await codex.locator('h4').evaluate(h=>parseFloat(getComputedStyle(h).fontSize)<parseFloat(getComputedStyle(document.querySelector('[data-settings-panel="runtime"] h3')).fontSize)),true);
    await codex.locator('summary').click();
    const editor = codex.getByRole('region',{name:'Codex 配置'}); await editor.waitFor();
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await editor.locator('input,select').count(),2);
    assert.ok(await editor.getByRole('button',{name:'测试连接',exact:true}).isDisabled());
    const input=editor.getByLabel('模型名字',{exact:true});
    await editor.locator('[data-model-status]').filter({hasText:'个可选'}).waitFor({state:'attached'});
    const effort=editor.getByLabel('思考等级',{exact:true});
    assert.ok(Math.abs((await input.boundingBox()).y-(await effort.boundingBox()).y)<1,'model and effort share one row');
    assert.equal(await editor.locator('[data-model-status]').isVisible(),false,'normal catalog descriptions stay out of the form');
    await editor.getByRole('button',{name:'展开模型列表',exact:true}).click();
    const menu=editor.getByRole('listbox'), options=menu.getByRole('option'); await options.first().waitFor();
    const count=await options.count(); assert.ok(count>=6,'current real Codex catalog has at least six models');
    const menuBox=await menu.boundingBox(), inputBox=await input.boundingBox(), sixth=await options.nth(5).boundingBox();
    assert.ok(Math.abs(menuBox.y-inputBox.y-inputBox.height-4)<1,'model menu uses the extension picker four-pixel gap');
    assert.equal(await effort.evaluate(node=>getComputedStyle(node,'::picker(select)').marginTop),'4px','effort menu uses the same gap');
    assert.ok(sixth.y+sixth.height<=menuBox.y+menuBox.height,'six candidates fit without scrolling');
    assert.ok(sixth.y+sixth.height<=760,'six candidates remain inside the window');
    await page.screenshot({path:join(root,`models-${theme}-${width}.png`)});
    await page.mouse.move(inputBox.x+20,inputBox.y+inputBox.height-2);
    await page.mouse.move(inputBox.x+20,inputBox.y+inputBox.height+1,{steps:4});
    assert.ok(await menu.isVisible(),'pointer can cross the former gap');
    const rawId=await options.nth(5).getAttribute('data-value'), label=await options.nth(5).textContent();
    assert.match(label,/^[^a-z]/,'model label starts uppercase');
    await options.nth(5).click(); assert.equal(await input.inputValue(),rawId,'selection keeps the exact Provider ID');
    assert.ok((await editor.locator('select[name="effort"] option').allTextContents()).every(text=>!(/^[a-z]/.test(text))));
    await input.fill('manual-settings-probe'); await input.press('Escape');
    await input.evaluate(node=>{node.dataset.retain='same-dom';});
    await codex.locator('summary').click(); assert.ok(await editor.isHidden());
    await codex.locator('summary').focus(); await page.keyboard.press('Enter'); await editor.waitFor();
    assert.equal(await input.inputValue(),'manual-settings-probe'); assert.equal(await input.getAttribute('data-retain'),'same-dom');
    const savedResponse=page.waitForResponse(response=>response.url().endsWith('/api/settings/runtime-profiles/'+profiles.codex.id)&&response.request().method()==='PUT');
    await editor.getByRole('button',{name:'保存配置',exact:true}).click(); const response=await savedResponse; assert.equal(response.status(),200,await response.text()); await editor.getByText(/^已保存。/).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(root,`inline-${theme}-${width}.png`)});
    await codex.locator('summary').click();
    await page.goto(origin+'/tasks');
    if(theme==='minimal'&&width===1320) {
      await app.evaluate(({shell})=>{const original=shell.openPath.bind(shell);shell.openPath=async path=>{globalThis.settingsOpenedDirectory=path;const result=await original(path);globalThis.settingsOpenResult=result;return result;};});
      await page.goto(origin+'/runs/'+completedRun.id);
      await page.locator('[data-toggle-task-details]').click();
      const directory=page.locator('.workspace-path');await directory.getByRole('button',{name:'打开',exact:true}).click();
      await poll('native directory opening',()=>app.evaluate(()=>globalThis.settingsOpenResult===''));
      assert.equal(await app.evaluate(()=>globalThis.settingsOpenedDirectory),completedRun.workspacePath,'host opens the authenticated current Run directory');
      assert.deepEqual(await directory.getByRole('button').allTextContents(),['复制','打开']);
      await page.goto(origin+'/tasks');
    }
    const checkTaskAlignment=async()=>{
      const geometry=await page.evaluate(()=>{
        const form=document.querySelector('#task-search-form').getBoundingClientRect(),list=document.querySelector('#tasks-table').getBoundingClientRect();
        return {left:list.left-form.left,right:list.right-form.right,gap:list.top-form.bottom,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.ok(Math.abs(geometry.left)<1&&Math.abs(geometry.right)<1,'task list and search/actions share both edges');
      assert.ok(Math.abs(geometry.gap-8)<1,'task list follows the search area with eight pixels');
      assert.equal(geometry.overflow,false,'task layout does not widen the window');
    };
    await checkTaskAlignment();
    const search=page.locator('#task-search-form');
    await search.getByRole('searchbox').fill('no-matching-task-layout-probe');
    await search.getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByText('没有匹配的任务',{exact:true}).waitFor();await checkTaskAlignment();
    await search.getByRole('button',{name:'重置',exact:true}).click();
    const actions=page.locator(`[data-archive-task="${completedTask.id}"]`).locator('..');
    await actions.waitFor();
    assert.deepEqual(await actions.getByRole('button').allTextContents(),['归档','删除任务']);
    assert.equal(await page.locator('[data-task-more]').count(),0);
    assert.ok(await page.locator(`[data-run-task="${task.id}"]`).isVisible());
    await actions.getByRole('button',{name:'删除任务',exact:true}).click();
    assert.ok(await page.locator('#confirm-delete-task').isDisabled(),'direct deletion retains explicit acknowledgement');
    await page.locator('[data-close-modal]').click();
    await page.screenshot({path:join(root,`task-actions-${theme}-${width}.png`)});
    await page.locator(`[data-archive-task="${completedTask.id}"]`).click();
    await page.locator('[data-confirm-dialog-accept]').click();
    await page.locator(`[data-archive-task="${completedTask.id}"]`).waitFor({state:'detached'});
    await page.locator('[data-task-center-page="archive"]').click();
    const restore=page.locator(`[data-unarchive-task="${completedTask.id}"]`); await restore.waitFor();await checkTaskAlignment();
    assert.deepEqual(await restore.locator('..').getByRole('button').allTextContents(),['恢复任务','删除任务']);
    await page.screenshot({path:join(root,`archive-actions-${theme}-${width}.png`)});
    await restore.click();
    await poll('restored task',async()=>!(await api('/api/bootstrap')).value.tasks.find(t=>t.id===completedTask.id).archivedAt);
  }
  evidence.cases.push('task search/actions and list share left/right edges with eight-pixel separation in current, empty-search and archive views; both themes at 1320/760');
  evidence.cases.push('same-row close choices, model/effort and equally tall token/save controls; matched four-pixel menus and real native opening of the authenticated current Run folder');
  evidence.cases.push('compact secondary Runtime/repository groups; directly visible start/archive/restore/delete actions in both themes at 1320/760; delete acknowledgement preserved; archive/restore round trip');
  await page.goto(origin+'/settings/runtime'); await codex.waitFor();
  assert.equal((await cli(['runtimes','get','codex'])).model,'manual-settings-probe');
  for(const body of [{name:'old'},{executable:'/tmp/x'},{provider:'codex'},{profile:'legacy'},{enabled:'yes'},{}])assert.equal((await api(`/api/settings/runtime-profiles/${profiles.codex.id}`,body,'PUT')).status,400);
  assert.equal((await api('/api/settings/runtime-profiles',{provider:'codex'})).status,400);
  assert.equal((await api(`/api/settings/runtime-profiles/${profiles.codex.id}`,{},'DELETE')).status,400);
  await codex.locator('summary').click();const drawer=codex.getByRole('region',{name:'Codex 配置'});await drawer.getByLabel('模型名字',{exact:true}).fill(''); await drawer.getByLabel('模型名字',{exact:true}).press('Escape'); await drawer.getByRole('button',{name:'保存配置',exact:true}).click();await drawer.getByText(/^已保存。/).waitFor();await codex.locator('summary').click();
  await codex.getByRole('switch').check(); await codex.getByText('已启用。',{exact:true}).waitFor();
  evidence.cases.push('two fixed slots, real switches, two-field inline disclosure, disabled task/chat/test gates, capitalized labels/exact values, six visible models, pointer crossing, retained DOM, heading hierarchy, partial updates and legacy rejection in two themes at 1320/760');
  if(real){
    const started = await api(`/api/tasks/${task.id}/run`,{}); assert.equal(started.status,202); const runId=started.value.run.id;
    console.log('REAL RUN '+runId);
    const workspace = await poll('real human acceptance',async()=>{const {value}=await api(`/api/runs/${runId}/workspace?view=summary`);if(['failed','blocked'].includes(value.run.status))throw Error('Real task failed: '+JSON.stringify(value.run.failure));return value.run.status==='awaiting_acceptance'?value:null;},600000);
    assert.ok(workspace.traces.some(trace=>trace.type==='node'&&trace.agentId===worker.id&&trace.status==='completed'));
    await page.goto(origin+'/runs/'+runId); await page.getByRole('button',{name:'确认完成',exact:true}).waitFor();
    assert.equal(await page.locator('.workspace-title h3').evaluate(node=>getComputedStyle(node).fontSize),'17px');
    await page.getByRole('button',{name:'确认完成',exact:true}).click();
    // Follow the product's explicit confirmation flow, never call Store directly.
    await page.locator('#ack-completion').check();
    await page.locator('#confirm-completion').click();
    await poll('human confirmed',async()=> (await api(`/api/runs/${runId}/workspace?view=summary`)).value.run.status==='completed');
    evidence.realTask={runId,status:'completed',providers:[...new Set(workspace.traces.filter(t=>t.status==='completed').map(t=>t.runtime?.provider||t.agentId))]};
  }
  await api('/api/auth/logout',{}); await cli(['auth','status'],false); evidence.cases.push('desktop logout immediately revokes CLI grant');
  assert.deepEqual(errors,[]); console.log('PASS '+root);
} catch(error) {evidence.error=String(error.stack||error);throw error;} finally {await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
