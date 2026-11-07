# AgentForge 首轮推广素材

目标读者：已经使用 AI 编程 CLI、需要协调多个助手的中文独立开发者与小团队。首轮集中在 V2EX「分享创造」和掘金实操教程。此文件的帖子与文章均为待发布成稿，不代表已经对外发帖。

## 统一产品信息

- 仓库：https://github.com/dengdai68/AgentForge
- Beta 下载：https://github.com/dengdai68/AgentForge/releases/tag/v0.1.6-beta.1
- 正式版：https://github.com/dengdai68/AgentForge/releases/latest
- 上手教程：https://github.com/dengdai68/AgentForge/blob/main/docs/quickstart.md
- 定位：为使用 AI 编程工具的独立开发者，把多个 AI 员工的分工、沟通和文件交付集中到一个本机工作台。
- 平台：macOS 13+ / Apple Silicon；当前没有 Intel、Windows、Linux 安装包或在线体验版。
- 成本：Apache-2.0 开源；模型订阅、API 和第三方工具费用由对应服务另计，需自行安装并授权至少一种模型 CLI。
- 边界：本机单管理员，员工以系统用户权限执行，无 Agent 沙箱；当前安装包为 ad-hoc 签名，未经 Apple 公证。模型服务仍可能接收任务内容。
- 截图：v0.1.6-beta.1 隔离实例中的真实配置界面；仅展示示例员工和任务草稿，不是完整模型任务的执行证据。功能以对应 Release 说明为准。

GitHub Description：

```text
A local AI team workspace for developers: coordinate Claude Code, Codex & DeepSeek Harness, track tasks and files, and schedule automations.
```

Topics：`ai-agents`、`multi-agent`、`developer-tools`、`desktop-app`、`macos`、`electron`、`claude-code`、`codex`、`deepseek`、`mcp`、`workflow-automation`、`collaboration`。按实际功能选择，遵循 [GitHub Topics 说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)。

## 渠道一：V2EX「分享创造」

发布入口：https://www.v2ex.com/new/create

节点说明：https://www.v2ex.com/go/create

标题：

```text
[开源自荐] AgentForge：把 Claude Code、Codex 的分工、沟通和文件交付放进一个 Mac 工作台
```

正文：

---

大家好，自荐一个开源桌面项目 AgentForge。

如果你已经在用 AI 编程 CLI，可能遇到过这种场景：一个窗口分析需求，一个窗口实现，另一个窗口审校；分工、上下文传递和最后的文件检查都需要自己来回协调。

AgentForge 尝试把这部分工作放进同一个本机工作台：为数字员工分别设置职责、Runtime 和工具，在任务里选入一位项目经理和其他成员，由经理推进分工和交接。每位员工保留独立会话，协作记录可以关联到控制台和实际文件。

目前接入 Claude Code、Codex 和 DeepSeek Harness。除了任务协作，也支持员工私聊/群聊、插件与 MCP、Cron 自动化，以及配置和任务操作的 CLI。普通任务最终由人来检查和确认。

