# 工程脚本

test-workflow-editor.mjs 同时核对两种节点在两主题、宽窄窗口的端口默认隐藏、悬停显示、键盘焦点和拖动期间显示、松开恢复；保留原有鼠标/键盘四边连线验收，不调用真实模型即可核对视觉变化。

性能改造验收：`test-task-creation.mjs` 验证服务端分页后的 App/CLI 管理功能；`test-communication-workbench.mjs` 检查有界历史、附件和窄屏控制台（保留标题，隐藏消息正文）。`test-packaged-electron.mjs` 在隔离 HOME 中额外验证真实 ASAR 的 sharp 原生缩略图解码与诊断 Worker 写入；`AGENTFORGE_PACKAGED_APP` 可指向临时构建包，不安装到操作者实例。`AGENTFORGE_TASK_PARALLEL_REAL=1 node scripts/test-task-parallel-real.mjs` 验证真实并行、续接与人类验收。合成基准结果和逐项闭环见性能审查报告及 docs/28。

仓库更名为 `dengdai68/AgentForge`：应用更新 API、严格附件来源、设置 GitHub 链接与打包发布配置使用新地址；应用身份、数据目录和 CLI 业务协议保持不变。README 仅介绍能力，安装/开发入口见 CONTRIBUTING。

test-task-creation.mjs 同时验收核心 App/CLI 对齐：真实 CLI 子进程与认证 HTTP 操作角色、团队、工作流、员工、MCP、插件和任务；验证团队合并选人、无额外验收标准、工作流独立交接来源、员工能力/角色往返、团队启停，以及两主题宽窄编辑。该展示/协议验收不启动 Provider；--start 成功/失败和不重试语义由 configuration-cli 测试覆盖。

test-directory-headers.mjs 同时验证任务工作流列、冻结名称、工作流筛选后分页、名称/状态组合与重置，覆盖 minimal 宽屏和 warm 窄屏；不执行 Provider。

`AGENTFORGE_TASK_RETRY_REAL=1 node scripts/test-task-retry-real.mjs` 使用隔离 Electron/HOME/数据，通过真实 Claude 经理派工、员工编写与运行求和测试；只在员工第一次真实成功进程结束后注入一次非零退出/Token 失效错误。实际点击宽窄 UI 恢复按钮，验证原 Dispatch、同一原生会话且下一次执行直接为员工，再到经理交接和可见人类确认。调用真实模型需已有 Claude 登录；只读复用已有登录，不复制凭据或触碰当前实例。失败注入明确标记，不声称外部服务实际故障。 UI 检查中断后可用 AGENTFORGE_TASK_RETRY_RESUME 指向本脚本已有的 .data/task-retry-real-* 目录，继续同一失败 Run；原 evidence.json 保留，续验另写 evidence-resumed.json。

候选浮层与表单验收：test-task-creation 在两主题用真实鼠标拖动角色/团队 textarea，核对顶部稳定、背景/Escape 保留草稿，以及团队列表脱离正文裁剪、随窗口向上/向下定位和鼠标跨越间隔；test-runtime-settings 覆盖模型列表与原生思考 select；test-communication-workbench 覆盖底部关闭、不自动展开、稳定身份色与两字头像。各脚本均支持隔离安装包路径，不改造操作者实例。

任务/团队验收夹具使用显式 memberAgentIds，团队选人仅作为 UI 展开来源；真实任务按冻结成员运行。test-task-creation 与 test-communication-workbench 覆盖独立成员和群聊，test-prompt-e2e 验证真实完整任务与人类验收。

客户端专用验收：源码/安装包均操作 Electron，自有服务随机端口。test-prompt-e2e 验证真实任务和历史；test-communication-workbench 验证沟通；已移除固定端口 Web 设置/历史脚本和独立浏览器分支。

test-roles-ui.mjs 在隔离 Electron 验收角色目录：导航入口、创建/编辑、搜索、每页20条分页、员工单选绑定/清空、绑定角色删除拒绝就地列出员工及窄窗口工具栏；不调用模型。AGENTFORGE_ROLES_REAL=1 node scripts/test-roles-real.mjs 以真实 Claude Code/Codex 验证角色提示词进入沟通与任务的应用系统/developer 指令并生效（随机探针前缀），对照未绑定员工与经理不受污染，覆盖解绑/编辑后的后续投递与任务冻结原文；只使用已有 CLI 登录，证据写 .data/roles-real-*。

独立客户端源码 UI 验收按真实目录树逐级展开 docs/notes 后读取夹具，不假设工作目录仍有 docs 特殊默认展开。所有验收与构建都从 AgentForge-App 自身依赖运行，不连接原仓库服务。

角色 UI 验收还覆盖外观设置隐藏角色、重载后保留、空 BUILD 分组隐藏与恢复默认；保存暖白/极简宽屏及原生窄窗口的 SVG 人物名牌图标截图。只验证客户端展示偏好，不调用 Provider 或扩展 CLI 能力。

AGENTFORGE_WORKSPACE_REAL=1 node scripts/test-workspace-files.mjs：隔离真实Claude代码开发/独立测试，全部通过CLI配置团队、员工、工作流与任务，非docs产物和真实样例MP4。AGENTFORGE_WORKSPACE_APP指定打包app，AGENTFORGE_WORKSPACE_CLAUDE指定实际CLI；同一隔离服务操作Electron的宽窄目录/CHANGE、1005项翻页、大文件下载与人类确认。不修改操作者任务或凭据，合成大小/分页数据明确为UI夹具。

