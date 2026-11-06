const active = new Map();

export function registerExecution(key, execution, group = key) {
  if (active.has(key)) throw new Error("该执行会话已有本地 Agent 进程在执行");
  const entry = { execution, group };
  active.set(key, entry);
  return () => { if (active.get(key) === entry) active.delete(key); };
}

export function terminateExecution(runId, reason = "用户终止") {
  const entries = [...active.entries()].filter(([key, entry]) => key === runId || entry.group === runId);
  for (const [, entry] of entries) entry.execution.terminate(reason);
  return entries.length > 0;
}

export function hasActiveExecution(runId) {
  return active.has(runId) || [...active.values()].some(entry => entry.group === runId);
}
