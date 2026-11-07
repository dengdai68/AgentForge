export function createAutomationScheduler({ getStore, execute, blocked = () => false, onError = () => {} }) {
  let timer,continuation,queue=[];
  function tick() {
    if (blocked() || continuation) return;
    const store = getStore();
    if(!queue.length)queue=store.dueAutomations();
    for (const item of queue.splice(0,8)) {
      try {
        const record = store.triggerAutomation(item.id, { plannedAt: item.plannedAt });
        if (record.runId && record.outcome === 'started') void Promise.resolve().then(() => execute(store, record.runId)).catch(error => onError(error, record.runId));
      } catch (error) { onError(error, item.id); }
    }
    if(queue.length)continuation=setImmediate(()=>{continuation=null;tick();});
  }
  return { tick, start() { timer ||= setInterval(tick, 10000); timer.unref(); }, stop() { clearInterval(timer); clearImmediate(continuation);timer = continuation = null;queue=[]; } };
}
