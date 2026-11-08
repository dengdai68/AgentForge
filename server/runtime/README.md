# 本机 Runtime

local-cli 按原生最终完成与进程退出结算恢复：早期错误在后续明确成功且 exit=0 时不再作为最终失败；非零退出、无成功完成、或后续新失败继续失败。Codex 的错误展示只标记实际错误事件，不污染其后的正文/思考/完成事件；原历史错误不删除。

失败原文、退出码和可用 stderr 经脱敏保留，不替换为泛化提示；重试资格另行判定，只有明确临时服务/连接错误可退避，次数由 Orchestrator/Store 控制。插件完整性错误提供路径和哈希差异且不可自动重试。Provider 继承 PYTHONDONTWRITEBYTECODE=1，避免普通 Python 导入向安装树写缓存；不忽略已有缓存、不自动清理真实安装目录，也不承诺沙箱隔离。

remotePluginRevision 用 ls-remote 查询真实提交并保留 ref/sha；importPlugins 可传 signal 和内部 transient 选项，自动更新源码用后清理，不保留重复检出。插件 source 记录安装 origin 及依赖 ref/sha/revision；marketplace 内部 pluginNames/includeMcps 限定自动更新只准备当前已装名称且不新装 MCP。公开安装输入仍仅 url/path，未扩权。

MCP mcpEditInput 复用 parseMcpJson 与既有安装校验；脱敏值只在相同 JSON 路径且未更改时恢复原私有值。编辑产出新不可变安装版本，不覆盖旧 mcp.json，兼容性与服务名冲突继续走 resolve。目录绑定事务由 Store 负责。

所选 Skill 原生加载：Claude 保留 --plugin-dir，移除禁用全部技能的参数，空 setting-sources 排除宿主设置并关闭可关闭的 bundled skills；Provider 必备内置能力不等于员工安装插件。Codex 有所选 Skill 时使用调用独占的 codex-app-server.mjs，以 extraRoots/set 注册精确目录、原生发现、每线程 skills.config 仅启用所选路径；无 Skill 的调用保留 exec，二者使用同一原生 thread 存储并精确续接。原生加载失败不回退为提示词读文件。应用系统指令不再追加 Skill 路径或历史工具目录；MCP 名称/参数/分页由真实服务定义提供。

打包版历史服务以 Electron Node 模式启动：Codex 适配器传递 Bridge 的完整 MCP env，required=true 让初始化失败真实报错；ELECTRON_RUN_AS_NODE 只给历史 MCP 子进程，cliEnvironment 仍从 Provider 环境移除。平台历史与员工选择的市场 MCP 独立，不新增配置字段。

promptSnapshot 完整保存脱敏系统指令/本轮输入，控制台如实展示二者和已确认原生会话 ID。Codex 工具阶段按原生调用 ID 关联，完成事件不重复保存相同参数，晚到或改变的参数与 search/open action 仍保留。Codex 每次调用关闭账号 Apps；市场调用继续禁用全局 MCP、插件和自动技能发现，仅加载所选扩展与平台历史服务。基础 Shell/文件/原生搜索工具仍由 Runtime 提供，不把扩展隔离称为沙箱。

应用 systemPrompt 与当前 prompt 分离。Claude 使用 Trace 私有追加指令文件并关闭旧系统快照，Codex 使用 developer_instructions/原生 developerInstructions；均续接原生会话。定位参数只含当前输入，不额外注入技能文件清单。要求 CLI 支持这些参数，详见 docs/22。

来源内文件/目录链接仅在安装复制时展开（含同仓库共享资源），安装副本全为真实文件/目录；断链、循环、来源外链接和特殊文件按插件/相对路径明确失败，整批回滚。普通文件名的中文、空格保持不变，展开后仍计入大小/数量限制；执行期完整性校验仍拒绝受管副本中的链接。

