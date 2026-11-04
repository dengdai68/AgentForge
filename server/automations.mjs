import { randomUUID } from 'node:crypto';
import { previewSchedule, localTimeZone } from './automation-schedule.mjs';

const clone = value => structuredClone(value);
const active = new Set(['planning', 'running', 'review', 'awaiting_human', 'paused']);
const fields = new Set(['title', 'objective', 'memberAgentIds', 'teamIds', 'workflowTemplateId', 'acceptanceCriteria', 'cron', 'enabled']);
function pageOf(items, query = {}) {
  const pageSize = Number(query.pageSize ?? 20), requested = Number(query.page ?? 1);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(requested) || requested < 1) throw new Error('分页参数无效');
  const total = items.length, totalPages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(requested, totalPages);
  return { items: clone(items.slice((page - 1) * pageSize, page * pageSize)), page, pageSize, total, totalPages };
}
export function automationCommands(state) {
  state.automations ||= []; state.automationTriggers ||= [];
  const get = id => { const item = state.automations.find(item => item.id === id); if (!item) throw new Error('自动化不存在'); return item; };
  const recordView = item => {
    const run = state.runs.find(run => run.id === item.runId);
    const {configuration, ...summary} = item;
    return { ...summary, status: run?.status || item.outcome, completedAt: run?.completedAt || null, completion: run?.confirmedBy ? run.confirmedBy === 'automation' ? 'automatic' : 'manual' : null };
  };
  const view = item => ({ ...clone(item), latestTrigger: state.automationTriggers.filter(record => record.automationId === item.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0,1).map(recordView)[0] || null });
  return {
    assertAutomationRunAvailable(runId) {
      const run=state.runs.find(value=>value.id===runId),task=state.tasks.find(value=>value.id===run?.taskId);
      if (task?.kind !== 'automation') return;
      if (state.runs.some(value=>value.id!==runId && state.tasks.find(item=>item.id===value.taskId)?.automationId===task.automationId && (active.has(value.status) || state.traces.some(trace=>trace.runId===value.id&&trace.status==='running')))) throw new Error('此自动化已有其他轮次执行中，请先结束该轮再重试');
    },
    getAutomation(id) { return view(get(id)); },
    listAutomations(query = {}) {
      if (query.status && !['all','enabled','disabled'].includes(query.status)) throw new Error('自动化状态无效');
      const search = String(query.search || '').trim().toLowerCase();
      return pageOf(state.automations.filter(item => (!search || `${item.title} ${item.objective}`.toLowerCase().includes(search)) && (!query.status || query.status === 'all' || item.enabled === (query.status === 'enabled'))).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)).map(view), query);
    },
    listAutomationTriggers(id, query = {}) {
      get(id);
      const statuses = ['all','running','planning','review','paused','awaiting_acceptance','completed','failed','cancelled','skipped'];
      if (query.status && !statuses.includes(query.status)) throw new Error('触发记录状态无效');
      return pageOf(state.automationTriggers.filter(item => item.automationId === id).map(recordView).filter(item => !query.status || query.status === 'all' || item.status === query.status).sort((a,b) => b.plannedAt.localeCompare(a.plannedAt) || b.id.localeCompare(a.id)), query);
    },
    saveAutomation(input, automationId = null, at = new Date()) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key => !fields.has(key))) throw new Error('自动化字段无效，不接受优先级或执行状态');
      const previous = automationId ? get(automationId) : null;
      if (previous && Object.keys(input).length === 1 && input.enabled === false) return this.transaction(() => { previous.enabled=false; previous.nextTriggerAt=null; previous.updatedAt=at.toISOString(); previous.version++; this.addEvent({type:'automation.saved',message:'自动化已停用',data:{automationId}}); return view(previous); });
      const next = { ...(previous || {}), ...input };
      if (next.enabled !== undefined && typeof next.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
      next.timeZone = localTimeZone();
      const times = previewSchedule(next.cron, next.timeZone, at);
      const task = this.buildTask({ title: next.title, objective: next.objective, memberAgentIds: next.memberAgentIds, teamIds: input.teamIds, workflowTemplateId: next.workflowTemplateId, acceptanceCriteria: next.acceptanceCriteria });
      return this.transaction(() => {
        const item = { id: previous?.id || 'automation_' + randomUUID(), version: (previous?.version || 0) + 1, title: task.title, objective: task.objective, memberAgentIds: task.memberAgentIds, workflowTemplateId: task.workflowTemplateId, acceptanceCriteria: task.acceptanceCriteria, cron: next.cron.trim().replace(/\s+/g,' '), timeZone: next.timeZone, enabled: next.enabled ?? true, nextTriggerAt: null, createdAt: previous?.createdAt || at.toISOString(), updatedAt: at.toISOString() };
        item.nextTriggerAt = item.enabled ? times[0] : null;
        if (previous) Object.assign(previous, item); else state.automations.push(item);
        this.addEvent({ type: 'automation.saved', message: '自动化配置已保存', data: { automationId: item.id, version: item.version } });
        return view(item);
      });
    },
    deleteAutomation(id) {
      get(id);
      if (state.automationTriggers.some(item => item.automationId === id)) throw new Error('自动化已有触发记录，请停用以保留历史');
      return this.transaction(() => { state.automations = state.automations.filter(item => item.id !== id); this.addEvent({type:'automation.deleted',message:'自动化已删除',data:{automationId:id}}); return { id }; });
    },
    dueAutomations(at = new Date()) { return state.automations.filter(item => item.enabled && item.nextTriggerAt && Date.parse(item.nextTriggerAt) <= +at).map(item => ({ id: item.id, plannedAt: item.nextTriggerAt })); },
    triggerAutomation(id, { plannedAt = null, at = new Date() } = {}) {
      const item = get(id), source = plannedAt ? 'schedule' : 'manual';
      if (plannedAt) {
        const existing = state.automationTriggers.find(record => record.automationId === id && record.source === 'schedule' && record.plannedAt === plannedAt);
        if (existing) return recordView(existing);
        if (!item.enabled || item.nextTriggerAt !== plannedAt || Date.parse(plannedAt) > +at) throw new Error('计划触发已失效');
      }
      const record = { id: 'trigger_' + randomUUID(), automationId: id, version: item.version, configuration: clone(item), source, plannedAt: plannedAt || at.toISOString(), createdAt: at.toISOString(), outcome: 'started', taskId: null, runId: null, reason: null };
      const advance = () => { if (plannedAt) get(id).nextTriggerAt = previewSchedule(item.cron, item.timeZone, at, 1)[0]; };
      const busy = state.runs.some(run => state.tasks.find(task => task.id === run.taskId)?.automationId === id && (active.has(run.status) || state.traces.some(trace => trace.runId === run.id && trace.status === 'running') || (run.status === 'awaiting_acceptance' && !this.canCompleteRun(run.id))));
      if (busy || plannedAt && +at - Date.parse(plannedAt) >= 60000) {
        record.outcome = 'skipped'; record.reason = busy ? '上一轮仍在执行或暂停，本次已跳过' : '离线或休眠错过计划时间，本次不补跑';
        return this.transaction(() => { advance(); state.automationTriggers.push(record); this.addEvent({type:'automation.skipped',message:record.reason,data:{automationId:id,triggerId:record.id}}); return recordView(record); });
      }
      try {
        return this.transaction(() => {
          const task = this.createTask({ title: item.title + "（" + new Intl.DateTimeFormat("en-CA", {timeZone:item.timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(plannedAt || at)) + "）", objective: item.objective, memberAgentIds: item.memberAgentIds, workflowTemplateId: item.workflowTemplateId, acceptanceCriteria: item.acceptanceCriteria });
          Object.assign(state.tasks.find(value => value.id === task.id), { kind: 'automation', automationId: id, automationTriggerId: record.id, automationVersion: item.version });
          const run = this.createRun(task.id); record.taskId = task.id; record.runId = run.id;
          for (const previous of state.runs.filter(value => value.id !== run.id && value.status === 'awaiting_acceptance' && state.tasks.find(task => task.id === value.taskId)?.automationId === id)) {
            if (!this.canCompleteRun(previous.id)) throw new Error('上一轮仍有未结束执行');
            this.confirmAutomationCompletion(previous.id, record.id);
          }
          advance(); state.automationTriggers.push(record);
          this.addEvent({ type: 'automation.triggered', runId: run.id, message: '自动化已触发', data: { automationId: id, triggerId: record.id } });
          return recordView(record);
        });
      } catch (error) {
        // The failed transaction rolled back the new task and all confirmations.
        record.taskId = null; record.runId = null; record.outcome = 'failed'; record.reason = error.message;
        return this.transaction(() => { advance(); state.automationTriggers.push(record); this.addEvent({type:'automation.trigger_failed',message:'自动化启动失败',data:{automationId:id,triggerId:record.id}}); return recordView(record); });
      }
    }
  };
}
