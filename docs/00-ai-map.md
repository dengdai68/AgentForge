# 代码导航

任务创建：app.js 的 newTaskModal 只保留标题、内容、可选折叠验收标准和底部团队/流程，移除人员说明生成器；task-create-modal 复用弹框分组与样式。test-task-creation 使用隔离 Electron 验证两主题三种窗口尺寸及真实 HTTP 创建；明确拒绝启动，不将展示测试当 Provider 证据。

设置二级分组密度由 compact.css 统一收紧 Runtime/仓库访问；app.js 的 renderTasks 直接展示允许的操作，移除菜单与全局菜单监听。test-runtime-settings 覆盖两主题宽窄展示、删除确认及归档/恢复往返；API/CLI/Store 不变。

设置层级与选择器：settings.mjs 的固定 Runtime 以原生 details 默认收起，页内展开保留表单；styles.css/compact.css 统一 h3/h4 递减字号。模型与思考等级同排，两类下拉距输入4px并可展示六行，鼠标跨边界不关闭；模型/思考只变显示标签首字母，不改 Provider ID 或 HTTP/CLI 输入值。隔离 Electron 两主题及宽窄验收见 test-runtime-settings。

公开思考展示：Runtime executionContent 保留凭据过滤，空白规范化不再误标脱敏；web/app.js 展示已保存 thinking 正文，空历史正文明确提示未保存，不补造 Provider 未公开内容。验证见 runtime-configuration/settings 与 test-collaboration-flow。

完整协作记录：Store 校验 Dispatch.sourceMessageId 属于同一 Run，Orchestrator 记录派工/交接来源；client/console-projections.mjs 合并消息、实际投递与协调事件，Web/Electron 和 CLI 共用。已有唯一结构化引用恢复展示关联，deliveries 为当前状态、history 为历史事实；已知交接 JSON 信封提取 rawResponse 报告，原始消息不变。客户端主线只保留总结、沟通及关键人类状态，不附加投递块、平台失败或验收文件清单。长消息始终渲染 Markdown，超过10行只展开区域；控制台无顶部错误摘要，日志错误标红，员工状态跟随最新 Trace 的失败/重试/恢复。CLI 保留完整投递/执行/验收文件引用；不改变调度或领域协议。scripts/test-collaboration-flow.mjs 用隔离 Electron/HTTP/CLI 验证。

独立客户端入口：npm start/dev → apps/electron/main.mjs → 自有 server/index.mjs → web/ 与 client/。全部相对依赖、CLI、Runtime、测试在本仓库；抽取来源、保留边界与发布身份见 docs/23-desktop-extraction.md。服务只由客户端 IPC 启动，直接运行拒绝；无独立 Web 部署。renderer 始终用客户端样式，所有 UI 验收只操作 Electron。

普通沟通：communication.mjs 的回复 schema 把可空的 handoffToAgentId 与 reply 同列 required（严格 Provider 要求 required 覆盖全部键），null/省略均表示不转交；Store 仍校验真实候选及单次转交，测试覆盖省略/null/非法字段和目标，任务协议独立不变。经理决定被在途投递顺延时，orchestrator 记录说明并向经理入队复核投递，不再静默丢弃；Run 进入验收或确认完成时，Store 取消未执行的平台协调跟进投递并记录审计，归档不再被残留复核投递阻塞。

工作目录：run-files 不再读写 .agentforge-workspace.json 或限定 docs；目录按 path/offset 分页读取，界面按需展开、继续加载和同层重试。CHANGE 将所有业务路径按真实层级合并，工作根与绑定子仓库比较任务初始提交。Workflow artifactPaths 仅为规范相对交付位置，可为空；Store/CLI/提示词同步，不再改写到 docs。执行快照覆盖全部业务路径但保留大小/敏感文件限制，历史冻结文件不迁移。

插件更新：plugin-updates.mjs 以两分钟单飞检查 Git 来源及外部依赖提交；configuration 提供 ls-remote 和可清理的临时检出，marketplace 只安装已装名称的新快照且不拆装 MCP，Store 事务更新当前员工。状态/开关/分钟周期经认证 HTTP、设置 → 更新 → 插件更新和 CLI plugins updates/check-updates/auto-update 共用。沟通无选择时打开最后更新会话，任务控制台首次无选择时打开最近执行者；显式选择不被刷新切走。

MCP 编辑：marketplace.mjs 复用安装校验并保留未改动脱敏值；HTTP 准备新版本与员工绑定，Store 事务更新当前员工、退役旧版本，冻结任务/排队投递不改。界面详情编辑与 CLI mcps update 同协议；团队空态仅保留创建团队引导。

