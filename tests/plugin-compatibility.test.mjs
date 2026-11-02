import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createMarketplace,readPluginExecutionPlan,readExtensionFile} from '../server/runtime/marketplace.mjs';
import {parsePluginMarkdown,pluginExecutionPlan,dshHookMatchers,compatibilityDigest} from '../server/runtime/plugin-compatibility.mjs';
import {normalizeDshEvent} from '../server/runtime/dsh.mjs';
import {selectedExtensions,nativePluginRuntime} from '../server/runtime/extensions.mjs';
import {subagentToolDecision,sourceToolAllowed} from '../server/runtime/plugin-agent-tools.mjs';
import {createCatalogFixtureStore} from './fixture-store.mjs';

async function fixture(t,dialect='claude-code') {
  const root=await mkdtemp(join(tmpdir(),'af-source-plan-')),source=join(root,'source');
  t.after(()=>rm(root,{recursive:true,force:true}));
  const folder=dialect==='codex'?'.codex-plugin':'.claude-plugin';
  await mkdir(join(source,folder),{recursive:true});await mkdir(join(source,'agents'));await mkdir(join(source,'hooks'));
  await writeFile(join(source,folder,'plugin.json'),JSON.stringify({name:'source-proof'}));
  await mkdir(join(source,'skills/proof'),{recursive:true});await writeFile(join(source,'skills/proof/SKILL.md'),'---\nname: proof\ndescription: |\n  source instructions\n  shared across targets\n---\nRead evidence.');
  await writeFile(join(source,'agents/review.md'),'---\nname: review\ndescription: |\n  independent evidence review\nmodel: inherit\ntools: [Read, Write, Glob, Grep, Bash]\n---\nPRIVATE_SOURCE_PERSONA');
  await writeFile(join(source,'hooks/hooks.json'),JSON.stringify({hooks:{PreToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'echo PRIVATE_COMMAND'}]}]}}));
  const market=createMarketplace(join(root,'market')),entry=(await market.import({path:source})).plugins[0];
  return {root,source,market,entry,selection:{pluginIds:[entry.id],mcpIds:[]}};
}

