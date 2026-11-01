# DeepSeek Harness Runtime 接入决策

## 协议和边界

DeepSeek Harness 为官方 Runtime，本轮验证版本 0.2.1-rc.2。使用本机 dsh sdk 的 JSON-RPC 协议，保持独立 Provider，不借用 Claude/Codex 适配器、不直接代替 Harness 调模型 API。设置增加唯一 dsh 槽位，可用开关及 model/effort；员工、CLI、任务/沟通共享该配置，冻结快照和人类确认语义保持不变。

适配入口 server/runtime/dsh.mjs；原生桥 server/runtime/dsh-plugin.mjs 只使用 Node 内置模块与 DeepSeek Harness 提供的 Cordis context，不新增依赖。打包后将桥源码写入 Trace 私有目录，外部 Node 不读取 ASAR。JSON 本身是有效 YAML，调用补丁用 JSON 序列化，避免自行拼接 YAML 或引入解析依赖。

每个原生会话使用 runtime-configs/dsh/会话ID 下的独立 DSH_HOME；只生成当前安装自带 SDK profile，不加载操作者全局/项目插件和默认 Skill 目录。DeepSeek Harness credentials-local 自己读取原 DSH_HOME（默认 ~/.dsh）的 .credentials.yaml，AgentForge 不解析、复制或展示密钥。配置协议只接入 DeepSeek Harness 内置 DeepSeek API Key/账号路由；用户自定义 pi-ai 路由没有自动导入。模型目录和逐模型思考等级由本机 DeepSeek Harness 服务报告；模型 ID 使用 Provider/模型ID，省略前缀为 deepseek-official。

## 指令、扩展与生命周期

应用/角色提示词通过原生 systemPrompt.section 进入 system-role；interpolate=false 保留业务文字中的模板花括号。输出 schema 是独立系统段，SDK 未提供原生 response_format；返回 JSON 仍由现有领域入口校验，非法输出失败，不把正文猜成成功。

选中 Skill 走原生 skill-filesystem，关闭默认目录；平台历史和市场 MCP 走原生 mcp-client，市场服务复用完整性校验启动器。所选插件如含不支持的 Hook/Subagent 等组件应明确不兼容，不能静默省略。扩展格式支持不代表账号或依赖已实测。当前协议安装按现有文件只读重算兼容性，无需重装；历史冻结版本不改。

session/prompt 仅确认入队；必须等 session/wait 完成托管子工作，检查最后 turn/end 和进程退出，再结算。会话由 Store 绑定，SDK 原生恢复不存在的会话时明确报错，不自行创建替代。公开助手正文/思考与工具事件进入原有脱敏内容投影，系统消息、用户回放、request/header 和签名不倾倒到控制台。取消终止整个调用进程组并等待退出。

## 依据

- https://github.com/deepseek-ai/deepseek-harness
- 官方已安装包 dsh-sdk-protocol、dsh-sdk-jsonrpc-server、dsh-system-prompt、dsh-credentials-local、dsh-skill-filesystem、dsh-mcp-client 的 README 与类型声明。

本轮状态与真实验证结果以交付说明为准；协议夹具不等于真实模型验收。

原生 SDK stdout 专用于 JSON-RPC。已安装 MCP SDK 的 console.debug 能力诊断由调用内 bridge 改送该 DeepSeek Harness 进程的 stderr；不忽略非 JSON 报文，也不向工具子进程继承任何日志重定向，业务命令 stdout 保持原语义。

DeepSeek Harness 原生 system/message 若包含本次完整应用系统指令，仅保留 systemPromptApplied=true 的审计事实，不保存原生系统正文。真实验证分别记录系统传入与模型回复的角色探针遵循情况；曾出现模型遗漏标记，不能把传入指令等同于逐条遵循。

Runtime 展示名称为 Claude Code、Codex、DeepSeek Harness，内部 Provider/CLI 命令仍为 claude-code/codex/dsh。服务通过与执行相同的 CLI 环境检查可执行文件（不运行模型、不读取凭据）；Store 注入该只读事实，在 list/get 返回 installed 和实际 enabled。未安装或客户端 PATH 找不到可执行文件时 enabled=false、界面开关关闭并锁定，HTTP/CLI 拒绝修改 enabled 和发起新调用；安装检查不改写用户开关偏好、员工或 Task 冻结事实。安装/PATH 修复后重开客户端或重新进入 Runtime 设置重新读取；已安装但未登录不属于未安装。

扩展支持更新见 docs/26：当前安装兼容性只读重算；原生 Skill、独立子代理 Session 和版本匹配的 Claude/Codex command Hook 桥按源标准执行。无法映射的字段/事件明确拒绝，旧冻结快照不升级。
