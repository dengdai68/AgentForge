import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SNAPSHOT_ID = 1;

// Cold rows retain identities/order only; bodies are loaded when a command reads them.
// A bounded clean-row cache is safe because dirty rows stay pinned until commit.
export const ROW_SOURCE = Symbol.for('agentforge.rows');
function lazyRows(metadata, read, readField, cacheLimit = 256) {
  const target = new Array(metadata.length), cache = new Map(), live = new Map(), pinned = new Set();
  const row = index => {
    if (Object.hasOwn(target,index)) return target[index];
    const meta = metadata[index]; if (!meta) return undefined;
    if (!cache.has(meta.id)) { const value=live.get(meta.id)?.deref() || JSON.parse(read(meta.id).value_json);cache.set(meta.id,value);live.set(meta.id,new WeakRef(value)); }
    return cache.get(meta.id);
  };
  const source = {
    idAt: index => Object.hasOwn(target,index) ? target[index]?.id : metadata[index]?.id,
    field: name => readField(name),
    pin: id => pinned.add(id),
    release() {
      // Appended/edited rows become cold-readable after their durable commit.
      // A live proxy keeps identity through WeakRef, without pinning all history.
      for(const key of Object.keys(target)) if(/^\d+$/.test(key)) {
        const value=target[key];if(!value?.id)continue;
        metadata[Number(key)]={id:value.id,position:Number(key)};live.set(value.id,new WeakRef(value));cache.set(value.id,value);delete target[key];
      }
      metadata.length=target.length;pinned.clear();
      if(cache.size>cacheLimit)for(const id of cache.keys()){cache.delete(id);if(cache.size<=cacheLimit)break;}
    },
    size: () => cache.size
  };
  return new Proxy(target, {
    get(array,key,receiver) {if(key===ROW_SOURCE)return source;if(/^\d+$/.test(String(key)))return row(Number(key));return Reflect.get(array,key,receiver);},
    has(array,key) {return /^\d+$/.test(String(key)) && Number(key)<array.length || Reflect.has(array,key);},
    set(array,key,value) {return Reflect.set(array,key,value);}
  });
}

