# 领域模型

任务创建接受可选 teamIds 和 memberAgentIds；至少选一人或一个团队。Store 展开可用团队中的 active 成员，与显式员工合并去重，校验显式 managerAgentId 为最终员工集合中的一位可用员工；显式停用/删除员工、停用/不存在团队、数组内重复 ID 拒绝。teamIds 不持久化，不恢复旧 teamId 团队绑定。任务不再使用任务优先级，废弃字段明确拒绝；冻结事实和人类最终确认不变。

任务独立持有 `memberAgentIds` 与冻结员工快照，通过必填的 `managerAgentId` 从成员中指定唯一的本次经理；不再写入或接受 `teamId`。团队只是可空的员工集合，不绑定经理；在任务或群聊选团队时展开为员工 ID 并集，之后团队编辑/删除不影响已加入的成员。任务列表、详情和员工控制台不展示团队名称。新任务启动前拒绝已删除成员；在途 Run 继续使用原冻结成员完成执行，不重建会话或改写历史。

员工删除为 `status=deleted`、`deletedAt` 的持久标记，目录/选人/团队和群聊成员列表不再显示，禁止编辑和新投递；自动移除当前团队与独立群聊的成员引用，取消尚未执行的沟通投递并留审计。已运行沟通可以保存最后答复，但不再唤醒其他员工；正在执行的任务保留全部冻结成员继续完成。任务协作中的旧发言与控制台证据保留；员工 Tab 不列出已删除者。已删除员工不再阻止当前角色/扩展退役，冻结调用仍使用已保存的提示词/文件。

群聊使用 `kind=group`、独立 `name` 和 `memberAgentIds`；每次创建产生新会话，即使成员相同也不复用团队群。创建时可省略 name，由 Store 按所选员工姓名以中文逗号连接生成，之后不随成员变动自动改名；自定义名称仍限 1–100 字符。可修改名字与成员，添加团队仅批量加入员工。私聊继续按员工复用，已删除员工的私聊从列表隐藏，原历史不删除。旧团队会话保留原消息/会话 ID；读模型从已记录成员事实读取，显式编辑/删除团队或员工时脱离旧团队标识，保存独立成员，不进行全库迁移或重置。

私聊输出仍为严格 `{reply}`。独立群聊输出为 `{reply, mentionAgentIds}`，普通答复用空数组，确需其他员工回答时填当前可用成员 ID，正文中的 @ 不自动投递。所有成员消息公开保留，指定接收者只决定唤醒；没有转交/接棒概念。每条含明确 mentionAgentIds 的新消息都向对应员工入队，包括已参与或正在执行的员工；同一员工按 FIFO 串行处理，失败的队首等待人工重试或取消。完成回调按 deliveryId 幂等，rootMessageId 仅保留来源，不用于抑制后续消息。普通答复及致谢应使用空数组结束讨论。员工会话仍各自隔离，任务派工/咨询协议不变。

协作读模型仅返回员工、经理、人类之间的沟通消息；关联投递与执行元数据保留，系统事件不再单独生成记录行。sourceMessageId 关联同 Run 消息，不按正文或时间猜测历史。startMessageId 对应 Trace.inputMessageId，用于定位本轮提示词；完整执行事实和文件仍由控制台与 artifacts 查询。

重复手动导入按同一来源地址＋插件名称匹配插件，按安装名称（去首尾空格、区分大小写）匹配 MCP；不同来源的同名插件保留。成功以新不可变版本覆盖当前目录项，原子更新所有当前员工（含停用）的选择并合并重复引用；Task/Run、排队投递和历史文件不变。失败整批保留原目录及绑定，候选从当前目录退役。首次安装不自动绑定员工；已存在的重复项在下次同标识导入时一并替换，不做全库清理。响应增加 replacements（kind/id/previousId/name）、employees（仅 ID/名称）、historyRetained；原 plugins/mcps 或 MCP 摘要字段不变。

工作流 artifactPaths 是工作目录内建议交付位置（文件或目录），可为空，不再限定/补齐 docs。持久化与冻结配置保留原路径，不进行路径迁移或重置。当前文件/CHANGE覆盖所有普通业务路径，repos 仍可保留历史冻结检出或员工自行准备的仓库及初始提交关系；读取排除内部元数据、凭据和符号链接。执行快照记录各业务路径，仍受20MiB单文件与5000文件上限，快照失败不是员工执行权限或任务结论；大文件可在工作目录查看元数据并下载，不能冒充已保存不可变快照。

