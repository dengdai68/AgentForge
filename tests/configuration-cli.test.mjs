import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, chmod, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execute as executeCommand, run as runCommand } from '../cli/main.mjs';
import { createClient, defaultEndpointFile, readInput, resolveEndpoint } from '../cli/client.mjs';
import { collaborationRecords } from '../client/console-projections.mjs';
import { resources } from '../cli/commands.mjs';

test('employee extension help states selected-only tools without expanding the input protocol', () => {
  const selection = resources.agents.schema.properties.runtime.properties.extensionSelection;
  assert.deepEqual(Object.keys(selection.properties), ['pluginIds', 'mcpIds']);
  assert.match(selection.properties.mcpIds.description, /不继承全局 MCP 或 Codex Apps/);
  assert.match(selection.properties.mcpIds.description, /基础文件\/Shell/);
});
import { formatOutput } from '../cli/output.mjs';

test('workflow CLI documents and validates arbitrary relative delivery locations without docs defaults',async()=>{
  const {validateInput}=await import('../cli/client.mjs');
  const value={name:'媒体交付',nodes:[{id:'media',title:'制作',staffingGuidance:'媒体制作',artifactPaths:['artifacts/preparation/','reports/质检/','summary.md']}]};
  validateInput(value,resources.workflows.schema);
  for(const path of ['/absolute','../escape','a/../b','a//b','a\\b','.git/config','.agentforge/private'])assert.throws(()=>validateInput({...value,nodes:[{...value.nodes[0],artifactPaths:[path]}]},resources.workflows.schema));
  assert.match(resources.workflows.schema.properties.nodes.items.properties.artifactPaths.description,/不限定 docs/);
});

const input = value => Readable.from([typeof value === 'string' ? value : JSON.stringify(value)]);
const cookie = 'agentforge_session=' + 'a'.repeat(64);
const origin = 'http://127.0.0.1:51983', instanceId = '11111111-2222-4333-8444-555555555555';
const endpointRoot = await mkdtemp(join(tmpdir(), 'af-cli-endpoint-')), endpointFile = join(endpointRoot, 'endpoint.json');
await writeFile(endpointFile, JSON.stringify({ origin, instanceId }), { mode: 0o600 });
after(() => rm(endpointRoot, { recursive: true, force: true }));
// Resource tests use a real private discovery file. Only the verified health
// response is infrastructure; existing spies still count resource requests.
function connected(command, args, options = {}) {
  if (!args.includes('--session-file')) return command(args, options);
  const fetcher = async (url, init) => {
    if (url === origin + '/api/health') {
      assert.equal(init.headers, undefined, 'discovery never sends a session');
      assert.equal(init.redirect, 'error');
      return new Response(JSON.stringify({ service: 'agentforge-control-plane', instanceId }));
    }
    return options.fetcher(url, init);
  };
  return command([...args, '--endpoint-file', endpointFile], { ...options, fetcher });
}
const execute = (args, options) => connected(executeCommand, args, options);
const run = (args, options) => connected(runCommand, args, options);

test('storage commands share authenticated HTTP and report an accepted restart without claiming completion',async()=>{
 const f=await fixture();let calls=0,busy=false;
 const fetcher=async(url,init)=>{calls++;assert.equal(url,origin+'/api/settings/workspace');assert.equal(init.headers.Cookie,cookie);
   if(busy)return new Response(JSON.stringify({error:'仍有执行'}),{status:409});
   if(init.method==='GET')return new Response(JSON.stringify({workspaceRoot:'/work',businessRoot:'/work/records'}));
   assert.equal(init.method,'PUT');assert.deepEqual(JSON.parse(init.body),{workspaceRoot:'/new-work'});return new Response(JSON.stringify({workspaceRoot:'/new-work',restarting:true}));
 };
 const invoke=(args,value)=>execute(['storage',...args,'--session-file',f.sessionFile],{fetcher,stdin:input(value??'')});
 assert.equal((await invoke(['get'])).workspaceRoot,'/work');assert.equal((await invoke(['update','--file','-'],{workspaceRoot:'/new-work'})).restarting,true);
 busy=true;await assert.rejects(invoke(['update','--file','-'],{workspaceRoot:'/new-work'}),error=>error.status===409);
 const before=calls;await assert.rejects(invoke(['update','--file','-'],{workspaceRoot:'/new-work',businessRoot:'/override'}),error=>error.code==='USAGE');await assert.rejects(invoke(['update','--file','-'],{root:'/new-work'}),error=>error.code==='USAGE');await assert.rejects(invoke(['get','unexpected-id']),error=>error.code==='USAGE');assert.equal(calls,before);
 const text=formatOutput(['storage','update'],await execute(['storage','update','--help']),{help:true});assert.match(text,/agentforge storage update --file/);assert.doesNotMatch(text,/storage update ID/);
});

test('CLI rejects removed targets offline and never contacts a service when the client is unavailable', async () => {
  for (const target of ['web', 'desktop']) await assert.rejects(executeCommand(['agents', 'list', '--target', target], { fetcher() { assert.fail('removed option is offline'); } }), error => error.code === 'USAGE');
  const unavailable = ['agents', 'list', '--endpoint-file', join(endpointRoot, 'absent.json')];
  await assert.rejects(executeCommand(unavailable, { fetcher() { assert.fail('no fallback to Web'); } }), error => error.code === 'CLIENT_UNAVAILABLE' && error.exitCode === 5);
  let calls = 0;
  await assert.rejects(executeCommand(['auth', 'login', '--username', 'operator', '--password-stdin', '--endpoint-file', endpointFile], { stdin: input('synthetic-password'), fetcher: async (url, init) => {
    calls++; assert.equal(url, origin + '/api/health'); assert.equal(init.headers, undefined);
    return new Response(JSON.stringify({ service: 'agentforge-control-plane', instanceId: 'stale' }));
  } }), error => error.code === 'CLIENT_UNAVAILABLE');
  assert.equal(calls, 1, 'stale instance never receives credentials');
});
test('plugin CLI exposes Runtime support progressively and documents source-wide Git imports',async()=>{
  const f=await fixture(),compatibility={'claude-code':{supported:true,reasons:[]},codex:{supported:false,reasons:['Codex 适配器不支持 settings']}};
  const entry={id:'plugin_one',name:'Claude-only',description:'proof',providers:['claude-code'],compatibility,components:{skills:1,agents:0,hooks:0,commands:0}};
  const fetcher=async url=>new Response(JSON.stringify(url.endsWith('/plugin_one')?entry:{plugins:[entry],total:1,page:1,pageSize:20,totalPages:1,hasMore:false}));
  const listed=await captured(['plugins','list','--session-file',f.sessionFile],{fetcher});
  assert.match(listed.stdout,/Runtime/);assert.match(listed.stdout,/Claude Code/);assert.doesNotMatch(listed.stdout,/settings/);
  const detail=await captured(['plugins','get',entry.id,'--session-file',f.sessionFile],{fetcher});assert.match(detail.stdout,/不兼容原因/);assert.match(detail.stdout,/settings/);
  const json=await captured(['plugins','get',entry.id,'--session-file',f.sessionFile,'--json'],{fetcher});assert.deepEqual(JSON.parse(json.stdout).data.compatibility,compatibility);
  const help=await captured(['plugins','import','--help']);assert.match(help.stdout,/全部插件/);assert.match(help.stdout,/github\/url\/git-subdir/);assert.match(help.stdout,/npm\/archive\/command/);
  assert.match(help.stdout,/链接安装为普通文件/);assert.match(help.stdout,/来源外链接/);assert.match(help.stdout,/整批回滚/);
  assert.match(help.stdout.replace(/\s+/g,''),/模型别名.*继承目标模型/);assert.match(help.stdout.replace(/\s+/g,''),/相对文件与行列/);
  assert.deepEqual(Object.keys(resources.plugins.schema.properties),['url','path'],'compatibility is automatic, without new conversion flags');
});
test('all task commands progressively disclose their own data and compact related references in text and JSON', async () => {
  const f = await fixture(), marker = 'INTERNAL_EMPLOYEE_PROMPT_MUST_NOT_EXPAND';
  const employee = { id: 'agent_one', name: '作者', systemPrompt: marker, runtime: { profileId: 'runtime_one', extensions: marker } };
  const manager = { ...employee, id: 'manager_one', name: '经理' };
  const task = { id: 'task_one', title: '简报任务', objective: '完整用户目标', acceptanceCriteria: ['核对真实产物'], status: 'awaiting_human', priority: 'medium', memberAgentIds: [employee.id, manager.id], team: { id: 'team_one', name: '内容组', members: [employee], secretInternal: marker }, memberSnapshots: [employee], managerAgentId: manager.id, managerSnapshot: manager, managerRuntime: { profileId: 'runtime_one', internal: marker }, workflowTemplateId: 'flow_one', workflowSnapshot: { id: 'flow_one', name: '写作流程', nodes: [{ id: 'write', title: '撰写', deliverable: marker }] }, repositoryBindings: { internal: marker }, futureNestedField: marker };
  const question = { id: 'question_one', content: '报告使用什么标题？', questionType: '标题', recipient: { id: 'human_operator', name: '你', type: 'human' }, sender: manager, consideredMemberIds: [marker], routingReason: marker, createdAt: '2026-10-23T00:00:00Z' };
  const run = { id: 'run_one', taskId: task.id, status: 'awaiting_human', task, manager, participants: [employee, manager], currentFocus: { nodeId: 'write', reason: marker }, deliveryReview: { verdict: 'pass', findings: [marker] }, summary: marker };
  const workspace = { run, pendingQuestions: [question], traces: [], dispatches: [], messages: [{ ...question, sender: { id: manager.id, name: manager.name, type: 'agent' } }], artifacts: [{ id: 'artifact_one', name: 'docs/report.md', sha256: 'abc' }], events: [] };
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Cookie, cookie);
    const path = url.slice(origin.length);
    const value = options.method === 'GET' ? taskReadResponse(url,{tasks:[task],runs:[run],workspace}) : path === '/api/tasks' ? options.method === 'POST' ? { task } : { tasks: [task] } : path.endsWith('/run') ? { run } : path.endsWith('/messages') ? { message: { id: 'message_one', content: marker, recipient: manager, kind: 'instruction' }, run, queued: true, resumed: false } : workspace;
    return new Response(JSON.stringify(value));
  };
  const args = operation => ['tasks', operation, ...(['list', 'create'].includes(operation) ? [] : [task.id]), '--session-file', f.sessionFile];
  const invoke = (operation, value) => execute([...args(operation), ...(value ? ['--file', '-'] : [])], { fetcher, stdin: input(value ?? '') });
  const detail = await invoke('get');
  assert.equal(detail.team, undefined);assert.deepEqual(detail.members,[{id:employee.id,name:employee.name},{id:manager.id,name:manager.name}]);
  assert.deepEqual(detail.workflow, { id: 'flow_one', name: '写作流程' });
  assert.deepEqual(detail.manager, { id: manager.id, name: manager.name });
  assert.equal(detail.objective, task.objective); assert.deepEqual(detail.acceptanceCriteria, task.acceptanceCriteria);
  for (const operation of ['get', 'list', 'progress', 'create', 'start', 'message', 'reply', 'questions']) {
    const value = operation === 'create' ? {managerAgentId:'system_project_manager', title: task.title, objective: task.objective, memberAgentIds: task.memberAgentIds, workflowTemplateId: task.workflowTemplateId } : operation === 'message' ? { content: '追加资料', recipientAgentId: manager.id } : operation === 'reply' ? { content: '标题采用知识简报', replyToMessageId: question.id } : undefined;
    const result = await invoke(operation, value);
    assert.ok(!JSON.stringify(result).includes(marker), operation);
    assert.ok(!JSON.stringify(result).includes('memberSnapshots'), operation);
    if (operation === 'create') assert.deepEqual(Object.keys(result.task), ['id', 'title', 'status']);
    if (operation === 'start') assert.deepEqual(result.run, { id: run.id, taskId: task.id, status: run.status });
    if (operation === 'message') { assert.equal(result.queued, true); assert.equal(result.resumed, false); }
    if (operation === 'progress') { assert.equal('openDefects' in result, false); assert.deepEqual(result.pendingQuestions, [{ id: question.id, name: '标题' }]); assert.deepEqual(result.participants[0], { id: employee.id, name: employee.name }); }
    if (operation === 'questions') assert.equal(result.items[0].content, question.content);
  }
  const defaultMessage = await invoke('message', { content: '没有指定接收人，交给项目经理' });
  assert.equal(defaultMessage.message.recipient.id, manager.id);
  assert.deepEqual(resources.tasks.operationInputs.message.schema.required, ['content']);
  const text = await captured(args('get'), { fetcher });
  assert.doesNotMatch(text.stdout,/agentforge teams get/); assert.match(text.stdout, /agentforge workflows get flow_one/); assert.match(text.stdout, /agentforge agents get manager_one/);
  assert.doesNotMatch(text.stdout, /systemPrompt|memberSnapshots|workflowSnapshot|runtime|INTERNAL_EMPLOYEE/);
  const json = await captured([...args('get'), '--json'], { fetcher });
  assert.deepEqual(JSON.parse(json.stdout).data, JSON.parse(JSON.stringify(detail)));
  const collaboration = (await invoke('collaboration')).items[0];
  assert.equal(collaboration.content, question.content);
  assert.equal('tone' in collaboration, false, 'UI palette metadata is not a CLI field');
  assert.equal('statusCode' in collaboration, false);
  assert.equal((await invoke('artifacts')).items[0].sha256, 'abc');
});
test('task CLI queries scoped progress, filters and collaboration and rejects stale/cross-run replies without writing', async () => {
  const f = await fixture(), writes = [];
  const task = { id: 'task_one', title: '中文知识任务', status: 'awaiting_human', teamId: 'team_one', objective: '完整目标' };
  const question = { id: 'question_one', content: '请选择报告标题', recipient: { type: 'human' }, sender: { type: 'agent', name: '经理' }, createdAt: '2026-10-23T00:00:00Z' };
  const workspace = { run: { id: 'run_one', task, status: 'awaiting_human', participants: [{ id: 'manager_one', name: '经理' }], currentFocus: { nodeId: 'write' } }, pendingQuestions: [question], traces: [], dispatches: [], messages: [question], events: [], artifacts: [{ id: 'artifact_one', name: 'docs/report.md', sha256: 'hash' }] };
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Cookie, cookie);
    const path = url.slice(origin.length);
    if (options.method === 'POST') { writes.push({ path, body: JSON.parse(options.body) }); return new Response(JSON.stringify({ message: { id: 'answer_one' } })); }
    const data = taskReadResponse(url,{tasks:[task,{...task,id:'archived',archivedAt:'2026-10-22'}],runs:[{id:'run_one',taskId:task.id}],workspace});
    return new Response(JSON.stringify(data));
  };
  const invoke = (args, value) => execute(['tasks', ...args, '--session-file', f.sessionFile], { fetcher, stdin: input(value ?? '') });
  assert.equal((await invoke(['list', '--search', '知识', '--status', 'awaiting_human'])).total, 1);
  assert.equal((await invoke(['list', '--archived'])).items[0].id, 'archived');
  assert.equal((await invoke(['get', task.id])).objective, '完整目标');
  const progress = await invoke(['progress', task.id]);
  assert.equal(progress.runId, 'run_one'); assert.equal(progress.pendingQuestions[0].id, 'question_one'); assert.match(progress.nextAction, /仍阻塞/);
  assert.equal((await invoke(['collaboration', task.id])).items[0].id, question.id);
  assert.equal((await invoke(['artifacts', task.id])).items[0].id, 'artifact_one');
  assert.equal((await invoke(['questions', task.id])).items[0].id, question.id);
  for (const replyToMessageId of ['other_question', 'already_answered']) await assert.rejects(invoke(['reply', task.id, '--file', '-'], { content: '回答', replyToMessageId }), error => error.code === 'QUESTION_NOT_PENDING');
  await assert.rejects(invoke(['reply', task.id, '--run', 'other_run', '--file', '-'], { content: '回答', replyToMessageId: question.id }), error => error.code === 'NOT_FOUND');
  await assert.rejects(invoke(['message', task.id, '--file', '-'], { content: '普通消息', replyToMessageId: question.id }), error => error.code === 'USAGE');
  await assert.rejects(invoke(['message', task.id, '--file', '-'], { content: '普通消息', recipientAgentId: '' }), error => error.code === 'USAGE');
  assert.equal(writes.length, 0);
  await invoke(['reply', task.id, '--file', '-'], { content: '采用内部简报', replyToMessageId: question.id });
  assert.equal(writes[0].path, '/api/runs/run_one/messages'); assert.equal(writes[0].body.replyToMessageId, question.id);
  await invoke(['message', task.id, '--file', '-'], { content: '补充资料', recipientAgentId: 'manager_one' });
  assert.equal(writes[1].body.recipientAgentId, 'manager_one');
  await invoke(['start', task.id]); assert.equal(writes[2].path, '/api/tasks/task_one/run');
  for (const operation of ['confirm', 'complete', 'delete']) await assert.rejects(invoke([operation, task.id]), error => error.code === 'USAGE');
});

