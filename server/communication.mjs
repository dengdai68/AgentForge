import { executionBudget } from "./execution-budget.mjs";
import { registerExecution } from "./runtime/registry.mjs";
import { writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { withHistoryTools } from "./history/bridge.mjs";
import { diagnostic, withDiagnosticContext } from "./diagnostics.mjs";
import { createRunFiles } from "./run-files.mjs";
import { communicationPrompt } from "./prompts.mjs";
import { runRuntime, RuntimeSessionMissingError, redactExternalText, separateRuntimeSession, promptSnapshot } from "./runtime/local-cli.mjs";

// Private replies have one body; groups may explicitly address peer members.
const replySchema = {type:"object",additionalProperties:false,properties:{reply:{type:"string"}},required:["reply"]};

export function createCommunicationService(store, { root, invoke, files = createRunFiles({root:join(dirname(root),'records'),communicationsRoot:root,resolveCommunicationWorkspace:key=>store.getCommunicationWorkspace(key)}) } = {}) {
  const active = new Map();
  async function execute(key, item) {
      const controller=new AbortController();let release;
      const unregister=registerExecution(`communication:${key}:${item.agentSnapshot?.id}:admission`,{terminate:reason=>controller.abort(new Error(reason))},key);
      try {
        release=await executionBudget(store).acquire({owner:key,provider:item.agentSnapshot?.runtime?.provider,signal:controller.signal,onWaiting:()=>store.appendCommunicationEvent(key,item.id,{providerEventType:'resource.waiting',message:'等待实例执行资源',data:{presentation:'system'}})});
        unregister();
        if (!item.available) throw new Error("被 @ 的成员已离开群聊、停用或删除");
        const group = store.getCommunication(key, { limit: 1 }).conversation.kind === "group";
        const schema = group ? { ...replySchema, properties: { ...replySchema.properties, mentionAgentIds: { type: "array", items: { type: "string" } } }, required: ["reply", "mentionAgentIds"] } : replySchema;
        const agent = item.agentSnapshot, cwd = store.prepareCommunicationWorkspace(key,root);
        store.assertRuntimeEnabled(agent.runtime);
        if(files.communicationPath(key)!==cwd)throw new Error('沟通资料与共享工作目录不一致');
        const directory=await files.prepareCommunicationAttempt(key,agent.id,item.id,item.attempts);
        const schemaPath = join(directory, "response-schema.json"), finalPath = join(directory, "response.json");
        await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
        const session = store.prepareCommunicationSession(key, item.id, cwd);
        store.appendCommunicationEvent(key, item.id, { providerEventType: session.resume ? 'session.resumed' : 'session.created', message: session.resume ? '继续该成员的独立会话。' : '为该成员建立独立会话。' });
        const context = store.communicationContext(key, item.id);
        const message = ({ id, sender, content, attachments = [], replyToMessageId, createdAt }) => ({ id, sender, content, replyToMessageId, createdAt, attachments: attachments.map(file => ({ name: file.name, bytes: file.bytes, sha256: file.sha256, path: resolve(cwd, file.path) })) });
        const input = communicationPrompt({ agent, context: { ...context, message: message(context.message) }, cwd, messages: context.messages.map(message), materialDirectory: files.communicationInputDirectory(key) });
        await files.writeCommunicationInputMaterials(key, input.materials);
        let inputAcknowledged = false, inputProgress = false, nativeConfirmed = session.resume;
        const acknowledgeInput = () => {
          if (inputAcknowledged) return;
          store.confirmCommunicationInput(key, item.id, [...new Set([...context.messages.map(message => message.id), context.message.id])]);
          inputAcknowledged = true;
        };
        const onPrompt = async value => {
          if (!files?.writeCommunicationContent) return;
          try {
            const contentRef = await files.writeCommunicationContent(key, item.id, item.attempts, promptSnapshot(value));
            store.appendCommunicationEvent(key, item.id, { providerEventType: 'prompt.snapshot', data: { contentRef } });
          } catch (error) { diagnostic('communication.prompt_snapshot_failed', { error }); }
        };
        const contextDirectories=[...new Set([...context.messages.flatMap(item=>(item.attachments || []).map(file=>dirname(resolve(cwd,file.path)))), ...input.materials.map(file=>dirname(file.path))])];
        const provider = invoke || runRuntime;
        const result = await withHistoryTools(store, agent, {
          runtime: agent.runtime, workspacePath: cwd, traceDirectory: directory, schemaPath, finalPath, outputSchema: schema,
          ...input, contextDirectories, onPrompt, runId: key, executionKey: `communication:${key}:${agent.id}`, session,
          onEvent: async (event) => {
            const { sessionId, auditEvent, content } = separateRuntimeSession(event);
            if (content && files) auditEvent.data.contentRef = await files.writeCommunicationContent(key, item.id, item.attempts, content);
            if ((auditEvent.providerEventType === "system" || auditEvent.providerEventType === "thread.started") && sessionId) { store.confirmCommunicationSession(key, item.id, sessionId); nativeConfirmed = true; }
            if (content && ['output','thinking','tool','tool_result'].includes(auditEvent.data?.presentation) && ['text','thinking','input','output'].some(key => content.fields?.[key]?.text)) inputProgress = true;
            if (nativeConfirmed && inputProgress) acknowledgeInput();
            store.appendCommunicationEvent(key, item.id, auditEvent);
          }
        }, provider, files);
        acknowledgeInput();
        let parsed;
        try { parsed = JSON.parse(result.finalText); } catch (error) { diagnostic("communication.result_parse_error", { error }); throw new Error("Agent 未返回有效的沟通回复 JSON"); }
        if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) throw new Error("Agent 沟通回复为空");
        if(Array.isArray(parsed) || Object.keys(parsed).some(key=>key!=="reply" && !(group && key==="mentionAgentIds")))throw new Error(group ? "群聊回复只接受 reply 和 mentionAgentIds" : "沟通回复只接受 reply");
        if (group && !Array.isArray(parsed.mentionAgentIds)) throw new Error("群聊回复须提供 mentionAgentIds，普通答复用 []");
        const reply = redactExternalText(parsed.reply);
        store.completeCommunication(key, item.id, reply, group ? parsed.mentionAgentIds : []);
        diagnostic("communication.completed");
      } catch (error) {
        // Shutdown leaves admitted work recoverable; it is not a Provider failure.
        if (error.name === 'AbortError') return;
        diagnostic("communication.failed", { error });
        store.failCommunication(key, item.id, redactExternalText(error.message || "回复失败"), error instanceof RuntimeSessionMissingError);
      } finally {unregister();release?.();}
  }
  function pump(key) {
    let workers = active.get(key);
    if (!workers) { workers = new Set(); active.set(key, workers); }
    for (;;) {
      const item = store.claimCommunication(key);
      if (!item) break;
      const worker = withDiagnosticContext({ source: "communication", conversationId: key, deliveryId: item.id, agentId: item.agentSnapshot?.id, attempt: item.attempts }, async () => {
        diagnostic("communication.started");
        return execute(key, item);
      }).finally(() => workers.delete(worker));
      workers.add(worker);
    }
    return workers;
  }
  return {
    isActive() { return active.size > 0; },
    async kick(key) {
      // Claim is synchronous: concurrent wakeups cannot claim a member twice.
      let workers = pump(key);
      while (workers.size) {
        await Promise.race(workers);
        workers = pump(key);
      }
      if (active.get(key) === workers) active.delete(key);
    },
    recover() { store.recoverCommunications(); },
    async poll() { await Promise.all(store.pendingCommunications().map((key) => this.kick(key))); }
  };
}
