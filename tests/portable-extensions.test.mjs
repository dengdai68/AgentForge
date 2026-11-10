import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMarketplace} from '../server/runtime/marketplace.mjs';
import {preparePortableExtensions,portableSkillName,configurePortableExtensions} from '../server/runtime/portable-extensions.mjs';
import {PORTABLE_RUNTIME_IDS,RUNTIME_IDS} from '../client/runtime-providers.mjs';
import {createStore} from '../server/store.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'af-native-extensions-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source');await mkdir(join(source,'.claude-plugin'),{recursive:true});await mkdir(join(source,'skills','proof'),{recursive:true});await writeFile(join(source,'.claude-plugin/plugin.json'),JSON.stringify({name:'selected-plugin',version:'1.0.0'}));await writeFile(join(source,'skills/proof/SKILL.md'),'---\nname: proof\ndescription: Use the selected proof instructions.\n---\nRead resources.txt beside this file.');await writeFile(join(source,'skills/proof/resources.txt'),'relative selected resource');const market=createMarketplace(join(root,'market'));return {root,source,market};}
for(const provider of PORTABLE_RUNTIME_IDS)test(provider+': selected immutable plugin and credential-bearing MCP project without leaking source secrets into argv',async t=>{
 const {root,source,market}=await fixture(t),imported=await market.import({path:source}),mcp=await market.add({kind:'mcp',name:'private-api',description:'',content:JSON.stringify({mcpServers:{private_api:{type:'http',url:'https://example.invalid/mcp',headers:{Authorization:'Bearer not-in-provider-argv'}}}})});
 const binding=await market.resolve({pluginIds:[imported.plugins[0].id],mcpIds:[mcp.id]},provider),runtime={provider,...binding},trace=join(root,'trace');await mkdir(trace);
 const original=await readFile(binding.skillPaths[0],'utf8');const result=await preparePortableExtensions({runtime,traceDirectory:trace});assert.equal(result.skills.length,1);assert.match(result.skills[0].name,/^selected-plugin-proof-/);assert.equal(await readFile(join(result.skills[0].path,'resources.txt'),'utf8'),'relative selected resource');assert.equal(await readFile(binding.skillPaths[0],'utf8'),original);assert.ok(!JSON.stringify(result.servers).includes('not-in-provider-argv'));assert.ok(result.servers.private_api.args.includes(binding.extensionManifest.find(x=>x.kind==='mcp').path));
 assert.ok((await stat(join(trace,'native-extensions'))).isDirectory());
 await writeFile(binding.skillPaths[0],original+'\nmodified');await assert.rejects(preparePortableExtensions({runtime,traceDirectory:trace}),/SHA256|不匹配|校验/);
});
test('portable plugin compatibility rejects unsupported Hook, Subagent and special Skill behavior as a whole',async t=>{
 const {source,market}=await fixture(t);await mkdir(join(source,'agents'));await writeFile(join(source,'agents/reviewer.md'),'---\nname: reviewer\ndescription: Review\nmemory: project\n---\nReview.');await mkdir(join(source,'hooks'));await writeFile(join(source,'hooks/hooks.json'),JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'echo selected'}]}]}}));await writeFile(join(source,'skills/proof/SKILL.md'),'---\nname: proof\ndescription: Review\ncontext: fork\n---\nReview.');
 const {plugins:[entry]}=await market.import({path:source});for(const provider of PORTABLE_RUNTIME_IDS){assert.equal(entry.compatibility[provider].supported,false);assert.match(entry.compatibility[provider].reasons.join(' '),/子代理/);assert.match(entry.compatibility[provider].reasons.join(' '),/Hook/);assert.match(entry.compatibility[provider].reasons.join(' '),/context/);await assert.rejects(market.resolve({pluginIds:[entry.id],mcpIds:[]},provider),/不兼容/);}
});
test('role selection resolves the same native plugin/MCP bindings for all nine runtimes',async t=>{
 const {source,market}=await fixture(t),{plugins:[entry]}=await market.import({path:source});const role=await market.resolveRole({pluginIds:[entry.id],mcpIds:[]});assert.deepEqual(Object.keys(role.extensionBindings),RUNTIME_IDS);for(const provider of PORTABLE_RUNTIME_IDS)assert.equal(role.extensionBindings[provider].extensionManifest[0].planTarget,provider);
 assert.notEqual(portableSkillName('same','skill','one'),portableSkillName('same','skill','two'));
});
test('explicit compatibility refresh changes directory cache only and survives reload without changing bindings',async t=>{
 const {root,source,market}=await fixture(t),{plugins:[entry]}=await market.import({path:source});const path=join(root,'data.sqlite'),store=createStore({databasePath:path});store.registerExtensions([entry]);
 const before=store.getExtension('plugin',entry.id);const after=store.refreshExtensionCompatibility('plugin',entry.id,{id:entry.id,providers:['cursor'],compatibility:{cursor:{supported:true,reasons:[]}}});assert.equal(after.id,before.id);assert.deepEqual(after.source,before.source);assert.deepEqual(store.queryExtensions('plugin').items[0].providers,['cursor']);assert.throws(()=>store.refreshExtensionCompatibility('plugin',entry.id,{id:entry.id,providers:['invented']}),/无效/);store.close();const reloaded=createStore({databasePath:path});assert.deepEqual(reloaded.getExtension('plugin',entry.id).providers,['cursor']);reloaded.close();
});
test('Pi exposes native MCP tools directly; OpenCode allows only exact selected Skill and MCP names',async t=>{
 const {root}=await fixture(t),projection={servers:{selected:{command:process.execPath,args:['private-reference']}},skills:[{name:'unique-selected-skill'}],skillsRoot:join(root,'skills')};
 await configurePortableExtensions({runtime:{provider:'pi'}},{PI_CODING_AGENT_DIR:root},projection);assert.equal(JSON.parse(await readFile(join(root,'mcp.json'),'utf8')).mcpServers.selected.exposure,'direct');
 const config=await configurePortableExtensions({runtime:{provider:'opencode'}},{},projection);assert.deepEqual(config.policies.filter(p=>p.effect==='allow').map(p=>p.resource),['selected','unique-selected-skill']);assert.equal(config.mcp.servers.selected.codemode,false);
});

