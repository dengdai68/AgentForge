import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDesktopNotifications,desktopNotice} from '../apps/electron/notifications.mjs';
import {createStore} from '../server/store.mjs';

const task={id:'evt_live',type:'run.awaiting_acceptance',runId:'run_live',taskId:'task_live',title:'通知验收任务'};
const chat={id:'chat_message_live',type:'communication.message',conversationId:'chat_live',title:'通知验收群',senderName:'验收员工'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const created=[],opened=[],diagnostics=[];let loggedIn=true,current=true;
 class Native extends EventEmitter { static isSupported(){return true;} constructor(options){super();this.options=options;created.push(this);}show(){this.emit('show');}close(){this.closed=true;this.emit('close');} }
 const notifier=createDesktopNotifications({Notification:Native,authorized:async()=>loggedIn,openTarget:async route=>opened.push(route),onDiagnostic:(...args)=>diagnostics.push(args)});
 return {notifier,created,opened,diagnostics,Native,logout(){loggedIn=false;notifier.clear();},stale(){current=false;},current:()=>current};}

test('native notices contain bounded metadata and only exact local task/chat routes',()=>{
 assert.equal(desktopNotice(task).route,'/runs/run_live');assert.equal(desktopNotice(chat).route,'/communication/chat_live');
 for(const bad of [null,{},[],{...task,runId:'../escape'},{...chat,conversationId:'https://evil.invalid'},{...task,type:'provider.stdout'},{...chat,senderName:''}])assert.equal(desktopNotice(bad),null);
 const notice=desktopNotice({...chat,content:'PRIVATE_MESSAGE',prompt:'PRIVATE_PROMPT',title:'api_key: PRIVATE_SENTINEL\n'+ 'x'.repeat(500)});assert.ok(notice.options.body.length<=160);assert.ok(!JSON.stringify(notice).includes('PRIVATE_'));assert.ok(!notice.options.body.includes('\n'));assert.equal(notice.options.groupId,'chat-chat_live');
});
test('native notifications deduplicate live events, navigate on click and stop at logout/service replacement',async()=>{
 const f=fixture();assert.equal(await f.notifier.receive(task,f.current),true);assert.equal(await f.notifier.receive(task,f.current),false);assert.equal(f.created.length,1);f.created[0].emit('click');await tick();assert.deepEqual(f.opened,['/runs/run_live']);
 await f.notifier.receive(chat,f.current);f.logout();assert.equal(f.created[1].closed,true);f.created[1].emit('click');await tick();assert.equal(f.opened.length,1);assert.equal(await f.notifier.receive({...chat,id:'new_message'},f.current),false);
 const stale=fixture();await stale.notifier.receive(task,stale.current);stale.stale();stale.created[0].emit('click');await tick();assert.deepEqual(stale.opened,[]);assert.equal(await stale.notifier.receive(chat,stale.current),false);
});
test('notification delivery failures never reject business work and pending auth cannot outlive clear',async()=>{
 const f=fixture();f.Native.prototype.show=function(){throw Error('OS notification denied');};assert.equal(await f.notifier.receive(task),false);assert.ok(f.diagnostics.some(([name])=>name==='failed'));
 let resolve;const pending=new Promise(done=>resolve=done),created=[];class Native{static isSupported(){return true;}constructor(){created.push(this);}}
 const notifier=createDesktopNotifications({Notification:Native,authorized:()=>pending,openTarget(){}}),receive=notifier.receive(task);notifier.clear();resolve(true);assert.equal(await receive,false);assert.deepEqual(created,[]);
});

test('Store publishes future task and communication metadata only after commit, without replay or duplicates',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-notice-store-')),options={databasePath:join(root,'records/state.sqlite'),workspaceRoot:join(root,'work')};let store=createStore(options);t.after(()=>{store.close();return rm(root,{recursive:true,force:true});});
 const agent=store.createAgent({name:'通知员工'}),task=store.createTask({title:'通知任务',objective:'仅测试事务通知',memberAgentIds:[agent.id],managerAgentId:agent.id}),run=store.createRun(task.id),notices=[];const unsubscribe=store.subscribeNotifications(notice=>notices.push(notice));
 assert.deepEqual(notices,[]);store.initializeDispatches(run.id);const dispatch=store.claimDispatch(run.id);store.completeDispatch(dispatch.id);store.transaction(()=>{store.requestHumanAcceptance(run.id);assert.deepEqual(notices,[]);});assert.equal(notices[0].type,'run.awaiting_acceptance');assert.equal(notices[0].title,task.title);assert.equal(notices[0].runId,run.id);
 store.confirmRunCompletion(run.id);assert.equal(notices.at(-1).type,'run.completed');
 const conversation=store.openCommunication({kind:'agent',targetId:agent.id});store.sendCommunication(conversation.id,{content:'PRIVATE_HUMAN_MESSAGE',clientRequestId:'notice-private-send'});const delivery=store.claimCommunication(conversation.id);const before=notices.length;store.transaction(()=>{store.completeCommunication(conversation.id,delivery.id,'PRIVATE_AGENT_REPLY');assert.equal(notices.length,before);});assert.equal(notices.length,before+1);const message=notices.at(-1);assert.equal(message.type,'communication.message');assert.equal(message.conversationId,conversation.id);assert.ok(!JSON.stringify(message).includes('PRIVATE_'));store.completeCommunication(conversation.id,delivery.id,'duplicate');assert.equal(notices.length,before+1);
 store.sendCommunication(conversation.id,{content:'rollback',clientRequestId:'notice-rollback-send'});const pending=store.claimCommunication(conversation.id);assert.throws(()=>store.transaction(()=>{store.completeCommunication(conversation.id,pending.id,'not committed');throw Error('rollback');}),/rollback/);assert.equal(notices.length,before+1);
 store.subscribeNotifications(()=>{throw Error('presentation failure');});store.completeCommunication(conversation.id,pending.id,'committed despite listener error');assert.equal(notices.length,before+2);unsubscribe();store.close();store=createStore(options);const replay=[];store.subscribeNotifications(notice=>replay.push(notice));store.getTask(task.id);store.getCommunication(conversation.id);assert.deepEqual(replay,[]);
});
