// Materialized into a private invocation directory for the external DeepSeek Harness Node
// process; never imported into the HTTP service or renderer.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mountExtensions } from './dsh-extensions.mjs';

export const name = 'agentforge-dsh';
export const inject = ['systemPrompt', 'loader', 'llm', 'tools', 'subagents'];

export async function apply(ctx, config) {
  // The installed MCP SDK uses console.debug for capability diagnostics.
  // In an SDK deployment stdout belongs to JSON-RPC, including during tool
  // execution. Redirect only this process's diagnostic console, never a tool
  // subprocess's environment or stdout.
  console.debug = console.error.bind(console);
  const instructions = JSON.parse(await readFile(config.instructionsPath, 'utf8'));
  if (instructions.workspaceHook) ctx.on('tools/post-execute', async (_exec, _result, next) => {
    await new Promise(resolve => {
      const request=http.request({socketPath:instructions.workspaceHook.socket,path:'/register',method:'POST'},response=>{response.resume();response.on('end',resolve);});
      request.setTimeout(30000,()=>request.destroy());request.on('error',resolve);request.end();
    });
    return next();
  });
  if (instructions.systemPrompt) ctx.systemPrompt.section({ name: 'agentforge:application', order: 20000, text: instructions.systemPrompt, interpolate: false });
  if (instructions.outputSchema) ctx.systemPrompt.section({ name: 'agentforge:response', order: 20010, text: `仅输出符合以下 JSON Schema 的一个 JSON 对象，不添加 Markdown 围栏或额外说明：\n${JSON.stringify(instructions.outputSchema)}`, interpolate: false });
  // Do not make Loader readiness depend on its own readiness barrier.
  queueMicrotask(async () => {
    try {
      await ctx.loader.await();
      await mountExtensions(ctx, instructions, dirname(config.instructionsPath));
      const models = [];
      for (const provider of ctx.llm.listProviders()) {
        for (const model of await ctx.llm.listModels(provider.id)) {
          const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id);
          models.push({ id: `${provider.id}/${model.id}`, label: model.name || model.id, description: model.description || '', levels: (resolved.reasoning?.efforts || []).map(level => ({ id: level.id, description: level.description || level.name || '', default: level.id === resolved.reasoning?.defaultEffort })) });
        }
      }
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'agentforge.ready', params: { version: 1, models } }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'agentforge.ready', params: { version: 1, error: error.message } }) + '\n');
    }
  });
}
