# 本机 Runtime

执行文件记录不再限定 docs/repos：工作流给交付位置建议，Orchestrator 经 Run Files 记录各业务路径有限快照并保留诊断；目录与CHANGE直接观察普通工作文件，大媒体不因快照/预览上限被漏列。不改变员工本机权限、冻结历史或原生会话。

插件默认每2分钟跟踪 Git 提交（设置 → 插件更新可开关、配置1–1440整数分钟周期或立即检查）；固定 sha 不追随 HEAD，ref 保持原选择，外部市场根提交未变时仍检查其未固定依赖。自动安装不执行脚本、只替换当前已安装插件，不自动启用/更新 MCP。当前员工使用新版本，冻结工作继续使用旧文件；更新后的受信任插件仍可能在后续执行中运行 Hook，不是沙箱。

MCP 可在详情或 CLI 编辑：新配置仍经过原安装校验及 Runtime 兼容校验，当前员工统一转到新版本，已冻结执行继续读取原始不可变文件。普通读取始终脱敏；相同 JSON 位置未修改的脱敏值保存时保留原值，删除字段清除，不把占位符当作鉴权值。

所选 Skill 交给 Runtime 原生发现和按需激活，不再通过“已配置技能文件”指令逐一读取。Claude 保留所选 --plugin-dir，开启原生 Skill 并排除宿主设置；Codex 有所选 Skill 时使用调用独占 App Server 注册精确额外根，原生发现后用线程级 skills.config 仅启用选中路径。无 Skill 的 exec 与原生传输共用 thread 身份；失败不回退为提示词读文件。Provider 自动生成的技能/工具目录不属于平台提示词快照。历史 MCP 的目录/schema/分页由服务定义提供，应用仅保留历史核对原则。

Codex 平台历史 MCP 使用 Bridge 提供的完整子进程环境；打包版必须向该 MCP 的 env 显式传 ELECTRON_RUN_AS_NODE=1，不能依靠 Provider 继承（Provider 环境会移除此标记）。历史 MCP 设置 required=true，无法初始化时由 Codex 中止启动/续接并进入原有失败诊断，不静默省略工具。无需用户另装 Node 或手工加历史 MCP，不修改全局配置。

提示词快照完整保留并展示脱敏后的系统指令与本轮输入，下方标记已确认原生会话 ID；未确认 Codex 占位 ID 不冒充原生 ID。控制台不显示重复范围说明和工具审计详情，不改变实际 Provider 指令分层。Codex 同一调用的完成阶段不重复保存已记录输入，首次在完成阶段出现或改变的参数仍保留，web_search action 亦保留；原始诊断不删改。

沟通同样保存脱敏公开 text/thinking/tools 和实际调用的 promptSnapshot，事件只持文件引用。内容位于 `communications/<会话ID>/.agentforge/<投递ID>/<尝试>/`，与附件分开；原生会话 ID 仅绑定到 Store 的投递尝试元数据，不进入通用审计。读取先验证会话/事件归属，再校验 SHA-256/字节；历史没有内容时不补造。

插件来源内部符号链接在安装时展开为普通文件/目录，保留内容、名称及可执行标记；范围限于传入的来源目录/所属 Git 仓库。断链、循环、越界和特殊文件给出插件名及相对路径，原子安装不发布部分结果；已安装副本仍拒绝链接、执行前仍核验完整性，见 docs/15。该兼容不执行来源脚本，不改变员工扩展隔离。

`server/runtime/local-cli.mjs` 适配 Claude Code 和 Codex CLI。连接配置、目录查询、环境与扩展加载由同目录模块负责；领域状态由 Store 和 Orchestrator 管理。

每次调用分离应用系统指令和当前输入：工作流仅经理、环境与可咨询成员目录进入系统层；原生会话保留历史，平台只投递新消息，不重放 transcript。Claude 追加系统文件并关闭旧快照，Codex 使用 developer_instructions；分层快照覆盖平台最终指令和输入，不包含 Provider 内部上下文。详见 [提示词组装](22-prompt-assembly.md)。

工作目录完整文件下载由 Run Files 与认证 HTTP 负责，不调用 Runtime；它复用文件预览的可见性检查，但流式返回完整字节，不使用预览截断。见 [文件读取边界](13-local-artifact-rendering.md)。

## 调用

扩展以完整插件版本和独立 MCP 版本冻结；员工仅选择 pluginIds/mcpIds。来源中全部 Claude/Codex 插件整批发布，自带 MCP 独立安装另选。Claude 显式插件目录加载；Codex 用原生 Subagent 配置及共同命令型 Hook 投影，专有事件明确不兼容。Skill 显式提供，Markdown Command 派生为可复用 Skill 说明，不执行斜杠预处理；MCP 支持 stdio/SSE/Streamable HTTP，远程桥接复用现有官方 SDK，不把鉴权或 Hook 原命令放进 Provider 参数、不写全局配置。不是沙箱，Provider 生命周期差异仍存在。完整契约见 [配置](15-employee-runtime-configuration.md)。

Claude/Codex 市场中的本地与 HTTPS Git 条目整批解析，按 ref/sha 检出并保留来源；npm/archive/command 尚不支持。两套 Runtime 清单和组件分别解析，Codex 显式空 Hook 不继承 Claude 默认 Hook；目录提供静态兼容性及具体原因，员工不能保存不兼容选择。stdio MCP 的 cwd/env_vars 经共用私有启动器在三种 Runtime 保留。配置根的正常祖先别名先归一实际路径，根/受管目录本身仍拒绝链接。

