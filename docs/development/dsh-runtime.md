# DSH Runtime 本机交付记录

## 结果与范围

2026-11-01，接入官方 DeepSeek Harness（本机 `dsh 0.2.1-rc.2`），增加唯一 DSH Runtime 槽位、可用开关、原生模型目录与逐模型思考等级。员工配置、沟通、任务、原生会话续接、角色指令、Skill、MCP、平台历史工具和 CLI 同步。契约及实现决策见 `docs/25-dsh-runtime.md`。

没有新依赖，没有发布、推送或修改 GitHub Release。保留此前更新页面的未提交修改。本机安装仍标为 0.1.1；本轮源码未提交。

## 验证

- `npm test`：573 pass / 0 fail；`/private/tmp/agentforge-dsh-final-tests.log`。
- `npm run check:ai`、`npm run check:impact`、规定四个 `node --check`、`git diff --check` 通过；impact 核对 64 个变更文件（写入本交付记录之前）。
- 打包回归 `AGENTFORGE_PACKAGED_APP=… npm run package:mac:check` 通过，覆盖认证、CLI、文件边界、三类固定 Runtime、窗口关闭/菜单栏与任务确认等；日志 `/private/tmp/agentforge-dsh-packaged-regression.log`。该回归早于最后的员工选择器修正和原生系统指令审计；最终真实打包验证覆盖这两项改动。
- 最终真实模型验证：`AGENTFORGE_DSH_REAL=1 AGENTFORGE_DSH_APP=… node scripts/test-dsh-real.mjs`，使用隔离 HOME/数据目录。通过真实模型目录、CLI、两种主题与宽窄布局、员工 UI 选择 DSH/角色/Skill/MCP、沟通、经理澄清与精确回复、原生 Skill/MCP/历史工具、角色冻结、会话续接、可见人类确认和归档。模型返回文件的随机探针内容与实际工具调用独立核对。原生系统指令已传入，最终角色探针遵循。
- 最终证据：临时验证目录 `.data/dsh-real-uF8iEi/evidence.json`，位于 `/private/var/folders/0v/30ygv3yd2fs9212mqrvq37t40000gn/T/agentforge-beta102-verification-03cen7_y`；运行日志 `/private/tmp/agentforge-dsh-packaged-real-final.log`。仅保留本地，不提交数据、截图和日志。

## 发现与修复

- Store 原先只允许 Claude/Codex 的原生会话确认；补齐 DSH 绑定，真实经理续接已验证。
- 已安装 DSH MCP SDK 的 `console.debug` 污染 JSON-RPC stdout；调用内原生 bridge 将该诊断送 stderr，工具子进程 stdout 保持原语义，不跳过无效协议帧。
- 员工创建 Provider 列表的变量引用错误已修正；最终真实测试实际通过员工 UI 创建 DSH 员工。
- 一次真实模型输出遗漏角色标记；核对冻结内容与私有指令后，增加原生 system/message 的布尔审计证明，区分“已传入”与“已遵循”，不保存系统消息正文。失败样本 `.data/dsh-real-IkK62b` 保留；最终样本两项均通过。
- 本机 Node 冷启动实测约 2.3 秒，既有 Claude 后台工作测试的 2 秒阈值产生假失败；测试改为 5 秒阈值/5.5 秒原生等待，保留等待跨越阈值的验证。独立重跑 5/5 通过，最终全量 573/573；产品超时没有调整。
- 一次构建因本地磁盘不足签名失败；清理本轮自建的可重建临时构建产物后重新打包、验签成功，未清理操作者数据。

## 安装落地

最终候选及安装后的签名验证通过；24 个变更资源与源码逐字节一致。`app.asar` SHA-256：`fbdd84e5bec714adc8a19589f93fa83f644187f3fdcd414a755bd60cbcce3f9d`。

确认真实服务没有执行中任务、没有待投递沟通后，正常退出并替换 `/Applications/AgentForge.app`；原安装保留在本轮安装暂存目录的 `Previous-AgentForge.app`。重新启动后仍为原登录用户、17 个任务，原视频任务 `task_33f8dd86-9bac-4a12-9b99-1d70706c32d5` 仍待人类验收。未重置真实实例或更改原任务状态。

