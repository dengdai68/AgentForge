import { automationCommands } from "./automations.mjs";
import { statSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { isAbsolute, resolve, dirname } from "node:path";
import { createSqlitePersistence } from "./persistence.mjs";
import { communicationCommands } from "./communication-store.mjs";
import { historyCommands } from "./history/index.mjs";
import { executionLogs } from "./execution-logs.mjs";

const now = () => new Date().toISOString(); let sequence = 0;
const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${(++sequence).toString(36)}`;
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function consoleAuditProjection(event) {
  const legacyAudit = ["runtime.event", "trace.failed"].includes(event?.type) && event.data?.auditVersion !== 2;
  if (!legacyAudit) return clone(event);
  const traceId = typeof event.data?.traceId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(event.data.traceId) ? event.data.traceId : null;
  return {
    id: event.id,
    type: event.type,
    runId: event.runId,
    timestamp: event.timestamp,
    actor: clone(event.actor),
    message: event.type === "runtime.event" ? "历史运行记录已按当前审计边界隐藏原始内容。" : "历史 Trace 失败原因已按当前审计边界隐藏原始内容。",
    data: { auditVersion: 1, ...(traceId ? { traceId } : {}) }
  };
}
const taskTransitions = { backlog: ["planning", "cancelled"], planning: ["running", "paused", "blocked", "cancelled"], running: ["review", "awaiting_human", "paused", "blocked", "cancelled"], awaiting_human: ["running", "review", "paused", "cancelled"], review: ["awaiting_acceptance", "running", "paused", "blocked", "cancelled"], paused: ["running", "awaiting_human", "review", "cancelled"], blocked: ["running", "cancelled"], awaiting_acceptance: ["done", "running", "cancelled"], done: [], cancelled: [] };
const runTransitions = { planning: ["running", "paused", "failed", "cancelled"], running: ["review", "awaiting_human", "paused", "failed", "cancelled"], awaiting_human: ["running", "review", "paused", "cancelled"], review: ["awaiting_acceptance", "running", "paused", "failed", "cancelled"], paused: ["running", "awaiting_human", "review", "cancelled"], awaiting_acceptance: ["completed", "running", "cancelled"], completed: [], failed: ["running"], cancelled: [] };
const text = (value, name) => { if (typeof value !== "string" || !value.trim()) throw new Error(`${name}不能为空`); return value.trim(); };
const roleName = (value) => { const name = text(value, "角色名称"); if (name.length > 80) throw new Error("角色名称最多 80 字符"); return name; };
const defaultAcceptanceCriteria = [];
function taskAcceptanceCriteria(value) {
  if (value === undefined || (Array.isArray(value) && !value.length)) return [...defaultAcceptanceCriteria];
  if (!Array.isArray(value) || value.some((criterion) => typeof criterion !== "string")) throw new Error("任务验收标准必须是字符串数组");
  if (value.length > 20) throw new Error("任务验收标准最多 20 条");
  return value.map((criterion, index) => {
    const normalized = criterion.trim();
    if (!normalized) throw new Error(`第 ${index + 1} 条任务验收标准不能为空`);
    if (normalized.length > 500) throw new Error(`第 ${index + 1} 条任务验收标准不能超过 500 字符`);
    return normalized;
  });
}
function migrateAcceptanceCriteria(value) {
  const legacy = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const criteria = legacy.filter((criterion) => typeof criterion === "string" && criterion.trim()).map((criterion) => criterion.trim() === "交付反思" ? "项目经理交付复核" : criterion.trim());
  return criteria.length ? criteria : [...defaultAcceptanceCriteria];
}
function pluginSources(value = []) {
  if (!Array.isArray(value) || value.length > 20) throw new Error("插件来源最多 20 个");
  return value.map((source) => {
    if (!source || !/^[0-9a-f-]{36}$/.test(source.catalogId) || typeof source.enabled !== "boolean" || !Array.isArray(source.enabledPlugins) || source.enabledPlugins.length > 300 || source.enabledPlugins.some((name) => typeof name !== "string" || !name.trim())) throw new Error("插件来源绑定无效");
    return { catalogId: source.catalogId, enabled: source.enabled, enabledPlugins: [...new Set(source.enabledPlugins)] };
  });
}
function extensionBinding(value) {
  if (value.extensionSelection === undefined) return {};
  const selection = value.extensionSelection, manifest = value.extensionManifest;
  // Current plugin-level references. Existing immutable Skill snapshots below
  // stay readable; HTTP/CLI never accept that retired write protocol.
  if(selection && !Object.hasOwn(selection,'skillIds')) {
    if(Object.keys(selection).some(key=>!['pluginIds','mcpIds'].includes(key)) || !Array.isArray(selection.pluginIds) || !Array.isArray(selection.mcpIds) || !Array.isArray(manifest)) throw new Error('插件/MCP 绑定无效');
    const ids=[...selection.pluginIds,...selection.mcpIds];
    if(new Set(ids).size!==ids.length || manifest.length!==ids.length || ids.some(id=>typeof id!=='string' || !/^[0-9a-f-]{36}$/.test(id))) throw new Error('插件/MCP 版本无效');
    if(manifest.some(ref=>!['plugin','mcp'].includes(ref.kind) || !selection[ref.kind==='plugin'?'pluginIds':'mcpIds'].includes(ref.id) || typeof ref.name!=='string' || !isAbsolute(ref.path || '') || !/^[a-f0-9]{64}$/.test(ref.sha256 || '') || (ref.kind==='plugin' && (!/^[a-f0-9]{64}$/.test(ref.treeSha256 || '') || !Array.isArray(ref.skills) || ref.skills.some(path=>typeof path!=='string' || isAbsolute(path) || path.split('/').includes('..'))))) || new Set(manifest.map(ref=>ref.id)).size!==ids.length) throw new Error('插件/MCP 引用无效');
    const plugins=manifest.filter(ref=>ref.kind==='plugin');
    for(const ref of manifest) {
      if(ref.adapterVersion!==undefined && ![1,2,3].includes(ref.adapterVersion)) throw new Error('插件执行计划版本无效');
      if([2,3].includes(ref.adapterVersion) && (ref.kind!=='plugin' || ref.planTarget!==(value.provider || 'claude-code') || !['claude-code','codex'].includes(ref.sourceDialect) || !/^[a-f0-9]{64}$/.test(ref.planSha256 || ''))) throw new Error('插件冻结执行计划无效');
      if((ref.sourceRoot!==undefined || ref.sourceSha256!==undefined) && (ref.kind!=='plugin' || !isAbsolute(ref.sourceRoot || '') || !/^[a-f0-9]{64}$/.test(ref.sourceSha256 || ''))) throw new Error('插件原始源引用无效');
      if(ref.mcpAdapterVersion!==undefined && (ref.kind!=='mcp' || ref.mcpAdapterVersion!==2)) throw new Error('MCP 执行适配版本无效');
    }
    if(value.pluginSources?.length || JSON.stringify(value.skillPaths || [])!==JSON.stringify(plugins.flatMap(ref=>ref.skills.map(path=>resolve(dirname(dirname(ref.path)),path)))) || JSON.stringify(value.pluginPaths || [])!==JSON.stringify((value.provider || 'claude-code')==='claude-code'?plugins.map(ref=>dirname(dirname(ref.path))):[]) || JSON.stringify(value.mcpConfigPaths || [])!==JSON.stringify(manifest.filter(ref=>ref.kind==='mcp').map(ref=>ref.path))) throw new Error('市场模式只能使用所选插件/MCP');
    return {extensionSelection:clone(selection),extensionManifest:clone(manifest)};
  }
  if (!selection || !Array.isArray(selection.skillIds) || !Array.isArray(selection.mcpIds) || !Array.isArray(manifest)) throw new Error("市场扩展绑定无效");
  const ids = [...selection.skillIds, ...selection.mcpIds];
  if (ids.length > 60 || new Set(ids).size !== ids.length || manifest.length !== ids.length || ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id))) throw new Error("市场扩展版本无效");
  if (manifest.some(ref => !ids.includes(ref.id) || !['skill', 'mcp'].includes(ref.kind) || !selection[ref.kind === 'skill' ? 'skillIds' : 'mcpIds'].includes(ref.id) || typeof ref.name !== 'string' || !isAbsolute(ref.path || '') || !/^[a-f0-9]{64}$/.test(ref.sha256 || '')) || new Set(manifest.map(ref => ref.id)).size !== ids.length) throw new Error("市场扩展引用无效");
  if (value.pluginPaths?.length || value.pluginSources?.length || ['skill', 'mcp'].some(kind => JSON.stringify(value[kind === 'skill' ? 'skillPaths' : 'mcpConfigPaths'] || []) !== JSON.stringify(manifest.filter(ref => ref.kind === kind).map(ref => ref.path)))) throw new Error("市场模式只能使用所选扩展");
  if (manifest.some(ref => ref.treeSha256 !== undefined && (ref.kind !== 'skill' || !/^[a-f0-9]{64}$/.test(ref.treeSha256)))) throw new Error("技能目录摘要无效");
  if(selection.pluginIds !== undefined && (!Array.isArray(selection.pluginIds) || selection.pluginIds.length > 30 || new Set(selection.pluginIds).size !== selection.pluginIds.length || selection.pluginIds.some(id=>typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)))) throw new Error('插件版本选择无效');
  if(manifest.some(ref=>(ref.resourceRoot !== undefined || ref.resourceSha256 !== undefined) && (ref.kind !== 'mcp' || !isAbsolute(ref.resourceRoot || '') || !/^[a-f0-9]{64}$/.test(ref.resourceSha256 || '')))) throw new Error('插件资源摘要无效');
  return { extensionSelection: { skillIds: [...selection.skillIds], mcpIds: [...selection.mcpIds], ...(selection.pluginIds === undefined ? {} : {pluginIds:[...selection.pluginIds]}) }, extensionManifest: manifest.map(({id,kind,name,path,sha256,treeSha256,resourceRoot,resourceSha256}) => ({id,kind,name,path,sha256,...(treeSha256 ? {treeSha256} : {}),...(resourceRoot ? {resourceRoot,resourceSha256} : {})})) };
}
const runtime = (value = {}) => { const provider = value.provider || "claude-code"; if (!["claude-code", "codex", "dsh"].includes(provider)) throw new Error("运行时必须选择 Claude Code、Codex 或 DeepSeek Harness"); return { ...(value.profileId ? { profileId: String(value.profileId) } : {}), ...extensionBinding(value), pluginSources: pluginSources(value.pluginSources), provider, executable: value.executable?.trim() || null, model: value.model?.trim() || "", effort: effortLevel(provider, value.effort), profile: value.profile?.trim() || "", skillPaths: Array.isArray(value.skillPaths) ? value.skillPaths.map((path) => resolve(path)) : [], pluginPaths: Array.isArray(value.pluginPaths) ? value.pluginPaths.map((path) => resolve(path)) : [], mcpConfigPaths: Array.isArray(value.mcpConfigPaths) ? value.mcpConfigPaths.map((path) => resolve(path)) : [] } };
function documentPaths(value = []) {
  if(!Array.isArray(value))throw new Error('节点交付位置必须是相对路径数组');
  return [...new Set(value.map(item=>{
    const path=text(item,'节点交付位置'),parts=path.replace(/\/$/,'').split('/');
    if(isAbsolute(path) || /[\\\0]/.test(path) || parts.some(part=>!part || ['.','..','.git','.agentforge','.agentforge-workspace.json'].includes(part)))throw new Error('交付位置必须是工作目录内的规范相对路径，不得包含内部目录');
    return path;
  }))];
}
function validateWorkflowInput(input) {
  if (Array.isArray(input.nodes) && input.nodes.some(node => ['ownerRole', 'repositoryPath', 'reuseOwnerFrom'].some(key => Object.hasOwn(node || {}, key)))) throw new Error('工作流节点仅使用staffingGuidance描述人员需求；不接受ownerRole、repositoryPath或reuseOwnerFrom');
}
function workflow(input = {}, { templateId, system, current = false } = {}) { if (!Array.isArray(input.nodes) || !input.nodes.length) throw new Error("工作流至少需要一个节点"); const nodes = input.nodes.map((inputNode, index) => { const nodeId = text(inputNode?.id || `node_${index + 1}`, "节点 ID"); return { id: nodeId, title: text(inputNode?.title, `第 ${index + 1} 个节点标题`), staffingGuidance: text(inputNode?.staffingGuidance || (inputNode?.ownerRole ? `适合由熟悉${inputNode.ownerRole}相关工作的成员承担；请结合成员提示词和能力判断。` : ""), `第 ${index + 1} 个节点人员需求`), dependsOn: [...new Set(inputNode?.dependsOn || [])], handoffFrom: [...new Set(inputNode?.handoffFrom || [])], deliverable: inputNode?.deliverable?.trim() || `完成「${inputNode?.title}」并交付可验收文件。`, artifactPaths: documentPaths(inputNode?.artifactPaths, nodeId), ...(!current ? {repositoryPath: inputNode?.repositoryPath || null} : {}), ...(!current && inputNode?.reuseOwnerFrom ? { reuseOwnerFrom: inputNode.reuseOwnerFrom } : {}) }; }); const ids = new Set(nodes.map((node) => node.id)); if (ids.size !== nodes.length) throw new Error("工作流节点 ID 不能重复"); for (const node of nodes) { if (!/^[a-z][a-z0-9_]*$/.test(node.id)) throw new Error("节点 ID 只能使用小写字母、数字和下划线"); for (const dependency of [...node.dependsOn, ...node.handoffFrom]) if (!ids.has(dependency) || dependency === node.id) throw new Error(`节点「${node.title}」引用了不存在或自身的依赖节点`); if (node.repositoryPath && (!/^repos\/[A-Za-z0-9._-]+$/.test(node.repositoryPath) || ["repos/.", "repos/.."].includes(node.repositoryPath))) throw new Error("代码仓库必须是 repos/ 下的一个直接子目录"); } const visiting = new Set(), visited = new Set(); const visit = (nodeId) => { if (visiting.has(nodeId)) throw new Error("工作流节点依赖不能形成循环"); if (visited.has(nodeId)) return; visiting.add(nodeId); nodes.find((node) => node.id === nodeId).dependsOn.forEach(visit); visiting.delete(nodeId); visited.add(nodeId); }; nodes.forEach((node) => visit(node.id)); return { id: templateId || id("workflow"), system: Boolean(system), name: text(input.name, "工作流名称"), description: input.description?.trim() || "", nodes }; }
const exampleWorkflow = {
  id: "content_delivery", name: "内容交付", description: "从可信材料整理简报、创作内容，再独立审校。",
  nodes: [
    { id: "content_brief", title: "内容简报与验收标准", staffingGuidance: "选择能梳理受众、事实边界与验收标准的成员。", dependsOn: [], deliverable: "交付内容简报，列出输入事实、未知事项与验收标准。", artifactPaths: ["docs/content-brief/"] },
    { id: "content_creation", title: "内容创作与编辑", staffingGuidance: "选择能依据简报撰写准确清晰内容的成员。", dependsOn: ["content_brief"], deliverable: "依据内容简报交付可直接审阅的内容稿。", artifactPaths: ["docs/content/"] },
    { id: "content_review", title: "内容审校与质量核查", staffingGuidance: "选择非作者、能独立核对事实和验收标准的成员。", dependsOn: ["content_creation"], deliverable: "交付独立审校记录，明确问题、证据和返工建议。", artifactPaths: ["docs/content-review/"] }
  ]
};
function migrateWorkflowTemplates(value) {
  return (value || []).map((item) => workflow(item, { templateId: item.id, system: item.system, current: true }));
}
function agent(id, name, description, color, provider, kind = "business") { return { id, name, initials: name.slice(0, 2).toUpperCase(), color, description, kind, systemPrompt: `${description} 评估交接并完成可核验交付，信息不足时向合适成员咨询。`, capabilities: [], runtime: runtime({ provider, extensionSelection: {pluginIds:[],mcpIds:[]}, extensionManifest: [] }), allowedTools: [], status: "active", system: false, createdAt: now() }; }
const managerId = "system_project_manager";
const humanMember = { id: "human_operator", type: "human", name: "本机用户", role: "需求方/最终业务决策人", capabilities: ["业务取舍", "外部事实", "最终决策"] };
const agents = [agent(managerId, "项目经理", "依据成员交接推进工作流，决定何时提交人类验收；业务判断由对应节点负责。", "violet", "claude-code", "manager"), agent("agent_analyst", "内容编辑", "擅长整理可信资料、区分事实与推断并撰写清晰内容。", "cyan", "claude-code"), agent("agent_tester", "独立审校", "独立核对原始材料、事实边界、验收标准和交付文件，明确报告问题。", "green", "claude-code")];
function legacyStatus(step) { return step?.status === "completed" ? "completed" : step?.status === "failed" ? "failed" : step?.status === "awaiting_answer" ? "waiting_human" : ["cancelled", "invalidated", "superseded"].includes(step?.status) ? "skipped" : ["executing", "ready", "awaiting_review", "retrying"].includes(step?.status) ? "running" : "queued"; }
function migrate(loaded) {
  if (!loaded) return null;
  const state = clone(loaded), claudeRuntime = (value = {}) => runtime(value);
  for (const key of ["agents", "teams", "tasks", "runs", "events", "artifacts", "messages", "decisions", "traces", "roles"]) state[key] ||= [];
  state.workflowTemplates = migrateWorkflowTemplates(state.workflowTemplates);
  state.agents = state.agents.filter((item) => item.id !== "system_reflection_agent");
  for (const item of state.agents) { item.runtime = claudeRuntime(item.runtime); item.system = Boolean(item.system); delete item.role; }
  for (const item of state.tasks) {
    item.workspacePath ||= process.cwd(); item.workflowSnapshot ||= clone(state.workflowTemplates.find((template) => template.id === item.workflowTemplateId));
    item.workflowSnapshot = workflow(item.workflowSnapshot, { templateId: item.workflowSnapshot.id, system: item.workflowSnapshot.system });
    item.managerRuntime = claudeRuntime(item.managerRuntime); delete item.reflectionRuntime; delete item.reflectionAgentId;
    if (item.archivedAt === undefined) item.archivedAt = item.archived ? item.updatedAt || now() : null;
    delete item.archived;
    item.acceptanceCriteria = migrateAcceptanceCriteria(item.acceptanceCriteria);
  }
  for (const current of state.runs) {
    for (const step of current.steps || []) {
      const traceId = `legacy_trace_${current.id}_${step.id}`;
      if (!state.traces.some((item) => item.id === traceId)) state.traces.push({ id: traceId, runId: current.id, workflowNodeId: step.nodeId, agentId: step.ownerAgentId, status: step.status === "completed" ? "completed" : step.status === "failed" ? "failed" : "legacy", startedAt: step.startedAt || null, endedAt: step.completedAt || null, tracePath: `runs/${current.id}/steps/${step.id}/`, inputArtifactIds: [], outputArtifactIds: [], error: step.error || null, legacy: true });
    }
    current.waitingConversationId ||= null; current.waitingNodeId ||= null; current.waitingAgentId ||= null; current.pendingMessageIds ||= [];
    current.deliveryReview ||= current.reflection || null;
    // `currentFocus` is a project-manager decision, not a derived node lifecycle.
    // Keep legacy completed runs neutral: a completed Run has no "current" work.
    current.currentFocus ||= null;
    for (const key of ["steps", "workItems", "traceId", "agentContexts", "artifactIds", "loopControls", "reflectionCycles", "nodeStates", "reflectionAgent", "reflection"]) delete current[key];
  }
  for (const item of state.traces) if (item.agentId === "system_reflection_agent") item.agentId = state.runs.find((run) => run.id === item.runId)?.manager?.id || managerId;
  for (const item of state.events) if (item.actor?.id === "system_reflection_agent" || item.actor?.name === "交付反思师") { const manager = state.runs.find((run) => run.id === item.runId)?.manager; item.actor = { type: "agent", id: manager?.id || managerId, name: manager?.name || "项目经理" }; item.message = item.message?.replace(/交付反思师/g, "项目经理").replace(/独立交付反思/g, "项目经理交付复核").replace(/交付反思/g, "项目经理交付复核"); }
  for (const item of state.artifacts) { item.traceId ||= item.stepId ? `legacy_trace_${item.runId}_${item.stepId}` : null; item.category ||= item.name?.startsWith("repos/") ? "code" : "document"; delete item.stepId; delete item.producedByWorkItemId; delete item.producedByRevision; }
  for (const item of state.messages) { item.conversationId ||= item.consultationThreadId || `conversation_${item.runId}_${item.relatedStepId || "general"}`; delete item.relatedStepId; delete item.consultationThreadId; }
  for (const item of state.decisions) { delete item.threadId; delete item.sourceStepId; item.status ||= "confirmed"; }
  // Retired collections remain opaque stored history; current APIs never project them.
  delete state.consultationThreads;
  return state;
}

// Current employee configuration has no repository binding. Historical Task/Run
// snapshots retain their own repository metadata and startup semantics.
const employeeConfiguration = agent => {if(!agent)return agent;const {repository,...employee}=agent;return clone(employee);};

// Effort vocabularies come from the real CLIs (claude --help effort levels;
// codex debug models supported_reasoning_levels, codex-cli 0.160.0). Codex does
// not locally reject unknown effort values, so the platform must reject values
// outside the known vocabulary instead of inventing per-model tables here.
const EFFORT_LEVELS = { "claude-code": ["low", "medium", "high", "xhigh", "max"], codex: ["low", "medium", "high", "xhigh", "max", "ultra"], dsh: ["off", "low", "high", "max"] };
function effortLevel(provider, value) {
  const item = value ?? "";
  if (typeof item !== "string" || item.length > 64 || /[\0\r\n]/.test(item)) throw new Error("Runtime 配置必须为单行文本");
  const trimmed = item.trim();
  if (trimmed && !EFFORT_LEVELS[provider].includes(trimmed)) throw new Error(`思考等级必须是 ${EFFORT_LEVELS[provider].join(" / ")} 之一或留空`);
  return trimmed;
}
function runtimeConnection(value = {}) {
  const provider = value.provider || "claude-code";
  if (!["claude-code", "codex", "dsh"].includes(provider)) throw new Error("运行时必须选择 Claude Code、Codex 或 DeepSeek Harness");
  const result = { provider };
  for (const key of ["model", "executable", "profile"]) {
    const item = value[key] ?? "";
    if (typeof item !== "string" || item.length > 4096 || /[\0\r\n]/.test(item)) throw new Error("Runtime 配置必须为单行文本");
    result[key] = item.trim() || (key === "executable" ? null : "");
  }
  result.effort = effortLevel(provider, value.effort);
  return result;
}

export function createStore({ databasePath = process.env.AGENTFORGE_DB_PATH || ":memory:", workspaceRoot = null, onSaveDiagnostic, runtimeInstalled = () => true } = {}) {
  if (workspaceRoot !== null && (!isAbsolute(workspaceRoot) || resolve(workspaceRoot) === "/")) throw new Error("系统工作根目录必须是非根绝对目录");
  const persistence = createSqlitePersistence(databasePath, { onSaveDiagnostic }), loaded = persistence.load(); const state = migrate(loaded) || { agents: clone(agents), teams: [], tasks: [], workflowTemplates: [workflow(exampleWorkflow, { templateId: exampleWorkflow.id, current: true })], runs: [], traces: [], artifacts: [], messages: [], decisions: [], roles: [], events: [{ id: "evt_welcome", type: "workspace.ready", runId: null, timestamp: now(), actor: { type: "system", name: "AgentForge" }, message: "工作区已就绪。", data: {} }] };
  state.roles ||= [];
  // Current configuration uses ordered roleIds. Immutable historical snapshots
  // retain their own singular/plural shape and are never resolved against live roles.
  if(state.agents.some(employee=>employee.roleId)){
    persistence.close();throw new Error('旧员工 roleId 配置已废弃；请在旧版本解除角色绑定后升级，或显式重新初始化配置。不会自动迁移或清除数据。');
  }
  const roleSnapshotsOf = (roleIds = []) => roleIds.map(roleId=>{
    const role=state.roles.find(item=>item.id===roleId);
    if(!role)throw new Error('绑定的角色不存在，请先在角色管理中创建');
    return {id:role.id,name:role.name,prompt:role.prompt};
  });
  const withRoleSnapshot = snapshot => !snapshot || snapshot.roleSnapshots !== undefined || snapshot.roleSnapshot !== undefined ? snapshot : {...snapshot,roleSnapshots:roleSnapshotsOf(snapshot.roleIds)};
  const assertRoleBindings = roleIds => {
    if(roleIds===undefined)return [];
    if(!Array.isArray(roleIds) || roleIds.some(value=>typeof value!=='string') || new Set(roleIds).size!==roleIds.length)throw new Error('roleIds 必须是不重复的角色 ID 数组，清空请使用 []');
    roleSnapshotsOf(roleIds);return [...roleIds];
  };
  state.dispatches ||= [];
  state.extensionRemovals ||= [];
  state.settings ||= {};
  state.settings.installationId ||= randomUUID();
  // Provider slots are permanent; IDs remain stable for employee references.
  state.settings.runtimeProfiles ||= [];
  const profiles = () => state.settings.runtimeProfiles;
  const ensureProfile = (connection) => {
    let item = profiles().find(item => item.provider === connection.provider);
    if (!item) { item = { id: `runtime_${connection.provider}`, provider: connection.provider, model: "", effort: "", enabled: true }; profiles().push(item); }
    return item;
  };
  for (const provider of ["claude-code", "codex", "dsh"]) {
    if (profiles().filter(item => item.provider === provider).length > 1) throw new Error(`Runtime ${provider} 存在多项旧配置，请先合并为每种 Provider 一项；不会自动迁移或重置数据`);
    ensureProfile({ provider });
  }
  const assertRuntimeEnabled = (value) => {
    if (!runtimeInstalled(value?.provider)) throw new Error("Runtime 未安装或当前客户端找不到可执行文件，无法启用或执行");
    const item = profiles().find(item => item.provider === value?.provider);
    if (!item || item.enabled === false) throw new Error(`${({codex:"Codex", "claude-code":"Claude Code", dsh:"DeepSeek Harness"})[value?.provider] || value?.provider} Runtime 已停用，请在设置中启用后重试`);
  };
  const resolveAgentRuntime = (value = {}) => {
    if (!value.profileId) return runtime(value);
    const profile = profiles().find(item => item.id === value.profileId);
    if (!profile) throw new Error("Runtime 配置不存在，请重新选择");
    return { ...runtime({ ...value, ...runtimeConnection({ provider: profile.provider, model: profile.model, effort: profile.effort }) }), profileId: profile.id };
  };
  const bindRuntime = (value = {}) => {
    const resolved = resolveAgentRuntime(value);
    for (const entry of state.extensionRemovals) {
      const selected = resolved.extensionSelection?.[entry.kind === "plugin" ? "pluginIds" : "mcpIds"] || [];
      if (selected.includes(entry.id)) throw new Error(`「${entry.name}」已删除，请重新选择已安装的插件或 MCP`);
    }
    return { ...resolved, profileId: resolved.profileId || ensureProfile(runtimeConnection(resolved)).id };
  };
  for (const employee of state.agents.filter(item => item.status !== "deleted")) employee.runtime = bindRuntime(employee.runtime);
  for (const employee of state.agents) { employee.kind ||= employee.system ? "manager" : "business"; employee.systemPrompt ??= employee.description || ""; employee.roleIds ??= []; delete employee.roleId; }
  for (const current of state.runs) {
    const task = state.tasks.find((item) => item.id === current.taskId), team = state.teams.find((item) => item.id === task?.teamId);
    current.manager ||= clone(state.agents.find((item) => item.id === managerId));
    current.participants ||= [...(team?.memberAgentIds || [...new Set(Object.values(task?.nodeAssignments || {}))]).map((memberId) => state.agents.find((item) => item.id === memberId)).filter(Boolean).map((item) => ({ ...withRoleSnapshot(clone(item)), type: "agent" })), { ...clone(current.manager), type: "agent", kind: "manager" }, ...(task?.kind === "automation" ? [] : [clone(humanMember)])];
    current.failure ??= null;
  }
  persistence.save(state);
  let transactionDepth = 0;
  const pendingEvents = [];
  const listeners = new Set(), save = () => { if (!transactionDepth) persistence.save(state); }, find = (collection, value) => collection.find((item) => item.id === value), getAgent = (value) => find(state.agents, value), getTeam = (value) => find(state.teams, value), getTask = (value) => find(state.tasks, value), getRun = (value) => find(state.runs, value), getTrace = (value) => find(state.traces, value), getRole = (value) => find(state.roles, value);
  const runAgent = (current, agentId) => current?.participants?.find((item) => item.type === "agent" && item.id === agentId && !(current.removedParticipantIds || []).includes(item.id)) || (current?.manager?.id === agentId ? current.manager : null);
  const addEvent = ({ type, runId = null, actor = { type: "system", name: "AgentForge" }, message, data = {} }) => { const item = { id: id("evt"), type, runId, timestamp: now(), actor: clone(actor), message: text(message, "事件说明"), data: clone(data) }; state.events.push(item); save(); if (transactionDepth) pendingEvents.push(item); else listeners.forEach((listener) => listener(clone(item))); return item; };
  const definition = (current, nodeId) => getTask(current.taskId)?.workflowSnapshot?.nodes.find((item) => item.id === nodeId); const assertNode = (current, nodeId) => { if (!definition(current, nodeId)) throw new Error("工作流节点不存在"); };
  function assignments(currentMembers, template, input = {}) { const result = {}; for (const item of template.nodes) { const agentId = input[item.id] || (item.reuseOwnerFrom && result[item.reuseOwnerFrom]); if (!agentId || !currentMembers.memberAgentIds.includes(agentId) || getAgent(agentId)?.status !== "active") throw new Error(`节点「${item.title}」必须显式分配给一位可用任务成员`); result[item.id] = agentId; } const repositories = new Map(); for (const item of template.nodes.filter((node) => node.repositoryPath)) { const owner = result[item.id]; if (repositories.has(owner) && repositories.get(owner) !== item.repositoryPath) throw new Error("一个成员只能处理一个 Git 仓库"); repositories.set(owner, item.repositoryPath); } return result; }
  const currentEmployee = value => { const employee = getAgent(value); return employee?.status === "deleted" ? null : employee; };
  // The former separate team manager is a member in the current read model.
  // Saving a team writes only the current member set; Task/Run snapshots stay intact.
  const teamMembers = team => [...new Set([...(team.memberAgentIds || []), team.managerAgentId].filter(Boolean))].filter(currentEmployee);
  function memberIds(input, { active = false, empty = false } = {}) {
    if (!Array.isArray(input) || input.some(value => typeof value !== "string") || new Set(input).size !== input.length) throw new Error("memberAgentIds 必须是不重复的数字员工 ID 数组");
    if ((!empty && !input.length) || input.some(value => !currentEmployee(value) || active && currentEmployee(value).status !== "active")) throw new Error(active ? "请选择可用的任务成员，已删除或停用员工不能加入" : "请选择存在的数字员工");
    return [...input];
  }
  function validateTeam(input) {
    if (Object.hasOwn(input, "managerAgentId")) throw new Error("团队不再指定项目经理，请将经理放入 memberAgentIds；任务创建时校验恰好一位项目经理");
    return { memberAgentIds: memberIds(input.memberAgentIds, { empty: true }) };
  }
  const taskReadModel = task => { const { teamId, team, priority, ...record } = task; return clone({ ...record, memberAgentIds: task.memberAgentIds || [...(task.memberSnapshots || []).map(member => member.id), task.managerSnapshot?.id || task.managerAgentId].filter(Boolean) }); };
  function recoverableFailedTraces(runId) {
    const current = getRun(runId);
    return state.traces.filter(trace => {
      if (trace.runId !== runId || trace.status !== "failed" || trace.type === "inquiry") return false;
      const delivery = state.dispatches.find(item => item.runId === runId && item.traceIds.includes(trace.id));
      if (current.failure?.dispatchId && delivery?.id !== current.failure.dispatchId) return false;
      return !delivery || (!delivery.interactionOnly && !delivery.escalatedAt && ["cancelled", "queued"].includes(delivery.status) && delivery.traceIds.at(-1) === trace.id);
    });
  }
  function failedBusinessTraces(runId) {
    return recoverableFailedTraces(runId).filter(trace => ["node", "instruction", "consultation"].includes(trace.type));
  }
  function taskDeletionBlock(taskId) {
    const relatedRuns = state.runs.filter((run) => run.taskId === taskId);
    if (relatedRuns.some((run) => ["planning", "running", "awaiting_human", "review", "awaiting_acceptance", "paused"].includes(run.status) || state.traces.some((trace) => trace.runId === run.id && trace.status === "running"))) return "active_run";
    const runIds = new Set(relatedRuns.map((run) => run.id));
    return state.dispatches.some((item) => runIds.has(item.runId) && item.interactionOnly && !["done", "cancelled"].includes(item.status)) ? "active_inquiries" : null;
  }
  function taskDeletionError(blockedBy) {
    return blockedBy === "active_inquiries"
      ? "存在未结束答疑，不能删除 Task；请先停止答疑或等待答复完成"
      : "存在活跃或暂停的 Run，不能删除 Task";
  }
  function resumeFailedRun(current, task, nodeId, dedupeKey, event, enqueue) {
    if (state.traces.some((trace) => trace.runId === current.id && trace.status === "running") || state.dispatches.some((item) => item.runId === current.id && item.status === "claimed")) throw new Error("仍有活跃执行，不能重新启动失败 Run");
    const failedTrace = recoverableFailedTraces(current.id).filter(trace => trace.workflowNodeId === nodeId).at(-1);
    const original = failedTrace && state.dispatches.find(item => item.traceIds.includes(failedTrace.id));
    current.completedAt = null; current.failure = null; current.status = "running";
    current.waitingConversationId = null; current.waitingNodeId = null; current.waitingAgentId = null;
    task.status = "running"; task.updatedAt = now();
    // Resume the exact delivery so inbox references, consultation parents and the
    // member's native session survive. Other pending work remains in the queue.
    let dispatch = original;
    if (dispatch) {
      dispatch.status = "queued"; dispatch.nextRetryAt = null; dispatch.updatedAt = now();
    } else if (failedTrace) {
      dispatch = enqueue(current.id, { recipientAgentId: failedTrace.agentId, workflowNodeId: nodeId, purpose: failedTrace.type, messageIds: current.pendingMessageIds || [], dedupeKey });
    } else {
      dispatch = state.dispatches.find(item => item.runId === current.id && item.status === "queued" && !item.interactionOnly)
        || enqueue(current.id, { recipientAgentId: current.manager.id, workflowNodeId: nodeId, purpose: "manager", messageIds: current.pendingMessageIds || [], dedupeKey });
    }
    dispatch.continueRequested = true;
    current.pendingRetryDispatchId = dispatch.id;
    addEvent({ ...event, runId: current.id, actor: humanMember, data: { ...event.data, dispatchId: dispatch.id, recipientAgentId: dispatch.recipientAgentId, cancelledDispatchIds: [] } });
    return clone(current);
  }
  return {
    ...communicationCommands(state, save),
    ...automationCommands(state),
    ...historyCommands(state, { databasePath, employeeConfiguration }),
    close() { this.closeHistory(); listeners.clear(); persistence.close(); },
    prepareDataReset() {
      if (state.runs.some(run => ["planning", "running", "review"].includes(run.status)) || state.traces.some(trace => trace.status === "running") || state.dispatches.some(delivery => delivery.status === "claimed") || state.communicationDeliveries.some(delivery => ["claimed", "running"].includes(delivery.status))) throw new Error("请先停止正在执行的任务和沟通，再清除数据");
      return state.runs.filter(run => getTask(run.taskId)?.workspaceManaged).map(run => ({ taskId: run.taskId, runId: run.id, path: resolve(run.workspacePath) }));
    },
    getNavigationNotifications() {
      const attention = new Set(["awaiting_human", "awaiting_acceptance", "paused", "blocked", "failed"]);
      return { taskAttentionCount: new Set(state.runs.filter(run => getTask(run.taskId)?.kind !== "automation" && !getTask(run.taskId)?.archivedAt && attention.has(run.status)).map(run => run.taskId)).size, communicationUnreadCount: this.listCommunications().reduce((sum, item) => sum + item.unreadCount, 0) };
    },
    getBootstrap() {
      const tasks = state.tasks.filter(task => task.kind !== "automation").map((task) => ({ id: task.id, title: task.title, objective: task.objective.slice(0, 240), status: task.status, workspaceKind: task.workspaceManaged ? "managed" : "legacy", memberAgentIds: taskReadModel(task).memberAgentIds, workflowTemplateId: task.workflowTemplateId, workflowSnapshot: { name: task.workflowSnapshot.name }, archivedAt: task.archivedAt, deletionBlockedBy: taskDeletionBlock(task.id), createdAt: task.createdAt, updatedAt: task.updatedAt }));
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const counts = new Map(state.runs.map((run) => [run.id, { traceCount: 0, artifactCount: 0 }]));
      for (const trace of state.traces) if (counts.has(trace.runId)) counts.get(trace.runId).traceCount++;
      for (const artifact of state.artifacts) if (counts.has(artifact.runId)) counts.get(artifact.runId).artifactCount++;
      return { installationId: state.settings.installationId, communicationUnreadCount: this.listCommunications().reduce((sum, item) => sum + item.unreadCount, 0), tasks: clone(tasks), runs: state.runs.filter(run => taskById.has(run.taskId)).map((run) => ({ id: run.id, taskId: run.taskId, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, task: clone(taskById.get(run.taskId)), ...counts.get(run.id) })), agents: this.listAgents(), roles: this.listRoles(), teams: this.listTeams(), workflowTemplates: this.listWorkflowTemplates(), events: state.events.filter(event => !event.type.startsWith("automation.") && (!event.runId || taskById.has(getRun(event.runId)?.taskId))).slice(-6).map((event) => ({ id: event.id, type: event.type, runId: event.runId, actor: clone(event.actor), timestamp: event.timestamp, message: event.message.slice(0, 240), data: {} })) };
    },
    getConsoleContentReference(runId, eventId) {
      const event = state.events.find(item => item.id === eventId && item.runId === runId && item.type === "runtime.event" && item.data?.auditVersion === 2);
      const trace = event && getTrace(event.data.traceId);
      const reference = event?.data?.contentRef;
      if (!getRun(runId) || !trace || trace.runId !== runId || trace.agentId !== event.actor?.id || !reference) throw new Error("执行内容不存在或当时未保存");
      const prefix = `runs/${runId}/traces/${trace.id}/`;
      if (!reference.storagePath?.startsWith(prefix) || !/^content-[0-9a-f-]{36}\.json$/.test(reference.storagePath.slice(prefix.length)) || !/^[0-9a-f]{64}$/.test(reference.sha256) || !Number.isInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > 300000) throw new Error("执行内容关联无效");
      return clone(reference);
    },
    getConsoleEvents(runId, { agentId, traceId = null, before = null, limit = 200 } = {}) {
      const current = getRun(runId);
      if (!current || !current.participants.some(member => member.type === "agent" && member.id === agentId)) throw new Error("Run 成员不存在");
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("日志页大小必须在 1 至 500 之间");
      if (traceId && !state.traces.some((trace) => trace.id === traceId && trace.runId === runId && trace.agentId === agentId)) throw new Error("Trace 不属于当前成员");
      const events = state.events.filter((event) => event.runId === runId && event.actor?.id === agentId && (!traceId || event.data?.traceId === traceId));
      const end = before ? events.findIndex((event) => event.id === before) : events.length;
      if (end < 0) throw new Error("日志游标无效，请刷新日志");
      const start = Math.max(0, end - limit), page = events.slice(start, end);
      return { events: page.map(consoleAuditProjection), total: events.length, hasMore: start > 0, nextBefore: page[0]?.id || null };
    },
    transaction(command) {
      if (transactionDepth) return command();
      const before = clone(state); transactionDepth = 1;
      let result;
      try { result = command(); if (result?.then) throw new Error("Store 事务必须同步"); persistence.save(state); }
      catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, before); pendingEvents.length = 0; throw error; }
      finally { transactionDepth = 0; }
      const events = pendingEvents.splice(0); events.forEach((event) => listeners.forEach((listener) => { try { listener(clone(event)); } catch { /* A subscriber cannot roll back committed state. */ } }));
      return result;
    },
    getWorkspaceSettings() { return { workspaceRoot: state.settings?.workspaceRoot || workspaceRoot, source: state.settings?.workspaceRoot ? "saved" : "startup" }; },
    listRuntimeProfiles() { return clone(profiles().map(item => { const installed = runtimeInstalled(item.provider); return { id: item.id, provider: item.provider, installed, enabled: installed && item.enabled !== false, model: item.model || "", effort: item.effort || "", employeeCount: state.agents.filter(agent => agent.status !== "deleted" && agent.runtime.profileId === item.id).length }; })); },
    resolveAgentRuntime(value) { return clone(resolveAgentRuntime(value)); },
    assertRuntimeEnabled(value) { assertRuntimeEnabled(value); },
    saveRuntimeProfile(input, profileId) {
      if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key => !["model", "effort", "enabled"].includes(key))) throw new Error("Runtime 仅接受 model、effort、enabled 的非空部分更新；不再支持具名连接");
      const previous = profiles().find(item => item.id === profileId);
      if (!previous) throw new Error("Runtime 配置不存在；仅可更新固定的 Claude Code/Codex/DeepSeek Harness");
      if (Object.hasOwn(input, "enabled") && typeof input.enabled !== "boolean") throw new Error("Runtime enabled 必须为布尔值");
      if (Object.hasOwn(input, "enabled") && !runtimeInstalled(previous.provider)) throw new Error("Runtime 未安装或当前客户端找不到可执行文件，不能改变可用开关");
      for (const key of ["model", "effort"]) if (Object.hasOwn(input, key) && typeof input[key] !== "string") throw new Error(`Runtime ${key} 必须为单行文本`);
      const connection = runtimeConnection({ provider: previous.provider, model: input.model ?? previous.model, effort: input.effort ?? previous.effort });
      return this.transaction(() => {
        Object.assign(previous, { model: connection.model, effort: connection.effort, enabled: input.enabled ?? (previous.enabled !== false) });
        delete previous.name; delete previous.executable; delete previous.profile;
        for (const employee of state.agents.filter(agent => agent.status !== "deleted" && agent.runtime.profileId === previous.id)) employee.runtime = resolveAgentRuntime(employee.runtime);
        addEvent({ type: "settings.runtime_updated", actor: humanMember, message: "人类更新了本机 Runtime 配置", data: { profileId: previous.id, enabled: previous.enabled } });
        return this.listRuntimeProfiles().find(item => item.id === previous.id);
      });
    },
    updateWorkspaceSettings(input) {
      const path = input?.workspaceRoot;
      if (typeof path !== "string" || !isAbsolute(path) || resolve(path) === "/" || path.includes("\0") || path.length > 4096) throw new Error("系统工作根目录必须是非根绝对目录");
      return this.transaction(() => {
        state.settings = { ...state.settings, workspaceRoot: resolve(path) };
        addEvent({ type: "settings.workspace_updated", actor: humanMember, message: "人类更新了新任务的默认工作目录", data: {} });
        return this.getWorkspaceSettings();
      });
    },
    listDispatches(runId) { return clone(state.dispatches.filter((item) => item.runId === runId)); },
    memberResponsibility(runId, agentId) {
      const item = state.dispatches.findLast(item => item.runId === runId && item.recipientAgentId === agentId && ["node", "instruction"].includes(item.purpose));
      return item?.workflowNodeId || null;
    },
    prepareMemberSession(dispatchId, traceId, cwd) {
      const delivery = this.getDispatch(dispatchId), current = getRun(delivery.runId), trace = getTrace(traceId);
      if (delivery.status !== "claimed" || trace?.dispatchId !== dispatchId || trace.status !== "running" || !isAbsolute(cwd)) throw new Error("会话必须绑定已领取的成员执行");
      current.memberSessions ||= {};
      let session = current.memberSessions[delivery.recipientAgentId];
      const needsNativeConfirmation = ["codex", "dsh"].includes(runAgent(current, trace.agentId).runtime.provider);
      const resume = Boolean(session?.sessionId && (!needsNativeConfirmation || session.nativeConfirmed));
      if (session && session.cwd !== cwd) throw new Error("同一成员会话的工作目录不能改变");
      if (!session?.sessionId) {
        session = { ...session, sessionId: randomUUID(), cwd, createdAt: now(), lastTraceId: traceId };
        current.memberSessions[delivery.recipientAgentId] = session;
      }
      session.lastTraceId = traceId;
      trace.providerSessionId = needsNativeConfirmation && !session.nativeConfirmed ? null : session.sessionId; trace.sessionMode = resume ? "resume" : "new";
      addEvent({ type: resume ? "session.resumed" : "session.created", runId: current.id, actor: { type: "agent", id: trace.agentId, name: runAgent(current, trace.agentId).name }, message: resume ? "续接该成员的既有会话。" : "为该成员建立独立会话。", data: { traceId, dispatchId, sessionId: session.sessionId } });
      save(); return { ...clone(session), resume };
    },
    bindProviderSession(traceId, providerSessionId) {
      const trace = getTrace(traceId), current = getRun(trace?.runId), session = current?.memberSessions?.[trace?.agentId];
      if (!session || session.lastTraceId !== traceId || trace.status !== "running" || !["codex", "dsh"].includes(runAgent(current, trace.agentId).runtime.provider) || !/^[a-zA-Z0-9-]{16,80}$/.test(providerSessionId)) throw new Error("Provider 会话绑定无效");
      if (session.nativeConfirmed && session.sessionId !== providerSessionId) throw new Error("Provider 会话与成员绑定不一致");
      session.sessionId = providerSessionId; session.nativeConfirmed = true; trace.providerSessionId = providerSessionId;
      save();
    },
    memberInputMessages(dispatchId) {
      const delivery = this.getDispatch(dispatchId), current = getRun(delivery.runId);
      const messages = state.messages.filter(item => item.runId === current.id);
      const through = current.memberSessions?.[delivery.recipientAgentId]?.inputThroughMessageId;
      const received = new Set(current.memberSessions?.[delivery.recipientAgentId]?.inputMessageIds || []);
      const previous = through ? messages.findIndex(item => item.id === through) : -1;
      return clone(messages.filter((item, index) => !received.has(item.id) && item.sender.id !== delivery.recipientAgentId &&
        (delivery.messageIds.includes(item.id) || index > previous &&
          (delivery.recipientAgentId === current.manager.id || item.recipient.id === delivery.recipientAgentId || item.recipient.type === "team"))));
    },
    confirmMemberInput(traceId, messageId, inputContext, messageIds) {
      const trace = getTrace(traceId), current = getRun(trace?.runId), session = current?.memberSessions?.[trace?.agentId];
      if (!session || session.lastTraceId !== traceId) throw new Error("不能确认其他成员会话的输入");
      if (messageId && !state.messages.some(item => item.runId === current.id && item.id === messageId)) throw new Error("输入游标不属于 Run");
      const delivered = messageIds || this.memberInputMessages(trace.dispatchId).map(item => item.id);
      if (delivered.some(id => !state.messages.some(item => item.runId === current.id && item.id === id))) throw new Error('输入消息不属于 Run');
      session.inputMessageIds = [...new Set([...(session.inputMessageIds || []), ...delivered])];
      session.inputThroughMessageId = messageId;
      if (inputContext) session.inputContext = clone(inputContext);
      save();
    },
    resetMemberSession(traceId, reason) {
      const trace = getTrace(traceId), current = getRun(trace?.runId), session = current?.memberSessions?.[trace?.agentId];
      if (!session || session.sessionId !== trace.providerSessionId || session.lastTraceId !== traceId) throw new Error("不能重建其他执行的会话");
      const previousSessionId = session.sessionId;
      session.sessionId = null; session.nativeConfirmed = false;
      delete session.inputContext;
      addEvent({ type: "session.reset", runId: current.id, actor: { type: "agent", id: trace.agentId, name: runAgent(current, trace.agentId).name }, message: "原生会话不可用，下次创建新会话；已确认的平台消息不重放，需要过去资料时查询历史工具。", data: { traceId, sessionId: previousSessionId, reason } });
      save();
    },
    listPatrolRunIds() {
      return state.runs.filter(run => !getTask(run.taskId).archivedAt && (["planning", "running", "review"].includes(run.status) || ["completed", "cancelled", "paused"].includes(run.status) && state.dispatches.some(item => item.runId === run.id && item.interactionOnly && item.status === "queued"))).map(run => run.id);
    },
    prepareRunPatrol(runId) {
      // Detection only reads metadata; clone/persist only when creating work.
      const current = getRun(runId);
      if (!current || getTask(current.taskId).archivedAt || current.status === "failed" || this.hasPendingHumanQuestion(runId)) return false;
      const deliveries = state.dispatches.filter(item => item.runId === runId);
      if (deliveries.some(item => item.status === "claimed") || state.traces.some(trace => trace.runId === runId && trace.status === "running")) return false;
      const active = ["planning", "running", "review"].includes(current.status);
      const queued = deliveries.filter(item => item.status === "queued" && (active || item.interactionOnly));
      if (queued.length) return queued.some(item => !item.nextRetryAt || Date.parse(item.nextRetryAt) <= Date.now());
      if (!active) return false;
      return this.transaction(() => {
        const lastTrace = state.traces.filter(trace => trace.runId === runId).at(-1);
        this.enqueueDispatch(runId, { recipientAgentId: current.manager.id, workflowNodeId: current.currentFocus?.nodeId || getTask(current.taskId).workflowSnapshot.nodes[0].id, purpose: "manager", dedupeKey: "patrol:" + (lastTrace?.id || "initial"), coordinationFollowup: true, patrol: true });
        addEvent({ type: "run.manager_patrol", runId, message: "运行中暂无执行者，已触发经理继续推进。", data: { trigger: "idle", intervalMs: 10000 } });
        return true;
      });
    },
    initializeDispatches(runId) {
      return this.transaction(() => {
        const current = getRun(runId), task = getTask(current.taskId);
        if (state.dispatches.some((item) => item.runId === runId) || ["completed", "cancelled", "failed", "awaiting_acceptance"].includes(current.status)) return;
        const nodeId = current.waitingNodeId || task.workflowSnapshot.nodes[0].id;
        const question = state.messages.filter((item) => item.runId === runId && item.conversationId === current.waitingConversationId && ["agent_consultation", "clarification_question"].includes(item.kind)).at(-1);
        if (question) {
          const parent = this.enqueueDispatch(runId, { recipientAgentId: question.sender.id, workflowNodeId: nodeId, purpose: question.sender.id === current.manager.id ? "manager" : "node", messageIds: [question.id], dedupeKey: "legacy-wait:" + question.id });
          const record = find(state.dispatches, parent.id); record.status = "waiting"; record.waitingMessageId = question.id;
          if (question.recipient.type === "agent") this.enqueueDispatch(runId, { recipientAgentId: question.recipient.id, workflowNodeId: task.workflowSnapshot.nodes.find((node) => task.nodeAssignments[node.id] === question.recipient.id)?.id || nodeId, purpose: "consultation", messageIds: [question.id], parentDispatchId: parent.id, dedupeKey: "question:" + question.id });
        } else this.enqueueDispatch(runId, { recipientAgentId: current.manager.id, workflowNodeId: nodeId, purpose: "manager", messageIds: current.pendingMessageIds || [], dedupeKey: "initial-manager" });
        this.syncWaiting(runId);
      });
    },
    getDispatch(dispatchId) { const item = find(state.dispatches, dispatchId); if (!item) throw new Error("Dispatch 不存在"); return clone(item); },
    enqueueDispatch(runId, input) {
      const current = getRun(runId);
      if (input.parentDispatchId && find(state.dispatches, input.parentDispatchId)?.runId !== runId) throw new Error("父投递不属于当前 Run");
      const interactionOnly = input.purpose === "inquiry" || Boolean(input.parentDispatchId && find(state.dispatches, input.parentDispatchId)?.interactionOnly);
      if (!current || getTask(current.taskId).archivedAt || (current.status === "failed" || ["completed", "cancelled"].includes(current.status) && !interactionOnly)) throw new Error("Run 不接受新投递");
      if (!runAgent(current, input.recipientAgentId)) throw new Error("投递收件人必须是 Run 数字员工");
      assertNode(current, input.workflowNodeId);
      if (!["manager", "node", "consultation", "instruction", "delivery_review", "inquiry"].includes(input.purpose)) throw new Error("投递用途无效");
      if (input.sourceMessageId != null && find(state.messages, input.sourceMessageId)?.runId !== runId) throw new Error("投递来源消息不属于 Run");
      const existing = input.dedupeKey && state.dispatches.find((item) => item.runId === runId && item.dedupeKey === input.dedupeKey);
      if (existing) return clone(existing);
      const messageIds = [...new Set(input.messageIds || [])];
      if (messageIds.some((value) => find(state.messages, value)?.runId !== runId)) throw new Error("投递消息不属于 Run");
      const item = { id: id("dispatch"), runId, recipientAgentId: input.recipientAgentId, workflowNodeId: input.workflowNodeId, purpose: input.purpose, interactionOnly, messageIds, sourceMessageId: input.sourceMessageId || null, parentDispatchId: input.parentDispatchId || null, waitingMessageId: null, status: "queued", attempts: 0, nextRetryAt: null, traceIds: [], dedupeKey: input.dedupeKey || null, ...(input.patrol ? { patrol: true } : {}), ...(input.coordinationFollowup ? { coordinationFollowup: true } : {}), ...(input.deferredRevisit ? { deferredRevisit: true } : {}), createdAt: now(), updatedAt: now() };
      state.dispatches.push(item); save(); return clone(item);
    },
    hasPendingHumanQuestion(runId) { return this.pendingQuestions(runId).some((item) => item.recipient.type === "human"); },
    canExecuteDispatch(dispatchId) {
      const item = find(state.dispatches, dispatchId), current = getRun(item?.runId);
      return Boolean(current && current.status !== "failed" && !this.hasPendingHumanQuestion(current.id) && !getTask(current.taskId).archivedAt && item.status === "claimed" && (["running", "review"].includes(current.status) || item.interactionOnly));
    },
    cancelInquiries(runId) {
      if (!getRun(runId)) throw new Error("Run 不存在");
      for (const item of state.dispatches.filter((item) => item.runId === runId && item.interactionOnly && !["done", "cancelled"].includes(item.status))) { item.status = "cancelled"; item.nextRetryAt = null; item.updatedAt = now(); }
      this.syncWaiting(runId);
      addEvent({ type: "run.inquiries_cancelled", runId, actor: humanMember, message: "人类已停止本轮答疑；原任务状态不变。", data: {} }); save();
    },
    claimDispatch(runId) {
      const current = getRun(runId);
      if (!current || current.status === "failed" || getTask(current.taskId).archivedAt || state.dispatches.some((item) => item.runId === runId && item.status === "claimed")) return null;
      if (this.hasPendingHumanQuestion(runId)) return null;
      const ready = item => item.runId === runId && item.status === "queued" && (["planning", "running", "review"].includes(current.status) || item.interactionOnly) && (!item.nextRetryAt || Date.parse(item.nextRetryAt) <= Date.now());
      const requested = find(state.dispatches, current.pendingRetryDispatchId);
      const item = requested && ready(requested) ? requested : state.dispatches.find(ready);
      if (!item) return null;
      if (current.pendingRetryDispatchId === item.id) delete current.pendingRetryDispatchId;
      item.status = "claimed"; item.attempts += 1; item.updatedAt = now(); save(); return clone(item);
    },
    attachDispatchTrace(dispatchId, traceId) {
      const item = find(state.dispatches, dispatchId), trace = getTrace(traceId);
      if (!item || item.status !== "claimed" || trace?.runId !== item.runId || trace.agentId !== item.recipientAgentId) throw new Error("投递与 Trace 不匹配");
      item.traceIds.push(traceId); trace.dispatchId = dispatchId; save();
    },
    retryDispatch(dispatchId, error, delayMs = 300000, failure = null) {
      const item = find(state.dispatches, dispatchId);
      if (!item || item.status !== "claimed") return;
      item.status = "queued"; item.lastError = String(error); item.nextRetryAt = new Date(Date.now() + delayMs).toISOString(); item.updatedAt = now();
      if (failure) { item.lastErrorKind = failure.kind; item.lastErrorSignature = failure.signature; item.errorStreak = failure.streak || 1; }
      addEvent({ type: "dispatch.retry_scheduled", runId: item.runId, message: "调用未完成，投递已保留并安排重试。", data: { dispatchId, nextRetryAt: item.nextRetryAt, error: item.lastError, ...(failure ? { failureKind: failure.kind, errorStreak: item.errorStreak } : {}) } }); save();
      return clone(item);
    },
    stopFailedDispatch(dispatchId, error, failure) {
      return this.transaction(() => {
        const item = find(state.dispatches, dispatchId), current = item && getRun(item.runId);
        if (!item || item.status !== 'claimed') throw new Error('投递未领取，不能停止失败重试');
        item.status = 'cancelled'; item.nextRetryAt = null; item.updatedAt = now(); item.lastError = String(error);
        item.lastErrorKind = failure?.kind; item.lastErrorSignature = failure?.signature; item.errorStreak = failure?.streak || 1;
        addEvent({ type: 'dispatch.retry_stopped', runId: item.runId, message: '自动重试已停止；请先排查原始错误，再由人类明确恢复。', data: { dispatchId, error: item.lastError, attempts: item.attempts, failureKind: failure?.kind } });
        if (!item.interactionOnly && ['planning', 'running', 'review'].includes(current.status)) { this.failRun(item.runId, item.lastError, 'runtime'); current.failure.dispatchId = item.id; }
        return clone(item);
      });
    },
    escalateFailedDispatch(dispatchId, { error, kind, signature, streak } = {}) {
      return this.transaction(() => {
        const item = find(state.dispatches, dispatchId), current = item && getRun(item.runId);
        if (!item || item.status !== "claimed" || !current) throw new Error("投递未领取，不能升级");
        if (!["node", "instruction"].includes(item.purpose)) throw new Error("只有业务投递可以升级经理处置");
        const kindLabel = kind === "workspace_artifact" ? "工作区/Artifact 校验" : "协议/结果校验";
        item.status = "cancelled"; item.nextRetryAt = null;
        item.lastError = String(error); item.lastErrorKind = kind; item.lastErrorSignature = signature; item.errorStreak = streak || 1;
        item.escalatedAt = now(); item.updatedAt = now();
        const note = this.addMessage({ runId: item.runId, workflowNodeId: item.workflowNodeId, sender: { type: "system", id: "agentforge", name: "AgentForge" }, recipientAgentId: current.manager.id, kind: "escalation", content: `自动升级：投递 ${dispatchId}（职责 ${item.workflowNodeId} → 成员 ${item.recipientAgentId}）连续两次遭确定性拒收，最近一次是${kindLabel}错误；自动重试已停止，原投递作为事实保留为已终止。失败摘要：${item.lastError}。请先安排团队成员做具体修复（例如由责任成员清理其引入的受限文件/符号链接、修正交付路径或结果格式），并核对修复后的真实 Artifact；只有确需产品取舍、额外权限或团队无法取得的外部事实时才询问人类。无法修复时在协作记录中明确阻塞原因；失败 Trace 与投递历史均未改写。` });
        this.enqueueDispatch(item.runId, { recipientAgentId: current.manager.id, workflowNodeId: item.workflowNodeId, purpose: "manager", messageIds: [note.id], sourceMessageId: note.id, dedupeKey: "escalate:" + dispatchId });
        addEvent({ type: "dispatch.escalated", runId: item.runId, message: `连续两次确定性拒收，最近一次为${kindLabel}错误；已停止重试并升级项目经理处置。`, data: { dispatchId, failureKind: kind, attempts: item.attempts, errorStreak: item.errorStreak, error: item.lastError } });
        return clone(item);
      });
    },
    retryScheduledDispatches(runId) {
      return this.transaction(() => {
        const current = getRun(runId), task = getTask(current?.taskId);
        if (!current || !task || task.archivedAt) throw new Error("Run 不存在或任务已归档");
        const retries = state.dispatches.filter((item) => item.runId === runId && item.status === "queued" && item.nextRetryAt && (["planning", "running", "review"].includes(current.status) || item.interactionOnly));
        if (!retries.length) throw new Error("当前没有等待退避的可重试调用");
        const dispatchIds = retries.map((item) => item.id);
        for (const item of retries) { item.nextRetryAt = null; item.updatedAt = now(); }
        addEvent({ type: "dispatch.retry_requested", runId, actor: humanMember, message: `人类请求立即重试 ${retries.length} 个等待退避的调用；失败 Trace 与原投递已保留。`, data: { dispatchIds } });
        return { run: clone(current), dispatchIds };
      });
    },
    completeDispatch(dispatchId) {
      const item = find(state.dispatches, dispatchId);
      if (!item || item.status !== "claimed") throw new Error("投递未领取，不能确认");
      item.status = "done"; item.updatedAt = now(); item.nextRetryAt = null; delete item.continueRequested; save();
    },
    pendingQuestions(runId) {
      const ids = state.dispatches.filter((item) => item.runId === runId && item.status === "waiting").map((item) => item.waitingMessageId);
      return clone(state.messages.filter((item) => ids.includes(item.id)));
    },
    syncWaiting(runId) {
      const current = getRun(runId), task = getTask(current.taskId);
      const question = this.pendingQuestions(runId).find((item) => item.recipient.type === "human") || this.pendingQuestions(runId).at(-1);
      current.waitingNodeId = question?.workflowNodeId || null;
      current.waitingConversationId = question?.conversationId || null;
      current.waitingAgentId = question?.recipient.type === "agent" ? question.recipient.id : null;
      if (!["paused", "cancelled", "completed", "failed", "awaiting_acceptance"].includes(current.status)) {
        if (question?.recipient.type === "human") { current.status = "awaiting_human"; task.status = "awaiting_human"; }
        else if (current.status === "awaiting_human") { current.status = "running"; task.status = "running"; }
      }
      save();
    },
    handoffDispatch(dispatchId, recipientAgentId, content, traceId) {
      return this.transaction(() => {
        const delivery = find(state.dispatches, dispatchId), current = getRun(delivery?.runId);
        if (!delivery || !this.canExecuteDispatch(dispatchId)) throw new Error("当前投递不能交接");
        if (recipientAgentId === delivery.recipientAgentId) throw new Error("不能 @ 自己");
        const sender = runAgent(current, delivery.recipientAgentId);
        if (recipientAgentId === humanMember.id) return this.askQuestion(dispatchId, { audience: "human", question: content }, traceId);
        if (!runAgent(current, recipientAgentId)) throw new Error("交接接收者不属于当前 Run");
        if (delivery.purpose === "consultation") {
          const parent = find(state.dispatches, delivery.parentDispatchId);
          if (parent?.recipientAgentId === recipientAgentId) {
            const message = this.answerQuestion(current.id, parent.waitingMessageId, content, { type: "agent", id: sender.id, name: sender.name }, traceId);
            this.completeDispatch(dispatchId); return message;
          }
          return this.askQuestion(dispatchId, { audience: "agent", recipientAgentId, question: content }, traceId);
        }
        const message = this.addMessage({ runId: current.id, workflowNodeId: delivery.workflowNodeId, traceId, sender: { type: "agent", id: sender.id, name: sender.name }, recipientAgentId, kind: "handoff", content });
        this.completeDispatch(dispatchId);
        this.enqueueDispatch(current.id, { recipientAgentId, workflowNodeId: this.memberResponsibility(current.id, recipientAgentId) || delivery.workflowNodeId, purpose: recipientAgentId === current.manager.id ? "manager" : "instruction", messageIds: [message.id], sourceMessageId: message.id, dedupeKey: "handoff-message:" + message.id });
        return message;
      });
    },
    askQuestion(dispatchId, consultation, traceId) {
      return this.transaction(() => {
        const delivery = find(state.dispatches, dispatchId), current = getRun(delivery?.runId);
        if (!delivery || delivery.status !== "claimed") throw new Error("咨询投递未领取");
        const questionType = consultation.questionType || "协作", routingReason = consultation.routingReason || "员工请求转交";
        const considered = Array.isArray(consultation.consideredMemberIds) ? consultation.consideredMemberIds : [];
        const human = consultation.audience === "human", recipientId = consultation.recipientAgentId;
        if (human && getTask(current.taskId).kind === "automation") throw new Error("自动化不接受人类澄清，请咨询经理或其他员工；无法继续则明确报告错误");
        if (!human && consultation.audience !== "agent") throw new Error("咨询受众无效");
        if (!human && (!runAgent(current, recipientId) || recipientId === delivery.recipientAgentId)) throw new Error("消息需要一个可送达的其他成员");
        const sender = runAgent(current, delivery.recipientAgentId);
        const message = this.addMessage({ runId: current.id, workflowNodeId: delivery.workflowNodeId, traceId, conversationId: id("conversation"), sender: { type: "agent", id: sender.id, name: sender.name }, recipientHuman: human, recipientAgentId: human ? null : recipientId, kind: human ? "clarification_question" : "agent_consultation", content: consultation.question, questionType, routingReason, consideredMemberIds: considered });
        delivery.status = "waiting"; delivery.waitingMessageId = message.id; delivery.updatedAt = now(); delivery.messageIds.push(message.id);
        if (!human) {
          this.enqueueDispatch(current.id, { recipientAgentId: recipientId, workflowNodeId: this.memberResponsibility(current.id, recipientId) || delivery.workflowNodeId, purpose: "consultation", messageIds: [message.id], sourceMessageId: message.id, parentDispatchId: delivery.id, dedupeKey: "question:" + message.id });
        }
        this.syncWaiting(current.id); return message;
      });
    },
    answerQuestion(runId, questionId, content, sender, traceId = null) {
      return this.transaction(() => {
        const current = getRun(runId), question = find(state.messages, questionId);
        const waiting = state.dispatches.find((item) => item.runId === runId && item.status === "waiting" && item.waitingMessageId === questionId);
        if (!current || getTask(current.taskId).archivedAt || !waiting || question?.recipient.id !== sender.id || question?.recipient.type !== sender.type) throw new Error("不存在匹配的待回答问题");
        const message = this.addMessage({ runId, workflowNodeId: question.workflowNodeId, conversationId: question.conversationId, replyToMessageId: questionId, traceId, sender, recipientAgentId: question.sender.id, kind: sender.type === "human" ? "clarification_answer" : "consultation_answer", content });
        waiting.status = "queued"; waiting.waitingMessageId = null; waiting.nextRetryAt = null; waiting.messageIds.push(message.id); waiting.updatedAt = now();
        this.syncWaiting(runId); return message;
      });
    },
    updateRunMembers(runId, input = {}) {
      return this.transaction(() => {
        const current=getRun(runId), task=getTask(current?.taskId);
        if(!current || task.archivedAt || ["completed","cancelled"].includes(current.status)) throw new Error("当前任务状态不允许修改成员");
        if(!input || Object.keys(input).some(key=>key!=="memberAgentIds") || !Array.isArray(input.memberAgentIds) || new Set(input.memberAgentIds).size!==input.memberAgentIds.length || input.memberAgentIds.some(id=>typeof id!=="string"))throw new Error("请提供不重复的 memberAgentIds 数组");
        const selected=input.memberAgentIds.map(agentId => agentId === current.manager.sourceAgentId ? current.manager.id : agentId);
        if(new Set(selected).size!==selected.length)throw new Error("请勿重复选择同一员工");
        if(!selected.includes(current.manager.id))throw new Error("任务必须保留当前项目经理");
        const before=current.participants.filter(item=>item.type==="agent" && !(current.removedParticipantIds || []).includes(item.id));
        const removed=before.filter(item=>!selected.includes(item.id));
        for(const member of removed) {
          if(state.traces.some(trace=>trace.runId===runId&&trace.agentId===member.id&&trace.status==="running") || state.dispatches.some(delivery=>delivery.runId===runId&&delivery.recipientAgentId===member.id&&!["done","cancelled"].includes(delivery.status)))throw new Error(`「${member.name}」仍有执行、待处理或等待回复的投递，暂不能移除`);
        }
        const added=selected.filter(id=>!before.some(member=>member.id===id));
        for(const agentId of added) {
          const employee=currentEmployee(agentId);
          if(!employee || employee.status!=="active")throw new Error("新增成员必须是可用数字员工");
          if(employee.kind==="manager")throw new Error("任务只允许当前一位项目经理");
          const frozen=current.participants.find(item=>item.id===agentId);
          if(!frozen){assertRuntimeEnabled(resolveAgentRuntime(employee.runtime));current.participants.push({...withRoleSnapshot(employeeConfiguration(employee)),type:"agent"});}
        }
        current.removedParticipantIds=current.participants.filter(item=>item.type==="agent"&&!selected.includes(item.id)).map(item=>item.id);
        task.updatedAt=now();
        addEvent({type:"run.members_updated",runId,actor:humanMember,message:"人类更新了当前任务成员；历史快照和记录保留。",data:{addedAgentIds:added,removedAgentIds:removed.map(item=>item.id)}});
        save();return {runId,memberAgentIds:selected,members:current.participants.filter(item=>item.type==="agent"&&selected.includes(item.id)).map(({id,name,kind})=>({id,name,kind}))};
      });
    },
    submitHumanMessage(runId, input) {
      return this.transaction(() => {
        const current = getRun(runId), task = getTask(current?.taskId);
        if (!current || task.archivedAt) throw new Error("任务已归档，不接受新消息");
        if (task.kind === "automation") throw new Error("自动化不接受人类协作消息");
        if (current.status === "failed") throw new Error("任务因错误中断，请先重试失败员工；当前不能发送消息或 @ 其他成员");
        if (!input.replyToMessageId && this.pendingQuestions(runId).some(question => question.recipient.type === "human")) throw new Error("任务正在等待人类澄清，请先回复待回答问题，不能追加新指令");
        const interactionOnly = ["completed", "cancelled", "paused"].includes(current.status);
        if (current.status === "awaiting_acceptance" && !input.replyToMessageId) {
          current.status = "running"; current.deliveryReview = null; current.acceptanceRequest = null; task.status = "running"; task.updatedAt = now();
          addEvent({ type: "run.acceptance_reopened", runId, actor: humanMember, message: "人类追加消息，重新进入团队协作并等待新的验收结论。", data: {} });
        }
        if (input.replyToMessageId) return { message: this.answerQuestion(runId, input.replyToMessageId, input.content, { type: "human", id: humanMember.id, name: humanMember.name }), resumed: current.status !== "paused", queued: true };
        const recipientId = input.recipientAgentId ?? current.manager.id;
        const recipient = runAgent(current, recipientId);
        if (!recipient) throw new Error("消息接收者不属于当前 Run");
        if (interactionOnly && getAgent(recipient.sourceAgentId || recipient.id)?.status === "deleted") throw new Error("此员工已删除，任务结束后不再接收新答疑");
        const message = this.addMessage({ runId, recipientAgentId: recipientId, content: input.content, kind: interactionOnly ? "inquiry" : "instruction" });
        const ownNode = this.memberResponsibility(runId, recipientId);
        if (interactionOnly) {
          this.enqueueDispatch(runId, { recipientAgentId: recipientId, workflowNodeId: ownNode || task.workflowSnapshot.nodes[0].id, purpose: "inquiry", messageIds: [message.id], sourceMessageId: message.id, dedupeKey: "message:" + message.id });
        } else if (recipientId === current.manager.id) {
          this.enqueueDispatch(runId, { recipientAgentId: current.manager.id, workflowNodeId: task.workflowSnapshot.nodes[0].id, purpose: "manager", messageIds: [message.id], sourceMessageId: message.id, dedupeKey: "message:" + message.id });
        } else {
          this.enqueueDispatch(runId, { recipientAgentId: recipientId, workflowNodeId: ownNode || current.currentFocus?.nodeId || task.workflowSnapshot.nodes[0].id, purpose: "instruction", messageIds: [message.id], sourceMessageId: message.id, dedupeKey: "message:" + message.id });
        }
        this.syncWaiting(runId); return { message, queued: true, resumed: false, interactionOnly };
      });
    },
    confirmAutomationCompletion(runId, triggerId) {
      const current = getRun(runId), task = getTask(current?.taskId);
      if (!current || task.kind !== "automation" || current.status !== "awaiting_acceptance" || !this.canCompleteRun(runId)) throw new Error("自动确认只能用于已结束执行的自动化待验收记录");
      current.status = "completed"; current.completedAt = now(); current.confirmedAt = current.completedAt; current.confirmedBy = "automation"; current.confirmedByTriggerId = triggerId;
      current.summary = "下一轮执行前已自动确认完成。"; current.currentFocus = null;
      task.status = "done"; task.updatedAt = now();
      addEvent({ type: "run.completed", runId, message: current.summary, data: { confirmedAt: current.confirmedAt, triggerId, completion: "automatic" } }); save(); return clone(current);
    },
    confirmRunCompletion(runId) {
      return this.transaction(() => {
        const current = getRun(runId), task = getTask(current?.taskId);
        if (!current || task.archivedAt || current.status !== "awaiting_acceptance") throw new Error("请在人类验收阶段确认完成");
        this.settleCoordinationFollowups(runId);
        current.status = "completed"; current.completedAt = now(); current.confirmedAt = current.completedAt; current.confirmedBy = humanMember.id;
        current.summary = "人类已验收并确认任务完成。";
        current.currentFocus = null;
        task.status = "done"; task.updatedAt = now();
        addEvent({ type: "run.completed", runId, actor: humanMember, message: "人类已验收并确认任务完成。", data: { confirmedAt: current.confirmedAt } }); save(); return clone(current);
      });
    },
    recordDeliveryReview(runId, traceId, input) {
      const current = getRun(runId);
      current.deliveryReview = { ...clone(input), traceId };
      save(); return clone(current.deliveryReview);
    },
    // Platform-created coordination follow-ups (deferred-decision revisits,
    // format corrections, delivery notices) exist only to continue coordination.
    // A concluded Run makes them unclaimable forever, so the terminal decision
    // legitimately cancels them with an audit record — never silently.
    settleCoordinationFollowups(runId) {
      const pending = state.dispatches.filter((item) => item.runId === runId && item.coordinationFollowup && !["done", "cancelled"].includes(item.status));
      if (!pending.length) return [];
      for (const item of pending) { item.status = "cancelled"; item.nextRetryAt = null; item.updatedAt = now(); }
      addEvent({ type: "dispatch.coordination_followups_settled", runId, message: "终止安排或人类确认已取代未执行的平台协调复核投递；这些投递已取消并保留记录。", data: { dispatchIds: pending.map((item) => item.id) } });
      save(); return pending.map((item) => item.id);
    },
    requestHumanAcceptance(runId, { traceId = null, summary = "项目经理已提交人类验收。" } = {}) {
      const current = getRun(runId), task = getTask(current.taskId);
      if (task.kind === "automation" && summary === "项目经理已提交人类验收。") summary = "项目经理已完成本轮交付。";
      this.settleCoordinationFollowups(runId);
      current.acceptanceRequest = { traceId, summary, requestedAt: now(), managerAgentId: current.manager.id };
      current.status = "awaiting_acceptance"; current.summary = summary;
      task.status = "awaiting_acceptance"; task.updatedAt = now();
      addEvent({ type: "run.awaiting_acceptance", runId, actor: { type: "agent", id: current.manager.id, name: current.manager.name }, message: summary, data: { acceptanceRequest: clone(current.acceptanceRequest) } });
      save(); return clone(current);
    },
    canCompleteRun(runId) { return !state.traces.some((item) => item.runId === runId && item.status === "running") && !state.dispatches.some((item) => item.runId === runId && !["done", "cancelled"].includes(item.status)); },
    assertTaskDeletionAllowed(taskId) { const task = getTask(taskId); if (!task) throw new Error("Task 不存在"); if (task.kind === "automation") throw new Error("自动化触发历史需保留，请停用自动化"); const blockedBy = taskDeletionBlock(taskId); if (blockedBy) throw new Error(taskDeletionError(blockedBy)); return taskReadModel(task); },
    deleteTask(taskId) { const task = this.assertTaskDeletionAllowed(taskId); const relatedRuns = state.runs.filter((run) => run.taskId === taskId); const runIds = new Set(relatedRuns.map((run) => run.id)); state.tasks = state.tasks.filter((item) => item.id !== taskId); state.runs = state.runs.filter((item) => !runIds.has(item.id)); state.traces = state.traces.filter((item) => !runIds.has(item.runId)); state.artifacts = state.artifacts.filter((item) => !runIds.has(item.runId)); state.messages = state.messages.filter((item) => !runIds.has(item.runId)); state.dispatches = state.dispatches.filter((item) => !runIds.has(item.runId)); state.decisions = state.decisions.filter((item) => !runIds.has(item.runId)); state.events = state.events.filter((item) => !runIds.has(item.runId)); save(); return { task: clone(task), runIds: [...runIds] }; },
    getExecutionLogs: (query) => executionLogs(state, query),
    snapshot: () => clone(state), subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, addEvent,
    listAgents: () => state.agents.filter(item => item.status !== "deleted").map(employeeConfiguration), listTeams: () => clone(state.teams.map((item) => {
      const { managerAgentId, ...team } = item, memberAgentIds = teamMembers(item);
      return { ...team, memberAgentIds, members: memberAgentIds.map(value => ({ ...employeeConfiguration(getAgent(value)), type: "agent" })) };
    })), listTasks: () => state.tasks.filter(task => task.kind !== "automation").map(taskReadModel), listWorkflowTemplates: () => clone(state.workflowTemplates), timeline: (runId = null) => clone(state.events.filter((item) => !runId || item.runId === runId)),
    listRuns: () => clone(state.runs.map((item) => ({ ...item, task: taskReadModel(getTask(item.taskId)), traceCount: state.traces.filter((trace) => trace.runId === item.id).length, artifactCount: state.artifacts.filter((artifact) => artifact.runId === item.id).length }))),
    getRun(runId) { const item = getRun(runId); if (!item) throw new Error("Run 不存在"); return clone(item); }, getTask(taskId) { const item = getTask(taskId); if (!item) throw new Error("任务不存在"); return taskReadModel(item); }, getRunAgent(runId, agentId) { return clone(runAgent(getRun(runId), agentId)); },
    getRunTask(runId) { const current = getRun(runId); if (!current) throw new Error("Run 不存在"); const task = getTask(current.taskId); return clone({ ...taskReadModel(task), memberAgentIds: current.participants.filter(item=>item.type==="agent" && !(current.removedParticipantIds || []).includes(item.id)).map(item=>item.id), taskWorkspacePath: task.workspacePath, workspacePath: current.workspacePath || task.workspacePath, deletionBlockedBy: taskDeletionBlock(task.id) }); },
    getRunWorkspace(runId, { summary = false } = {}) { const current = getRun(runId); if (!current) throw new Error("Run 不存在"); const traces = state.traces.filter((item) => item.runId === runId).map((item) => ({ ...item, agent: summary ? { id: item.agentId, name: current.participants.find(member=>member.id===item.agentId)?.name } : current.participants.find(member=>member.id===item.agentId) })); const artifacts = state.artifacts.filter((item) => item.runId === runId).map((item) => (summary ? { ...item } : { ...item, trace: getTrace(item.traceId), agent: current.participants.find(member=>member.id===item.ownerAgentId) })); return clone({ deletedAgentIds: state.agents.filter(item => item.status === "deleted").map(item => item.id), failureEvents: state.events.filter((event) => event.runId === runId && event.type === "trace.failed").slice(-20).map(consoleAuditProjection), pendingQuestions: this.pendingQuestions(runId), dispatches: this.listDispatches(runId), run: { ...current, task: this.getRunTask(runId), artifactCount: artifacts.length }, traces, artifacts, messages: state.messages.filter((item) => item.runId === runId), decisions: state.decisions.filter((item) => item.runId === runId), events: state.events.filter((item) => item.runId === runId && (!summary || ["dispatch.retry_scheduled", "dispatch.retry_requested", "dispatch.retry_stopped", "dispatch.escalated", "dispatch.coordination_followups_settled", "session.reset", "run.completed", "run.awaiting_acceptance", "run.acceptance_reopened", "run.recovered", "run.cancelled", "run.paused", "run.resumed", "run.inquiries_cancelled", "run.failed", "run.retry_requested", "run.orchestration_retry_requested", "run.reassessment_requested"].includes(item.type))) }); },
    createWorkflowTemplate(input = {}) { validateWorkflowInput(input); const item = workflow(input, {current: true}); if (state.workflowTemplates.some((candidate) => candidate.name === item.name)) throw new Error("工作流名称必须唯一"); state.workflowTemplates.push(item); save(); return clone(item); },
    updateWorkflowTemplate(templateId, input = {}) { const current = find(state.workflowTemplates, templateId); if (!current) throw new Error("工作流不存在"); validateWorkflowInput(input); Object.assign(current, workflow(input, { templateId, system: current.system, current: true })); save(); return clone(current); },
    deleteWorkflowTemplate(templateId) {
      const current = find(state.workflowTemplates, templateId);
      if (!current) throw new Error("工作流不存在");
      const references = state.tasks.filter(task => task.workflowTemplateId === templateId);
      if (references.length) throw new Error(`工作流仍被 ${references.length} 个 Task 的冻结快照引用，不能删除`);
      return this.transaction(() => {
        state.workflowTemplates = state.workflowTemplates.filter(item => item.id !== templateId);
        addEvent({ type: "configuration.workflow_deleted", actor: humanMember, message: "人类删除了未使用的工作流", data: { workflowTemplateId: templateId } });
        return clone(current);
      });
    },
    createAgent(input = {}) {
      if(Object.hasOwn(input,"roleId"))throw new Error("roleId 已废弃，请使用 roleIds 数组");
      if(Object.hasOwn(input,"repository"))throw new Error("员工不再绑定仓库，请将仓库说明写入提示词");
      const name = text(input.name, "数字员工名称"), kind = input.kind === undefined ? "business" : input.kind;
      if (!["business", "manager"].includes(kind)) throw new Error("数字员工类型无效");
      if (input.status !== undefined && !['active','inactive'].includes(input.status)) throw new Error('数字员工状态无效');
      const item = { ...agent(id("agent"), name, input.description?.trim() || "一个等待被赋予使命的数字员工。", ["violet", "cyan", "amber", "blue", "green"][state.agents.length % 5], input.runtime?.provider || "claude-code", kind), systemPrompt: input.systemPrompt?.trim() || input.description?.trim() || "评估输入并完成可核验交付，信息不足时向合适成员咨询。", capabilities: Array.isArray(input.capabilities) ? input.capabilities : [], roleIds: assertRoleBindings(input.roleIds), runtime: bindRuntime(input.runtime) };
      item.status=input.status ?? 'active';state.agents.push(item); save(); return clone(item);
    },
    updateAgent(agentId, input = {}) {
      if(Object.hasOwn(input,"roleId"))throw new Error("roleId 已废弃，请使用 roleIds 数组");
      if(Object.hasOwn(input,"repository"))throw new Error("员工不再绑定仓库，请将仓库说明写入提示词");
      const stored = getAgent(agentId), current = clone(stored);
      if (!current || current.status === "deleted") throw new Error("数字员工不存在或已删除");
      if(input.kind!==undefined && !["business","manager"].includes(input.kind))throw new Error("员工类型只支持普通员工和项目经理");
      if (input.status !== undefined && !["active", "inactive"].includes(input.status)) throw new Error("数字员工状态无效");
      if(!["business","manager"].includes(input.kind || current.kind))throw new Error("旧研发类型已废弃，请显式保存为普通员工");
      delete current.repository;
      if (input.kind) current.kind = input.kind;
      if (input.systemPrompt !== undefined) current.systemPrompt = String(input.systemPrompt).trim();
      if (input.name !== undefined) { current.name = text(input.name, "数字员工名称"); current.initials = Array.from(current.name).slice(0, 2).join("").toUpperCase(); }
      if (input.description !== undefined) current.description = input.description;
      if (input.capabilities) current.capabilities = input.capabilities;
      if (input.roleIds !== undefined) current.roleIds = assertRoleBindings(input.roleIds);
      if (input.runtime) current.runtime = bindRuntime(input.runtime);
      if (input.status) current.status = input.status;
      Object.assign(stored, current); delete stored.repository; save(); return clone(current);
    },
    isExtensionRemoved(kind, extensionId) {
      return state.extensionRemovals.some(item => item.kind === kind && item.id === extensionId);
    },
    getPluginUpdateSettings() {return {enabled:state.settings?.pluginAutoUpdate !== false,intervalMinutes:state.settings?.pluginUpdateIntervalMinutes ?? 2};},
    setPluginUpdateSettings(input) {
      if(!input || typeof input!=='object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key=>!['enabled','intervalMinutes'].includes(key)))throw new Error('仅接受 enabled 与 intervalMinutes，至少提供一项');
      if('enabled' in input && typeof input.enabled!=='boolean')throw new Error('enabled 必须为布尔值');
      if('intervalMinutes' in input && (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes<1 || input.intervalMinutes>1440))throw new Error('检查周期必须为 1–1440 的整数分钟');
      return this.transaction(()=>{
        state.settings ||= {};
        if('enabled' in input)state.settings.pluginAutoUpdate=input.enabled;
        if('intervalMinutes' in input)state.settings.pluginUpdateIntervalMinutes=input.intervalMinutes;
        addEvent({type:'configuration.plugin_auto_update',actor:humanMember,message:'已保存插件更新设置',data:this.getPluginUpdateSettings()});
        return this.getPluginUpdateSettings();
      });
    },
    replacePluginExtensions(replacements,bindings) {
      return this.transaction(()=>{
        const ids=replacements.map(item=>item.previousId);
        if(!ids.length || new Set(ids).size!==ids.length || replacements.some(item=>this.isExtensionRemoved('plugin',item.previousId) || !item.id || item.id===item.previousId))throw new Error('插件配置已变化，请重新检查');
        const users=state.agents.filter(item=>item.status!=="deleted" && item.runtime?.extensionSelection?.pluginIds?.some(id=>ids.includes(id)));
        if(bindings.length!==users.length || users.some(item=>!bindings.some(binding=>binding.agentId===item.id && JSON.stringify(binding.previousRuntime)===JSON.stringify(item.runtime))))throw new Error('员工配置已变化，本次插件更新未应用');
        for(const binding of bindings)this.updateAgent(binding.agentId,{runtime:binding.runtime});
        const actor={type:'system',id:'plugin-updater',name:'插件更新'};
        for(const item of replacements)this.removeExtension({kind:'plugin',id:item.previousId,name:item.name},actor);
        const employees=users.map(({id,name})=>({id,name}));
        addEvent({type:'configuration.plugins_updated',actor,message:'插件已更新；当前员工使用新版本，冻结历史保持不变',data:{plugins:replacements.map(({id,previousId,name})=>({id,previousId,name})),employees}});
        return {plugins:replacements.map(({id,previousId,name})=>({id,previousId,name})),employees};
      });
    },
    planExtensionImport(candidates,current) {
      const origin=item=>item.source?.origin?.url || item.source?.url;
      const identity=item=>JSON.stringify([item.kind,item.kind==='plugin'?origin(item):null,item.name]);
      if(new Set(candidates.map(identity)).size!==candidates.length)throw new Error('本批次包含重复安装名称，请调整名称后重新导入');
      const candidateIds=new Set(candidates.map(item=>item.id));
      const active=current.filter(item=>!candidateIds.has(item.id) && !this.isExtensionRemoved(item.kind,item.id));
      const replacements=candidates.flatMap(next=>active.filter(old=>identity(old)===identity(next)).map(old=>({kind:next.kind,id:next.id,previousId:old.id,name:next.name})));
      const maps=Object.fromEntries(['plugin','mcp'].map(kind=>[kind,new Map(replacements.filter(item=>item.kind===kind).map(item=>[item.previousId,item.id]))]));
      const users=this.listAgents().filter(item=>['plugin','mcp'].some(kind=>item.runtime?.extensionSelection?.[kind==='plugin'?'pluginIds':'mcpIds']?.some(id=>maps[kind].has(id))));
      const bindings=users.map(item=>({agentId:item.id,previousRuntime:item.runtime,selection:Object.fromEntries(['plugin','mcp'].map(kind=>{
        const key=kind==='plugin'?'pluginIds':'mcpIds';
        return [key,[...new Set(item.runtime.extensionSelection[key].map(id=>maps[kind].get(id)||id))]];
      }))}));
      return {replacements,bindings};
    },
    replaceImportedExtensions(replacements,bindings) {
      return this.transaction(()=>{
        const keys=replacements.map(item=>`${item.kind}:${item.previousId}`);
        if(new Set(keys).size!==keys.length || replacements.some(item=>!['plugin','mcp'].includes(item.kind) || !item.id || !item.previousId || item.id===item.previousId || this.isExtensionRemoved(item.kind,item.previousId) || this.isExtensionRemoved(item.kind,item.id)))throw new Error('扩展配置已变化，请重新导入');
        const users=state.agents.filter(item=>item.status!=="deleted" && replacements.some(next=>item.runtime?.extensionSelection?.[next.kind==='plugin'?'pluginIds':'mcpIds']?.includes(next.previousId)));
        if(bindings.length!==users.length || new Set(bindings.map(item=>item.agentId)).size!==bindings.length || users.some(item=>!bindings.some(binding=>binding.agentId===item.id && JSON.stringify(binding.previousRuntime)===JSON.stringify(item.runtime))))throw new Error('员工配置已变化，本次导入未应用');
        for(const binding of bindings)this.updateAgent(binding.agentId,{runtime:binding.runtime});
        for(const item of replacements)this.removeExtension({kind:item.kind,id:item.previousId,name:item.name});
        const employees=users.map(({id,name})=>({id,name}));
        if(replacements.length)addEvent({type:'configuration.extensions_imported',actor:humanMember,message:'重复导入已覆盖当前扩展并更新员工选择，冻结历史保持不变',data:{replacements,employees}});
        return {replacements,employees,historyRetained:true};
      });
    },
    replaceMcpExtension(previousId,replacement,bindings) {
      return this.transaction(()=>{
        if(this.isExtensionRemoved('mcp',previousId) || !replacement?.id || replacement.id===previousId)throw new Error('MCP 已变化，请刷新后重新编辑');
        const users=state.agents.filter(item=>item.status!=="deleted" && item.runtime?.extensionSelection?.mcpIds?.includes(previousId));
        if(bindings.length!==users.length || users.some(item=>!bindings.some(binding=>binding.agentId===item.id && JSON.stringify(binding.previousRuntime)===JSON.stringify(item.runtime))))throw new Error('员工配置已变化，请刷新后重新编辑 MCP');
        for(const binding of bindings)this.updateAgent(binding.agentId,{runtime:binding.runtime});
        this.removeExtension({kind:'mcp',id:previousId,name:replacement.name});
        const employees=users.map(({id,name})=>({id,name}));
        addEvent({type:'configuration.mcp_updated',actor:humanMember,message:'人类编辑了 MCP；当前员工使用新版本，冻结历史保持不变',data:{previousId,id:replacement.id,name:replacement.name,employees}});
        return {...replacement,previousId,employees,historyRetained:true};
      });
    },
    removeExtension({ kind, id: extensionId, name }, actor=humanMember) {
      if (!["plugin", "mcp"].includes(kind) || typeof extensionId !== "string" || !extensionId) throw new Error("扩展标识无效");
      if (this.isExtensionRemoved(kind, extensionId)) throw new Error("此插件或 MCP 已删除");
      const key = kind === "plugin" ? "pluginIds" : "mcpIds";
      const users = state.agents.filter(item => item.status !== "deleted" && item.runtime?.extensionSelection?.[key]?.includes(extensionId));
      if (users.length) throw new Error(`仍被数字员工「${users.map(item => item.name).join("、")}」使用，请先在员工中移除选择后再删除`);
      const entry = { kind, id: extensionId, name: text(name, "扩展名称"), removedAt: now() };
      return this.transaction(() => {
        state.extensionRemovals.push(entry);
        addEvent({ type: "configuration.extension_deleted", actor, message: actor.type==='system'?'插件更新退役了原版本':`人类删除了已安装的${kind === "plugin" ? "插件" : "MCP"}`, data: entry });
        return { deleted: true, id: extensionId, kind, name: entry.name, historyRetained: true };
      });
    },
    deleteAgent(agentId) {
      const current = currentEmployee(agentId);
      if (!current) throw new Error("数字员工不存在或已删除");
      return this.transaction(() => {
        this.detachCommunicationMember(agentId);
        current.status = "deleted"; current.deletedAt = now();
        for (const team of state.teams) { team.memberAgentIds = teamMembers(team).filter(value => value !== agentId); delete team.managerAgentId; }
        addEvent({ type: "configuration.agent_deleted", actor: humanMember, message: "人类删除了数字员工；在途任务继续使用冻结成员，历史发言保留", data: { agentId } });
        return { id: agentId, name: current.name, status: current.status, deletedAt: current.deletedAt, historyRetained: true };
      });
    },
    listRoles: () => clone(state.roles),
    getRole(roleId) { const current = getRole(roleId); if (!current) throw new Error("角色不存在"); return clone(current); },
    createRole(input = {}) {
      const item = { id: id("role"), name: roleName(input.name), prompt: text(input.prompt, "角色提示词"), createdAt: now() };
      return this.transaction(() => {
        state.roles.push(item);
        addEvent({ type: "configuration.role_created", actor: humanMember, message: `人类创建了角色「${item.name}」`, data: { roleId: item.id } });
        return clone(item);
      });
    },
    updateRole(roleId, input = {}) {
      const current = getRole(roleId);
      if (!current) throw new Error("角色不存在");
      if (input.name === undefined && input.prompt === undefined) throw new Error("角色更新至少提供名称或提示词");
      return this.transaction(() => {
        if (input.name !== undefined) current.name = roleName(input.name);
        if (input.prompt !== undefined) current.prompt = text(input.prompt, "角色提示词");
        addEvent({ type: "configuration.role_updated", actor: humanMember, message: `人类更新了角色「${current.name}」；新任务与后续沟通投递使用新提示词，冻结历史不变`, data: { roleId } });
        return clone(current);
      });
    },
    deleteRole(roleId) {
      const current = getRole(roleId);
      if (!current) throw new Error("角色不存在");
      const users = state.agents.filter(item => item.status !== "deleted" && item.roleIds.includes(roleId));
      if (users.length) throw new Error(`角色仍被数字员工「${users.map(item => item.name).join("、")}」绑定，请先在员工中解除绑定后再删除`);
      return this.transaction(() => {
        state.roles = state.roles.filter(item => item.id !== roleId);
        addEvent({ type: "configuration.role_deleted", actor: humanMember, message: `人类删除了未被绑定的角色「${current.name}」`, data: { roleId, name: current.name } });
        return clone(current);
      });
    },
    deleteTeam(teamId) {
      const current = getTeam(teamId);
      if (!current) throw new Error("团队不存在");
      return this.transaction(() => {
        this.detachCommunicationTeam(teamId);
        state.teams = state.teams.filter(item => item.id !== teamId);
        addEvent({ type: "configuration.team_deleted", actor: humanMember, message: "人类删除了团队；任务与群聊成员保持独立", data: { teamId } });
        return { id: teamId, name: current.name, historyRetained: true };
      });
    },
    createTeam(input = {}) {
      if (input.status !== undefined && !["active", "inactive"].includes(input.status)) throw new Error("团队状态无效");
      const members = validateTeam(input);
      const item = { id: id("team"), name: text(input.name, "团队名称"), mission: input.mission?.trim() || "", ...members, status: input.status ?? "active", createdAt: now() };
      state.teams.push(item); save(); return clone(item);
    },
    updateTeam(teamId, input = {}) {
      const current = getTeam(teamId); if (!current) throw new Error("团队不存在");
      if (Object.hasOwn(input, "managerAgentId")) throw new Error("团队不再指定项目经理，请使用 memberAgentIds");
      const next = { ...current, ...input }; delete next.managerAgentId;
      const members = validateTeam({ ...next, memberAgentIds: input.memberAgentIds === undefined ? teamMembers(current) : input.memberAgentIds });
      if (next.status !== undefined && !["active", "inactive"].includes(next.status)) throw new Error("团队状态无效");
      const name = text(next.name, "团队名称");
      return this.transaction(() => {
        this.detachCommunicationTeam(teamId);
        Object.assign(current, members, { name, mission: next.mission, status: next.status }); delete current.managerAgentId;
        save(); return this.listTeams().find(item => item.id === teamId);
      });
    },
    buildTask(input = {}) {
      if (Object.hasOwn(input, "teamId")) throw new Error("任务不再绑定团队，请将团队员工加入 memberAgentIds");
      if (input.repositorySources !== undefined) throw new Error("不再接受仓库绑定，请将仓库说明写入提示词或任务内容");
      const teamIds = input.teamIds === undefined ? [] : input.teamIds;
      if (!Array.isArray(teamIds) || teamIds.some(value => typeof value !== "string") || new Set(teamIds).size !== teamIds.length) throw new Error("teamIds 必须是不重复的团队 ID 数组");
      if (Object.hasOwn(input, "priority")) throw new Error("priority 已废弃，任务不再使用优先级");
      if ((input.kind !== undefined && input.kind !== "manual") || ["automationId", "automationTriggerId"].some(key => Object.hasOwn(input, key))) throw new Error("任务来源只能由自动化调度设置");
      const selectedTeams = teamIds.map(teamId => { const team = getTeam(teamId); if (!team || team.status !== "active") throw new Error("请选择存在且可用的团队"); return team; });
      const explicitMembers = memberIds(input.memberAgentIds === undefined ? [] : input.memberAgentIds, { active: true, empty: true });
      const selectedIds = memberIds([...new Set([...explicitMembers, ...selectedTeams.flatMap(team => teamMembers(team).filter(agentId => currentEmployee(agentId)?.status === "active"))])], { active: true }), members = selectedIds.map(getAgent);
      const managers = members.filter(member => member.kind === "manager");
      if (managers.length !== 1) throw new Error("任务成员必须且只能包含一位可用项目经理");
      const managerAgentId = managers[0].id;
      if (members.some(member => !["business", "manager"].includes(member.kind))) throw new Error("任务成员含旧研发类型，请先编辑为普通员工");
      if (input.workflowTemplateId != null && typeof input.workflowTemplateId !== "string") throw new Error("工作流 ID 必须是字符串或 null");
      const templateId = input.workflowTemplateId?.trim() || null;
      const template = templateId ? find(state.workflowTemplates, templateId) : { id: null, name: "默认协作", description: "按任务目标和成员能力协作，由经理推进交接并提交验收。", nodes: [{ id: "delivery", title: "完成任务", staffingGuidance: "经理根据任务目标和成员能力安排执行，成员完成后明确交接；需要更多工作时继续协调，交付后提交验收。", deliverable: "完成用户要求，如实说明交付结果与尚未解决的问题。", artifactPaths: [], dependsOn: [], handoffFrom: [] }] };
      if (!template) throw new Error("工作流不存在");
      const workspaceRoot = this.getWorkspaceSettings().workspaceRoot, taskId = "task_" + randomUUID();
      if (workspaceRoot && input.workspacePath !== undefined) throw new Error("工作目录由系统自动分配，不能为任务指定");
      const workspacePath = workspaceRoot ? resolve(workspaceRoot, taskId) : text(input.workspacePath, "任务工作目录");
      if (!workspaceRoot && (!isAbsolute(workspacePath) || !statSync(resolve(workspacePath)).isDirectory())) throw new Error("任务工作目录必须是存在的绝对路径");
      const memberSnapshots = members.filter(member => member.id !== managerAgentId).map(member => withRoleSnapshot(employeeConfiguration(member)));
      const managerSnapshot = withRoleSnapshot(employeeConfiguration(getAgent(managerAgentId)));
      const repositories = { repositorySources: [], repositoryBindings: {} }, effectiveTemplate = clone(template);
      effectiveTemplate.nodes.forEach(node => { node.staffingGuidance ||= node.ownerRole ? `适合由熟悉${node.ownerRole}相关工作的成员承担；请结合成员提示词和能力判断。` : `选择能够完成「${node.title}」交付的成员。`; node.repositoryPath = null; });
      const nodeAssignments = input.nodeAssignments ? assignments({ memberAgentIds: selectedIds.filter(value => value !== managerAgentId) }, effectiveTemplate, input.nodeAssignments) : {};
      const item = { id: taskId, workspaceManaged: Boolean(workspaceRoot), repositoryMode: "workspace", ...repositories, memberAgentIds: selectedIds, memberSnapshots, managerSnapshot, title: text(input.title, "任务标题"), objective: text(input.objective, "任务目标"), workspacePath: resolve(workspacePath), kind: "manual", workflowTemplateId: template.id, workflowSnapshot: effectiveTemplate, nodeAssignments, deliveryAuthorization: null, managerAgentId, managerRuntime: runtime(input.managerRuntime || managerSnapshot.runtime), status: "backlog", archivedAt: null, acceptanceCriteria: taskAcceptanceCriteria(input.acceptanceCriteria), createdAt: now(), updatedAt: now() };
      return item;
    },
    createTask(input = {}) { const item = this.buildTask(input); state.tasks.unshift(item); save(); return clone(item); },
    archiveTask(taskId) { const current = getTask(taskId); if (!current) throw new Error("任务不存在"); if (current.status !== "done") throw new Error("只有已完成任务可以归档"); if (current.archivedAt) throw new Error("任务已经归档"); if (state.runs.some((run) => run.taskId === taskId && !this.canCompleteRun(run.id))) throw new Error("仍有未结束协作，不能归档"); current.archivedAt = now(); current.updatedAt = current.archivedAt; const latestRun = state.runs.find((run) => run.taskId === taskId); addEvent({ type: "task.archived", runId: latestRun?.id || null, message: `任务「${current.title}」已归档，交付记录仍可查看。`, data: { taskId, archivedAt: current.archivedAt } }); save(); return taskReadModel(current); },
    unarchiveTask(taskId) { const current = getTask(taskId); if (!current) throw new Error("任务不存在"); if (!current.archivedAt) throw new Error("任务尚未归档"); current.archivedAt = null; current.updatedAt = now(); const latestRun = state.runs.find((run) => run.taskId === taskId); addEvent({ type: "task.unarchived", runId: latestRun?.id || null, message: `任务「${current.title}」已恢复至任务中心。`, data: { taskId } }); save(); return taskReadModel(current); },
    createRun(taskId) {
      const currentTask = getTask(taskId);
      if (!currentTask || currentTask.status !== "backlog") throw new Error("Task 不能启动新的 Run");
      const sourceManager = currentTask.managerSnapshot;
      if (sourceManager?.kind !== "manager" || !Array.isArray(currentTask.memberSnapshots)) throw new Error("任务缺少冻结成员或负责经理，请重新创建任务");
      const frozen = [sourceManager, ...currentTask.memberSnapshots];
      if (frozen.some(employee => getAgent(employee.id)?.status === "deleted")) throw new Error("任务尚未开始且有成员已删除，请重新选择成员创建任务");
      for (const employee of frozen) assertRuntimeEnabled(employee.runtime);
      const manager = { ...withRoleSnapshot(clone(sourceManager)), id: id("manager"), sourceAgentId: sourceManager.id, runtime: clone(currentTask.managerRuntime) };
      const participants = [...currentTask.memberSnapshots.map(item => ({ ...withRoleSnapshot(clone(item)), type: "agent" })), { ...manager, type: "agent" }, ...(currentTask.kind === "automation" ? [] : [clone(humanMember)])];
      const runId = id("run"), item = { id: runId, workspacePath: currentTask.workspaceManaged ? resolve(currentTask.workspacePath, runId) : currentTask.workspacePath, taskId, manager, participants, status: "running", currentFocus: null, waitingConversationId: null, waitingNodeId: null, waitingAgentId: null, pendingMessageIds: [], startedAt: now(), completedAt: null, failure: null, summary: null, deliveryReview: null };
      state.runs.unshift(item); currentTask.status = "running"; save(); return clone(item);
    },
    updateRun(runId, patch = {}) { if (patch.status === "completed") throw new Error("完成必须由人类确认"); const current = getRun(runId); if (!current) throw new Error("Run 不存在"); if (patch.status === "awaiting_human" && getTask(current.taskId).kind === "automation") throw new Error("自动化不等待人类澄清"); if (patch.status && patch.status !== current.status && !runTransitions[current.status]?.includes(patch.status)) throw new Error(`Run 不能从 ${current.status} 变更为 ${patch.status}`); Object.assign(current, clone(patch)); save(); return clone(current); }, setTaskStatus(taskId, status) { if (status === "done") throw new Error("完成必须由人类确认"); const current = getTask(taskId); if (!current || (status !== current.status && !taskTransitions[current.status]?.includes(status))) throw new Error("Task 状态变更不合法"); current.status = status; current.updatedAt = now(); save(); return clone(current); },
    getRunRecoveryPlan(runId) {
      const current = getRun(runId);
      const empty = { shouldExecute: false, interruptedTraceIds: [], recoveredDispatchIds: [] };
      if (!current || current.status === "failed" || getTask(current.taskId).archivedAt) return empty;
      const deliveries = state.dispatches.filter((item) => item.runId === runId);
      const pending = deliveries.filter((item) => ["queued", "claimed"].includes(item.status));
      const inquiryPending = pending.some((item) => item.interactionOnly);
      const inquiryReady = pending.some((item) => item.interactionOnly && (item.status === "claimed" || !item.nextRetryAt || Date.parse(item.nextRetryAt) <= Date.now()));
      const businessActive = ["planning", "running", "review"].includes(current.status);
      // A waiting human question is not work. Legacy agent consultations still
      // need initializeDispatches to materialize their recorded recipient.
      const waitingWork = current.status === "awaiting_human" && !this.hasPendingHumanQuestion(runId) && (pending.length > 0 || (!deliveries.length && current.waitingAgentId));
      const recoverBusiness = businessActive || ["awaiting_human", "paused"].includes(current.status);
      const recoverableDispatches = deliveries.filter((item) => item.status === "claimed" && (recoverBusiness || item.interactionOnly));
      return {
        shouldExecute: !this.hasPendingHumanQuestion(runId) && Boolean(businessActive || waitingWork || inquiryReady),
        interruptedTraceIds: state.traces.filter((trace) => trace.runId === runId && trace.status === "running" && (recoverBusiness || (inquiryPending && deliveries.some((item) => item.interactionOnly && item.traceIds.includes(trace.id))))).map((trace) => trace.id),
        recoveredDispatchIds: recoverableDispatches.map((item) => item.id),
      };
    },
    recoverInterruptedRun(runId, reason = "AgentForge 服务重启，未完成的本机执行已中断") {
      const plan = this.getRunRecoveryPlan(runId), current = getRun(runId);
      if (!plan.interruptedTraceIds.length && !plan.recoveredDispatchIds.length) return { run: clone(current), ...plan };
      return this.transaction(() => {
        for (const dispatchId of plan.recoveredDispatchIds) {
          const delivery = find(state.dispatches, dispatchId);
          delivery.status = "queued"; delivery.nextRetryAt = null; delivery.updatedAt = now();
        }
        for (const traceId of plan.interruptedTraceIds) this.completeTrace(traceId, { status: "failed", error: reason });
        addEvent({ type: "run.recovered", runId, message: current.status === "paused" ? "服务重启后已回收中断执行；任务保持暂停，仅独立答疑可以继续。" : "服务重启后已回收中断执行，保留历史 Trace 并重新排队未完成投递。", data: { interruptedTraceIds: plan.interruptedTraceIds, recoveredDispatchIds: plan.recoveredDispatchIds, status: current.status } });
        return { run: clone(current), ...plan };
      });
    },
    failRun(runId, reason, phase = "workspace_preparation") {
      return this.transaction(() => {
        const current = getRun(runId), task = getTask(current?.taskId);
        if (!current || !task || !["planning", "running", "review"].includes(current.status)) throw new Error("只有活跃 Run 可以标记为失败");
        if (state.traces.some((trace) => trace.runId === runId && trace.status === "running") || state.dispatches.some((item) => item.runId === runId && item.status === "claimed")) throw new Error("存在活跃执行，不能标记 Run 失败");
        current.status = "failed"; current.completedAt = now(); current.failure = { phase, message: text(reason, "失败原因") };
        task.status = "blocked"; task.updatedAt = now();
        addEvent({ type: "run.failed", runId, message: current.failure.message, data: { phase } });
        return clone(current);
      });
    },
    retryFailedNode(runId, nodeId) {
      return this.transaction(() => {
        const current = getRun(runId), task = getTask(current?.taskId);
        if (!current || !task || task.archivedAt || current.status !== "failed") throw new Error("只能恢复未归档的失败 Run");
        this.assertAutomationRunAvailable(runId);
        if (current.failure?.phase === "workspace_baseline_missing") throw new Error("工作目录基线缺失，旧 Run 不能安全重试；请核对文件并在干净工作区新建 Task/Run");
        assertNode(current, nodeId);
        const failures = failedBusinessTraces(runId), failedNodeIds = new Set(failures.map((trace) => trace.workflowNodeId));
        if (!failedNodeIds.has(nodeId)) throw new Error("所选职责没有可恢复的失败 Trace");
        const traceIds = failures.map((trace) => trace.id);
        return resumeFailedRun(current, task, nodeId, `manual-node-retry:${randomUUID()}`, {
          type: "run.retry_requested",
          message: `人类请求原员工继续「${nodeId}」的失败投递；原会话与历史 Trace 已保留。`,
          data: { workflowNodeId: nodeId, failedTraceIds: traceIds }
        }, this.enqueueDispatch.bind(this));
      });
    },
    retryFailedOrchestration(runId) {
      return this.transaction(() => {
        const current = getRun(runId), task = getTask(current?.taskId);
        if (!current || !task || task.archivedAt || current.status !== "failed") throw new Error("只能恢复未归档的失败 Run");
        this.assertAutomationRunAvailable(runId);
        if (current.failure?.phase === "workspace_baseline_missing") throw new Error("工作目录基线缺失，旧 Run 不能安全重试；请核对文件并在干净工作区新建 Task/Run");
        const businessFailures = failedBusinessTraces(runId);
        if (businessFailures.length) throw new Error("存在失败的业务职责，请从该职责的恢复操作重新开始");
        const failures = recoverableFailedTraces(runId);
        const failedTraceIds = failures.map(trace => trace.id);
        const nodeId = failures.at(-1)?.workflowNodeId || current.currentFocus?.nodeId || task.workflowSnapshot.nodes[0].id;
        assertNode(current, nodeId);
        return resumeFailedRun(current, task, nodeId, `manual-orchestration-retry:${randomUUID()}`, {
          type: "run.orchestration_retry_requested",
          message: "人类请求重新准备运行环境，继续原失败投递或待执行队列。",
          data: { failedTraceIds }
        }, this.enqueueDispatch.bind(this));
      });
    },
    pauseRun(runId, reason = "用户暂停") { const current = getRun(runId), task = getTask(current?.taskId); if (!current || !["planning", "running", "awaiting_human", "review"].includes(current.status)) throw new Error("只有活跃 Run 可以暂停"); current.pausedFromStatus = current.status; current.status = "paused"; task.status = "paused"; task.updatedAt = now(); addEvent({ type: "run.paused", runId, message: "Run 已暂停；当前本机角色执行已停止，历史 Trace 与产物保留。", data: { reason } }); save(); return clone(current); },
    resumeRun(runId) { const current = getRun(runId), task = getTask(current?.taskId); if (!current || current.status !== "paused") throw new Error("只有已暂停 Run 可以继续"); this.assertAutomationRunAvailable(runId); const restoredStatus = this.hasPendingHumanQuestion(runId) ? "awaiting_human" : ["awaiting_human", "review"].includes(current.pausedFromStatus) ? current.pausedFromStatus : "running"; current.status = restoredStatus; task.status = restoredStatus; task.updatedAt = now(); delete current.pausedFromStatus; addEvent({ type: "run.resumed", runId, message: "Run 已继续；项目经理将依据当前状态决定后续角色协作。", data: {} }); save(); return clone(current); },
    collaborationCandidates(runId) { const current = getRun(runId); return clone(getTask(current.taskId).workflowSnapshot.nodes); }, setCurrentFocus(runId, nodeId, reason = "项目经理已选择下一次协作") { const current = getRun(runId); assertNode(current, nodeId); current.currentFocus = { nodeId, reason: text(reason, "当前工作重心说明"), updatedAt: now() }; save(); return clone(current.currentFocus); },
    createTrace(runId, input = {}) { const current = getRun(runId); assertNode(current, input.workflowNodeId); if (!runAgent(current, input.agentId)) throw new Error("Trace Agent 不属于 Run"); const item = { id: id("trace"), inputMessageId: id("input"), runId, workflowNodeId: input.workflowNodeId, agentId: input.agentId, type: input.type || "node", status: "running", startedAt: now(), endedAt: null, tracePath: `runs/${runId}/traces/`, inputArtifactIds: [], outputArtifactIds: [], promptRef: null, error: null }; state.traces.push(item); save(); return clone(item); }, completeTrace(traceId, patch = {}) { const current = getTrace(traceId); if (!current) throw new Error("Trace 不存在"); current.status = patch.status || "completed"; current.endedAt = now(); current.tracePath = patch.tracePath || `runs/${current.runId}/traces/${current.id}/events.ndjson`; current.error = patch.error || null; save(); return clone(current); },
    attachTracePrompt(traceId, reference = {}) { const current = getTrace(traceId); if (!current) throw new Error("Trace 不存在"); if (current.promptRef || reference.storagePath !== `runs/${current.runId}/traces/${current.id}/prompt-snapshot.json` || !/^[0-9a-f]{64}$/.test(reference.sha256 || "") || !Number.isInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > 300000) throw new Error("提示词快照关联无效"); current.promptRef = { storagePath: reference.storagePath, bytes: reference.bytes, sha256: reference.sha256 }; save(); return clone(current); },
    getTracePromptReference(runId, traceId) { const trace = getTrace(traceId); const reference = trace?.promptRef; if (!getRun(runId) || !trace || trace.runId !== runId || !reference) throw new Error("提示词快照不存在或当时未保存"); if (reference.storagePath !== `runs/${runId}/traces/${trace.id}/prompt-snapshot.json` || !/^[0-9a-f]{64}$/.test(reference.sha256 || "") || !Number.isInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > 300000) throw new Error("提示词快照关联无效"); return clone(reference); },
    acceptNodeResult(runId, nodeId, traceId, output, inputs = []) {
      if (["defects", "resolvesDefectIds", "verifiedDefectIds"].some(key => Object.hasOwn(output, key))) throw new Error("已移除独立问题清单字段；请在 summary 中说明问题与处理结果，并通过 handoff 或 consultation 交接");
      const current = getRun(runId), currentTrace = getTrace(traceId);
      assertNode(current, nodeId);
      if (!currentTrace || currentTrace.runId !== runId || currentTrace.workflowNodeId !== nodeId || currentTrace.status !== "running") throw new Error("Trace 不属于当前节点或不可验收");
      for (const input of inputs) {
        const item = { id: id("artifact"), runId, taskId: current.taskId, traceId, ownerAgentId: currentTrace.agentId, name: input.name, category: input.name.startsWith("repos/") ? "code" : "document", mediaType: input.mediaType || "application/octet-stream", storagePath: input.storagePath, sourcePath: input.sourcePath || null, sha256: input.sha256, bytes: input.bytes, deleted: Boolean(input.deleted), version: state.artifacts.filter((artifact) => artifact.runId === runId && artifact.name === input.name).length + 1, createdAt: now() };
        state.artifacts.push(item); currentTrace.outputArtifactIds.push(item.id);
      }
      for (const input of (Array.isArray(output.decisions) ? output.decisions : [])) if (input?.summary) state.decisions.push({ id: id("decision"), runId, traceId, summary: input.summary, impact: input.impact || "clarification", affectedNodeIds: input.affectedNodeIds || [], rationale: input.rationale || "", status: "confirmed", createdAt: now(), confirmedAt: now() });
      save();
      return clone(currentTrace);
    }, failNode(runId, nodeId, traceId, error) { const current = getRun(runId); assertNode(current, nodeId); this.completeTrace(traceId, { status: "failed", error }); save(); },
    addMessage(input = {}) { const current = getRun(input.runId); if (!current) throw new Error("Run 不存在"); if (getTask(current.taskId).kind === "automation" && (input.recipientHuman || input.sender?.type === "human" || !input.sender)) throw new Error("自动化只允许员工与经理之间沟通"); const recipient = input.recipientHuman ? { type: "human", id: "human_operator", name: "你" } : input.recipientAgentId ? runAgent(current, input.recipientAgentId) : { type: "team", id: "team", name: "全体团队" }; if (!recipient) throw new Error("消息接收者不属于当前 Run");
        const item = { id: id("message"), runId: current.id, conversationId: input.conversationId || `conversation_${current.id}_${input.workflowNodeId || "general"}`, workflowNodeId: input.workflowNodeId || null, sender: input.sender || { type: "human", id: "human_operator", name: "你" }, recipient: { type: recipient.type || "agent", id: recipient.id, name: recipient.name }, traceId: input.traceId || null, startMessageId: input.traceId ? getTrace(input.traceId)?.inputMessageId || null : null, replyToMessageId: input.replyToMessageId || null, questionType: input.questionType || null, routingReason: input.routingReason || null, consideredMemberIds: input.consideredMemberIds || [], kind: input.kind || "instruction", content: text(input.content, "消息内容"), createdAt: now() }; state.messages.push(item); addEvent({ type: "message.sent", runId: current.id, actor: item.sender, message: item.content, data: { messageId: item.id, conversationId: item.conversationId, workflowNodeId: item.workflowNodeId } }); return clone(item); }, waitForHuman(runId, nodeId, conversationId) { const current = getRun(runId); if (getTask(current.taskId).kind === "automation") throw new Error("自动化不等待人类澄清"); current.waitingNodeId = nodeId; current.waitingAgentId = null; current.waitingConversationId = conversationId; current.currentFocus = { nodeId, reason: "等待人类澄清", updatedAt: now() }; current.status = "awaiting_human"; getTask(current.taskId).status = "awaiting_human"; save(); }, resumeHuman(runId, messageId) { const current = getRun(runId), message = find(state.messages, messageId); if (!current?.waitingNodeId || !message || message.conversationId !== current.waitingConversationId) throw new Error("当前 Run 没有匹配的人类澄清"); current.waitingNodeId = null; current.waitingAgentId = null; current.waitingConversationId = null; current.status = "running"; getTask(current.taskId).status = "running"; save(); return clone(current); }, waitForAgent(runId, nodeId, agentId, conversationId) { const current = getRun(runId); if (!runAgent(current, agentId)) throw new Error("被咨询数字员工不属于当前 Run"); current.waitingNodeId = nodeId; current.waitingAgentId = agentId; current.waitingConversationId = conversationId; current.currentFocus = { nodeId, reason: "等待角色协作答复", updatedAt: now() }; save(); }, resumeAgent(runId, conversationId) { const current = getRun(runId); if (!current?.waitingNodeId || !current.waitingAgentId || current.waitingConversationId !== conversationId) throw new Error("当前 Run 没有匹配的角色协作"); current.waitingNodeId = null; current.waitingAgentId = null; current.waitingConversationId = null; save(); return clone(current); },
    requestReplan(runId, messageId) { const current = getRun(runId); current.pendingMessageIds.push(messageId); save(); }, pendingMessages(runId) { const current = getRun(runId); return clone(state.messages.filter((item) => current?.pendingMessageIds.includes(item.id))); }, consumePendingMessages(runId) { getRun(runId).pendingMessageIds = []; save(); }, noteReassessment(runId, nodeIds, reason = "项目经理确认变更影响") { const current = getRun(runId); for (const nodeId of nodeIds) assertNode(current, nodeId); addEvent({ type: "run.reassessment_requested", runId, message: reason, data: { nodeIds } }); save(); return clone(current); },
    cancelRun(runId, reason) {
      const current = getRun(runId), task = getTask(current?.taskId);
      if (!current || !task || !["planning", "running", "awaiting_human", "review", "awaiting_acceptance", "paused"].includes(current.status)) return clone(current);
      const cancelledAt = now(), cancellationReason = text(reason, "终止原因"), cancelledDispatchIds = [];
      for (const item of state.dispatches.filter((item) => item.runId === runId && !["done", "cancelled"].includes(item.status))) {
        item.status = "cancelled"; item.nextRetryAt = null; item.updatedAt = cancelledAt; cancelledDispatchIds.push(item.id);
      }
      current.status = "cancelled"; current.completedAt = cancelledAt; current.cancellationReason = cancellationReason;
      task.status = "cancelled"; task.updatedAt = cancelledAt;
      addEvent({ type: "run.cancelled", runId, actor: humanMember, message: "人类已终止 Run；未完成协作投递已取消，既有 Trace 与交付记录保留。", data: { reason: cancellationReason, cancelledDispatchIds } });
      save(); return clone(current);
    }
  };
}
