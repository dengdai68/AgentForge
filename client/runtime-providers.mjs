// One fixed slot per native CLI. Installation and authentication are separate facts.
export const RUNTIME_PROVIDERS = Object.freeze({
  'claude-code': {label:'Claude Code',command:'claude',efforts:['low','medium','high','xhigh','max']},
  codex: {label:'Codex',command:'codex',efforts:['low','medium','high','xhigh','max','ultra']},
  dsh: {label:'DeepSeek Harness',command:'dsh',efforts:['off','low','high','max']},
  cursor: {label:'Cursor',command:'cursor-agent',efforts:['none','low','medium','high','xhigh','max']},
  gemini: {label:'Gemini CLI',command:'gemini',efforts:['minimal','low','medium','high']},
  qwen: {label:'Qwen Code',command:'qwen',efforts:['low','medium','high','xhigh','max']},
  kimi: {label:'Kimi Code',command:'kimi',efforts:['low','medium','high','xhigh','max']},
  pi: {label:'Pi',command:'pi',efforts:['off','minimal','low','medium','high','xhigh','max']},
  opencode: {label:'OpenCode',command:'opencode',efforts:['none','minimal','low','medium','high','xhigh','max']}
});
export const RUNTIME_IDS = Object.freeze(Object.keys(RUNTIME_PROVIDERS));
export const PORTABLE_RUNTIME_IDS = Object.freeze(RUNTIME_IDS.slice(3));
export const RUNTIME_EFFORT_LEVELS = Object.fromEntries(Object.entries(RUNTIME_PROVIDERS).map(([id,value])=>[id,value.efforts]));
export const runtimeLabel = id => RUNTIME_PROVIDERS[id]?.label || id || '未知 Runtime';
export const nativeSessionId = value => typeof value==='string'&&/^[A-Za-z0-9_-]{8,200}$/.test(value);
