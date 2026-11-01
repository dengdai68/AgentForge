import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { probeRuntime } from '../server/runtime/probe.mjs';
import { registerExecution } from '../server/runtime/registry.mjs';

test('fixed Runtime slots retain IDs, gate new work and preserve frozen snapshots across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'af-fixed-runtime-'));
  const options = { databasePath: join(root, 'state.sqlite'), workspaceRoot: root };
  let store = createStore(options);
  const defaults = store.listRuntimeProfiles();
  assert.equal(defaults.length, 2);
  const profile = defaults.find(item => item.provider === 'claude-code');
  store.saveRuntimeProfile({ model: 'frozen' }, profile.id);
  const worker = store.createAgent({ name: 'Worker', runtime: { profileId: profile.id } });
  const team = store.createTeam({ name: 'T', memberAgentIds: [worker.id] });
  const flow = store.createWorkflowTemplate({ name: 'F', nodes: [{ id: 'write', title: 'Write', staffingGuidance: 'Writer' }] });
  const task = store.createTask({ title: 'Frozen', objective: 'Write', teamId: team.id, workflowTemplateId: flow.id });
  const chat = store.openCommunication({ kind: 'agent', targetId: worker.id });
  store.saveRuntimeProfile({ enabled: false, model: 'next' }, profile.id);
  assert.throws(() => store.createRun(task.id), /已停用/);
  assert.throws(() => store.sendCommunication(chat.id, { content: 'Question', clientRequestId: randomUUID() }), /已停用/);
  assert.throws(() => store.assertRuntimeEnabled(worker.runtime), /已停用/);
  assert.equal(store.getTask(task.id).memberSnapshots[0].runtime.model, 'frozen');
  assert.equal(store.listAgents().find(item => item.id === worker.id).runtime.model, 'next');
  const before = store.snapshot();
  assert.throws(() => store.transaction(() => { store.saveRuntimeProfile({ enabled: true }, profile.id); throw new Error('rollback'); }), /rollback/);
  assert.deepEqual(store.snapshot(), before);
  for (const input of [{ name: 'named' }, { provider: 'codex' }, { executable: '/custom' }, { profile: 'local' }, {}, {enabled:'yes'}, {model:null}, {effort:null}]) assert.throws(() => store.saveRuntimeProfile(input, profile.id));
  assert.throws(() => store.saveRuntimeProfile({ model: 'new' }), /固定/);
  store.close(); store = createStore(options);
  assert.deepEqual(store.listRuntimeProfiles().map(item => item.id), defaults.map(item => item.id));
  assert.equal(store.listRuntimeProfiles().find(item => item.id === profile.id).enabled, false);
  store.saveRuntimeProfile({ enabled: true }, profile.id);
  assert.doesNotThrow(() => store.assertRuntimeEnabled(worker.runtime));
  assert.ok(store.createRun(task.id));
  assert.ok(store.sendCommunication(chat.id, { content: 'Question', clientRequestId: randomUUID() }));
  assert.equal(store.listRuntimeProfiles().length, 2);
  store.close();
});

