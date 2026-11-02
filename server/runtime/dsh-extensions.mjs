// Runs only inside the installed Harness, from a private invocation directory.
import { readFile, writeFile, realpath, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const sourceTools = {read:'Read',write:'Write',edit:'Edit',bash:'Bash',glob:'Glob',grep:'Grep',web_search:'WebSearch',web_fetch:'WebFetch',skill:'Skill',ask_user_question:'AskUserQuestion'};
const nativeTools = Object.fromEntries(Object.entries(sourceTools).map(([native,source])=>[source,native]));
const notify = (method,params) => process.stdout.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n');

export async function mountExtensions(ctx, instructions, directory) {
  const plugins = (instructions.plugins || []).filter(plugin=>plugin.agents.length || plugin.hooks.length);
  if (!plugins.length) return;
  // Resolve peers relative to the actual CLI, not this private file or the app.
  const host = createRequire(pathToFileURL(await realpath(process.argv[1])));
  const version = JSON.parse(await readFile(host.resolve('@deepseek-ai/dsh-agent/package.json'),'utf8')).version;
  if (version !== '0.2.1-rc.2') throw new Error(`插件兼容层需要 DeepSeek Harness 0.2.1-rc.2，当前为 ${version}`);
  const agents = new Map(), children = new Map();
  for (const plugin of plugins) for (const agent of plugin.agents) {
    const definition = {...agent,qualifiedName:`${plugin.name}:${agent.name}`};
    agents.set(definition.qualifiedName,definition);
    const existing = agents.get(agent.name);
    agents.set(agent.name,existing === undefined ? definition : null);
  }
  if (agents.size) {
    ctx.on('agent/created', async ({agent}) => {
      const definition = children.get(agent.session.id);
      if (!definition) return;
      await agent.ctx.inject(['systemPrompt','tools'], scoped => {
        scoped.systemPrompt.section({name:'agentforge:application',order:20000,text:definition.body,interpolate:false});
        scoped.systemPrompt.section({name:'agentforge:response',order:20010,text:'',interpolate:false});
        const available=scoped.tools.schemas().map(tool=>tool.name);
        const expand=names=>[...new Set(names.flatMap(name=>{
          const native=nativeTools[name] || name;
          if(native.endsWith('*'))return available.filter(candidate=>candidate.startsWith(native.slice(0,-1)));
          return available.includes(native)?[native]:[];
        }))];
        if (definition.tools) {
          const allow=expand(definition.tools);
          if(allow.length)scoped.tools.restrict({allow});
          else if(available.length)scoped.tools.restrict({deny:available});
        }
        if (definition.deniedTools) {const deny=expand(definition.deniedTools);if(deny.length)scoped.tools.restrict({deny});}
      });
    });
    const description = 'Run an installed plugin subagent in an independent session and wait for its actual result. Available subagent_type: '+[...agents.keys()].filter(name=>name.includes(':')).join(', ');
    for (const name of ['Task','Agent']) ctx.tools.register({
      name,description,
      parameters:{type:'object',properties:{subagent_type:{type:'string'},prompt:{type:'string'},description:{type:'string'}},required:['subagent_type','prompt'],additionalProperties:false},
      output:{schema:{type:'object',properties:{agentId:{type:'string'},output:{type:'string'}},required:['agentId','output'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:value.output}]},
      async execute(args,exec) {
        const definition = agents.get(args.subagent_type);
        if (!definition) throw new Error('子代理不存在或名称重复；请使用 plugin:agent 全名');
        const childId = randomUUID(); children.set(childId,definition);
        let activation;
        try {
          activation = await ctx.subagents.startActivation({provider:'spawn',label:args.description || definition.qualifiedName,childId,request:{parent:exec.agent,prompt:[{type:'text',text:args.prompt}],maxDepth:1},signal:exec.signal,delivery:'caller'});
          notify('agentforge.subagent',{phase:'started',id:childId,name:definition.qualifiedName});
          const result = await activation.result;
          notify('agentforge.subagent',{phase:'ended',id:childId,name:definition.qualifiedName,status:result.stopReason});
          if (result.stopReason !== 'completed') throw new Error(`子代理未完成：${result.stopReason}`);
          return {agentId:childId,output:result.output.filter(block=>block.type==='text').map(block=>block.text).join('\n')};
        } finally {try {await activation?.dispose();} finally {children.delete(childId);}}
      }
    });
  }
  for (const [index,plugin] of plugins.entries()) {
    if (!plugin.hooks.length) continue;
    const dialect = plugin.sourceDialect, file = join(directory,`hooks-${dialect}-${index}.mjs`);
    let source = await readFile(join(directory,`hooks-${dialect === 'claude-code' ? 'claude-code' : 'codex'}.mjs`),'utf8');
    source = source.replaceAll('"@deepseek-ai/schemastery"',JSON.stringify(pathToFileURL(host.resolve('@deepseek-ai/schemastery')).href))
      .replaceAll('"@deepseek-ai/dsh-llm"',JSON.stringify(pathToFileURL(host.resolve('@deepseek-ai/dsh-llm')).href))
      .replaceAll('"@deepseek-ai/dsh-hook-protocol"','"./hook-guard.mjs"');
    // Preserve the source dialect in hook stdin as well as in its matcher.
    source = 'const sourceTools='+JSON.stringify(sourceTools)+';\n'+source.replaceAll('tool_name: exec.name','tool_name: sourceTools[exec.name] || exec.name');
    if(dialect==='codex') source=source.replaceAll('tool_input: { command: commandOf(exec.arguments) }','tool_input: exec.name === "bash" ? {command: commandOf(exec.arguments)} : exec.arguments');
    await writeFile(file,source,{mode:0o600});
    const configPath = join(directory,`hooks-${index}.json`);
    const hooks={},data=join(dirname(plugin.root),'data'),quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
    await mkdir(data,{recursive:true,mode:0o700});
    for(const item of plugin.hooks) {
      hooks[item.event] ||= [];
      hooks[item.event].push(...item.matchers.map(group=>({...group,hooks:group.hooks.map(hook=>({...hook,command:`export CLAUDE_PLUGIN_ROOT=${quote(plugin.root)} PLUGIN_ROOT=${quote(plugin.root)} CLAUDE_PLUGIN_DATA=${quote(data)} PLUGIN_DATA=${quote(data)}; ${hook.command}`}))})));
    }
    await writeFile(configPath,JSON.stringify({hooks}),{mode:0o600});
    await ctx.plugin(await import(pathToFileURL(file).href),{configPath,pluginRoot:plugin.root,projectDir:instructions.workspacePath});
  }
}
