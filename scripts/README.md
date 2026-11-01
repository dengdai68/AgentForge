# 工程脚本

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

AGENTFORGE_PROMPT_E2E_REAL=1 AGENTFORGE_PROMPT_E2E_PACKAGED=1 node scripts/test-prompt-e2e.mjs 使用当前安装包的隔离 Electron（不与 WEB 模式混用）。两个真实 Provider 在续接时实际调用平台历史 search_private_chat/read_context 取回未放入提示词的随机资料；再完成 Claude 团队代码开发、澄清、独立测试、人类确认、完成后历史答疑和归档拒绝。调用使用现有模型登录，不读取/复制凭据，不覆盖操作者实例；证据明确 packaged surface。package:mac:check 另用受控 Provider 消费实际 Codex 参数，连接真正的打包历史 MCP，断言 Node 标记仅在子进程且八工具及记录可读，不冒充模型。

build-app-icon.cjs 保留用户原始 application.png，使用 macOS Swift/CoreGraphics 生成干净圆角 UI 图、透明边距 100/1024 的 Dock 图及 18/36px 单色菜单栏模板，sips/iconutil 从 Dock 图生成同尺度 ICNS。临时文件使用专用 mkdtemp；无浏览器、网络、新包依赖或操作者配置访问。按 web/icons/README.md 重生成并验证，发布读取已生成资源。

test-directory-headers.mjs 覆盖任务操作顺序、任务/归档顶栏名称、无占位的内部语义标题、归档往返搜索保留、团队/工作流跨页搜索/空态/清空与宽窄 客户端布局；test-electron.mjs 对真实 DOM 验证完整脱敏系统/本轮输入、会话 ID、无工具审计详情、人类气泡外元信息与 @成员。使用隔离数据与明确标记的展示夹具。

test-electron.mjs 用两个不同原生 ID、完全相同参数的 MCP 调用验证两行各自输入/输出，同时重复投递每个调用的开始/完成阶段，确认只修复单次调用重复渲染，不按参数合并真实调用。

`AGENTFORGE_PROMPT_E2E_REAL=1 node scripts/test-prompt-e2e.mjs` 在隔离客户端以真实 Claude/Codex 验证系统指令及原生会话记忆（不重发随机码），再以 Claude 团队执行澄清阻塞、代码实现、独立测试及界面人类确认。只使用已有 CLI 登录，不复制/修改凭据，不接触真实任务。

失败后可通过 AGENTFORGE_PROMPT_E2E_RESUME=.data/prompt-e2e-<证据目录> 续接同一隔离 Run；只允许该测试目录，保留失败记录和原生会话，通过正常消息请求经理继续，不编辑领域数据库。测试可使用正常 retry-now 命令作最多两次显式重试，不以重跑抹去失败。

`node scripts/test-directory-headers.mjs` 在隔离实例操作任务、沟通、团队、工作流、员工和 MCP 六页，覆盖 客户端宽窄布局及创建弹框，不启动 Provider。`AGENTFORGE_DIRECTORY_HEADERS_PACKAGED=1` 检查本地构建安装包；`AGENTFORGE_DIRECTORY_HEADERS_BASELINE=1` 仅采集改动前几何/截图，不能作为改动后断言通过。

沟通工作台验收断言顶部只出现最新/刷新、私聊无重复员工标签；群聊成员切换仍可操作且不在顶部工具栏，加载历史、折叠草稿和宽窄布局继续验证。

`test-communication-workbench.mjs` 覆盖真实市场卡片、附件上传/下载、同名文件、未读与半屏控制台及真实 HTTP 失败路径。显式 `AGENTFORGE_COMMUNICATION_E2E_REAL=1` 在源码隔离客户端调用已有 Claude Code，读取随机附件标记并触发缺失文件工具失败；host HOME/数据库/下载隔离。`AGENTFORGE_COMMUNICATION_E2E_PACKAGED=1` 仅安装包受控验收，不与 REAL 同用。不复制凭据或重置真实实例。

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