test('frontmatter supports safe YAML lists/multiline text and preserves the exact system body',()=>{
  const parsed=parsePluginMarkdown('---\nname: review\ntools: [Read, Bash]\ndescription: |\n  first\n  second\n---\nLiteral {{value}}\n');
  assert.deepEqual(parsed.attributes.tools,['Read','Bash']);assert.equal(parsed.attributes.description,'first\nsecond\n');
  assert.equal(parsed.body,'Literal {{value}}\n');
  assert.throws(()=>parsePluginMarkdown('---\nvalue: !!js/function >\n  function(){}\n---\n'),/unknown tag/);
});
test('literal description colons normalize only native YAML; malformed structures never expose source text',()=>{
  const description='Use builds. Triggers on: nyx构建、查询构建状态。';
  const content=`---\nname: nyx-build\ndescription: ${description}\nversion: 1.0.0\n---\n# Original body\n`;
  const parsed=parsePluginMarkdown(content);
  assert.equal(parsed.attributes.description,description);assert.equal(parsed.body,'# Original body\n');
  assert.notEqual(parsed.nativeContent,content);assert.deepEqual(parsePluginMarkdown(parsed.nativeContent).attributes,parsed.attributes);
  assert.equal(parsePluginMarkdown(parsed.nativeContent).nativeContent,parsed.nativeContent);
  for(const text of ['description: "PRIVATE_UNTERMINATED','tools: [PRIVATE_BROKEN','description: !!js/function PRIVATE_SCRIPT']) {
    assert.throws(()=>parsePluginMarkdown(`---\nname: broken\n${text}\n---\nPRIVATE_BODY`,{path:'skills/broken/SKILL.md'}),error=>{
      assert.equal(error.code,'PLUGIN_MARKDOWN_INVALID');assert.match(error.message,/skills\/broken\/SKILL.md/);
      assert.ok(!JSON.stringify(error).includes('PRIVATE'));assert.ok(!error.message.includes('PRIVATE'));
      assert.equal(error.mark,undefined);assert.equal(error.cause,undefined);return true;
    });
  }
});
test('known source model aliases map explicitly to the target Runtime while historical v2 stays unchanged',async t=>{
  const root=await mkdtemp(join(tmpdir(),'af-source-model-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'agent.md'),'---\nname: review\nmodel: opus\ntools: Read, Bash, Skill, AskUserQuestion, Agent\n---\nReview');
  const info={sourceDialect:'claude-code',reasons:[],components:{agents:[{name:'review',path:'agent.md'}],hooks:[]}};
  for(const target of ['codex','dsh']) {
    const current=await pluginExecutionPlan(info,root,target);assert.equal(current.supported,true);
    assert.equal(current.plan.agents[0].model,'inherit');assert.equal(current.plan.agents[0].sourceModel,'opus');
    const historical=await pluginExecutionPlan(info,root,target,2);assert.equal(historical.supported,false);assert.equal(historical.plan.agents[0].model,'opus');
    assert.equal(historical.plan.agents[0].sourceModel,undefined);
  }
  assert.equal((await pluginExecutionPlan(info,root,'claude-code')).plan.agents[0].model,'opus');
});
test('native YAML repair copies supporting files without mutating installed bytes or source snapshots',async t=>{
  const {root,source,market}=await fixture(t);
  const raw='---\nname: proof\ndescription: Build requests: local validation only\n---\nRead evidence.\n';
  await writeFile(join(source,'skills/proof/SKILL.md'),raw);
  await writeFile(join(source,'skills/proof/support.txt'),'support bytes');
  const entry=(await market.import({path:source})).plugins[0];
  for(const provider of ['claude-code','codex','dsh']) {
    const runtime={provider,...await market.resolve({pluginIds:[entry.id],mcpIds:[]},provider)},ref=runtime.extensionManifest[0];
    const trace=join(root,'trace-'+provider);await mkdir(trace);
    const native=await nativePluginRuntime(runtime,trace);
    assert.notEqual(native.skillPaths[0],runtime.skillPaths[0]);
    assert.equal(await readFile(runtime.skillPaths[0],'utf8'),raw);assert.equal(await readFile(join(ref.sourceRoot,'skills/proof/SKILL.md'),'utf8'),raw);
    assert.equal(parsePluginMarkdown(await readFile(native.skillPaths[0],'utf8')).body,'Read evidence.\n');
    assert.equal(await readFile(join(dirname(native.skillPaths[0]),'support.txt'),'utf8'),'support bytes');
    await selectedExtensions(runtime);await readExtensionFile(ref);
  }
});
test('one malformed installed Skill stays visible as incompatible while other market entries remain readable',async t=>{
  const {market,selection}=await fixture(t),runtime=await market.resolve(selection,'claude-code');
  await writeFile(runtime.skillPaths[0],'---\nname: proof\ndescription: "PRIVATE_BROKEN\n---\nPRIVATE_BODY');
  const second=await fixture(t);
  await market.import({path:second.source});
  const {plugins}=await market.catalog();assert.equal(plugins.length,2);
  const broken=plugins.find(p=>p.id===selection.pluginIds[0]);assert.deepEqual(broken.providers,[]);
  assert.ok(!JSON.stringify(broken.compatibility).includes('PRIVATE'));
  assert.equal(plugins.filter(p=>p.providers.length===3).length,1);
  await assert.rejects(market.resolve(selection,'codex'),/frontmatter YAML/);
});
test('a saved v2 reference still validates its original plan digest after v3 is introduced',async t=>{
  const {market,selection}=await fixture(t),runtime=await market.resolve(selection,'dsh'),ref=runtime.extensionManifest[0];
  const plan=await readPluginExecutionPlan(ref),legacy={...ref,adapterVersion:2,planSha256:compatibilityDigest({...plan,version:2})};
  assert.equal((await readPluginExecutionPlan(legacy)).version,2);
  await selectedExtensions({...runtime,provider:'dsh',extensionManifest:[legacy]});
});
test('Store accepts v3 bindings for each Runtime and still rejects mismatched frozen targets and digests',async t=>{
  const {root,market,selection}=await fixture(t),store=createCatalogFixtureStore({databasePath:join(root,'store.sqlite')});t.after(()=>store.close());
  for(const provider of ['claude-code','codex','dsh']) {
    const runtime={provider,...await market.resolve(selection,provider)};
    const employee=store.createAgent({name:'binding-'+provider,runtime});assert.equal(employee.runtime.extensionManifest[0].adapterVersion,3);
    for(const patch of [{planTarget:'invalid'},{planSha256:'broken'},{sourceDialect:'invalid'}]) {
      assert.throws(()=>store.createAgent({name:'invalid-'+provider,runtime:{...runtime,extensionManifest:[{...runtime.extensionManifest[0],...patch}]}}),/冻结执行计划/);
    }
  }
});
test('DeepSeek chooses the full Codex source variant of dual manifests rather than mixing Hook dialects',async t=>{
  const {source,market}=await fixture(t);
  await mkdir(join(source,'.codex-plugin'));
  await writeFile(join(source,'.codex-plugin/plugin.json'),JSON.stringify({name:'source-proof',hooks:[]}));
  await writeFile(join(source,'hooks/hooks.json'),JSON.stringify({hooks:{PostToolUseFailure:[{hooks:[{type:'command',command:'true'}]}]}}));
  const entry=(await market.import({path:source})).plugins[0];assert.deepEqual(entry.providers,['claude-code','codex','dsh']);
  const ref=(await market.resolve({pluginIds:[entry.id],mcpIds:[]},'dsh')).extensionManifest[0];
  const plan=await readPluginExecutionPlan(ref);assert.equal(plan.sourceDialect,'codex');assert.deepEqual(plan.hooks,[]);
});
test('native Codex delegation and question aliases obey the selected source child policy',()=>{
  for(const tool of ['spawn_agent','wait_agent','send_input','close_agent']) {
    assert.equal(sourceToolAllowed({tools:['Agent']},tool),true);assert.equal(sourceToolAllowed({tools:['Bash']},tool),false);
  }
  assert.equal(sourceToolAllowed({tools:['AskUserQuestion']},'request_user_input'),true);
  assert.equal(sourceToolAllowed({tools:['Skill'],deniedTools:['Skill']},'skill'),false);
});
for(const dialect of ['claude-code','codex']) test(`${dialect} source installs once; all targets freeze a metadata-only plan and preserve the original source`,async t=>{
  const {source,market,entry,selection}=await fixture(t,dialect);
  assert.deepEqual(entry.providers,['claude-code','codex','dsh']);
  for(const provider of entry.providers) {
    const runtime=await market.resolve(selection,provider),ref=runtime.extensionManifest[0],plan=await readPluginExecutionPlan(ref);
    assert.equal(ref.adapterVersion,3);assert.equal(plan.sourceDialect,dialect);assert.equal(plan.target,provider);
    assert.equal(plan.agents[0].model,'inherit');assert.deepEqual(plan.agents[0].tools,['Read','Write','Glob','Grep','Bash']);
    assert.equal(plan.agents[0].name,'review');assert.ok(!JSON.stringify(runtime).includes('PRIVATE_SOURCE_PERSONA'));
    assert.ok(!JSON.stringify(runtime).includes('PRIVATE_COMMAND'));
    assert.equal(await readFile(join(ref.sourceRoot,'agents/review.md'),'utf8'),await readFile(join(source,'agents/review.md'),'utf8'));
  }
});
test('current installed compatibility is derived without reinstall or rewriting old metadata/frozen references',async t=>{
  const {market,selection}=await fixture(t),runtime=await market.resolve(selection,'dsh'),ref=runtime.extensionManifest[0];
  const file=join(dirname(dirname(dirname(ref.path))),'entry.json');
  const entry=JSON.parse(await readFile(file,'utf8'));entry.providers=['claude-code','codex'];entry.compatibility.dsh={supported:false,reasons:['old adapter']};
  delete entry.runtimeComponents.dsh;
  for(const component of Object.values(entry.components).flat())component.providers=['claude-code','codex'];
  await writeFile(file,JSON.stringify(entry));const before=await readFile(file,'utf8');
  const detail=await market.detail(ref.id,'plugin');assert.ok(detail.providers.includes('dsh'));
  assert.ok(detail.components.agents[0].providers.includes('dsh'));
  assert.equal(detail.components.skills.length,1,'legacy inventory and new discovery merge into one source component');
  assert.deepEqual(detail.components.skills[0].providers,['claude-code','codex','dsh']);
  assert.equal((await market.resolve(selection,'dsh')).extensionManifest[0].planSha256,ref.planSha256);
  assert.equal(await readFile(file,'utf8'),before);assert.equal(ref.planTarget,'dsh');
});
test('plan/directory tampering cannot silently change execution; old frozen projection remains separate',async t=>{
  const {market,selection}=await fixture(t),ref=(await market.resolve(selection,'dsh')).extensionManifest[0];
  await assert.rejects(readPluginExecutionPlan({...ref,planSha256:'f'.repeat(64)}),/执行计划/);
  const claude=await market.resolve(selection,'claude-code');claude.extensionManifest[0].planSha256='f'.repeat(64);
  await assert.rejects(selectedExtensions({provider:'claude-code',...claude}),/执行计划/);
  const legacy={...ref,adapterVersion:1};delete legacy.sourceRoot;delete legacy.sourceSha256;
  await writeFile(join(ref.sourceRoot,'agents/review.md'),'tampered source');
  await assert.rejects(readPluginExecutionPlan(ref),/原始源副本/);
  assert.ok(await readExtensionFile(legacy),'no automatic upgrade of historical source references');
});
test('unsupported lifecycle, non-command Hooks and agent metadata are explicit failures, never partial success',async t=>{
  const root=await mkdtemp(join(tmpdir(),'af-plan-errors-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'agent.md'),'---\nname: review\nisolation: worktree\nmodel: claude-pinned-unknown\ntools: [Unmapped]\n---\nReview');
  const info={sourceDialect:'claude-code',reasons:[],components:{agents:[{name:'review',path:'agent.md'}],hooks:[{event:'PermissionRequest',matchers:[{hooks:[{type:'prompt',prompt:'a',async:true}]}]}]}};
  const result=await pluginExecutionPlan(info,root,'dsh');assert.equal(result.supported,false);
  for(const reason of ['isolation','claude-pinned-unknown','Unmapped','PermissionRequest','command','async'])assert.match(result.reasons.join('\n'),new RegExp(reason));
});
test('Hook matcher mapping changes tool subjects, never shell commands; audit never exposes raw hook output',()=>{
  const hooks=[{event:'PreToolUse',matchers:[{matcher:'Bash|Read',hooks:[{type:'command',command:'echo Bash Read'}]}]}];
  const mapped=dshHookMatchers(hooks,'claude-code');assert.equal(mapped[0].matchers[0].matcher,'bash|read');assert.equal(mapped[0].matchers[0].hooks[0].command,'echo Bash Read');
  assert.equal(dshHookMatchers([{event:'PreToolUse',matchers:[{matcher:'^(Skill|AskUserQuestion)$',hooks:[]}]}],'claude-code')[0].matchers[0].matcher,'^(skill|ask_user_question)$');
  const audit=normalizeDshEvent({type:'hook/result',data:{point:'PreToolUse',decision:'deny',exitCode:0,stderrSummary:'PRIVATE_TOKEN'}},()=>{});
  assert.equal(audit[0].data.decision,'deny');assert.ok(!JSON.stringify(audit).includes('PRIVATE_TOKEN'));
});
test('source subagent tool choices apply to the exact Codex child, without restricting its parent or other children',async t=>{
  const stateDirectory=await mkdtemp(join(tmpdir(),'af-agent-tools-'));t.after(()=>rm(stateDirectory,{recursive:true,force:true}));
  const config={stateDirectory,agents:{'source:review':{tools:['Bash'],deniedTools:['mcp__private__*']}}};
  await subagentToolDecision(config,{hook_event_name:'SubagentStart',agent_type:'source:review',agent_id:'child-1'});
  const call=(session_id,tool_name)=>({hook_event_name:'PreToolUse',session_id,tool_name});
  assert.equal(await subagentToolDecision(config,call('parent-1','apply_patch')),null);
  assert.equal(await subagentToolDecision(config,call('child-1','Bash')),null);
  assert.equal((await subagentToolDecision(config,{...call('parent-1','apply_patch'),agent_id:'child-1'})).hookSpecificOutput.permissionDecision,'deny');
  assert.equal((await subagentToolDecision(config,{...call('parent-2','apply_patch'),agent_id:'resumed-child',agent_type:'source:review'})).hookSpecificOutput.permissionDecision,'deny','a later invocation uses the frozen role map even without a new SubagentStart');
  for(const name of ['apply_patch','mcp__private__read'])assert.equal((await subagentToolDecision(config,call('child-1',name))).hookSpecificOutput.permissionDecision,'deny');
  assert.equal(await subagentToolDecision(config,call('unrelated','apply_patch')),null);
  const audit=await readFile(join(stateDirectory,'decisions.jsonl'),'utf8');assert.match(audit,/"allowed":false/);assert.ok(!audit.includes('PRIVATE_SOURCE_PERSONA'));
});
