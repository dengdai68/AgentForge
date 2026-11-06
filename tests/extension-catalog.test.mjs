import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../server/store.mjs';

test('SQLite extension catalog persists summary-only pages, searches before paging, and rolls back soft deletion', t=>{
 const root=mkdtempSync(join(tmpdir(),'af-extension-index-')),databasePath=join(root,'state.sqlite');
 let store=createStore({databasePath,workspaceRoot:join(root,"work")});t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const entries=Array.from({length:105},(_,i)=>({id:randomUUID(),kind:i<65?'plugin':'mcp',name:`条目 ${i}`,description:i%2?'MATCH':'other',createdAt:new Date(1700000000000+i).toISOString(),providers:['claude-code'],content:'PRIVATE_MCP_SECRET',manifest:{private:'PRIVATE_PROMPT'}}));
 store.registerExtensions(entries);
 assert.equal(store.queryExtensions('plugin').items.length,20);assert.equal(store.queryExtensions('plugin').total,65);
 const page=store.queryExtensions('plugin',{search:'match',page:2});assert.equal(page.total,32);assert.equal(page.items.length,12);assert.equal(page.hasMore,false);
 assert.equal(store.queryExtensions('plugin',{search:'%',page:1}).total,0);
 assert.equal(store.queryExtensions('plugin',{page:99}).page,4);
 for(const input of [{page:0},{page:1.1},{search:12},{search:'x'.repeat(201)}])assert.throws(()=>store.queryExtensions('plugin',input));
 const target=entries[0];
 assert.throws(()=>store.transaction(()=>{store.removeExtension(target);throw Error('rollback');}),/rollback/);
 assert.ok(store.getExtension('plugin',target.id));assert.equal(store.queryExtensions('plugin').total,65);
 const receipt=store.removeExtension(target);assert.equal(receipt.historyRetained,true);assert.deepEqual(receipt.employees,[]);
 store.close();store=createStore({databasePath});
 assert.equal(store.queryExtensions('plugin').total,64);assert.equal(store.queryExtensions('mcp').total,40);assert.equal(store.getExtension('plugin',target.id),null);
 const db=new DatabaseSync(databasePath,{readOnly:true});try{
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM extension_catalog').get().count,105);
  assert.ok(db.prepare('SELECT deleted_at FROM extension_catalog WHERE id=?').get(target.id).deleted_at);
  const json=db.prepare('SELECT value_json FROM extension_catalog').all().map(row=>row.value_json).join('');assert.doesNotMatch(json,/PRIVATE_MCP_SECRET|PRIVATE_PROMPT/);
  assert.equal(Object.hasOwn(JSON.parse(db.prepare('SELECT state_json FROM workspace_snapshots').get().state_json),'extensionCatalog'),false);
 }finally{db.close();}
});

test('role extensions merge with direct selections, freeze task/chat snapshots and detach on removal', t=>{
 const root=mkdtempSync(join(tmpdir(),'af-role-bindings-')),databasePath=join(root,'state.sqlite');
 let store=createStore({databasePath,workspaceRoot:join(root,"work")});t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const extension={id:randomUUID(),kind:'mcp',name:'role-service',createdAt:new Date().toISOString(),providers:['claude-code','codex','dsh']};store.registerExtensions([extension]);
 const selection={pluginIds:[],mcpIds:[extension.id]},path=join(root,'mcp.json');
 const binding={extensionSelection:selection,extensionManifest:[{...extension,path,sha256:'a'.repeat(64)}],skillPaths:[],pluginPaths:[],mcpConfigPaths:[path],pluginSources:[]};
 const role=store.createRole({name:'研究',prompt:'ROLE',extensionSelection:selection,extensionBindings:{'claude-code':binding,codex:binding,dsh:binding}});
 const employee=store.createAgent({name:'继承员工',roleIds:[role.id]});
 assert.deepEqual(store.listAgents().find(item=>item.id===employee.id).inheritedExtensionSelection,selection);
 assert.equal(Object.hasOwn(role,'extensionBindings'),false);
 const task=store.createTask({title:'冻结角色',objective:'测试',memberAgentIds:['system_project_manager',employee.id]});
 assert.deepEqual(task.memberSnapshots[0].runtime.extensionSelection,selection);
 const chat=store.openCommunication({kind:"agent",targetId:employee.id});
 store.sendCommunication(chat.id,{content:'hi',clientRequestId:'role-binding-chat'});const delivery=store.claimCommunication(chat.id);
 assert.deepEqual(delivery.agentSnapshot.runtime.extensionSelection,selection);
 store.updateAgent(employee.id,{runtime:{provider:'claude-code',...binding}});
 const direct=store.createTask({title:'重复去重',objective:'测试',memberAgentIds:['system_project_manager',employee.id]});
 assert.equal(direct.memberSnapshots[0].runtime.extensionManifest.length,1);
 store.updateAgent(employee.id,{roleIds:[]});
 assert.deepEqual(store.listAgents().find(item=>item.id===employee.id).runtime.extensionSelection,selection);
 store.updateAgent(employee.id,{roleIds:[role.id]});store.removeExtension(extension);
 assert.deepEqual(store.getRole(role.id).extensionSelection,{pluginIds:[],mcpIds:[]});
 assert.deepEqual(store.listAgents().find(item=>item.id===employee.id).runtime.extensionSelection,{pluginIds:[],mcpIds:[]});
 assert.deepEqual(store.getTask(task.id).memberSnapshots[0].runtime.extensionSelection,selection);
 store.close();store=createStore({databasePath});assert.deepEqual(store.getRole(role.id).extensionSelection,{pluginIds:[],mcpIds:[]});
});
