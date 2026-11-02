// Opt-in external-source acceptance. Never execute deployment workflows or the
// source's transcript-upload Hook; generic Hook/MCP acceptance is separate.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,randomInt} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import yaml from 'js-yaml';
import {createMarketplace,readPluginExecutionPlan,readExtensionFile} from '../server/runtime/marketplace.mjs';
import {parsePluginMarkdown} from '../server/runtime/plugin-compatibility.mjs';
import {nativePluginRuntime,codexAgentKey} from '../server/runtime/extensions.mjs';
import {runClaudeCodeCli,runCodexCli,runDshCli} from '../server/runtime/local-cli.mjs';
import {loadLoginShellEnvironment} from '../apps/electron/login-shell-env.mjs';
import {cliEnvironment} from '../server/runtime/cli-environment.mjs';
if(process.env.AGENTFORGE_AI_MINIONS_REAL!=='1'||!process.env.AGENTFORGE_AI_MINIONS_SOURCE)throw Error('Set AGENTFORGE_AI_MINIONS_REAL=1 and AGENTFORGE_AI_MINIONS_SOURCE to a local checkout; uses real model calls');
await mkdir('.data',{recursive:true});const root=await realpath(await mkdtemp(resolve('.data/ai-minions-real-')));
Object.assign(process.env,await loadLoginShellEnvironment());process.env.AGENTFORGE_LOG_DIR=join(root,'logs');
process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT=join(root,'runtime');
const source=await realpath(process.env.AGENTFORGE_AI_MINIONS_SOURCE),exec=promisify(execFile),providers=['claude-code','codex','dsh'];
const revision=(await exec('git',['-C',source,'rev-parse','HEAD'])).stdout.trim();
const sourceStatus=(await exec('git',['-C',source,'status','--porcelain'])).stdout;
const market=createMarketplace(join(root,'market')),imported=await market.import({path:source}),catalog=await market.catalog();
const evidence={root,revision,realProviders:true,pluginCount:catalog.plugins.length,plans:[],cases:[],versions:{}};
const save=()=>writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log('EVIDENCE '+root);await save();
let skillEntry,reviewEntry,reviewAgent;
for(const plugin of catalog.plugins){
 assert.deepEqual(plugin.providers,providers,plugin.name+' supports all Runtimes');
 for(const provider of providers){
  const runtime={provider,...await market.resolve({pluginIds:[plugin.id],mcpIds:[]},provider)},ref=runtime.extensionManifest[0],plan=await readPluginExecutionPlan(ref);
  const trace=join(root,'projection',plugin.id,provider);await mkdir(trace,{recursive:true});
  const native=await nativePluginRuntime(runtime,trace);
  for(const path of native.skillPaths){const text=await readFile(path,'utf8'),head=text.match(/^---\r?\n([\s\S]*?)\r?\n---/);if(head)yaml.load(head[1],{schema:yaml.JSON_SCHEMA});}
  await readExtensionFile(ref);
  evidence.plans.push({name:plugin.name,provider,version:plan.version,skillCount:runtime.skillPaths.length,agentCount:plan.agents.length,hookCount:plan.hooks.length,sourceDialect:plan.sourceDialect,models:plan.agents.filter(a=>a.sourceModel).map(a=>({name:a.name,sourceModel:a.sourceModel,targetModel:a.model}))});
  if(provider==='dsh'&&!plan.hooks.length&&ref.skills.some(path=>path.endsWith('/nyx-build/SKILL.md')))skillEntry=plugin;
  if(provider==='dsh'&&!plan.hooks.length&&plan.agents.some(a=>a.sourceModel==='sonnet')){reviewEntry=plugin;reviewAgent=plan.agents.find(a=>a.sourceModel==='sonnet');}
 }
}
assert.ok(skillEntry,'source contains the reported nyx-build Skill');assert.ok(reviewEntry,'source contains a model-pinned independent review agent');
console.log('PASS '+evidence.plans.length+' source/Runtime plans and strict native YAML projections');await save();
for(const [provider,command]of Object.entries({'claude-code':'claude',codex:'codex',dsh:'dsh'})){
 const env=cliEnvironment(command),path=(await exec('/usr/bin/which',[command],{env})).stdout.trim();
 evidence.versions[provider]={path,version:(await exec(path,['--version'],{env})).stdout.trim()};
}
await save();
// Source Plugins with business Hooks remain imported/resolved but are never
// invoked here: shipping synthetic transcripts to a company service is not an
// appropriate compatibility test. Selected source agents/Skills are unmodified.
await Promise.all(providers.map(async provider=>{
 const workspace=join(root,'real-'+provider),trace=join(workspace,'trace');await mkdir(trace,{recursive:true});
 const constant=randomInt(10000,99999);await writeFile(join(workspace,'case.js'),`export function adjust(input) { return input + ${constant}; }\n`);
 const runtime={provider,executable:evidence.versions[provider].path,effort:'low',...(provider==='dsh'?{model:'deepseek-official/deepseek-flash'}:{}),...await market.resolve({pluginIds:[skillEntry.id,reviewEntry.id],mcpIds:[]},provider)};
 const ref=runtime.extensionManifest.find(ref=>ref.id===reviewEntry.id),plan=await readPluginExecutionPlan(ref),index=plan.agents.findIndex(a=>a.name===reviewAgent.name);
 const alias=provider==='codex'?codexAgentKey(ref,index,reviewAgent.name):`${reviewEntry.name}:${reviewAgent.name}`;
 const skillRef=runtime.extensionManifest.find(ref=>ref.id===skillEntry.id),skillPath=runtime.skillPaths.find(path=>path.endsWith('/nyx-build/SKILL.md'));
 const raw=await readFile(skillPath,'utf8'),parsed=parsePluginMarkdown(raw),heading=parsed.body.split(/\r?\n/).find(line=>/^#\s/.test(line))?.trim();assert.ok(heading);
 const sourceBytes=await readFile(join(skillRef.sourceRoot,skillRef.skills.find(path=>path.endsWith('/nyx-build/SKILL.md'))));assert.equal(sourceBytes.toString(),raw);
 const row={provider,status:'running',workspace,alias};evidence.cases.push(row);console.log('RUN '+provider);const events=[];
 try{
  const systemPrompt='You are testing imported plugin loading with local synthetic files. Do not deploy, build, install, publish, access credentials, or call company services. Loading a Skill does not authorize its business workflow. Only load/read the named Skill and delegate the local JavaScript analysis to the exact installed independent agent. The parent must not read case.js or calculate the child result. Do not inspect agent source files. Return JSON only and write the same result to proof.json.';
  const prompt=`Load the imported ${skillEntry.name}:nyx-build Skill using the native Skill mechanism and read its full instructions. Report its first level-one Markdown heading verbatim as skillHeading. This is a read-only compatibility probe, not a build/deployment request. Then invoke the installed independent agent ${alias} (${provider==='codex'?'spawn_agent with exact agent_type':'Task/Agent with exact subagent_type'}) and wait for its real result. Ask that agent to inspect only case.js in this directory and report the integer added to input by adjust(). Return the child result as agentConstant (a number). Write proof.json containing only skillHeading and agentConstant, and return the same JSON.`;
  const result=await ({'claude-code':runClaudeCodeCli,codex:runCodexCli,dsh:runDshCli}[provider])({runtime,workspacePath:workspace,traceDirectory:trace,finalPath:join(trace,'final.json'),runId:randomUUID(),systemPrompt,prompt,onEvent:event=>events.push(event)});
  const proof=JSON.parse(await readFile(join(workspace,'proof.json'),'utf8'));assert.equal(proof.skillHeading,heading);assert.equal(proof.agentConstant,constant);assert.ok(result.finalText.includes(String(constant)));
  if(provider==='codex'){const audit=await readFile(join(trace,'codex-child-tools/invocations.jsonl'),'utf8');assert.ok(audit.split('\n').filter(Boolean).map(JSON.parse).some(e=>e.event==='SubagentStart'&&e.agentType===alias));}
  else if(provider==='dsh')assert.ok(events.some(e=>e.providerEventType==='dsh.subagent'&&e.data?.status==='completed'));
  else assert.ok(events.some(e=>['Task','Agent'].includes(e.data?.toolName)));
  assert.equal(await readFile(skillPath,'utf8'),raw);await readExtensionFile(skillRef);row.status='pass';row.toolNames=[...new Set(events.map(e=>e.data?.toolName).filter(Boolean))];console.log('PASS '+provider);
 }catch(error){row.status='fail';row.error=error.message;console.log('FAIL '+provider+': '+error.message);}
 await writeFile(join(workspace,'events.json'),JSON.stringify(events),{mode:0o600});
}));
assert.equal((await exec('git',['-C',source,'status','--porcelain'])).stdout,sourceStatus,'operator source checkout unchanged');
await save();assert.ok(evidence.cases.every(c=>c.status==='pass'),'All source/Runtime cases must actually pass; inspect evidence');
console.log('PASS external source imports, native YAML/Skill activation, source subagents, model mapping and source integrity across all three Runtimes');
