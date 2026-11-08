# 多 Runtime 原生 CLI 接入

## 决策与边界

固定 Runtime 目录扩展为 Claude Code、Codex、DeepSeek Harness、Cursor、Gemini CLI、Qwen Code、Kimi Code、Pi 和 OpenCode，每项保留独立模型、思考等级及可用开关。共享 `client/runtime-providers.mjs` 管理 ID、标签、执行文件与真实参数词汇，App、Store、HTTP、CLI 不各自维护不同目录。

新增适配器复用已有进程执行、取消、空闲检测、脱敏日志及调用注册，不建立第二个任务引擎，不直接访问领域 Store。任务、自动化和沟通走同一个 Runtime 分派器。仅凭原生事件确认会话，后续显式传精确会话 ID；不使用“最近会话”，不将平台占位 UUID 当作已创建会话。OpenCode 的 `ses_` ID 保留合法下划线。

只在原生完成事件及正常进程退出后接受最终文本；非零退出、明确错误、缺少完成及会话 ID 不匹配均失败。公开正文、思考和工具调用写现有 Trace 内容，原始帧和凭据不进入持久审计字段。结构化输出要求交给原生参数或本轮指令；最终业务响应仍由现有解析和协调逻辑解释。

新增 Runtime 提供任务、沟通、模型设置、会话续接、控制台、基础 Skill 插件和 MCP；Claude/Codex 插件的 Subagent/Hook 方言不直接宣称兼容，所选不支持扩展在现有市场绑定校验中明确拒绝。按组件整体兼容计划开放插件，独立 MCP 支持全部九种 Runtime，不能静默忽略选中扩展或加载全局插件替代。新增 Runtime 不改写当前员工、冻结任务或全局账号配置，产品不自动安装或升级全局 CLI；开发验收依用户明确要求安装六个新增 CLI 的官方最新版。

无法通过原生命令安全查询模型目录时返回明确错误并保留手工输入，不编造模型/档位。安装只读检查执行 PATH；未安装的槽位仍可见，但不能启用、测试或启动。账号登录继续由各 CLI 自己管理。

OpenCode 使用 `opencode api --standalone model.list` 查询模型及变体元数据，只投影可公开模型字段。Gemini 的应用系统指令通过私有 `GEMINI_SYSTEM_MD` 文件传递，按成员创建稳定的私有 `GEMINI_CLI_HOME`；只投影账号、模型及连接环境，仅加载所选 Skill/MCP，关闭未选择的 Hook，并显式跳过目录交互信任提示；Qwen追加系统指令，Kimi Code 2 使用创建时绑定的 Markdown Agent，每轮从私有指令文件读取最新应用说明，Pi追加系统文件，OpenCode 使用本轮私有 Agent 配置、独立服务器及关闭自动更新。Cursor没有独立系统指令参数时，显式在本轮消息前缀传入应用指令，属于传输能力限制，不能声称为原生system角色。新增适配器通过相同私有历史桥加载 agentforge_history，不另造历史接口。

## 原生接口依据

