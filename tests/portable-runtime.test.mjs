import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {PORTABLE_RUNTIME_IDS,RUNTIME_IDS,RUNTIME_EFFORT_LEVELS,runtimeLabel} from '../client/runtime-providers.mjs';
import {readNativeJsonl,portableEvents,assertPortableExtensionIsolation,nativeModelWithEffort} from '../server/runtime/portable-cli.mjs';
import {runRuntime,executionContent,separateRuntimeSession} from '../server/runtime/local-cli.mjs';
import {createStore} from '../server/store.mjs';
import {validateInput} from '../cli/client.mjs';
import {resources} from '../cli/commands.mjs';
import {runtimeModelCatalog} from '../server/runtime/model-catalog.mjs';

const uuid='01ab23cd-45ef-4678-89ab-01cd23ef45ab';
const frames=(provider,id=uuid)=>({
  cursor:[{type:'system',subtype:'init',session_id:id},{type:'assistant',message:{content:[{type:'text',text:'done'}]}},{type:'result',subtype:'success',result:'done'}],
  qwen:[{type:'system',subtype:'session_start',session_id:id},{type:'assistant',message:{content:[{type:'text',text:'done'}]}},{type:'result',subtype:'success',result:'done'}],
  gemini:[{type:'init',session_id:id},{type:'message',role:'assistant',content:'done',delta:true},{type:'result',status:'success'}],
  kimi:[{role:'assistant',content:'done'},{role:'meta',type:'session.resume_hint',session_id:id}],
  pi:[{type:'session',id},{type:'message_end',message:{role:'assistant',content:[{type:'text',text:'done'}],stopReason:'stop'}},{type:'agent_end',willRetry:false},{type:'agent_settled',aborted:false}],
  opencode:[{type:'step_start',sessionID:id},{type:'text',sessionID:id,part:{text:'done'}},{type:'step_finish',sessionID:id,part:{reason:'stop'}}]
})[provider];
for(const provider of PORTABLE_RUNTIME_IDS)test(`${provider}: native events bind the exact session, complete and redact audit content`,()=>{
 const id=provider==='opencode'?'ses_native_example_123456':uuid,p=portableEvents(provider,{session:{sessionId:id,resume:true},content:fields=>executionContent(fields)}),events=frames(provider,id).flatMap(frame=>p.normalize(frame)).filter(Boolean);
 assert.equal(p.getFinal(),'done');assert.equal(p.getTerminalFailure(),null);const session=events.map(separateRuntimeSession).find(event=>event.sessionId);assert.equal(session.sessionId,id);assert.equal(session.auditEvent.data.sessionId,undefined);
 const incomplete=portableEvents(provider,{session:{sessionId:id},content:fields=>executionContent(fields)});assert.throws(()=>incomplete.getFinal(),/完成/);
 if(provider!=='kimi'){const mismatch=portableEvents(provider,{session:{sessionId:uuid,resume:true},content:fields=>executionContent(fields)});assert.throws(()=>mismatch.normalize(frames(provider,'another_native_session_123456')[0]),/不一致/);}
});

test('relative context directory inputs fail before native startup',async()=>{
 await assert.rejects(runRuntime({runtime:{provider:'gemini'},workspacePath:'/tmp',traceDirectory:'/tmp',contextDirectories:['../foreign'],prompt:'Never start',onEvent:async()=>{}}),/绝对路径/);
});

test('Cursor native thinking deltas remain public thinking content, never final answers',()=>{
 const p=portableEvents('cursor',{session:{sessionId:uuid,resume:false},content:executionContent});
 p.normalize({type:'system',subtype:'init',session_id:uuid});const event=p.normalize({type:'thinking',subtype:'delta',text:'A public reasoning fragment'});
 assert.equal(event.data.presentation,'thinking');assert.equal(event.content.fields.thinking.text,'A public reasoning fragment');assert.throws(()=>p.getFinal(),/完成/);
});

