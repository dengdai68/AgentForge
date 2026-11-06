# CLI

核心管理能力与 App 对齐：员工搜索包含能力标签；团队支持启停；工作流依赖 dependsOn 与交接 handoffFrom 独立保存，交付定义为空时由 Store 补默认值。tasks create 接受 teamIds 与 memberAgentIds 并集，由 Store 展开可用团队中的 active 成员、去重并校验恰好一位经理；不保存团队绑定。验收标准省略或 [] 均为空，最多20条/每条500字符；不再使用任务优先级。create --start 显式创建并启动，失败输出 TASK_CREATED_START_FAILED 与 taskId，先查询状态勿重复创建。任务列表按更新/归档时间降序，未知状态拒绝。

`tasks list --workflow ID_OR_NAME` 支持精确 ID 或唯一的当前/任务冻结名称；歧义须用 ID，不存在明确报错。与 search/status/archived 组合后分页，摘要包含 workflow 的 ID 与任务冻结名称，不返回完整工作流配置。

任务失败人工恢复在客户端继续原失败员工的投递与会话；CLI 无恢复命令，不扩展操作权限。progress 保留累计 attempts/脱敏错误，协作查询保留失败及恢复事件。

任务从团队与员工 ID 合并成独立成员集合，必须恰好有一位可用项目经理；团队不拥有任务或群聊。领域规则见 [领域模型](../docs/03-domain-model.md)，CLI 输入输出见 [CLI 指南](../docs/21-configuration-cli.md)。

任务创建可传 teamIds 进行批量选人，持久化使用 memberAgentIds；移除 --team。团队 managerAgentId 废弃，成员可空；员工删除保留持久标记及历史。详情只输出成员 ID/名称引用，不包含员工提示词/扩展配置。长期群聊仍不属于 CLI 命令覆盖范围。

协作读模型仅返回员工、经理、人类之间的沟通消息；关联投递与执行元数据保留，系统事件不再单独生成记录行。sourceMessageId 关联同 Run 消息，不按正文或时间猜测历史。startMessageId 对应 Trace.inputMessageId，用于定位本轮提示词；完整执行事实和文件仍由控制台与 artifacts 查询。

本仓库仅提供客户端。CLI 配置/任务/auth 命令和参数不变，连接私有 endpoint，不提供服务器部署目标。

Runtime 外部故障立即保留脱敏原始错误并标记任务失败，禁止新消息；修复后在客户端重试原员工投递和会话，CLI 不新增恢复权限。只有确认的原生会话丢失允许重建一次；经理非终止安排仍尊重已有投递，验收后的协调跟进结算只保留审计事件。

工作流 artifactPaths 是规范工作目录相对文件/目录建议，可省略为空；任意业务根均可使用，不再强制docs。create/update/schema/帮助/文本标签同步；任务artifacts仍按实际不可变快照查询，大文件当前目录浏览/下载属于客户端，不新增CLI越权入口。

plugins 新增 updates（状态）、check-updates（立即请求异步检查）、auto-update --file settings.json（enabled布尔值和intervalMinutes整数分钟1–1440，至少一项，默认2）。帮助/schema/参数与认证HTTP、设置 → 更新 → 插件更新同步；更新回执只含插件ID/原ID/名称，不倾倒其他资源，检查不会创建任务或确认完成。CLI只访问客户端，Git网络由服务处理。沟通和任务控制台的默认选中仅为 UI 行为，不更改任务/协作命令。

MCP 新增 update ID --file patch.json，渐进帮助/schema 描述 name/description/content 部分更新、隐藏值保留与新版本回执。命令通过认证 PUT，不访问市场私有文件；省略 JSON 保留配置，成功后使用返回的新 ID。

pluginIds 仍选择完整插件：所选 Skill 原生注册、按需触发，不作为路径提示追加到应用系统指令；CLI 帮助/schema 同步此语义，输入字段和输出不变。内置历史工具通过 MCP tools/list 和服务说明提供能力，不在应用提示词重复工具清单。

员工扩展选择为空或省略时，不继承全局 MCP/插件或 Codex 账号 Apps；只加载所选服务与平台历史工具，保留 Runtime 基础文件/Shell 工具。`agents create/update --help` 和 schema 的 mcpIds 说明已同步；字段、输出与认证协议不变。普通资料和扩展选择变化不重建沟通原生会话，Runtime 连接变化另行记录。

员工 systemPrompt 作为 Runtime 的应用系统指令传递；完整工作流仅项目经理持有，执行环境及可咨询成员目录也属于应用系统指令。CLI 字段不新增，帮助/schema 已同步含义；任务消息和精确澄清仍走同一认证 HTTP。

