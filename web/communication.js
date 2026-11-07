import { ByteCache } from "../client/byte-cache.mjs";
import { consoleEventWindow } from "../client/console-projections.mjs";
export function attachmentImageError(event) {
  if (event.target.matches?.('.communication-image img')) event.target.closest('.communication-image').dataset.imageError = 'true';
}
export function openAttachmentImage(trigger, onClose = () => {}) {
    const dialog = document.createElement('dialog'); dialog.className = 'communication-image-viewer';
    const name = trigger.dataset.imageName, url = trigger.dataset.imageUrl;
    dialog.setAttribute('aria-label', `图片预览：${name}`);
    dialog.innerHTML = `<header><strong>${escapeHtml(name)}</strong><div class="communication-image-actions"><a class="text-action" href="${escapeHtml(url.replace(/\?preview=1$/, ""))}" download="${escapeHtml(name)}" data-image-download>下载</a><button type="button" class="text-action" data-close-image aria-label="关闭图片预览（Esc）">×</button></div></header><div class="communication-image-stage"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}"><p role="status" hidden>图片无法预览，请关闭后下载原文件。</p></div>`;
    dialog.querySelector('[data-close-image]').onclick = () => dialog.close();
    dialog.querySelector('[data-image-download]').onclick = async event => {
      event.preventDefault();
      try { await downloadAttachment(event.currentTarget); }
      catch (error) { const status = dialog.querySelector('[role=status]'); status.textContent = error.message; status.hidden = false; }
    };
    dialog.querySelector('img').onerror = event => { event.target.hidden = true; dialog.querySelector('[role=status]').hidden = false; };
    dialog.querySelector('.communication-image-stage').onclick = event => { if (event.target.classList.contains('communication-image-stage')) dialog.close(); };
    dialog.onclose = () => { dialog.remove(); if (trigger.isConnected) trigger.focus({preventScroll:true}); onClose(); };
    document.body.append(dialog); dialog.showModal(); return dialog;
}
export async function downloadAttachment(link) {
  const response = await fetch(link.href,{method:'HEAD'});
  // HEAD intentionally has no response body, including error responses.
  if (!response.ok) throw new Error(`附件下载失败（HTTP ${response.status}）`);
  const download=document.createElement('a');download.href=link.href;download.download=link.download;download.click();
}

import { createEmployeeMultiSelect, extensionAvatarColor } from "./marketplace.mjs";
import { paginate, paginationMarkup } from "./pagination.mjs";
import { createFloatingList, closeFloatingList, closeFloatingLists } from './floating-list.mjs';
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const date = (value) => new Date(value).toLocaleString("zh-CN", { hour12: false });
const consoleIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m7 9 3 3-3 3m6 0h4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

