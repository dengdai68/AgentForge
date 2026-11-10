# 系统架构

Store 拥有任务独立成员、唯一经理及逻辑删除规则；团队仅是批量选人的配置集合，不参与 Run 调度。Task/Run 冻结事实与当前目录可见性分离；删除员工或团队不会改写运行中的成员、消息及会话。群聊同样独立保存成员集合，详见 [领域模型](03-domain-model.md) 与 [长期沟通](17-communication.md)。

群聊使用 `kind=group`、独立 `name` 和 `memberAgentIds`；每次创建产生新会话，即使成员相同也不复用团队群。可修改名字与成员，添加团队仅批量加入员工。私聊继续按员工复用，已删除员工的私聊从列表隐藏，原历史不删除。旧团队会话保留原消息/会话 ID；读模型从已记录成员事实读取，显式编辑/删除团队或员工时脱离旧团队标识，保存独立成员，不进行全库迁移或重置。

Store 拥有员工逻辑删除、成员校验和公开消息的定向投递；HTTP 暴露同一命令，Runtime 只执行会话。

协作记录只展示员工、经理、人类之间的沟通 Message；系统提示、启动、投递、重试和结算事件不作为记录行。底层不可变事件、Dispatch 和 Trace 继续保留，关联执行元数据供查询。消息保存本轮 `startMessageId`，对应 Trace 的 `inputMessageId`；“本轮控制台”按该 ID 打开、定位本次提示词，不受日志分页影响。成员原生会话贯穿任务且彼此隔离，每次执行拥有独立输入轮次 ID。 sourceMessageId 由 Store 校验同 Run；共享投影供 Web/Electron 与 CLI 使用，不按正文或时间猜测关联。

本仓库为 AgentForge App 独立客户端，完整抽取边界见 [ADR：客户端抽取](23-desktop-extraction.md)。默认 start/dev 启动 Electron，自带本机控制面与全部界面；服务要求父进程 IPC 与 bootstrap 信息，不能直接启动；父进程断开时退出。

工作目录展示由 Run Files 直接读取真实任务根，取代 manifest 白名单；HTTP 按 path/offset 每页200项，界面按需展开。工作流只提供交付位置建议，Store 校验规范相对路径，CLI同步，未提供时不填 docs。Orchestrator 采集各业务路径的有限不可变快照，CHANGE 通过只读 Git 观察已提交/未提交/未跟踪文件；大媒体不因快照上限从目录/CHANGE消失。不新增索引库、文件监控服务或自动提交。

插件定时更新决策：复用本机服务生命周期和 Node 定时器，不新增系统 cron、常驻守护进程、队列或依赖。服务运行期间默认每120000ms检查，上轮结束后安排下一轮，不重叠；开关与1–1440整数分钟周期（默认2）由 Store 持久保存，设置入口独立于插件市场，检查状态/最近结果仅为当前服务进程观察。按安装来源分组，使用真实 Git 提交及外部 ref/sha 依赖判断变化；无变化不克隆/安装、不写审计。新候选经完整校验与全部当前选择者兼容检查，再由一个 Store 事务替换该来源插件引用；失败保留该来源旧版，其他来源可继续。安装不执行来源脚本/Hook，自动检出的临时源码用后清理，已冻结安装文件不删除。重置时阻止与活动更新并发，重置后清除检查状态。

原生 Skill 传输决策：完整插件安装/员工选择协议不变。Claude 使用既有 --plugin-dir 原生 Skill，不全局禁用。Codex 仅在有所选 Skill 时使用调用独占的 stdio App Server：额外根注册、原生发现、线程级启用列表、thread/turn 执行；无 Skill 的 exec 不作无关迁移，二者共用 Provider thread 身份和控制台投影。这是能力驱动的传输选择，不是旧数据兼容或失败回退。单次进程避免共享工作目录员工混用进程级根；取消/超时清理自有进程组。不新增服务、依赖、凭据副本或领域状态来源，最终完成仍由人类确认。

server/prompts.mjs 分离应用系统指令和当前输入：完整工作流仅经理持有，执行环境进系统层。Store 保存成员平台消息输入游标及上下文摘要，模型产生内容/成功返回后确认送达，后续只追加新消息和变化上下文，原生会话拥有对话历史，不重放 transcript。Runtime 分别适配 Claude 系统追加文件和 Codex developer_instructions，详细协议见 docs/22。

Runtime 外部故障立即保留脱敏原始错误并标记任务失败，禁止新消息；修复后在客户端重试原员工投递和会话，CLI 不新增恢复权限。只有确认的原生会话丢失允许重建一次；经理非终止安排仍尊重已有投递，验收后的协调跟进结算只保留审计事件。