CLI 仅连接运行中的客户端；源码/安装版统一通过私有 endpoint 发现、验证实例后才读取会话或发送凭据。不连接 Web、无 --target 或目标环境分支、不回退 4310；离线帮助/输入校验不访问服务。开发测试可指定 --endpoint-file。默认使用宿主发布的客户端授权；独立登录保存到 ~/.agentforge/cli-session.json，显式 --session-file 可隔离使用。

`plugins import` 同样支持来源目录/所属 Git 仓库内的文件与目录链接，安装为普通文件，中文/空格文件名不变；断链、循环、越界、特殊文件明确定位并整批回滚，操作帮助/schema 说明该语义。无新参数，不扩大员工选择或 Runtime 权限。

插件和 MCP 增加 `delete ID --yes`；帮助说明当前员工引用会阻止删除、冻结历史文件保留，插件与独立 MCP 不连带删除。搜索继续使用 `list --search 文本`，UI 布局不引入额外 CLI 协议。

`main.mjs` 处理命令；`commands.mjs` 定义帮助与 schema；`client.mjs` 负责认证 HTTP；`output.mjs` 渲染文本/JSON；`password.mjs` 隐藏终端密码输入。`agentforge` 是安装包内的 Electron Node 启动器。

`roles` 组管理员工可共用的纯文本提示词角色（list/get/create/update/delete，update 部分更新，delete 需 `--yes` 且被绑定时拒绝）；员工经 `agents create/update` 的 有序 `roleIds` 数组绑定多个角色，[] 全部解绑；旧 roleId 输入拒绝。角色文本并入应用系统/developer 指令，冻结任务保持原文本；语义详见 docs/03、22。


根帮助列命令组，操作帮助列字段，`--json` 返回机器输出。默认复用客户端授权；独立登录才持久保存 CLI 自己的会话。CLI 不读取浏览器 Cookie 或 SQLite。密码仅隐藏交互输入或显式 stdin，不作命令参数。

任务命令经过同一 HTTP；创建和启动分开，写入不自动重试。最终验收确认保留在 客户端。完整命令和失败语义见 [CLI 指南](../docs/21-configuration-cli.md)。

共享协作投影的颜色和界面状态码不进入 CLI 输出；`tasks collaboration` 保留状态文字，补充 dispatchId、recipientAgentId、workflowNodeId、executionTraceId、attempts、nextRetryAt、error 等投递关联字段；traceId 仍表示发言来源。

扩展按完整插件：`plugins import --file source.json` 直接整批安装 Git/本机目录中全部 Claude/Codex 插件；自带 MCP 拆分后仍由员工单独选择。`plugins get ID` 查组件，`mcps get ID` 查脱敏 JSON，stdio/SSE/Streamable HTTP 均支持。员工只写 pluginIds/mcpIds，创建和更新均可设置 active/inactive；操作帮助/schema 同步当前协议。

市场内相对目录和 HTTPS github/url/git-subdir 条目一起安装，保留 ref/sha；不支持的 npm/archive/command 整批报错。plugins list 只加 Runtime 摘要列，get 按需展开 compatibility/reasons，help/schema 说明静态兼容不等于真实调用已通过。含 cwd/env_vars 的 stdio MCP 只支持 Codex；员工选择与 UI/API 使用同一兼容性规则。

重复 plugins import 按同来源地址＋插件名称覆盖；mcps create（含插件拆分 MCP）按安装名称覆盖，去首尾空格并区分大小写。当前员工引用原子切换，冻结历史不变，不兼容时整批拒绝。输入参数保持；help/schema、文本覆盖计数及 JSON replacements/employees/historyRetained 回执同步。

Runtime 命令固定为 list/get/update/test/models，按 ID 或固定 Provider 引用，model/effort/enabled 为非空部分更新，旧 create/delete/名称/自定义 CLI 路径明确拒绝。默认优先验证并使用宿主发布的父会话关联凭证；显式 --session-file 隔离独立 CLI 登录。logout 只撤销独立会话，共享授权在客户端退出。见 docs/14、15、21。

DeepSeek Harness 是第三个固定 Runtime；runtimes list/get/update/test/models 均支持 dsh 引用，schema 含 DeepSeek Harness off/low/high/max 和模型 Provider/ID 说明。员工通过 profileId 绑定；不新增凭据或可执行路径输入。模型目录真实启动本机 SDK 但不调用模型生成；test --yes 才调用模型。

Runtime 展示名称为 Claude Code、Codex、DeepSeek Harness，内部 Provider/CLI 命令仍为 claude-code/codex/dsh。服务通过与执行相同的 CLI 环境检查可执行文件（不运行模型、不读取凭据）；Store 注入该只读事实，在 list/get 返回 installed 和实际 enabled。未安装或客户端 PATH 找不到可执行文件时 enabled=false、界面开关关闭并锁定，HTTP/CLI 拒绝修改 enabled 和发起新调用；安装检查不改写用户开关偏好、员工或 Task 冻结事实。安装/PATH 修复后重开客户端或重新进入 Runtime 设置重新读取；已安装但未登录不属于未安装。

