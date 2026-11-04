# CLI 指南

核心 App/CLI 对齐：tasks create --file input.json [--start] 支持 teamIds、memberAgentIds 混合选人，服务端展开去重；可只传其中之一，最终恰好一位可用经理。acceptanceCriteria 可省略或 []，最多20条/每条500字符；不再使用任务优先级。--start 显式创建后启动，可能消耗模型额度；失败返回 TASK_CREATED_START_FAILED、taskId 与查询建议，不自动重试、不回滚已创建任务。先 progress 核实，再按状态决定是否 start，不能重复 create。员工搜索包含 capabilities；工作流交付定义可省略，依赖/交接来源独立；团队启停与 App 同步。tasks list 校验状态并按更新时间（归档按归档时间）降序分页。

`agentforge tasks list --workflow ID_OR_NAME` 按工作流精确 ID 或唯一名称（当前或任务冻结名称）筛选；同名歧义明确拒绝，改用 ID。与 `--search`、`--status`、`--archived` 组合后分页；文本/JSON 摘要包含 `workflow: {id, name}`，name 为任务冻结名称。

客户端人工恢复会继续原失败员工的 Dispatch 与会话，保留累计 attempts、消息引用和失败 Trace；CLI progress/协作查询继续展示真实历史，本轮不新增恢复命令或输入字段。

任务通过独立成员集合创建，Store 校验恰好一位可用项目经理，团队仅用来批量选人。删除员工与团队的冻结历史语义见 [领域模型](03-domain-model.md)。

CLI tasks create schema 使用 teamIds 与 memberAgentIds，由 Store 合并为独立成员；移除 teamId 和 tasks list --team。tasks get 返回成员 ID/名称引用，不倾倒员工提示词/Runtime；tasks list 显示成员数。teams create/update 不接受 managerAgentId，memberAgentIds 可以为空。agents delete --yes 逻辑删除并返回 historyRetained，teams delete --yes 不再因任务/群聊历史拒绝。help/schema/example/text/JSON 共用当前协议。长期沟通属于客户端能力，本轮不新增 CLI 群聊权限。

协作记录只展示员工、经理、人类之间的沟通 Message；系统提示、启动、投递、重试和结算事件不作为记录行。底层不可变事件、Dispatch 和 Trace 继续保留，关联执行元数据供查询。消息保存本轮 `startMessageId`，对应 Trace 的 `inputMessageId`；“本轮控制台”按该 ID 打开、定位本次提示词，不受日志分页影响。成员原生会话贯穿任务且彼此隔离，每次执行拥有独立输入轮次 ID。

角色可交接给除自己之外的任意参与者；人类显式指定员工直接送达，未指定则交给经理。错误任务拒绝新指令，等待原员工重试。

重复手动导入按同一来源地址＋插件名称匹配插件，按安装名称（去首尾空格、区分大小写）匹配 MCP；不同来源的同名插件保留。成功以新不可变版本覆盖当前目录项，原子更新所有当前员工（含停用）的选择并合并重复引用；Task/Run、排队投递和历史文件不变。失败整批保留原目录及绑定，候选从当前目录退役。首次安装不自动绑定员工；已存在的重复项在下次同标识导入时一并替换，不做全库清理。响应增加 replacements（kind/id/previousId/name）、employees（仅 ID/名称）、historyRetained；原 plugins/mcps 或 MCP 摘要字段不变。

本仓库仅提供客户端；首次管理员设置在应用内。CLI 继续连接客户端私有 endpoint，配置/任务/auth 命令和字段不变。

Runtime 外部故障立即保留脱敏原始错误并标记任务失败，禁止新消息；修复后在客户端重试原员工投递和会话，CLI 不新增恢复权限。只有确认的原生会话丢失允许重建一次；经理非终止安排仍尊重已有投递，验收后的协调跟进结算只保留审计事件。

