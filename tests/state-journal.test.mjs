import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStateJournal, copyState } from '../server/state-journal.mjs';
import { createSqlitePersistence } from '../server/persistence.mjs';

test('entity journal rolls back nested edits, truncation, unshift and collection replacement without breaking held references', () => {
  const journal = createStateJournal({rows:[{id:'a',nested:{value:1}},{id:'b',nested:{value:2}}],settings:{enabled:true}});
  const {state}=journal, held=state.rows[0];
  const before=copyState(state);
  assert.equal(journal.get('rows','a'),held);
  journal.begin(); held.nested.value=3; state.rows.unshift({id:'c'});
  assert.equal(journal.get('rows','c').id,'c');
  assert.equal(journal.select('rows','id','a')[0].nested.value,3);
  state.rows.length=1; state.settings.enabled=false; state.rows=state.rows.filter(row=>row.id!=='c');
  journal.rollback(); assert.deepEqual(copyState(state),before); assert.equal(held.nested.value,1);
  assert.equal(journal.get('rows','b').nested.value,2);
});

test('incremental saves write only changed entities, keep transaction rollback, and reopen complete history', () => {
  const root=mkdtempSync(join(tmpdir(),'af-entity-journal-')), path=join(root,'state.sqlite');
  let persistence=createSqlitePersistence(path), db;
  try {
    const journal=createStateJournal({tasks:[{id:'t',title:'Original'}],events:Array.from({length:1000},(_,i)=>({id:`e${i}`,message:'history'}))});
    persistence.save(journal.state); journal.commit();
    db=new DatabaseSync(path); db.exec("CREATE TABLE writes(kind TEXT); CREATE TRIGGER touched AFTER UPDATE ON workspace_entities BEGIN INSERT INTO writes VALUES('entity'); END;");
    journal.begin(); journal.state.events.push({id:'new',message:'one event'}); persistence.save(journal.state,journal); journal.commit();
    assert.equal(db.prepare('SELECT count(*) n FROM writes').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM workspace_event_rows').get().n,1001);
    db.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON workspace_snapshots BEGIN SELECT RAISE(ABORT,'failure'); END;");
    journal.begin(); journal.state.tasks[0].title='must rollback'; journal.state.events.push({id:'failed'});
    assert.throws(()=>persistence.save(journal.state,journal),/failure/); journal.rollback();
    assert.equal(journal.state.tasks[0].title,'Original'); assert.equal(journal.state.events.length,1001);
    db.exec('DROP TRIGGER fail_save');
    journal.begin(); journal.state.tasks[0].title='Saved'; persistence.save(journal.state,journal); journal.commit();
    assert.equal(db.prepare('SELECT count(*) n FROM writes').get().n,1);
    persistence.close(); persistence=createSqlitePersistence(path);
    assert.deepEqual(persistence.load(),copyState(journal.state));
  } finally {persistence.close();db?.close();rmSync(root,{recursive:true,force:true});}
});

test('lazy entities preserve held identity, rollback and secondary indexes after eviction and restart',()=>{
  const root=mkdtempSync(join(tmpdir(),'af-lazy-')),path=join(root,'db.sqlite'),disk=createSqlitePersistence(path);
  try {
    disk.save({rows:Array.from({length:700},(_,i)=>({id:'r'+i,group:i%2,value:i})),events:[]});
    const journal=createStateJournal(disk.load({lazy:true})),held=journal.get('rows','r0');
    for(let i=1;i<700;i++)journal.get('rows','r'+i);
    journal.begin();held.group=3;disk.save(journal.state,journal);journal.commit();
    assert.equal(journal.get('rows','r0'),held);assert.equal(journal.select('rows','group',3)[0],held);
    journal.begin();held.group=4;journal.state.rows.splice(1,1);journal.rollback();
    assert.equal(journal.select('rows','group',3)[0].id,'r0');assert.equal(journal.get('rows','r1').value,1);
    assert.equal(disk.load().rows[0].group,3);
  } finally {disk.close();rmSync(root,{recursive:true,force:true});}
});

for (const edit of [false,true]) test(`snapshot-backed collections are fully materialized with ${edit?'partial edits':'a clean journal'}`, () => {
  const root=mkdtempSync(join(tmpdir(),'af-snapshot-materialization-')),path=join(root,'db.sqlite');
  let disk=createSqlitePersistence(path);
  const db=new DatabaseSync(path);
  try {
    const initial={settings:{installationId:'existing'},tasks:[{id:'t1',title:'untouched'},{id:'t2',title:'edited'}],events:[{id:'e1'},{id:'e2'}],empty:[],extensionCatalog:[{id:'plugin1',kind:'plugin',name:'Installed',createdAt:'2026-01-01T00:00:00Z'}]};
    db.prepare('INSERT INTO workspace_snapshots VALUES(1,?,?)').run(JSON.stringify(initial),'2026-01-01T00:00:00Z');
    const journal=createStateJournal(disk.load({lazy:true}));
    journal.begin();
    if(edit){journal.state.tasks[1].title='saved';journal.state.events[1].message='saved';}
    db.exec("CREATE TRIGGER reject_initial_save BEFORE UPDATE ON workspace_snapshots BEGIN SELECT RAISE(ABORT,'initial write failed'); END");
    assert.throws(()=>disk.save(journal.state,journal),/initial write failed/);
    assert.equal(db.prepare('SELECT count(*) n FROM workspace_entity_collections').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM workspace_event_collections').get().n,0);
    assert.deepEqual(JSON.parse(db.prepare('SELECT state_json FROM workspace_snapshots').get().state_json),initial);
    db.exec('DROP TRIGGER reject_initial_save');
    disk.save(journal.state,journal);journal.commit();
    const expected=copyState(journal.state);
    assert.equal(db.prepare("SELECT count(*) n FROM workspace_entities WHERE collection='tasks'").get().n,2);
    assert.equal(db.prepare('SELECT count(*) n FROM workspace_event_rows').get().n,2);
    assert.equal(db.prepare('SELECT count(*) n FROM extension_catalog').get().n,1);
    disk.close();disk=createSqlitePersistence(path);
    assert.deepEqual(disk.load(),expected);
    const reopened=createStateJournal(disk.load({lazy:true}));
    reopened.begin();reopened.state.tasks[1].title='next';disk.save(reopened.state,reopened);reopened.commit();
    assert.deepEqual(disk.load().tasks,[{id:'t1',title:'untouched'},{id:'t2',title:'next'}]);
  } finally {disk.close();db.close();rmSync(root,{recursive:true,force:true});}
});

test('an existing installation retains list/detail parity and frozen run state on first indexed startup',async()=>{
  const {createStore}=await import('../server/store.mjs');
  const root=mkdtempSync(join(tmpdir(),'af-existing-install-')),path=join(root,'db.sqlite');
  let store=createStore({databasePath:path,workspaceRoot:join(root,'work')});
  try {
    const task=store.createTask({managerAgentId:'system_project_manager',title:'Existing task',objective:'Preserve this task',memberAgentIds:['system_project_manager']});
    const run=store.createRun(task.id);store.pauseRun(run.id);
    const expected=store.snapshot();store.close();store=null;
    // Same current domain state, stored before the SQL entity read model existed.
    const db=new DatabaseSync(path);
    try {
      db.prepare('UPDATE workspace_snapshots SET state_json=? WHERE id=1').run(JSON.stringify(expected));
      db.exec('DELETE FROM workspace_entities; DELETE FROM workspace_entity_collections;');
    } finally {db.close();}
    for(let i=0;i<2;i++){
      store=createStore({databasePath:path,workspaceRoot:join(root,'work')});
      assert.equal(store.queryDirectory('tasks').total,1);
      assert.equal(store.queryDirectory('tasks').items[0].id,task.id);
      assert.equal(store.getDirectoryItem('tasks',task.id).objective,task.objective);
      assert.deepEqual(store.getRun(run.id),expected.runs[0]);
      assert.deepEqual(store.snapshot().messages,expected.messages);
      assert.deepEqual(store.snapshot().dispatches,expected.dispatches);
      assert.equal(store.listAgents().length,expected.agents.length);
      store.close();store=null;
    }
  } finally {store?.close();rmSync(root,{recursive:true,force:true});}
});

test('compact collaboration pages preserve answered questions, delivery links and human acceptance without downloading history',async()=>{
  const {createStore}=await import('../server/store.mjs'),{collaborationRecords}=await import('../client/console-projections.mjs');
  const root=mkdtempSync(join(tmpdir(),'af-collaboration-pages-')),path=join(root,'db.sqlite');
  let store=createStore({databasePath:path,workspaceRoot:join(root,'work')});
  try {
    const task=store.createTask({managerAgentId:'system_project_manager',title:'分页',objective:'目标',memberAgentIds:['system_project_manager']}),run=store.createRun(task.id);
    const state=store.snapshot(),manager=run.manager;
    state.messages=Array.from({length:95},(_,i)=>({id:`message-${String(i).padStart(3,'0')}`,runId:run.id,createdAt:new Date(1700000000000+i*1000).toISOString(),kind:'handoff',sender:{id:manager.id,name:manager.name,type:'agent'},recipient:{id:'other',name:'other',type:'agent'},content:'body '+i}));
    Object.assign(state.messages[0],{kind:'clarification_question',recipient:{id:'human_operator',name:'你',type:'human'}});
    Object.assign(state.messages[94],{kind:'clarification_answer',replyToMessageId:state.messages[0].id,sender:{type:'human',name:'你'}});
    Object.assign(state.messages[93],{kind:'manager_decision',traceId:'trace-final',recipient:{type:'team'}});
    state.traces=[{id:'trace-final',runId:run.id,agentId:manager.id,status:'completed',inputMessageId:'prompt-final'}];
    state.dispatches=[{id:'dispatch',runId:run.id,sourceMessageId:state.messages[30].id,recipientAgentId:manager.id,status:'done',purpose:'manager',traceIds:['trace-final']}];
    state.events=[{id:'accepted',runId:run.id,type:'run.awaiting_acceptance',timestamp:state.messages[93].createdAt,data:{acceptanceRequest:{traceId:'trace-final'}}}];
    store.close();const disk=createSqlitePersistence(path);disk.save(state);disk.close();store=createStore({databasePath:path,workspaceRoot:join(root,'work')});
    const full=collaborationRecords(store.getRunWorkspace(run.id));
    const seen=[];let before=null;
    do {
      const page=store.getRunCollaboration(run.id,{before,limit:10});
      assert.ok(page.workspace.messages.length<=12);assert.ok(page.workspace.traces.length<=1);
      const selected=new Set(page.selected),records=collaborationRecords(page.workspace).filter(r=>selected.has(r.id));
      assert.deepEqual(records,full.filter(r=>selected.has(r.id)));
      seen.push(...page.selected);before=page.hasMore?page.nextBefore:null;
    }while(before);
    assert.equal(new Set(seen).size,95);assert.equal(seen.length,95);
    const human=store.getRunCollaboration(run.id,{human:true});assert.deepEqual(human.selected,full.filter(r=>r.human).map(r=>r.id));
    assert.equal(store.getRunSummary(run.id).messages.length,0);assert.equal(store.getRunSummary(run.id).run.traceCount,1);
    assert.throws(()=>store.getRunCollaboration(run.id,{before:'foreign'}),/游标/);
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
});