Store 保存 pluginAutoUpdate 开关（默认开启）与 pluginUpdateIntervalMinutes（默认2，整数1–1440），非空部分设置经过同一命令校验并记录 configuration.plugin_auto_update；按来源替换插件时核对员工 Runtime 未被并发编辑，原子更新当前选择者并退役旧目录版本，configuration.plugins_updated 的 actor 是系统插件更新而非人类。Task/Run/排队调用的冻结 manifest 与原始文件不改。关闭开关仅停止后续定时检查，已开始检查仍完成；退出本机服务不再检查。

MCP 编辑生成不可变新版本；Store.replaceMcpExtension 在一个事务中核对当前员工 Runtime 未被并发修改、更新所有当前选择者并退役旧版本，记录 configuration.mcp_updated。Task/Run/排队投递的冻结 manifest、原始私有文件及历史消息不改写；不兼容或配置冲突拒绝整次更新。新版本 ID 由回执提供，旧 ID 从当前目录退役。

沟通附件属于 Conversation，消息冻结 ID、名称、相对路径、字节和 SHA-256，引用只能来自同会话。CommunicationDelivery 每次 attempt 保存自己的原生会话绑定，ID 不进入通用审计事件；控制台投影实际投递/尝试，不创建 Task/Run。只有员工新回复计入未读，人类发送与 pending 均不计入。

任务默认工作根统一为 `~/.agentforge/workspace`，不分 Web/Desktop；配置与鉴权仍按实例隔离。新 taskId 使用 `task_<随机UUID>` 这一不透明引用，避免跨实例同毫秒任务共用目录；目录层次仍为 `<workspaceRoot>/tasks/<taskId>/<runId>`。目录分配使用不透明 ID，拒绝路径穿越；清除所有数据以整个当前工作目录为范围，工作目录外的文件保留。保存的工作根与已有任务/运行路径不变，不自动搬迁。

已安装插件/MCP 可由人类删除：认证 HTTP 验证安装 ID 后调用 Store `removeExtension`。当前员工（包括停用员工）仍选择该版本时拒绝，不隐式解除绑定；Store 同步拒绝删除后到达的过期绑定写入。`extensionRemovals` 与 `configuration.extension_deleted` 事件在同一事务持久化，目录与详情不再暴露已删项。不可变文件与冻结 Task/Run 不变，历史执行仍可核验/恢复；插件删除不连带删除独立 MCP。

插件安装版本是员工扩展的选择单位，包含完整 Skill/Subagent/Hook 文件与摘要。员工新配置只接受 `extensionSelection.pluginIds/mcpIds`，不接受 Skill ID 或私有 MCP JSON；扩展内部路径/摘要由服务解析并随任务冻结。安装插件不绑定员工，不把组件单独安装为员工可选资源。旧任务事实不重写，废弃输入明确拒绝。

角色（Role）提供名称、纯文本提示词及插件/MCP选择，是一组员工可共用的应用系统配置；不是员工类型、职责标签、工作流人员绑定或权限规则，不进入派工/选人逻辑。员工以有序、无重复的 `roleIds` 数组绑定零个或多个角色；`updateAgent` 省略保持不变，`[]` 解除全部绑定，null/重复/未知 ID 拒绝且不部分保存。每个角色的提示词按数组顺序加入应用系统/developer 指令，不自动消解冲突、不参与派工权限。Task 创建把整组 `roleSnapshots`（各 ID、名称和当时提示词）随员工/经理快照冻结，Run 再克隆；后续角色编辑、重排、解绑或删除不影响在途与历史任务。沟通在发送和显式重试时保存当时的整组角色；排队/历史投递不改写，角色变化不重建原生会话。任一当前员工（含停用）绑定的任何角色均拒绝删除，列出引用员工；解除绑定后可删除，冻结文本仍保留。当前写协议不再接受 `roleId`；已有非空旧员工绑定须在旧版本解除后升级或由操作者显式重新初始化配置，不自动迁移/清除真实实例。无绑定员工初始化为 `roleIds: []`。已有历史 `roleSnapshot` 作为冻结事实仍可原样读取和执行，不从当前角色补查。旧 `role` 遗留字段仍废弃。角色增删改记录 `configuration.role_created/role_updated/role_deleted` 审计事件。

一个来源整批发布多个插件版本；自带 MCP 拆为独立版本，仍需员工明确选择，不继承插件选择。员工 create/update 均可设置 active/inactive（默认 active）；停用不改变冻结任务和投递事实。

