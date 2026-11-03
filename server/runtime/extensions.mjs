import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile, cp, mkdtemp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readExtensionFile, readPluginExecutionPlan, selectionIds } from './marketplace.mjs';
import { parseMcpJson } from './configuration.mjs';
import { diagnostic } from '../diagnostics.mjs';
import { cliEnvironment } from './cli-environment.mjs';
import { diagnoseLaunch } from './launch-diagnostics.mjs';
import { parsePluginMarkdown } from './plugin-compatibility.mjs';

const exec = promisify(execFile);
// Preserve existing model connection env without loading user extensions/hooks.
// Never execute apiKeyHelper or return these values through the control plane.
export async function claudeMarketEnvironment(path = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')) {
  let content;
  try { content = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('模型连接配置不可读取'); }
  let settings;
  try { if (Buffer.byteLength(content) > 1024 * 1024) throw new Error(); settings = JSON.parse(content); } catch { throw new Error('模型连接配置无效'); }
  const keys = ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_FABLE_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES','ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES','ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES','ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'];
  return Object.fromEntries(keys.filter(key => process.env[key] === undefined && typeof settings?.env?.[key] === 'string').map(key => [key, settings.env[key]]));
}
export const tomlValue = value => Array.isArray(value) ? `[${value.map(tomlValue).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).map(([key,item]) => `${JSON.stringify(key)}=${tomlValue(item)}`).join(',')}}` : JSON.stringify(value);
export const codexAgentKey=(ref,index,name)=>`af_${ref.id.replaceAll('-','')}_${index}_${name.replace(/[^a-zA-Z0-9_]/g,'_').toLowerCase().slice(0,24)}`;

// Native readers receive valid YAML without changing source bytes, installation
// hashes or frozen paths. Only components needing the narrow text correction
// get a private copy, including their relative supporting resources.
export async function nativePluginRuntime(runtime, traceDirectory) {
  const roots=new Map();let directory;
  for(const ref of (runtime.extensionManifest || []).filter(item=>item.kind==='plugin')) {
    const root=dirname(dirname(ref.path)),paths=new Set(ref.skills || []);
    if([2,3].includes(ref.adapterVersion))for(const agent of (await readPluginExecutionPlan(ref)).agents)paths.add(agent.path);
    const changed=[];
    for(const path of paths) {
      const content=await readFile(join(root,path),'utf8'),{nativeContent}=parsePluginMarkdown(content,{path});
      if(content!==nativeContent)changed.push({path,content:nativeContent});
    }
    if(!changed.length)continue;
    await readExtensionFile(ref);
    directory ||= await mkdtemp(join(traceDirectory,'native-plugins-'));
    const target=join(directory,ref.id);await cp(root,target,{recursive:true,errorOnExist:true,force:false});
    for(const item of changed)await writeFile(join(target,item.path),item.content,{mode:0o600});
    roots.set(root,target);
  }
  if(!roots.size)return runtime;
  return {...runtime,pluginPaths:(runtime.pluginPaths || []).map(path=>roots.get(path) || path),skillPaths:(runtime.skillPaths || []).map(path=>{
    for(const [root,target] of roots)if(path.startsWith(root+'/'))return join(target,path.slice(root.length+1));return path;
  })};
}

