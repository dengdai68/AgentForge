import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskPrompt, communicationPrompt } from '../server/prompts.mjs';
import { runClaudeCodeCli, runCodexCli, promptSnapshot } from '../server/runtime/local-cli.mjs';
import { withHistoryTools } from '../server/history/bridge.mjs';
import { createFixtureStore } from './fixture-store.mjs';
import { scheduleManagerFollowup } from '../server/orchestrator.mjs';

const taskInput = () => ({
  task: { title: '目标', objective: 'TASK_OBJECTIVE', workspacePath: '/work', repositorySources: [], repositoryBindings: {}, acceptanceCriteria: [], workflowSnapshot: { nodes: [{ id: 'first', title: 'CURRENT_WORK', deliverable: 'CURRENT_DELIVERY' }, { id: 'second', title: 'OTHER_NODE_SECRET' }] } },
  run: { id: 'run-one', manager:{id:'coordinator'} }, node: { id: 'first', title: 'CURRENT_WORK', description:'CURRENT_NODE_DESCRIPTION', deliverable: 'CURRENT_DELIVERY', artifactPaths: ['docs/first'] },
  trace: { id: 'trace-one' }, agent: { id: 'worker', name: '员工', kind: 'business', systemPrompt: 'PERSONA_RULE' }, directory: '/trace', cwd: '/work',
  workspace: { traces: [], pendingQuestions: [], decisions: [], artifacts: [] }, messages: [], roster: [{ id: 'worker', name: '员工' }], mode: 'node', delivery: { messageIds: [], attempts: 1 }, session: { resume: false }
});

test('routing feedback is explicit current input, not a stale error or a role message', () => {
  const input = taskInput();
  input.delivery = { ...input.delivery, lastErrorKind:'routing', lastError:'EXACT_REJECTION', routingError:{traceId:'rejected-trace',message:'EXACT_REJECTION'} };
  const correction = taskPrompt(input);
  assert.equal(correction.prompt.match(/EXACT_REJECTION/g).length, 1);
  assert.match(correction.prompt,/rejected-trace/); assert.match(correction.prompt,/不要重复已完成的业务操作/);
  assert.deepEqual(input.messages, []);
  delete input.delivery.routingError;
  const resolved = taskPrompt(input);
  assert.doesNotMatch(resolved.prompt,/EXACT_REJECTION|协调纠错反馈/);
});

test('workflow is manager-only file context; complete graph never enters system or current input', () => {
  const input = taskInput(), worker = taskPrompt(input);
  assert.match(worker.systemPrompt, /PERSONA_RULE|任务工作目录：\/work/);
  assert.doesNotMatch(worker.prompt, /PERSONA_RULE|\/work|工作流定义|OTHER_NODE_SECRET/);
  assert.doesNotMatch(worker.systemPrompt, /OTHER_NODE_SECRET/);
  assert.match(worker.systemPrompt, /可咨询角色：/);
  assert.doesNotMatch(worker.prompt, /可咨询角色：/);
  assert.match(worker.prompt, /CURRENT_DELIVERY|TASK_OBJECTIVE/);
  assert.match(worker.prompt, /CURRENT_NODE_DESCRIPTION/);
  const manager = taskPrompt({ ...input, agent: { ...input.agent, id:'coordinator', kind: 'manager' }, mode: 'manager' });
  assert.doesNotMatch(manager.systemPrompt, /OTHER_NODE_SECRET|CURRENT_DELIVERY/);
  assert.match(manager.systemPrompt, /\/trace\/workflow\.md|先用文件工具读取/);
  assert.doesNotMatch(manager.prompt, /OTHER_NODE_SECRET|CURRENT_DELIVERY|workflowNodeId/);
  const continued = taskPrompt({ ...input, session: { resume: true, inputContext: worker.inputContext } });
  assert.doesNotMatch(continued.prompt, /TASK_OBJECTIVE/);
  assert.doesNotMatch(continued.prompt, /CURRENT_DELIVERY/);
});