验收脚本失败可用 AGENTFORGE_WORKSPACE_RESUME=系统临时目录内的af-workspace-case-*证据目录，继续同一真实任务的UI及人类确认；不重新创建或启动模型任务。仅接受已有失败证据的隔离夹具，原失败evidence.json保留，续验写evidence-resumed.json。

node scripts/test-plugin-updates.mjs 通过本机真实 HTTPS Git 和正式120秒定时器验收插件安装与设置 UI/API/CLI、周期保存/禁用/立即执行，以及沟通最近会话默认选择。AGENTFORGE_PLUGIN_UPDATES_APP 指定真实应用包；AGENTFORGE_PLUGIN_UPDATE_TASK_REAL=1 显式调用现有 Claude 账号，AGENTFORGE_PLUGIN_UPDATE_CLAUDE 可精确指定现有 CLI，执行更新后原生 Skill 真实任务到界面人类确认，并核验控制台最近执行成员默认选择与显式选择保留。临时TLS证书/信任与数据均隔离，证据保存在输出的系统临时目录。

`node scripts/test-marketplace-edit.mjs` 实际操作隔离 Electron，验证空团队、MCP 编辑取消/错误/成功、脱敏值、绑定员工、CLI 更新及不兼容拒绝。指定 `AGENTFORGE_MCP_EDIT_APP=/absolute/AgentForge.app` 使用真实打包 Electron；均不调用模型、不修改操作者数据。

AGENTFORGE_PROMPT_E2E_REAL=1 AGENTFORGE_NATIVE_SKILLS_REAL=1 node scripts/test-prompt-e2e.mjs：通过真实界面手工安装测试插件，以 Claude/Codex 原生会话执行技能附带脚本、实际 MCP/历史查询，校验未在提示词提供的随机产物；覆盖 exec/App Server 续接、移除选择、真实代码开发/独立测试/澄清阻塞和人类确认。隔离 HOME/数据库，不修改操作者任务或凭据。

真实任务的窄窗口截图必须在 setContentSize/setViewportSize 后等待 renderer 的 innerWidth/innerHeight 达到目标尺寸，不能把 OS 尚未完成调整的上一帧当作窄屏证据。

AGENTFORGE_PROMPT_E2E_REAL=1 AGENTFORGE_PROMPT_E2E_PACKAGED=1 node scripts/test-prompt-e2e.mjs 使用当前安装包的隔离 Electron（不与 WEB 模式混用）。两个真实 Provider 在续接时实际调用平台历史 search_private_chat/read_context 取回未放入提示词的随机资料；再完成 Claude 团队代码开发、澄清、独立测试、人类确认、完成后历史答疑和归档拒绝。调用使用现有模型登录，不读取/复制凭据，不覆盖操作者实例；证据明确 packaged surface。package:mac:check 另用受控 Provider 消费实际 Codex 参数，连接真正的打包历史 MCP，断言 Node 标记仅在子进程且十工具及记录可读，不冒充模型。

build-app-icon.cjs 保留用户原始 application.png 字节与完整构图，不做放大裁切，使用 macOS Swift/CoreGraphics 生成标准圆角 UI 图、透明边距 100/1024 的 Dock 图及 18/36px 单色菜单栏模板，sips/iconutil 从 Dock 图生成同尺度 ICNS。临时文件使用专用 mkdtemp；无浏览器、网络、新包依赖或操作者配置访问。按 web/icons/README.md 重生成并验证，发布读取已生成资源。

test-directory-headers.mjs 覆盖任务操作顺序、任务/归档顶栏名称、无占位的内部语义标题、归档往返搜索保留、团队/工作流跨页搜索/空态/清空与宽窄 客户端布局；test-electron.mjs 对真实 DOM 验证完整脱敏系统/本轮输入、会话 ID、无工具审计详情、人类气泡外元信息与 @成员。使用隔离数据与明确标记的展示夹具。

test-electron.mjs 用两个不同原生 ID、完全相同参数的 MCP 调用验证两行各自输入/输出，同时重复投递每个调用的开始/完成阶段，确认只修复单次调用重复渲染，不按参数合并真实调用。

`AGENTFORGE_PROMPT_E2E_REAL=1 node scripts/test-prompt-e2e.mjs` 在隔离客户端以真实 Claude/Codex 验证系统指令及原生会话记忆（不重发随机码），再以 Claude 团队执行澄清阻塞、代码实现、独立测试及界面人类确认。只使用已有 CLI 登录，不复制/修改凭据，不接触真实任务。

失败后可通过 AGENTFORGE_PROMPT_E2E_RESUME=.data/prompt-e2e-<证据目录> 续接同一隔离 Run；只允许该测试目录，保留失败记录和原生会话，通过正常消息请求经理继续，不编辑领域数据库。测试可使用正常 retry-now 命令作最多两次显式重试，不以重跑抹去失败。

