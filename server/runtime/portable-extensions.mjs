import {cp,mkdir,readFile,writeFile,symlink,lstat,rm,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import yaml from 'js-yaml';
import {selectedExtensions} from './extensions.mjs';
import {readExtensionFile,readPluginExecutionPlan} from './marketplace.mjs';
import {PORTABLE_AGENT_TOOLS,parsePluginMarkdown} from './plugin-compatibility.mjs';

const launcher=fileURLToPath(new URL('./mcp-launcher.mjs',import.meta.url));
const nativeNode=()=>process.env.AGENTFORGE_ELECTRON_NODE || process.execPath;
export const portableSkillName=(namespace,name,id)=>`${namespace}-${name}`.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)+'-'+createHash('sha256').update(id+':'+name).digest('hex').slice(0,8);
export async function referenceNativeFile(source,target){
  try{await lstat(source);}catch(error){if(error.code==='ENOENT')return;throw error;}
  try{const current=await lstat(target);if(!current.isSymbolicLink())throw new Error('原生配置引用位置已有非链接文件');await rm(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(dirname(target),{recursive:true,mode:0o700});await symlink(source,target);
}
export async function nativeConnectionSettings(source,keys){
  let value;try{const raw=await readFile(source,'utf8');if(Buffer.byteLength(raw)>1024*1024)throw Error();value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();}catch(error){if(error.code==='ENOENT')return {};throw new Error('原生连接设置无法读取或不是有效 JSON');}
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
}
// Integrity-checked immutable sources are never modified. Whole plugin copies
// preserve relative resources; only the native SKILL frontmatter is projected.
export async function preparePortableExtensions(input){
  const {runtime,traceDirectory,historyMcp}=input;
  const selected=await selectedExtensions(runtime),servers={};
  for(const [name,{ref}]of Object.entries(selected))servers[name]={command:nativeNode(),args:[launcher,ref.path,ref.sha256,name],...(process.versions.electron?{env:{ELECTRON_RUN_AS_NODE:'1'}}:{})};
  if(historyMcp){if(servers.agentforge_history)throw new Error('MCP 使用平台保留名称');servers.agentforge_history={command:historyMcp.command,args:historyMcp.args,env:historyMcp.env};}
  const root=join(traceDirectory,'native-extensions');await mkdir(root,{recursive:true,mode:0o700});const skills=[],plugins=[],agents=[];
  for(const ref of (runtime.extensionManifest || []).filter(item=>item.kind==='plugin')){
    await readExtensionFile(ref);const plan=await readPluginExecutionPlan(ref);
    if(plan.target!==runtime.provider || !Array.isArray(plan.nativeSkills) || JSON.stringify(ref.skills)!==JSON.stringify(plan.nativeSkills.map(skill=>skill.path)))throw new Error('插件没有当前 Runtime 的原生执行计划');
    const source=dirname(dirname(ref.path)),target=join(root,ref.id),manifest=JSON.parse(await readFile(ref.path,'utf8'));
    await cp(source,target,{recursive:true,errorOnExist:true,force:false});
    if(runtime.provider==='kimi'){
      // Kimi scans real child directories, not symlinked collections or a
      // SKILL.md directly at a scan root. Retain selected Skill files only in
      // this invocation copy; installed sources are never changed.
      const allowed=new Set(ref.skills.map(path=>join(target,path)));
      const prune=async directory=>{for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await prune(path);else if(entry.name==='SKILL.md'&&!allowed.has(path))await rm(path);}};
      await prune(target);
    }
    const agentNames=new Map(plan.agents.map(agent=>[agent.name,portableSkillName(manifest.name,'agent-'+agent.name,ref.id)]));
    const translateNames=body=>{for(const [source,name]of agentNames)body=body.replaceAll(manifest.name+':'+source,runtime.provider==='cursor'?manifest.name+':'+name:name);return body;};
    for(const agent of plan.agents){
      const {body}=parsePluginMarkdown(await readFile(join(target,agent.path),'utf8'),{path:agent.path});
      const name=agentNames.get(agent.name),file=join(root,'agent-prompts',name+'.md');await mkdir(dirname(file),{recursive:true,mode:0o700});
      await writeFile(file,translateNames(body).replaceAll('${CLAUDE_PLUGIN_ROOT}',target).replaceAll('${CODEX_PLUGIN_ROOT}',target),{mode:0o600});
      const toolNames=agent.tools?.map(tool=>PORTABLE_AGENT_TOOLS[runtime.provider][tool]),deniedTools=agent.deniedTools?.map(tool=>PORTABLE_AGENT_TOOLS[runtime.provider][tool]);
      agents.push({name,namespace:manifest.name,sourceName:agent.name,description:`[${manifest.name}:${agent.name}] ${agent.description}`,promptFile:file,...(toolNames?{toolNames:[...new Set(toolNames)]}:{}),...(deniedTools?{deniedTools:[...new Set(deniedTools)]}:{})});
    }
    for(const path of ref.skills){
      const file=join(target,path),content=await readFile(file,'utf8'),{attributes,body}=parsePluginMarkdown(content,{path});
      const name=portableSkillName(manifest.name,attributes.name || dirname(path).split('/').at(-1),ref.id);
      const projected={...attributes,name,description:attributes.description || `来自插件 ${manifest.name} 的可复用工作说明`};
      await writeFile(file,'---\n'+yaml.dump(projected,{schema:yaml.JSON_SCHEMA,lineWidth:-1})+'---\n'+translateNames(body).replaceAll('${CLAUDE_PLUGIN_ROOT}',target).replaceAll('${CODEX_PLUGIN_ROOT}',target),{mode:0o600});
      skills.push({name,path:dirname(file)});
    }
    // Cursor's native plugin loader supplies discovery; no source MCP or hooks
    // are included implicitly, since those require separate selected bindings.
    const wrapper=join(root,'cursor-plugins',ref.id),cursor=join(wrapper,'.cursor-plugin');await mkdir(cursor,{recursive:true,mode:0o700});await mkdir(join(wrapper,'skills'),{mode:0o700});
    const pluginSkills=skills.filter(skill=>skill.path.startsWith(target+'/'));for(const skill of pluginSkills)await symlink(skill.path,join(wrapper,'skills',skill.name));
    const pluginAgents=agents.filter(agent=>agent.namespace===manifest.name);if(pluginAgents.length)await mkdir(join(wrapper,'agents'),{mode:0o700});
    for(const agent of pluginAgents)await writeFile(join(wrapper,'agents',agent.name+'.md'),'---\n'+yaml.dump({name:agent.name,description:agent.description,model:'inherit'},{lineWidth:-1})+'---\n'+await readFile(agent.promptFile,'utf8'),{mode:0o600});
    await writeFile(join(cursor,'plugin.json'),JSON.stringify({name:manifest.name,version:manifest.version || '1.0.0',skills:pluginSkills.map(skill=>'./skills/'+skill.name),agents:pluginAgents.map(agent=>'./agents/'+agent.name+'.md')}),{mode:0o600});plugins.push(wrapper);
  }
  const skillsRoot=join(root,'skills');await mkdir(skillsRoot,{recursive:true,mode:0o700});
  for(const skill of skills)await symlink(skill.path,join(skillsRoot,skill.name));
  return {root,skillsRoot,skills,plugins,servers,agents};
}
export async function writeNativeJson(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,JSON.stringify(value),{mode:0o600});}

