import { executionBudget } from "./execution-budget.mjs";
import { withWorkspaceHooks } from './workspace-hooks.mjs';
import { join, resolve } from "node:path";
import { withHistoryTools } from "./history/bridge.mjs";
import { desktopServiceDataRoot } from "./data-home.mjs";
import { createRunFiles } from "./run-files.mjs";
import { runClaudeCodeCli, runCodexCli, runDshCli, promptSnapshot, RuntimeCancelledError, RuntimeSessionMissingError, runtimeFailureDetail, separateRuntimeSession } from "./runtime/local-cli.mjs";
import { diagnostic, withDiagnosticContext } from "./diagnostics.mjs";
import { terminateExecution, registerExecution } from "./runtime/registry.mjs";
import { taskPrompt } from "./prompts.mjs";

// Interpret coordination fields without accepting/rejecting the employee's work.
// Plain text and extra report fields are kept as ordinary handoff content.
export function readNodeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) value = { summary: String(value ?? "") };
  const output = { ...value, kind: "node_result", summary: typeof value.summary === "string" ? value.summary : JSON.stringify(value) };
  for (const field of ["artifacts", "decisions"]) output[field] = Array.isArray(value[field]) ? value[field] : [];
  output.consultation = value.consultation && typeof value.consultation === "object" ? value.consultation : null;
  output.managerDecision = value.managerDecision && typeof value.managerDecision === "object" ? value.managerDecision : null;
  output.deliveryReview = value.deliveryReview && typeof value.deliveryReview === "object" ? value.deliveryReview : null;
  return output;
}
export function parseEmployeeResponse(value) {
  const raw = String(value ?? "").trim();
  const candidates = [raw, ...Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), match => match[1])];
  for (const candidate of candidates) {
    try { return readNodeResult({ ...JSON.parse(candidate), rawResponse: raw }); }
    catch { /* Ordinary text remains a valid employee handoff. */ }
  }
  // CLI text may put one coordination envelope after a natural-language
  // preface. Parse balanced JSON, not a greedy brace regex (strings may contain
  // braces/escaped quotes). Multiple objects or trailing prose stay plain text.
  const objects = [];
  let depth = 0, start = -1, quoted = false, escaped = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (depth && quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (depth && char === '"') quoted = true;
    else if (char === "{") { if (!depth) start = index; depth++; }
    else if (char === "}" && depth && --depth === 0) {
      try { objects.push({ value: JSON.parse(raw.slice(start, index + 1)), start, end: index + 1 }); } catch { /* Not an envelope. */ }
    }
  }
  if (objects.length === 1) {
    const item = objects[0];
    if (!raw.slice(item.end).trim() && /(?:^|\n)\s*$/.test(raw.slice(0, item.start)) &&
        ["managerDecision", "consultation", "deliveryReview", "handoff"].some(key => item.value[key] && typeof item.value[key] === "object")) {
      return readNodeResult({ ...item.value, rawResponse: raw });
    }
  }
  return readNodeResult({ summary: raw });
}
function nodeInfo(task, nodeId) { return task.workflowSnapshot.nodes.find((node) => node.id === nodeId); }
async function provider(input) { if (input.runtime.provider === "dsh") return runDshCli(input); if (input.runtime.provider === "codex") return runCodexCli(input); if (input.runtime.provider !== "claude-code") throw new Error(`不支持的真实运行时：${input.runtime.provider}`); return runClaudeCodeCli(input); }