原生 Skill：local-cli 保留 Claude --plugin-dir 但不禁用 Skill；所选 Codex Skill 走调用独占 codex-app-server.mjs，额外根注册、目录核对、线程级启用、精确续接，复用控制台投影。无 Skill 保留 exec，不作失败回退。prompts 不生成技能路径指引；history/mcp 的服务说明和 schema 拥有目录/分页。test-prompt-e2e 的 NATIVE_SKILLS_REAL 模式真实验证；CLI 字段不变、帮助同步。

CLI 连接集中在 cli/client.mjs 的私有 endpoint 发现与实例校验，无目标环境分支；客户端始终提供 CLI 分类。server/data-home.mjs 统一默认任务根 ~/agentforge，Electron 只复用纯路径函数；Store 随机 Task UUID 防止共享根碰撞，历史路径不变。真实 CLI 开发 E2E 启动独立 Electron 随机端口，不伪装 Web endpoint。

规则入口：[AGENTS.md](../AGENTS.md)。机器可读模块及联动文件见 `ai/module-registry.json`。

| 目录/入口 | 职责 | 文档 |
| --- | --- | --- |
| `server/index.mjs` | HTTP、认证路由、静态资源和 SSE | [架构](02-system-architecture.md) |
| `server/store.mjs` | 领域命令、持久状态、任务读模型 | [领域](03-domain-model.md) |
| `server/orchestrator.mjs` | 派工、会话续接、协作和进程执行 | [Runtime](08-real-local-agent-runtime.md) |
| `server/runtime/` | Claude Code/Codex、模型目录、Skill/MCP | [配置](15-employee-runtime-configuration.md) |
| `server/run-files.mjs` | 执行内容、提示词和交付快照 | [文件](13-local-artifact-rendering.md) |
| `server/workspace-git.mjs` | 工作区 Git 状态和 Diff | [文件](13-local-artifact-rendering.md) |
| `server/history/` | 员工历史查询和索引 | [历史](19-agent-history.md) |
| `server/communication*.mjs` | 长期会话与消息投递 | [沟通](17-communication.md) |
| `server/auth.mjs` | 管理员、会话、Origin 与登录限流 | [认证](14-console-authentication.md) |
| `client/console-projections.mjs` | 无副作用的共享展示投影 | [client](../client/README.md) |
| `web/app.js` | 任务、员工、团队、工作流与文件界面 | [web](../web/README.md) |
| `web/settings.mjs` | 外观、Runtime、仓库和 CLI 设置 | [配置](15-employee-runtime-configuration.md) |
| `apps/electron/` | 桌面窗口、自有后台和受限宿主接口 | [桌面](18-electron-client.md) |
| `cli/` | 认证 HTTP 命令、帮助与输出 | [CLI](21-configuration-cli.md) |
| `tests/`、`scripts/` | 隔离测试、构建及工程检查 | [测试](../tests/README.md) |

## 修改入口

- 失败与续接：runtime/local-cli 保留脱敏原始错误并独立判定临时故障；marketplace 提供完整性失败位置，cli-environment 禁止默认 Python 字节码写入。orchestrator 限制三次尝试，Store 停止不可重试投递；prompts 按内容摘要追加变化，模型实际活动确认输入游标。HTTP 巡检只继续已有到期队列，CLI 进度/帮助同步失败恢复语义。

- 任务目录标题由顶栏展示，index.html/styles.css 将内部任务/归档 h2 保留为无占位的可访问语义；app.js 更新归档顶栏名称。目录实机回归验证宽窄 客户端及往返搜索。Release 工作流发布成功后按构建输出的精确 artifact ID 清理 Actions 中转包，失败最多保留一天，不删除发布附件/标签。

- 真实模型验收的窄窗口截图等待 renderer 尺寸到位再保存，避免原生窗口异步调整让证据仍是宽屏；不改变产品代码或业务协议。

- 历史与后续答疑：local-cli.mjs 为 Codex 的平台历史 MCP 完整传递 Bridge 自有环境（打包版 Electron Node 标记）并设为 required，不改变 Provider 自身环境。app.js 协作流渲染全部消息及关联派工、协调事实，移除固定验收副本和停止答疑按钮；styles.css 缩小人类气泡。安装包协议测试与 test-prompt-e2e 的 PACKAGED 模式覆盖真实历史调用和完成后答疑；CLI/状态机/历史可见性不变。

