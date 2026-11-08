import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createMcpToolDiscovery} from '../server/runtime/mcp-tools.mjs';
import {createMarketplace} from '../server/runtime/marketplace.mjs';

async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'af-mcp-tools-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function reference(root,service){const content=JSON.stringify({mcpServers:{test:service}}),path=join(root,'mcp.json');await writeFile(path,content,{mode:0o600});return {id:root,kind:'mcp',path,sha256:createHash('sha256').update(content).digest('hex')};}
const tool=name=>({name,description:'工具说明',inputSchema:{type:'object',properties:{text:{type:'string'},password:{type:'string',description:'Required password'}},required:['text']}});

test('MCP discovery launches through the desktop-provided Node executable',async t=>{
 const root=await fixture(t),marker=join(root,'launcher-used'),wrapper=join(root,'desktop-node'),script=join(root,'server.mjs');
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 await writeFile(wrapper,`#!/bin/sh\nprintf x >> ${quote(marker)}\nexec ${quote(process.execPath)} "$@"\n`,{mode:0o700});
 await writeFile(script,`import {Server} from ${JSON.stringify(pathToFileURL(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js')).href)};import {StdioServerTransport} from ${JSON.stringify(pathToFileURL(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js')).href)};import {ListToolsRequestSchema} from ${JSON.stringify(pathToFileURL(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/types.js')).href)};const server=new Server({name:'desktop-fixture',version:'1.0.0'},{capabilities:{tools:{}}});server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[${JSON.stringify(tool('desktop_tool'))}]}));await server.connect(new StdioServerTransport());`);
 const ref=await reference(root,{command:process.execPath,args:[script]}),previous=process.env.AGENTFORGE_ELECTRON_NODE;
 try {
  process.env.AGENTFORGE_ELECTRON_NODE=wrapper;
  const found=await createMcpToolDiscovery()(ref,'test');assert.equal(found.total,1);assert.equal(found.tools[0].name,'desktop_tool');assert.equal(await readFile(marker,'utf8'),'x');
 }finally{if(previous===undefined)delete process.env.AGENTFORGE_ELECTRON_NODE;else process.env.AGENTFORGE_ELECTRON_NODE=previous;}
});

test('MCP tools discovers all pages over real stdio, shares in-flight work, caches successes and refreshes',async t=>{
 const root=await fixture(t),counter=join(root,'starts'),script=join(root,'server.mjs');
 await writeFile(script,`import {Server} from ${JSON.stringify(pathToFileURL(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js')).href)};import {StdioServerTransport} from ${JSON.stringify(pathToFileURL(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js')).href)};import {ListToolsRequestSchema} from ${JSON.stringify(pathToFileURL(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/types.js')).href)};import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(counter)},'x');const server=new Server({name:'fixture',version:'1.0.0'},{capabilities:{tools:{}}});server.setRequestHandler(ListToolsRequestSchema,async request=>request.params?.cursor?{tools:[${JSON.stringify(tool('second'))}]}:{tools:[${JSON.stringify(tool('first'))}],nextCursor:'page2'});await server.connect(new StdioServerTransport());`);
 const ref=await reference(root,{command:process.execPath,args:[script]}),discover=createMcpToolDiscovery();
 const [a,b]=await Promise.all([discover(ref,'test'),discover(ref,'test')]);assert.deepEqual(a,b);assert.deepEqual(a.tools.map(t=>t.name),['first','second']);assert.equal(a.total,2);assert.equal(a.tools[0].inputSchema.properties.password.type,'string');assert.equal(await readFile(counter,'utf8'),'x');
 a.tools.length=0;assert.equal((await discover(ref,'test')).tools.length,2);assert.equal(await readFile(counter,'utf8'),'x');await discover(ref,'test',{refresh:true});assert.equal(await readFile(counter,'utf8'),'xx');
});

for(const type of ['http','sse'])test(`MCP tools uses authenticated ${type} transport and returns real schemas without tool calls`,async t=>{
 const root=await fixture(t);let stream,called=0;
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer fixture-secret');
  if(req.method==='GET'&&type==='sse'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});stream=res;res.write('event: endpoint\ndata: /messages\n\n');return;}
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  let body='';for await(const part of req)body+=part;const message=JSON.parse(body);let result;
  if(message.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'remote',version:'1.0.0'}};
  else if(message.method==='tools/list'){const value=tool('remote_tool');value.description=req.headers.authorization;value.inputSchema.properties.password.default='fixture-secret';result={tools:[value]};}
  else if(message.method==='tools/call'){called++;throw Error('Discovery must not call a tool');}
  if(result){const value={jsonrpc:'2.0',id:message.id,result};if(type==='sse'){res.writeHead(202).end();stream.write('event: message\ndata: '+JSON.stringify(value)+'\n\n');}else res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value));}else res.writeHead(202).end();
 });server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{stream?.end();server.closeAllConnections();server.close();});
 const market=createMarketplace(join(root,'market')),entry=await market.add({kind:'mcp',name:'Remote',description:'真实协议',content:JSON.stringify({mcpServers:{test:{type,url:`http://127.0.0.1:${server.address().port}/mcp`,headers:{Authorization:'Bearer fixture-secret'}}}})});
 const found=await market.tools(entry.id);assert.equal(found.tools[0].name,'remote_tool');assert.equal(found.tools[0].inputSchema.required[0],'text');assert.equal(called,0);assert.ok(!JSON.stringify(found).includes('fixture-secret'));
});

test('MCP discovery times out and closes hanging transports; invalid content rejects and failures are not cached',async t=>{
 const root=await fixture(t),script=join(root,'hang.mjs');await writeFile(script,'setInterval(()=>{},1000);');const ref=await reference(root,{command:process.execPath,args:[script]});
 const discover=createMcpToolDiscovery({timeoutMs:100});await assert.rejects(discover(ref,'test'),/超时/);await assert.rejects(discover(ref,'test'),/超时/);
 await writeFile(ref.path,'changed');await assert.rejects(createMcpToolDiscovery({timeoutMs:3000})(ref,'test'),/无法读取/);
});
