# 市场卡片与逐 Runtime 兼容验证

用户确认本轮验证兼容机制和实际加载/调用，不逐一执行 16 个插件的完整视频生成、翻译或配音业务。

## 改动

插件/MCP 卡片移除 Runtime 支持标签，只保留名称、说明、版本/ID 和详情。详细兼容信息、员工选择校验与服务端校验保留。此为展示修改，CLI 命令、参数、输出、help/schema 和 HTTP 协议均不改变；已核对，无需新增 CLI 字段。

新增 scripts/test-plugin-runtimes-real.mjs：Claude Code/Codex 两类源 × 全部三种 Runtime；每个组合实际读取原生 Skill、启动独立校验和子代理、执行 command Hook，并调用 stdio/HTTP/SSE 三种 MCP。验证随机挑战的 SHA-256、实际文件、子代理生命周期、Hook 日志与 MCP 服务端调用事实，不能用总结或支持标签代替。脚本枚举与 Runtime 设置类型一致性校验；新增 Runtime 未加入实测时直接失败。

## 结果

| Runtime | Claude Code 来源 | Codex 来源 | 三种 MCP 传输 |
| --- | --- | --- | --- |
| Claude Code 2.1.310 | PASS | PASS | PASS |
| Codex 0.164.0 | PASS | PASS | PASS |
| DeepSeek Harness 0.2.1-rc.2 | PASS | PASS | PASS |

六组真实模型调用全部通过，18 个来源/Runtime/传输组合全部覆盖。成功证据：/var/folders/0v/30ygv3yd2fs9212mqrvq37t40000gn/T/agentforge-beta102-verification-03cen7_y/.data/plugin-runtimes-real-uMRZ19/evidence.json；每组有独立目录、proof.json、reviewer-proof.json、hook-proof.jsonl、mcp-proof.log、events.json 及 Trace。运行命令：AGENTFORGE_PLUGIN_RUNTIMES_REAL=1 node scripts/test-plugin-runtimes-real.mjs。

界面 scripts/test-brand-presentation.mjs 的源码与打包版验收均通过，覆盖 1320/760px、minimal/warm 两主题、卡片无 Runtime 标签、版本/ID、详情、空态与对比度；目录分别为 .data/brand-presentation-DoCGtn 和 .data/brand-presentation-YuuYF6。

npm test：585 pass / 0 fail；check:ai、check:impact、规定 node --check、git diff --check 通过。

## 失败记录和边界

首轮临时检出继承到旧 Claude Code 2.1.216，缺少系统快照参数；验证脚本改为使用与桌面相同的账号登录 Shell 环境，并记录实际路径/版本，未改动或升级全局 CLI。首轮日志 /private/tmp/af-market-runtime-matrix.log 保留。

最初的固定标记 reviewer 测例在 DeepSeek 的 Codex 来源下出现重复委派或自行给出评语，均记为失败；核对隔离原生会话，子代理确实收到自己的系统正文、未继承父员工应用指令。改用更可核验的独立文件校验和工作，限定 Read/Bash 工具，要求子代理真实计算并写出挑战结果；未改生产 Runtime 或放宽通过条件。中间失败日志 /private/tmp/af-market-runtime-matrix-second.log 保留，最终六组结果在 /private/tmp/af-market-runtime-matrix-third.log。

本轮验证的是可移植组件/传输机制；不代表所有业务插件、外部 API 账号或所有模型都已完成业务验收。

## 安装和实机复核

已安装 /Applications/AgentForge.app（版本保持 0.1.1）；codesign --verify --deep --strict 通过。ASAR SHA-256：b376650ce47a2d7d5ff586ee7a8dd3cf1740581679ec2b6dfc1d7e91bdca2ea2。

通过真实客户端查看插件与 MCP 市场，卡片已无 Runtime 支持标签；详情仍可查。安装前后 17 个任务/Run 的状态和消息 SHA-256 一致，无业务记录变化。安装前快照 /private/tmp/af-market-cards-before.json。
