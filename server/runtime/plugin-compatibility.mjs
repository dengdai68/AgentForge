import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

export const COMPATIBILITY_VERSION = 2;
export const compatibilityDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const DSH_TOOL_NAMES = {Read:'read',Write:'write',Edit:'edit',Bash:'bash',Glob:'glob',Grep:'grep',WebSearch:'web_search',WebFetch:'web_fetch',Task:'Task',Agent:'Agent'};
const bridgeEvents = {
  'claude-code': new Set(['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Stop','SubagentStart','SubagentStop']),
  codex: new Set(['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Stop'])
};
const tokens = value => value === undefined ? undefined : Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s*,\s*/).filter(Boolean) : null;

export function parsePluginMarkdown(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const attributes = match ? yaml.load(match[1], {schema:yaml.JSON_SCHEMA, json:true}) || {} : {};
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) throw new Error('插件 Markdown frontmatter 必须是对象');
  return {attributes, body:match ? content.slice(match[0].length) : content};
}

export async function pluginExecutionPlan(info, root, target) {
  const reasons = [...info.reasons], sourceDialect = info.sourceDialect || 'claude-code';
  const agents = [];
  for (const component of info.components.agents) {
    if (isAbsolute(component.path) || component.path.split('/').includes('..')) throw new Error('子代理路径越界');
    const content = await readFile(join(root, component.path), 'utf8');
    const {attributes} = parsePluginMarkdown(content);
    const tools = tokens(attributes.tools), deniedTools = tokens(attributes.disallowedTools);
    const name = String(attributes.name || component.name);
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name)) throw new Error('子代理名称无效');
    if (tools === null || deniedTools === null || [...(tools || []),...(deniedTools || [])].some(value=>typeof value !== 'string')) throw new Error(`子代理 ${name} 的 tools 必须为名称列表`);
    if (target !== 'claude-code') {
      const supported = new Set(['name','description','tools','disallowedTools','model','color']);
      for (const key of Object.keys(attributes)) if (!supported.has(key)) reasons.push(`子代理 ${name} 的 ${key} 尚无 ${target} 等价映射`);
      if (target === 'dsh' && attributes.model && attributes.model !== 'inherit') reasons.push(`子代理 ${name} 指定模型 ${attributes.model}，DeepSeek Harness 尚无该源模型映射`);
      if(target==='codex' && sourceDialect==='claude-code' && attributes.model && attributes.model!=='inherit') reasons.push(`子代理 ${name} 指定 Claude 模型 ${attributes.model}，Codex 尚无该源模型映射`);
      if(target==='codex' && tools?.some(tool=>['Read','Glob','Grep'].includes(tool)) && !tools.includes('Bash')) reasons.push(`子代理 ${name} 的读取/搜索工具需要 Codex shell 映射，但源未启用 Bash`);
      if(target==='dsh') for(const tool of [...(tools || []),...(deniedTools || [])]) if(!Object.hasOwn(DSH_TOOL_NAMES,tool) && !tool.startsWith('mcp__')) reasons.push(`子代理 ${name} 的工具 ${tool} 尚无 DeepSeek Harness 等价映射`);
    }
    if(target==='claude-code' && sourceDialect==='codex' && attributes.model && attributes.model!=='inherit') reasons.push(`子代理 ${name} 指定 Codex 模型 ${attributes.model}，Claude Code 尚无该源模型映射`);
    agents.push({...component,name,description:attributes.description || component.description || '',model:attributes.model || 'inherit',...(tools?{tools}:{}),...(deniedTools?{deniedTools}:{}),sha256:createHash('sha256').update(content).digest('hex')});
  }
  if (new Set(agents.map(agent=>agent.name)).size !== agents.length) reasons.push('插件包含重复子代理名称');
  if(target!=='claude-code') for(const command of info.components.commands || []) {
    const {attributes,body}=parsePluginMarkdown(await readFile(join(root,command.path),'utf8'));
    if(/\$ARGUMENTS|\$\d|!`/.test(body) || Object.keys(attributes).some(key=>!['name','description','argument-hint'].includes(key))) reasons.push(`Command ${command.name} 的参数/预处理或专用字段尚无 ${target} 等价映射`);
  }
  if (target === 'dsh') for (const hook of info.components.hooks) {
    if (!bridgeEvents[sourceDialect].has(hook.event)) reasons.push(`DeepSeek Harness 的 ${sourceDialect} 桥尚无 Hook ${hook.event} 的等价映射`);
    for (const group of hook.matchers) {
      if(!group || !Array.isArray(group.hooks)) {reasons.push(`Hook ${hook.event} 处理器必须为数组`);continue;}
      if (group.matcher) try { new RegExp(group.matcher); } catch { reasons.push(`Hook ${hook.event} matcher 不是有效表达式`); }
      for (const handler of group.hooks) {
        if (handler?.async || handler?.if) reasons.push(`Hook ${hook.event} 的 async/if 尚无等价映射`);
        if (!handler || handler.type !== 'command' || typeof handler.command !== 'string') {reasons.push(`DeepSeek Harness 的 ${sourceDialect} 桥仅支持 command Hook`);continue;}
        const allowed=new Set(['type','command','timeout','timeoutSec','statusMessage','async','if']);
        for(const key of Object.keys(handler))if(!allowed.has(key))reasons.push(`Hook ${hook.event} 的 ${key} 尚无 DeepSeek Harness 等价映射`);
        if(handler.timeout!==undefined && (!Number.isFinite(handler.timeout) || handler.timeout<=0)) reasons.push(`Hook ${hook.event} timeout 必须为正数`);
      }
    }
  }
  const plan = {version:COMPATIBILITY_VERSION,target,sourceDialect,agents,hooks:info.components.hooks};
  return {plan,supported:reasons.length === 0,reasons:[...new Set(reasons)],digest:compatibilityDigest(plan)};
}

// Translate tool subjects, never commands or arbitrary source text. Literal
// source matchers keep their exact-match semantics; regexes retain alternation.
export function dshHookMatchers(hooks, dialect) {
  return hooks.map(item=>({...item,matchers:item.matchers.map(group=>{
    const matcher = group.matcher;
    if (!matcher) return group;
    const mapped = matcher.split('|').map(name=>DSH_TOOL_NAMES[name] || name).join('|');
    return {...group,matcher:dialect === 'claude-code' && /^[\w|]+$/.test(matcher) ? mapped : matcher.replace(/\b(Read|Write|Edit|Bash|Glob|Grep|WebSearch|WebFetch|Task|Agent)\b/g,name=>DSH_TOOL_NAMES[name])};
  })}));
}