test('task collaboration CLI exposes complete dispatch flow in text and JSON without nested snapshots', async () => {
  const f = await fixture();
  const task = { id: 'task_flow', title: '协作流', status: 'running' };
  const workspace = {
    run: { id: 'run_flow', task, participants: [{ id: 'analyst', name: '需求分析' }] }, pendingQuestions: [], traces: [], artifacts: [],
    messages: [
      { id: 'assignment', kind: 'manager_decision', createdAt: '2026-10-30T00:00:00Z', sender: { type: 'agent', name: '经理' }, recipient: { type: 'team', name: '全体团队' }, content: '分析验收标准', traceId: 'source-trace' },
      { id: 'handoff', kind: 'handoff', createdAt: '2026-10-30T00:00:01Z', sender: {type:'agent',name:'需求分析'}, content: JSON.stringify({status:'completed', rawResponse:'# HUMAN_REPORT\n\n已交付验收标准。'}) },
      { id: 'notice', kind: 'coordination_notice', createdAt: '2026-10-30T00:00:02Z', sender: { type: 'system', name: 'AgentForge' }, content: '协调说明' },
      { id: 'human', kind: 'instruction', createdAt: '2026-10-30T00:00:03Z', sender: { type: 'human', name: '你' }, recipient: { type: 'team' }, content: '补充说明' },
    ],
    dispatches: [{ id: 'work', sourceMessageId: 'assignment', createdAt: '2026-10-30T00:00:01Z', recipientAgentId: 'analyst', workflowNodeId: 'requirements', purpose: 'node', status: 'claimed', attempts: 1, traceIds: ['execution-trace'] }],
    events: [{ id: 'pause', type: 'run.paused', timestamp: '2026-10-30T00:00:04Z', message: '任务暂停', data: { systemPrompt: 'INTERNAL_SNAPSHOT' } }],
  };
  const fetcher = async url => new Response(JSON.stringify(taskReadResponse(url,{tasks:[task],runs:[{id:'run_flow',taskId:task.id}],workspace})));
  const args = ['tasks', 'collaboration', task.id, '--all', '--session-file', f.sessionFile];
  const result = await execute(args, { fetcher });
  assert.deepEqual(result.items.map(item => item.id), ['human', 'handoff', 'assignment']);
  const assignment = result.items.at(-1);
  assert.equal(assignment.to, '需求分析'); assert.equal(assignment.dispatchId, 'work');
  assert.equal(assignment.traceId, 'source-trace'); assert.equal(assignment.executionTraceId, 'execution-trace');
  const rendered = await captured(args, { fetcher });
  assert.match(rendered.stdout, /HUMAN_REPORT/); assert.doesNotMatch(rendered.stdout,/rawResponse/);
  assert.match(rendered.stdout, /接手执行 Trace ID/); assert.match(rendered.stdout, /需求分析/);
  const json = await captured([...args, '--json'], { fetcher });
  assert.deepEqual(JSON.parse(json.stdout).data, JSON.parse(JSON.stringify(result)));
  assert.doesNotMatch(JSON.stringify(result), /INTERNAL_SNAPSHOT|tone|statusCode|全体团队/);
  const schema = await execute(['schema', 'tasks', 'collaboration']);
  assert.match(JSON.stringify(schema), /沟通消息/);
});
test('desktop CLI verifies its private live endpoint and never falls back to Web', async () => {
  const root = await mkdtemp(join(tmpdir(), 'af-desktop-cli-'));
  const directory = join(root, 'private'); await mkdir(directory, { mode: 0o700 });
  const endpointFile = join(directory, 'desktop-endpoint.json');
  const desktopOrigin = 'http://127.0.0.1:51983', instanceId = '11111111-2222-4333-8444-555555555555';
  await writeFile(endpointFile, JSON.stringify({ origin: desktopOrigin, instanceId }), { mode: 0o600 });
  const fetcher = async url => { assert.equal(url, `${desktopOrigin}/api/health`); return new Response(JSON.stringify({ service: 'agentforge-control-plane', instanceId }), { status: 200 }); };
  assert.equal(await resolveEndpoint(endpointFile, fetcher), desktopOrigin);
  await assert.rejects(resolveEndpoint(endpointFile, async () => new Response(JSON.stringify({ service: 'agentforge-control-plane', instanceId: 'other' }))), error => error.code === 'CLIENT_UNAVAILABLE');
  await chmod(endpointFile, 0o644);
  await assert.rejects(resolveEndpoint(endpointFile, fetcher), error => error.code === 'CLIENT_UNAVAILABLE');
  await chmod(endpointFile, 0o600);
  await assert.rejects(resolveEndpoint(join(directory, 'missing.json'), fetcher), error => error.code === 'CLIENT_UNAVAILABLE');
  assert.equal(defaultEndpointFile('/fixture-home'), '/fixture-home/.agentforge/desktop/desktop-endpoint.json');
});
async function captured(args, options = {}) {
  let stdout = '', stderr = '';
  const code = await run(args, { ...options, write: value => { stdout += value; }, writeError: value => { stderr += value; } });
  return { code, stdout, stderr };
}
test('default CLI help progressively discloses root, groups and operation details offline', async () => {
  for (const args of [[], ['help'], ['--help'], ['schema']]) {
    const result = await captured(args, { fetcher() { assert.fail('help must stay offline'); } });
    assert.equal(result.code, 0); assert.equal(result.stderr, ''); assert.ok(!result.stdout.startsWith('{'));
    for (const phrase of ['AI 团队操作系统', '数字员工', 'MCP 市场', '插件市场', '工作流', '团队', 'Runtime', '会话状态', '查看具体操作参数：在命令后加 --help，例如 agentforge agents get --help。']) assert.ok(result.stdout.includes(phrase), phrase);
    assert.doesNotMatch(result.stdout, /逐层查看|GROUP|OPERATION/);
    assert.equal(result.stdout.split('\n').filter(line => line.includes('--help')).length, 1);
    assert.ok(result.stdout.indexOf('AI 团队操作系统') < result.stdout.indexOf('命令目录'));
    for (const hidden of ['典型交付流程', '核心概念', 'SQLite', '--password-stdin', '建议配置顺序', 'JSON 输入模板']) assert.ok(!result.stdout.includes(hidden), hidden);
    assert.ok(result.stdout.length < 1000 && result.stdout.split('\n').length < 24, 'root is a short directory, not the entire manual');
    assert.ok(result.stdout.split('\n')[0].endsWith('而不只是聊天回复。'), 'product purpose is one logical line');
  }
  for (const group of Object.keys(resources)) {
    const result = await captured(['help', group], { columns: 160 });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /子命令/); assert.match(result.stdout, new RegExp(`例如 agentforge ${group} ${group==='storage'?'get':'list'} --help`));
    assert.doesNotMatch(result.stdout, /下一层帮助|GROUP|OPERATION/);
    assert.ok(!result.stdout.includes('完整字段说明') && !result.stdout.includes('JSON 输入模板'));
    for (const operation of resources[group].operations) assert.ok(result.stdout.includes(operation));
    assert.equal((await captured([group])).stdout, result.stdout);
    const schema = await captured(['schema', group], { columns: 160 });
    assert.match(schema.stdout, /完整字段说明/); assert.match(schema.stdout, /JSON 输入模板/); assert.match(schema.stdout, /失败恢复/);
    for (const name of Object.keys(resources[group].schema.properties)) assert.ok(schema.stdout.includes(name), group + '.' + name);
    for (const operation of resources[group].operations) assert.equal((await captured([group, operation, '--help'])).code, 0);
  }
  const auth = (await captured(['auth'])).stdout;
  assert.match(auth, /管理员会话/); assert.match(auth, /login/); assert.match(auth, /status/); assert.match(auth, /logout/);
  assert.match(auth, /例如 agentforge auth login --help/); assert.doesNotMatch(auth, /GROUP|OPERATION/);
  assert.ok(!auth.includes('--password-stdin') && !auth.includes('AF_LOGIN_PASSWORD'));
  const login = (await captured(['auth', 'login', '--help'])).stdout;
  assert.match(login, /--username NAME \[--password-stdin\]/); assert.match(login, /交互登录/); assert.match(login, /隐藏输入/); assert.match(login, /AF_LOGIN_PASSWORD/); assert.match(login, /stdin/);
  for (const operation of ['status', 'logout']) {
    const text = (await captured(['auth', operation, '--help'])).stdout;
    assert.ok(!text.includes('--username') && !text.includes('--password-stdin') && !text.includes('AF_LOGIN_PASSWORD'));
    assert.match(text, /--session-file/);
  }
  const employee = await captured(['agents', 'create', '--help'], { columns: 160 });
  assert.match(employee.stdout, /runtime.extensionSelection.pluginIds/); assert.match(employee.stdout, /父项提供时必填/);
  assert.match(employee.stdout, /完整替换/); assert.ok(!employee.stdout.includes('--username')); assert.match(employee.stdout, /roleIds/); assert.ok(!/^ {2}role {2}/m.test(employee.stdout), 'the retired role label stays absent; only roleId references a shared role');
  assert.match((await captured(['workflows', 'create', '--help'])).stdout, /staffingGuidance/);
  for (const operation of ['list', 'get', 'delete']) {
    const text = (await captured(['agents', operation, '--help'])).stdout;
    assert.ok(!text.includes('完整字段说明') && !text.includes('JSON 输入模板') && !text.includes('--file'));
    assert.equal(text.includes('--yes'), operation === 'delete');
    assert.equal(text.includes('--search'), operation === 'list');
    if (operation !== 'list') assert.match(text, /ID：必填精确资源ID/);
  }
});
test('displayed help examples are executable offline; usage errors do not recommend placeholder commands', async () => {
  const offline = { fetcher() { assert.fail('help must not authenticate or make requests'); } };
  const root = (await captured([], offline)).stdout;
  const example = root.match(/例如 (agentforge [a-z -]+)--help/)[1].trim().split(/\s+/).slice(1);
  const detail = await captured([...example, '--help'], offline);
  assert.equal(detail.code, 0); assert.match(detail.stdout, /ID：必填精确资源ID/);
  for (const args of [['agents', 'get'], ['GROUP'], ['GROUP', 'agents'], ['agents', 'help']]) {
    const result = await captured(args, offline);
    assert.equal(result.code, 2); assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /GROUP|OPERATION|<group>|<operation>/);
    assert.match(result.stderr, /agentforge agents get --help/);
  }
});
test('explicit --json works before/after commands, including malformed usage; piped default stays text', async () => {
  for (const args of [['--json', 'schema', 'agents'], ['schema', 'agents', '--json'], ['agents', 'create', '--help', '--json']]) {
    const result = await captured(args); assert.equal(result.code, 0); assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).data.group, 'agents');
  }
  for (const args of [['--json', '--json'], ['help', '--unknown', '--json'], ['--json', 'tasks', 'confirm', 'x']]) {
    const result = await captured(args); assert.equal(result.code, 2); assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).error.code, 'USAGE');
  }
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../cli/main.mjs', import.meta.url)), 'help']);
  assert.match(stdout, /^AgentForge/); assert.equal(stderr, '');
});
test('CLI executable works through an npm-style symlink and keeps stdout machine-readable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'af-cli-link-'));
  const link = join(root, 'agentforge');
  await symlink(fileURLToPath(new URL('../cli/main.mjs', import.meta.url)), link);
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [link, 'schema', 'workflows', '--json']);
  assert.equal(JSON.parse(stdout).data.group, 'workflows'); assert.equal(stderr, '');
});
function directoryResponse(url,key,rows) {
  const q=new URL(url).searchParams;
  const matching=rows.filter(item=>(!q.get('search')||[item.name,item.title,item.description,item.mission,item.prompt,item.objective,...item.capabilities||[]].join(' ').toLowerCase().includes(q.get('search').trim().toLowerCase()))&&(!q.get('role')||item.roleIds?.includes(q.get('role')))&&(!q.get('status')||item.status===q.get('status'))&&(!q.get('workflow')||item.workflowTemplateId===q.get('workflow'))&&(key!=='tasks'||Boolean(item.archivedAt)===(q.get('archived')==='true')));
  const total=matching.length,totalPages=Math.max(1,Math.ceil(total/20)),page=Math.min(Number(q.get('page')||1),totalPages);
  return {[key]:matching.slice((page-1)*20,page*20),page,pageSize:20,total,totalPages,hasMore:page<totalPages};
}
function taskReadResponse(url,{tasks=[],runs=[],workspace,workflowTemplates=[]}={}) {
  const path=new URL(url).pathname;
  if(path==='/api/catalog-references')return {workflowTemplates,taskWorkflows:tasks.map(t=>({id:t.workflowTemplateId,name:t.workflowSnapshot?.name}))};
  if(path==='/api/tasks')return directoryResponse(url,'tasks',tasks);
  if(path.startsWith('/api/tasks/')){const task=tasks.find(t=>t.id===path.split('/').at(-1));return {task:task&&{...task,runs:runs.filter(r=>r.taskId===task.id)}};}
  if(path.endsWith('/collaboration'))return {items:collaborationRecords(workspace),total:collaborationRecords(workspace).length,hasMore:false,nextBefore:null};
  if(path.endsWith('/artifacts'))return {items:workspace.artifacts,total:workspace.artifacts.length,hasMore:false,nextBefore:null};
  if(path.endsWith('/workspace'))return workspace;
  throw Error('Unexpected task read '+url);
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'af-config-cli-')), sessionFile = join(root, 'private', 'session.json');
  const calls = [], state = { agents: [{ id: 'agent_one', name: '原员工', kind: 'business', runtime: { profileId: 'runtime_one', extensionSelection: { mcpIds: ['private-id'], pluginIds: [] } } }], teams: [{ id: 'team_one', name: '内容团队', memberAgentIds: ['agent_one'] }], profiles: [{ id: 'runtime_one', name: 'default', provider: 'claude-code' }], workflowTemplates: [], plugins: [{ id: 'plugin_one', name: '编辑插件', skillIds: ['skill_one'], unsupported: ['hooks'] }], entries: [{ id: 'skill_one', kind: 'skill', name: '编辑', description: '中文' }] };
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith(origin + '/api/')); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Origin, origin);
    const path = url.slice(origin.length), body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method, body });
    const response = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
    if (path === '/api/auth/login') return response({ username: 'operator', expiresAt: null }, 200, { 'set-cookie': cookie + '; Path=/; HttpOnly' });
    assert.equal(options.headers.Cookie, cookie);
    if (path === '/api/auth/logout') return response({ ok: true });
    if (path === '/api/auth/session') return response({ username: 'operator', expiresAt: null });
    const pathname=new URL(url).pathname;
    const resource = Object.values(resources).find(item => pathname === item.path || pathname.startsWith(item.path + '/'));
    if (path.endsWith('/test')) return response({ ok: false, logPath: '/private/probe.jsonl', testId: 'probe-1' });
    if (options.method === 'GET' && ['agents','roles','teams','workflowTemplates'].includes(resource.key)) {
      if(pathname!==resource.path)return response({[({agents:'agent',roles:'role',teams:'team',workflowTemplates:'workflowTemplate'})[resource.key]]:state[resource.key].find(item=>item.id===pathname.split('/').at(-1))});
      return response(directoryResponse(url,resource.key,state[resource.key]));
    }
    if (options.method === 'GET') return response({ [resource.key]: state[resource.key], ...(resource.key === 'plugins' ? { entries: state.entries } : {}),...(['plugins','entries'].includes(resource.key)?{totalPages:1,total:state[resource.key].length,page:1,pageSize:20,hasMore:false}:{}) });
    return response(body || { deleted: true });
  };
  const options = { fetcher };
  const invoke = (args, stdin) => execute([...args, '--session-file', sessionFile], { ...options, stdin: input(stdin ?? '') });
  await invoke(['auth', 'login', '--username', 'operator', '--password-stdin'], 'synthetic-password\n');
  return { root, sessionFile, invoke, calls, state, fetcher };
}
test('Runtime CLI resolves full fixed names and makes missing installation distinct from user disabling', async () => {
  const f = await fixture();
  try {
    f.state.profiles.push({ id: 'runtime_dsh', provider: 'dsh', installed: false, enabled: false, model: '', effort: '' });
    assert.equal((await f.invoke(['runtimes', 'get', 'DeepSeek Harness'])).id, 'runtime_dsh');
    assert.equal((await f.invoke(['runtimes', 'get', 'Claude Code'])).id, 'runtime_one');
    const data = await f.invoke(['runtimes', 'list']);
    const text = formatOutput(['runtimes', 'list'], data, { columns: 120 });
    assert.match(text, /DeepSeek Harness/); assert.match(text, /未安装/);
    assert.equal(data.items.find(item => item.provider === 'dsh').installed, false);
    assert.match(formatOutput(['runtimes', 'get'], f.state.profiles[1]), /本机已安装/);
    await assert.rejects(f.invoke(['agents', 'get', 'DeepSeek Harness']), error => error.code === 'USAGE');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('MCP update is progressive, accepts partial input and sends an authenticated PUT without nested resources',async()=>{
  const f=await fixture();try{
    const help=await captured(['mcps','update','--help']);assert.match(help.stdout,/update ID --file/);assert.match(help.stdout,/隐藏值/);assert.match(help.stdout,/新版本/);
    await f.invoke(['mcps','update','skill_one','--file','-'],{description:'新的说明'});
    assert.deepEqual(f.calls.at(-1),{path:'/api/runtime/mcp-marketplace/skill_one',method:'PUT',body:{description:'新的说明'}});
    const count=f.calls.length;await assert.rejects(f.invoke(['mcps','update','skill_one','--file','-'],{}),/至少提供/);assert.equal(f.calls.length,count);
  }finally{await rm(f.root,{recursive:true,force:true})}
});
test('plugin update controls expose progressive help and authenticated status, trigger and settings commands',async()=>{
  const f=await fixture();try{
    for(const operation of ['updates','check-updates','auto-update']){
      const help=await captured(['plugins',operation,'--help']);assert.match(help.stdout,/2分钟/);if(operation==='auto-update'){assert.match(help.stdout,/--file/);assert.match(help.stdout,/enabled/);}
    }
    await f.invoke(['plugins','updates']);assert.deepEqual(f.calls.at(-1),{path:'/api/runtime/marketplace/updates',method:'GET',body:null});
    await f.invoke(['plugins','check-updates']);assert.deepEqual(f.calls.at(-1),{path:'/api/runtime/marketplace/updates',method:'POST',body:{}});
    await f.invoke(['plugins','auto-update','--file','-'],{enabled:false});assert.deepEqual(f.calls.at(-1),{path:'/api/runtime/marketplace/updates/settings',method:'PUT',body:{enabled:false}});
    await f.invoke(['plugins','auto-update','--file','-'],{intervalMinutes:15});assert.deepEqual(f.calls.at(-1).body,{intervalMinutes:15});
    const count=f.calls.length;for(const input of [{},{enabled:'false'},{enabled:true,extra:1},{intervalMinutes:0},{intervalMinutes:1441},{intervalMinutes:1.5},{intervalMinutes:'2'}])await assert.rejects(f.invoke(['plugins','auto-update','--file','-'],input));assert.equal(f.calls.length,count);
  }finally{await rm(f.root,{recursive:true,force:true})}
});
test('plugin and MCP deletion exposes progressive help and requires explicit confirmation before authenticated DELETE', async () => {
  const f=await fixture();
  try {
    for(const [group,id,path] of [['plugins','plugin_one','/api/runtime/marketplace/plugin_one'],['mcps','skill_one','/api/runtime/mcp-marketplace/skill_one']]) {
      const help=await captured([group,'delete','--help']);
      assert.match(help.stdout,/delete ID --yes/);assert.match(help.stdout,/历史任务/);
      const before=f.calls.length;
      await assert.rejects(f.invoke([group,'delete',id]),error=>error.code==='USAGE');
      assert.equal(f.calls.length,before,'missing confirmation never accesses service');
      await f.invoke([group,'delete',id,'--yes']);
      assert.deepEqual(f.calls.at(-1),{path,method:'DELETE',body:{}});
    }
  } finally {await rm(f.root,{recursive:true,force:true});}
});
test('text lists, complete details and mutation feedback preserve IDs, prompts and configuration-only semantics', async () => {
  const f = await fixture(), invoke = (args, options = {}) => captured([...args, '--session-file', f.sessionFile], { fetcher: f.fetcher, ...options });
  const list = await invoke(['agents', 'list']);
  assert.match(list.stdout, /数字员工列表/); assert.match(list.stdout, /agent_one/); assert.match(list.stdout, /共 1 项/); assert.match(list.stdout, /agents get ID/);
  assert.equal(list.stderr, '');
  f.state.agents[0].systemPrompt = '第一条要求\n' + '需要完整保留的详细交付要求。'.repeat(50) + '\n最终要求';
  const detail = await invoke(['agents', 'get', 'agent_one']);
  assert.match(detail.stdout, /执行与协作提示词/); assert.match(detail.stdout, /最终要求/); assert.match(detail.stdout, /private-id/); assert.ok(detail.stdout.length > 800);
  assert.match(detail.stdout, /systemPrompt\)：\n  第一条要求/);
  const created = await invoke(['teams', 'create', '--file', '-'], { stdin: input(resources.teams.example) });
  assert.match(created.stdout, /已创建团队配置/); assert.match(created.stdout, /企业知识内容组/); assert.match(created.stdout, /不代表 Task\s+已完成/);
  const status = await invoke(['auth', 'status']); assert.match(status.stdout, /CLI 会话有效/); assert.match(status.stdout, /operator/); assert.match(status.stdout, /不过期/); assert.ok(!status.stdout.includes(cookie));
  const json = await invoke(['agents', 'list', '--json']); assert.equal(JSON.parse(json.stdout).data.items[0].id, 'agent_one');
  const result = await invoke(['agents', 'list', '--search', 'missing']); assert.match(result.stdout, /没有匹配的配置/);
});
test('text tables handle CJK, narrow/long values, empty/out-of-range pages, and escape terminal controls', () => {
  const data = { items: [{ id: 'agent_one', name: '中文', status: 'active' }, { id: 'agent_two', name: 'Edit', status: 'active' }], total: 21, page: 1, pageSize: 20, hasMore: true };
  const table = formatOutput(['agents', 'list'], data);
  assert.ok(table.includes('中文  ') && table.includes('Edit  ')); assert.match(table, /--page 2/);
  data.items[0].name = '完整长名称'.repeat(50) + '\x1b[31m\rPRIVATE_CONTROL\u202e';
  const narrow = formatOutput(['agents', 'list'], data, { columns: 40 });
  assert.ok(!narrow.includes('\x1b') && !narrow.includes('\r') && !narrow.includes('\u202e'));
  assert.ok(narrow.includes('完整长名称'.repeat(50))); assert.match(narrow, /\\u001b/); assert.match(narrow, /ID：agent_one/);
  assert.match(formatOutput(['teams', 'list'], { ...data, items: [], page: 99 }), /本页没有记录/);
  assert.match(formatOutput(['teams', 'list'], { ...data, total: 0, items: [], page: null }), /--all/);
});
test('text failures go only to stderr with exit code and recovery; no raw errors or input secrets', async () => {
  const f = await fixture(), session = ['--session-file', f.sessionFile];
  for (const [status, code] of [[401, 3], [409, 4]]) {
    const result = await captured(['teams', 'list', ...session], { fetcher: async () => new Response('{"error":"safe rejection"}', { status }) });
    assert.equal(result.code, code); assert.equal(result.stdout, ''); assert.match(result.stderr, /HTTP 状态/); assert.match(result.stderr, /处理建议/);
  }
  const malformed = await captured(['teams', 'create', '--file', '-', ...session], { stdin: input('{"secret":"never-echo'), fetcher: f.fetcher });
  assert.equal(malformed.code, 2); assert.equal(malformed.stdout, ''); assert.ok(!malformed.stderr.includes('never-echo'));
  const uncertain = await captured(['teams', 'create', '--file', '-', ...session], { stdin: input(resources.teams.example), fetcher: () => { throw new Error('raw-cookie-secret'); } });
  assert.equal(uncertain.code, 5); assert.equal(uncertain.stdout, ''); assert.match(uncertain.stderr, /可能已经提交/); assert.ok(!uncertain.stderr.includes('raw-cookie-secret'));
});

test('AI CLI provides offline comprehensive group/command schemas and safe examples', async () => {
  const failFetch = () => { throw new Error('help must be offline'); };
  const help = await execute(['help'], { fetcher: failFetch });
  assert.equal(Object.keys(help.resources).length, 10); assert.match(help.sequence.join(' '), /runtimes.*plugins.*mcps.*roles.*agents.*teams.*workflows/);
  for (const group of Object.keys(resources)) {
    const schema = await execute(['schema', group], { fetcher: failFetch });
    assert.equal(schema.schema.additionalProperties, false); assert.ok(schema.notes.length);
    for (const operation of resources[group].operations) assert.equal((await execute([group, operation, '--help'])).operation, operation);
  }
  assert.match((await execute(['auth', 'login', '--help'])).login, /stdin/);
  assert.match(JSON.stringify(help), /staffingGuidance/); assert.match(JSON.stringify(help), /extensionSelection/);
  for (const args of [['schema', 'missing'], ['help', 'agents', 'missing'], ['--password', 'secret'], ['agents', 'delete', 'x'], ['tasks', 'confirm', 'x']]) await assert.rejects(execute(args), error => error.code === 'USAGE');
});

test('CLI login stores only a private expiring session, authenticates commands and revokes logout', async () => {
  const f = await fixture();
  assert.equal((await stat(f.sessionFile)).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.root, 'private'))).mode & 0o777, 0o700);
  const saved = await readFile(f.sessionFile, 'utf8'); assert.ok(!saved.includes('synthetic-password'));
  assert.equal((await f.invoke(['auth', 'status'])).username, 'operator');
  assert.deepEqual(await f.invoke(['auth', 'logout']), { loggedOut: true });
  await assert.rejects(stat(f.sessionFile), { code: 'ENOENT' });
  await assert.rejects(f.invoke(['agents', 'list']), error => error.code === 'AUTH_REQUIRED');
});