- `local-cli.mjs`：Claude Code/Codex/DeepSeek Harness 调用、事件投影、会话恢复和取消。
- `model-catalog.mjs`：真实模型目录及思考等级能力。
- `configuration.mjs`：可信 Git/本地插件来源、私有仓库读取凭据。
- 市场清单支持 Claude/Codex 相对目录及 HTTPS github/url/git-subdir 条目，整批检出并记录 ref/sha；不支持的 npm/archive/command 整批报错。按 Runtime 分别解析清单，兼容性和原因传给目录/员工入口；支持是静态组件兼容，不等于账号或依赖已验证。
- 市场配置根先解析祖先目录别名（如 macOS /tmp），受管根/子目录本身仍拒绝链接；执行引用使用真实路径并保持完整性校验。
- `marketplace.mjs`、`extensions.mjs`：Claude/Codex/Agent Plugins 来源整批原子安装；自带 MCP 独立入市场，员工另选；完整性加载与原生 Subagent/共同 Hook 投影，Skill 不单选。
- `plugin-hooks.mjs`：从私有完整性校验插件读取选中 Hook 命令，不将命令正文放入 Provider 参数；不写全局配置。
- `mcp-launcher.mjs`：私有 stdio 子进程及现有 SDK SSE/Streamable HTTP 桥接，拒绝重定向；远程鉴权不进参数。
- Codex stdio 的 cwd/env_vars 保留，cwd 在私有启动器中生效；这些版本不标记 Claude 兼容。插件两份清单的 MCP 若不同则独立拆分，不覆盖彼此。
- `cli-environment.mjs`、`launch-diagnostics.mjs`：启动环境和本机诊断。
- `probe.mjs`：隔离目录中的真实连接测试。

Runtime 适配 Provider，不评价业务结果，不写 Store 状态。员工以本机用户权限运行；工作目录是启动位置。Provider 原生会话先绑定 Store，再从持久审计事件中剥离调用级字段；执行正文和提示词使用受限快照引用。

模型目录：Codex 使用本机 `codex debug models`，Claude 使用本地模型配置与内置别名；不读取凭据键，不伪造目录。模型与 effort 透传现有 CLI。

配置、扩展及安全边界见 [员工配置](../../docs/15-employee-runtime-configuration.md) 和 [Runtime](../../docs/08-real-local-agent-runtime.md)。

控制台展示已保存的公开 thinking 正文；敏感片段仍过滤，首尾空白与换行规范化不标为脱敏。历史正文为空时明确说明“未保存可显示的思考正文”，不以“已脱敏”占位，不补造未公开或未保存内容。

Runtime 可编辑项仅 model/effort，CLI 可执行文件按服务 PATH 发现；可用开关由 Store 和调用方校验，适配器不拥有开关状态。历史冻结 model/effort 继续传给 Provider。测试私有 CLI 用隔离 Shell PATH，不再创建具名连接或写自定义 executable。

Claude stream-json 的 result 表示一轮结束，不表示整个进程结束。适配器跟踪原生 background_tasks_changed/task_started/task_notification：已知后台工作运行期间以及成功轮次等待原生后续工作时，不启动平台的无进展计时器；新正文/原生任务通知重新进入执行阶段，无后台工作时恢复计时。由 Claude 自身负责 print 后台等待上限，平台不增加另一套业务时限，也不在第一条成功 result 时提前结算。最终仍须进程正常退出且无结构化失败；取消、会话错误、API 重试上限与退出码校验不变。

DeepSeek Harness 入口 dsh.mjs、私有原生 bridge dsh-plugin.mjs：独立 SDK JSON-RPC、模型目录、会话原生恢复、系统指令和所选 Skill/MCP；保留 session/wait 后续工作边界，取消进程组并等待退出。外部 DeepSeek Harness 不访问 ASAR；bridge 在 Trace 私有目录物化，仅用 Node 内置模块和原生 context。当前内置 DeepSeek 路由、off/low/high/max，不加载全局插件和默认 Skill，不解析 DeepSeek Harness 凭据。详见 docs/25。

Runtime 展示名称为 Claude Code、Codex、DeepSeek Harness，内部 Provider/CLI 命令仍为 claude-code/codex/dsh。服务通过与执行相同的 CLI 环境检查可执行文件（不运行模型、不读取凭据）；Store 注入该只读事实，在 list/get 返回 installed 和实际 enabled。未安装或客户端 PATH 找不到可执行文件时 enabled=false、界面开关关闭并锁定，HTTP/CLI 拒绝修改 enabled 和发起新调用；安装检查不改写用户开关偏好、员工或 Task 冻结事实。安装/PATH 修复后重开客户端或重新进入 Runtime 设置重新读取；已安装但未登录不属于未安装。

