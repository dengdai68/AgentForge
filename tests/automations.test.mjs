import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';
import { previewSchedule } from '../server/automation-schedule.mjs';
import { createAutomationScheduler } from '../server/automation-scheduler.mjs';
import { taskPrompt } from '../server/prompts.mjs';
function setup() {
  const store=createStore({workspaceRoot:'/tmp/automation-unit-work'});
  const input={title:'自动简报',objective:'完成简报',memberAgentIds:['system_project_manager','agent_analyst'],workflowTemplateId:'content_delivery',cron:'* * * * *',timeZone:'Asia/Shanghai'};
  const at=new Date('2026-11-04T00:00:00Z');
  return {store,input,at,automation:store.saveAutomation(input,null,at)};
}
test('five-field cron validates timezone, ranges and DST',()=>{
  assert.equal(previewSchedule('0 9 * * 1-5','Asia/Shanghai',new Date('2026-11-06T02:00:00Z'),1)[0],'2026-11-09T01:00:00.000Z');
  for(const cron of ['* * * * * *','@daily','H * * * *','60 * * * *','0 0 31 2 *'])assert.throws(()=>previewSchedule(cron,'UTC'));
  assert.throws(()=>previewSchedule('* * * * *','invalid'));
  const times=previewSchedule('0 9 * * *','America/New_York',new Date('2026-10-31T14:00:00Z'),2);
  assert.equal(times[0],'2026-11-01T14:00:00.000Z');assert.equal(times[1],'2026-11-02T14:00:00.000Z');
});
test('automatic runs isolate list, participants, prompts and human commands; ordinary tasks unchanged',()=>{
  const {store,input,automation}=setup();try{
    const ordinary=store.createTask({title:'普通',objective:'保持人类',memberAgentIds:input.memberAgentIds,workflowTemplateId:input.workflowTemplateId});const manual=store.createRun(ordinary.id);
    assert.ok(manual.participants.some(member=>member.type==='human'));
    const record=store.triggerAutomation(automation.id);assert.ok(record.runId,record.reason);
    const run=store.getRun(record.runId),task=store.getRunTask(run.id);
    assert.equal(task.kind,'automation');assert.ok(run.participants.every(member=>member.type==='agent'));
    assert.deepEqual(store.listTasks().map(item=>item.id),[ordinary.id]);assert.deepEqual(store.getBootstrap().runs.map(item=>item.id),[manual.id]);
    assert.throws(()=>store.submitHumanMessage(run.id,{content:'hello'}),/自动化/);
    const dispatch=store.enqueueDispatch(run.id,{recipientAgentId:run.manager.id,workflowNodeId:'content_brief',purpose:'manager'});store.claimDispatch(run.id);
    assert.throws(()=>store.askQuestion(dispatch.id,{audience:'human',question:'请回答'},null),/自动化/);
    assert.throws(()=>store.addMessage({runId:run.id,recipientHuman:true,sender:{type:'agent',id:run.manager.id},content:'请回答'}),/自动化/);
    const prompt=taskPrompt({task,run,node:task.workflowSnapshot.nodes[0],trace:{id:'trace'},agent:run.manager,directory:'tmp',cwd:'tmp',workspace:store.getRunWorkspace(run.id),messages:[],roster:run.participants,mode:'manager',delivery:{id:dispatch.id,patrol:true},session:{}});
    assert.match(prompt.systemPrompt,/全自动任务/);assert.doesNotMatch(prompt.systemPrompt,/audience（agent 或 human）|需要人类回答时/);
    assert.throws(()=>store.createTask({...input,priority:'high'}),/废弃/);
  }finally{store.close();}
});
test('trigger transaction confirms only finished awaiting acceptance and retains audit link',()=>{
  const {store,automation}=setup();try{
    const first=store.triggerAutomation(automation.id);store.requestHumanAcceptance(first.runId);
    const second=store.triggerAutomation(automation.id);assert.ok(second.runId);
    const previous=store.getRun(first.runId);assert.equal(previous.status,'completed');assert.equal(previous.confirmedBy,'automation');assert.equal(previous.confirmedByTriggerId,second.id);
    assert.equal(store.getRunWorkspace(first.runId).messages.length,0);
    const skip=store.triggerAutomation(automation.id);assert.equal(skip.outcome,'skipped');assert.equal(skip.runId,null);
    store.pauseRun(second.runId);assert.equal(store.triggerAutomation(automation.id).outcome,'skipped');
    assert.equal(store.getRun(second.runId).status,'paused');
  }finally{store.close();}
});
test('invalid next configuration cannot accept prior run; disable still works',()=>{
  const {store,automation}=setup();try{
    const first=store.triggerAutomation(automation.id);store.requestHumanAcceptance(first.runId);
    store.updateAgent('agent_analyst',{status:'inactive'});
    const next=store.triggerAutomation(automation.id);assert.equal(next.outcome,'failed');assert.equal(next.runId,null);assert.equal(store.getRun(first.runId).status,'awaiting_acceptance');assert.equal(store.listRuns().length,1);
    assert.equal(store.saveAutomation({enabled:false},automation.id).enabled,false);
  }finally{store.close();}
});
test('scheduled claim is persistent and idempotent; missed occurrences skip, manual does not move schedule',()=>{
  const {store,automation,at}=setup();try{
    const plannedAt=automation.nextTriggerAt,nextAt=new Date(plannedAt);
    const first=store.triggerAutomation(automation.id,{plannedAt,at:nextAt}),duplicate=store.triggerAutomation(automation.id,{plannedAt,at:nextAt});assert.equal(first.id,duplicate.id);assert.equal(store.listAutomationTriggers(automation.id).total,1);
    const next=store.getAutomation(automation.id).nextTriggerAt;store.triggerAutomation(automation.id);assert.equal(store.getAutomation(automation.id).nextTriggerAt,next);
    store.requestHumanAcceptance(first.runId);
    const missed=store.triggerAutomation(automation.id,{plannedAt:next,at:new Date(+at+3600000)});assert.equal(missed.outcome,'skipped');assert.equal(store.getRun(first.runId).status,'awaiting_acceptance');
  }finally{store.close();}
});
test('pagination filters before slicing; no nested full list in bootstrap',()=>{
  const {store,input,automation}=setup();try{
    for(let i=0;i<24;i++)store.saveAutomation({...input,title:`分页 ${i}`,enabled:i%2===0});
    assert.equal(store.listAutomations().total,25);assert.equal(store.listAutomations({page:2}).items.length,5);assert.equal(store.listAutomations({status:'disabled'}).total,12);
    assert.throws(()=>store.listAutomations({page:0}),/分页/);assert.throws(()=>store.listAutomationTriggers(automation.id,{status:'bogus'}),/状态/);
    for(let i=0;i<23;i++)store.triggerAutomation(automation.id);
    assert.equal(store.listAutomationTriggers(automation.id,{page:2}).items.length,3);assert.equal(store.listAutomationTriggers(automation.id,{status:'skipped'}).total,22);
    assert.throws(()=>store.deleteAutomation(automation.id),/停用/);
  }finally{store.close();}
});
test('scheduler launches asynchronously and does not await provider',async()=>{
  let invoked=0,claimed=0,due=true;let resolve;
  const pending=new Promise(r=>resolve=r);
  const store={dueAutomations:()=>due?[{id:'auto',plannedAt:'now'}]:[],triggerAutomation:()=>{due=false;claimed++;return {runId:'run',outcome:'started'};}};
  const scheduler=createAutomationScheduler({getStore:()=>store,execute:()=>{invoked++;return pending;}});
  scheduler.tick();scheduler.tick();assert.equal(claimed,1);await Promise.resolve();assert.equal(invoked,1);resolve();scheduler.stop();
});