`node scripts/test-directory-headers.mjs` 在隔离实例操作任务、沟通、团队、工作流、员工和 MCP 六页，覆盖 客户端宽窄布局及创建弹框，不启动 Provider。`AGENTFORGE_DIRECTORY_HEADERS_PACKAGED=1` 检查本地构建安装包；`AGENTFORGE_DIRECTORY_HEADERS_BASELINE=1` 仅采集改动前几何/截图，不能作为改动后断言通过。

沟通工作台验收断言顶部只出现最新/刷新、私聊无重复员工标签；群聊成员切换仍可操作且不在顶部工具栏，加载历史、折叠草稿和宽窄布局继续验证。

`test-communication-workbench.mjs` 覆盖真实市场卡片、附件上传/下载、同名文件、未读与个人控制台及真实 HTTP 失败路径；同时验证一人私聊/多人默认命名群聊、无标题创建、长姓名省略/固定图标/成员数、只读居中详情和群名编辑的失败/轮询保留，两主题宽窄布局。显式 `AGENTFORGE_COMMUNICATION_E2E_REAL=1` 在源码隔离客户端调用已有 Claude Code，读取随机附件标记并触发缺失文件工具失败；host HOME/数据库/下载隔离。`AGENTFORGE_COMMUNICATION_E2E_PACKAGED=1` 或 `AGENTFORGE_COMMUNICATION_APP=/absolute/path/AgentForge.app` 为安装包受控验收，不与 REAL 同用。不复制凭据或重置真实实例。

AGENTFORGE_CLI_E2E=1 或 AGENTFORGE_TASK_CLI_E2E=1 的真实开发验收启动独立 Electron，CLI 使用其私有 endpoint，不连接或停止 Web 4310。任务工作根预存隔离目录，真实 Provider 继续使用操作者已配置的运行环境；配置、开发、失败探针、澄清阻塞及最终人类确认均记录在隔离证据目录。

员工插件/MCP 选择器回归需真实点击输入后移鼠标离开（仅 fill 不会产生 pointerleave），验证候选与 4px 间隙可穿越、复点重开、Escape/Tab 收起、方向键/Enter 选择和移除；检查隐藏候选不保留焦点，宽窄 客户端均实际操作。仅 UI 行为变化不需要触发 Provider 或改变 CLI 契约。

插件详情回归必须实际用滚轮到达最后一项、键盘翻页并核对底部操作，不能仅断言弹窗无溢出；覆盖 客户端宽窄视口。员工长/短/空简介检查跨行卡片高度及操作相对位置，CLI 在真实隔离服务执行插件整批导入。真实插件任务的首个 Skill 来自来源内符号链接，安装后核对普通文件并要求真实员工读取其 marker；不对用户本机私有插件执行 Hook/MCP。

命令入口见 `package.json`。测试只使用隔离数据，执行真实 Provider 的脚本可能消耗模型额度；不要指向日常实例。

`AGENTFORGE_PLUGIN_E2E=1 node scripts/test-development-e2e.mjs` 手动安装本地完整插件（Skill/Subagent/Hook）及两个 MCP，通过员工搜索选择器绑定一个 MCP；真实空选择员工隔离探针、开发与独立测试完成后，核验工具/文件证据并在界面人工确认，不以夹具代替真实 Provider。

扩展验收在返工后读取最高 version 的报告快照，不把历史第一版误当当前交付；旧快照不删除或覆盖。源码 Electron 检查同时验证 Runtime 标签、具体不兼容原因和 UI/HTTP 拒绝，以及窄窗口中滚到顶部可恢复完整概要、滚到末尾可读最后组件。

设置 UI 回归以不存在的嵌套目录验证自动创建、已有文件保留和新任务分配/旧路径冻结；文件阻挡路径验证失败。市场空态须在卡片网格外占整行；安装包沟通检查人类靠右、员工靠左。

`AGENTFORGE_WORKSPACE_E2E=1 node scripts/test-development-e2e.mjs` 在隔离实例通过设置页保存不存在的嵌套目录，再于新根完成真实 Claude 代码开发、独立测试及界面确认；不能在真实操作者实例执行。

打包控制台检查遵循按角色点击和视口加载，不等待未触发的后台内容；覆盖未展开的 Bash/Read/Write 摘要、分组 Read 成功/失败、Write 转义正文与窄窗口。

任务空间回归覆盖当前文件/CHANGE 的同构树与独立折叠、移除交付版本、控制台不回显协作正文，以及返回按钮间距和列表搜索保留。

安装包回归使用三个声明根验证折叠后的实际几何间距，并实际下载文件核对字节与名称；覆盖未登录、非法路径、文件消失后的就地错误和窄窗口下载/刷新排列。

CHANGE 回归确认目录根下无重复「没有更改」，整体空态及错误/未初始化语义另由展示单测覆盖。

记录可读性回归使用超过 50 条的 Provider 夹具输出检查普通提示词分页；有界延迟观察真实运行中的夹具 Trace 与终态成员颜色，私聊/群聊检查姓名色和窄窗口，不冒充真实模型。源码检查同样显式选员工、加载旧页及滚动触发正文。

test-marketplace-edit.mjs 同时验收角色宽窄空态与 MCP 一致、重复插件/MCP UI/CLI/API 导入覆盖、插件拆分 MCP 和停用员工绑定、并发创建与不兼容整批回滚；AGENTFORGE_MCP_EDIT_APP 可验证打包应用。