test('condition workers receive current judgment guidance without the other branch definitions',()=>{
  const input=taskInput();input.node.type='condition';const result=taskPrompt(input);
  assert.match(result.prompt,/节点类型：条件判断/);assert.match(result.prompt,/交回经理选择分支/);assert.doesNotMatch(result.prompt+result.systemPrompt,/OTHER_NODE_SECRET/);
});

test('resumed task delivers only changed context and new handoffs, while retries before receipt retain input', () => {
  const input = taskInput();
  input.workspace.artifacts = [{id:'a1',name:'audio.wav',version:1,sha256:'aaa'}];
  input.messages = [{id:'m1',content:'首次派工'}];
  const first = taskPrompt(input);
  assert.equal(taskPrompt({...input,session:{resume:true}}).prompt, first.prompt, 'native session allocation is not a delivery receipt');
  const second = taskPrompt({...input,session:{resume:true,inputContext:first.inputContext},messages:[{id:'m2',content:'仅重做 38 句'}]});
  assert.match(second.prompt,/仅重做 38 句/);
  assert.doesNotMatch(second.prompt,/TASK_OBJECTIVE|CURRENT_DELIVERY|首次派工|audio.wav/);
  input.workspace.artifacts[0].sha256='bbb';
  const changed=taskPrompt({...input,session:{resume:true,inputContext:second.inputContext},messages:[]});
  assert.doesNotMatch(changed.prompt,/audio.wav|Artifact 引用更新/);
  assert.doesNotMatch(changed.prompt,/TASK_OBJECTIVE|CURRENT_DELIVERY/);
});

test('communication separates persona/mode/environment from the one target message', () => {
  const message = { id: 'message-one', content: 'USER_ORIGINAL', sender: { type: 'human' } };
  const result = communicationPrompt({ agent: { name: '员工', systemPrompt: 'PERSONA_RULE' }, root: '/chat', cwd: '/chat/worker', context: { conversation: { kind: 'agent' }, handoffCandidates: [], message }, messages: [message] });
  assert.match(result.systemPrompt, /PERSONA_RULE/);
  assert.match(result.systemPrompt, /会话共享工作目录（当前 cwd）：\/chat/);
  assert.doesNotMatch(result.systemPrompt, /USER_ORIGINAL/);
  assert.doesNotMatch(result.prompt, /PERSONA_RULE|\/chat|只输出|人类沟通中回答/);
  assert.doesNotMatch(result.systemPrompt,/handoffToAgentId|本轮可转交成员/);
  assert.match(result.systemPrompt,/只输出 JSON 对象/);
  assert.match(result.systemPrompt,/不转交、不安排其他成员/);
  assert.equal(result.prompt.match(/USER_ORIGINAL/g).length, 1);
});

test('ordinary communication never adds automatic routing candidates', () => {
  const input = { agent: { name: '员工' }, root: '/chat', cwd: '/chat/worker', messages: [], context: { conversation: { kind: 'team' }, message: { id: 'm', content: 'USER_ONLY' }, handoffCandidates: [{ id: 'peer-one', name: '同事' }] } };
  const first = communicationPrompt(input);
  const second = communicationPrompt({ ...input, context: { ...input.context, handoffCandidates: [] } });
  assert.doesNotMatch(first.systemPrompt, /peer-one|handoffToAgentId/);
  assert.doesNotMatch(second.systemPrompt, /peer-one/);
  assert.equal(first.prompt, second.prompt);
});

test('explicit manager selection is not overridden by static Task node assignments', () => {
  const store = createFixtureStore(), run = store.createRun(store.listTasks()[0].id);
  store.updateRun(run.id, { status: 'running' });
  assert.equal(store.getRunTask(run.id).nodeAssignments.requirements, 'agent_analyst');
  scheduleManagerFollowup(store, run.id, { id: 'manager-turn', recipientAgentId: run.manager.id, traceIds: [] }, { nextNodeId: 'requirements', nextAgentId: 'agent_tester', rationale: '本轮选择具备能力的另一成员' });
  assert.equal(store.listDispatches(run.id).at(-1).recipientAgentId, 'agent_tester');
  store.close();
});

