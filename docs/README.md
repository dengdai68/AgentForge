# 文档

| 主题 | 文档 |
| --- | --- |
| 第一次使用 | [安装、配置员工与检查第一次文件交付](quickstart.md) |
| 代码导航 | [模块地图](00-ai-map.md) |
| 产品 | [功能与协作方式](01-product-requirements.md) |
| 架构 | [系统分层](02-system-architecture.md)、[领域模型](03-domain-model.md)、[性能架构决策](28-performance-architecture.md) |
| 界面 | [设计约定](06-design-system.md) |
| 存储 | [SQLite](07-sqlite-persistence.md)、[文件与 Diff](13-local-artifact-rendering.md)、[统一数据根与目录事务](30-storage-layout.md) |
| 运行 | [本机 Runtime](08-real-local-agent-runtime.md)、[员工配置](15-employee-runtime-configuration.md) |
| 提示词 | [每次员工调用、澄清与新指令的组装逻辑](22-prompt-assembly.md) |
| 登录 | [认证与会话](14-console-authentication.md) |
| 沟通 | [私聊与群聊](17-communication.md)、[历史查询](19-agent-history.md) |
| 客户端 | [Electron](18-electron-client.md)、[CLI](21-configuration-cli.md)、[应用更新](24-desktop-updates.md) |
| 独立项目 | [客户端抽取边界与来源](23-desktop-extraction.md) |
| 关系图 | [本地图形渲染](12-local-diagram-rendering.md) |

文档只描述当前行为。开发流水、临时验收记录和已废弃方案不保留在使用指南中；版本变化见 [CHANGELOG](../CHANGELOG.md)。

- [DeepSeek Harness Runtime 接入决策](25-dsh-runtime.md)

- [26：Runtime 插件源标准兼容](26-runtime-plugin-compatibility.md)：统一导入、原生组件、冻结计划及明确失败边界。

- [自动化](27-automations.md)：定时配置、触发历史、全自动协作、分页和下一轮自动确认；含 Cron 依赖架构决策。

- [29：多 Runtime 原生 CLI 接入](29-runtime-providers.md)：九项目录、会话及原生适配能力边界。

提示词原文对照：[当前安装版逐字导出](development/current-prompt-wording-export.md)。固定文案来自真实组装函数，并核对安装包源码；仅身份配置、消息和路径等动态数据使用 mock，未执行示例任务。

待实施设计：[团队共享协作记录与分层提示词方案](development/prompt-assembly-and-shared-collaboration-design.md)。分别提供 Leader、成员、自动化、私聊和群聊的完整 systemPrompt 与每轮 userPrompt，另列响应协议和模型回复。固定文案是拟实施全文，动态数据使用 mock；尚未修改运行逻辑，不与上方当前行为混用。