test('binding an existing role to a new Runtime derives only the missing target from the same immutable selection',async t=>{
 const {root,source,market}=await fixture(t),{plugins:[entry]}=await market.import({path:source}),selection={pluginIds:[entry.id],mcpIds:[]};const store=createStore({databasePath:join(root,'roles.sqlite')});t.after(()=>store.close());store.registerExtensions([entry]);const original=await market.resolve(selection,'claude-code');const role=store.createRole({name:'Existing role',prompt:'Role instructions',extensionSelection:selection,extensionBindings:{'claude-code':original}});assert.equal(store.hasRoleRuntimeBinding(role.id,'cursor'),false);
 const cursor=await market.resolve(selection,'cursor');store.ensureRoleRuntimeBinding(role.id,'cursor',selection,cursor);assert.equal(store.hasRoleRuntimeBinding(role.id,'cursor'),true);assert.equal(store.hasRoleRuntimeBinding(role.id,'claude-code'),true);assert.deepEqual(store.getRole(role.id),role,'derived target does not change role choice or instructions');assert.throws(()=>store.ensureRoleRuntimeBinding(role.id,'gemini',{pluginIds:[],mcpIds:[]},cursor),/已变化/);
});

test('native subagents preserve source instructions and mapped tool selection without weakening Cursor constraints',async t=>{
 const {root,source,market}=await fixture(t);await mkdir(join(source,'agents'));await writeFile(join(source,'agents/reviewer.md'),'---\nname: reviewer\ndescription: Independent reviewer\nmodel: inherit\ntools: Read, Bash\ndisallowedTools: Write\n---\nReview independently. Use ${CLAUDE_PLUGIN_ROOT}/resources.');
 const {plugins:[entry]}=await market.import({path:source});assert.equal(entry.compatibility.cursor.supported,false);assert.match(entry.compatibility.cursor.reasons.join(' '),/tools\/disallowedTools/);
 for(const provider of PORTABLE_RUNTIME_IDS.filter(p=>p!=='cursor')){
  assert.equal(entry.compatibility[provider].supported,true,provider);const runtime={provider,...await market.resolve({pluginIds:[entry.id],mcpIds:[]},provider)},traceDirectory=join(root,provider);await mkdir(traceDirectory);
  const projection=await preparePortableExtensions({runtime,traceDirectory});assert.equal(projection.agents.length,1);const [agent]=projection.agents;assert.ok(!agent.name.includes(':'));assert.equal(agent.sourceName,'reviewer');assert.match(await readFile(agent.promptFile,'utf8'),/Review independently/);assert.ok(!(await readFile(agent.promptFile,'utf8')).includes('${CLAUDE_PLUGIN_ROOT}'));
  const config=join(root,provider+'-config');await mkdir(config);await writeFile(join(config,'settings.json'),'{}');const environment={GEMINI_CLI_HOME:join(root,provider+'-home'),QWEN_HOME:config,KIMI_CODE_HOME:config,PI_CODING_AGENT_DIR:config};if(provider==='gemini'){await mkdir(join(environment.GEMINI_CLI_HOME,'.gemini'),{recursive:true});await writeFile(join(environment.GEMINI_CLI_HOME,'.gemini/settings.json'),'{}');}
  const result=await configurePortableExtensions({runtime},environment,projection);
  if(provider==='pi'){assert.ok(result.piExtension);const native=JSON.parse(await readFile(join(projection.root,'pi-agents.json'),'utf8'));assert.deepEqual(native.agents[0].toolNames,['read','bash']);assert.deepEqual(native.agents[0].deniedTools,['write']);}
  else if(provider==='opencode'){const native=result.agents[agent.name];assert.equal(native.mode,'subagent');assert.deepEqual(native.permissions.map(p=>[p.action,p.effect]),[['*','deny'],['read','allow'],['shell','allow'],['edit','deny']]);}
  else {const home=provider==='gemini'?join(environment.GEMINI_CLI_HOME,'.gemini'):config;const native=await readFile(join(home,'agents',agent.name+'.md'),'utf8');assert.match(native,/Review independently/);assert.match(native,/tools:/);assert.match(native,/name: selected-plugin-agent-reviewer-/);}
 }
});