| 对象 | 含义 |
| --- | --- |
| Agent | 数字员工及当前运行配置 |
| Role | 共用提示词与插件/MCP选择，供员工按有序 roleIds 多选绑定 |
| Team | 可复用的数字员工集合 |
| Workflow | 节点、人员需求、自然语言交付及交接关系 |
| Task | 人类目标、独立成员和冻结配置 |
| Run | 一次任务执行与整体协调状态 |
| Dispatch | 持久化投递、尝试和重试安排 |
| Trace | 一次员工调用、原生会话和提示词引用 |
| Message | 带发送者、接收者和 conversationId 的协作消息 |
| Artifact | 绑定 Trace 的不可变文件快照元数据 |
| Decision | 员工记录的决定 |
| Event | 生命周期与执行审计事实 |

## 当前协作协议

任务由经理首次推进。员工、经理、人类均可向其他任务参与者发送消息；不得 @ 自己。模型使用 handoff.recipientAgentId 定向交接，向人类咨询使用 consultation.audience=human；经理仍通过 managerDecision 明确工作节点和接收者或提交人类验收。人类指定员工时直接送达，不因该员工尚无节点分配而转发经理。

新 Run 从 running（进行中）开始；planning/review 只保留既有冻结记录语义，界面统一显示进行中。错误中断 failed、待人类澄清 awaiting_human、待验收 awaiting_acceptance 是需要人类处理的三种自动停止状态；人为暂停和终止仍由用户控制。业务调用失败立即中断整个任务并拒绝新消息/答疑/跨成员派工，修复后只能显式重试原投递。重试给该员工的动态输入加“继续”，不创建协作 Message，失败历史保留。

每10秒巡检只检查运行元数据，异步触发各 Run 的执行，不等待模型。没有执行中的 Trace/Dispatch：先继续已有可执行投递；没有待执行投递且没有待答人类问题时，Store 建立一次经理巡检投递，让原经理会话读取当前状态与沟通记录继续推进。单飞覆盖准备阶段，错误、等待澄清、暂停、验收和结束不触发经理。

协作读模型只返回员工、经理、人类之间的 Message，不显示系统消息、投递、重试、开始/结算等事件；底层事件与历史仍保留供诊断。每次 Trace 创建独立 inputMessageId（应用输入轮次ID，不冒充 Provider 消息ID），该轮输出 Message 保存 startMessageId；控制台链接依据此ID定位本轮提示词，成员原生会话仍贯穿任务生命周期并彼此隔离。

## 协调

协作记录只展示员工、经理、人类之间的沟通 Message；系统提示、启动、投递、重试和结算事件不作为记录行。底层不可变事件、Dispatch 和 Trace 继续保留，关联执行元数据供查询。消息保存本轮 `startMessageId`，对应 Trace 的 `inputMessageId`；“本轮控制台”按该 ID 打开、定位本次提示词，不受日志分页影响。成员原生会话贯穿任务且彼此隔离，每次执行拥有独立输入轮次 ID。 接收人表示实际处理对象，不代表私密范围；未指定对象的发言只显示发送者。

Dispatch 的 sourceMessageId 只关联同 Run 消息，用于追溯实际接手执行，不改变输入游标。无法关联的投递留在执行查询，不伪造角色沟通。

经理通过协调决定安排后续节点、员工和人类交接。没有下一步时可请求人类验收；平台记录决定，不核对节点完成率、业务结论或文件证据。员工可以普通文字交接。任务完成只能由人类确认。

Run 不持久化一套独立的节点状态机；界面的当前焦点由 Trace、消息和经理安排投影。节点依赖是预期交接信息，不能作为员工本机操作权限。

## 冻结配置和工作目录

Task 创建时冻结独立员工集合与工作流配置；历史已冻结的仓库配置保留，角色提示词文本随员工快照一并冻结。修改配置仅影响后续任务。

受管工作根：`<workspaceRoot>/tasks/<taskId>/<runId>`。`taskId` 区分任务，`runId` 区分该任务的一次执行。新任务所有成员从 Run 根启动；仓库操作按提示词/任务内容处理。已有历史任务仍按冻结仓库绑定选择启动目录，启动目录不是访问限制。

新 Run 工作根初始化 Git，克隆仓库注册为 `repos/` 下的 gitlink。初始化失败记诊断，不阻止员工交接或替经理评价任务。

## 会话和历史

