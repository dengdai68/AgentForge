// Real Claude task, isolated Electron data, deliberate first worker process failure.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
if(process.env.AGENTFORGE_TASK_COLLABORATION_REAL!=='1')throw Error('Requires AGENTFORGE_TASK_COLLABORATION_REAL=1; invokes real Claude');
await mkdir('.data',{recursive:true});
const resume=process.env.AGENTFORGE_TASK_COLLABORATION_RESUME;
if(resume&&!resolve(resume).startsWith(resolve('.data/task-collaboration-real-')))throw Error('Resume requires this test’s isolated evidence directory');
const root=resume?resolve(resume):await mkdtemp(resolve('.data/task-collaboration-real-')),home=join(root,'home'),data=join(root,'client');await mkdir(home,{recursive:true});
const previous=resume?JSON.parse(await readFile(join(root,'evidence.json'),'utf8')):null;
const command=process.env.AGENTFORGE_RETRY_CLAUDE||execFileSync('/usr/bin/which',['claude'],{encoding:'utf8'}).trim();
const managerMarker='PATROL_MANAGER_'+randomBytes(8).toString('hex');
const workerMarker='RETRY_WORKER_'+randomBytes(8).toString('hex');
const launcher=join(root,'claude');
if(!resume)await writeFile(launcher,`#!${process.execPath}
import {readFileSync,existsSync,writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';
const args=process.argv.slice(2),index=args.indexOf('--append-system-prompt-file');
const worker=index>=0&&readFileSync(args[index+1],'utf8').includes(${JSON.stringify(workerMarker)});
const manager=index>=0&&readFileSync(args[index+1],'utf8').includes(${JSON.stringify(managerMarker)}),orphan=manager&&!existsSync(${JSON.stringify(join(root,'orphan-once'))});
const p=spawn(${JSON.stringify(command)},args,{env:{...process.env,HOME:${JSON.stringify(homedir())}},stdio:orphan?['inherit','pipe','inherit']:'inherit'});
if(orphan){let buffer='';p.stdout.on('data',data=>{buffer+=data.toString();let n;while((n=buffer.indexOf('\\n'))>=0){let line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const event=JSON.parse(line);if(event.type==='result'&&!event.is_error){const result={summary:'本轮已查看任务，尚未交接。（隔离验收注入：删除本次模型协调字段）'};event.result=JSON.stringify(result);delete event.structured_output;line=JSON.stringify(event);writeFileSync(${JSON.stringify(join(root,'orphan-once'))},'removed routing after real manager turn');}}catch{}process.stdout.write(line+'\\n');}});p.stdout.on('end',()=>{if(buffer)process.stdout.write(buffer);});}
p.on('error',e=>{console.error(e.message);process.exitCode=1;});
p.on('exit',code=>{if(worker&&code===0&&!existsSync(${JSON.stringify(join(root,'failed-once'))})){writeFileSync(${JSON.stringify(join(root,'failed-once'))},'injected after a real model turn');console.error('API Error: 401 authentication token expired (isolated failure injection)');process.exitCode=1;}else process.exitCode=code??1;});
`,{mode:0o700});
const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";
for(const name of ['.zprofile','.zshrc'])await writeFile(join(home,name),'export PATH='+quote(root)+':"$PATH"\n');
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('retry-qa',password);auth.close();
const seed=createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});seed.updateWorkspaceSettings({workspaceRoot:join(root,'work')});const profileId=seed.listRuntimeProfiles().find(p=>p.provider==='claude-code').id;seed.close();
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
console.log('EVIDENCE '+root);const evidence={root,realModel:true,injectedFailure:'worker process exits 1 after first successful real turn'};
try{
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});const origin=new URL(page.url()).origin;
 const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;},{path,body,method});
 await page.goto(origin+'/login');await page.locator('#username').fill('retry-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 let worker,manager,task,run;
 if(!resume){
 ({agent:worker}=await api('/api/agents',{name:'续接验收员工',systemPrompt:workerMarker+'。编写 add.mjs 导出 add(a,b)，编写 add.test.mjs 用 node:test 验证正数和负数求和，并运行 node --test add.test.mjs。成功后在协作交接正文说明工作中发现的问题、处理过程和验证结果；不输出独立问题清单字段。若已完成，则检查原文件并复跑测试后交接。',runtime:{profileId,extensionSelection:{pluginIds:[],mcpIds:[]}}}));
 ({agent:manager}=await api('/api/agents',{name:'续接验收经理',kind:'manager',systemPrompt:managerMarker+'。只将唯一节点 check 派给续接验收员工，不自己做文件。派工必须采用单人 managerDecision，包含 nextNodeId、nextAgentId、instruction、rationale 四个字段，instruction 明确包含文件名及执行测试要求。员工交接后返回 managerDecision:{nextNodeId:null,nextAgentId:null} 提交验收，不带 instruction，不额外派工、不要求人类澄清。',runtime:{profileId,extensionSelection:{pluginIds:[],mcpIds:[]}}}));
 const {workflowTemplate:workflow}=await api('/api/workflow-templates',{name:'原员工失败恢复验证',nodes:[{id:'check',title:'求和与测试',staffingGuidance:'续接验收员工',deliverable:'add.mjs 和 add.test.mjs，通过 node --test',artifactPaths:['add.mjs','add.test.mjs'],dependsOn:[]}]});
 ({task}=await api('/api/tasks',{managerAgentId:manager.id,title:'原员工失败恢复真实验收',objective:'经理将 check 派给续接验收员工。员工实现 add.mjs 和 add.test.mjs，测试正数和负数求和并实际运行 node --test。收到成功交接后经理提交人类验收。',memberAgentIds:[manager.id,worker.id],workflowTemplateId:workflow.id}));
 ({run}=await api('/api/tasks/'+task.id+'/run',{}));
 }else{const old=await api('/api/runs/'+previous.runId+'/workspace');run=old.run;task=run.task;worker={id:old.traces.find(t=>t.id===previous.failedTraceId).agentId};manager=run.manager;}
 evidence.runId=run.id;
 const workspace=()=>api('/api/runs/'+run.id+'/workspace');
 const wait=async(label,fn)=>{const start=Date.now();let logged=0;while(Date.now()-start<600000){const value=await fn();if(value)return value;if(Date.now()-logged>30000){console.log('WAIT '+label);logged=Date.now();}await new Promise(r=>setTimeout(r,1000));}throw Error('Timed out '+label);};
 const current=await workspace();
 const alreadyResumed=Boolean(resume&&current.run.status==='awaiting_acceptance');
 const failed=alreadyResumed?{...current,traces:current.traces.slice(0,current.traces.findIndex(t=>t.id===previous.failedTraceId)+1)}:await wait('worker failure',async()=>{const w=await workspace();return w.run.status==='failed'?w:null;});
 assert.ok(failed.events.some(e=>e.type==='run.routing_incomplete'&&e.data.correctionScheduled));
 const managerTraces=failed.traces.filter(t=>t.agentId===run.manager.id);assert.equal(managerTraces[0].status,'failed');assert.match(managerTraces[0].error,/缺少 managerDecision/);assert.equal(managerTraces[1].dispatchId,managerTraces[0].dispatchId);assert.equal(managerTraces[1].providerSessionId,managerTraces[0].providerSessionId);
 const managerResult=JSON.parse(await readFile(join(data,'agentforge-runs','runs',run.id,'traces',managerTraces[1].id,'internal','accepted-node-result.json'),'utf8'));assert.equal(managerResult.managerDecision.nextAgentId,worker.id);assert.match(managerResult.managerDecision.instruction,/add/);
 const directed=failed.messages.find(m=>m.kind==='handoff'&&m.sender.id===run.manager.id&&m.recipient.id===worker.id);assert.equal(directed.content,managerResult.managerDecision.instruction);assert.ok(failed.traces.filter(t=>t.agentId===run.manager.id).length>=2);
 const failure=failed.traces.at(-1);assert.equal(failure.agentId,worker.id);assert.match(failure.error,/token expired/);assert.ok(failure.providerSessionId);const dispatchId=failure.dispatchId;
 evidence.failedTraceId=failure.id;evidence.sessionId=failure.providerSessionId;
 await page.goto(origin+'/runs/'+run.id);const button=page.locator('[data-retry-failed-node]');if(!alreadyResumed){await button.waitFor();assert.equal(await page.locator('#instruction-text').isDisabled(),true);
 for(const width of [1320,760]){await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,760),{origin,width});await page.waitForFunction(width=>innerWidth===width,width);assert.ok(await button.isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(root,'failure-'+width+'.png')});}
 const blocked=await page.evaluate(async id=>{const r=await fetch('/api/runs/'+id+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'错误时禁止派工'})});return r.status;},run.id);assert.equal(blocked,400);
 await new Promise(r=>setTimeout(r,11000));assert.equal((await workspace()).traces.length,failed.traces.length);
 await button.click();}
 const completed=await wait('resumed worker and manager acceptance',async()=>{const w=await workspace();if(w.run.status==='failed') {if(w.traces.length>failed.traces.length)throw Error(JSON.stringify(w.run.failure));return null;}return w.run.status==='awaiting_acceptance'?w:null;});
 const resumed=completed.traces[failed.traces.length];assert.equal(resumed.agentId,worker.id);assert.equal(resumed.dispatchId,dispatchId);assert.equal(resumed.providerSessionId,failure.providerSessionId);assert.equal(resumed.sessionMode,'resume');assert.equal(resumed.status,'completed');const finishing=completed.traces.slice(failed.traces.length).filter(t=>t.agentId===run.manager.id);assert.ok(finishing.length>=1&&finishing.length<=2);assert.equal(finishing.at(-1).status,'completed');if(finishing.length===2){assert.equal(finishing[0].status,'failed');assert.match(finishing[0].error,/协调指令未生效/);assert.equal(finishing[0].dispatchId,finishing[1].dispatchId);assert.equal(finishing[0].providerSessionId,finishing[1].providerSessionId);}
 const result=await promisify(execFile)(process.execPath,['--test','add.test.mjs'],{cwd:completed.run.task.workspacePath});assert.match(result.stdout,/pass/);
 await wait('CLI delegation',()=>stat(join(data,'desktop-cli-session.json')).catch(()=>null));
 const cli=await promisify(execFile)(process.execPath,[resolve('cli/main.mjs'),'tasks','progress',task.id,'--endpoint-file',join(data,'desktop-endpoint.json'),'--json'],{env:{...process.env,HOME:home}});assert.equal(JSON.parse(cli.stdout).ok,true);
 await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await wait('human completion',async()=>(await workspace()).run.status==='completed');
 const collaboration=await promisify(execFile)(process.execPath,[resolve('cli/main.mjs'),'tasks','collaboration',task.id,'--endpoint-file',join(data,'desktop-endpoint.json'),'--json'],{env:{...process.env,HOME:home}});const records=JSON.parse(collaboration.stdout);assert.doesNotMatch(JSON.stringify(records),/协调投递结算/);
 evidence.routingCorrection=true;evidence.singleInstructionDelivered=true;evidence.failedTaskLocked=true;evidence.resumedTraceId=resumed.id;evidence.status='passed';await page.screenshot({path:join(root,'completed.png')});console.log(JSON.stringify({root:evidence.root,status:evidence.status,realModel:evidence.realModel,routingCorrection:evidence.routingCorrection,singleInstructionDelivered:evidence.singleInstructionDelivered,failedTaskLocked:evidence.failedTaskLocked}));
}catch(error){evidence.status='failed';evidence.error=error.message;throw error;}finally{await writeFile(join(root,resume?'evidence-resumed.json':'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
