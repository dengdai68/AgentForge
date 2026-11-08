import {RUNTIME_IDS,RUNTIME_PROVIDERS,PORTABLE_RUNTIME_IDS} from "../../client/runtime-providers.mjs";
import { dshModelCatalog } from "./dsh.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, delimiter, isAbsolute } from "node:path";
import { constants } from "node:fs";
import { cliEnvironment } from "./cli-environment.mjs";
import { createHash } from "node:crypto";
import { diagnostic } from "../diagnostics.mjs";

const exec = promisify(execFile);

// Effort vocabularies are observed from the real CLIs, never invented:
// claude --help documents low|medium|high|xhigh|max (2.1.216); codex debug
// models reports supported_reasoning_levels per model (codex-cli 0.160.0).
export const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
export const CODEX_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max", "ultra"];

// Claude Code has no offline model-list command (verified against the official
// docs). The locally resolvable candidates are the documented built-in aliases
// plus alias pins and the current model declared in settings.json/environment.
const CLAUDE_ALIASES = ["default", "best", "fable", "sonnet", "opus", "haiku", "sonnet[1m]", "opus[1m]", "opusplan"];
const CLAUDE_PIN_ALIASES = ["HAIKU", "SONNET", "OPUS", "FABLE"];

function claudeEfforts(capabilities) {
  if (Array.isArray(capabilities)) {
    if (!capabilities.includes("effort")) return { levels: [], note: "配置声明该模型不支持思考档位" };
    return { levels: CLAUDE_EFFORT_LEVELS, note: "配置声明该模型支持 effort 能力" };
  }
  return { levels: CLAUDE_EFFORT_LEVELS, note: "未声明模型能力；档位由 CLI 按模型实际支持解析，不支持时回退" };
}

async function readClaudeSettings(path) {
  let content;
  try { content = await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return {}; throw new Error("Claude 本机配置不可读取"); }
  try {
    if (Buffer.byteLength(content) > 1024 * 1024) throw new Error();
    const settings = JSON.parse(content);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error();
    return settings;
  } catch { throw new Error("Claude 本机配置不是有效 JSON"); }
}

