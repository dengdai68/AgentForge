import { paginationMarkup } from './pagination.mjs';

export function createAutomationUI({ api, esc, pill, exactTime, edit, navigate, openRun, toast, confirmDelete, catalog }) {
  let root, selectedId, request = 0, timer, query = { search: '', status: 'all', page: 1 }, records = { status: 'all', page: 1 }, tab = 'records', mountedKey, recordOwner;
  const format = (value, timeZone) => value ? timeZone ? new Intl.DateTimeFormat('zh-CN',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)) : exactTime(value) : '—';
  const stateLabel = record => record?.status === 'awaiting_acceptance' ? '<span class="status-pill awaiting_acceptance">待验收</span>' : record?.status === 'skipped' ? '<span class="status-pill">已跳过</span>' : record ? pill(record.status) : '尚未触发';
  async function load({ quiet = false } = {}) {
    const target = root, id = selectedId, ticket = ++request;
    if (!quiet) target.setAttribute('aria-busy','true');
    try {
      const data = id ? await api(`/api/automations/${encodeURIComponent(id)}`) : await api('/api/automations?' + new URLSearchParams(query));
      const history = id && tab === 'records' ? await api(`/api/automations/${encodeURIComponent(id)}/triggers?` + new URLSearchParams(records)) : null;
      if (ticket !== request || target !== root) return;
      if (!id) {
        query.page = data.page;
        if (!target.querySelector('#automation-search')) target.innerHTML = `<form class="directory-toolbar" id="automation-search"><input name="search" aria-label="搜索自动化" placeholder="搜索" value="${esc(query.search)}"><select name="status" aria-label="自动化状态"><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select><button class="small-button" type="submit">搜索</button><button class="small-button" type="button" data-auto-reset>重置</button><button class="primary-button" type="button" data-auto-new>＋ 新建自动化</button></form><div data-auto-results></div>`;
        target.querySelector('[name=status]').value = query.status;
        target.querySelector('[data-auto-results]').innerHTML = data.items.length ? `<div class="automation-table-scroll"><table class="data-table automation-table"><thead><tr><th>自动化</th><th>状态</th><th>执行规则</th><th>下次执行</th><th>最近执行</th><th>操作</th></tr></thead><tbody>${data.items.map(item => `<tr><td><button class="text-action automation-name" data-auto-open="${esc(item.id)}">${esc(item.title)}</button></td><td><span class="status-pill ${item.enabled ? 'running' : ''}">${item.enabled ? '已启用' : '已停用'}</span></td><td><code>${esc(item.cron)}</code><small>${esc(item.timeZone)}</small></td><td>${format(item.nextTriggerAt,item.timeZone)}</td><td>${stateLabel(item.latestTrigger)}</td><td><button class="small-button" data-auto-open="${esc(item.id)}">详情</button></td></tr>`).join('')}</tbody></table></div>${paginationMarkup(data,'automations')}` : '<div class="directory-empty">没有符合条件的自动化</div>';
      } else {
        const item = data.automation;
        // Avoid replacing a focused control during background refresh.
        if (quiet && target.contains(document.activeElement)) return;
        target.innerHTML = `<div class="automation-heading"><div class="workspace-title"><button class="small-button" data-auto-back aria-label="返回自动化列表">←</button><h3>${esc(item.title)}</h3><span class="status-pill ${item.enabled ? 'running' : ''}">${item.enabled ? '已启用' : '已停用'}</span></div><div class="automation-actions"><button class="small-button" data-auto-edit>编辑</button><button class="small-button" data-auto-toggle>${item.enabled ? '停用' : '启用'}</button>${item.latestTrigger ? '' : '<button class="small-button danger" data-auto-delete>删除</button>'}<button class="primary-button" data-auto-trigger>立即执行</button></div></div><div class="automation-schedule"><code>${esc(item.cron)}</code><span>${esc(item.timeZone)}</span><span>下次执行 ${format(item.nextTriggerAt,item.timeZone)}</span></div><div class="ws-tabs workspace-mode-tabs" role="tablist" aria-label="自动化详情"><button class="ws-tab ${tab === 'records' ? 'active' : ''}" data-auto-tab="records" role="tab" aria-selected="${tab === 'records'}">触发记录</button><button class="ws-tab ${tab === 'config' ? 'active' : ''}" data-auto-tab="config" role="tab" aria-selected="${tab === 'config'}">配置</button></div><div data-auto-detail></div>`;
        const body = target.querySelector('[data-auto-detail]');
        if (tab === 'config') body.innerHTML = `<dl class="automation-config"><dt>执行成员</dt><dd>${item.memberAgentIds.map(id=>esc(catalog().agents.find(agent=>agent.id===id)?.name || id)).join('、')}</dd><dt>工作流</dt><dd>${esc(catalog().workflowTemplates.find(workflow=>workflow.id===item.workflowTemplateId)?.name || item.workflowTemplateId)}</dd><dt>内容描述</dt><dd>${esc(item.objective)}</dd><dt>验收标准</dt><dd>${item.acceptanceCriteria.length ? item.acceptanceCriteria.map(esc).join('<br>') : '无额外标准'}</dd><dt>执行规则</dt><dd>全自动协作；下一轮启动前自动确认上一轮待验收记录。正在执行或暂停时跳过重叠触发；离线错过不补跑。</dd></dl>`;
        else {
          records.page = history.page;
          body.innerHTML = `<form class="directory-toolbar" id="automation-record-filter"><select name="status" aria-label="触发状态">${[['all','全部状态'],['running','进行中'],['awaiting_acceptance','待验收'],['completed','已完成'],['failed','错误中断'],['paused','已暂停'],['cancelled','已终止'],['skipped','已跳过']].map(([value,label]) => `<option value="${value}" ${records.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button class="small-button" type="submit">筛选</button><button class="small-button" type="button" data-auto-refresh>刷新</button></form>${history.items.length ? `<div class="automation-table-scroll"><table class="data-table automation-table"><thead><tr><th>计划时间</th><th>触发方式</th><th>状态</th><th>完成方式</th><th>操作</th></tr></thead><tbody>${history.items.map(record => `<tr><td>${format(record.plannedAt,item.timeZone)}<small>触发 ${format(record.createdAt,item.timeZone)}</small></td><td>${record.source === 'schedule' ? '定时' : '手动'}</td><td>${stateLabel(record)}${record.reason ? `<small class="automation-reason">${esc(record.reason)}</small>` : ''}</td><td>${record.completion === 'automatic' ? '自动确认' : record.completion === 'manual' ? '手动确认' : '—'}</td><td>${record.runId ? `<button class="small-button" data-auto-run="${esc(record.runId)}">查看详情</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>${paginationMarkup(history,'automation-triggers')}` : '<div class="directory-empty">暂无符合条件的触发记录</div>'}`;
        }
        target.querySelector('[data-auto-edit]').onclick = () => edit(item);
        target.querySelector('[data-auto-toggle]').onclick = event => action(event.currentTarget, async () => { await api(`/api/automations/${id}`, {method:'PUT',body:JSON.stringify({enabled:!item.enabled})}); await load(); });
        target.querySelector('[data-auto-trigger]').onclick = event => action(event.currentTarget, async () => { const result = await api(`/api/automations/${id}/trigger`,{method:'POST',body:'{}'}); records.page = 1; tab = 'records'; toast(result.trigger.reason || '已开始执行',result.trigger.outcome === 'failed'); await load(); });
        if (target.querySelector('[data-auto-delete]')) target.querySelector('[data-auto-delete]').onclick = () => confirmDelete(item, async () => { await api(`/api/automations/${id}`,{method:'DELETE'}); navigate(null); });
      }
    } catch (error) {
      if (ticket !== request || target !== root) return;
      if (!quiet) {
        if (!target.children.length) target.innerHTML = `<div class="directory-empty" role="alert">${esc(error.message)} <button class="small-button" data-auto-refresh>重试</button></div>`;
        else toast(error.message,true);
      }
    } finally { if (ticket === request) target.removeAttribute('aria-busy'); }
  }
  async function action(button, work) { if (button.disabled) return; button.disabled = true; try { await work(); } catch(error) { toast(error.message,true); } finally { if(button.isConnected)button.disabled=false; } }
  return {
    mount(target, id = null) {
      root = target;
      const key = id || 'list';
      if (mountedKey === key) return;
      if (id && recordOwner !== id) { records = {status:'all',page:1}; tab='records'; recordOwner=id; }
      selectedId = id; mountedKey = key; target.innerHTML = '';
      target.onclick = event => {
        const button = event.target.closest('button'); if (!button || button.disabled) return;
        if (button.hasAttribute('data-auto-new')) edit();
        if (button.dataset.autoOpen) navigate(button.dataset.autoOpen);
        if (button.hasAttribute('data-auto-back')) navigate(null);
        if (button.dataset.autoRun) openRun(button.dataset.autoRun);
        if (button.dataset.autoTab) { tab=button.dataset.autoTab; void load(); }
        if (button.hasAttribute('data-auto-reset')) { query={search:'',status:'all',page:1}; target.querySelector('[name=search]').value=''; void load(); }
        if (button.hasAttribute('data-auto-refresh')) void load();
        if (button.dataset.page) { (id ? records : query).page=Number(button.dataset.page); void load(); }
      };
      target.onsubmit = event => { event.preventDefault(); const form = new FormData(event.target); if(id)records={status:form.get('status'),page:1}; else query={search:form.get('search'),status:form.get('status'),page:1}; void load(); };
      void load(); clearInterval(timer); timer=setInterval(()=>{if(document.visibilityState==='visible')void load({quiet:true});},15000);
    },
    refresh() { return load(); },
    unmount() { ++request; clearInterval(timer); mountedKey=null; }
  };
}