`node scripts/test-collaboration-flow.mjs` 用隔离 HOME/数据库/认证启动真实 Electron，验证经理派工、员工交接、成员咨询/答复、人类消息、平台协调与重试事实、分页、涉及人类筛选、Markdown 安全和宽窄布局，并经真实 HTTP/CLI 核对同一投影。执行数据为终态的 Store 场景，不调用 Provider；证据写入忽略的 `.data/collaboration-flow-*`。

`AGENTFORGE_COLLABORATION_APP=/absolute/path/AgentForge.app node scripts/test-collaboration-flow.mjs` 对指定构建/安装包运行同一套隔离协作验收，不访问原实例数据。

协作验收补充覆盖：无 sourceMessageId 时以源投递/Trace 唯一关联的旧交接；失败后恢复的当前状态与实际事件时间；经理全流程协调；验收说明与人类确认时序。隔离 fixture 走 Store 完成态，不调用 Provider；source/packaged 均操作实际760px内容窗口。当前安装实例的真实任务审阅通过原有客户端进行，不读取认证数据库、浏览器 cookie 或直接读领域数据库。

协作降噪验收还验证无当前投递区块、无平台失败通知、控制台 Tab 固定名称、发言 Trace 与无来源 Trace 的执行入口、控制台红色失败日志和切回全部执行；CLI 仍完整保留重试事实。

协作脚本同时验证：5行 Markdown 区域在折叠时已完整渲染、展开保留 DOM、交接信封正文提取、短消息无展开入口、验收无自动附件、无控制台顶部错误摘要、最新失败员工标错及成功重试清错。

控制台展示已保存的公开 thinking 正文；敏感片段仍过滤，首尾空白与换行规范化不标为脱敏。历史正文为空时明确说明“未保存可显示的思考正文”，不以“已脱敏”占位，不补造未公开或未保存内容。

`node scripts/test-brand-presentation.mjs` 在隔离 Electron 中验证两主题、1320/760px：员工可用与 Runtime 支持同色、支持/不支持及头像/按钮/空态文字对比、键盘焦点、三目录空态 computed style 完全一致、详情入口与真实 HTTP 失败。仅展示夹具，不执行 Provider/MCP。`AGENTFORGE_BRAND_APP=/absolute/path/AgentForge.app` 可检查指定构建包；证据在忽略的 `.data/brand-presentation-*`。

`node scripts/test-runtime-settings.mjs`：隔离 Electron/HTTP/真实 CLI 子进程检查固定 Runtime、可用门禁、两字段页内折叠编辑、两主题宽窄布局/标题层级/六行候选与鼠标连续选择、旧字段拒绝、共享授权及退出撤销；`AGENTFORGE_SETTINGS_APP=/absolute/path/AgentForge.app` 检查安装包并验证启动自动安装 CLI。`AGENTFORGE_SETTINGS_REAL=1` 显式运行 Claude Code 经理→Codex 成员→人类确认的最小完整任务，使用私有 Shell PATH 包装器只读复用本机 Provider 登录，不改全局凭据。证据在忽略的 `.data/runtime-settings-*`。

`test-runtime-settings.mjs` 还在两主题/宽窄窗口验证紧凑 Runtime/仓库二级配置、任务操作直接可见、删除确认及归档恢复往返；生命周期数据仅为展示夹具，不是模型执行证据。

`node scripts/test-task-creation.mjs`：隔离 Electron 两主题/1320×1000、760×760、800×560 检查六至十二行输入上限、折叠验收、固定同排选择器与提交、真实 HTTP 创建及启动被拒后的保留。`AGENTFORGE_TASK_CREATION_APP=/path/AgentForge.app` 运行打包版。启动请求故意拒绝，不运行 Provider。

`test-runtime-settings.mjs` 同时检查常规两项同行、Token 与保存同行、Runtime 双字段同行及两类下拉4px间距，并通过真实宿主打开当前隔离 Run 文件夹；不对操作者任务发命令。

`test-runtime-settings.mjs` 还测量任务搜索区与列表的左右对齐、8px间距和窄屏无溢出，覆盖当前任务、空搜索与归档页。

`test-collaboration-flow.mjs` 另验证控制台 SSE 追加与工作区摘要刷新保留日志 DOM、正文选择和阅读位置；其事件是隔离呈现夹具，不代替真实 Provider 长任务验证。

test-application-updates.mjs 用隔离 HOME/数据启动真实 Electron（AGENTFORGE_UPDATES_APP 可指定安装包），通过注入控制器适配器覆盖正式版/Beta/无正式版/离线、下载进度与真实文件校验、后台发现更新及下载完成均不创建通知卡、返回更新区域仍可操作、原生安装繁忙/空闲和两主题宽窄布局。假DMG不执行、原生安装适配器不退出测试客户端，不冒充真实签名升级。

test-dsh-real.mjs（AGENTFORGE_DSH_REAL=1）使用隔离 Electron、真实 DeepSeek Harness/模型，核验 Runtime/CLI、原生 Skill/MCP/平台历史、角色冻结和完整任务到可见人类确认；仅为测试实例创建数据，不碰操作者实例。DeepSeek Harness 命令可由 AGENTFORGE_DSH_COMMAND 指定，模型可由 AGENTFORGE_DSH_MODEL 指定；原 DSH_HOME 仅交给原生凭据服务读取。

