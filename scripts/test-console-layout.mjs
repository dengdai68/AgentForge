// Isolated presentation test. No real employee/provider invocation is started.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {_electron as electron} from 'playwright-core';
import {desktopStoragePaths} from '../apps/electron/runtime-paths.mjs';
import {createAuth} from '../server/auth.mjs';
import {createCatalogFixtureStore as createStore} from '../tests/fixture-store.mjs';
import {createRunFiles} from '../server/run-files.mjs';

await mkdir('.data',{recursive:true});
const root=await mkdtemp(resolve('.data/console-layout-')),bundle=process.env.AGENTFORGE_CONSOLE_LAYOUT_APP;
const storage=desktopStoragePaths(bundle?join(root,'.agentforge','desktop'):root,{home:root}),password=randomBytes(24).toString('hex');
const auth=createAuth({databasePath:storage.AGENTFORGE_AUTH_DB_PATH});await auth.setAdministrator('layout-test',password);auth.close();
const store=createStore({databasePath:storage.AGENTFORGE_DB_PATH,workspaceRoot:storage.AGENTFORGE_WORKSPACE_ROOT});
const task=store.createTask({title:'Console layout verification',objective:'Isolated visual check',memberAgentIds: store.listTeams()[0].memberAgentIds,workflowTemplateId:'software_delivery'}),run=store.createRun(task.id);
const trace=store.createTrace(run.id,{agentId:run.manager.id,workflowNodeId:'development',type:'node'});
store.completeTrace(trace.id,{status:'completed'});store.pauseRun(run.id,'Presentation only; never start Provider');
const markdown=['## 长正文排版','',...Array.from({length:18},(_,i)=>`${i+1}. 正文列表第 ${i+1} 项：编号应完整可见，长段落应由时间线统一滚动。`),'','> 引用内容与正文保持相同的阅读区域。','','```js','const answer = 42;','```','', '| 列 | 值 |','| --- | --- |','| 内容 | 正常显示 |'].join('\n');
const files=createRunFiles({root:storage.AGENTFORGE_RUN_FILES_ROOT});
const contentRef=await files.writeConsoleContent(run.id,trace.id,{version:1,fields:{text:{text:markdown,redacted:false,truncated:false}}});
store.addEvent({type:'runtime.event',runId:run.id,actor:{type:'agent',id:run.manager.id,name:run.manager.name},message:'Markdown layout fixture',data:{auditVersion:2,traceId:trace.id,presentation:'text',providerEventType:'assistant',contentRef}});store.close();
const app=await electron.launch({...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/AgentForge')}:{args:['apps/electron/main.mjs']}),env:{...process.env,HOME:root,AGENTFORGE_DESKTOP_DATA_ROOT:root},timeout:120000});
const evidence={root,cases:[]};console.log('EVIDENCE '+root);
try {
  const page=await app.firstWindow();await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});const origin=new URL(page.url()).origin;
  await page.goto(origin+'/login');await page.locator('#username').fill('layout-test');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
  for(const theme of ['minimal','warm'])for(const width of [1320,760]) {
    await app.evaluate(({BrowserWindow},{width,origin})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith(origin)).setContentSize(width,800),{width,origin});
    await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value=${theme}]`).check();
    await page.goto(origin+'/runs/'+run.id);await page.locator('#console-mode').click();
    await page.locator('.console-markdown ol li').last().waitFor();
    const layout=await page.locator('.console-markdown').evaluate(element=>{
      const css=getComputedStyle(element),list=element.querySelector('ol'),first=list.querySelector('li');
      return {maxHeight:css.maxHeight,overflowY:css.overflowY,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,numberSpace:first.getBoundingClientRect().left-element.getBoundingClientRect().left,indent:parseFloat(getComputedStyle(list).paddingLeft),fontSize:parseFloat(css.fontSize),items:list.children.length};
    });
    assert.equal(layout.maxHeight,'none');assert.equal(layout.overflowY,'visible');assert.ok(layout.clientHeight>=layout.scrollHeight-1);assert.equal(layout.items,18);assert.ok(layout.numberSpace>=2*layout.fontSize);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('.console-markdown h2').scrollIntoViewIfNeeded();await page.screenshot({path:join(root,`${theme}-${width}.png`)});
    evidence.cases.push({theme,width,layout});
  }
  evidence.result='PASS';console.log('PASS console Markdown: wide/narrow, two themes, one vertical scroller and intact list space');
}catch(error){evidence.result='FAIL';evidence.error=error.message;throw error;}
finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