应用指令和当前输入分离：员工身份、入口规则、执行环境进入 Provider 指令层；完整工作流仅进入经理指令，其他员工只接收本轮职责，不注入全工作流或预绑定人员表。经理明确选择下一位员工，不能由 Task 的旧节点分配覆盖。

原生会话拥有其对话历史，平台不重放聊天记录。成员会话记录已投递的平台消息游标和上下文内容摘要：跨员工交接、广播和人类回复仍须首次送达。模型本轮产生实际正文/思考/工具内容或成功返回结果后确认；启动失败、快照或连接事件不确认。确认后即使执行失败也不重投；关联目标 ID 不绕过游标。会话不存在时清空上下文摘要并记录重建事实，不伪称原生历史仍在；可通过真实历史工具按需查询。

外部服务、鉴权、额度等 Runtime 错误立即停止原投递，Run 标为 failed、Task 标为 blocked；暂停与原生会话确实丢失时的一次重建按各自协议处理。错误期间禁止发送消息或 @ 其他成员，只能由人类重试原失败投递。重试保持员工、原生会话、消息引用、咨询链、累计 attempts 和失败 Trace，并在本轮输入动态加入“继续”，不创建协作消息。原投递优先领取，其他待执行投递保留。没有实际失败投递的工作区准备错误保留原队列，空队列才由经理启动。 进入验收或完成时取消平台协调跟进投递，结算只保留审计事件，不显示协作消息。

每位成员独立会话，后续 Trace 可续接已绑定的原生 Claude Code/Codex ID。Codex 创建阶段的内部占位 UUID 不写入 Trace.providerSessionId，原生 thread.started 确认后才绑定。沟通员工资料和插件/MCP 选择变化不改变会话身份；下次调用重新应用指令与所选扩展。实际 Runtime 连接或启动目录变化才重建，历史记录与已确认消息游标保留。

Task、Run、Trace、Artifact 和历史消息保留关联。删除配置时保留实际引用关系；归档与终止不抹去历史。清除数据只能通过显式管理员入口。

## 读模型

`GET /api/bootstrap` 返回目录摘要；`GET /api/runs/:id/workspace?view=summary` 排除 Runtime 日志；`GET /api/runs/:id/console` 按成员、Trace 与游标分页。完整执行正文与提示词使用各自按需读取接口。

Runtime 当前目录每种 Provider 恰好一项，ID 保持稳定；saveRuntimeProfile 仅允许 model/effort/enabled 非空部分更新并原子投影当前员工。Task/Run/已排队调用的模型档位仍冻结；enabled 为当前调用可用门禁，不属于冻结的业务事实。停用不取消正在执行的进程，但拒绝新任务启动、沟通发送及后续调用；重启后保存的开关仍生效。创建、删除、名称、CLI 路径和命名 profile 写入协议废弃，详见 docs/15。

Runtime Provider 新增 dsh，固定槽位 runtime_dsh；与现有两个 Provider 同样由 Store 拥有 enabled/model/effort 及员工绑定。DeepSeek Harness effort 为 off/low/high/max，空为原生默认。已有任务/排队投递保持冻结配置，开关只约束后续调用。DeepSeek Harness 和 Codex 一样须确认原生会话存在后再标记为可恢复；未知会话错误经原恢复入口处理，Runtime 不自建替代会话。新增 Provider 不重置操作者实例或改写旧市场/任务版本；旧市场版本需重新导入/编辑以获得当前 DeepSeek Harness 兼容声明。

Runtime 展示名称为Claude Code、Codex、DeepSeek Harness、Cursor、Gemini CLI、Qwen Code、Kimi Code、Pi、OpenCode；固定 Provider ID、执行文件与能力边界见 [多 Runtime 接入](29-runtime-providers.md)。服务通过与执行相同的 CLI 环境检查可执行文件（不运行模型、不读取凭据）；Store 注入该只读事实，在 list/get 返回 installed 和实际 enabled。未安装或客户端 PATH 找不到可执行文件时 enabled=false、界面开关关闭并锁定，HTTP/CLI 拒绝修改 enabled 和发起新调用；安装检查不改写用户开关偏好、员工或 Task 冻结事实。安装/PATH 修复后重开客户端或重新进入 Runtime 设置重新读取；已安装但未登录不属于未安装。

任务协作的人类新消息未提供 recipientAgentId（省略或 null）时，由 Store 路由给该 Run 的冻结项目经理；显式指定仍校验当前 Run 成员。精确澄清回复继续由 replyToMessageId 决定接收人，普通消息不能隐式回答待答问题。已完成/暂停/终止 Run 的无指定消息仍为经理答疑，不恢复业务执行；失败 Run 拒绝新消息，先重试；已归档继续只读。