`plugin-compatibility.mjs` 安全解析源 frontmatter 并生成无提示词的冻结计划；marketplace 从当前安装只读派生支持矩阵。`dsh-extensions.mjs` 在 Harness 中创建原生独立子代理与选中 Hook，版本固定的 MIT 原代码/许可在 `vendor/dsh-hooks/`。私有目录生成 peer import URL 与源工具名映射，不改全局配置。设计/边界见 docs/26。MCP 启动器在三种 Runtime 共用；新调用保留源名称，旧冻结引用保留旧投影。

`plugin-agent-tools.mjs` 为 Codex 源子代理生成原生工具选择 Hook；按 child session 记录选择，不限制父员工/其他子代理，不改操作系统或领域权限。

跨 Runtime 真实兼容门禁：scripts/test-plugin-runtimes-real.mjs，按源格式和 Provider 分列 Skill、独立子代理、Hook 与 stdio/HTTP/SSE MCP 实际调用；不把支持矩阵当实际执行证据。

插件执行计划 v3 对已知 Claude 模型别名在非 Claude Runtime 继承目标模型并保留 sourceModel；DeepSeek 选择现有 Codex 清单时使用完整方言而不混合 Hook。单行 description 冒号仅在原生调用副本中编码，原文/正文/支持文件保留；解析错误只暴露组件相对路径和行列，格式错误不使其他已安装插件目录不可用。旧 v2 引用仍验原摘要。实际源验证为 test-ai-minions-real，机制验证仍为 test-plugin-runtimes-real。

导入逐组件隔离定义错误：Skill/Command/Subagent Markdown 与 Hook JSON/事件/匹配组/处理器仅跳过失败单元。原始 source 不变，原生执行副本只含有效 Markdown 与规范化清单/Hook；warnings 由市场/HTTP/CLI/界面共享。越界/链接/完整性/清单错误仍阻断，执行期保持严格。详见 docs/26。

Codex 在 Provider 确认 thread.started 之前出现明确鉴权/未登录错误时，JSONL 与 app-server 调用立即失败并释放进程；此时控制台没有原生会话 ID 是真实事实，不使用应用占位 ID 续接。JSONL 的连续错误事件计入有上限的重试等待，不会无限重置空闲计时。已确认会话的 Provider 原生恢复仍按最终成功/失败结算。登录修复后，手动重试启动新的 CLI 进程读取当前账号状态，无需删除员工；已有已确认会话继续原 ID。

任务执行内置 PostToolUse Hook 经调用级私有 socket 触发 Run Files 登记动态克隆仓库；基准只取明确 clone reflog 起点，私有持久记录不随提交/重试更新。CHANGE 与 diff 动态发现并按最深仓库归属比较；缺少起点明确提示仅未提交差异，读取/轮次结束补查，无额外协作消息或自动 Git 写操作。

local-cli 将 Claude api_retry、Codex error/stderr 的明确诊断字段保存为脱敏 execution content；不记录整帧或请求 body，重试后的成功仍按原完成协议结算。

任务 Runtime 使用 `executionKey = Run ID:员工 ID`，`registerExecution` 第三个参数为 Run 分组；同键不允许重叠，不同成员可并发，`terminateExecution(runId)` 停止该组所有调用。Claude CLI、Codex exec/app-server、DSH 共用注册逻辑；沟通/探测不传分组时保持原键语义。注册释放按 entry 身份核对，避免旧回调删除新调用。

marketplace 负责安装文件准备、单项详情和实际绑定/执行校验；HTTP 列表不再调用磁盘 catalog() 全量解析，导入摘要交给 Store 登记配置 JSON。低层 catalog() 仅保留文件诊断和 Runtime 测试用途，不作产品目录源。当前兼容性展示为导入快照；目录协议见 docs/15。

Marketplace.resolveRole 解析角色选择到兼容Provider引用；resolveRoleReplacements 在插件更新、重复导入及MCP编辑时准备角色的新引用。源码/MCP内容保持不可变文件，角色与员工关联留在 Store/SQLite。

