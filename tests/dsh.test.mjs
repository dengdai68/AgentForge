import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStore } from '../server/store.mjs';
import { runDshCli, executionContent, RuntimeCancelledError, RuntimeSessionMissingError } from '../server/runtime/local-cli.mjs';
import { normalizeDshEvent, DSH_EFFORT_LEVELS } from '../server/runtime/dsh.mjs';
import { hasActiveExecution, terminateExecution } from '../server/runtime/registry.mjs';
import { RUNTIME_EFFORT_LEVELS } from '../web/settings.mjs';

const fixture = `#!/usr/bin/env node
const fs=require('node:fs'),readline=require('node:readline'),path=require('node:path');
const rows=JSON.parse(fs.readFileSync(process.argv.at(-1),'utf8'));
const mode=fs.readFileSync(path.join(process.cwd(),'mode'),'utf8');
const instructions=JSON.parse(fs.readFileSync(rows.at(-1).insert.at(-1).config.instructionsPath,'utf8'));
if(!instructions.systemPrompt.includes('{{literal}}'))process.exit(8);
if(rows.find(r=>r.id==='skill-filesystem').config.includeDefaultRoots!==false)process.exit(9);
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n');
const event=(id,type,data)=>send({method:'session.event',params:{sessionId:id,event:{type,data}}});
send({method:'agentforge.ready',params:{version:1,models:[{id:'deepseek-official/test'}]}});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line),reply=result=>send({id:m.id,result});
 if(m.method==='initialize'){fs.writeFileSync('handshake.json',JSON.stringify({...m.params,nativeHome:process.env.DSH_HOME}));reply({serverInfo:{name:mode==='identity'?'wrong-runtime':'deepseek-harness-sdk-runtime'}});}
 else if(m.method==='session/resume'){if(mode==='missing')send({id:m.id,error:{code:-1,message:'Session not found'}});else reply({});}
 else if(m.method==='session/prompt'){fs.writeFileSync('prompt.json',JSON.stringify(m.params));reply({messageId:'message'});event(m.params.sessionId,'assistant/message',{message:{content:[{type:'text',text:'{"phase":"first"}'}]}});event(m.params.sessionId,'turn/end',{reason:{kind:'completed'}});}
 else if(m.method==='session/wait'){
  if(mode==='cancel')return;
  setTimeout(()=>{event(m.params.sessionId,'assistant/message',{message:{content:[{type:'text',text:mode==='invalid'?'not JSON':'{"phase":"final"}'}]}});event(m.params.sessionId,'turn/end',{reason:{kind:mode==='max'?'max-tokens':'completed'}});reply({});},50);
 } else if(m.method==='shutdown'){reply({});process.exit(0);}
});
`;

async function setup(t, mode = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'agentforge-dsh-test-'));
  const previous = process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT;
  process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT = join(root, 'config');
  const executable = join(root, 'dsh'); await writeFile(executable, fixture, { mode: 0o700 });
  await writeFile(join(root, 'mode'), mode);
  const directory = join(root, 'trace'); await mkdir(directory);
  t.after(async () => { if (previous === undefined) delete process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT; else process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT = previous; await rm(root, { recursive: true, force: true }); });
  return { root, input: { runtime: { provider: 'dsh', executable, model: 'deepseek-official/test', effort: 'off' }, workspacePath: root, traceDirectory: directory, finalPath: join(directory, 'result.json'), outputSchema: { type: 'object' }, prompt: 'current user input only', systemPrompt: 'application instruction {{literal}}', session: { sessionId: randomUUID(), resume: false }, runId: randomUUID(), idleTimeoutMs: 10000, onEvent: async () => {} } };
}

test('DeepSeek Harness has a fixed slot, its own effort vocabulary and frozen role/model facts', () => {
  const store = createStore({ workspaceRoot: join(tmpdir(), 'dsh-frozen-' + randomUUID()) });
  try {
    const slot = store.listRuntimeProfiles().find(profile => profile.provider === 'dsh'); assert.ok(slot);
    assert.deepEqual(DSH_EFFORT_LEVELS, RUNTIME_EFFORT_LEVELS.dsh);
    store.saveRuntimeProfile({ model: 'deepseek-official/deepseek-flash', effort: 'off' }, slot.id);
    const role = store.createRole({ name: 'DeepSeek Harness role', prompt: 'shared role instructions' });
    const worker = store.createAgent({ name: 'DeepSeek Harness worker', roleIds: [role.id], runtime: { profileId: slot.id } });
    const team = store.createTeam({ name: 'DeepSeek Harness team', memberAgentIds: [worker.id] });
    const flow = store.createWorkflowTemplate({ name: 'DeepSeek Harness flow', nodes: [{ id: 'write', title: 'Write', staffingGuidance: 'writer' }] });
    const task = store.createTask({ title: 'DeepSeek Harness task', objective: 'Write', teamId: team.id, workflowTemplateId: flow.id });
    store.saveRuntimeProfile({ model: 'next', effort: 'high', enabled: false }, slot.id);
    assert.equal(store.getTask(task.id).memberSnapshots[0].runtime.effort, 'off');
    assert.equal(store.getTask(task.id).memberSnapshots[0].roleSnapshots[0].prompt, 'shared role instructions');
    assert.throws(() => store.createRun(task.id), /DeepSeek Harness Runtime 已停用/);
    assert.throws(() => store.saveRuntimeProfile({ effort: 'medium' }, slot.id), /思考等级/);
    assert.throws(() => store.saveRuntimeProfile({ executable: 'another' }, slot.id), /仅接受/);
  } finally { store.close(); }
});