插件新绑定的 `adapterVersion:2` 引用冻结 `planTarget`、`sourceDialect`、`planSha256`，只含元数据与摘要，不存原始提示词或 Hook 命令。新安装另外保留 `sourceRoot/sourceSha256` 完整性引用。执行计划按源标准解析；已有 Task/Run 的旧引用继续按旧适配语义执行，不自动换计划。MCP 新绑定 `mcpAdapterVersion:2` 保留源服务名，历史调用保留其记录的命名方式。详见 docs/26。

插件执行引用 adapterVersion=3 冻结 v3 计划摘要（含已知源模型别名到目标 Runtime 继承模型的 sourceModel）；原始来源与安装树不变。已有 adapterVersion=2 仍按 v2 规则重算和核验原摘要，不升级旧 Task/Run。调用内 YAML 文本编码投影不回写领域状态、安装目录或冻结事实；契约见 docs/26。

## 当前员工配置与沟通简化

员工类型只接受 business（普通员工）和 manager（项目经理），create/update 不接受 developer 或 repository。仓库地址、基线和工作说明写入员工提示词或任务内容；平台不为新任务解析员工仓库、生成检出计划或按员工类型选择启动目录。新 Task 的 repositoryMode 为 workspace，仓库来源/绑定为空，所有成员从 Run 工作根启动。团队读模型不再派生 deliveryRepositories。

废弃当前配置不自动迁移/清除；已有旧研发员工可由操作者显式编辑为普通员工，并把原仓库说明写入 systemPrompt。保存明确去除其旧仓库绑定。已创建 Task/Run 的 repositoryMode、repositorySources、repositoryBindings、员工和工作流快照、真实仓库与执行历史均保留，继续按各自冻结事实执行；不以移除配置入口为由改写旧任务。

普通沟通回复保存 reply 正文并结束该成员投递，不支持 handoffToAgentId 或转交；私聊只有 reply，群聊可由人类本次 @/广播及员工明确 mentionAgentIds 产生定向投递。已有转交历史保留为已发生事实，当前界面不再提供转交操作或强调转交标签。任务派工、角色咨询不属于普通沟通，保持原协议。

问题发现、修复交接和核验结果全部由角色 Message 表达。移除独立 Defect 集合的创建/更新、状态流转和读模型，废弃 defects、resolvesDefectIds、verifiedDefectIds 输出字段，出现时明确拒绝并提示使用 summary/consultation 与 handoff。工作流焦点不再根据独立问题记录高亮，任务进度不含 openDefects/openDefectCount，原独立列表接口移除。

这是输出与查询协议变更：调用方须移除旧字段并改用协作消息，无需重新初始化当前实例；不重写冻结消息、Trace、文件或存量数据库历史，不将旧清单伪造成角色发言。已有执行会话继续使用，后续调用遵循当前消息协议。

沟通失败保留原消息、投递和调用历史，nextAttemptAt 为 null，不由轮询自动重试。失败消息下提供“查看控制台”和“重试”；重试使用当前员工配置，未确认原生会话时创建真实新会话，已确认时续接。同员工 FIFO、其他群成员并行及服务重启恢复在途调用保持原规则。

任务执行内置 PostToolUse Hook 经调用级私有 socket 触发 Run Files 登记动态克隆仓库；基准只取明确 clone reflog 起点，私有持久记录不随提交/重试更新。CHANGE 与 diff 动态发现并按最深仓库归属比较；缺少起点明确提示仅未提交差异，读取/轮次结束补查，无额外协作消息或自动 Git 写操作。

自动化新增 Automation 与 AutomationTrigger 元数据集合。Task.kind=automation 冻结 automationId/automationTriggerId/automationVersion；普通任务为 manual（历史未设置视为普通）。自动化每轮独立工作目录/会话/快照，无 human participant，不允许人类消息、澄清或交接；经理交付后 awaiting_acceptance，下一轮实际创建成功的同一事务自动确认，confirmedBy=automation 并关联 confirmedByTriggerId。错误/暂停/取消不自动确认。普通任务的人类最终验收不变。任务优先级输入已废弃，明确拒绝，当前读模型不展示；旧冻结事实不重写，不要求重置真实数据。详见 [自动化](27-automations.md)。

