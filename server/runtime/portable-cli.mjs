import {writeFile, mkdir,readFile,readdir,lstat,symlink,stat,rm,realpath} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {StringDecoder} from 'node:string_decoder';
import {RUNTIME_PROVIDERS,PORTABLE_RUNTIME_IDS,nativeSessionId} from '../../client/runtime-providers.mjs';
import {preparePortableExtensions,preparePortableConnectionProfile,configurePortableExtensions} from './portable-extensions.mjs';
import {cliEnvironment} from './cli-environment.mjs';

const textOf=value=>typeof value==='string'?value:Array.isArray(value)?value.filter(x=>x?.type==='text').map(x=>x.text || '').join('\n'):'';
const exec=promisify(execFile);
const memberContext=input=>join(input.workspacePath,'.agentforge','runtime-context',createHash('sha256').update(input.executionKey || input.runId || input.traceDirectory).digest('hex').slice(0,24));
async function referenceFile(source,target){
  try{await lstat(source);}catch(error){if(error.code==='ENOENT')return;throw error;}
  try{const value=await lstat(target);if(!value.isSymbolicLink())throw new Error('原生配置引用被非链接文件替代');if(await realpath(target)===await realpath(source))return;await rm(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  await symlink(source,target);
}
async function prepareCursorHome(input,environment){
  const host=environment.HOME || homedir(),source=environment.CURSOR_CONFIG_DIR || (environment.XDG_CONFIG_HOME?join(environment.XDG_CONFIG_HOME,'cursor'):join(host,'.cursor')),home=join(memberContext(input),'cursor-home'),config=join(home,'.cursor');
  await mkdir(config,{recursive:true,mode:0o700});
  let settings={};try{const raw=await readFile(join(source,'cli-config.json'),'utf8');if(Buffer.byteLength(raw)>1024*1024)throw Error();settings=JSON.parse(raw);if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error();}catch(error){if(error.code!=='ENOENT')throw new Error('Cursor 原生连接配置无法读取或不是有效 JSON');}
  await writeFile(join(config,'cli-config.json'),JSON.stringify(Object.fromEntries(['model','permissions'].filter(key=>settings[key]!==undefined).map(key=>[key,settings[key]]))),{mode:0o600});
  // File-store users retain the native account path; no token bytes are read.
  await referenceFile(join(host,'.cursor/auth.json'),join(config,'auth.json'));
  if(process.platform==='darwin'){
    let target;try{const {stdout}=await exec('/usr/bin/security',['default-keychain','-d','user'],{env:environment,timeout:5000,maxBuffer:65536});target=stdout.trim().replace(/^"|"$/g,'');}catch{} // API-key/file-store accounts may have no default keychain.
    if(target?.startsWith('/')){const directory=join(home,'Library/Keychains');await mkdir(directory,{recursive:true,mode:0o700});await referenceFile(target,join(directory,target.split('/').at(-1)));}
  }else if(process.platform==='win32'){environment.APPDATA ||= join(host,'AppData/Roaming');}
  else {environment.XDG_CONFIG_HOME ||= join(host,'.config');}
  environment.AGENTFORGE_HOST_HOME=host;environment.HOME=home;environment.CURSOR_CONFIG_DIR=config;environment.CURSOR_DATA_DIR=config;
  return `本机用户目录：${host}。CLI 的 HOME 仅保存本成员的原生配置和会话，不是文件访问边界。涉及用户目录时使用上述本机用户目录；运行 Git、SSH 等需要用户配置的工具时，为相应命令显式设置 HOME 为该本机用户目录。`;
}
// Gemini has no user-owned per-invocation system-settings override: those
// files require root ownership. A persistent, member-scoped CLI config home
// instead projects connection settings only. Native credentials stay in the
// OS keychain or are referenced by path; the adapter never reads token bytes.
async function prepareGeminiHome(input,environment){
  const source=join(environment.GEMINI_CLI_HOME || environment.HOME || homedir(),'.gemini');
  const home=join(memberContext(input),'gemini-home'),config=join(home,'.gemini');
  await mkdir(config,{recursive:true,mode:0o700});
  let settings={};try{const raw=await readFile(join(source,'settings.json'),'utf8');if(Buffer.byteLength(raw)>1024*1024)throw Error();settings=JSON.parse(raw);if(!settings || typeof settings!=='object'||Array.isArray(settings))throw Error();}catch(error){if(error.code!=='ENOENT')throw new Error('Gemini 账号连接配置无法读取或不是有效 JSON');}
  const connectionKeys=['GEMINI_API_KEY','GOOGLE_API_KEY','GEMINI_BASE_URL','GEMINI_API_BASE_URL','GOOGLE_GENAI_USE_VERTEXAI','GOOGLE_CLOUD_PROJECT','GOOGLE_CLOUD_LOCATION','GOOGLE_APPLICATION_CREDENTIALS','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'];
  const projected={security:{auth:settings.security?.auth || {}},...(settings.model?{model:settings.model}:{}),...(settings.modelConfigs?{modelConfigs:settings.modelConfigs}:{}),...(settings.proxy?{proxy:settings.proxy}:{}),env:Object.fromEntries(Object.entries(settings.env || {}).filter(([key])=>connectionKeys.includes(key))),skills:{enabled:false},hooksConfig:{enabled:false},mcp:{allowed:[]}};
  if(input.runtime.effort){
    projected.modelConfigs ||= {};projected.modelConfigs.overrides=[...(projected.modelConfigs.overrides || []),{match:{model:input.runtime.model},modelConfig:{generateContentConfig:{thinkingConfig:{thinkingLevel:input.runtime.effort.toUpperCase()}}}}];
  }
  await writeFile(join(config,'settings.json'),JSON.stringify(projected),{mode:0o600});
  const account=join(source,'google_accounts.json');try{await lstat(account);const link=join(config,'google_accounts.json');try{await lstat(link);}catch(error){if(error.code!=='ENOENT')throw error;await symlink(account,link);}}catch(error){if(error.code!=='ENOENT')throw new Error('Gemini 原生账号索引无法引用');}
  // OAuth's native cache is member-scoped. A changed original credential file
  // invalidates only this adapter's derived cache; no global credential writes.
  const oauth=join(source,'oauth_creds.json');try{
    const info=await stat(oauth),stamp=JSON.stringify([oauth,info.size,info.mtimeMs]),marker=join(config,'agentforge-auth-source.json');let previous;try{previous=await readFile(marker,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(previous!==stamp){await rm(join(config,'oauth_creds.json'),{force:true});await writeFile(marker,stamp,{mode:0o600});}
    if(!environment.GOOGLE_APPLICATION_CREDENTIALS)environment.GOOGLE_APPLICATION_CREDENTIALS=oauth;
  }catch(error){if(error.code!=='ENOENT')throw new Error('Gemini 原生凭据引用无法确认');}
  environment.GEMINI_CLI_HOME=home;
  return `本机用户目录：${environment.HOME || homedir()}。Gemini 的配置主目录仅保存本成员的原生配置和会话；访问用户文件时使用本机用户目录的绝对路径。`;
}
// Only selected, validated components receive native projections. Never
// silently substitute native global extensions for an empty employee selection.
export async function assertPortableExtensionIsolation(provider,cwd,environment) {
  if(provider==='pi')return; // Explicit native resource flags and private agentDir below.
  const home=environment.HOME || homedir(),folder={cursor:'.cursor',gemini:'.gemini',qwen:'.qwen',kimi:'.kimi-code',opencode:'.opencode'}[provider];
  const roots=[provider==='qwen'?environment.QWEN_HOME:provider==='kimi'?(environment.KIMI_CODE_HOME || join(home,folder)):provider==='gemini'?join(environment.GEMINI_CLI_HOME || home,folder):join(home,folder),join(cwd,folder),...(provider==='opencode'?[join(environment.XDG_CONFIG_HOME || join(home,'.config'),'opencode'),'/Library/Application Support/opencode']:[])];
  if(['cursor','gemini','qwen'].includes(provider))for(const folder of ['.agents','.claude','.codex','.grok']){try{const files=await readdir(join(cwd,folder,'skills'));if(files.length)throw new Error('工作目录包含未选择的原生 Skill，当前适配器不能隔离，未启动调用');}catch(error){if(error.code!=='ENOENT')throw error;}}
  const cursorConfigRoot=provider==='cursor'?(environment.CURSOR_CONFIG_DIR || (environment.XDG_CONFIG_HOME?join(environment.XDG_CONFIG_HOME,'cursor'):join(home,'.cursor'))):null;
  if(cursorConfigRoot)roots.push(cursorConfigRoot);
  if(provider==='opencode'){let parent=cwd;for(;;){roots.push(parent,join(parent,'.opencode'));const next=dirname(parent);if(next===parent)break;parent=next;}}
  if(provider==='kimi'){
    // Native Kimi also discovers a repository-root .mcp.json and TOML hooks.
    let project=cwd;
    for(;;){try{await lstat(join(project,'.git'));break;}catch(error){if(error.code!=='ENOENT')throw error;}const parent=dirname(project);if(parent===project){project=cwd;break;}project=parent;}
    try{const config=JSON.parse(await readFile(join(project,'.mcp.json'),'utf8'));if(Object.keys(config.mcpServers || {}).length)throw new Error('Kimi 项目 MCP 未由员工选择，当前适配器不能隔离，未启动调用');}catch(error){if(error.code!=='ENOENT')throw new Error('Kimi 项目 MCP 配置存在或无法确认扩展范围，未启动调用');}
    for(const root of new Set(roots)){try{const config=await readFile(join(root,'config.toml'),'utf8');if(/^\s*(?:\[\[?\s*["']?hooks\b|["']?hooks["']?\s*=)/m.test(config))throw new Error('Kimi 原生 hooks 尚未支持员工隔离，未启动调用');}catch(error){if(error.code!=='ENOENT')throw error;}}
  }
  for(const root of new Set(roots)){
    for(const name of ['mcp.json','settings.json',...(provider==='cursor'?['hooks.json','cli.json']:[]),...(provider==='opencode'?['opencode.json','opencode.jsonc']:[])]){
      let raw;try{raw=await readFile(join(root,name),'utf8');}catch(error){if(error.code==='ENOENT')continue;throw new Error('原生 Runtime 扩展配置无法读取，不能确认加载范围');}
      let value;try{if(Buffer.byteLength(raw)>1024*1024)throw Error();value=JSON.parse(raw);}catch{throw new Error('原生 Runtime 配置无法确认扩展范围（需有效 JSON），未启动调用');}
      if((provider==='opencode'?['extensions','hooks','plugin','plugins']:provider==='gemini'?['mcpServers','extensions','hooks','plugin','plugins',...(root===join(cwd,folder)?['mcp','skills','hooksConfig']:[])]:['mcpServers','mcp','extensions','hooks','plugin','plugins']).some(key=>value[key]&&Object.keys(value[key]).length))throw new Error(`${RUNTIME_PROVIDERS[provider].label} 原生配置含有未由员工选择的扩展；当前适配器不能安全隔离这些扩展，未启动调用。请使用不含全局扩展的 CLI 配置或已有兼容 Runtime。`);
    }
    if(provider==='cursor'&&cursorConfigRoot===root&&root!==join(home,'.cursor')&&root!==join(cwd,'.cursor'))continue; // Config location is not Cursor's HOME-based plugin/skill discovery root.
    for(const name of (provider==='opencode'?['plugins','extensions']:['plugins','extensions','skills','agents'])){
      let files;try{files=await readdir(join(root,name));}catch(error){if(error.code==='ENOENT')continue;throw new Error('原生 Runtime 扩展目录无法读取');}
      // Qwen creates this data-only enablement index even with no extensions.
      if(files.some(name=>!name.startsWith('.') && !(provider==='qwen' && name==='extension-enablement.json')))throw new Error(`${RUNTIME_PROVIDERS[provider].label} 原生 ${name} 目录有未选择扩展，当前适配器尚未支持隔离，未启动调用`);
    }
  }
}
// Normalize only explicit content fields. Provider envelopes/usage/configuration
// are never persisted as console content or used as business conclusions.
export async function* readNativeJsonl(stream) {
  const decoder=new StringDecoder('utf8');let buffer='';
  for await(const chunk of stream){buffer+=decoder.write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));let end;while((end=buffer.indexOf('\n'))!==-1){const row=buffer.slice(0,end);if(Buffer.byteLength(row)>16*1024*1024)throw new Error('Provider 单条事件超过 16 MiB');yield row.replace(/\r$/,'');buffer=buffer.slice(end+1);}if(Buffer.byteLength(buffer)>16*1024*1024)throw new Error('Provider 单条事件超过 16 MiB');}
  buffer+=decoder.end();if(buffer)yield buffer.replace(/\r$/,'');
}

export function portableEvents(provider,{session,content}) {
  let finalText='',complete=false,failure=null,observed=null,sawAssistantText=false;
  const output=(type,presentation,fields={},data={})=>({providerEventType:type,message:({output:'模型回复',thinking:'公开思考',tool:'工具调用',tool_result:'工具返回',error:'Provider 执行错误',system:'Provider 执行状态'})[presentation],data:{auditVersion:2,presentation,...data},...(Object.keys(fields).length?{content:content(fields)}:{})});
  const connected=id=>{
    if(!nativeSessionId(id))throw new Error('Provider 返回的会话 ID 无效');
    if(observed&&observed!==id || session?.resume&&session.sessionId!==id)throw new Error('Provider 返回的会话 ID 与当前成员绑定不一致');
    observed=id;return output('thread.started','system',{}, {sessionId:id});
  };
  const tool=(id,name,args)=>output('tool.started','tool',{input:args || {}},{toolUseId:id,toolName:name || '工具'});
  const returned=(id,value,isError=false)=>output('tool.completed','tool_result',{output:value},{toolResultId:id,status:isError?'failed':'completed'});
  const answer=(value,append=false)=>{const text=textOf(value);if(append)finalText+=text;else finalText=text;return output('assistant.message','output',{text});};
  const failed=value=>{failure=typeof value==='string'?value:value?.message || 'Provider 执行失败';complete=false;return output('error','error',{text:failure});};
  const normalize=event=>{
    const events=[];
    if(provider==='gemini') {
      if(event.type==='init')return connected(event.session_id);
      if(event.type==='message'&&event.role==='assistant')return answer(event.content,event.delta===true);
      if(event.type==='tool_use'){finalText='';complete=false;return tool(event.tool_id,event.tool_name,event.parameters);}
      if(event.type==='tool_result')return returned(event.tool_id,event.output || event.error?.message,event.status==='error');
      if(event.type==='error')return event.severity==='warning'?output('warning','system',{text:event.message}):failed(event.message);
      if(event.type==='result'){complete=event.status==='success';if(!complete)return failed(event.error);failure=null;}
    }else if(provider==='cursor'||provider==='qwen') {
      if(event.type==='system'&&event.session_id)return connected(event.session_id);
      if(event.type==='thinking'&&event.text)return output('thinking','thinking',{thinking:event.text});
      if(event.type==='assistant') {
        const parts=Array.isArray(event.message?.content)?event.message.content:[{type:'text',text:event.message?.content}];
        finalText=textOf(parts);if(finalText)sawAssistantText=true;complete=false;
        for(const part of parts){
          if(part.type==='text')events.push(output('assistant.message','output',{text:part.text}));
          if(part.type==='thinking')events.push(output('thinking','thinking',{thinking:part.thinking}));
          if(part.type==='tool_use')events.push(tool(part.id,part.name,part.input));
        }
        return events;
      }
      if(event.type==='user')return (event.message?.content || []).filter?.(part=>part.type==='tool_result').map(part=>returned(part.tool_use_id,textOf(part.content),part.is_error));
      if(event.type==='tool_call') {
        const name=Object.keys(event.tool_call || {})[0],call=event.tool_call?.[name] || {};
        return event.subtype==='completed'?returned(event.call_id,call.result):tool(event.call_id,name,call.args);
      }
      if(event.type==='error')return failed(event.error || event.message);
      if(event.type==='result'){complete=event.subtype==='success'&&event.is_error!==true;if(!complete)return failed(event.error || event.result);failure=null;if(event.result&&(provider!=='cursor'||!sawAssistantText))finalText=event.result;return output('result','system');}
    }else if(provider==='kimi') {
      // Kimi Code 2 emits the actual native ID in its terminal resume hint.
      // Earlier content cannot be treated as confirmation of a platform UUID.
      if(event.role==='meta'&&event.type==='session.resume_hint'){complete=Boolean(finalText);return connected(event.session_id);}
      if(event.role==='meta'&&event.type==='turn.step.retrying')return output('system','error',{text:{attempt:event.failed_attempt,nextAttempt:event.next_attempt,status:event.status_code,message:event.error_message}},{subtype:'api_retry'});
      if(event.role==='assistant') {
        if(event.content)events.push(answer(event.content));
        for(const call of event.tool_calls || [])events.push(tool(call.id,call.function?.name,call.function?.arguments));
        complete=false;failure=null;
      }
      if(event.role==='tool')events.push(returned(event.tool_call_id,event.content));
      if(event.type==='error')events.push(failed(event.error || event.message));
      return events;
    }else if(provider==='pi') {
      if(event.type==='session')return connected(event.id);
      if(event.type==='message_end'&&event.message?.role==='assistant'){
        if(['error','aborted'].includes(event.message.stopReason))return failed(event.message.errorMessage || event.message.stopReason);
        const thinking=event.message.content?.filter(p=>p.type==='thinking').map(p=>p.thinking).join('\n');
        if(thinking)events.push(output('thinking','thinking',{thinking}));
        const text=textOf(event.message.content);if(text)events.push(answer(text));failure=null;return events;
      }
      if(event.type==='tool_execution_start')return tool(event.toolCallId,event.toolName,event.args);
      if(event.type==='tool_execution_end')return returned(event.toolCallId,textOf(event.result?.content),event.isError);
      if(event.type==='auto_retry_end'&&!event.success)return failed(event.finalError);
      if(event.type==='agent_end')complete=event.willRetry!==true&&!failure;
      if(event.type==='agent_settled'){complete=!event.aborted&&!failure;if(event.aborted)return failed('Pi 已中止执行');}
    }else if(provider==='opencode') {
      if(event.sessionID&&!observed)events.push(connected(event.sessionID));
      const part=event.part || {};
      if(event.type==='text')events.push(answer(part.text,true));
      if(event.type==='reasoning')events.push(output('thinking','thinking',{thinking:part.text}));
      if(event.type==='tool_use'){
        events.push(tool(part.callID,part.tool,part.state?.input));
        if(['completed','error'].includes(part.state?.status))events.push(returned(part.callID,part.state.output || part.state.error,part.state.status==='error'));
      }
      if(event.type==='step_start'){finalText='';complete=false;}
      if(event.type==='step_finish'&&part.reason==='stop'){complete=true;failure=null;}
      if(event.type==='error')events.push(failed(event.error?.data || event.error));
      return events;
    }
    return output(event.type || 'provider.event','system');
  };
  return {normalize,getTerminalFailure:()=>failure,getFinal:()=>{if(!complete)throw new Error('Provider 未返回明确的完成事件');if(!observed)throw new Error('Provider 未确认成员会话 ID');return finalText;}};
}

export function nativeModelWithEffort({provider,model,effort}) {
  if(!effort)return model;
  if(provider==='opencode')return model.split('#')[0]+'#'+effort;
  if(provider==='cursor'){
    if(/-(none|minimal|low|medium|high|xhigh|max)(-fast)?$/.test(model))return model.replace(/-(none|minimal|low|medium|high|xhigh|max)(-fast)?$/,(_,old,fast)=>'-'+effort+(fast || ''));
    if(model.endsWith(']')&&model.includes('[')){const offset=model.indexOf('['),parts=model.slice(offset+1,-1).split(',').filter(x=>x.trim()&&!x.trim().startsWith('effort='));return model.slice(0,offset)+'['+[...parts,'effort='+effort].join(',')+']';}
    return model+'[effort='+effort+']';
  }
  return model;
}

export async function runPortableCli(input,api) {
  const {runtime,traceDirectory,session:requested}=input,provider=runtime.provider;
  if(!PORTABLE_RUNTIME_IDS.includes(provider))throw new Error('不支持的原生 CLI');
  if(!runtime.extensionSelection && ((runtime.extensionManifest || []).length || runtime.skillPaths?.length || runtime.pluginPaths?.length || runtime.mcpConfigPaths?.length))throw new Error('扩展路径缺少冻结的员工选择');
  const requestedDirectories=input.contextDirectories ?? [];
  if(!Array.isArray(requestedDirectories)||[traceDirectory,...requestedDirectories].some(path=>typeof path!=='string'||!isAbsolute(path)||/[\0\r\n]/.test(path)))throw new Error('执行上下文目录必须是绝对路径数组');
  const contextDirectories=[...new Set([traceDirectory,...requestedDirectories])];
  const command=runtime.executable || RUNTIME_PROVIDERS[provider].command;
  const environment=cliEnvironment(command,{},input.environment?{environment:input.environment}:{});
  environment.PWD=input.workspacePath;
  if(provider==='kimi' && runtime.effort)environment.KIMI_MODEL_THINKING_EFFORT=runtime.effort;
  let hostContext=provider==='cursor'?await prepareCursorHome(input,environment):'';
  if(provider==='gemini')hostContext=await prepareGeminiHome(input,environment);
  hostContext ||= await preparePortableConnectionProfile(input,environment,memberContext(input));
  // Clear only invocation-owned files before checking ambient configuration.
  if(provider==='cursor')await rm(join(environment.HOME,'.cursor','mcp.json'),{force:true});
  if(provider==='gemini')await rm(join(environment.GEMINI_CLI_HOME,'.gemini','skills'),{recursive:true,force:true});
  if(provider==='qwen')await rm(join(environment.QWEN_HOME,'skills'),{recursive:true,force:true});
  if(provider==='kimi'||provider==='pi')await rm(join(provider==='kimi'?environment.KIMI_CODE_HOME:environment.PI_CODING_AGENT_DIR,'mcp.json'),{force:true});
  for(const config of [provider==='qwen'?environment.QWEN_HOME:provider==='gemini'?join(environment.GEMINI_CLI_HOME,'.gemini'):provider==='kimi'?environment.KIMI_CODE_HOME:null].filter(Boolean))await rm(join(config,'agents'),{recursive:true,force:true});
  await assertPortableExtensionIsolation(provider,input.workspacePath,environment);
  const extensions=await preparePortableExtensions(input),nativeConfig=await configurePortableExtensions(input,environment,extensions);
  const session=requested || {sessionId:randomUUID(),resume:false};
  if(!nativeSessionId(session.sessionId))throw new Error('会话 ID 无效');
  const instructions=join(traceDirectory,'agentforge-instructions.md');
  const schema=input.outputSchema?`\n返回符合以下 JSON Schema 的 JSON，不包含代码围栏：\n${JSON.stringify(input.outputSchema)}`:'';
  const applicationInstructions=[hostContext,input.systemPrompt || ''].filter(Boolean).join('\n')+schema;
  await input.onPrompt?.({...input,systemPrompt:applicationInstructions});
  await writeFile(instructions,applicationInstructions,{mode:0o600});
  const prompt=provider==='cursor'?`[应用指令]\n${hostContext}\n${input.systemPrompt || ''}${schema}\n\n[本轮输入]\n${input.prompt}`:input.prompt;
  if(provider==='gemini')environment.GEMINI_SYSTEM_MD=instructions;
  if(provider==='opencode'){const {agents,...configuration}=nativeConfig;environment.OPENCODE_CONFIG_CONTENT=JSON.stringify({update:'disable',...configuration,agents:{...agents,agentforge:{mode:'primary',system:applicationInstructions}}});}
  let args;
  if(provider==='cursor')args=['--print','--force','--trust','--approve-mcps',...extensions.plugins.flatMap(path=>['--plugin-dir',path]),'--output-format','stream-json',...(session.resume?['--resume',session.sessionId]:[])];
  if(provider==='gemini')args=['--skip-trust','--extensions','none','--output-format','stream-json','--approval-mode','yolo',...(session.resume?['--resume',session.sessionId]:[])];
  if(provider==='qwen')args=['--output-format','stream-json','--approval-mode','yolo','--append-system-prompt',(input.systemPrompt || '')+schema,...(session.resume?['--resume',session.sessionId]:[])];
  if(provider==='kimi'){
    const key=createHash('sha256').update(input.executionKey || input.runId || traceDirectory).digest('hex').slice(0,24),context=join(input.workspacePath,'.agentforge','runtime-context',key),active=join(context,'instructions.md');
    await mkdir(context,{recursive:true,mode:0o700});await writeFile(active,(input.systemPrompt || '')+schema,{mode:0o600});
    const agent=join(traceDirectory,'agentforge-agent.md');await writeFile(agent,`---\nname: agentforge\ndescription: AgentForge 当前成员\n---\n\${base_prompt}\n\n每次开始处理用户输入之前，必须读取应用维护的系统指令文件 ${active} 并遵循当前内容。这是本会话的应用指令来源，后续轮次该文件会更新。\n`,{mode:0o600});
    const emptySkills=extensions.skillsRoot;
    args=['-p',input.prompt,'--output-format','stream-json',...(extensions.skills.length?[...new Set(extensions.skills.map(skill=>dirname(skill.path)))].flatMap(path=>['--skills-dir',path]):['--skills-dir',emptySkills]),...(session.resume?['--session',session.sessionId]:['--agent-file',agent])];
  }
  if(provider==='pi'){
    const sessions=join(input.workspacePath,'.agentforge','pi-sessions');await mkdir(sessions,{recursive:true,mode:0o700});
    args=['--mode','json','--no-extensions','--extension','builtin:mcp',...(nativeConfig.piExtension?['--extension',nativeConfig.piExtension]:[]),'--no-skills',...extensions.skills.flatMap(skill=>['--skill',skill.path]),'--no-prompt-templates','--no-approve','--session-dir',sessions,'--append-system-prompt',instructions,...(session.resume?['--session',session.sessionId]:[]),...(runtime.effort?['--thinking',runtime.effort]:[])];
  }
  if(provider==='opencode')args=['run','--standalone','--format','json','--auto','--agent','agentforge',...(session.resume?['--session',session.sessionId]:[])];
  if(['gemini','qwen'].includes(provider))args.push(...contextDirectories.flatMap(path=>['--include-directories',path]));
  if(provider==='cursor')args.push(...contextDirectories.flatMap(path=>['--add-dir',path]));
  if(runtime.model)args.push('--model',nativeModelWithEffort(runtime));
  const diagnosticPrompt=[input.systemPrompt,input.prompt].filter(Boolean);
  if(provider==='opencode'&&session.resume){
    // v2 run --session silently creates a missing ID. Check that exact native
    // session first. Discard the sanitized export as a stream: no transcript
    // copy, JSON stringify, memory-sized history, or platform session guessing.
    const discard=async function*(stream){for await(const chunk of stream){void chunk;}};
    await api.execute({...input,command,args:['session','export','--standalone','--sanitize',session.sessionId],cwd:input.workspacePath,env:environment,stdin:undefined,lineReader:discard,provider:'OpenCode',session,diagnosticPrompt,failEarlyAuthentication:true,normalizeEvent:()=>null,getFinal:()=> 'session exists',idleTimeoutMs:30000});
  }
  const events=portableEvents(provider,{session,content:fields=>api.content(fields,diagnosticPrompt)});
  return api.execute({...input,command,args,cwd:input.workspacePath,env:environment,stdin:provider==='kimi'?undefined:prompt,lineReader:readNativeJsonl,provider:RUNTIME_PROVIDERS[provider].label,session,diagnosticPrompt,failEarlyAuthentication:true,normalizeEvent:events.normalize,getFinal:events.getFinal,getTerminalFailure:events.getTerminalFailure});
}