test('Cursor terminal result transcript does not replace the last complete assistant response',()=>{
 const p=portableEvents('cursor',{session:{sessionId:uuid},content:executionContent});p.normalize({type:'system',subtype:'init',session_id:uuid});p.normalize({type:'assistant',message:{content:[{type:'text',text:'I will inspect the workflow.'}]}});p.normalize({type:'assistant',message:{content:[{type:'text',text:'{"summary":"done",'},{type:'text',text:'"managerDecision":{"nextNodeId":null,"nextAgentId":null}}'}]}});p.normalize({type:'result',subtype:'success',result:'I will inspect the workflow.{"summary":"done","managerDecision":{"nextNodeId":null,"nextAgentId":null}}'});assert.deepEqual(JSON.parse(p.getFinal()),{summary:'done',managerDecision:{nextNodeId:null,nextAgentId:null}});
 const fallback=portableEvents('cursor',{session:{sessionId:uuid},content:executionContent});fallback.normalize({type:'system',session_id:uuid});fallback.normalize({type:'result',subtype:'success',result:'done'});assert.equal(fallback.getFinal(),'done');
});

test('Gemini final response excludes narration from earlier tool turns',()=>{
 const p=portableEvents('gemini',{session:{sessionId:uuid},content:executionContent});p.normalize({type:'init',session_id:uuid});p.normalize({type:'message',role:'assistant',delta:true,content:'I will create the requested file.'});p.normalize({type:'tool_use',tool_id:'write1',tool_name:'write_file',parameters:{path:'proof.txt'}});p.normalize({type:'tool_result',tool_id:'write1',output:'Written'});p.normalize({type:'message',role:'assistant',delta:true,content:'{"summary":"done",'});p.normalize({type:'message',role:'assistant',delta:true,content:'"managerDecision":{"nextNodeId":null,"nextAgentId":null}}'});p.normalize({type:'result',status:'success'});
 assert.deepEqual(JSON.parse(p.getFinal()),{summary:'done',managerDecision:{nextNodeId:null,nextAgentId:null}});
});

test('native JSONL keeps Unicode separators and split UTF-8 bytes inside one record',async()=>{
 const line=JSON.stringify({type:'message',content:'中文\u2028下一行\u2029完整'})+'\r\n',buffer=Buffer.from(line),rows=[];
 for await(const row of readNativeJsonl(Readable.from([buffer.subarray(0,20),buffer.subarray(20,22),buffer.subarray(22)])))rows.push(JSON.parse(row));
 assert.equal(rows.length,1);assert.equal(rows[0].content,'中文\u2028下一行\u2029完整');
});

test('OpenCode projects enabled native model variants without provider settings',async()=>{
 const list=await runtimeModelCatalog({provider:'opencode'},{environment:{},run:async(command,args)=>{assert.equal(command,'opencode');assert.deepEqual(args,['api','--standalone','model.list']);return{stdout:JSON.stringify({data:[{providerID:'native',id:'model-a',type:'chat',name:'Model A',variants:[{id:'deep',settings:{apiKey:'SECRET'}}],settings:{apiKey:'SECRET'}},{providerID:'native',id:'disabled',type:'chat',enabled:false}]})};}});
 assert.deepEqual(list.models.map(x=>x.id),['native/model-a']);assert.deepEqual(list.models[0].levels,[{id:'deep'}]);assert.ok(!JSON.stringify(list).includes('SECRET'));
 await assert.rejects(runtimeModelCatalog({provider:'cursor'},{environment:{},run:async()=>({stdout:'invalid output'})}),/未返回可选模型/);
});

test('all nine fixed slots and effort validation agree with CLI; profile edits preserve old task snapshots',()=>{
 const store=createStore({workspaceRoot:join(tmpdir(),'af-native-frozen-workspace')});try{
  assert.deepEqual(store.listRuntimeProfiles().map(p=>p.provider),RUNTIME_IDS);
  for(const provider of PORTABLE_RUNTIME_IDS){
   const profile=store.listRuntimeProfiles().find(p=>p.provider===provider);store.saveRuntimeProfile({model:'manual-model',effort:RUNTIME_EFFORT_LEVELS[provider][0] || ''},profile.id);
   validateInput({effort:RUNTIME_EFFORT_LEVELS[provider][0] || ''},resources.runtimes.schema);
   const agent=store.createAgent({name:runtimeLabel(provider),runtime:{profileId:profile.id}}),task=store.createTask({managerAgentId:agent.id,title:'Frozen '+provider,objective:'Verify',memberAgentIds:[agent.id]});
   store.saveRuntimeProfile({model:'changed'},profile.id);assert.equal(store.getTask(task.id).managerSnapshot.runtime.model,'manual-model');
   assert.throws(()=>store.saveRuntimeProfile({effort:'unknown invalid'},profile.id),/思考等级/);
  }
 }finally{store.close();}
});

