# 共享展示投影

workspaceAgents 使用服务端 deletedAgentIds 过滤已删除员工（经理以 sourceAgentId 识别）；仅过滤成员列表，不改写 Run、Trace、协作正文与历史事实。

协作记录只展示员工、经理、人类之间的沟通 Message；系统提示、启动、投递、重试和结算事件不作为记录行。底层不可变事件、Dispatch 和 Trace 继续保留，关联执行元数据供查询。消息保存本轮 `startMessageId`，对应 Trace 的 `inputMessageId`；“本轮控制台”按该 ID 打开、定位本次提示词，不受日志分页影响。成员原生会话贯穿任务且彼此隔离，每次执行拥有独立输入轮次 ID。

角色可交接给除自己之外的任意参与者；人类显式指定员工直接送达，未指定则交给经理。错误任务拒绝新指令，等待原员工重试。

`console-projections.mjs` 将已认证读模型转为任务状态、员工执行状态、协作记录、工具分组、Shell 和 Diff 展示数据。

纯函数不访问 DOM、网络、文件、数据库或 Runtime，不发领域命令。Web 和 Electron 使用同一投影；HTTP 始终负责认证。测试见 `tests/client-projections.test.mjs`。

`isRoutineConsoleEvent` 在 `buildConsoleEntries` 中隐藏无正文的常规状态通知（开始/保存、普通会话连接、空 Provider 进度和诊断占位），不删除源事件。正文引用、工具、错误、重试、会话重建、恢复与未知记录仍保留；原始分页边界不按可见条数重算。任务和沟通共用此规则，CLI/API/日志不变。

任务审计的精确 Provider 类型前缀在识别通知前归一；无正文的 trace.accepted 同属常规确认，不重复回显交接保存状态。

本次提示词完整展示已脱敏系统层和本轮输入。工具阶段按 Trace + 原生调用 ID 合并，不把重复阶段计为多次调用；不同 ID 的真实调用保留。空 tool_progress 摘要隐藏，真实工具/正文引用仍保留。

协作投影的 `tone` / `statusCode` 仅供界面按真实消息/投递状态配色；CLI 不输出视觉元数据，文本/JSON 同步完整协作投影，仍不输出视觉元数据。

`toolCommandSummary` 提取已脱敏 Shell 命令或 Read/Write 文件路径；`toolFileInput` 提取完整 JSON 中的文件路径与写入文本，无法解析不猜测。

共享 Runtime 名称投影识别 DeepSeek Harness；DeepSeek Harness 事件仍进入现有 auditVersion=2 正文/思考/工具和原生会话显示，不引入公开原始 SDK 报文。

协作 UI 不重复展示回复的问题副本，但共享投影和 CLI 仍保留 replyToMessageId/来源关联；记录数量与 @ 说明不占协作顶部。未指定接收人的默认经理路由由 Store 拥有。

控制台 Markdown 正文不另设纵向高度上限；时间线负责纵向滚动，列表缩进保留编号，代码/表格保留横向滚动。兼容性标签来自同一服务派生矩阵。

workflowFocus 仅依据执行、等待和经理当前焦点；不接收独立问题列表。所有问题和处理反馈通过协作消息呈现。

自动化直接复用任务工作区与既有协作/控制台投影，不另建执行详情组件。自动化参与者无 human，因此不显示人类输入与筛选；普通任务投影和历史定位不变。

workspaceAgents 默认排除已移除成员；历史 Trace 保留冻结身份。任务成员列表复用执行状态与控制台选择。

并行成员状态按各自最新 Trace 显示：Run 已 failed 时，仍在收尾的成员保留“执行中”；完成/取消等状态继续覆盖旧执行。App 的当前执行行展示所有 running Trace 对应成员，CLI progress 的 activeTraces 使用同一事实范围。

共享 STATUS_TEXT 与 TASK_FILTERS 将 backlog 显示为「草稿」，协议仍为 backlog；任务启动及 Run 状态不变。

collaborationRecords 保留 Message.attachments 元数据；任务和沟通共用图片预览/下载展示，CLI 保留对应引用。Trace/Artifact 中 agent 为 id/name 引用，完整成员配置从 Run.participants 读取。

ByteCache 按 UTF-8 字节及项数实施 LRU，支持并发读取去重和失败移除。控制台正文、提示词及沟通 Markdown 分别配置预算；缓存不拥有领域状态。collaborationRecords 可接收按页补齐的问题/答复、投递和验收文件摘要，与全历史投影保持消息语义和本轮输入定位一致。


workflow-description.mjs 是不读文件、不执行派工的纯投影：将工作流节点和连线确定性组合为Markdown，并为未显式给连线的节点关系提供同一只读投影。画布文本预览与Run Files共用它，完整正文保留，布局不进入模型指令；Store拥有校验、规范化和冻结状态。

工作流分支：nodes.type=process/condition，edges.condition为自然语言条件（最多2000字符），默认流程/空条件；App/CLI同协议并冻结。条件节点菱形、经理选择满足条件的一条分支；预览返回保留画布有效尺寸。test-workflow-editor覆盖反复切换、宽窄布局、类型切换与分支保存回读。

任务经理属于Task/Run上下文，由managerAgentId确定；可咨询成员目录使用taskRole而非持久员工kind判定身份。员工种类仍作为历史字段保留，不作为协调或选人依据。

工作流文字投影继续排除position及端口等呈现参数；process单出口、condition分支由Store写入校验，编辑器与CLI同步。既有冻结workflow.md不修改。

共享 runtime-providers.mjs 统一九种 Runtime ID、显示名、执行文件、思考词汇和原生会话标识；不拥有调用或领域状态。

Runtime 原生 thinking 与最终回复使用不同事件类型；Cursor thinking delta 仅作为公开思考呈现，不可用作完成或会话确认。

市场兼容标签复用 RUNTIME_IDS 九项；原生扩展适配与组件边界见 docs/29。市场详情显式检查兼容性后刷新当前目录，不变更员工选择或历史。

runtime-providers 思考集合同步新增六项；OpenCode 可用档位是模型返回的 native variant，服务端最终按所选模型验证。

## 共享协作输入与报告通知

合并经理报告以 coalescedSourceMessageIds 明确关联全部来源，每条消息展示同一个真实 Dispatch/Trace 的处理状态；不把背景阅读当业务投递，不推断正文来源。Web/Electron 与 CLI 继续共用 collaborationRecords。