`AGENTFORGE_SETTINGS_MISSING=1 node scripts/test-runtime-settings.mjs` 使用隔离 HOME/PATH 验证未安装 Runtime 的关闭/锁定、API/CLI 拒绝、可执行文件安装/移除后的重新读取及两主题宽窄布局。可结合 AGENTFORGE_SETTINGS_APP 指向安装候选，不调用模型。

test-collaboration-flow 核对精简后的协作顶部/答复正文，以及两主题宽窄控制台提示词和会话 ID 的真实左边缘；test-dsh-real 另以真实模型验证完成后 UI 未 @ 与 CLI 未指定接收人的经理答疑及不重开业务流程。

`test-dsh-real.mjs` 增加源插件真实独立 reviewer 与 command Hook；`AGENTFORGE_DSH_SOURCE_DIALECT=claude-code|codex` 选择源方言，仍须 `AGENTFORGE_DSH_REAL=1`。调用真实模型、隔离数据，完整任务直到可见人类确认/归档，不以夹具代替。

`test-console-layout.mjs` 使用隔离暂停任务，实际检查两个主题与 1320/760px 的长 Markdown、编号缩进、单一纵向滚动；可用 AGENTFORGE_CONSOLE_LAYOUT_APP 指定待验收安装包。

`AGENTFORGE_PLUGIN_RUNTIMES_REAL=1 node scripts/test-plugin-runtimes-real.mjs`：两种源格式 × Claude Code/Codex/DeepSeek Harness，六个真实模型组合。每项实际读取 Skill、调用独立子代理和 command Hook、调用 stdio/HTTP/SSE 三种 MCP，核对随机输出与本地工具证据。所有素材与模型工作目录隔离；不等于逐一完成已安装业务插件的生成/翻译/配音业务流程。失败逐项保留，不将静态支持标签当验收。

`AGENTFORGE_AI_MINIONS_REAL=1 AGENTFORGE_AI_MINIONS_SOURCE=/absolute/checkout node scripts/test-ai-minions-real.mjs` 使用外部本地来源隔离导入，核对每个插件在全部 Runtime 的计划和原生 YAML；真实加载 nyx-build 并调用来源内的独立代码分析子代理验证模型映射。只读加载业务 Skill，不触发部署，不运行来源的 transcript-upload Hook；Hook/MCP 机制由既有六组真实矩阵另验。证据仅写 .data，原检出和真实任务不变。

test-roles-ui 覆盖角色/插件/MCP 框内多选添加/移除、无排序操作、两主题宽窄几何一致性及保存回读；test-plugin-runtimes-real 在两种来源内加入错误 Skill/Subagent/Hook，验证有效组件在三种 Runtime 中真实调用与多个角色指令生效；test-dsh-real 验证整组角色冻结及完整任务验收。

`AGENTFORGE_ROLES_APP=/absolute/path/AgentForge.app node scripts/test-roles-ui.mjs` 将同一多角色/部分安装验收用于真实打包版（仍使用隔离数据），并实际通过已认证 CLI 写入/清空 roleIds。

`AGENTFORGE_DIRECT_COMMUNICATION_REAL=1 node scripts/test-communication-direct-real.mjs`：在隔离 Store 中实际调用三种 Runtime，先产生旧 schema 会话，再用 reply-only 重试并核对原生 ID 不变、群聊仅处理人类接收者且不新增子投递；不读写操作者沟通。test-dsh-real 同时核对新任务没有仓库绑定并到可见人类确认。开发/CLI E2E 的仓库说明改写在 systemPrompt 中，由员工依目标准备，不通过旧 developer/repository 输入。

`AGENTFORGE_TASK_COLLABORATION_REAL=1 node scripts/test-task-collaboration-real.mjs` 使用隔离 Electron 和真实 Claude：首轮真实经理输出注入丢失协调字段，验证原会话收到具体拒收原因并纠正，真实经理使用含 instruction 的单人派工并实际送达员工；真实员工首轮结束后注入鉴权错误，验证 failed 锁定、原员工/会话重试、完成交付和界面人类确认。故障是验收注入，不冒充 Provider 实际故障。证据保存在 .data/task-collaboration-real-*；可用 AGENTFORGE_TASK_COLLABORATION_RESUME 指定该脚本失败的隔离目录续验。`test-collaboration-flow.mjs` 覆盖角色消息过滤和跨日志分页的提示词定位。

协作 UI 验收额外检查任务详情无独立问题面板；真实任务验收要求员工在交接正文报告问题、处理过程和验证结果。Provider 夹具不再输出已移除的问题清单字段。

AGENTFORGE_CODEX_LOGIN_REAL=1 node scripts/test-codex-login-recovery-real.mjs 在隔离 Electron 中注入一次未登录、会话建立前持续报错；恢复时调用当前真实 Codex 账号，验证同一员工/私聊手动重试、真实会话 ID，以及任务派工、失败重试、产物测试和界面人类确认。不会登出或改写操作者凭据。沟通与任务 UI 脚本覆盖蓝色选中态、字号一致和目录加载无可见中文提示。