test('accepted input cursor survives restart while native session remains isolated', async t => {
  const root = await mkdtemp(join(tmpdir(), 'af-input-cursor-')); t.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, 'state.sqlite'); let store = createFixtureStore({ databasePath });
  const run = store.createRun(store.listTasks()[0].id); store.updateRun(run.id, { status: 'running' });
  const message = store.addMessage({ runId: run.id, content: 'ONCE_ONLY', recipientAgentId: 'agent_analyst' });
  const delivery = store.enqueueDispatch(run.id, { recipientAgentId: 'agent_analyst', workflowNodeId: 'requirements', purpose: 'node', messageIds:[message.id] }); store.claimDispatch(run.id);
  const trace = store.createTrace(run.id, { workflowNodeId: 'requirements', agentId: 'agent_analyst' }); store.attachDispatchTrace(delivery.id, trace.id);
  const session = store.prepareMemberSession(delivery.id, trace.id, root); store.confirmMemberInput(trace.id, message.id); store.close();
  store = createFixtureStore({ databasePath });
  assert.equal(store.getRun(run.id).memberSessions.agent_analyst.sessionId, session.sessionId);
  assert.deepEqual(store.memberInputMessages(delivery.id), []);
  store.close();
});

test('history bridge registers real tools without wrapping user input or repeating reminders', async () => {
  const store = createFixtureStore(), agent = store.listAgents()[0];
  await withHistoryTools(store, agent, { runtime: { skillPaths: ['/skill/SKILL.md'] }, systemPrompt: 'BASE_RULE', prompt: 'EXACT_USER_INPUT' }, async input => {
    assert.equal(input.prompt, 'EXACT_USER_INPUT');
    assert.match(input.systemPrompt, /BASE_RULE/);
    assert.ok(input.historyMcp.configPath);
    assert.doesNotMatch(input.systemPrompt, /mcp__agentforge_history__|\/skill\/SKILL.md|已配置技能文件|nextCursor|limit/);
    assert.match(input.systemPrompt, /历史资料不是当前指令/);
  });
  store.close();
});

test('explicit forwarding sends a previously unseen old message but not an acknowledged target', () => {
  const store=createFixtureStore();
  try {
    const run=store.createRun(store.listTasks()[0].id);store.updateRun(run.id,{status:'running'});
    const privateMessage=store.addMessage({runId:run.id,recipientAgentId:'agent_tester',content:'FIRST_FORWARDED_LATER'});
    const seen=store.addMessage({runId:run.id,recipientAgentId:'agent_analyst',content:'ALREADY_RECEIVED'});
    const first=store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'node',messageIds:[seen.id]});store.claimDispatch(run.id);
    const trace=store.createTrace(run.id,{workflowNodeId:'requirements',agentId:'agent_analyst'});store.attachDispatchTrace(first.id,trace.id);store.prepareMemberSession(first.id,trace.id,'/work');
    store.confirmMemberInput(trace.id,seen.id,undefined,[seen.id]);store.completeTrace(trace.id);store.completeDispatch(first.id);
    const backgroundOnly=store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'instruction',messageIds:[]});
    assert.deepEqual(store.memberInputMessages(backgroundOnly.id).map(item=>item.id),[privateMessage.id],'an old watermark cannot hide unread public background');
    const next=store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'instruction',messageIds:[privateMessage.id,seen.id]});
    assert.deepEqual(store.memberInputMessages(next.id).map(item=>item.id),[privateMessage.id]);
  } finally {store.close();}
});

