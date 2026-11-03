import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { desktopServiceStoragePaths } from '../data-home.mjs';
import { cliEnvironment } from './cli-environment.mjs';
import { registerExecution, hasActiveExecution } from './registry.mjs';
import { diagnostic } from '../diagnostics.mjs';
import { diagnoseLaunch } from './launch-diagnostics.mjs';
import { selectedExtensions, nativePluginRuntime } from './extensions.mjs';
import { fileURLToPath } from 'node:url';
import { readPluginExecutionPlan } from './marketplace.mjs';
import { parsePluginMarkdown, dshHookMatchers } from './plugin-compatibility.mjs';

export const DSH_EFFORT_LEVELS = ['off', 'low', 'high', 'max'];
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : undefined;
const text = blocks => (blocks || []).filter(block => block.type === 'text').map(block => block.text || '').join('\n');

export function normalizeDshEvent(event, content, prompt = '', applicationInstructions = '') {
  const data = event.data || {}, base = { auditVersion: 2 };
  if (event.type === 'system/message' && applicationInstructions && text(data.message?.content).includes(applicationInstructions)) return [{ providerEventType: 'system', message: 'Provider 会话已初始化', data: { ...base, presentation: 'system', subtype: 'dsh_instructions_applied', systemPromptApplied: true } }];
  if (event.type === 'assistant/message') return (data.message?.content || []).flatMap(block => {
    if (!['text', 'reasoning'].includes(block.type) || !block.text) return [];
    return [{ providerEventType: 'dsh.assistant', message: block.type === 'reasoning' ? '模型正在整理执行方案' : '模型已更新执行进展', data: { ...base, presentation: block.type === 'reasoning' ? 'thinking' : 'output' }, content: content({ [block.type === 'reasoning' ? 'thinking' : 'text']: block.text }, prompt) }];
  });
  if (event.type === 'tool/call') return [{ providerEventType: 'dsh.tool.call', message: '已请求本机工具', data: { ...base, presentation: 'tool', toolName: identifier(data.name) || '本机工具', toolUseId: identifier(data.callId), status: 'running' }, content: content({ input: data.arguments }, prompt) }];
  if (event.type === 'tool/result') return [{ providerEventType: 'dsh.tool.result', message: data.message?.isError ? '本机工具执行失败' : '本机工具已返回结果', data: { ...base, presentation: 'tool_result', toolResultId: identifier(data.message?.toolCallId || data.message?.callId), status: data.message?.isError ? 'failed' : 'completed' }, content: content({ output: text(data.message?.content) || data.error?.reason }, prompt) }];
  if (event.type === 'hook/invoked' || event.type === 'hook/result') return [{providerEventType:`dsh.${event.type.replace('/','.')}`,message:event.type==='hook/invoked'?'插件 Hook 已开始执行':'插件 Hook 已返回决策',data:{...base,presentation:'system',hookEvent:identifier(data.point),status:event.type==='hook/invoked'?'running':data.exitCode===0?'completed':'failed',decision:identifier(data.decision)}}];
  if (event.type === 'turn/end') return [{ providerEventType: 'dsh.turn.end', message: data.reason?.kind === 'completed' ? 'Provider 已结束本轮执行' : 'Provider 本轮未完成', data: { ...base, presentation: data.reason?.kind === 'completed' ? 'system' : 'error' } }];
  // System/user messages, request headers and native replay metadata may carry
  // full prompts or signatures. They never become public execution content.
  return [];
}

