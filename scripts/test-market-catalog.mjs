// Isolated full HTTP/CLI/renderer catalog acceptance. No Provider or operator data.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir,mkdtemp,writeFile,readFile,rename } from 'node:fs/promises';
import { resolve,join,dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
import { DatabaseSync } from 'node:sqlite';
await mkdir('.data',{recursive:true});
const root=await mkdtemp(resolve('.data/market-catalog-')),home=join(root,'home'),data=join(root,'client'),source=join(root,'source');await mkdir(home,{recursive:true});await mkdir(join(source,'.claude-plugin'),{recursive:true});
const plugins=[];for(let i=0;i<45;i++){
 const name='catalog-'+String(i).padStart(2,'0'),folder=join(source,name);plugins.push({name,source:'./'+name});await mkdir(join(folder,'.claude-plugin'),{recursive:true});
 await writeFile(join(folder,'.claude-plugin/plugin.json'),JSON.stringify({name,description:'数据库目录验收 '+name,mcpServers:{probe:{command:'node',args:['--version']}}}));
 for(let j=0;j<10;j++){const path=join(folder,'skills','skill-'+j);await mkdir(path,{recursive:true});await writeFile(join(path,'SKILL.md'),'---\nname: skill-'+j+'\ndescription: isolated catalog fixture\n---\nOnly used for catalog acceptance.');}
}
await writeFile(join(source,'.claude-plugin/marketplace.json'),JSON.stringify({name:'catalog-benchmark',plugins}));
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('catalog-qa',password);auth.close();
const store=createStore({databasePath:join(data,'agentforge.sqlite'),workspaceRoot:join(root,'work')});const manager=store.createAgent({name:'目录验收经理',kind:'manager'});store.setPluginUpdateSettings({enabled:false});store.close();
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});const evidence={root};console.log('EVIDENCE '+root);
try{
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});const origin=new URL(page.url()).origin;
 await page.goto(origin+'/login');await page.locator('#username').fill('catalog-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 const api=(path,body,method=body===undefined?'GET':'POST',status=200)=>page.evaluate(async({path,body,method,status})=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(r.status!==status)throw Error(`${r.status} expected ${status}: ${JSON.stringify(v)}`);return v;},{path,body,method,status});
 assert.equal((await fetch(origin+'/api/runtime/marketplace')).status,401);
 const imported=await api('/api/runtime/marketplace',{path:source},'POST',201);assert.equal(imported.plugins.length,45);assert.equal(imported.mcps.length,45);
 const plugin=imported.plugins.find(p=>p.name==='catalog-00'),mcp=imported.mcps.find(m=>m.name.startsWith('catalog-00'));
 const profile=(await api('/api/settings/runtime-profiles')).profiles.find(p=>p.provider==='claude-code');
 const employees=[];for(const status of ['active','inactive'])employees.push((await api('/api/agents',{name:'绑定目录 '+status,status,runtime:{profileId:profile.id,extensionSelection:{pluginIds:[plugin.id],mcpIds:[mcp.id]}}},'POST',201)).agent);
 const task=(await api('/api/tasks',{title:'冻结目录',objective:'仅保存冻结引用',memberAgentIds:[manager.id,employees[0].id]},'POST',201)).task;
 const times=[];for(let i=0;i<4;i++){const start=Date.now(),result=await api('/api/runtime/marketplace');times.push(Date.now()-start);assert.equal(result.plugins.length,20);assert.equal(result.total,45);assert.equal(result.totalPages,3);}
 evidence.httpListMs=times;
 for(const path of ['/api/runtime/marketplace','/api/runtime/mcp-marketplace']){const result=await api(path+'?page=3');assert.equal((result.plugins||result.entries).length,5);await api(path+'?page=0',undefined,'GET',400);await api(path+'?unknown=1',undefined,'GET',400);}
 // A list page must not touch plugin content. Detail must still validate/read it.
 const pluginRoot=dirname(dirname(employees[0].runtime.extensionManifest.find(ref=>ref.kind==='plugin').path)),held=pluginRoot+'.held';await rename(pluginRoot,held);
 try{assert.equal((await api('/api/runtime/marketplace')).total,45);await api('/api/runtime/marketplace/'+plugin.id,undefined,'GET',400);}finally{await rename(held,pluginRoot);}
 for(const [theme,width] of [['minimal',1280],['warm',760]]){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value=${theme}]`).check();
  for(const route of ['marketplace','mcp-marketplace']){
   await page.goto(origin+'/'+route);const catalog=page.locator('#'+route+'-root');await catalog.locator('.installed-extension-card').first().waitFor();assert.equal(await catalog.locator('.installed-extension-card').count(),20);
   await catalog.getByRole('button',{name:'下一页',exact:true}).click();await catalog.locator('[data-market-pager]').filter({hasText:'第 2/3 页'}).waitFor();
   await catalog.locator('.directory-toolbar input').fill('catalog-00');await page.waitForFunction(route=>document.querySelectorAll('#'+route+'-root .installed-extension-card').length===1,route);
   assert.equal(await catalog.locator('[data-market-pager] button').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({animations:'disabled',path:join(root,`${route}-${theme}.png`)});
  }
 }
 const cli=async(args,value)=>{const result=await new Promise((done,reject)=>{const child=spawn(process.execPath,[resolve('cli/main.mjs'),...args,'--endpoint-file',join(data,'desktop-endpoint.json'),'--session-file',join(root,'session.json'),'--json'],{stdio:['pipe','pipe','pipe']});let stdout='';child.stdout.on('data',chunk=>stdout+=chunk);child.once('error',reject);child.once('close',code=>done({code,stdout}));child.stdin.end(value||'');});assert.equal(result.code,0,result.stdout);return JSON.parse(result.stdout).data;};
 await cli(['auth','login','--username','catalog-qa','--password-stdin'],password+'\n');assert.equal((await cli(['plugins','list','--all'])).items.length,45);assert.equal((await cli(['mcps','list','--page','3'])).items.length,5);assert.equal((await cli(['plugins','list','--search','CATALOG-00'])).total,1);
 await page.goto(origin+'/marketplace');await page.locator('#marketplace-root .directory-toolbar input').fill('catalog-00');await page.locator(`[data-extension-detail="${plugin.id}"]`).first().click();await page.locator('[data-plugin-tab]').first().waitFor();await page.locator('[data-delete-extension]').click();await page.getByRole('button',{name:'删除插件',exact:true}).click();await page.waitForFunction(async()=> (await(await fetch('/api/runtime/marketplace')).json()).total===44);
 let current=(await api('/api/agents')).agents;for(const employee of employees){const r=current.find(e=>e.id===employee.id).runtime;assert.deepEqual(r.extensionSelection,{pluginIds:[],mcpIds:[mcp.id]});assert.equal(r.pluginPaths.length,0);assert.equal(r.skillPaths.length,0);}
 const removed=await cli(['mcps','delete',mcp.id,'--yes']);assert.equal(removed.employees.length,2);assert.equal(removed.historyRetained,true);
 current=(await api('/api/agents')).agents;for(const employee of employees){const r=current.find(e=>e.id===employee.id).runtime;assert.deepEqual(r.extensionSelection,{pluginIds:[],mcpIds:[]});assert.equal(r.extensionManifest.length,0);assert.equal(r.mcpConfigPaths.length,0);}
 await api('/api/runtime/marketplace/'+plugin.id,undefined,'GET',404);await api('/api/runtime/mcp-marketplace/'+mcp.id,undefined,'GET',404);
 await api('/api/agents/'+employees[0].id,{runtime:{profileId:profile.id,extensionSelection:{pluginIds:[plugin.id],mcpIds:[]}}},'PUT',400);
 const frozen=(await api('/api/tasks')).tasks.find(item=>item.id===task.id);assert.deepEqual(frozen.memberSnapshots,task.memberSnapshots);
 for(const ref of employees[0].runtime.extensionManifest)assert.ok((await readFile(ref.path)).length);
 const db=new DatabaseSync(join(data,'agentforge.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS count FROM extension_catalog').get().count,90);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM extension_catalog WHERE deleted_at IS NOT NULL').get().count,2);}finally{db.close();}
 evidence.status='passed';evidence.counts={plugins:45,mcps:45,affectedEmployees:2};console.log(JSON.stringify(evidence));
}catch(error){evidence.error=error.message;throw error;}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
