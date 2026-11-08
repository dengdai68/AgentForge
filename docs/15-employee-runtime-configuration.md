# 数字员工与扩展配置

重复手动导入按同一来源地址＋插件名称匹配插件，按安装名称（去首尾空格、区分大小写）匹配 MCP；不同来源的同名插件保留。成功以新不可变版本覆盖当前目录项，原子更新所有当前员工（含停用）的选择并合并重复引用；Task/Run、排队投递和历史文件不变。致命失败整批保留原目录及绑定，候选从当前目录退役。首次安装不自动绑定员工；已存在的重复项在下次同标识导入时一并替换，不做全库清理。响应增加 replacements（kind/id/previousId/name）、employees（仅 ID/名称）、historyRetained；原 plugins/mcps 或 MCP 摘要字段不变。

设置 → 插件更新提供自动更新开关、检查周期（整数分钟，1–1440，默认2分钟）、立即检查和最近结果；插件市场仅管理安装项。只更新已安装 Git 来源插件；本地目录不自动轮询，固定 sha 不追随 HEAD。以来源及依赖 Git 提交判断变化，版本号不变仍可更新。仅安装仍在当前列表中的名称，已删除项不重装；来源移除某已装插件、读取失败、格式/完整性/Runtime兼容或并发绑定冲突时保留该来源当前版本并记录诊断。其他来源仍检查。MCP 不随自动插件更新拆装或改变选择；Task/Run/排队投递不改写。服务运行时有效，退出后不运行，重启后重新计时；开关与周期持久化，最近结果不伪装为跨重启历史。GET/POST /api/runtime/marketplace/updates 查询/请求检查（POST返回202，之后查询结果）；PUT .../updates/settings 接受非空部分对象 {enabled?:boolean,intervalMinutes?:integer}，拒绝未知字段。上轮结束后按已保存周期再计时；保存设置重新计时，关闭不取消已开始检查，关闭时仍可立即检查。设置草稿不被状态刷新覆盖。

MCP 详情提供编辑名称、说明及 JSON；保存生成新版本并原子更新当前员工的 mcpIds，列表只保留新的当前版本，已启动任务和排队调用保持旧快照。PUT /api/runtime/mcp-marketplace/:id 接受非空部分对象 {name?,description?,content?}；content 是完整单服务 JSON 字符串，省略保留配置。GET 中未改动的脱敏值在相同 JSON 位置保留，删除字段清除，重命名服务或鉴权字段须填写真实新值。失败保留旧绑定；新候选退役且文件不作历史改写。返回新 id、previousId、employees（仅 ID/名称）、historyRetained。旧 ID 再编辑返回404；不兼容时整次拒绝。