- [Cursor Headless 输出](https://docs.cursor.com/en/cli/reference/output-format)：print、stream-json、精确 resume。
- [Gemini Headless](https://geminicli.com/docs/cli/headless/)：init/message/tool/result 流。
- [Qwen Headless](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md)：stream-json、session_start、resume。
- [Kimi CLI](https://github.com/MoonshotAI/kimi-code)：`-p`（自带自动许可，不与 `--auto` 混用）、stream-json、精确 session；原生终结 `session.resume_hint` 才确认会话。
- [Pi JSON](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md) 与 [CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md)：session header、message_end、agent_settled、session 文件。
- [OpenCode CLI](https://opencode.ai/docs/cli/)：run --format json、--session、--auto；以本机帮助确认实际版本支持。

实现入口 `server/runtime/portable-cli.mjs`；验证入口 `tests/portable-runtime.test.mjs` 与隔离客户端 `scripts/test-portable-runtimes.mjs`。夹具只证明协议处理，真实模型验证单独记录，缺少安装/账号不能宣称通过真实执行。

## 本轮接入基线

| Runtime | 官方最新版安装基线 | 调用约束 |
| --- | --- | --- |
| Cursor | 2026.11.05-86047df | 精确 `--resume`；账号由 `cursor-agent login` 管理 |
| Gemini CLI | 0.67.0 | 原生系统文件与 `--resume`；首次在 `gemini` 登录 |
| Qwen Code | 0.26.9 | 私有 QWEN_HOME 投影连接设置与所选 Skill/MCP；QWEN_RUNTIME_DIR 保留原生会话存储；原生 `--resume` |
| Kimi Code | 2.5.2 | 官方新 CLI，取代已停维 Python `kimi-cli`；Markdown Agent 仅创建时传入 |
| Pi | 1.5.0 | 原生 JSON / 精确会话，显式关闭未选择扩展 |
| OpenCode | 2.2.6 | 独立服务器；v2 Agent/system；MCP、Skill 原生策略默认拒绝并精确放行所选名称；未选择的原生插件配置拒绝加载 |

OpenCode v2 的 `run --session` 在 ID 不存在时会创建会话。因此续接先用精确 ID 执行只读 `session export --sanitize`，仅校验退出状态，流式丢弃所有输出；不缓存或复制历史，不把导出内容写入控制台。未找到会话走现有明确恢复路径，不在旧 ID 下静默新建。

Kimi 的创建时 Agent 指向按执行成员键隔离的 `.agentforge/runtime-context` 私有指令文件；续接只更新该文件，不改写原 Trace。没有原生终结提示时保留调用记录，不能声称已有可续接会话。

Cursor 原生插件、MCP 与 Skill 缺少统一的调用级关闭接口，因此为每位执行成员使用稳定的私有 CLI HOME、CURSOR_CONFIG_DIR 与 CURSOR_DATA_DIR。仅投影原生模型和权限设置，不继承全局扩展；macOS 引用现有默认加密钥匙串数据库，文件认证引用原账号文件，由 CLI 自行读取，不提取令牌。工具仍以本机用户权限运行，应用指令明确给出原用户目录及 Git/SSH 等命令的 HOME 用法；这不是文件访问沙箱。

Gemini 的系统设置覆盖要求 root 所有权，不能用用户私有文件冒充系统设置。因此在 `.agentforge/runtime-context/<成员执行键>/gemini-home` 维护稳定的原生配置与会话缓存，只投影连接字段，扩展不从全局继承。OS 钥匙串仍由原生 CLI 读取；旧 OAuth 文件通过 `GOOGLE_APPLICATION_CREDENTIALS` 引用，适配器只读文件元数据，不读取 token 字节。原始文件变动仅使该成员的派生认证缓存失效，全局配置和账号不改写。

真实验证中的隔离 HOME 在 macOS 下只引用现有默认加密钥匙串数据库，确保原生 CLI 的 `security` 查询仍能定位现有登录；验证程序不查询或输出凭据值，不创建或修改钥匙串。

新六种适配器在合成实际应用指令（含原用户目录及输出格式）后再发布唯一一次提示词快照；历史桥不提前保存不完整的原始输入。Gemini 以最后一个工具轮次之后的助手文本作为最终结果，避免把工具前旁白拼接进交接 JSON。未确认原生会话的失败轮次不推进输入消费游标。

Cursor、Gemini、Qwen 显式加入本轮 Trace 与当前消息附件的上下文目录，避免原生文件读取工具拒绝工作目录之外的工作流/上传文件。目录由已有归属校验后的文件元数据派生，App 与 CLI 的任务/消息入口共用，不开放任意原生启动参数。

Cursor 的 result.result 包含整轮助手转录（含工具前旁白），不能覆盖最终助手消息。适配器以最后一个完整 assistant 信封的文本块作为最终输出；只有没有 assistant 文本时才回退 terminal result。所有旁白仍保留在控制台，避免把转录拼入业务交接 JSON。

## 扩展投影决策（2026-11-08）

复用市场完整性校验、组件级兼容计划和冻结引用；`portable-extensions.mjs` 只物化调用级原生 Skill/子代理/MCP 配置，不拥有 Store 状态、不安装全局扩展。六种 Runtime 均提供原生 Skill 加载及 stdio MCP；HTTP/SSE 复用现有 mcp-launcher，凭据只由私有引用读取，不进入命令行或提示词。Skill 及相对支持文件保留在私有插件副本，注册名按插件命名空间区分；原生加载器负责发现与按需读取，不把正文拼入系统提示词。

插件是组件整体兼容的安装单元；原生尚无经验证等价映射的 Hook、子代理或专用 Skill 行为明确拒绝，不静默丢弃。市场兼容性属于可重新计算的目录摘要；显式检查更新当前目录元数据，不迁移配置、不改写不可变安装文件、员工绑定或历史任务快照。App 与 CLI 共用检查命令。

原生事实来源：Cursor `--plugin-dir` 与 [插件规范](https://prod.cursor.com/docs/reference/plugins)、[Gemini 原生 Skills](https://geminicli.com/docs/cli/skills/)、[Qwen Skills](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/skills.md)、[Kimi MCP](https://moonshotai.github.io/kimi-code/en/customization/mcp.html)、Pi 已安装官方 CLI 的 `--skill`/`--no-skills` 及 MCP 配置实现、[OpenCode v2 Skills](https://opencode.ai/docs/skills/) 与 [MCP](https://opencode.ai/docs/mcp-servers/)。以安装版本的真实调用证据为交付门禁。

配置细节：Cursor 用 `--plugin-dir` 加载仅含选中 Skill 和无工具约束子代理的原生包装目录；Gemini 使用私有 `.gemini/skills` 与 `mcpServers`；Qwen 私有 HOME 隔离其他工具的全局 Skill，禁用项目/扩展/内置 Skill 层并仅提供私有用户 Skill；Kimi 用真实父目录 `--skills-dir` 和包含 `${base_prompt}` 的 Agent 模板，保留原生环境及 Skill 目录；Pi 用 `--no-skills --skill` 精确选中、显式加载内置 MCP 及所选子代理扩展，MCP 设置 `exposure:direct`；OpenCode v2 使用 `skills` 数组和 `mcp.servers`，按精确 ID 设置 `skill.use`/`mcp.use` 例外，不禁用 Provider 必备原生插件。

检查兼容性：App 市场详情的“检查兼容性”与 `plugins check-compatibility ID` / `mcps check-compatibility ID` 调用同一受认证 POST `/:id/compatibility`，重新验证安装并由 Store 仅更新目录 providers/compatibility/components/warnings。列表仍为 SQLite 分页查询，不在列表请求中全量解析磁盘。角色绑定按当前兼容性计算，不依据过期安装清单 providers 拒绝新增 Runtime。

验证脚本 `scripts/test-portable-extensions-real.mjs` 逐 Runtime 验证原生 Skill 的私有随机内容、相对资源文件、三种 MCP 工具真实返回，以及精确会话续接后的变化值。禁止用 Shell 客户端替代缺失原生 MCP 工具，Pi 另断言实际 mcp__ 工具事件；`AGENTFORGE_PORTABLE_EXTENSIONS=1` 的 test-portable-runtimes 通过 CLI 导入扩展、绑定角色及员工，覆盖任务、原生续接、普通沟通、客户端验收。

员工选择新 Runtime 并绑定既有角色时，HTTP 先验证组合扩展，再由 Store 按该角色相同不可变扩展 ID 补齐缺失目标的派生执行计划；已有目标计划、角色选择及历史快照不修改。此为配置命令的按需解析，不在启动或读列表时迁移数据。

## 独立子代理原生投影

Gemini/Qwen/Kimi/OpenCode 使用原生子代理定义及工具选择；Pi 使用官方扩展 API 注册选中子代理工具，并像官方独立子代理扩展示例一样启动独立 Pi 进程/会话，传递冻结正文、继承父模型、限制源工具、等待真实结果并联动取消。不引入第二个 Task 引擎，不写 Store，不用父模型冒充独立审校。Pi 扩展由原生加载器提供 TypeBox，无新增应用依赖；源码仅在 Trace 私有目录物化，普通后台不导入原生扩展依赖。

Cursor CLI 的 Markdown 子代理接口只提供 readonly 而非等价 tools/disallowedTools 选择：含这些源约束的子代理仍明确不兼容；不删除约束或改成提示词承诺。没有工具约束的定义可以加载。需要完整工具选择时须使用其他已兼容 Runtime，不能把宽松工具集当作等价映射。

2026-11-08 真实门禁：新增六种 Runtime 均通过原生 Skill、相对资源、三种 MCP 传输、两轮变化值与原生子代理独立计算；各目标另经 App/CLI 角色继承完成任务、精确续接、两轮普通沟通及客户端确认。最终签名包另通过真实 Pi 独立子代理与 MCP 的完整任务；这不代表每个业务插件的翻译、生成或发布业务已逐个执行。

## 模型与思考选择
新增目标从原生目录/本机模型元数据投影候选，不再统一空列表：Cursor --list-models；Gemini models --output-format json；Kimi provider list --json 只投影 models 的名称/档位，忽略 providers、鉴权和地址；Pi --list-models；OpenCode 原生 API 模型元数据；Qwen 使用本机 modelProviders 与官方 OAuth 模型别名。目录输出统一 label、levels（id/default），来源和错误不展示私有配置。未知模型允许手工输入，不将未知能力误判为无思考。设置/CLI 使用同一模型校验。思考参数只写本轮原生配置/参数/环境，不写全局账号配置，冻结任务的选择不变。

原生思考传递：Cursor 从已列出的同族档位变体映射原生模型 ID（保留 fast），手工参数化模型使用 effort 覆盖；Gemini 3 在私有 modelConfigs.overrides 为选中模型设置 thinkingLevel（minimal/low/medium/high），Auto 和仅 token-budget 模型保持默认；Qwen 私有 model.reasoningEffort；Kimi 每轮 KIMI_MODEL_THINKING_EFFORT 并按目录 supportEfforts 校验；Pi --thinking（包括 max）；OpenCode --model provider/model#variant。目录错误不把原生 stdout/stderr 或 cause 附到公开错误，缓存只保留投影结果。

思考配置原生依据：[Gemini modelConfigs](https://geminicli.com/docs/cli/generation-settings/)、[Qwen model.reasoningEffort](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md)、[Kimi 环境变量](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/env-vars.html)、[OpenCode 模型变体](https://opencode.ai/docs/models/)。Cursor/Pi 参数以当次最新版原生 help 和真实目录为准。
