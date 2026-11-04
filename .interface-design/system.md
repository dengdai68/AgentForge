# AgentForge 现有界面规范

> 使用 `interface-design:interface-design` 从现有实现与实际客户端抽取；以现有任务中心为基准，记录抽取结果及随后获准实施的一致性修复。
> 抽取与修复日期：2026-11-05；初始源码基线：`b95bbac`。本文记录公共视觉与交互规范；自动化任务标题和 App/CLI 投影契约另见 `docs/27-automations.md`。
> 贡献规则仍以 `AGENTS.md` 为准，产品设计说明仍见 [docs/06-design-system.md](../docs/06-design-system.md)。后续实现变化时应重新核对生效样式，不能用本文覆盖更新后的产品事实。

## 1. 证据与适用范围

初次规范抽取时实际检查隔离 Electron 实例中的设置（常规、Runtime 收起/展开、外观）、任务中心、数字员工、角色、自动化列表，以及新建任务、创建员工和删除工作流确认弹窗。使用隔离 HOME、数据库和目录夹具，没有调用 Provider、启动业务任务、重启或改写已安装实例。

尺寸以 `getComputedStyle` 和 DOM `getBoundingClientRect()` 的 CSS px 为准，不按 Retina 截图的像素估算。宽屏为 1280 × 850、极简主题；窄屏为 760 × 600、暖白主题。760px 是当前 Electron 最小窗口宽度，不代表手机端验收。

- **实测**：23 个页面状态均无整页水平溢出、无 renderer pageerror（不等同于全业务验收）；以上页面的布局、字体、控件、表面；搜索空态、Runtime 展开、主按钮悬停、输入焦点、必填错误、主题切换、表单 Esc/遮罩保留和确认框 Esc 关闭。
- **源码核对**：共享多选器、浮层定位、禁用/加载/读取错误、员工只读详情、状态色、动画及响应式断点。未逐一制造网络失败、Provider 故障或所有业务状态，不能把源码规则说成全场景验证。
- 初次抽取证据：`.data/ui-system-audit-qH4Zia/`；一致性修复后重新测量：`.data/ui-system-audit-UWYTEa/`。工作目录及弹窗回归见 `scripts/test-issue3-ui.mjs`（通过，证据 `.data/issue3-ui-XT76he/`），覆盖两种主题、1320/760px 窗口、浅/深色文件预览、键盘焦点、差异切换、刷新和读取失败恢复，并验证粗指针点击区域及减少动画。所有截图、测试数据、日志和临时审查脚本均保留在忽略的 `.data/`，不提交。

### 样式来源与读取顺序

| 层 | 文件 / 稳定定位点 | 职责 |
| --- | --- | --- |
| 共享基础 | [web/styles.css](../web/styles.css)，`:root`、主题块及后续组件覆盖 | 品牌语义、组件结构、业务状态、响应式规则 |
| 桌面密度 | [apps/electron/compact.css](../apps/electron/compact.css)，`html:root, html:root[data-theme]` | 字体、侧栏、紧凑控件、列表、设置及弹窗密度 |
| 注入 | [server/index.mjs](../server/index.mjs)，`serveStatic → presented` | HTML 的 `</head>` 前注入 `#agentforge-desktop-style`，不是独立 Web 外观 |
| 页面结构 | [web/index.html](../web/index.html)、[web/app.js](../web/app.js) | 主导航、目录容器、任务、员工、角色及共享弹窗 |

公共 CSS 存在多轮同名覆盖；应以实际选择器优先级、主题与桌面覆盖共同计算后的值为准。不要直接复制较早的绿色主题、16/18px 弹窗圆角或 24px 设置卡片内边距。

## 2. 当前方向与层级

**方向**：高密度桌面工作台。任务、员工和配置是主体，页面用细边线、浅色表面和紧凑文字组织信息；没有营销式大标题、巨型留白或装饰性渐变卡片。

按 skill 的领域检查记录现有特征：