tasks message 的 recipientAgentId 可省略，默认发给当前 Run 的项目经理；显式提供需为当前 Run 成员 ID。tasks reply 仍必须指定待答问题 ID，普通消息不会被猜成澄清回答；回执保留实际接收方。

插件/MCP 跨 Runtime 支持按源标准计划统一查询；既有安装无需重装，`plugins get` 可核对每种 Runtime 的当前原因。输入命令不新增兼容转换开关，MCP cwd/env_vars 在三种 Runtime 共用私有启动器，详见 docs/26。

插件导入/查询共享源标准 v3：已知 Claude 模型别名在其他 Runtime 继承目标模型；单行描述冒号在原生投影规范化，未知结构明确拒绝。某个已安装插件格式错误在该条兼容原因中显示，不阻塞全部列表；原始源和冻结任务不改写。命令、输入 schema 和引用输出不新增转换参数。

插件 import 的 warnings 明确列出跳过组件；文本 ⚠️、JSON 结构化结果和插件 get 共享相对路径/原因。路径或完整性失败仍拒绝批次。

员工 kind 只接受 business/manager，schema/help 移除 repository 与 developer；仓库说明放 systemPrompt。当前员工 get 不展示废弃仓库字段。普通沟通不属于 CLI 配置/任务命令，私聊/群聊输出协议没有新增 CLI 能力。

tasks collaboration 文本/JSON 仅返回角色沟通，包含 startMessageId；tasks message 指定员工直接送达，错误任务拒绝新消息。tasks progress 对 failed 优先提示在客户端重试原员工。帮助/schema 同步以上含义；本次不增加恢复命令，最终完成仍由客户端人类确认。

tasks progress 移除 openDefects；问题报告与处理反馈统一使用 tasks collaboration 查询、tasks message/reply 交接。帮助/schema 同步此读模型变化，不增加命令或确认权限。

automations 新增 list/get/create/update/delete/trigger/triggers；列表与触发历史按页查询，--all 显式逐页读取，配置字段与 App 弹窗一致。update 支持 enabled 开关，停用后可删除全部对应任务及触发历史；trigger 的失败/跳过回执不代表任务已启动。tasks list 仅普通任务；priority 已废弃，输入/schema/输出同步移除。

任务成员查询/修改使用 tasks members TASK_ID，写入附 --file，完整成员列表含经理；App 编辑与 CLI 共用 Store 的状态、忙碌成员、唯一经理校验。团队创建支持 status，默认 active。

tasks/automations create 的 workflowTemplateId 可省略、null 或空字符串；默认协作不会隐式选取目录模板。automations 输入移除 timeZone，按本机当地时间执行。tasks members 支持失败与待验收等非终结状态，仍保护经理和未结投递成员。

员工列表支持 --role ID_OR_NAME，与搜索组合后分页；精确 ID 优先，名称需唯一。App 采用同一角色目录与 roleIds 绑定关系。

自动化任务标题统一为 `自动化名称#yyyy-MM-dd HH:mm:ss`（当地时区、24 小时制；定时取计划时刻，手动取触发时刻）。触发列表首列展示真实任务标题；HTTP/CLI 的触发回执、列表和 latestTrigger 返回 taskTitle，未生成任务为 null；不重写历史任务名称。

并行任务不增加创建参数或开关：App/CLI 通过同一 HTTP 创建与启动，经理按任务指令批量分工。`tasks progress` 的 activeTraces/pendingDispatches 展示全部成员执行与队列；错误后仍有成员收尾时 nextAction 明示等待收尾后重试。`tasks terminate --yes` 停止全部成员，包含 failed 后仍在执行的成员；最终确认与重试仍在客户端。

任务草稿：tasks create 默认只保存完整任务（backlog），tasks start ID 显式执行，create --start 对齐 App「保存并开始」。列表 --status backlog、详情和删除沿用既有命令，不引入第二套 draft 状态或未完成字段协议。

插件/MCP 列表改为服务端搜索分页，--all 显式逐页收集；删除直达指定 ID，无需读取整个目录。plugins/mcps delete --yes 与 App 同为软删除＋全员工当前解绑，回执含受影响员工引用。

tasks message/reply 支持 JSON attachmentPaths/attachmentIds，CLI 保留二进制原字节，经同一认证 HTTP 上传、发送并返回引用；content 有附件时可空，最多10个/单文件20 MiB，具体字段见 schema。client.request 仅对 Buffer 使用 octet-stream，普通命令仍发送 JSON。

roles create/update 支持 extensionSelection，和 App 的角色插件/MCP选择一致；agents 返回 inheritedExtensionSelection 区分继承来源。automations delete ID --yes 仅接受停用自动化，删除全部对应任务和触发历史并先终止执行。