沟通工作台复用任务控制台 renderer 和按需内容读取器，但以 Conversation/Delivery/attempt 为归属。HTTP 接受同源认证二进制附件，Run Files 保存会话原文件和私有执行内容，Store 只保存元数据、消息关联与调用事实。控制台只在展开时按成员/50 条事件分页轮询，历史按 Map 分组，不重复扫描全事件。现有 CLI 未覆盖长期沟通，本轮不扩展 CLI 权限或命令；配置与任务协议不变。

CLI 仅供客户端使用，私有 endpoint 发现与实例校验统一在 cli/client.mjs；不接受 Web/Desktop 目标，不默认连接 4310。应用数据根仍隔离；默认任务根统一为 ~/.agentforge/workspace，由 server/data-home.mjs 的纯路径函数供客户端自有服务使用。保存的工作根和历史路径不改写。新 Task ID 使用随机 UUID，避免独立实例共享工作根时因毫秒/进程序号相同而碰撞，不增加平台子目录。

```text
Electron renderer / CLI
        │ HTTP + SSE
server/index.mjs ─ auth.mjs
        │
      Store ─ SQLite
        │
  Orchestrator ─ Run Files / Workspace Git
        │
      Runtime ─ Claude Code / Codex CLI
```

## 分层

- 客户端界面/CLI 发命令和展示结果；Electron 另外拥有窗口与自有子服务。
- HTTP 负责认证、路由、输入边界和资源读取。
- Store 拥有 Task、Run、Trace、Message、Dispatch 等持久状态与命令。
- Orchestrator 执行经理的协调决定、调用员工、投递消息和记录事实。
- Runtime 只适配本机 Provider，不能直接更改领域状态。
- Run Files 保存文件快照，SQLite 保存元数据；Workspace Git 提供源代码差异。

平台不按业务质量、节点覆盖率或文件证据改判员工结果，不增加自动收尾复核。

## 实例

Electron 自有子服务只绑定 127.0.0.1 随机端口，鉴权仅接受实际 origin。所有 HTML 始终包含客户端样式，不按 User-Agent 切换产品模式。没有独立 Web 部署入口，认证 HTTP 仅为本机客户端/CLI 所需。

源码和安装版的默认数据根见 [桌面文档](18-electron-client.md)。HTTP API、静态应用、SSE 与文件资源经过同一认证入口。

统一存储根由认证 HTTP 接受路径、预留空闲锁，再由拥有子服务的 Electron 宿主停机整理；Store 不参与文件搬运，Runtime 不选择数据盘。数据库、执行资料与扩展同盘，认证/启动定位与运行日志保留私有本机位置。storage.json 先于数据库解析；不可用数据盘明确失败，不新建替代实例。任务创建从当前启动根分配路径，已存在 Task/Run 路径不改。App/CLI storage get/update 共用相同忙碌拒绝与已接受重启回执。地址解析不改冻结内容，决策与验证见 [docs/30](30-storage-layout.md)。

扩展目录约定：Runtime 根中的 `installed-plugins/<批次ID>/plugins/<版本ID>/plugin/` 保存完整插件，批次 `mcps/` 保存拆分 MCP，`marketplace/<版本ID>/` 保存手动 MCP。SQLite 只冻结不可变引用/摘要。完整插件不拆成可单选 Skill；一个来源整批原子发布，不自动启用。详见 docs/15。

## 执行和恢复

### 扩展批次与传输适配（本轮）

完整来源在 `installed-plugins/<批次ID>/` 内同时准备插件和拆分 MCP，最后一次目录 rename 原子发布；目录索引从批次清单读取，不引入第二套数据库权威。插件仍为员工选择单位，拆分 MCP 为独立选择单位。原文件和派生加载文件一起冻结目录摘要，避免源目录修改影响已发布版本。

MCP 传输直接复用现有 `@modelcontextprotocol/sdk` 的 stdio/SSE/Streamable HTTP，不引入全局安装器或新的网络服务；私有启动器仅在员工执行生命周期内桥接，凭据留在私有文件而非 CLI 参数。跨来源重定向不携带服务鉴权。Claude/Codex 插件清单按同一包模型解析，Provider 专有能力通过执行参数/文件投影适配，不把格式转换等同于能力等价。