`AGENTFORGE_WORKSPACE_CLONE_REAL=1 node scripts/test-workspace-clone-real.mjs` 在隔离 Electron 用真实模型执行 clone、修改、测试、commit、CHANGE 查看和人类确认；默认三种 Runtime，可用 `AGENTFORGE_WORKSPACE_CLONE_PROVIDERS=claude-code,codex,dsh` 选择。使用现有账号但不更改凭据，证据保留 .data。

完整测试仍通过 npm test 的隔离入口运行；磁盘较慢或同机任务较多时，可显式设置 `AGENTFORGE_TEST_CONCURRENCY=2 npm test` 降低 Node 测试文件并发，不过滤测试、不调整断言或超时；默认并发保持 Node 默认值。

NAS 冷启动可用 `AGENTFORGE_TEST_STARTUP_TIMEOUT_MS=180000` 为两项隔离服务启动验收设置更长等待；仅影响 application-updates/auth 的首次 ready 等待，不改变后续 IPC 期限、运行时超时或安全断言。默认仍为原来的20/30秒。

test-automations.mjs 在隔离 Electron 验证自动化弹窗、两主题宽窄/短屏、服务端两级分页、普通任务隔离、完整工作区往返及 CLI 配置往返；不调用 Provider。AGENTFORGE_AUTOMATIONS_REAL=1 node scripts/test-automations-real.mjs 使用已有 Claude 登录，在隔离 HOME/数据中执行普通任务到界面人工确认，以及真正定时触发和下一轮自动确认；不修改操作者实例。

自动化真实验收遇到 Provider 延迟时，可用 AGENTFORGE_AUTOMATIONS_RESUME 指向本脚本已有的 .data/automations-real-* 目录续验已创建的自动化；使用同一冻结 Run/会话，不重建任务或复制凭据，等待上限为每轮十五分钟。可用 AGENTFORGE_AUTOMATIONS_PROVIDER=codex 选择 Codex；默认任务和自动化均不选流程模板。若已有轮次因外部错误失败，另显式设置 AGENTFORGE_AUTOMATIONS_RETRY=1，通过客户端恢复按钮续跑原会话（每轮最多一次），并检查失败状态仍可编辑成员。不要与高并发全量测试同时运行真实模型验收。

自动化真实验收可设置 AGENTFORGE_AUTOMATIONS_PROVIDER=codex；默认 claude-code。只切换隔离实例的员工 Runtime，不改变操作者配置；默认模型可通过 AGENTFORGE_AUTOMATIONS_MODEL 指定。

node scripts/test-issue3-ui.mjs 隔离验证两主题宽窄布局、成员 App/CLI 往返及沟通控制台；显示夹具不算模型证据。AGENTFORGE_ISSUE3_REAL=1 node scripts/test-issue3-real.mjs 验证真实新成员执行、员工目录 MCP、澄清与人类验收，不覆盖安装。

`test-issue3-ui.mjs` 同时验证共享原生弹窗的 Tab 圈定/焦点返回/表单 Esc 保留、Runtime 同行等高、工作目录页签刷新、CHANGE 标题工具与失败后恢复、减少动画。夹具 Git 仅在隔离任务目录初始化，不运行 Provider。

test-automations.mjs 同步验证任务标题列、当地时分秒格式、App/CLI 标题回读和宽窄表格布局；未创建任务的触发显示空标题。

自动化详情入口回归覆盖已创建任务的所有执行状态和窄窗口固定操作列；AGENTFORGE_AUTOMATIONS_APP 指定待安装 .app，可使用同一隔离 UI/API/CLI 验收运行打包客户端。

`AGENTFORGE_TASK_PARALLEL_REAL=1 node scripts/test-task-parallel-real.mjs`：真实 Claude、隔离 Electron/HOME/数据库/工作区，经理同时派 A/B，A 返回后派 C 且 B 尚未结束；核对每员工会话串行、CLI 全量进度、宽窄窗口以及最终人类确认。测试屏障只写隔离文件，证据保存在忽略的 `.data/task-parallel-real-*`。若验收工具中断，可用 `AGENTFORGE_TASK_PARALLEL_RESUME=.data/task-parallel-real-...` 恢复该隔离实例，结果明确标识重启续接，不覆盖首次证据。

`node scripts/test-communication-media.mjs`：隔离 Electron、HOME/数据/下载目录，不启动 Provider；验证图片/文件入口、缩略图、全窗口预览与 Esc 焦点返回、损坏图片、认证 preview 原字节及 401/415、原名文件下载、两主题宽窄自动化表格与描述背景。证据保存在忽略的 `.data/communication-media-*`；`AGENTFORGE_MEDIA_BASELINE=1` 只记录现状。

`node scripts/test-task-drafts.mjs` 在隔离 Electron 中验证两主题宽窄创建/保存/列表/筛选，草稿持久化无 Run、启动拒绝仍保留草稿、保存并开始，以及 CLI 创建/筛选与 App 互查。`AGENTFORGE_DRAFT_REAL=1` 追加真实 Claude 启动到人类确认；`AGENTFORGE_DRAFT_BASELINE=1` 只采集原界面。证据存于忽略的 `.data/task-drafts-*`，不覆盖已安装实例。