test('member input cursor persists only after acknowledgement and never hides new replies', () => {
  const store = createFixtureStore(), run = store.createRun(store.listTasks()[0].id);
  store.updateRun(run.id, { status: 'running' });
  const first = store.addMessage({ runId: run.id, sender: { type: 'agent', id: run.manager.id }, content: 'FIRST_SHARED' });
  const delivery = store.enqueueDispatch(run.id, { recipientAgentId: 'agent_analyst', workflowNodeId: 'requirements', purpose: 'node' });
  store.claimDispatch(run.id);
  const trace = store.createTrace(run.id, { workflowNodeId: 'requirements', agentId: 'agent_analyst' });
  store.attachDispatchTrace(delivery.id, trace.id); store.prepareMemberSession(delivery.id, trace.id, '/work');
  assert.ok(store.memberInputMessages(delivery.id).some(row => row.id === first.id));
  assert.ok(store.memberInputMessages(delivery.id).some(row => row.id === first.id), 'preparing input does not consume it');
  store.confirmMemberInput(trace.id, first.id);
  assert.equal(store.memberInputMessages(delivery.id).length, 0);
  store.resetMemberSession(trace.id, 'confirmed missing native session');
  assert.equal(store.memberInputMessages(delivery.id).length, 0, 'native session loss does not replay acknowledged platform history');
  const second = store.addMessage({ runId: run.id, recipientAgentId: 'agent_analyst', content: 'NEW_HUMAN_REPLY' });
  assert.deepEqual(store.memberInputMessages(delivery.id).map(row => row.id), [second.id]);
  store.close();
});

test('native adapters receive application instructions separately and update them on exact session resume', async t => {
  const root = await mkdtemp(join(tmpdir(), 'af-prompt-transport-')); t.after(() => rm(root, { recursive: true, force: true }));
  const capture = join(root, 'args.json'), executable = join(root, 'provider.mjs');
  await writeFile(executable, `#!/usr/bin/env node\nif(process.argv.includes("features")){console.log("skip_host_skill_discovery stable false");process.exit(0);}if(process.argv.includes("mcp")&&process.argv.includes("list")){console.log("[]");process.exit(0);}\nimport {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({type:'result',result:'ok'}));`, { mode: 0o700 });
  const base = { runtime: { executable }, systemPrompt: 'SYSTEM_RULE_ONE', prompt: 'USER_ONLY', workspacePath: root, traceDirectory: root, finalPath: join(root, 'final'), runId: 'transport', onEvent: async () => {} };
  await runClaudeCodeCli(base);
  let args = JSON.parse(await readFile(capture, 'utf8'));
  assert.equal(args.at(-1), 'USER_ONLY');
  assert.equal(await readFile(args[args.indexOf('--append-system-prompt-file') + 1], 'utf8'), 'SYSTEM_RULE_ONE');
  assert.equal(args[args.indexOf('--system-prompt-snapshot') + 1], 'off');
  await runClaudeCodeCli({ ...base, systemPrompt: 'UPDATED_ENVIRONMENT', session: { sessionId: '12345678-1234-1234-1234-123456789abc', resume: true } });
  args = JSON.parse(await readFile(capture, 'utf8'));
  assert.ok(args.includes('--resume'));
  assert.equal(await readFile(args[args.indexOf('--append-system-prompt-file') + 1], 'utf8'), 'UPDATED_ENVIRONMENT');
  await writeFile(base.finalPath, 'ok');
  await runCodexCli(base);
  args = JSON.parse(await readFile(capture, 'utf8'));
  assert.equal(args.at(-1), 'USER_ONLY');
  assert.ok(args.includes('developer_instructions="SYSTEM_RULE_ONE"'));
  const snapshot = promptSnapshot(base);
  assert.match(snapshot.prompt.text, /\[应用系统指令\][\s\S]*SYSTEM_RULE_ONE[\s\S]*\[本轮输入\][\s\S]*USER_ONLY/);
});


