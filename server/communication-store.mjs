import { copyState } from "./state-journal.mjs";
import { randomUUID, createHash } from "node:crypto";
import { communicationVisibility } from "./history/index.mjs";

const copy = copyState;
const now = () => new Date().toISOString();
const id = (prefix) => prefix + "_" + randomUUID();

// Invoked only inside createStore. No IO, Provider calls or external domain writes.
export function communicationCommands(state, save, employeeSnapshot, journal, persistence) {
  for (const key of ["communicationConversations", "communicationMessages", "communicationDeliveries", "communicationEvents", "communicationAttachments"]) state[key] ||= [];
  let migratedReadState = false;
  for (const thread of state.communicationConversations) if (!Object.hasOwn(thread, "humanReadThroughMessageId")) {
    thread.humanReadThroughMessageId = journal.select("communicationMessages", "conversationId", thread.id).at(-1)?.id || null;
    migratedReadState = true;
  }
  if (migratedReadState) save();
  const conversation = (key) => {
    const item = journal.get("communicationConversations", key);
    if (!item) throw new Error("沟通会话不存在");
    return item;
  };
  const delivery = (conversationId, key) => {
    conversation(conversationId);
    const item = journal.get("communicationDeliveries", key);
    if (!item || item.conversationId !== conversationId) throw new Error("沟通投递不存在");
    return item;
  };
  const rosterIds = thread => {
    if (thread.kind === "agent") return [thread.targetId];
    if (thread.memberAgentIds) return thread.memberAgentIds;
    // Read saved legacy conversations without rewriting messages or sessions.
    const recorded = journal.select("communicationMessages", "conversationId", thread.id).flatMap(row => row.visibleToAgentIds || []);
    const team = journal.get("teams", thread.targetId);
    return [...new Set(recorded.length ? recorded : [...(team?.memberAgentIds || []), team?.managerAgentId].filter(Boolean))];
  };
  const members = thread => rosterIds(thread).map(value => journal.get("agents", value)).filter(row => row && row.status !== "deleted").map(row => ({
    id: row.id, name: row.name, kind: row.kind, status: row.status, description: row.description, color: row.color, initials: row.initials,
    systemPrompt: row.systemPrompt, capabilities: copy(row.capabilities || []),
    roles: (row.roleIds || []).map(value => journal.get("roles", value)).filter(Boolean).map(role => ({ id: role.id, name: role.name, prompt: role.prompt }))
  }));
  const validateMembers = ids => {
    if (!Array.isArray(ids) || ids.some(value => typeof value !== "string") || new Set(ids).size !== ids.length) throw new Error("群聊成员必须是不重复的数字员工 ID 数组");
    if (ids.some(value => !state.agents.some(row => row.id === value && row.status !== "deleted"))) throw new Error("群聊成员不存在或已删除");
    return [...ids];
  };
  const groupName = value => { if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new Error("群聊名称需为 1–100 字符"); return value.trim(); };
  const detachTeam = teamId => {
    for (const thread of state.communicationConversations.filter(row => row.kind === "team" && row.targetId === teamId)) {
      thread.memberAgentIds = rosterIds(thread); thread.kind = "group"; delete thread.targetId;
    }
  };
  // Failed replies remain visible and require explicit retry after the cause is fixed.
  const pending = (item) => !["done", "cancelled"].includes(item.status);
  const unread = thread => {
    if(!journal.changes.has('communicationMessages'))return persistence.communicationUnread(thread);
    const rows=journal.select('communicationMessages','conversationId',thread.id);
    const readIndex=rows.findIndex(row=>row.id===thread.humanReadThroughMessageId);
    let count=0;for(let i=readIndex+1;i<rows.length;i++)if(rows[i].sender.type==='agent')count++;
    return count;
  };
  const summary = (thread, details = false) => {
    const target = thread.kind === "agent" ? journal.get("agents", thread.targetId) : null;
    const last = journal.select("communicationMessages", "conversationId", thread.id,{last:1})[0];
    const unreadCount=unread(thread),pendingRows=['queued','claimed','running','failed'].flatMap(status=>journal.select('communicationDeliveries','status',status)).filter(row=>row.conversationId===thread.id);
    return { id: thread.id, kind: thread.kind === "agent" ? "agent" : "group", ...(thread.kind === "agent" ? { targetId: thread.targetId } : {}), name: target?.name || thread.name, unreadCount, createdAt: thread.createdAt, updatedAt: thread.updatedAt, members: members(thread).map(({systemPrompt,roles,...member}) => ({ ...(details ? { ...member, systemPrompt, roles } : member), running: pendingRows.some(row => row.agentId === member.id && row.status === "running") })), preview: last?.content.slice(0, 100) || last?.attachments?.map(row => row.name).join('、').slice(0, 100) || "", pending: pendingRows.length };
  };
  const page = (rows, before, limit) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("分页大小必须为 1–200");
    const end = before ? rows.findIndex((row) => row.id === before) : rows.length;
    if (end < 0) throw new Error("沟通游标不存在");
    const start = Math.max(0, end - limit), items = rows.slice(start, end);
    return { items: copy(items), hasMore: start > 0, nextBefore: items[0]?.id || null };
  };
  const event = (item, type, content, data = {}) => {
    state.communicationEvents.push({ id: id("chat_event"), conversationId: item.conversationId, deliveryId: item.id, agentId: item.agentId, attempt: item.attempts, type, content, data: copy(data), createdAt: now() });
  };
  const attachment = (key, attachmentId) => {
    conversation(key);
    const item = journal.get("communicationAttachments", attachmentId);
    if (!item || item.conversationId !== key) throw new Error("附件不属于当前会话或不存在");
    return item;
  };
  const callId = row => `${row.deliveryId}_${row.attempt}`;
  // Delivery snapshots embed the bound role's text at send/retry time, exactly
  // like the employee's own systemPrompt: later role edits apply to subsequent
  // deliveries, never rewrite queued or historical snapshots.
  const withRole = (agent) => {
    if (!agent) return agent;
    if(employeeSnapshot)return employeeSnapshot(copy(agent));
    const roleSnapshots=(agent.roleIds || []).map(roleId=>{const role=(state.roles || []).find(row=>row.id===roleId);if(!role)throw new Error('绑定的角色不存在');return {id:role.id,name:role.name,prompt:role.prompt};});
    return {...copy(agent),roleSnapshots};
  };
  return {
    communicationUnreadCount() { return state.communicationConversations.filter(thread=>thread.kind!=='agent'||journal.get('agents',thread.targetId)?.status!=='deleted').reduce((sum,thread)=>sum+unread(thread),0); },
    registerCommunicationAttachment(key, record) {
      conversation(key);
      if (!record || !/^attachment_[a-f0-9-]{36}$/.test(record.id) || typeof record.name !== 'string' || !record.name || /[/\\\0]/.test(record.name) || record.path !== `attachments/${record.id}/${record.name}` || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > 20 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('附件元数据无效');
      if (journal.get("communicationAttachments", record.id)) throw new Error('附件已存在');
      const item = { id: record.id, name: record.name, path: record.path, bytes: record.bytes, sha256: record.sha256, conversationId: key, createdAt: now() };
      state.communicationAttachments.push(item); save(); return copy(item);
    },
    getCommunicationAttachment(key, attachmentId) { return copy(attachment(key, attachmentId)); },
    openCommunication(input = {}) {
      const { kind, targetId } = input;
      if (kind === "agent") {
        const target = state.agents.find(row => row.id === targetId && row.status !== "deleted");
        if (!target) throw new Error("沟通对象不存在或已删除");
        let thread = state.communicationConversations.find(row => row.kind === "agent" && row.targetId === targetId);
        if (!thread) { thread = { id: id("chat"), kind, targetId, name: target.name, createdAt: now(), updatedAt: now(), sessions: {}, humanReadThroughMessageId: null }; state.communicationConversations.push(thread); save(); }
        return summary(thread);
      }
      if (kind !== "group" || Object.hasOwn(input, "targetId")) throw new Error("群聊独立创建，请提交 kind=group、name 和 memberAgentIds，不再绑定团队");
      const memberAgentIds = validateMembers(input.memberAgentIds);
      if (!memberAgentIds.length) throw new Error("新群聊至少选择一位数字员工");
      const name = input.name === undefined ? memberAgentIds.map(value => journal.get("agents", value).name).join("，") : groupName(input.name);
      const thread = { id: id("chat"), kind: "group", name, memberAgentIds, createdAt: now(), updatedAt: now(), sessions: {}, humanReadThroughMessageId: null };
      state.communicationConversations.push(thread); save(); return summary(thread);
    },
    updateCommunication(key, input = {}) {
      const thread = conversation(key);
      if (thread.kind === "agent") throw new Error("私聊不能编辑群名称或成员");
      if (!input || !Object.keys(input).length || Object.keys(input).some(value => !["name", "memberAgentIds"].includes(value))) throw new Error("仅可更新群聊名称与 memberAgentIds");
      const name = input.name === undefined ? thread.name : groupName(input.name), ids = input.memberAgentIds === undefined ? rosterIds(thread) : validateMembers(input.memberAgentIds);
      return this.transaction(() => {
        thread.kind = "group"; delete thread.targetId; thread.name = name; thread.memberAgentIds = ids; thread.updatedAt = now();
        for (const item of journal.select("communicationDeliveries", "conversationId", key).filter(row => !ids.includes(row.agentId) && ["queued", "failed"].includes(row.status))) {
          item.status = "cancelled"; item.nextAttemptAt = null; item.updatedAt = now(); event(item, "cancelled", "成员已离开群聊，待回复取消；历史保留");
        }
        save(); return summary(thread);
      });
    },
    detachCommunicationTeam(teamId) { detachTeam(teamId); },
    detachCommunicationMember(agentId) {
      for (const thread of state.communicationConversations.filter(row => row.kind !== "agent" && rosterIds(row).includes(agentId))) {
        thread.memberAgentIds = rosterIds(thread).filter(value => value !== agentId); thread.kind = "group"; delete thread.targetId;
      }
      for (const item of state.communicationDeliveries.filter(row => row.agentId === agentId && ["queued", "failed"].includes(row.status))) {
        item.status = "cancelled"; item.nextAttemptAt = null; item.updatedAt = now(); event(item, "cancelled", "员工已删除，待回复取消；历史保留");
      }
    },
    listCommunications(query) {
      if(query){const page=persistence.queryEntities('communicationConversations',query);return {...page,items:page.items.map(id=>summary(conversation(id)))};}
      return state.communicationConversations.filter(thread=>thread.kind!=='agent'||journal.get('agents',thread.targetId)?.status!=='deleted').map(thread=>summary(thread)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    },
    markCommunicationRead(key, messageId) {
      const thread = conversation(key),target=journal.get('communicationMessages',messageId),next=target?.conversationId===key?journal.entry('communicationMessages',messageId).position:-1;
      if (next < 0) throw new Error("已读消息不属于当前会话");
      const previous = journal.entry('communicationMessages',thread.humanReadThroughMessageId)?.position??-1;
      if (next > previous) { thread.humanReadThroughMessageId = messageId; save(); }
      return summary(thread);
    },
    getCommunication(key, { before = null, limit = 100, since = null } = {}) {
      const revision=['communicationConversations','communicationMessages','communicationDeliveries','agents','roles'].map(name=>journal.version(name)).join(':');
      if(since===revision&&!before){conversation(key);return {unchanged:true,revision};}
      if(!Number.isInteger(limit)||limit<1||limit>200)throw new Error('分页大小必须为 1–200');
      const thread=conversation(key),window=journal.select('communicationMessages','conversationId',key,{before,last:limit+1}),items=window.slice(-limit);
      const result={items:copy(items),hasMore:window.length>limit,nextBefore:items[0]?.id||null};
      const messageIds = new Set(result.items.map((row) => row.id));
      return { revision, conversation: summary(thread, true), messages: result.items, hasMore: result.hasMore, nextBefore: result.nextBefore,
        deliveries: copy([...new Map([...messageIds].flatMap(id=>journal.select('communicationDeliveries','messageId',id)).concat(['queued','claimed','running','failed'].flatMap(status=>journal.select('communicationDeliveries','status',status)).filter(row=>row.conversationId===key)).map(row=>[row.id,row])).values()]).map(({ agentSnapshot, invocations, ...row }) => row) };
    },
    sendCommunication(key, { content = '', mentionAgentIds = [], attachmentIds = [], clientRequestId } = {}) {
      const thread = conversation(key);
      if (!Array.isArray(attachmentIds) || attachmentIds.some(value => typeof value !== 'string') || new Set(attachmentIds).size !== attachmentIds.length) throw new Error('附件列表无效');
      const attachments = attachmentIds.map(value => copy(attachment(key, value)));
      if (typeof content !== "string" || (!content.trim() && !attachments.length) || content.length > 32000) throw new Error("消息需为 1–32000 字符，或包含附件");
      if (typeof clientRequestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(clientRequestId)) throw new Error("发送请求标识无效");
      if (!Array.isArray(mentionAgentIds) || mentionAgentIds.some((item) => typeof item !== "string")) throw new Error("@ 成员列表无效");
      const previous = journal.select("communicationMessages", "clientRequestId", clientRequestId).find(row => row.conversationId === key);
      if (previous) {
        if (previous.content !== content || JSON.stringify(previous.mentionAgentIds) !== JSON.stringify([...new Set(mentionAgentIds)]) || JSON.stringify((previous.attachments || []).map(row => row.id)) !== JSON.stringify(attachmentIds)) throw new Error("发送标识已用于另一条消息");
        return copy(previous);
      }
      if (!Array.isArray(mentionAgentIds) || mentionAgentIds.some((item) => typeof item !== "string")) throw new Error("@ 成员列表无效");
      const mentioned = [...new Set(mentionAgentIds)], roster = members(thread);
      if (mentioned.some((key) => !roster.some((member) => member.id === key && member.status === "active"))) throw new Error("@ 成员不在当前群聊或已停用");
      const recipients = thread.kind === "agent" ? [thread.targetId] : mentioned.length ? mentioned : roster.filter((member) => member.status === "active").map((member) => member.id);
      if (recipients.some((key) => !roster.some((member) => member.id === key && member.status === "active"))) throw new Error("数字员工已停用");
      if (!recipients.length) throw new Error("没有可回复的群聊成员，请先添加可用员工");
      for (const agentId of recipients) this.assertRuntimeEnabled(journal.get("agents", agentId).runtime);
      const message = { id: id("chat_message"), conversationId: key, clientRequestId, sender: { type: "human", id: "human_operator", name: "你" }, content, attachments, mentionAgentIds: mentioned, visibleToAgentIds: roster.map(member => member.id), createdAt: now(), replyToMessageId: null };
      const deliveries = recipients.map((agentId) => ({ id: id("chat_delivery"), conversationId: key, messageId: message.id, rootMessageId: message.id, agentId, agentSnapshot: withRole(journal.get("agents", agentId)), status: "queued", attempts: 0, createdAt: now(), updatedAt: now(), nextAttemptAt: null, error: null }));
      state.communicationMessages.push(message); state.communicationDeliveries.push(...deliveries); thread.updatedAt = now(); save();
      return copy(message);
    },
    claimCommunication(key) {
      const thread = conversation(key), queue = ['queued','claimed','running','failed'].flatMap(status=>journal.select('communicationDeliveries','status',status)).filter(row=>row.conversationId===key).sort((a,b)=>journal.entry('communicationDeliveries',a.id).position-journal.entry('communicationDeliveries',b.id).position);
      // FIFO per member; an unavailable member must not block other group members.
      for (const candidate of queue) if (["queued", "failed"].includes(candidate.status) && !members(thread).some(member => member.id === candidate.agentId && member.status === "active")) { candidate.status = "cancelled"; candidate.nextAttemptAt = null; event(candidate, "cancelled", "成员已离开或不可用，待回复取消"); save(); }
      const seen = new Set();
      const item = queue.find((candidate) => {
        if (seen.has(candidate.agentId)) return false;
        seen.add(candidate.agentId);
        return candidate.status === "queued";
      });
      if (!item) return null;
      item.status = "running"; item.attempts++; item.updatedAt = now(); event(item, "started", "开始回复"); save();
      return copy({ ...item, available: members(thread).some((member) => member.id === item.agentId && member.status === "active") });
    },
    communicationContext(key, deliveryId) {
      const thread = conversation(key), item = delivery(key, deliveryId);
      const all = journal.select("communicationMessages", "conversationId", key, {idsOnly:true});
      const cutoff = all.indexOf(item.messageId), current=journal.get('communicationMessages',item.messageId);
      const through = thread.sessions[item.agentId]?.inputThroughMessageId;
      const previous = through ? all.indexOf(through) : cutoff - 1;
      const selected=new Set([...all.slice(previous+1,cutoff+1),item.messageId,current.replyToMessageId].filter(Boolean));
      const messages = [...selected].map(id=>journal.get('communicationMessages',id)).filter(row=>row?.conversationId===key&&communicationVisibility(state,thread,row).includes(item.agentId)&&
        (row.id===item.messageId||row.id===current.replyToMessageId||row.sender.id!==item.agentId)).sort((a,b)=>journal.entry('communicationMessages',a.id).position-journal.entry('communicationMessages',b.id).position);
      return { conversation: summary(thread, true), messages: copy(messages), message: copy(current) };
    },
    prepareCommunicationSession(key, deliveryId, cwd) {
      const thread = conversation(key), item = delivery(key, deliveryId);
      if (item.status !== "running") throw new Error("投递未执行");
      const provider = item.agentSnapshot.runtime.provider;
      const runtime = item.agentSnapshot.runtime;
      const connectionKey = createHash('sha256').update(JSON.stringify([runtime.provider, runtime.executable || null, runtime.model || '', runtime.profile || ''])).digest('hex');
      let session = thread.sessions[item.agentId];
      const inputThroughMessageId = session?.inputThroughMessageId;
      // Persona and selected extensions are reapplied to each invocation. They
      // do not change native conversation identity or erase its memory.
      if (session && (session.provider !== provider || session.cwd !== cwd || session.connectionKey !== connectionKey)) { event(item, "session_reset", "Runtime 连接变化，重建模型上下文，聊天记录保留"); session = null; }
      const resume = Boolean(session?.confirmed);
      if (!session?.sessionId) session = { sessionId: randomUUID(), provider, cwd, confirmed: false, connectionKey, ...(inputThroughMessageId ? { inputThroughMessageId } : {}) };
      session.connectionKey = connectionKey;
      item.invocations ||= [];
      if (!item.invocations.some(row => row.attempt === item.attempts)) item.invocations.push({ attempt: item.attempts, provider, sessionMode: resume ? 'resume' : 'create', providerSessionId: session.confirmed ? session.sessionId : null });
      thread.sessions[item.agentId] = session; save(); return { ...copy(session), resume };
    },
    confirmCommunicationSession(key, deliveryId, sessionId) {
      const thread = conversation(key), item = delivery(key, deliveryId), session = thread.sessions[item.agentId];
      if (item.status !== "running" || !session || typeof sessionId !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(sessionId)) throw new Error("沟通会话绑定无效");
      if ((session.provider === "claude-code" || session.confirmed) && session.sessionId !== sessionId) throw new Error("沟通会话绑定不一致");
      session.sessionId = sessionId; session.confirmed = true;
      const invocation = item.invocations?.find(row => row.attempt === item.attempts);
      if (invocation) invocation.providerSessionId = sessionId;
      save();
    },
    appendCommunicationEvent(key, deliveryId, input) {
      const item = delivery(key, deliveryId); event(item, input.providerEventType || "output", input.message || "", input.data || {}); save();
    },
    completeCommunication(key, deliveryId, content, mentionAgentIds = []) {
      if (!Array.isArray(mentionAgentIds) || mentionAgentIds.some(value => typeof value !== "string") || new Set(mentionAgentIds).size !== mentionAgentIds.length) throw new Error("群聊 @ 必须是不重复的员工 ID 数组，不支持转交参数");
      return this.transaction(() => {
        const item = delivery(key, deliveryId), thread = conversation(key);
        if (item.status === "done") return;
        if (item.status !== "running" || typeof content !== "string" || !content.trim() || content.length > 128000) throw new Error("沟通回复无效");
        const roster = members(thread), rootMessageId = item.rootMessageId || item.messageId;
        if (mentionAgentIds.length && thread.kind === "agent") throw new Error("私聊不能 @ 其他员工");
        if (mentionAgentIds.some(value => value === item.agentId || !roster.some(member => member.id === value && member.status === "active"))) throw new Error("@ 对象必须是群聊中其他可用员工");
        const message = { id: id("chat_message"), conversationId: key, sender: { type: "agent", id: item.agentId, name: item.agentSnapshot.name }, content, mentionAgentIds, visibleToAgentIds: [...new Set([...roster.map(member => member.id), item.agentId])], createdAt: now(), replyToMessageId: item.messageId, deliveryId, rootMessageId };
        state.communicationMessages.push(message); item.status = "done"; item.error = null; item.nextAttemptAt = null; item.updatedAt = now(); thread.updatedAt = now();
        if (thread.sessions[item.agentId]) thread.sessions[item.agentId].inputThroughMessageId = item.messageId;
        const senderPresent = roster.some(member => member.id === item.agentId && member.status === "active");
        // Each new addressed message queues a reply, even for a busy or previously
        // participating member. Completion is idempotent; claim owns per-member FIFO.
        for (const agentId of senderPresent ? mentionAgentIds : []) {
          state.communicationDeliveries.push({ id: id("chat_delivery"), conversationId: key, messageId: message.id, rootMessageId, agentId, agentSnapshot: withRole(journal.get("agents", agentId)), status: "queued", attempts: 0, createdAt: now(), updatedAt: now(), nextAttemptAt: null, error: null });
        }
        event(item, "completed", "回复已保存"); save();
      });
    },
    failCommunication(key, deliveryId, reason, resetSession = false) {
      const item = delivery(key, deliveryId);
      if (item.status !== "running") return;
      item.status = "failed"; item.error = String(reason).slice(0, 2000); item.updatedAt = now();
      item.nextAttemptAt = null;
      event(item, "failed", item.error);
      if (resetSession) { const session = conversation(key).sessions[item.agentId]; if (session) { session.sessionId = null; session.confirmed = false; } event(item, "session_reset", "模型会话不存在，创建新会话但不重放已确认消息；历史仍可按需查询"); }
      save();
    },
    retryCommunication(key, deliveryId) {
      const item = delivery(key, deliveryId);
      if (item.status !== "failed") throw new Error("只能重试失败回复");
      const current = journal.get("agents", item.agentId);
      if (!current || current.status !== "active" || !members(conversation(key)).some(member => member.id === current.id)) throw new Error("成员已离开群聊、停用或删除，不能重试");
      this.assertRuntimeEnabled(current.runtime);
      item.agentSnapshot = withRole(current);
      item.status = "queued"; item.nextAttemptAt = null; event(item, "retry", "请求重试"); save();
    },
    cancelCommunication(key, deliveryId) {
      const item = delivery(key, deliveryId);
      if (!["queued", "failed"].includes(item.status)) throw new Error("只能取消排队或失败回复");
      item.status = "cancelled"; item.updatedAt = now(); event(item, "cancelled", "人类取消待回复，消息和操作记录保留"); save();
    },
    recoverCommunications() {
      for (const item of journal.select("communicationDeliveries", "status", "running")) {
        item.status = "queued"; item.updatedAt = now(); event(item, "recovered", "服务重启，恢复未完成回复");
      }
      save();
    },
    pendingCommunications() { return [...new Set(journal.select("communicationDeliveries", "status", "queued").map((row) => row.conversationId))]; },
    getCommunicationConsole(key, { agentId, before = null, limit = 50 } = {}) {
      const thread = conversation(key), deliveries = persistence.communicationConsoleMembers(key).map(row=>journal.get('communicationDeliveries',row.id));
      const roster = new Map(members(thread).map(row => [row.id, { id: row.id, name: row.name }]));
      for (const row of deliveries.filter(item => {const agent=journal.get('agents',item.agentId);return agent&&agent.status!=='deleted';})) roster.set(row.agentId, { id: row.agentId, name: row.agentSnapshot.name, runtime: { provider: row.agentSnapshot.runtime.provider } });
      const running=new Set(journal.select('communicationDeliveries','status','running').filter(row=>row.conversationId===key).map(row=>row.agentId));
      const agents = [...roster.values()].map(row => ({ ...row, running: running.has(row.id) }));
      if (agentId && !roster.has(agentId)) throw new Error('控制台成员不属于当前会话');
      const result = persistence.communicationEventPage(key,{agentId,before,limit,excludePrompts:true});
      const calls=new Map(result.items.map(row=>[callId(row),row]));
      const traces = [...calls.values()].flatMap(event => {
        const own=persistence.communicationCallEvents(key,event.deliveryId,event.attempt),row=own.find(item=>item.type==='started');
        if(!row)return [];
        const ending = own.findLast(item => ['completed', 'failed'].includes(item.type));
        const item = journal.get('communicationDeliveries',row.deliveryId), invocation = item?.invocations?.find(item => item.attempt === row.attempt);
        const active = item?.attempts === row.attempt && item.status === 'running';
        return { id: callId(row), agentId: row.agentId, type: '沟通调用', startedAt: row.createdAt, status: ending?.type === 'failed' ? 'failed' : ending ? 'completed' : active ? 'running' : 'interrupted',
          providerSessionId: invocation?.providerSessionId || null, sessionMode: invocation?.sessionMode || null, agent: { runtime: { provider: invocation?.provider } },
          promptRef: own.find(item => item.type === 'prompt.snapshot')?.data.contentRef || null };
      });
      return { agents, traces, events: result.items.map(row => ({ id: row.id, timestamp: row.createdAt, actor: { type: 'agent', id: row.agentId, name: roster.get(row.agentId)?.name || '数字员工' },
        type: row.type.startsWith('session.') ? row.type : row.data?.auditVersion === 2 ? 'runtime.event' : `communication.${row.type}`,
        message: row.content, data: { ...row.data, traceId: callId(row), providerEventType: row.type } })), hasMore: result.hasMore, nextBefore: result.nextBefore };
    },
    getCommunicationContentReference(key, eventId, { prompt = false } = {}) {
      conversation(key);
      const call=prompt?/^(.+)_([1-9]\d*)$/.exec(eventId):null;
      const row=prompt?(call?persistence.communicationCallEvents(key,call[1],Number(call[2])).find(item=>item.type==='prompt.snapshot'):null):journal.get('communicationEvents',eventId);
      const reference = row?.data?.contentRef;
      if (!reference || row.conversationId!==key || (!prompt&&row.data?.auditVersion!==2) || !reference.storagePath.startsWith(`communications/${key}/.agentforge/`)) throw new Error('沟通执行内容不存在或不属于当前会话');
      return copy(reference);
    },
    getCommunicationEvents(key, deliveryId, { before = null, limit = 100 } = {}) {
      delivery(key, deliveryId); return persistence.communicationEventPage(key,{deliveryId,before,limit});
    }
  };
}
