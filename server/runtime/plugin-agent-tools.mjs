// Private Codex Hook adapter for source subagent tool selection. This is a
// native tool-surface mapping, not an OS sandbox or a domain permission gate.
import {readFile,mkdir,writeFile,realpath,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

export function sourceToolAllowed(policy,tool) {
  const matches=(pattern,name)=>pattern===name || (pattern.endsWith('*') && name.startsWith(pattern.slice(0,-1)));
  const aliases=tool==='apply_patch'?['Write','Edit']:tool==='web_search'?['WebSearch']:[tool];
  if(policy.deniedTools?.some(pattern=>aliases.some(name=>matches(pattern,name)))) return false;
  return !policy.tools || policy.tools.some(pattern=>aliases.some(name=>matches(pattern,name)));
}
export async function subagentToolDecision(configuration,input) {
  await mkdir(configuration.stateDirectory,{recursive:true,mode:0o700});
  await appendFile(join(configuration.stateDirectory,'invocations.jsonl'),JSON.stringify({event:input.hook_event_name,sessionId:input.session_id,agentId:input.agent_id,agentType:input.agent_type})+'\n',{mode:0o600});
  const identity=value=>typeof value==='string' && /^[\w:.-]{1,200}$/.test(value);
  const statePath=id=>join(configuration.stateDirectory,createHash('sha256').update(id).digest('hex')+'.json');
  if(input.hook_event_name==='SubagentStart') {
    const policy=configuration.agents[input.agent_type];
    if(policy && identity(input.agent_id)) {
      await mkdir(configuration.stateDirectory,{recursive:true,mode:0o700});
      await writeFile(statePath(input.agent_id),JSON.stringify(policy),{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    }
    return null;
  }
  // Codex retains the root session_id in child Hook payloads. agent_id is
  // the actual child identity; using session_id would miss every child call.
  const callerId=input.agent_id || input.session_id;
  if(input.hook_event_name!=='PreToolUse' || !identity(callerId)) return null;
  // Native agent_type also survives a later parent invocation. Prefer the
  // current frozen role map; the recorded child id supports older payloads.
  let policy=input.agent_id && configuration.agents[input.agent_type];
  if(!policy)try {policy=JSON.parse(await readFile(statePath(callerId),'utf8'));}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    if(input.agent_id && /^af_[a-f0-9]{32}_\d+_[a-z0-9_]+$/.test(input.agent_type || '')) return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'源子代理已不在本次选中的插件配置中'}};
    return null;
  }
  const allowed=sourceToolAllowed(policy,input.tool_name);
  await appendFile(join(configuration.stateDirectory,'decisions.jsonl'),JSON.stringify({sessionId:input.session_id,agentId:callerId,tool:input.tool_name,allowed})+'\n',{mode:0o600});
  if(allowed)return null;
  return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'所选源子代理未启用此工具'}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(await realpath(process.argv[1])).href) {
  try {
    let input='';for await(const part of process.stdin){input+=part;if(Buffer.byteLength(input)>1024*1024)throw new Error('Hook input too large');}
    const decision=await subagentToolDecision(JSON.parse(await readFile(process.argv[2],'utf8')),JSON.parse(input));
    if(decision)process.stdout.write(JSON.stringify(decision)+'\n');
  }catch {process.stderr.write('Selected source subagent tool configuration is unavailable\n');process.exitCode=2;}
}