- 领域概念：任务、协作记录、数字员工、项目经理、工作流、自动化触发、控制台与工作目录。
- 色彩来源：蓝/青/紫缎带 A 品牌图标、白色工作面、蓝灰正文与边线、琥珀待处理、红色错误。头像额外使用橙与绿表达身份。
- 产品识别点：应用 A 图标；紧凑操作侧栏；员工实色双字头像；带文字的任务状态；角色间沟通与“本轮控制台”证据入口。后两项由源码与现有文档核对，本次未执行模型会话。
- 已有布局选择：顶栏代替重复大标题；列表/分隔行代替每段配置套卡片；正文阅读与控制台证据分开。这是对现状的概括，不新增设计方向。

**焦点组织**：列表首先可见搜索和右侧主操作，随后读取名称与状态；设置以 15px 分组标题 → 13px 子项 → 12/11px 配置说明递减；新建任务将主要空间给内容描述，成员、工作流与提交操作留在底部。

**深度**：页面、表格和卡片主要采用边线与表面色，桌面 `--shadow` / `--shadow-hover` 均为 `none`。弹窗已改用共享 `--shadow`，桌面为无投影；模糊遮罩与细边框承担模态层级，不再使用独立强阴影。

## 3. 色彩与主题

以下为现有 CSS 变量；除主题中性表面外，两主题共用品牌及状态语义。

| 用途 | Token | 当前值 |
| --- | --- | --- |
| 主操作 / 焦点 / 可用 | `--accent` | `#2558d9` |
| 主操作悬停 | `--accent-hover` | `#1e46b7` |
| 蓝色浅底 / 边线 | `--accent-soft` / `--accent-line` | `#edf3ff` / `#cddcfa` |
| 紫色强调 / 浅底 | `--accent-violet` / `--accent-violet-soft` | `#6b4ec4` / `#f1edff` |
| 青色强调 / 浅底 | `--accent-cyan` / `--accent-cyan-soft` | `#076b8b` / `#e8f7fc` |
| 正文 / 辅助信息 | `--ink` / `--muted` | `#17233d` / `#5f6e87` |
| 白色工作面 / 边线 | `--paper` / `--line` | `#ffffff` / `#dfe5f1` |
| 深色基值 | `--dark` | `#0c1735` |
| 错误边线 / 错误文字 / 浅底 | `--danger` / `--danger-ink` / `--danger-soft` | `#c53838` / `#a52a2a` / `#fff1f0` |
| 待处理文字 / 浅底 | `--record-warning` / `--record-warning-soft` | `#8d5d14` / `#fff7e8` |

| 中性表面 Token | 极简 `minimal` | 暖白 `warm` |
| --- | --- | --- |
| `--bg` | `#f7f9ff` | `#faf9fc` |
| `--desktop-sidebar-bg` | `#f0f4fd` | `#f3f2fa` |
| `--surface-soft` | `#f2f5fc` | `#f4f3fa` |
| `--selection-bg` | `#e8efff` | `#eaeaff` |
| `--desktop-hover` | `var(--surface-soft)` | `#f0eff8` |

主工作面实际为 `--paper`，不是把 `--bg` 整页铺满。暖白仍是浅色主题；文件树/终端的局部主题不等于应用全局暗色模式。

变量关系：`--desktop-action`、`--desktop-focus` 引用 `--accent`；`--record-info` 引用蓝，`--record-teal` 引用青，`--record-violet` 引用紫。`--lime` / `--lime-dark` 是兼容命名，当前也是蓝色，不应按名字理解为绿色。

状态规则见 `web/styles.css` 的 “Shared brand semantics” 段（约 1543 行）：可用/进行中/待验收使用蓝；完成使用青；等待人类使用琥珀；失败/阻塞使用红；取消/暂停使用中性。状态始终有文字，不仅靠颜色表达，也不凭颜色推断业务验收通过。

头像颜色是身份色，不能当状态色：紫 `#7341b8`、青 `#007d86`、蓝 `#2461c2`、橙 `#ad5508`、绿 `#25803e`，白色字；系统色为 `#344568`。来源为共享 `.color-*` 选择器。

## 4. 字体层级

桌面正文为 `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`，`13px / 1.5 / 400`，实测行高 19.5px。控件继承系统字体。代码、路径和计数局部使用 `ui-monospace, SFMono-Regular, monospace` 等等宽栈；公共 CSS 顶部的 Google Fonts 引用不代表桌面正文实际使用 Space Grotesk。

