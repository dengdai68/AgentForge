# 控制面

createTask 的 teamIds 只是创建时选人输入：Store 校验团队 active，展开其中 active 成员，与显式 memberAgentIds 合并去重；显式停用成员仍拒绝，显式从最终成员中选择一位经理。任务仅持久化独立成员及冻结快照，团队后续变化不联动任务。不再使用任务优先级；CLI --start 顺序调用既有创建/启动 HTTP，不新增调度规则。

失败 Run 的人工恢复继续原 Dispatch/成员会话，保留消息和咨询依赖、累计 attempts 与失败 Trace，不取消其他排队工作。下次领取优先处理人类恢复的投递；已完成投递的旧错误不再成为恢复入口。没有执行投递的准备失败保留原队列，空队列才启动经理。

`store.mjs` 管理任务独立成员、唯一经理及员工逻辑删除，`communication-store.mjs` 管理独立群聊、编辑成员与公开定向投递；`index.mjs` 提供同一认证 HTTP 入口，包含 `PUT /api/communications/:id`。删除只改变当前目录/成员关系，运行中的冻结任务和历史证据保留。契约见 [领域模型](../docs/03-domain-model.md) 与 [长期沟通](../docs/17-communication.md)。

Runtime 原生恢复后按最后成功完成及零退出码结算，历史错误不覆盖恢复后的沟通/任务结果；未完成、非零退出和后续失败仍明确失败。诊断保留，配置更新不自动重建会话或改写旧调用。

协作记录仅展示角色之间的 Message，保留真实发送者、接收者和正文；系统事件不生成记录行。sourceMessageId 关联实际派工，startMessageId 关联本轮提示词，Web/Electron/CLI 共用投影。底层事件与执行历史保留，无法关联的投递由执行查询查看，不伪造沟通。长消息安全渲染 Markdown 后折叠，展开保留阅读位置；错误详情在控制台，成员状态随最新执行更新。

私聊输出 schema 只有必填 reply；群聊还要求 mentionAgentIds，普通回复用 []，明确咨询同事时由 Store 定向投递并按新消息入队，完成回调幂等，同一成员 FIFO 串行处理，没有 handoffToAgentId 或转交。群聊创建省略 name 时按所选员工姓名以中文逗号生成完整默认群名；成员读模型包含与员工卡片相同的 color/initials。人类 @/广播、FIFO/并行、会话与历史隔离不变，任务派工/咨询独立不变。

工作目录直接读取真实根，不再生成/读取展示清单，不预建 docs。目录查询按层/200项分页，普通根文件、业务自定义目录与大媒体可见；认证读取/下载仅保留工作根、敏感文件与链接检查。Git比较工作根初始化提交并保留绑定repos原始gitlink。Orchestrator记录各业务路径有限快照，Store工作流位置仅作建议、缺省空，不改写历史路径。

plugin-updates.mjs 属于编排层，只准备已装 Git 插件新快照并调用 Store 事务；Store 保存开关、分钟周期和绑定/审计，Runtime 负责来源校验、Git 提交查询与不可变文件。HTTP 暴露认证状态、异步检查及部分设置，不从 UI 驱动定时器；重置避开活动更新，服务重启清空观察状态。

MCP PUT 编辑由 Runtime 校验与准备新不可变文件，Store 事务核对并更新当前员工、退役旧目录版本及记录审计。HTTP 不循环保存部分员工；失败隐藏未使用候选，原配置/冻结文件保留。编辑不返回私有鉴权值。

Skill 路径不进入应用系统指令：Claude 原生插件 Skill 激活，Codex 所选技能经调用独占的原生 app-server 注册，并以线程级启用列表排除未选路径。历史 MCP 的能力目录/分页在服务定义中，不再复制进应用提示词；仅保留历史核对的行为原则。HTTP/Store 仍拥有状态，原生进程只返回执行事实。

Codex 的平台历史 MCP 接收 Bridge 全部自有环境，包含打包版 Node 模式；启动为 required，不能在指令声称有历史工具的同时静默忽略启动失败。Provider 环境隔离、员工市场选择与历史查询范围不变。协作页只展示真实经理结论消息，不再固定附加验收副本；内部验收事实、取消与审计保留。