test('CLI rejects insecure/expired/foreign-origin/symlink session files without leaking cookie', async () => {
  const f = await fixture();
  await chmod(f.sessionFile, 0o644);
  await assert.rejects(f.invoke(['agents', 'list']), error => error.code === 'AUTH_REQUIRED');
  await chmod(f.sessionFile, 0o600);
  await writeFile(f.sessionFile, JSON.stringify({ origin: 'https://example.com', cookie, expiresAt: Date.now() + 10000 }));
  await assert.rejects(f.invoke(['agents', 'list']), error => error.code === 'AUTH_REQUIRED');
  const link = join(f.root, 'private', 'link.json'); await symlink(f.sessionFile, link);
  await assert.rejects(execute(['agents', 'list', '--session-file', link], { fetcher: f.fetcher }), error => error.code === 'AUTH_REQUIRED');
  await writeFile(f.sessionFile, JSON.stringify({ origin, cookie, expiresAt: null }));
  await f.invoke(['agents', 'list']);
  await writeFile(f.sessionFile, JSON.stringify({ origin, cookie, expiresAt: 1 }));
  await assert.rejects(f.invoke(['agents', 'list']), error => error.code === 'AUTH_REQUIRED');
  await chmod(join(f.root, 'private'), 0o755);
  await assert.rejects(f.invoke(['agents', 'list']), error => error.code === 'SESSION_FILE');
});