export const imageAttachment = name => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name || '');
const attachmentSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`;
export const imageButton = (url, name, thumbnail=url) => `<button type="button" class="communication-image" data-chat-image data-image-url="${escapeHtml(url)}" data-image-name="${escapeHtml(name)}" aria-label="放大查看 ${escapeHtml(name)}"><img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(name)}" loading="lazy"><span class="communication-image-error">图片无法预览</span></button>`;
const attachmentIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/></svg>';
const pictureIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>';
export function attachmentControls(scope, disabled = false) {
  return `<button type="button" class="composer-icon-button" data-${scope}-attach aria-label="添加附件" title="添加附件" ${disabled ? 'disabled' : ''}>${attachmentIcon}</button><button type="button" class="composer-icon-button" data-${scope}-attach-image aria-label="添加图片" title="添加图片" ${disabled ? 'disabled' : ''}>${pictureIcon}</button>`;
}
export function draftAttachments(items, scope, disabled = false) {
  return items.map(item => {
    const name = escapeHtml(item.file.name);
    const remove = `<button type="button" class="composer-remove" data-remove-${scope}-attachment="${escapeHtml(item.id)}" aria-label="移除附件 ${name}" title="移除 ${name}" ${disabled ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
    return item.previewURL
      ? `<div class="communication-draft-image">${imageButton(item.previewURL, item.file.name)}${remove}</div>`
      : `<div class="communication-attachment pending" title="${name}">${attachmentIcon}<span class="composer-file-info"><span>${name}</span><small>${escapeHtml(item.file.name.split(".").length > 1 ? item.file.name.split(".").pop().toUpperCase().slice(0,12) : "文件")}</small></span>${remove}</div>`;
  }).join('');
}
export function messageAttachments(files, conversationId, scope = "communications") {
  if (!files.length) return '';
  return `<div class="communication-attachment-list">${files.map(file => {
    const url = `/api/${scope}/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(file.id)}`;
    // libvips does not decode BMP. Keep its existing browser preview rather
    // than replacing a supported attachment with a broken thumbnail.
    if (imageAttachment(file.name)) return `<figure class="communication-image-item">${imageButton(url + '?preview=1', file.name,url+(/\.bmp$/i.test(file.name)?'?preview=1':'?preview=1&thumbnail=1'))}</figure>`;
    return `<a class="communication-attachment" href="${url}" download="${escapeHtml(file.name)}" data-attachment-download>${attachmentIcon}<span>${escapeHtml(file.name)}</span><small>${attachmentSize(file.bytes)}</small></a>`;
  }).join('')}</div>`;
}

export function latestConversationId(conversations = []) {
  return conversations.reduce((latest,item)=>!latest || (Date.parse(item.updatedAt)||0)>(Date.parse(latest.updatedAt)||0)?item:latest,null)?.id || null;
}

export function memberMentionMarkup(html, names = [], document = globalThis.document) {
  const members = [...new Set(names.filter(name => typeof name === 'string' && name))].sort((a, b) => b.length - a.length);
  if (!members.length || !document?.createTreeWalker) return html;
  const container = document.createElement('div'); container.innerHTML = html;
  const pattern = new RegExp('@(?:' + members.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g');
  const walker = document.createTreeWalker(container, 4), nodes = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('code,pre,a,.member-mention')) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue, matches = [...text.matchAll(pattern)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment(); let offset = 0;
    for (const match of matches) {
      fragment.append(document.createTextNode(text.slice(offset, match.index)));
      const mention = document.createElement('strong'); mention.className = 'member-mention'; mention.textContent = match[0]; fragment.append(mention);
      offset = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(offset))); node.replaceWith(fragment);
  }
  return container.innerHTML;
}

export function formatCommunicationContent(content, { parse, sanitize, mentions = [] } = {}) {
  const fallback = `<span class="communication-plain">${escapeHtml(content)}</span>`;
  if (typeof parse !== "function" || typeof sanitize !== "function") return memberMentionMarkup(fallback, mentions);
  try {
    const html = parse(String(content));
    if (typeof html !== "string") return memberMentionMarkup(fallback, mentions);
    return memberMentionMarkup(sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["img", "video", "audio", "picture", "source", "iframe", "style", "form", "input", "button"], FORBID_ATTR: ["style"], ALLOW_DATA_ATTR: false }), mentions);
  } catch { return memberMentionMarkup(fallback, mentions); }
}

export function activeMention(value, caret, selected = []) {
  const match = value.slice(0, caret).match(/@([^@\n]{0,60})$/);
  if (!match || selected.some((member) => match[1].startsWith(member.name + " "))) return null;
  return match;
}

// Stable per-sender accents, never an inferred execution or business status.
export function communicationSenderTone(sender = {}) {
  if (sender.type === "human") return "info";
  const key = String(sender.id || sender.name || "agent");
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return hash % 2 ? "violet" : "teal";
}

export function createCommunicationUI({ api, navigate, notify, prepareContent = async () => {}, renderContent = escapeHtml, renderConsole = () => {}, renderAvatar = () => '', onRead = () => {} }) {
  let host, currentId = null, generation = 0, timer, contacts = [], conversations = [];
  let listLoaded = false, listError = "", listRequest = null, listPage = 1, listPagination = {page:1,totalPages:1,total:0};
  const views = new Map(), markdownCache=new ByteCache({maxBytes:4*1024*1024,maxEntries:300});
  let imageViewer = null;
  const view = (key) => {
    if (!views.has(key)) views.set(key, { messages: new Map(), readMessageIds: new Set(), deliveries: new Map(), draft: "", mentions: [], attachments: [], consoleOpen: false, consoleAgentId: null, consoleMembers: [], consolePages: new Map(), consoleRequest: null, consoleError: '', requestId: null, hasMore: false, before: null, loaded: false, sending: false, latestError: "", olderError: "", historyEpoch: 0, latestRequest: null, olderRequest: null });
    return views.get(key);
  };
  const query = (selector) => host?.querySelector(selector);
  const isCurrent = (key, token) => host?.isConnected && key === currentId && token === generation;
  function renderReadErrors() {
    const state = currentId && view(currentId);
    query(".communication-error").textContent = [listError, state?.latestError, state?.olderError].filter(Boolean).join(" · ");
  }
  function renderList() {
    const page = {...listPagination,items:conversations}; listPage = page.page;
    const html = page.items.map(item => {
      const employee = item.members?.find(member => member.id === item.targetId) || contacts.find(member => member.id === item.targetId) || {name:item.name};
      const initials = [...(employee.initials || employee.name || '?')].slice(0,2).join('');
      const avatar = item.kind !== 'agent' ? `<span class="communication-avatar color-${extensionAvatarColor(item.id)}" aria-hidden="true">群聊</span>` : renderAvatar({...employee,initials},'communication-avatar') || `<span class="communication-avatar color-${escapeHtml(employee.color || 'system')}" aria-hidden="true">${escapeHtml(initials)}</span>`;
      return `<button class="communication-contact ${item.id === currentId ? "selected" : ""}" data-chat-id="${escapeHtml(item.id)}">${avatar}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.preview || (item.kind !== "agent" ? "群聊" : "数字员工私聊"))}</small></span>${item.unreadCount ? `<span class="communication-unread" aria-label="${item.unreadCount} 条未读">${item.unreadCount}</span>` : ""}</button>`;
    }).join('') || `<div class="directory-empty" role="${listError ? "alert" : "status"}">${listError ? "会话列表读取失败，正在重连。" : listLoaded ? "<strong>还没有会话</strong>点击 ＋ 新建对话，选择数字员工开始沟通。" : "正在读取会话…"}</div>`;
    if (query('.communication-list').innerHTML !== html) query('.communication-list').innerHTML = html;
    query(".communication-pager").innerHTML = paginationMarkup(page, "communications");
    queryAll("[data-chat-id]").forEach((button) => button.onclick = () => navigate(button.dataset.chatId));
  }
  function queryAll(selector) { return [...(host?.querySelectorAll(selector) || [])]; }
  async function markVisibleRead() {
    const key = currentId, token = generation;
    if (!key || host?.ownerDocument?.visibilityState === "hidden") return;
    const state = view(key), list = query(".communication-messages");
    if (!list || !state.conversation?.unreadCount || !state.latestVisibleMessageId || state.reading || list.scrollHeight - list.scrollTop - list.clientHeight > 80) return;
    state.reading = true;
    try {
      const result = await api(`/api/communications/${key}/read`, { method: "POST", body: JSON.stringify({ messageId: state.latestVisibleMessageId }) });
      if (!isCurrent(key, token)) return;
      state.conversation = { ...state.conversation, unreadCount:result.conversation.unreadCount };
      conversations = conversations.map(item => item.id === key ? {...item,unreadCount:result.conversation.unreadCount} : item);
      renderList(); onRead();
    } catch { /* A failed acknowledgement keeps the messages unread; retry on the next poll. */ }
    finally { state.reading = false; }
  }
  function renderMessages() {
    if (!currentId) return;
    const state = view(currentId), list = query(".communication-messages");
    const bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const top = list.scrollTop, height = list.scrollHeight;
    const messages = [...state.messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const html = messages.map((message) => {

      const mentions=(state.conversation?.members||[]).map(member=>member.name),cacheKey=message.id+':'+message.content+':'+mentions.join('|');
      let content=markdownCache.get(cacheKey);if(content===undefined){content=renderContent(message.content,mentions);markdownCache.set(cacheKey,content);}
      const attachments = messageAttachments(message.attachments || [], currentId);
      const failed = [...state.deliveries.values()].filter(item => item.messageId === message.id && item.status === 'failed');
      const recovery = failed.map(item => `<div class="communication-recovery"><span>${escapeHtml(state.conversation.members.find(member=>member.id===item.agentId)?.name || '员工')} 回复失败</span><button type="button" class="text-action" data-chat-failure-console="${escapeHtml(item.agentId)}">查看控制台</button><button type="button" class="text-action" data-retry-chat-delivery="${escapeHtml(item.id)}">重试</button></div>`).join('');
      return `<article class="communication-message ${message.sender.type === "human" ? "from-human" : ""}" data-tone="${communicationSenderTone(message.sender)}"><header><strong>${escapeHtml(message.sender.name)}</strong><time>${escapeHtml(date(message.createdAt))}</time></header><div class="communication-body communication-markdown">${content}</div>${attachments ? `<div class="communication-message-attachments">${attachments}</div>` : ''}${recovery}</article>`;
    }).join("") || `<div class="communication-empty">${state.latestError ? "聊天记录读取失败，正在重连。" : state.loaded ? "从一句话开始沟通。消息将持续保留。" : "正在读取聊天记录…"}</div>`;
    if (state.renderedMessages !== html || state.messageList !== list) {
      state.renderedMessages = html; state.messageList = list;
      list.innerHTML = html;
      if (state.loadingOlder) list.scrollTop = top + list.scrollHeight - height;
      else list.scrollTop = bottom ? list.scrollHeight : top;
    }
    query(".communication-older").hidden = !state.hasMore;
    query(".communication-latest").hidden = !state.browsingHistory;
    query(".communication-older").disabled = Boolean(state.olderRequest?.generation === generation);
  }
  async function loadMessages(older = false) {
    const key = currentId, token = generation;
    if (!key) return;
    const state = view(key);
    const slot = older ? "olderRequest" : "latestRequest";
    const errorSlot = older ? "olderError" : "latestError";
    if (state[slot]?.generation === token || (older && (!state.loaded || !state.hasMore || !state.before))) return;
    const request = { generation: token, epoch: state.historyEpoch, before: state.before, sentMessages: [] };
    state[slot] = request;
    if (older) query(".communication-older").disabled = true;
    try {
      const [result] = await Promise.all([
        api(`/api/communications/${key}${older ? "?before=" + encodeURIComponent(request.before) : state.revision ? "?since="+encodeURIComponent(state.revision) : ""}`),
        prepareContent().catch(() => {}) // A missing display dependency must not hide messages.
      ]);
      if (!isCurrent(key, token) || (older && request.epoch !== state.historyEpoch)) return;
      if(result.unchanged)return;
      if(!older)state.revision=result.revision;
      if(!older&&state.browsingHistory){state.conversation=result.conversation;renderHeading();renderRoster();return;}
      if(older)state.browsingHistory=true;
      if (!older && state.loaded && result.messages.length && !result.messages.some((message) => state.readMessageIds.has(message.id))) {
        // A missed window is re-anchored, never joined across a hidden history gap.
        // POST confirms one message, not coverage of intervening history.
        state.messages.clear(); state.readMessageIds.clear(); state.deliveries.clear(); state.loaded = false;
        // POST acknowledgements received after this GET began are newer facts.
        request.sentMessages.forEach((message) => state.messages.set(message.id, message));
        state.historyEpoch++;
        state.olderRequest = null;
        state.olderError = "";
      }
      if (!older) {
        if (state.consoleAgentId && state.conversation?.members.some(member => member.id === state.consoleAgentId) && !result.conversation.members.some(member => member.id === state.consoleAgentId)) {
          state.consoleOpen = false; state.consoleAgentId = null; state.consoleMembers = []; state.consoleRequest = null; state.consoleRenderKey = null; state.consoleError = '';
          renderConsolePanel();
        }
        const stale = state.conversation?.updatedAt && result.conversation.updatedAt && result.conversation.updatedAt < state.conversation.updatedAt;
        if (!stale) state.conversation = result.conversation;
        state.latestVisibleMessageId = result.messages.at(-1)?.id;
      }
      result.messages.forEach((message) => { state.messages.set(message.id, message); state.readMessageIds.add(message.id); });
      const ordered=[...state.messages.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      const removed=older?ordered.slice(200):ordered.slice(0,Math.max(0,ordered.length-200));
      for(const {id}of removed){state.messages.delete(id);state.readMessageIds.delete(id);}
      for(const [id,delivery]of state.deliveries)if(!state.messages.has(delivery.messageId)&&['done','cancelled'].includes(delivery.status))state.deliveries.delete(id);
      result.deliveries.forEach((delivery) => state.deliveries.set(delivery.id, delivery));
      if (!state.loaded || older) { state.before = result.nextBefore; state.hasMore = result.hasMore; }
      state.loaded = true; state.loadingOlder = older;
      state[errorSlot] = "";
      renderHeading();
      renderRoster(); renderMessages(); state.loadingOlder = false;
      if (!older) void markVisibleRead();
      renderReadErrors();
    } catch (error) {
      if (!isCurrent(key, token) || (older && request.epoch !== state.historyEpoch)) return;
      state[errorSlot] = older ? `更早消息读取失败：${error.message}（历史和草稿保留，可再次加载更早消息）` : `聊天记录读取失败：${error.message}（历史和草稿保留，正在重连）`;
      if (!state.loaded) query(".communication-heading").textContent = "会话读取失败";
      renderReadErrors(); renderMessages();
    } finally {
      if (state[slot] === request) state[slot] = null;
      if (isCurrent(key, token)) query(".communication-older").disabled = Boolean(state.olderRequest?.generation === token);
    }
  }
  async function poll() {
    if (!host || listRequest?.generation === generation) return;
    const request = { generation }; listRequest = request;
    const token = generation;
    try {
      const result = await api(`/api/communications?page=${listPage}`);
      if (!host || token !== generation) return;
      listPagination=result;conversations = result.conversations; listLoaded = true; listError = ""; renderList(); renderReadErrors();
      if(!currentId){const latest=latestConversationId(conversations);if(latest)navigate(latest);}
    } catch (error) { if (host && token === generation) { listError = `会话列表读取失败：${error.message}（历史和草稿保留，正在重连）`; renderList(); renderReadErrors(); } }
    finally { if (listRequest === request) listRequest = null; }
  }
  function consolePage(state) {
    if (!state.consolePages.has(state.consoleAgentId)) state.consolePages.set(state.consoleAgentId, { events: new Map(), traces: [], loaded: false, hasMore: false, before: null });
    return state.consolePages.get(state.consoleAgentId);
  }
  function renderConsolePanel() {
    if (!currentId) return;
    const state = view(currentId), panel = query('[data-communication-console]');
    panel.hidden = !state.consoleOpen; panel.dataset.open = String(state.consoleOpen);
    query('.communication-panes').classList.toggle('console-open', state.consoleOpen);
    query('[data-toggle-communication-console]').setAttribute('aria-expanded', String(state.consoleOpen));
    query('[data-chat-roster]').querySelectorAll('[data-chat-member-console]').forEach(button => button.setAttribute('aria-pressed', String(state.consoleOpen && button.dataset.chatMemberConsole === state.consoleAgentId)));
    if (!state.consoleOpen) return;
    query('[data-communication-console-error]').textContent = state.consoleError;
    const page = consolePage(state);
    query('[data-communication-console-older]').hidden = !page.hasMore;
    query('[data-communication-console-older]').disabled = Boolean(state.consoleRequest);
    const stream = query('[data-communication-stream]');
    const agent = state.consoleMembers.find(row => row.id === state.consoleAgentId);
    query("[data-chat-console-name]").textContent = agent?.name || "控制台";
    if (!agent) { stream.textContent = state.consoleRequest ? '正在读取控制台…' : '此会话尚无执行记录。'; return; }
    const key = JSON.stringify([agent.id, [...page.events.keys()], page.traces]);
    if (state.consoleRenderKey === key) return;
    state.consoleRenderKey = key;
    const reading = page.reading || { following: true, top: 0, open: [], closed: [] };
    if (stream.dataset.agentId === agent.id && stream.children.length) {
      reading.following = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;
      reading.top = stream.scrollTop;
      reading.open = [...stream.querySelectorAll('details[open][data-console-key]')].map(node => node.dataset.consoleKey);
      reading.closed = [...stream.querySelectorAll('details[data-default-open]:not([open])')].map(node => node.dataset.consoleKey);
    }
    const anchor = state.consolePrepend ? [...stream.querySelectorAll('[data-console-row]')].find(node => node.getBoundingClientRect().bottom > stream.getBoundingClientRect().top) : null;
    const anchorTop = anchor?.getBoundingClientRect().top;
    stream.dataset.agentId = agent.id;
    renderConsole(stream, { events: [...page.events.values()], traces: page.traces, hasMore: page.hasMore, refresh: Boolean(state.consoleRefresh), basePath: `/api/communications/${encodeURIComponent(currentId)}` }, agent);
    state.consoleRefresh = false;
    for (const details of stream.querySelectorAll('details[data-console-key]')) details.open = reading.open.includes(details.dataset.consoleKey) || (details.dataset.defaultOpen !== undefined && !reading.closed.includes(details.dataset.consoleKey));
    stream.scrollTop = state.consolePrepend && anchor?.isConnected ? stream.scrollTop + anchor.getBoundingClientRect().top - anchorTop : state.consolePrepend ? 0 : reading.following ? stream.scrollHeight : reading.top;
    state.consolePrepend = false; page.reading = reading;
  }
  async function loadConsole(older = false, { latest = false } = {}) {
    const key = currentId, token = generation;
    if (!key) return;
    const state = view(key), page = consolePage(state);
    if (!state.consoleOpen || state.consoleRequest || older && (!page.hasMore || !page.before)) return;
    const stream = query('[data-communication-stream]');
    if (!latest && page.loaded && stream.scrollHeight - stream.scrollTop - stream.clientHeight >= 48) page.browsingHistory = true;
    if (!older && !latest && page.browsingHistory) return;
    const request = { agentId: state.consoleAgentId }; state.consoleRequest = request;
    renderConsolePanel();
    try {
      const params = new URLSearchParams({ limit: '50', ...(request.agentId ? { agentId: request.agentId } : {}), ...(older ? { before: page.before } : {}) });
      const result = await api(`/api/communications/${key}/console?${params}`);
      if (!isCurrent(key, token) || !state.consoleOpen || state.consoleRequest !== request) return;
      state.consoleMembers = result.agents.filter(agent => !request.agentId || agent.id === request.agentId);
      if (!request.agentId && result.agents.length) {
        state.consoleAgentId = (result.agents.find(agent => agent.running) || result.agents[0]).id;
        state.consoleRequest = null; state.consoleRenderKey = null; renderConsolePanel(); void loadConsole(); return;
      }
      const window = consoleEventWindow(latest ? [] : [...page.events.values()], result.events, { older });
      page.events = new Map(window.events.map(event => [event.id, event]));
      const traceIds = new Set(window.events.map(event => event.data?.traceId));
      page.traces = [...new Map([...page.traces, ...result.traces].map(trace => [trace.id, trace])).values()].filter(trace => traceIds.has(trace.id));
      if (!page.loaded || older || latest || window.reset) { page.before = result.nextBefore; page.hasMore = result.hasMore; }
      if (window.trimmedBefore) { page.before = window.events[0].id; page.hasMore = true; }
      if (older) page.browsingHistory = true;
      if (latest) { page.browsingHistory = false; page.reading = { following: true, top: 0, open: [], closed: [] }; stream.scrollTop = stream.scrollHeight; }
      page.loaded = true; state.consoleError = ''; state.consolePrepend = older;
    } catch (error) { if (isCurrent(key, token) && state.consoleRequest === request) state.consoleError = `控制台读取失败：${error.message}；记录保留，可刷新重试。`; }
    finally { if (state.consoleRequest === request) state.consoleRequest = null; if (isCurrent(key, token)) renderConsolePanel(); }
  }
  function renderAttachments() {
    const state = view(currentId);
    const container = query('[data-chat-attachments]');
    container.innerHTML = draftAttachments(state.attachments, 'chat', state.sending);
    container.onclick = event => {
      const image = event.target.closest('[data-chat-image]');
      if (image) { openImage(image); return; }
      const button = event.target.closest('[data-remove-chat-attachment]');
      if (!button || state.sending) return;
      const item = state.attachments.find(item => item.id === button.dataset.removeChatAttachment);
      if (item?.previewURL) URL.revokeObjectURL(item.previewURL);
      state.attachments = state.attachments.filter(value => value !== item);
      state.requestId = null; renderAttachments();
      query('#communication-input')?.focus({preventScroll:true});
    };
    for (const button of host.querySelectorAll('.composer-icon-button')) button.disabled = state.sending;
  }

  const imageError = attachmentImageError;
  function openImage(trigger) {
    imageViewer?.close();
    imageViewer = openAttachmentImage(trigger, () => { if (!trigger.isConnected) query('#communication-input')?.focus(); });
  }

  function mentionMenu() {
    const input = query("textarea"), state = view(currentId), menu = query(".communication-mentions");
    state.mentions = state.mentions.filter((member) => input.value.includes("@" + member.name));
    const match = activeMention(input.value, input.selectionStart, state.mentions);
    if (!match || state.conversation?.kind !== "group") { closeFloatingList(menu); return; }
    const members = state.conversation.members.filter((member) => member.status === "active" && member.name.toLowerCase().includes(match[1].toLowerCase()));
    menu.innerHTML = members.map((member, index) => `<button type="button" role="option" aria-selected="${index === 0}" data-chat-mention="${escapeHtml(member.id)}">${escapeHtml(member.name)}</button>`).join("") || "<p>没有匹配成员</p>";
    createFloatingList(input,menu).open();
    menu.querySelectorAll("button").forEach((button) => button.onclick = () => {
      const member = members.find((item) => item.id === button.dataset.chatMention);
      input.setRangeText("@" + member.name + " ", input.selectionStart - match[0].length, input.selectionStart, "end");
      state.mentions = [...state.mentions.filter((item) => item.id !== member.id), member];
      state.draft = input.value; state.requestId = null; closeFloatingList(menu); input.focus();
    });
  }
  function renderHeading() {
    const state = view(currentId), conversation = state.conversation, heading = query('.communication-heading');
    const group = conversation?.kind === 'group';
    heading.textContent = conversation?.name || (state.latestError ? '会话读取失败' : '加载会话…');
    heading.hidden = Boolean(state.nameEditing);
    heading.setAttribute('tabindex', group ? '0' : '-1');
    heading.setAttribute('title', conversation?.name || '');
    query('[data-chat-name-input]').hidden = !state.nameEditing;
    query('.communication-subtitle').textContent = conversation ? (group ? '群聊 · @ 指定成员，不 @ 全员回复' : '长期私聊 · 与任务执行上下文隔离') : '';
  }
  function beginRename() {
    const state = view(currentId);
    if (state.conversation?.kind !== 'group' || state.renaming) return;
    state.nameEditing = true; renderHeading();
    const input = query('[data-chat-name-input]'); input.value = state.conversation.name; input.setCustomValidity(''); input.focus(); input.select();
  }
  function cancelRename() {
    const state = view(currentId);
    if (state.renaming) return;
    state.nameEditing = false; renderHeading();
  }
  async function saveName() {
    const key = currentId, token = generation, state = view(key), input = query('[data-chat-name-input]');
    if (state.renaming) return;
    const name = input.value.trim();
    if (name === state.conversation.name) { cancelRename(); return; }
    input.setCustomValidity(!name ? '请输入群聊名称' : name.length > 100 ? '群聊名称最多 100 字符' : '');
    if (!input.reportValidity()) return;
    state.renaming = true; input.disabled = true;
    try {
      const result = await api(`/api/communications/${key}`, {method:'PUT',body:JSON.stringify({name})});
      state.conversation = {...state.conversation,name:result.conversation.name,updatedAt:result.conversation.updatedAt};
      state.nameEditing = false;
      if (isCurrent(key,token)) { renderHeading(); conversations = conversations.map(item => item.id === key ? {...item,name:result.conversation.name,updatedAt:result.conversation.updatedAt} : item); renderList(); }
    } catch(error) { if (isCurrent(key,token)) { notify(error.message,true); input.focus(); } }
    finally { state.renaming = false; input.disabled = false; if (isCurrent(key,token) && state.nameEditing) input.focus(); }
  }
  function setupConversation() {
    const area = query(".communication-main");
    if (!currentId) { area.innerHTML = '<div class="communication-empty"><h2>沟通</h2><p>选择数字员工开始私聊，或新建一个群聊。</p><small>历史长期保存 · 不受任务归档影响</small></div>'; return; }
    const state = view(currentId);
    state.consoleRenderKey = null;
    area.innerHTML = `<div class="communication-panes">
      <section class="communication-chat">
        <header class="communication-header"><div><h2 class="communication-heading"></h2><input class="communication-name-input" data-chat-name-input aria-label="群聊名称" maxlength="100" required hidden><p class="communication-subtitle"></p></div><button type="button" class="text-action" data-toggle-chat-members aria-expanded="false" hidden>成员</button><button type="button" class="text-action member-console-icon communication-console-toggle" data-toggle-communication-console aria-label="控制台" title="控制台" aria-controls="communication-console-panel" aria-expanded="${state.consoleOpen}" hidden>${consoleIcon}</button></header>
        <div><button class="small-button communication-older" hidden>加载更早消息</button><button class="small-button communication-latest" hidden>回到最新</button></div><div class="communication-messages" aria-label="聊天记录"></div>
        <form class="communication-composer"><div class="communication-mentions" role="listbox" aria-label="@ 成员" hidden></div><div class="message-composer-card"><div class="message-composer-input"><div class="communication-draft-attachments" data-chat-attachments></div><textarea id="communication-input" aria-label="输入消息" placeholder="输入消息；群聊输入 @ 选择成员" rows="3">${escapeHtml(state.draft)}</textarea></div><p class="field-hint" data-chat-upload-status role="status"></p><input type="file" multiple data-chat-file hidden><input type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp" data-chat-image-file hidden><div class="communication-composer-actions">${attachmentControls('chat', state.sending)}<span>Enter 发送 · Shift + Enter 换行</span><button class="primary-button" type="submit">发送</button></div></div></form>
      </section>
      <aside class="communication-roster" aria-label="聊天成员" hidden><header><strong data-chat-member-count>成员</strong><button type="button" class="text-action" data-edit-chat-group>编辑群聊</button><button type="button" class="text-action" data-close-chat-members aria-label="关闭成员列表">×</button></header><div data-chat-roster></div></aside>
      <dialog class="communication-picker communication-member-detail" aria-label="员工详细信息"></dialog>
      <aside id="communication-console-panel" class="communication-console" data-communication-console hidden>
        <div class="communication-console-toolbar"><strong data-chat-console-name></strong><div class="communication-console-actions"><button type="button" class="text-action" data-communication-console-latest>↓ 最新</button><button type="button" class="text-action" data-communication-console-refresh>刷新</button><button type="button" class="text-action" data-close-chat-console aria-label="关闭控制台">×</button></div></div><button type="button" class="text-action communication-console-older" data-communication-console-older hidden>加载更早记录</button><p class="communication-console-error" data-communication-console-error role="alert"></p><div class="communication-trace-stream" data-communication-stream tabindex="0" role="log" aria-label="沟通控制台"></div>
      </aside>
    </div>`;
    state.nameEditing = false; renderHeading();
    query('.communication-header').ondblclick = event => { if (!event.target.closest('button,input')) beginRename(); };
    query('.communication-heading').onkeydown = event => { if (['Enter','F2'].includes(event.key)) { event.preventDefault(); beginRename(); } };
    query('[data-chat-name-input]').onkeydown = event => { if (event.isComposing || event.keyCode === 229) return; if(event.key === 'Enter') { event.preventDefault(); void saveName(); } else if(event.key === 'Escape') { event.preventDefault(); cancelRename(); query('.communication-heading').focus(); } };
    query('[data-chat-name-input]').onblur = cancelRename;
    renderMessages();
    renderAttachments(); renderRoster(); renderConsolePanel();
    query('[data-toggle-chat-members]').onclick = () => setMembersOpen(!query('.communication-panes').classList.contains('members-open'));
    query('[data-close-chat-members]').onclick = () => { setMembersOpen(false); query('[data-toggle-chat-members]').focus(); };
    query('.communication-roster').onkeydown = event => { if(event.key === 'Escape') { event.preventDefault(); setMembersOpen(false); query('[data-toggle-chat-members]').focus(); } };
    query('[data-edit-chat-group]').onclick = () => showGroupEditor(state.conversation);
    query('[data-close-chat-console]').onclick = () => { state.consoleOpen = false; renderConsolePanel(); };
    query('[data-toggle-communication-console]').onclick = () => { state.consoleOpen = !state.consoleOpen; state.consoleRequest = null; state.consoleRenderKey = null; renderConsolePanel(); if (state.consoleOpen) void loadConsole(); };
    query('[data-communication-console-older]').onclick = () => void loadConsole(true);
    query('[data-communication-console-refresh]').onclick = () => { state.consoleRenderKey = null; state.consoleRefresh = true; state.consoleRequest = null; void loadConsole(false, { latest: true }); };
    query('[data-communication-console-latest]').onclick = () => { state.consoleRequest = null; void loadConsole(false, { latest: true }); };
    const fileInput = query('[data-chat-file]');
    query('[data-chat-attach]').onclick = () => { if (!state.sending) fileInput.click(); };
    const imageInput = query('[data-chat-image-file]');
    query('[data-chat-attach-image]').onclick = () => { if (!state.sending) imageInput.click(); };
    query('.communication-messages').addEventListener('error', imageError, true);
    query('[data-chat-attachments]').addEventListener('error', imageError, true);
    fileInput.onchange = imageInput.onchange = event => {
      const picker = event.currentTarget;
      if (state.sending) return;
      for (const file of picker.files) {
        if (file.size > 20 * 1024 * 1024) { notify(`「${file.name}」超过单文件 20 MiB 上限。`, true); continue; }
        state.attachments.push({ id: crypto.randomUUID(), file, uploaded: null, previewURL: imageAttachment(file.name) ? URL.createObjectURL(file) : null });
      }
      picker.value = ''; state.requestId = null; renderAttachments();
    };
    query('.communication-messages').onclick = async event => {
      const image = event.target.closest('[data-chat-image]');
      if (image) { openImage(image); return; }
      const consoleButton = event.target.closest('[data-chat-failure-console]');
      if (consoleButton) { openMemberConsole(consoleButton.dataset.chatFailureConsole); return; }
      const retry = event.target.closest('[data-retry-chat-delivery]');
      if (retry) {
        const key = currentId; retry.disabled = true;
        try { await api(`/api/communications/${key}/deliveries/${retry.dataset.retryChatDelivery}/retry`, {method:'POST',body:'{}'}); if(currentId===key)await loadMessages(); }
        catch(error){notify(error.message,true);}finally{retry.disabled=false;} return;
      }
      const link = event.target.closest('[data-attachment-download]');
      if (!link) return;
      event.preventDefault();
      try {
        await downloadAttachment(link);
      } catch (error) { notify(error.message, true); }
    };
    query(".communication-messages").onscroll = () => { void markVisibleRead(); };
    query('.communication-latest').onclick=()=>{state.browsingHistory=false;state.revision=null;state.messages.clear();state.deliveries.clear();state.readMessageIds.clear();state.loaded=false;loadMessages();};
    query(".communication-older").onclick = () => loadMessages(true).catch((error) => notify(error.message, true));
    const form = query("form"), input = query("textarea"), submit = form.querySelector('[type="submit"]');
    submit.disabled = state.sending;
    input.oninput = () => { state.draft = input.value; state.requestId = null; mentionMenu(); };
    input.onkeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      const modified = event.shiftKey || event.metaKey || event.altKey || event.ctrlKey;
      const menu = query(".communication-mentions"), buttons = [...menu.querySelectorAll("button")];
      if (!menu.hidden && buttons.length && !modified && ["Tab", "Enter", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        let index = Math.max(0, buttons.findIndex((button) => button.getAttribute("aria-selected") === "true"));
        if (["Tab", "Enter"].includes(event.key)) buttons[index].click();
        else { index = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length; buttons.forEach((button, i) => button.setAttribute("aria-selected", String(i === index))); }
        return;
      }
      if (event.key === "Escape") closeFloatingList(menu);
      if (event.key === "Enter") {
        event.preventDefault();
        if (modified) { input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end"); input.dispatchEvent(new Event("input")); }
        else form.requestSubmit();
      }
    };
    form.onsubmit = async (event) => {
      event.preventDefault(); const key = currentId, token = generation, content = input.value;
      if (state.sending || (!content.trim() && !state.attachments.length)) return;
      if (content.length > 32000) { notify("消息最多 32000 字符。", true); return; }
      state.requestId ||= crypto.randomUUID();
      const requestId = state.requestId;
      const mentionAgentIds = state.mentions.filter((member) => content.includes("@" + member.name)).map((member) => member.id);
      const attachments = [...state.attachments];
      state.sending = true; submit.disabled = true; renderAttachments();
      try {
        for (const item of attachments) {
          if (item.uploaded) continue;
          if (isCurrent(key, token)) query('[data-chat-upload-status]').textContent = `正在上传 ${item.file.name}…`;
          const result = await api(`/api/communications/${key}/attachments?name=${encodeURIComponent(item.file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: item.file });
          item.uploaded = result.attachment;
        }
        const { message } = await api(`/api/communications/${key}/messages`, { method: "POST", body: JSON.stringify({ content, mentionAgentIds, attachmentIds: attachments.map(item => item.uploaded.id), clientRequestId: requestId }) });
        state.messages.set(message.id, message);
        state.attachments = state.attachments.filter(item => !attachments.includes(item));
        attachments.forEach(item => { if (item.previewURL) URL.revokeObjectURL(item.previewURL); });
        state.latestRequest?.sentMessages.push(message);
        if (state.draft === content) { state.draft = ""; state.mentions = []; state.requestId = null; if (isCurrent(key, token)) input.value = ""; }
        if (isCurrent(key, token)) { closeFloatingList(query(".communication-mentions")); renderMessages(); const list = query(".communication-messages"); list.scrollTop = list.scrollHeight; }
      } catch (error) { notify(error.message, true); }
      finally { state.sending = false; if (host && currentId === key) { query('form [type="submit"]').disabled = false; query('[data-chat-upload-status]').textContent = ''; renderAttachments(); } }
    };
  }
  function setMembersOpen(open) { query('.communication-panes').classList.toggle('members-open',open);query('[data-toggle-chat-members]').setAttribute('aria-expanded',String(open)); }
  function openMemberConsole(agentId) {
    const state = view(currentId); const closing=state.consoleOpen && state.consoleAgentId===agentId; state.consoleAgentId = agentId; state.consoleOpen = !closing; state.consoleRequest = null; state.consoleRenderKey = null;
    if (query('.communication-member-detail').open) query('.communication-member-detail').close();
    setMembersOpen(false); renderConsolePanel(); if(state.consoleOpen) void loadConsole();
  }
  function renderRoster() {
    const state = view(currentId), container = query('[data-chat-roster]'); if (!container || !state.conversation) return;
    const group = state.conversation.kind === 'group', members = state.conversation.members || [];
    query('.communication-panes').classList.toggle('has-group',group);
    query('.communication-roster').hidden = !group;
    query('[data-toggle-chat-members]').hidden = !group;
    query('[data-toggle-chat-members]').textContent = `成员 ${members.length}`;
    query('[data-toggle-communication-console]').hidden = group;
    query('[data-chat-member-count]').textContent = `成员 ${members.length}`;
    const html = members.map(member => `<div class="communication-roster-member"><button type="button" class="text-action communication-member-identity" data-chat-member-detail="${escapeHtml(member.id)}" title="${escapeHtml(member.name)}">${renderAvatar(member)}<span class="communication-member-name">${escapeHtml(member.name)}</span></button>${member.running ? '<span class="member-running-dot" role="status" aria-label="正在运行" title="正在运行"></span>' : ''}<button type="button" class="text-action member-console-icon" data-chat-member-console="${escapeHtml(member.id)}" aria-pressed="${state.consoleOpen && state.consoleAgentId === member.id}" aria-label="查看 ${escapeHtml(member.name)} 的控制台" title="查看控制台">${consoleIcon}</button></div>`).join('') || '<p class="field-hint">暂无员工</p>';
    if (container.innerHTML !== html) container.innerHTML = html;
    container.onclick = event => {
      const detail = event.target.closest('[data-chat-member-detail]'), consoleButton = event.target.closest('[data-chat-member-console]');
      if (consoleButton) return openMemberConsole(consoleButton.dataset.chatMemberConsole);
      if (!detail) return;
      renderMemberDetail(detail.dataset.chatMemberDetail, true);
    };
    const panel = query('.communication-member-detail');
    if (panel.open) renderMemberDetail(panel.dataset.memberId);
  }
  function renderMemberDetail(memberId, focus = false) {
    const member = view(currentId).conversation?.members?.find(row => row.id === memberId), panel = query('.communication-member-detail');
    if (!member) { if (panel.open) panel.close(); return; }
    const html = employeeDetailMarkup(member,{renderAvatar,renderContent,closeControl:'<button type="button" class="text-action" data-close-member-detail aria-label="关闭员工详情">×</button>'});
    if (panel.innerHTML !== html) panel.innerHTML = html;
    panel.dataset.memberId = memberId;
    panel.querySelector('[data-close-member-detail]').onclick = () => panel.close();
    panel.onclose = () => query(`[data-chat-member-detail="${CSS.escape(memberId)}"]`)?.focus();
    if (focus && !panel.open) panel.showModal();
  }

  async function startConversation(memberAgentIds) {
    if (!memberAgentIds.length) throw new Error('请至少选择一位数字员工');
    const input = memberAgentIds.length === 1 ? {kind:'agent',targetId:memberAgentIds[0]} : {kind:'group',memberAgentIds};
    const result = await api('/api/communications',{method:'POST',body:JSON.stringify(input)});
    return result;
  }
  function showGroupEditor(existing = null) {
    const trigger = query('[data-new-chat]'), key = currentId;
    const dialog = document.createElement('dialog'); dialog.className = 'communication-picker'; dialog.setAttribute('aria-labelledby','communication-picker-title');
    dialog.innerHTML = `<header><h2 id="communication-picker-title">${existing ? '编辑群聊' : '新建对话'}</h2></header><form>${existing ? `<div class="form-field"><label for="chat-group-name">群聊名称</label><input id="chat-group-name" name="name" maxlength="100" required value="${escapeHtml(existing.name)}"></div>` : ''}<div class="form-field" data-group-member-picker></div><p role="alert" data-group-error></p><div class="form-actions"><button type="button" class="small-button" data-close-group autofocus>关闭</button><button type="submit" class="primary-button">${existing ? '保存' : '开始沟通'}</button></div></form>`;
    host.append(dialog);
    const employees = contacts.filter(item => item.contactKind === 'agent'), teams = contacts.filter(item => item.contactKind === 'team');
    const selection = createEmployeeMultiSelect(dialog.querySelector('[data-group-member-picker]'), { id:'chat-group-members', label:'成员', placeholder:'添加团队或数字员工', esc:escapeHtml, items:[...teams,...employees], selectedIds:existing?.members.map(member=>member.id) || [], detail:item=>`<small>${escapeHtml(item.contactKind === 'team' ? '团队 · '+item.memberAgentIds.length+' 位员工' : item.description || '数字员工')}</small>`, expand:item=>item.contactKind === 'team' ? item.memberAgentIds.filter(id=>employees.some(member=>member.id===id)) : [item.id] });
    dialog.querySelector('[data-close-group]').onclick = () => dialog.close();
    dialog.oncancel = event => event.preventDefault();
    dialog.onclose = () => { closeFloatingLists(dialog); dialog.remove(); trigger?.focus(); };
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const button = dialog.querySelector('[type=submit]'); button.disabled = true;
      try {
        if (existing) {
          const name = dialog.querySelector('[name=name]').value;
          await api(`/api/communications/${key}`,{method:'PUT',body:JSON.stringify({memberAgentIds:selection.value(),...(name !== existing.name ? {name} : {})})});
          dialog.close(); if (key === currentId) await loadMessages();
        } else { const result = await startConversation(selection.value()); dialog.close(); navigate(result.conversation.id); }
        void poll();
      } catch(error) { dialog.querySelector('[data-group-error]').textContent = error.message; button.disabled = false; }
    };
    dialog.showModal(); dialog.querySelector('[data-close-group]').focus();
  }
  return {
    async open(kind, targetId) {
      if (kind === 'team') {
        try { const team = (await api('/api/teams')).teams.find(item => item.id === targetId); if (!team) throw new Error('团队不存在'); const result = await startConversation(team.memberAgentIds); navigate(result.conversation.id); } catch(error) { notify(error.message,true); } return;
      }
      const existing = conversations.find((item) => item.kind === kind && item.targetId === targetId);
      if (existing) { navigate(existing.id); return; }
      try { const result = await api("/api/communications", { method: "POST", body: JSON.stringify({ kind, targetId }) }); navigate(result.conversation.id); }
      catch (error) { notify(error.message, true); }
    },
    mount(element, state, selectedId) {
      const fresh = host !== element; host = element;
      contacts = [...state.agents.map((item) => ({ ...item, contactKind: "agent" })), ...state.teams.map((item) => ({ ...item, contactKind: "team" }))];
      if (fresh) {
        host.innerHTML = '<div class="communication-error" role="status"></div><div class="communication-layout"><aside class="communication-sidebar"><div class="communication-sidebar-heading"><h2>沟通</h2><button type="button" class="small-button" data-new-chat aria-label="新建对话"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></button></div><div class="communication-list"></div><div class="communication-pager"></div></aside><section class="communication-main"></section></div>';
        query("[data-new-chat]").onclick = () => showGroupEditor();
        query(".communication-pager").onclick = (event) => { const button = event.target.closest("[data-page]"); if (button) { listPage = Number(button.dataset.page); poll(); } };
      }
      const changed = fresh || currentId !== selectedId;
      if (changed) { imageViewer?.close(); if(currentId){const old=view(currentId);old.consoleOpen=false;old.consoleRequest=null;old.consolePages.clear();old.messages.clear();old.deliveries.clear();old.readMessageIds.clear();old.loaded=false;old.revision=null;old.browsingHistory=false;} generation++; currentId = selectedId; if(currentId){view(currentId).consoleOpen=false;view(currentId).consoleRequest=null;} setupConversation(); }
      const update = () => { if(globalThis.document?.visibilityState==='hidden')return; poll(); loadMessages(); void loadConsole(); };
      renderList(); renderReadErrors();
      if (changed || !timer) { clearInterval(timer); timer = setInterval(update, 2000); update(); }
    },
    unmount() { markdownCache.clear(); imageViewer?.close(); for(const state of views.values()){state.consoleOpen=false;state.consoleRequest=null;} clearInterval(timer); timer = null; closeFloatingLists(host); host = null; currentId = null; generation++; }
  };
}

export function employeeDetailMarkup(member, {renderAvatar = () => '', renderContent = escapeHtml, closeControl = ''} = {}) {
  const roles=member.roles || member.roleSnapshots || [];
  return `<section class="employee-profile"><header class="employee-profile-identity">${renderAvatar(member)}<div class="employee-profile-name"><h3>${escapeHtml(member.name)}</h3>${member.kind==='manager'?'<span class="employee-profile-kind">项目经理</span>':''}</div>${closeControl}</header>
    <section class="employee-profile-section"><h4>简介</h4><p class="employee-profile-description">${escapeHtml(member.description || '暂无简介')}</p></section>
    <section class="employee-profile-section"><h4>工作提示词</h4><div class="employee-profile-prompt communication-markdown">${renderContent(member.systemPrompt || '未填写')}${roles.map(role=>`<section class="employee-role-prompt"><h5>${escapeHtml(role.name)}</h5>${renderContent(role.prompt || '未填写')}</section>`).join('')}</div></section>
  </section>`;
}