运行中成员由 Run.participants 冻结快照与 removedParticipantIds 投影；添加成员冻结当前配置，移除不删除历史，重新加入复用原快照。必须保留当前经理；经理原始员工 ID 在写入口映射为 Run 身份，映射后拒绝重复。执行中、待投递或等待回复的成员不能移除。失败、已结束及待验收 Run 不允许编辑。成员变化仅产生审计事件，不插入协作消息。待人类澄清时仅接受精确 replyToMessageId 回复，拒绝新指令。

工作流选择可省略、null 或空字符串；Task 保存 workflowTemplateId=null 与固定“默认协作”单节点 delivery 快照，经理按目标协调，普通/自动化沿用各自人类边界。不从目录隐式选模板。非终结 Run（包括失败、待验收）可修改成员，但归档、完成、取消拒绝；经理和未结投递成员不可移除。员工改名同步当前 initials，已冻结成员身份不回写。

## 同任务员工并行

同一 Run 内不同员工可并行，同一员工（含经理）的 claimed 投递/原生会话串行。经理可返回 managerDecision.assignments 数组，每项包含 nextNodeId、nextAgentId、instruction；一次派工须全部验证通过才记录定向协作消息和队列，拒绝重复员工、自指派和混合决策。单人 nextNodeId/nextAgentId/instruction/rationale 是同一协议的单项简写，归一为 assignments 后由同一 Store 命令校验、生成定向指令与投递。instruction 可省略，此时使用本轮 summary，其次 rationale；显式空值或非文本拒绝，不丢弃指令。验收仅接受 nextNodeId=null、nextAgentId 省略或 null，不允许同时带派工 instruction。等待其他员工结果使用 managerDecision.wait=true，须存在其他未完成工作；不增加人工开关、不由平台判断业务依赖。经理可在其他员工执行期间处理已返回结果、追加派工，只有没有其他业务投递/执行时才能请求验收。

队列只阻塞同一员工，不让忙碌成员阻塞其他人；经理及员工在执行期间收到的新消息排队，完成后及时唤醒。失败立即标记整项任务并停止领取新投递，已领取的其他员工允许收尾并保存结果/排队交接；人类待所有在途调用收尾后重试原失败投递，多处失败逐一恢复，未解除前不启动其他排队工作。暂停/终止覆盖全部成员进程，failed 也允许显式终止为 cancelled；重启回收全部在途调用，失败 Run 保持失败且不自动重试。人类澄清停止新投递，在途调用同样收尾。共享目录和任务累计 CHANGE 保持不变，不自动隔离或合并 Git，不以文件快照推断并行员工的独占修改归属。App/CLI 使用同一执行与查询协议，无并行开关或新增配置字段。

普通任务草稿复用 Task.status=backlog：保存时按现有创建规则校验标题、目标、成员、可选工作流和验收标准，持久化冻结快照；不创建 Run、投递或工作目录，不调用 Provider。App「保存草稿」与 CLI tasks create 等价；显式「启动」或 tasks start 才创建 Run。「保存并开始」/create --start 顺序调用相同创建及启动命令，启动被拒绝时保留草稿，启动响应不确定时先查询再决定下一步。此处草稿是完整且待启动的任务，不新增部分字段协议、自动保存或草稿编辑接口。

扩展目录由 Store 拥有：extensionCatalog 在配置 JSON 保存摘要和 deletedAt，通过阶段 JSON 与 SQLite revision 指针协调导入登记和当前员工替换。removeExtension 软删除并从所有员工当前 runtime 清除对应 ID、manifest 与派生路径，保持员工其他配置及 Task/Run/已排队会话快照。回执 employees 仅 ID/名称。删除后旧输入被拒绝，历史文件不清理；当前安装目录协议及旧目录重新导入要求见 docs/15。

任务协作附件：runAttachments 保存 id/runId/name/path/bytes/sha256/createdAt 元数据；消息以 attachmentIds 引用同一 Run 已登记文件并冻结 attachments。每条最多10个、单文件20 MiB；有附件可无文字。普通指令及精确澄清回答共用附件校验，错误/归档/自动化不接受人类上传；任务删除随 Run 删除元数据和文件，历史消息引用不随员工变更重写。Store 深拷贝使用 structuredClone，避免 JSON 中间字符串上限；工作区 Trace/Artifact 的 agent 仅含 id/name，完整冻结成员保留于 Run。

### 角色扩展与自动化删除