workflows create/update/schema/--help 的 artifactPaths 支持任意规范工作目录相对文件或目录（artifacts/media/、reports/、summary.md），缺省为空；不再限定docs或作为接纳白名单。任务artifacts可查询非docs业务快照；CLI没有当前目录浏览/下载命令，本轮不扩权。

插件更新命令：plugins updates 查询当前服务检查状态、周期、下次检查、最近更新回执与错误摘要；plugins check-updates 请求立即检查（异步返回，随后 updates 查询）；plugins auto-update --file settings.json 接受 {enabled?:boolean,intervalMinutes?:integer}，至少一项，周期1–1440分钟（默认2）。三个操作的 --help 逐层展示参数，默认可读文本、显式 --json。设置与客户端「设置 → 更新 → 插件更新」一致，CLI仍只连接客户端，不直接访问Git。关闭时可立即检查，保存后按新周期计时；当前员工统一切换新版本，冻结任务、排队调用及 MCP 选择不变；退出服务后不继续检查。

mcps update ID --file patch.json 编辑名称/说明/单服务 JSON，至少提供一项；省略 content 保留配置。完整参数与脱敏值保留规则见 mcps update --help。成功返回新 id、previousId 和更新员工 ID/名称，不倾倒员工详情；后续用新 ID get。当前员工原子切换，冻结任务和排队调用不变，不兼容或并发修改时拒绝。安装仍用 create；首次不自动绑定，重复导入按安装名称覆盖并更新已有选择。

pluginIds 仍选择完整插件；所选 Skill 经 Runtime 原生注册、按需激活，不向应用系统指令追加路径和逐一读取说明。内置历史 MCP 通过真实工具定义提供能力。CLI 字段、输出和关联查询不变，agents 帮助/schema 同步语义；原生注册/触发须真实验证，不能仅凭安装或静态兼容标签判断。

平台历史工具由任务/沟通 Runtime 自动提供，不需 CLI 安装或员工额外选择；打包版启动环境修复不增加命令、输入字段或输出。任务继续使用原有 messages/send/reply 语义：未归档可发送，归档只读；移除 Web 的停止答疑按钮不改变 CLI/API 或人类最终确认边界。

员工 `runtime.extensionSelection` 省略或空数组均表示不加载市场扩展，不继承全局 MCP、插件或 Codex Apps。MCP 选择帮助已同步隔离边界；基础文件/Shell 工具仍可用，CLI 无新参数或输出字段。员工资料/扩展编辑不重建沟通原生会话，下一次调用应用新配置；实际 Runtime 连接变化才重建。

员工 `systemPrompt` 表示通过 Runtime 系统/developer 指令传递的长期工作法，而不是每轮用户正文。完整工作流只给经理；环境与可咨询成员目录在指令层。已有配置、任务新指令和精确澄清命令不新增参数或权限，帮助/schema 同步该含义。

CLI 专属于客户端：源码和安装版都只发现运行中的客户端，校验私有 endpoint 的实例 ID 后才读取会话/发送凭据；无 Web 目标、无 4310 回退。客户端退出、连接文件不安全或实例失配返回 CLIENT_UNAVAILABLE（退出码 5）。已移除 --target，废弃选项明确拒绝；help/schema 和输入校验保持离线。开发/隔离测试可用 --endpoint-file 指定客户端私有连接文件，不手填 origin。默认会话统一为 ~/.agentforge/cli-session.json（可显式 --session-file）；旧安装版 CLI 需要重新登录，不搬迁会话。普通 Web 设置不提供 CLI 安装入口。

新实例默认任务工作根统一为 ~/agentforge，不分 Web/Desktop；设置中已保存的目录仍优先，已有 Task/Run 路径不改写。CLI 创建任务使用当前实例工作根，应用数据仍按实例隔离于 ~/.agentforge。

`plugins import --file source.json` 安装时展开来源目录/所属 Git 仓库内的符号链接，形成不依赖原目录的普通文件副本；中文、空格等文件名保留。断链、循环、越界目标和特殊文件返回插件名/相对路径，整批不发布，不静默忽略。输入仍只有 url/path 二选一，`--help` 和 schema 同步说明，无额外兼容开关；员工选择及详情查询协议不变。