// Keep redacted original wording separate from automatic retry eligibility.
class RuntimeInvocationError extends Error {
  constructor(error, input) {
    super(runtimeFailureDetail(error, [input.systemPrompt, input.prompt].filter(Boolean).join('\n')));
    this.name = "RuntimeInvocationError";
    this.code = error?.code;
  }
}
class RoutingError extends Error {
  constructor(error) { super(error.message); this.name = 'RoutingError'; }
}
function applyRouting(command) {
  try { return command(); }
  catch (error) { throw new RoutingError(error); }
}
export function failureKindOf(error) {
  if (error instanceof RuntimeInvocationError) return "provider";
  if (error instanceof RuntimeSessionMissingError) return "session";
  return "execution";
}
export function failureSignature(kind, message) {
  const line = String(message || "").split("\n")[0].slice(0, 240);
  return `${kind}:${line.replace(/(?:\/[\w.@+-]+)+\/?/g, "<path>").replace(/\b[a-z]+_[a-z0-9]+_[a-z0-9]+\b/gi, "<id>").replace(/\b[0-9a-f]{8,64}\b/gi, "<hex>").replace(/\d+/g, "<n>")}`;
}
async function invokeRuntime(store, agent, input, files) {
  try {
    store.assertRuntimeEnabled(agent.runtime);
    return await withDiagnosticContext({ traceId: input.traceId }, () => withWorkspaceHooks(files, {...store.getRunTask(input.runId),runId:input.runId}, input, prepared => withHistoryTools(store, agent, prepared, provider, files)));
  } catch (error) {
    if (error instanceof RuntimeCancelledError || error instanceof RuntimeSessionMissingError) throw error;
    diagnostic("task.runtime_error", { error });
    throw new RuntimeInvocationError(error, input);
  }
}
function traceFailureSummary(error) {
  if (error instanceof RuntimeInvocationError || error instanceof RuntimeSessionMissingError || error instanceof RuntimeCancelledError) return error.message || "本机执行未完成。";
  return error?.message || "本次执行未完成，已保留投递重试。";
}
async function capture(files, runId, traceId, workspacePath, before, output, node, purpose) {
  await files.writeInternalTraceFile(runId, traceId, "accepted-node-result.json", JSON.stringify(output, null, 2));
  let changed;
  try { changed = await files.captureWorkspaceChanges({ runId, traceId, workspacePath, before }); }
  catch (error) {
    diagnostic("task.artifact_recording_failed", { error, traceId });
    return [];
  }
  return changed.artifacts;
}

function acceptedWorkspaceBaseline(initial, artifacts) {
  const entries = new Map(initial);
  for (const artifact of artifacts) {
    if (!artifact.name) continue;
    if (artifact.deleted) entries.delete(artifact.name);
    else entries.set(artifact.name, { hash: artifact.sha256, bytes: artifact.bytes });
  }
  Object.defineProperty(entries, "restrictedEntries", { value: initial.restrictedEntries });
  return entries;
}

function managerDispatch(store, runId, dedupeKey, messageIds = [], sourceMessageId = null) {
  const run = store.getRun(runId), task = store.getRunTask(runId);
  return store.enqueueDispatch(runId, { recipientAgentId: run.manager.id, workflowNodeId: task.workflowSnapshot.nodes[0].id, purpose: "manager", dedupeKey, messageIds, sourceMessageId, coordinationFollowup: true, deferredRevisit: dedupeKey.startsWith("redispatch:") });
}

