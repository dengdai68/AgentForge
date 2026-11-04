---
name: agentforge-release
description: 为 AgentForge App 打包并发布 GitHub Release，按仓库约定递增正式版或 Beta 版本，生成简洁中文发布说明并核验附件。用户要求打包发布、发布测试版或正式版时使用；只安装到本机不等于发布。
---

# AgentForge GitHub 发布

在仓库根目录执行。贡献规则见 `AGENTS.md`，构建入口见 `package.json`、`CONTRIBUTING.md`，附件与签名契约见 `docs/24-desktop-updates.md`。本 skill 定义发布操作流程；新增或修改 skill 本身不表示要实际发布。

## 版本与渠道

- “发布”指发布到 `dengdai68/AgentForge` 的 GitHub Releases，不以本机打包、安装或推送代码代替发布成功。
- 未明确要求正式版时，一律发布测试版：`v主.次.补丁-beta.N`，例如 `v0.1.3-beta.1`。同一目标版本每次新的打包发布只将 beta 序号加 1；首个为 1。
- 正式版严格为三段：`v主.次.补丁`，例如 `v0.1.3`。无特殊版本要求时，相对最新正式版只将补丁号加 1；主、次版本不变。对应 Beta 晋升正式时移除后缀，不再额外递增一次。
- 默认新周期从最新正式版的下一补丁版开始；已有该周期 Beta 时继续其序号。例如正式版 `v0.1.3` 后依次为 `v0.1.4-beta.1`、`v0.1.4-beta.2`，明确要求正式版时为 `v0.1.4`。用户指定版本时优先遵循指定值。
- 发布前查 GitHub Releases（包括草稿和预发布）、远端标签及 package/lock 版本，按数字比较版本，不能凭本地文件或列表第一项猜版本。已占用版本不复用；同次失败上传的恢复沿用原版本与原构建，不因重试增加序号、不覆盖已公开版本。
- package.json 与 package-lock.json 的应用版本使用不带 `v` 的相同版本。更新版本用 `npm version VERSION --no-git-tag-version` 或等价定向编辑，避免 npm 隐式创建提交/tag。

## 源码、构建与标签

1. 检查 Git 状态和待发布变更，保留无关修改；按 AGENTS 完成对应验证与提交，记录精确源码 SHA，并推送必要的源码提交。只把本次版本新增和修改内容纳入发布说明。
2. 使用现有构建命令，隔离构建输出，确保版本、源码 SHA 和安装包一致。按发布契约验证安装包、签名实际状态、校验清单及更新元数据；不得把旧输出或私有数据混入附件。签名是否公证必须如实报告给用户，不能冒充已公证。
3. **只有正式版显式创建和推送代码 tag**：`vVERSION` 必须指向通过验证的发布提交，禁止移动或覆盖已有 tag。测试版不执行 `git tag` 或 `git push --tags`，也不使用要求预先存在标签的 Beta 工作流。
4. GitHub Release 必须关联 Git 标签，无法做到“有 Release 而完全没有标签”。测试版通过 `gh release create` 的 `--target FULL_COMMIT_SHA` 让 GitHub 创建必要的关联标签，不额外手动打代码 tag；不得声称远端没有 Beta 标签。若用户明确要求远端也完全无标签，应说明此平台限制，不擅自用正式版或其他发布渠道替代。
5. 当前 `.github/workflows/release-macos-beta.yml` 要求预先存在 tag，两个发布工作流还包含旧标题/自动说明。不能直接运行它们并保留旧格式。默认用已验证的本机产物与 `gh release` 发布；需要 CI 时先把相应入口调整为本 skill 的源码定位、标题和说明要求，再执行，不降低现有签名门禁。

## Release 标题与说明

标题严格等于版本号（带 `v`），如 `v0.1.4-beta.2` 或 `v0.1.4`。不加 AgentForge、平台名、日期或其他文字。

说明只列本次版本增加、修改和修复的内容，每项一句中文。Beta 相对上次同周期 Beta；首个 Beta 相对上次正式版；正式版汇总相对上次正式版的改动。以实际提交与 CHANGELOG 为证据，不直接粘贴全部 Unreleased。不要增加标题、前言、构建信息、测试报告、提交列表、下载教程或自动生成的 GitHub notes。

最后一段固定为：

注：如果提示 Apple 无法验证，请使用 `sudo xattr -d com.apple.quarantine "/Applications/AgentForge.app"` 暂时忽略。

该命令仅作为用户要求的说明文字，不在发布过程中对本机应用执行。

将完整说明写入临时 UTF-8 文件，通过 `--notes-file` 传入，不用 `--generate-notes` 或 `--notes-from-tag`。格式示例：

```markdown
- 新增任务按工作流筛选。
- 修复员工重试时没有继续原会话的问题。

注：如果提示 Apple 无法验证，请使用 `sudo xattr -d com.apple.quarantine "/Applications/AgentForge.app"` 暂时忽略。
```

## 上传与核验

- 先上传草稿和同次构建的附件：DMG、ZIP、相应更新元数据、生成的 blockmap 和 SHA256SUMS.txt；具体文件遵循 docs/24。指定明确文件列表，避免混入其他版本。
- 测试版创建使用 `--target FULL_COMMIT_SHA --prerelease --latest=false --title VERSION --notes-file NOTES_FILE`；不加 `--verify-tag`。正式版使用已推送标签、`--verify-tag --latest --title VERSION --notes-file NOTES_FILE`。
- 附件全部上传并验证后再公开草稿。公开时测试版仍为 prerelease 且非 latest，正式版为非 prerelease 且 latest；确认标题和正文未被工作流覆盖。
- 上传失败先核对草稿和已上传附件，只补同次构建缺失的内容；不盲目重复创建 Release，不删除已公开 Release 或移动标签。不完整的发布保留草稿并如实说明阻塞。
- 最后读取 GitHub Release，核对版本、目标提交、标题、正文、渠道、附件名称与大小/校验信息，确认非草稿且附件可下载。交付版本号与 Release 链接；不要仅凭命令退出码宣称发布完成。