私有提示词快照保留完整脱敏系统指令/本轮输入，共享控制台展示完整内容和已确认原生会话 ID；静态应用图标 PNG 返回正确 MIME。员工姓名/职责/能力及插件/MCP 选择变化续接原生沟通会话，下一次调用应用新配置；只有实际 Runtime 连接或启动目录变化才重建。Codex Apps 在调用级关闭，不修改全局配置。

prompts.mjs 纯组装系统指令与当前输入：身份/入口/环境进系统层，完整工作流仅经理；用户目标、职责和状态按内容摘要增量追加。员工绑定角色的共用提示词作为快照数据（有序 `roleSnapshots`，已有单角色历史仍读取冻结值）并入身份段，组装层不查询 Store。Store 游标在模型产生内容或成功返回后确认，明确目标也不重投，不重放原生历史；派工使用经理显式员工 ID。协议见 docs/22。

Store 拥有 roles 集合：名称＋纯文本提示词，员工经 有序 `roleIds` 多选绑定（可空数组），绑定校验存在性；Task 创建冻结整组 `roleSnapshots` 文本，沟通投递在发送/重试时嵌入，删除拒绝当前员工（含停用）引用并列出名称。HTTP 提供认证 `/api/roles` CRUD 与 bootstrap 摘要；Runtime 不持有角色状态。

Runtime 原始错误脱敏后保留，外部错误立即标记任务失败并等待原员工人工重试；10 秒巡检只推进非等待、非失败的任务。

沟通附件由 Run Files 保存在会话 attachments 子目录，Store 只冻结引用和摘要；认证二进制上传最多 20 MiB，下载验证归属/字节/摘要/链接。调用正文和提示词在私有 .agentforge 目录，通用事件只持引用，原生会话绑定在投递尝试元数据；分页 API 供共享控制台，不制造 Task/Run。

data-home.mjs 为客户端子服务提供统一的默认数据根 ~/.agentforge/workspace；数据库和 Run Files 按实例隔离于该根的 .agentforge，Runtime 配置保留私有配置目录，认证与启动资料留在 ~/.agentforge。宿主当前工作根优先，历史 Task/Run 路径不搬迁。Store 新 Task ID 使用随机 UUID，避免跨实例共享根目录时同毫秒/序号碰撞；HTTP/Store 命令不扩权，CLI 仅连接客户端。

插件安装在来源复制阶段展开同仓库/目录内的符号链接，断链、循环、越界和特殊文件精确报错且整批回滚；执行用不可变普通文件副本，运行期完整性校验不放宽。HTTP/CLI 使用同一路径，契约见 docs/15。

插件/MCP 目录与详情经 Store 的 extensionRemovals 过滤；认证 DELETE 验证已安装目标，再由 Store 检查当前员工引用、拒绝已删 ID 的新绑定并原子写入删除事件。Runtime 文件保留给冻结任务，不在 HTTP 层删除历史文件。

| 模块 | 职责 |
| --- | --- |
| `index.mjs` | HTTP 路由、认证、静态资源、SSE |
| `store.mjs` | 领域状态、命令和读模型 |
| `orchestrator.mjs` | 派工、协作、会话续接及执行 |
| `persistence.mjs` | SQLite 元数据 |
| `run-files.mjs` | 工作目录、执行内容、提示词和 Artifact 快照 |
| `workspace-git.mjs` | Git 状态、任务初始版本与 Diff |
| `auth.mjs` | 管理员、持久会话和登录限流 |
| `communication*.mjs` | 私聊、群聊、消息投递 |
| `history/` | 员工历史工具和派生查询索引 |
| `runtime/` | CLI、模型目录、Skill/MCP 与私有配置 |
| `data-home.mjs`、`data-reset.mjs` | 实例路径和显式数据清除 |
| `diagnostics.mjs` | 本机诊断日志 |

