// Real Codex chat and Task, isolated Electron, injected pre-session authentication failure.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
if(process.env.AGENTFORGE_CODEX_LOGIN_REAL!=='1')throw Error('Requires AGENTFORGE_CODEX_LOGIN_REAL=1; invokes real Codex');
await mkdir('.data',{recursive:true});
const resume=process.env.AGENTFORGE_CODEX_LOGIN_RESUME;
if(resume&&!resolve(resume).startsWith(resolve('.data/codex-login-real-')))throw Error('Resume requires this test’s isolated evidence directory');
const root=resume?resolve(resume):await mkdtemp(resolve('.data/codex-login-real-')),home=join(root,'home'),data=join(root,'client');await mkdir(home,{recursive:true});
const previous=resume?JSON.parse(await readFile(join(root,'evidence.json'),'utf8')):null;
const command=process.env.AGENTFORGE_LOGIN_CODEX||execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim();
const workerMarker='RETRY_WORKER_'+randomBytes(8).toString('hex');
const launcher=join(root,'codex');
if(!resume)await writeFile(launcher,`#!${process.execPath}
import {existsSync,writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';
const args=process.argv.slice(2),call=args.includes('exec'),chat=args.some(a=>a.includes('LOGIN_CHAT_AUTH_PROBE')),worker=args.some(a=>a.includes(${JSON.stringify(workerMarker)})),marker=${JSON.stringify(root)}+(chat?'/chat-auth-failed':'/task-auth-failed');
if(call&&(chat||worker)&&!existsSync(marker)){writeFileSync(marker,'injected unauthenticated CLI startup');const emit=()=>console.log(JSON.stringify({type:'error',message:'401 Unauthorized token expired: not logged in; reconnecting'}));emit();setInterval(emit,100);}else{const p=spawn(${JSON.stringify(command)},args,{env:{...process.env,HOME:${JSON.stringify(homedir())}},stdio:'inherit'});p.on('error',e=>{console.error(e.message);process.exitCode=1;});p.on('exit',code=>process.exitCode=code??1);}
`,{mode:0o700});
const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";
for(const name of ['.zprofile','.zshrc'])await writeFile(join(home,name),'export PATH='+quote(root)+':"$PATH"\n');
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('retry-qa',password);auth.close();
const seed=createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});seed.updateWorkspaceSettings({workspaceRoot:join(root,'work')});const profileId=seed.listRuntimeProfiles().find(p=>p.provider==='codex').id;seed.close();
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
console.log('EVIDENCE '+root);const evidence={...(previous||{}),root,realModel:true,injectedFailure:'unauthenticated startup emits repeated errors before native session, then existing real Codex login is available'};
try{
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});const origin=new URL(page.url()).origin;
 const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;},{path,body,method});
 await page.goto(origin+'/login');await page.locator('#username').fill('retry-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 let worker,manager,task,run;
 if(!resume){
 ({agent:worker}=await api('/api/agents',{name:'续接验收员工',systemPrompt:workerMarker+'。编写 add.mjs 导出 add(a,b)，编写 add.test.mjs 用 node:test 验证正数和负数求和，并运行 node --test add.test.mjs。成功后普通文字交接。若已完成，则检查原文件并复跑测试后交接。',runtime:{profileId,extensionSelection:{pluginIds:[],mcpIds:[]}}}));
 const {conversation:chat}=await api('/api/communications',{kind:'agent',targetId:worker.id});
 await api('/api/communications/'+chat.id+'/messages',{content:'LOGIN_CHAT_AUTH_PROBE：本轮是私聊，只回复 LOGIN_RECOVERED，不做文件。',clientRequestId:randomBytes(12).toString('hex')});
 const waitChat=async status=>{for(let n=0;n<600;n++){const value=await api('/api/communications/'+chat.id);if(value.deliveries[0]?.status===status)return value;await new Promise(r=>setTimeout(r,1000));}throw Error('Timed out chat '+status);};
 const failedChat=await waitChat('failed');assert.equal(failedChat.deliveries[0].nextAttemptAt,null);
 await new Promise(r=>setTimeout(r,16000));assert.equal((await api('/api/communications/'+chat.id)).deliveries[0].attempts,1);
 await page.goto(origin+'/communication/'+chat.id);await page.locator('[data-retry-chat-delivery]').click();const recoveredChat=await waitChat('done');assert.match(recoveredChat.messages.at(-1).content,/LOGIN_RECOVERED/);assert.equal(recoveredChat.deliveries[0].agentId,worker.id);
 const consoleState=await api('/api/communications/'+chat.id+'/console?agentId='+worker.id);assert.ok(consoleState.traces.some(t=>t.providerSessionId));evidence.communicationRecovered=true;evidence.employeeId=worker.id;
 ({agent:manager}=await api('/api/agents',{name:'续接验收经理',kind:'manager',systemPrompt:'只将唯一节点 check 派给续接验收员工，不自己做文件。员工交接后通过 managerDecision 的 nextNodeId:null、nextAgentId:null 提交人类验收，不额外派工、不要求人类澄清。',runtime:{profileId,extensionSelection:{pluginIds:[],mcpIds:[]}}}));
 const {workflowTemplate:workflow}=await api('/api/workflow-templates',{name:'原员工失败恢复验证',nodes:[{id:'check',title:'求和与测试',staffingGuidance:'续接验收员工',deliverable:'add.mjs 和 add.test.mjs，通过 node --test',artifactPaths:['add.mjs','add.test.mjs'],dependsOn:[]}]});
 ({task}=await api('/api/tasks',{title:'原员工失败恢复真实验收',objective:'经理将 check 派给续接验收员工。员工实现 add.mjs 和 add.test.mjs，测试正数和负数求和并实际运行 node --test。收到成功交接后经理提交人类验收。',memberAgentIds:[manager.id,worker.id],workflowTemplateId:workflow.id}));
 ({run}=await api('/api/tasks/'+task.id+'/run',{}));
 }else{const old=await api('/api/runs/'+previous.runId+'/workspace');run=old.run;task=run.task;worker={id:old.traces.find(t=>t.id===previous.failedTraceId).agentId};manager=run.manager;}
 evidence.runId=run.id;
 const workspace=()=>api('/api/runs/'+run.id+'/workspace');
 const wait=async(label,fn)=>{const start=Date.now();let logged=0;while(Date.now()-start<600000){const value=await fn();if(value)return value;if(Date.now()-logged>30000){console.log('WAIT '+label);logged=Date.now();}await new Promise(r=>setTimeout(r,1000));}throw Error('Timed out '+label);};
 const current=await workspace(),alreadyResumed=Boolean(resume&&current.run.status==='awaiting_acceptance');
 const failed=alreadyResumed?{...current,traces:current.traces.slice(0,current.traces.findIndex(t=>t.id===previous.failedTraceId)+1)}:await wait('worker failure',async()=>{const w=await workspace();return w.run.status==='failed'?w:null;});
 const failure=failed.traces.at(-1);assert.equal(failure.agentId,worker.id);assert.match(failure.error,/token expired/);assert.equal(failure.providerSessionId,null);const dispatchId=failure.dispatchId;
 evidence.failedTraceId=failure.id;evidence.sessionId=failure.providerSessionId;
 await page.goto(origin+'/runs/'+run.id);const button=page.locator('[data-retry-failed-node]');if(!alreadyResumed){await button.waitFor();
 for(const width of [1320,760]){await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,760),{origin,width});await page.waitForFunction(width=>innerWidth===width,width);assert.ok(await button.isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(root,'failure-'+width+'.png')});}
 await button.click();}
 const completed=await wait('resumed worker and manager acceptance',async()=>{const w=await workspace();if(w.run.status==='failed') {if(w.traces.length>failed.traces.length)throw Error(JSON.stringify(w.run.failure));return null;}return w.run.status==='awaiting_acceptance'?w:null;});
 const resumed=completed.traces[failed.traces.length];assert.equal(resumed.agentId,worker.id);assert.equal(resumed.dispatchId,dispatchId);assert.ok(resumed.providerSessionId);assert.equal(resumed.sessionMode,'new');assert.equal(resumed.status,'completed');assert.ok(completed.traces.filter(t=>t.agentId===run.manager.id).length>=failed.traces.filter(t=>t.agentId===run.manager.id).length+1);
 const result=await promisify(execFile)(process.execPath,['--test','add.test.mjs'],{cwd:completed.run.task.workspacePath});assert.match(result.stdout,/pass/);
 await wait('CLI delegation',()=>stat(join(data,'desktop-cli-session.json')).catch(()=>null));
 const cli=await promisify(execFile)(process.execPath,[resolve('cli/main.mjs'),'tasks','progress',task.id,'--endpoint-file',join(data,'desktop-endpoint.json'),'--json'],{env:{...process.env,HOME:home}});assert.equal(JSON.parse(cli.stdout).ok,true);
 await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();await wait('human completion',async()=>(await workspace()).run.status==='completed');
 evidence.resumedTraceId=resumed.id;evidence.status='passed';if(evidence.error){evidence.previousAttemptError=evidence.error;delete evidence.error;}await page.screenshot({path:join(root,'completed.png')});console.log(JSON.stringify(evidence));
}catch(error){evidence.status='failed';evidence.error=error.message;throw error;}finally{await writeFile(join(root,resume?'evidence-resumed.json':'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
