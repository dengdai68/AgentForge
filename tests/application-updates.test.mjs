import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationUpdates, selectRelease, fetchLatestRelease, downloadReleaseInstaller, RELEASE_ROOT } from '../apps/electron/updates.mjs';
import { isUpdateSender } from '../apps/electron/policy.mjs';
import { createAuth } from '../server/auth.mjs';

const payload = Buffer.from('isolated installer fixture, never executed');
const digest = createHash('sha256').update(payload).digest('hex');
function release(version = '1.2.3', extra = {}) {
  const asset = name => ({name,state:'uploaded',size:payload.length,digest:'sha256:'+digest,browser_download_url:`${RELEASE_ROOT}/download/v${version}/${name}`});
  return {tag_name:'v'+version,draft:false,prerelease:false,assets:[asset(`AgentForge-${version}-arm64.dmg`),asset('latest-mac.yml'),asset('SHA256SUMS.txt')],...extra};
}
const options = extra => ({currentVersion:'1.0.0-beta.109',arch:'arm64',packaged:true,readLatest:async()=>release(),...extra});

test('only stable published versions upgrade, including beta-to-same-stable; no downgrade or foreign assets', () => {
  for (const item of [release('2.0.0-beta.1'),release('2.0.0',{prerelease:true}),release('2.0.0',{draft:true}),release('02.0.0'),release('1.0.0+build.1')]) assert.equal(selectRelease(item,'0.1.0','arm64'),null);
  assert.equal(selectRelease(release('1.0.0'),'1.0.0-beta.109','arm64').version,'1.0.0');
  assert.equal(selectRelease(release('1.0.0'),'1.0.0','arm64'),null);
  assert.equal(selectRelease(release('1.0.0'),'2.0.0-beta.1','arm64'),null);
  const malicious = release(); malicious.assets[0].browser_download_url='https://example.com/AgentForge-1.2.3-arm64.dmg';
  assert.equal(selectRelease(malicious,'1.0.0','arm64').installer,null);
  assert.equal(selectRelease(release(),'1.0.0','x64').installer,null);
});

test('GitHub no-stable 404 differs from offline/rate-limit failure', async () => {
  assert.equal(await fetchLatestRelease(async()=>new Response('',{status:404})),null);
  await assert.rejects(fetchLatestRelease(async()=>new Response('',{status:403})),/GitHub/);
  await assert.rejects(fetchLatestRelease(async()=>new Response('x'.repeat(1024*1024+1))),/大小/);
});

test('checking never downloads; no stable, failure and explicit retry report truthfully',async()=>{
  let reads=0,downloads=0;
  const service=createApplicationUpdates(options({readLatest:async()=>{reads++; if(reads===1)throw new Error('offline');return null;},downloadInstaller:async()=>{downloads++;}}));
  assert.equal((await service.check()).phase,'error');
  assert.equal((await service.check()).phase,'current');
  assert.equal(reads,2);assert.equal(downloads,0);service.stop();
});

test('manual download is explicit, coalesced, progress is public and opening never restarts',async()=>{
  let downloads=0,opened,prepared=0,finish;
  const gate=new Promise(resolve=>{finish=resolve;});
  const service=createApplicationUpdates(options({cacheRoot:'/unused',downloadInstaller:async(_release,_root,progress)=>{downloads++;progress({percent:25});await gate;return '/private/fixture.dmg';},openInstaller:async path=>{opened=path;return '';},prepareRestart:async()=>{prepared++;}}));
  const states=[];service.subscribe(s=>states.push(s));
  await service.check();assert.equal(downloads,0);
  const first=service.download(),second=service.download();await Promise.resolve();assert.equal(service.snapshot().percent,25);
  finish();await Promise.all([first,second]);assert.equal(downloads,1);assert.equal(service.snapshot().phase,'downloaded');
  await service.install();assert.equal(opened,'/private/fixture.dmg');assert.equal(prepared,0);
  assert.ok(states.every(s=>!('installerPath' in s) && !('feedUrl' in s)));service.stop();
});

test('native installation waits for idle lease and retains downloaded update on busy rejection',async()=>{
  let install=0,releaseLease=0,busy=true;
  const service=createApplicationUpdates(options({nativeInstall:true,createNativeUpdater:()=>({download:async version=>assert.equal(version,'1.2.3'),install(){install++;}}),prepareRestart:async()=>{if(busy)throw new Error('仍有任务执行');},releaseRestart(){releaseLease++;}}));
  await service.check();await service.download();await service.install();assert.equal(install,0);assert.equal(releaseLease,1);
  assert.equal(service.snapshot().phase,'downloaded');assert.match(service.snapshot().message,/任务/);
  busy=false;await service.install();assert.equal(install,1);assert.equal(service.snapshot().canInstall,false);
  await assert.rejects(service.install(),/下载完成/);assert.equal(install,1,'duplicate install cannot release the pending restart lease');service.stop();
});

test('native setup or manual checksum failures permit download retry, never claim readiness',async()=>{
  let tries=0;
  const service=createApplicationUpdates(options({nativeInstall:true,createNativeUpdater(){tries++;throw new Error('manifest mismatch');}}));
  await service.check();await service.download();assert.equal(service.snapshot().phase,'error');assert.equal(service.snapshot().canInstall,false);
  await service.download();assert.equal(tries,2);service.stop();
});

