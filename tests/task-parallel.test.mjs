import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCatalogFixtureStore } from './fixture-store.mjs';
import { executeRun, scheduleManagerFollowup, terminateRun, pauseRun } from '../server/orchestrator.mjs';
import { registerExecution, hasActiveExecution, terminateExecution } from '../server/runtime/registry.mjs';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'af-parallel-'));
  const store = createCatalogFixtureStore({ workspaceRoot: join(root, 'work') });
  t.after(async () => { store.close(); await rm(root, {recursive:true,force:true}); });
  const task = store.createTask({managerAgentId:'system_project_manager', title:'并行任务', objective:'独立成员并行', memberAgentIds:store.listTeams()[0].memberAgentIds, workflowTemplateId:'software_delivery' });
  return {store,root,task,run:store.createRun(task.id)};
}
const assignment = (id,node='requirements') => ({nextAgentId:id,nextNodeId:node,instruction:`请 ${id} 完成独立工作`});
function claimTrace(store,run) {const d=store.claimDispatch(run.id);assert.ok(d);const trace=store.createTrace(run.id,{agentId:d.recipientAgentId,workflowNodeId:d.workflowNodeId,type:d.purpose});store.attachDispatchTrace(d.id,trace.id);return {d,trace};}

test('single and batch instructions share validation, directed delivery and idempotency', async t => {
 for (const single of [true,false]) {
  const {store,run}=await setup(t),delivery={id:'manager-round',recipientAgentId:run.manager.id};
  const instruction='媒体准备：下载源文件；保留完整路径与字幕。\n禁止重复下载，交接给经理。';
  const item={nextNodeId:'requirements',nextAgentId:'agent_analyst',instruction};
  const decision=single?{...item,rationale:'独立准备'}:{assignments:[item],rationale:'独立准备'};
  scheduleManagerFollowup(store,run.id,delivery,decision);scheduleManagerFollowup(store,run.id,delivery,decision);
  const [d]=store.listDispatches(run.id);assert.equal(store.listDispatches(run.id).length,1);
  assert.deepEqual(store.memberInputMessages(d.id).map(m=>[m.content,m.recipient.id]),[[instruction,'agent_analyst']]);
  const before=store.snapshot();
  for(const value of ['',null,123,{}])assert.throws(()=>scheduleManagerFollowup(store,run.id,{...delivery,id:'invalid'},single?{...item,instruction:value}:{assignments:[{...item,instruction:value}]}),/派工指令/);
  assert.throws(()=>scheduleManagerFollowup(store,run.id,delivery,{nextNodeId:null,nextAgentId:null,instruction}),/验收/);
  assert.deepEqual(store.snapshot(),before);
 }
});

test('manager batch is atomic, idempotent and creates separate directed instructions', async t => {
 const {store,run}=await setup(t),delivery={id:'manager-round',recipientAgentId:run.manager.id};
 for(const assignments of [[assignment('agent_analyst'),assignment('missing')],[assignment('agent_analyst'),assignment('agent_analyst')],[assignment(run.manager.id)]]){
  assert.throws(()=>scheduleManagerFollowup(store,run.id,delivery,{assignments}));assert.equal(store.listDispatches(run.id).length,0);assert.equal(store.getRunWorkspace(run.id).messages.length,0);
 }
 const decision={assignments:[assignment('agent_analyst'),assignment('agent_engineer','development')]};
 scheduleManagerFollowup(store,run.id,delivery,decision);scheduleManagerFollowup(store,run.id,delivery,decision);
 assert.equal(store.listDispatches(run.id).length,2);assert.deepEqual(store.getRunWorkspace(run.id).messages.map(m=>m.recipient.id),['agent_analyst','agent_engineer']);
 const a=claimTrace(store,run), b=claimTrace(store,run);assert.notEqual(a.d.recipientAgentId,b.d.recipientAgentId);
 store.enqueueDispatch(run.id,{recipientAgentId:a.d.recipientAgentId,workflowNodeId:'requirements',purpose:'instruction'});
 assert.equal(store.claimDispatch(run.id),null);assert.throws(()=>store.requestHumanAcceptance(run.id),/仍有成员/);
 store.completeTrace(a.trace.id);store.completeDispatch(a.d.id);assert.equal(store.claimDispatch(run.id).recipientAgentId,a.d.recipientAgentId);
});

