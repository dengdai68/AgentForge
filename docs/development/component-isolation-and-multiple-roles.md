# 组件错误隔离与员工多角色

目标：来源内一个 Skill/Hook/Subagent 格式错误不阻断有效组件，安装后给出可定位的 ⚠️；员工能绑定整组有序角色。范围为现有 Runtime/Store/HTTP/CLI/renderer，不新增依赖、不更改业务权限，不发布新 Release。

实现：

- 安装阶段只捕获明确的组件定义错误，按 Markdown 文件或 Hook 声明/事件/匹配组/处理器隔离；原始源保留，规范化可执行树排除错误 Markdown，按方言写有效清单/Hook，最后计算不可变摘要。路径越界、链接逃逸、完整性、插件清单和 MCP 错误仍拒绝批次。没有有效组件的错误插件不安装，有效兄弟插件继续。
- HTTP 返回 warnings；安装后弹出错误清单，插件详情保留，CLI 默认文本与 JSON、自动更新状态同步。只含相对定位与原因，不带 YAML 缓冲区/源正文/Hook 命令。合法空 Hook 事件、`*` 通配符保持有效。
- 员工写协议为 roleIds 数组，支持添加/移除/重排，重复/null/未知 ID 原子拒绝。Task/Run 冻结整组 roleSnapshots；沟通发送/重试解析当时角色，历史不改写；按数组顺序进入应用系统/developer 指令。
- 旧 roleId 写入拒绝。仓库约定不自动迁移当前配置：非空旧绑定需升级前解绑或操作者显式重新初始化；历史单角色快照仍以冻结值读取。本机正式只读接口确认 16 位员工、0 个角色、无旧角色绑定，无需初始化。

实际验证：

- npm test：最终 599 pass / 0 fail。早轮暴露未同步的 DSH 单角色测试，已改为数组；并行重负载下一次 SDK 夹具启动超过其10秒门限，未改产品超时，后续完整门禁通过。
- npm run check:ai、npm run check:impact、规定四个 node --check、git diff --check 通过。影响门禁先指出遗漏的架构说明，补齐后通过。
- AGENTFORGE_PLUGIN_RUNTIMES_REAL=1 node scripts/test-plugin-runtimes-real.mjs：两种源 × Claude Code/Codex/DeepSeek Harness 共6组通过。每份源加入错误 Skill/Subagent/Hook，同时验证有效原生 Skill、独立子代理、真实 Hook、stdio/HTTP/SSE MCP 与两角色提示词实际生效。证据 `.data/plugin-runtimes-real-jcVvV4/`，不执行外部业务 Hook。
- AGENTFORGE_DSH_REAL=1 node scripts/test-dsh-real.mjs：实际沟通、多角色冻结、独立子代理、MCP/历史工具、澄清精确回复、完整任务→可见人类确认→归档及后续咨询通过。隔离验证检出证据 `.data/dsh-real-XakH32/`。
- node scripts/test-roles-ui.mjs：实际 Electron 多角色添加/重排/保存回读/清空、被引用角色删除拒绝、废弃HTTP字段拒绝、部分安装警告/详情、相对路径和正文不泄露通过；保留两主题宽窄目录与窄屏表单截图。证据 `.data/roles-ui-2iSWM0/`。测试中修正表单异步读取等待和截图动画等待，未按摘要推断通过。
- ai-minions 原始本机来源只读导入：26插件、78个 Runtime 计划可解析，warnings为空；不安装到真实业务实例、不执行其业务脚本或上传 Hook。证据临时目录 af-partial-minions-lvOdoi/evidence.json。

限制：静态格式检查不能证明任意源 Shell/脚本的业务行为正确，也不能实现尚无等价映射的专有 Runtime 功能；这些仍明确拒绝。多个角色冲突由配置者安排，平台按顺序传递，不自动裁决。原生会话可能保留旧角色历史影响。真实业务插件完整工作流不属于本轮机制验证。

打包验证：electron-builder arm64 ad-hoc 开发包；完整 test-packaged-electron 通过（隔离配置/登录、扩展、CLI、任务到可见确认、文件与关闭生命周期）。AGENTFORGE_ROLES_APP 指向应用包运行同一角色/部分安装 UI 验收和真实认证 CLI 数组写入/清空，通过于隔离验证检出 `.data/roles-ui-k3JFam/`。初次额外打包验收发现测试仍将配置种在源码数据路径，改用打包版的隔离 HOME/.agentforge/desktop 后通过；不改产品数据路径。
