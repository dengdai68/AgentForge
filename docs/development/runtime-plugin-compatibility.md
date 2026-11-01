# 源标准插件兼容交付

本轮目标：用户只导入一次 Claude Code/Codex 插件，Runtime 按源标准生成原生执行计划；当前安装无需逐个重装。边界、依赖和明确拒绝项以 docs/26 为准，不承诺未知 Provider 专有功能自动等价。

## 实现

- 新安装保留未改写的 source 副本；兼容性从实际安装文件派生，不依赖旧 providers。新绑定冻结 planTarget/sourceDialect/planSha256 与源摘要，不存提示词或 Hook 命令进领域引用。旧 Task/Run 快照不升级。
- DeepSeek Harness：独立原生 Session 子代理、源系统正文、继承模型与工具选择；使用核对 npm SHA-512 且逐字节一致的 MIT 官方 0.2.1-rc.2 Hook 桥。动态未映射输出失败，不以警告后省略当支持。
- Codex：合法隔离原生别名保留源名称描述；原生 SubagentStart/PreToolUse 对源子代理执行工具选择，优先使用 agent_id。跨调用按冻结角色映射处理；父员工及其他子代理不受影响。
- MCP：三种 Runtime 共用私有完整性启动器，保留源服务名/cwd/env_vars/stdio/SSE/HTTP；历史命名投影保留。
- 统一安全 YAML 元信息解析和组件合并，避免旧安装在新增 Runtime 后重复显示同一 Skill。
- 控制台普通 Markdown 去掉内层纵向滚动，保留列表编号空间及代码/表格横向滚动。
- CLI 复核：命令、参数与输入 schema 不新增转换选项；list/get、员工解析共用 HTTP 当前兼容矩阵，help/notes/docs 同步。

## 已执行验证

- npm test：585 pass / 0 fail（最终回归日志 /private/tmp/af-source-standard-install-regression.log）。
- check:ai、check:impact、规定 node --check、git diff --check 通过。
- 真实 Claude/Codex 源插件在 DeepSeek Harness 独立子代理与 command Hook 调用通过；Hook 拒绝测试确实未创建 canary 文件。
- 完整真实团队任务含 Skill、MCP、历史工具、独立 reviewer、人类澄清、交接、可见人类确认和归档：隔离源码 .data/dsh-real-ceWl48；打包版 Codex 源 .data/dsh-real-cdwuTS；最终 DeepSeek 打包执行 .data/dsh-real-hNTsok。这些目录均在 /private/tmp/agentforge-beta102-verification-path 指向的可丢弃检出下。
- 最终打包版 Codex 子代理工具拒绝：/private/tmp/af-source-standard-packaged-codex-final.log，真实 apply_patch 被拒、canary 不存在，子代理正常交回；该日志首行给出完整私有证据目录。
- Claude Code 的源 reviewer 与带 cwd/env_vars 的 MCP 实际调用：/private/tmp/af-source-standard-claude-native-second.log。
- 窄/宽、minimal/warm 两主题的实际 Electron Markdown 排版通过：scripts/test-console-layout.mjs；源码 .data/console-layout-5lxcss、打包 .data/console-layout-36BbG8，均有 PNG 与 evidence.json。

## 验证过程中修正/限制

- 发现 Codex -c 带引号键会把引号作为名称；改为合法小写唯一别名，并通过真实原生调用核验。
- 发现 Codex 子代理 Hook 的 session_id 保留根会话，必须使用 agent_id；反向执行验证后修正，未把首次未阻止 canary 的运行当通过。
- 首次打包 reviewer 将结构复核扩大为 MCP/历史重新验值，返回失败；收紧测试角色的复核标准后重新跑完整任务通过，保留失败证据。
- 首次独立 Claude 探针误从 finalPath 取结果（适配器返回 finalText）；修正验证脚本后实际调用通过。
- 旧 test-electron 全套展示脚本仍含已废弃的强制 @ 和顶部失败横幅断言，另有历史分页/滚动假设；本轮未声称该全套通过，探索修改已撤回，使用新增的聚焦真实界面脚本验收本轮排版。
- 源模型固定到其他 Provider、动态 Command 预处理、未映射 Hook 字段/事件明确拒绝；DeepSeek 原生扩展桥须匹配 0.2.1-rc.2。纯 Skill 不受 Hook 桥版本限制。支持标签是静态兼容，不代表模型一定遵循指令或外部依赖已就绪。

## 本机审阅

已通过正式只读接口对比：17 个任务/Run 的状态与 Messages SHA-256 一致；16 插件、2 MCP 均重新识别 DeepSeek Harness 支持。实际客户端查看了市场与带 reviewer 的插件详情；发现旧组件重复后增加回归并修正。最终实机详情为 Skill 1 / Subagent 1 / Hook 0，每项均合并显示 Claude Code / Codex / DeepSeek Harness，无重复 Skill。原视频 run_mvw97nan_3 的实际控制台也已目检：编号完整、普通正文无内层纵向滚动条；代码块保留横向滚动。

安装：/Applications/AgentForge.app，版本保持 0.1.1，本地 ad-hoc 签名校验通过；ASAR SHA-256 746250fec55539b7fc6cac6f13946fd3f7d41855a791f31c2d67e99c5c1a8f67。回退副本 /Applications/.AgentForge-source-standard-eb405dc8209d48eda4ee4ca1f9a20bf7/Previous-AgentForge.app。最终只读核对记录 /private/tmp/af-source-standard-installed-final-review.json；17 个任务/Run 的状态与消息摘要均未改变。
