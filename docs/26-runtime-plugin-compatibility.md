# ADR：以源插件标准为基准的 Runtime 兼容层

## 决策

Claude Code/Codex 是导入方言；其他 Runtime 负责适配源插件，用户只导入一次，不手工选择被省略的组件，导入时定义格式错误的组件按下文独立跳过。保留原始安装源，按 Runtime 生成执行计划；已有安装内容可只读重新分析，不更改历史冻结引用、原生会话或操作者配置。不通过伪造 providers 声明或将独立子代理改成 Skill 来实现兼容。

marketplace 拥有来源和完整性检查；plugin-compatibility 解析源组件、声明与目标计划；Runtime 在自己的调用目录物化原生配置。Store 只保存领域引用及冻结计划，不读取 Provider 配置或判断业务交付。CLI/HTTP/renderer 共用同一兼容结果，静态兼容不等于安装、授权或实际执行成功。

## 依赖与复用

- 直接声明现有锁文件中的 js-yaml 4.3.2，以安全 JSON schema 解析 Markdown frontmatter；不执行标签、脚本或表达式。原始正文不经过模型改写。
- 复用 MIT 许可的 DeepSeek Harness 0.2.1-rc.2 官方 hooks-claude-code、hooks-codex、hook-protocol 的发布 JS。随应用保存原代码和许可，执行时在 Trace 私有目录物化，解析到当前实际 dsh 入口的原生 peer packages；不安装全局插件、不读取全局 Hook 配置、不从网络运行代码。
- 官方桥接仅支持声明的事件/command 类型；在计划阶段明确拒绝不能等价执行的组件和字段，不能依赖上游“警告后跳过”的默认行为。版本不匹配明确失败，不强行加载旧桥。
- 子代理使用 Harness 原生 spawn 服务、独立 Session 和独立作用域系统段，等待真实结果和清理，转交取消信号；不以同一模型对话中的文字角色扮演代替。
- 多目标解析/计划结构参考 EveryInc/compound-engineering-plugin 的 Converter/Writer 模式；不直接运行其全局安装器。dsh-movein 的子代理转 Skill 策略不采用。

## 兼容与冻结

新增 Runtime 应通过源插件兼容验收后开放相应能力。已有当前协议安装的兼容列表是派生读模型，不以历史 providers 数组判定新适配器能力。新绑定冻结源文件摘要和计划；执行前核对源目录及计划，既有 Task/Run 使用自己的旧快照，不自动换插件或计划。新导入另外保留原始源副本，原生加载所需的 MCP 隔离及 Command 投影继续与源副本分离。

Codex 子代理通过原生 SubagentStart/PreToolUse Hook 将工具选择绑定到精确 child session，父员工及其他子代理不受影响。Codex 的读取/搜索需 shell 映射；源未启用 Bash 时明确拒绝这类当前无法等价实现的工具组合。动态 Command 参数/预处理和跨 Provider 的指定模型不静默忽略。原生 `-c` 配置键不能带引号（否则成为名称本身）；源名称保留在描述，原生名称使用隔离且有效的小写唯一别名。原生 Hook 的子代理调用保留 root session_id，须优先用 agent_id 绑定子代理，不能误用根会话身份。

MCP 使用统一解析与完整性启动器映射 command/args/env/cwd/传输，不按导入来源限制 Runtime。插件内的 MCP 仍独立选择，防止选择插件就自动启用未选择的服务。前端不提供手工降级组件的转换选项。

## 验证

覆盖 Claude/Codex 两类源、纯 Skill/MCP、独立子代理、Hook 实际执行/拒绝、未知组件失败、源完整性、历史冻结及 UI/CLI 一致性。真实模型完整任务验证到可见人类确认；使用隔离 HOME 和数据，不改造真实实例。控制台普通 Markdown 仅由时间线纵向滚动，列表保留编号空间；代码与宽表格保留横向滚动。

跨 Runtime 门禁由 `scripts/test-plugin-runtimes-real.mjs` 给出两种源 × 三种 Provider 的逐项证据，包含 Skill/子代理/Hook 与三种 MCP 传输真实调用。卡片不展示支持标签；详情与选择器仍保留静态能力、失败原因。兼容机制验证与业务插件完整流程验收分别记录，不能互相替代。

## ai-minions 源标准补充（执行计划 v3）

源 Markdown 的顶层单行 description 若只因未转义的冒号+空格导致 YAML 映射错误，按完整单行字面描述重新编码；不修复其他结构错误、标签或脚本。解析错误仅带相对组件路径和行列，不将 YAML 缓冲区、原始提示正文或片段带入诊断。原始 source 与已安装冻结目录不改写；必要时只在调用私有投影中规范化 frontmatter，正文与支持文件保持原字节。某个已安装插件的格式错误以该插件不兼容说明呈现，不使整个目录读取失败；执行仍明确拒绝不能解析的内容，导入则按组件隔离规则处理。

