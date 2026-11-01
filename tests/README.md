# 测试

本仓库仅验收客户端。HTTP 夹具模拟自有 IPC 子服务，不是独立 Web 产品；UI 只操作隔离 Electron，真实任务用 test-prompt-e2e，沟通用 test-communication-workbench。

工作目录回归：自定义目录/根文件/大媒体的真实Git状态、任务初始提交比较、1005项分页、根读取/下载、工作流路径和重启保留；路径穿越、内部凭据、链接拒绝。真实开发端到端通过CLI配置、Claude实现与独立测试、非docs产物/媒体、Web与打包界面、人类确认。

plugin-updates.test.mjs 使用本机 HTTPS Git smart-HTTP 真仓库验证提交变化、同版本号更新、原生文件/员工引用、删除项不重装、MCP不重复安装、兼容失败保留和恢复、来源隔离、取消/单飞/持久开关及周期校验。settings/communication 测试覆盖设置草稿、最近执行成员与最近更新会话选择。plugin-git-fixture.mjs 的临时TLS信任仅用于测试进程，不进入安装包。AGENTFORGE_PLUGIN_UPDATE_SCHEDULE_REAL=1 可实等120秒；普通单测仅缩短注入时钟间隔。

MCP 编辑覆盖脱敏保留/凭据清除/服务重命名拒绝、不可变文件、当前员工原子绑定、并发冲突回滚及 CLI 部分 PUT。隔离实际 UI 验收涵盖空团队、编辑取消/错误/成功、宽窄布局与 API/CLI 回读，不修改操作者实例。

native-skills.test.mjs 使用明确的 stdio 协议夹具检查额外根、线程启用列表、输入/输出 schema、精确续接、缺失技能/会话、错误、交互请求、取消及超时；夹具通过不替代真实模型验收。

打包历史回归覆盖 Codex 真实启动参数完整转发 Bridge 环境、required 和 Provider 不继承 Node 模式；package:mac:check 用内置 Electron 实际 MCP 握手、列出八工具并检索随机已存记录，不以提示词声明代替可用性。真实模型脚本另有 PACKAGED 模式：Claude/Codex 历史检索、代码任务完整验收、完成后答疑和归档拒绝。协作投影 UI 覆盖所有未归档状态可输入、真实消息时序、无固定验收副本/停止答疑及紧凑气泡，最终确认门禁保留。

提示词展示回归覆盖完整脱敏系统层/本轮输入与已确认会话 ID，保留截断/缺失语义；工具阶段按 Trace + 调用 ID 合并，不按相同参数合并真实独立调用，无 ID 不猜测。投影与 Electron DOM 验证两个参数完全相同的独立调用，各自只显示一次输入和输出，重复开始/完成阶段不制造额外调用。覆盖晚到 web_search action、员工资料/扩展编辑后会话不重建及 Runtime 连接变更重建。图标核对用户原图 SHA-256、PNG/ICNS 和宿主引用；团队/工作流搜索与紧凑工具栏由宽窄目录脚本操作验证。

控制台投影覆盖常规通知隐藏、正文/思考/工具及异常/未知记录保留、源事件不变，以及降噪后的工具配对/分组；原始事件仍用于分页和提示词时间边界。

prompts.test.mjs 覆盖系统/当前输入分层、经理独占工作流、消息确认游标、真实 CLI 参数和续接环境更新；既有协调夹具显式读取系统文件并选择员工，不依赖旧节点映射。真实模型验收另见 scripts/test-prompt-e2e.mjs。

roles.test.mjs 覆盖角色 CRUD 校验与审计事件、员工 roleId 绑定/解绑/非法拒绝、删除引用拒绝（含停用员工）、Task/Run 快照冻结角色文本与删除后可核验、沟通投递快照发送时嵌入与显式重试刷新、角色提示词只进系统指令不进当前输入、旧 role 字段不复活，以及 roles CLI 渐进帮助/schema 和认证 CRUD 请求形态。

settings.test.mjs 的偏好持久化用例包含角色隐藏选择，防止新增侧栏入口遗漏 NAVIGATION 后在保存/读取时丢失；实际隐藏、重载、恢复默认和 SVG 宽窄窗口显示由 scripts/test-roles-ui.mjs 验证。

沟通工作台新增附件归属/同名/空文件/二进制/完整性/链接/超限、发送幂等与上传失败保留、仅真实未读提示及控制台按调用分页的回归。真实 Provider 不作为单测夹具：由 scripts/test-communication-workbench.mjs 显式执行随机文件读取验收，安装包再验证相同 UI/API。

CLI 资源单测使用真实权限受限的连接文件和明确的 health 夹具，失效/不安全/实例失配时不得发送凭据或回退 Web。配置/任务 CLI 真实 E2E 在独立 Electron 随机端口执行，保持 Web 4310 不受影响；新 Task UUID 的跨进程回归固定时间戳验证共享工作根不碰撞。fixture home 和已保存的隔离任务目录防止写入操作者目录。

市场安装覆盖来源内文件/目录链接、中文/空格路径、可执行位、空目录和来源移除后的独立读取；断链、循环、越界及 FIFO 验证明确错误与整批回滚，运行期链接篡改仍拒绝。CLI 操作帮助验证相同安装语义。

`npm test` 通过 `scripts/run-tests.mjs` 运行 Node 测试，清理继承的实例与 Git hook 环境，并将日志指向临时目录。

主要覆盖：领域与投递、Runtime、认证、员工配置、CLI、文件存储、Git Diff、历史查询、展示投影及 Electron 策略。