- 应用标志：web/icons/application.png 保留用户提供的蓝紫 A 原图字节；scripts/build-app-icon.cjs 只用 sips/iconutil 生成 ICNS 尺寸。侧栏/Dock/安装包同源，菜单栏用原图彩色缩略图；无浏览器、新依赖或业务权限，移除过时三柱 SVG。

- 紧凑工作台：团队/工作流在 app.js 搜索后分页，任务归档/新建在搜索行；共享/compact 样式上移目录操作。tracePromptMarkup 展示完整脱敏提示词及已确认原生会话 ID；工具仅按 Trace/原生调用 ID 归并重复阶段，单次调用内重复输入只显示一次，不同调用即使参数相同也保留各自输入输出，无 ID 不猜测。人类协作元信息与正文气泡分离；侧栏/安装包同源图标。CLI 字段不变，扩展隔离帮助同步。

- 控制台降噪：client/console-projections.mjs 的 isRoutineConsoleEvent 在分组前过滤无内容的常规通知，统一识别任务 Provider 类型前缀与沟通无前缀事件，任务与沟通共用；原始分页窗口、审计、日志及 CLI 不变。内容引用、工具、异常与未知消息不隐藏。

- 指令分层：server/prompts.mjs 组装系统指令/当前输入；工作流仅经理、执行环境进系统层。Store 消息游标只投递新消息，原生会话拥有历史；Bridge 准备工具指引和快照，Runtime 使用 Claude 系统追加文件/Codex developer_instructions。真实验收见 scripts/test-prompt-e2e.mjs，CLI 参数不变。

- 目录顶部一致性：index.html 为团队/工作流采用同行搜索/创建工具栏，styles.css 统一紧凑高度；compact.css 移除团队/工作流列表顶边框。scripts/test-directory-headers.mjs 以隔离数据操作六页、宽窄 客户端、跨页搜索及创建弹框；CLI/HTTP/执行协议不变。

- 沟通控制台工具栏仅保留最新/刷新；`communication.js` 隐藏唯一成员的重复标签，把群聊成员选择与更早记录入口置于工具栏外。`styles.css` 负责间距，运行/HTTP/CLI 契约不变；UI 验收覆盖单聊、群聊切换和宽窄布局。

- 沟通工作台：communication-store 拥有附件引用与每次投递/尝试的会话事实；Run Files 管理原文件和私有正文，HTTP 暴露同源上传、校验下载、成员分页控制台。communication.js 管理半屏布局/草稿/未读，app.js 注入与任务空间同一个 renderer/hydrator。详情见 docs/17；CLI 未覆盖长期沟通，本轮无 CLI 命令/字段变化。市场头像复用员工 palette。

- 员工扩展选择器的开/关及焦点归还集中在 `web/marketplace.mjs`；鼠标移出、表单外部点击与键盘焦点离开关闭列表，事件仅绑定当前表单，不扩展 HTTP/CLI 或 Runtime 协议。源码与安装包 UI 回归覆盖插件/MCP 各自的鼠标、键盘及保存回读。

- 插件来源链接在 `marketplace.mjs` 的安装复制阶段按 `configuration.mjs` 提供的 sourceRoot 展开，执行期仍拒绝链接；CLI 操作帮助同步边界。详情统一滚动区与稳定卡片布局在 `styles.css`，滚轮/键盘、跨行对齐和真实链接 Skill 加载分别由 Electron/插件 E2E 覆盖。