Store 拥有状态，Runtime 不直接写领域对象。平台执行员工和经理的协调决定，不核验业务质量、节点覆盖或文件证据；记录失败不作为拒收业务结论的理由。

任务摘要不包含 Runtime 日志；控制台按成员和游标分页，正文与提示词另行读取。读取文件时验证资源归属和完整性，避免展示错误内容。

工作目录 `content?download=1&path=...` 共用工作根、敏感路径和符号链接检查，以 attachment/octet-stream 流式返回完整当前文件，不受预览上限影响；传输错误进入诊断，不回写领域状态。

服务仅由客户端 IPC 携带 bootstrap 信息启动，固定 127.0.0.1、系统随机端口、实际 origin；普通 node 直接启动在存储初始化前拒绝，父进程断开即退出。不读取 .env/HOST/PORT/公开域名，不提供独立 Web 部署。所有 HTML 加入客户端样式。

认证工作目录 PUT 先验证非根绝对路径，再 mkdir 创建缺失父/子目录，核对实际位置和权限后由 Store 保存；失败保留原设置及诊断 cause，不清理目录或搬动旧任务。CLI 创建任务继续使用当前根，不新增设置命令。

扩展统一为插件级不可变版本：Git/本机来源中全部插件作为一个批次发布，失败不留下部分安装；自带 MCP 拆成独立市场项，不随插件启用。认证详情接口按需读组件/脱敏 JSON；员工输入仅 pluginIds/mcpIds，创建/编辑均可设置状态。stdio/SSE/Streamable HTTP 支持三种 Runtime。完整契约见 docs/15。

插件市场接受 Claude/Codex 市场中的本地条目及 HTTPS github/url/git-subdir 远程条目，保留真实 revision；不支持来源整批失败。组件按 Runtime 分别解析，API 返回 providers/compatibility 及原因，员工绑定由同一解析拒绝不兼容选择。配置根允许祖先正常别名、受管目录本身拒绝链接。含 cwd/env_vars 的 MCP 供 Codex/DeepSeek Harness 使用，工作目录由启动器应用。

手动重复导入由 HTTP 串行准备；Store 按同来源地址＋名称、MCP 按安装名称覆盖，Store.replaceImportedExtensions 事务更新当前员工（含停用）、合并重复引用并退役旧目录项。失败整批保留原状态，候选退役；冻结任务和排队调用的文件不变。回执包含 reference-only replacements/employees/historyRetained。

控制台展示已保存的公开 thinking 正文；敏感片段仍过滤，首尾空白与换行规范化不标为脱敏。历史正文为空时明确说明“未保存可显示的思考正文”，不以“已脱敏”占位，不补造未公开或未保存内容。

固定 Runtime 目录/部分更新与 Store 可用门禁见 docs/15；调用前校验 enabled，冻结模型事实不改。auth.mjs 签发父会话关联的独立 CLI 委托，退出或宿主重启失效，清除工作目录保留当前登录，正式端点与私有文件发布契约见 docs/14、18。

长任务的 Claude 后台等待使用原生生命周期，不以成功轮次后的安静误判执行失败。prompts 只投递必要上下文：成员消息来源与正文保留，内部路由元数据、空配置、员工选人说明及批量 Artifact 哈希不重复注入；交付证据按需查询，详见 docs/22。

经理回复缺少协调决定与决定字段不完整采用同一真实纠错路径；不让已完成 Trace、空队列和 running 状态静默并存，也不以正文代替领域命令。

固定 Runtime 增加 DeepSeek Harness；认证配置资源、Store 开关/冻结/会话确认、任务 Orchestrator 和普通沟通都调用独立 SDK 适配器。原生模型目录和连接测试共用真实配置，不另设 DeepSeek Harness HTTP 权限或存储 Token。MCP 安装/导入返回 DeepSeek Harness 兼容声明；专用 Hook/Subagent 组件不兼容，已有安装版本不迁移。

