# 表单浮层与 v0.1.3 正式发行

## 目标与范围

修复新建沟通自动展开候选、底部选人被弹框裁剪、拖动文本框导致弹窗偏移及误关，以及会话头像缺少员工身份颜色的问题。基线为 `178f793`，只改 renderer 交互、共享样式、验证与发行版本；不改变 Store、API、CLI 输入输出、提示词或 Runtime 执行协议。

## 实现

- 新建/编辑沟通的关闭按钮位于底部主按钮左侧。初始焦点放在关闭按钮，选人仅在用户进入输入框后展开。
- 新增已注册的 `web/floating-list.mjs`，复用浏览器 manual Popover 顶层；列表仍在原组件 DOM 中，按视口剩余空间向下或向上定位，不受父容器滚动裁剪。保留四像素连续鼠标通道，随滚动/缩放/尺寸变化重定位，关闭时释放观察器及监听器。
- 员工/角色/插件/MCP/团队/任务多选、Runtime 模型和任务/群聊 @ 候选共用浮层定位。原生 select 继续由浏览器处理。
- 含表单的共享弹窗采用稳定顶部和内部滚动；背景点击及 Escape 不关闭，仅显式关闭、取消或成功提交后退出。只读详情和确认弹窗保留原有关闭行为。
- 会话头像增至 38px，可显示两个字符；私聊复用员工头像及颜色，群聊按会话 ID 使用既有身份色板。选中会话不覆盖头像身份颜色。

## 源码验证

以下均为隔离 HOME/数据目录中的 Electron 界面测试，不使用或改造操作者实例。

| 命令 | 结果与证据目录 |
| --- | --- |
| `node --test tests/settings.test.mjs tests/communication.test.mjs` | 90/90 通过；首次 VM 夹具缺少新导入的关闭函数，修复夹具后复跑通过 |
| `node scripts/test-task-creation.mjs` | 通过；`.data/task-creation-NHWC0A`，两主题及 1320×1000、760×760、800×560，原生鼠标拖动、草稿保留、上下翻转、真实选择与 HTTP/CLI 回读 |
| `node scripts/test-runtime-settings.mjs` | 通过；`.data/runtime-settings-5yKnpf`，模型六项、鼠标跨间隙、原生思考等级、两个主题宽窄布局及 CLI 登录授权回归 |
| `node scripts/test-communication-workbench.mjs` | 通过；`.data/communication-workbench-58F06u`，关闭按钮、无初始下拉、头像颜色、私聊/群聊及个人控制台回归 |

## 发行与限制

版本升级为 `0.1.3`，合入此前 Beta 1–3 及已提交的独立任务成员、独立群聊与 Runtime 恢复结算修复。当前协议及废弃输入见 CHANGELOG 和 CLI 文档；不自动重置真实数据，不承诺旧配置迁移。

本次沿用仓库已支持的本机 ad-hoc 正式发行路径，未进行 Developer ID 签名或 Apple 公证，仅声明下载校验后的手动安装；签名 CI 门禁不变。DMG、ZIP、两份 blockmap、latest-mac.yml 与 SHA256SUMS.txt 必须来自同一最终构建。

本轮界面检查使用受控执行夹具，不声称新增真实模型全流程验证；本轮没有执行协议变更。CLI 能力未变化，真实命令回归仍覆盖共享认证、配置引用和任务输入校验。操作者当前已安装客户端及其未保存表单未被关闭或替换。

## 最终安装包验证

本机验收候选输出：`/private/tmp/af-stable-v0.1.3-final-20261103`。首轮构建后又补全浮层的外部点击/焦点关闭及关闭回调，因此重新完整构建。Electron Builder 会从包内 package.json 移除 build/devDependencies，版本与生产依赖已另外核对一致。

| 命令（APP 为最终目录中的 mac-arm64/AgentForge.app） | 结果与证据 |
| --- | --- |
| `AGENTFORGE_TASK_CREATION_APP=… node scripts/test-task-creation.mjs` | 通过；`.data/task-creation-x0kiVM`，含关闭仍展开候选的所属弹框后无残留浮层 |
| `AGENTFORGE_COMMUNICATION_APP=… node scripts/test-communication-workbench.mjs` | 通过；`.data/communication-workbench-VNrQoN` |
| `AGENTFORGE_SETTINGS_APP=… node scripts/test-runtime-settings.mjs` | 通过；`.data/runtime-settings-72Bi9X`，含包内 CLI 自动安装和新 shell 共享授权 |
| `AGENTFORGE_PACKAGED_APP=… npm run package:mac:check` | 通过；`.data/packaged-electron-e2e-QrONVG`，资源哈希、签名完整性/篡改拒绝、插件 YAML 三 Runtime 投影、隔离登录/CLI/任务/重启及慢 shell 退出 |

已查看最终包的团队底部下拉截图：560px 高窗口向上展开、视口内可点；源码与包内所有本轮运行文件哈希一致。ASAR 根仅包含许可证、应用源码及依赖，不包含 `.data`、`.git`、`.codex`、测试或诊断资料。更新元数据中的两份安装包大小和 SHA-512 与最终附件一致；SHA256SUMS.txt 同时覆盖 DMG、ZIP、两份 blockmap 和 latest-mac.yml。

`node --check` 已覆盖规定的 index/store/orchestrator/app 及本轮新增/修改的 renderer 模块，`git diff --check` 通过。首次完整测试 615/616 通过：旧样式断言将表单的视口高度限制也误作普通弹窗规则，已缩小到普通弹窗的基础样式；表单边界由实际 UI 验收负责。原失败日志为 `/private/tmp/af-v0.1.3-commit.log`。提交钩子强制复跑 `npm test`、`check:ai` 和 `check:impact -- --staged`，通过后才生成发行源码提交，最终日志为 `/private/tmp/af-v0.1.3-commit-final.log`。提交格式另经 `check:commit` 验证。

正式发布地址：[v0.1.3](https://github.com/dengdai68/AgentForge-App/releases/tag/v0.1.3)。发布流程为主分支提交、同名标签、草稿上传完整六个附件并核对远程大小/摘要，再公开为非预发布 latest；发布后的应用更新检测及下载校验使用隔离缓存验证，不操作当前安装实例。

## 上传网络回退

冻结源码为 `0d3d1b6`，本机完整门禁最终 616/616 通过。主分支及 v0.1.3 标签已推送，但本机上传两个大安装包持续连接重置，只有四个小附件成功，草稿没有公开。多次传输均保留具体日志，不将 starter 文件当作已完成附件。

为完成远程交付，现有 ad-hoc 工作流增加仅上传已有草稿模式；CI 按相同的 v0.1.3 冻结源码重新构建并执行既有单元/契约/安装包验收，再用同次构建的完整附件替换草稿中的候选。最终远程摘要以 CI 安装包及其清单为准，本机候选不与之混用。该工具改动不移动标签、不修改任何运行代码，不改变正式 Developer ID/公证门禁，公开前仍需核对远程附件和更新检测。