// Apply a manager decision atomically without blocking independent recipients.
export function scheduleManagerFollowup(store, runId, delivery, decision, sourceMessageId = null) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw new Error('managerDecision 必须是协调对象');
  if (Object.hasOwn(decision, 'assignments')) {
    if (Object.keys(decision).some(key => !['assignments', 'rationale'].includes(key))) throw new Error('assignments 不能与其他协调决定混用');
    const deliveries = store.enqueueManagerAssignments(runId, delivery, decision.assignments);
    return { scheduled: 'assignments', dispatchIds: deliveries.map(item => item.id) };
  }
  if (Object.hasOwn(decision, 'wait')) {
    if (decision.wait !== true || Object.keys(decision).some(key => !['wait', 'rationale'].includes(key))) throw new Error('等待决定仅接受 wait=true、rationale');
    if (!store.listDispatches(runId).some(item => item.id !== delivery.id && !['done', 'cancelled'].includes(item.status))) throw new Error('没有未完成工作可等待，请明确派工或提交验收');
    return { scheduled: 'waiting' };
  }
  if (Object.keys(decision).some(key => !['nextNodeId', 'nextAgentId', 'instruction', 'rationale'].includes(key))) throw new Error('managerDecision 仅接受 nextNodeId、nextAgentId、instruction、rationale，或 assignments / wait；咨询必须使用顶层 consultation');
  const next = decision.nextNodeId;
  if (next !== null) {
    const source = sourceMessageId ? store.getRunMessage(runId, sourceMessageId) : null;
    if (sourceMessageId && !source) throw new Error('投递来源消息不属于 Run');
    const instruction = Object.hasOwn(decision, 'instruction') ? decision.instruction : source?.content || decision.rationale || '请完成本次节点职责并向经理交接';
    const deliveries = store.enqueueManagerAssignments(runId, delivery, [{ nextNodeId: next, nextAgentId: decision.nextAgentId, instruction }]);
    return { scheduled: "handoff", dispatchIds: deliveries.map(item => item.id) };
  }
  if (decision.nextAgentId != null || Object.hasOwn(decision, 'instruction')) throw new Error('提交验收时 nextAgentId 必须为 null 或省略，不能同时包含派工 instruction');
  store.requestHumanAcceptance(runId, { traceId: delivery.traceIds?.at(-1) || null, summary: decision.rationale || "项目经理已提交人类验收。" });
  return { scheduled: "acceptance" };
}

function acceptDelivery(store, delivery, trace, output, artifacts) {
  const runId = delivery.runId, run = store.getRun(runId);
  if (!store.canExecuteDispatch(delivery.id)) throw new RuntimeCancelledError("当前投递已停止");
  if (store.getRunTask(runId).kind === "automation") {
    if (output.automationFailure) throw new Error(String(output.automationFailure));
    if (output.consultation?.audience === "human" || output.handoff?.recipientAgentId === "human_operator") throw new Error("自动化不能向人类交接或澄清；请调整配置后重试原员工");
  }
  const agent = store.getRunAgent(runId, delivery.recipientAgentId);
  const sender = { type: "agent", id: agent.id, name: agent.name };
  if ([output.handoff, output.consultation, output.managerDecision].filter(Boolean).length > 1) throw new RoutingError(new Error('handoff、consultation、managerDecision 不能同时使用；每轮只提交一种协调决定'));
  store.acceptNodeResult(runId, delivery.workflowNodeId, trace.id, output, artifacts);
  const content = output.summary || "本轮工作已返回。";
  if (output.handoff) {
    applyRouting(() => store.handoffDispatch(delivery.id, output.handoff.recipientAgentId, content, trace.id));
    store.completeTrace(trace.id); store.syncWaiting(runId); return;
  }
  if (output.consultation) {
    applyRouting(() => store.askQuestion(delivery.id, output.consultation, trace.id));
    store.completeTrace(trace.id);
    return;
  }
  let resultMessage;
  if (delivery.purpose === "inquiry") {
    store.addMessage({ runId, traceId: trace.id, sender, recipientHuman: true, replyToMessageId: delivery.messageIds[0], kind: "inquiry_answer", content });
  } else if (delivery.purpose === "consultation" && !output.consultation) {
    const parent = store.getDispatch(delivery.parentDispatchId);
    store.answerQuestion(runId, parent.waitingMessageId, content, sender, trace.id);
  } else {
    const single = ['manager', 'delivery_review'].includes(delivery.purpose) && output.managerDecision && Object.hasOwn(output.managerDecision, 'nextNodeId') && output.managerDecision.nextNodeId !== null;
    const directedContent = single && (Object.hasOwn(output.managerDecision, 'instruction') ? output.managerDecision.instruction : content);
    // A single dispatch already records its directed instruction. Keep a
    // distinct summary, but don't broadcast that same instruction a second time.
    if (directedContent !== content) resultMessage = store.addMessage({ runId, workflowNodeId: delivery.workflowNodeId, traceId: trace.id, sender, kind: ["manager", "delivery_review"].includes(delivery.purpose) ? "manager_decision" : "handoff", content });
  }
  store.completeTrace(trace.id); store.completeDispatch(delivery.id);
  if (["manager", "delivery_review"].includes(delivery.purpose)) {
    if (output.deliveryReview) store.recordDeliveryReview(runId, trace.id, output.deliveryReview);
    let decision = output.managerDecision || (output.deliveryReview?.verdict === "pass" ? { nextNodeId: null, rationale: content } : null);
    if (decision && Object.hasOwn(decision, 'nextNodeId') && decision.nextNodeId !== null && !Object.hasOwn(decision, 'instruction')) decision = { ...decision, instruction: content };
    if (!decision && (output.deliveryReview?.verdict === "rework" || output.consultation)) {
      managerDispatch(store, runId, "followup:" + delivery.id, [], resultMessage?.id);
    } else {
      try {
        if (!decision) throw new Error('本轮缺少 managerDecision，正文报告不能建立派工或提交验收。请返回 managerDecision（单人 nextNodeId/nextAgentId、批量 assignments 或 wait:true）；提交人类验收时前两项为 null，需要咨询则使用顶层 consultation');
        scheduleManagerFollowup(store, runId, { ...delivery, traceIds: [trace.id] }, decision, resultMessage?.id);
      } catch (error) {
        if (error.code !== 'COORDINATION_PENDING') throw new RoutingError(error);
        // A valid terminal decision may race a peer's still-unconsumed report.
        // Wait behind that work; do not consume a protocol correction or block
        // the report with a requeued manager at the head of its own FIFO.
        managerDispatch(store, runId, 'redispatch:' + delivery.id, [], resultMessage?.id);
        store.addEvent({ type: 'run.acceptance_deferred', runId, actor: sender, message: error.message, data: { traceId: trace.id, dispatchId: delivery.id } });
      }
    }
  } else if (!["consultation", "inquiry"].includes(delivery.purpose) || output.consultation) {
    store.addEvent({ type: "trace.accepted", runId, actor: sender, message: "已记录员工交接。", data: { traceId: trace.id, workflowNodeId: delivery.workflowNodeId, artifactCount: artifacts.length } });
    const source = store.getRunMessage(runId, delivery.sourceMessageId);
    if (source?.sender?.type === "agent" && source.sender.id !== agent.id) {
      store.enqueueDispatch(runId, { recipientAgentId: source.sender.id, workflowNodeId: delivery.workflowNodeId, purpose: source.sender.id === run.manager.id ? "manager" : "instruction", messageIds: resultMessage ? [resultMessage.id] : [], sourceMessageId: resultMessage?.id, dedupeKey: "delivery:" + delivery.id, coordinationFollowup: source.sender.id === run.manager.id });
    }
  }
  store.syncWaiting(runId);
}

