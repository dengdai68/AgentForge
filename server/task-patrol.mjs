export const TASK_PATROL_INTERVAL_MS = 10000;

// Detection never waits for model work. The in-flight set also covers file
// preparation, before a provider process or a running Trace exists.
export function createTaskPatrol({ store, execute, isExecuting = () => false, blocked = () => false, onError = () => {} }) {
  const inFlight = new Set();
  let timer;
  function tick() {
    if (blocked()) return;
    for (const runId of store.listPatrolRunIds()) {
      if (inFlight.has(runId) || isExecuting(runId)) continue;
      try {
        if (!store.prepareRunPatrol(runId)) continue;
        inFlight.add(runId);
        void Promise.resolve().then(() => execute(runId)).catch(error => onError(error, runId)).finally(() => inFlight.delete(runId));
      } catch (error) { onError(error, runId); }
    }
  }
  return { tick, start() { timer ||= setInterval(tick, TASK_PATROL_INTERVAL_MS); timer.unref(); }, stop() { clearInterval(timer); timer = null; } };
}