Dispatch 持久化投递与尝试状态；Trace 记录一次实际调用。失败保留原始事实，重试创建新的执行记录。人工恢复由 Store 重新排队原失败 Dispatch，并优先交给原收件员工；复用原成员会话与投递上下文，不从经理重新派工，也不取消其他待执行投递。启动恢复把被中断的调用记入历史，并根据持久投递恢复可继续的工作。桌面退出会停止其自有后台与执行进程，不保证离线继续运行。

## 展示性能

任务摘要排除 Runtime 日志，控制台使用成员分页接口。执行正文、提示词、文件、Diff 和图形资源按需读取。协作数据目前随任务摘要返回，UI 分批渲染，尚未实现服务端协作游标分页。

### 仓库开发 Skill 的边界

`.codex/skills/agentforge-development/` 是本仓库 Codex 开发辅助入口，按用户要求随源码维护，不进入运行时插件目录、员工提示词、模型上下文协议或安装包。它只将开发任务路由到既有 AGENTS、设计契约与验收脚本，不建立第二套贡献规则，也不授予发布或操作真实任务的权限。

Runtime 固定目录和当前可用门禁归 Store，HTTP/CLI 只接受模型、档位、enabled 部分更新；Orchestrator 与沟通服务调用前核对开关，不终止已执行 Provider。CLI 登录共享由 Electron 宿主经认证端点获取父会话关联委托并发布私有实例文件，认证层逐次验证父会话；CLI 不直接读取 Chromium 或数据库。此设计复用现有目录、HTTP 和宿主能力，不新增依赖或通用桥。

经理协调调用缺少 managerDecision 或缺少 nextNodeId 时，保留原报告并复用真实 routing: 协调纠错投递，要求经理明确派工/咨询/提交验收；不静默耗尽队列、不从自然语言推断验收。普通员工文字交接及 inquiry 答复规则不变。

桌面应用更新采用现有 electron-builder 配套的 electron-updater 与显式 semver 依赖，不自建应用替换服务。更新生命周期只属于宿主，Store/CLI不拥有更新状态；正式发现、临时签名手动安装及签名原生安装、原子空闲锁与CI交付契约见 [架构决策：应用更新](24-desktop-updates.md)。

DeepSeek Harness 使用独立 SDK JSON-RPC 适配器 dsh.mjs；dsh-plugin.mjs 作为每次调用的私有原生 Cordis 插件提供 system-role 指令与模型元数据，不进入 renderer/HTTP 控制器。会话目录归 AgentForge Runtime 配置根，凭据由 DeepSeek Harness 原生服务从原 DSH_HOME 读取，不解析/复制密钥。SDK session/wait 结束全部托管后续工作后才结算；Store 仍拥有身份/任务状态。决策见 docs/25。

Runtime 展示名称为 Claude Code、Codex、DeepSeek Harness，内部 Provider/CLI 命令仍为 claude-code/codex/dsh。服务通过与执行相同的 CLI 环境检查可执行文件（不运行模型、不读取凭据）；Store 注入该只读事实，在 list/get 返回 installed 和实际 enabled。未安装或客户端 PATH 找不到可执行文件时 enabled=false、界面开关关闭并锁定，HTTP/CLI 拒绝修改 enabled 和发起新调用；安装检查不改写用户开关偏好、员工或 Task 冻结事实。安装/PATH 修复后重开客户端或重新进入 Runtime 设置重新读取；已安装但未登录不属于未安装。

插件自动更新仍通过 Marketplace 准备不可变候选、Store 原子更新员工绑定；组件定义错误的 warnings 随候选结果进入检查状态，由更新区域提示并在插件详情查看。来源/完整性等致命错误保留当前版本，冻结任务与排队投递不改写。

`server/task-patrol.mjs` 每 10 秒检测运行元数据。存在执行中的 Trace/Dispatch 或正在准备的执行时跳过；已有可执行队列则继续队列；运行中没有执行者和待执行交接时，由 Store 创建经理巡检投递，异步调用 Orchestrator。单飞覆盖准备阶段，定时器不等待模型。错误、等待人类澄清、暂停、验收及结束不会触发经理推进；终态已有独立答疑队列仍可执行。经理根据状态和角色沟通记录继续协调，平台不评价业务结果。

员工发现问题、修复和验证结果通过协作 Message 记录和交接；平台没有独立问题清单或关闭状态，不根据问题数量控制任务推进。Store 拒绝已废弃的清单输出字段；HTTP 移除独立清单接口，历史索引不再投影该集合。

