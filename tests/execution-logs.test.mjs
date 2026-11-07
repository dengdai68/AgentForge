import test from "node:test";
import assert from "node:assert/strict";
import { executionLogs } from "../server/execution-logs.mjs";
import { createStore } from "../server/store.mjs";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { runInNewContext } from 'node:vm';

test('SSE releases slow consumers, recovers after drain and removes subscriptions on close',async()=>{
  const source=await readFile(new URL('../server/index.mjs',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('    const runId = streamMatch[1];'),source.indexOf('  if (request.method === "GET" && pathname === "/api/health")'));
  function connection(){
    let listener,heartbeat,unsubscribed=false,cleared=false;const responseEvents={},requestEvents={},writes=[];
    const response={writableEnded:false,destroyed:false,writableLength:0,accept:true,writeHead(){},write(chunk){writes.push(chunk);return this.accept;},on(type,fn){responseEvents[type]=fn;},destroy(){this.destroyed=true;requestEvents.close();},end(){this.writableEnded=true;requestEvents.close();}};
    const streams=new Set(),request={on(type,fn){requestEvents[type]=fn;}};
    const invoke=runInNewContext('(function(){'+body.slice(0,body.lastIndexOf('  }'))+'})',{
      response,request,streamMatch:['','run'],Buffer,JSON,eventStreams:streams,auth:{session:()=>true},store:{getRun(){},subscribe(fn){listener=fn;return()=>{unsubscribed=true;};}},setInterval(fn){heartbeat=fn;return 1;},clearInterval(){cleared=true;}
    });invoke();
    return {response,responseEvents,writes,streams,emit(message='event'){listener({runId:'run',message});},beat(){heartbeat();},closed:()=>unsubscribed&&cleared};
  }
  const drained=connection();drained.response.accept=false;drained.emit();drained.responseEvents.drain();drained.response.accept=true;drained.emit();assert.equal(drained.response.destroyed,false);
  const slow=connection();slow.response.accept=false;slow.emit();slow.emit();assert.equal(slow.response.destroyed,true);assert.equal(slow.streams.size,0);assert.ok(slow.closed());
  const overflow=connection();overflow.response.writableLength=256*1024;overflow.beat();assert.equal(overflow.response.destroyed,true);assert.equal(overflow.writes.length,1,'oversized buffer receives no additional frame');assert.ok(overflow.closed());
});

const fixture = () => ({ runs: [{ id: "r", taskId: "t" }], tasks: [{ id: "t", title: "代码开发" }],
  communicationConversations: [{ id: "c", kind: "agent", name: "员工" }, { id: "g", kind: "team", name: "团队" }],
  communicationDeliveries: [{ id: "d", status: "done" }],
  events: [{ id: "e1", runId: "r", type: "trace.failed", timestamp: "2026-10-15T01:00:00Z", message: "ENOENT SECRET_SENTINEL", data: { traceId: "tr", raw: "SECRET_SENTINEL" } }],
  communicationEvents: [{ id: "e2", conversationId: "c", deliveryId: "d", type: "failed", createdAt: "2026-10-15T02:00:00Z", content: "401 SECRET_SENTINEL", attempt: 1 }, { id: "e3", conversationId: "g", type: "completed", createdAt: "2026-10-15T03:00:00Z", content: "SECRET_SENTINEL" }] });

test("global logs merge task/private/group facts without content or credentials", () => {
  const state = fixture(), original = structuredClone(state), result = executionLogs(state);
  assert.deepEqual(result.items.map(row => row.source), ["group", "private", "task"]);
  assert.equal(result.items[1].currentStatus, "done");
  assert.equal(result.items[1].level, "error");
  assert.match(result.items[1].message, /登录已失效/);
  assert.match(result.items[2].message, /CLI 不可启动/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL/);
  assert.deepEqual(state, original);
});

test("log filters and stable older cursor reject invalid queries", () => {
  const state = fixture();
  assert.equal(executionLogs(state, { source: "private", level: "error" }).items.length, 1);
  const first = executionLogs(state, { limit: 1 });
  assert.equal(first.hasMore, true);
  state.communicationEvents.push({ id: "e4", conversationId: "g", type: "started", createdAt: "2026-10-15T04:00:00Z" });
  assert.equal(executionLogs(state, { before: first.nextBefore, limit: 1 }).items[0].id, "e2");
  for (const query of [{ limit: 201 }, { limit: 0 }, { source: "invalid" }, { level: "secret" }, { before: "missing" }]) assert.throws(() => executionLogs(state, query));
});

test("tool failure is not described as provider failure and unknown failures stay generic", () => {
  const state = fixture();
  state.events.push({id: "tool", runId: "r", type: "runtime.event", timestamp: "2026-10-15T05:00:00Z", message: "SECRET_SENTINEL", data: {auditVersion: 2, status: "failed", toolName: "Bash", input: "SECRET_SENTINEL"}});
  const row = executionLogs(state, {source: "task", level: "error"}).items[0];
  assert.equal(row.level, "error");
  assert.match(row.message, /工具执行失败/);
  assert.doesNotMatch(JSON.stringify(row), /SECRET_SENTINEL/);
  state.communicationEvents[0].content = "SECRET_SENTINEL";
  assert.match(executionLogs(state, {source: "private"}).items[0].message, /执行未完成/);
});

test("Store audit logs survive reopening with failure and recovery facts intact", async () => {
  await mkdir('.data', {recursive: true});
  const root = await mkdtemp(resolve('.data/execution-logs-test-'));
  const options = {databasePath: join(root, 'state.sqlite')};
  const store = createStore(options);
  const agent = store.listAgents().find(row => !row.system);
  const conversation = store.openCommunication({kind: 'agent', targetId: agent.id});
  store.sendCommunication(conversation.id, {content: 'SECRET_SENTINEL', clientRequestId: 'logging-test-message'});
  const delivery = store.claimCommunication(conversation.id);
  store.failCommunication(conversation.id, delivery.id, 'ENOENT SECRET_SENTINEL');
  store.retryCommunication(conversation.id, delivery.id);
  store.claimCommunication(conversation.id);
  store.completeCommunication(conversation.id, delivery.id, 'SECRET_SENTINEL');
  const reopened = createStore(options).getExecutionLogs({source: 'private'});
  assert.ok(reopened.items.some(row => row.type === 'failed' && row.currentStatus === 'done'));
  assert.ok(reopened.items.some(row => row.type === 'retry'));
  assert.ok(reopened.items.some(row => row.type === 'completed'));
  assert.doesNotMatch(JSON.stringify(reopened), /SECRET_SENTINEL/);
});

test('indexed Store logs match the shared projection across equal timestamps, filters and cursors',async()=>{
  const {createSqlitePersistence}=await import('../server/persistence.mjs');
  const {tmpdir}=await import('node:os'),{rm}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'af-log-index-')),databasePath=join(root,'db.sqlite'),seed=createStore();
  const initial=seed.snapshot();seed.close();const value=fixture();Object.assign(initial,value);
  value.events.push({id:'e0',runId:'r',type:'runtime.event',timestamp:'2026-10-15T03:00:00Z',data:{presentation:'error'}});
  const disk=createSqlitePersistence(databasePath);disk.save(initial);disk.close();const store=createStore({databasePath});
  try {
    for(const source of ['all','task','private','group'])for(const level of ['all','error']){
      const expected=executionLogs(value,{source,level,limit:1}),actual=store.getExecutionLogs({source,level,limit:1});assert.deepEqual(actual,expected);
      if(actual.hasMore)assert.deepEqual(store.getExecutionLogs({source,level,limit:1,before:actual.nextBefore}),executionLogs(value,{source,level,limit:1,before:actual.nextBefore}));
    }
  } finally {store.close();await rm(root,{recursive:true,force:true});}
});
