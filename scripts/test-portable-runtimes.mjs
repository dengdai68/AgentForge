// Isolated UI/HTTP/CLI acceptance. Default native executables are protocol
// fixtures. Opt in to one actual model with AGENTFORGE_PORTABLE_REAL=opencode.
import assert from 'node:assert/strict';
import{execFile}from'node:child_process';import{promisify}from'node:util';
import {_electron as electron} from 'playwright-core';
import {mkdtemp,mkdir,writeFile,readFile,symlink,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {RUNTIME_IDS,RUNTIME_PROVIDERS,PORTABLE_RUNTIME_IDS} from '../client/runtime-providers.mjs';
import {createAuth} from '../server/auth.mjs';
import {createStore} from '../server/store.mjs';
import {execute as cli} from '../cli/main.mjs';
const videoProof=process.env.AGENTFORGE_VIDEO_PROOF==='1';
const real=process.env.AGENTFORGE_PORTABLE_REAL || '',bundle=process.env.AGENTFORGE_PORTABLE_APP,extensionProof=process.env.AGENTFORGE_PORTABLE_EXTENSIONS==='1',agentProof=process.env.AGENTFORGE_PORTABLE_AGENT_PROOF==='1';
if(agentProof&&(!extensionProof||!real))throw Error('Agent proof requires real provider and extensions');
if(real&&!PORTABLE_RUNTIME_IDS.includes(real))throw Error('Unknown real Provider');
await mkdir('.data',{recursive:true});const root=await mkdtemp(resolve('.data/portable-runtimes-')),home=join(root,'home'),bin=join(home,'bin'),data=bundle?join(home,'.agentforge/desktop'):join(root,'client');await mkdir(bin,{recursive:true});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('portable-qa',password);auth.close();
const seed=createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});seed.updateWorkspaceSettings({workspaceRoot:join(root,'work')});seed.close();
const fixtureBody=provider=>`#!/usr/bin/env node
import{randomUUID,createHash}from'node:crypto';import{appendFile,mkdir,writeFile,readFile,realpath}from'node:fs/promises';import{join}from'node:path';
if(process.argv[2]==='session'&&process.argv[3]==='export')process.exit(0);
if(process.argv[2]==='models'){console.log('fixture/qa-native');process.exit(0);}
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const args=process.argv.slice(2),index=args.findIndex(x=>['--resume','--session'].includes(x));
const id=index>=0?args[index+1]:${JSON.stringify(provider)}==='opencode'?'ses_'+randomUUID().replaceAll('-',''):randomUUID();
await appendFile(${JSON.stringify(join(root,'fixture-calls.jsonl'))},JSON.stringify({provider:${JSON.stringify(provider)},resume:index>=0,id,communication:process.cwd().includes('/communications/')})+'\\n');
const result=JSON.stringify(process.cwd().includes('/communications/')?{reply:'协议夹具沟通成功，不是真实模型'}:{summary:'协议夹具执行成功，不是真实模型',managerDecision:{nextNodeId:null,nextAgentId:null}}),send=x=>console.log(JSON.stringify(x));
if(['cursor','qwen'].includes(${JSON.stringify(provider)})){send({type:'system',subtype:'init',session_id:id});send({type:'result',subtype:'success',result});}
if(${JSON.stringify(provider)}==='gemini'){send({type:'init',session_id:id});send({type:'message',role:'assistant',content:result,delta:true});send({type:'result',status:'success'});}
if(${JSON.stringify(provider)}==='kimi'){send({role:'assistant',content:result});send({role:'meta',type:'session.resume_hint',session_id:id});}
if(${JSON.stringify(provider)}==='pi'){send({type:'session',id});send({type:'message_end',message:{role:'assistant',content:[{type:'text',text:result}],stopReason:'stop'}});send({type:'agent_settled',aborted:false});}
if(${JSON.stringify(provider)}==='opencode'){send({type:'step_start',sessionID:id});send({type:'text',sessionID:id,part:{text:result}});send({type:'step_finish',sessionID:id,part:{reason:'stop'}});}
`;
for(const provider of PORTABLE_RUNTIME_IDS)if(provider!==real)await writeFile(join(bin,RUNTIME_PROVIDERS[provider].command),fixtureBody(provider),{mode:0o700});
// Opt-in real validation keeps domain/browser state isolated. Only the native
// CLI reads its existing connection/auth file through a private link; tests do
// not parse, print, copy, or publish credential values.
if(['cursor','gemini'].includes(real)&&process.platform==='darwin'){
 // A private HOME otherwise hides the default macOS keychain from security(1).
 // Reference only the existing default encrypted database; no -g/-w lookup,
 // credential extraction, keychain change, or additional access grant occurs.
 const {stdout}=await promisify(execFile)('/usr/bin/security',['default-keychain','-d','user']);const target=stdout.trim().replace(/^"|"$/g,'');
 if(!target.startsWith('/'))throw Error('Native default keychain path is invalid');
 const directory=join(home,'Library/Keychains');await mkdir(directory,{recursive:true});await symlink(target,join(directory,target.split('/').at(-1)));
}
for(const provider of real==='cursor'?['cursor']:real==='qwen'?['qwen']:[]){
 const native=provider==='cursor'?(process.env.CURSOR_CONFIG_DIR || join(process.env.HOME,'.cursor')):join(process.env.HOME,'.qwen'),isolated=join(home,'.'+provider);await mkdir(isolated,{recursive:true});
 for(const name of provider==='cursor'?['cli-config.json']:['settings.json','oauth_creds.json']){const source=join(native,name);try{await lstat(source);await symlink(source,join(isolated,name));}catch(error){if(error.code!=='ENOENT')throw error;}}
}
const env={...process.env,HOME:home,ZDOTDIR:home,PATH:bin+':'+process.env.PATH,AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')};
if(real==='cursor')env.CURSOR_CONFIG_DIR=join(home,'.cursor');
if(real==='gemini')env.GEMINI_CLI_HOME=process.env.GEMINI_CLI_HOME || process.env.HOME;
if(real==='kimi')env.KIMI_CODE_HOME=process.env.KIMI_CODE_HOME || join(process.env.HOME,'.kimi-code');
if(real==='pi')env.PI_CODING_AGENT_DIR=process.env.PI_CODING_AGENT_DIR || join(process.env.HOME,'.pi/agent');
if(real==='opencode'){env.XDG_CONFIG_HOME ||= join(process.env.HOME,'.config');env.XDG_DATA_HOME ||= join(process.env.HOME,'.local/share');env.XDG_STATE_HOME ||= join(process.env.HOME,'.local/state');}
const app=await electron.launch({...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/AgentForge')}:{}),args:[...(bundle?[]:['apps/electron/main.mjs']),'--user-data-dir='+join(root,'browser')],env,timeout:120000});const evidence={root,real:real || null,protocolFixtures:!real,providers:[],layouts:[]},errors=[];console.log('EVIDENCE '+root);
try{
 const page=await app.firstWindow({timeout:120000});page.on('pageerror',e=>errors.push(e.message));await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});const origin=new URL(page.url()).origin;
 const api=(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(data.error);return data;},{path,body});
 await page.goto(origin+'/login');await page.locator('#username').fill('portable-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 const flags=['--endpoint-file',join(data,'desktop-endpoint.json'),'--session-file',join(root,'cli/session.json')];await cli(['auth','login','--username','portable-qa','--password-stdin',...flags],{stdin:Readable.from([password+'\n'])});
 let extensionRole=null,extensionPluginId=null;const childProof=randomBytes(16).toString('hex'),skillProof=randomBytes(16).toString('hex'),mcpProof=randomBytes(16).toString('hex');
 if(extensionProof){
  const source=join(root,'plugin-source');await mkdir(join(source,'.claude-plugin'),{recursive:true});await mkdir(join(source,'skills','runtime-e2e'),{recursive:true});
  await writeFile(join(source,'.claude-plugin/plugin.json'),JSON.stringify({name:'runtime-e2e',version:'1.0.0'}));
  await writeFile(join(source,'skills/runtime-e2e/SKILL.md'),`---\nname: runtime-e2e\ndescription: Only during Task execution, create extension-proof.txt and call the selected native MCP for mcp-proof.txt. Do not use in ordinary communication.\n---\nDuring Task execution write extension-proof.txt in the task working directory with exactly ${skillProof}. Call the e2e_proof read_validation_code native MCP tool and write its returned verificationCode string to mcp-proof.txt. Then finish the task using the platform's task result format. Never read MCP configuration/source or emulate the tool via Shell.\n`);
  if(agentProof){await mkdir(join(source,'agents'));await writeFile(join(source,'agents/proof-worker.md'),`---\nname: proof-worker\ndescription: Independently write the native child verification file during Task execution.\nmodel: inherit\n${real==='cursor'?'':'tools: Read, Bash\n'}---\nOnly act as the independent proof worker. Use Shell in the task's working directory to write task-child-proof.txt with exactly ${childProof}. Return that same value. Do not use any Skill, MCP, or another subagent.\n`);const skill=join(source,'skills/runtime-e2e/SKILL.md');await writeFile(skill,await readFile(skill,'utf8')+'\nDuring Task execution invoke the installed runtime-e2e:proof-worker as an independent native subagent, let it follow its own instructions to create task-child-proof.txt, and wait for completion. Do not inspect its definition or impersonate its work in the parent.\n');}
  const imported=await cli(['plugins','import','--file','-',...flags],{stdin:Readable.from([JSON.stringify({path:source})])}),mcp=await cli(['mcps','create','--file','-',...flags],{stdin:Readable.from([JSON.stringify({name:'Runtime E2E proof',content:JSON.stringify({mcpServers:{e2e_proof:{command:process.execPath,args:[resolve('scripts/marketplace-probe-mcp.mjs'),join(root,'native-mcp-proof.log'),mcpProof]}}})})])});
  extensionPluginId=imported.plugins[0].id;
  for(const [group,id]of [['plugins',imported.plugins[0].id],['mcps',mcp.id]]){const check=await cli([group,'check-compatibility',id,...flags]);if(agentProof&&group==='plugins')assert.ok(check.providers.includes(real));else assert.equal(check.providers.length,9);}
  extensionRole=(await cli(['roles','create','--file','-',...flags],{stdin:Readable.from([JSON.stringify({name:'Native extension E2E role',prompt:'Task execution must use the selected runtime-e2e Skill and native e2e_proof MCP; ordinary communication only replies.',extensionSelection:{pluginIds:[imported.plugins[0].id],mcpIds:[mcp.id]}})])})).role;
 }
 const profiles=await cli(['runtimes','list',...flags]);assert.deepEqual(profiles.items.map(x=>x.provider),RUNTIME_IDS);
 const wait=async(id,excludeTrace)=>{const start=Date.now();while(Date.now()-start<(real?600000:30000)){const w=await api('/api/runs/'+id+'/workspace?view=compact');if(w.run.status==='failed')throw Error(w.run.failure?.message || 'Run failed');if(w.run.status==='awaiting_acceptance'&&w.traces.some(t=>t.status==='completed'&&t.id!==excludeTrace))return w;await new Promise(r=>setTimeout(r,500));}throw Error('Native run timeout');};
 for(const provider of PORTABLE_RUNTIME_IDS){
  const profile=profiles.items.find(p=>p.provider===provider);assert.ok(profile.installed,provider+' executable');
  const model=provider===real?(process.env.AGENTFORGE_PORTABLE_MODEL || ''):'qa-native';
  await cli(['runtimes','update',profile.id,'--file','-',...flags],{stdin:Readable.from([JSON.stringify({model,effort:provider===real?(process.env.AGENTFORGE_PORTABLE_EFFORT || ''):''})])});assert.equal((await cli(['runtimes','get',provider,...flags])).model,model);
  if(real&&provider!==real)continue;
  if(real){
    const catalog=await cli(['runtimes','models',provider,'--refresh',...flags]);assert.ok(catalog.models.length>0);
    await page.goto(origin+'/settings/runtime');const row=page.locator(`[data-runtime-profile="${profile.id}"]`);await row.locator('summary').click();await row.locator('[data-refresh-models]').click();
    await row.locator('[name=model]').fill(model);await page.locator('[data-value="'+model+'"]').click();
    const effort=process.env.AGENTFORGE_PORTABLE_EFFORT || '';await row.locator('[name=effort]').selectOption(effort);await row.getByRole('button',{name:'保存配置',exact:true}).click();await row.getByText('已保存。可测试此配置。',{exact:true}).waitFor();assert.equal((await cli(['runtimes','get',provider,...flags])).effort,effort);
  }
  const agent=(await cli(['agents','create','--file','-',...flags],{stdin:Readable.from([JSON.stringify({name:provider+' 验收员工',...(extensionRole?{roleIds:[extensionRole.id]}:{}),systemPrompt:'执行 Task 时，你是唯一成员并担任经理，亲自用工具创建 proof.txt，内容为 NATIVE_RUNTIME_VERIFIED，不派工其他人。任务执行完毕后，最终只输出一个有效 JSON 对象，不加解释、反引号或 Markdown：{"summary":"NATIVE_RUNTIME_VERIFIED","managerDecision":{"nextNodeId":null,"nextAgentId":null}}。普通沟通遵循平台当前沟通格式，不使用任务的经理决策格式。',runtime:{profileId:profile.id,extensionSelection:{pluginIds:[],mcpIds:[]}}})])})).agent;
  const launched=await cli(['tasks','create','--file','-','--start',...flags],{stdin:Readable.from([JSON.stringify({title:provider+' '+(real?'真实模型':'协议夹具')+'验收',objective:real?'创建 proof.txt，正文 NATIVE_RUNTIME_VERIFIED；最终只输出 JSON 对象 {"summary":"NATIVE_RUNTIME_VERIFIED","managerDecision":{"nextNodeId":null,"nextAgentId":null}} 提交验收。':'仅验证协议夹具经客户端派工和确认，不宣称模型执行。',memberAgentIds:[agent.id],managerAgentId:agent.id})])});
  const completed=await wait(launched.run.id);assert.ok(completed.traces.some(t=>t.status==='completed'&&t.providerSessionId));if(real){assert.match(await readFile(join(completed.run.task.workspacePath,'proof.txt'),'utf8'),/NATIVE_RUNTIME_VERIFIED/);if(extensionProof){assert.equal((await readFile(join(completed.run.task.workspacePath,'extension-proof.txt'),'utf8')).trim(),skillProof);assert.equal((await readFile(join(completed.run.task.workspacePath,'mcp-proof.txt'),'utf8')).trim(),mcpProof);assert.match(await readFile(join(root,'native-mcp-proof.log'),'utf8'),/called/);if(agentProof)assert.equal((await readFile(join(completed.run.task.workspacePath,'task-child-proof.txt'),'utf8')).trim(),childProof);}}
  const first=completed.traces.find(t=>t.status==='completed');await cli(['tasks','message',launched.task.id,'--file','-',...flags],{stdin:Readable.from([JSON.stringify({content:'继续原会话，核对已有结果，最终只输出 JSON 对象 {"summary":"NATIVE_RUNTIME_VERIFIED","managerDecision":{"nextNodeId":null,"nextAgentId":null}} 提交验收。'})])});const resumed=await wait(launched.run.id,first.id);const next=resumed.traces.find(t=>t.status==='completed'&&t.id!==first.id);assert.equal(next.providerSessionId,first.providerSessionId);assert.equal(next.sessionMode,'resume');
  await page.goto(origin+'/runs/'+launched.run.id);
  if(videoProof){
    const clip=join(completed.run.task.workspacePath,'preview.mp4');await promisify(execFile)('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=320x180:rate=12','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',clip]);
    await page.locator('#directory-mode').click();await page.locator('[data-select-working-file="preview.mp4"]').click();const video=page.locator('.working-video-preview video');await video.waitFor();
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await video.evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video').currentTime>0.15);await video.evaluate(v=>{v.pause();v.currentTime=2.5;});await page.waitForFunction(()=>Math.abs(document.querySelector('video').currentTime-2.5)<0.2&&!document.querySelector('video').seeking);
    await page.locator('[data-refresh-directory]').click();await page.waitForFunction(()=>document.querySelector('video')?.currentTime>2.3);
    const resource='/api/runs/'+launched.run.id+'/working-directory/content?media=1&path=preview.mp4';
    const range=await page.evaluate(async url=>{const r=await fetch(url,{headers:{Range:'bytes=4-11'}});return {status:r.status,range:r.headers.get('Content-Range'),size:(await r.arrayBuffer()).byteLength};},resource);const head=await page.evaluate(async url=>{const r=await fetch(url,{method:'HEAD'});return {status:r.status,length:r.headers.get('Content-Length'),size:(await r.arrayBuffer()).byteLength};},resource);assert.equal(head.status,200);assert.ok(Number(head.length)>0);assert.equal(head.size,0);assert.equal(range.status,206);assert.equal(range.size,8);assert.match(range.range,/^bytes 4-11\//);
    for(const [value,status]of [['bytes=-20',206],['bytes=999999999999-',416],['bytes=1-2,4-6',416]])assert.equal(await page.evaluate(async({resource,value})=>(await fetch(resource,{headers:{Range:value}})).status,{resource,value}),status);
    const noauth=await app.context().request.get(origin+resource,{headers:{Cookie:''}});assert.equal(noauth.status(),401);
    for(const width of [1320,760]){await page.evaluate(width=>{document.documentElement.dataset.theme=width===760?'warm':'minimal';},width);await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,760),width);await page.waitForFunction(width=>innerWidth===width,width);await page.waitForFunction(()=>{const v=document.querySelector('video').getBoundingClientRect(),head=document.querySelector('.artifact-viewer-head').getBoundingClientRect(),box=document.querySelector('.artifact-viewer').getBoundingClientRect();return v.top>=head.bottom&&v.bottom<=box.bottom&&v.height>50&&document.querySelector('video').currentTime>2.3&&document.querySelector('video').readyState>=2&&!document.querySelector('video').seeking;});await page.screenshot({path:join(root,'video-'+width+'.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
    evidence.video={played:true,sought:true,range:true,authentication:true};await page.locator('#collaboration-mode').click();
  }
  await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await page.waitForFunction(async id=>(await(await fetch('/api/runs/'+id+'/workspace?view=compact')).json()).run.status==='completed',launched.run.id);evidence.providers.push({provider,runId:launched.run.id,confirmed:true,real:provider===real,...(extensionProof?{roleExtensions:true}:{}),...(agentProof?{nativeSubagent:true}:{})});
  {
   const {conversation}=await api('/api/communications',{kind:'agent',targetId:agent.id});
   for(let turn=1;turn<=2;turn++){
    await api('/api/communications/'+conversation.id+'/messages',{content:real?'第 '+turn+' 轮真实沟通，请自然回复“收到”，严格按本轮沟通 JSON 格式回复，不执行任务。':'第 '+turn+' 次协议沟通',clientRequestId:randomBytes(12).toString('hex')});const started=Date.now();let received=false;
    while(Date.now()-started<(real?180000:30000)){const chat=await api('/api/communications/'+conversation.id);if(chat.deliveries.some(d=>d.status==='failed'))throw Error(provider+' communication failed');if(chat.messages.filter(m=>m.sender.type==='agent').length===turn){received=true;break;}await new Promise(r=>setTimeout(r,200));}assert.ok(received);
   }
   if(!real){const calls=(await readFile(join(root,'fixture-calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).filter(c=>c.provider===provider&&c.communication);assert.equal(calls.length,2);assert.equal(calls[0].id,calls[1].id);}const chatConsole=await api('/api/communications/'+conversation.id+'/console');const calls=chatConsole.traces.filter(t=>t.providerSessionId);assert.equal(calls.length,2);assert.equal(calls[0].providerSessionId,calls[1].providerSessionId);assert.ok(calls.some(t=>t.sessionMode==='resume'));evidence.providers.at(-1).communicationResumed=true;
  }
 }
 for(const [theme,width]of[['minimal',1320],['warm',760]]){
  await app.evaluate(({BrowserWindow},{width})=>{const w=BrowserWindow.getAllWindows()[0];if(w.isMaximized())w.unmaximize();w.setContentSize(width,800);},{width});
  await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value=${theme}]`).check();await page.goto(origin+'/settings/runtime');await page.locator('.runtime-provider-row').nth(8).waitFor();assert.equal(await page.locator('.runtime-provider-row').count(),9);
  const last=page.locator('[data-runtime-profile=runtime_opencode]');await last.locator('summary').click();await last.locator('[name=model]').waitFor();assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth));await page.screenshot({path:join(root,`runtime-${theme}-${width}.png`)});evidence.layouts.push({theme,width,providers:9});
  if(extensionProof){await page.goto(origin+'/marketplace');await page.locator(`[data-extension-detail="${extensionPluginId}"]`).first().click();await page.locator('.plugin-runtime-compatibility .runtime-support').nth(8).waitFor();assert.equal(await page.locator('.plugin-runtime-compatibility .runtime-support').count(),9);await page.locator('[data-check-compatibility]').click();await page.getByText('兼容性已更新。',{exact:true}).waitFor();await page.locator('.plugin-runtime-compatibility .runtime-support').nth(8).waitFor();assert.ok(await page.locator('.extension-detail-modal').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:join(root,`market-native-${theme}-${width}.png`)});await page.locator('[data-close-modal]').click();}
 }
 assert.deepEqual(errors,[]);evidence.status='passed';console.log(JSON.stringify(evidence));
}catch(error){evidence.status='failed';evidence.error=error.message;await(await app.firstWindow()).screenshot({path:join(root,'failure.png')}).catch(()=>{});throw error;}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
