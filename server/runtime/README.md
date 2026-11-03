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