Runtime 展示名称为 Claude Code、Codex、DeepSeek Harness，内部 Provider/CLI 命令仍为 claude-code/codex/dsh。服务通过与执行相同的 CLI 环境检查可执行文件（不运行模型、不读取凭据）；Store 注入该只读事实，在 list/get 返回 installed 和实际 enabled。未安装或客户端 PATH 找不到可执行文件时 enabled=false、界面开关关闭并锁定，HTTP/CLI 拒绝修改 enabled 和发起新调用；安装检查不改写用户开关偏好、员工或 Task 冻结事实。安装/PATH 修复后重开客户端或重新进入 Runtime 设置重新读取；已安装但未登录不属于未安装。

submitHumanMessage 允许省略/null recipientAgentId，默认路由给冻结 Run 经理；显式成员校验和精确澄清回复优先规则保持。终态仅答疑、归档只读；HTTP/CLI 使用同一领域命令。

插件源标准兼容由 runtime/plugin-compatibility 及目标 Runtime 适配器负责；当前安装支持矩阵只读重算，Store 冻结摘要，HTTP/CLI 共用同一结果。契约见 docs/26。

插件/MCP 兼容机制由三种 Runtime 分别真实验证，入口 scripts/test-plugin-runtimes-real.mjs；详见 docs/26。

ai-minions/常见源 frontmatter 兼容按 docs/26 v3 处理：源文本和历史 v2 计划保留，原生私有投影规范化描述，目录中的格式异常只影响对应插件。HTTP/CLI 共享当前兼容结果与安全错误位置，不返回 YAMLException.mark.buffer 或完整 Skill 正文。

插件导入将组件格式错误与来源完整性错误区分：前者返回定位 warnings 并安装有效部分，后者仍原子失败。员工角色改为有序 roleIds/roleSnapshots，HTTP 拒绝旧 roleId 写入；历史单角色快照保留。

员工当前配置只允许 business/manager，HTTP/CLI 拒绝 developer/repository；新任务仓库字段为空、所有成员从 Run 根启动，仓库说明由提示词承载。历史任务的 repositoryMode/sources/bindings 仍由原冻结规则执行；不启动迁移、不改写旧任务。

`server/task-patrol.mjs` 每 10 秒检测运行元数据。存在执行中的 Trace/Dispatch 或正在准备的执行时跳过；已有可执行队列则继续队列；运行中没有执行者和待执行交接时，由 Store 创建经理巡检投递，异步调用 Orchestrator。单飞覆盖准备阶段，定时器不等待模型。错误、等待人类澄清、暂停、验收及结束不会触发经理推进；终态已有独立答疑队列仍可执行。经理根据状态和角色沟通记录继续协调，平台不评价业务结果。

外部服务、鉴权、额度等 Runtime 错误立即停止原投递，Run 标为 failed、Task 标为 blocked；暂停与原生会话确实丢失时的一次重建按各自协议处理。错误期间禁止发送消息或 @ 其他成员，只能由人类重试原失败投递。重试保持员工、原生会话、消息引用、咨询链、累计 attempts 和失败 Trace，并在本轮输入动态加入“继续”，不创建协作消息。原投递优先领取，其他待执行投递保留。没有实际失败投递的工作区准备错误保留原队列，空队列才由经理启动。

员工问题报告、修复和验证全部采用角色 Message。Store 不再创建/更新独立问题清单，拒绝旧清单结果字段；HTTP 删除独立列表接口，工作区和执行摘要移除相关字段；历史原文不改写。

Codex 在 Provider 确认 thread.started 之前出现明确鉴权/未登录错误时，JSONL 与 app-server 调用立即失败并释放进程；此时控制台没有原生会话 ID 是真实事实，不使用应用占位 ID 续接。JSONL 的连续错误事件计入有上限的重试等待，不会无限重置空闲计时。已确认会话的 Provider 原生恢复仍按最终成功/失败结算。登录修复后，手动重试启动新的 CLI 进程读取当前账号状态，无需删除员工；已有已确认会话继续原 ID。

沟通失败保留原消息、投递和调用历史，nextAttemptAt 为 null，不由轮询自动重试。失败消息下提供“查看控制台”和“重试”；重试使用当前员工配置，未确认原生会话时创建真实新会话，已确认时续接。同员工 FIFO、其他群成员并行及服务重启恢复在途调用保持原规则。