async function launch(input, { content = () => null, cancelledError = message => new Error(message), missingSessionError = message => new Error(message), catalog = false } = {}) {
  const runtime = input.runtime || { provider: 'dsh' }, command = runtime.executable || 'dsh';
  const key = input.executionKey || input.runId || `dsh-catalog-${randomUUID()}`;
  const sessionId = input.session?.sessionId || randomUUID();
  if (!/^[A-Za-z0-9-]{16,100}$/.test(sessionId)) throw new Error('DeepSeek Harness 会话 ID 无效');
  const temporary = !input.traceDirectory;
  const directory = input.traceDirectory || await mkdtemp(join(tmpdir(), 'agentforge-dsh-catalog-'));
  const env = cliEnvironment(command), credentialHome = env.DSH_HOME || join(homedir(), '.dsh');
  const nativeHome = catalog || !input.session ? join(directory, 'home') : join(desktopServiceStoragePaths().runtimeConfigRoot, 'dsh', sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(nativeHome, { recursive: true, mode: 0o700 });
  const plugin = join(directory, 'dsh-agentforge.mjs'), instructionsPath = join(directory, 'dsh-instructions.json'), patch = join(directory, 'dsh-patch.yml');
  await writeFile(plugin, await readFile(new URL('./dsh-plugin.mjs', import.meta.url)), { mode: 0o600 });
  const servers = catalog ? {} : await selectedExtensions(runtime);
  const nativeRuntime=catalog?runtime:await nativePluginRuntime(runtime,directory);
  await writeFile(join(directory,'dsh-extensions.mjs'),await readFile(new URL('./dsh-extensions.mjs',import.meta.url)),{mode:0o600});
  const plugins=[];
  for(const ref of catalog ? [] : (runtime.extensionManifest || []).filter(item=>item.kind==='plugin' && [2,3].includes(item.adapterVersion))) {
    const plan=await readPluginExecutionPlan(ref),root=dirname(dirname(ref.path));
    const agents=await Promise.all(plan.agents.map(async agent=>({...agent,body:parsePluginMarkdown(await readFile(join(root,agent.path),'utf8')).body})));
    plugins.push({name:JSON.parse(await readFile(ref.path,'utf8')).name,root,sourceDialect:plan.sourceDialect,agents,hooks:dshHookMatchers(plan.hooks,plan.sourceDialect)});
  }
  if(plugins.some(item=>item.hooks.length)) for(const name of ['hooks-claude-code.mjs','hooks-codex.mjs','hook-protocol.mjs','hook-guard.mjs']) await writeFile(join(directory,name),await readFile(new URL(`./vendor/dsh-hooks/${name}`,import.meta.url)),{mode:0o600});
  await writeFile(instructionsPath, JSON.stringify({ systemPrompt: input.systemPrompt || '', outputSchema: input.outputSchema,plugins,workspacePath:input.workspacePath,workspaceHook:input.workspaceHook }), { mode: 0o600 });
  const entries = Object.entries(servers).map(([name, { ref }]) => ({ id: `agentforge-mcp-${ref.id}`, name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: ref.mcpAdapterVersion===2 ? name : `market_${ref.id.replaceAll('-', '').slice(0, 24)}`, command: process.execPath, args: [fileURLToPath(new URL('./mcp-launcher.mjs', import.meta.url)), ref.path, ref.sha256, name], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}, failOnStartupError: true } }));
  if (input.historyMcp) entries.push({ id: 'agentforge-history', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'agentforge_history', command: input.historyMcp.command, args: input.historyMcp.args, env: input.historyMcp.env || {}, failOnStartupError: true } });
  entries.push({ id: 'agentforge', name: plugin, config: { instructionsPath } });
  const rows = [
    { id: 'credentials', config: { path: join(credentialHome, '.credentials.yaml'), watch: false } },
    { id: 'skill-filesystem', config: { includeDefaultRoots: false, customSkillDirs: (nativeRuntime.skillPaths || []).map(path => dirname(path)), watch: false } },
    { id: 'skill-office', disabled: true },
    { id: 'sdk-jsonrpc-server', config: { maxTokensAsSuccess: false } },
    { insert: entries }
  ];
  await writeFile(patch, JSON.stringify(rows), { mode: 0o600 });
  if (input.canStart && !input.canStart()) throw cancelledError('执行在启动前已暂停或终止');
  if (hasActiveExecution(key)) throw new Error('该执行会话已有本地 Agent 进程在执行');
  const child = spawn(command, ['sdk', '--patch', patch], { cwd: input.workspacePath || directory, env: { ...env, DSH_HOME: nativeHome, DSH_PERMISSION_MODE: 'danger-full-access', DSH_PRIMARY_RUNTIME: '', DSH_BUNDLED_OFFICE_CLI: '', AGENTFORGE_TRACE_OUTPUT_DIR: join(directory, 'output') }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const pending = new Map(); let serial = 0, failure, closed = false, stopping = false, graceful = false, cancelled, idle, killTimer, finalText = '', reason, nativeWaiting = false, stderr = '';
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }); ready.catch(() => {});
  const exit = new Promise(resolve => child.once('close', (code, signal) => { closed = true; resolve({ code, signal }); }));
  const signal = name => { try { process.platform === 'win32' ? child.kill(name) : process.kill(-child.pid, name); } catch {} };
  const stop = () => { stopping = true; clearTimeout(idle); if (closed) return; signal('SIGTERM'); killTimer ||= setTimeout(() => { if (!closed) signal('SIGKILL'); }, 3000); killTimer.unref(); };
  const abort = error => { failure ||= error; rejectReady(failure); for (const waiter of pending.values()) waiter.reject(failure); pending.clear(); stop(); };
  const touch = () => { clearTimeout(idle); if (!stopping && !graceful && !nativeWaiting) { idle = setTimeout(() => abort(new Error('DeepSeek Harness 超过等待时间未产生可审计进展事件')), input.idleTimeoutMs || (catalog ? 30000 : 600000)); idle.unref(); } };
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const id = ++serial; pending.set(id, { method, resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const unregister = registerExecution(key, { terminate(message) { cancelled = cancelledError(message); abort(cancelled); } });
  child.on('error', error => { diagnostic('provider.spawn_error', { error }); void diagnoseLaunch({ command, cwd: input.workspacePath || directory, searchPath: env.PATH, provider: 'DeepSeek Harness' }).then(value => diagnostic('provider.launch_diagnostic', value)).catch(() => {}); abort(error); });
  child.stdin.on('error', error => { if (!closed) abort(error); });
  child.once('close', (code, signal) => { if (!stopping && !graceful) abort(new Error(`DeepSeek Harness 进程提前退出 (${code ?? signal})${stderr ? ': ' + stderr.slice(-2000) : ''}`)); });
  const errors = createInterface({ input: child.stderr });
  const stderrTask = (async () => { for await (const line of errors) { stderr = (stderr + '\n' + line).slice(-8000); diagnostic('provider.stderr', { text: line }); } })();
  const reader = createInterface({ input: child.stdout });
  const receive = (async () => {
    try {
      for await (const line of reader) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line); touch();
        if (frame.id !== undefined && !frame.method) {
          const waiter = pending.get(frame.id); if (!waiter) continue; pending.delete(frame.id);
          if (frame.error) { const error = new Error(`DeepSeek Harness ${waiter.method}: ${frame.error.message}`); error.rpcCode = frame.error.code; waiter.reject(error); }
          else waiter.resolve(frame.result);
          continue;
        }
        if (frame.method === 'agentforge.ready') { if (frame.params?.error) rejectReady(new Error(frame.params.error)); else if (frame.params?.version !== 1) rejectReady(new Error('DeepSeek Harness Bridge 协议不兼容')); else resolveReady(frame.params); continue; }
        if (frame.method === 'agentforge.extension_failure') throw new Error(frame.params?.message || '插件兼容执行失败');
        if (frame.method === 'agentforge.subagent') {await input.onEvent?.({providerEventType:'dsh.subagent',message:frame.params?.phase==='started'?'插件子代理已开始独立执行':'插件子代理已结束',data:{auditVersion:2,presentation:'system',subagentId:identifier(frame.params?.id),status:identifier(frame.params?.status)}});continue;}
        if (frame.method !== 'session.event' || frame.params?.sessionId !== sessionId) continue;
        const event = frame.params.event;
        if (event.type === 'turn/start') { nativeWaiting = false; touch(); }
        if (event.type === 'assistant/message') finalText = text(event.data?.message?.content);
        if (event.type === 'turn/end') { reason = event.data?.reason; nativeWaiting = reason?.kind === 'completed'; touch(); }
        for (const normalized of normalizeDshEvent(event, content, [input.systemPrompt, input.prompt].filter(Boolean).join('\n'), input.systemPrompt || '')) await input.onEvent?.(normalized);
      }
    } catch (error) { abort(error); }
  })();
  touch();
  try {
    const info = await ready;
    if (catalog) { graceful = true; await request('shutdown'); const status = await exit; if (status.code !== 0) throw new Error(`DeepSeek Harness 退出失败 (${status.code ?? status.signal})`); return info.models; }
    const model = runtime.model || info.models?.[0]?.id;
    if (!model) throw new Error('DeepSeek Harness 没有可用模型，请先在 DeepSeek Harness 中配置模型和登录授权');
    const split = model.indexOf('/'), provider = split < 0 ? 'deepseek-official' : model.slice(0, split), modelId = split < 0 ? model : model.slice(split + 1);
    const initialized = await request('initialize', { cwd: input.workspacePath, provider, model: modelId, ...(runtime.effort ? { reasoningEffort: runtime.effort } : {}) });
    if (initialized?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') throw new Error('DeepSeek Harness SDK 握手身份不兼容');
    if (input.session?.resume) {
      try { await request('session/resume', { sessionId }); }
      catch (error) { if (/missing|not found|does not exist|unknown session/i.test(error.message)) throw missingSessionError('DeepSeek Harness 未找到指定会话'); throw error; }
    }
    await request('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text: input.prompt }] });
    await input.onEvent?.({ providerEventType: 'thread.started', message: '成员会话已连接', data: { auditVersion: 2, presentation: 'system', sessionId } });
    // The SDK wait owns child/background completion; the first turn/end is not
    // the end of the invocation. Its response follows all preceding events.
    await request('session/wait', { sessionId });
    if (reason?.kind !== 'completed') throw new Error(`DeepSeek Harness 本轮未完成：${reason?.kind || '缺少结束事件'}`);
    if (!finalText.trim()) throw new Error('DeepSeek Harness 未返回可验证的最终结构化结果');
    if (input.outputSchema) { try { JSON.parse(finalText); } catch { throw new Error('DeepSeek Harness 未返回有效的 JSON 结果'); } }
    graceful = true;
    await request('shutdown');
    const status = await exit;
    if (status.code !== 0) throw new Error(`DeepSeek Harness 退出失败 (${status.code ?? status.signal})`);
    await writeFile(input.finalPath, finalText, { mode: 0o600 });
    return { finalText };
  } finally {
    clearTimeout(idle); unregister(); stop(); await exit; if (!graceful) signal('SIGKILL'); clearTimeout(killTimer);
    await Promise.allSettled([receive, stderrTask]);
    if (temporary) await rm(directory, { recursive: true, force: true });
    if (cancelled) throw cancelled;
    if (failure) throw failure;
  }
}

export function runDshSdk(input, helpers) { return launch(input, helpers); }
export async function dshModelCatalog() {
  const models = await launch({}, { catalog: true });
  return { provider: 'dsh', source: '本机 DeepSeek Harness SDK 原生模型目录', notes: ['使用独立 DeepSeek Harness SDK 配置，仅由 DeepSeek Harness 读取本机凭据；不加载全局插件或 Skill。', '模型使用 Provider/模型 ID；无前缀时采用 deepseek-official。当前接入内置 DeepSeek API Key/账号路由，不导入用户自定义 pi-ai 路由。', '目录可见不等于调用成功；逐模型思考等级来自 DeepSeek Harness 原生元数据。'], models };
}
