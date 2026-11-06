import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,symlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCatalogFixtureStore} from './fixture-store.mjs';
import {createRunFiles} from '../server/run-files.mjs';
import {createStore} from '../server/store.mjs';
import {taskPrompt} from '../server/prompts.mjs';
import {collaborationRecords} from '../client/console-projections.mjs';

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'af-task-attachment-')),databasePath=join(root,'state.sqlite');
 const store=createCatalogFixtureStore({databasePath,workspaceRoot:join(root,'work')});
 t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const task=store.createTask({title:'附件',objective:'读取上传内容',memberAgentIds:['system_project_manager','agent_analyst']});
 return {root,databasePath,store,task,run:store.createRun(task.id),files:createRunFiles({root:join(root,'files')})};
}
test('task attachment messages keep original bytes, ownership, frozen references and clarification routing',async t=>{
 const {root,databasePath,store,task,run,files}=await fixture(t);
 const bytes=Buffer.from([0,255,128,13,10,1]);
 const record=store.registerRunAttachment(run.id,await files.writeRunAttachment(run.id,'资料.bin',bytes));
 assert.deepEqual(await files.readRunAttachment(run.id,record),bytes);
 const other=store.createRun(store.createTask({title:'其他',objective:'不读取前一任务',memberAgentIds:['system_project_manager']}).id);
 assert.throws(()=>store.submitHumanMessage(other.id,{content:'',attachmentIds:[record.id]}),/不属于/);
 assert.equal(store.getRunWorkspace(other.id).messages.length,0);
 assert.throws(()=>store.submitHumanMessage(run.id,{content:'',attachmentIds:Array(11).fill(record.id)}),/10/);
 const sent=store.submitHumanMessage(run.id,{content:'',attachmentIds:[record.id]});
 assert.equal(sent.message.content,'');assert.equal(sent.message.attachments[0].sha256,record.sha256);
 assert.equal(collaborationRecords(store.getRunWorkspace(run.id)).find(m=>m.id===sent.message.id).attachments[0].id,record.id);
 const delivery=store.claimDispatch(run.id),trace=store.createTrace(run.id,{agentId:run.manager.id,workflowNodeId:delivery.workflowNodeId,type:delivery.purpose});store.attachDispatchTrace(delivery.id,trace.id);
 const question=store.askQuestion(delivery.id,{audience:'human',question:'请补充附件说明',questionType:'fact'},trace.id);
 store.completeTrace(trace.id);
 const answer=store.submitHumanMessage(run.id,{replyToMessageId:question.id,content:'参考附件',attachmentIds:[record.id]});
 assert.equal(answer.message.replyToMessageId,question.id);assert.equal(store.listDispatches(run.id).find(d=>d.id===delivery.id).status,'queued');
 const messages=store.memberInputMessages(delivery.id);messages.forEach(m=>m.attachments?.forEach(a=>a.path=files.runAttachmentPath(run.id,a)));
 const prompt=taskPrompt({task:store.getRunTask(run.id),run,node:task.workflowSnapshot.nodes[0],trace,agent:run.manager,directory:root,cwd:task.workspacePath,workspace:store.getRunExecutionContext(run.id),messages,roster:run.participants,mode:'manager',delivery,session:{}});
 assert.ok(prompt.prompt.includes(files.runAttachmentPath(run.id,record)));
 const reopened=createStore({databasePath});try{assert.deepEqual(reopened.getRunAttachment(run.id,record.id),record);}finally{reopened.close();}
 await writeFile(files.runAttachmentPath(run.id,record),'tampered');await assert.rejects(files.readRunAttachment(run.id,record),/完整性/);
 store.failRun(other.id,'模拟错误');assert.throws(()=>store.registerRunAttachment(other.id,record),/不接受附件/);
});
test('task uploads reject oversized, path traversal and symlink storage',async t=>{
 const {root,run,files}=await fixture(t);
 for(const name of ['../secret','a/b','..',''])await assert.rejects(files.writeRunAttachment(run.id,name,Buffer.from('x')));
 await assert.rejects(files.writeRunAttachment(run.id,'large',Buffer.alloc(20*1024*1024+1)),/20 MiB/);
 const external=join(root,'external');await mkdir(external);await mkdir(join(root,'files','runs',run.id),{recursive:true});await symlink(external,join(root,'files','runs',run.id,'attachments'));
 await assert.rejects(files.writeRunAttachment(run.id,'x',Buffer.from('x')),/符号链接/);
});
test('long-run scheduling reads bounded facts without expanding employee prompts or audit history',async t=>{
 const {store}=await fixture(t);store.updateAgent('system_project_manager',{systemPrompt:'large employee prompt '.repeat(8000)});
 const task=store.createTask({title:'长任务',objective:'复现重复展开',memberAgentIds:['system_project_manager']});const run=store.createRun(task.id);
 store.transaction(()=>{for(let i=0;i<100;i++){
  const trace=store.createTrace(run.id,{agentId:run.manager.id,workflowNodeId:task.workflowSnapshot.nodes[0].id,type:'manager'});store.completeTrace(trace.id);
  store.addEvent({type:'runtime.event',runId:run.id,message:'audit',data:{auditVersion:2,payload:'large log '.repeat(1000)}});
 }});
 const context=store.getRunExecutionContext(run.id);assert.equal(context.traces.length,18);assert.equal(store.hasRunTraces(run.id),true);assert.ok(JSON.stringify(context).length<10000);
 assert.ok(JSON.stringify(store.getRunWorkspace(run.id,{summary:true})).length<2000000,'employee snapshots must not expand per Trace');
 context.traces[0].status='failed';assert.equal(store.getRunExecutionContext(run.id).traces[0].status,'completed');
 assert.equal(store.getRunMessage(run.id,'missing'),null);assert.equal(store.latestRunMessageId(run.id),null);
});
