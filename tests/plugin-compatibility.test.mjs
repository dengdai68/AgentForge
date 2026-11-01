import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createMarketplace,readPluginExecutionPlan,readExtensionFile} from '../server/runtime/marketplace.mjs';
import {parsePluginMarkdown,pluginExecutionPlan,dshHookMatchers} from '../server/runtime/plugin-compatibility.mjs';
import {normalizeDshEvent} from '../server/runtime/dsh.mjs';
import {selectedExtensions} from '../server/runtime/extensions.mjs';
import {subagentToolDecision} from '../server/runtime/plugin-agent-tools.mjs';

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
for(const dialect of ['claude-code','codex']) test(`${dialect} source installs once; all targets freeze a metadata-only plan and preserve the original source`,async t=>{
  const {source,market,entry,selection}=await fixture(t,dialect);
  assert.deepEqual(entry.providers,['claude-code','codex','dsh']);
  for(const provider of entry.providers) {
    const runtime=await market.resolve(selection,provider),ref=runtime.extensionManifest[0],plan=await readPluginExecutionPlan(ref);
    assert.equal(ref.adapterVersion,2);assert.equal(plan.sourceDialect,dialect);assert.equal(plan.target,provider);
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
  await writeFile(join(root,'agent.md'),'---\nname: review\nisolation: worktree\nmodel: sonnet\ntools: [Unmapped]\n---\nReview');
  const info={sourceDialect:'claude-code',reasons:[],components:{agents:[{name:'review',path:'agent.md'}],hooks:[{event:'PermissionRequest',matchers:[{hooks:[{type:'prompt',prompt:'a',async:true}]}]}]}};
  const result=await pluginExecutionPlan(info,root,'dsh');assert.equal(result.supported,false);
  for(const reason of ['isolation','sonnet','Unmapped','PermissionRequest','command','async'])assert.match(result.reasons.join('\n'),new RegExp(reason));
});
test('Hook matcher mapping changes tool subjects, never shell commands; audit never exposes raw hook output',()=>{
  const hooks=[{event:'PreToolUse',matchers:[{matcher:'Bash|Read',hooks:[{type:'command',command:'echo Bash Read'}]}]}];
  const mapped=dshHookMatchers(hooks,'claude-code');assert.equal(mapped[0].matchers[0].matcher,'bash|read');assert.equal(mapped[0].matchers[0].hooks[0].command,'echo Bash Read');
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