实际客户端已核对三类 Runtime、DSH 折叠展开、模型/思考等级配置及真实模型下拉。安装后的 `agentforge runtimes list` 与 `agentforge runtimes models dsh` 通过默认客户端授权读取成功。最后截图因系统捕捉错误未取得；此前隔离打包版的两主题宽窄截图及本机安装后可访问性界面核验已完成。

## 限制

- 当前接入 DSH 内置 DeepSeek API Key/账号路由，不自动导入自定义 pi-ai 路由；凭据由 DSH 自己读取，应用不复制解析密钥。
- DSH 支持本轮选定的原生 Skill/MCP；Claude/Codex 的 Hook、Subagent 等扩展不宣称兼容。旧市场不可变版本需重新导入/编辑才有 DSH 兼容声明，不改写历史冻结事实。
- stdio MCP 已真实验证；远程 HTTP/SSE 复用既有启动器，本轮未另外连接真实远程 MCP 服务。
- 指令真实传入不保证模型逐条遵循；原生会话历史依然保留，角色编辑不清除过去影响。DSH 当前为已安装的 RC 版本，未来 SDK 协议变化须重新验证。

## 全名与安装可用性补充

按后续反馈，界面、CLI、错误信息和当前契约统一展示 **DeepSeek Harness**；Provider、命令、环境变量和原生协议标识保持 `dsh` / `DSH_*`。CLI 同时接受固定 Runtime 的完整展示名称。

服务注入与实际执行相同 PATH 的只读安装检查，Store 返回 `installed` 和实际 `enabled`：找不到可执行文件时开关关闭、显示“未安装”并锁定，HTTP/CLI 拒绝修改开关及新调用。模型配置可离线保存；安装判断不读取凭据、不启动 CLI、不改写原有启用偏好或冻结快照。已安装但未登录仍需通过连接测试区分。

最终验证：`npm test` **576 pass / 0 fail**，规定门禁全部通过。源码隔离 UI 验证 `.data/runtime-settings-XnD3cs`、最终打包 UI 验证临时目录 `.data/runtime-settings-EnPMIx`，分别覆盖两主题、1320/760 宽度、完整名称、未安装锁定、API/CLI 拒绝、安装后可操作、移除后重新锁定及不执行探测脚本。最终真实打包模型任务 `.data/dsh-real-PtdT1D` 通过沟通、员工 UI、澄清、Skill/MCP/历史、原生指令传入、冻结快照、人类确认及归档。打包验证目录仍为本记录上文的 `agentforge-beta102-verification-03cen7_y`；新日志 `/private/tmp/agentforge-runtime-missing-packaged.log`、`/private/tmp/agentforge-runtime-name-real-packaged.log`、`/private/tmp/agentforge-runtime-label-install-tests-final.log`。

最终安装包 25 个变更资源与源码字节一致并通过签名验证，ASAR SHA-256：`85f5113b29ba7fa9d82fe88c717107e4436a6e3baa3c3ef0e546a7f793b3c707`。已正常退出空闲实例并安装到 `/Applications/AgentForge.app`，仍为本地 0.1.1，无推送或 Release 发布；原应用保留在 `/Applications/.AgentForge-runtimeavailability-0a9f718079a34e0fa355e8d5eb699341/Previous-AgentForge.app`。安装前真实实例 17 个任务、无执行中任务及待投递沟通；用户在本轮期间自行验收了视频任务，安装不改变该事实。

重启后实际客户端 Runtime 页已显示完整 DeepSeek Harness 名称；安装后的 `agentforge runtimes get 'DeepSeek Harness' --json` 回读成功。真实实例仍有 17 个任务，视频任务仍为用户已确认完成状态。当前三类 Runtime 在本机均已安装，因此三个开关可操作；缺失与移除场景由上述隔离安装验证覆盖，没有改动操作者的 Runtime 安装。
