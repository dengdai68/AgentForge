import test from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync,renameSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createConfigurationStore} from '../server/configuration-store.mjs';
import {createStore} from '../server/store.mjs';
const setup=t=>{const root=mkdtempSync(join(tmpdir(),'af-json-configuration-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,directory:join(root,'private'),databasePath:join(root,'work/state.sqlite')};};
test('uncommitted candidates are discarded and committed candidates recover without another write',t=>{
 const options=setup(t),first=createConfigurationStore(options);const revision=first.stage({settings:{pluginAutoUpdate:false}});
 assert.equal(existsSync(join(options.directory,'configuration.json')),false);
 assert.deepEqual(createConfigurationStore(options).values(),{});
 const next=createConfigurationStore(options),committed=next.stage({extensionCatalog:[{id:'kept'}]});
 assert.throws(()=>createConfigurationStore({...options,databasePath:join(options.root,'another.sqlite'),committedRevision:committed}),/另一个工作区/);
 assert.deepEqual(createConfigurationStore({...options,committedRevision:committed}).values(),{extensionCatalog:[{id:'kept'}]});
 assert.equal(existsSync(join(options.directory,'configuration.pending.json')),false);assert.ok(revision);
});
test('post-commit publish failure preserves business bindings, fences writes, and recovers on restart',t=>{
 const options=setup(t);let fail=false;
 let store=createStore({...options,configurationDirectory:options.directory,configurationPublish:(from,to)=>{if(fail)throw Object.assign(new Error('disk unavailable'),{code:'EIO'});renameSync(from,to);}});
 const item={id:randomUUID(),kind:'mcp',name:'Private service',createdAt:new Date().toISOString(),providers:['claude-code']};store.registerExtensions([item]);
 fail=true;
 assert.throws(()=>store.removeExtension(item),error=>error.committed===true);
 assert.equal(store.getExtension('mcp',item.id),null);
 assert.throws(()=>store.createRole({name:'Must not commit',prompt:'fixture'}),/配置发布尚未完成/);
 store.close();store=createStore({...options,configurationDirectory:options.directory});t.after(()=>store.close());
 assert.equal(store.getExtension('mcp',item.id),null);assert.equal(store.listRoles().some(role=>role.name==='Must not commit'),false);
 const db=new DatabaseSync(options.databasePath,{readOnly:true});try{const state=JSON.parse(db.prepare('SELECT state_json FROM workspace_snapshots').get().state_json);assert.deepEqual(Object.keys(state.settings),['installationId']);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='extension_catalog'").get(),undefined);}finally{db.close();}
});
test('clearing business data retains global Runtime and extension settings in JSON',t=>{
 const options=setup(t);let store=createStore({...options,configurationDirectory:options.directory});
 store.saveRuntimeProfile({model:'gpt-5.1-codex',effort:'high'},'runtime_codex');
 store.registerExtensions([{id:randomUUID(),kind:'plugin',name:'Retained plugin',createdAt:new Date().toISOString(),providers:['codex']}]);
 store.createRole({name:'Business role',prompt:'fixture'});store.close();rmSync(join(options.root,'work'),{recursive:true,force:true});
 store=createStore({...options,configurationDirectory:options.directory});t.after(()=>store.close());
 assert.equal(store.listRuntimeProfiles().find(p=>p.provider==='codex').model,'gpt-5.1-codex');assert.equal(store.queryExtensions('plugin').total,1);assert.equal(store.listRoles().length,0);
});
test('configuration files cannot be replaced by symlinks',t=>{const options=setup(t),config=createConfigurationStore(options);config.stage({});config.commit();rmSync(join(options.directory,'configuration.json'));symlinkSync('/etc/passwd',join(options.directory,'configuration.json'));assert.throws(()=>createConfigurationStore(options),/私有常规文件/);});
test('SQL failure discards staged JSON and keeps the previous catalog and binding transaction',t=>{
 const options=setup(t),store=createStore({...options,configurationDirectory:options.directory});t.after(()=>store.close());
 const item={id:randomUUID(),kind:'mcp',name:'Keep on rollback',createdAt:new Date().toISOString(),providers:['codex']};store.registerExtensions([item]);
 const before=readFileSync(join(options.directory,'configuration.json'),'utf8'),db=new DatabaseSync(options.databasePath);try{
  db.exec("CREATE TRIGGER reject_config BEFORE UPDATE ON workspace_snapshots BEGIN SELECT RAISE(ABORT,'fixture SQL failure'); END");
  assert.throws(()=>store.removeExtension(item),/fixture SQL failure/);
  assert.equal(readFileSync(join(options.directory,'configuration.json'),'utf8'),before);assert.equal(existsSync(join(options.directory,'configuration.pending.json')),false);assert.ok(store.getExtension('mcp',item.id));
 }finally{db.close();}
});
test('a pre-commit configuration write failure cannot leak its candidate into a later business-only save',t=>{
 const options=setup(t),store=createStore({...options,configurationDirectory:options.directory});t.after(()=>store.close());
 const item={id:randomUUID(),kind:'mcp',name:'Unchanged after unavailable disk',createdAt:new Date().toISOString(),providers:['codex']};store.registerExtensions([item]);
 renameSync(options.directory,options.directory+'.away');try{assert.throws(()=>store.removeExtension(item),{code:'ENOENT'});}finally{renameSync(options.directory+'.away',options.directory);}
 assert.ok(store.getExtension('mcp',item.id));store.createRole({name:'Next business operation',prompt:'fixture'});
 const values=JSON.parse(readFileSync(join(options.directory,'configuration.json'),'utf8')).values;assert.equal(values.extensionCatalog.find(entry=>entry.id===item.id).deletedAt,null);assert.equal(existsSync(join(options.directory,'configuration.pending.json')),false);
});