Role.extensionSelection 保存 pluginIds/mcpIds，省略创建为空、更新保持，显式两个空数组清空。Store 保留按 Provider 解析的内部引用，不向配置 API 暴露。员工 runtime.extensionSelection 是直接选择；inheritedExtensionSelection 是只读角色继承 ID。执行快照按 ID 合并去重，解绑角色保留员工直接选择。角色更改只影响新 Task 与后续沟通投递，不改冻结历史。角色扩展与员工 Runtime 不兼容或合并后命名空间冲突时，配置保存失败。

扩展软删除清除当前角色和员工关联；插件更新、重复导入及 MCP 编辑同事务替换当前角色和员工关联。内容仍在文件中，配置 JSON 保存当前扩展主清单，SQLite 保存角色和员工关联及冻结引用，不搬迁源码或凭据。

仅已停用自动化允许永久删除。客户端确认或 CLI --yes 后，服务锁定该自动化及关联任务，终止尚未结束的执行，等待退出，再暂存 Run 文件并在单一 Store 事务中删除所有关联 Task/Run/触发记录。数据库失败恢复暂存文件；文件最终清理失败返回202及 runFileCleanup=pending。普通任务及其他自动化保持独立。

## 读模型与事务边界

领域字段和冻结/验收语义不变。实体 ID/位置索引替代全状态复制；事务以属性逆操作回滚，SQLite 提交后才发布事件。任务详情提供 compact 状态与独立协作游标，日志按时间/ID 查询；数据窗口是读取边界，不删除或改写历史。目录搜索/筛选/分页与详情经同一 HTTP 供 App/CLI 使用。当前配置协议不新增旧版本输入兼容，物理实体分表不重置真实实例。资源等待属于运行观察日志，不是一条角色沟通。

协调协议拒收与业务执行失败分开处理：拒收事务不产生任何派工、等待问题或验收状态，原始角色报告、文件事实和失败 Trace 保留。Store 把具体原因及原 Trace ID 保存在原 Dispatch 的 routingError，立即在同一成员会话中安排一次格式纠正；纠正仍失败则停止该投递并标记整项任务 failed，巡检不再空转。人工重试继续原投递并重新给予一次纠正机会。反馈只进入本轮输入和控制台审计，不生成系统协作消息，不把模型回复文件当作投递成功回执；外部 Provider 失败仍只由人类显式重试。

合法验收遇到仍在执行、排队或等待答复的工作时，记录延后决定并在其他工作结束后请经理重新协调；延后投递不阻塞后续员工报告，也不消耗协议纠正次数。原始 nextNodeId=null、nextAgentId 非空或同时携带 instruction 属混合决定，明确拒绝，不静默验收。


## 极简工作流画布与文件化上下文

工作流仍是项目经理参考的自然语言协作图，不是自动执行引擎。当前 App 与 CLI 共用 `nodes` 和 `edges`：节点最简只需 title，type 为 process（默认流程）或 condition（条件判断），description 保存完整说明，id 省略按数组顺序生成 node_N；staffingGuidance 可空，保留 deliverable、artifactPaths 等补充要求。position 为可选画布坐标 {x,y}，均为 -100000 至 100000 的有限数，仅用于呈现。最多100个节点、300条连线，正文最多20000字符。

每条 edge 包含 id（省略生成 link_N）、source、target、condition（默认空，最多2000字符的自然语言分支条件）、description、dependency（默认false）和 handoff（默认true）。同向节点对唯一，不能自连或引用不存在节点；至少启用一种关系。普通交接允许返工回路，只有 dependency 关系禁止成环。提供 edges 时它是关系来源，nodes.dependsOn/handoffFrom 若同时提供必须一致，Store 输出这两个派生字段；省略 edges 时由节点关系生成连线，不维护两套独立关系。空 edges 表示没有连线。

编辑和删除图元素只改变待保存模板；任务创建冻结节点、连线及正文，后续模板编辑不改变 Task/Run。经理每次调用从该冻结快照生成私有 workflow.md，系统指令只给文件路径、SHA256和读取要求；员工收到当前节点说明与交付指令。原生会话、并行派工、失败恢复、人类确认和自动化验收边界不变。

条件节点以菱形呈现，经理结合实际证据从出线选择满足条件的一条继续，未知条件先澄清；不同时执行互斥分支。流程节点仍可把独立工作交给多人并行。条件与交接说明进入冻结文件，平台不求值表达式、不自动裁判业务结果；不要求草稿图的所有出口均已连好。

未填写交付要求时，流程节点默认交付可验收文件，条件节点默认说明判断证据与理由并交回经理，不要求每次判断生成独立文件。

