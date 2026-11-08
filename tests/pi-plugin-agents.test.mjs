import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

async function fixture(t,{missingCommand=false,wait=false}={}){
 const root=await mkdtemp(join(tmpdir(),'af-pi-native-child-'));t.after(()=>rm(root,{recursive:true,force:true}));
 // Native Pi supplies this schema module; the application never imports it.
 await mkdir(join(root,'node_modules/typebox'),{recursive:true});await writeFile(join(root,'node_modules/typebox/package.json'),JSON.stringify({type:'module',exports:'./index.mjs'}));await writeFile(join(root,'node_modules/typebox/index.mjs'),'export const Type=new Proxy({},{get:()=>value=>value});');
 await writeFile(join(root,'pi-agents.mjs'),await readFile(new URL('../server/runtime/pi-agents.mjs',import.meta.url),'utf8'));
 const command=join(root,'native-pi'),promptFile=join(root,'child-prompt.md');await writeFile(promptFile,'Frozen independent instructions');
 await writeFile(command,`#!${process.execPath}\nimport {writeFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';\nlet input='';for await(const chunk of process.stdin)input+=chunk;await writeFile(${JSON.stringify(join(root,'invocation.json'))},JSON.stringify({args:process.argv.slice(2),input,cwd:process.cwd()}));\n${wait?'setInterval(()=>{},1000);':"console.log(JSON.stringify({type:'session',id:randomUUID()}));console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'独立结果'}],stopReason:'stop'}}));console.log(JSON.stringify({type:'agent_settled',aborted:false}));"}\n`,{mode:0o700});
 await writeFile(join(root,'pi-agents.json'),JSON.stringify({command:missingCommand?join(root,'missing'):command,agents:[{name:'selected-reviewer',sourceName:'reviewer',description:'Review',promptFile,toolNames:['read','bash','write'],deniedTools:['write']}]}));let tool;
 const extension=(await import(pathToFileURL(join(root,'pi-agents.mjs')).href)).default;await extension({registerTool:value=>{tool=value;},getThinkingLevel:()=> 'medium'});
 return {root,tool,promptFile,ctx:{cwd:root,model:{provider:'native',id:'actual-model'}}};
}
test('Pi child has its own native session, exact source tools/model and stdin instructions',async t=>{
 const {root,tool,promptFile,ctx}=await fixture(t),invoke=()=>tool.execute('call',{agent:'selected-reviewer',task:'Independent task'},new AbortController().signal,undefined,ctx);
 const first=await invoke(),second=await invoke();assert.notEqual(first.details.sessionId,second.details.sessionId);assert.equal(first.content[0].text,'独立结果');const call=JSON.parse(await readFile(join(root,'invocation.json'),'utf8'));assert.equal(call.input,'Independent task');assert.equal(call.cwd,await realpath(root));assert.equal(call.args[call.args.indexOf('--tools')+1],'read,bash');assert.equal(call.args[call.args.indexOf('--model')+1],'native/actual-model');assert.equal(call.args[call.args.indexOf('--system-prompt')+1],promptFile);assert.ok(call.args.includes('--no-mcp'));assert.ok(call.args.includes('--no-skills'));
 const records=(await readFile(join(root,'pi-agent-invocations.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(records.map(r=>r.event),['started','ended','started','ended']);assert.notEqual(records[0].directory,records[2].directory);assert.ok(!JSON.stringify(records).includes('Independent task'));
 await assert.rejects(tool.execute('bad',{agent:'unselected',task:'x'},null,null,ctx),/Unknown selected/);
});
test('Pi child startup failure rejects instead of waiting for nonexistent output',async t=>{
 const {tool,ctx}=await fixture(t,{missingCommand:true});await assert.rejects(tool.execute('call',{agent:'selected-reviewer',task:'x'},null,null,ctx),/ENOENT/);
});
test('Pi child cancellation terminates the native invocation and reports cancelled',async t=>{
 const {root,tool,ctx}=await fixture(t,{wait:true}),controller=new AbortController();const pending=tool.execute('call',{agent:'selected-reviewer',task:'x'},controller.signal,null,ctx);
 for(let i=0;i<200;i++){try{await readFile(join(root,'invocation.json'));break;}catch{await new Promise(r=>setTimeout(r,10));}}controller.abort();await assert.rejects(pending,/cancelled/);await assert.rejects(tool.execute('aborted',{agent:'selected-reviewer',task:'x'},controller.signal,null,ctx),/cancelled/);
});
