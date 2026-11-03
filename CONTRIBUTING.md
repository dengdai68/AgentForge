# Contributing

本仓库是 AgentForge 客户端的独立源码，默认 `npm start` 启动 Electron。`web/` 和 `server/` 均是应用的本机组成部分；不要求检出 AgentForge 原仓库。抽取边界见 [docs/23](docs/23-desktop-extraction.md)。测试与包构建使用隔离数据，不覆盖现有安装。

先阅读 [AGENTS.md](AGENTS.md)、[代码导航](docs/00-ai-map.md) 和目标模块的 README。

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

版本与锁文件保持一致。macOS 构建使用 `npm run package:mac`，产物位于 `release/`。发布标签与源码提交绑定，上传 DMG、ZIP 和 SHA-256 清单；不得把本机数据或凭据打入安装包。

Release 工作流只在发布成功后删除本次构建输出 ID 对应的 Actions 中转产物；失败时保留最多一天以便重试。正式 Release 附件与 Actions 存储独立，不批量删除其他构建、日志、Git 标签或源码历史。

仓库内 Codex skill 位于 `.codex/skills/agentforge-development/SKILL.md`，用于选择共享界面与验收路径；AGENTS.md 仍为唯一贡献规则入口，设计事实仍由 docs/06 维护。无需安装额外依赖。

正式版发布使用 .github/workflows/release-macos-stable.yml（已批准的 v主.次.补丁 标签，与 package.json 一致）。配置仓库 secrets：MAC_CSC_LINK（Developer ID Application 的p12证书或其base64）、MAC_CSC_KEY_PASSWORD、MAC_CSC_NAME（完整Developer ID Application证书名称）、APPLE_ID、APPLE_APP_SPECIFIC_PASSWORD、APPLE_TEAM_ID；同一应用后续签名保持Apple Team一致。工作流验证签名/公证后上传DMG、ZIP、latest-mac.yml、blockmap与SHA256SUMS.txt，正式Release设为latest。手动发布也必须上传同次构建的这些文件。默认本机/Beta构建保持ad-hoc；ad-hoc客户端首次升级到Developer ID版本需手动安装，后续才可原生自动更新。不得将证书/私钥/密码或CI临时文件提交入库。

经操作者明确授权，也可在本机验证后手动发布 ad-hoc 正式 Release（例如 v0.1.1）。必须明确声明未做 Developer ID 签名/公证、仅支持已校验安装包手动安装；不得声称原生自动替换通过。保持非预发布稳定标签、源码提交、同次构建附件及更新元数据一致。签名 CI 工作流的证书门禁保持不变。

本机网络无法上传大文件时，可调用现有 Beta 构建工作流的 `draft_assets_only=true`：按指定已存在标签构建并验收，将同次构建的六个附件上传到已存在草稿，拒绝替换公开 Release；不自动公开。仍需上述 ad-hoc 授权及工作流确认词。操作者核对摘要、安装方式和说明后再将草稿发布为所需正式版或预发布；正式签名工作流保持独立。