| 层级 | 当前字号 / 字重 / 行高 | 代表组件 |
| --- | --- | --- |
| 弹窗标题 | 18px / 700 / 27px，字距 `-.02em` | `.modal h2` |
| 员工只读姓名（源码） | 17px，标题默认粗体 | `.employee-profile-identity h3` |
| 设置分组标题 | 15px / 700 / 22.5px | `.settings-section h3` |
| 品牌名称 | 14px / 600，字距 `-.02em` | `.brand strong` |
| 设置子标题 / 卡片名称 | 13px / 600；设置 19.5px，卡片名称 20px | `.settings-section h4`、`.agent-card h3` |
| 顶栏 / 表格任务名 | 13px / 500 | `.breadcrumb strong`、`#tasks-table .table-title` |
| 正文 / 任务和员工表单值 | 13px / 400；长描述常用 1.6–1.75 | `body`、任务/员工表单、Markdown |
| 控件文字 / 字段标签 / 设置说明 | 12px；按钮 500、普通标签 400 | 通用按钮、`.form-field label`、`.settings-description` |
| 元数据 / 提示 / 状态 / 表头 | 11px；提示行高 16.5px | `.field-hint`、`.field-error`、`.status-pill`、表头 |
| 导航分组 / 小头像字 | 10px；导航分组 500，字距 `.04em` | `.nav-label`、小头像 |

当前没有统一字号 Token，也不是严格的 1.25 比例字阶。不要把 skill 的建议比例写成项目已实现规则。信息主次主要由大小、字重、`ink/muted` 和间距共同表达；未发现统一的四级文字颜色 Token。

## 5. 间距、布局与圆角

项目尚无完整 spacing Token。可辨认的结构节奏以 4px 为参考，但大量既有值是 5/6/10/14/18px，**不能声称全站已经严格遵守 4px 网格**。后续复用时优先复用组件整体，不自行四舍五入现有值。

| 场景 | 已有尺寸 |
| --- | --- |
| 桌面侧栏 | 宽 216px；内边距 `14px 8px 10px`；图标 16px；应用图标 24px |
| 顶栏 | 高 44px；左右内边距 18px；底边 1px |
| 主页面 | `.view` 内边距 `14px 18px 20px` |
| 表格目录 | 任务搜索项 gap 8px；搜索区至表格 8px；自动化列表沿用 8px |
| 卡片目录 | 工具栏高至少 44px、上下 padding 4px、下 margin 14px；卡片网格 gap 14px |
| 数字员工 / 角色卡片 | padding 16px；最小网格列宽 `min(310px,100%)`；宽屏可多列 |
| 设置 | 外层最大宽 960px；分类列 140px；列 gap 20px；内容最大宽 760px；内容左侧 padding 20px 与 1px 分隔线 |
| 字段 | `.form-field` 下 margin 8px；标签至控件 5px；内边距 `8px 10px` |
| Runtime 展开 | 上 margin 12px；模型/思考列比例 1.5:1、gap 12px；操作区上 padding 8px |
| 弹窗 | 宽屏 padding 18px；小窗口为 14px；内容滚动组另有 2px padding；底部操作上 padding 10px |

圆角分层：4px（状态、标签、局部焦点）→ 5px（输入、按钮、导航、紧凑提示）→ 6px（头像、主题卡、共享空态、提示词背景）→ 8px（员工卡片、弹窗）。Runtime 开关为 12px 圆角，圆点/圆形图标另按形状处理；并非所有容器都圆角化。

响应式来源：`compact.css` 的 1000/900/760px 与 `max-height:620px` 规则、共享 CSS 的表单规则。≤1000px 侧栏变 64px，仅保留图标，页面水平 padding 14px；≤900px 设置改为单列分类区+内容区，分隔线转到上方；≤1100px 或高度≤620px 弹窗 padding 14px。表格保留内容最小宽度并由容器横向滚动，不压扁所有列。

## 6. 可复用组件模式

### 列表工具栏与卡片