test('failed parallel member stops new claims while peers retain their results and handoffs', async t => {
 const {store,run}=await setup(t);
 scheduleManagerFollowup(store,run.id,{id:'batch',recipientAgentId:run.manager.id},{assignments:[assignment('agent_analyst'),assignment('agent_engineer','development')]});
 const a=claimTrace(store,run),b=claimTrace(store,run);
 store.completeTrace(a.trace.id,{status:'failed',error:'401 expired'});store.stopFailedDispatch(a.d.id,'401 expired',{kind:'provider'});
 assert.equal(store.getRun(run.id).status,'failed');assert.equal(store.canExecuteDispatch(b.d.id),true);assert.equal(store.claimDispatch(run.id),null);
 assert.throws(()=>store.retryFailedNode(run.id,'requirements'),/活跃执行/);
 store.handoffDispatch(b.d.id,run.manager.id,'B 的独立结果',b.trace.id);store.completeTrace(b.trace.id);
 assert.equal(store.getDispatch(b.d.id).status,'done');assert.equal(store.claimDispatch(run.id),null);
 store.retryFailedNode(run.id,'requirements');const resumed=store.claimDispatch(run.id);assert.equal(resumed.id,a.d.id);assert.equal(store.claimDispatch(run.id),null);
 store.completeTrace(store.createTrace(run.id,{agentId:a.d.recipientAgentId,workflowNodeId:a.d.workflowNodeId}).id);store.completeDispatch(resumed.id);
 assert.equal(store.claimDispatch(run.id).recipientAgentId,run.manager.id);
});

test('multiple failed peers are retried individually before any queued followup', async t => {
 const {store,run}=await setup(t);
 scheduleManagerFollowup(store,run.id,{id:'batch',recipientAgentId:run.manager.id},{assignments:[assignment('agent_analyst'),assignment('agent_engineer','development')]});
 const a=claimTrace(store,run),b=claimTrace(store,run);
 for(const {d,trace} of [a,b]){store.completeTrace(trace.id,{status:'failed',error:'503'});store.stopFailedDispatch(d.id,'503',{kind:'provider'});}
 store.retryFailedNode(run.id,'development');assert.equal(store.claimDispatch(run.id).id,b.d.id);store.completeDispatch(b.d.id);
 assert.equal(store.getRun(run.id).status,'failed');assert.equal(store.getRun(run.id).failure.dispatchId,a.d.id);
 store.retryFailedNode(run.id,'requirements');assert.equal(store.claimDispatch(run.id).id,a.d.id);store.completeDispatch(a.d.id);assert.equal(store.getRun(run.id).status,'running');
});

test('runtime registry permits distinct members and terminates all calls in the Run', () => {
 const ended=[],cleanups=[];
 for(const key of ['parallel:A','parallel:B'])cleanups.push(registerExecution(key,{terminate(reason){ended.push([key,reason]);}},'parallel'));
 try {assert.equal(hasActiveExecution('parallel'),true);assert.throws(()=>registerExecution('parallel:A',{}));assert.equal(terminateExecution('parallel','pause'),true);assert.equal(ended.length,2);}finally{cleanups.forEach(fn=>fn());}
 assert.equal(hasActiveExecution('parallel'),false);
});

