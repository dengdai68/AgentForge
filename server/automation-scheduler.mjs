export function createAutomationScheduler({ getStore, execute, blocked = () => false, onError = () => {} }) {
  let timer;
  function tick() {
    if (blocked()) return;
    const store = getStore();
    for (const item of store.dueAutomations()) {
      try {
        const record = store.triggerAutomation(item.id, { plannedAt: item.plannedAt });
        if (record.runId && record.outcome === 'started') void Promise.resolve().then(() => execute(store, record.runId)).catch(error => onError(error, record.runId));
      } catch (error) { onError(error, item.id); }
    }
  }
  return { tick, start() { timer ||= setInterval(tick, 10000); timer.unref(); }, stop() { clearInterval(timer); timer = null; } };
}
