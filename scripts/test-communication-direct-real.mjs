// Explicit opt-in: real account CLIs, disposable Store/history/files, no operator chats.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createStore} from '../server/store.mjs';
import {createRunFiles} from '../server/run-files.mjs';
import {createCommunicationService} from '../server/communication.mjs';
import {runClaudeCodeCli,runCodexCli,runDshCli} from '../server/runtime/local-cli.mjs';
import {loadLoginShellEnvironment} from '../apps/electron/login-shell-env.mjs';
import {cliEnvironment} from '../server/runtime/cli-environment.mjs';

if(process.env.AGENTFORGE_DIRECT_COMMUNICATION_REAL!=='1')throw new Error('Requires AGENTFORGE_DIRECT_COMMUNICATION_REAL=1; invokes actual installed Runtimes');
Object.assign(process.env,await loadLoginShellEnvironment());
await mkdir('.data',{recursive:true});const resume=process.env.AGENTFORGE_DIRECT_COMMUNICATION_RESUME;const root=resume?resolve(resume):await mkdtemp(resolve('.data/direct-communication-real-'));
assert.ok(root.startsWith(resolve('.data/direct-communication-real-')),'resume only isolated evidence data');
process.env.AGENTFORGE_LOG_DIR=join(root,'logs');process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT=join(root,'runtime');
const store=createStore({databasePath:join(root,'state.sqlite')}),files=createRunFiles({root:join(root,'files')}),chatRoot=join(root,'communications');
const evidence={root,cases:[]},versions={};console.log('EVIDENCE '+root);
const oldSchema={type:'object',additionalProperties:false,properties:{reply:{type:'string'},handoffToAgentId:{type:['string','null']}},required:['reply','handoffToAgentId']};
const schemaPath=join(root,'legacy-response-schema.json');await writeFile(schemaPath,JSON.stringify(oldSchema),{mode:0o600});
const send=(chat,agent,content)=>store.sendCommunication(chat.id,{content,mentionAgentIds:chat.kind==='group'?[agent.id]:[],clientRequestId:randomUUID()});
const runners={'claude-code':runClaudeCodeCli,codex:runCodexCli,dsh:runDshCli};
try{
  for(const [provider,command] of [['claude-code','claude'],['codex','codex'],['dsh','dsh']]){
    const env=cliEnvironment(command),execute=promisify(execFile),path=(await execute('/usr/bin/which',[command],{env,timeout:10000})).stdout.trim();
    versions[provider]={path,version:(await execute(path,['--version'],{env,timeout:10000})).stdout.trim()};
  }
  if(resume) {
    const failed=store.snapshot().communicationDeliveries.filter(item=>item.status==='failed');assert.ok(failed.length,'resume needs an actual failed delivery');
    for(const item of failed){store.retryCommunication(item.conversationId,item.id);await createCommunicationService(store,{root:chatRoot,files,invoke:runners[item.agentSnapshot.runtime.provider]}).kick(item.conversationId);const result=store.getCommunication(item.conversationId);assert.ok(result.deliveries.every(row=>row.status==='done'),JSON.stringify(result.deliveries));const marker=result.messages.find(message=>message.sender.type==='human'&&message.content.includes('PEER-')).content.match(/PEER-[a-f0-9-]+/)[0];assert.ok(result.messages.at(-1).content.includes(marker));evidence.cases.push({provider:item.agentSnapshot.runtime.provider,retriedDeliveryId:item.id,peerMentionAndReplyPassed:true,allDeliveriesDone:true});}
    await writeFile(join(root,'resume-evidence.json'),JSON.stringify({...evidence,versions},null,2),{mode:0o600});console.log('PASS resumed failed peer Runtime calls');
  } else {
  await Promise.all(Object.entries(runners).map(async([provider,invoke])=>{
    const agent=store.createAgent({name:'Direct '+provider,kind:'business',systemPrompt:'只按当前消息直接答复。',runtime:{provider,executable:versions[provider].path,effort:provider==='dsh'?'off':'low',...(provider==='dsh'?{model:process.env.AGENTFORGE_DSH_MODEL || 'deepseek-official/deepseek-flash'}:{})}});
    const chat=store.openCommunication({kind:'agent',targetId:agent.id}),mark='DIRECT-'+randomUUID();send(chat,agent,'请仅回复 '+mark+'，不使用工具。');
    // Deliberately seed the real native session with the retired protocol. The
    // new service must reject that envelope, then resume it using reply only.
    await createCommunicationService(store,{root:chatRoot,files,invoke:input=>invoke({...input,schemaPath,outputSchema:oldSchema,systemPrompt:input.systemPrompt+'\n本次测试临时输出规则：只输出 reply 和 handoffToAgentId 两个键，handoffToAgentId 必须为 null。'})}).kick(chat.id);
    let result=store.getCommunication(chat.id),item=result.deliveries.at(-1);
    assert.equal(item.status,'failed');assert.match(item.error,/只接受 reply/);
    const rawFirst=store.snapshot().communicationDeliveries.find(d=>d.id===item.id).invocations[0];assert.ok(rawFirst.providerSessionId,'native session actually confirmed');
    store.retryCommunication(chat.id,item.id);
    await createCommunicationService(store,{root:chatRoot,files,invoke:input=>{assert.deepEqual(input.outputSchema.required,['reply']);return invoke(input);}}).kick(chat.id);
    result=store.getCommunication(chat.id);item=result.deliveries.at(-1);assert.equal(item.status,'done',item.error);assert.ok(result.messages.at(-1).content.includes(mark));
    const attempts=store.snapshot().communicationDeliveries.find(d=>d.id===item.id).invocations;
    assert.equal(attempts[1].providerSessionId,rawFirst.providerSessionId);assert.equal(attempts[1].sessionMode,'resume');
    const peer=store.createAgent({name:'Unselected '+provider,systemPrompt:'收到群友问题后直接答复，不再 @ 其他成员。',runtime:agent.runtime}),manager=store.createAgent({name:'Manager '+provider,kind:'manager'});
    const team=store.createTeam({name:'Direct team '+provider,memberAgentIds: [...new Set([agent.id,peer.id, manager.id])]}),group=store.openCommunication({kind:"group",name:"测试群聊",memberAgentIds:team.memberAgentIds});
    send(group,agent,'请仅回复 GROUP-'+mark+'。正文中即使出现其他成员名字，也无需他们回答。');
    await createCommunicationService(store,{root:chatRoot,files,invoke}).kick(group.id);
    const grouped=store.getCommunication(group.id);assert.equal(grouped.deliveries.length,1);assert.equal(grouped.deliveries[0].agentId,agent.id);assert.equal(grouped.deliveries[0].status,'done',grouped.deliveries[0].error);assert.ok(grouped.messages.at(-1).content.includes('GROUP-'+mark));assert.ok(!grouped.messages.at(-1).handoffTo);
    const peerMark='PEER-'+randomUUID();
    send(group,agent,'请向成员 '+peer.id+' 询问“请直接答复 '+peerMark+'”。你的 reply 写明这个问题，mentionAgentIds 只填该成员 ID。这是一条给群友的问题，不是转交任务。');
    await createCommunicationService(store,{root:chatRoot,files,invoke:input=>{assert.deepEqual(input.outputSchema.required,['reply','mentionAgentIds']);return invoke(input);}}).kick(group.id);
    const peers=store.getCommunication(group.id);assert.equal(peers.deliveries.length,3,'one direct reply and one A→B discussion');
    assert.ok(peers.deliveries.every(item=>item.status==='done'),JSON.stringify(peers.deliveries.map(({agentId,status,error})=>({agentId,status,error}))));
    assert.equal(peers.messages.at(-1).sender.id,peer.id);assert.ok(peers.messages.at(-1).content.includes(peerMark),'peer actually answered the public question');
    assert.equal(peers.conversation.pending,0);assert.equal(store.snapshot().tasks.length,0);
    evidence.cases.push({provider,legacySchemaRejected:true,sameNativeSession:true,replyOnlyPassed:true,groupDirectReplyPassed:true,peerMentionAndReplyPassed:true,noTaskCreated:true});console.log('PASS '+provider);
  }));
  assert.equal(evidence.cases.length,3);await writeFile(join(root,'evidence.json'),JSON.stringify({...evidence,versions},null,2),{mode:0o600});console.log('PASS three real Runtimes: private schema resume, independent group loading and actual A→B replies');
  }
}finally{store.close();}