插件和 MCP 支持 `agentforge plugins delete ID --yes`、`agentforge mcps delete ID --yes`。先 `list --search 文本` 或 `get ID` 核对目标；没有 `--yes` 不发删除请求。当前员工仍选择该版本时服务拒绝并指出员工，需先 `agents update` 移除选择。成功回执包含 ID、名称、deleted 与 historyRetained；再 list 不显示、get 返回 404。历史冻结引用和文件保留，插件删除不影响独立 MCP。各操作的 `--help`/schema 与认证 HTTP 同步。

任务协作的界面配色不进入 CLI 文本/JSON；仍输出真实状态文字，不输出 `tone` / `statusCode` 等视觉元数据。

## 安装与连接

桌面「设置 → 命令行 CLI」可安装用户级命令。源码运行 `npm run cli -- help`。


```bash
agentforge auth login --username admin
agentforge auth status
agentforge teams list
agentforge agents create --help
agentforge schema agents --json
```

TTY 隐藏输入密码；脚本使用显式 `--password-stdin`。没有密码命令行参数。会话私有持久保存，默认不因时间到期；不读取浏览器 Cookie、数据库或全局 Provider 凭据。`auth logout` 撤销本 CLI 会话。

## 配置

命令组包含员工、角色、团队、工作流、Runtime、插件和 MCP。根帮助列组，组帮助列操作，操作 `--help` 和 `schema` 提供字段与 JSON 模板。默认可读文本，机器消费者显式 `--json`。

角色：`roles list/get/create/update/delete` 管理只有名称和纯文本提示词的共用角色；list `--search` 与界面一致，按名称和提示词匹配。update 为部分更新（至少 name/prompt 一项），delete 需要 `--yes` 且仍有员工（含停用）绑定时拒绝并列出员工。员工以有序、不重复的 `roleIds` 数组绑定一组角色，省略保持不变、[] 全部解绑；旧 roleId/null 输入明确拒绝；角色提示词并入该员工沟通与任务执行的应用系统/developer 指令，不进入每轮用户消息。角色编辑只影响之后创建的任务与后续沟通投递，冻结 Task/Run 快照保持原文本；删除角色不改写历史快照。

员工通过 `runtime.profileId` 引用连接，扩展只接受完整 `extensionSelection:{pluginIds:[],mcpIds:[]}`。拒绝单 Skill、员工 `mcpJson`、手工路径及派生字段。工作流用 `staffingGuidance` 表达人员需求；员工仅 business/manager 两类，仓库说明写入 systemPrompt；拒绝 developer 与 repository 输入。`pluginSources`、工作流 `ownerRole/repositoryPath/reuseOwnerFrom` 不属于当前写入协议。

插件：`plugins list` 只列已装摘要；`plugins get ID` 按需返回 Skill/Subagent/Hook 详情。`plugins import --file source.json` 接受 `{"url":"https://…git"}` 或 `{"path":"/absolute/plugins"}`，一次原子安装来源全部 Claude/Codex 插件，返回插件摘要与拆分 MCP 摘要；任何条目失败则整批不发布。不再接受 discover/sourceId/pluginName 或安装信任参数。自带 MCP 另入 MCP 市场，员工单独选择，不随插件启用。`mcps create --file mcp.json` 安装单服务 JSON，支持 stdio/SSE/Streamable HTTP，三种 Runtime 均可用；`mcps get ID` 返回脱敏 JSON。安装不执行 Hook/依赖、不自动绑定。员工 create/update 可指定 status 为 active/inactive。详细字段用操作后的 `--help` 查看，在线市场暂不提供。

