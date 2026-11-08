// Opt-in real native Skill + stdio/HTTP/SSE MCP proof. All domain/files are isolated.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {SSEServerTransport} from '@modelcontextprotocol/sdk/server/sse.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createMarketplace} from '../server/runtime/marketplace.mjs';
import {runRuntime,separateRuntimeSession} from '../server/runtime/local-cli.mjs';
import {PORTABLE_RUNTIME_IDS,RUNTIME_PROVIDERS} from '../client/runtime-providers.mjs';
if(process.env.AGENTFORGE_PORTABLE_EXTENSIONS_REAL!=='1')throw Error('Requires AGENTFORGE_PORTABLE_EXTENSIONS_REAL=1; invokes real models');
const agentProof=process.env.AGENTFORGE_PORTABLE_AGENT_PROOF==='1';
const providers=(process.env.AGENTFORGE_PORTABLE_PROVIDERS || PORTABLE_RUNTIME_IDS.join(',')).split(',');if(providers.some(p=>!PORTABLE_RUNTIME_IDS.includes(p)))throw Error('Unknown provider');
await mkdir('.data',{recursive:true});const root=await mkdtemp(resolve('.data/portable-extensions-real-'));process.env.AGENTFORGE_LOG_DIR=join(root,'logs');
const market=createMarketplace(join(root,'market')),cases=[],connections=[],peers=new Map();
const rpc=(row,kind)=>{const server=new Server({name:'portable-extension-proof',version:'1.0.0'},{capabilities:{tools:{}}});server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'read_validation_code',description:'Return the verification value for this local validation.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));server.setRequestHandler(CallToolRequestSchema,async request=>{assert.equal(request.params.name,'read_validation_code');row.calls.push(kind);return {content:[{type:'text',text:JSON.stringify({verificationCode:row.expected[kind]})}]};});return server;};
const http=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1'),[,provider,kind]=url.pathname.split('/'),row=cases.find(r=>r.provider===provider);if(!row||req.headers.authorization!=='Bearer '+row.token){res.writeHead(401);res.end();return;}
 if(kind==='sse'&&req.method==='GET'){const t=new SSEServerTransport('/'+provider+'/messages',res);connections.push(t);peers.set(t.sessionId,t);await rpc(row,'sse').connect(t);return;}
 if(kind==='messages'){const t=peers.get(url.searchParams.get('sessionId'));if(!t){res.writeHead(404);res.end();return;}await t.handlePostMessage(req,res);return;}
 if(kind==='http'){const t=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});connections.push(t);await rpc(row,'http').connect(t);await t.handleRequest(req,res);return;}
 res.writeHead(404);res.end();}catch{if(!res.headersSent)res.writeHead(500);res.end();}});await new Promise(done=>http.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+http.address().port;
const save=()=>writeFile(join(root,'evidence.json'),JSON.stringify({root,real:true,cases:cases.map(({token,expected,runtime,...row})=>row)},null,2),{mode:0o600});
console.log('EVIDENCE '+root);
try{
 for(const [index,provider]of providers.entries()){
  const work=join(root,provider),source=join(work,'source'),dialect=index%2?'codex':'claude-code',folder=dialect==='codex'?'.codex-plugin':'.claude-plugin';await mkdir(join(source,folder),{recursive:true});await mkdir(join(source,'skills','native-proof'),{recursive:true});
  execFileSync('git',['init','-q',work]);
  const expected={skill:'SKILL-'+randomUUID(),resource:'RESOURCE-'+randomUUID(),stdio:'STDIO-'+randomUUID(),http:'HTTP-'+randomUUID(),sse:'SSE-'+randomUUID()};
  await writeFile(join(source,folder,'plugin.json'),JSON.stringify({name:'native-proof',version:'1.0.0'}));
  await writeFile(join(source,'skills/native-proof/SKILL.md'),`---\nname: native-proof\ndescription: Use for the native extension verification task to produce proof.json from actual Skill and MCP results.\n---\nThe skillProof is ${expected.skill}. Read support.txt beside this SKILL.md; use its full content as resourceProof. Actually call read_validation_code on proof_stdio, proof_http and proof_sse; the result's verificationCode is the string for stdio, http, sse respectively. Write proof.json with fields skillProof, resourceProof, stdio, http, sse. Do not read MCP source/configuration or invent values.\n`);await writeFile(join(source,'skills/native-proof/support.txt'),expected.resource);
  if(agentProof){
    await mkdir(join(source,'agents'));await writeFile(join(source,'agents/checksum-worker.md'),`---\nname: checksum-worker\ndescription: Independently compute the SHA-256 checksum for this native plugin verification.\nmodel: inherit\n${provider==='cursor'?'':'tools: Read, Bash\n'}---\nYou are the independent checksum worker. Do not use the parent native-proof Skill or MCP tools and do not delegate. Read reviewer-input.json in the working directory, compute SHA-256 of left + ':' + right with Node crypto via Shell, write reviewer-proof.json with {"digest":"computed hash"}. Return only the digest.\n`);
    const skill=join(source,'skills/native-proof/SKILL.md');await writeFile(skill,await readFile(skill,'utf8')+'\nAdditionally, delegate to the installed native-proof:checksum-worker in an independent native agent session, wait for its result, and include its returned digest as agentProof in proof.json. Never compute that digest in the parent. Read the child-written reviewer-proof.json and copy its digest into proof.json programmatically; do not retype the digest by hand.\n');
  }
  const imported=await market.import({path:source}),row={provider,dialect,token:randomUUID(),expected,calls:[],status:'running'};cases.push(row);
  const mcpIds=[];for(const [kind,configuration]of Object.entries({stdio:{command:process.execPath,args:[resolve('scripts/marketplace-probe-mcp.mjs'),join(work,'mcp.log'),expected.stdio],cwd:work},http:{type:'http',url:origin+'/'+provider+'/http',headers:{Authorization:'Bearer '+row.token}},sse:{type:'sse',url:origin+'/'+provider+'/sse',headers:{Authorization:'Bearer '+row.token}}}))mcpIds.push((await market.add({kind:'mcp',name:provider+'-'+kind,description:'Isolated native validation',content:JSON.stringify({mcpServers:{['proof_'+kind]:configuration}})})).id);
  row.runtime={provider,...(provider==='gemini'?{model:'gemini-3.1-flash-lite'}:{}),...await market.resolve({pluginIds:[imported.plugins[0].id],mcpIds},provider)};
  const events=[];let nativeId;await save();console.log('RUN '+provider);
  try{
   for(let turn=1;turn<=2;turn++){
    if(agentProof){const challenge={left:randomUUID(),right:randomUUID()};await writeFile(join(work,'reviewer-input.json'),JSON.stringify(challenge));expected.agentProof=(await import('node:crypto')).createHash('sha256').update(challenge.left+':'+challenge.right).digest('hex');}
    if(turn===2){expected.http='HTTP-'+randomUUID();expected.sse='SSE-'+randomUUID();}
    const trace=join(work,'trace-'+turn);await mkdir(trace,{recursive:true});
    await runRuntime({runtime:row.runtime,workspacePath:work,traceDirectory:trace,executionKey:'extension-proof-'+provider,runId:'extension-proof-'+provider,...(nativeId?{session:{sessionId:nativeId,resume:true}}:{}),systemPrompt:'Working directory: '+work+'. Write proof.json in this exact directory. Verify the installed native Skill and selected MCPs with synthetic local data. Use native skill discovery/loading. If a Skill or native MCP tool is unavailable, report the error and stop immediately. Never use Shell, other clients, configuration inspection or source reading to emulate a missing tool. Do not inspect hidden directories, MCP configuration/source, credentials or unrelated files. Use the selected Skill to write proof.json. Return only the proof JSON. Do not perform other work.',prompt:'Use the installed native-proof Skill to write proof.json using its actual instructions and all three selected MCP tools. This is turn '+turn+'. HTTP and SSE verification values change every turn. Call all three tools again; do not reuse earlier values or an existing proof file.',onEvent:async event=>{events.push(event);const x=separateRuntimeSession(event);if(x.sessionId){if(nativeId)assert.equal(x.sessionId,nativeId);nativeId=x.sessionId;}},idleTimeoutMs:240000,apiRetryTimeoutMs:60000});
    const proof=JSON.parse(await readFile(join(work,'proof.json'),'utf8'));assert.deepEqual(proof,{skillProof:expected.skill,resourceProof:expected.resource,stdio:expected.stdio,http:expected.http,sse:expected.sse,...(agentProof?{agentProof:expected.agentProof}:{})});if(agentProof)assert.equal(JSON.parse(await readFile(join(work,'reviewer-proof.json'),'utf8')).digest,expected.agentProof);await writeFile(join(work,'proof-turn-'+turn+'.json'),JSON.stringify(proof));
   }
   for(const kind of ['http','sse'])assert.ok(row.calls.filter(x=>x===kind).length>=2,'actual repeated '+kind+' tool calls');assert.ok((await readFile(join(work,'mcp.log'),'utf8')).split('\n').filter(x=>x==='called').length>=2);assert.ok(nativeId);if(agentProof)assert.ok(events.some(e=>/agent|task|checksum-worker/i.test(e.data?.toolName || '') || e.data?.toolName==='tool_call' && /\"name\":\s*\"agent\"/.test(e.content?.fields?.input?.text || '')),'actual native subagent tool invocation');if(provider==='pi')for(const kind of ['stdio','http','sse'])assert.ok(events.some(e=>e.data?.toolName==='mcp__proof_'+kind+'__read_validation_code'),'actual Pi native MCP '+kind);row.status='passed';row.resumed=true;row.toolNames=[...new Set(events.map(e=>e.data?.toolName).filter(Boolean))];console.log('PASS '+provider);
  }catch(error){row.status='failed';row.error=error.message;console.log('FAIL '+provider+': '+error.message);}
  await writeFile(join(work,'events.json'),JSON.stringify(events),{mode:0o600});await save();
 }
 assert.ok(cases.every(row=>row.status==='passed'),'Real native extension validation failed; see evidence.json');console.log('PASS all selected native Skill and three-transport MCP cases, with exact native session resume');
}finally{await Promise.allSettled(connections.map(t=>t.close()));http.closeAllConnections();await new Promise(done=>http.close(done));}