async function invokeDispatch(store, files, delivery, runBaseline) {
  const runId = delivery.runId, run = store.getRun(runId), task = store.getRunTask(runId);
  const agent = store.getRunAgent(runId, delivery.recipientAgentId), node = nodeInfo(task, delivery.workflowNodeId);
  const trace = store.createTrace(runId, { workflowNodeId: node.id, agentId: agent.id, type: delivery.purpose });
  store.attachDispatchTrace(delivery.id, trace.id);
  const controller=new AbortController();let release, output, artifacts;
  const unregister=registerExecution(`${runId}:${agent.id}:admission`,{terminate:reason=>controller.abort(new RuntimeCancelledError(reason))},runId);
  try {
    release=await executionBudget(store).acquire({owner:runId,provider:agent.runtime.provider,signal:controller.signal,onWaiting:()=>store.addEvent({type:'runtime.event',runId,actor:{type:'agent',id:agent.id,name:agent.name},message:'等待实例执行资源',data:{auditVersion:2,traceId:trace.id,presentation:'system',providerEventType:'resource.waiting'}})});
    unregister();
    if(!store.canExecuteDispatch(delivery.id))throw new RuntimeCancelledError('执行等待已取消');
    const directory = await files.prepareTrace(runId, trace.id);
    const finalPath = await files.writeInternalTraceFile(runId, trace.id, "provider-final.json", "");
    const workspace = store.getRunExecutionContext(runId);
    const before = ["node", "instruction"].includes(delivery.purpose)
      ? acceptedWorkspaceBaseline(runBaseline, workspace.artifacts)
      : await files.snapshotWorkspace(task.workspacePath, { excludeRunFiles: true }).catch(() => new Map());
    // Only explicit inbox/chain messages or this responsibility's handoffs are
    // shared. Other members' private model context is never forwarded.
    const roster = run.participants.filter(member=>!(run.removedParticipantIds || []).includes(member.id)).map(({ id, type, name, kind, description, capabilities }) => ({ id, type, name, kind, description, capabilities }));
    // A member keeps one cwd/session even when answering another node's question.
    const cwd = task.repositoryMode === "agent" ? (task.repositoryBindings[agent.id] ? resolve(task.workspacePath, task.repositoryBindings[agent.id].path) : task.workspacePath) : task.workspacePath;
    const session = store.prepareMemberSession(delivery.id, trace.id, cwd);
    const messages = store.memberInputMessages(delivery.id);
    for (const message of messages) for (const attachment of message.attachments || []) {
      await files.readRunAttachment(runId, attachment);
      attachment.path = files.runAttachmentPath(runId, attachment);
    }
    const inputThroughMessageId = store.latestRunMessageId(runId);
    let input, inputAcknowledged = false;
    const acknowledgeInput = () => {
      if (!inputAcknowledged) {
        store.confirmMemberInput(trace.id, inputThroughMessageId, input.inputContext, messages.map(item => item.id));
        inputAcknowledged = true;
      }
    };
    const onEvent = async (event) => {
      const { sessionId, auditEvent, content } = separateRuntimeSession(event);
      // Init/thread-connected is not proof of input consumption. New model
      // content/tool activity is; preserve this receipt even if the turn fails.
      if (content && ['text', 'thinking', 'input', 'output'].some(key => content.fields?.[key]?.text)) acknowledgeInput();
      if (content) auditEvent.data.contentRef = await files.writeConsoleContent(runId, trace.id, content);
      if (["codex", "dsh"].includes(agent.runtime.provider) && auditEvent.providerEventType === "thread.started" && sessionId) store.bindProviderSession(trace.id, sessionId);
      await files.appendTrace(runId, trace.id, { occurredAt: new Date().toISOString(), runId, traceId: trace.id, workflowNodeId: node.id, agentId: agent.id, provider: agent.runtime.provider, type: auditEvent.providerEventType, message: auditEvent.message, data: auditEvent.data });
      store.addEvent({ type: "runtime.event", runId, actor: { type: "agent", id: agent.id, name: agent.name }, message: auditEvent.providerEventType + ": " + (auditEvent.message || "收到运行时事件"), data: { traceId: trace.id, workflowNodeId: node.id, providerEventType: auditEvent.providerEventType, ...auditEvent.data } });
    };
    const effectiveNode = delivery.purpose === "node" && task.repositoryMode === "agent" ? { ...node, repositoryPath: task.repositoryBindings?.[agent.id]?.path || null } : node;
    input = taskPrompt({ task, run, node: effectiveNode, trace, agent, directory, cwd, workspace, messages, roster, mode: delivery.purpose, delivery, session });
    const onPrompt = async value => {
      try { store.attachTracePrompt(trace.id, await files.writePromptSnapshot(runId, trace.id, promptSnapshot(value))); }
      catch (error) { diagnostic("task.prompt_snapshot_failed", { error, runId, traceId: trace.id }); }
    };
    // The runtime returns text; coordination fields are interpreted when present.
    const runtimeResult = await invokeRuntime(store, agent, { ...input, onPrompt, traceId: trace.id, session, executionKey: `${runId}:${agent.id}`, canStart: () => store.canExecuteDispatch(delivery.id), runtime: agent.runtime, workspacePath: cwd, traceDirectory: directory, finalPath, runId, onEvent }, files);
    output = parseEmployeeResponse(runtimeResult.finalText);
    artifacts = await capture(files, runId, trace.id, task.workspacePath, before, output, effectiveNode, delivery.purpose);
    acknowledgeInput();
    store.transaction(() => acceptDelivery(store, delivery, trace, output, artifacts));
  } catch (error) {
    if (error instanceof RoutingError) {
      // The rejected routing transaction has rolled back, including all partial
      // messages/queues and completion. Preserve actual work independently from
      // whether the coordination envelope could be applied.
      store.transaction(() => {
        store.acceptNodeResult(runId, node.id, trace.id, output, artifacts);
        store.addMessage({ runId, workflowNodeId: node.id, traceId: trace.id, sender: { type: 'agent', id: agent.id, name: agent.name }, kind: agent.id === run.manager.id ? 'manager_decision' : 'handoff', content: output.summary || '本轮工作已返回。' });
        store.rejectDispatchRouting(delivery.id, trace.id, error.message);
      });
      return;
    }
    const cancelled = error instanceof RuntimeCancelledError || error.name === 'AbortError';
    diagnostic("task.dispatch_failed", { error, traceId: trace.id, agentId: agent.id, workflowNodeId: node.id });
    const failure = traceFailureSummary(error);
    store.completeTrace(trace.id, { status: cancelled ? "cancelled" : "failed", error: failure });
    if (error instanceof RuntimeSessionMissingError) store.resetMemberSession(trace.id, failure);
    const kind = cancelled ? null : failureKindOf(error);
    const immediate = error instanceof RuntimeSessionMissingError || ["paused", "cancelled"].includes(store.getRun(runId).status);
    const failureFact = kind ? { kind, signature: failureSignature(kind, failure) } : null;
    if (failureFact) failureFact.streak = delivery.lastErrorSignature === failureFact.signature ? (delivery.errorStreak || 1) + 1 : 1;
    const retrySession = error instanceof RuntimeSessionMissingError && delivery.lastErrorKind !== 'session';

    if (cancelled || immediate && !(error instanceof RuntimeSessionMissingError) || retrySession) {
      store.retryDispatch(delivery.id, failure, immediate ? 0 : 300000, failureFact);
    } else {
      store.stopFailedDispatch(delivery.id, failure, failureFact);
    }
    store.addEvent({ type: cancelled ? "trace.cancelled" : "trace.failed", runId, actor: { type: "agent", id: agent.id, name: agent.name }, message: (cancelled ? "Trace 已停止：" : "Trace 未完成：") + failure, data: { traceId: trace.id, dispatchId: delivery.id, workflowNodeId: node.id, ...(cancelled ? {} : { auditVersion: 2, failureKind: kind }) } });
    if (store.getRun(runId).status === "cancelled" && !delivery.interactionOnly) throw error;
  } finally {unregister();release?.();}
}