test('unsupported native extensions fail before a process starts, without exposing configuration secrets',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-native-isolation-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.cursor'));
 await writeFile(join(root,'.cursor/settings.json'),JSON.stringify({mcpServers:{private:{command:'never-run',env:{API_KEY:'DO_NOT_EXPOSE'}}}}));
 await assert.rejects(assertPortableExtensionIsolation('cursor',root,{HOME:root}),error=>/未由员工选择/.test(error.message)&&!error.message.includes('DO_NOT_EXPOSE'));
});

test('OpenCode native policies isolate skills and MCP; unsupported native plugins are still rejected',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-opencode-isolation-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'.config/opencode');await mkdir(join(config,'skills/fixture'),{recursive:true});await writeFile(join(config,'opencode.json'),JSON.stringify({mcp:{servers:{unselected:{type:'local',command:['never-run']}}}}));
 await assert.doesNotReject(assertPortableExtensionIsolation('opencode',root,{HOME:root}));
 await mkdir(join(config,'plugins/fixture'),{recursive:true});await assert.rejects(assertPortableExtensionIsolation('opencode',root,{HOME:root}),/plugins/);
});

test('Cursor projects an isolated native home while preserving host context, model and permissions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-cursor-profile-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const native=join(root,'native'),work=join(root,'work'),trace=join(root,'trace');await mkdir(join(native,'.cursor/skills/unselected'),{recursive:true});await mkdir(work);await mkdir(trace);
 const original={model:'manual-native',permissions:{deny:['Shell(rm)']},hooks:{never:'never-run'},unrelatedSecret:'must-not-project'};await writeFile(join(native,'.cursor/cli-config.json'),JSON.stringify(original));await writeFile(join(native,'.cursor/mcp.json'),JSON.stringify({mcpServers:{unselected:{command:'never-run'}}}));
 const capture=join(root,'capture.json'),command=join(root,'cli');await writeFile(command,`#!/usr/bin/env node
import{writeFile,readFile,access}from'node:fs/promises';import{join}from'node:path';let text='';for await(const x of process.stdin)text+=x;let mcp=false;try{await access(join(process.env.CURSOR_CONFIG_DIR,'mcp.json'));mcp=true;}catch{}
await writeFile(${JSON.stringify(capture)},JSON.stringify({home:process.env.HOME,host:process.env.AGENTFORGE_HOST_HOME,settings:JSON.parse(await readFile(join(process.env.CURSOR_CONFIG_DIR,'cli-config.json'),'utf8')),text,mcp}));for(const e of ${JSON.stringify(frames('cursor'))})console.log(JSON.stringify(e));`,{mode:0o700});
 const snapshots=[];const input={onPrompt:async value=>snapshots.push(value),runtime:{provider:'cursor',executable:command},environment:{...process.env,HOME:native,CURSOR_CONFIG_DIR:join(native,'.cursor')},workspacePath:work,traceDirectory:trace,executionKey:'cursor-member',prompt:'Verify',systemPrompt:'Application rules',onEvent:async()=>{}};
 await runRuntime(input);const first=JSON.parse(await readFile(capture,'utf8'));assert.notEqual(first.home,native);assert.equal(first.host,native);assert.equal(snapshots.length,1);assert.ok(snapshots[0].systemPrompt.includes(native));assert.equal(snapshots[0].prompt,'Verify');assert.deepEqual(first.settings,{model:original.model,permissions:original.permissions});assert.equal(first.mcp,true);assert.match(first.text,/本机用户目录/);assert.ok(first.text.includes(native));
 await runRuntime({...input,session:{sessionId:uuid,resume:true}});const next=JSON.parse(await readFile(capture,'utf8'));assert.equal(next.home,first.home);assert.deepEqual(JSON.parse(await readFile(join(native,'.cursor/cli-config.json'),'utf8')),original);
});

