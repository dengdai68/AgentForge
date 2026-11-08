import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createStore } from '../server/store.mjs';
import { createSqlitePersistence } from '../server/persistence.mjs';
import { createFixtureStore } from './fixture-store.mjs';

const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'af-catalog-contract-')); return { databasePath: join(root, 'state.sqlite'), workspaceRoot: root }; };

test('independent instances share a workspace root without same-millisecond task directory collisions', t => {
  const root = mkdtempSync(join(tmpdir(), 'af-shared-workspace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = `import {createCatalogFixtureStore} from './tests/fixture-store.mjs';
    Date.now=()=>1700000000000;
    const store=createCatalogFixtureStore({workspaceRoot:${JSON.stringify(root)},databasePath:${JSON.stringify(root)}+'/instance-'+process.pid+'.sqlite'});
    const task=store.createTask({managerAgentId:'system_project_manager',title:'Independent task',objective:'Isolated path proof',memberAgentIds: store.listTeams()[0].memberAgentIds,workflowTemplateId:'software_delivery'});
    console.log(JSON.stringify({id:task.id,path:task.workspacePath}));store.close();`;
  const launch = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const a = launch(), b = launch();
  assert.match(a.id, /^task_[a-f0-9-]{36}$/);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.path, b.path);
  assert.equal(a.path, join(root, a.id)); assert.equal(b.path, join(root, b.id));
});

test('fresh catalogs are minimal, all examples can be deleted and stay deleted after restart', () => {
  const options = fixture(); let store = createStore(options);
  assert.equal(store.listAgents().length, 3);
  assert.equal(store.listWorkflowTemplates().length, 1);
  assert.deepEqual(store.listTeams(), []); assert.deepEqual(store.listTasks(), []); assert.deepEqual(store.listRuns(), []);
  for (const item of store.listAgents()) {
    assert.equal(Object.hasOwn(item, 'role'), false);
    store.updateAgent(item.id, { name: item.name + ' edited', status: 'inactive' });
    store.deleteAgent(item.id);
  }
  for (const item of store.listWorkflowTemplates()) store.deleteWorkflowTemplate(item.id);
  const runtimeIds = store.listRuntimeProfiles().map(item => item.id);
  assert.equal(store.snapshot().events.filter(item => item.type === 'configuration.agent_deleted').length, 3);
  store.close(); store = createStore(options);
  assert.deepEqual(store.listAgents(), []); assert.deepEqual(store.listTeams(), []);
  assert.deepEqual(store.listWorkflowTemplates(), []); assert.deepEqual(store.listRuntimeProfiles().map(item => item.id), runtimeIds);
  const worker = store.createAgent({ name: 'New worker' });
  assert.deepEqual(store.createTeam({ name: 'No manager', memberAgentIds: [worker.id] }).memberAgentIds, [worker.id]);
  const manager = store.createAgent({ name: 'New manager', kind: 'manager' });
  assert.deepEqual(store.createTeam({ name: 'New team', memberAgentIds: [worker.id, manager.id] }).memberAgentIds, [worker.id, manager.id]);
  store.close();
});

test('employee deletion hides current membership and retains frozen tasks, messages and in-flight execution', () => {
  const store = createFixtureStore(), team = store.listTeams()[0], task = store.listTasks()[0], run = store.createRun(task.id);
  store.updateRun(run.id,{status:'running'}); const beforeRun = store.getRun(run.id);
  const chat = store.openCommunication({kind:'group',name:'Independent group',memberAgentIds:team.memberAgentIds});
  const msg = store.sendCommunication(chat.id,{content:'Keep the public history',mentionAgentIds:['agent_analyst'],clientRequestId:'delete-history-case'});
  const claimed = store.claimCommunication(chat.id); store.completeCommunication(chat.id,claimed.id,'Historical analyst reply');
  const taskBefore = store.getTask(task.id);
  store.deleteAgent('agent_analyst');
  assert.ok(!store.listAgents().some(row=>row.id==='agent_analyst'));
  assert.equal(store.snapshot().agents.find(row=>row.id==='agent_analyst').status,'deleted');
  assert.ok(!store.listTeams()[0].memberAgentIds.includes('agent_analyst'));
  assert.ok(!store.getCommunication(chat.id).conversation.members.some(row=>row.id==='agent_analyst'));
  assert.equal(store.getCommunication(chat.id).messages.at(-1).content,'Historical analyst reply');
  assert.equal(store.getCommunication(chat.id).messages[0].id,msg.id);
  assert.deepEqual(store.getTask(task.id),taskBefore); assert.deepEqual(store.getRun(run.id),beforeRun);
  assert.ok(store.getRunAgent(run.id,'agent_analyst'));
  assert.ok(store.getRunWorkspace(run.id).deletedAgentIds.includes('agent_analyst'));
  assert.throws(()=>store.updateAgent('agent_analyst',{name:'Resurrect'}),/已删除/);
  assert.throws(()=>store.createTask({managerAgentId:'system_project_manager',title:'New',objective:'No deleted member',memberAgentIds:taskBefore.memberAgentIds,workflowTemplateId:taskBefore.workflowTemplateId}),/已删除/);
  store.deleteTeam(team.id); assert.deepEqual(store.getTask(task.id),taskBefore);
  assert.equal(store.getCommunication(chat.id).conversation.members.length,team.memberAgentIds.length-1);
  assert.throws(()=>store.deleteWorkflowTemplate(task.workflowTemplateId),/冻结快照引用/);
  store.close();
});

test('tasks own an explicit unique roster with exactly one manager, teams need none', () => {
  const store=createStore({workspaceRoot:tmpdir()}),[manager,writer]=store.listAgents();
  const team=store.createTeam({name:'No manager',memberAgentIds:[writer.id]});
  const base={managerAgentId:manager.id,title:'Task',objective:'Independent staff',workflowTemplateId:store.listWorkflowTemplates()[0].id};
  for (const ids of [[],[writer.id],[manager.id,manager.id],['missing',manager.id]]) assert.throws(()=>store.createTask({...base,memberAgentIds:ids}));
  const other=store.createAgent({name:'Another manager',kind:'manager'});
  assert.equal(store.createTask({...base,memberAgentIds:[manager.id,other.id,writer.id]}).managerAgentId,manager.id);
  assert.throws(()=>store.createTask({...base,teamId:team.id}),/不再绑定/);
  assert.throws(()=>store.createTeam({name:'Old protocol',memberAgentIds:[writer.id],managerAgentId:manager.id}),/不再指定/);
  const task=store.createTask({...base,memberAgentIds:[manager.id,writer.id]});
  assert.equal(Object.hasOwn(task,'teamId'),false);assert.equal(store.getBootstrap().tasks[0].team,undefined);
  store.updateTeam(team.id,{memberAgentIds:[],name:'Empty pool'});store.deleteTeam(team.id);
  assert.equal(store.createRun(task.id).manager.sourceAgentId,manager.id);
  store.close();
});

test('failed persistence rolls back catalog removal and its audit atomically', () => {
  const options = fixture(), store = createStore(options), database = new DatabaseSync(options.databasePath);
  const team = store.createTeam({ name: 'Disposable', memberAgentIds: [store.listAgents()[0].id] });
  const before = store.snapshot();
  database.exec("CREATE TRIGGER reject_catalog BEFORE UPDATE ON workspace_snapshots BEGIN SELECT RAISE(ABORT,'catalog save rejected'); END;");
  for (const command of [() => store.deleteTeam(team.id), () => store.deleteAgent(store.listAgents()[1].id), () => store.deleteWorkflowTemplate(store.listWorkflowTemplates()[0].id), () => store.saveRuntimeProfile({enabled:false},store.listRuntimeProfiles().find(item => item.provider === 'codex').id)]) {
    assert.throws(command, /catalog save rejected/); assert.deepEqual(store.snapshot(), before);
  }
  database.exec('DROP TRIGGER reject_catalog'); store.deleteTeam(team.id);
  database.close(); store.close();
});

test('role migration changes only current employees, never frozen Task/Run or communication snapshots', () => {
  const options = fixture(), fixtureStore = createFixtureStore(options), task = fixtureStore.listTasks()[0], run = fixtureStore.createRun(task.id);
  const chat = fixtureStore.openCommunication({ kind: 'agent', targetId: 'agent_analyst' });
  fixtureStore.sendCommunication(chat.id, { content: 'Queued frozen input', clientRequestId: 'legacy-snapshot' });
  const state = fixtureStore.snapshot(); fixtureStore.close();
  state.agents[0].role = 'Legacy current label';
  state.tasks[0].memberSnapshots[0].role = 'Historical task label';
  state.runs[0].participants[0].role = 'Historical run label';
  state.communicationDeliveries[0].agentSnapshot.role = 'Historical queued label';
  const taskSnapshot = structuredClone(state.tasks[0]), runSnapshot = structuredClone(state.runs[0]);
  const persistence = createSqlitePersistence(options.databasePath); persistence.save(state); persistence.close();
  const store = createStore(options);
  assert.ok(store.listAgents().every(item => !Object.hasOwn(item, 'role')));
  assert.deepEqual(store.getTask(task.id), taskSnapshot); assert.deepEqual(store.getRun(run.id), runSnapshot);
  assert.deepEqual(store.snapshot().communicationDeliveries, state.communicationDeliveries);
  const worker = store.createAgent({ name: 'No label', role: 'ignored legacy input', description: 'Evidence-based editor' });
  assert.equal(Object.hasOwn(worker, 'role'), false);
  store.updateAgent(worker.id, { role: 'still ignored' });
  assert.equal(Object.hasOwn(store.listAgents().find(item => item.id === worker.id), 'role'), false);
  store.close();
});

test('current workflow writes reject obsolete staffing/repository parameters without mutation', () => {
  const store = createStore(fixture());
  const definition = {name:'Current workflow',nodes:[{id:'write',title:'Write',staffingGuidance:'An evidence-based editor'}]};
  const created = store.createWorkflowTemplate(definition);
  assert.ok(!Object.hasOwn(created.nodes[0], 'repositoryPath'));
  const before = store.snapshot();
  for (const key of ['ownerRole','repositoryPath','reuseOwnerFrom']) {
    const invalid = {...definition,nodes:[{...definition.nodes[0],[key]:'unsupported'}]};
    assert.throws(() => store.createWorkflowTemplate(invalid), /不接受/);
    assert.throws(() => store.updateWorkflowTemplate(created.id,invalid), /不接受/);
  }
  assert.deepEqual(store.snapshot(),before);
  store.updateWorkflowTemplate(created.id,{...definition,description:'Updated current definition'});
  assert.equal(store.listWorkflowTemplates().find(item=>item.id===created.id).description,'Updated current definition');
  store.close();
});


test('task team selection merges active employees once and freezes independent members', t => {
  const options = fixture(); t.after(() => rmSync(options.workspaceRoot, { recursive: true, force: true }));
  const store = createStore(options); t.after(() => store.close());
  const manager = store.createAgent({name:'经理',kind:'manager'}), otherManager = store.createAgent({name:'另一经理',kind:'manager'});
  const worker = store.createAgent({name:'员工'}), inactive = store.createAgent({name:'停用员工',status:'inactive'});
  const team = store.createTeam({name:'团队',memberAgentIds:[manager.id,worker.id,inactive.id]});
  const overlap = store.createTeam({name:'重叠团队',memberAgentIds:[worker.id]});
  const flow = store.createWorkflowTemplate({name:'流程',nodes:[{id:'work',title:'工作',staffingGuidance:'可用员工'}]});
  const input = {managerAgentId:manager.id,title:'任务',objective:'验证独立成员',teamIds:[team.id,overlap.id],memberAgentIds:[worker.id],workflowTemplateId:flow.id,acceptanceCriteria:[]};
  const task = store.createTask(input);
  assert.deepEqual(task.memberAgentIds,[worker.id,manager.id]); assert.deepEqual(task.acceptanceCriteria,[]); assert.equal(Object.hasOwn(task,'priority'),false);
  assert.equal(task.teamIds,undefined); assert.equal(task.teamId,undefined);
  assert.throws(()=>store.createTask({...input,teamIds:[team.id,team.id]}),/teamIds/);
  assert.throws(()=>store.createTask({...input,teamIds:null}),/teamIds/);
  assert.throws(()=>store.createTask({...input,memberAgentIds:[inactive.id]}),/停用/);
  assert.ok(store.createTask({...input,memberAgentIds:[otherManager.id]}).memberAgentIds.includes(otherManager.id));
  assert.throws(()=>store.createTask({...input,managerAgentId:inactive.id}),/所选员工/);
  assert.throws(()=>store.createTask({...input,teamIds:['missing']}),/团队/);
  assert.throws(()=>store.createTask({...input,priority:'invalid'}),/优先级/);
  store.updateTeam(team.id,{status:'inactive'});
  assert.throws(()=>store.createTask(input),/可用的团队/);
  store.deleteTeam(team.id);
  assert.deepEqual(store.listTasks().find(item=>item.id===task.id).memberAgentIds,[worker.id,manager.id]);
});


test('saved task drafts persist without execution and start explicitly exactly once', t => {
  const options = fixture();
  t.after(() => rmSync(options.workspaceRoot, {recursive:true,force:true}));
  let store = createStore(options);
  try {
    const manager = store.createAgent({name:'草稿经理',kind:'manager'});
    const task = store.createTask({managerAgentId:manager.id,title:'持久化草稿',objective:'只在显式启动后执行',memberAgentIds:[manager.id]});
    assert.equal(task.status,'backlog');
    assert.equal(store.listRuns().length,0);
    assert.equal(existsSync(task.workspacePath),false);
    store.close(); store = createStore(options);
    assert.equal(store.listTasks().find(item=>item.id===task.id).status,'backlog');
    assert.equal(store.listRuns().length,0);
    const run = store.createRun(task.id);
    assert.equal(run.taskId,task.id);
    assert.equal(store.listTasks().find(item=>item.id===task.id).status,'running');
    assert.throws(()=>store.createRun(task.id),/不能启动/);
    assert.equal(store.listRuns().length,1);
  } finally { store.close(); }
});

test('any selected employee can coordinate a task without changing global kind; snapshots and role survive catalog edits',()=>{
 const store=createStore({workspaceRoot:tmpdir()});
 try{
  const architect=store.createAgent({name:'架构师',systemPrompt:'负责设计'}),developer=store.createAgent({name:'开发',systemPrompt:'实现功能'}),tester=store.createAgent({name:'测试',kind:'manager'});
  const input={title:'任务身份',objective:'按本次指定角色协作',memberAgentIds:[architect.id,developer.id,tester.id],managerAgentId:architect.id};
  for(const managerAgentId of [undefined,null,[], 'missing'])assert.throws(()=>store.createTask({...input,managerAgentId}),/请选择/);
  const task=store.createTask(input);assert.equal(task.managerSnapshot.kind,'business');assert.deepEqual(task.memberSnapshots.map(a=>a.id),[developer.id,tester.id]);
  store.updateAgent(architect.id,{name:'新名字',systemPrompt:'新职责'});const run=store.createRun(task.id);assert.equal(run.manager.sourceAgentId,architect.id);assert.equal(run.manager.name,'架构师');assert.equal(run.manager.systemPrompt,'负责设计');
  assert.equal(store.listAgents().find(a=>a.id===architect.id).kind,'business');
  const reverse=store.createTask({...input,managerAgentId:developer.id});assert.equal(reverse.managerSnapshot.id,developer.id);
  const extra=store.createAgent({name:'另一个员工',kind:'manager'});assert.doesNotThrow(()=>store.updateRunMembers(run.id,{memberAgentIds:[architect.id,developer.id,tester.id,extra.id]}));
  assert.throws(()=>store.updateRunMembers(run.id,{memberAgentIds:[developer.id,tester.id]}),/保留当前项目经理/);
 }finally{store.close();}
});
