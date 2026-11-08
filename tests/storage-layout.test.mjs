import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm,symlink,readlink,cp,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {storageBusinessRoot,storageLocation,readStorageLocation,writeStorageLocation,runtimeStorageReferences,runtimeStoragePath,validateStorageDestination} from '../server/storage-layout.mjs';
import {desktopStoragePaths,defaultDesktopLocation} from '../apps/electron/runtime-paths.mjs';
import {relocateStorage} from '../apps/electron/storage-relocation.mjs';
import {readExtensionFile} from '../server/runtime/marketplace.mjs';

async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'af-storage-layout-')));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'control'),target=join(root,'work');await mkdir(source,{mode:0o700});return{root,source,target};}
test('one current locator protocol rejects invalid roots and unsafe files',async t=>{
 const{source,target}=await fixture(t);const value={version:1,workspaceRoot:target,previousRuntimeRoots:[]};
 assert.deepEqual(await readStorageLocation(source,value),value);await writeStorageLocation(source,value);assert.deepEqual(await readStorageLocation(source,{}),value);assert.deepEqual(JSON.parse(await readFile(join(source,'storage.json'),'utf8')),value);assert.equal(storageBusinessRoot(target,'desktop-dev'),join(target,'records'));
 for(const invalid of [{...value,version:2},{...value,workspaceRoot:'/'},{...value,workspaceRoot:'relative'},{...value,previousRuntimeRoots:['/arbitrary']},{...value,unknown:true},{...value,businessRoot:join(target,'other')}])assert.throws(()=>storageLocation(invalid));
 const obsolete=JSON.stringify({...value,businessRoot:join(target,'wrong-records')});await writeFile(join(source,'storage.json'),obsolete,{mode:0o600});await assert.rejects(readStorageLocation(source,value),/businessRoot/);assert.equal(await readFile(join(source,'storage.json'),'utf8'),obsolete);
 await rm(join(source,'storage.json'));await symlink(join(source,'missing'),join(source,'storage.json'));await assert.rejects(readStorageLocation(source,value),/私有常规文件/);
});
test('address relocation changes owned runtime references only, preserving frozen input and prefix boundaries',()=>{
 const options={currentRoot:'/new/runtime-configs',previousRoots:['/old/runtime-configs']},old='/old/runtime-configs/plugin/x';
 const runtime={skillPaths:[old],pluginPaths:[old],mcpConfigPaths:[old],extensionManifest:[{path:old,sourceRoot:old,source:{url:old},sha256:'same'}],systemPrompt:old};const before=structuredClone(runtime),mapped=runtimeStorageReferences(runtime,options);
 assert.deepEqual(runtime,before);assert.equal(mapped.skillPaths[0],'/new/runtime-configs/plugin/x');assert.equal(mapped.extensionManifest[0].sha256,'same');assert.equal(mapped.extensionManifest[0].source.url,old);assert.equal(mapped.systemPrompt,old);
 assert.equal(runtimeStoragePath('/old/runtime-configs-foreign/file',options),'/old/runtime-configs-foreign/file');assert.equal(runtimeStoragePath('/old/elsewhere',options),'/old/elsewhere');
});
test('verified business relocation preserves bytes and symlinks while leaving configuration in place',async t=>{
 const{root,source,target}=await fixture(t);const runtime=join(source,'runtime-configs');await mkdir(join(runtime,'marketplace/mcp'),{recursive:true});await mkdir(join(source,'runs/run_one/traces/trace_one'),{recursive:true});
 const content='{"mcpServers":{}}',ref={path:join(runtime,'marketplace/mcp/mcp.json'),sha256:createHash('sha256').update(content).digest('hex'),kind:'mcp'};
 await writeFile(ref.path,content);await mkdir(join(source,'updates'));await writeFile(join(source,'updates/verified.dmg'),'verified cached installer');
 await mkdir(join(source,'.deleting/op_one'),{recursive:true});await writeFile(join(source,'.deleting/op_one/manifest.json'),'pending-delete-proof');
 await writeFile(join(source,'agentforge.sqlite'),'opaque database bytes');await writeFile(join(source,'auth.sqlite'),'unchanged authentication');await writeFile(join(runtime,'git-credentials.json'),'private authentication');await writeFile(join(source,'runs/run_one/traces/trace_one/prompt-snapshot.json'),'immutable original '+ref.path);
 const foreign=join(root,'foreign');await writeFile(foreign,'external credential untouched');await symlink(foreign,join(source,'runs/link'));
 const moved=await relocateStorage({sourceRoot:source,controlRoot:source,workspaceRoot:target});
 assert.equal(await readFile(join(source,'agentforge.sqlite'),'utf8'),'opaque database bytes','source retained until healthy');assert.equal(await readFile(join(storageBusinessRoot(moved.location.workspaceRoot),'.deleting/op_one/manifest.json'),'utf8'),'pending-delete-proof');
 assert.equal(await readFile(join(storageBusinessRoot(moved.location.workspaceRoot),'runs/run_one/traces/trace_one/prompt-snapshot.json'),'utf8'),'immutable original '+ref.path);
 assert.equal(await readlink(join(storageBusinessRoot(moved.location.workspaceRoot),'runs/link')),foreign);assert.equal(await readFile(foreign,'utf8'),'external credential untouched');
 assert.equal(await readFile(join(runtime,'git-credentials.json'),'utf8'),'private authentication');await assert.rejects(lstat(join(storageBusinessRoot(moved.location.workspaceRoot),'runtime-configs/git-credentials.json')),{code:'ENOENT'});
 const oldEnv={root:process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT,previous:process.env.AGENTFORGE_RUNTIME_PREVIOUS_ROOTS};process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT=runtime;process.env.AGENTFORGE_RUNTIME_PREVIOUS_ROOTS=JSON.stringify(moved.location.previousRuntimeRoots);
 try{assert.equal(await readExtensionFile(ref),content);}finally{for(const[key,value]of [['AGENTFORGE_RUNTIME_CONFIG_ROOT',oldEnv.root],['AGENTFORGE_RUNTIME_PREVIOUS_ROOTS',oldEnv.previous]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
 assert.equal(await readFile(join(source,'updates/verified.dmg'),'utf8'),'verified cached installer');
 await moved.cleanup();await assert.rejects(lstat(join(source,'agentforge.sqlite')),{code:'ENOENT'});assert.equal(await readFile(join(source,'auth.sqlite'),'utf8'),'unchanged authentication');assert.equal(await readFile(foreign,'utf8'),'external credential untouched');
});
test('copy failure never switches locator or removes source, and source changes block cleanup',async t=>{
 const{source,target}=await fixture(t);await writeFile(join(source,'agentforge.sqlite'),'original');
 await assert.rejects(relocateStorage({sourceRoot:source,controlRoot:source,workspaceRoot:target,copy:async()=>{throw Object.assign(new Error('target disk full'),{code:'ENOSPC'});}}),{code:'ENOSPC'});
 assert.equal(await readFile(join(source,'agentforge.sqlite'),'utf8'),'original');await assert.rejects(lstat(join(source,'storage.json')),{code:'ENOENT'});await assert.rejects(lstat(storageBusinessRoot(target)),{code:'ENOENT'});
 const moved=await relocateStorage({sourceRoot:source,controlRoot:source,workspaceRoot:target});await writeFile(join(source,'agentforge.sqlite'),'external modification');await assert.rejects(moved.cleanup(),/已被修改/);assert.equal(await readFile(join(source,'agentforge.sqlite'),'utf8'),'external modification');
});
test('occupied, nested, and linked targets refuse without overwriting another instance',async t=>{
 const{root,source,target}=await fixture(t);await mkdir(storageBusinessRoot(target),{recursive:true});await writeFile(join(storageBusinessRoot(target),'owner'),'other instance');
 await assert.rejects(validateStorageDestination({sourceRoot:source,workspaceRoot:target}),/已有实例/);assert.equal(await readFile(join(storageBusinessRoot(target),'owner'),'utf8'),'other instance');
 await assert.rejects(validateStorageDestination({sourceRoot:source,workspaceRoot:join(source,'nested')}),/相互嵌套/);
 const linked=join(root,'linked');await mkdir(linked);await symlink(source,join(linked,'records'));await assert.rejects(validateStorageDestination({sourceRoot:source,workspaceRoot:linked}),/真实文件夹/);
});


test('host paths derive records solely from workspaceRoot in production and development',()=>{
 for(const instance of ['desktop','desktop-dev']){
  const p=desktopStoragePaths('/config/namespace',{workspaceRoot:'/work',instance});
  assert.equal(p.dataRoot,'/work/records');assert.equal(p.AGENTFORGE_DB_PATH,'/work/records/agentforge.sqlite');assert.equal(p.AGENTFORGE_RUN_FILES_ROOT,'/work/records');assert.equal(p.AGENTFORGE_AUTH_DB_PATH,'/config/namespace/auth.sqlite');
 }
 for(const packaged of [true,false]){
  const location=defaultDesktopLocation({home:'/fixture',packaged,controlRoot:'/override',env:{AGENTFORGE_DESKTOP_DATA_ROOT:'/override'}});
  assert.equal(Object.hasOwn(location,'businessRoot'),false);assert.equal(location.workspaceRoot,packaged?'/fixture/.agentforge/workspace':'/fixture/.agentforge/workspace-dev');
 }
});