test('Gemini projects connection settings into a stable private home without loading native global extensions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-gemini-profile-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const native=join(root,'native'),workspace=join(root,'work'),trace=join(root,'trace');await mkdir(join(native,'.gemini/skills/unselected'),{recursive:true});await mkdir(workspace);await mkdir(trace);
 const original={security:{auth:{selectedType:'gemini-api-key'}},model:{name:'manual-native'},env:{GEMINI_BASE_URL:'https://example.invalid',UNRELATED_SECRET:'never-project'},mcpServers:{unselected:{command:'never-run'}},hooks:{SessionStart:[{command:'never-run'}]},skills:{enabled:true}};
 const settings=join(native,'.gemini/settings.json');await writeFile(settings,JSON.stringify(original));const oauth=join(native,'.gemini/oauth_creds.json');await writeFile(oauth,'must not be parsed by adapter');
 const command=join(root,'cli'),capture=join(root,'capture.json');await writeFile(command,`#!/usr/bin/env node
import{readFile,writeFile}from'node:fs/promises';import{join}from'node:path';let text='';for await(const part of process.stdin)text+=part;
await writeFile(${JSON.stringify(capture)},JSON.stringify({home:process.env.GEMINI_CLI_HOME,settings:JSON.parse(await readFile(join(process.env.GEMINI_CLI_HOME,'.gemini/settings.json'),'utf8')),reference:process.env.GOOGLE_APPLICATION_CREDENTIALS}));
for(const e of ${JSON.stringify(frames('gemini'))})console.log(JSON.stringify(e));`,{mode:0o700});
 const input={runtime:{provider:'gemini',executable:command},environment:{...process.env,HOME:native,GEMINI_CLI_HOME:native},workspacePath:workspace,traceDirectory:trace,executionKey:'same-member',prompt:'Verify',onEvent:async()=>{}};
 await runRuntime(input);const first=JSON.parse(await readFile(capture,'utf8'));assert.equal(first.settings.security.auth.selectedType,'gemini-api-key');assert.deepEqual(first.settings.model,{name:'manual-native'});assert.equal(first.settings.env.UNRELATED_SECRET,undefined);assert.deepEqual(first.settings.mcpServers,{});assert.equal(first.settings.hooks,undefined);assert.deepEqual(first.settings.skills,{enabled:false});assert.deepEqual(first.settings.hooksConfig,{enabled:false});assert.deepEqual(first.settings.mcp,{allowed:[]});assert.equal(first.reference,oauth);assert.notEqual(first.home,native);
 await runRuntime({...input,session:{sessionId:uuid,resume:true}});const second=JSON.parse(await readFile(capture,'utf8'));assert.equal(second.home,first.home);assert.deepEqual(JSON.parse(await readFile(settings,'utf8')),original);assert.equal(await readFile(oauth,'utf8'),'must not be parsed by adapter');
});

test('Cursor custom config root is checked for MCP without confusing it with HOME skill discovery',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-cursor-config-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'native-config'),home=join(root,'home');await mkdir(join(config,'skills/existing'),{recursive:true});await mkdir(home);
 const env={HOME:home,CURSOR_CONFIG_DIR:config};await assert.doesNotReject(assertPortableExtensionIsolation('cursor',home,env));
 await writeFile(join(config,'mcp.json'),JSON.stringify({mcpServers:{unselected:{command:'never-run'}}}));await assert.rejects(assertPortableExtensionIsolation('cursor',home,env),/未由员工选择/);
});

test('Kimi requires its native terminal resume hint, never a synthetic platform UUID',()=>{
 const p=portableEvents('kimi',{session:{sessionId:uuid,resume:false},content:executionContent});
 p.normalize({role:'assistant',content:'done'});assert.throws(()=>p.getFinal(),/完成/);
 p.normalize({role:'meta',type:'session.resume_hint',session_id:'native_session_12345'});assert.equal(p.getFinal(),'done');
 const mismatch=portableEvents('kimi',{session:{sessionId:uuid,resume:true},content:executionContent});assert.throws(()=>mismatch.normalize({role:'meta',type:'session.resume_hint',session_id:'different_native_12345'}),/不一致/);
});