test('CLI paginates/searches config lists and resolves exact IDs and plugin Skills', async () => {
  const f = await fixture();
  f.state.teams = Array.from({ length: 43 }, (_, n) => ({ id: 't_' + n, name: '内容团队' + n }));
  assert.equal((await f.invoke(['teams', 'list'])).items.length, 20);
  assert.equal((await f.invoke(['teams', 'list', '--page', '3'])).items.length, 3);
  assert.equal((await f.invoke(['teams', 'list', '--all'])).items.length, 43);
  assert.equal((await f.invoke(['teams', 'list', '--search', '团队42'])).total, 1);
  assert.equal((await f.invoke(['teams', 'get', 't_42'])).name, '内容团队42');
  await assert.rejects(f.invoke(['teams', 'get', 'missing']), error => error.code === 'NOT_FOUND');
  await f.invoke(['plugins', 'get', 'plugin_one']);
  assert.equal(f.calls.at(-1).path,'/api/runtime/marketplace/plugin_one');
  await f.invoke(['plugins','import','--file','-'],{path:'/absolute/plugin'});
  assert.equal(f.calls.at(-1).path,'/api/runtime/marketplace');
  await assert.rejects(f.invoke(['plugins','discover','--file','-']),error=>error.code==='USAGE');
  await assert.rejects(f.invoke(['plugins','skills','plugin_one']),error=>error.code==='USAGE');
  await assert.rejects(f.invoke(['agents', 'plugins', 'agent_one']), error => error.code === 'USAGE');
  for (const args of [['teams', 'list', '--page', '0'], ['teams', 'list', '--page', '1', '--all'], ['teams', 'list', '--file', '-'], ['teams', 'get', '../secret']]) await assert.rejects(f.invoke(args), error => error.code === 'USAGE');
});