test('central runtime edits update bound employees but preserve queued work and survive restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentforge-profiles-'));
  const options = { databasePath: join(root, 'state.sqlite'), workspaceRoot: root };
  let store = createStore(options);
  const profile = store.saveRuntimeProfile({ model: 'test-model' }, store.listRuntimeProfiles().find(item => item.provider === 'claude-code').id);
  const a = store.createAgent({ name: 'A', role: 'writer', runtime: { profileId: profile.id } });
  const b = store.createAgent({ name: 'B', role: 'writer', runtime: { profileId: profile.id, skillPaths: [join(root, 'skill.md')] } });
  const team = store.createTeam({ name: 'Test', memberAgentIds: [a.id, b.id] });
  const flow = store.createWorkflowTemplate({ name: 'Write', nodes: [{ id: 'write', title: 'Write', staffingGuidance: 'writer', dependsOn: [] }] });
  const task = store.createTask({ title: 'Frozen', objective: 'Write a document', teamId: team.id, workflowTemplateId: flow.id });
  store.saveRuntimeProfile({ model: 'next-model' }, profile.id);
  assert.equal(store.listAgents().find(item => item.id === a.id).runtime.model, 'next-model');
  assert.deepEqual(store.listAgents().find(item => item.id === b.id).runtime.skillPaths, [join(root, 'skill.md')]);
  assert.equal(store.getTask(task.id).memberSnapshots[0].runtime.model, 'test-model');
  assert.throws(() => store.saveRuntimeProfile({ name: 'Bad', provider: 'codex' }, profile.id), /仅接受/);
  assert.throws(() => store.saveRuntimeProfile({ name: 'Bad', token: 'secret' }), /仅接受/);
  assert.throws(() => store.saveRuntimeProfile({ name: 'Changed', provider: 'claude-code' }), /仅接受/);
  assert.throws(() => store.createAgent({ name: 'Bad', role: 'writer', runtime: { profileId: 'missing' } }), /不存在/);
  const expected = store.listRuntimeProfiles(); store = createStore(options);
  assert.deepEqual(store.listRuntimeProfiles(), expected);
  assert.equal(store.listAgents().find(item => item.id === a.id).runtime.profileId, profile.id);
  assert.equal(store.getTask(task.id).memberSnapshots[0].runtime.model, 'test-model');
});

test('Store only exposes the two fixed provider slots when internal employees are bound', () => {
  const store = createStore();
  for (const provider of ['claude-code', 'codex']) store.createAgent({ name: provider, runtime: { provider } });
  assert.equal(store.listRuntimeProfiles().length, 2);
  assert.ok(store.listRuntimeProfiles().every(item => !Object.hasOwn(item, 'name') && !Object.hasOwn(item, 'executable')));
  store.close();
});

test('runtime probe checks structured response, isolates extensions, and exposes only result/path', async () => {
  const profile = { id: 'probe', provider: 'claude-code', model: 'test' };
  const success = await probeRuntime(profile, { invoke: async input => {
    assert.deepEqual(input.runtime.extensionSelection, { pluginIds: [], mcpIds: [] });
    assert.equal(input.session, undefined);
    assert.equal(JSON.parse(await readFile(input.schemaPath)).additionalProperties, false);
    return { finalText: '{"status":"ok"}' };
  } });
  assert.equal(success.ok, true); assert.match(success.logPath, /\.jsonl$/);
  const invalid = await probeRuntime(profile, { invoke: async () => ({ finalText: 'model says done' }) });
  assert.equal(invalid.ok, false); assert.equal(invalid.error, undefined);
  const missing = await probeRuntime({ ...profile, executable: '/agentforge-test-missing-cli' });
  assert.equal(missing.ok, false);
  assert.match(await readFile(missing.logPath, 'utf8'), /provider.spawn_error/);
  const codexMissing = await probeRuntime({ ...profile, provider: 'codex', executable: '/agentforge-test-missing-codex' });
  assert.equal(codexMissing.ok, false);
  assert.match(await readFile(codexMissing.logPath, 'utf8'), /provider.configuration_probe_failed/);
});

test('new communication uses changed profile and resets the model session, queued delivery keeps its snapshot', () => {
  const store = createStore();
  const employee = store.listAgents().find(item => item.id === 'agent_analyst');
  const thread = store.openCommunication({ kind: 'agent', targetId: employee.id });
  const send = () => store.sendCommunication(thread.id, { content: 'hello', clientRequestId: randomUUID(), mentionAgentIds: [] });
  send();
  const first = store.claimCommunication(thread.id);
  const session = store.prepareCommunicationSession(thread.id, first.id, '/tmp/probe-chat');
  store.confirmCommunicationSession(thread.id, first.id, session.sessionId);
  store.completeCommunication(thread.id, first.id, 'reply');
  send();
  const profile = store.listRuntimeProfiles().find(item => item.id === employee.runtime.profileId);
  const { id, employeeCount, system, ...input } = profile;
  store.saveRuntimeProfile({ model: 'changed-model' }, id);
  const queued = store.claimCommunication(thread.id);
  assert.equal(queued.agentSnapshot.runtime.model, employee.runtime.model);
  assert.equal(store.prepareCommunicationSession(thread.id, queued.id, '/tmp/probe-chat').resume, true);
  store.completeCommunication(thread.id, queued.id, 'reply');
  send();
  const next = store.claimCommunication(thread.id);
  assert.equal(next.agentSnapshot.runtime.model, 'changed-model');
  const fresh = store.prepareCommunicationSession(thread.id, next.id, '/tmp/probe-chat');
  assert.equal(fresh.resume, false); assert.notEqual(fresh.sessionId, session.sessionId);
});