export async function preparePortableConnectionProfile(input,environment,context){
  const provider=input.runtime.provider,host=environment.HOME;
  if(provider==='qwen'){
    const source=environment.QWEN_HOME || join(host,'.qwen'),home=join(context,'qwen-home'),config=join(home,'.qwen');
    await mkdir(config,{recursive:true,mode:0o700});
    const settings=await nativeConnectionSettings(join(source,'settings.json'),['security','model','modelProviders','env']);
    // Authentication/provider selection is preserved; customization is invocation-owned.
    await writeNativeJson(join(config,'settings.json'),{...settings,...(input.runtime.effort?{model:{...settings.model,reasoningEffort:input.runtime.effort}}:{}),skills:{disabledLevels:['project','extension','bundled']}});
    for(const name of ['oauth_creds.json'])await referenceNativeFile(join(source,name),join(config,name));
    environment.QWEN_RUNTIME_DIR ||= source;environment.QWEN_HOME=config;environment.HOME=home;
    return `本机用户目录：${host}。CLI HOME 仅保存本成员的调用配置；访问用户配置或运行 Git、SSH 时使用本机用户目录。`;
  }
  if(provider==='kimi'){
    const source=environment.KIMI_CODE_HOME || join(host,'.kimi-code'),home=join(context,'kimi-home');await mkdir(home,{recursive:true,mode:0o700});
    // Native TOML remains native-owned. Reject executable hooks rather than
    // parsing a second TOML dialect or copying credential values.
    try{const config=await readFile(join(source,'config.toml'),'utf8');if(/^\s*(?:\[\[?\s*["']?hooks\b|["']?hooks["']?\s*=)/m.test(config))throw Error('Kimi 连接配置含有未选择的 Hook，尚不能隔离');}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const name of ['config.toml','credentials','oauth','device_id','region','sessions','session_index.jsonl','file-history'])await referenceNativeFile(join(source,name),join(home,name));
    environment.KIMI_CODE_HOME=home;return '';
  }
  if(provider==='pi'){
    const source=environment.PI_CODING_AGENT_DIR || join(host,'.pi','agent'),home=join(context,'pi-home');await mkdir(home,{recursive:true,mode:0o700});
    for(const name of ['auth.json','models.json'])await referenceNativeFile(join(source,name),join(home,name));
    const settings=await nativeConnectionSettings(join(source,'settings.json'),['defaultProvider','defaultModel','defaultThinkingLevel','enabledModels']);
    await writeNativeJson(join(home,'settings.json'),settings);environment.PI_CODING_AGENT_DIR=home;return '';
  }
  return '';
}
export async function configurePortableExtensions(input,environment,projection){
  const {provider}=input.runtime,{servers,skillsRoot,skills,agents=[]}=projection,configName=provider==='cursor'?join(environment.HOME,'.cursor'):provider==='gemini'?join(environment.GEMINI_CLI_HOME,'.gemini'):provider==='qwen'?environment.QWEN_HOME:provider==='kimi'?environment.KIMI_CODE_HOME:environment.PI_CODING_AGENT_DIR;
  const trusted=Object.fromEntries(Object.entries(servers).map(([name,service])=>[name,{...service,trust:true}]));
  if(['gemini','qwen','kimi'].includes(provider)){
    const folder=join(configName,'agents');await mkdir(folder,{recursive:true,mode:0o700});
    for(const agent of agents){
      const tools=agent.toolNames?.filter(tool=>!agent.deniedTools?.includes(tool)),metadata={name:agent.name,description:agent.description,...(tools?{tools}:{}),...(provider==='gemini'?{kind:'local',model:'inherit'}:provider==='qwen'?{model:'inherit',...(agent.deniedTools?{disallowedTools:agent.deniedTools}:{})}:agent.deniedTools?{disallowedTools:agent.deniedTools}:{})};
      await writeFile(join(folder,agent.name+'.md'),'---\n'+yaml.dump(metadata,{lineWidth:-1})+'---\n'+await readFile(agent.promptFile,'utf8'),{mode:0o600});
    }
  }
  if(provider==='cursor'||provider==='kimi'||provider==='pi')await writeNativeJson(join(configName,'mcp.json'),{mcpServers:provider==='pi'?Object.fromEntries(Object.entries(servers).map(([name,service])=>[name,{...service,exposure:'direct'}])):servers});
  if(provider==='gemini'||provider==='qwen'){
    const file=join(configName,'settings.json'),settings=JSON.parse(await readFile(file,'utf8'));
    Object.assign(settings,{mcpServers:trusted,mcp:{allowed:Object.keys(servers)}});
    if(provider==='gemini')settings.experimental={enableAgents:true};
    if(provider==='gemini')settings.skills={enabled:skills.length>0};
    await writeNativeJson(file,settings);
    const target=join(configName,'skills');await rm(target,{recursive:true,force:true});await symlink(skillsRoot,target);
  }
  if(provider==='opencode'){
    const policy=(action,names)=>[{action,resource:'*',effect:'deny'},...names.map(resource=>({action,resource,effect:'allow'}))];
    return {agents:Object.fromEntries(await Promise.all(agents.map(async agent=>[agent.name,{description:agent.description,mode:'subagent',system:await readFile(agent.promptFile,'utf8'),...(agent.toolNames?{permissions:[{action:'*',resource:'*',effect:'deny'},...agent.toolNames.map(action=>({action,resource:'*',effect:'allow'})),...(agent.deniedTools || []).map(action=>({action,resource:'*',effect:'deny'}))]}:{})}]))),skills:[skillsRoot],mcp:{servers:Object.fromEntries(Object.entries(servers).map(([name,service])=>[name,{type:'local',command:[service.command,...service.args],environment:service.env || {},codemode:false}]))},policies:[...policy('mcp.use',Object.keys(servers)),...policy('skill.use',skills.map(skill=>skill.name))]};
  }
  if(provider==='pi' && agents.length){const extension=join(projection.root,'pi-agents.mjs');await writeFile(extension,await readFile(new URL('./pi-agents.mjs',import.meta.url),'utf8'),{mode:0o600});await writeNativeJson(join(projection.root,'pi-agents.json'),{command:input.runtime.executable || 'pi',agents});return {piExtension:extension};}
  return {};
}