test('CLI writes all five configuration areas, confirms trust/deletion/test and keeps employee runtime selections', async () => {
  const f = await fixture();
  for (const group of ['agents', 'teams', 'workflows', 'runtimes', 'mcps', 'plugins']) {
    const operation = group === 'plugins' ? 'import' : group === 'runtimes' ? 'update' : 'create';
    await f.invoke([group, operation, ...(group === 'runtimes' ? ['runtime_one'] : []), '--file', '-'], resources[group].example);
  }
  await f.invoke(['agents', 'update', 'agent_one', '--file', '-'], { runtime: { profileId: 'runtime_two' } });
  const payload = f.calls.at(-1).body;
  assert.equal(payload.runtime.profileId, 'runtime_two'); assert.deepEqual(payload.runtime.extensionSelection.mcpIds, ['private-id']);
  await f.invoke(['agents', 'update', 'agent_one', '--file', '-'], { runtime: { extensionSelection: { mcpIds: [], pluginIds: [] } } });
  assert.deepEqual(f.calls.at(-1).body.runtime.extensionSelection.mcpIds, []);
  assert.equal(f.calls.at(-1).body.runtime.profileId, 'runtime_one');
  await assert.rejects(f.invoke(['runtimes', 'delete', 'runtime_one', '--yes']), error => error.code === 'USAGE');
  for (const args of [['runtimes', 'delete', 'runtime_one'], ['runtimes', 'test', 'runtime_one']]) await assert.rejects(f.invoke(args, {}), error => error.code === 'USAGE');
  await f.invoke(['agents','create','--file','-'],{name:'Disabled at creation',status:'inactive'});
  assert.equal(f.calls.at(-1).body.status,'inactive');
  await assert.rejects(f.invoke(['runtimes', 'test', 'runtime_one', '--yes']), error => error.code === 'RUNTIME_TEST_FAILED' && error.hint.includes('probe.jsonl'));
});

test('CLI deletes employees and teams only after confirmation and propagates reference rejection', async () => {
  const f = await fixture();
  for (const [group, id, path] of [['agents', 'agent_one', '/api/agents/agent_one'], ['teams', 'team_one', '/api/teams/team_one']]) {
    const before = f.calls.length;
    await assert.rejects(f.invoke([group, 'delete', id]), error => error.code === 'USAGE');
    assert.equal(f.calls.length, before, 'missing confirmation must not perform an HTTP request');
    await f.invoke([group, 'delete', id, '--yes']);
    assert.deepEqual(f.calls.at(-1), { path, method: 'DELETE', body: {} });
    const blocked = await captured([group, 'delete', id, '--yes', '--session-file', f.sessionFile], {
      fetcher: (url, options) => options.method === 'DELETE'
        ? new Response('{"error":"仍有真实引用，请先解除引用"}', { status: 409 })
        : f.fetcher(url, options)
    });
    assert.equal(blocked.code, 4); assert.equal(blocked.stdout, ''); assert.match(blocked.stderr, /仍有真实引用/);
  }
});

test('employee schemas and writes use abilities and prompts without a role label', async () => {
  const f = await fixture();
  assert.deepEqual(resources.agents.schema.required, ['name']);
  assert.ok(!Object.hasOwn(resources.agents.schema.properties, 'role'));
  assert.ok(!Object.hasOwn(resources.agents.example, 'role'));
  await f.invoke(['agents', 'create', '--file', '-'], { name: '无职责标签员工', description: '中文编辑', capabilities: ['编辑'] });
  assert.equal(f.calls.at(-1).body.name, '无职责标签员工');
  const before = f.calls.length;
  for (const [operation, args] of [['create', []], ['update', ['agent_one']]]) {
    await assert.rejects(f.invoke(['agents', operation, ...args, '--file', '-'], { name: '旧输入', role: 'legacy' }), error => error.code === 'USAGE');
  }
  assert.equal(f.calls.length, before, 'removed fields are rejected before HTTP');
  const machine = await captured(['schema', 'agents', '--json']);
  const schema = JSON.parse(machine.stdout).data;
  assert.equal(schema.schema.additionalProperties, false); assert.ok(schema.schema.properties.runtime.properties.extensionSelection);
  assert.ok(!Object.hasOwn(schema.schema.properties, 'role'));
  assert.ok(!(await captured(['agents', 'list', '--session-file', f.sessionFile], { fetcher: f.fetcher })).stdout.includes('职责'));
});

test('CLI accepts only current employee/workflow inputs and never replays derived runtime paths', async () => {
  const f = await fixture(), before = f.calls.length;
  for (const key of ['skillPaths', 'mcpConfigPaths', 'pluginPaths', 'pluginSources', 'provider', 'model', 'executable', 'extensionManifest']) {
    await assert.rejects(f.invoke(['agents', 'update', 'agent_one', '--file', '-'], {runtime:{[key]:[]}}), error => error.code === 'USAGE');
  }
  for (const key of ['ownerRole', 'repositoryPath', 'reuseOwnerFrom']) {
    const value = {...resources.workflows.example, nodes:[{...resources.workflows.example.nodes[0], [key]:'not-supported'}]};
    await assert.rejects(f.invoke(['workflows', 'create', '--file', '-'], value), error => error.code === 'USAGE');
  }
  assert.equal(f.calls.length, before, 'unsupported fields must not make HTTP writes');
  assert.ok(!resources.agents.operations.includes('plugins'));
  const help = await captured(['agents', 'create', '--help']);
  assert.doesNotMatch(help.stdout, /兼容旧|skillPaths|mcpConfigPaths|pluginPaths|pluginSources/);
  Object.assign(f.state.agents[0].runtime, {skillPaths:['/internal/file'],pluginSources:[],extensionManifest:[]});
  const read = await f.invoke(['agents', 'get', 'agent_one']);
  assert.deepEqual(Object.keys(read.runtime), ['profileId', 'extensionSelection']);
  await f.invoke(['agents', 'update', 'agent_one', '--file', '-'], {runtime:{profileId:'runtime_one'}});
  assert.deepEqual(Object.keys(f.calls.at(-1).body.runtime), ['profileId', 'extensionSelection']);
});

test('CLI input errors do not echo malformed JSON/secrets or silently accept unknown fields', async () => {
  const f = await fixture(), before = f.calls.length;
  for (const value of ['{ "token":"synthetic-secret"', '[]', 'null', '{"name":"x","role":"y","token":"synthetic-secret"}', '{"name":"x","role":"y","runtime":{"extensionSelection":{"mcpIds":[]}}}']) {
    let output;
    assert.equal(await run(['agents', 'create', '--file', '-', '--session-file', f.sessionFile, '--json'], { fetcher: f.fetcher, stdin: input(value), write: x => { output = x; } }), 2);
    assert.ok(!output.includes('synthetic-secret')); assert.equal(JSON.parse(output).ok, false);
  }
  assert.equal(f.calls.length, before);
  await assert.rejects(readInput('-', input('x'.repeat(1024 * 1024 + 1))), error => error.code === 'USAGE');
  const path = join(f.root, 'input.json'); await writeFile(path, '{}');
  const link = join(f.root, 'link-input.json'); await symlink(path, link);
  await assert.rejects(readInput(link, input('')), error => error.code === 'USAGE');
  assert.deepEqual(await readInput(path, input('')), {});
});

test('CLI reports auth/rejection/uncertain network outcomes without retries or raw errors', async () => {
  const f = await fixture();
  for (const [status, exit] of [[401, 3], [403, 3], [409, 4], [413, 4]]) {
    let output;
    const result = await run(['teams', 'list', '--session-file', f.sessionFile, '--json'], { fetcher: async () => new Response('{"error":"safe rejection"}', { status }), write: value => { output = JSON.parse(value); } });
    assert.equal(result, exit); assert.equal(output.error.status, status);
  }
  let count = 0, output;
  const code = await run(['teams', 'create', '--file', '-', '--session-file', f.sessionFile, '--json'], { stdin: input(resources.teams.example), fetcher: () => { count++; throw new Error('raw-cookie-secret'); }, write: value => { output = value; } });
  assert.equal(code, 5); assert.equal(count, 1); assert.ok(!output.includes('raw-cookie-secret')); assert.match(output, /可能已经提交/);
  assert.equal(createClient({ sessionFile: f.sessionFile }).request instanceof Function, true);
});

