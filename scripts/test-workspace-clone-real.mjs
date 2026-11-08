// Opt-in: real native Hook + clone/commit task, isolated Electron and human sign-off.
import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright-core';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createStore} from '../server/store.mjs';
import {createAuth} from '../server/auth.mjs';
if(process.env.AGENTFORGE_WORKSPACE_CLONE_REAL!=='1')throw Error('Requires AGENTFORGE_WORKSPACE_CLONE_REAL=1');
const providers=(process.env.AGENTFORGE_WORKSPACE_CLONE_PROVIDERS||'claude-code,codex,dsh').split(',');
await mkdir(resolve('.data'),{recursive:true});const root=await mkdtemp(resolve('.data/workspace-clone-real-')),home=join(root,'home'),data=join(root,'client'),source=join(root,'source');await mkdir(home);await mkdir(source);
const git=(cwd,args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=CloneQA','-c','user.email=qa@localhost','-c','commit.gpgsign=false','-C',cwd,...args],{encoding:'utf8'});
git(source,['init']);await writeFile(join(source,'value.mjs'),'export const value = 1;\n');git(source,['add','.']);git(source,['commit','-m','initial']);const initial=git(source,['rev-parse','HEAD']).trim();
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('clone-qa',password);auth.close();
const store=createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});store.updateWorkspaceSettings({workspaceRoot:join(root,'work')});const profiles=Object.fromEntries(store.listRuntimeProfiles().map(p=>[p.provider,p.id]));store.close();
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
for(const provider of providers){const name=provider==='claude-code'?'claude':provider,actual=execFileSync('/usr/bin/which',[name],{encoding:'utf8'}).trim();await writeFile(join(root,name),'#!/bin/sh\nHOME='+quote(homedir())+' exec '+quote(actual)+' "$@"\n',{mode:0o700});}
for(const name of ['.zprofile','.zshrc'])await writeFile(join(home,name),'export PATH='+quote(root)+':"$PATH"\n');
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,DSH_HOME:process.env.DSH_HOME||join(homedir(),'.dsh'),CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
const evidence={root,initial,providers:[]};console.log('EVIDENCE '+root);
try{
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});const origin=new URL(page.url()).origin;
 const api=(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;},{path,body});
 await page.goto(origin+'/login');await page.locator('#username').fill('clone-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 await api('/api/health');
 for(const provider of providers){
  const runtime={profileId:profiles[provider],extensionSelection:{pluginIds:[],mcpIds:[]}};
  const {agent:worker}=await api('/api/agents',{name:'克隆员工 '+provider,systemPrompt:`先用独立工具调用 git clone ${quote(source)} project。下一次工具调用将 project/value.mjs 的 value 改为 2，运行 node --input-type=module -e 'import {value} from "./project/value.mjs"; if(value!==2)process.exit(1)'，然后使用 git -C project -c user.name=CloneQA -c user.email=qa@localhost -c commit.gpgsign=false commit 提交（先 git add）。只修改这个文件。不修改全局配置。完成后向经理交接实际测试及提交结果。`,runtime});
  const {agent:manager}=await api('/api/agents',{name:'克隆经理 '+provider,kind:'manager',systemPrompt:'将唯一节点 implement 派给克隆员工，不亲自操作文件。收到成功交接后提交人类验收。managerDecision 只使用 nextNodeId、nextAgentId、rationale 三个字段：派工时 nextNodeId=implement、nextAgentId=员工真实 ID；交付完成时 nextNodeId 和 nextAgentId 都为 null。不使用 action/type/decision 字段。不额外派工或澄清。',runtime});
  const {workflowTemplate:flow}=await api('/api/workflow-templates',{name:'克隆累计差异 '+provider,nodes:[{id:'implement',title:'修改并提交',staffingGuidance:worker.name,deliverable:'project/value.mjs 的 value=2，实际测试并提交',artifactPaths:['project/value.mjs'],dependsOn:[]}]});
  const {task}=await api('/api/tasks',{managerAgentId:manager.id,title:'Clone CHANGE '+provider,objective:'将测试源仓库克隆至 project，修改 value 为 2，验证并提交。员工成功后经理请求人类验收。',memberAgentIds:[manager.id,worker.id],workflowTemplateId:flow.id});const {run}=await api('/api/tasks/'+task.id+'/run',{});
  let final,registeredDuringExecution=false;const started=Date.now();
  while(Date.now()-started<600000){
   final=await api('/api/runs/'+run.id+'/workspace');
   // Do not read CHANGE before completion: prove Hook/turn-end registration, not GET fallback.
   try { const saved=JSON.parse(await readFile(join(data,'agentforge-runs','runs',run.id,'workspace-repositories.json'),'utf8')); if(saved.some(r=>r.baseRef===initial)&&final.traces.some(t=>t.agentId===worker.id&&t.status==='running'))registeredDuringExecution=true; } catch {}
   if(final.run.status==='failed')throw Error(JSON.stringify(final.run.failure));
   if(final.run.status==='awaiting_acceptance')break;
   if(Date.now()-started>30000&&Math.floor((Date.now()-started)/1000)%30===0)console.log('WAIT '+provider);
   await new Promise(r=>setTimeout(r,1000));
  }
  assert.equal(final.run.status,'awaiting_acceptance');assert.ok(registeredDuringExecution,'native Hook registered before worker ended');const work=final.run.task.workspacePath;
  assert.notEqual(git(join(work,'project'),['rev-parse','HEAD']).trim(),initial);assert.equal(git(join(work,'project'),['status','--porcelain']).trim(),'');
  const changes=await api('/api/runs/'+run.id+'/working-directory/changes'),child=changes.repositories.find(r=>r.path==='project');assert.equal(child.baseRef,initial);assert.deepEqual(child.changes.map(c=>c.path),['project/value.mjs']);
  const diff=await api('/api/runs/'+run.id+'/working-directory/diff?path=project%2Fvalue.mjs');assert.match(diff.patch,/-export const value = 1;/);assert.match(diff.patch,/\+export const value = 2;/);
  await page.goto(origin+'/runs/'+run.id);await page.locator('[data-ws-tab="directory"]').click();await page.locator('[data-ws-tab="diff"]').click();await page.getByText('value.mjs',{exact:true}).last().click();
  for(const width of [1320,760]){await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,760),{origin,width});await page.waitForFunction(width=>innerWidth===width,width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(root,provider+'-'+width+'.png')});}
  await page.locator('[data-ws-tab="collaboration"]').click();await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();
  for(let i=0;i<30;i++){if((await api('/api/runs/'+run.id+'/workspace')).run.status==='completed')break;await new Promise(r=>setTimeout(r,200));}
  assert.equal((await api('/api/runs/'+run.id+'/workspace')).run.status,'completed');evidence.providers.push({provider,runId:run.id,baseRef:child.baseRef,registeredDuringExecution,result:'passed'});console.log('PASS '+provider);
 }
 evidence.result='passed';
}catch(error){evidence.error=error.stack;throw error;}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