市场来源遵循 Claude/Codex 的 Git/本地部分规范：相对目录、local/path、HTTPS github/url/git-subdir，支持 ref 和完整 sha（sha 优先），安装所有条目并保留真实提交。不执行 npm/archive/command 来源，遇到时整批失败。`plugins list` 的 Runtime 列只列支持项；`plugins get ID` 的 compatibility 给出三种 Runtime 的 supported/reasons，组件注明 providers。静态支持不代表依赖、CLI 或账号已实测。不兼容的员工选择由 HTTP 拒绝。stdio MCP 额外提供 cwd（绝对路径）/env_vars（变量名数组）时由三种 Runtime 共用私有启动器处理。

`runtimes models PROVIDER` 返回真实模型/思考等级目录；`effort` 空值使用 CLI 默认。详细参数以当前命令帮助为准。

## 任务

- `tasks create/start`：创建与启动分开。
- `tasks list/get/progress`：摘要、任务事实和当前进展。
- `tasks collaboration/questions/artifacts`：协作、未答问题与交付元数据。
- `tasks message/reply`：发消息（recipientAgentId 可选，省略默认给当前 Run 项目经理；显式指定则发给该成员），或精确回复待答人类问题。
- `tasks terminate/delete`：终止后保留历史，删除须显式 `--yes` 且任务已停止。

历史执行可用 `--run RUN_ID` 指定，Run 须属于任务。写消息需要已启动的 Run；回复必须匹配当前未答问题。最终任务完成由 客户端的人类确认。

任务输出不递归展开员工提示词或完整冻结配置，关联信息通过 ID/名称引用，按需用对应命令查询。

## 输出与失败

`--json` 成功为 `{ok:true,data:...}`，失败为 `{ok:false,error:...}`。普通文本错误写 stderr；交互密码提示也只写 stderr。

退出码：0 成功，2 输入/用法，3 登录/会话，4 服务拒绝，5 连接/超时/不确定响应，130 交互取消。写入不自动重试；连接中断后先读取核实，再决定是否重发。

输入文件最大 1 MiB，HTTP 响应最大 16 MiB，请求限时 120 秒。会话目录/文件要求当前用户、0700/0600，拒绝符号链接。命令只走认证 HTTP，不直接访问 Store 或 Runtime。

## 当前 Runtime 与客户端登录

`runtimes` 仅有 list/get/update/test/models；固定 Claude Code 和 Codex，不能 create/delete/命名。update ID --file patch.json 接受 model、effort、enabled 的非空部分对象；ID 或固定 Provider 名称可引用。models PROVIDER 不再支持 --executable。停用阻止新的 Provider 调用，不取消已运行调用；历史快照不变。

安装版默认安装 Shell 命令，无需手动点击。CLI 默认复用已登录客户端的正式委托授权，客户端未登录且无独立 CLI 会话时才需 `auth login`。显式 --session-file 使用独立会话；auth logout 只撤销独立会话，共享授权请在客户端退出。实例重启自动更新共享凭证，CLI 不跟随旧端口、不读取浏览器 Cookie/数据库。

DeepSeek Harness 的 CLI 入口为 runtimes list/get/update/test/models，按 dsh 或固定 ID 引用；runtimes models dsh 返回本机 SDK 的 Provider/模型ID 和逐模型档位。update --file 支持 model、effort、enabled，DeepSeek Harness effort 接受空/off/low/high/max，其他 Provider 不接受 off。员工仍只绑定 profileId 和选择扩展版本，不新增 Token/Base URL/可执行路径参数。help/schema/默认文本/显式 JSON 均同步第三个 Provider；test --yes 真实调用 DeepSeek Harness。当前仅内置 DeepSeek 路由；Subagent/command Hook 按 docs/26 原生映射，未映射字段明确拒绝。

