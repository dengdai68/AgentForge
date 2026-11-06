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