export async function selectedExtensions(runtime) {
  // An omitted selection means no market extensions, never ambient discovery.
  if (!runtime.extensionSelection) return {};
  // Read-only invocation adapter for already frozen pre-plugin Task/Run
  // snapshots, not an administrator input or automatic data conversion.
  if(Object.hasOwn(runtime.extensionSelection,'skillIds')) {
    const manifest=runtime.extensionManifest, selection=runtime.extensionSelection;
    if(!Array.isArray(manifest) || !Array.isArray(selection.skillIds) || !Array.isArray(selection.mcpIds) || manifest.length!==selection.skillIds.length+selection.mcpIds.length || runtime.pluginPaths?.length || runtime.pluginSources?.length) throw new Error('冻结扩展绑定无效');
    const servers=Object.create(null);
    for(const kind of ['skill','mcp']) {
      const refs=manifest.filter(ref=>ref.kind===kind);
      if(JSON.stringify(refs.map(ref=>ref.id))!==JSON.stringify(selection[kind==='skill'?'skillIds':'mcpIds']) || JSON.stringify(refs.map(ref=>ref.path))!==JSON.stringify(runtime[kind==='skill'?'skillPaths':'mcpConfigPaths'] || [])) throw new Error('冻结扩展绑定与执行路径不一致');
      for(const ref of refs) {
        const content=await readExtensionFile(ref);
        if(kind==='mcp') for(const [name,service] of Object.entries(parseMcpJson(content).mcpServers)) {
          if(['agentforge_history','__proto__','prototype','constructor'].includes(name) || Object.hasOwn(servers,name)) throw new Error('MCP 服务名称重复或使用保留名称');
          servers[name]={service,ref};
        }
      }
    }
    return servers;
  }
  const selection = selectionIds(runtime.extensionSelection), manifest = runtime.extensionManifest;
  const ids = [...selection.pluginIds, ...selection.mcpIds];
  if (!Array.isArray(manifest) || manifest.length !== ids.length || new Set(manifest.map(r => r.id)).size !== ids.length || runtime.pluginSources?.length) throw new Error('市场扩展绑定无效');
  const pluginRefs = manifest.filter(ref=>ref.kind==='plugin');
  const skillPaths = pluginRefs.flatMap(ref=>(ref.skills || []).map(path=>join(dirname(dirname(ref.path)),path)));
  const pluginPaths = (runtime.provider || 'claude-code')==='claude-code' ? pluginRefs.map(ref=>dirname(dirname(ref.path))) : [];
  if(JSON.stringify(runtime.skillPaths || [])!==JSON.stringify(skillPaths) || JSON.stringify(runtime.pluginPaths || [])!==JSON.stringify(pluginPaths)) throw new Error('插件绑定与执行路径不一致');
  const servers = Object.create(null);
  for (const kind of ['plugin', 'mcp']) {
    const refs = manifest.filter(ref => ref.kind === kind);
    if (JSON.stringify(refs.map(ref => ref.id)) !== JSON.stringify(selection[kind === 'plugin' ? 'pluginIds' : 'mcpIds']) || (kind==='mcp' && JSON.stringify(refs.map(ref => ref.path)) !== JSON.stringify(runtime.mcpConfigPaths || []))) throw new Error('市场扩展绑定与执行路径不一致');
    for (const ref of refs) {
      const content = await readExtensionFile(ref);
      if(kind==='plugin' && [2,3].includes(ref.adapterVersion)) {
        if(ref.planTarget!==(runtime.provider || 'claude-code'))throw new Error('冻结插件执行计划与 Runtime 不一致');
        await readPluginExecutionPlan(ref);
      }
      if (kind !== 'mcp') continue;
      for (const [name, service] of Object.entries(parseMcpJson(content).mcpServers)) {
        if (['agentforge_history','__proto__','prototype','constructor'].includes(name) || Object.hasOwn(servers, name)) throw new Error('MCP 服务名称重复或使用了平台保留名称');
        servers[name] = { service, ref };
      }
    }
  }
  return servers;
}

