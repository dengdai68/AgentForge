import {writeStorageLocation} from '../server/storage-layout.mjs';
// Isolated task attachment UI/HTTP/CLI acceptance; REAL=1 uses the operator's configured Claude account read-only.
import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright-core';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createCatalogFixtureStore} from '../tests/fixture-store.mjs';
import {createAuth} from '../server/auth.mjs';
import {createMarketplace} from '../server/runtime/marketplace.mjs';
const real=process.env.AGENTFORGE_ATTACHMENTS_REAL==='1';
await mkdir('.data',{recursive:true});const root=await mkdtemp(resolve('.data/task-attachments-')),home=join(root,'home'),data=join(root,'client');await mkdir(home,{recursive:true});
const auth=createAuth({databasePath:join(data,'auth.sqlite')}),password=randomBytes(20).toString('hex');await auth.setAdministrator('attachments-qa',password);auth.close();
const store=createCatalogFixtureStore({databasePath:join(root,'work','records','agentforge.sqlite'),configurationDirectory:data,workspaceRoot:join(root,'work')});store.updateWorkspaceSettings({workspaceRoot:join(root,'work')});store.setPluginUpdateSettings({enabled:false});
store.updateAgent('system_project_manager',{systemPrompt:'你是附件验收经理。先向人类 consultation audience=human 索取一张图片和一个文本文件。得到回复后，必须实际读取消息 attachments 中的绝对路径，回复文本中的验证串以及图片内容描述；不要派工，不要再次询问，使用 managerDecision nextNodeId:null,nextAgentId:null 提交验收。'});
let roleProof;
if(real && process.env.AGENTFORGE_ROLE_EXTENSIONS_REAL==='1') {
 const source=join(root,'role-proof');await mkdir(join(source,'.claude-plugin'),{recursive:true});await mkdir(join(source,'skills/proof'),{recursive:true});
 roleProof='ROLE_EXTENSION_'+randomBytes(12).toString('hex');
 await writeFile(join(source,'.claude-plugin/plugin.json'),JSON.stringify({name:'role-proof',description:'隔离角色继承验证'}));
 await writeFile(join(source,'skills/proof/SKILL.md'),'---\nname: proof\ndescription: 角色扩展继承验证串\n---\n本轮最终交付中请原样写出验证串：'+roleProof+'\n');
 const market=createMarketplace(join(data,'runtime-configs')),installed=await market.import({path:source});store.registerExtensions(installed.plugins);
 const role=store.createRole({name:'附件验收角色扩展',prompt:'先调用 role-proof:proof Skill，记住其中验证串，在收到人类附件后最后回复中展示它。',...await market.resolveRole({pluginIds:[installed.plugins[0].id],mcpIds:[]})});
 store.updateAgent('system_project_manager',{roleIds:[role.id]});
}
const runs=[];
for(const name of real?['真实附件']:['附件 minimal','附件 warm','CLI附件']){
 const task=store.createTask({managerAgentId:'system_project_manager',title:name,objective:'先询问人类提供参考图片和文本文件，收到后读取它们并报告内容，然后提交验收。',memberAgentIds:['system_project_manager']});const run=store.createRun(task.id);
 if(!real){store.initializeDispatches(run.id);const d=store.claimDispatch(run.id),trace=store.createTrace(run.id,{agentId:run.manager.id,workflowNodeId:d.workflowNodeId,type:d.purpose});store.attachDispatchTrace(d.id,trace.id);store.askQuestion(d.id,{audience:'human',question:'请提供参考图片和文件'},trace.id);store.completeTrace(trace.id);}
 runs.push({task,run});
}
store.close();
const imageBytes=await readFile('web/icons/application.png'),marker='ATTACHMENT_'+randomBytes(12).toString('hex'),fileBytes=Buffer.from('文件验证串：'+marker+'\n');
await writeFile(join(root,'binary.png'),imageBytes);
await writeStorageLocation(data,{version:1,workspaceRoot:join(root,'work'),previousRuntimeRoots:[]});
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,...(real?{CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')} :{}),AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
const evidence={root,real,cases:[]};console.log('EVIDENCE '+root);
try{
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});const origin=new URL(page.url()).origin;page.on('pageerror',error=>console.log('UI_ERROR',error.message));page.on('response',r=>{if(r.url().includes('/attachments')||r.url().endsWith('/messages'))console.log('HTTP',r.status(),new URL(r.url()).pathname);});
 await page.goto(origin+'/login');await page.locator('#username').fill('attachments-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 const api=(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const r=await fetch(path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};},{path,body,method});
 const size=async width=>{await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,850),width);await page.waitForFunction(width=>innerWidth===width,width);};
 for(const [index,{run,task}] of runs.slice(0,real?1:2).entries()){
  const theme=index?'warm':'minimal',width=index?760:1280;await size(width);await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value=${theme}]`).check();await page.goto(origin+'/runs/'+run.id);
  if(real){for(let i=0;i<180;i++){const w=(await api(`/api/runs/${run.id}/workspace?view=summary`)).data;if(w.pendingQuestions?.length)break;if(w.run?.status==='failed')throw Error('真实任务失败：'+JSON.stringify(w.traces.map(t=>t.error)));await page.waitForTimeout(1000);}await page.reload();}
  await page.locator('#reply-question').waitFor({timeout:180000});
  await page.locator('[data-task-image-file]').setInputFiles({name:'参考图片.png',mimeType:'image/png',buffer:imageBytes});await page.locator('[data-task-file]').setInputFiles({name:'说明.txt',mimeType:'text/plain',buffer:fileBytes});
  await page.locator('[data-task-attachments] .communication-draft-image img').waitFor();assert.equal(await page.locator('[data-remove-task-attachment]').count(),2);
  assert.equal(await page.locator('.message-composer-input [data-task-attachments] .communication-draft-image img').count(),1);assert.equal(await page.locator('[data-task-attachments] img').count(),1);assert.equal(await page.locator('[data-task-attachments] .pending > svg').count(),1);
  assert.equal(await page.locator('[data-task-attach]').innerText(),'');assert.equal(await page.locator('[data-task-attach-image]').innerText(),'');
  await page.locator('#instruction-text').fill('核对参考材料');await page.locator('[data-task-attachments] .communication-draft-image [data-chat-image]').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#instruction-text').inputValue(),'核对参考材料');await page.locator('#instruction-text').fill('');
  const inputBounds=await page.locator('.message-composer-input').boundingBox(),imageBounds=await page.locator('[data-task-attachments] .communication-draft-image img').boundingBox(),fileBounds=await page.locator('[data-task-attachments] .pending').boundingBox(),textBounds=await page.locator('.message-composer-input textarea').boundingBox();assert.ok(imageBounds.y>=inputBounds.y&&imageBounds.y+imageBounds.height<=inputBounds.y+inputBounds.height);assert.ok(fileBounds.y+fileBounds.height<=textBounds.y);assert.ok(imageBounds.y+imageBounds.height<=textBounds.y);assert.ok(Math.abs(fileBounds.y-imageBounds.y)<2);assert.equal(imageBounds.height,48);assert.equal(fileBounds.height,48);
   const draftImage=page.locator('.communication-draft-image .communication-image');await draftImage.hover();assert.equal(await draftImage.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
  await page.locator("#instruction-text").focus();await page.screenshot({path:join(root,`draft-${theme}.png`)});await page.locator("#instruction-form").screenshot({path:join(root,`composer-${theme}.png`)});
  const response=page.waitForResponse(r=>r.url().endsWith(`/api/runs/${run.id}/messages`)&&r.request().method()==='POST');await page.locator('[data-send-instruction]').click();const submitted=await response;assert.equal(submitted.status(),201);const receipt=await submitted.json();assert.equal(receipt.message.attachments.length,2);assert.ok(receipt.message.replyToMessageId);
  const record=page.locator(`[data-collaboration-record="${receipt.message.id}"]`);await record.waitFor();assert.equal(await record.locator('figcaption').count(),0);assert.equal(await record.locator('.communication-image-item').innerText(),'');const sentItems=await record.locator('.communication-attachment-list').evaluate(el=>({width:el.clientWidth,items:[...el.children].map(child=>{const r=child.getBoundingClientRect();return {y:r.y,width:r.width};})}));if(sentItems.items.reduce((n,item)=>n+item.width,8)<=sentItems.width)assert.equal(sentItems.items[0].y,sentItems.items[1].y);await record.locator('[data-chat-image]').click();await page.locator('.communication-image-viewer[open]').waitFor();assert.equal(Math.round((await page.locator('.communication-image-viewer').boundingBox()).width),width);await page.keyboard.press('Escape');
  const url=`/api/runs/${run.id}/attachments/${receipt.message.attachments[0].id}`;assert.equal((await fetch(origin+url)).status,401);const preview=await page.request.get(origin+url+'?preview=1');assert.equal(preview.status(),200);assert.deepEqual(await preview.body(),imageBytes);
  const file=await page.request.get(origin+`/api/runs/${run.id}/attachments/${receipt.message.attachments[1].id}`);assert.deepEqual(await file.body(),fileBytes);assert.match(file.headers()['content-disposition'],/attachment/);
  assert.equal((await page.request.get(origin+`/api/runs/${run.id}/attachments/${receipt.message.attachments[1].id}?preview=1`)).status(),415);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(root,`sent-${theme}.png`)});
  if(real){let final;for(let i=0;i<240;i++){final=(await api(`/api/runs/${run.id}/workspace?view=summary`)).data;if(final.run.status==='awaiting_acceptance')break;if(final.run.status==='failed')throw Error('附件读取调用失败：'+JSON.stringify(final.traces.map(t=>t.error)));await page.waitForTimeout(1000);}assert.equal(final.run.status,'awaiting_acceptance');assert.ok(final.messages.some(m=>m.sender.type==='agent'&&m.content.includes(marker)),'真实模型必须读取未写入任务描述的附件验证串');await page.reload();await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();for(let i=0;i<20;i++){if((await api(`/api/runs/${run.id}/workspace?view=summary`)).data.run.status==='completed')break;await page.waitForTimeout(250);}assert.equal((await api(`/api/runs/${run.id}/workspace?view=summary`)).data.run.status,'completed');if(roleProof)assert.ok(final.messages.some(m=>m.sender.type==='agent' && m.content.includes(roleProof)),'模型须从角色继承的 Skill 读取未写入任务/角色提示词的验证串');evidence.roleExtensionVerified=Boolean(roleProof);evidence.realCompleted=run.id;}
  evidence.cases.push({runId:run.id,theme,width,messageId:receipt.message.id});
 }
 if(!real){
  const health=(await api('/api/health')).data;await writeFile(join(root,'endpoint.json'),JSON.stringify({origin,instanceId:health.instanceId}),{mode:0o600});
  const cli=(args,input='')=>new Promise((done,reject)=>{const c=spawn(process.execPath,['cli/main.mjs',...args,'--json','--endpoint-file',join(root,'endpoint.json'),'--session-file',join(root,'cli/session.json')]);let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.once('error',reject);c.once('close',code=>code?reject(Error(stderr||stdout)):done(JSON.parse(stdout).data));c.stdin.end(input);});
  await cli(['auth','login','--username','attachments-qa','--password-stdin'],password+'\n');const {task,run}=runs[2],w=(await api(`/api/runs/${run.id}/workspace?view=summary`)).data;
  const receipt=await cli(['tasks','reply',task.id,'--file','-'],JSON.stringify({content:'',replyToMessageId:w.pendingQuestions[0].id,attachmentPaths:[join(root,'binary.png')]}));assert.equal(receipt.message.attachments.length,1);const downloaded=await page.request.get(origin+`/api/runs/${run.id}/attachments/${receipt.message.attachments[0].id}`);assert.deepEqual(await downloaded.body(),imageBytes);
  const foreign=await api(`/api/runs/${run.id}/messages`,{content:'跨任务',attachmentIds:[(await api(`/api/runs/${runs[0].run.id}/workspace?view=summary`)).data.messages.find(m=>m.attachments?.length).attachments[0].id]});assert.equal(foreign.status,400);evidence.cliBinary='passed';
 }
 evidence.status='passed';console.log(JSON.stringify(evidence));
}catch(error){evidence.error=error.message;try{const page=await app.firstWindow();await page.screenshot({path:join(root,'failure.png')});console.log('TOAST',await page.locator('#toast').textContent());}catch{}throw error;}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
