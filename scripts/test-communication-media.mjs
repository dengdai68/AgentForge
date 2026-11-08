// Isolated Electron attachment and automation presentation acceptance; no Provider.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCatalogFixtureStore } from '../tests/fixture-store.mjs';
import { createRunFiles } from '../server/run-files.mjs';
import { createAuth } from '../server/auth.mjs';
await mkdir('.data',{recursive:true});
const root=await mkdtemp(resolve('.data/communication-media-')),home=join(root,'home'),data=join(root,'client');await mkdir(home,{recursive:true});
const auth=createAuth({databasePath:join(data,'auth.sqlite')}),password=randomBytes(24).toString('hex');await auth.setAdministrator('media-qa',password);auth.close();
const store=createCatalogFixtureStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});
const files=createRunFiles({root:join(data,'agentforge-runs')}),chat=store.openCommunication({kind:'agent',targetId:'agent_analyst'});
const imageBytes=await readFile('web/icons/application.png'),fileBytes=Buffer.from('附件下载内容\n中文文件名与原字节保留。');
const attachments=[];
for(const [name,bytes] of [['参考图片.png',imageBytes],['说明文件.txt',fileBytes],['损坏图片.png',Buffer.from('not an image')]])attachments.push(store.registerCommunicationAttachment(chat.id,await files.writeCommunicationAttachment(chat.id,name,bytes)));
store.sendCommunication(chat.id,{content:'请参考图片和说明文件。',attachmentIds:attachments.map(a=>a.id),clientRequestId:'media-fixture'});
store.completeCommunication(chat.id,store.claimCommunication(chat.id).id,'已收到参考材料。');
const auto=store.saveAutomation({managerAgentId:'system_project_manager',title:'素材整理',objective:'读取参考图片与说明文件。\n生成本轮整理结果，并说明需要继续处理的内容。',memberAgentIds:['system_project_manager','agent_analyst'],cron:'0 9 * * *',enabled:false});
const trigger=store.triggerAutomation(auto.id);store.requestHumanAcceptance(trigger.runId);store.close();
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});
const evidence={root,cases:[]};console.log('EVIDENCE '+root);
try{
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});const origin=new URL(page.url()).origin;page.on('pageerror',error=>console.log('UI_ERROR',error.message));
 await page.goto(origin+'/login');await page.locator('#username').fill('media-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 const size=async(width,height=800)=>{await app.evaluate(({BrowserWindow},{origin,width,height})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,height),{origin,width,height});await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});};
 await size(1200);
 await page.goto(origin+'/communication/'+chat.id);await page.locator('.communication-message-attachments').waitFor();await page.screenshot({path:join(root,'chat-before.png')});
 if(process.env.AGENTFORGE_MEDIA_BASELINE==='1'){
  await page.goto(origin+'/automations/'+auto.id);await page.locator('.automation-trigger-table').waitFor();evidence.baseline=await page.locator('.automation-table-scroll').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth}));await page.screenshot({path:join(root,'automation-before.png')});console.log(JSON.stringify(evidence));
 }else{
  assert.equal((await page.request.get(origin+'/api/health')).status(),200);
  const imageUrl=`/api/communications/${chat.id}/attachments/${attachments[0].id}`;
  const preview=await page.request.get(origin+imageUrl+'?preview=1');assert.equal(preview.status(),200);assert.equal(preview.headers()['content-type'],'image/png');assert.deepEqual(await preview.body(),imageBytes);
  assert.equal((await page.request.get(`${origin}/api/communications/${chat.id}/attachments/${attachments[2].id}?preview=1`)).status(),415);
  assert.equal((await fetch(origin+imageUrl+'?preview=1')).status,401);
  // Media and responsive assertions are below; keeping evidence out of source control.
  for(const [theme,width] of [['minimal',1200],['warm',760]]){
   await size(width);await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value=${theme}]`).check();
   await page.goto(origin+'/communication/'+chat.id);
   const thumbnail=page.locator('[data-chat-image]').filter({has:page.locator('img[alt="参考图片.png"]')});await thumbnail.waitFor();
   await page.waitForFunction(()=>document.querySelector('img[alt="参考图片.png"]')?.naturalWidth>0);
   assert.equal(await page.locator('.communication-image-item figcaption').count(),0);
   assert.equal(await page.locator('.communication-image-item').first().innerText(),'');
   const attachmentRow=page.locator('.communication-attachment-list').first();
   const positions=await attachmentRow.evaluate(el=>({width:el.clientWidth,items:[...el.children].map(child=>{const r=child.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};})}));
   assert.ok(positions.items[0].width+positions.items[1].width+8<=positions.width);assert.equal(positions.items[0].y,positions.items[1].y);assert.ok(positions.items[1].x>positions.items[0].x);if(positions.items.reduce((sum,item)=>sum+item.width,16)>positions.width)assert.ok(positions.items[2].y>positions.items[0].y);
   await page.screenshot({path:join(root,`sent-${theme}-${width}.png`)});
   await thumbnail.click();await page.locator('.communication-image-viewer[open]').waitFor();
   const modal=page.locator('.communication-image-viewer');const bounds=await modal.boundingBox();assert.equal(Math.round(bounds.width),width);assert.equal(Math.round(bounds.height),800);
   await page.waitForFunction(()=>document.querySelector('.communication-image-viewer img')?.naturalWidth>0);await page.screenshot({path:join(root,`preview-${theme}-${width}.png`)});
   const imageDestination=join(root,`image-download-${theme}.png`);
   await app.evaluate(({BrowserWindow},destination)=>{globalThis.__imageDownload=null;BrowserWindow.getAllWindows()[0].webContents.session.once('will-download',(_event,item)=>{item.setSavePath(destination);item.once('done',(_event,state)=>globalThis.__imageDownload={state,name:item.getFilename()});});},imageDestination);
   await page.locator('[data-image-download]').click();
   for(let i=0;i<100;i++){const result=await app.evaluate(()=>globalThis.__imageDownload);if(result){assert.equal(result.state,'completed');assert.equal(result.name,'参考图片.png');break;}await page.waitForTimeout(100);}
   assert.deepEqual(await readFile(imageDestination),imageBytes);
   await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await thumbnail.evaluate(el=>el===document.activeElement),true);
   const broken=page.locator('[data-chat-image]').filter({has:page.locator('img[alt="损坏图片.png"]')});await broken.locator('.communication-image-error').waitFor();
   const destination=join(root,`download-${theme}.txt`);
   await app.evaluate(({BrowserWindow},destination)=>{globalThis.__mediaDownload=null;BrowserWindow.getAllWindows()[0].webContents.session.once('will-download',(_event,item)=>{item.setSavePath(destination);item.once('done',(_event,state)=>globalThis.__mediaDownload={state,name:item.getFilename()});});},destination);
   await page.locator('[data-attachment-download]').filter({hasText:'说明文件.txt'}).click();
   await assert.doesNotReject(async()=>{for(let i=0;i<100;i++){const result=await app.evaluate(()=>globalThis.__mediaDownload);if(result){assert.equal(result.state,'completed');assert.equal(result.name,'说明文件.txt');return;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('附件下载未完成');});assert.deepEqual(await readFile(destination),fileBytes);
   await page.locator('[data-chat-image-file]').setInputFiles({name:'发送前图片.png',mimeType:'image/png',buffer:imageBytes});await page.locator('[data-chat-attachments] .communication-draft-image img').waitFor();
   await page.locator('[data-chat-file]').setInputFiles({name:'项目参考说明及详细交接资料_带有很长名称的文件.txt',mimeType:'text/plain',buffer:fileBytes});
   await page.locator('#communication-input').fill('请参考图片与附件');
   assert.equal(await page.locator('.message-composer-input [data-chat-attachments] .communication-draft-image img').count(),1);assert.equal(await page.locator('[data-chat-attachments] img').count(),1);assert.equal(await page.locator('[data-chat-attachments] .pending > svg').count(),1);
   assert.equal(await page.locator('[data-chat-attach]').innerText(),'');assert.equal(await page.locator('[data-chat-attach-image]').innerText(),'');
   const inputBounds=await page.locator('.message-composer-input').boundingBox(),imageBounds=await page.locator('[data-chat-attachments] .communication-draft-image img').boundingBox(),fileBounds=await page.locator('[data-chat-attachments] .pending').boundingBox(),textBounds=await page.locator('.message-composer-input textarea').boundingBox();assert.ok(imageBounds.y>=inputBounds.y&&imageBounds.y+imageBounds.height<=inputBounds.y+inputBounds.height);assert.ok(fileBounds.y+fileBounds.height<=textBounds.y);assert.ok(imageBounds.y+imageBounds.height<=textBounds.y);assert.ok(Math.abs(fileBounds.y-imageBounds.y)<2);assert.equal(imageBounds.height,48);assert.equal(fileBounds.height,48);
   const draftImage=page.locator('.communication-draft-image .communication-image');await draftImage.hover();assert.equal(await draftImage.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
   await page.locator('[data-chat-attachments] .communication-draft-image [data-chat-image]').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#communication-input').inputValue(),'请参考图片与附件');assert.equal(await draftImage.evaluate(el=>getComputedStyle(el).outlineOffset),'-2px');assert.equal(await draftImage.evaluate(el=>getComputedStyle(el).outlineColor),await draftImage.evaluate(el=>getComputedStyle(el).getPropertyValue('--muted').trim()).then(color=>page.evaluate(color=>{const el=document.createElement('span');el.style.color=color;document.body.append(el);const value=getComputedStyle(el).color;el.remove();return value;},color)));
   await page.screenshot({path:join(root,`draft-${theme}-${width}.png`)});
   await page.locator('[data-chat-attachments] .communication-draft-image [data-remove-chat-attachment]').click();assert.equal(await page.locator('[data-chat-attachments] .communication-draft-image img').count(),0);assert.equal(await page.locator('[data-chat-attachments] .pending').count(),1);
   await page.locator('[data-chat-attachments] [data-remove-chat-attachment]').click();assert.equal(await page.locator('[data-chat-attachments]').isVisible(),false);assert.equal(await page.locator('#communication-input').inputValue(),'请参考图片与附件');
   await page.screenshot({path:join(root,`chat-${theme}-${width}.png`)});
   await page.goto(origin+'/automations/'+auto.id);await page.locator('.automation-trigger-table').waitFor();
   const table=await page.locator('.automation-table-scroll').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth}));if(width===1200)assert.ok(table.scrollWidth<=table.width+1,JSON.stringify(table));
   assert.ok(await page.locator('[data-auto-run]').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:join(root,`records-${theme}-${width}.png`)});
   await page.locator('[data-auto-tab=config]').click();await page.locator('.automation-config-objective').waitFor();assert.notEqual(await page.locator('.automation-config-objective').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');await page.screenshot({path:join(root,`config-${theme}-${width}.png`)});evidence.cases.push({theme,width,table});
  }
  evidence.status='passed';console.log(JSON.stringify(evidence));
 }
}catch(error){evidence.error=error.message;try {const page=await app.firstWindow();console.log('TOAST',await page.locator('#toast').textContent());await page.screenshot({path:join(root,'failure.png')});}catch{}throw error;}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