test('task input keeps actionable message provenance and omits routing/storage noise', () => {
  const input = taskInput();
  input.node.staffingGuidance = 'MANAGER_STAFFING_ONLY';
  input.agent.systemPrompt = ''; input.agent.description = 'ONCE_PERSONA';
  input.messages = [{id:'m1',runId:'STORAGE_RUN',conversationId:'STORAGE_CHAT',traceId:'STORAGE_TRACE',sender:{id:'manager',name:'经理'},recipient:{id:'worker'},replyToMessageId:'question-one',kind:'consultation_reply',questionType:'澄清',content:'ACTUAL_ANSWER /work/deliverable.txt',routingReason:'ROUTING_AUDIT',consideredMemberIds:['AUDIT_MEMBER']}];
  input.workspace.artifacts = [{id:'a1',name:'UNRELATED_LOG',sha256:'INTERNAL_HASH'}];
  const result = taskPrompt(input);
  assert.equal(result.systemPrompt.split('ONCE_PERSONA').length - 1, 1);
  assert.doesNotMatch(result.systemPrompt, /团队共享仓库：\[\]/);
  assert.doesNotMatch(result.prompt, /MANAGER_STAFFING_ONLY|STORAGE_|ROUTING_AUDIT|AUDIT_MEMBER|UNRELATED_LOG|INTERNAL_HASH|lastErrorKind|messageIds/);
  assert.match(result.prompt, /ACTUAL_ANSWER \/work\/deliverable.txt/);
  assert.match(result.prompt, /question-one|consultation_reply|manager/);
  // Staffing guidance remains in the frozen file, not inline system instructions.
  input.task.workflowSnapshot.nodes[0].staffingGuidance = 'MANAGER_STAFFING_ONLY';
  assert.doesNotMatch(taskPrompt({...input,agent:{...input.agent,id:'coordinator',kind:'manager'},mode:'manager'}).systemPrompt,/MANAGER_STAFFING_ONLY/);
});

test('patrol shares the ordinary inbox and never replays an acknowledged report or own output', () => {
  const input = taskInput();
  input.agent.id = 'coordinator'; input.mode = 'manager';
  input.workspace.messages = [{ id:'old',sender:{type:'agent',id:'worker'},content:'ALREADY_READ' }, { id:'new',sender:{type:'human'},content:'NEW_ONCE' }];
  const first = taskPrompt(input);
  const next = taskPrompt({ ...input, session:{resume:true,inputContext:first.inputContext}, delivery:{...input.delivery,patrol:true}, messages:[input.workspace.messages[1]] });
  assert.doesNotMatch(next.prompt,/ALREADY_READ|当前协作记录/);
  assert.equal(next.prompt.split('NEW_ONCE').length - 1, 1);
});

