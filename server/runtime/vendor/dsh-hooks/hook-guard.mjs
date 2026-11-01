// AgentForge adapter around the unmodified MIT upstream protocol. Unsupported
// dynamic output must fail the invocation, never become a warning + success.
export * from './hook-protocol.mjs';
import {runHook as upstream} from './hook-protocol.mjs';
export async function runHook(shell,hook,options,now) {
  const result = await upstream(shell,hook,options,now);
  const output = result.output;
  const field = ['updatedInput','systemMessage'].find(key=>output[key] !== undefined) || (output.continue === false ? 'continue:false' : output.decision==='ask' ? 'permissionDecision:ask' : null);
  if (field) {
    const message = `插件 Hook 返回 ${field}，当前 DeepSeek Harness 桥无法等价执行`;
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agentforge.extension_failure',params:{message}})+'\n');
    throw new Error(message);
  }
  return result;
}
