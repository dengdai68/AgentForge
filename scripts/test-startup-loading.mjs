import assert from 'node:assert/strict';
import {mkdtemp,mkdir,access,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {testEnvironment} from './run-tests.mjs';
import {_electron as electron} from 'playwright-core';
import {randomBytes} from 'node:crypto';
// Packaged acceptance only; all business/auth/browser data is disposable.
if(!process.env.AGENTFORGE_PACKAGED_APP)throw Error('Set AGENTFORGE_PACKAGED_APP to the built application bundle');
const bundle=resolve(process.env.AGENTFORGE_PACKAGED_APP);
const root=await mkdtemp(join(tmpdir(),'agentforge-startup-ui-')),home=join(root,'home');await mkdir(home);
const app=await electron.launch({executablePath:bundle+'/Contents/MacOS/AgentForge',args:['--user-data-dir='+join(root,'browser')],env:testEnvironment({...process.env,HOME:home,AGENTFORGE_LOG_DIR:join(root,'logs')}),timeout:120000});
const evidence={root};
try {
 const page=await app.firstWindow();page.setDefaultTimeout(30000);
 await page.waitForURL(/http:\/\/127.0.0.1:.*\/setup/,{timeout:90000});
 await assert.rejects(access(join(home,'.agentforge/workspace/records/agentforge.sqlite')),{code:'ENOENT'});
 const origin=new URL(page.url()).origin;
 const password=randomBytes(24).toString('hex');
 const response=await page.evaluate(async password=>{const r=await fetch('/api/auth/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'startup-ui',password})});return {status:r.status,body:await r.json()};},password);assert.equal(response.status,201);
 const requests=[];page.on('request',request=>{const u=new URL(request.url());if(u.pathname.startsWith('/api/'))requests.push(u.pathname+u.search)});
 await page.goto(origin+'/settings/general');await page.locator('#account-name').waitFor();
 await page.waitForFunction(()=>document.querySelector('#breadcrumb-current')?.textContent==='设置');
 await page.evaluate(()=>localStorage.setItem('agentforge.installation','retained-marker'));
 for(const path of ['/marketplace','/mcp-marketplace']){await page.goto(origin+path);await page.locator('[data-market-empty]:visible').waitFor();}
 assert.equal(await page.evaluate(()=>localStorage.getItem('agentforge.installation')),'retained-marker');
 assert.ok(requests.includes('/api/bootstrap?view=connection'));
 assert.equal(requests.some(path=>path.includes('view=shell')),false);
 assert.ok(requests.some(path=>path.startsWith('/api/runtime/marketplace?')));assert.ok(requests.some(path=>path.startsWith('/api/runtime/mcp-marketplace?')));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(760,760));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 evidence.configurationRequests=requests.slice();
 await page.goto(origin+'/tasks');await page.locator('#task-search-form').waitFor();
 assert.ok(requests.includes('/api/bootstrap?view=shell'));
 const status=await page.evaluate(async()=>{const r=await fetch('/api/bootstrap?view=connection');return r.json()});assert.equal(status.businessReady,true);
 await access(join(home,'.agentforge/workspace/records/agentforge.sqlite'));
 evidence.status='passed';console.log(JSON.stringify(evidence));
} catch(error){evidence.status='failed';evidence.error=error.message;throw error;}
finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
