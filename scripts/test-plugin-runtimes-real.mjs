// Opt-in compatibility matrix: real installed Providers, synthetic local assets,
// no operator tasks/configuration changes or external business generation.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {SSEServerTransport} from '@modelcontextprotocol/sdk/server/sse.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {taskPrompt} from '../server/prompts.mjs';
import {createMarketplace} from '../server/runtime/marketplace.mjs';
import {codexAgentKey} from '../server/runtime/extensions.mjs';
import {runClaudeCodeCli,runCodexCli,runDshCli} from '../server/runtime/local-cli.mjs';
import {loadLoginShellEnvironment} from '../apps/electron/login-shell-env.mjs';
import {cliEnvironment} from '../server/runtime/cli-environment.mjs';
import {RUNTIME_EFFORT_LEVELS} from '../web/settings.mjs';

if(process.env.AGENTFORGE_PLUGIN_RUNTIMES_REAL!=='1')throw new Error('Requires AGENTFORGE_PLUGIN_RUNTIMES_REAL=1; invokes all three real Runtimes');
assert.deepEqual(Object.keys(RUNTIME_EFFORT_LEVELS).sort(),['claude-code','codex','dsh'],'Every configured Runtime must have a real compatibility case; add new Runtime coverage before declaring the matrix complete');
await mkdir('.data',{recursive:true});
const root=await realpath(await mkdtemp(resolve('.data/plugin-runtimes-real-')));
// Match the desktop host's account-shell environment. A test checkout may
// otherwise pick a different, older CLI from its inherited shell PATH.
Object.assign(process.env,await loadLoginShellEnvironment());
process.env.AGENTFORGE_LOG_DIR=join(root,'logs');
process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT=join(root,'runtime');
const market=createMarketplace(join(root,'market')),cases=[],remoteCalls=[],transports=[],ssePeers=new Map();
const versions={};
for(const [provider,command] of Object.entries({'claude-code':'claude',codex:'codex',dsh:'dsh'})) {
  const env=cliEnvironment(command),run=promisify(execFile);
  const path=(await run('/usr/bin/which',[command],{env,timeout:10000})).stdout.trim();
  versions[provider]={path,version:(await run(path,['--version'],{env,timeout:10000})).stdout.trim()};
}
const evidence={root,realProviders:true,cases,versions};console.log('EVIDENCE '+root);console.log('VERSIONS '+JSON.stringify(versions));
const rpcServer=(key,transport)=>{
  const server=new Server({name:'matrix-'+transport,version:'1.0.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'read_validation_code',description:'Read the local compatibility verification value',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));
  server.setRequestHandler(CallToolRequestSchema,async request=>{
    assert.equal(request.params.name,'read_validation_code');
    const row=cases.find(row=>row.key===key);assert.ok(row);
    remoteCalls.push({key,transport});
    return {content:[{type:'text',text:JSON.stringify({verificationCode:row.expected[transport]})}]};
  });return server;
};
const http=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1'),[,key,transport]=url.pathname.split('/');
    const row=cases.find(row=>row.key===key);if(!row){res.writeHead(404);res.end();return;}
    if(req.headers.authorization!=='Bearer '+row.testToken){res.writeHead(401);res.end();return;}
    if(transport==='sse' && req.method==='GET'){
      const connection=new SSEServerTransport('/'+key+'/messages',res);transports.push(connection);ssePeers.set(connection.sessionId,connection);await rpcServer(key,'sse').connect(connection);return;
    }
    if(transport==='messages'){const connection=ssePeers.get(url.searchParams.get('sessionId'));if(!connection){res.writeHead(404);res.end();return;}await connection.handlePostMessage(req,res);return;}
    if(transport==='http'){
      const connection=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});transports.push(connection);await rpcServer(key,'http').connect(connection);await connection.handleRequest(req,res);return;
    }
    res.writeHead(404);res.end();
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
});
await new Promise(done=>http.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+http.address().port;
try {
  for(const sourceDialect of ['claude-code','codex']) {
    const source=join(root,'source-'+sourceDialect),folder=sourceDialect==='codex'?'.codex-plugin':'.claude-plugin';
    const skill='SKILL-'+randomUUID();
    await mkdir(join(source,folder),{recursive:true});await mkdir(join(source,'agents'));await mkdir(join(source,'hooks'));await mkdir(join(source,'skills/runtime-proof'),{recursive:true});
    await writeFile(join(source,folder,'plugin.json'),JSON.stringify({name:'runtime-proof',version:'1.0.0'}));
    await writeFile(join(source,'skills/runtime-proof/SKILL.md'),`---\nname: runtime-proof\ndescription: Only for the parent coordinator producing proof.json. Not for the independent checksum-worker subagent.\n---\nThis is the parent coordinator's workflow. The independent checksum worker follows its own system instructions instead of repeating this workflow. The skill proof value is exactly ${skill}. Obtain the three MCP proof values by actually calling their read_validation_code tools; use each result's verificationCode string, not the enclosing object. Invoke the installed runtime-proof:checksum-worker independently, wait for its result and use that as agentProof. Write proof.json with fields skillProof, agentProof, stdio, http, sse. Never invent missing values or substitute your own review.\n`);
    await writeFile(join(source,'agents/checksum-worker.md'),`---\nname: checksum-worker\ndescription: Compute a local verification checksum in an independent session\nmodel: inherit\ntools: Read, Bash\n---\nYour job is only a checksum computation. Read reviewer-input.json in the current working directory. Compute the SHA-256 hex digest of input.left + ':' + input.right using Node's crypto module. Write reviewer-proof.json containing {"digest":"the computed hex digest"}. Return only the computed digest. Do not use the parent runtime-proof Skill, call MCPs, delegate, or perform a qualitative review. Use Bash to compute and write the proof file.\n`);
    await writeFile(join(source,'record-hook.mjs'),`import {appendFile} from 'node:fs/promises';let text='';for await(const part of process.stdin)text+=part;const p=JSON.parse(text);await appendFile('hook-proof.jsonl',JSON.stringify({event:p.hook_event_name,tool:p.tool_name})+'\\n');`);
    await writeFile(join(source,'hooks/hooks.json'),JSON.stringify({hooks:{PreToolUse:[{matcher:'.*',hooks:[{type:'command',command:'node "${CLAUDE_PLUGIN_ROOT}/record-hook.mjs"'}]}]}}));
    await mkdir(join(source,'skills/broken'));await writeFile(join(source,'skills/broken/SKILL.md'),'---\nname: [broken\n---\nDo not load');
    await writeFile(join(source,'agents/broken.md'),'---\nname: broken\ntools: 42\n---\nDo not load');
    await writeFile(join(source,'broken-hooks.json'),'invalid hook JSON');
    const manifestPath=join(source,sourceDialect==='codex'?'.codex-plugin/plugin.json':'.claude-plugin/plugin.json');
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));manifest.hooks=['./hooks/hooks.json','./broken-hooks.json'];await writeFile(manifestPath,JSON.stringify(manifest));
    const imported=await market.import({path:source});assert.equal(imported.warnings.length,3);const installed=imported.plugins[0];
    for(const provider of ['claude-code','codex','dsh']) {
      const key=sourceDialect+'--'+provider,workspace=join(root,key),trace=join(workspace,'trace');await mkdir(trace,{recursive:true});
      const challenge={left:randomUUID(),right:randomUUID()};await writeFile(join(workspace,'reviewer-input.json'),JSON.stringify(challenge));
      const digest=createHash('sha256').update(challenge.left+':'+challenge.right).digest('hex');
      const row={key,sourceDialect,provider,workspace,trace,testToken:randomUUID(),expected:{skillProof:skill,agentProof:digest,stdio:'STDIO-'+randomUUID(),http:'HTTP-'+randomUUID(),sse:'SSE-'+randomUUID()},status:'pending'};cases.push(row);
      const configurations={stdio:{command:process.execPath,args:[resolve('scripts/marketplace-probe-mcp.mjs'),'mcp-proof.log',row.expected.stdio],cwd:workspace,env_vars:['PATH']},http:{type:'http',url:origin+'/'+key+'/http',headers:{Authorization:'Bearer '+row.testToken}},sse:{type:'sse',url:origin+'/'+key+'/sse',headers:{Authorization:'Bearer '+row.testToken}}};
      const mcpIds=[];for(const [transport,configuration] of Object.entries(configurations))mcpIds.push((await market.add({kind:'mcp',name:key+'-'+transport,description:'Isolated compatibility proof',content:JSON.stringify({mcpServers:{['matrix_'+transport]:configuration}})})).id);
      row.runtime={provider,executable:versions[provider].path,effort:'low',...(provider==='dsh'?{model:process.env.AGENTFORGE_DSH_MODEL || 'deepseek-official/deepseek-flash'}:{}),...await market.resolve({pluginIds:[installed.id],mcpIds},provider)};
      row.alias=provider==='codex'?codexAgentKey(row.runtime.extensionManifest.find(ref=>ref.kind==='plugin'),0,'checksum-worker'):'runtime-proof:checksum-worker';
    }
  }
  let saveTail=Promise.resolve();
  const save=()=>saveTail=saveTail.then(()=>writeFile(join(root,'evidence.json'),JSON.stringify({root,realProviders:true,versions,cases:cases.map(({runtime,testToken,expected,...row})=>row),remoteCalls},null,2),{mode:0o600}));
  // One call per Provider at a time; separate Providers can progress together.
  await Promise.all(['claude-code','codex','dsh'].map(async provider=>{
    for(const row of cases.filter(row=>row.provider===provider)) {
      row.status='running';await save();console.log('RUN '+row.key);
      const events=[];
      try {
        const aliasInstruction=provider==='codex'?`Use spawn_agent with agent_type ${row.alias} and agent_name checksum_probe; use that exact installed role, no fallback/default agent, and wait for completion.`:`Use the installed ${row.alias} subagent through ${provider==='dsh'?'Task or Agent':'Agent or Task'} and wait for its independent result.`;
        const roleValues=['ROLE-FIRST-'+row.key,'ROLE-SECOND-'+row.key];
        const composed=taskPrompt({agent:{id:'matrix',name:'matrix',kind:'business',systemPrompt:'Follow the selected native Skill.',roleSnapshots:roleValues.map((value,index)=>({id:'role_'+index,name:'Role '+index,prompt:`Include ${value} in the final JSON field roleProof as an array, preserving this role order.`}))},task:{title:'Compatibility proof',workspacePath:row.workspace,repositorySources:[],repositoryBindings:{},acceptanceCriteria:[],workflowSnapshot:{nodes:[]}},run:{id:'matrix'},node:{id:'verify',title:'Verify'},trace:{id:'matrix'},directory:row.trace,cwd:row.workspace,workspace:{traces:[],pendingQuestions:[],decisions:[],artifacts:[]},messages:[],roster:[],mode:'node',delivery:{messageIds:[],attempts:1},session:{resume:false}});
        const input={runtime:row.runtime,workspacePath:row.workspace,traceDirectory:row.trace,finalPath:join(row.trace,'final.json'),runId:randomUUID(),systemPrompt:composed.systemPrompt+'\nYou are verifying imported plugin capabilities with local synthetic data. Follow the selected Skill. Actually use the Skill, the installed independent checksum worker and each selected MCP. Do not inspect agent source files or invent values. Do not perform other work. Return one JSON object only.',prompt:`Activate the runtime-proof Skill (plugin runtime-proof). ${aliasInstruction} Actually call read_validation_code separately on matrix_stdio, matrix_http and matrix_sse. Follow the Skill to write proof.json in the working directory, then return the same JSON.`,onEvent:event=>events.push(event)};
        const result=await ({'claude-code':runClaudeCodeCli,codex:runCodexCli,dsh:runDshCli}[provider])(input);
        const proof=JSON.parse(await readFile(join(row.workspace,'proof.json'),'utf8'));
        for(const [field,value] of Object.entries(row.expected))assert.equal(proof[field],value,row.key+': '+field);
        assert.ok(result.finalText.includes(row.expected.agentProof));
        for(const value of roleValues)assert.ok(result.finalText.includes(value),'both bound role prompts reached '+provider);row.multiRoleDelivered=true;
        assert.equal(JSON.parse(await readFile(join(row.workspace,'reviewer-proof.json'),'utf8')).digest,row.expected.agentProof,'actual child checksum file');
        assert.match(await readFile(join(row.workspace,'mcp-proof.log'),'utf8'),/called/);
        for(const transport of ['http','sse'])assert.ok(remoteCalls.some(call=>call.key===row.key && call.transport===transport),row.key+': actual '+transport+' call');
        const hook=await readFile(join(row.workspace,'hook-proof.jsonl'),'utf8');assert.match(hook,/PreToolUse/);
        if(provider==='codex'){
          const audit=await readFile(join(row.trace,'codex-child-tools/invocations.jsonl'),'utf8');assert.ok(audit.split('\n').filter(Boolean).map(JSON.parse).some(item=>item.event==='SubagentStart' && item.agentType===row.alias));
        }else if(provider==='dsh')assert.ok(events.some(event=>event.providerEventType==='dsh.subagent' && event.data?.status==='completed'));
        else assert.ok(events.some(event=>['Task','Agent'].includes(event.data?.toolName)),'actual Claude independent subagent tool call');
        row.status='pass';row.toolNames=[...new Set(events.map(event=>event.data?.toolName).filter(Boolean))];
        await writeFile(join(row.workspace,'events.json'),JSON.stringify(events),{mode:0o600});console.log('PASS '+row.key);
      }catch(error){row.status='fail';row.error=error.message;await writeFile(join(row.workspace,'events.json'),JSON.stringify(events),{mode:0o600});console.log('FAIL '+row.key+': '+error.message);}
      await save();
    }
  }));
  assert.ok(cases.every(row=>row.status==='pass'),'Every source/Runtime combination must pass; see evidence.json');
  console.log('PASS 6 source/Runtime combinations, native Skill/independent subagent/Hook and stdio+HTTP+SSE MCP');
}finally{await Promise.allSettled(transports.map(transport=>transport.close()));http.closeAllConnections();await new Promise(done=>http.close(done));}
