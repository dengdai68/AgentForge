// Real models and an isolated desktop: no operator data or canned responses.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
import { writeStorageLocation } from '../server/storage-layout.mjs';

if (process.env.AGENTFORGE_SHARED_COLLABORATION_REAL !== '1') throw Error('Requires AGENTFORGE_SHARED_COLLABORATION_REAL=1; invokes real models');
await mkdir('.data',{recursive:true});
const resume=process.env.AGENTFORGE_SHARED_COLLABORATION_RESUME;
if(resume && (dirname(resolve(resume))!==resolve('.data') || !/^shared-collaboration-[A-Za-z0-9]+$/.test(basename(resume)))) throw Error('Resume requires this test’s isolated evidence directory');
const bundle=process.env.AGENTFORGE_SHARED_COLLABORATION_APP;
const root=resume?resolve(resume):await mkdtemp(resolve('.data/shared-collaboration-')),home=join(root,'home'),data=bundle?join(home,'.agentforge','desktop'):join(root,'client');
const previous=resume?JSON.parse(await readFile(join(root,'evidence.json'),'utf8')):null;
await mkdir(home,{recursive:true});
if(resume && bundle)await cp(join(root,'client'),data,{recursive:true});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('shared-qa',password);auth.close();
const seed=createStore({databasePath:join(root,'work','records','agentforge.sqlite'),configurationDirectory:data,workspaceRoot:join(root,'work')});seed.updateWorkspaceSettings({workspaceRoot:join(root,'work')});
const profileId=seed.listRuntimeProfiles().find(item=>item.provider==='claude-code').id;seed.close();
await writeStorageLocation(data,{version:1,workspaceRoot:join(root,'work'),previousRuntimeRoots:[]});
let proofA='PUBLIC_A_'+randomBytes(10).toString('hex'),proofB='OWN_B_'+randomBytes(10).toString('hex');
const app=await electron.launch({...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/AgentForge')}:{ }),args:[...(bundle?[]:['apps/electron/main.mjs']),'--user-data-dir='+join(root,'browser-profile')],env:{...process.env,HOME:home,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
const evidence={root,realModel:true,bundle:bundle||'source',...(resume?{resumedAfterFailure:previous.error}:{})};console.log('EVIDENCE '+root);
try {
  const page=await app.firstWindow({timeout:180000});page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(120000);await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:120000,waitUntil:'domcontentloaded'});const origin=new URL(page.url()).origin;
  const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw Error(value.error);return value;},{path,body,method});
  await page.goto(origin+'/login');await page.locator('#username').fill('shared-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
  const employee=async(name,systemPrompt)=>(await api('/api/agents',{name,systemPrompt,runtime:{profileId,extensionSelection:{pluginIds:[],mcpIds:[]}}})).agent;
  let a,b,observer,run;
  if(resume){const old=await api('/api/runs/'+previous.runId+'/workspace');run=old.run;assert.equal(run.status,'awaiting_acceptance');[a,b,observer]=['共享讨论 A','共享讨论 B','仅旁观不唤醒'].map(name=>run.task.memberSnapshots.find(member=>member.name===name));proofA=a.systemPrompt.match(/PUBLIC_A_[a-f0-9]+/)[0];proofB=b.systemPrompt.match(/OWN_B_[a-f0-9]+/)[0];evidence.taskId=run.taskId;evidence.runId=run.id;}else{
  a=await employee('共享讨论 A',`你参加真实讨论。opening 节点首次发言：建议去湖边，必须用 JSON handoff 交给本Run经理（从可咨询角色选择 taskRole=manager 的真实ID），完整发言放 summary，只在完整公开正文中给出你的校验码 ${proofA}。之后若收到同伴咨询，结合自己的上次发言回答：确认选湖边，并复述自己的校验码。不要另写“已参与讨论”的汇报摘要，完整发言放 summary。不要修改文件。`);
  b=await employee('共享讨论 B',`opening 节点首次发言：建议去城市书店，在完整正文给出你的校验码 ${proofB}，交给本Run经理。discuss 节点：从公开协作背景读取 A 先前发给经理的校验码，引用该码，向 A 发起 agent consultation，问是否确认湖边方案。收到真实答复后写完整最终结论，包含 A 的码、自己 opening 的码和确认选湖边；交接经理。不猜码，不从员工目录读取别人的系统配置，不创建文件。完整发言放 summary。`);
  observer=await employee('仅旁观不唤醒','只在被明确交办时回答；不需要因为背景消息产生自己的任务。');
  const manager=await employee('共享讨论经理',`本次是具体讨论任务。首次用 assignments 将 opening 同时派给 A(${a.id}) 和 B(${b.id})，让他们各自发言交回你。两人的 opening 都完成后，仅再给 B 派 discuss：让 B 自己读取 A 的公开报告并向 A consultation 确认，再给出最终结论。不要在 discuss 的 instruction 中复制任何校验码，校验码应通过公开背景和原生记忆获取。已有工作未完成则 wait。B 完成 discuss 且答复结束后 nextNodeId:null,nextAgentId:null 提交验收。不唤醒旁观者，不自己代答，不写文件，不复派相同工作。`);
  const workflow=(await api('/api/workflow-templates',{name:'公开讨论与同伴确认',nodes:[{id:'opening',title:'分别发言',deliverable:'各自发表一条完整意见'},{id:'discuss',title:'同伴确认',deliverable:'B引用A公开意见，A确认后B给出结论'}]})).workflowTemplate;
  const task=(await api('/api/tasks',{managerAgentId:manager.id,title:'共享协作真实讨论验收',objective:'A、B分别发言，再由B基于A公开意见向A确认并给出结论；保留完整发言，不能只向经理汇报已完成。无需创建业务文件。',memberAgentIds:[manager.id,a.id,b.id,observer.id],workflowTemplateId:workflow.id})).task;
  run=(await api('/api/tasks/'+task.id+'/run',{})).run;evidence.taskId=task.id;evidence.runId=run.id;
  }
  const state=()=>api('/api/runs/'+run.id+'/workspace');
  let done;const deadline=Date.now()+600000;let reportAt=0;
  while(Date.now()<deadline){const w=await state();if(w.run.status==='failed')throw Error(w.run.failure?.message||'Run failed');if(w.run.status==='awaiting_acceptance'){done=w;break;}if(Date.now()-reportAt>30000){console.log('WAIT '+w.traces.length+' traces');reportAt=Date.now();}await new Promise(resolve=>setTimeout(resolve,1000));}
  assert.ok(done,'Real discussion timed out');
  assert.equal(done.traces.filter(t=>t.agentId===observer.id).length,0,'public background must not wake every member');
  for(const member of [a,b]){const traces=done.traces.filter(t=>t.agentId===member.id);assert.ok(traces.length>=2);assert.equal(new Set(traces.map(t=>t.providerSessionId)).size,1);assert.ok(traces.slice(1).every(t=>t.sessionMode==='resume'));}
  const aReport=done.messages.find(m=>m.sender.id===a.id&&m.content.includes(proofA));assert.ok(aReport);assert.equal(aReport.recipient.id,run.manager.id);
  const bFinal=done.messages.find(m=>m.sender.id===b.id&&m.content.includes(proofA)&&m.content.includes(proofB)&&m.content.includes('湖边'));assert.ok(bFinal,'final body must retain peer evidence, own native memory and confirmation');
  assert.ok(done.messages.some(m=>m.kind==='agent_consultation'&&m.sender.id===b.id&&m.recipient.id===a.id));
  const bPrompts=await Promise.all(done.traces.filter(t=>t.agentId===b.id).map(t=>api(`/api/runs/${run.id}/traces/${t.id}/prompt`)));
  assert.ok(bPrompts.some(p=>p.prompt.text.split('[本轮输入]')[1].includes(proofA)),'A directed report must reach B as public background');
  assert.ok(bPrompts.every(p=>!p.prompt.text.split('[本轮输入]')[0].includes(proofA)),'A private persona is never copied into B system instructions');
  const instructions=done.messages.filter(m=>m.sender.id===run.manager.id&&m.recipient.id===b.id);assert.ok(instructions.every(m=>!m.content.includes(proofA)&&!m.content.includes(proofB)));
  await page.goto(origin+'/runs/'+run.id,{waitUntil:'domcontentloaded'});await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();
  await page.waitForFunction(async id=>{const r=await fetch('/api/runs/'+id+'/workspace?view=summary');return (await r.json()).run.status==='completed';},run.id);
  for(const width of [1320,760]){await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith(origin)).setContentSize(width,760),{origin,width});await page.waitForFunction(width=>innerWidth===width,width);await page.screenshot({path:join(root,'completed-'+width+'.png')});}
  Object.assign(evidence,{status:'passed',peerPublicReportDelivered:true,peerConsultation:true,nativeMemoryRetained:true,completeBody:true,noBackgroundWakeup:true,humanConfirmation:true,traces:done.traces.map(({id,agentId,type,status,sessionMode})=>({id,agentId,type,status,sessionMode}))});
  console.log('PASS shared collaboration: '+root);
}catch(error){evidence.status='failed';evidence.error=error.message;throw error;}
finally{await writeFile(join(root,resume?'evidence-resumed.json':'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