test('controlled dispatch loop overlaps A/B and runs C from A result before B finishes', async t => {
 const {store,root,task}=await setup(t);
 // Fresh frozen task using a controlled Provider executable, with a barrier:
 // B cannot finish until C runs. A serial implementation therefore cannot pass.
 const executable=join(root,'provider.mjs');
 await writeFile(executable,`#!/usr/bin/env node
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
const prompt=process.argv.at(-1), system=readFileSync(process.argv[process.argv.indexOf('--append-system-prompt-file')+1],'utf8');
const roster=JSON.parse(system.match(/可咨询角色：(.*)/)[1]);const manager=roster.find(x=>x.taskRole==='manager').id;
const role=system.match(/你是「([^」]+)」/)[1];let result;
if(role.includes('项目经理')) {
 if(!existsSync('started')){writeFileSync('started','1');result={summary:'同时分工',managerDecision:{assignments:[{nextNodeId:'requirements',nextAgentId:'agent_analyst',instruction:'A 独立工作'},{nextNodeId:'development',nextAgentId:'agent_engineer',instruction:'B 独立工作'}]}};}
 else if(existsSync('a.done')&&!existsSync('c.sent')){writeFileSync('c.sent','1');result={summary:'A 已完成，C 可以开始',managerDecision:{assignments:[{nextNodeId:'testing',nextAgentId:'agent_tester',instruction:'C 根据 A 的结果工作'}]}};}
 else result={summary:'核对返回结果',managerDecision:existsSync('b.done')&&existsSync('c.done')?{nextNodeId:null,nextAgentId:null,rationale:'完成'}:{wait:true,rationale:'等待工作'}};
} else {
 if(role.includes('需求')){writeFileSync('a.done','A');}
 else if(role.includes('研发')){const start=Date.now();while(!existsSync('c.done')){if(Date.now()-start>15000)throw Error('C was blocked by B');await new Promise(r=>setTimeout(r,50));}writeFileSync('b.done','B');}
 else {writeFileSync('c.done','C');}
 result={summary:role+'完成',handoff:{recipientAgentId:manager}};
}
console.log(JSON.stringify({type:'result',is_error:false,result:JSON.stringify(result)}));
`,{mode:0o700});
 for(const agent of store.listAgents())store.updateAgent(agent.id,{runtime:{provider:'claude-code',executable}});
 const next=store.createTask({managerAgentId:'system_project_manager',title:'并行实调度',objective:'A B 独立，C 在 A 后',memberAgentIds:task.memberAgentIds,workflowTemplateId:task.workflowTemplateId});const run=store.createRun(next.id);
 await executeRun(store,run.id,{runFilesRoot:join(root,'audit')});
 const w=store.getRunWorkspace(run.id);assert.equal(w.run.status,'awaiting_acceptance',JSON.stringify(w.traces.map(t=>({id:t.agentId,error:t.error}))));
 const b=w.traces.find(t=>t.agentId==='agent_engineer'),c=w.traces.find(t=>t.agentId==='agent_tester');assert.ok(b&&c,JSON.stringify(w.traces.map(t=>({agentId:t.agentId,status:t.status,error:t.error}))));assert.ok(Date.parse(c.startedAt)<Date.parse(b.endedAt));
 for(const agent of run.participants){const traces=w.traces.filter(t=>t.agentId===agent.id);for(let i=1;i<traces.length;i++)assert.ok(Date.parse(traces[i].startedAt)>=Date.parse(traces[i-1].endedAt));}
 store.confirmRunCompletion(run.id);assert.equal(store.getRun(run.id).status,'completed');
});


test('unconsumed worker reports prevent early acceptance even after all workers settle', async t => {
 const {store,run}=await setup(t);
 store.enqueueDispatch(run.id,{recipientAgentId:run.manager.id,workflowNodeId:'requirements',purpose:'manager',coordinationFollowup:true});
 assert.throws(()=>store.requestHumanAcceptance(run.id),/仍有成员/);
 const d=store.claimDispatch(run.id);store.completeDispatch(d.id);
 store.requestHumanAcceptance(run.id);assert.equal(store.getRun(run.id).status,'awaiting_acceptance');
});

test('deferred acceptance waits behind worker reports without blocking the manager FIFO', async t => {
 const {store,run}=await setup(t);
 scheduleManagerFollowup(store,run.id,{id:'batch',recipientAgentId:run.manager.id},{assignments:[assignment('agent_analyst')]});
 const a=claimTrace(store,run);
 const deferred=store.enqueueDispatch(run.id,{recipientAgentId:run.manager.id,workflowNodeId:'requirements',purpose:'manager',coordinationFollowup:true,deferredRevisit:true});
 assert.equal(store.claimDispatch(run.id),null);
 store.handoffDispatch(a.d.id,run.manager.id,'员工结果',a.trace.id);store.completeTrace(a.trace.id);
 const report=store.claimDispatch(run.id);assert.equal(report.recipientAgentId,run.manager.id);assert.notEqual(report.id,deferred.id);
 store.completeDispatch(report.id);assert.equal(store.claimDispatch(run.id).id,deferred.id);
 store.completeDispatch(deferred.id);store.requestHumanAcceptance(run.id);assert.equal(store.getRun(run.id).status,'awaiting_acceptance');
});