Runtime 展示名称为 Claude Code、Codex、DeepSeek Harness，内部 Provider/CLI 命令仍为 claude-code/codex/dsh。服务通过与执行相同的 CLI 环境检查可执行文件（不运行模型、不读取凭据）；Store 注入该只读事实，在 list/get 返回 installed 和实际 enabled。未安装或客户端 PATH 找不到可执行文件时 enabled=false、界面开关关闭并锁定，HTTP/CLI 拒绝修改 enabled 和发起新调用；安装检查不改写用户开关偏好、员工或 Task 冻结事实。安装/PATH 修复后重开客户端或重新进入 Runtime 设置重新读取；已安装但未登录不属于未安装。

插件兼容性由统一的源标准执行计划计算（docs/26）。`plugins list/get` 与员工选择共用当前结果；已有插件不需重装，旧 providers 不作为新 Runtime 的能力门禁。`mcps create/get` 的 cwd/env_vars 在三种 Runtime 中经统一私有启动器保留；无新增导入开关或手工降级字段，命令/输入 schema 不变。新增绑定的执行计划摘要为服务生成，CLI 不接受用户伪造引用。

插件兼容语义补充：Runtime v3 对已知 Claude 模型别名在其他 Provider 继承目标模型，保留原名供执行计划核验；不声称使用同一个模型。描述的单行冒号仅在调用私有投影规范化，未知 YAML 结构/标签仍拒绝。list/get 将格式异常限定到相应插件的兼容原因，错误仅包含相对组件路径及行列；既有命令、输入 schema 和关联引用格式不变。

插件导入部分成功时返回 warnings（plugin/component/path/message）；默认文本明确打印 ⚠️ 与每项路径/原因，JSON 保留结构化数组。相应插件 get 可再次查看，不输出原始错误组件正文。

任务协作改为仅角色沟通，文本/JSON 新增 startMessageId（应用本轮输入 ID）。tasks message 的 recipient 直接路由至所选员工，failed 任务拒绝发送；tasks progress 优先提示原员工重试。CLI 不新增恢复或最终确认权限。每 10 秒巡检为空闲的进行中任务唤醒经理，错误不自动重试。

tasks progress 不再输出 openDefects；任务与执行摘要不再提供独立问题计数。问题、修复与核验反馈使用 tasks collaboration 查询，tasks message/reply 发送。无新增参数或权限，最终确认仍在客户端；旧清单消费者应改用角色沟通记录，无需重置实例。

本次为沟通恢复、Runtime 启动鉴权和展示调整。CLI 配置与任务命令/参数/输出保持；tasks progress 继续提示失败后在客户端重试。长期沟通尚无 CLI 命令，不新增权限。

任务仓库基准由内置工具 Hook 自动登记；当前文件 CHANGE/diff 属于现有客户端读取能力，不新增 CLI 命令、字段、身份或写操作权限。员工/插件/MCP 配置协议不变，用户无需绑定额外插件。

automations list/get/create/update/delete/trigger/triggers 与 App 使用同一认证 HTTP。create 字段继承任务内容/成员/工作流/验收要求，附 cron、timeZone、enabled（默认 true）；update 是非空部分更新。list 支持 --search/--status enabled|disabled/--page，triggers ID 支持 --status/--page，两者 --all 显式逐页请求。trigger ID 立即运行，不改变下次计划时间，返回 started/failed/skipped；失败无新 Run，不能当作已执行。历史配置不倾倒在列表，详情返回 ID 关联；已有记录的自动化只能停用，不允许删除历史。普通 tasks list 只查普通任务；tasks create 不接受 priority。操作管理与提前确认在客户端，自动化的人类协作入口明确拒绝。

`tasks members TASK_ID [--run RUN_ID]` 查询当前成员；附 `--file FILE.json`（或 `-`）完整替换 `{ "memberAgentIds": [...] }`，使用同一认证 PUT /api/runs/:id/members。经理可用其目录 ID 或当前 Run ID，但不能重复；不能移除经理或有未结投递的成员。历史快照保留。teams create/update 均接受 status=active|inactive，创建默认 active，与 App 名称旁启用复选框一致。tasks message 在存在待人类澄清时拒绝，须 tasks reply 精确回复。