任务执行内置 PostToolUse Hook 经调用级私有 socket 触发 Run Files 登记动态克隆仓库；基准只取明确 clone reflog 起点，私有持久记录不随提交/重试更新。CHANGE 与 diff 动态发现并按最深仓库归属比较；缺少起点明确提示仅未提交差异，读取/轮次结束补查，无额外协作消息或自动 Git 写操作。

自动化配置和分页触发历史由 automations.mjs 提供 Store commands；automation-schedule.mjs 计算下一时间，automation-scheduler.mjs 10秒检测并异步执行。Task 来源冻结、人类路由门禁、前轮事务确认见 docs/27。普通任务优先级已移除。

PUT /api/runs/:id/members 经认证交给 Store 更新当前成员投影，不隐式启动执行；冻结历史保留。communication-store 的成员 running 来自该会话全部运行中投递，不依赖消息分页。

任务和自动化共用可选工作流语义：未选使用固定默认协作快照。自动化配置和预览接口拒绝 timeZone 输入，使用本机当地时区；生成标题带当地日期和时分秒。Runtime 诊断正文保存在受认证内容通道，事件仅保留摘要。

自动化任务标题统一为 `自动化名称#yyyy-MM-dd HH:mm:ss`（当地时区、24 小时制；定时取计划时刻，手动取触发时刻）。触发列表首列展示真实任务标题；HTTP/CLI 的触发回执、列表和 latestTrigger 返回 taskTitle，未生成任务为 null；不重写历史任务名称。

同任务并行：经理通过 `managerDecision.assignments` 一次向不同员工发送独立指令，`wait:true` 等待其他工作。Store 按成员领取且同成员串行；Orchestrator 一次准备、多个 Worker，新增消息唤醒领取。任一业务调用失败阻止新工作，但保留其他在途成员的结果与交接；重试原投递及其咨询链，不提前释放其他队列。验收前必须清空在途和排队工作（旧平台 deferredRevisit 可结算）。暂停/终止覆盖 Run 全部进程，失败任务也可终止。

沟通附件 GET 的 `preview=1` 分支在既有归属与完整性校验后按位图签名提供 image MIME；非位图返回 415，普通附件仍下载。鉴权、no-store/nosniff/CSP 和原文件记录保持，契约见 docs/17。

插件/MCP 目录摘要在 Store.registerExtensions 中登记，由 configuration-store 的私有 JSON 保存；queryExtensions 对缓存摘要搜索分页。persistence 协调 JSON revision 与业务绑定，导入、编辑、更新、软删除和全员工当前解绑保持提交一致性，不碰冻结事实和文件。

任务协作上传共用认证二进制入口与位图预览；Run Files 保存原字节，Store 保存同 Run 引用，orchestrator 在投递前核验附件并传递绝对路径。调度上下文和工作目录/Artifact 查询不再构建全量 getRunWorkspace；深拷贝移除 JSON 字符串中间结果，避免长任务重复展开员工配置导致 Invalid string length。

角色扩展内部保存按Provider解析引用，配置API仅返回选择ID；Store在任务和沟通快照中合并员工直接扩展与角色扩展。市场替换及删除同步当前角色关联。停用自动化删除先退出执行并暂存Run文件，再原子删除相关记录。

性能路径：Store → state-journal 实体逆操作/脏集合 → persistence 同步原子小事务。历史内容按 ID 延迟加载，目录/协作/日志使用索引分页；history 派生库以提交水位增量同步。execution-budget 只在编排层管理任务与沟通资源准入，diagnostic-writer 负责有界异步日志，file-fingerprints/attachment-thumbnails 负责文件摘要和派生图片。边界与缓存规则见 [docs/28](../docs/28-performance-architecture.md)。

派工协议：单人 nextNodeId/nextAgentId/instruction 与 assignments 共用 enqueueManagerAssignments。原子路由拒收只回滚投递/咨询/验收，实际报告与文件仍记录；rejectDispatchRouting 保存具体错误到原投递，允许一次原会话纠正，重复拒收失败并由人类继续。Provider 故障不走此纠正。合法验收遇到在途工作使用 deferredRevisit，领取须等待其他工作结束且不阻塞后续经理消息。