- 协调流程：Store → Orchestrator → Runtime；平台只执行协调决定，不评价业务结果。
- 角色：Store 拥有 roles 集合与员工 `roleId` 绑定校验/删除拒绝；Task 创建把角色文本冻结为员工快照的 `roleSnapshot`，沟通投递快照在发送/重试时嵌入；`prompts.mjs` 把快照中的角色提示词并入应用系统指令（任务与沟通共用，Claude `--append-system-prompt-file` / Codex `developer_instructions` 通道不变），Runtime 无角色状态。界面 BUILD 组有独立角色目录；CLI 为 `roles` 组与 `agents` 的 `roleId`。
- 角色侧栏展示：`web/preferences.mjs` 的 NAVIGATION 包含 roles，隐藏选择可重载保留、默认恢复与空 BUILD 分组共用现有偏好逻辑；`web/index.html` 用 SVG 人物名牌替代字体符号，`apps/electron/compact.css` 补同形蒙版以修复实心方块。`test-roles-ui.mjs` 验证偏好及宽窄窗口、两种主题；只改展示，CLI 无变动。
- 配置能力：HTTP/Store、界面与 CLI 一起核对；当前输入协议见员工配置和 CLI 文档。员工/插件/MCP 目录共用同行搜索工具栏与卡片；插件/MCP 删除经 Store 记录 extensionRemovals 并拒绝当前员工引用，文件保留供冻结任务使用。
- 插件/MCP：`web/marketplace.mjs` → 认证目录/详情与来源整批 import → Runtime 不可变插件版本及拆分 MCP；员工只选 pluginIds/mcpIds，创建/编辑均可设置 active/inactive。`mcp-launcher.mjs` 通过现有 SDK 桥接 SSE/Streamable HTTP；`plugin-hooks.mjs` 为 Codex 执行完整性校验的选定命令 Hook，Subagent 配置投影到 Trace。Electron 数据仍由 runtime-paths 指向 ~/.agentforge。
- 市场整批导入解析 Claude/Codex 本地及 HTTPS Git 条目，ref/sha 记录实际来源；配置根先归一祖先别名。清单/Hook/Skill 分 Runtime 投影，目录/CLI 展示静态兼容性与原因，员工绑定拒绝不兼容。Codex MCP cwd 在私有启动器生效，npm/archive/command 来源仍明确拒绝，详见 docs/15。
- 展示：优先共享投影和现有样式，桌面差异放入 `compact.css`；工具命令/文件摘要解析在共享投影，可见行加载与 Read/Write 正文展示在 `web/app.js`。
- 消息方向由 renderer 的真实 sender 判断：人类右、员工左，不改变协作投影/CLI。市场整行空/错误状态在 `marketplace.mjs` 的网格外；工作根设置在 HTTP 校验并创建目录后交 Store 保存，见 docs/02、06。
- 工作目录：当前文件与 CHANGE 共用 `workingFileTree`；不再提供交付版本页面，历史文件仍由 Run Files/API/CLI 管理。提示词组装、澄清与新指令的代码路径见 [提示词组装](22-prompt-assembly.md)。
- 文件下载：`web/app.js` 的下载命令 → 认证 `content?download=1` → Run Files 的共享路径校验和流式读取；根目录间距使用 界面中两个文件面板共享的样式。现有 CLI 查询 Artifact 历史，不包含当前文件下载命令，本轮不扩展 CLI 权限或协议。
- 新增模块：先更新注册表；契约变化同步 source of truth、测试和变更记录。
- CHANGE 空态由 `renderWorkingChanges` 统一呈现，目录下不重复显示无更改；保留读取错误与 Git 未初始化提示，CLI/API 不受影响。

发布检查：`scripts/test-packaged-electron.mjs` 验证控制台默认选择最近执行者，再显式切换员工读取历史；无选择时不再期待旧的空白提示，仍触发真实按需加载。

记录可读性：`renderChatStream` 按 Trace 时间合并提示词/事件并尊重分页窗口；`collaborationRecords` 提供视觉状态投影，沟通按稳定发送者配色，共享 tokens 在 renderer、紧凑覆盖在宿主；CLI 排除视觉元数据。

源码 UI 验收先等待员工首页加载完成再遍历旧页，不把先行渲染的提示词元数据误认为历史已加载；按记录 ID 定位需要滚动读取的正文。

重复导入：server/index.mjs 串行准备，Store 按来源＋名称（插件）或安装名称（MCP）匹配；Store.replaceImportedExtensions 原子切换当前员工及退役旧版本；冻结历史保留。CLI 同步覆盖回执与渐进帮助。角色空态复用 MCP 整行提示。

全部目录空态共用 directory-empty，整行对齐、14px 16px 内边距、主题浅色背景、虚线边框和6px圆角。

品牌与目录视觉：web/styles.css 维护蓝/青/紫 tokens、状态标签与 directory-empty；apps/electron/compact.css 复用品牌，仅覆盖宿主密度和主题表面。用户新 PNG 生成同源 ICNS，菜单栏用彩色缩略图而非 alpha 模板。开发方法入口 `.codex/skills/agentforge-development/SKILL.md` 引用 AGENTS 与 docs/06；隔离验收 `scripts/test-brand-presentation.mjs`。

Runtime 设置入口：固定两项与 Store enabled 门禁见 docs/15，宿主默认 CLI 安装及委托凭证发布见 docs/18，认证生命周期见 docs/14，CLI 部分更新协议见 docs/21；验收脚本 scripts/test-runtime-settings.mjs 支持隔离源码/安装包及显式真实 Provider 模式。

任务目录打开：web/app.js 在复制后提供打开按钮 → preload 零参数 openWorkspaceDirectory → main 核对当前 Run 与认证 summary 中的目录 → shell.openPath。无新 HTTP/CLI 协议；宿主边界见 docs/18。