v3 将源 opus/sonnet/haiku 等 Claude 别名在其他 Runtime 中明确映射为继承目标 Runtime 的已配置模型，保留 sourceModel 元信息，不声称使用同一个模型。非已知别名仍明确拒绝未知固定模型。DeepSeek 的 Skill、AskUserQuestion 依原生 skill、ask_user_question 工具映射；Codex 的原生委派/等待、读取技能和提问按源工具能力映射。插件包含 Codex 清单时，DeepSeek 使用该完整源方言配置，不混拼两份 Hook。已有 v2 引用仍按 v2 计划重算与验摘要，不转换历史事实。

## 组件定义错误隔离

导入的 Skill/Command/Subagent Markdown YAML、字段类型、名称、tools 定义无效时，仅跳过该文件；Hook JSON 无效时跳过该声明，事件/匹配组/处理器格式无效时跳过相应最小单元，有效兄弟组件继续安装。未闭合 frontmatter 也属错误。空事件定义合法；不把不支持的专有语义伪装为格式错误来降级，Runtime 等价映射失败仍按兼容性规则拒绝。

原始 source 副本完整保存；可执行 plugin 树排除错误 Markdown，以各来源方言生成只引用有效组件的原生清单及 Hook 文件，防止 Provider 默认扫描再次加载坏组件。完成后计算目录/文件/计划摘要，执行阶段不再宽松解析或忽略完整性问题。没有任何可用组件且存在错误的插件不安装，但同批其他插件继续；全无可用组件时返回空安装清单和 warnings。

HTTP/CLI 安装响应 `warnings` 为 `{plugin, component, path, message}[]`，相对路径可含声明内索引；不含源正文、Hook 命令或 YAML 原始缓冲区。客户端安装后弹出 ⚠️ 组件未安装清单，关闭后可在插件详情查看；CLI 文本明确警告，JSON 原样提供结构化 warnings。自动更新状态和详情同样保留警告。路径越界、链接逃逸、不可读取、非法插件清单、MCP 配置或完整性错误仍使批次失败，不发布半个安装目录。

## 六种新增 Runtime

Cursor、Gemini、Qwen、Kimi、Pi、OpenCode 使用 portable-extensions 的原生 Skill 和 MCP 投影，详见 docs/29。基础 Skill、无预处理的 Command 和已验证的独立子代理可映射。Gemini/Qwen/Kimi/OpenCode 使用原生 Agent，Pi 使用原生扩展启动独立进程并等待；Cursor 仅接受未声明工具约束的子代理，含 tools/disallowedTools 明确拒绝；Pi 要求显式基础工具清单。指定模型仅支持 inherit 或已映射的源别名；未映射工具拒绝。Hook 及 context/agent/model/hooks/disable-model-invocation/user-invocable 等专用 Skill 行为目前整插件明确拒绝，不对外声明完整 Claude/Codex 插件方言兼容。源组件没有被偷偷删除或改为提示词拼接。新增计划只影响这些新目标；已有三种目标的冻结计划摘要不改变。

原三种完整方言桥仍由 test-plugin-runtimes-real 验证；六种新增目标由 test-portable-extensions-real 验证，另跑 test-portable-runtimes 的扩展模式到客户端验收。市场兼容性摘要可由显式 App/CLI 检查命令更新；摘要刷新不迁移或重写扩展协议。

## 裸 Skill 的插件外壳

无插件清单的根 Skill 或 skills/<目录>/SKILL.md 由 configuration 读取安全 frontmatter 形成虚拟条目；marketplace 只在私有安装副本中生成清单，保持技能目录内相对资源路径。每个 Skill 一插件，元信息完整沿用 Skill，原始 source 与执行 plugin 分离。后续兼容计划、完整性、来源身份与不可变更新均复用已有协议，不新增依赖、配置资源或运行时适配器。边界及更新失败语义见 docs/15。

## 可选工具预批准元信息

Skill 的 `allowed-tools`（及 `allowedTools` 拼写）不参与平台 Runtime 兼容性判断，也不因字段内容增加拒绝原因。原始文件、安装副本与调用投影保留该元信息，平台不把它转换为工具限制或额外授权；实际工具调用继续由目标 Runtime 自身配置处理。其他专用字段、子代理工具选择、Hook 与完整性校验保持原规则。没有新协议版本：既有可用绑定的计划结构和摘要不变；之前因该字段被拒绝的目标没有有效冻结计划。已有插件可通过检查兼容性更新目录摘要，无需重装，不改历史文件或绑定。
