# 员工类型与普通沟通简化

目标：移除研发员工类型/仓库绑定，把仓库说明交给提示词；普通沟通仅直接答复，不再要求 handoffToAgentId 或产生自动转交。范围为 Store/HTTP/CLI/renderer/提示词；Task 内经理派工、咨询与验收保持原协议，不新增依赖或 Release。

事实与实现：

- 旧 communication schema 把 reply 与 handoffToAgentId 都设为 required，提示词和 Store 仍提供候选/单次转交。现 schema 的 properties/required 均只有 reply；未知字段、空正文依然拒绝。删去候选列表、转交字段及自动子投递、界面标签。私聊和群聊的人类 @/不 @ 广播规则、成员 FIFO/并行、可见性、原生会话与已保存消息保留。
- 员工当前配置只接受 business/manager，HTTP/CLI schema/help 拒绝 developer/repository，表单移除绑定栏。显式编辑去除旧 repository，当前读模型不返回废弃字段。新 Task 的 repositoryMode=workspace，sources/bindings 为空，所有成员从 Run 根启动；地址/基线可写 systemPrompt。旧 Task/Run 的冻结仓库继续检出和执行，不启动迁移、不重置真实数据。
- 正式认证接口核对本机有两位旧研发员工（研发实现、独立测试）。按本轮指令显式改为普通员工，并将各自原 URL/ref 工作说明追加到原 systemPrompt；名称、Runtime、状态、角色绑定未改。17 个 Task 完整读模型 SHA-256 在更新前后相同。该操作是请求的当前配置变更，不是测试或启动自动迁移。

实际验证：

- npm test：600 pass / 0 fail。保留历史仓库检出、缺失基线失败/修复、文件变化与旧冻结执行验证；测试通过显式冻结夹具建历史任务，不借废弃输入创建新员工。
- 规定 check:ai/check:impact、四个 node --check 与 git diff --check 通过；CLI 另测退休类型/仓库拒绝、普通员工提示词输入及实际认证数组操作。沟通不在 CLI 功能边界内，不增加 CLI 命令。
- AGENTFORGE_DIRECT_COMMUNICATION_REAL=1 node scripts/test-communication-direct-real.mjs：Claude Code、Codex、DeepSeek Harness 三种真实 Runtime 均先运行旧 handoff schema，再用新 reply-only 协议重试成功，原生 session ID 保持不变；群聊明确 @ 一人只产生一份投递，未选成员不调用。证据隔离检出 .data/direct-communication-real-QkeSit。
- AGENTFORGE_DSH_REAL=1 node scripts/test-dsh-real.mjs：真实沟通、共享工作根无仓库绑定的新任务、MCP/Skill/子代理、精确澄清→人类确认→归档及后续答疑通过，证据 .data/dsh-real-YIYanG。
- 源码 UI .data/roles-ui-WX7JZ8 和打包 UI .data/roles-ui-owm6HJ：普通员工/经理选项、没有仓库输入，HTTP 拒绝旧字段，创建/保存与两主题宽窄布局通过。
- 打包完整验收 scripts/test-packaged-electron.mjs 通过：含 reply-only 沟通未读、CLI、文件、任务/确认、隔离重置及关闭生命周期。证据 .data/packaged-electron-e2e-aa7qOG。
- 初轮旧功能测试仍断言转交/仓库字段，按新协议同步；历史夹具重载后曾误用默认 CLI，改为恢复原夹具专用 executable 后完整回归通过。保留原错误，不把摘要当通过证据。

限制：不消除原生历史中的旧指令影响；实际三 Runtime 的同会话续接已验证。旧 Task 中的仓库是冻结事实，当前入口移除不等于删除其历史路径。新任务的仓库创建/拉取由员工依据提示词和用户目标执行，平台不承诺自动检出。