test('task lifecycle CLI terminates the selected run and deletes through authenticated HTTP without implicit retries', async () => {
  const f = await fixture(), writes = [];
  const task = { id: 'task_old', title: '旧任务', status: 'awaiting_acceptance' };
  const runs = [{ id: 'run_latest', taskId: task.id }, { id: 'run_old', taskId: task.id }];
  let refuseDelete = true;
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Cookie, cookie);
    const path = url.slice(origin.length);
    if (options.method === 'GET') return new Response(JSON.stringify(taskReadResponse(url,{tasks:[task],runs})));
    writes.push({ path, method: options.method });
    if (options.method === 'DELETE') return new Response(JSON.stringify(refuseDelete ? { error: '存在活跃 Run' } : { task, runIds: runs.map(x => x.id), runFileCleanup: 'pending' }), { status: refuseDelete ? 409 : 202 });
    return new Response(JSON.stringify({ run: { ...runs.find(x => path.includes(x.id)), status: 'cancelled', manager: { systemPrompt: 'private' } } }));
  };
  const invoke = args => execute(['tasks', ...args, '--session-file', f.sessionFile], { fetcher });
  for (const op of ['terminate', 'delete']) await assert.rejects(invoke([op, task.id]), e => e.code === 'USAGE');
  await assert.rejects(invoke(['terminate', task.id, '--run', 'foreign_run', '--yes']), e => e.code === 'NOT_FOUND');
  assert.equal(writes.length, 0);
  await assert.rejects(invoke(['delete', task.id, '--yes']));
  assert.deepEqual(writes, [{ path: '/api/tasks/task_old', method: 'DELETE' }]);
  const terminated = await invoke(['terminate', task.id, '--run', 'run_old', '--yes']);
  assert.deepEqual(terminated, { taskId: task.id, run: { id: 'run_old', taskId: task.id, status: 'cancelled' } });
  assert.equal(writes.at(-1).path, '/api/runs/run_old/terminate');
  refuseDelete = false;
  const deleted = await invoke(['delete', task.id, '--yes']);
  assert.equal(deleted.runFileCleanup, 'pending');
  assert.deepEqual(deleted.runIds, ['run_latest', 'run_old']);
  assert.match(formatOutput(['tasks', 'delete'], deleted), /任务已删除/);
  assert.match(formatOutput(['tasks', 'terminate'], terminated), /已终止/);
});

test('runtimes models queries the real provider catalog endpoint with provider validation and no fabricated list', async () => {
  const f = await fixture();
  const catalog = { provider: 'codex', source: 'codex debug models（本机 CLI 目录）', notes: ['目录来自本机 codex CLI'], models: [{ id: 'gpt-real', label: 'GPT Real', levels: [{ id: 'high', default: true }] }] };
  const fetcher = async (url, options) => {
    const path = url.slice(origin.length);
    if (path.startsWith('/api/settings/runtime-profiles/models')) return new Response(JSON.stringify(catalog));
    return f.fetcher(url, options);
  };
  const invoke = (args) => execute([...args, '--session-file', f.sessionFile], { fetcher });
  const result = await invoke(['runtimes', 'models', 'codex']);
  assert.equal(result.models[0].id, 'gpt-real');
  assert.equal(result.models[0].levels[0].id, 'high');
  await assert.rejects(invoke(['runtimes', 'models', 'claude-code', '--executable', '/custom/claude']), error => error.code === 'USAGE');
  let seenUrl;
  const spy = async (url, options) => { seenUrl = url; return fetcher(url, options); };
  await execute(['runtimes', 'models', 'codex', '--session-file', f.sessionFile], { fetcher: spy });
  const requested = new URL(seenUrl);
  assert.equal(requested.pathname, '/api/settings/runtime-profiles/models');
  assert.equal(requested.searchParams.get('provider'), 'codex');
  assert.equal(requested.searchParams.get('executable'), null);
  for (const args of [['runtimes', 'models'], ['runtimes', 'models', 'gpt-5'], ['runtimes', 'models', 'codex', '--yes'], ['runtimes', 'models', 'codex', 'extra']]) await assert.rejects(invoke(args), error => error.code === 'USAGE');
  const help = await captured(['runtimes', 'models', '--help'], { fetcher: () => { throw new Error('help must be offline'); } });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /models PROVIDER/);
  assert.match(help.stdout, /codex debug models/);
  assert.match(help.stdout, /不编造/);
  const text = await captured(['runtimes', 'models', 'codex', '--session-file', f.sessionFile], { fetcher });
  assert.match(text.stdout, /Provider 模型目录/);
  assert.match(text.stdout, /gpt-real/);
  assert.match(text.stdout, /思考档位|可选档位/);
});

test('runtime connection schema validates effort vocabulary and model stays free text', async () => {
  const f = await fixture();
  const base = { model: 'any-model-name', effort: '', enabled: true };
  await f.invoke(['runtimes', 'update', 'runtime_one', '--file', '-'], base);
  assert.equal(f.calls.at(-1).body.model, 'any-model-name', 'manual model values are accepted');
  await f.invoke(['runtimes', 'update', 'runtime_one', '--file', '-'], { ...base, effort: 'max' });
  assert.equal(f.calls.at(-1).body.effort, 'max');
  await assert.rejects(f.invoke(['runtimes', 'update', 'runtime_one', '--file', '-'], { ...base, name: 'z', effort: 'extreme' }), error => error.code === 'USAGE');
  await assert.rejects(f.invoke(['runtimes', 'update', 'runtime_one', '--file', '-'], { ...base, name: 'z', effort: undefined, unknown: 1 }), error => error.code === 'USAGE');
  const schema = await execute(['schema', 'runtimes']);
  assert.equal(schema.schema.properties.effort.maxLength,64);
  assert.match(schema.schema.properties.effort.description,/variant/);
  await f.invoke(['runtimes','update','runtime_one','--file','-'],{...base,effort:'custom-variant'});
  await assert.rejects(f.invoke(['runtimes','update','runtime_one','--file','-'],{...base,effort:'unsafe value'}),error=>error.code==='USAGE');
  assert.match(schema.schema.properties.model.description, /runtimes models/);
});

test('repeat-import help and receipts expose overwrite behavior without changing input authority',async()=>{
  for(const [group,operation] of [['plugins','import'],['mcps','create']]){
    const result=await captured([group,operation,'--help']);assert.match(result.stdout,/覆盖/);assert.match(result.stdout,/replacements/);
    const receipt={replacements:[{kind:group==='plugins'?'plugin':'mcp',id:'new-version',previousId:'old-version',name:'同名项'}],employees:[{id:'employee-id',name:'员工'}],historyRetained:true};
    const output=formatOutput([group,operation],receipt);assert.match(output,/覆盖 1 个已有版本/);assert.match(output,/更新 1 位员工/);assert.match(output,/old-version/);
  }
});

test('default CLI uses the formal desktop delegation, validates instance and respects explicit isolation', async () => {
  const root = await mkdtemp(join(tmpdir(),'af-shared-cli-'));
  try {
    const endpoint = join(root,'desktop-endpoint.json'), shared = join(root,'desktop-cli-session.json');
    await writeFile(endpoint,JSON.stringify({origin,instanceId}),{mode:0o600});
    await writeFile(shared,JSON.stringify({origin,instanceId,cookie,expiresAt:null}),{mode:0o600});
    const calls = [];
    const fetcher = async (url,init) => {
      calls.push({url,init});
      if (url.endsWith('/api/health')) return new Response(JSON.stringify({service:'agentforge-control-plane',instanceId}));
      assert.equal(init.headers.Cookie,cookie);
      if (url.endsWith('/api/auth/session')) return new Response(JSON.stringify({username:'operator',expiresAt:null}));
      return new Response(JSON.stringify({profiles:[{id:'codex',provider:'codex',model:'',effort:'',enabled:true}]}));
    };
    const result = await executeCommand(['runtimes','list','--endpoint-file',endpoint],{fetcher,home:root});
    assert.equal(result.total,1); assert.equal(calls[0].init.headers,undefined);
    assert.equal(calls.filter(call=>call.url.endsWith('/api/auth/session')).length,1);
    const explicit = join(root,'missing-private-session.json');
    await assert.rejects(executeCommand(['runtimes','list','--endpoint-file',endpoint,'--session-file',explicit],{fetcher,home:root}),error=>error.code==='AUTH_REQUIRED');
    await writeFile(shared,JSON.stringify({origin,instanceId:'11111111-2222-4333-8444-666666666666',cookie,expiresAt:null}),{mode:0o600});
    // A stale instance must never receive the saved desktop token.
    const before = calls.length;
    await assert.rejects(executeCommand(['runtimes','list','--endpoint-file',endpoint],{fetcher,home:root}),error=>error.code==='AUTH_REQUIRED');
    assert.equal(calls.length,before+1);
  } finally { await rm(root,{recursive:true,force:true}); }
});


test('CLI role arrays validate duplicates/retired writes and format partial import warnings explicitly',async()=>{
  const {validateInput}=await import('../cli/client.mjs');
  validateInput({name:'worker',roleIds:['role_b','role_a']},resources.agents.schema);
  for(const value of [{name:'worker',roleIds:null},{name:'worker',roleIds:['role_a','role_a']},{name:'worker',roleId:'role_a'}])assert.throws(()=>validateInput(value,resources.agents.schema));
  const result={plugins:[{id:'plugin',name:'partial'}],mcps:[],warnings:[{plugin:'partial',component:'skill',path:'skills/bad/SKILL.md',message:'frontmatter YAML 无效'}]};
  const output=formatOutput(['plugins','import'],result);assert.match(output,/⚠️/);assert.match(output,/skills\/bad\/SKILL.md/);assert.match(output,/YAML 无效/);
});


test('employee CLI rejects retired developer/repository writes and directs repository guidance to prompts',async()=>{
 const {validateInput}=await import('../cli/client.mjs');assert.deepEqual(resources.agents.schema.properties.kind.enum,['business','manager']);assert.equal(Object.hasOwn(resources.agents.schema.properties,'repository'),false);
 for(const input of [{name:'old',kind:'developer'},{name:'old',repository:null},{name:'old',repository:{url:'https://example.invalid/app.git'}}])assert.throws(()=>validateInput(input,resources.agents.schema));
 validateInput({name:'worker',kind:'business',systemPrompt:'按本次任务说明处理仓库。'},resources.agents.schema);
});


test('task progress help describes original employee recovery without granting a CLI retry operation', async () => {
  const help = await execute(['tasks','progress','--help']);
  assert.match(JSON.stringify(help), /原失败员工的投递与会话/);
  assert.match(JSON.stringify(help), /协调协议拒收.*自动纠正一次/);
  await assert.rejects(execute(['tasks','retry']), /未知|不支持|命令/);
});


