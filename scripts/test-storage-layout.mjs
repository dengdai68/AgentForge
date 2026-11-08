// Storage lifecycle acceptance. Fixtures are isolated; REAL=1 additionally
// invokes the operator-authorized native Claude CLI without writing its config.
import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright-core';
import {mkdir,mkdtemp,writeFile,readFile,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {createAuth} from '../server/auth.mjs';
import {createStore} from '../server/store.mjs';
import {createMarketplace,readExtensionFile} from '../server/runtime/marketplace.mjs';
import {storageBusinessRoot,writeStorageLocation} from '../server/storage-layout.mjs';
import {execute} from '../cli/main.mjs';
const real=process.env.AGENTFORGE_STORAGE_REAL==='1',bundle=process.env.AGENTFORGE_STORAGE_APP,instance=bundle?'desktop':'desktop-dev';
const fixtureParent=resolve(process.env.AGENTFORGE_STORAGE_TEST_ROOT || '.data');await mkdir(fixtureParent,{recursive:true});const root=await realpath(await mkdtemp(join(fixtureParent,'storage-layout-'))),home=join(root,'home'),control=join(home,'.agentforge/desktop'),beforeWork=join(root,'before'),afterWork=join(root,'after'),before=storageBusinessRoot(beforeWork,instance);
await mkdir(home,{recursive:true});const password=randomBytes(24).toString('hex');const auth=createAuth({databasePath:join(control,'auth.sqlite')});await auth.setAdministrator('storage-qa',password);auth.close();
await writeStorageLocation(control,{version:1,workspaceRoot:beforeWork,previousRuntimeRoots:[]});
const plugin=join(root,'source-plugin');await mkdir(join(plugin,'.claude-plugin'),{recursive:true});await mkdir(join(plugin,'skills/storage-fact'),{recursive:true});await writeFile(join(plugin,'.claude-plugin/plugin.json'),JSON.stringify({name:'storage-proof',version:'1.0.0'}));
const fact=randomBytes(16).toString('hex');await writeFile(join(plugin,'skills/storage-fact/SKILL.md'),'---\nname: storage-fact\ndescription: Read the storage relocation proof fact.\n---\nRead facts.txt in this skill directory and return the exact full value. Do not invent it.');await writeFile(join(plugin,'skills/storage-fact/facts.txt'),fact);
const market=createMarketplace(join(control,'runtime-configs')),imported=await market.import({path:plugin}),extension=imported.plugins[0];
const mcpFact=randomBytes(16).toString('hex'),mcpLog=join(root,'mcp-calls.log');
let probe=resolve('scripts/marketplace-probe-mcp.mjs');
if(bundle){
 // Test service only: real MCP JSON-RPC over stdio, without importing source
 // files from a removable checkout. The Provider remains the real native CLI.
 probe=join(root,'probe.cjs');await writeFile(probe,`const fs=require('node:fs'),rl=require('node:readline');const [log,proof]=process.argv.slice(2);fs.appendFileSync(log,'started\\n');rl.createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;let result;if(q.method==='initialize')result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'storage-proof',version:'1'}};else if(q.method==='tools/list')result={tools:[{name:'read_validation_code',description:'Read the required validation code.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};else if(q.method==='tools/call'){fs.appendFileSync(log,'called\\n');result={content:[{type:'text',text:JSON.stringify({verificationCode:proof})}]};}else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});`);
}
const mcp=await market.add({kind:'mcp',name:'storage-proof-mcp',description:'隔离存储验收 MCP 工具',content:JSON.stringify({mcpServers:{storage_proof:{command:process.execPath,args:[probe,mcpLog,mcpFact]}}})});
const store=createStore({databasePath:join(before,'agentforge.sqlite'),workspaceRoot:beforeWork,configurationDirectory:control});store.registerExtensions([...imported.plugins,mcp]);store.setPluginUpdateSettings({enabled:false});
const runtime=await market.resolve({pluginIds:[extension.id],mcpIds:[mcp.id]},'claude-code'),worker=store.createAgent({name:'存储位置验收',description:'读取原生 Skill 并提交交付。',systemPrompt:'按输入核验真实文件并报告。',runtime:{profileId:store.listRuntimeProfiles().find(p=>p.provider==='claude-code').id,...runtime}});
const manager=store.createAgent({name:'存储验收经理',systemPrompt:'把具体文件工作交给存储位置验收员工；依据交接直接提交人类验收，不增加业务复核。',runtime:{profileId:store.listRuntimeProfiles().find(p=>p.provider==='claude-code').id,...runtime}});
const task=store.createTask({title:'存储完整性验收',objective:`使用已加载的 storage-fact 原生 Skill，从其中 facts.txt 读取完整原值，写到本任务工作目录 report.txt，并在 summary 中报告完整原值。还必须调用已选择的 storage_proof MCP 的 read_validation_code 工具，把其 verificationCode 原值写入 mcp-proof.txt。经理将文件工作交给存储位置验收员工，无需其他员工和额外复核；员工交接后，经理按系统协议直接提交人类验收。不要提出澄清。`,memberAgentIds:[worker.id,manager.id],managerAgentId:manager.id});
const frozen=store.getTask(task.id);assert.equal(frozen.workspacePath,join(beforeWork,'tasks',task.id));store.close();
const app=await electron.launch({...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/AgentForge')} :{}),args:bundle?[]:['apps/electron/main.mjs'],env:{...process.env,HOME:home,AGENTFORGE_DESKTOP_DATA_ROOT:control,AGENTFORGE_LOG_DIR:join(root,'logs'),...(real?{CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')}:{})},timeout:120000});
const evidence={root,real,checks:[]};console.log('EVIDENCE '+root);
const poll=async(label,work,timeout=180000)=>{const started=Date.now();while(Date.now()-started<timeout){const value=await work();if(value)return value;await new Promise(r=>setTimeout(r,500));}throw new Error('Timeout: '+label);};
try{
 const page=await app.firstWindow({timeout:120000});page.setDefaultTimeout(45000);await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});let origin=new URL(page.url()).origin;
 const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw new Error(value.error);return value;},{path,body,method});
 await page.waitForLoadState('load');await page.waitForTimeout(500);console.log('INITIAL '+page.url());await page.goto(origin+'/login');await page.locator('#username').fill('storage-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 const cli=(args,value)=>execute([...args,'--endpoint-file',join(control,'desktop-endpoint.json')],{home,stdin:value===undefined?undefined:(async function*(){yield JSON.stringify(value);})()});await poll('CLI delegation',()=>lstat(join(control,'desktop-cli-session.json')).catch(()=>null));
 const initial=await cli(['storage','get']);assert.equal(initial.runtimeConfigRoot,join(control,'runtime-configs'));assert.equal(initial.configurationFile,join(control,'configuration.json'));assert.equal(initial.workspaceRoot,beforeWork);assert.equal(initial.businessRoot,before);assert.equal(initial.runFilesRoot,before);assert.equal(Object.hasOwn(JSON.parse(await readFile(join(control,'storage.json'),'utf8')),'businessRoot'),false);evidence.checks.push('App and CLI query same active paths; authentication separate');
 let runId,sessionHashes=[];
 if(real){
  const started=await api('/api/tasks/'+task.id+'/run',{});runId=started.run.id;
  await poll('real native task to human acceptance',async()=>{const w=await api('/api/runs/'+runId+'/workspace?view=compact');if(w.run.status==='failed')throw Error('Real invocation failed; inspect isolated console');return w.run.status==='awaiting_acceptance';},300000);
  assert.equal((await readFile(join((await api('/api/runs/'+runId+'/workspace?view=compact')).run.task.workspacePath,'report.txt'),'utf8')).trim(),fact);
  assert.equal((await readFile(join((await api('/api/runs/'+runId+'/workspace?view=compact')).run.task.workspacePath,'mcp-proof.txt'),'utf8')).trim(),mcpFact);
  const w=await api('/api/runs/'+runId+'/workspace?view=compact');sessionHashes=w.traces.filter(t=>t.providerSessionId).map(t=>({id:t.agentId,hash:createHash('sha256').update(t.providerSessionId).digest('hex')}));assert.ok(sessionHashes.length);
  await page.goto(origin+'/runs/'+runId);await page.getByRole('button',{name:'确认完成',exact:true}).click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await poll('client human confirmation',async()=>(await api('/api/runs/'+runId+'/workspace?view=compact')).run.status==='completed');evidence.checks.push('real native Skill read random file; real Task completed by human client');
 }
 const chatEvidence=[];
 if(real){
  const members=[];
  for(const name of ['共享目录 A','共享目录 B'])members.push((await api('/api/agents',{name,systemPrompt:'仅按本轮消息读取现有文件并如实回答，不修改文件，不主动提问或 @ 其他员工。',runtime:{profileId:'runtime_claude-code',extensionSelection:{pluginIds:[],mcpIds:[]}}})).agent);
  const group=(await api('/api/communications',{kind:'group',name:'同一目录验收',memberAgentIds:members.map(m=>m.id)})).conversation;
  const groupPath=join(beforeWork,'communications',group.id),shared=randomBytes(16).toString('hex');await mkdir(groupPath,{recursive:true});await writeFile(join(groupPath,'shared-fact.txt'),shared);
  const attachmentBytes=randomBytes(24).toString('hex');
  const uploaded=await page.evaluate(async({id,bytes})=>{const r=await fetch('/api/communications/'+id+'/attachments?name=proof.txt',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes});const v=await r.json();if(!r.ok)throw Error(v.error);return v.attachment;},{id:group.id,bytes:attachmentBytes});
  assert.equal(await readFile(join(groupPath,uploaded.path),'utf8'),attachmentBytes);
  const reply=async(chat,agent,file,expected,expectedCwd)=>{
    const sent=await api('/api/communications/'+chat.id+'/messages',{content:'请执行 pwd，并使用相对路径读取 ./'+file+'。reply 只报告真实工作目录和文件完整原值，不改文件，不 @ 其他人。',mentionAgentIds:chat.kind==='group'?[agent.id]:[],clientRequestId:randomBytes(16).toString('hex')});
    const result=await poll('native communication reads shared cwd',async()=>{const d=await api('/api/communications/'+chat.id);const delivery=d.deliveries.find(item=>item.messageId===sent.message.id&&item.agentId===agent.id);if(delivery?.status==='failed')throw Error('Real communication failed: '+delivery.error);return delivery?.status==='done'?d:false;},240000);
    const message=result.messages.filter(m=>m.sender.id===agent.id).at(-1);assert.ok(message.content.includes(expected));assert.ok(message.content.includes(expectedCwd));assert.equal(result.conversation.workspacePath,expectedCwd);
    const console=await api('/api/communications/'+chat.id+'/console?agentId='+agent.id);const trace=console.traces.find(t=>t.status==='completed'&&t.providerSessionId);assert.ok(trace);assert.ok(trace.promptRef);const prompt=await api('/api/communications/'+chat.id+'/traces/'+trace.id+'/prompt');assert.ok(prompt);assert.ok((await lstat(join(before,trace.promptRef.storagePath))).isFile());return createHash('sha256').update(trace.providerSessionId).digest('hex');
  };
  const first=await reply(group,members[0],'shared-fact.txt',shared,groupPath),second=await reply(group,members[1],'shared-fact.txt',shared,groupPath);assert.notEqual(first,second);
  const privateChat=(await api('/api/communications',{kind:'agent',targetId:members[0].id})).conversation,privatePath=join(beforeWork,'communications',privateChat.id),privateFact=randomBytes(16).toString('hex');await mkdir(privatePath,{recursive:true});await writeFile(join(privatePath,'private-fact.txt'),privateFact);
  assert.notEqual(await reply(privateChat,members[0],'private-fact.txt',privateFact,privatePath),first);
  chatEvidence.push({id:group.id,path:groupPath,agentId:members[0].id,sessionHash:first,fact:shared,attachment:uploaded,attachmentBytes});
  evidence.checks.push('real private/group invocations use communications/conversationId; group peers read the same relative file and actual pwd while native sessions stay distinct');
 }
 await page.goto(origin+'/settings/workspace');await page.locator('#default-workspace-root').waitFor();await page.screenshot({path:join(root,'before.png')});
 await assert.rejects(api('/api/settings/workspace',{workspaceRoot:afterWork,businessRoot:join(afterWork,'wrong')},'PUT'),/仅接受 workspaceRoot/);
 const accepted=await cli(['storage','update','--file','-'],{workspaceRoot:afterWork});assert.equal(accepted.restarting,true);
 await poll('owned service restart',async()=>{try{return new URL(page.url()).origin!==origin&&page.url().endsWith('/settings/workspace');}catch{return false;}},180000);origin=new URL(page.url()).origin;
 await page.locator('#default-workspace-root').waitFor();await poll('new delegation',()=>cli(['storage','get']).then(v=>v.workspaceRoot===afterWork).catch(()=>false));const updated=await cli(['storage','get']);assert.equal(updated.businessRoot,storageBusinessRoot(afterWork,instance));
 assert.equal(updated.runtimeConfigRoot,join(control,'runtime-configs'));const persisted=JSON.parse(await readFile(join(control,'storage.json'),'utf8'));assert.equal(Object.hasOwn(persisted,'businessRoot'),false);assert.equal(persisted.workspaceRoot,afterWork);
 for(const chat of chatEvidence){
  assert.equal((await api('/api/communications/'+chat.id)).conversation.workspacePath,chat.path);
  const downloaded=await page.evaluate(async({id,attachment})=>{const r=await fetch('/api/communications/'+id+'/attachments/'+attachment);if(!r.ok)throw Error('attachment '+r.status);return r.text();},{id:chat.id,attachment:chat.attachment.id});assert.equal(downloaded,chat.attachmentBytes);
  const console=await api('/api/communications/'+chat.id+'/console?agentId='+chat.agentId),trace=console.traces.find(t=>t.promptRef);assert.ok(trace);await api('/api/communications/'+chat.id+'/traces/'+trace.id+'/prompt');assert.ok((await lstat(join(storageBusinessRoot(afterWork,instance),trace.promptRef.storagePath))).isFile());
 }
 assert.equal((await api('/api/tasks/'+task.id)).task.workspacePath,frozen.workspacePath);assert.deepEqual((await api('/api/tasks/'+task.id)).task.memberSnapshots,frozen.memberSnapshots);
 const detail=await api('/api/runtime/marketplace/'+extension.id);assert.equal(detail.name,extension.name);await assert.rejects(lstat(join(before,'agentforge.sqlite')),{code:'ENOENT'});assert.ok((await lstat(join(control,'auth.sqlite'))).isFile());evidence.checks.push('CLI accepted change; host copied and verified, restarted only its service; new root active; old business files reclaimed; auth unchanged; frozen task path and members unchanged');
 if(real){
  const callsBefore=(await readFile(mcpLog,'utf8')).split('called').length,prior=new Set((await api('/api/runs/'+runId+'/workspace?view=compact')).traces.map(t=>t.id));await api('/api/runs/'+runId+'/messages',{content:'继续原会话：再次使用 storage-fact 原生 Skill 读取事实文件，并调用 storage_proof MCP 的 read_validation_code 工具，回复两个完整原值，不改 report.txt 或 mcp-proof.txt，不启动新业务，不重复提交验收。'});
  const w=await poll('native exact resume after relocation',async()=>{const w=await api('/api/runs/'+runId+'/workspace?view=compact');if(w.run.status==='failed')throw Error('Resume failed');const added=w.traces.find(t=>!prior.has(t.id));if(added?.status==='failed')throw Error('Native follow-up failed');return added?.status==='completed'?w:false;},240000);
  const newTrace=w.traces.find(t=>!prior.has(t.id));assert.ok(sessionHashes.some(s=>s.id===newTrace.agentId&&s.hash===createHash('sha256').update(newTrace.providerSessionId||'').digest('hex')));assert.equal(w.run.status,'completed');assert.ok((await readFile(mcpLog,'utf8')).split('called').length>callsBefore);evidence.checks.push('original native session continued after physical move with frozen Skill and MCP references; real MCP tool called again');
 }
 await page.screenshot({path:join(root,'after.png')});
 const catalogBefore=await api('/api/runtime/marketplace'),profilesBefore=await api('/api/settings/runtime-profiles');
 await writeFile(join(afterWork,'user-extra.txt'),'reset must remove this too');
 await page.getByRole('button',{name:'清除所有数据',exact:true}).click();await page.locator('#reset-current-password').fill(password);await page.locator('#reset-confirmation').fill('清除所有数据');await page.locator('#reset-data-form [type=submit]').click();
 await page.locator('#account-name').waitFor();await poll('reset reload',async()=>(await api('/api/bootstrap')).tasks.length===0);
 assert.equal((await api('/api/runtime/marketplace')).plugins.length,catalogBefore.plugins.length);
 assert.deepEqual((await api('/api/settings/runtime-profiles')).profiles.map(({employeeCount,...p})=>p),profilesBefore.profiles.map(({employeeCount,...p})=>p));
 await assert.rejects(lstat(join(afterWork,'user-extra.txt')),{code:'ENOENT'});assert.equal((await api('/api/bootstrap')).communicationUnreadCount,0);
 assert.equal((await api('/api/runtime/marketplace/'+extension.id)).name,extension.name);
 evidence.checks.push('client reset deletes entire work root including custom files; authenticated session, Runtime settings, plugin/MCP catalog and immutable files remain');evidence.result='PASS';
}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();console.log(JSON.stringify(evidence));}