- **搜索 / 筛选**：32px 高，`5px 9px` padding，12px 字，5px 圆角，白底、1px `--line`。主目录统一选择器位于 `compact.css` 约 485 行。任务搜索宽 240px、选择框宽 140px；员工/角色搜索最大宽 400px，实际宽度可收缩。
- **任务中心基准**：搜索、状态、工作流和操作在同一工具栏；名称、工作流、状态、更新与操作按表格列展示；任务单元格 padding `10px 12px`，表头 `8px 10px`。源码 `app.js` 的 `renderTasks` 相关段、`#task-search-form`、`#tasks-table`。
- **数字员工 / 角色基准**：`directory-toolbar` + `agent-grid` + `agent-card`；员工头像 30×30px、圆角 6px；姓名与可用状态顶部对齐，普通员工不重复类型；简介与底部元信息分层。角色复用布局，不展示角色 ID、创建时间、绑定人数。
- **共享空态**：`.directory-empty` 跨满列表宽度，padding `14px 16px`，1px 虚线、6px 圆角、`surface-soft` 背景、muted 文字、12px/1.6；本次自动化空态与员工无匹配均为标题+说明两行，实测约 74px 高；纯单行按当前盒模型约 49.2px，内容换行后自然增高。空态不重复创建按钮。
- **分页**：[web/pagination.mjs](../web/pagination.mjs) 维护共享分页；当前页、禁用页按钮及查询重置页码沿用现有实现，不用视觉调整改变查询语义。

自动化触发记录首列为任务标题（280px），长标题省略并通过 title 查看全文；表格最小宽度1100px，窄窗口仅表格内部横向滚动，保留计划时间、触发方式、状态、完成方式及操作。实现位置：`web/automations.mjs`、`web/styles.css .automation-trigger-table/.automation-trigger-title` 与 `apps/electron/compact.css .automation-trigger-table`。

### 按钮与表单

| 组件 | 当前规格 | 使用边界 |
| --- | --- | --- |
| 通用按钮 | min-height 30px（主目录创建按钮为 32px）；`5px 10px`；12px/500；1px 边线；5px 圆角 | `.primary-button/.ghost-button/.danger-button/.small-button`；实际高度受行高影响 |
| 任务工具栏按钮 | min-height 32px | 同行搜索和筛选 |
| 表格行操作 | min-height 26px；`3px 7px`；11px | `.table-actions .small-button` |
| 普通输入 / 下拉 | `8px 10px`；1px 边线；5px 圆角；白底 | 高度由字体和行高决定，不统一硬写 32px |
| 任务标题 / 工作流 | 实测 37.5px 高，13px/19.5px | 新建任务弹窗 |
| Runtime 模型输入 / 思考下拉 | 统一 37.5px、13px/1.5 | 与新建任务字段一致 |
| 仓库访问同行输入/按钮（源码） | 明确 height/min-height 36px | `.repository-token-row` |
| 单选 / 复选 | 设置通常 15×15px | 包含标签的选项提供点击范围；选中有文字和边线/浅底 |
| Runtime 可用开关 | 32×19px，圆点 13px，圆角 12px | 原生 checkbox + `role=switch`；开为蓝白，关为中性 |

主按钮悬停变 `accent-hover`，没有放大、上浮或阴影；次按钮悬停用 `desktop-hover`、边线 `--control-hover-border`（引用 `--accent-line`）；危险按钮默认红字白底，悬停红浅底及红边。通用禁用 opacity .5、not-allowed；Runtime 开关禁用 .6，分页禁用 .45，是当前组件差异。

### 设置与弹窗

- 设置由 [web/settings.mjs](../web/settings.mjs) 的 `createSettingsUI` 维护；用 `.settings-layout/.settings-nav/.settings-section`，不是外套大卡片。Runtime 用原生 `details/summary` 收起展开，展开时才创建编辑区，收起保留草稿。
- 共享弹窗由 [web/app.js](../web/app.js) 的 `openModal/closeModal/confirmDialog` 维护（约 200 行），壳在 [web/index.html](../web/index.html) 的 `#modal-backdrop`。外层为原生 `<dialog>`，使用 `showModal()/close()`；浏览器负责背景不可交互与 Tab 模态，标题通过 `aria-labelledby` 关联。打开聚焦首个输入或按钮，关闭返回触发入口；入口已移除则回到当前导航。
- 通用宽度上限 560px；确认框 440px；员工配置 760px；任务创建 900px 且不超视口减 40px；员工只读详情 640px 且不超视口减 32px。高度与视口、表单类型共同约束，正文滚动，操作区保留。
- 新建任务的正文为主要输入区域，13px、行高 1.65，textarea 高度约 6–12 行自适应；验收标准为可选 `details`，底部保留成员多选、工作流和操作。复用 `newTaskModal`，自动化增加调度字段。
- 员工只读详情（源码）：[web/communication.js](../web/communication.js) 的 `employeeDetailMarkup` 与 `app.js` 的 `showEmployeeDetail`；头部头像+姓名+小字类型，简介与工作提示词直接展开，无重复“员工详细信息”标题；提示词底色 `surface-soft`、padding `12px 16px`、圆角 6px、13px/1.75。样式位于 `styles.css` 的 `.employee-profile-*`，约 2124 行。

