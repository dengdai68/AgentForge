import {writeStorageLocation} from '../server/storage-layout.mjs';
// Real Codex acceptance: member edits, employee-directory MCP and exact human clarification.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
if(process.env.AGENTFORGE_ISSUE3_REAL!=='1')throw Error('Requires AGENTFORGE_ISSUE3_REAL=1; invokes a real Provider');
const provider=process.env.AGENTFORGE_ISSUE3_PROVIDER || 'codex';if(!['claude-code','codex'].includes(provider))throw Error('Unsupported test Provider');const cliName=provider==='codex'?'codex':'claude';
await mkdir('.data',{recursive:true});const root=await mkdtemp(resolve('.data/issue3-real-')),home=join(root,'home'),data=join(root,'client');await mkdir(home,{recursive:true});
const command=execFileSync('/usr/bin/which',[cliName],{encoding:'utf8'}).trim();
await writeFile(join(root,cliName),`#!${process.execPath}\nimport {spawn} from 'node:child_process'; const p=spawn(${JSON.stringify(command)},process.argv.slice(2),{env:{...process.env,HOME:${JSON.stringify(homedir())}},stdio:'inherit'});p.on('error',()=>process.exitCode=1);p.on('exit',code=>process.exitCode=code??1);`,{mode:0o700});
const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";for(const name of ['.zprofile','.zshrc'])await writeFile(join(home,name),'export PATH='+quote(root)+':"$PATH"\n');
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('issue3-real',password);auth.close();
const seed=createStore({databasePath:join(root,'work','records','agentforge.sqlite'),configurationDirectory:data,workspaceRoot:join(root,'work')});seed.updateWorkspaceSettings({workspaceRoot:join(root,'work')});seed.saveRuntimeProfile({model:process.env.AGENTFORGE_ISSUE3_MODEL || (provider==='claude-code'?'sonnet':''),effort:'low'},'runtime_'+provider);seed.close();
await writeStorageLocation(data,{version:1,workspaceRoot:join(root,'work'),previousRuntimeRoots:[]});
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
console.log('EVIDENCE '+root);const evidence={root,realModel:true,provider};
try{
 const page=await app.firstWindow({timeout:180000});page.setDefaultTimeout(30000);await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});const origin=new URL(page.url()).origin;
 const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();if(!r.ok)throw Error(value.error||'HTTP '+r.status);return value;},{path,body,method});
 await page.goto(origin+'/login');await page.locator('#username').fill('issue3-real');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 const runtime={profileId:'runtime_'+provider,extensionSelection:{pluginIds:[],mcpIds:[]}},probe='directory-'+randomBytes(8).toString('hex'),answer='answer-'+randomBytes(6).toString('hex');
 const {agent:reference}=await api('/api/agents',{name:'只读目录资料员',runtime,systemPrompt:'本次目录核验码为 '+probe+'。只作为目录资料，无需执行。'});
 const {agent:worker}=await api('/api/agents',{name:'新增交付员工',runtime,systemPrompt:'收到经理交接后必须先向人类澄清一次：请提供确认口令。收到精确回答后创建 result.txt，写入经理给出的目录核验码与人类确认口令。读取核对文件，然后交接经理。不得猜口令，不操作任务目录之外文件。'});
 const {agent:manager}=await api('/api/agents',{name:'目录协作经理',kind:'manager',runtime,systemPrompt:'第一轮必须调用平台 MCP list_employees 搜索只读目录资料员，再调用 read_employee 读取其 systemPrompt 中核验码。将核验码写入第一轮 summary 及给新增交付员工的 handoffMessage，nextNodeId=deliver，nextAgentId=该员工ID。员工交付后返回 nextNodeId=null、nextAgentId=null 请求验收；不重复派工、不自己写文件。'});
 const {agent:placeholder}=await api('/api/agents',{name:'待移除空闲员工',runtime});
 const {workflowTemplate:workflow}=await api('/api/workflow-templates',{name:'目录与澄清验收',nodes:[{id:'deliver',title:'澄清后交付',staffingGuidance:'新增交付员工',artifactPaths:['result.txt']}]});
 const {task}=await api('/api/tasks',{managerAgentId:manager.id,title:'Issue3 真实验收',objective:'经理通过员工目录 MCP 读取只读目录资料员的核验码，派给新增交付员工；员工向人类澄清口令后写 result.txt，读取验证并交付。',memberAgentIds:[manager.id,placeholder.id],workflowTemplateId:workflow.id});
 // Update the live roster immediately after starting; all subsequent dispatches use the Store membership.
 const {run}=await api(`/api/tasks/${task.id}/run`,{});evidence.runId=run.id;evidence.taskId=task.id;
 await api(`/api/runs/${run.id}/members`,{memberAgentIds:[manager.id,worker.id]},'PUT');
 await page.goto(origin+`/runs/${run.id}`);
 const waitFor=async statuses=>{for(let i=0;i<450;i++){const w=await api(`/api/runs/${run.id}/workspace?view=summary`);if(w.run.status==='failed')throw Error('Real execution failed '+JSON.stringify(w.run.failure));if(statuses.includes(w.run.status))return w;await new Promise(r=>setTimeout(r,2000));}throw Error('Real execution timed out');};
 const waiting=await waitFor(['awaiting_human']);console.log('STAGE awaiting_human');assert.ok(waiting.pendingQuestions.some(q=>q.sender.id===worker.id));assert.ok(waiting.messages.some(m=>m.sender.id===run.manager.id&&m.content.includes(probe)),'manager read the random employee prompt through MCP before delegation');
 const rejection=await page.evaluate(async id=>{const r=await fetch(`/api/runs/${id}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'不允许插入的额外指令'})});return {status:r.status,value:await r.json()};},run.id);assert.ok(rejection.status>=400);assert.match(rejection.value.error,/澄清/);
 const audit=JSON.stringify((await api(`/api/runs/${run.id}/workspace`)).events);for(const tool of ['list_employees','read_employee'])assert.ok(audit.includes(tool),'real MCP call recorded: '+tool);
 console.log('STAGE reply UI');await page.reload();await page.screenshot({path:join(root,'clarification.png')});await page.locator('#reply-question').waitFor();assert.equal(await page.locator('#reply-question option[value=""]').count(),0);await page.locator('#instruction-text').fill(answer);await page.locator('[data-send-instruction]').click();
 console.log('STAGE awaiting acceptance');const done=await waitFor(['awaiting_acceptance']);const result=await readFile(join(done.run.task.workspacePath,'result.txt'),'utf8');assert.ok(result.includes(probe)&&result.includes(answer));
 await page.reload();await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await page.locator('#modal-backdrop.open').waitFor({state:'hidden'});assert.equal((await api(`/api/runs/${run.id}/workspace`)).run.status,'completed');
 evidence.passed=true;await page.screenshot({path:join(root,'completed.png')});console.log('PASS '+root);
}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