- 使用已安装并登录的本机 CLI，真实执行命令。
- 员工从 Run 工作根或绑定仓库启动；以本机用户权限运行，目录不是沙箱。
- 同一成员后续调用恢复已绑定的原生会话；不同成员会话独立。
- 模型与思考等级透传 Provider 对应参数；模型目录来源见员工配置文档。
- 平台接受普通文字交接，不要求 Provider 通过业务结果 Schema 验证。

## 记录

持久事件保存固定生命周期、进展、失败类别、工具状态及关联。Provider 原始 stdout/stderr 不作为业务交付事实。

执行正文、公开思考、工具输入输出先脱敏和限长，再保存到 Run Files；事件只持引用。提示词保存为 Trace 绑定快照，查看时按需读取。快照失败只记诊断，仍继续调用员工。

原生会话 ID 绑定到 Trace；控制台的会话创建、恢复和初始化消息据此展示。Codex 内部占位 ID 不冒充原生 ID。

## 文件

交付文件和执行记录位于独立存储。Artifact 保留 Trace、路径、SHA-256 和文件副本；文件读取关联与完整性检查保护展示，不参与业务质量评价。

## 失败与诊断

Provider 最终错误保留原始措辞、退出码、路径和可用 stderr，仅脱敏凭据与提示词，不再替换成“Provider 执行失败”。完整诊断、栈和进程输出仍写私有日志，设置提供路径。错误分类只控制重试，不替代错误正文。

仅明确临时故障（429、502/503/504、连接重置及临时 DNS 等）自动退避重试，单份投递最多共三次尝试；鉴权、缺 CLI、权限、参数、插件完整性和未知错误不自动重试。确认的原生会话丢失允许重建一次，连续丢失停止；取消/暂停仍遵循已有生命周期。业务失败通过已有人工恢复入口处理。平台五分钟巡检只继续到期的已有投递，不代表经理另派任务。

插件目录完整性校验仍包含全部安装文件，不忽略缓存或关闭哈希。失败报告实际路径及 expected/actual SHA256；Provider 环境设置 PYTHONDONTWRITEBYTECODE=1，避免继承环境的 Python 工具产生安装树字节码。此变量不是写保护或沙箱，程序仍可主动覆盖；已经被写入的真实安装目录不自动删除、修补或改写冻结哈希。

退出桌面会终止其自有执行进程；重启依据持久状态恢复或记录中断。不要把桌面关闭描述为后台离线运行保证。

控制台展示已保存的公开 thinking 正文；敏感片段仍过滤，首尾空白与换行规范化不标为脱敏。历史正文为空时明确说明“未保存可显示的思考正文”，不以“已脱敏”占位，不补造未公开或未保存内容。

### Claude 后台等待与平台空闲计时

Claude Code print/stream-json 可以在 result 之后等待后台命令、子代理、Monitor 或计划唤醒，再执行后续轮次。平台按原生后台任务生命周期区分等待与活动执行：有已知后台工作或成功轮次等待时，停止无进展计时；后续执行重新启用。仅活动轮次既无后台工作也无可审计进展时才报空闲超时。不能把首个 result 当最终交付，也不能因十分钟后台安静就取消 TTS。等待由原生 CLI 的后台生命周期和等待上限管理；保留人类暂停/终止、API 重试计时、非零退出与结构化失败。参见 [Claude 官方说明](https://code.claude.com/docs/en/headless#background-tasks-at-exit)。

DeepSeek Harness 接入使用本机 dsh sdk（实测 0.2.1-rc.2），系统/角色提示词通过原生 systemPrompt.section 注入，字面模板不插值；用户消息只承载当前输入。通过 session/prompt 入队并以 session/wait 等待原生托管后续执行，检查完成原因和进程退出，不在第一条 turn/end 提前结算。取消终止调用进程组；会话缺失、非 JSON、token 上限和 SDK 不兼容均如实失败。仅助手公开正文/思考及工具事件进入脱敏内容，system/user/request header 不倾倒。详见 docs/25。

Runtime 展示名称为 Claude Code、Codex、DeepSeek Harness，内部 Provider/CLI 命令仍为 claude-code/codex/dsh。服务通过与执行相同的 CLI 环境检查可执行文件（不运行模型、不读取凭据）；Store 注入该只读事实，在 list/get 返回 installed 和实际 enabled。未安装或客户端 PATH 找不到可执行文件时 enabled=false、界面开关关闭并锁定，HTTP/CLI 拒绝修改 enabled 和发起新调用；安装检查不改写用户开关偏好、员工或 Task 冻结事实。安装/PATH 修复后重开客户端或重新进入 Runtime 设置重新读取；已安装但未登录不属于未安装。

跨 Runtime 扩展按 docs/26 的源标准计划执行。私有 Trace 物化 DeepSeek 原生子代理/官方 Hook 桥，peer 解析锚定实际 dsh CLI，版本不匹配拒绝含这些组件的调用。纯 Skill 不依赖 Hook 桥版本。原始安装源与历史冻结引用不重写。

源插件计划 v3 与旧 v2 的冻结边界、模型/工具映射及原生 YAML 私有投影见 docs/26；真实 ai-minions 验收通过独立来源目录导入和三个真实 Runtime 调用，不修改操作者插件/任务。

插件导入的定义错误隔离详见 docs/26：原始源保留，错误组件排除在原生执行副本外，三种 Runtime 接收相同有效部分及各自方言配置；执行时不放宽摘要与冻结计划核验。
