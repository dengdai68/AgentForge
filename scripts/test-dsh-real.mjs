// Explicit opt-in: installed DeepSeek Harness, real model, native Skill/MCP/history and a
// complete Task through visible human acceptance. All app data is isolated.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';

if (process.env.AGENTFORGE_DSH_REAL !== '1') throw new Error('Requires AGENTFORGE_DSH_REAL=1; real model calls, never a Provider fixture');
await mkdir('.data', { recursive: true });
const bundle = process.env.AGENTFORGE_DSH_APP;
const root = await mkdtemp(resolve('.data/dsh-real-')), home = join(root, 'home'), data = bundle ? join(home, '.agentforge', 'desktop') : join(root, 'client');
await mkdir(home, { recursive: true, mode: 0o700 });
const password = randomBytes(24).toString('hex'), auth = createAuth({ databasePath: join(data, 'auth.sqlite') });
await auth.setAdministrator('dsh-qa', password); auth.close();
const seed = createStore({ databasePath: join(data, 'agentforge.sqlite'), workspaceRoot: join(root, 'work') });
seed.updateWorkspaceSettings({ workspaceRoot: join(root, 'work') }); seed.close();
// A private launcher preserves the operator's installed Node/DeepSeek Harness executable;
// DSH_HOME remains the invocation-owned directory supplied by the adapter.
const command = process.env.AGENTFORGE_DSH_COMMAND || execFileSync('/usr/bin/which', ['dsh'], { encoding: 'utf8' }).trim();
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
await writeFile(join(root, 'dsh'), '#!/bin/sh\nHOME=' + quote(homedir()) + ' exec ' + quote(command) + ' "$@"\n', { mode: 0o700 });
for (const file of ['.zprofile', '.zshrc']) await writeFile(join(home, file), 'export PATH=' + quote(root) + ':"$PATH"\n');
const secret = prefix => prefix + randomBytes(8).toString('hex');
const roleSecret = secret('ROLE-'), skillSecret = secret('SKILL-'), mcpSecret = secret('MCP-'), historySecret = secret('HISTORY-'), reviewerSecret=secret('REVIEW-');
const plugin = join(root, 'plugin');
const sourceDialect=process.env.AGENTFORGE_DSH_SOURCE_DIALECT || 'claude-code',manifestDirectory=sourceDialect==='codex'?'.codex-plugin':'.claude-plugin';
assert.ok(['claude-code','codex'].includes(sourceDialect));
await mkdir(join(plugin, manifestDirectory), { recursive: true }); await mkdir(join(plugin, 'skills', 'dsh-evidence'), { recursive: true });
await writeFile(join(plugin, manifestDirectory, 'plugin.json'), JSON.stringify({ name: 'dsh-evidence', version: '1.0.0', description: 'DeepSeek Harness native Skill/Subagent/Hook verification' }));
await mkdir(join(plugin,'agents'));await mkdir(join(plugin,'hooks'));
await writeFile(join(plugin,'agents/reviewer.md'),`---\nname: reviewer\ndescription: Independent verification reviewer\nmodel: inherit\ntools: Read, Glob, Grep, Bash\n---\nYour only review criterion is file structure. Read dsh-verification.txt and check that its first three nonempty lines respectively match SKILL-[16 hexadecimal characters], MCP-[16 hexadecimal characters], HISTORY-[16 hexadecimal characters]. The parent separately verifies the actual MCP/history values; do not repeat those checks, request their tools, or add acceptance criteria. If the structure passes, return exactly ${reviewerSecret}. Return failure only for missing file or invalid structure. This is an independent review, not a parent Task/Run response: do not output JSON.\n`);
const hookLog=join(root,'source-hook.log');
await writeFile(join(plugin,'hooks/hooks.json'),JSON.stringify({hooks:{PreToolUse:[{matcher:'Task|Agent',hooks:[{type:'command',command:`node -e 'require("node:fs").appendFileSync(${JSON.stringify(hookLog)},"invoked\\n")'`}]}]}}));
await writeFile(join(plugin, 'skills', 'dsh-evidence', 'SKILL.md'), `---\nname: dsh-evidence\ndescription: Use for the DeepSeek Harness integration verification task and dsh-verification.txt delivery.\n---\nThe first line of dsh-verification.txt must be exactly ${skillSecret}. Obtain the second line from the selected MCP read_probe tool, and the third line from platform communication history. Never invent either value. Write those three lines first. Then call Task or Agent with subagent_type dsh-evidence:reviewer and prompt asking to independently check dsh-verification.txt. Append its exact result as the fourth line. Do not replace the independent agent with a Skill or your own review.\n`);
const mcpFile = join(root, 'mcp.mjs');
await writeFile(mcpFile, `import {Server} from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'))};\nimport {StdioServerTransport} from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};\nimport {ListToolsRequestSchema,CallToolRequestSchema} from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/types.js'))};\nconst s=new Server({name:'DeepSeek Harness verification',version:'1.0.0'},{capabilities:{tools:{}}});s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'read_probe',description:'Read the random MCP verification value',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));s.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:${JSON.stringify(mcpSecret)}}]}));await s.connect(new StdioServerTransport());\n`);
const app = await electron.launch({ ...(bundle ? { executablePath: resolve(bundle, 'Contents/MacOS/AgentForge') } : { args: ['apps/electron/main.mjs'] }), env: { ...process.env, HOME: home, DSH_HOME: process.env.DSH_HOME || join(homedir(), '.dsh'), AGENTFORGE_DESKTOP_DATA_ROOT: data, AGENTFORGE_LOG_DIR: join(root, 'logs') }, timeout: 180000 });
const evidence = { root, provider: 'dsh', realModel: true, cases: [] };
console.log('EVIDENCE ' + root);
const wait = async (label, check) => { const start = Date.now(); let logged = 0; for (;;) { const result = await check(); if (result) return result; if (Date.now() - start > 12 * 60000) throw new Error('Timed out: ' + label); if (Date.now() - logged > 30000) { console.log('WAIT ' + label); logged = Date.now(); } await new Promise(done => setTimeout(done, 1500)); } };
try {
  const page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 60000 });
  const origin = new URL(page.url()).origin;
  const api = (path, body, method = 'POST') => page.evaluate(async ({ path, body, method }) => { const r = await fetch(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); const value = await r.json(); if (!r.ok) throw new Error(path + ': ' + JSON.stringify(value)); return value; }, { path, body, method });
  await page.goto(origin + '/login'); await page.locator('#username').fill('dsh-qa'); await page.locator('#password').fill(password); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('#account-name').waitFor();
  const { profiles } = await api('/api/settings/runtime-profiles', null, 'GET'), slot = profiles.find(p => p.provider === 'dsh'); assert.ok(slot); assert.equal(profiles.length, 3);
  const catalog = await api('/api/settings/runtime-profiles/models?provider=dsh', null, 'GET'); assert.ok(catalog.models.length);
  const model = process.env.AGENTFORGE_DSH_MODEL || catalog.models[0].id;
  await api('/api/settings/runtime-profiles/' + slot.id, { model, effort: 'off' }, 'PUT');
  await page.goto(origin + '/settings/runtime'); await page.getByRole('switch', { name: 'DeepSeek Harness 可用', exact: true }).waitFor();
  await page.getByLabel('DeepSeek Harness 配置', { exact: true }).click();
  await page.screenshot({ path: join(root, 'runtime-wide.png') });
  for (const theme of ['minimal', 'warm']) for (const width of [1320, 760]) {
    await page.goto(origin + '/settings/appearance'); await page.locator(`[name=theme][value=${theme}]`).check();
    await app.evaluate(({BrowserWindow}, {origin,width}) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(origin)).setContentSize(width,760), {origin,width});
    await page.waitForFunction(expected => innerWidth === expected, width);
    await page.goto(origin + '/settings/runtime'); const row=page.locator(`[data-runtime-profile="${slot.id}"]`); await row.locator('summary').click();
    assert.equal(await row.locator('[name=model]').inputValue(), model);
    assert.equal(await row.locator('[name=effort]').inputValue(), 'off');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({path:join(root,`runtime-${theme}-${width}.png`)});
  }
  evidence.cases.push('real DeepSeek Harness catalog and fixed Runtime UI, two themes/wide/narrow');
  // Exercise actual CLI HTTP authentication and DeepSeek Harness command/schema resolution.
  const cli = (args, stdin = '') => new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['cli/main.mjs', ...args, '--endpoint-file', join(data, 'desktop-endpoint.json'), '--session-file', join(root, 'cli', 'session.json'), '--json'], { env: { ...process.env, HOME: home, PATH: root + ':' + process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] }); let output = '', error = '';
    child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { error += part; }); child.on('error', reject); child.on('close', code => code === 0 ? resolvePromise(JSON.parse(output).data) : reject(new Error('CLI failed: ' + error))); child.stdin.end(stdin);
  });
  await cli(['auth', 'login', '--username', 'dsh-qa', '--password-stdin'], password + '\n');
  assert.ok((await cli(['runtimes', 'list'])).items.some(p => p.provider === 'dsh'));
  assert.ok((await cli(['runtimes', 'models', 'dsh'])).models.length);
  await cli(['runtimes', 'update', 'dsh', '--file', '-'], JSON.stringify({ effort: 'off' }));
  evidence.cases.push('actual DeepSeek Harness CLI list/models/update');
  const imported = await api('/api/runtime/marketplace', { path: plugin }); const pluginId = imported.plugins[0].id; assert.ok(imported.plugins[0].providers.includes('dsh'));
  const mcpResult = await api('/api/runtime/mcp-marketplace', { name: 'DeepSeek Harness verification', description: 'Isolated native MCP', content: JSON.stringify({ mcpServers: { verification: { command: process.execPath, args: [mcpFile] } } }) });
  const mcpId = mcpResult.entry?.id || mcpResult.id;
  assert.ok(mcpId, 'MCP creation returns its installed ID');
  const { role } = await api('/api/roles', { name: 'DeepSeek Harness verification role', prompt: `交接 summary 必须包含 ${roleSecret}。保持普通 JSON 协议。` });
  await page.goto(origin + '/agents'); await page.getByRole('button', {name:'＋ 创建数字员工',exact:true}).click();
  const form=page.locator('#agent-form'); await form.waitFor();
  assert.deepEqual(await form.locator('[name=runtimeProfileId] option').allTextContents(), ['Claude Code','Codex','DeepSeek Harness']);
  await form.locator('[name=name]').fill('DeepSeek Harness worker'); await form.locator('[name=runtimeProfileId]').selectOption(slot.id);
  await form.locator('#employee-role').fill(role.name);
  await form.locator(`#employee-role-options [data-add-extension="${role.id}"]`).click();
  const {role:secondRole}=await api('/api/roles',{name:'Additional verification role',prompt:'交接 summary 必须包含 MULTI_ROLE_SECOND。'});
  // Reload the employee form so its role directory contains the additional role.
  // The second role is set through the same authenticated employee command after creation.
  await form.locator('[name=systemPrompt]').fill('完成指定文件后简明交接，不作额外交付。');
  await form.locator('#employee-plugin-search').fill('dsh-evidence'); await form.locator(`[data-add-extension="${pluginId}"]`).click();
  await form.locator('#employee-mcp-search').fill('DeepSeek Harness verification'); await form.locator(`[data-add-extension="${mcpId}"]`).click();
  await page.screenshot({path:join(root,'employee-dsh-selection.png')});
  const created=page.waitForResponse(response => response.url().endsWith('/api/agents') && response.request().method()==='POST');
  await form.getByRole('button',{name:'创建数字员工',exact:true}).click();
  const response=await created; assert.equal(response.status(),201); const {agent:worker}=await response.json();
  assert.equal(worker.runtime.provider,'dsh'); assert.deepEqual(worker.roleIds,[role.id]);
  await api('/api/agents/'+worker.id,{roleIds:[role.id,secondRole.id]},'PUT');
  evidence.cases.push('actual employee UI selects DeepSeek Harness, role, native Skill and MCP');
  const { agent: manager } = await api('/api/agents', { name: 'DeepSeek Harness manager', kind: 'manager', systemPrompt: '只安排唯一节点给 DeepSeek Harness worker，收到交接后提交人类验收。不要自行代做文件，不添加流程节点。', runtime: { profileId: slot.id, extensionSelection: { pluginIds: [], mcpIds: [] } } });
  const { conversation } = await api('/api/communications', { kind: 'agent', targetId: worker.id });
  await api(`/api/communications/${conversation.id}/messages`, { content: `请记住历史校验值 ${historySecret}，回复 ok 即可，不使用工具。`, clientRequestId: secret('request-') });
  await wait('real DeepSeek Harness communication', async () => { const value = await api('/api/communications/' + conversation.id, null, 'GET'); const failure = value.deliveries.find(d => d.status === 'failed'); if (failure) throw new Error(failure.error); return value.deliveries.length && value.deliveries.every(d => d.status === 'done') ? value : null; });
  const { team } = await api('/api/teams', { name: 'DeepSeek Harness real team', memberAgentIds: [...new Set([worker.id, manager.id])] });
  const { workflowTemplate: workflow } = await api('/api/workflow-templates', { name: 'DeepSeek Harness real flow', nodes: [{ id: 'verify', title: 'DeepSeek Harness verification', staffingGuidance: 'DeepSeek Harness worker', deliverable: 'dsh-verification.txt', artifactPaths: ['dsh-verification.txt'], dependsOn: [] }] });
  const { task } = await api('/api/tasks', { title: 'DeepSeek Harness native integration verification', objective: '经理开工前必须先向人类确认文件名是否采用 dsh-verification.txt；得到肯定回复后，安排唯一节点给 DeepSeek Harness worker：使用 dsh-evidence Skill，调用选中的验证 MCP 读取随机值，并用平台历史工具查找此前与人类沟通中保存的历史校验值。按 Skill 要求写出 dsh-verification.txt 的三行内容，完成后交接经理，经理提交人类验收。不要猜值，除文件名确认外不需要人类提供新材料。', memberAgentIds: team.memberAgentIds, workflowTemplateId: workflow.id });
  assert.equal(task.repositoryMode,'workspace');assert.deepEqual(task.repositorySources,[]);assert.deepEqual(task.repositoryBindings,{});
  await api('/api/roles/' + role.id, { prompt: '后续任务的新角色说明，不应覆盖已有任务冻结角色。' }, 'PUT');
  const { run } = await api('/api/tasks/' + task.id + '/run', {}); evidence.taskId = task.id; evidence.runId = run.id;
  const answered = new Set();
  const workspace = await wait('real DeepSeek Harness task to human acceptance', async () => { const value = await api('/api/runs/' + run.id + '/workspace?view=summary', null, 'GET'); for (const question of value.pendingQuestions.filter(q => q.recipient.type === 'human')) { if (answered.has(question.id)) continue; await api('/api/runs/' + run.id + '/messages', { content: '确认采用 dsh-verification.txt，请继续既定验证任务。', replyToMessageId: question.id }); answered.add(question.id); } if (['failed', 'paused', 'terminated'].includes(value.run.status)) throw new Error('Run stopped: ' + JSON.stringify(value.run.failure)); return value.run.status === 'awaiting_acceptance' ? value : null; });
  assert.ok(answered.size, 'real model clarification required an exact human reply');
  assert.ok(workspace.messages.some(message=>message.sender?.id===worker.id && message.content.includes('MULTI_ROLE_SECOND')),'second role governs the real worker handoff');
  evidence.cases.push('real clarification and exact human reply');
  const managerTraces = workspace.traces.filter(trace => trace.type === 'manager');
  assert.ok(managerTraces.some(trace => trace.sessionMode === 'resume'), 'manager native identity is confirmed before its next coordination');
  assert.equal(new Set(managerTraces.map(trace => trace.providerSessionId).filter(Boolean)).size, 1, 'manager keeps one native session');
  const workerTrace = workspace.traces.find(trace => trace.agentId === worker.id && trace.type === 'node' && trace.status === 'completed'); assert.ok(workerTrace);
  const consolePage = await api(`/api/runs/${run.id}/console?agentId=${worker.id}&limit=500`, null, 'GET');
  const calls = consolePage.events.filter(event => event.data?.presentation === 'tool').map(event => event.data.toolName);
  assert.ok(calls.includes('skill'), 'DeepSeek Harness activated the selected Skill natively');
  assert.ok(calls.some(name => name?.includes('read_probe')), 'DeepSeek Harness called the selected MCP');
  assert.ok(calls.some(name => name?.includes('agentforge_history')), 'DeepSeek Harness queried platform history');
  assert.ok(calls.includes('Task') || calls.includes('Agent'),'source subagent was invoked through the real native child adapter');
  assert.ok(consolePage.events.some(event=>event.data?.providerEventType==='dsh.subagent' || event.message==='插件子代理已开始独立执行'),'independent child lifecycle is audited');
  assert.match(await readFile(hookLog,'utf8'),/invoked/,'source command Hook actually ran');
  evidence.sourceDialect=sourceDialect;evidence.cases.push('source-standard independent subagent and command Hook actually executed');
  const results=consolePage.events.filter(event => event.data?.presentation === 'tool_result');
  const callIds=new Set(consolePage.events.filter(event => event.data?.presentation === 'tool').map(event => event.data.toolUseId));
  assert.ok(results.length && results.every(event => callIds.has(event.data.toolResultId) && event.data.contentRef), 'native tool results pair with calls and retain public output');
  evidence.nativeToolCalls = calls;
  const file = await readFile(join(workspace.run.workspacePath || workspace.task.workspacePath, 'dsh-verification.txt'), 'utf8');
  assert.deepEqual(file.trim().split(/\r?\n/), [skillSecret, mcpSecret, historySecret, reviewerSecret]);
  const instructions=JSON.parse(await readFile(join(data,'agentforge-runs','runs',run.id,'traces',workerTrace.id,'dsh-instructions.json'),'utf8'));
  assert.ok(instructions.systemPrompt.includes(roleSecret), 'frozen role is part of the actual application instructions');
  assert.ok(consolePage.events.some(event => event.data?.subtype === 'dsh_instructions_applied' && event.data.systemPromptApplied), 'DeepSeek Harness native system message contains those exact application instructions');
  // Delivery is a Runtime contract; arbitrary model obedience is an observed
  // outcome. Keep both facts, including a missed probe, instead of claiming
  // that writing a prompt file alone proves delivery or forcing the output.
  evidence.roleDeliveredToNativeSystem=true;
  evidence.roleProbeFollowed=workspace.messages.some(message => message.sender.id===worker.id && message.content.includes(roleSecret));
  if(!evidence.roleProbeFollowed) console.log('OBSERVATION model omitted the role marker; native system delivery verified separately');
  await page.goto(origin + '/runs/' + run.id); await page.getByRole('button', { name: '确认完成', exact: true }).waitFor();
  await page.screenshot({ path: join(root, 'human-acceptance.png') });
  await page.getByRole('button', { name: '确认完成', exact: true }).click();
  await page.locator('#ack-completion').check();
  await page.locator('#confirm-completion').click();
  await wait('visible human confirmation', async () => (await api('/api/runs/' + run.id + '/workspace?view=summary', null, 'GET')).run.status === 'completed');
  await page.goto(origin + '/runs/' + run.id);
  await page.locator('#instruction-text').fill('请简短说明本次交付是否已完成。这是完成后的咨询，无需执行业务操作。');
  const sentResponse = page.waitForResponse(response => response.url().endsWith('/api/runs/' + run.id + '/messages') && response.request().method() === 'POST');
  await page.locator('[data-send-instruction]').click();
  const sent = await (await sentResponse).json();
  assert.equal(sent.message.recipient.id, run.manager.id); assert.equal(sent.interactionOnly, true);
  await wait('unmentioned UI inquiry answered by real manager', async () => {
    const current = await api('/api/runs/' + run.id + '/workspace?view=summary', null, 'GET');
    assert.equal(current.run.status, 'completed');
    return current.messages.find(message => message.kind === 'inquiry_answer' && message.replyToMessageId === sent.message.id && message.sender.id === run.manager.id && message.content.trim());
  });
  const cliSent = await cli(['tasks', 'message', task.id, '--file', '-'], JSON.stringify({ content: '请用一句话说明交付状态，仅咨询。' }));
  assert.equal(cliSent.message.recipient.id, run.manager.id);
  await wait('unaddressed CLI inquiry answered by real manager', async () => {
    const current = await api('/api/runs/' + run.id + '/workspace?view=summary', null, 'GET');
    assert.equal(current.run.status, 'completed');
    return current.messages.find(message => message.kind === 'inquiry_answer' && message.replyToMessageId === cliSent.message.id && message.sender.id === run.manager.id);
  });
  await page.goto(origin + '/runs/' + run.id); await page.locator('.collaboration-row').first().waitFor();
  assert.equal(await page.locator('.collaboration-toolbar small, .collaboration-reference, .human-guide').count(), 0);
  await page.screenshot({ path: join(root, 'default-manager-inquiry.png') });
  evidence.cases.push('unmentioned UI and unaddressed CLI inquiries answered by real manager after completion, without reopening workflow or repeated quoted questions');
  await api('/api/tasks/' + task.id + '/archive', {});
  evidence.cases.push('real native Skill/MCP/history and frozen-role task', 'visible human confirmation and archive');
  evidence.result = 'PASS'; await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log('PASS DeepSeek Harness real acceptance:', root);
} catch (error) { evidence.result = 'FAIL'; evidence.error = error.message; await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); throw error; }
finally { await app.close(); }