任务执行内置 PostToolUse Hook 经调用级私有 socket 触发 Run Files 登记动态克隆仓库；基准只取明确 clone reflog 起点，私有持久记录不随提交/重试更新。CHANGE 与 diff 动态发现并按最深仓库归属比较；缺少起点明确提示仅未提交差异，读取/轮次结束补查，无额外协作消息或自动 Git 写操作。

自动化调度与普通任务执行共用 Store → Orchestrator → Runtime。单独10秒调度器只检测/领取并异步执行，不等待模型；Store 事务原子创建 Task/Run、确认前轮并记录触发去重键，重启恢复现有 Run。引入 cron-parser 5.4.0 计算时区/DST，无新服务；依赖决策和离线策略见 [自动化](27-automations.md)。

Orchestrator 每轮按 removedParticipantIds 过滤当前派工名单；已有执行保留原提示，忙碌成员不可移除。

同任务并行复用现有 Dispatch、成员原生会话和 Node 异步调用，不引入队列服务/依赖。每个 Store/Run 单飞覆盖准备与调度，Worker 按成员独立运行，完成或新输入唤醒领取；同员工 FIFO，经理可处理部分返回结果并继续派工。Store 原子验证批量 assignments；平台只判断投递/执行是否未结束，不判断业务依赖或验收质量。一个成员报错立即停止新领取，在途成员收尾；重试期间只允许原投递及其咨询链，其他失败逐一恢复后再放行队列。

沟通媒体展示由 renderer 管理；HTTP 附件 preview 分支负责认证、归属、完整性与位图类型校验，Run Files 继续保存原字节，Store 不新增媒体状态。具体端点见 docs/17-communication.md。

插件/MCP 当前目录归 Store/SQLite；Runtime 只准备不可变文件并返回摘要。HTTP 在同一 Store 事务中登记目录、替换绑定与软删除旧版本。列表用数据库分页，详情/实际绑定按条读取 Runtime 文件；自动更新从数据库取活跃目录。见 docs/15 与 docs/07。

长任务调度按需读取：getRunExecutionContext 只投影最近18个 Trace 状态、未结束投递、基线所需文件摘要、最近30条巡检消息和待答问题/决策；源消息和输入游标单独查询，不展开 UI 工作区或全量运行事件。工作目录/Artifact HTTP 查询同样使用 getRunTask/getRunArtifact。原生上下文压缩告警不等同于应用编排 RangeError；不同 runId 的日志按运行归属排查。

## 有界读写与资源准入

采用 [性能架构决策](28-performance-architecture.md)：Store 用可回滚实体变更集，SQLite 原子保存变化实体及水位，提交后通知；历史正文按需加载。目录服务端分页、协作消息游标分页，renderer 不加载全部历史再切页。任务/沟通共用实例总并发及 Provider 子额度，公平排队、取消与释放均属编排层；10 秒检测通过小批次触发异步执行。诊断 Worker、文件流及字节缓存管理资源，不新增领域状态所有者或第二数据库服务。

协调拒收属于 Store 状态：单人与多人派工归一到同一原子命令，Orchestrator 不吞掉拒收异常。实际报告/文件与路由是否生效分别记录；routingError 将具体原因带回原成员当前输入，最多一次自动格式纠正，重复拒收转 failed，外部错误仍人工恢复。合法验收因其他执行/排队未结束而延后，不算协议错误；延后投递不阻塞其依赖的报告。详见 docs/03、22。


极简工作流沿用X6与认证配置HTTP；画布只编辑节点/连线，Store拥有规范化、校验和Task冻结。client/workflow-description.mjs是共享纯Markdown投影；Run Files在经理Trace启动前写入workflow.md，Orchestrator只传文件引用，prompts不访问文件或Store。无法生成文件时原投递失败，不退回内联当前模板。工作流不是新增调度引擎，既有协调决定、咨询和验收边界保持不变。

同一轮包含 `summary` 与 `consultation` 时，先将非空且与问题正文不同的报告保存为普通角色 Message，再保存问题和等待关系；两条消息关联同一 Trace/本轮输入。缺少报告或正文与问题相同不另造消息，协调失败仍回滚路由并保留原报告；不从控制台补造旧 Message。

经理是Task的显式managerAgentId，不是Agent.kind分类。Store验证属于所选active成员并冻结，Run保留独立经理别名、sourceAgentId和会话；Orchestrator/Prompt依据Run身份协调。自动化持久保存选择、每次触发创建同协议Task，不重写在途身份。MCP工具发现为runtime适配器，只通过已安装不可变配置执行initialize/tools/list，HTTP认证和目录有效性仍由控制面/Store负责，缓存仅成功元数据且限60秒/64项/16MiB，4并发、15秒超时；不进SQLite，不影响市场分页和业务执行，不调用具体工具。