test('real streamed download verifies checksum/size, publishes only a complete file and removes failed parts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'af-app-update-'));
  try{
    const selected=selectRelease(release(),'1.0.0','arm64');
    const path=await downloadReleaseInstaller(selected,root,()=>{}, {fetcher:async()=>new Response(payload)});
    assert.deepEqual(await readFile(path),payload);
    assert.deepEqual(await readdir(root),['AgentForge-1.2.3-arm64.dmg']);
    await assert.rejects(downloadReleaseInstaller(selected,root,()=>{},{fetcher:async()=>new Response(Buffer.alloc(payload.length))}),/校验/);
    assert.deepEqual(await readdir(root),['AgentForge-1.2.3-arm64.dmg']);
    assert.deepEqual(await readFile(path),payload,'failed replacement preserves complete download');
    selected.installer.digest=null;
    const fromChecksum=await downloadReleaseInstaller(selected,root,()=>{},{fetcher:async url=>new Response(url.endsWith('SHA256SUMS.txt')?`${digest}  ${selected.installer.name}\n`:payload)});
    assert.equal(fromChecksum,path);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cancelled stream cannot become a downloaded installer',async()=>{
  const root=await mkdtemp(join(tmpdir(),'af-update-abort-')),abort=new AbortController();abort.abort();
  try{await assert.rejects(downloadReleaseInstaller(selectRelease(release(),'1.0.0','arm64'),root,()=>{},{signal:abort.signal,fetcher:async(_url,{signal})=>{signal.throwIfAborted();}}));assert.deepEqual(await readdir(root),[]);}
  finally{await rm(root,{recursive:true,force:true});}
});

test('automatic checks never overlap, do not download, and stop with their host',async()=>{
  let reads=0,finish;const pending=new Promise(resolve=>{finish=resolve;});
  const service=createApplicationUpdates(options({startupMs:5,intervalMs:10,readLatest:async()=>{reads++;await pending;return null;}}));
  service.start();await new Promise(r=>setTimeout(r,30));assert.equal(reads,1);
  service.stop();finish();await new Promise(r=>setTimeout(r,30));assert.equal(reads,1);
});

test('update mutations accept only the owned settings main frame',()=>{
  const origin='http://127.0.0.1:59001',mainFrame={url:origin+'/settings/updates'},contents={mainFrame};
  assert.equal(isUpdateSender({sender:contents,senderFrame:mainFrame},contents,origin),true);
  assert.equal(isUpdateSender({sender:contents,senderFrame:{...mainFrame}},contents,origin),false);
  for(const url of [origin+'/settings/general','https://evil.test/settings/updates',origin+'/settings/updates/extra']){mainFrame.url=url;assert.equal(isUpdateSender({sender:contents,senderFrame:mainFrame},contents,origin),false);}
});

test('owned service restart lease atomically blocks writes, rejects busy writes and releases on matching ID',async()=>{
  const root=await mkdtemp(join(tmpdir(),'af-update-lease-')),password=randomBytes(16).toString('hex');
  const auth=createAuth({databasePath:join(root,'auth.sqlite')});await auth.setAdministrator('updates-qa',password);auth.close();
  const child=fork(new URL('../server/index.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,HOME:root,AGENTFORGE_DESKTOP_PORT:'0',AGENTFORGE_BOOTSTRAP_TOKEN:randomBytes(32).toString('hex'),AGENTFORGE_DB_PATH:join(root,'state.sqlite'),AGENTFORGE_AUTH_DB_PATH:join(root,'auth.sqlite'),AGENTFORGE_RUN_FILES_ROOT:join(root,'runs'),AGENTFORGE_RUNTIME_CONFIG_ROOT:join(root,'runtime'),AGENTFORGE_WORKSPACE_ROOT:join(root,'work'),AGENTFORGE_LOG_DIR:join(root,'logs')}});
  const receive=predicate=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',listener);reject(Error('IPC timeout'));},20000);const listener=value=>{if(predicate(value)){clearTimeout(timer);child.off('message',listener);resolve(value);}};child.on('message',listener);});
  let held;
  try{
    const ready=await receive(m=>m.type==='agentforge-ready'),origin='http://127.0.0.1:'+ready.port;
    const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'updates-qa',password})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0],headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json'};
    const prepare=async()=>{const id=randomUUID(),pending=receive(m=>m.type==='agentforge-update-readiness' && m.id===id);child.send({type:'agentforge-update-prepare',id});return {...await pending,id};};
    const release=async id=>{const pending=receive(m=>m.type==='agentforge-update-released' && m.id===id);child.send({type:'agentforge-update-release',id});await pending;};
    const lease=await prepare();assert.equal(lease.ready,true);
    assert.equal((await fetch(origin+'/api/tasks',{method:'POST',headers,body:'{}'})).status,503);
    assert.equal((await fetch(origin+'/api/health')).status,200);
    child.send({type:'agentforge-update-release',id:randomUUID()});assert.equal((await prepare()).ready,false);
    await release(lease.id);assert.equal((await fetch(origin+'/api/tasks',{method:'POST',headers,body:'{}'})).status,400);
    held=httpRequest(origin+'/api/tasks',{method:'POST',headers:{...headers,'Content-Length':'10000'}});held.on('error',()=>{});held.write('{"title":');
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal((await prepare()).ready,false,'in-flight HTTP write blocks native restart');
    held.destroy();held=null;
  }finally{held?.destroy();const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;await rm(root,{recursive:true,force:true});}
});
