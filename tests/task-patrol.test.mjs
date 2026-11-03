import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureStore } from './fixture-store.mjs';
import { createTaskPatrol, TASK_PATROL_INTERVAL_MS } from '../server/task-patrol.mjs';
import { taskPrompt } from '../server/prompts.mjs';
import { collaborationRecords } from '../client/console-projections.mjs';

const setup = () => { const store = createFixtureStore(); const run = store.createRun(store.listTasks()[0].id); return {store,run}; };
test('ten-second patrol triggers independent work without waiting and never duplicates in-flight preparation', async()=>{
  assert.equal(TASK_PATROL_INTERVAL_MS,10000);
  const {store,run}=setup();let release,calls=0;const pending=new Promise(resolve=>release=resolve);
  const patrol=createTaskPatrol({store,execute:()=>{calls++;return pending;}});
  try{
    patrol.tick();patrol.tick();await Promise.resolve();assert.equal(calls,1);assert.equal(store.listDispatches(run.id).length,1);assert.equal(store.listDispatches(run.id)[0].recipientAgentId,run.manager.id);
    patrol.tick();assert.equal(calls,1);release();await new Promise(r=>setImmediate(r));
    store.updateRun(run.id,{status:'failed'});patrol.tick();await Promise.resolve();assert.equal(calls,1);
  }finally{release();patrol.stop();store.close();}
});
test('patrol recovers an unaddressed completed turn but excludes errors, human questions, pause, acceptance and terminal states',()=>{
  const {store,run}=setup();
  try{
    const d=store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'node'});store.claimDispatch(run.id);const t=store.createTrace(run.id,{agentId:'agent_analyst',workflowNodeId:'requirements'});store.attachDispatchTrace(d.id,t.id);
    assert.equal(store.prepareRunPatrol(run.id),false);store.completeTrace(t.id);store.completeDispatch(d.id);
    assert.equal(store.prepareRunPatrol(run.id),true);assert.equal(store.prepareRunPatrol(run.id),true);assert.equal(store.listDispatches(run.id).filter(x=>x.status==='queued').length,1);
    for(const status of ['failed','paused','awaiting_acceptance','completed','cancelled','awaiting_human']){const isolated=setup();try{if(['awaiting_acceptance','completed'].includes(status))isolated.store.updateRun(isolated.run.id,{status:'review'});if(status==='completed'){isolated.store.updateRun(isolated.run.id,{status:'awaiting_acceptance'});isolated.store.confirmRunCompletion(isolated.run.id);}else isolated.store.updateRun(isolated.run.id,{status});assert.equal(isolated.store.prepareRunPatrol(isolated.run.id),false,status);}finally{isolated.store.close();}}
  }finally{store.close();}
});
test('all digital roles can hand off to any other member, human instructions directly reach unassigned employees',()=>{
  const {store,run}=setup();
  try{
    const human=store.submitHumanMessage(run.id,{recipientAgentId:'agent_engineer',content:'Handle this directly'});assert.equal(store.listDispatches(run.id)[0].recipientAgentId,'agent_engineer');
    const delivery=store.claimDispatch(run.id);const trace=store.createTrace(run.id,{agentId:'agent_engineer',workflowNodeId:delivery.workflowNodeId,type:delivery.purpose});store.attachDispatchTrace(delivery.id,trace.id);
    assert.throws(()=>store.handoffDispatch(delivery.id,'agent_engineer','self',trace.id),/自己/);
    const msg=store.handoffDispatch(delivery.id,'agent_tester','Please check',trace.id);store.completeTrace(trace.id);
    assert.equal(msg.startMessageId,trace.inputMessageId);assert.equal(store.claimDispatch(run.id).recipientAgentId,'agent_tester');
    const records=collaborationRecords(store.getRunWorkspace(run.id));assert.ok(records.every(r=>r.category==='message'&&r.senderType!=='system'));assert.equal(records.find(r=>r.id===msg.id).startMessageId,trace.inputMessageId);assert.equal(records[0].id,human.message.id);
  }finally{store.close();}
});
test('failed task rejects all human messaging; retry adds a transient continue input without collaboration noise',()=>{
  const {store,run}=setup();
  try{
    const d=store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'node'});store.claimDispatch(run.id);const trace=store.createTrace(run.id,{agentId:'agent_analyst',workflowNodeId:'requirements'});store.attachDispatchTrace(d.id,trace.id);store.completeTrace(trace.id,{status:'failed',error:'401'});store.stopFailedDispatch(d.id,'401',{kind:'provider'});
    assert.throws(()=>store.submitHumanMessage(run.id,{content:'different work',recipientAgentId:'agent_tester'}),/错误中断/);
    const before=store.getRunWorkspace(run.id).messages.length;store.retryFailedNode(run.id,'requirements');const resumed=store.claimDispatch(run.id);
    const task=store.getRunTask(run.id),workspace=store.getRunWorkspace(run.id),agent=store.getRunAgent(run.id,resumed.recipientAgentId);
    const input=taskPrompt({task,run:store.getRun(run.id),node:task.workflowSnapshot.nodes[0],trace,agent,directory:'/tmp/test',cwd:task.workspacePath,workspace,messages:[],roster:[],mode:resumed.purpose,delivery:resumed,session:{}});
    assert.match(input.prompt,/继续。/);assert.equal(store.getRunWorkspace(run.id).messages.length,before);assert.deepEqual(collaborationRecords(store.getRunWorkspace(run.id)),[]);
  }finally{store.close();}
});

test('nested consultation may contact an ancestor in a new turn and unwind replies',()=>{
  const {store,run}=setup();
  try {
    store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'node'});
    const a=store.claimDispatch(run.id),q1=store.askQuestion(a.id,{audience:'agent',recipientAgentId:'agent_engineer',question:'Check implementation'});
    const b=store.claimDispatch(run.id),q2=store.askQuestion(b.id,{audience:'agent',recipientAgentId:'agent_analyst',question:'Clarify requirement'});
    const a2=store.claimDispatch(run.id);assert.equal(a2.recipientAgentId,'agent_analyst');assert.notEqual(a2.id,a.id);
    store.handoffDispatch(a2.id,'agent_engineer','Requirement clarified');assert.equal(store.getDispatch(b.id).status,'queued');
    assert.equal(store.claimDispatch(run.id).id,b.id);store.handoffDispatch(b.id,'agent_analyst','Implementation checked');assert.equal(store.claimDispatch(run.id).id,a.id);
    assert.equal(store.pendingQuestions(run.id).length,0);const messages=store.getRunWorkspace(run.id).messages;assert.ok(messages.some(m=>m.replyToMessageId===q1.id));assert.ok(messages.some(m=>m.replyToMessageId===q2.id));
  } finally {store.close();}
});