性能：市场 ID→安装目录索引按批次目录指纹失效，单操作共享解析/校验结果；跨操作摘要缓存仍校验文件元数据和链接，不跳过变化内容哈希。模型目录 30 秒缓存/in-flight 去重，Provider、二进制、环境摘要、账号/配置变动失效，支持显式 refresh。任务/沟通资源池属于编排层，Runtime 仍只适配 Provider，不拥有任务业务状态。

mcp-tools.mjs复用mcp-launcher读取真实工具定义（initialize/tools/list），支持stdio/SSE/HTTP；成功60秒缓存、同配置并发合并、最多4连接、64项/16MiB缓存和每清单2000项/2MiB，15秒总超时，失败不缓存、finally关闭。只脱敏真实值、保留schema中password等参数定义；市场列表不执行发现，详情和CLI按需读取。

工具发现适配器仅首次显式读取工具时动态加载；普通Runtime启动器、元数据列表和安装配置读取不导入工具发现客户端，不额外启动服务。

桌面安装版的工具发现使用宿主提供的 `AGENTFORGE_ELECTRON_NODE` 启动 Node 子进程，与历史桥保持一致；不使用后台 Electron Helper 作为启动器。源码运行回退到当前 Node 可执行文件。

新增 portable-cli.mjs 适配 Cursor、Gemini、Qwen、Kimi、Pi、OpenCode 的原生非交互输出、精确会话续接和控制台内容；local-cli.runRuntime 统一分派并复用进程注册/取消/脱敏。市场插件/MCP 由 portable-extensions 投影，拒绝未映射的源行为及不能隔离的全局扩展配置；详见 docs/29。

Gemini 非交互调用显式信任任务工作目录并指定 extensions none，保持现有账号配置与全局文件不变。系统设置路径在原生 CLI 中要求 root 所有权，适配器不写入该路径，也不以未经验证的设置覆盖宣称扩展已隔离。Cursor thinking delta 按原生事件保存公开思考。

Gemini 使用稳定的成员私有 GEMINI_CLI_HOME 只投影连接配置，原生钥匙串/旧 OAuth 路径仍由 CLI 自行读取。Qwen 使用 safe-mode 禁用扩展而保留认证；不使用会跳过账号设置的 bare 模式。

Cursor 在成员稳定的私有 HOME 中保存原生会话，仅引用已有钥匙串/文件认证并投影 model/permissions，关闭全局扩展隐式加载。原用户目录通过调用指令及 AGENTFORGE_HOST_HOME 提供；不限制本机文件操作。

portable-extensions.mjs 复用 selectedExtensions/readPluginExecutionPlan 校验与 MCP 私有启动器，为六个新增 Runtime 生成命名空间 Skill 及原生 MCP 配置。Skill 相对资源保留，子代理映射各 Runtime 原生接口；pi-agents.mjs 只由原生 Pi 扩展加载器执行，独立进程/会话传递冻结正文、源工具选择、模型及取消，不拥有领域状态。Cursor 拒绝源工具约束，Pi 要求显式基础工具清单。Hook/未映射工具/专用字段整插件明确拒绝。不得用拼接 Skill 全文或 Shell 客户端替代原生加载。

model-catalog 投影新增六种原生模型目录与思考档位，忽略提供方鉴权等非模型字段；错误不保留未脱敏 stdout/stderr。原生参数映射由 portable-cli/portable-extensions 完成，不写全局账号设置；OpenCode 模型元数据来自 api --standalone model.list。

业务配置根与认证分离：插件/MCP、DSH 受管会话等位于配置数据根，Git 托管凭据位于宿主传入的 credentials/。local-cli 日志入口对 Runtime 副本解析受管旧地址，marketplace 读取目录/冻结清单也使用相同解析；完整性与计划摘要照常验证，不更改旧快照或全局 CLI 配置。docs/30 说明物理整理边界。

当前存储归属以 [配置目录与工作目录](../../docs/30-storage-layout.md) 为准：配置、认证、Runtime、插件/MCP 清单及源文件保存在 `~/.agentforge`；员工、角色、团队、工作流、自动化、任务与沟通及执行内容保存在工作目录，默认 `~/.agentforge/workspace`。清除所有数据删除整个当前工作目录，保留配置和登录。插件/MCP 列表与 Runtime 设置使用私有 JSON，SQLite 只存业务关联及配置提交 revision。