export function createSqlitePersistence(databasePath = ":memory:", { onSaveDiagnostic } = {}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspace_snapshots (
      id INTEGER PRIMARY KEY CHECK (id = ${SNAPSHOT_ID}),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS extension_catalog (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
      search_text TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
      value_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS extension_catalog_listing ON extension_catalog(kind, deleted_at, created_at DESC, id);
    CREATE TABLE IF NOT EXISTS workspace_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL) STRICT;
    INSERT OR IGNORE INTO workspace_revision VALUES(1,0);
    CREATE TABLE IF NOT EXISTS workspace_changes(collection TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(collection,id)) STRICT;
    CREATE INDEX IF NOT EXISTS workspace_changes_revision ON workspace_changes(revision);
    CREATE TABLE IF NOT EXISTS workspace_entities (
      collection TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, value_json TEXT NOT NULL,
      PRIMARY KEY(collection,id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS workspace_entity_order ON workspace_entities(collection,position);
    CREATE INDEX IF NOT EXISTS workspace_entity_run ON workspace_entities(collection,json_extract(value_json,'$.runId'),position);
    CREATE INDEX IF NOT EXISTS workspace_entity_run_agent ON workspace_entities(collection,json_extract(value_json,'$.runId'),json_extract(value_json,'$.agentId'),position);
    CREATE INDEX IF NOT EXISTS workspace_entity_status ON workspace_entities(collection,json_extract(value_json,'$.status'),position);
    CREATE INDEX IF NOT EXISTS workspace_entity_conversation ON workspace_entities(collection,json_extract(value_json,'$.conversationId'),position);
    CREATE INDEX IF NOT EXISTS workspace_entity_conversation_agent ON workspace_entities(collection,json_extract(value_json,'$.conversationId'),json_extract(value_json,'$.agentId'),position);
    CREATE INDEX IF NOT EXISTS workspace_message_role ON workspace_entities(collection,json_extract(value_json,'$.runId'),json_extract(value_json,'$.sender.type'),position);
    CREATE INDEX IF NOT EXISTS workspace_message_sender ON workspace_entities(collection,json_extract(value_json,'$.conversationId'),json_extract(value_json,'$.sender.type'),position);
    CREATE INDEX IF NOT EXISTS workspace_entity_automation ON workspace_entities(collection,json_extract(value_json,'$.automationId'),json_extract(value_json,'$.plannedAt') DESC,id DESC);
    CREATE INDEX IF NOT EXISTS workspace_automation_due ON workspace_entities(collection,json_extract(value_json,'$.enabled'),json_extract(value_json,'$.nextTriggerAt'));
    CREATE TABLE IF NOT EXISTS workspace_entity_collections(name TEXT PRIMARY KEY) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_event_collections (name TEXT PRIMARY KEY) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_event_rows (
      collection TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, value_json TEXT NOT NULL,
      PRIMARY KEY(collection, id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS workspace_event_member ON workspace_event_rows(collection,json_extract(value_json,'$.runId'),json_extract(value_json,'$.actor.id'),position);
    CREATE INDEX IF NOT EXISTS workspace_event_conversation ON workspace_event_rows(collection,json_extract(value_json,'$.conversationId'),json_extract(value_json,'$.agentId'),position);
    CREATE INDEX IF NOT EXISTS workspace_event_conversation_order ON workspace_event_rows(collection,json_extract(value_json,'$.conversationId'),position);
    CREATE INDEX IF NOT EXISTS workspace_event_delivery ON workspace_event_rows(collection,json_extract(value_json,'$.deliveryId'),json_extract(value_json,'$.attempt'),json_extract(value_json,'$.type'),position);
    CREATE INDEX IF NOT EXISTS workspace_event_kind ON workspace_event_rows(collection,json_extract(value_json,'$.runId'),json_extract(value_json,'$.type'),json_extract(value_json,'$.data.acceptanceRequest.traceId'),position);
    CREATE INDEX IF NOT EXISTS workspace_event_error_time ON workspace_event_rows((CASE WHEN json_extract(value_json,'$.type')='failed' OR json_extract(value_json,'$.type') LIKE '%.failed' OR json_extract(value_json,'$.data.presentation')='error' OR json_extract(value_json,'$.data.status')='failed' THEN 1 ELSE 0 END),COALESCE(json_extract(value_json,'$.timestamp'),json_extract(value_json,'$.createdAt')) DESC,id DESC);
    CREATE INDEX IF NOT EXISTS workspace_event_global_time ON workspace_event_rows(COALESCE(json_extract(value_json,'$.timestamp'),json_extract(value_json,'$.createdAt')) DESC,id DESC);
    CREATE INDEX IF NOT EXISTS workspace_event_time ON workspace_event_rows(collection,COALESCE(json_extract(value_json,'$.timestamp'),json_extract(value_json,'$.createdAt')) DESC,id DESC);
  `);
  const loadSnapshot = database.prepare("SELECT state_json FROM workspace_snapshots WHERE id = ?");
  const saveSnapshot = database.prepare(`
    INSERT INTO workspace_snapshots (id, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
  `);
  const readCollections = database.prepare("SELECT name FROM workspace_event_collections");
  const readEvents = database.prepare("SELECT id,position,value_json FROM workspace_event_rows WHERE collection=? ORDER BY position");
  const insertCollection = database.prepare("INSERT OR IGNORE INTO workspace_event_collections VALUES (?)");
  const removeCollection = database.prepare("DELETE FROM workspace_event_collections WHERE name=?");
  const removeEvents = database.prepare("DELETE FROM workspace_event_rows WHERE collection=?");
  const removeEvent = database.prepare("DELETE FROM workspace_event_rows WHERE collection=? AND id=?");
  const writeEvent = database.prepare("INSERT INTO workspace_event_rows VALUES (?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET position=excluded.position,value_json=excluded.value_json");
  const readCatalog = database.prepare("SELECT value_json FROM extension_catalog ORDER BY created_at DESC,id");
  const writeCatalog = database.prepare("INSERT INTO extension_catalog VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,search_text=excluded.search_text,created_at=excluded.created_at,deleted_at=excluded.deleted_at,value_json=excluded.value_json");
  const deleteCatalog = database.prepare("DELETE FROM extension_catalog WHERE id=?");
  const catalogCount = database.prepare("SELECT COUNT(*) AS total FROM extension_catalog WHERE kind=? AND deleted_at IS NULL AND instr(search_text,?)>0");
  const catalogPage = database.prepare("SELECT value_json FROM extension_catalog WHERE kind=? AND deleted_at IS NULL AND instr(search_text,?)>0 ORDER BY created_at DESC,id LIMIT ? OFFSET ?");
  const entityCollections = database.prepare('SELECT name FROM workspace_entity_collections');
  const entityRows = database.prepare('SELECT id,position,value_json FROM workspace_entities WHERE collection=? ORDER BY position');
  const entityWrite = database.prepare('INSERT INTO workspace_entities VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET position=excluded.position,value_json=excluded.value_json');
  const entityDelete = database.prepare('DELETE FROM workspace_entities WHERE collection=? AND id=?');
  const entityCollectionWrite = database.prepare('INSERT OR IGNORE INTO workspace_entity_collections VALUES(?)');
  let entities = new Map();
  let catalogCache = new Map();
  let cached = new Map();

  return {
    load({lazy = false} = {}) {
      const row = loadSnapshot.get(SNAPSHOT_ID);
      if (!row) { cached = new Map(); return null; }
      const state = JSON.parse(row.state_json);
      entities = new Map();
      for (const {name} of entityCollections.all()) {
        const cache = new Map();
        if (lazy) {
          const meta=database.prepare('SELECT id,position FROM workspace_entities WHERE collection=? ORDER BY position').all(name);
          const read=id=>database.prepare('SELECT value_json FROM workspace_entities WHERE collection=? AND id=?').get(name,id);
          state[name]=lazyRows(meta,read,field=>{
            if(!/^[a-zA-Z]+$/.test(field))throw new Error('Invalid entity field');
            return database.prepare(`SELECT id,json_extract(value_json,'$.${field}') value FROM workspace_entities WHERE collection=? ORDER BY position`).all(name);
          });
          for(const entry of meta)cache.set(entry.id,{position:entry.position,get json(){return read(entry.id).value_json;}});
        } else state[name] = entityRows.all(name).map(item => {cache.set(item.id,{json:item.value_json,position:item.position});return JSON.parse(item.value_json);});
        entities.set(name,cache);
      }
      const catalog = readCatalog.all().map(row => JSON.parse(row.value_json));
      if (catalog.length) state.extensionCatalog = catalog;
      catalogCache = new Map(catalog.map(entry => [entry.id, JSON.stringify(entry)]));
      const loaded = new Map();
      for (const { name } of readCollections.all()) {
        const entries = new Map();
        if (lazy) {
          const meta=database.prepare('SELECT id,position FROM workspace_event_rows WHERE collection=? ORDER BY position').all(name);
          const read=id=>database.prepare('SELECT value_json FROM workspace_event_rows WHERE collection=? AND id=?').get(name,id);
          state[name]=lazyRows(meta,read,field=>{
            if(!/^[a-zA-Z]+$/.test(field))throw new Error('Invalid event field');
            return database.prepare(`SELECT id,json_extract(value_json,'$.${field}') value FROM workspace_event_rows WHERE collection=? ORDER BY position`).all(name);
          });
          for(const entry of meta) entries.set(entry.id,{position:entry.position,get json(){return read(entry.id).value_json;}});
        } else state[name] = readEvents.all(name).map((item) => {
          const value = JSON.parse(item.value_json);
          entries.set(item.id, { json: item.value_json, position: item.position });
          return value;
        });
        loaded.set(name, entries);
      }
      cached = loaded;
      return state;
    },
    revision() { return database.prepare('SELECT revision FROM workspace_revision WHERE id=1').get().revision; },
    changesSince(revision) { return database.prepare('SELECT collection,id FROM workspace_changes WHERE revision>?').all(revision); },
    communicationUnread(thread) {
      const position=thread.humanReadThroughMessageId?database.prepare("SELECT position FROM workspace_entities WHERE collection='communicationMessages' AND id=? AND json_extract(value_json,'$.conversationId')=?").get(thread.humanReadThroughMessageId,thread.id)?.position:-1;
      return database.prepare("SELECT count(*) total FROM workspace_entities WHERE collection='communicationMessages' AND json_extract(value_json,'$.conversationId')=? AND json_extract(value_json,'$.sender.type')='agent' AND position>?").get(thread.id,position??-1).total;
    },
    collaborationPage(runId,{before=null,limit=30,human=false}={}) {
      const where=["collection='messages'","json_extract(value_json,'$.runId')=?","json_extract(value_json,'$.sender.type') IN ('agent','human')"],values=[runId];
      if(human)where.push("(json_extract(value_json,'$.sender.type')='human' OR json_extract(value_json,'$.recipient.type')='human' OR (json_extract(value_json,'$.kind')='manager_decision' AND EXISTS(SELECT 1 FROM workspace_event_rows a WHERE a.collection='events' AND json_extract(a.value_json,'$.runId')=json_extract(workspace_entities.value_json,'$.runId') AND json_extract(a.value_json,'$.type')='run.awaiting_acceptance' AND json_extract(a.value_json,'$.data.acceptanceRequest.traceId')=json_extract(workspace_entities.value_json,'$.traceId'))))");
      const base=where.join(' AND '),total=database.prepare(`SELECT count(*) total FROM workspace_entities INDEXED BY workspace_message_role WHERE ${base}`).get(...values).total;
      if(before){const row=database.prepare(`SELECT position FROM workspace_entities WHERE ${base} AND id=?`).get(...values,before);if(!row)throw new Error('协作游标无效');where.push('position<?');values.push(row.position);}
      const rows=database.prepare(`SELECT id FROM workspace_entities INDEXED BY workspace_entity_run WHERE ${where.join(' AND ')} ORDER BY position DESC LIMIT ?`).all(...values,limit+1);
      const selected=rows.slice(0,limit).reverse().map(row=>row.id);return {selected,total,hasMore:rows.length>limit,nextBefore:selected[0]||null};
    },
    collaborationContext(runId,messageIds,traceIds) {
      if(!messageIds.length)return {dispatchIds:[],eventIds:[]};const placeholders=messageIds.map(()=>'?').join(',');
      const dispatchIds=database.prepare(`SELECT id FROM workspace_entities WHERE collection='dispatches' AND json_extract(value_json,'$.runId')=? AND (json_extract(value_json,'$.sourceMessageId') IN (${placeholders}) OR json_extract(value_json,'$.waitingMessageId') IN (${placeholders}) OR EXISTS(SELECT 1 FROM json_each(value_json,'$.messageIds') WHERE value IN (${placeholders})))`).all(runId,...messageIds,...messageIds,...messageIds).map(row=>row.id);
      const eventIds=database.prepare(`SELECT id FROM workspace_event_rows WHERE collection='events' AND json_extract(value_json,'$.runId')=? AND json_extract(value_json,'$.type') IN ('run.awaiting_acceptance','dispatch.retry_scheduled','dispatch.retry_stopped','dispatch.escalated','session.reset','run.retry_requested','run.orchestration_retry_requested') AND ((json_extract(value_json,'$.data.acceptanceRequest.traceId') IN (SELECT value FROM json_each(?))) OR json_extract(value_json,'$.data.traceId') IN (SELECT value FROM json_each(?)) OR json_extract(value_json,'$.data.dispatchId') IN (SELECT value FROM json_each(?))) ORDER BY position`).all(runId,JSON.stringify(traceIds),JSON.stringify(traceIds),JSON.stringify(dispatchIds)).map(row=>row.id);
      return {dispatchIds,eventIds};
    },
    acceptanceFiles(runId,timestamp) {
      const latest="WITH ranked AS (SELECT id,value_json,row_number() OVER (PARTITION BY json_extract(value_json,'$.name') ORDER BY COALESCE(json_extract(value_json,'$.createdAt'),'') DESC,position DESC) rank FROM workspace_entities WHERE collection='artifacts' AND json_extract(value_json,'$.runId')=? AND (json_extract(value_json,'$.createdAt') IS NULL OR json_extract(value_json,'$.createdAt')<=?))";
      const where="rank=1 AND NOT COALESCE(json_extract(value_json,'$.deleted'),0) AND json_extract(value_json,'$.storagePath') IS NOT NULL";
      const count=database.prepare(`${latest} SELECT count(*) count FROM ranked WHERE ${where}`).get(runId,timestamp).count;
      const files=database.prepare(`${latest} SELECT id,json_extract(value_json,'$.name') name FROM ranked WHERE ${where} ORDER BY id DESC LIMIT 8`).all(runId,timestamp);
      return {count,files};
    },
    historyTracePage(trace,{after=0,high,limit=30}={}) {
      const where="collection='events' AND json_extract(value_json,'$.runId')=? AND json_extract(value_json,'$.actor.id')=? AND json_extract(value_json,'$.data.traceId')=?",values=[trace.runId,trace.agentId,trace.id];
      high??=database.prepare(`SELECT MAX(position)+1 high FROM workspace_event_rows WHERE ${where}`).get(...values).high||0;
      const rows=database.prepare(`SELECT position+1 id,value_json FROM workspace_event_rows WHERE ${where} AND position+1>? AND position+1<=? ORDER BY position LIMIT ?`).all(...values,after,high,limit+1).map(row=>({id:row.id,event:JSON.parse(row.value_json)}));
      return {rows,high};
    },
    traceCounts(runId) { return Object.fromEntries(database.prepare("SELECT json_extract(value_json,'$.agentId') agent,count(*) total FROM workspace_entities WHERE collection='traces' AND json_extract(value_json,'$.runId')=? GROUP BY json_extract(value_json,'$.agentId')").all(runId).map(row=>[row.agent,row.total])); },
    taskWorkflowReferences() { return database.prepare("SELECT DISTINCT json_extract(value_json,'$.workflowTemplateId') id,json_extract(value_json,'$.workflowSnapshot.name') name FROM workspace_entities WHERE collection='tasks' AND COALESCE(json_extract(value_json,'$.kind'),'ordinary')!='automation' AND json_extract(value_json,'$.workflowTemplateId') IS NOT NULL").all(); },
    overviewCounts() {
      const tasks=database.prepare("SELECT json_extract(value_json,'$.status') status,count(*) total FROM workspace_entities WHERE collection='tasks' AND COALESCE(json_extract(value_json,'$.kind'),'ordinary')!='automation' GROUP BY status").all();
      const runs=database.prepare("SELECT json_extract(r.value_json,'$.status') status,count(*) total FROM workspace_entities r JOIN workspace_entities t ON t.collection='tasks' AND t.id=json_extract(r.value_json,'$.taskId') WHERE r.collection='runs' AND COALESCE(json_extract(t.value_json,'$.kind'),'ordinary')!='automation' GROUP BY status").all();
      const artifacts=database.prepare("SELECT count(*) total FROM workspace_entities a JOIN workspace_entities r ON r.collection='runs' AND r.id=json_extract(a.value_json,'$.runId') JOIN workspace_entities t ON t.collection='tasks' AND t.id=json_extract(r.value_json,'$.taskId') WHERE a.collection='artifacts' AND COALESCE(json_extract(t.value_json,'$.kind'),'ordinary')!='automation'").get().total;
      return {tasks:Object.fromEntries(tasks.map(row=>[row.status,row.total])),runs:Object.fromEntries(runs.map(row=>[row.status,row.total])),artifacts};
    },
    dueAutomations(at) { return database.prepare("SELECT id,json_extract(value_json,'$.nextTriggerAt') plannedAt FROM workspace_entities WHERE collection='automations' AND json_extract(value_json,'$.enabled')=1 AND json_extract(value_json,'$.nextTriggerAt')<=? ORDER BY json_extract(value_json,'$.nextTriggerAt'),id").all(at.toISOString()); },
    automationPage(automationId,{page=1,pageSize=20,search='',status='all'}={}) {
      page=Number(page);pageSize=Number(pageSize);if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new Error('分页参数无效');
      const where=['e.collection=?'],values=[automationId?'automationTriggers':'automations'];
      if(automationId){where.push("json_extract(e.value_json,'$.automationId')=?");values.push(automationId);if(status&&status!=='all'){where.push("COALESCE(json_extract(r.value_json,'$.status'),json_extract(e.value_json,'$.outcome'))=?");values.push(status);}}
      else {if(search.trim()){where.push("instr(lower(json_extract(e.value_json,'$.title')||' '||json_extract(e.value_json,'$.objective')),?)>0");values.push(search.trim().toLowerCase());}if(status&&status!=='all'){where.push("json_extract(e.value_json,'$.enabled')=?");values.push(status==='enabled'?1:0);}}
      const from="workspace_entities e LEFT JOIN workspace_entities r ON r.collection='runs' AND r.id=json_extract(e.value_json,'$.runId')",filter=where.join(' AND ');
      const total=database.prepare(`SELECT count(*) total FROM ${from} WHERE ${filter}`).get(...values).total,totalPages=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,totalPages);
      const items=database.prepare(`SELECT e.id FROM ${from} WHERE ${filter} ORDER BY json_extract(e.value_json,'$.${automationId?'plannedAt':'updatedAt'}') DESC,e.id DESC LIMIT ? OFFSET ?`).all(...values,pageSize,(page-1)*pageSize).map(row=>row.id);
      return {items,page,pageSize,total,totalPages};
    },
    latestAutomationTrigger(id) { return database.prepare("SELECT id FROM workspace_entities WHERE collection='automationTriggers' AND json_extract(value_json,'$.automationId')=? ORDER BY json_extract(value_json,'$.createdAt') DESC,id DESC LIMIT 1").get(id)?.id; },
    executionLogPage({source='all',level='all',before=null,limit=100}={}) {
      if(!['all','task','private','group'].includes(source)||!['all','error'].includes(level))throw new Error('日志筛选无效');
      if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('分页大小必须为 1–200');
      const time="COALESCE(json_extract(e.value_json,'$.timestamp'),json_extract(e.value_json,'$.createdAt'))";
      const kind="CASE WHEN e.collection='events' THEN 'task' WHEN json_extract(c.value_json,'$.kind') IN ('team','group') THEN 'group' ELSE 'private' END";
      const where=["((e.collection='events' AND json_extract(e.value_json,'$.runId') IS NOT NULL) OR (e.collection='communicationEvents' AND c.id IS NOT NULL))"],values=[];
      if(source!=='all'){where.push(`${kind}=?`);values.push(source);}
      if(level==='error')where.push("(CASE WHEN json_extract(e.value_json,'$.type')='failed' OR json_extract(e.value_json,'$.type') LIKE '%.failed' OR json_extract(e.value_json,'$.data.presentation')='error' OR json_extract(e.value_json,'$.data.status')='failed' THEN 1 ELSE 0 END)=1");
      const from="workspace_event_rows e INDEXED BY "+(level==='error'?'workspace_event_error_time':'workspace_event_global_time')+" LEFT JOIN workspace_entities c ON c.collection='communicationConversations' AND c.id=json_extract(e.value_json,'$.conversationId')";
      if(before){const cursor=database.prepare(`SELECT ${time} timestamp,e.id FROM ${from} WHERE ${where.join(' AND ')} AND e.id=?`).get(...values,before);if(!cursor)throw new Error('日志游标不存在，请刷新最新记录');where.push(`(${time},e.id)<(?,?)`);values.push(cursor.timestamp,cursor.id);}
      const rows=database.prepare(`SELECT e.collection,e.value_json FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${time} DESC,e.id DESC LIMIT ?`).all(...values,limit+1);
      return {rows:rows.slice(0,limit).map(row=>({collection:row.collection,event:JSON.parse(row.value_json)})),hasMore:rows.length>limit};
    },
    consolePage(runId,agentId,{traceId=null,before=null,limit=200}={}) {
      const where=["collection='events'","json_extract(value_json,'$.runId')=?","json_extract(value_json,'$.actor.id')=?"],values=[runId,agentId];
      if(traceId){where.push("json_extract(value_json,'$.data.traceId')=?");values.push(traceId);}
      const base=where.join(' AND '),total=database.prepare(`SELECT count(*) total FROM workspace_event_rows WHERE ${base}`).get(...values).total;
      if(before){const cursor=database.prepare(`SELECT position FROM workspace_event_rows WHERE ${base} AND id=?`).get(...values,before);if(!cursor)throw new Error('日志游标无效，请刷新日志');where.push('position<?');values.push(cursor.position);}
      const rows=database.prepare(`SELECT value_json FROM workspace_event_rows WHERE ${where.join(' AND ')} ORDER BY position DESC LIMIT ?`).all(...values,limit+1);
      const events=rows.slice(0,limit).reverse().map(row=>JSON.parse(row.value_json));
      return {events,total,hasMore:rows.length>limit,nextBefore:events[0]?.id||null};
    },
    communicationEventPage(conversationId,{agentId=null,deliveryId=null,before=null,limit=100,excludePrompts=false}={}) {
      if(!Number.isInteger(limit)||limit<1||limit>200)throw new Error('分页大小必须为 1–200');
      const where=["collection='communicationEvents'","json_extract(value_json,'$.conversationId')=?"],values=[conversationId];
      if(agentId){where.push("json_extract(value_json,'$.agentId')=?");values.push(agentId);}
      if(deliveryId){where.push("json_extract(value_json,'$.deliveryId')=?");values.push(deliveryId);}
      if(excludePrompts)where.push("json_extract(value_json,'$.type')!='prompt.snapshot'");
      if(before){const row=database.prepare(`SELECT position FROM workspace_event_rows WHERE ${where.join(' AND ')} AND id=?`).get(...values,before);if(!row)throw new Error('沟通游标不存在');where.push('position<?');values.push(row.position);}
      const rows=database.prepare(`SELECT value_json FROM workspace_event_rows WHERE ${where.join(' AND ')} ORDER BY position DESC LIMIT ?`).all(...values,limit+1);
      const items=rows.slice(0,limit).reverse().map(row=>JSON.parse(row.value_json));return {items,hasMore:rows.length>limit,nextBefore:items[0]?.id||null};
    },
    communicationCallEvents(conversationId,deliveryId,attempt) {
      return database.prepare("SELECT value_json FROM workspace_event_rows INDEXED BY workspace_event_delivery WHERE collection='communicationEvents' AND json_extract(value_json,'$.deliveryId')=? AND json_extract(value_json,'$.attempt')=? AND json_extract(value_json,'$.conversationId')=? AND json_extract(value_json,'$.type') IN ('started','prompt.snapshot','completed','failed') ORDER BY position").all(deliveryId,attempt,conversationId).map(row=>JSON.parse(row.value_json));
    },
    communicationConsoleMembers(conversationId) {
      return database.prepare("SELECT id,json_extract(value_json,'$.agentId') agentId,MAX(position) FROM workspace_entities INDEXED BY workspace_entity_conversation_agent WHERE collection='communicationDeliveries' AND json_extract(value_json,'$.conversationId')=? GROUP BY json_extract(value_json,'$.agentId')").all(conversationId);
    },
    findEntities(collection, filters, {limit=100,last=false}={}) {
      const where=['collection=?'], values=[collection];
      for(const [field,value] of Object.entries(filters)) {
        if(!['runId','agentId','taskId','conversationId','status'].includes(field))throw new Error('无效查询字段');
        where.push(`json_extract(value_json,'$.${field}')=?`);values.push(value);
      }
      return database.prepare(`SELECT id FROM workspace_entities WHERE ${where.join(' AND ')} ORDER BY position ${last?'DESC':'ASC'} LIMIT ?`).all(...values,limit).map(row=>row.id);
    },
    queryEntities(collection, { search = '', status = '', role = '', workflow = '', archived = false, page = 1, pageSize = 20 } = {}) {
      if (!['tasks','agents','roles','teams','workflowTemplates','communicationConversations','automations','automationTriggers'].includes(collection)) throw new Error('目录无效');
      page=Number(page);pageSize=Number(pageSize);
      if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new Error('分页参数无效');
      const clauses=['collection=?'], values=[collection];
      const field=name=>`json_extract(value_json,'$.${name}')`;
      if(collection==='agents')clauses.push(`${field('status')} != 'deleted'`);
      if(collection==='communicationConversations')clauses.push(`(${field('kind')}!='agent' OR EXISTS(SELECT 1 FROM workspace_entities a WHERE a.collection='agents' AND a.id=json_extract(workspace_entities.value_json,'$.targetId') AND json_extract(a.value_json,'$.status')!='deleted'))`);
      if(collection==='tasks') {
        clauses.push(`COALESCE(${field('kind')},'ordinary') != 'automation'`,`${field('archivedAt')} IS ${archived ? 'NOT ' : ''}NULL`);
        if(workflow && workflow!=='all'){clauses.push(`${field('workflowTemplateId')}=?`);values.push(workflow);}
      }
      if(search.trim()) {
        const keys=collection==='tasks'?['title']:collection==='roles'?['name','prompt']:['name','description','mission','capabilities'];
        clauses.push(`instr(lower(${keys.map(key=>`COALESCE(${field(key)},'')`).join("||' '||")}),?)>0`);values.push(search.trim().toLocaleLowerCase());
      }
      if(status && status!=='all'){clauses.push(`${field('status')}=?`);values.push(status);}
      if(role){clauses.push(`EXISTS(SELECT 1 FROM json_each(value_json,'$.roleIds') WHERE value=?)`);values.push(role);}
      const where=clauses.join(' AND '), total=database.prepare(`SELECT COUNT(*) total FROM workspace_entities WHERE ${where}`).get(...values).total;
      const totalPages=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,totalPages);
      const order=collection==='tasks'?`${field(archived?'archivedAt':'updatedAt')} DESC,id`:collection==='communicationConversations'?`${field('updatedAt')} DESC,id`:'position';
      const items=database.prepare(`SELECT id FROM workspace_entities WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...values,pageSize,(page-1)*pageSize).map(row=>row.id);
      return {items,total,page,pageSize,totalPages,hasMore:page<totalPages};
    },
    queryExtensions(kind, { search = '', page = 1, pageSize = 20 } = {}) {
      const query = search.trim().toLocaleLowerCase();
      const { total } = catalogCount.get(kind, query);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      page = Math.min(page, totalPages);
      const items = catalogPage.all(kind, query, pageSize, (page - 1) * pageSize).map(row => JSON.parse(row.value_json));
      return { items, total, page, pageSize, totalPages, hasMore: page < totalPages };
    },
    save(state, journal = null) {
      if (journal && !journal.changes.size) {
        const uninitialized = Object.entries(state).some(([name, rows]) => {
          if (!Array.isArray(rows)) return false;
          if (name === 'extensionCatalog') return rows.length > 0 && !catalogCache.size;
          return name === 'events' || name === 'communicationEvents' ? !cached.has(name) : !entities.has(name);
        });
        if (!uninitialized) return;
      }
      const observed = typeof onSaveDiagnostic === "function";
      const started = observed ? performance.now() : 0, phases = observed ? [] : null;
      let phase = null, phaseStarted = 0, count = 0;
      let outcome = "error", transactionOutcome = "not_started", transactionStarted = false;
      const finishPhase = (result = "success") => {
        if (!observed || phase === null) return;
        phases.push({ phase, elapsedMs: performance.now() - phaseStarted, count, outcome: result });
        phase = null;
      };
      const startPhase = (name) => {
        if (!observed) return;
        finishPhase(); phase = name; count = 0; phaseStarted = performance.now();
      };
      try {
        startPhase("diff");
        if(!journal)for(const {name} of entityCollections.all())if(!entities.has(name))entities.set(name,new Map(entityRows.all(name).map(row=>[row.id,{position:row.position,json:row.value_json}])));
        const snapshot = { ...state }, next = new Map(), writes = [], removals = [];
        for (const key of ["events", "communicationEvents"]) {
          if (!Array.isArray(state[key])) continue;
          delete snapshot[key];
          const old = cached.get(key) || new Map(), dirty = journal?.changes.get(key);
          // A journal only describes edits since load. Snapshot-backed collections
          // still need a complete first write before the snapshot can omit them.
          const initialized = cached.has(key);
          if (journal && initialized && !dirty) {next.set(key,old);continue;}
          const partial = initialized && dirty && !dirty.has(null);
          const entries = partial ? new Map() : new Map();
          const values = partial ? [...dirty].map(id => journal.entry(key,id)).filter(Boolean) : state[key].map((value,position)=>({value,position}));
          values.forEach(({value, position}) => {
            if (typeof value.id !== "string" || entries.has(value.id)) throw new Error("Invalid persistent event identity");
            const previous = old.get(value.id);
            const json = previous?.value === value ? previous.json : JSON.stringify(value);
            entries.set(value.id, { json, position });
            if (!previous || previous.json !== json || previous.position !== position) writes.push([key, value.id, position, json]);
            if (observed) ++count;
          });
          if (!partial) for (const id of old.keys()) if (!entries.has(id)) removals.push([key, id]);
          next.set(key, partial ? {previous:old,updates:entries} : entries);
        }
        const catalogChanged = !journal || journal.changes.has('extensionCatalog') || (!catalogCache.size && state.extensionCatalog?.length > 0);
        const nextCatalog = catalogChanged ? new Map((state.extensionCatalog || []).map(entry => [entry.id, JSON.stringify(entry)])) : catalogCache;
        delete snapshot.extensionCatalog;
        startPhase("serialize");
        const entityUpdates = new Map(), entityRemovals = [], entityWrites = [];
        for (const [name, rows] of Object.entries(snapshot)) {
          if (!Array.isArray(rows) || (!journal && rows.some(value => !value?.id))) continue;
          delete snapshot[name];
          const old = entities.get(name) || new Map(), dirty = journal?.changes.get(name);
          const initialized = entities.has(name);
          if (journal && initialized && !dirty) continue;
          const partial = initialized && dirty && !dirty.has(null);
          const updates = new Map();
          const values = partial ? [...dirty].map(id => journal.entry(name,id)).filter(Boolean) : rows.map((value,position)=>({value,position}));
          for (const {value,position} of values) {
            const json = JSON.stringify(value), previous = old.get(value.id);
            if (updates.has(value.id)) throw new Error('Invalid persistent entity identity');
            updates.set(value.id,{json,position});
            if (!previous || previous.json!==json || previous.position!==position) entityWrites.push([name,value.id,position,json]);
          }
          if (!partial) for (const id of old.keys()) if (!updates.has(id)) entityRemovals.push([name,id]);
          entityUpdates.set(name,{old,updates,partial});
        }
        const json = JSON.stringify(snapshot);
        if (observed) ++count;
        startPhase("begin");
        database.exec("BEGIN IMMEDIATE");
        transactionStarted = true;
        if (observed) ++count;
        startPhase("reconcile");
        // A fresh adapter reconciles persisted rows before establishing its cache.
        const collections = readCollections.all();
        if (observed) ++count;
        for (const { name } of collections) if (!next.has(name) || !cached.has(name)) {
          removeEvents.run(name); if (observed) ++count;
          removeCollection.run(name); if (observed) ++count;
        }
        for (const key of next.keys()) { insertCollection.run(key); if (observed) ++count; }
        startPhase("delete");
        for (const args of removals) { removeEvent.run(...args); if (observed) ++count; }
        for (const args of entityRemovals) entityDelete.run(...args);
        if (!journal) for (const {name} of entityCollections.all()) if (!Object.hasOwn(state,name)) {
          database.prepare('DELETE FROM workspace_entities WHERE collection=?').run(name);
          database.prepare('DELETE FROM workspace_entity_collections WHERE name=?').run(name);
        }
        for (const name of entityUpdates.keys()) entityCollectionWrite.run(name);
        for (const args of entityWrites) entityWrite.run(...args);
        startPhase("upsert_events");
        for (const args of writes) { writeEvent.run(...args); if (observed) ++count; }
        for (const id of catalogCache.keys()) if (!nextCatalog.has(id)) deleteCatalog.run(id);
        for (const entry of catalogChanged ? state.extensionCatalog || [] : []) if (catalogCache.get(entry.id) !== nextCatalog.get(entry.id)) {
          writeCatalog.run(entry.id, entry.kind, entry.name, `${entry.name} ${entry.description || ''}`.toLocaleLowerCase(), entry.createdAt, entry.deletedAt || null, nextCatalog.get(entry.id));
        }
        startPhase("upsert_snapshot");
        saveSnapshot.run(SNAPSHOT_ID, json, new Date().toISOString());
        if (observed) ++count;
        database.prepare('UPDATE workspace_revision SET revision=revision+1 WHERE id=1').run();
        const revision = database.prepare('SELECT revision FROM workspace_revision WHERE id=1').get().revision;
        const mark = database.prepare('INSERT INTO workspace_changes VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET revision=excluded.revision');
        for(const [name,id] of [...writes,...removals,...entityWrites,...entityRemovals])mark.run(name,id,revision);
        if (!journal) for(const [name,entries] of entities) if(!Object.hasOwn(state,name)) for(const id of entries.keys())mark.run(name,id,revision);
        startPhase("commit");
        database.exec("COMMIT");
        transactionStarted = false;
        transactionOutcome = "committed";
        if (!journal) for (const name of entities.keys()) if (!Object.hasOwn(state,name)) entities.delete(name);
        if (observed) ++count;
        for (const [key,entry] of next) if (entry.previous) { for (const [id,value] of entry.updates) entry.previous.set(id,value); next.set(key,entry.previous); }
        cached = next; catalogCache = nextCatalog;
        for (const [name,{old,updates,partial}] of entityUpdates) {
          if (partial) {for (const [id,value] of updates) old.set(id,value);entities.set(name,old);} else entities.set(name,updates);
        }
        outcome = "success";
        finishPhase();
      } catch (error) {
        finishPhase("error");
        if (transactionStarted) {
          startPhase("rollback");
          try {
            database.exec("ROLLBACK");
            transactionOutcome = "rolled_back";
            if (observed) ++count;
            finishPhase();
          } catch {
            transactionOutcome = "rollback_failed";
            finishPhase("error");
          }
        }
        throw error;
      } finally {
        if (observed) {
          const record = { operation: "save", outcome, elapsedMs: performance.now() - started, transactionOutcome, phases };
          // Diagnostics must never turn a committed save into a Store rollback.
          try { onSaveDiagnostic(record); } catch { /* Preserve the original save result. */ }
        }
      }
    },
    close() {
      database.close();
    }
  };
}