任务中心搜索区与任务列表左右外缘对齐，搜索区到列表保留8px间距，当前任务/空搜索/归档列表一致；桌面compact.css去除full-panel的重复内边距。仅展示调整，无HTTP/CLI协议变化；test-runtime-settings覆盖两主题宽窄窗口。

目录空态统一由 `web/styles.css` 的 `.directory-empty` 维护，跨满列表/卡片行并对齐左右边缘，内边距14px 16px；沟通选择器跟随其列表宽度。实时同步移至登录信息旁，窄侧栏保留可访问的状态圆点，顶栏不重复。仅呈现变化，无 CLI/API 协议影响。

应用标志更新为用户最新提供的铺满画布版本，PNG 原样保留（SHA-256 `46bb3c5165723bba5f63f070de19647fa6c6385366579d0d9a9a9bb1277e937e`），侧栏、Dock 与菜单栏共用；macOS 包图标从同源 PNG 生成 ICNS，不改变主题配色或 CLI/API。

长任务排查：`server/runtime/local-cli.mjs` 区分 Claude 原生后台等待与活动轮次空闲；`server/prompts.mjs` 维护必要业务上下文及增量投递；`web/app.js` 的控制台按事件更新并在摘要刷新时保留阅读 DOM。

经理正文已返回但 Run 空队列仍 running：查 orchestrator.acceptDelivery 的 managerDecision 完整性及 routing: 纠错投递，不以正文“已验收”自动改状态。

- 应用图标按用途派生：build-app-icon.cjs 保留用户原始 PNG，生成干净 UI 图、824/1024 比例 Dock 图及同尺度 ICNS、18pt/2x 菜单栏模板；主进程启用原生模板适配明暗，不将彩色底板作为模板。资源与复现见 web/icons/README.md，无 CLI/API/任务协议影响。

应用更新：apps/electron/updates.mjs 拥有正式版发现/下载状态，主进程封闭 IPC 与原生 MacUpdater；更新状态和按钮仅在设置/updates 区域展示，复用 renderer 样式，不创建通知卡。server/index.mjs 仅通过父子私有 IPC 原子预留空闲重启，锁期间拒绝新写入并暂停调度。发布/签名边界见 docs/24-desktop-updates.md；不改变 CLI 配置命令或任务决定。

更新页的两个配置区直接使用设置 h3 标题，不重复 Tab 名称；settings.mjs 将动态版本 span 与 GitHub 文字链接并列，状态刷新不覆盖链接。styles.css 复用设置间距并支持换行，test-application-updates 覆盖标题层级与版本旁链接。无版本号、CLI/API 或更新机制变化。

DeepSeek Harness：dsh.mjs 驱动独立 SDK，dsh-plugin.mjs 在原生 Runtime 注入字面系统段和模型目录；local-cli 负责统一诊断/错误类型。Store 提供固定 dsh 槽位、effort 和原生身份确认，Orchestrator/communication/probe 路由同一实现。marketplace 声明原生 Skill/MCP 的 DeepSeek Harness 兼容性并拒绝专有 Hook/Subagent，UI/CLI 同步；dsh.test 与 test-dsh-real 分别验证协议和真实任务。决策见 docs/25。

Runtime 安装状态：cli-environment.runtimeInstalled 按实际执行 PATH 只读检查，index 注入 Store；Store 的 installed/有效 enabled 同步 UI 和 CLI，缺失时开关关闭锁定，拒绝 enabled 修改及新调用。完整展示名称 DeepSeek Harness 不改变 dsh 标识。

协作简化：app.js 不展示总条数、强制 @ 说明和回复问题副本；Store 的 submitHumanMessage 对未指定接收者路由给冻结 Run 经理，CLI message schema/help/example 同步可选接收方。精确澄清与归档/终态规则不变；styles.css 将提示词会话 ID 与内容框左边缘对齐。

跨 Runtime 插件源标准与冻结执行计划见 [docs/26](26-runtime-plugin-compatibility.md)；入口 `server/runtime/plugin-compatibility.mjs`，DeepSeek 原生组件物化 `dsh-extensions.mjs`。已有安装兼容性由当前适配器派生，不能依赖历史 providers。

市场卡片在 web/marketplace.mjs 只保留版本/ID 与详情；Runtime 兼容信息保留在详情和员工选择器。三 Runtime、两源格式与三种 MCP 传输的真实兼容验证入口为 scripts/test-plugin-runtimes-real.mjs。