test('DeepSeek Harness public projection preserves reasoning and tool pairing, never system/user replay', () => {
  for (const type of ['system/message', 'user/message', 'request/header']) assert.deepEqual(normalizeDshEvent({ type, data: { secret: 'PRIVATE' } }, executionContent), []);
  const applied=normalizeDshEvent({type:'system/message',data:{message:{content:[{type:'text',text:'native prefix\nprivate instructions'}]}}},executionContent,'','private instructions');
  assert.equal(applied[0].data.systemPromptApplied,true); assert.equal(applied[0].content,undefined);
  assert.deepEqual(normalizeDshEvent({type:'system/message',data:{message:{content:[{type:'text',text:'different instructions'}]}}},executionContent,'','private instructions'),[]);
  const blocks = normalizeDshEvent({ type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'public reasoning' }, { type: 'text', text: 'visible reply' }] } } }, executionContent);
  assert.equal(blocks[0].data.presentation, 'thinking'); assert.equal(blocks[0].content.fields.thinking.text, 'public reasoning');
  assert.equal(blocks[1].content.fields.text.text, 'visible reply');
  const call = normalizeDshEvent({ type: 'tool/call', data: { callId: 'call-1', name: 'bash', arguments: '{"command":"true"}' } }, executionContent)[0];
  const result = normalizeDshEvent({ type: 'tool/result', data: { message: { callId: 'call-1', isError: true, content: [{ type: 'text', text: 'failed' }] } } }, executionContent)[0];
  assert.equal(call.data.toolUseId, result.data.toolResultId); assert.equal(result.data.status, 'failed');
});

test('native DeepSeek Harness bridge keeps diagnostic debug off protocol stdout without changing child stdout', async t => {
  const { root } = await setup(t);
  const instructionsPath = join(root, 'instructions.json');
  await writeFile(instructionsPath, JSON.stringify({ systemPrompt: 'literal {{value}}' }));
  const code = `import {apply} from ${JSON.stringify(new URL('../server/runtime/dsh-plugin.mjs', import.meta.url).href)};
    import {execFileSync} from 'node:child_process';
    let section; await apply({systemPrompt:{section:value=>{section=value}},loader:{await:async()=>{}},llm:{listProviders:()=>[]}}, {instructionsPath:${JSON.stringify(instructionsPath)}});
    console.debug('MCP diagnostic');
    const child=execFileSync(process.execPath,['-e','console.log("tool stdout")'],{encoding:'utf8'});
    process.stdout.write(JSON.stringify({proof:{child,text:section.text,interpolate:section.interpolate}})+'\\n');`;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code]);
  assert.match(stderr, /MCP diagnostic/);
  const frames = stdout.trim().split('\n').map(line => JSON.parse(line));
  const proof = frames.find(frame => frame.proof).proof;
  assert.equal(proof.child, 'tool stdout\n'); assert.equal(proof.text, 'literal {{value}}'); assert.equal(proof.interpolate, false);
  assert.ok(frames.some(frame => frame.method === 'agentforge.ready'));
});

test('DeepSeek Harness waits for native follow-up completion and keeps instructions out of the user message', async t => {
  const { root, input } = await setup(t); const events = []; input.onEvent = async event => events.push(event);
  const result = await runDshCli(input);
  assert.equal(result.finalText, '{"phase":"final"}'); assert.equal(await readFile(input.finalPath, 'utf8'), result.finalText);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'prompt.json'), 'utf8')).contentBlocks, [{ type: 'text', text: input.prompt }]);
  assert.equal(JSON.parse(await readFile(join(root, 'handshake.json'), 'utf8')).reasoningEffort, 'off');
  assert.equal(events.find(event => event.providerEventType === 'thread.started').data.sessionId, input.session.sessionId);
  assert.equal(hasActiveExecution(input.runId), false);
});

test('DeepSeek Harness connection probes without a Store session keep native files inside their temporary Trace', async t => {
  const { root, input } = await setup(t); delete input.session;
  await runDshCli(input);
  const handshake = JSON.parse(await readFile(join(root, 'handshake.json'), 'utf8'));
  assert.equal(handshake.nativeHome, join(input.traceDirectory, 'home'));
});

test('DeepSeek Harness rejects wrong peers, non-JSON output and token-limited turns honestly', async t => {
  for (const [mode, message] of [['identity', /握手身份/], ['invalid', /有效的 JSON/], ['max', /max-tokens/]]) {
    const { input } = await setup(t, mode); await assert.rejects(runDshCli(input), message); assert.equal(hasActiveExecution(input.runId), false);
  }
});

test('DeepSeek Harness missing-session errors remain typed and never submit replacement input', async t => {
  const { root, input } = await setup(t, 'missing'); input.session.resume = true;
  await assert.rejects(runDshCli(input), RuntimeSessionMissingError);
  await assert.rejects(readFile(join(root, 'prompt.json')), { code: 'ENOENT' });
});

test('DeepSeek Harness cancellation and launch fencing release only their own execution', async t => {
  const { input } = await setup(t, 'cancel');
  let started; const ready = new Promise(resolve => { started = resolve; });
  input.onEvent = async event => { if (event.providerEventType === 'thread.started') started(); };
  const promise = runDshCli(input); await ready;
  assert.equal(terminateExecution(input.runId, 'test cancellation'), true);
  await assert.rejects(promise, RuntimeCancelledError); assert.equal(hasActiveExecution(input.runId), false);
  await assert.rejects(runDshCli({ ...input, canStart: () => false }), RuntimeCancelledError);
});