工作流呈现共用web/workflow-layout.mjs：局部ELK仅决定坐标，正交几何与视口控制不参与任务状态。Store在当前workflow写入及新Task冻结入口执行process单出口规则；四边端口是可选呈现元数据，App/CLI通过同一HTTP保存。历史冻结图保留原事实，只读整理不写回。

新增多 CLI Runtime 的架构边界见 [docs/29](29-runtime-providers.md)：共享目录和单一执行分派，复用现有执行生命周期；不新增任务引擎，不把 Runtime 事件当作业务验收。

六种新增 Runtime 的扩展适配决策见 docs/29：市场拥有源解析/不可变安装/兼容计划，Store 拥有当前目录摘要与冻结绑定，portable-extensions 仅生成原生调用配置。复用既有 MCP 私有启动器和历史桥，不引入第二套工具协议、模型客户端或全局安装服务；兼容性检查通过受认证命令更新目录派生数据，列表仍为数据库分页。

当前存储归属以 [配置目录与工作目录](30-storage-layout.md) 为准：配置、认证、Runtime、插件/MCP 清单及源文件保存在 `~/.agentforge`；员工、角色、团队、工作流、自动化、任务与沟通及执行内容保存在工作目录，默认 `~/.agentforge/workspace`。清除所有数据删除整个当前工作目录，保留配置和登录。插件/MCP 列表与 Runtime 设置使用私有 JSON，SQLite 只存业务关联及配置提交 revision。

员工启动目录：新普通任务与自动化采用 `<工作目录>/tasks/<TaskID>/<RunID>`；沟通采用 Store 首次分配并持久保存的 `<工作目录>/communications/<会话ID>`，群聊成员共享文件目录但原生会话独立。既有任务路径不重写，已分配的沟通目录不随工作根切换；目录变更重建模型上下文并保留聊天历史。内部附件、提示词和执行内容仍由 Run Files 管理，详见 docs/30-storage-layout.md 与 docs/17-communication.md。

## 提示词输入精简

提示词大正文由 prompts 纯函数返回资料计划，Orchestrator/communication 在 Provider 调用前交 Run Files 物化。records/runs/<RunID>/input-materials 与 records/communications/<会话ID>/input-materials 使用 SHA256 文件名；Run Files 拥有路径归属、排他创建、权限及完整性校验，SQLite 不复制文件正文。工作流同时保留逐 Trace 冻结证据与 Run 级 workflow/<SHA256>/workflow.md 稳定读取入口。写入失败停止本轮，不回退内联或截断；Runtime 只接收既有指令通道与实际资料目录。

## 共享协作输入与报告通知

Store 选择 Run 全部未读公开消息并管理当前处理消息引用，Orchestrator 同步捕获消息水位后才异步读取附件；不让新消息越过回执。队尾未领取报告通知由 Store 合并，原生会话仍串行、其他成员仍并行。客户端共享投影将合并的每条明确来源关联到同一个投递；不从正文、角色名称或时间猜测关联。

## 登录就绪与业务就绪

本机服务先建立认证、静态界面与 IPC ready，不创建业务 Store。首个认证业务请求或管理员已配置后的十秒后台检测触发同一个初始化 Promise；顺序完成数据重置恢复、Store 打开、删除恢复、投递恢复与调度器启动。调度不依赖用户打开页面。失败保存原始阶段诊断并对业务接口返回 503，不循环重建；登录、health、连接视图和纯配置读取保持可用。子服务 cwd 为配置目录，员工启动目录仍由任务/沟通协议决定。宿主仍检查已保存的数据盘定位，避免断盘时静默创建新实例。

初始化只枚举集合名称和小配置快照；各业务集合的 ID/顺序及正文分别按首次访问加载。分页读模型继续使用 SQL 限定查询，未访问的产物/事件不因其他集合保存或提交而加载。执行恢复只读取必要的运行、投递、会话状态；存在真实待恢复执行时允许加载其所需记录。此决策复用原 Store、SQLite、定时器，不增加缓存库、服务或兼容迁移。

系统通知沿用自有子服务 IPC：Store 成功提交后发布有界元数据 → index 透传 → Electron 校验身份/当前登录并显示原生通知。无全量历史扫描、数据库轮询、第二事件库或 renderer 通用通知桥；系统失败不回滚业务。页面 toast 使用浏览器顶层 Popover，解决原生 dialog 不受普通 z-index 约束的问题。实现和生命周期见 docs/18 与 docs/06。