### 多选与浮层

[web/marketplace.mjs](../web/marketplace.mjs) 的 `createEmployeeMultiSelect` 共用于成员、角色、插件与 MCP。已选标签与搜索在同一边框内，不另外生成一份已选列表；不可选项有原因与 disabled。支持方向键、Home/End、Enter、Escape，以及空输入 Backspace 移除可移除的最后一项。

[web/floating-list.mjs](../web/floating-list.mjs) 的 `createFloatingList` 使用原生 Popover 顶层，锚点宽度、默认最大高度 240px、间隙 4px、视口安全边 8px；空间不足向上翻转；透明间隙桥保证鼠标连续悬停；滚动/resize 更新定位。Runtime 模型候选将最大高度配置为 226px。焦点或点击离开收起，不清空已选值。

### 工作目录

“当前文件 / CHANGE”与右侧无边框刷新图标在同一行，行下无分隔线；当前页签决定刷新对象，忙碌时禁用，失败后恢复可点击。两个文件预览共用 `.artifact-viewer-head`：左侧文件名与版本/时间，右侧操作；当前文件保留下载，CHANGE 放置行内/左右对比与仅差异/完整文件四个图标。移除独立更改计数工具栏。深色文件主题下标题和图标保持可读，窄窗口允许按空间换行。

## 7. 交互状态与动效

| 状态 | 当前实现 / 本次证据 |
| --- | --- |
| 导航选中 | 主导航和设置分类均为蓝字 + `selection-bg`、字重 500；主题选中为 accent 边框 + accent-soft 浅底 |
| 键盘焦点 | 通用 `:focus-visible`：2px accent outline、offset 2px；输入使用 accent border + `0 0 0 2px var(--control-focus-ring)`，Token 引用 accent-line；Runtime 开关 offset 2px |
| 输入错误 | 必填提交后 `.invalid` 红边和 `.field-error` 文字，保留表单内容；实测新建任务 |
| 表单关闭 | Esc 和遮罩不关闭；显式取消/关闭才退出；实测新建任务 |
| 确认框关闭 | Esc、遮罩、取消、关闭视作取消；实测删除工作流的 Esc，没有执行删除 |
| 关闭后焦点 | 返回打开入口，入口不存在时回到当前导航；原生 dialog 提供键盘模态 |
| 空列表 | 共享 `.directory-empty`；实测员工无匹配与自动化未创建 |
| 加载 / 读取错误 | 代码区分加载、失败、真实空结果；市场使用独立整行状态区，字段错误就地展示；本次没有注入请求失败 |
| 保存 / 请求中 | 原有按钮 disabled、状态文字或 toast；不以 UI 色彩假定请求成功；源码核对 |

桌面页面切换 `.view` 无动画，导航 transition 为 none。共享弹窗仍为遮罩淡入 180ms、内容 220ms（`translateY(10px) scale(.99)` → 正常，ease）；遮罩 blur 4px。加载旋转、执行圆点和共享弹窗均响应 reduced-motion；共享弹窗在减少动画时取消入场动画。

## 8. 冲突、例外与已有基准建议

原审查冲突已按以下决定处理。保留的尺寸差异有明确使用场景，不作为待修缺陷。

