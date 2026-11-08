import {writeStorageLocation} from '../server/storage-layout.mjs';
// Opt-in real-model acceptance, isolated desktop/data/workspace; never the installed app.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
if (process.env.AGENTFORGE_TASK_PARALLEL_REAL !== '1') throw Error('Requires AGENTFORGE_TASK_PARALLEL_REAL=1; invokes real Claude');
await mkdir('.data', {recursive:true});
const resume=process.env.AGENTFORGE_TASK_PARALLEL_RESUME;
if(resume&&!resolve(resume).startsWith(resolve('.data/task-parallel-real-')))throw Error('Resume requires this test’s isolated evidence directory');
const root=resume?resolve(resume):await mkdtemp(resolve('.data/task-parallel-real-')), home=join(root,'home'), data=join(root,'client');
const previous=resume?JSON.parse(await readFile(join(root,'evidence.json'),'utf8')):null;
await mkdir(home,{recursive:true});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});
await auth.setAdministrator('parallel-qa',password);auth.close();
const seed=createStore({databasePath:join(root,'work','records','agentforge.sqlite'),configurationDirectory:data,workspaceRoot:join(root,'work')});
seed.updateWorkspaceSettings({workspaceRoot:join(root,'work')});const profileId=seed.listRuntimeProfiles().find(p=>p.provider==='claude-code').id;seed.close();
await writeStorageLocation(data,{version:1,workspaceRoot:join(root,'work'),previousRuntimeRoots:[]});
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
const evidence={root,realModel:true,...(resume?{resumedAfterInterruption:true}: {})};console.log('EVIDENCE '+root);
try {
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});const origin=new URL(page.url()).origin;
 const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;},{path,body,method});
 await page.goto(origin+'/login');await page.locator('#username').fill('parallel-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 const employee=async(name,systemPrompt,kind='business')=>(await api('/api/agents',{name,kind,systemPrompt,runtime:{profileId,extensionSelection:{pluginIds:[],mcpIds:[]}}})).agent;
 let a,b,c,manager,task,run;
 if(!resume){
 a=await employee('并行 A','只做 A：写 a.txt 内容 21，用 Node 验证读取为21，普通文字或 handoff 交接经理。不要改其他文件。');
 b=await employee('并行 B','只做 B：先写 b.started.txt，然后使用 Node 轮询等待 c.txt 出现（每秒一次，最多180秒，超时报告失败），发现 c.txt 后写 b.txt 内容 independent 并验证，交接经理。不要自己创建 c.txt，不需要咨询；等待 C 是本次并发验收的测试屏障。');
 c=await employee('并行 C','只做 C：读取 a.txt，写 c.txt 内容为 a.txt 数字的两倍，用 Node assert 验证结果为42，交接经理。不要改其他文件。');
 manager=await employee('并行经理',`这是实际并发验收。首轮必须 managerDecision.assignments 同时派 A(${a.id}) 节点 a 和 B(${b.id}) 节点 b，给出独立 instruction。收到 A 完成就立即派 C(${c.id}) 节点 c，不等待 B；只派一次 C。B 会等待 c.txt，因此串行会超时。尚有执行/排队时使用 wait:true。三人都返回成功且所有队列已处理后 nextNodeId:null,nextAgentId:null 提交验收。你自己不操作文件，不询问人类，不复派已完成员工。`,'manager');
 const {workflowTemplate:workflow}=await api('/api/workflow-templates',{name:'并行交接验收',nodes:[{id:'a',title:'A 独立计算',staffingGuidance:'并行 A',deliverable:'a.txt',dependsOn:[]},{id:'b',title:'B 独立工作',staffingGuidance:'并行 B',deliverable:'b.txt',dependsOn:[]},{id:'c',title:'C 使用 A',staffingGuidance:'并行 C',deliverable:'c.txt',dependsOn:['a']}]});
 ({task}=await api('/api/tasks',{managerAgentId:manager.id,title:'真实并行 A B 与后续 C',objective:'经理同时派 A/B；A 完成后立即派 C，B 在 C 文件出现前保持执行。最终 a.txt=21、b.txt=independent、c.txt=42。依赖由经理安排。',memberAgentIds:[manager.id,a.id,b.id,c.id],workflowTemplateId:workflow.id}));
 ({run}=await api('/api/tasks/'+task.id+'/run',{}));
 }else{const old=await api('/api/runs/'+previous.runId+'/workspace');run=old.run;task=run.task;[a,b,c]=['并行 A','并行 B','并行 C'].map(name=>run.participants.find(p=>p.name===name));}
 evidence.runId=run.id;evidence.taskId=task.id;
 await page.goto(origin+'/runs/'+run.id);
 const workspace=()=>api('/api/runs/'+run.id+'/workspace');
 const wait=async(label,fn)=>{const start=Date.now();let logged=0;while(Date.now()-start<600000){const value=await fn();if(value)return value;if(Date.now()-logged>30000){console.log('WAIT '+label);logged=Date.now();}await new Promise(r=>setTimeout(r,500));}throw Error('Timed out '+label);};
 if(!resume){
 const overlap=await wait('A/B overlap',async()=>{const w=await workspace();if(w.run.status==='failed')throw Error(JSON.stringify(w.run.failure));return w.traces.filter(t=>[a.id,b.id].includes(t.agentId)&&t.status==='running').length===2?w:null;});
 evidence.concurrentTraceIds=overlap.traces.filter(t=>t.status==='running').map(t=>t.id);
 await wait('CLI delegation',()=>stat(join(data,'desktop-cli-session.json')).catch(()=>null));
 const cli=await promisify(execFile)(process.execPath,[resolve('cli/main.mjs'),'tasks','progress',task.id,'--endpoint-file',join(data,'desktop-endpoint.json'),'--json'],{env:{...process.env,HOME:home}});
 const progress=JSON.parse(cli.stdout);assert.equal(progress.ok,true);assert.equal(progress.data.activeTraces.length,2);await writeFile(join(root,'cli-progress.json'),cli.stdout);
 await page.waitForFunction(()=>document.querySelector('.workspace-properties')?.textContent.includes('并行 A、并行 B'));
 for(const width of [1320,760]){await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,760),{origin,width});await page.waitForFunction(width=>innerWidth===width,width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(root,'parallel-'+width+'.png')});}
 }
 const done=await wait('all results and manager acceptance',async()=>{const w=await workspace();if(w.run.status==='failed')throw Error(JSON.stringify(w.run.failure));return w.run.status==='awaiting_acceptance'?w:null;});
 const ta=done.traces.find(t=>t.agentId===a.id),tb=done.traces.find(t=>t.agentId===b.id),tc=done.traces.find(t=>t.agentId===c.id);
 for(const agent of [a,b,c])assert.ok(done.traces.some(t=>t.agentId===agent.id&&t.status==='completed'));
 assert.ok(Date.parse(ta.startedAt)<Date.parse(tb.endedAt)&&Date.parse(tb.startedAt)<Date.parse(ta.endedAt));assert.ok(Date.parse(tc.startedAt)<Date.parse(tb.endedAt));
 for(const agent of run.participants){const traces=done.traces.filter(t=>t.agentId===agent.id);for(let i=1;i<traces.length;i++)assert.ok(Date.parse(traces[i].startedAt)>=Date.parse(traces[i-1].endedAt));}
 const path=done.run.task.workspacePath;
 for(const [file,value] of [['a.txt','21'],['b.txt','independent'],['c.txt','42']])assert.equal((await readFile(join(path,file),'utf8')).trim(),value);
 await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await wait('human completion',async()=>(await workspace()).run.status==='completed');
 evidence.traces=done.traces.map(({agentId,status,startedAt,endedAt,providerSessionId})=>({agentId,status,startedAt,endedAt,providerSessionId}));evidence.status='passed';await page.screenshot({path:join(root,'completed.png')});console.log(JSON.stringify(evidence));
} catch(error){evidence.status='failed';evidence.error=error.message;throw error;} finally{await writeFile(join(root,resume?'evidence-resumed.json':'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