- `settings.test.mjs`：设置、会话展示、延迟加载、团队搜索与停用成员保留。
- 工作目录保存用真实临时文件系统测试缺失目录创建、已有文件保留、根/相对路径/文件阻挡拒绝与失败不保存；协作按发送者（不按接收者）布局，市场状态在卡片网格外，加载失败不误报空态。
- `client-projections.test.mjs`：跨客户端纯投影与认证静态资源入口。
- `electron.test.mjs`：宿主边界与打包清单。
- `ai-contract.test.mjs`：规则入口、模块联动和提交检查。

UI 使用隔离 Electron 实例检查宽窄布局、搜索、展开和滚动。真实 Provider E2E 为显式专项命令，不以夹具冒充模型执行。夹具、截图、日志、数据库和凭据不得提交。

安装包检查先确认控制台未选择员工时没有日志，再显式选择员工、滚动到正文并验证延迟内容。

提示词回归覆盖未完整加载的长调用、交错调用去重与隐藏帧分页边界。协作/沟通配色只投影真实消息事实；CLI 回归确保视觉元数据不泄漏到 JSON。

重复导入验证：marketplace.test.mjs 覆盖插件＋MCP同事务替换、停用员工、过期绑定回滚及历史文件可读；configuration-cli.test.mjs 覆盖渐进帮助/schema与覆盖回执。test-marketplace-edit.mjs 使用隔离 Electron/CLI/API 验证并发导入、不同来源、整批失败与角色宽窄空态。

完整协作记录：client-projections 覆盖全部消息/实际投递/协调事件、同文不同消息、无来源历史投递、发言与执行 Trace 分离和原始 Provider 数据排除；dispatch-routing 验证同 Run 来源校验及消息输入/排队语义不变；configuration-cli 验证文本/JSON 投影。真实桌面与 HTTP/CLI 验收见 scripts/test-collaboration-flow.mjs。

协作可读性回归：历史时间与当前状态隔离、失败/恢复的逐次执行明细、已存投递/Trace 唯一关联及歧义回退、不同轮人类确认对应不同验收、验收时文件有界引用与删除/未来记录排除；不根据自然语言判断质量。

员工状态回归覆盖最新调用失败→重试→成功和其他成员隔离；交接 JSON 投影覆盖正文提取、重复结果移除、无关 JSON 保留与原始事实不变。隔离 Electron 验证无顶部错误摘要、日志错误红色、5行 Markdown 原位展开和验收无自动附件。

控制台展示已保存的公开 thinking 正文；敏感片段仍过滤，首尾空白与换行规范化不标为脱敏。历史正文为空时明确说明“未保存可显示的思考正文”，不以“已脱敏”占位，不补造未公开或未保存内容。

`node scripts/test-brand-presentation.mjs` 在隔离 Electron 中验证两主题、1320/760px：员工可用与 Runtime 支持同色、支持/不支持及头像/按钮/空态文字对比、键盘焦点、三目录空态 computed style 完全一致、详情入口与真实 HTTP 失败。仅展示夹具，不执行 Provider/MCP。`AGENTFORGE_BRAND_APP=/absolute/path/AgentForge.app` 可检查指定构建包；证据在忽略的 `.data/brand-presentation-*`。

固定 Runtime 回归在 runtime-profiles/configuration-catalog/configuration-cli：两项稳定、字段拒绝、开关门禁、冻结快照与事务回滚。auth 测试真实 HTTP 的委托签发、父退出/重置/重启失效；CLI 测试实例校验与显式会话隔离。scripts/test-runtime-settings.mjs 补实际页内折叠/开关/共享授权及打包默认安装验收。

任务中心操作直接可见的展示回归覆盖删除确认保留、归档/恢复往返和两主题宽窄布局，入口 scripts/test-runtime-settings.mjs；不以其生命周期夹具作为真实 Provider 执行证据。

任务创建展示在 smoke 静态契约与 scripts/test-task-creation.mjs 隔离界面验收同步；显式验收内容仍按原协议冻结，隐藏说明不改变 Runtime 权限或 CLI 能力。

application-updates.test.mjs 覆盖严格正式版与SemVer、GitHub 404/错误、下载并发与显式触发、真实流式校验/失败清理、后台周期停止、IPC来源限制及真实子服务空闲锁（忙写入拒绝、锁中HTTP写入拒绝、正确ID释放）。签名安装真实闭环仍需正式签名Release。

dsh.test.mjs 覆盖第三个固定 Provider、冻结模型/角色与禁用、公开事件过滤、SDK 身份、原生后续等待、非 JSON/终止原因、会话缺失与取消。协议夹具仅验证传输，真实模型与完整任务另跑 test-dsh-real。

Runtime 安装可用性由 cli-environment 与 runtime-profiles 测试分别覆盖 PATH/可执行权限/链接/移除及 Store 的锁定、调用门禁、冻结事实和偏好保留；CLI 覆盖完整展示名称和安装状态输出。

任务协作消息覆盖未指定/null 接收人默认冻结经理、显式成员校验、待答澄清不被普通消息消费、终态仅答疑；renderer 保留明确 @ 与精确回复，移除顶部冗余和答复问题副本。

`plugin-compatibility.test.mjs` 覆盖安全 YAML、两种源的冻结计划、源完整性、旧安装只读重算、未映射组件与 Hook 审计隐私；真实子代理/Hook 在 scripts/test-dsh-real.mjs 另验。
