# Runtime 恢复状态与配置界面修正

结果与范围：MCP 卡片移除无业务意义的安装短 ID，关联 ID/详情操作仍保留；员工系统提示词和角色共用提示词的创建/编辑区域默认八行。修复原生 CLI 已恢复却仍将旧错误作为最终状态的根因，不新增重试、不替换真实凭据、不重写历史事件或冻结配置。

事实与实现：

- 本机客户端实际查看，MCP 卡片在说明后显示安装 ID 的前八位；两个提示词 textarea 未指定 rows，实际约两行。现仅显示真实插件版本，不把 ID 当版本；两个提示词采用 rows=8。
- local-cli 原来以 ||= 留住首次错误，Codex 还把它扩散至后续所有普通输出的 presentation/message。隔离原生 JSONL 用例实际复现先 401、后成功但仍报 401，以及后续 503 被早期 401 遮盖。
- 仅在明确原生成功完成且 CLI exit=0 后，早期错误不再决定最终结算；无完成、非零退出、后续新失败仍失败，保留最新失败原因。Codex 只给真实错误事件标记 error，后续正文保持自己的展示类型。Claude is_error=true 即使 subtype=success 仍认定失败，并保留 result 中的错误原因。
- Runtime 对配置和凭据的读取方式不变；已运行进程不热替换凭据，后续调用按现有配置启动。恢复以实际成功为准，不因用户编辑配置而伪造健康状态。
- CLI 的配置输入、资源 ID、输出与帮助未变；市场卡片属于客户端布局，Runtime 结算修正经同一执行链自然适用于任务/沟通与 CLI 查询，无需新增 CLI 参数。

验证：

- npm test：608 pass / 0 fail。新增八项原生流用例分别覆盖 Claude/Codex 恢复成功、无完成、非零退出、成功后新失败；修改前失败、修改后通过，保留已有分类错误和工具失败回归。
- check:ai、check:impact、规定四项 node --check 与 git diff --check 通过。
- node scripts/test-roles-ui.mjs：源码 .data/roles-ui-gBDlRn；安装包模式 AGENTFORGE_ROLES_APP=.data/config-presentation-build/mac-arm64/AgentForge.app：.data/roles-ui-FpWrfO。验证八行实际可见内容、两主题/宽窄员工表单、MCP 无短 ID、绑定编辑及真实认证 CLI 数组读写。
- AGENTFORGE_PACKAGED_APP=.data/config-presentation-build/mac-arm64/AgentForge.app node scripts/test-packaged-electron.mjs：.data/packaged-electron-e2e-guZGu3，安装包生命周期验收通过。
- AGENTFORGE_DIRECT_COMMUNICATION_REAL=1 node scripts/test-communication-direct-real.mjs：.data/direct-communication-real-Im3CZu，Claude Code/Codex/DeepSeek Harness 三种真实原生会话续接及 reply-only 沟通通过。
- 使用 loadLoginShellEnvironment 后运行 AGENTFORGE_PROMPT_E2E_REAL=1 AGENTFORGE_PROMPT_E2E_TASK_ONLY=1 的 test-prompt-e2e：.data/prompt-e2e-tsUmLx，真实代码实现、独立测试八项、精确澄清阻塞、界面人类确认及历史答疑完成。原脚本在后续精确窗口尺寸截图等待超时，报告原样保留为 FAIL，不声称整脚本通过；补充脚本 /private/tmp/af-recovery-task-supplement.mjs 在同一隔离实例核对已完成事实、760×650 窄窗、归档只读及真实启动失败仍在控制台显示，supplement-evidence.json 为 PASS。补充过程中将陈旧 ENOENT 文案匹配改为实际 Shell not found/exit=127 错误，并接受已归档的明确拒绝，未重新调用模型或改造真实任务。
- 首次真实任务启动曾因测试 Shell 选中旧 Claude CLI 不支持 --system-prompt-snapshot 失败；改用与客户端一致的登录 Shell 环境后执行上述新隔离实例。没有更改全局 CLI 或登录配置。

以上 .data 证据位于本机 disposable verification checkout，由 /private/tmp/agentforge-beta102-verification-path 定位；日志、数据库、截图及凭据未提交。鉴权错误恢复由受控原生流复现，没有人为失效或替换操作者真实 Token；真实模型回归验证正常链路，不将夹具冒充真实鉴权服务。

安装准备：打包资源的 123 个源码文件摘要一致、版本与签名验证通过；首次完整暂存遇到磁盘空间不足，已仅移除本轮未完成暂存并改用同卷克隆，保留原安装及回退副本。不自动发布 GitHub 新版本。
