# CLI

协作读模型以消息/事件为主线，按 sourceMessageId 或唯一的已有定向消息、Dispatch/Trace 引用关联真实派工；不按正文、名字或时间猜测，不回填历史。deliveries 明示投递当前状态，history 保留每次执行与重试的实际时间，经理协调为全流程范围。CLI 保留完整投递/执行事实、验收关联及有界文件 ID/名称引用（files 最多8项、fileCount 为总数）；完整文件列表用 artifacts 查询。已知员工交接结果信封从 rawResponse 提取已记录的报告正文，去除重复结构化结果，原始消息和控制台事实不变。客户端协作区展示成员总结、沟通和关键人类状态，保留单一“本轮控制台”入口；不自动附加投递状态、技术失败/重试通知、验收文件清单或平台验收说明。长消息全文一次渲染 Markdown，超过5行仅收起区域，展开不重建 DOM，Run 内保留阅读状态。控制台无顶部错误摘要，失败记录在日志内标红；员工状态按自己的最新 Trace 显示错误/执行中/正常，重试成功后清除旧错误。未验证事项保留员工原文，不自动判定交付质量；存储、调度、模型输入和人类确认规则不变。

任务协作时间线合并同一 Run 的全部 Message、实际 Dispatch 与协调事件。接收人表示处理对象，不表示私密级别：经理派工指向接手员工，工作交接指向经理，咨询/答复保留双方，没有处理对象的发言只显示发送者。sourceMessageId 仅关联同 Run 来源消息，正文与首个实际投递合并；同源额外投递归入同一消息；无法用已存引用关联的投递独立注明，不猜测历史来源。显示节点、尝试次数、重试/错误和真实投递状态；发言与接手执行提供独立控制台入口。任务确认、取消、暂停、恢复等事件按时间保留，不输出原始 Provider 帧或提示词。

本仓库仅提供客户端。CLI 配置/任务/auth 命令和参数不变，连接私有 endpoint，不提供服务器部署目标。

Task 进度与帮助同步原始脱敏错误、临时故障最多三次尝试和人工恢复语义；确定性/未知错误不自动重试，不再宣称必然升级经理。

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

员工 kind 只接受 business/manager，schema/help 移除 repository 与 developer；仓库说明放 systemPrompt。当前员工 get 不展示废弃仓库字段。普通沟通不属于 CLI 配置/任务命令，reply-only 协议没有新增 CLI 能力。
