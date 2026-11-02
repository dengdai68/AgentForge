# ai-minions 插件兼容修复

## 结果与边界

复现来源为本机未修改的 ai-minions 检出，HEAD a0fe0c0d。225 份组件 Markdown 中两份 nyx-build 描述包含未加引号的 `Triggers on:`，导致严格 YAML 解析失败；已安装目录的兼容性重算把异常传播到整个 GET marketplace，YAMLException 同时携带源缓冲区。

现在只针对导致映射错误的顶层单行字面 description 做安全字符串编码；其他结构错误与未知标签仍拒绝。原始 source、副本安装树及正文不改写，Native 调用需要时才复制插件到私有 Trace 并规范化元信息，支持文件保留。格式错误以对应插件的不兼容原因呈现，错误只含相对组件位置，不包含原始 YAML 缓冲区或完整提示。

执行计划 v3 对非 Claude Runtime 的已知 opus/sonnet/haiku 别名继承目标 Runtime 配置模型，保留 sourceModel；不声称运行同一个 Claude 模型。DeepSeek 可使用插件现成的完整 Codex 方言；原生 Skill/提问与 Codex 委派工具名称同步。Store 接受新引用并校验目标和摘要；既有 v2 引用按原规则验摘要，不升级历史 Task/Run。

CLI 命令、输入 schema 和引用输出保持原协议，help/文档同步自动适配及错误可见性；未增加转换参数。

## 验证

- `npm test` 最终 593 pass / 0 fail；日志 `/private/tmp/agentforge-minions-tests-pass.log`。AI、模块影响、规定语法与 diff 检查通过。
- `AGENTFORGE_AI_MINIONS_REAL=1 AGENTFORGE_AI_MINIONS_SOURCE=… node scripts/test-ai-minions-real.mjs`：26 个插件、78 个插件/Runtime 组合全部导入、解析及严格原生 YAML 投影通过。三个真实 Runtime 均读取原始 nyx-build，并调用来源内独立分析子代理返回隔离 JS 文件中的随机常数；检查原生子代理生命周期和源摘要，检出 Git 状态不变。
- 实测版本：Claude Code 2.1.310、Codex 0.164.0、DeepSeek Harness 0.2.1-rc.2。实际源证据 `.data/ai-minions-real-nfzqXv/evidence.json`。
- `AGENTFORGE_PLUGIN_RUNTIMES_REAL=1 node scripts/test-plugin-runtimes-real.mjs` 六组全部通过，覆盖原生 Skill、独立子代理、command Hook 与 stdio/HTTP/SSE MCP。证据 `.data/plugin-runtimes-real-n96GG1/evidence.json`，日志 `/private/tmp/agentforge-minions-matrix.log`。
- `AGENTFORGE_DSH_REAL=1 node scripts/test-dsh-real.mjs` 真实沟通及完整任务、澄清、交接、可见人类确认、归档与完成后经理答疑通过。证据 `.data/dsh-real-wGu0PF/evidence.json`，日志 `/private/tmp/agentforge-minions-lifecycle-final.log`。
- 上述相对证据目录均位于 `/private/tmp/agentforge-beta102-verification-path` 指向的可丢弃检出；未提交截图、日志、会话或源插件内容。
- 安装包 `package:mac:check` 全部通过；额外用实际包内 ASAR 模块及内置 Electron Node 为三个 Runtime 生成合法 YAML，源摘要不变。另覆盖签名篡改拒绝、认证、CLI、MCP、任务确认、窗口与重置隔离；证据 `.data/packaged-electron-e2e-7qilgl`，日志 `/private/tmp/agentforge-minions-packaged.log`。

## 失败记录

初次全量回归发现 Store 尚只接受旧计划版本，导致新引用绑定被拒；已补齐 v3 校验并增加成功/错误目标/摘要/方言回归，重新跑完整真实任务和最终全量测试。旧双清单测试仍期待 DeepSeek 继承 Claude Hook，与新完整 Codex 方言选择不符；已同步预期。CLI 帮助断言补上终端换行处理。失败日志保留，未用失败运行宣称通过。

## 安装与限制

已安装到 `/Applications/AgentForge.app`，本机版本仍为 0.1.2，严格签名验证通过。ASAR SHA-256：86ce50ed95e8361d9dda19f8e7ca2f1cc79c34cae64992600176ef2cc6561a25。回退包在 `/Applications/.AgentForge-minions-compat-8c31db04770e426d9e458860799d4f7a/Previous-AgentForge.app`。

重启后通过真实客户端查看插件市场，现有 16 项正常加载；正式只读接口核对 17 个 Task/Run 的状态、消息摘要及插件 ID 清单与安装前一致。

兼容验证覆盖导入、原生投影及实际加载/调用机制，未执行业务部署或向公司服务上传 transcript；ai-minions 的业务 Hook 配置已解析/投影，其执行机制由隔离合成 Hook 验证。外部服务、账号和具体业务成果仍需各业务自己的验收。本轮为本机修复，GitHub 已发布的 v0.1.2 不包含此后续改动。

后续按用户要求准备 v0.1.3-beta.1 预发布测试包，包含本修复及下载进度同行展示，沿用既有 Beta 签名与安装约束；实际发布和安装结果以同名 Release 与交付核验为准。