首次保存快照内集合时先完整物化，不能把“脏日志为空”当成“集合已落盘”；实体/事件初始化标记与主快照删除数组同事务提交。`state-journal` 回归覆盖已有安装 ID 的冷启动与再次重启。


极简工作流画布与CLI共同提交节点description/position和edges。Store统一校验/规范化连线及派生节点关系，普通交接可返工回路，前置依赖禁止成环；不执行连线正文条件。Run Files按每次经理Trace从任务冻结定义生成0600且排他创建的workflow.md；Orchestrator将文件引用交给纯prompt组装，生成失败按原投递失败处理，不注入全图或改用当前模板。新节点正文进入员工当前职责增量。

工作流分支：nodes.type=process/condition，edges.condition为自然语言条件（最多2000字符），默认流程/空条件；App/CLI同协议并冻结。条件节点菱形、经理选择满足条件的一条分支；预览返回保留画布有效尺寸。test-workflow-editor覆盖反复切换、宽窄布局、类型切换与分支保存回读。

同一轮包含 `summary` 与 `consultation` 时，先将非空且与问题正文不同的报告保存为普通角色 Message，再保存问题和等待关系；两条消息关联同一 Trace/本轮输入。缺少报告或正文与问题相同不另造消息，协调失败仍回滚路由并保留原报告；不从控制台补造旧 Message。

任务必须显式managerAgentId，从最终active成员中选一位，不按员工kind推断。Task冻结经理原配置，Run继续独立经理别名/sourceAgentId与会话；新增其他成员不按kind拒绝，当前经理不可移除。自动化保存/更新/触发同一字段，配置版本与历史Run不联动。
runtime/mcp-tools.mjs通过已安装不可变配置与现有mcp-launcher建立短连接，仅initialize/tools/list；15秒超时、成功60秒缓存、并发合并/上限和工具体积边界，finally关闭。POST认证tools入口校验当前目录项，CLI/UI共用，详情失败独立于配置读取。

workflow当前写入及新Task冻结模板时校验process最多一出口，condition允许分支；sourcePort/targetPort仅接受四边枚举。读取现有模板与冻结历史不转换、不改写；更新失败保持原记录。

Runtime 固定目录与本机安装门禁覆盖九项；任务/沟通/探测复用 runRuntime，Store 仅保存配置和已确认会话，OpenCode ses_ 标识不再因下划线被拒绝。新增适配边界见 docs/29。

工作目录 content?media=1 的 GET/HEAD 使用 Run Files 视频描述符，单段 Range 返回206/416；保护认证及文件边界，有界流与断连清理，不转码。Runtime 保存的 model/effort 与 App/CLI 共用原生目录。

工作目录由宿主启动参数提供，生产 Store 以当前启动工作根分配新任务，不再让旧库内工作目录设置覆盖它。数据库、Run Files、Runtime 配置同盘；认证及 Git 凭据独立。HTTP storage 查询/修改先冻结调度与写入，再通知唯一 IPC 父进程停机整理；Runtime 与目录读取只解析受管资源地址，不变更冻结事实。数据清理包含独立 Git 凭据，日志实例以稳定认证位置标识；完整协议见 docs/30。

当前存储归属以 [配置目录与工作目录](../docs/30-storage-layout.md) 为准：配置、认证、Runtime、插件/MCP 清单及源文件保存在 `~/.agentforge`；员工、角色、团队、工作流、自动化、任务与沟通及执行内容保存在工作目录，默认 `~/.agentforge/workspace`。清除所有数据删除整个当前工作目录，保留配置和登录。插件/MCP 列表与 Runtime 设置使用私有 JSON，SQLite 只存业务关联及配置提交 revision。