![AgentForge 数字员工配置界面](https://github.com/dengdai68/AgentForge/releases/download/v0.1.6-beta.1/agentforge-employees-preview-20261107.png)

上图是 v0.1.6-beta.1 隔离实例的真实配置界面，展示示例员工，不是模型已经完成任务的效果图；功能以对应 Release 说明为准。

第一次建议用一个小任务试：给出几条产品素材，让编辑生成 `release-note.md`，审校生成 `review.md`，最后自己打开文件核对。我整理了可直接复制的素材和员工提示词：

https://github.com/dengdai68/AgentForge/blob/main/docs/quickstart.md

使用前说明几个边界：

- 目前发布包支持 macOS 13+ / Apple Silicon，没有 Windows/Linux/Intel 安装包或在线体验版。
- 应用按 Apache-2.0 开源，不包含模型额度；至少需要一种已安装并授权的模型 CLI，多员工会增加调用量。
- 配置与任务记录保存在本机，模型调用仍会连接对应服务。
- 当前是本机单管理员应用，不提供 Agent 沙箱；安装包为 ad-hoc 签名，尚未经过 Apple 公证。
- 这是迭代中的项目，普通任务的交付质量仍需自己检查。

仓库：https://github.com/dengdai68/AgentForge

Beta 下载：https://github.com/dengdai68/AgentForge/releases/tag/v0.1.6-beta.1

想先听听有类似需求的朋友反馈：从安装到创建第一个任务，哪一步最容易卡住？如果你已经在多个 CLI 之间手动分工，也欢迎说说目前最费力的部分。

---

## 渠道二：掘金实操教程

编辑入口：https://juejin.cn/editor/drafts/new?v=2

建议标签：人工智能、开源、开发工具；以编辑器当前可选标签为准。正文如下。

标题：

```text
用 AgentForge 配置一个 AI 编辑小队：从安装到检查 Markdown 交付
```

正文：

---

当一个 AI 助手负责起草、另一个负责审校时，除了提示词，还要处理上下文交接、执行记录和文件位置。AgentForge 是一个开源本机工作台，把这些内容放在同一任务里，并接入 Claude Code、Codex 和 DeepSeek Harness。

本文用“整理产品发布说明”演示第一次配置。先了解员工和任务，再启动模型，最后检查实际文件。本教程由项目维护方提供；截图来自 v0.1.6-beta.1 的隔离实例，示例仅保存草稿，没有执行模型，也没有固定耗时或效果承诺。

### 准备环境

需要 macOS 13+ / Apple Silicon，以及至少一种已经安装并授权的模型 CLI。应用本身按 Apache-2.0 开源，模型订阅、API 和远程工具费用由对应服务计收。

从 [v0.1.6-beta.1 下载页](https://github.com/dengdai68/AgentForge/releases/tag/v0.1.6-beta.1) 获取 DMG，拖入 Applications。当前安装包为 ad-hoc 签名，未经 Apple 公证；若系统拦截，确认来源可信后按系统设置允许打开，不要关闭系统安全保护。

首次打开创建本机管理员，在设置里检查 Runtime 和可写的任务目录。无需部署服务器；目前没有在线体验版。

### 为员工分配不同职责

在「数字员工」创建四位成员，全部使用同一种已授权 Runtime 也可以：

| 成员 | 类型 | 系统提示词示例 |
| --- | --- | --- |
| 项目经理 | 项目经理 | 协调成员撰写和审校，汇总交付文件及未解决事项，交付后提交人类确认。不要虚构执行结果。 |
| 资料分析师 | 普通员工 | 阅读给定材料，区分事实、推断和缺失信息，把可用素材交给编辑；不虚构来源。 |
| 内容编辑 | 普通员工 | 根据素材撰写发布说明并交付实际 Markdown 文件，不添加材料没有提供的结论。 |
| 独立审校 | 普通员工 | 对照素材检查文档中的虚构、遗漏和歧义，将问题和修改建议写入审校文件。 |

任务必须且只能包含一位可用项目经理。第一次不必创建角色、团队或导入插件；这些可以在流程熟悉后添加。

### 用自带素材创建任务

打开「任务中心 → 新建任务」，标题填写「整理产品发布说明」，粘贴以下内容：

```text
请将以下产品素材整理成中文发布说明，并进行独立审校。

原始素材：一款本地 Markdown 笔记工具，支持全文搜索、双向链接、
Markdown 导出。仅提供 macOS 测试版，价格尚未确定。

交付 release-note.md：产品简介、已有功能、支持平台和限制。
交付 review.md：逐项核对素材，记录问题、修改建议和未验证项。

只使用给定事实，不虚构定价、用户量、性能或用户评价。
缺失信息明确标注，不必访问外部网站。将文件写入任务工作目录，
完成后交给我检查。
```

加入经理、资料分析师、编辑和审校，流程使用默认协作。暂不调用模型时点击「保存草稿」，准备开始时选择「保存并开始」。

![Beta 任务创建界面：示例素材与成员选择](https://github.com/dengdai68/AgentForge/releases/download/v0.1.6-beta.1/agentforge-task-preview-20261107.png)

这张图展示输入方式，不是任务已经执行成功的证据。截图版本为 v0.1.6-beta.1。

### 检查过程和实际文件

运行后在协作记录查看员工交接，需要时回答澄清；从「本轮控制台」查看相应执行记录。在工作目录打开 `release-note.md` 和 `review.md`，逐项对照素材。

检查价格是否仍标注为“尚未确定”，有没有新增虚构功能，审校记录有没有指出未验证项。文件缺失或内容不符合要求时，把具体问题反馈给经理；发生执行错误时先查失败员工控制台，处理原因后从原员工重试。普通任务最终要在客户端由人显式确认。

多员工可以分离职责，也会增加调用量。质量、费用和耗时取决于模型与任务，不保证固定轮数或一次完成。配置与任务记录保存在本机，但模型和远程工具调用仍可能发送任务内容；员工以当前系统用户权限执行，应用不提供 Agent 沙箱或多租户隔离。

如果第一轮顺利，再考虑复用团队、导入工具或配置自动化。先把“任务输入、实际文件、人工检查”走通，更容易判断这些功能是否适合自己的工作。

[项目仓库](https://github.com/dengdai68/AgentForge) · [完整上手指南与排错](https://github.com/dengdai68/AgentForge/blob/main/docs/quickstart.md) · [问题反馈](https://github.com/dengdai68/AgentForge/issues)

---

## 发布顺序与反馈记录

1. 先确认 GitHub 首页的图片、教程和下载链接可访问，Description、Topics 已生效；核对帖子里的版本仍可下载。
2. 用项目作者的账号发布 V2EX 成稿，发布后记录真实 URL，及时回答安装、模型授权和首次任务问题。
3. 根据首批问题调整教程，再用作者账号发布掘金文章；不跨多个节点重复投放同一内容。
4. 首周记录两个帖子的真实链接、阅读/评论及反馈；GitHub 自带 Traffic 可辅助观察访问和克隆变化，不把 Star 增长直接等同于实际使用或推广归因。
5. 只根据实际收到的安装失败、授权困难、首次任务问题决定后续改进；没有反馈时不编造用户案例、评价或转化率。

| 渠道 | 状态 | 发布链接 | 发布后记录 |
| --- | --- | --- | --- |
| V2EX 分享创造 | 待发布 | — | 评论、首次体验卡点 |
| 掘金教程 | 待发布 | — | 阅读、收藏、操作问题 |

没有发布账号或用户未确认成稿时，保留待发布状态，不把准备素材描述成已经推广成功。
