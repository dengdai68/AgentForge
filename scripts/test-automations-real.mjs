// Three real Provider runs: manual acceptance and two automatic cycles.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
if(process.env.AGENTFORGE_AUTOMATIONS_REAL!=='1')throw Error('Requires AGENTFORGE_AUTOMATIONS_REAL=1; invokes a real Provider');
const provider=process.env.AGENTFORGE_AUTOMATIONS_PROVIDER || 'claude-code';if(!['claude-code','codex'].includes(provider))throw Error('Unsupported test Provider');const cliName=provider==='codex'?'codex':'claude';
await mkdir('.data',{recursive:true});const resume=process.env.AGENTFORGE_AUTOMATIONS_RESUME;if(resume&&!resolve(resume).startsWith(resolve('.data/automations-real-')))throw Error('Resume requires isolated automation test directory');const root=resume?resolve(resume):await mkdtemp(resolve('.data/automations-real-')),home=join(root,'home'),data=join(root,'client');await mkdir(home,{recursive:true});const previous=resume?JSON.parse(await readFile(join(root,'evidence.json'),'utf8')):null;
const command=execFileSync('/usr/bin/which',[cliName],{encoding:'utf8'}).trim();
await writeFile(join(root,cliName),`#!${process.execPath}\nimport {spawn} from 'node:child_process'; const p=spawn(${JSON.stringify(command)},process.argv.slice(2),{env:{...process.env,HOME:${JSON.stringify(homedir())}},stdio:'inherit'});p.on('error',()=>process.exitCode=1);p.on('exit',code=>process.exitCode=code??1);`,{mode:0o700});
const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";for(const name of ['.zprofile','.zshrc'])await writeFile(join(home,name),'export PATH='+quote(root)+':"$PATH"\n');
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('automation-real',password);auth.close();
const seed=createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});seed.updateWorkspaceSettings({workspaceRoot:join(root,'work')});seed.saveRuntimeProfile({model:process.env.AGENTFORGE_AUTOMATIONS_MODEL || (provider==='claude-code'?'sonnet':''),effort:'low'},'runtime_'+provider);seed.close();
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
console.log('EVIDENCE '+root);const evidence={...previous,root,realModel:true,provider};
try {
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});const origin=new URL(page.url()).origin;
 const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw Error(value.error||'HTTP '+response.status);return value;},{path,body,method});
 await page.goto(origin+'/login');await page.locator('#username').fill('automation-real');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 let input,probe;
 if(evidence.automationId){ const existing=(await api(`/api/automations/${evidence.automationId}`)).automation;input={title:existing.title,objective:existing.objective,memberAgentIds:existing.memberAgentIds,workflowTemplateId:existing.workflowTemplateId};probe=existing.objective.match(/automation-[a-f0-9]+/)[0]; }
 else {
 const runtime={profileId:'runtime_'+provider,extensionSelection:{pluginIds:[],mcpIds:[]}};
 const {agent:worker}=await api('/api/agents',{name:'自动化验证员工',runtime,systemPrompt:'执行唯一工作：创建 result.txt，内容为任务目标中的探针值。用工具读取文件核对内容，随后交接经理。不要询问人类，不修改工作目录之外的文件。'});
 const {agent:manager}=await api('/api/agents',{name:'自动化验证经理',kind:'manager',runtime,systemPrompt:'先将唯一节点 deliver 派给唯一业务员工。员工完成后，返回 managerDecision，nextNodeId 与 nextAgentId 都为 null。不要自己编写文件，不要额外审查、派工或询问人类。'});
 const {workflowTemplate:workflow}=await api('/api/workflow-templates',{name:'自动化验证流程',nodes:[{id:'deliver',title:'生成探针文件',staffingGuidance:'交给唯一业务员工',dependsOn:[],artifactPaths:['result.txt']}]});
 probe='automation-'+randomBytes(8).toString('hex');input={title:'真实自动化验证',objective:`在工作目录生成 result.txt，内容精确为 ${probe}。使用工具读取核验后向经理交付。`,memberAgentIds:[manager.id,worker.id],workflowTemplateId:workflow.id};
 }
 const waitRun=async id=>{for(let i=0;i<450;i++){const workspace=await api(`/api/runs/${id}/workspace?view=summary`);if(['failed','cancelled'].includes(workspace.run.status))throw Error('真实运行中断 '+JSON.stringify(workspace.run.failure));if(['awaiting_acceptance','completed'].includes(workspace.run.status))return workspace;await new Promise(r=>setTimeout(r,2000));}throw Error('真实任务未在十五分钟内交付');};
 if(!evidence.automationId){
 const {task}=await api('/api/tasks',{...input,title:'普通流程回归'});const {run:manual}=await api(`/api/tasks/${task.id}/run`,{});evidence.manualRunId=manual.id;
 await waitRun(manual.id);await page.goto(origin+`/runs/${manual.id}`);await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await page.locator('#modal-backdrop.open').waitFor({state:'hidden'});assert.equal((await api(`/api/runs/${manual.id}/workspace`)).run.status,'completed');
 }
 const {automation}=evidence.automationId?await api(`/api/automations/${evidence.automationId}`):await api('/api/automations',{...input,cron:'* * * * *',timeZone:'Asia/Shanghai',enabled:true});evidence.automationId=automation.id;
 let record;
 for(let i=0;i<45;i++){const result=await api(`/api/automations/${automation.id}/triggers`);record=result.items.find(item=>evidence.firstRunId?item.runId===evidence.firstRunId:item.runId);if(record)break;await new Promise(r=>setTimeout(r,2000));}
 assert.ok(record?.runId,'real timer generated a run');assert.equal(record.source,'schedule');evidence.firstRunId=record.runId;
 // Disable subsequent timed executions while this first scheduled run completes.
 await api(`/api/automations/${automation.id}`,{enabled:false},'PUT');const first=await waitRun(record.runId);
 assert.ok(first.run.participants.every(member=>member.type==='agent'));assert.equal(await readFile(join(first.run.task.workspacePath,'result.txt'),'utf8').then(v=>v.trim()),probe);
 const next=evidence.secondRunId?(await api(`/api/automations/${automation.id}/triggers`)).items.find(item=>item.runId===evidence.secondRunId):(await api(`/api/automations/${automation.id}/trigger`,{})).trigger;assert.ok(next.runId,next.reason);evidence.secondRunId=next.runId;
 assert.equal((await api(`/api/runs/${record.runId}/workspace`)).run.confirmedBy,'automation');const second=await waitRun(next.runId);assert.equal(await readFile(join(second.run.task.workspacePath,'result.txt'),'utf8').then(v=>v.trim()),probe);
 assert.equal((await api('/api/tasks')).tasks.length,1);
 await page.goto(origin+`/runs/${next.runId}`);await page.locator('#collaboration-panel').waitFor();assert.equal(await page.locator('#instruction-form').count(),0);await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await page.locator('#modal-backdrop.open').waitFor({state:'hidden'});
 assert.equal((await api(`/api/runs/${next.runId}/workspace`)).run.status,'completed');await page.screenshot({path:join(root,'real-completed.png')});evidence.passed=true;console.log('PASS '+root);
}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