`node scripts/test-market-catalog.mjs`：隔离 Electron/HTTP/CLI 导入45插件、450 Skill、45 MCP，验证数据库分页/搜索、两主题宽窄界面、插件文件暂不可读时列表仍可读且详情报错、App/CLI软删除全员工解绑、历史冻结及文件保留；证据在忽略的 .data/market-catalog-*。

test-task-attachments.mjs：隔离 Electron 宽窄主题下上传图片/文件、无文字精确澄清、全窗口预览、下载和 CLI 二进制回读。AGENTFORGE_ATTACHMENTS_REAL=1 使用现有 Claude 账号执行真实索取附件→读取随机验证串与图片→人类确认任务，产出仅在 .data。

附件输入呈现验收：`test-task-attachments.mjs` 与 `test-communication-media.mjs` 在两主题宽窄窗口实际上传，核对图片包含在输入框内、文件卡片与图片同排置于文字区上方，图片 hover 无边框、纯图标入口、预览关闭及文本草稿保留；任务脚本继续验证空正文附件澄清发送，沟通脚本检查分别移除图片与文件。

附件呈现验收同时核对待发送图片/文件48px同高，以及发送后图片无名称/大小、图片和文件可横向同排。

test-roles-ui 验证角色扩展选择及多选控件固定高度；test-automations 验证成员/模板随正文滚动及停用自动化级联删除，均使用隔离实例。

`AGENTFORGE_ATTACHMENTS_REAL=1 AGENTFORGE_ROLE_EXTENSIONS_REAL=1 node scripts/test-task-attachments.mjs`：隔离真实 Claude 任务通过角色继承 Skill 读取随机验证串、处理人类附件并在客户端最终验收，验证执行配置实际生效。

`AGENTFORGE_COLLABORATION_SCROLL_ONLY=1 node scripts/test-collaboration-flow.mjs` 定向验证协作发送的阅读状态：1320/760px、历史页回复成功切回最新并滚到底部、失败保留历史/草稿/位置，以及“最新”按钮定位。使用暂停 Run 的真实澄清 HTTP 回复，核对仍暂停且 Trace 为零，不调用 Provider；失败为明确的 HTTP 拒绝夹具。

`AGENTFORGE_BRAND_ICONS_ONLY=1 node scripts/test-brand-presentation.mjs` 专项验证应用图标：极简/暖白主题、1320/760px 侧栏、透明圆角、无 CSS 边框与白色底板、原生 18/36px 模板及 Dock 留白。复用综合品牌脚本的图标断言，跳过员工/市场/目录/弹窗等非图标场景；`AGENTFORGE_BRAND_APP` 可指定构建包，数据、登录与截图仍全部隔离。


`node scripts/test-workflow-editor.mjs`：隔离Electron/真实认证HTTP和CLI，实际拖线、节点拖动/正文、失败保存保留、双主题1320/760、模板编辑不改冻结任务、CLI创建/编辑/删除与App回读。`AGENTFORGE_WORKFLOW_EDITOR_REAL=1` 另运行真实Claude完整任务，经理读取仅文件包含的随机连线标记，员工交付并核对文件，最终由测试操作者在UI确认完成；使用既有Claude原生配置，不输出或改写凭据。所有证据在忽略的.data/workflow-editor-*。

工作流分支：nodes.type=process/condition，edges.condition为自然语言条件（最多2000字符），默认流程/空条件；App/CLI同协议并冻结。条件节点菱形、经理选择满足条件的一条分支；预览返回保留画布有效尺寸。test-workflow-editor覆盖反复切换、宽窄布局、类型切换与分支保存回读。

`AGENTFORGE_WORKFLOW_EDITOR_APP=/absolute/path/AgentForge.app node scripts/test-workflow-editor.mjs` 对构建包运行同一工作流验收；packaged数据放隔离HOME的.agentforge/desktop，并隔离旧Chromium目录。覆盖标题位置、两字段属性栏、2/3节点、连续添加不移动旧图/不重叠、画布删除、键盘连线、隐藏补充字段不丢失、文本预览和CLI回读。

`test-workflow-editor.mjs`核对工作流标题输入480px上限、两主题与1320/760窗口画布交互；REAL模式通过CLI tasks create --workflow NAME --start执行真实条件分支，并在客户端验收。

test-task-creation增加任务/自动化★单选经理、业务员工协调、删除后重选和编辑回读，并以真实stdio MCP验证详情工具查询、搜索、schema及刷新；两主题宽窄布局。test-workflow-editor的REAL验收从CLI显式指定kind=business员工为经理，真实执行条件分支后客户端验收。

test-task-creation验证连接配置不可折叠且位于工具之前、23项全部显示且无搜索/分页/schema控件及刷新，员工卡片移除默认模型/思考摘要；test-workflow-editor核对两主题宽窄下32px标题输入与焦点环完整可见。纯呈现变化，无CLI/API契约变化。

test-task-creation补充11名已选员工及长姓名的换行、完整可见、经理切换与移除后保存验证，自动化新建/编辑同样支持多行；MCP连接配置必须是静态section且无summary。

test-workflow-editor覆盖普通节点鼠标/键盘第二出口拒绝及显式转条件、四边端口拖动与App/CLI回读、ELK整理保存、30节点只读缩放/本地整理不写回、宽窄双主题和错误草稿；REAL仍完成真实分支任务和人类验收。

