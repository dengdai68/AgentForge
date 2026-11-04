# Contributing

本仓库是 AgentForge 客户端的独立源码，默认 `npm start` 启动 Electron。`web/` 和 `server/` 均是应用的本机组成部分；不要求检出 AgentForge 原仓库。抽取边界见 [docs/23](docs/23-desktop-extraction.md)。测试与包构建使用隔离数据，不覆盖现有安装。

先阅读 [AGENTS.md](AGENTS.md)、[代码导航](docs/00-ai-map.md) 和目标模块的 README。

## 安装与本机运行

从 [GitHub Releases](https://github.com/dengdai68/AgentForge/releases) 下载 DMG，将 AgentForge 拖入 Applications。当前安装包面向 macOS 13+ / Apple Silicon，采用 ad-hoc 签名，尚未经过 Apple 公证。应用内首次创建管理员，并在设置中配置 Runtime 和工作目录。Claude Code、Codex 或 DeepSeek Harness 需在本机安装并完成各自授权；应用自带本机服务，无需部署服务器。

源码开发需要 Node.js 22.12+（推荐 Node 24）、npm 和 Git：

```bash
git clone https://github.com/dengdai68/AgentForge.git
cd AgentForge
npm ci
npm start
```

`npm start` / `npm run dev` 启动 Electron 及其自有随机端口子服务，不复用 4310，也不提供独立 Web 部署。安装版数据位于 `~/.agentforge/desktop/`，开发版位于 `~/.agentforge/desktop-dev/`；任务工作目录默认 `~/agentforge`。仓库改名不改变应用身份与数据位置。数字员工以当前本机用户权限执行，Runtime bypass 不是沙箱；当前为本机单管理员应用。

安装版启动时提供用户级 `agentforge` 命令，可在「设置 → 命令行 CLI」查看及修复；源码入口为 `npm run cli -- help`。CLI 连接运行中的客户端并复用当前登录授权，完整指南见 [docs/21](docs/21-configuration-cli.md)。

## 开发流程

1. 确认问题、影响范围和现有测试。
2. 实现改动，同步相关文档与 `ai/module-registry.json`。
3. 运行 `npm test`、`npm run check:ai`、`npm run check:impact` 和 `git diff --check`。
4. UI 改动检查宽窄窗口；API/CLI 改动验证受影响的入口。涉及执行行为时，用隔离数据验证真实流程。
5. 提交 PR，说明行为变化、验证结果及已知限制。

客户端 renderer、Electron、CLI 共享 HTTP 和领域语义。已被 CLI 覆盖的功能变更须同时更新命令、帮助、schema、输出与测试。

测试使用临时目录，不能清理操作者数据、外部项目或全局 CLI 凭据。开发阶段不承诺旧协议兼容；破坏性变更须明确说明，不能自动重置真实实例。

## 提交格式

```text
<type>(<scope>): <summary>

Intent:
Changes:
Verification:
Risks:
History:
```

提交前执行 `npm run check:commit -- <消息文件>`。类型包括 `feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`chore`、`arch`、`security`。

## 发布

发布操作使用 [agentforge-release](.codex/skills/agentforge-release/SKILL.md)。默认 Beta，正式版仅在明确要求时发布；版本递增、标签操作和 Release 标题/说明遵循该 skill。下述旧 CI 入口不能直接用于新的 Beta 发布，格式差异与替代路径见 skill；签名与附件校验要求继续保留。签名状态在交付报告中说明，Release 正文保持 skill 要求的变更列表与底部注。

版本与锁文件保持一致。macOS 构建使用 `npm run package:mac`，产物位于 `release/`。发布标签与源码提交绑定，上传 DMG、ZIP 和 SHA-256 清单；不得把本机数据或凭据打入安装包。

Release 工作流只在发布成功后删除本次构建输出 ID 对应的 Actions 中转产物；失败时保留最多一天以便重试。正式 Release 附件与 Actions 存储独立，不批量删除其他构建、日志、Git 标签或源码历史。

仓库内 Codex skill 位于 `.codex/skills/agentforge-development/SKILL.md`，用于选择共享界面与验收路径；AGENTS.md 仍为唯一贡献规则入口，设计事实仍由 docs/06 维护。无需安装额外依赖。

正式版发布使用 .github/workflows/release-macos-stable.yml（已批准的 v主.次.补丁 标签，与 package.json 一致）。配置仓库 secrets：MAC_CSC_LINK（Developer ID Application 的p12证书或其base64）、MAC_CSC_KEY_PASSWORD、MAC_CSC_NAME（完整Developer ID Application证书名称）、APPLE_ID、APPLE_APP_SPECIFIC_PASSWORD、APPLE_TEAM_ID；同一应用后续签名保持Apple Team一致。工作流验证签名/公证后上传DMG、ZIP、latest-mac.yml、blockmap与SHA256SUMS.txt，正式Release设为latest。手动发布也必须上传同次构建的这些文件。默认本机/Beta构建保持ad-hoc；ad-hoc客户端首次升级到Developer ID版本需手动安装，后续才可原生自动更新。不得将证书/私钥/密码或CI临时文件提交入库。

经操作者明确授权，也可在本机验证后手动发布 ad-hoc 正式 Release（例如 v0.1.1）。必须在交付报告中明确声明未做 Developer ID 签名/公证、仅支持已校验安装包手动安装；不得声称原生自动替换通过。保持非预发布稳定标签、源码提交、同次构建附件及更新元数据一致。签名 CI 工作流的证书门禁保持不变。

本机网络无法上传大文件时，可调用现有 Beta 构建工作流的 `draft_assets_only=true`：按指定已存在标签构建并验收，将同次构建的六个附件上传到已存在草稿，拒绝替换公开 Release；不自动公开。仍需上述 ad-hoc 授权及工作流确认词。操作者核对摘要、安装方式和说明后再将草稿发布为所需正式版或预发布；正式签名工作流保持独立。