test('runtime probe deadline terminates only its own invocation and never reports late success', async () => {
  let terminated = false;
  const result = await probeRuntime({ id: 'timeout', provider: 'claude-code' }, { timeoutMs: 10, invoke: input => new Promise(resolve => {
    const unregister = registerExecution(input.executionKey, { terminate() { terminated = true; unregister(); resolve({ finalText: '{"status":"ok"}' }); } });
  }) });
  assert.equal(terminated, true); assert.equal(result.ok, false); assert.equal(result.timedOut, true);
});

test('runtime effort is validated per provider, reprojected to employees and frozen in existing work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'af-profile-effort-'));
  const options = { databasePath: join(root, 'state.sqlite'), workspaceRoot: root };
  let store = createStore(options);
  const claude = store.saveRuntimeProfile({ model: 'sonnet', effort: 'high' }, store.listRuntimeProfiles().find(item => item.provider === 'claude-code').id);
  assert.equal(claude.effort, 'high');
  const codex = store.saveRuntimeProfile({ effort: 'ultra' }, store.listRuntimeProfiles().find(item => item.provider === 'codex').id);
  assert.equal(codex.effort, 'ultra');
  for (const [input, pattern] of [
    [{ effort: 'ultra' }, /思考等级/],
    [{ effort: 'nonsense' }, /思考等级/],
    [{ effort: 'high\nrm' }, /单行/],
    [{ effort: 'high', token: 'x' }, /仅接受/]
  ]) assert.throws(() => store.saveRuntimeProfile(input, claude.id), pattern);
  const worker = store.createAgent({ name: 'W', runtime: { profileId: claude.id } });
  assert.equal(store.listAgents().find(item => item.id === worker.id).runtime.effort, 'high');
  const team = store.createTeam({ name: 'T', memberAgentIds: [worker.id] });
  const flow = store.createWorkflowTemplate({ name: 'F', nodes: [{ id: 'write', title: 'Write', staffingGuidance: 'Writer' }] });
  const task = store.createTask({ title: 'Frozen', objective: 'Write', teamId: team.id, workflowTemplateId: flow.id });
  store.saveRuntimeProfile({ model: 'opus', effort: 'max' }, claude.id);
  assert.equal(store.listAgents().find(item => item.id === worker.id).runtime.effort, 'max', 'profile edit reprojects effort to bound employees');
  assert.equal(store.getTask(task.id).memberSnapshots[0].runtime.effort, 'high', 'frozen task snapshot keeps the previous effort');
  assert.throws(() => store.saveRuntimeProfile({ effort: 'ultra' }, claude.id), /思考等级/);
  const cleared = store.saveRuntimeProfile({ effort: '' }, claude.id);
  assert.equal(cleared.effort, '');
  store.saveRuntimeProfile({ effort: 'low' }, claude.id);
  store.close(); store = createStore(options);
  assert.equal(store.listRuntimeProfiles().find(item => item.id === claude.id).effort, 'low', 'effort survives restart');
  assert.equal(store.listRuntimeProfiles().find(item => item.id === codex.id).effort, 'ultra');
  store.close();
});

test('runtime probe passes the saved model and effort to the real invocation', async () => {
  const seen = [];
  const result = await probeRuntime({ id: 'effort-probe', provider: 'codex', model: 'gpt-real', effort: 'high' }, { invoke: async input => {
    seen.push(input.runtime);
    return { finalText: '{"status":"ok"}' };
  } });
  assert.equal(result.ok, true);
  assert.equal(seen[0].model, 'gpt-real');
  assert.equal(seen[0].effort, 'high');
});