test('successful consultation clears routing feedback while preserving rejected trace history', async t => {
 const {store,run}=await setup(t);
 store.initializeDispatches(run.id);const first=claimTrace(store,run);
 store.rejectDispatchRouting(first.d.id,first.trace.id,'咨询对象无效');
 const before=store.getRunWorkspace(run.id).events.length;
 store.rejectDispatchRouting(first.d.id,first.trace.id,'duplicate callback');assert.equal(store.getRunWorkspace(run.id).events.length,before);
 const second=claimTrace(store,run);
 store.askQuestion(second.d.id,{audience:'human',question:'确认业务范围'},second.trace.id);
 const waiting=store.getDispatch(second.d.id);assert.equal(waiting.status,'waiting');assert.equal(waiting.routingError,undefined);assert.equal(waiting.routingCorrectionCount,undefined);
 assert.equal(store.getRunWorkspace(run.id).traces.find(item=>item.id===first.trace.id).status,'failed');
});

test('manual retry of a failed deferred manager cannot deadlock behind unrelated queued work', async t => {
 const {store,run}=await setup(t);
 const deferred=store.enqueueDispatch(run.id,{recipientAgentId:run.manager.id,workflowNodeId:'requirements',purpose:'manager',coordinationFollowup:true,deferredRevisit:true});
 const first=claimTrace(store,run);
 const report=store.enqueueDispatch(run.id,{recipientAgentId:run.manager.id,workflowNodeId:'requirements',purpose:'manager'});
 store.completeTrace(first.trace.id,{status:'failed',error:'401'});store.stopFailedDispatch(first.d.id,'401',{kind:'provider'});
 store.retryFailedOrchestration(run.id);assert.equal(store.claimDispatch(run.id).id,deferred.id);
 store.completeDispatch(deferred.id);assert.equal(store.claimDispatch(run.id).id,report.id);
});

test('human clarification holds new starts while already claimed peers finish', async t => {
 const {store,run}=await setup(t);
 scheduleManagerFollowup(store,run.id,{id:'batch',recipientAgentId:run.manager.id},{assignments:[assignment('agent_analyst'),assignment('agent_engineer','development')]});
 const a=claimTrace(store,run),b=claimTrace(store,run);
 const question=store.askQuestion(a.d.id,{audience:'human',question:'请确认范围'},a.trace.id);store.completeTrace(a.trace.id);
 assert.equal(store.getRun(run.id).status,'awaiting_human');assert.equal(store.canExecuteDispatch(b.d.id),true);
 store.handoffDispatch(b.d.id,run.manager.id,'B 已完成',b.trace.id);store.completeTrace(b.trace.id);
 assert.equal(store.claimDispatch(run.id),null);
 store.answerQuestion(run.id,question.id,'确认',{id:'human_operator',type:'human',name:'你'});
 assert.ok(store.claimDispatch(run.id));
});

test('restart of failed parallel Run recovers peers without auto-retrying the error', async t => {
 const {store,run}=await setup(t);
 scheduleManagerFollowup(store,run.id,{id:'batch',recipientAgentId:run.manager.id},{assignments:[assignment('agent_analyst'),assignment('agent_engineer','development')]});
 const a=claimTrace(store,run),b=claimTrace(store,run);
 store.completeTrace(a.trace.id,{status:'failed',error:'401'});store.stopFailedDispatch(a.d.id,'401',{kind:'provider'});
 const recovery=store.recoverInterruptedRun(run.id);
 assert.equal(recovery.shouldExecute,false);assert.deepEqual(recovery.recoveredDispatchIds,[b.d.id]);
 assert.equal(store.getRun(run.id).failure.dispatchId,a.d.id);assert.equal(store.getDispatch(b.d.id).status,'queued');assert.equal(store.claimDispatch(run.id),null);
 store.retryFailedNode(run.id,'requirements');assert.equal(store.claimDispatch(run.id).id,a.d.id);store.completeDispatch(a.d.id);
 assert.equal(store.claimDispatch(run.id).id,b.d.id);
});