test('task lists expose frozen workflow references and combine workflow filtering before pagination', async () => {
  const f = await fixture();
  const tasks = Array.from({ length: 45 }, (_, i) => ({ id: `task_${i}`, title: `任务 ${i}`, status: 'backlog', workflowTemplateId: i < 22 ? 'flow_a' : 'flow_b', workflowSnapshot: { name: i < 22 ? '旧名称' : '另一流程' }, archivedAt: i === 44 ? '2026-01-01' : null }));
  const workflowTemplates = [{ id: 'flow_a', name: '新名称' }, { id: 'flow_b', name: '另一流程' }];
  const invoke = args => execute(['tasks', 'list', ...args, '--session-file', f.sessionFile], { fetcher: async url => new Response(JSON.stringify(taskReadResponse(url,{tasks,workflowTemplates}))) });
  const selected = await invoke(['--workflow', '新名称', '--page', '2']);
  assert.equal(selected.total, 22); assert.equal(selected.items.length, 2);
  assert.deepEqual(selected.items[0].workflow, { id: 'flow_a', name: '旧名称' });
  assert.match(formatOutput(['tasks', 'list'], selected), /旧名称/);
  assert.equal((await invoke(['--workflow', '旧名称', '--all'])).total, 22);
  assert.equal((await invoke(['--workflow', 'flow_b', '--archived'])).total, 1);
  assert.equal((await invoke(['--workflow', 'flow_b', '--search', '23', '--status', 'backlog'])).total, 1);
  assert.equal((await invoke(['--workflow', 'flow_b', '--status', 'running'])).total, 0);
  await assert.rejects(invoke(['--workflow', '不存在']), error => error.code === 'NOT_FOUND');
  workflowTemplates.push({ id: 'flow_c', name: '新名称' });
  await assert.rejects(invoke(['--workflow', '新名称']), error => error.code === 'AMBIGUOUS_REFERENCE');
  assert.equal((await invoke(['--workflow', 'flow_a'])).total, 22);
  assert.match((await captured(['tasks', 'list', '--help'])).stdout, /--workflow ID_OR_NAME/);
});


test('CLI task creation supports teams, empty criteria and explicit create/start with recoverable failure', async () => {
  const f = await fixture(), writes = [];
  const value = {managerAgentId:'system_project_manager',title:'任务',objective:'目标',teamIds:['team_one'],memberAgentIds:[],workflowTemplateId:'flow_one',acceptanceCriteria:[]};
  let rejectStart = false;
  const fetcher = async (url, options) => {
    writes.push({url,body:JSON.parse(options.body)});
    return url.endsWith('/run') ? new Response(JSON.stringify(rejectStart ? {error:'Runtime 不可用'} : {run:{id:'run_one',taskId:'task_one',status:'running'}}),{status:rejectStart?409:202}) : new Response(JSON.stringify({task:{id:'task_one',title:'任务',status:'backlog'}}));
  };
  const invoke = (args, body=value) => execute(['tasks','create','--file','-',...args,'--session-file',f.sessionFile],{fetcher,stdin:input(body)});
  const created = await invoke([]); assert.equal(created.run,undefined); assert.equal(created.task.status,'backlog'); assert.match(formatOutput(['tasks','create'],created),/草稿已保存/); assert.equal(writes.length,1); assert.deepEqual(writes[0].body,value);
  writes.length=0; const started = await invoke(['--start']); assert.equal(writes.length,2); assert.equal(started.run.id,'run_one'); assert.match(formatOutput(['tasks','create'],started),/已创建并启动/);
  rejectStart=true; writes.length=0;
  await assert.rejects(invoke(['--start']),error=>error.code==='TASK_CREATED_START_FAILED' && error.taskId==='task_one' && /不要重复创建/.test(error.hint));
  assert.equal(writes.length,2,'no automatic create or start retry');
  const before=writes.length;
  for (const patch of [{teamIds:[],memberAgentIds:[]},{acceptanceCriteria:Array(21).fill('标准')},{acceptanceCriteria:['x'.repeat(501)]}]) await assert.rejects(invoke([],{...value,...patch}),error=>error.code==='USAGE');
  assert.equal(writes.length,before);
  const failure=await captured(['tasks','create','--start','--file','-','--session-file',f.sessionFile,'--json'],{fetcher,stdin:input(value)});
  assert.equal(JSON.parse(failure.stdout).error.taskId,'task_one');
  assert.match((await captured(['tasks','create','--help'])).stdout,/--start/);
});

test('CLI search includes employee capabilities and rejects unknown task statuses', async () => {
  const f = await fixture(); f.state.agents[0].capabilities=['独立审片'];
  assert.equal((await f.invoke(['agents','list','--search',' 独立审片 '])).total,1);
  await assert.rejects(execute(['tasks','list','--status','not_a_status','--session-file',f.sessionFile],{fetcher:()=>assert.fail('invalid status must not query tasks')}),error=>error.code==='USAGE');
});

test('CLI draft updates preserve patch semantics, resolve workflows and retain saved edits on launch failure',async()=>{
 const f=await fixture(),writes=[];let rejectStart=false,rejectSave=false;
 const fetcher=async(url,options)=>{
  if(new URL(url).pathname==='/api/catalog-references')return new Response(JSON.stringify({workflowTemplates:[{id:'flow_one',name:'协作流程'}]}));
  writes.push({url,method:options.method,body:JSON.parse(options.body)});
  if(url.endsWith('/run'))return new Response(JSON.stringify(rejectStart?{error:'Runtime 不可用'}:{run:{id:'run_one',taskId:'task_one',status:'running'}}),{status:rejectStart?409:202});
  return new Response(JSON.stringify(rejectSave?{error:'只有尚未启动的普通任务草稿可以编辑'}:{task:{id:'task_one',title:'新标题',status:'backlog'}}),{status:rejectSave?400:200});
 };
 const invoke=(body,args=[])=>execute(['tasks','update','task_one','--file','-',...args,'--session-file',f.sessionFile],{fetcher,stdin:input(body)});
 const patch={title:'新标题',objective:'新目标',memberAgentIds:['worker'],teamIds:['team_one'],managerAgentId:'worker',workflowTemplateId:null,acceptanceCriteria:[]};
 const saved=await invoke(patch);assert.equal(saved.task.id,'task_one');assert.equal(saved.run,undefined);assert.deepEqual(writes[0],{url:writes[0].url,method:'PUT',body:patch});assert.ok(writes[0].url.endsWith('/api/tasks/task_one'));assert.match(formatOutput(['tasks','update','task_one'],saved),/草稿修改已保存/);
 writes.length=0;await invoke({objective:'仅改目标'});assert.deepEqual(writes[0].body,{objective:'仅改目标'});
 writes.length=0;await invoke({title:'流程修改'},['--workflow','协作流程']);assert.equal(writes[0].body.workflowTemplateId,'flow_one');
 writes.length=0;await invoke({},['--workflow','协作流程']);assert.deepEqual(writes[0].body,{workflowTemplateId:'flow_one'});
 writes.length=0;const started=await invoke({title:'启动前保存'},['--start']);assert.equal(started.run.id,'run_one');assert.deepEqual(writes.map(w=>w.method),['PUT','POST']);assert.match(formatOutput(['tasks','update','task_one'],started),/修改已保存并启动/);
 rejectStart=true;writes.length=0;await assert.rejects(invoke({title:'保留修改'},['--start']),e=>e.code==='TASK_UPDATED_START_FAILED'&&e.taskId==='task_one'&&/不要重复提交修改/.test(e.hint));assert.equal(writes.length,2);
 const failedOutput=await captured(['tasks','update','task_one','--file','-','--start','--session-file',f.sessionFile,'--json'],{fetcher,stdin:input({title:'保留修改'})});assert.equal(JSON.parse(failedOutput.stdout).error.taskId,'task_one');assert.equal(JSON.parse(failedOutput.stdout).error.code,'TASK_UPDATED_START_FAILED');
 rejectSave=true;writes.length=0;await assert.rejects(invoke({title:'拒绝'},['--start']),/只有尚未启动/);assert.equal(writes.length,1);
 const before=writes.length;for(const value of [{},{memberAgentIds:[]},{teamIds:[]},{status:'running'},{workspacePath:'/tmp/override'},{acceptanceCriteria:Array(21).fill('标准')}])await assert.rejects(invoke(value),e=>e.code==='USAGE');assert.equal(writes.length,before);
 const help=await captured(['tasks','update','--help']);assert.match(help.stdout,/TASK_ID.*--file/);assert.match(help.stdout,/--start/);assert.match(help.stdout,/仅尚未启动|尚未启动/);
 const schema=await execute(['schema','tasks','update']);assert.deepEqual(schema.schema.required,[]);assert.equal(schema.schema.minProperties,1);assert.equal(schema.schema.additionalProperties,false);
});

test('automation CLI exposes discovery, trigger IDs, status paging and readable list output', async () => {
  assert.match((await captured(['--help'])).stdout, /automations/);
  for (const operation of ['trigger', 'triggers']) {
    const result = await captured(['automations', operation, '--help']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, new RegExp(`automations ${operation} ID`));
    assert.match(result.stdout, /ID：必填/);
    assert.match(result.stdout, /taskTitle/);
    if (operation === 'triggers') {
      assert.match(result.stdout, /--page N \| --all/);
      assert.match(result.stdout, /awaiting_acceptance/);
    }
  }
  assert.match((await captured(['automations', 'list', '--help'])).stdout, /all\/enabled\/disabled/);
  const data = {items:[{id:'auto_one',title:'每日检查',enabled:true,cron:'0 9 * * *',timeZone:'Asia/Shanghai'}],total:21,page:1,pageSize:20,hasMore:true};
  const output = formatOutput(['automations','list'],data);
  assert.match(output,/每日检查/); assert.match(output,/已启用/); assert.match(output,/automations list --page 2/);
  const f = await fixture();
  const result = await execute(['automations','list','--all','--session-file',f.sessionFile], {fetcher:async url => {
    const page=Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify({items:[{id:`auto_${page}`,title:'分页',enabled:false}],page,pageSize:20,total:21,totalPages:2}));
  }});
  assert.equal(result.items.length,2); assert.equal(result.page,null); assert.equal(result.hasMore,false);
  assert.match(formatOutput(['automations','list'],result),/--all/);
  const title='每日检查#2026-11-05 08:09:07';
  const triggers=await execute(['automations','triggers','auto_one','--session-file',f.sessionFile],{fetcher:async()=>new Response(JSON.stringify({items:[{id:'trigger_one',taskTitle:title,taskId:'task_one',status:'running'},{id:'trigger_skip',taskTitle:null,status:'skipped'}],page:1,totalPages:1,total:2,pageSize:20}))});
  assert.equal(triggers.items[0].taskTitle,title);assert.equal(triggers.items[1].taskTitle,null);
  const readable=formatOutput(['automations','triggers','auto_one'],triggers);
  assert.match(readable,/任务标题/);assert.ok(readable.includes(title));

});