export async function codexMarketArgs(runtime, servers, workspacePath, traceDirectory, workspaceHook = null) {
  const isolation = ['-c', 'features.apps=false', '-c', 'features.skip_host_skill_discovery=true', '-c', 'features.plugins=false', '-c', 'features.skill_mcp_dependency_install=false'];
  // Refuse old CLIs instead of silently accepting an unknown config key.
  const env = cliEnvironment(runtime.executable || 'codex');
  const supported = await exec(runtime.executable || 'codex', ['features', 'list'], { env, timeout: 10000, maxBuffer: 128 * 1024 }).catch(async error => {
    diagnostic('provider.configuration_probe_failed', { operation: 'features', error });
    if (error.code === 'ENOENT') {
      diagnostic('provider.launch_diagnostic', await diagnoseLaunch({ command: runtime.executable || 'codex', cwd: workspacePath, searchPath: env.PATH, provider: 'Codex' }));
    }
    throw error;
  });
  if (!/^skip_host_skill_discovery\s/m.test(supported?.stdout || '')) throw new Error('当前 Codex CLI 不支持市场技能加载隔离，请升级 CLI 或选择 Claude Code');
  // Native config tables merge, including project layers: {} is not a reset.
  // Read the effective configuration without starting servers, then disable it.
  let configured;
  try {
    const args = [...(runtime.profile ? ['--profile',runtime.profile] : []), ...isolation, 'mcp','list','--json'];
    const result = await exec(runtime.executable || 'codex', args, {env,cwd:workspacePath,timeout:10000,maxBuffer:1024*1024});
    configured = JSON.parse(result.stdout);
    if (!Array.isArray(configured) || configured.some(item=>typeof item.name !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(item.name))) throw new Error('codex mcp list --json 返回了无效的 MCP 配置列表');
  } catch (error) { diagnostic('provider.configuration_probe_failed', { operation: 'mcp-list', error }); throw error; }
  const disabled = configured.flatMap(item=>['-c',`mcp_servers.${item.name}.enabled=false`]);
  const mcp = {};
  for (const [name, {service, ref}] of Object.entries(servers)) {
    const key=ref.mcpAdapterVersion===2 ? name : `agentforge_market_${ref.id.replaceAll('-','')}`;
    mcp[key] = { command: process.execPath, args: [fileURLToPath(new URL('./mcp-launcher.mjs', import.meta.url)), ref.path, ref.sha256, name], enabled: true, required: true,
      ...(process.versions.electron ? {env: {ELECTRON_RUN_AS_NODE: '1'}} : {}) };
  }
  // Never override the parent table: that erases earlier enabled=false overrides.
  // Codex -c splits the key on dots; quoted segments become literal quotes.
  // MCP names are already restricted to letters, digits, underscore and '-'.
  const selected = Object.entries(mcp).flatMap(([name,service]) => ['-c', `mcp_servers.${name}=${tomlValue(service)}`]);
  const pluginArgs=[];
  const hookEvents=['SessionStart','SessionEnd','UserPromptSubmit','PreToolUse','PostToolUse','PermissionRequest','Stop','SubagentStart','SubagentStop','PreCompact','PostCompact','PreModelRequest','PostModelRequest','Interrupt'];
  const hooks=Object.fromEntries(hookEvents.map(name=>[name,[]])),agentTools={};let hookCount=0;
  for(const ref of (runtime.extensionManifest || []).filter(item=>item.kind==='plugin')) {
    await readExtensionFile(ref);
    // Frozen Skill-only invocations predate native projections; their recorded
    // paths remain executable without rewriting history or installation files.
    if(![1,2,3].includes(ref.adapterVersion)) continue;
    const root=dirname(dirname(ref.path)), plan=[2,3].includes(ref.adapterVersion) ? await readPluginExecutionPlan(ref) : JSON.parse(await readFile(join(root,'.agentforge/codex.json'),'utf8'));
    const namespace=[2,3].includes(ref.adapterVersion) ? JSON.parse(await readFile(ref.path,'utf8')).name : '';
    if(!traceDirectory && (plan.agents.length || plan.hooks.length)) throw new Error('插件原生组件需要执行记录目录');
    for(const [agentIndex,agent] of plan.agents.entries()) {
      const content=await readFile(join(root,agent.path),'utf8');
      const key=[2,3].includes(ref.adapterVersion) ? codexAgentKey(ref,agentIndex,agent.name) : `af_${ref.id.replaceAll('-','')}_${agentIndex}_${agent.name.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,24)}`;
      const configFile=join(traceDirectory,[2,3].includes(ref.adapterVersion)?`agent-${ref.id}-${agentIndex}.toml`:`${key}.toml`);
      await mkdir(traceDirectory,{recursive:true,mode:0o700});
      await writeFile(configFile,`${agent.model && agent.model!=='inherit'?`model=${tomlValue(agent.model)}\n`:''}developer_instructions=${tomlValue(content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''))}\n`,{mode:0o600});
      pluginArgs.push('-c',`agents.${key}=${tomlValue({description:[2,3].includes(ref.adapterVersion)?`[${namespace}:${agent.name}] ${agent.description || agent.name}`:agent.description || agent.name,config_file:configFile})}`);
      if([2,3].includes(ref.adapterVersion))agentTools[key]={tools:agent.tools,deniedTools:agent.deniedTools};
    }
    for(const [eventIndex,item] of plan.hooks.entries()) for(const [groupIndex,group] of item.matchers.entries()) {
      if(!hooks[item.event]) throw new Error('插件 Hook 与当前 Codex 不兼容');
      const projected=[];
      for(const [hookIndex,hook] of group.hooks.entries()) {
        if(hook.type!=='command') throw new Error('Codex 插件只支持可映射的 command Hook');
        const quote=value=>`'${String(value).replaceAll("'","'\\''")}'`;
        const frozenRef=join(traceDirectory,`plugin-${ref.id}.json`);
        if([2,3].includes(ref.adapterVersion))await writeFile(frozenRef,JSON.stringify(ref),{mode:0o600});
        const command=[process.execPath,fileURLToPath(new URL('./plugin-hooks.mjs',import.meta.url)),ref.path,ref.sha256,ref.treeSha256,eventIndex,groupIndex,hookIndex,...([2,3].includes(ref.adapterVersion)?[frozenRef]:[])].map(quote).join(' ');
        projected.push({...hook,command:(process.versions.electron?'ELECTRON_RUN_AS_NODE=1 ':'')+command});hookCount++;
      }
      hooks[item.event].push({...group,hooks:projected});
    }
  }
  if(Object.keys(agentTools).length) {
    const path=join(traceDirectory,'codex-agent-tools.json');
    await writeFile(path,JSON.stringify({agents:agentTools,stateDirectory:join(traceDirectory,'codex-child-tools')}),{mode:0o600});
    const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
    const command=(process.versions.electron?'ELECTRON_RUN_AS_NODE=1 ':'')+[process.execPath,fileURLToPath(new URL('./plugin-agent-tools.mjs',import.meta.url)),path].map(quote).join(' ');
    for(const event of ['SubagentStart','PreToolUse'])hooks[event].unshift({hooks:[{type:'command',command}]});
    hookCount++;
  }
  if (workspaceHook) { hooks.PostToolUse.unshift({hooks:[{type:'command',command:workspaceHook.command,timeout:35}]}); hookCount++; }
  // Replace each event array rather than merging ambient user command hooks.
  for(const [event,groups] of Object.entries(hooks)) pluginArgs.push('-c',`hooks.${event}=${tomlValue(groups)}`);
  if(hookCount) pluginArgs.push('--dangerously-bypass-hook-trust');
  return [...isolation, ...disabled, ...selected, ...pluginArgs];
}