test-portable-runtimes.mjs 验证九项 App/CLI Runtime 配置和员工绑定；真实 Provider 模式独立记录安装/账号阻塞，不将协议夹具当真实模型。

scripts/test-portable-extensions-real.mjs 需要 AGENTFORGE_PORTABLE_EXTENSIONS_REAL=1，可用 AGENTFORGE_PORTABLE_PROVIDERS 指定集合；实际调用模型，验证 Skill/相对资源/stdio、HTTP、SSE MCP 及原会话续接。test-portable-runtimes 支持 AGENTFORGE_PORTABLE_EXTENSIONS=1 进行角色继承与真实完整任务验收。

上述两个 portable 验证脚本均支持 AGENTFORGE_PORTABLE_AGENT_PROOF=1，额外调用原生独立子代理并核对其实际产物；扩展脚本验证两轮不同随机挑战和原会话续接，完整任务脚本验证角色继承直到客户端人类确认。Cursor 使用无工具约束源，其他目标使用显式 Read/Bash，不能将 Cursor 此项通过宣称为源工具约束兼容。

test-portable-runtimes 支持 AGENTFORGE_PORTABLE_EFFORT，真实模式先经 CLI 查询原生目录、在 App 选择模型和档位并保存回读，再执行完整任务/续接/确认。AGENTFORGE_VIDEO_PROOF=1 额外生成隔离 H264 视频，验证播放、seek、Range/416/认证及宽窄布局；可对签名包运行。

正式包验收 test-packaged-electron 从共享 RUNTIME_IDS 核对九项配置，任务创建显式选择所选成员中的经理；协议夹具按 taskRole 派工，不依赖员工类型或已移除的全量 Trace 上下文。真实模型验收仍独立记录。

`node scripts/test-storage-layout.mjs` 在独立 HOME/locator 中验证设置与 CLI 查询、资料校验搬运、自有服务重启、旧资料清理、认证保留和冻结引用；`AGENTFORGE_STORAGE_APP=/absolute/AgentForge.app` 改验安装包，`AGENTFORGE_STORAGE_REAL=1` 额外执行真实 Claude 原生 Skill 完整任务、客户端人类确认及搬运后精确会话续接。不是用协议夹具冒充真实模型。其他专项脚本显式设置当前协议的隔离 locator，打包总验收另检查默认数据/认证分离。

存储布局引入的控制根、认证根、先前 Runtime 根和实例类型环境变量同样由测试入口清除，防止客户端内发起测试时继承真实实例位置。

安装包冒烟的工作目录配置现在按“业务数据整理并重启服务”验收：核验新端点与当前根、客户端登录保留，以及独立 CLI 按新 origin 重新登录；不再等待旧的仅保存工作目录提示。

存储生命周期验收绑定真实 stdio MCP 探针；REAL 模式除原生 Skill 外，须实际调用工具取得随机事实，搬运后原会话再调用一次，不能仅以目录可读替代调用前链路验证。

存储验收可用 AGENTFORGE_STORAGE_TEST_ROOT 指定专用临时父目录；默认仍保存到忽略的 .data。NAS 源码冷启动超时时优先使用已构建 ASAR 与系统临时数据目录复核，不能用调整产品重试次数掩盖读取入口错误。

员工启动目录：新普通任务与自动化采用 `<工作目录>/tasks/<TaskID>/<RunID>`；沟通采用 Store 首次分配并持久保存的 `<工作目录>/communications/<会话ID>`，群聊成员共享文件目录但原生会话独立。既有任务路径不重写，已分配的沟通目录不随工作根切换；目录变更重建模型上下文并保留聊天历史。内部附件、提示词和执行内容仍由 Run Files 管理，详见 docs/30-storage-layout.md 与 docs/17-communication.md。

`test-storage-layout.mjs` 的真实模式同时验收 tasks/TaskID/RunID、两名群成员读取同一相对文件并报告真实 pwd、私聊目录与原生会话隔离；工作根更换后沟通已分配目录保持，最后在隔离客户端清除工作根并确认配置/认证保留。

提示词精简验收：test-workflow-editor 的 REAL 模式额外验证长沟通正文 contentRef 真实读取、同一原生会话无正文重放的记忆、长任务目标与长节点正文文件读取，以及跨经理轮次稳定的冻结工作流路径；普通任务与单人自动化均在客户端最终确认。tests/prompts、communication、run-files-security 覆盖巡检/群聊去重、状态增量及清空、失败输入回执、资料完整性/链接拒绝。

`AGENTFORGE_SHARED_COLLABORATION_REAL=1 node scripts/test-shared-collaboration-real.mjs` 使用隔离HOME/实例与真实Claude：分别发言、读取发给经理的同伴公开报告、员工间咨询及原生续接、完整公开正文、无背景唤醒与客户端最终确认。可指定 AGENTFORGE_SHARED_COLLABORATION_APP=/absolute/AgentForge.app 核验构建包；不修改操作者实例，证据仅在忽略的 .data/shared-collaboration-*。

共享协作真实验收可用 `AGENTFORGE_SHARED_COLLABORATION_RESUME=/absolute/.data/shared-collaboration-XXX` 重新核对同一隔离实例并完成客户端验收；只允许本脚本证据目录且 Run 须已待验收，不重新派工、不覆盖首次失败记录。