未填写扩展选择等同于空选择，不继承用户/项目的全局 MCP 和插件。Codex 每次调用显式关闭账号 Apps（`features.apps=false`）；Claude 使用 strict-mcp-config 与空 setting-sources，并仅沿用模型连接环境。所选 MCP 与平台历史服务仍加载，Runtime 基础文件、Shell、原生搜索工具不在此扩展清单中；这不是 OS 沙箱。员工资料/插件/MCP 编辑不重建原生沟通记忆，下一轮应用新配置。参见 [Codex 官方配置](https://developers.openai.com/codex/config-reference/) 与 [Claude CLI](https://code.claude.com/docs/en/cli-reference)。

## 已安装项管理

员工插件/MCP 的搜索下拉在鼠标移出选择区、点击表单其他区域、Tab 离开或 Escape 时收起，不再遮住后续字段；点击已聚焦输入可重开。鼠标选择、方向键/Enter、多选和移除仍保留，收起不改已选 ID。仅共享 renderer 交互调整，HTTP/CLI 输入输出、兼容性校验和 Runtime 加载不变。

卡片的名称区、三行简介、Runtime 信息和操作区保持稳定位置；长内容在卡片省略，插件/MCP 详情及员工编辑保留完整信息。插件详情采用一个有界正文滚动区，概览和组件随正文滚动，标签页吸顶，标题及删除/关闭按钮固定可见；多 Skill、长简介和窄窗口均不裁掉末尾组件。

员工、插件和 MCP 页面均提供同行搜索与创建/安装操作；按名称和说明不区分大小写过滤，再按每页 20 项分页，输入变化回到第一页。员工也匹配能力标签。插件/MCP 复用员工卡片样式，详情底部「删除」使用应用确认框。CLI 对应 `plugins delete ID --yes` / `mcps delete ID --yes`。

删除在同一 Store/SQLite 事务中将目录条目标为 deletedAt，并解除所有数字员工（含停用、已删除目录记录）的当前绑定与派生加载路径；回执包含 employees 的 ID/名称。成功后从目录和选择器隐藏，详情返回 404，禁止新绑定；独立 MCP 不随插件删除。历史任务/执行的冻结引用和不可变文件保留，删除不是清理历史文件或撤销正在运行的历史执行。

## 当前迭代契约：仓库整批安装与跨 Runtime 加载

安装入口仅输入 HTTPS Git 地址或本机目录，直接安装来源中全部插件，不再提供信任勾选、候选读取或单插件选择。识别 Claude `.claude-plugin`、Codex `.codex-plugin`/`.agents/plugins` 和 Agent Plugins 根 manifest；组件标准化后按 Runtime 生成加载投影，不改全局 CLI 配置。可共用 Skill；Subagent/Hook 使用本机 Provider 的真实能力，不能映射的事件明确报告兼容性，不用提示词冒充已执行。

来源中有效组件作为一次原子安装发布；Skill/Hook/Subagent 定义格式错误独立跳过并返回 warnings，不影响有效兄弟组件。路径/完整性等致命错误仍不发布部分目录。详见 docs/26。插件自带 MCP 拆为独立市场版本，仍须员工单独选择，不随插件加载。MCP 接受 stdio、sse、streamableHttp（及标准 http/streamable-http 拼写），复用已有 MCP SDK 的客户端传输，在私有 stdio 启动器中桥接，供九种 Runtime 统一加载；不自动配置 OAuth 或安装依赖。

员工新建和编辑均支持 active/inactive；插件与 MCP 搜索器分行排列。员工、插件和 MCP 改为响应式卡片，不改变既有信息或分页语义。插件详情顶部概要，下方 Skill/Subagent/Hook 标签页切换列表。旧的单插件安装/读取来源协议废弃，CLI 同轮同步；开发阶段不转换旧安装版本、不改冻结历史或真实实例。

## 当前唯一写入协议

员工只引用共享 Runtime，并独立选择完整插件及 MCP：

```json
{"runtime":{"profileId":"<Runtime ID>","extensionSelection":{"pluginIds":[],"mcpIds":[]}}}
```

HTTP/CLI 拒绝 `skillIds`、员工 `mcpJson`、连接字段、手工路径及派生 manifest。省略 runtime 或更新字段时保留现有绑定；显式 extensionSelection 必须包含两个数组并完整替换。新员工默认使用固定 Claude Code 项，停用时须先在设置启用；不能自行新建连接。

安装、列表、员工选择均以插件版本为单位；Skill/Subagent/Hook 只在插件详情中查看，不可单选。插件自带 MCP 会拆为独立市场项，选插件不会隐式启用服务。

## 安装与详情

- 插件首页只列已安装项。HTTPS Git 仓库或本机绝对目录直接一次安装全部条目。识别 `.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json`、`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json` 和根 `plugin.json`。市场支持相对目录、Codex `local/path`、`url` 的同仓库 `./` 来源，以及 HTTPS `github`、`url`、`git-subdir` 远程来源。远程来源按 URL+ref/sha 复用检出，sha 优先；记录真实仓库与提交 ID。不提供读取来源/单插件选择/信任勾选。npm/archive/command 来源尚不支持，明确整批拒绝，不跳过条目或执行清单命令。
- 安装复制完整插件及支持文件到 Runtime 根下 `installed-plugins/<批次ID>/plugins/<版本ID>/plugin/`，拆分 MCP 在同批次 `mcps/<版本ID>/`，独立手动 MCP 在 `marketplace/<版本ID>/`。默认根位于 `~/.agentforge/<实例>/runtime-configs/`。准备完整批次后一次 rename 发布，失败清理临时批次，不暴露部分已安装项。版本不可变，保存 manifest 及完整目录摘要；受管副本篡改会拒绝执行。
- 配置根的祖先目录允许 macOS `/tmp` → `/private/tmp`、卷挂载等正常别名，先解析实际位置再创建与记录路径；配置根本身及受管子目录仍拒绝符号链接，运行中实际位置改变则报错。目录错误在诊断中保留具体路径和错误码，不自动删除或重建真实数据。
- 导入不运行安装脚本、Hook、依赖安装或 MCP；首次安装不自动绑定员工，重复导入按本页覆盖规则更新已有选择。拆分时解析默认或声明的 MCP JSON，把插件根变量替换成已安装目录；清空加载副本的默认 MCP 文件并移除 manifest 的 MCP 声明，避免 Provider 自动启用。选中员工实际执行 Hook，以本机用户权限运行；bypass 不是沙箱。
- 插件卡片、详情及员工选择器分别标记九种 Runtime 支持情况；详情给出不兼容原因，组件标记适用 Runtime。列表只给组件数量与兼容性；详情按需读取 Skill、Subagent、Hook 元信息及 manifest。支持表示静态组件可加载，不代表本机 CLI、依赖、模型账号已实测。在线市场浏览本轮不提供。
- 共享市场根目录且显式声明 Skill 子目录时，只加载该条目声明的 Skill；普通独立插件的自定义 Skill 路径仍补充默认目录。遵循 [Claude 插件清单规则](https://code.claude.com/docs/en/plugins-reference#marketplace-entries-and-the-manifest)，不会把同仓库其他插件的 Skill 自动混入所选插件。
- MCP 通过单服务 `mcpServers` JSON 安装为独立不可变版本，私有文件权限0600。详情接口隐藏 env/headers 等鉴权值；列表不携带 JSON。stdio、SSE、Streamable HTTP 均支持九种 Runtime；`streamableHttp`、`streamable-http` 归一为 Provider 的 `http` 类型。URL 未写 type 时按 HTTP 解析。stdio 的 `cwd`/`env_vars` 经九种 Runtime 共用的私有启动器保留；手动 cwd 必须绝对路径，插件相对 cwd 固定为不可变插件目录。子进程继承当前本机环境，env_vars 不是沙箱白名单。两套清单同名 MCP 若定义不同，拆成独立 Runtime 标记的版本，由员工选择一个，不互相覆盖。Codex 私有启动器复用现有 MCP SDK 桥接远程传输；鉴权不进入命令行，拒绝重定向，不自动配置 OAuth。
- 员工编辑通过可搜索下拉添加插件/MCP，已选项以可移除标签展示。加载失败、版本缺失或 Provider 不兼容时阻止保存，不静默丢弃选择。
- 市场别名（如 stable/dev）可分别安装，但同一员工不能同时选择原生名称相同的两个插件版本，避免 Runtime 命名空间互相覆盖。

接口（均需管理员认证）：插件 `GET /api/runtime/marketplace`、`POST ...`（url/path 二选一）、`GET .../:id`；安装返回 `{plugins:[摘要],mcps:[拆分摘要]}`。废弃 discover/sourceId/pluginName，不保留旧输入兼容。MCP `GET/POST /api/runtime/mcp-marketplace`、`GET .../:id`。CLI 同步使用 `plugins list/get/import`、`mcps list/get/create`、`agents create/update`；安装无额外信任参数，删除与真实 Runtime 测试仍须 `--yes`。

## Runtime 加载与隔离

安装允许来源仓库/本机市场目录内部的文件与目录符号链接（包括同仓库共享资源），将目标内容按链接原路径复制成普通文件/目录，保留字节与可执行标记；中文、空格等合法文件名保持不变。来源边界为本次传入的目录或各条目所属的 Git 仓库，不是任意上级目录。断链、循环链接、来源外目标及 socket/FIFO/设备等特殊文件明确报告插件名和相对路径，整批不发布，不静默漏装。展开后的文件仍计入原有大小/数量限制。安装副本和受管配置目录仍不允许符号链接，执行前摘要/完整性校验不放宽；不执行来源中的脚本或 Hook。既有安装无需迁移，失败的来源重新安装即可。

安装时分别解析 Claude 与 Codex 清单，不把优先发现的清单组件覆盖到另一个 Runtime。Codex 根 manifest 的 `extensions.com.openai` 或 `.codex-plugin` 配置用于 Codex 投影；显式 `hooks: {}` 关闭默认 Hook，不继承 Claude 的启动 Hook。组件并集只用于详情展示，实际 Skill/Subagent/Hook 按员工所选 Runtime 投影并随任务冻结。切换 Runtime 不自动删除原选择；不兼容时 UI 和服务端均拒绝保存，须移除或更换插件。

Claude 使用所选 --plugin-dir 原生加载 Skill/Subagent/Hook，空 setting-sources 排除宿主设置、关闭可关闭的 bundled skills，不禁用全部 Skill。Codex 所选 Skill 通过调用独占 App Server 原生注册额外根，发现后以线程级 skills.config 仅启用所选路径；不把路径和逐一读取指令放进系统提示词。无 Skill 保留 exec，同一会话身份可续接，原生加载失败不退回读文件指令。既有 agents/共同 command Hook 投影保留，不改全局配置；源专有而尚无等价映射的功能必须明确拒绝，不能以省略组件声称完整兼容。不支持原生接口的 CLI 明确报错，当前目标 Codex 0.164.0。

格式互通不等于所有生命周期/工具名等价；Skill、共同命令 Hook 和 Subagent 正文可适配，但 Provider 专有功能须分别验证。参考 [Codex 插件规范](https://developers.openai.com/plugins/build/plugins)、[官方跨格式说明](https://developers.openai.com/plugins/guides/submit-claude-plugin)、[Claude 规范](https://code.claude.com/docs/en/plugins-reference)。已审阅的 [claude-codex-converter](https://github.com/achammah/claude-codex-converter) 侧重全局迁移，不作为员工隔离加载器；本轮复用现有官方 MCP SDK，不新增依赖。

只加载员工明确选择的扩展引用。选择变更只影响后续 Task/沟通；既有 Task/Run 与已排队投递冻结事实不重写。冻结快照的读取适配不是重新开放废弃的写入协议。开发期不自动转换旧 Skill 选择或安装版本：旧配置需重新安装插件/MCP并明确选择；不擅自重置真实实例。

这是加载隔离，不是 OS 沙箱：同一系统用户的员工仍可能主动访问其他本机文件。插件来源、Hook 和 MCP 均须可信。

## 集中 Runtime

设置固定 Claude Code、Codex 和 DeepSeek Harness 各一项，员工引用 profileId；只编辑模型/思考等级及 enabled 开关。旧具名连接的新增、删除、命名、CLI 路径及 Codex profile 输入不再接受。完整当前协议见本文末尾。

测试按钮使用保存配置、新会话与空扩展调用真实 CLI/模型；成功须验证结构化应答。失败/超时写本机日志，页面只显示结果和日志路径。不创建业务任务，也不等于任务可交付。沿用各 CLI 自身登录，不新增模型 Token/Base URL 存储。

## Runtime 模型目录与思考等级（2026-10-25）

Runtime 配置新增可选 `effort`（思考等级，空 = CLI 默认），随 model 一同保存、回读、投影给绑定员工并进入真实调用；已有 Task/Run/排队沟通快照保持冻结。Store 按 Provider 校验 effort 档位集合（Claude Code：low/medium/high/xhigh/max；Codex：加 ultra，均来自真实 CLI 观察），明显非法值拒绝；模型仍是自由文本——2026-10-25 人类裁决允许手工输入，服务端不做列表成员硬校验，但 UI/CLI 如实标注"不在当前列表"。

模型列表只来自真实来源，经受认证 `GET /api/settings/runtime-profiles/models?provider=…` 提供（server/runtime/model-catalog.mjs）：Codex 用与真实 spawn 相同的 cliEnvironment 执行 `codex debug models`（0.160.0 起），投影 slug/名称/可见性/逐模型 supported_reasoning_levels；visibility 为 hide 的模型不列出，目录可见不等于账号可用（实测 gpt-5.5 在目录中但被 ChatGPT 账号拒绝，返回明确 model_not_found），实际可用性以连接测试/调用为准。Claude Code 无离线列表命令（官方文档确认），目录 = 文档内置别名（default/best/fable/sonnet/opus/haiku/sonnet[1m]/opus[1m]/opusplan）+ settings.json `model`/env 与进程环境（进程优先，与 claudeMarketEnvironment 同边界）中的 ANTHROPIC_MODEL 与 ANTHROPIC_DEFAULT_*_MODEL 别名钉住及 _SUPPORTED_CAPABILITIES 能力声明；只读模型/名称/说明/能力键，凭据键绝不读取或回显。查询失败、空列表如实返回错误/空集，不编造列表。市场扩展执行带 `--setting-sources ''`，settings.json 的 model 字段在该模式下不生效（ANTHROPIC_* 环境键仍按同一优先级生效），目录说明已如实标注。

生效链路：Claude 调用追加 `--model`/`--effort`（2.1.216 实测，非法档位 CLI 仅告警回退，故保存侧必须校验）；Codex 追加 `--model` 与 `-c model_reasoning_effort="<level>"`（0.160.0 实测该键被识别、非法值不被本地拒绝，故保存侧必须校验）。保存校验分两层：Store 按 Provider 档位集合拒绝明显非法值；HTTP 在模型存在于真实目录时按该模型声明的档位拒绝不适用值（Codex 逐模型、Claude 按能力声明），模型不在目录（手工输入）或目录查询失败时不臆造拒绝。连接测试使用保存的 model+effort。resume 会话照常携带两参数：Claude `--resume` 下 `--model`/`--effort` 覆盖原会话选择（官方文档机制，已实测参数接受）；Codex `exec resume` 下 `-c`/`--model` 覆盖同理。切换模型时 UI 清除不在新模型档位集合内的旧 effort 并明示；模型能力未知（无声明/不在目录）时不臆造拒绝，如实标注由 CLI 解析回退。

目录与执行环境一致性：市场扩展执行（`--setting-sources ''`）经 claudeMarketEnvironment 只回注明确列举的连接键，该白名单与目录读取键一致——ANTHROPIC_MODEL、四个 ANTHROPIC_DEFAULT_*_MODEL 别名钉住及对应 _SUPPORTED_CAPABILITIES 能力声明、地址与代理键；进程环境优先。目录声明的别名钉住/能力在实际 spawn 同样生效（回归测试锁定）。

Web 设置模型字段为可搜索筛选的建议列表 + 手工输入，思考等级为联动 select，加载中/空/失败三态与"手工输入不在列表"标注齐备；目录请求带序号，连续刷新或切换页面时过期响应不覆盖新列表。CLI `runtimes models PROVIDER` 返回同一目录，schema/help/输出同步 effort 字段与 models 操作。桌面共用该设置页，无新增 IPC/桥。目录和调用共用服务 PATH 发现的固定 CLI，不接受界面/CLI 指定路径或命名 Codex profile。


### GitHub / GitLab 私有仓库拉取 Token（2026-10-12）

「设置 → 仓库访问」（`/settings/repositories`）管理本机 `git-credentials.json`，它位于 `AGENTFORGE_RUNTIME_CONFIG_ROOT` 下、权限为 0600，格式固定为版本号和 GitHub/GitLab Token。`GET /api/runtime/git-credentials` 只返回两个公共 HTTPS 主机的 `{ id, label, host, configured }` 状态；`PUT`/`DELETE /api/runtime/git-credentials/github|gitlab` 仅在已登录管理员会话中写入或移除，读取后绝不回显 Token。托管根目录和文件均拒绝链接，文件拒绝异常结构与过大内容，并以临时文件重命名提交；它不是 Store 数据、员工配置字段或可导出的业务 metadata。主题和导航偏好使用单独的浏览器本地存储，绝不混入 Token；离开设置清除输入，页面刷新只恢复配置状态。

已有历史 Task 保留冻结的不含凭据 repository URL/ref；新 Task 不再生成仓库绑定或自动检出。`server/index.mjs` 只把 URL 解析能力交给 Run Files；Run Files 只在 URL 精确匹配 `https://github.com/...` 或 `https://gitlab.com/...` 时，在 clone/fetch 子进程中以临时 credential helper 传入 Token（GitHub 用户名 `x-access-token`，GitLab 用户名 `oauth2`），按主机拒绝重定向/其他主机请求并在检出后删除 helper。Token 不进入 URL、命令参数、workspace-ready 标记、Task/Run/Trace/Event/Artifact、日志或 Agent Prompt。clone 禁用 Git hooks、子模块与 LFS 自动下载；既有本机 Git URL 重写并不成为平台 Token 授权。

这仅解决公共 GitHub/GitLab HTTPS 的读取：SSH、自托管实例、GitHub App/OAuth、Token 轮换和写权限不在范围；已有本机 Git/SSH 认证仍可照常工作。拉取 Token 不等于 `deliveryAuthorization`，不授权 push、合并或部署；这些外部操作仍需 Task 明确的人类授权。由于 Runtime 是用户授权的本机 bypass，0600 私有文件和临时 helper 不是沙箱，也不能防御同一 OS 用户的直接读取。

## 固定 Runtime 配置（当前协议）

Runtime 目录固定为Claude Code、Codex、DeepSeek Harness、Cursor、Gemini CLI、Qwen Code、Kimi Code、Pi、OpenCode，每种 Provider 只有一项；名称由 Provider 决定，不允许创建、删除或自定义名称/CLI 路径/Codex profile。`GET /api/settings/runtime-profiles` 返回 id、provider、enabled、model、effort、employeeCount；`PUT .../:id` 接受非空部分对象 `{enabled?:boolean, model?:string, effort?:string}`。旧创建/删除、名称及连接字段写入明确拒绝；员工仍用 profileId 引用，既有 Runtime ID 不变。模型目录不接受自定义 executable，沿服务发现的本机 CLI。当前员工随保存更新模型与档位，已有 Task/Run/排队投递的模型及档位快照不改。

设置以三行固定 Runtime 展示可用开关，配置默认折叠，页内展开仅编辑模型名与思考等级；折叠保留表单 DOM 与草稿。停用是当前实例的调用开关：不终止已启动的 Provider；阻止新的任务启动、沟通发送和后续 Provider 调用，包括旧任务后续调用。现有员工绑定及历史不移除，停用项在员工选择器标注，不可新绑定。重新启用不会伪装失败调用已成功，失败任务/投递按原恢复入口继续。

新工作区预置九项，实际可用由本机安装与用户开关共同决定。开发阶段不维护具名多连接协议或迁移：多个同 Provider 配置的旧开发数据须由操作者先合并配置，服务明确报错，不擅自选择或重置真实实例。

DeepSeek Harness 使用唯一 dsh 槽位，不允许创建/删除具名连接。模型目录来自本机原生 SDK；model 为 Provider/模型ID，裸 ID 使用 deepseek-official，空值选择当前真实目录首项。当前接入内置 DeepSeek API Key/账号路由，不自动导入全局 pi-ai 配置。effort 为 off/low/high/max，逐模型约束由原生目录提供；账号访问和真实调用仍以 DeepSeek Harness 验证为准。每个会话使用独立 DSH_HOME，native credentials-local 指向原 DSH_HOME/.credentials.yaml；应用不解析/复制密钥、不修改全局配置。Skill 用原生 filesystem provider 仅扫描所选目录；MCP 复用完整性启动器（含 cwd/env_vars）和平台历史服务。Subagent/command Hook 按 docs/26 映射为原生组件；未映射字段明确拒绝。旧安装当前兼容性只读重算，不补写旧快照，无需重新导入。

Runtime 展示名称为Claude Code、Codex、DeepSeek Harness、Cursor、Gemini CLI、Qwen Code、Kimi Code、Pi、OpenCode；固定 Provider ID、执行文件与能力边界见 [多 Runtime 接入](29-runtime-providers.md)。服务通过与执行相同的 CLI 环境检查可执行文件（不运行模型、不读取凭据）；Store 注入该只读事实，在 list/get 返回 installed 和实际 enabled。未安装或客户端 PATH 找不到可执行文件时 enabled=false、界面开关关闭并锁定，HTTP/CLI 拒绝修改 enabled 和发起新调用；安装检查不改写用户开关偏好、员工或 Task 冻结事实。安装/PATH 修复后重开客户端或重新进入 Runtime 设置重新读取；已安装但未登录不属于未安装。

源标准兼容层见 [docs/26](26-runtime-plugin-compatibility.md)：安装保留源副本；当前安装可只读重算 Runtime 支持与组件标签，不必逐个重装。DeepSeek Harness 0.2.1-rc.2 使用原生独立子代理 Session 和版本匹配的官方 Claude/Codex command Hook 桥，保留源系统正文、继承模型与工具选择；父调用等待子代理真实结果/清理。无法等价映射的事件、字段、模型或动态 Hook 输出明确失败，不把跳过组件当支持。MCP 的 cwd/env_vars/传输在九种 Runtime 共用私有启动器。

插件来源描述中的单行字面冒号可在原生调用副本中规范化；其他不合法 YAML 明确指出相对文件与行列，不输出原文。v3 已知 Claude 模型别名在非 Claude Runtime 使用所选 Runtime 的模型，源名称保留在计划中；旧 v2 冻结不转换。DeepSeek 可使用插件自带的完整 Codex 清单。详见 docs/26。

员工保留的存储字段 kind 只接受 business/manager，界面不再展示“员工类型”，字段不决定任何任务的经理身份；普通任务和自动化显式选择所选员工中的 managerAgentId。废弃的 developer、repository 值及仓库输入明确拒绝。原仓库地址和基线可由操作者写入 systemPrompt。新任务从统一工作根执行，不自动准备仓库；旧 Task/Run 仓库事实保留。当前旧员工仅在操作者显式编辑时去除旧绑定，不做启动迁移或重置。


## 数据库目录与查询

插件与 MCP 摘要在导入/创建时写入同一业务 SQLite 的 extension_catalog 表，记录名称、说明、来源/版本、Runtime 兼容性、组件数量和软删除时间。完整组件和私密 MCP JSON 保持不可变文件存储；不把正文或凭据复制到目录表。插件/MCP GET 列表只查询数据库，不遍历安装目录或重算兼容性；GET 详情按单条读取文件，绑定与执行仍校验内容完整性。

列表接受 `page`（正整数，默认1）与 `search`（名称/说明包含匹配，最多200字符），固定每页20项；返回原资源键 plugins/entries，加 total/page/pageSize/totalPages/hasMore。先过滤软删除和搜索再分页，按 createdAt 降序、ID 稳定排序；超尾页收敛到最后一页。拒绝未知或重复参数。App 翻页和防抖搜索、CLI --page/--search/--all 使用同一查询，员工选择器按页收集摘要，不读取组件正文。

导入候选文件准备完后，目录登记、重复来源替换、员工重绑定、旧版本软删除在同一事务提交；失败候选不进入当前目录。MCP 编辑和自动插件更新同步这一事务边界。自动更新只查询数据库中未删除的安装项；删除与在途更新竞争由原版本/员工快照检查拒绝，不会自动复活。兼容性展示取安装时结果，真正绑定/执行按当前解析规则检查。

本次配置协议以数据库目录为唯一当前安装目录，不自动扫描旧版本安装记录或迁移旧格式。旧版只有磁盘记录的安装需显式重新导入，并重新选择员工绑定；原文件与冻结执行记录保留，不自动清除或重置真实实例。

角色支持 extensionSelection（pluginIds/mcpIds）并自动合并到员工执行快照；员工直接选择独立保存，解绑角色不清除直接选择。新增任务和后续沟通使用当前角色扩展，冻结历史保持原引用。删除扩展同步解除角色和员工关联，更新/编辑/重复导入同步替换两类关联。插件源码及 MCP 私有配置继续保存文件；SQLite 只维护索引与关联。

扩展详情通过安装批次目录指纹维护版本 ID→路径索引；绑定/执行准备在单次操作内共享解析与完整性检查，后续操作按文件指纹重新判断。元数据或内容发生变化仍拒绝使用冻结版本，不跳过篡改检测。Runtime 模型目录使用 30 秒短缓存与在途请求合并，账号配置、环境和可执行文件变更使缓存失效，App/CLI 显式刷新可绕过已完成缓存。完整资源边界见 [docs/28](28-performance-architecture.md)。

MCP工具发现：POST /api/runtime/mcp-marketplace/:id/tools，空对象或{refresh?:boolean}；只允许当前已安装项，读取不可变配置，使用与真实调用相同的mcp-launcher进行initialize/tools/list，支持stdio/SSE/HTTP，不调用业务工具。返回{tools:[{name,title?,description,inputSchema,outputSchema?,annotations?}],total,checkedAt}，名称/参数结构保留，真实凭据值脱敏。15秒总超时，成功缓存60秒且同配置请求合并，刷新绕过缓存，失败不缓存；进程与连接总会关闭，最多4个并发发现，每项最多2000工具/2MiB并限制分页。列表页仍只查询数据库元数据，不连接全部MCP。详情在静态展示的连接配置下独立加载并完整显示工具名称和说明，保留刷新；不显示搜索、分页和参数定义，失败不伪装成空列表。HTTP/CLI保留完整参数结构与既有查询能力，CLI mcps tools ID --all [--refresh]读取全部工具。

mcps tools支持--search名称/说明筛选后分页，默认每页20条，--page N与--all互斥；--all返回全部匹配工具。输出tools、匹配total、服务availableTotal、page/pageSize/totalPages/hasMore及checkedAt；与App详情搜索和20条分页相同，查询只读取一次工具定义。

桌面 MCP 工具发现沿用宿主提供的 Node 可执行文件。若本地服务的 Python/Node 环境位于 NAS 等受系统保护位置，应用重新签名后既有 macOS 文件访问授权可能失效；应根据系统 TCC 日志恢复操作者原有授权。工具查询不绕过系统权限，不自动更改服务配置；超时不是工具列表为空的依据。

新增原生 CLI Runtime 的事件、会话、模型目录和扩展边界见 [docs/29](29-runtime-providers.md)。本轮不将 Claude/Codex 插件方言直接标记为新 Runtime 兼容；未支持的扩展拒绝绑定，不能静默忽略。

新增六种 Runtime 的基础 Skill/可适配 Command 插件、原生 MCP、私有配置及不兼容组件边界见 [多 Runtime 接入](../docs/29-runtime-providers.md)。App 市场详情“检查兼容性”与 CLI `plugins check-compatibility ID` / `mcps check-compatibility ID` 等价；仅刷新当前目录摘要，不改写安装、员工/角色绑定或历史。

新增六种模型与思考目录及参数映射见 docs/29。App/CLI 共用 label/levels 与保存校验；OpenCode 档位接受所选模型实际提供的 variant 名称（1–64 字符，仅字母数字点横线下划线）。Cursor/Gemini/OpenCode 指定档位须同时有模型。未知模型可手工输入，真实调用失败如实报告。