for(const provider of PORTABLE_RUNTIME_IDS)test(`${provider}: real child process receives stdin and precise resume flags`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-native-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'trace/output'),{recursive:true});
 const command=join(root,'cli'),capture=join(root,'capture.json'),id=provider==='opencode'?'ses_example_native_123456':uuid;
 // Protocol fixture, not a model. Covers actual spawn, framing and Store-facing events.
 const output=provider==='kimi'?frames(provider,id):frames(provider,id);
 await writeFile(command,'#!/usr/bin/env node\n'+`let text='';for await(const part of process.stdin)text+=part;await (await import('node:fs/promises')).writeFile(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),text,geminiSettings:process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,kimiEffort:process.env.KIMI_MODEL_THINKING_EFFORT,settings:await (async()=>{const fs=await import('node:fs/promises'),path=await import('node:path');const file=process.env.GEMINI_CLI_HOME?path.join(process.env.GEMINI_CLI_HOME,'.gemini/settings.json'):process.env.QWEN_HOME?path.join(process.env.QWEN_HOME,'settings.json'):null;return file?JSON.parse(await fs.readFile(file,'utf8')):null;})()}));for(const event of ${JSON.stringify(output)})console.log(JSON.stringify(event));`,{mode:0o700});
 const events=[],input={runtime:{provider,executable:command,model:'manual-model',effort:'low',extensionSelection:{pluginIds:[],mcpIds:[]},extensionManifest:[]},workspacePath:root,traceDirectory:join(root,'trace'),runId:randomUUID(),session:{sessionId:id,resume:true},systemPrompt:'System instruction',prompt:'User request',environment:{...process.env,HOME:root},onEvent:async e=>events.push(e)};
 assert.equal((await runRuntime(input)).finalText,'done');const captured=JSON.parse(await readFile(capture,'utf8'));assert.ok(provider==='kimi'?captured.args.includes('User request'):captured.text.includes('User request'));assert.ok(captured.args.includes(id));assert.equal(captured.args.includes('User request'),provider==='kimi');if(['cursor','gemini','qwen'].includes(provider)){assert.ok(captured.args.includes(join(root,'trace')));assert.ok(captured.args.includes(provider==='cursor'?'--add-dir':'--include-directories'));}if(provider==='qwen')assert.equal(captured.settings.model.reasoningEffort,'low');if(provider==='kimi')assert.equal(captured.kimiEffort,'low');if(provider==='gemini'){assert.equal(captured.settings.modelConfigs.overrides.at(-1).modelConfig.generateContentConfig.thinkingConfig.thinkingLevel,'LOW');assert.ok(captured.args.includes('--skip-trust'));assert.equal(captured.geminiSettings,undefined);assert.ok(captured.args.includes('none'));}if(provider==='kimi'){assert.ok(!captured.args.includes('--auto'));assert.ok(!captured.args.includes('--agent-file'));}assert.equal(events.some(e=>e.data?.sessionId===id),true);
});

test('Qwen native enablement index is metadata; actual unselected extension directories still block startup',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-qwen-native-index-'));t.after(()=>rm(root,{recursive:true,force:true}));const config=join(root,'.qwen'),work=join(root,'work');await mkdir(join(config,'extensions'),{recursive:true});await mkdir(work);await writeFile(join(config,'extensions/extension-enablement.json'),'{}');await assertPortableExtensionIsolation('qwen',work,{HOME:root,QWEN_HOME:config});await mkdir(join(config,'extensions/unselected'));await assert.rejects(assertPortableExtensionIsolation('qwen',work,{HOME:root,QWEN_HOME:config}),/未选择扩展/);
});

test('native model arguments preserve fast mode and carry real OpenCode variant names',()=>{
 assert.equal(nativeModelWithEffort({provider:'cursor',model:'native-high-fast',effort:'low'}),'native-low-fast');
 assert.equal(nativeModelWithEffort({provider:'cursor',model:'native[context=1m]',effort:'high'}),'native[context=1m,effort=high]');
 assert.equal(nativeModelWithEffort({provider:'cursor',model:'native[effort=low]',effort:'high'}),'native[effort=high]');
 assert.equal(nativeModelWithEffort({provider:'opencode',model:'provider/model#old',effort:'deep'}),'provider/model#deep');
});