// One dispatcher owns Run preparation; each employee has its own in-flight call.
const executions = new WeakMap();
export function isRunExecuting(store, runId) { return Boolean(executions.get(store)?.has(runId)); }
export function executeRun(store, runId, options = {}) {
  let active = executions.get(store); if (!active) { active = new Map(); executions.set(store, active); }
  const existing = active.get(runId);
  if (existing) { existing.wake?.(); return existing.promise; }
  const control = {};
  active.set(runId, control);
  control.promise = withDiagnosticContext({ source: "task", runId }, () => drainRun(store, runId, options, control)).finally(() => active.delete(runId));
  return control.promise;
}
async function drainRun(store, runId, { runFilesRoot = process.env.AGENTFORGE_RUN_FILES_ROOT || join(desktopServiceDataRoot(), "agentforge-runs"), resolveGitCredential = null } = {}, control = {}) {
  const files = createRunFiles({ root: runFilesRoot, resolveGitCredential });
  try {
    let run = store.getRun(runId);
    if (!store.getRunRecoveryPlan(runId).shouldExecute) return;
    try {
      await files.prepareRun(runId);
      await files.prepareRunWorkspace(store.getRunTask(runId));
    } catch (error) {
      diagnostic("task.workspace_failed", { error, runId });
      const current = store.getRun(runId);
      if (["planning", "running", "review"].includes(current.status)) {
        store.failRun(runId, "运行文件或冻结仓库尚未准备好。请核对仓库来源、基线和本机文件权限后重试。");
      }
      return;
    }
    let runBaseline;
    try {
      runBaseline = await files.loadOrCreateWorkspaceBaseline(runId, store.getRunTask(runId).workspacePath, { allowCreate: !store.hasRunTraces(runId) });
    } catch (error) {
      diagnostic("task.workspace_baseline_failed", { error, runId });
      runBaseline = await files.snapshotWorkspace(store.getRunTask(runId).workspacePath, { excludeRunFiles: true }).catch(() => new Map());
    }
    store.initializeDispatches(runId);
    run = store.getRun(runId);
    if (run.status === "planning") { store.updateRun(runId, { status: "running" }); store.setTaskStatus(run.taskId, "running"); }
    const workers = new Set();
    let turns = 0, cancellationError = null;
    while (true) {
      store.syncWaiting(runId);
      if (!store.getRunTask(runId).archivedAt) {
        let delivery;
        while (turns < 80 && (delivery = store.claimDispatch(runId))) {
          turns++;
          const claimed = delivery;
          const work = withDiagnosticContext({ source: "task", runId, taskId: run.taskId, dispatchId: claimed.id, workflowNodeId: claimed.workflowNodeId, agentId: claimed.recipientAgentId, attempt: claimed.attempts }, async () => {
            diagnostic("task.dispatch_started");
            await invokeDispatch(store, files, claimed, runBaseline);
            diagnostic("task.dispatch_settled");
          }).catch(error => {
            if (store.getRun(runId).status === 'cancelled') cancellationError ||= error;
            diagnostic('task.worker_settled_error', { runId, error });
          }).finally(() => workers.delete(work));
          workers.add(work);
        }
      }
      if (!workers.size) break;
      await Promise.race([...workers, new Promise(resolve => { control.wake = resolve; })]);
      control.wake = null;
    }
    if (cancellationError) throw cancellationError;
    if (turns >= 80) store.addEvent({ type: "run.manager_patrol_queued", runId, message: "本轮投递达到上限，剩余队列由巡检继续。", data: {} });
  } catch (error) {
    if (store.getRun(runId).status === "cancelled") throw error;
    diagnostic("task.orchestration_error", { runId, error });
    store.addEvent({ type: "run.manager_patrol_queued", runId, message: "编排未完成，保留队列等待巡检。", data: { auditVersion: 2, error: traceFailureSummary(error) } });
  }
}
export function requestHumanIntervention(store, runId, messageId) {
  const message = store.getRunMessage(runId, messageId);
  if (!message) throw new Error("人工消息不存在");
  const run = store.getRun(runId), task = store.getRunTask(runId), recipientId = message.recipient.type === "agent" ? message.recipient.id : run.manager.id;
  const ownNode = store.memberResponsibility(runId, recipientId);
  if (run.status === "failed") throw new Error("任务因错误中断，请先重试失败员工");
  store.enqueueDispatch(runId, { recipientAgentId: recipientId, workflowNodeId: ownNode || task.workflowSnapshot.nodes[0].id, purpose: recipientId === run.manager.id ? "manager" : "instruction", messageIds: [messageId], sourceMessageId: messageId, dedupeKey: "message:" + messageId });
  return store.getRun(runId);
}
export function terminateRun(store, runId, reason) {
  if (["completed", "cancelled"].includes(store.getRun(runId).status)) return stopInquiries(store, runId);
  const run = store.cancelRun(runId, reason); terminateExecution(runId, reason); return run;
}
export function stopInquiries(store, runId) {
  const executing = store.listDispatches(runId).some((item) => item.interactionOnly && item.status === "claimed");
  store.cancelInquiries(runId);
  if (executing) terminateExecution(runId, "用户停止答疑");
  return store.getRun(runId);
}
export function pauseRun(store, runId, reason) { const run = store.pauseRun(runId, reason); store.cancelInquiries(runId); terminateExecution(runId, reason); return run; }
export function resumeRun(store, runId) { return store.resumeRun(runId); }