test('pause and termination stop every parallel process, including peers of a failed Run', async t => {
 for(const mode of ['pause','terminate-failed']) {
  const {store,run}=await setup(t),ended=[];
  scheduleManagerFollowup(store,run.id,{id:'batch',recipientAgentId:run.manager.id},{assignments:[assignment('agent_analyst'),assignment('agent_engineer','development')]});
  const a=claimTrace(store,run),b=claimTrace(store,run);
  const clean=[a,b].map(({d})=>registerExecution(run.id+':'+d.recipientAgentId,{terminate(){ended.push(d.id);}},run.id));
  try {
   if(mode==='pause')pauseRun(store,run.id,'暂停');
   else {store.completeTrace(a.trace.id,{status:'failed',error:'401'});store.stopFailedDispatch(a.d.id,'401',{kind:'provider'});terminateRun(store,run.id,'终止');}
   assert.equal(ended.length,2);assert.equal(store.getRun(run.id).status,mode==='pause'?'paused':'cancelled');assert.equal(store.canExecuteDispatch(b.d.id),false);assert.equal(store.claimDispatch(run.id),null);
  } finally {clean.forEach(fn=>fn());}
 }
});


test('a retried member can consult a busy recipient queue without releasing unrelated work', async t => {
 const {store,run}=await setup(t);
 scheduleManagerFollowup(store,run.id,{id:'batch',recipientAgentId:run.manager.id},{assignments:[assignment('agent_analyst')]});
 const a=claimTrace(store,run);
 store.completeTrace(a.trace.id,{status:'failed',error:'401'});store.stopFailedDispatch(a.d.id,'401',{kind:'provider'});
 store.retryFailedNode(run.id,'requirements');assert.equal(store.claimDispatch(run.id).id,a.d.id);
 const unrelated=store.enqueueDispatch(run.id,{recipientAgentId:'agent_engineer',workflowNodeId:'development',purpose:'node'});
 const question=store.askQuestion(a.d.id,{audience:'agent',recipientAgentId:'agent_engineer',question:'请确认接口'});
 const consult=store.claimDispatch(run.id);assert.equal(consult.purpose,'consultation');assert.equal(store.claimDispatch(run.id),null);
 store.answerQuestion(run.id,question.id,'接口确认',{type:'agent',id:'agent_engineer',name:'B'});store.completeDispatch(consult.id);
 assert.equal(store.claimDispatch(run.id).id,a.d.id);store.completeDispatch(a.d.id);assert.equal(store.claimDispatch(run.id).id,unrelated.id);
});

test('new input wakes an active Run without overlapping its busy member session', async t => {
 const {store,root,task}=await setup(t),executable=join(root,'inbox-provider.mjs');
 await writeFile(executable,`#!/usr/bin/env node
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
const system=readFileSync(process.argv[process.argv.indexOf('--append-system-prompt-file')+1],'utf8');
if(system.includes('你是「Sora'))writeFileSync('release','C');
else {writeFileSync('started','A');const start=Date.now();while(!existsSync('release')){if(Date.now()-start>8000)throw Error('new message was not dispatched');await new Promise(r=>setTimeout(r,25));}}
console.log(JSON.stringify({type:'result',is_error:false,result:'完成独立工作'}));
`,{mode:0o700});
 for(const agent of store.listAgents())store.updateAgent(agent.id,{runtime:{provider:'claude-code',executable}});
 const next=store.createTask({managerAgentId:'system_project_manager',title:'执行中接收消息',objective:'独立员工可以及时接收新输入',memberAgentIds:task.memberAgentIds,workflowTemplateId:task.workflowTemplateId}),run=store.createRun(next.id);
 store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'node'});
 const options={runFilesRoot:join(root,'audit')},pending=executeRun(store,run.id,options);t.after(()=>pending);
 const cwd=store.getRunTask(run.id).workspacePath,start=Date.now();
 while(!await readFile(join(cwd,'started'),'utf8').catch(()=>null)){assert.ok(Date.now()-start<5000);await new Promise(r=>setTimeout(r,25));}
 store.submitHumanMessage(run.id,{recipientAgentId:'agent_tester',content:'独立任务：完成 C'});
 assert.equal(executeRun(store,run.id,options),pending);
 await pending;assert.equal((await readFile(join(cwd,'release'),'utf8')),'C');
 const traces=store.getRunWorkspace(run.id).traces;assert.ok(traces.every(trace=>trace.status==='completed'));
 assert.ok(Date.parse(traces.find(t=>t.agentId==='agent_tester').startedAt)<Date.parse(traces.find(t=>t.agentId==='agent_analyst').endedAt));
});