| 原问题 | 处理结果与现行基准 | 对应位置 |
| --- | --- | --- |
| 目录输入 32px、创建按钮 30px | 主目录创建按钮统一至少 32px；普通表单按钮保留 30px、表格行操作 26px，按场景分级 | `compact.css` 目录/按钮 |
| Runtime 输入 37.5px、下拉 36px | 模型与思考统一 13px、1.5 行高、37.5px，与新建任务一致 | `.runtime-inline-editor` |
| 表格后距 8px、卡片后距 14px | 明确保留表格/卡片两种密度；任务和自动化为 8px，员工与角色为 14px | 目录样式与第 5 节 |
| 设置/主题与主导航选中颜色不同 | 设置分类统一蓝字浅底，主题选中用 accent 边线和 accent-soft | `.settings-nav/.theme-option` |
| 弹窗硬编码强阴影 | 改为共享 `--shadow`，桌面为 none；原生 select 候选也使用共享阴影 | `.modal`、`::picker(select)` |
| 焦点环硬编码、offset 不同 | 输入使用 `--control-focus-ring`；开关和普通键盘控件 offset 均为 2px；行内改名保留已确认的单边线焦点特例 | `styles.css :root`、`compact.css` |
| 表单 Esc 文案与行为冲突 | 表单关闭 title 为“关闭”；非表单为“关闭（Esc）”；表单仍保护草稿 | `app.js openModal` |
| 弹窗缺少焦点圈定/归还 | 改为原生 dialog 模态，显式返回触发入口；无入口时返回当前导航 | `index.html`、`app.js openModal/closeModal` |
| 主题缩略图颜色过时 | 两张预览分别使用现行极简蓝灰/暖白淡紫表面 | `.theme-preview` |
| 多层 CSS 存在历史声明 | 继续保留共享结构+桌面密度分层，以实际桌面生效值为准；本轮受影响声明直接修改，不进行无证据的全文件重写 | 第 1 节的来源顺序 |
| 紧凑控件与触控/减少动画建议冲突 | 桌面保留用户要求的 32px 目录密度；粗指针主要按钮和设置标签提供至少 44px 区域；共享弹窗支持 reduced-motion | `@media(pointer:coarse)`、`prefers-reduced-motion` |

**整体基准推荐任务中心**：它已确定 32px 搜索/筛选尺寸、紧凑顶栏、8px 列表间距及表格密度，也符合已有用户要求。组件层面补充参考：数字员工负责卡片目录；Runtime 设置负责配置层级；新建任务负责长表单弹窗；删除工作流负责短确认框结构。复用时先按场景选择，再核对本节场景差异。

## 9. 后续复用定位清单

| 要复用的能力 | 组件 / 样式入口 |
| --- | --- |
| 品牌、表面、状态、头像 | `web/styles.css :root / Shared brand semantics`；`apps/electron/compact.css` 顶部 tokens |
| 导航、页面壳、密度与断点 | `web/index.html`、`web/preferences.mjs NAVIGATION`；`compact.css .sidebar/.topbar/.view` |
| 列表搜索与卡片 | `web/index.html .directory-toolbar`、`web/app.js` 目录 renderer；`styles.css .directory-toolbar/.directory-empty`、`compact.css` 目录覆盖 |
| 自动化列表、详情和配置 | `web/automations.mjs`；`styles.css .automation-*`、`compact.css #automation-search` |
| 设置与 Runtime | `web/settings.mjs createSettingsUI`；`compact.css .settings-* / .runtime-*` |
| 表单 / 弹窗 | `web/app.js openModal/closeModal/confirmDialog/newTaskModal/newAgentModal`；`styles.css .modal-*`、`compact.css` forms 段 |
| 多选 / 模型浮层 | `web/marketplace.mjs createEmployeeMultiSelect`、`web/floating-list.mjs createFloatingList`、`web/settings.mjs showModels` |
| 员工只读资料 | `web/communication.js employeeDetailMarkup`、`web/app.js showEmployeeDetail`；`styles.css .employee-profile-*` |
| 分页 | `web/pagination.mjs`；`styles.css .list-pagination` |

本轮新增两个共享颜色语义 Token：`--control-focus-ring`、`--control-hover-border`，均引用已有 accent-line；采用浏览器原生 dialog，不增加框架或依赖。App/CLI 业务能力无变化，无需新增 CLI 命令。

触发记录操作列固定右侧，复用 paper 背景与 line 分隔；所有已创建 Task/Run 均保留「查看详情」，不按执行状态隐藏。
