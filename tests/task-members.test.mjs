import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureStore} from './fixture-store.mjs';
import {workspaceAgents} from '../client/console-projections.mjs';

test('membership edits retain frozen records, reject busy removal and keep the manager',()=>{
 const store=createFixtureStore();try{
  const run=store.createRun(store.listTasks()[0].id),initial=structuredClone(run.participants),ids=initial.filter(m=>m.type==='agent').map(m=>m.id);
  assert.ok(store.updateRunMembers(run.id,{memberAgentIds:ids.map(id=>id===run.manager.id?run.manager.sourceAgentId:id)}).memberAgentIds.includes(run.manager.id));
  assert.throws(()=>store.updateRunMembers(run.id,{memberAgentIds:[...ids,run.manager.sourceAgentId]}),/重复/);
  const newMember=store.createAgent({name:'新增协作员工',systemPrompt:'冻结的新成员指令'});
  assert.throws(()=>store.updateRunMembers(run.id,{memberAgentIds:ids.filter(id=>id!==run.manager.id)}),/经理/);
  const result=store.updateRunMembers(run.id,{memberAgentIds:[...ids,newMember.id]});assert.ok(result.memberAgentIds.includes(newMember.id));
  const d=store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'node'});store.claimDispatch(run.id);
  assert.throws(()=>store.updateRunMembers(run.id,{memberAgentIds:result.memberAgentIds.filter(id=>id!=='agent_analyst')}),/暂不能移除/);
  store.completeDispatch(d.id);
  const t=store.createTrace(run.id,{agentId:'agent_analyst',workflowNodeId:'requirements'});store.completeTrace(t.id);
  store.updateRunMembers(run.id,{memberAgentIds:result.memberAgentIds.filter(id=>id!=='agent_analyst')});
  assert.deepEqual(store.getRun(run.id).participants.slice(0,initial.length),initial);
  const workspace=store.getRunWorkspace(run.id);assert.equal(workspace.traces.find(trace=>trace.id===t.id).agent.name,initial.find(a=>a.id==='agent_analyst').name);
  assert.ok(!workspaceAgents(workspace).some(m=>m.id==='agent_analyst'));
  assert.doesNotThrow(()=>store.getConsoleEvents(run.id,{agentId:'agent_analyst',traceId:t.id}));
  assert.throws(()=>store.submitHumanMessage(run.id,{recipientAgentId:'agent_analyst',content:'不可投递'}),/不属于/);
  store.updateRunMembers(run.id,{memberAgentIds:result.memberAgentIds});assert.equal(store.getRun(run.id).participants.filter(a=>a.id==='agent_analyst').length,1);
  store.updateRun(run.id,{status:'failed'});assert.throws(()=>store.updateRunMembers(run.id,{memberAgentIds:ids}),/状态/);
 }finally{store.close();}
});
test('employee MCP directory shares CLI catalog, paginates and rejects foreign identity and mutation',()=>{
 const store=createFixtureStore();try{
  const actor=store.listAgents()[0].id;
  const first=store.historyQuery(actor,'list_employees',{limit:2,page:1});assert.equal(first.items.length,2);assert.equal(first.hasMore,true);
  const second=store.historyQuery(actor,'list_employees',{limit:2,page:2});assert.notEqual(first.items[0].id,second.items[0].id);
  const employee=store.listAgents()[0];assert.deepEqual(store.historyQuery(actor,'read_employee',{agentId:employee.id}).employee,employee);
  assert.throws(()=>store.historyQuery('foreign','list_employees',{}),/不存在|访问/);
  assert.throws(()=>store.historyQuery(actor,'read_employee',{agentId:employee.id,status:'inactive'}),/参数/);
  assert.throws(()=>store.historyQuery(actor,'list_employees',{page:0}),/参数/);
  assert.equal(store.createTeam({name:'停用团队',memberAgentIds:[],status:'inactive'}).status,'inactive');
 }finally{store.close();}
});