test('manager state sends per-entity changes, removals and window eviction without repeating unchanged facts', () => {
  const input = taskInput(); input.agent.id='coordinator'; input.mode='manager';
  input.workspace.traces=[{id:'old-trace',agentId:'worker',status:'completed'},{id:input.trace.id,agentId:'coordinator',status:'running'}];
  input.workspace.dispatches=[{id:'work',recipientAgentId:'worker',status:'claimed'}];
  input.workspace.pendingQuestions=[{id:'q',sender:{id:'worker'},recipient:{id:'human'},content:'QUESTION_BODY'}];
  const first=taskPrompt(input);
  assert.match(first.prompt,/old-trace|executing":1/);assert.doesNotMatch(first.prompt,/QUESTION_BODY|trace-one/);
  const second=taskPrompt({...input,session:{inputContext:first.inputContext},workspace:{...input.workspace,traces:[...input.workspace.traces,{id:'new-trace',agentId:'worker2',status:'running'}]}});
  assert.match(second.prompt,/new-trace/);assert.doesNotMatch(second.prompt,/old-trace|"work"|"q"/);
  const cleared=taskPrompt({...input,session:{inputContext:second.inputContext},workspace:{...input.workspace,traces:[],dispatches:[],pendingQuestions:[]}});
  assert.match(cleared.prompt,/outsideWindowIds.*old-trace/);assert.match(cleared.prompt,/removedIds.*work/);assert.match(cleared.prompt,/removedIds.*q/);
});

test('large original text becomes lossless stable material references and is not planned again after receipt', () => {
  const input=taskInput(),body='完整正文🌍\n'.repeat(1100);input.task.objective=body;
  input.messages=[{id:'large-message',sender:{id:'manager'},content:body}];
  input.materialDirectory='/records/input-materials';
  const first=taskPrompt(input);
  assert.doesNotMatch(first.prompt,/完整正文/);assert.match(first.prompt,/contentRef|资料文件/);assert.equal(first.materials.length,2);
  assert.equal(first.materials.find(item=>item.content===body).content,body);
  assert.ok(first.materials.every(item=>item.path.startsWith(input.materialDirectory+'/')));
  const resumed=taskPrompt({...input,messages:[],directory:'/different-trace',session:{inputContext:first.inputContext}});
  assert.equal(resumed.materials.length,0);assert.doesNotMatch(resumed.prompt,/资料文件/);
  const chat=communicationPrompt({agent:input.agent,cwd:'/chat',materialDirectory:input.materialDirectory,context:{conversation:{kind:'agent'},message:input.messages[0]},messages:input.messages});
  assert.equal(chat.materials.length,1);assert.equal(chat.materials[0].content,body);assert.doesNotMatch(chat.prompt,/完整正文/);
});

test('public background is caught up once, while an already read message can become current work later', () => {
  const store=createFixtureStore();
  try {
    const run=store.createRun(store.listTasks()[0].id);store.updateRun(run.id,{status:'running'});
    const other=store.addMessage({runId:run.id,sender:{type:'agent',id:'agent_tester'},recipientAgentId:run.manager.id,content:'PEER_PUBLIC_REPORT'});
    const d=store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'node',messageIds:[]});store.claimDispatch(run.id);
    const trace=store.createTrace(run.id,{agentId:'agent_analyst',workflowNodeId:'requirements'});store.attachDispatchTrace(d.id,trace.id);store.prepareMemberSession(d.id,trace.id,'/work');
    const through=store.latestRunMessageId(run.id),received=store.memberInputMessages(d.id);assert.ok(received.some(m=>m.id===other.id));
    const during=store.addMessage({runId:run.id,sender:{type:'agent',id:'agent_engineer'},recipientAgentId:'agent_tester',content:'ARRIVED_AFTER_INPUT_SELECTION'});
    store.confirmMemberInput(trace.id,through,{},received.map(m=>m.id));store.completeTrace(trace.id);store.completeDispatch(d.id);
    const next=store.enqueueDispatch(run.id,{recipientAgentId:'agent_analyst',workflowNodeId:'requirements',purpose:'instruction',messageIds:[other.id]});
    assert.deepEqual(store.memberInputMessages(next.id).map(m=>m.id),[during.id]);
    const input=taskInput();input.delivery=next;input.messages=store.memberInputMessages(next.id);
    const prompt=taskPrompt(input);assert.match(prompt.prompt,new RegExp(`本轮处理消息：.*${other.id}`));assert.doesNotMatch(prompt.prompt,/PEER_PUBLIC_REPORT/);assert.match(prompt.prompt,/ARRIVED_AFTER_INPUT_SELECTION/);
    assert.equal(store.listDispatches(run.id).length,2,'background does not wake recipients');
  }finally{store.close();}
});

test('a large shared inbox is lossless file context with explicit current work references', () => {
  const input=taskInput();input.messages=Array.from({length:60},(_,i)=>({id:'public_'+i,sender:{id:'peer'},recipient:{id:'another'},content:'共享背景。'.repeat(60)}));input.delivery.messageIds=['public_59'];
  const output=taskPrompt(input);assert.match(output.prompt,/本轮处理消息：\["public_59"\]/);assert.match(output.prompt,/资料文件（本轮未读公开协作记录/);assert.doesNotMatch(output.prompt,/共享背景/);
  const records=JSON.parse(output.materials.at(-1).content);assert.equal(records.length,60);assert.equal(records.at(-1).content,input.messages.at(-1).content);
});
