# 独立任务成员、团队人员池与群聊

基线：`f773e5c`，直接在 `main` 开发。范围为任务成员、团队、员工删除及长期沟通的同一组成员语义；不增加业务验收门禁、宿主权限或新依赖。

## 交付行为

- Task 保存独立 `memberAgentIds` 和冻结快照，不接受 `teamId`。选团队只展开员工 ID，可以继续添加其他团队或员工；全部选中项显示在共享输入框内。必须且只能加入一位可用项目经理，含第二位经理的候选会禁用，HTTP/CLI 再独立校验。
- 团队保存统一的员工集合，可以为空、可以没有经理。删除团队不影响任务或独立群聊；任务列表、详情和员工控制台不再显示团队标签或筛选。
- 员工删除保存 `status=deleted`、`deletedAt`；当前目录、选人、团队、群聊成员及私聊列表隐藏。未执行的沟通投递取消并留审计；已经开始的答复保留，但不继续唤醒其他员工。运行中的任务继续使用原冻结成员，历史消息、Trace、产物和会话不删除。任务结束后不可向已删除员工发起新答疑。
- 群聊使用独立 ID、名字、成员集合，每次创建新群；可编辑名称和成员。团队仅是批量加入员工的入口，不决定群身份或后续成员。
- 群聊右侧显示当前员工，姓名打开角色、系统/共用提示词、能力和简介；姓名后的图标在最右打开该员工控制台。窄屏可关闭成员/控制台，草稿保留。移除正在查看的成员时关闭其当前面板，避免持续读取已删除对象。
- 私聊仍使用 `{reply}`，群聊使用 `{reply, mentionAgentIds}`。公开正文只显示回复，不展示 JSON 信封或“回复的问题”。明确的员工 @ 可产生同事答复；普通答复不广播唤醒全员。同一人类消息的一轮讨论中每人最多唤醒一次，避免循环，消息与去重审计均保留。

唯一领域契约见 `docs/03-domain-model.md`，群聊协议见 `docs/17-communication.md`。Runtime 只适配模型，成员规则与投递由 Store 管理。

## CLI 与协议同步

`tasks create` 改为 `memberAgentIds`，`tasks list --team` 移除；任务详情只输出员工 ID/名称引用。`teams create/update` 不接受单独的 `managerAgentId`，团队成员可空；团队查询不倾倒员工提示词或 Runtime 配置。`agents delete --yes` 返回逻辑删除结果和 `historyRetained`。命令、渐进帮助、schema、示例、文本/JSON 输出、文档及测试同步。

长期沟通原本不属于 CLI 覆盖范围，本轮没有新增 CLI 群聊权限。新群聊入口为认证 `POST /api/communications`，编辑为 `PUT /api/communications/:id`。

旧输入明确拒绝，不自动迁移或清空真实数据。现存冻结 Task/Run 和会话记录继续保留；旧调用方须同步升级，缺少必要冻结成员的未启动任务须重新创建，无需为本次改动重置已运行任务。

## 实际验证

### 自动化与正式入口

- `npm test`：612 项通过，0 失败。
- `npm run check:ai`、`npm run check:impact`、`git diff --check` 通过。
- `node --check` 覆盖规定的 `server/index.mjs`、`server/store.mjs`、`server/orchestrator.mjs`、`web/app.js`，以及受影响的沟通、提示词、CLI 和专项验证脚本，通过。
- `node scripts/test-task-creation.mjs`：隔离 Electron，两主题、1320×1000 / 760×760 / 800×560；跨团队加入员工、拒绝第二经理、框内标签、创建空团队和保留停用成员通过。真实 CLI 子进程通过认证 HTTP 检查创建/查询/删除、旧输入拒绝、团队删除后任务独立、员工删除后冻结引用保留。证据：`.data/task-creation-7zdZtq/evidence.json`。
- `node scripts/test-communication-workbench.mjs`：独立群创建/重命名/编辑、团队删除后成员不变、@ 选择、成员详情/控制台、删除后隐藏、草稿、附件与分页通过；两主题、1500×1000 / 760×700 无横向溢出。受控 CLI 缺失只用于错误呈现，不冒充真实模型。证据：`.data/communication-workbench-nGkdUU/evidence.json`。

### 三种真实 Runtime 群聊

实际运行：

```bash
AGENTFORGE_DIRECT_COMMUNICATION_REAL=1 node scripts/test-communication-direct-real.mjs
AGENTFORGE_DIRECT_COMMUNICATION_REAL=1 AGENTFORGE_DIRECT_COMMUNICATION_RESUME=.data/direct-communication-real-B4cEVs node scripts/test-communication-direct-real.mjs
```

Claude Code 2.1.310、Codex CLI 0.164.0、DeepSeek Harness 0.2.1-rc.2 均验证私聊回复、独立群直接答复和员工 A 明确询问 B 后 B 的真实回复。Codex 的 B 调用首次因模型目录请求超时失败；保留原错误，只重试失败投递后完成。只读复核三组已完成投递和随机探针，结果存于 `.data/direct-communication-real-B4cEVs/final-evidence.json`，重试回执在同目录 `resume-evidence.json`。

### 真实完整任务与删除语义

加载登录 Shell 环境后运行 `scripts/test-prompt-e2e.mjs`，设置 `AGENTFORGE_PROMPT_E2E_REAL=1`、`AGENTFORGE_PROMPT_E2E_TASK_ONLY=1`、`AGENTFORGE_MEMBERSHIP_REAL=1`。

两次真实 Claude Code 工作流均完成：经理向人类澄清 → 在等待阶段删除来源团队和实现员工 → 冻结员工真实开发并执行测试 → 非作者独立测试 → 经理请求验收 → 客户端勾选确认 → 完成后历史工具答疑 → 归档。第二次实现的 Node.js 测试另由验收脚本运行，10 项通过。任务 `task_df86bd74-2d76-40aa-9ea9-1f6a1b4551df`、Run `run_mvzh4rvf_2`；删除员工从当前 Tab 隐藏，但历史交接入口实际打开原控制台。

如实保留两次脚本末尾失败：第一次附加“CLI 缺失”探针误用了已经删除的员工，第二次探针的界面断言只匹配 ENOENT，而实际为 Shell 的文件不存在错误。修正夹具和断言后，对同一已确认归档的任务及失败 Run 补测宽窄控制台、健康端点、取消投递，均通过；没有重写原失败证据。证据：`.data/prompt-e2e-wfbadi/evidence.json`、`.data/prompt-e2e-ACLHMZ/evidence.json`、后者同目录的 `supplemental-evidence.json` 与截图。补测命令：`node .data/membership-final-ui-recheck.mjs`。

## 限制与交付边界

- 本轮验证源码 Electron，未构建、安装或发布新包；没有改造操作者真实任务、数据库、安装或全局 CLI 凭据。
- 原生会话可能记得旧成员、旧角色或旧沟通；更改当前配置不会擦除原生历史，后续调用以当前系统指令和成员事实为准。
- 未对每个业务插件执行完整视频生产等业务流程；这里验证成员关系、实际模型沟通与完整代码任务生命周期。
- 测试日志、截图、SQLite、会话及配置只留在忽略的 `.data/`，不进入提交。
