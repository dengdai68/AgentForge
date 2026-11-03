// Keep dropdowns in their component DOM while escaping ancestor scroll clips.
const lists = new WeakMap();

export function createFloatingList(anchor, list, { maxHeight = 240, gap = 4, onClose = () => {} } = {}) {
  if (lists.has(list)) return lists.get(list);
  const document = anchor.ownerDocument, window = document.defaultView;
  const surface = document.createElement('div');
  surface.className = 'floating-list'; surface.setAttribute('popover', 'manual'); surface.hidden = true;
  list.before(surface); surface.append(list);
  let opened = false, events, observer, frame = 0;
  function cleanup() {
    events?.abort(); events = null;
    observer?.disconnect(); observer = null;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  }
  function close() {
    const changed = opened; opened = false; cleanup(); list.hidden = true;
    if (surface.matches(':popover-open')) surface.hidePopover();
    surface.hidden = true;
    if (changed) onClose();
  }
  function position() {
    if (!opened) return;
    const box = anchor.getBoundingClientRect(), width = window.innerWidth, height = window.innerHeight, edge = 8;
    if (!anchor.isConnected || list.hidden || !box.width || box.bottom <= 0 || box.top >= height) { close(); return; }
    const popupWidth = Math.min(box.width, width - edge * 2);
    surface.style.width = `${popupWidth}px`;
    Object.assign(list.style, { position:'static', inset:'auto', margin:'0', width:'100%', boxSizing:'border-box', display:'block' });
    const style = window.getComputedStyle(list);
    const natural = Math.min(maxHeight, list.scrollHeight + parseFloat(style.borderTopWidth || 0) + parseFloat(style.borderBottomWidth || 0));
    const below = height - box.bottom - edge, above = box.top - edge;
    const bottom = below >= natural + gap || below >= above;
    list.style.maxHeight = `${Math.max(0, Math.min(maxHeight, (bottom ? below : above) - gap))}px`;
    // Transparent padding joins the anchor and menu so mouseleave cannot close
    // the component while the pointer crosses the visible four-pixel gap.
    surface.style.padding = bottom ? `${gap}px 0 0` : `0 0 ${gap}px`;
    const popupHeight = list.getBoundingClientRect().height + gap;
    surface.style.left = `${Math.max(edge, Math.min(box.left, width - popupWidth - edge))}px`;
    surface.style.top = `${bottom ? box.bottom : box.top - popupHeight}px`;
    surface.dataset.placement = bottom ? 'bottom' : 'top';
  }
  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; position(); });
  }
  function open() {
    list.hidden = false; surface.hidden = false;
    if (!surface.matches(':popover-open')) surface.showPopover();
    if (!opened) {
      opened = true;
      events = new window.AbortController();
      window.addEventListener('resize', schedule, { signal:events.signal });
      const outside = event => { if (!anchor.contains(event.target) && !surface.contains(event.target)) close(); };
      document.addEventListener('pointerdown',outside,{capture:true,signal:events.signal});
      document.addEventListener('focusin',outside,{capture:true,signal:events.signal});
      document.addEventListener('scroll', event => { if (!list.contains(event.target)) schedule(); }, { capture:true, signal:events.signal });
      observer = new window.ResizeObserver(schedule);
      observer.observe(anchor); observer.observe(list);
      const modal = anchor.closest('dialog,.modal'); if (modal) observer.observe(modal);
    }
    position();
  }
  surface.addEventListener('toggle', event => { if (event.newState === 'closed') { const changed=opened;opened = false; cleanup(); list.hidden = true; surface.hidden = true;if(changed)onClose(); } });
  const controller = { open, close, position, surface };
  lists.set(list, controller);
  return controller;
}

export function closeFloatingList(list) {
  if (!list) return;
  const controller = lists.get(list);
  if (controller) controller.close(); else list.hidden = true;
}

export function closeFloatingLists(root) {
  for (const list of root?.querySelectorAll?.('.floating-list > *') || []) lists.get(list)?.close();
}