员工启动目录：新普通任务与自动化采用 `<工作目录>/tasks/<TaskID>/<RunID>`；沟通采用 Store 首次分配并持久保存的 `<工作目录>/communications/<会话ID>`，群聊成员共享文件目录但原生会话独立。既有任务路径不重写，已分配的沟通目录不随工作根切换；目录变更重建模型上下文并保留聊天历史。内部附件、提示词和执行内容仍由 Run Files 管理，详见 docs/30-storage-layout.md 与 docs/17-communication.md。

业务记录统一位于 `<工作目录>/records`：数据库、历史索引及 runs/communications 执行正文与校验记录共享此根；沟通 cwd/上传附件在 `<工作目录>/communications/<会话ID>`。不再创建 `.agentforge/desktop/agentforge-runs`；配置仍在 Home。路径与目录切换契约见 docs/30。App/CLI storage get/update 使用同一 HTTP 定位，不直接读取数据库。

工作目录定位只持久化 workspaceRoot，records 路径固定由 workspaceRoot/records 推导；storage.json 不接受 businessRoot。App/CLI 返回的 businessRoot 为只读计算结果，开发实例通过独立工作根隔离，见 docs/30。

## 提示词输入精简

输入精简：巡检复用成员消息回执，群聊不复制本人旧回复，沟通在原生会话确认及模型活动后确认接收，失败续接只引用已读目标。经理状态按实体ID投递增量；超过4096字符的正文由 prompts 生成计划，Run Files 写入私有内容寻址 input-materials，调用前失败即停止。冻结 workflow.md 同时保留 Trace 证据与 Run 稳定读取入口。App/CLI 配置和业务查询协议不变，详见 docs/22。

## 共享协作输入与报告通知

Run 全员在下一次合法调用自动补齐未读公开消息；本轮处理消息 ID 与背景阅读回执分别表示待办和已读。经理队尾未尝试的员工报告通知合并，人工指令/咨询/重试不合并，所有来源同一次真实投递。输出 summary 是完整正文，正文加尾部 JSON 时保留前文，不用短摘要替换。详见 docs/22。

## 业务按需初始化

`index.mjs` 的认证/health/静态页先就绪；`ensureBusiness()` 合并首次业务请求和十秒后台检测，恢复执行后启动原调度器。纯配置 GET 使用配置文件，不打开业务库。初始化错误保留阶段诊断并返回业务 503，不重试扫描或阻断登录。`persistence.mjs` 的懒集合同时延迟 ID/顺序与正文；未访问历史不会因其他集合提交被加载。`configuration-store.mjs` 的只读视图不会调和 pending revision 或写文件。

沟通可根据用户要求直接执行操作，不设置仅讨论、不修改文件或系统配置的限制。复杂、需要多人协作或持续跟进的工作可以提醒用户创建任务；是否创建由用户决定，不作为继续处理的前提。私聊 reply、群聊 mentionAgentIds、真实附件路径、来源规则和原生会话续接保持不变；既有会话下一次调用使用当前应用提示词，不重建或清除历史。

草稿编辑由 Store.updateTask 统一校验，经认证 PUT /api/tasks/:id 暴露；复用 buildTask 候选验证与当前选择快照，事务保存同一 Task 身份与工作目录，只有未启动的普通 backlog 且无 Run 可编辑。成员替换/空值/不可用选择与 App/CLI 同源；保存不执行，启动是后续独立命令。

插件导入同时接受根或 skills/<目录>/SKILL.md 裸 Skill，自动一 Skill 一插件且不改来源；保持名称/完整描述、支持文件、来源提交和既有更新/冻结语义。HTTP url/path 输入及回执不变，详见 docs/15、26。

Skill allowed-tools/allowedTools 是可选元信息，平台兼容性计算不再据此拒绝。原文与投影保留；App/CLI 共用现有 compatibility 刷新端点更新旧目录摘要，其他校验及冻结历史不变。

Store.subscribeNotifications 发布未来已提交的任务待验收/完成及员工沟通新消息元数据；事务回滚丢弃、监听异常隔离、关闭 Store 清理，不新增持久事件或扫描历史。index 只向当前自有桌面 IPC 透传，系统通知失败不改业务结果。通知不含正文、附件、Trace 或提示词，边界见 docs/18。