test('optional Skill allowed-tools metadata never blocks a Runtime and remains in immutable/native files',async t=>{
 const {root,source,market}=await fixture(t);
 for(const header of ['allowed-tools: Bash, Read','allowed-tools: [Bash, Read]','allowed-tools: []','allowedTools: [Bash, Read]']){
  const original='---\nname: proof\ndescription: Optional tool metadata\n'+header+'\n---\nRead resources.txt beside this file.';
  await writeFile(join(source,'skills/proof/SKILL.md'),original);const {plugins:[entry]}=await market.import({path:source});
  for(const provider of RUNTIME_IDS){assert.equal(entry.compatibility[provider].supported,true,provider);assert.deepEqual(entry.compatibility[provider].reasons,[]);const runtime={provider,...await market.resolve({pluginIds:[entry.id],mcpIds:[]},provider)};assert.equal(await readFile(runtime.skillPaths[0],'utf8'),original);
   if(PORTABLE_RUNTIME_IDS.includes(provider)){const traceDirectory=join(root,entry.id,provider);await mkdir(traceDirectory,{recursive:true});const projection=await preparePortableExtensions({runtime,traceDirectory});const {parsePluginMarkdown}=await import('../server/runtime/plugin-compatibility.mjs');const native=parsePluginMarkdown(await readFile(join(projection.skills[0].path,'SKILL.md'),'utf8')).attributes;const attributes=parsePluginMarkdown(original).attributes;assert.deepEqual(native['allowed-tools'],attributes['allowed-tools']);assert.deepEqual(native.allowedTools,attributes.allowedTools);assert.equal(await readFile(join(projection.skills[0].path,'resources.txt'),'utf8'),'relative selected resource');}
  }
 }
});

test('existing optional-field compatibility cache can refresh without reinstalling or changing identity',async t=>{
 const {root,source,market}=await fixture(t);await writeFile(join(source,'skills/proof/SKILL.md'),'---\nname: proof\ndescription: Existing installation\nallowed-tools: Bash, Read\n---\nRead resources.txt');
 const {plugins:[entry]}=await market.import({path:source}),store=createStore({databasePath:join(root,'cached.sqlite')});t.after(()=>store.close());const stale={...entry,providers:['claude-code','codex','dsh'],compatibility:{...entry.compatibility,...Object.fromEntries(PORTABLE_RUNTIME_IDS.map(p=>[p,{supported:false,reasons:['old allowed-tools rejection']}]))}};store.registerExtensions([stale]);
 const before=store.getExtension('plugin',entry.id);assert.equal(before.compatibility.opencode.supported,false);const current=await market.detail(entry.id,'plugin');const refreshed=store.refreshExtensionCompatibility('plugin',entry.id,current);assert.equal(refreshed.id,entry.id);assert.deepEqual(refreshed.source,before.source);for(const provider of RUNTIME_IDS)assert.equal(refreshed.compatibility[provider].supported,true);
 const binding=await market.resolve({pluginIds:[entry.id],mcpIds:[]},'opencode');assert.match(await readFile(binding.skillPaths[0],'utf8'),/allowed-tools: Bash, Read/);
});