同一轮包含 `summary` 与 `consultation` 时，先将非空且与问题正文不同的报告保存为普通角色 Message，再保存问题和等待关系；两条消息关联同一 Trace/本轮输入。缺少报告或正文与问题相同不另造消息，协调失败仍回滚路由并保留原报告；不从控制台补造旧 Message。

经理为任务身份：Task创建必须提交managerAgentId（非空员工ID，属于展开后的memberAgentIds且active），不按Agent.kind推断或自动选择；所有员工均可担任。managerSnapshot保存该员工原配置，memberSnapshots保存其余员工；Run继续使用独立经理别名/sourceAgentId和冻结会话，不修改全局员工类型。Agent.kind字段保留但不参与选人、成员增删或任务角色判断，新建默认business；App移除类型输入与标识。Run启动后经理不更换、不能移除；任何其他员工均可作为普通成员加入。已有Task/Run冻结事实保留；旧自动化需显式编辑选择经理，不迁移或猜测。

工作流当前写入规则：process节点最多一条出口连线（包含前置依赖和普通交接），多出口必须显式改为condition；所有创建/完整替换入口和新Task冻结当前模板时使用同一Store校验。已有模板读取及已冻结Task/Run不改写、不推断类型；编辑存在多出口的流程节点时先显式转换。edge可选sourcePort/targetPort为top/right/bottom/left，省略交由视图自动选侧；四边端口只影响呈现，不改变source/target和协作执行。

新增原生 CLI Runtime 的事件、会话、模型目录和扩展边界见 [docs/29](29-runtime-providers.md)。本轮不将 Claude/Codex 插件方言直接标记为新 Runtime 兼容；未支持的扩展拒绝绑定，不能静默忽略。

扩展兼容性检查只更新当前目录派生摘要；不可变安装、冻结计划与 Task/Run/角色/员工引用不重写。新增 Runtime 的冻结插件计划包含所选原生 Skill 元信息；旧三种 Runtime 的计划摘要结构保持。

员工选择新 Runtime 并绑定既有角色时，HTTP 先验证组合扩展，再由 Store 按该角色相同不可变扩展 ID 补齐缺失目标的派生执行计划；已有目标计划、角色选择及历史快照不修改。此为配置命令的按需解析，不在启动或读列表时迁移数据。

工作根是宿主当前启动配置，生产 Store 通过 workspaceRootAuthoritative 使用该根创建新 Task，不再用业务库内旧工作目录设置决定资料位置。既有 Task/Run.workspacePath、冻结成员/扩展、不可变消息及原生会话 ID 保持；物理文件搬运与地址解析不产生业务重判或新派工，见 docs/30。

当前存储归属以 [配置目录与工作目录](30-storage-layout.md) 为准：配置、认证、Runtime、插件/MCP 清单及源文件保存在 `~/.agentforge`；员工、角色、团队、工作流、自动化、任务与沟通及执行内容保存在工作目录，默认 `~/.agentforge/workspace`。清除所有数据删除整个当前工作目录，保留配置和登录。插件/MCP 列表与 Runtime 设置使用私有 JSON，SQLite 只存业务关联及配置提交 revision。

沟通 workspacePath 为首次执行时分配的持久业务目录，形如 `<workspaceRoot>/communications/<conversationId>`；所有成员共享 cwd，原生会话仍保存在各自 sessions[agentId] 下。工作根变化不改已分配路径，改变成员启动目录按既有协议显式重建原生上下文，历史消息和调用事实保留。

## 提示词输入精简

输入回执属于成员原生会话：任务延续原有消息 ID/摘要；沟通新增 inputMessageIds，与成功回复状态独立。原生会话确认及真实模型活动后消费输入，业务结果解析失败不抹去已接收事实；新原生会话清空沟通消息回执并重新投递当前目标。经理状态按实体 ID/内容摘要投递变化，移出最近窗口不等于领域完成。大正文文件是原始消息的派生读取资料，不新增领域消息或授权，详见 docs/22。

## 共享协作输入与报告通知

Run 公开消息按每位成员的原生会话回执增量补齐，阅读背景与处理待办分离，当前待办保留明确消息 ID。经理队尾未尝试报告可合并为一个投递，保留多来源引用与幂等键；不合并人工指令、咨询、恢复及已领取调用。合并不自动结算业务，仍由该次协调成功结算。前置自然正文不被尾部协调 JSON 的摘要替换，原始响应和历史事实保留。
