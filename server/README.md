# 控制面

createTask 的 teamIds 只是创建时选人输入：Store 校验团队 active，展开其中 active 成员，与显式 memberAgentIds 合并去重；显式停用成员仍拒绝，最终恰好一位经理。任务仅持久化独立成员及冻结快照，团队后续变化不联动任务。不再使用任务优先级；CLI --start 顺序调用既有创建/启动 HTTP，不新增调度规则。

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

data-home.mjs 为客户端子服务 提供统一的默认任务根 ~/agentforge；应用数据仍按实例隔离于 ~/.agentforge。保存的工作根优先，历史路径不搬迁。Store 新 Task ID 使用随机 UUID，避免跨实例共享根目录时同毫秒/序号碰撞；HTTP/Store 命令不扩权，CLI 仅连接客户端。

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

固定 Runtime 目录/部分更新与 Store 可用门禁见 docs/15；调用前校验 enabled，冻结模型事实不改。auth.mjs 签发父会话关联的独立 CLI 委托，退出/重置/重启失效，正式端点与私有文件发布契约见 docs/14、18。

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

任务和自动化共用可选工作流语义：未选使用固定默认协作快照。自动化配置和预览接口拒绝 timeZone 输入，使用本机当地时区；生成标题带当地日期。Runtime 诊断正文保存在受认证内容通道，事件仅保留摘要。
