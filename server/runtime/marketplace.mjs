import {RUNTIME_IDS} from '../../client/runtime-providers.mjs';
import {runtimeLabel} from "../../client/runtime-providers.mjs";
import { mkdir, lstat, readFile, writeFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {runtimeStoragePath,runtimeStorageReferences} from '../storage-layout.mjs';
import { fileFingerprint } from '../file-fingerprints.mjs';
import { parseMcpJson, createRuntimeConfiguration } from './configuration.mjs';
import { diagnosticRedactor,diagnostic } from '../diagnostics.mjs';
import { pluginExecutionPlan, parsePluginMarkdown, COMPATIBILITY_VERSION } from './plugin-compatibility.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
const codexHookEvents=new Set(['SessionStart','SessionEnd','UserPromptSubmit','PreToolUse','PostToolUse','PermissionRequest','Stop','SubagentStart','SubagentStop','PreCompact','PostCompact','PreModelRequest','PostModelRequest','Interrupt']);
const claudeHookEvents=new Set(['SessionStart','Setup','UserPromptSubmit','UserPromptExpansion','PreToolUse','PermissionRequest','PermissionDenied','PostToolUse','PostToolUseFailure','PostToolBatch','Notification','MessageDisplay','SubagentStart','SubagentStop','TaskCreated','TaskCompleted','Stop','StopFailure','TeammateIdle','InstructionsLoaded','ConfigChange','CwdChanged','DirectoryAdded','FileChanged','WorktreeCreate','WorktreeRemove','PreCompact','PostCompact','PreModelSwitch','PostModelSwitch','Elicitation','ElicitationResult','SessionEnd']);
function pluginJson(content) {
  try {return JSON.parse(content);} catch {throw new Error('插件清单或 Hook JSON 格式无效，请检查来源文件');}
}
const summary = ({id,kind,name,description,createdAt,providers,compatibility,source,version,components,warnings}) => ({id,kind,name,description,createdAt,providers,...(compatibility?{compatibility}:{}),...(source ? {source} : {}),...(version ? {version} : {}),...(warnings?.length?{warnings}:{}),...(components ? {components:Object.fromEntries(Object.entries(components).map(([key,items])=>[key,items.length]))} : {})});
async function tree(root, copyTo, sourceRoot = root) {
  const files = []; let bytes = 0;
  const boundary = copyTo ? await realpath(sourceRoot) : root;
  const inside = path => path === boundary || path.startsWith(boundary+'/');
  const fail = (rel,reason,cause) => new Error(`插件文件 ${JSON.stringify(rel || '.')}：${reason}`,{cause});
  async function visit(path, rel, ancestors) {
    let actual, info;
    try { actual=await realpath(path); info=await lstat(path); }
    catch(cause) { throw fail(rel,cause.code==='ELOOP'?'链接循环，无法安装':'路径或链接目标不可读取，请修复后重试',cause); }
    if(!inside(actual)) throw fail(rel,'链接目标超出来源目录，请将所需文件放入来源后重试');
    // Source links are materialized only at install time. Frozen installed
    // snapshots must remain real files/directories; never follow a tampered link.
    if(!copyTo && (info.isSymbolicLink() || actual!==path)) throw fail(rel,'已安装目录包含链接');
    if(info.isSymbolicLink()) info=await lstat(actual);
    if(info.isDirectory()) {
      if(ancestors.has(actual)) throw fail(rel,'目录链接形成循环，请修复后重试');
      const next=new Set(ancestors);next.add(actual);
      if(copyTo) await mkdir(join(copyTo,rel),{recursive:true,mode:0o700});
      for(const name of (await readdir(actual)).sort()) {
        if(name!=='.git') await visit(join(actual,name),rel?join(rel,name):name,next);
      }
      return;
    }
    if(!info.isFile()) throw fail(rel,'不支持套接字、管道或设备等特殊文件，请移出插件后重试');
    bytes += info.size;
    if (bytes > 128*1024*1024 || files.length >= 8192) throw new Error('插件超过 128 MB 或 8192 个文件');
    if(copyTo) {const content=await readFile(actual);files.push([rel,digest(content)]);await writeFile(join(copyTo,rel),content,{flag:'wx',mode:info.mode&0o100?0o700:0o600});}
    else files.push([rel,await fileFingerprint(actual)]);
  }
  await visit(root,'',new Set()); return digest(JSON.stringify(files));
}
async function contained(root, path) {
  if(typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new Error('插件组件路径必须位于插件目录内');
  const target=resolve(root,path);
  if((target!==root && !target.startsWith(root+'/')) || await realpath(target)!==target) throw new Error('插件组件路径越界或包含链接');
  return target;
}
const exists = path => lstat(path).then(()=>true,error=>{if(error.code==='ENOENT') return false; throw error;});
async function pluginInfo(plugin,provider,{tolerant=false}={}) {
  const warnings=[],rejectedPaths=new Set();
  const invalid=message=>Object.assign(new Error(message),{code:'PLUGIN_COMPONENT_INVALID'});
  const skip=(error,component,path)=>{
    if(!tolerant || !['PLUGIN_MARKDOWN_INVALID','PLUGIN_COMPONENT_INVALID'].includes(error.code))throw error;
    warnings.push({plugin:plugin.name,component,path,message:error.message});
  };
  if(plugin.disabled) throw new Error('外部插件引用暂不支持，请直接读取该插件仓库');
  let manifest={};
  const prefersCodex=plugin.sourceDialect ? plugin.sourceDialect==='codex' : provider==='codex' || provider==='dsh' && await exists(join(plugin.path,'.codex-plugin/plugin.json'));
  const order=prefersCodex?['plugin.json','.codex-plugin/plugin.json','.claude-plugin/plugin.json']:['.claude-plugin/plugin.json','plugin.json','.codex-plugin/plugin.json'];
  const manifestFile=(await Promise.all(order.map(async path=>await exists(join(plugin.path,path))?path:null))).find(Boolean) || '.claude-plugin/plugin.json';
  const manifestPath=join(plugin.path,manifestFile);
  if(await exists(manifestPath)) {
    if((await lstat(manifestPath)).size>1024*1024) throw new Error('插件清单过大');
    manifest=pluginJson(await readFile(await contained(plugin.path,'./'+manifestFile),'utf8'));
    if(!manifest || typeof manifest!=='object' || Array.isArray(manifest)) throw new Error('插件清单无效');
  }
  const sourceDialect = plugin.sourceDialect || (manifestFile === '.claude-plugin/plugin.json' ? 'claude-code' : 'codex');
  const overlay=manifest.extensions?.['com.openai'];
  if(sourceDialect==='codex' && overlay && typeof overlay==='object') manifest={...manifest,...overlay};
  else if(provider==='codex' && manifestFile==='plugin.json' && await exists(join(plugin.path,'.codex-plugin/plugin.json'))) manifest={...manifest,...pluginJson(await readFile(await contained(plugin.path,'./.codex-plugin/plugin.json'),'utf8')),name:manifest.name};
  const componentKeys=['skills','agents','hooks','commands','mcpServers'];
  if(plugin.strict===false && Object.keys(manifest).length && componentKeys.some(key=>plugin[key]!==undefined)) throw new Error('插件 strict:false 与独立清单组件冲突');
  for(const key of componentKeys) if(plugin[key]!==undefined) {
    if(['skills','agents','commands'].includes(key) && manifest[key]!==undefined) manifest[key]=[...[manifest[key]].flat(),...[plugin[key]].flat()];
    else manifest[key]=plugin[key];
  }
  const mcpServers=Object.create(null);
  const nativeCodex=sourceDialect==='codex';
  const declarations=manifest.mcpServers===undefined ? [] : [manifest.mcpServers].flat();
  if(!nativeCodex || manifest.mcpServers===undefined) for(const path of ['.mcp.json','mcp.json']) if(await exists(join(plugin.path,path))) declarations.unshift('./'+path);
  for(const declaration of declarations) {
    const raw=typeof declaration==='string'?pluginJson(await readFile(await contained(plugin.path,declaration),'utf8')):declaration;
    const parsed=parseMcpJson(JSON.stringify({mcpServers:raw?.mcpServers || raw}));
    for(const [name,service] of Object.entries(parsed.mcpServers)) {
      mcpServers[name]=service;
    }
  }
  delete manifest.mcpServers;
  manifest.name ||= plugin.name;
  if(typeof manifest.name!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(manifest.name)) throw new Error('插件名称必须为字母、数字、点、横线或下划线');
  const skills=[], agents=[], hooks=[], commands=[];
  async function scan(path, kind) {
    const directory=await contained(plugin.path,path), info=await lstat(directory);
    if(info.isDirectory()) {
      if(kind==='skill' && await exists(join(directory,'SKILL.md'))) { await scan(path.replace(/\/$/,'')+'/SKILL.md',kind); return; }
      for(const name of (await readdir(directory)).sort()) await scan(path.replace(/\/$/,'')+'/'+name,kind);
      return;
    }
    if(!info.isFile() || !directory.endsWith('.md') || (kind==='skill' && basename(directory)!=='SKILL.md')) return;
    const componentPath=relative(plugin.path,directory);
    try {
      const content=await readFile(directory,'utf8');
      if(Buffer.byteLength(content)>128*1024) throw invalid('Markdown 组件超过 128 KB');
      const {attributes}=parsePluginMarkdown(content,{path:componentPath});
      for(const key of ['name','description','model','color']) if(attributes[key]!==undefined && typeof attributes[key]!=='string')throw invalid(`Markdown ${key} 必须为文本`);
      const name=attributes.name ?? (kind==='skill'?basename(dirname(directory)):basename(directory,'.md'));
      if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name))throw invalid('组件名称格式无效');
      if(kind==='agent')for(const key of ['tools','disallowedTools'])if(attributes[key]!==undefined && !(typeof attributes[key]==='string' || Array.isArray(attributes[key]) && attributes[key].every(value=>typeof value==='string')))throw invalid(`子代理 ${key} 必须为名称列表`);
      const result={name,description:attributes.description || '',path:componentPath};
      const list=kind==='skill'?skills:kind==='agent'?agents:commands;
      if(!list.some(item=>item.path===result.path)){if(list.some(item=>item.name===name))throw invalid('组件名称重复');list.push(result);}
    }catch(error){skip(error,kind,componentPath);rejectedPaths.add(componentPath);}
  }
  for(const [key,kind] of [['skills','skill'],['agents','agent'],['commands','command']]) {
    if((key==='skills' ? !plugin.rootSkillSelection : manifest[key]===undefined) && await exists(join(plugin.path,key))) await scan(`./${key}`,kind);
    for(const path of manifest[key]===undefined ? [] : [manifest[key]].flat()) {
      if(typeof path!=='string'){skip(invalid(`${key} 仅支持相对路径声明`),kind,`plugin.json#${key}`);continue;}
      await scan(path,kind);
    }
  }
  const defaultHooks=(!nativeCodex || manifest.hooks===undefined) && await exists(join(plugin.path,'hooks/hooks.json'))?['./hooks/hooks.json']:[];
  const hookDeclarations=[...new Set([...defaultHooks,...(manifest.hooks===undefined?[]:[manifest.hooks].flat())])];
  for(const [declarationIndex,declaration] of hookDeclarations.entries()) {
    const path=typeof declaration==='string'?declaration:`plugin.json#hooks[${declarationIndex}]`;
    let config;
    try {
      if(typeof declaration==='string'){
        const content=await readFile(await contained(plugin.path,declaration),'utf8');
        try{config=JSON.parse(content);}catch{throw invalid('Hook JSON 格式无效');}
      }else config=declaration;
      if(!config || typeof config!=='object' || Array.isArray(config))throw invalid('Hook 配置必须为对象');
      const events=config.hooks ?? config;
      if(!events || typeof events!=='object' || Array.isArray(events))throw invalid('Hook 事件配置必须为对象');
      for(const [event,matchers] of Object.entries(events)) {
        const eventPath=`${path}#${event}`;
        if(!Array.isArray(matchers)){skip(invalid('Hook 事件应为数组'),'hook',eventPath);continue;}
        const valid=[];
        for(const [index,group] of matchers.entries()){
          const groupPath=`${eventPath}[${index}]`;
          try {
            if(!group || typeof group!=='object' || !Array.isArray(group.hooks))throw invalid('Hook 处理器必须为数组');
            if(group.matcher!==undefined){if(typeof group.matcher!=='string')throw invalid('Hook matcher 必须为文本');try{if(group.matcher!=='*')new RegExp(group.matcher);}catch{throw invalid('Hook matcher 不是有效表达式');}}
            const handlers=[];
            for(const [handlerIndex,handler] of group.hooks.entries())try{
              if(!handler || typeof handler!=='object' || Array.isArray(handler) || !['command','prompt','agent','http'].includes(handler.type))throw invalid('Hook 类型无效');
              const field=handler.type==='command'?'command':handler.type==='http'?'url':'prompt';
              if(typeof handler[field]!=='string' || !handler[field].trim())throw invalid(`Hook ${field} 必须为非空文本`);
              for(const key of ['timeout','timeoutSec'])if(handler[key]!==undefined && (!Number.isFinite(handler[key]) || handler[key]<=0))throw invalid('Hook 超时时间必须为正数');
              handlers.push(handler);
            }catch(error){skip(error,'hook',`${groupPath}.hooks[${handlerIndex}]`);}
            if(handlers.length)valid.push({...group,hooks:handlers});
          }catch(error){skip(error,'hook',groupPath);}
        }
        if(valid.length || matchers.length===0)hooks.push({event,matchers:valid});
      }
    }catch(error){skip(error,'hook',path);}
  }
  const reasons=[];
  if(provider!=='claude-code' && provider!=='codex') {
    for(const key of ['lspServers','settings','outputStyles']) if(manifest[key]) reasons.push(`DeepSeek Harness 适配器不支持 ${key}`);
  }
  if(provider==='codex') for(const key of ['lspServers','settings','outputStyles']) if(manifest[key]) reasons.push(`Codex 适配器不支持 ${key}`);
  for(const item of hooks) {
    if(provider!=='dsh' && !(provider==='codex'?codexHookEvents:claudeHookEvents).has(item.event)) reasons.push(`不支持 Hook 事件 ${item.event}`);
    if(provider==='codex' && item.matchers.some(group=>!Array.isArray(group.hooks) || group.hooks.some(hook=>hook.type!=='command' || typeof hook.command!=='string'))) reasons.push(`Hook ${item.event} 仅支持 command 类型`);
  }
  if(manifest.apps) reasons.push('当前本机 Runtime 不支持托管 App 映射');
  const normalized=Object.fromEntries(Object.entries(manifest).filter(([key])=>['name','description','version','author','homepage','repository','license','keywords','skills','agents','commands','hooks','outputStyles','lspServers','settings'].includes(key)));
  return {manifest:normalized,mcpServers,sourceDialect,warnings,rejectedPaths:[...rejectedPaths],components:{skills,agents,hooks,commands},supported:reasons.length===0,reasons};
}
export function selectionIds(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!['pluginIds','mcpIds'].includes(key))) throw new Error('扩展选择仅接受 pluginIds 和 mcpIds；不再接受 Skill 选择');
  return Object.fromEntries(['pluginIds','mcpIds'].map(key=>{
    if(!Array.isArray(value[key]) || value[key].some(id=>!uuid(id)) || new Set(value[key]).size!==value[key].length) throw new Error('扩展选择需要完整且不重复的插件/MCP 版本 ID');
    return [key,[...value[key]]];
  }));
}
const validationScope=new AsyncLocalStorage();
export function withExtensionValidation(work){return validationScope.getStore()?work():validationScope.run(new Map(),work);}
function validated(key,work){const cache=validationScope.getStore();if(!cache)return work();if(!cache.has(key))cache.set(key,Promise.resolve().then(work));return cache.get(key);}
export function readExtensionFile(ref){return validated('file:'+JSON.stringify(ref),()=>verifyExtensionFile(ref));}
async function verifyExtensionFile(ref) {
  ref=runtimeStorageReferences({extensionManifest:[ref]}).extensionManifest[0];
  try {
    const info=await lstat(ref.path);
    if(!info.isFile() || info.isSymbolicLink() || info.size>128*1024 || await realpath(ref.path)!==ref.path) throw new Error(`扩展清单不是有效的普通文件：${ref.path}`);
    const content=await readFile(ref.path,'utf8');
    if(digest(content)!==ref.sha256) throw new Error(`扩展清单 SHA256 不匹配：${ref.path}；expected=${ref.sha256}；actual=${digest(content)}`);
    if(ref.treeSha256) {
      const root=ref.kind==='plugin'?dirname(dirname(ref.path)):dirname(ref.path), actual=await tree(root);
      if(actual!==ref.treeSha256) throw new Error(`扩展目录 SHA256 不匹配：${root}；expected=${ref.treeSha256}；actual=${actual}`);
    }
    if(ref.resourceRoot) {
      const actual=await tree(ref.resourceRoot);
      if(actual!==ref.resourceSha256) throw new Error(`扩展资源 SHA256 不匹配：${ref.resourceRoot}；expected=${ref.resourceSha256}；actual=${actual}`);
    }
    if(ref.sourceRoot && await tree(ref.sourceRoot)!==ref.sourceSha256) throw new Error('插件原始源副本完整性校验失败');
    return content;
  } catch (error) {
    error.code='EXTENSION_INTEGRITY_FAILED'; error.retryable=false;
    throw error;
  }
}
export function readPluginExecutionPlan(ref){return validated('plan:'+JSON.stringify(ref),()=>verifyPluginExecutionPlan(ref));}
async function verifyPluginExecutionPlan(ref) {
  ref=runtimeStorageReferences({extensionManifest:[ref]}).extensionManifest[0];
  await readExtensionFile(ref);
  if(![2,COMPATIBILITY_VERSION].includes(ref.adapterVersion)) throw new Error('插件执行计划版本不支持');
  const root=dirname(dirname(ref.path));
  const info=await pluginInfo({path:root,name:ref.name,sourceDialect:ref.sourceDialect},ref.planTarget);
  const result=await pluginExecutionPlan(info,root,ref.planTarget,ref.adapterVersion);
  if(!result.supported || result.digest!==ref.planSha256) throw new Error(`插件执行计划校验失败：${result.reasons.join('；') || '冻结计划不一致'}`);
  return result.plan;
}
export function createMarketplace(root) {
  let toolDiscovery;
  const configuredRoot=resolve(root);
  let managedRoot=configuredRoot, directory=join(managedRoot,'marketplace'), pluginDirectory=join(managedRoot,'installed-plugins'), canonicalRoot=null;
  let locationStamp=null,locations=new Map(),locationWork;
  async function locationIndex(){
    const info=await lstat(pluginDirectory,{bigint:true}),stamp=[info.dev,info.ino,info.mtimeNs,info.ctimeNs].join(':');
    if(stamp===locationStamp)return locations;
    if(locationWork)return locationWork;
    locationWork=(async()=>{const entries=await batches();locations=new Map(entries.map(item=>[item.kind+':'+item.id,item.directory]));locationStamp=stamp;return locations;})();
    try{return await locationWork;}finally{locationWork=null;}
  }
  async function batches() {
    const result=[];
    for(const id of (await readdir(pluginDirectory)).filter(uuid).sort()) {
      const path=join(pluginDirectory,id,'batch.json');
      if(await exists(path)) {
        const content=JSON.parse(await readFile(path,'utf8'));
        if(content.protocol!==3 || !Array.isArray(content.entries) || content.entries.some(item=>!uuid(item.id)||!['plugin','mcp'].includes(item.kind))) throw new Error('插件安装批次无效');
        result.push(...content.entries.map(item=>({...item,directory:join(pluginDirectory,id,item.kind==='plugin'?'plugins':'mcps',item.id)})));
      }
    }
    return result;
  }
  async function ensure() {
    const checkDirectory=async path=>{
      await mkdir(path,{recursive:true,mode:0o700});
      const info=await lstat(path);
      if(info.isSymbolicLink() || !info.isDirectory()) throw Object.assign(new Error('市场配置根目录不可用：受管目录必须为真实文件夹，不能是符号链接；详情见诊断日志'),{code:'MARKETPLACE_DIRECTORY_INVALID',path,configuredRoot});
    };
    await checkDirectory(configuredRoot);
    const currentRoot=await realpath(configuredRoot);
    if(canonicalRoot && currentRoot!==canonicalRoot) throw Object.assign(new Error('市场配置根目录的实际位置已改变，请重启应用后重新检查目录'),{code:'MARKETPLACE_ROOT_CHANGED',path:configuredRoot,canonicalRoot,currentRoot});
    canonicalRoot=currentRoot;managedRoot=currentRoot;directory=join(managedRoot,'marketplace');pluginDirectory=join(managedRoot,'installed-plugins');
    for(const path of [directory,pluginDirectory]) await checkDirectory(path);
  }
  async function read(id, kind, installedDirectory) {
    if(!uuid(id)) throw new Error('扩展版本 ID 无效'); await ensure();
    const location=runtimeStoragePath(installedDirectory) || (await locationIndex()).get(kind+':'+id) || join(kind==='plugin'?pluginDirectory:directory,id);
    const file=join(location,'entry.json');
    try {
      if(await realpath(file)!==file || (await lstat(file)).size>2*1024*1024) throw new Error();
      const entry=JSON.parse(await readFile(file,'utf8'));
      if(entry.id!==id || entry.kind!==kind || ![2,3].includes(entry.protocol)) throw new Error();
      return {...entry,directory:location};
    } catch { throw new Error('已安装版本不可读取；请重新安装，不自动转换旧扩展协议'); }
  }
  const reference = (entry,provider) => ({id:entry.id,kind:entry.kind,name:entry.name,path:join(entry.directory || join(entry.kind==='plugin'?pluginDirectory:directory,entry.id),entry.kind==='plugin'?'plugin/.claude-plugin/plugin.json':'mcp.json'),sha256:entry.sha256,...(entry.protocol===3?{adapterVersion:1}:{}),...(entry.treeSha256?{treeSha256:entry.treeSha256,skills:entry.components.skills.map(item=>item.path)}:{}),...(entry.originalTreeSha256?{sourceRoot:join(entry.directory,'source'),sourceSha256:entry.originalTreeSha256}:{}),...(provider && entry.kind==='mcp'?{mcpAdapterVersion:2}:{}),...(provider && entry.plans?.[provider]?{adapterVersion:COMPATIBILITY_VERSION,planTarget:provider,sourceDialect:entry.plans[provider].plan.sourceDialect,planSha256:entry.plans[provider].digest}:{})});
  function currentCompatibility(entry){return validated('compatibility:'+entry.id,()=>parseCompatibility(entry));}
  async function parseCompatibility(entry) {
    if(entry.kind==='mcp') {
      parseMcpJson(await readFile(reference(entry).path,'utf8'));
      return {...entry,providers:RUNTIME_IDS};
    }
    const location=dirname(dirname(reference(entry).path)),plans={},runtimeComponents={},components=Object.fromEntries(['skills','agents','hooks','commands'].map(key=>[key,new Map()]));
    for(const provider of RUNTIME_IDS) {
      const info=await pluginInfo({path:location,name:entry.name,sourceDialect:provider==='dsh'?undefined:entry.sourceDialects?.[provider]},provider);
      // The installed inventory preserves an explicit marketplace root selection
      // and generated Command instruction files. Reparse their actual bytes;
      // do not rediscover neighbouring plugins as implicit default Skills.
      const selected=entry.runtimeComponents?.[provider]?.skills;
      if(selected) info.components.skills=await Promise.all(selected.map(async path=>{
        const {attributes}=parsePluginMarkdown(await readFile(await contained(location,'./'+path),'utf8'),{path});
        return {name:attributes.name || basename(dirname(path)),description:attributes.description || '',path};
      }));
      plans[provider]=await pluginExecutionPlan(info,location,provider);
      runtimeComponents[provider]={skills:info.components.skills.map(item=>item.path)};
      if(plans[provider].supported) for(const [key,list] of Object.entries(info.components)) for(const item of list) {
        const signature=JSON.stringify(item),record=components[key].get(signature) || {...item,providers:[]};record.providers.push(provider);components[key].set(signature,record);
      }
    }
    const compatibility=Object.fromEntries(Object.entries(plans).map(([provider,result])=>[provider,{supported:result.supported,reasons:result.reasons}]));
    return {...entry,plans,runtimeComponents,components:Object.fromEntries(Object.entries(components).map(([key,list])=>[key,[...list.values()]])),compatibility,providers:Object.keys(compatibility).filter(provider=>compatibility[provider].supported)};
  }
  async function catalogCompatibility(entry) {
    try {return await currentCompatibility(entry);}
    catch(error) {
      if(!['PLUGIN_MARKDOWN_INVALID','PLUGIN_COMPONENT_INVALID'].includes(error.code))throw error;
      return {...entry,providers:[],components:Object.fromEntries(Object.entries(entry.components).map(([key,items])=>[key,items.map(item=>({...item,providers:[]}))])),compatibility:Object.fromEntries(RUNTIME_IDS.map(provider=>[provider,{supported:false,reasons:[error.message]}]))};
    }
  }
  return {
    async catalog() {
      await ensure(); const plugins=[];
      for(const item of await batches()) if(item.kind==='plugin') plugins.push(summary(await catalogCompatibility(await read(item.id,'plugin',item.directory))));
      for(const id of (await readdir(pluginDirectory)).filter(uuid).sort()) if(await exists(join(pluginDirectory,id,'entry.json'))) plugins.push(summary(await catalogCompatibility(await read(id,'plugin',join(pluginDirectory,id)))));
      return {plugins:plugins.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};
    },
    async mcpCatalog() {
      await ensure(); const entries=[];
      for(const id of (await readdir(directory)).filter(uuid).sort()) {
        const file=join(directory,id,'entry.json');
        if(!await exists(file)) continue;
        let metadata;
        try {
          if(await realpath(file)!==file || !(await lstat(file)).isFile() || (await lstat(file)).size>2*1024*1024) throw new Error();
          metadata=JSON.parse(await readFile(file,'utf8'));
        } catch {throw new Error('已安装 MCP 元信息不可读取，请重新安装');}
        if(metadata.kind!=='mcp' || metadata.visibility!=='market' || metadata.protocol!==2) continue;
        entries.push(summary(await currentCompatibility(await read(id,'mcp',join(directory,id)))));
      }
      for(const item of await batches()) if(item.kind==='mcp') entries.push(summary(await currentCompatibility(await read(item.id,'mcp',item.directory))));
      return {entries:entries.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};
    },
    async list() {return [...(await this.catalog()).plugins,...(await this.mcpCatalog()).entries];},
    async tools(id,options={}) {
      const entry=await read(id,'mcp'),ref=reference(entry),configuration=parseMcpJson(await readExtensionFile(ref));
      const [name,service]=Object.entries(configuration.mcpServers)[0];
      const secrets=[...Object.values(service.env || {}),...Object.values(service.headers || {}),...(service.env_vars || []).map(key=>process.env[key]).filter(Boolean)];
      const discover=await (toolDiscovery ||= import('./mcp-tools.mjs').then(({createMcpToolDiscovery})=>createMcpToolDiscovery()));
      return discover(ref,name,{...options,secrets});
    },
    async detail(id,kind) {
      const raw=await read(id,kind),entry=kind==='plugin'?await catalogCompatibility(raw):await currentCompatibility(raw), content=await readExtensionFile(reference(entry));
      if(kind==='plugin') return diagnosticRedactor()({...summary(entry),components:entry.components,manifest:JSON.parse(content)});
      const configuration=parseMcpJson(content), secrets=Object.values(configuration.mcpServers).flatMap(server=>[...Object.values(server.env||{}),...Object.values(server.headers||{})]);
      const redact=diagnosticRedactor({secrets});
      for(const server of Object.values(configuration.mcpServers)) for(const key of ['env','headers']) if(server[key]) server[key]=Object.fromEntries(Object.keys(server[key]).map(name=>[name,'[已隐藏]']));
      return {...summary(entry),configuration:redact(configuration),redacted:secrets.length>0};
    },
    async import(input,options={}) {
      if(!input || typeof input!=='object' || Object.keys(input).some(key=>!['url','path'].includes(key)) || Boolean(input.url)===Boolean(input.path)) throw new Error('安装参数只接受一个 url 或 path；安装来源中的全部插件');
      await ensure();
      const catalog=await createRuntimeConfiguration(managedRoot).importPlugins(input,options);
      try{return await this.importCatalog(catalog,options);}
      finally{try{await catalog.dispose?.()}catch(error){diagnostic('plugins.source_cleanup_failed',{error})}}
    },
    async mcpEditInput(id,input) {
      if(!input || typeof input!=='object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key=>!['name','description','content'].includes(key))) throw new Error('MCP 编辑仅接受 name、description、content，至少提供一项');
      const entry=await read(id,'mcp'), raw=await readExtensionFile(reference(entry));
      let content=raw;
      if(input.content!==undefined) {
        const next=parseMcpJson(input.content), previous=parseMcpJson(raw), visible=(await this.detail(id,'mcp')).configuration;
        // Preserve unchanged redacted values by exact JSON location, never
        // expose private values in an edit response or save masking as a token.
        const restore=(value,old,masked)=>{
          if(typeof value==='string') {
            if(value===masked && old!==masked)return old;
            if(/\[已隐藏\]|\[REDACTED\]/i.test(value))throw new Error('隐藏值只能在原位置保留；修改服务名或鉴权字段时请填写新值，删除字段可清除');
            return value;
          }
          if(Array.isArray(value))return value.map((item,index)=>restore(item,old?.[index],masked?.[index]));
          if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,restore(item,old?.[key],masked?.[key])]));
          return value;
        };
        content=JSON.stringify(restore(next,previous,visible));
      }
      return {kind:'mcp',name:input.name===undefined?entry.name:input.name,description:input.description===undefined?entry.description:input.description,content};
    },
    async importCatalog(catalog,{pluginNames,includeMcps=true}={}) {
      await ensure();
      if(!Array.isArray(catalog.plugins) || !catalog.plugins.length) throw new Error('来源中没有插件');
      if(new Set(catalog.plugins.map(item=>item.name)).size!==catalog.plugins.length) throw new Error('来源包含重复插件名称');
      const batchId=randomUUID(), staging=join(pluginDirectory,`.install-${batchId}`), final=join(pluginDirectory,batchId), entries=[],warnings=[];
      try {
        await mkdir(staging,{recursive:true,mode:0o700});
        if(pluginNames?.some(name=>!catalog.plugins.some(plugin=>plugin.name===name)))throw new Error('来源已移除已安装插件，本次更新未应用');
        for(const plugin of catalog.plugins.filter(plugin=>!pluginNames || pluginNames.includes(plugin.name))) {
        if(plugin.disabled) throw new Error(`插件 ${plugin.name} 引用了外部来源，请直接安装对应仓库；本批次未安装`);
        const id=randomUUID(), target=join(staging,'plugins',id,'plugin');
        await mkdir(target,{recursive:true,mode:0o700});
        try { await tree(plugin.path,target,plugin.sourceRoot || plugin.path); }
        catch(cause) { throw new Error(`插件「${plugin.name}」无法安装：${cause.message}；本批次未安装`,{cause}); }
        const originalTreeSha256=await tree(plugin.path,join(staging,'plugins',id,'source'),plugin.sourceRoot || plugin.path);
        const variants=Object.fromEntries(await Promise.all(RUNTIME_IDS.map(async provider=>[provider,await pluginInfo({...plugin,path:target},provider,{tolerant:true})])));
        // Preserve all source bytes separately. Only the executable installation
        // excludes rejected Markdown and uses sanitized, dialect-specific manifests.
        for(const info of Object.values(variants))for(const warning of info.warnings)if(!warnings.some(item=>JSON.stringify(item)===JSON.stringify(warning)))warnings.push(warning);
        for(const path of new Set(Object.values(variants).flatMap(info=>info.rejectedPaths)))await rm(await contained(target,'./'+path));
        if(warnings.some(item=>item.plugin===plugin.name) && Object.values(variants).every(info=>!Object.values(info.components).some(items=>items.length) && !Object.keys(info.mcpServers).length)){
          await rm(dirname(target),{recursive:true,force:true});continue;
        }
        for(const [provider,info] of Object.entries(variants)) {
        Object.assign(info,await pluginExecutionPlan(info,target,provider));
        const commandSkills=[];
        for(const [index,command] of info.components.commands.entries()) {
          const path=`.agentforge/command-skills/${digest(command.path).slice(0,16)}/SKILL.md`,name=`command-${command.name}`.slice(0,64);
          const body=(await readFile(join(target,command.path),'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
          await mkdir(dirname(join(target,path)),{recursive:true,mode:0o700});
          await writeFile(join(target,path),`---\nname: ${name}\ndescription: ${JSON.stringify(command.description || 'Adapted reusable command instructions')}\n---\n原 Command 作为可复用 Skill 说明加载；不提供斜杠参数展开或命令预处理。缺少参数时先询问，不自动执行预处理片段。\n\n${body}`,{mode:0o600});
          info.components.skills.push({name,description:'从 Command 适配的说明；无斜杠预处理',path});commandSkills.push('./'+path);
        }
        if(commandSkills.length) info.manifest.skills=[...[info.manifest.skills || []].flat(),...commandSkills];
        Object.assign(info,await pluginExecutionPlan(info,target,provider));
        }
        for(const [provider,variant] of Object.entries(variants)){
          variant.manifest.skills=[...new Set(variant.components.skills.map(item=>'./'+dirname(item.path)))];
          variant.manifest.agents=variant.components.agents.map(item=>'./'+item.path);
          variant.manifest.commands=variant.components.commands.map(item=>'./'+item.path);
          const hooksPath=`.agentforge/${provider}-hooks.json`;
          await mkdir(dirname(join(target,hooksPath)),{recursive:true,mode:0o700});
          const events={};for(const item of variant.components.hooks)(events[item.event] ||= []).push(...item.matchers);
          await writeFile(join(target,hooksPath),JSON.stringify({hooks:events}),{mode:0o600});
          variant.manifest.hooks='./'+hooksPath;
        }
        if(await exists(join(target,'hooks/hooks.json')))await writeFile(join(target,'hooks/hooks.json'),'{}',{mode:0o600});
        // Keep an existing Codex dialect independent of the Claude manifest.
        if(await exists(join(target,'.codex-plugin/plugin.json'))){await writeFile(join(target,'.codex-plugin/plugin.json'),JSON.stringify(variants.codex.manifest),{mode:0o600});}
        if(await exists(join(target,'plugin.json')))await writeFile(join(target,'plugin.json'),JSON.stringify(variants.codex.manifest),{mode:0o600});
        const info=variants['claude-code'],codex=variants.codex;
        const components=Object.fromEntries(['skills','agents','hooks','commands'].map(key=>{
          const merged=new Map();for(const [provider,variant] of Object.entries(variants))for(const item of variant.components[key]){if(!variant.supported)continue;const signature=JSON.stringify(item),record=merged.get(signature)||{...item,providers:[]};record.providers.push(provider);merged.set(signature,record);}return [key,[...merged.values()]];
        }));
        const compatibility=Object.fromEntries(Object.entries(variants).map(([provider,variant])=>[provider,{supported:variant.supported,reasons:variant.reasons}]));
        const mcpVariants=[];
        for(const [provider,variant] of Object.entries(variants))for(const [name,service] of Object.entries(variant.mcpServers)) {
          const existing=mcpVariants.find(item=>item.name===name && JSON.stringify(item.service)===JSON.stringify(service));
          if(existing)existing.providers.push(provider);else mcpVariants.push({name,service,providers:[provider]});
        }
        // Provider auto-discovery must never activate a bundled MCP with its plugin.
        for(const file of ['.mcp.json','mcp.json']) if(await exists(join(target,file))) await writeFile(join(target,file),'{"mcpServers":{}}',{mode:0o600});
        await mkdir(join(target,'.claude-plugin'),{recursive:true,mode:0o700});
        await writeFile(join(target,'.claude-plugin/plugin.json'),JSON.stringify(info.manifest),{mode:0o600});
        await mkdir(join(target,'.agentforge'),{recursive:true,mode:0o700});
        await writeFile(join(target,'.agentforge/codex.json'),JSON.stringify({hooks:codex.components.hooks,agents:codex.components.agents}),{mode:0o600});
        const entry={protocol:3,warnings:warnings.filter(item=>item.plugin===plugin.name),originalTreeSha256,sourceDialects:Object.fromEntries(Object.entries(variants).map(([provider,info])=>[provider,info.sourceDialect])),id,kind:'plugin',name:plugin.name,description:String(plugin.description || info.manifest.description || '').slice(0,500),version:info.manifest.version || '',createdAt:new Date().toISOString(),source:{...(plugin.source || {url:catalog.url,revision:catalog.revision}),origin:{url:catalog.url,revision:catalog.revision}},components,compatibility,runtimeComponents:Object.fromEntries(Object.entries(variants).map(([provider,variant])=>[provider,{skills:variant.components.skills.map(item=>item.path)}])),providers:Object.keys(variants).filter(provider=>compatibility[provider].supported),sha256:digest(await readFile(join(target,'.claude-plugin/plugin.json'))),treeSha256:await tree(target)};
        await writeFile(join(dirname(target),'entry.json'),JSON.stringify(entry),{flag:'wx',mode:0o600}); entries.push(entry);
        for(const {name,service,providers} of includeMcps?mcpVariants:[]) {
          const expand=value=>typeof value==='string'?value.replaceAll('${CLAUDE_PLUGIN_ROOT}',join(final,'plugins',id,'plugin')).replaceAll('${PLUGIN_ROOT}',join(final,'plugins',id,'plugin')):Array.isArray(value)?value.map(expand):value && typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,expand(item)])):value;
          const resolvedService=expand(service);
          if(resolvedService.cwd && !resolvedService.cwd.startsWith('/')) resolvedService.cwd=resolve(join(final,'plugins',id,'plugin'),resolvedService.cwd);
          const expanded=JSON.stringify({mcpServers:{[name]:resolvedService}});
          const mcpId=randomUUID(), location=join(staging,'mcps',mcpId);
          await mkdir(location,{recursive:true,mode:0o700});
          const separate=mcpVariants.filter(item=>item.name===name).length>1;
          const mcp=await this.add({kind:'mcp',name:`${entry.name} · ${name}${separate?' · '+providers.join('/') : ''}`.slice(0,80),description:`来自插件 ${entry.name}；需员工单独选择`,content:expanded},location,mcpId);
          if(separate || resolvedService.cwd || resolvedService.env_vars){mcp.providers=providers;await writeFile(join(location,'entry.json'),JSON.stringify(mcp),{mode:0o600});}
          entries.push(mcp);
        }
        }
        await writeFile(join(staging,'batch.json'),JSON.stringify({protocol:3,entries:entries.map(({id,kind})=>({id,kind}))}),{flag:'wx',mode:0o600});
        await rename(staging,final);return {warnings,plugins:entries.filter(item=>item.kind==='plugin').map(summary),mcps:entries.filter(item=>item.kind==='mcp').map(summary)};
      } catch(error) {await rm(staging,{recursive:true,force:true});throw error;}
    },
    async add(input, location, entryId) {
      if(!input || input.kind!=='mcp' || typeof input.name!=='string' || !input.name.trim() || input.name.length>80 || typeof input.description!=='string' || input.description.length>500) throw new Error('请填写 MCP 名称（最多 80 字）和说明（最多 500 字）');
      const configuration=parseMcpJson(input.content), names=Object.keys(configuration.mcpServers);
      if(names.length!==1 || ['agentforge_history','__proto__','prototype','constructor'].includes(names[0])) throw new Error('每次只安装一个 MCP Server，不能使用平台保留名称');
      const service=configuration.mcpServers[names[0]], remote=['http','sse'].includes(service.type), allowed=remote?['type','url','headers']:['type','command','args','env','cwd','env_vars'];
      if(Object.keys(service).some(key=>!allowed.includes(key))) throw new Error('MCP 包含不支持的字段');
      if(service.cwd && !service.cwd.startsWith('/'))throw new Error('MCP cwd 必须为绝对目录');
      const content=JSON.stringify(configuration,null,2), id=entryId || randomUUID(), entry={protocol:location?3:2,id,kind:'mcp',name:input.name.trim(),description:input.description.trim(),createdAt:new Date().toISOString(),providers:RUNTIME_IDS,sha256:digest(content),visibility:'market'};
      await ensure();const target=location || join(directory,id);await mkdir(target,{recursive:true,mode:0o700});await writeFile(join(target,'mcp.json'),content,{flag:'wx',mode:0o600});await writeFile(join(target,'entry.json'),JSON.stringify(entry),{flag:'wx',mode:0o600});return location?entry:summary(entry);
    },
    resolveRole(selection) { return withExtensionValidation(async()=>{
      const selected=selectionIds(selection);
      const entries=await Promise.all(['plugin','mcp'].flatMap(kind=>selected[kind==='plugin'?'pluginIds':'mcpIds'].map(async id=>currentCompatibility(await read(id,kind)))));
      const providers=RUNTIME_IDS.filter(provider=>entries.every(item=>item.providers.includes(provider)));
      if(!providers.length)throw new Error('所选角色扩展没有共同兼容的 Runtime');
      const extensionBindings=Object.fromEntries(await Promise.all(providers.map(async provider=>[provider,await this.resolve(selected,provider)])));
      return {extensionSelection:selected,extensionBindings};
    }); },
    async resolveRoleReplacements(roles,replacements) {
      const maps=Object.fromEntries(['plugin','mcp'].map(kind=>[kind,new Map(replacements.filter(item=>(item.kind || 'plugin')===kind).map(item=>[item.previousId,item.id]))]));
      return Promise.all(roles.filter(role=>['plugin','mcp'].some(kind=>role.extensionSelection?.[kind==='plugin'?'pluginIds':'mcpIds']?.some(id=>maps[kind].has(id)))).map(async role=>({roleId:role.id,previousSelection:role.extensionSelection,...await this.resolveRole(Object.fromEntries(['plugin','mcp'].map(kind=>{const key=kind==='plugin'?'pluginIds':'mcpIds';return [key,[...new Set(role.extensionSelection[key].map(id=>maps[kind].get(id)||id))]];})))})));
    },
    resolve(selection,provider) { return withExtensionValidation(async()=>{
      const selected=selectionIds(selection), extensionManifest=[], names=new Set();
      for(const kind of ['plugin','mcp']) for(const id of selected[kind==='plugin'?'pluginIds':'mcpIds']) {
        const entry=await currentCompatibility(await read(id,kind));
        if(!entry.providers.includes(provider)) throw new Error(`${kind==='plugin'?'插件':'MCP'}「${entry.name}」与 ${runtimeLabel(provider)} 不兼容：${entry.compatibility?.[provider]?.reasons?.join('；') || (kind==='mcp'?'当前 MCP 配置包含此 Runtime 不支持的字段':'当前 Runtime 不支持此插件组件')}`);
        const ref=reference(entry,provider);
        if(kind==='plugin' && entry.runtimeComponents) ref.skills=entry.runtimeComponents[provider].skills;
        const content=await readExtensionFile(ref);
        if(kind==='mcp') {const name=Object.keys(parseMcpJson(content).mcpServers)[0];if(names.has(name)) throw new Error('MCP 服务名称重复，请只选择一个版本');names.add(name);}
        else {
          const namespace=JSON.parse(content).name;
          if(names.has(`plugin:${namespace}`)) throw new Error(`插件命名空间「${namespace}」重复，请只选择一个版本（市场别名不改变插件名称）`);
          names.add(`plugin:${namespace}`);
        }
        extensionManifest.push(ref);
      }
      return {extensionSelection:selected,extensionManifest,skillPaths:extensionManifest.filter(ref=>ref.kind==='plugin').flatMap(ref=>ref.skills.map(path=>join(dirname(dirname(ref.path)),path))),pluginPaths:provider==='claude-code'?extensionManifest.filter(ref=>ref.kind==='plugin').map(ref=>dirname(dirname(ref.path))):[],mcpConfigPaths:extensionManifest.filter(ref=>ref.kind==='mcp').map(ref=>ref.path),pluginSources:[]};
    }); }
  };
}