test('task members CLI reads compact current roster and validates full replacements',async()=>{
 const f=await fixture(),calls=[];
 const fetcher=async(url,options)=>{
  const path=url.slice(origin.length);calls.push({path,method:options.method,body:options.body});
  const value=path==='/api/tasks/t'?{task:{id:'t',runs:[{id:'r',taskId:'t'}]}}:path.endsWith('/members')?{runId:'r',memberAgentIds:['m','b'],members:[{id:'m'},{id:'b'}]}:{run:{participants:[{id:'m',name:'经理',type:'agent',systemPrompt:'private'},{id:'a',type:'agent'}],removedParticipantIds:['a']}};
  return new Response(JSON.stringify(value));
 };
 const invoke=(args,value)=>execute(['tasks','members','t',...args,'--session-file',f.sessionFile],{fetcher,stdin:input(value??'')});
 assert.deepEqual((await invoke([])).members,[{id:'m',name:'经理'}]);
 await assert.rejects(invoke(['--file','-'],{memberAgentIds:['m','m']}),error=>error.code==='USAGE');
 assert.equal(calls.some(c=>c.method==='PUT'),false);
 assert.deepEqual((await invoke(['--file','-'],{memberAgentIds:['m','b']})).memberAgentIds,['m','b']);
 assert.equal(calls.at(-1).path,'/api/runs/r/members');assert.equal(calls.at(-1).method,'PUT');
});

test('employee role filter resolves ID or unique name before search and pagination', async()=>{
 const f=await fixture(),roles=[{id:'role_a',name:'分析'},{id:'role_b',name:'开发'}];
 const agents=Array.from({length:45},(_,i)=>({id:'agent_'+i,name:'员工 '+i,roleIds:i<22?['role_a','role_b']:['role_b']}));
 const invoke=args=>execute(['agents','list',...args,'--session-file',f.sessionFile],{fetcher:async url=>new Response(JSON.stringify(url.endsWith('/catalog-references')?{roles}:directoryResponse(url,'agents',agents)))});
 assert.equal((await invoke(['--role','分析','--page','2'])).items.length,2);
 assert.equal((await invoke(['--role','role_a','--all'])).total,22);
 assert.equal((await invoke(['--role','role_a','--search','21'])).total,1);
 assert.equal((await invoke(['--role','role_a','--search','44'])).total,0);
 await assert.rejects(invoke(['--role','不存在']),e=>e.code==='NOT_FOUND');
 roles.push({id:'role_c',name:'分析'});await assert.rejects(invoke(['--role','分析']),e=>e.code==='AMBIGUOUS_REFERENCE');
 assert.equal((await invoke(['--role','role_a'])).total,22);
 assert.match((await captured(['agents','list','--help'])).stdout,/--role/);
});


test('task progress exposes all concurrent members and failed-run settlement in text and JSON', async () => {
 const f=await fixture(),task={id:'task_parallel',title:'并行',status:'running'};
 const workspace={run:{id:'run_parallel',task,status:'running',participants:[{id:'a',name:'A'},{id:'b',name:'B'}]},traces:[{id:'ta',agentId:'a',status:'running'},{id:'tb',agentId:'b',status:'running'}],dispatches:[{id:'da',recipientAgentId:'a',status:'claimed'},{id:'db',recipientAgentId:'b',status:'claimed'},{id:'dc',recipientAgentId:'a',status:'queued'}],pendingQuestions:[],messages:[],events:[],artifacts:[]};
 const fetcher=async url=>new Response(JSON.stringify(taskReadResponse(url,{tasks:[task],runs:[{id:workspace.run.id,taskId:task.id}],workspace})));
 const args=['tasks','progress',task.id,'--session-file',f.sessionFile];
 const initial=await execute(args,{fetcher});assert.deepEqual(initial.activeTraces.map(t=>t.agentId),['a','b']);assert.equal(initial.pendingDispatches.length,3);
 workspace.run.status='failed';workspace.traces[0].status='failed';
 const json=await captured([...args,'--json'],{fetcher});const data=JSON.parse(json.stdout).data;assert.deepEqual(data.activeTraces.map(t=>t.agentId),['b']);assert.match(data.nextAction,/收尾/);
 assert.match((await captured(args,{fetcher})).stdout,/收尾/);
 workspace.traces[1].status='completed';assert.doesNotMatch((await execute(args,{fetcher})).nextAction,/收尾/);
 assert.match(resources.tasks.notes.join(' '),/不同员工并行/);
});

test('workflow progressive help exposes minimal nodes, directed edge text and shared defaults', async()=>{
  const help=await captured(['workflows','create','--help']);
  for(const field of ['nodes[].type','nodes[].description','nodes[].position','edges[].condition','edges[].source','edges[].target','edges[].description','edges[].dependency','edges[].handoff'])assert.ok(help.stdout.includes(field));
  assert.match(help.stdout,/默认 false/);assert.match(help.stdout,/默认 true/);assert.match(help.stdout,/返工回路/);
  assert.deepEqual(resources.workflows.schema.properties.nodes.items.required,['title']);
});

test('task create selects saved canvas workflow by unique name or ID and rejects conflicts before creating',async()=>{
  const f=await fixture(),posts=[];
  const fetcher=async(url,init)=>{
    if(new URL(url).pathname==='/api/catalog-references')return new Response(JSON.stringify({workflowTemplates:[{id:'wf_one',name:'分支流程'},{id:'wf_a',name:'重名'},{id:'wf_b',name:'重名'}]}));
    posts.push({path:new URL(url).pathname,body:JSON.parse(init.body)});
    return new Response(JSON.stringify(new URL(url).pathname.endsWith('/run')?{run:{id:'run_one',status:'running'}}:{task:{id:'task_one',title:'流程验证',status:'backlog'}}));
  };
  const invoke=(workflow,value={},extra=[])=>execute(['tasks','create','--workflow',workflow,'--file','-',...extra,'--session-file',f.sessionFile],{fetcher,stdin:input({managerAgentId:'manager',title:'流程验证',objective:'完成所选分支',memberAgentIds:['manager'],...value})});
  const started=await invoke('分支流程',{},['--start']);assert.equal(started.run.id,'run_one');assert.equal(posts[0].body.workflowTemplateId,'wf_one');assert.equal(posts[1].path,'/api/tasks/task_one/run');
  posts.length=0;await invoke('wf_one',{workflowTemplateId:'wf_one'});assert.equal(posts.length,1);assert.equal(posts[0].body.workflowTemplateId,'wf_one');
  for(const [value,body,code] of [['重名',{},'AMBIGUOUS_REFERENCE'],['不存在',{},'NOT_FOUND'],['wf_one',{workflowTemplateId:'wf_other'},'USAGE']]){posts.length=0;await assert.rejects(invoke(value,body),error=>error.code===code);assert.equal(posts.length,0);}
  assert.match(resources.tasks.notes.join(' '),/create --workflow ID_OR_NAME/);
});

test('MCP tools CLI uses the authenticated discovery endpoint and explicit refresh without invoking tools',async()=>{
 const f=await fixture(),calls=[];const fetcher=async(url,init)=>{calls.push({path:new URL(url).pathname,method:init.method,body:JSON.parse(init.body)});return new Response(JSON.stringify({tools:[{name:'lookup',description:'查找',inputSchema:{type:'object'}}],total:1,checkedAt:'2026-11-07T00:00:00Z'}));};
 const args=['mcps','tools','mcp_one','--session-file',f.sessionFile];const result=await execute(args,{fetcher});assert.equal(result.tools[0].name,'lookup');assert.deepEqual(calls[0],{path:'/api/runtime/mcp-marketplace/mcp_one/tools',method:'POST',body:{refresh:false}});
 await execute([...args,'--refresh'],{fetcher});assert.equal(calls[1].body.refresh,true);assert.match(resources.mcps.notes.join(' '),/不调用工具/);
});

test('task CLI requires explicit managerAgentId offline and automation uses the same field',async()=>{
 const f=await fixture(),value={title:'任务',objective:'明确任务身份',memberAgentIds:['employee']};
 await assert.rejects(execute(['tasks','create','--file','-','--session-file',f.sessionFile],{stdin:input(value),fetcher:()=>assert.fail('missing manager must not write')}),e=>e.code==='USAGE');
 assert.ok(resources.tasks.schema.required.includes('managerAgentId'));assert.ok(resources.automations.schema.required.includes('managerAgentId'));
 assert.equal(resources.agents.schema.required.includes('kind'),false);
});

test('MCP tool search and pagination match the App before slicing, with explicit all and empty results',async()=>{
 const f=await fixture(),tools=Array.from({length:25},(_,i)=>({name:'lookup_'+i,description:'相同说明',inputSchema:{type:'object'}}));
 const fetcher=async()=>new Response(JSON.stringify({tools,total:25,checkedAt:'2026-11-07T00:00:00Z'}));
 const invoke=flags=>execute(['mcps','tools','mcp_one',...flags,'--session-file',f.sessionFile],{fetcher});
 const first=await invoke([]);assert.equal(first.tools.length,20);assert.equal(first.total,25);assert.equal(first.hasMore,true);
 const second=await invoke(['--page','2']);assert.equal(second.tools.length,5);assert.equal(second.tools[0].name,'lookup_20');
 const selected=await invoke(['--search','LOOKUP_2','--all']);assert.deepEqual(selected.tools.map(t=>t.name),['lookup_2','lookup_20','lookup_21','lookup_22','lookup_23','lookup_24']);assert.equal(selected.total,6);assert.equal(selected.availableTotal,25);assert.equal(selected.page,null);
 assert.equal((await invoke(['--search','不存在'])).tools.length,0);
 await assert.rejects(invoke(['--all','--page','2']),error=>error.code==='USAGE');
});

test('plugins and MCPs share explicit compatibility refresh with authenticated App endpoint and offline input validation',async()=>{
 const f=await fixture();try{
  for(const [group,path]of [['plugins','marketplace'],['mcps','mcp-marketplace']]){
   assert.ok(resources[group].operations.includes('check-compatibility'));
   const result=await execute([group,'check-compatibility','extension_one','--session-file',f.sessionFile],{fetcher:async(url,options)=>{assert.equal(url,origin+'/api/runtime/'+path+'/extension_one/compatibility');assert.equal(options.method,'POST');assert.equal(options.headers.Cookie,cookie);assert.deepEqual(JSON.parse(options.body),{});return new Response(JSON.stringify({id:'extension_one',providers:['cursor']}));}});assert.deepEqual(result.providers,['cursor']);
   await assert.rejects(execute([group,'check-compatibility','extension_one','--file','-'],{fetcher:()=>assert.fail('invalid options must fail offline')}),error=>error.code==='USAGE');
  }
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('bare Skill import uses the same plugin url/path schema and discloses update semantics',async()=>{
  assert.deepEqual(Object.keys(resources.plugins.schema.properties),['url','path']);
  assert.match(resources.plugins.schema.properties.url.description,/裸 Skill/);assert.match(resources.plugins.schema.properties.path.description,/裸 Skill/);
  const help=await captured(['plugins','import','--help']),plain=help.stdout.replace(/\s+/g,'');assert.match(plain,/SKILL.md/);assert.match(plain,/每个Skill自动包装/);assert.match(plain,/Git来源支持同一更新机制/);assert.match(plain,/本地目录通过再次导入更新/);
});


test('plugin help treats optional allowed-tools as metadata and explains existing-install refresh',async()=>{
 const help=await captured(['plugins','import','--help']),plain=help.stdout.replace(/\s+/g,'');assert.match(plain,/allowed-tools\/allowedTools/);assert.match(plain,/不参与平台兼容性判断/);assert.match(plain,/无需重装/);
});