// Only model/address/capability keys are read. Credential keys
// (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, ...) are never read, copied,
// logged or returned; the same boundary as claudeMarketEnvironment.
async function claudeCatalog({ environment, homeDirectory }) {
  const settingsPath = join(environment.CLAUDE_CONFIG_DIR || join(homeDirectory, ".claude"), "settings.json");
  const settings = await readClaudeSettings(settingsPath);
  const pick = (key) => typeof environment[key] === "string" && environment[key] ? environment[key]
    : typeof settings.env?.[key] === "string" && settings.env[key] ? settings.env[key] : undefined;
  const pins = {};
  for (const alias of CLAUDE_PIN_ALIASES) {
    pins[alias] = {
      model: pick(`ANTHROPIC_DEFAULT_${alias}_MODEL`),
      name: pick(`ANTHROPIC_DEFAULT_${alias}_MODEL_NAME`),
      description: pick(`ANTHROPIC_DEFAULT_${alias}_MODEL_DESCRIPTION`),
      capabilities: pick(`ANTHROPIC_DEFAULT_${alias}_MODEL_SUPPORTED_CAPABILITIES`)?.split(",").map(item => item.trim()).filter(Boolean)
    };
  }
  const current = pick("ANTHROPIC_MODEL") || (typeof settings.model === "string" && settings.model.trim() ? settings.model.trim() : undefined);
  const currentFromSettingsOnly = !pick("ANTHROPIC_MODEL") && current;
  const models = [];
  const seen = new Set();
  const pushModel = (model) => {
    const key = `${model.id}${model.resolvedTo || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    models.push(model);
  };
  for (const alias of CLAUDE_ALIASES) {
    const pin = pins[alias.toUpperCase()];
    const resolved = pin?.model || undefined;
    pushModel({
      id: alias,
      label: pin?.name || alias,
      description: pin?.description || "",
      resolvedTo: resolved,
      capabilities: pin?.capabilities,
      current: current === alias,
      source: resolved ? "本机别名钉住（settings.json env / 环境变量）" : "Claude Code 内置别名",
      ...claudeEfforts(pin?.capabilities)
    });
  }
  const pinnedIds = new Set(Object.values(pins).map(pin => pin.model).filter(Boolean));
  for (const pinned of [...pinnedIds]) {
    const pin = CLAUDE_PIN_ALIASES.map(alias => ({ alias, ...pins[alias] })).find(item => item.model === pinned);
    const aliases = CLAUDE_PIN_ALIASES.filter(alias => pins[alias].model === pinned).map(alias => alias.toLowerCase()).join("/");
    pushModel({
      id: pinned, label: pinned, description: pin.description || "", resolvedTo: undefined,
      capabilities: pin.capabilities, current: current === pinned,
      source: `别名 ${aliases} 钉住的实际模型 ID`,
      ...claudeEfforts(pin.capabilities)
    });
  }
  if (current && !pinnedIds.has(current) && !CLAUDE_ALIASES.includes(current)) {
    pushModel({
      id: current, label: current, description: "", resolvedTo: undefined, capabilities: undefined, current: true,
      source: currentFromSettingsOnly ? "settings.json model 字段（市场扩展执行使用 --setting-sources '' 时不生效）" : "ANTHROPIC_MODEL 环境变量",
      ...claudeEfforts(undefined)
    });
  }
  return {
    provider: "claude-code",
    source: "Claude Code 内置别名与本机配置（settings.json model/env 与环境变量）",
    notes: [
      "Claude Code 没有离线列出全部模型的命令；此处列出内置别名、本机别名钉住与当前生效模型，可钉任意全量模型 ID。",
      "仅读取模型/名称/说明/能力类键；凭据键（如 ANTHROPIC_AUTH_TOKEN）绝不读取或展示。",
      "选择市场扩展的执行带 --setting-sources ''：settings.json 的 model 字段不生效，ANTHROPIC_* 环境变量按同一优先级生效。",
      "思考档位可用性因模型而异；未声明能力的模型由 CLI 解析，不支持时回退到不超过所选的最高可用档。"
    ],
    models
  };
}

function codexCatalogModels(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.models)) throw new Error("Codex 模型目录结构无法识别");
  return parsed.models
    .filter(item => item && typeof item.slug === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(item.slug))
    .map(item => ({
      slug: item.slug,
      hidden: item.visibility !== "list",
      model: {
        id: item.slug,
        label: typeof item.display_name === "string" ? item.display_name : item.slug,
        description: typeof item.description === "string" ? item.description.slice(0, 500) : "",
        supportedInApi: item.supported_in_api === true,
        source: "codex debug models",
        levels: (Array.isArray(item.supported_reasoning_levels) ? item.supported_reasoning_levels : [])
          .filter(level => level && typeof level.effort === "string" && /^[a-z]{1,20}$/.test(level.effort))
          .map(level => ({ id: level.effort, description: typeof level.description === "string" ? level.description.slice(0, 200) : "", default: level.effort === item.default_reasoning_level }))
      }
    }));
}

async function codexCatalog(executable, { run }) {
  const command = executable || "codex";
  let result;
  try {
    result = await run(command, ["debug", "models"], { env: cliEnvironment(command), timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    diagnostic("provider.model_catalog_failed", { provider: "codex", error });
    throw new Error("Codex 模型目录查询失败：需要支持 debug models 的 codex CLI（0.160.0 起），请检查本机 CLI 安装、登录 Shell PATH 与版本");
  }
  let entries;
  try { entries = codexCatalogModels(JSON.parse(result.stdout)); }
  catch (error) {
    diagnostic("provider.model_catalog_invalid", { provider: "codex", error });
    throw new Error("Codex 模型目录输出无法解析；请检查 codex CLI 版本");
  }
  const models = entries.filter(entry => !entry.hidden).map(entry => entry.model);
  return {
    provider: "codex",
    source: "codex debug models（本机 CLI 目录）",
    notes: [
      "目录来自本机 codex CLI；账号实际可用模型以调用为准，目录中可见的模型仍可能被账号权益拒绝。",
      entries.some(entry => entry.hidden) ? "CLI 标记为隐藏的模型不列出。" : "目录不含隐藏模型。",
      "目录为全局目录：codex debug models 不接受 --profile（CLI 实测明确拒绝），命名 profile 仅影响调用时配置，不改变目录。",
      "逐模型思考档位来自目录的 supported_reasoning_levels；模型不在目录（含手工输入）时按 Codex 全局档位集合展示，实际支持以调用为准。"
    ],
    models
  };
}

// Native outputs can contain provider configuration. Project allowlisted model
// metadata only; never attach raw stdout/stderr or the original error as cause.
async function portableCatalog(provider,executable,{environment,homeDirectory,run}) {
  const levels=ids=>ids.map(id=>({id}));
  const command=executable || RUNTIME_PROVIDERS[provider].command;
  const native=async args=>{try{return (await run(command,args,{timeout:30000,maxBuffer:8*1024*1024,env:cliEnvironment(command,{}, {environment,homeDirectory})})).stdout.replace(/\x1b\[[0-9;]*m/g,'');}catch{throw Error(`${RUNTIME_PROVIDERS[provider].label} 模型目录查询失败，请检查原生 CLI 安装及登录`);}};
  const parse=raw=>{try{return JSON.parse(raw);}catch{throw Error('原生模型目录无法解析，请检查 CLI 版本');}};
  const safe=value=>typeof value==='string' && value.length>0 && value.length<=256 && !/[\x00-\x20]/.test(value);
  let models=[],source='';
  if(provider==='cursor'){
    source='cursor-agent --list-models';
    models=(await native(['--list-models'])).split(/\r?\n/).flatMap(line=>{const match=/^([^\s]+) - (.+)$/.exec(line);return match&&safe(match[1])?[{id:match[1],label:match[2].replace(/ \(current.*\)$/,''),current:match[2].includes('(current'),levels:[]}]:[];});
    for(const model of models){const part=/^(.*)-(none|minimal|low|medium|high|xhigh|max)(-fast)?$/.exec(model.id);if(part)model.levels=levels(models.flatMap(m=>{const p=/^(.*)-(none|minimal|low|medium|high|xhigh|max)(-fast)?$/.exec(m.id);return p&&p[1]===part[1]&&(p[3]||'')===(part[3]||'')?[p[2]]:[]}));model.note='思考档位来自此模型族的原生变体；未列档位可直接选择带思考等级的模型。';}
  } else if(provider==='gemini'){
    source='gemini models --output-format json';const rows=parse(await native(['models','--output-format','json']));if(!Array.isArray(rows))throw Error('Gemini 模型目录结构无法识别');
    models=rows.filter(m=>safe(m.id)).map(m=>({id:m.id,label:m.displayName || m.name || m.id,levels:levels(/^gemini-3/.test(m.id)?RUNTIME_PROVIDERS.gemini.efforts:[]),note:'Gemini 3 使用原生 thinkingLevel；Auto 与仅支持 token budget 的模型保留 CLI 默认。'}));
  } else if(provider==='kimi'){
    source='kimi provider list --json（仅模型元数据）';const value=parse(await native(['provider','list','--json']));if(!value.models || typeof value.models!=='object')throw Error('Kimi 模型目录结构无法识别');
    models=Object.entries(value.models).filter(([id])=>safe(id)).map(([id,m])=>({id,label:m.displayName || id,levels:(m.supportEfforts || []).filter(x=>RUNTIME_PROVIDERS.kimi.efforts.includes(x)).map(id=>({id,default:id===m.defaultEffort}))}));
  } else if(provider==='pi'){
    source='pi --list-models';models=(await native(['--list-models'])).split(/\r?\n/).flatMap(line=>{const parts=line.trim().split(/\s+/);return parts.length>=6&&parts[0]!=='provider'&&safe(parts[0])&&safe(parts[1])?[{id:parts[0]+'/'+parts[1],label:parts[0]+'/'+parts[1],levels:levels(parts[4]==='yes'?RUNTIME_PROVIDERS.pi.efforts:[]),note:'原生 Pi 思考档位；具体 Provider 可按实际支持归一。'}]:[];});
  } else if(provider==='opencode'){
    source='opencode api --standalone model.list';const value=parse(await native(['api','--standalone','model.list']));if(!Array.isArray(value.data))throw Error('OpenCode 模型目录结构无法识别');
    models=value.data.filter(m=>m.enabled!==false&&m.type==='chat'&&safe(m.providerID)&&safe(m.id)).map(m=>({id:m.providerID+'/'+m.id,label:m.name || m.id,levels:(m.variants || []).filter(v=>safe(v.id)&&/^[a-zA-Z0-9_.-]{1,64}$/.test(v.id)).map(v=>({id:v.id})),note:'档位为此模型原生 variant，通过 model#variant 执行。'}));
  } else if(provider==='qwen'){
    source='Qwen 本机 modelProviders / 官方 OAuth 别名';const path=join(environment.QWEN_HOME || join(homeDirectory,'.qwen'),'settings.json');let config={};try{if((await stat(path)).size>1024*1024)throw Error();const raw=await readFile(path,'utf8');if(Buffer.byteLength(raw)>1024*1024)throw Error();config=parse(raw);}catch(error){if(error.code!=='ENOENT')throw Error('Qwen 模型配置无法读取');}
    for(const rows of Object.values(config.modelProviders || {}))if(Array.isArray(rows))for(const row of rows)if(safe(row.id))models.push({id:row.id,label:row.name || row.id,levels:levels(RUNTIME_PROVIDERS.qwen.efforts),note:'Qwen 原生 reasoningEffort，各 Provider 按模型实际支持映射和归一。'});
    if(['qwen-oauth','qwen-subscription'].includes(config.security?.auth?.selectedType))models.push({id:'coder-model',label:'Qwen 原生默认编程模型',levels:levels(RUNTIME_PROVIDERS.qwen.efforts)});
    if(safe(config.model?.name)&&!models.some(m=>m.id===config.model.name))models.push({id:config.model.name,label:config.model.name,levels:levels(RUNTIME_PROVIDERS.qwen.efforts)});
  }
  if(!models.length)throw Error(`${RUNTIME_PROVIDERS[provider].label} 未返回可选模型；请检查原生 CLI 登录和模型配置，也可手工输入`);
  return {provider,source,models:[...new Map(models.map(m=>[m.id,m])).values()],notes:['目录来自原生 CLI 或本机模型配置，不代表账号额度或访问权限已通过真实调用。']};
}

// Read-only catalog for the Runtime settings surfaces. Profile field changes do
// not reach frozen Task/Run snapshots; this query never mutates CLI state.
async function loadModelCatalog({ provider, executable = null }, { environment = process.env, homeDirectory = homedir(), run = exec } = {}) {
  if (provider === "dsh") return dshModelCatalog();
  if (provider === "claude-code") return claudeCatalog({ environment, homeDirectory });
  if (provider === "codex") return codexCatalog(executable, { run });
  if(PORTABLE_RUNTIME_IDS.includes(provider))return portableCatalog(provider,executable,{environment,homeDirectory,run});
  throw new Error("provider 必须是已支持的 Runtime ID");
}

// Server-side per-model effort check for profile saves. Only models actually
// present in the real catalog are constrained; manual models and catalog
// outages leave capability unknown and must not invent rejections.
export function assertModelEffort(catalog, model, effort) {
  const entry = catalog?.models?.find(item => item.id === model);
  if (!entry) return;
  const levels = (entry.levels || []).map(level => typeof level === "string" ? level : level.id);
  if (!levels.includes(effort)) throw new Error(`模型 ${model} 不支持思考等级 ${effort}（该模型支持：${levels.join(" / ") || "无，请留空使用 CLI 默认"}）`);
}

// Only a digest of environment values is retained; never store or expose credentials.
const catalogs=new WeakMap();
export async function runtimeModelCatalog(input,{environment=process.env,homeDirectory=homedir(),run=exec,refresh=false}={}) {
  if(!RUNTIME_IDS.includes(input.provider))throw new Error('provider 必须是已支持的 Runtime ID');
  const provider=input.provider, config=environment.CODEX_HOME || join(homeDirectory,'.codex');
  const command=input.executable||RUNTIME_PROVIDERS[provider]?.command;
  let executable=isAbsolute(command)?command:null;
  if(!executable)for(const directory of (cliEnvironment(command,{}, {environment,homeDirectory}).PATH||'').split(delimiter)){try{const candidate=join(directory,command);await access(candidate,constants.X_OK);if((await stat(candidate)).isFile()){executable=candidate;break;}}catch{}}
  const nativeConfig=provider==='qwen'?join(environment.QWEN_HOME || join(homeDirectory,'.qwen'),'settings.json'):provider==='kimi'?join(environment.KIMI_CODE_HOME || join(homeDirectory,'.kimi-code'),'config.toml'):provider==='pi'?join(environment.PI_CODING_AGENT_DIR || join(homeDirectory,'.pi/agent'),'models.json'):null;
  const paths=[executable,nativeConfig,...(provider==='codex'?[join(config,'auth.json'),join(config,'config.toml')]:provider==='claude-code'?[join(environment.CLAUDE_CONFIG_DIR || join(homeDirectory,'.claude'),'settings.json')]:[])].filter(Boolean);
  const stamps=await Promise.all(paths.map(async path=>{try{const value=await stat(path,{bigint:true});return [path,String(value.ino),String(value.size),String(value.mtimeNs),String(value.ctimeNs)];}catch{return [path,'missing'];}}));
  const key=createHash('sha256').update(JSON.stringify([input,homeDirectory,stamps,Object.entries(environment).sort(([a],[b])=>a.localeCompare(b))])).digest('hex');
  let cache=catalogs.get(run);if(!cache)catalogs.set(run,cache=new Map());
  const old=cache.get(key);if(old && (old.pending || !refresh && old.expires>Date.now()))return structuredClone(await old.promise);
  const entry={pending:true,expires:0};entry.promise=loadModelCatalog(input,{environment,homeDirectory,run});cache.set(key,entry);
  while(cache.size>16)cache.delete(cache.keys().next().value);
  try{const result=await entry.promise;entry.pending=false;entry.expires=Date.now()+30000;return structuredClone(result);}catch(error){if(cache.get(key)===entry)cache.delete(key);throw error;}
}