test('reopened Store preserves occurrence key, configuration and next-run confirmation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'af-auto-')),options={databasePath:join(dir,'state.sqlite'),workspaceRoot:join(dir,'work')};let store=createStore(options);
  try{
    const auto=store.saveAutomation({title:'持久调度',objective:'验证',memberAgentIds:['system_project_manager','agent_analyst'],workflowTemplateId:'content_delivery',cron:'* * * * *',timeZone:'UTC'});
    const first=store.triggerAutomation(auto.id,{plannedAt:auto.nextTriggerAt,at:new Date(auto.nextTriggerAt)});store.requestHumanAcceptance(first.runId);store.close();store=createStore(options);
    assert.equal(store.triggerAutomation(auto.id,{plannedAt:auto.nextTriggerAt,at:new Date(auto.nextTriggerAt)}).id,first.id);
    const second=store.triggerAutomation(auto.id);assert.ok(second.runId);store.close();store=createStore(options);
    assert.equal(store.getRun(first.runId).confirmedByTriggerId,second.id);assert.equal(store.listAutomationTriggers(auto.id).total,2);assert.equal(store.getRun(first.runId).participants.some(member=>member.type==='human'),false);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('pending traces prevent next-run confirmation; failed retries cannot overlap another cycle',()=>{
  const {store,automation}=setup();try{
    const first=store.triggerAutomation(automation.id);const run=store.getRun(first.runId);
    const trace=store.createTrace(run.id,{agentId:run.manager.id,workflowNodeId:'content_brief',type:'manager'});store.requestHumanAcceptance(run.id);
    assert.equal(store.triggerAutomation(automation.id).outcome,'skipped');assert.equal(store.getRun(run.id).status,'awaiting_acceptance');
    store.completeTrace(trace.id);store.updateRun(run.id,{status:'running'});store.failRun(run.id,'测试失败');
    const second=store.triggerAutomation(automation.id);assert.ok(second.runId);assert.throws(()=>store.retryFailedOrchestration(run.id),/其他轮次/);assert.equal(store.getRun(run.id).status,'failed');
  }finally{store.close();}
});
