# 桌面应用更新

## 架构决策

应用更新属于 Electron 宿主生命周期，与 Git 插件更新、Store 领域配置及 CLI 无关。采用现有 electron-builder 对应的 `electron-updater` 6.x 与显式 `semver` 依赖，复用 Squirrel.Mac 的下载校验和签名安装，不自建替换正在运行应用的脚本或系统服务。控制器为 `apps/electron/updates.mjs`，renderer 只调用有限的状态、检查、下载、安装及打开 Release 命令，不提供 URL、文件或进程参数。

## 正式版规则与交互

仅查询公开仓库 `dengdai68/AgentForge-App` 的 GitHub latest Release。不读取本机 GitHub 凭据。draft/prerelease 为 true，或标签不是严格 `v?主.次.补丁` 的版本，均不参与更新；按 SemVer 比较，禁止降级。同版本正式版高于其 Beta，当前 Beta 也只接收正式版。404 表示尚无正式版，网络错误不冒充“已是最新”。

安装版启动约 20 秒后自动检查，运行期间每 6 小时检查；离线失败保留现状，下次周期或用户手动重试。检查不会自动下载或重启。发现更新只在设置 → 更新 → 应用更新区域显示版本信息和更新按钮；不创建通知卡、弹窗或自动跳转。应用菜单“检查更新…”可主动打开该区域，更新 Tab 直接展示应用更新与插件更新两个配置区，不重复“更新”标题；GitHub 文字链接位于当前版本后，不单独展示长地址或“发布说明与下载”按钮。用户点击下载后展示进度，完成后明确提示重启安装或打开安装包。原生安装器关闭自动退出安装，普通退出不会暗中安装。

macOS Developer ID 签名的安装版使用原生自动安装。当前 ad-hoc 安装版可下载并校验相同架构的 DMG，打开后由用户手动安装；不能显示“重启自动安装”。开发源码可手动检查，但不下载安装。没有适配安装包时保留 Release 链接并准确提示。

## 发布契约

正式版标签、package.json 与锁文件版本必须一致，标签不得有预发布后缀。Release 至少上传同次构建的 DMG、ZIP、`latest-mac.yml`、blockmap（如生成）和 `SHA256SUMS.txt`。签名正式发布工作流使用 Developer ID、Apple 公证凭据，签名安装要求相同 Apple Team；私钥仅由 CI secrets 提供，不能进入应用、日志或仓库。

原生更新器固定 latest channel、allowPrerelease=false、allowDowngrade=false，使用选中正式 Release 的固定标签地址，不让后续 Beta 抢占下载。更新元数据版本必须与选中 Release 相同。手动 DMG 下载仅接受本仓库该标签下的固定文件名，流式落入宿主私有更新缓存，按 GitHub asset SHA-256 digest 或同 Release 的校验清单验证大小与内容，成功后原子完成；失败不暴露半成品，不关闭 TLS、签名或 Gatekeeper 校验。

## 重启边界

“重启并安装”首先通过父子私有 IPC 向自有服务申请短期空闲锁。服务在同一事件循环检查任务、沟通、Runtime 测试、插件更新及写操作；繁忙则拒绝。获准后暂时阻止新写入和调度，再调用原生安装器退出。失败释放锁，超时自动释放。服务身份与消息 ID 必须匹配；无法确认空闲时不重启。不替用户暂停、结束或验收任务。

正式版从 GitHub 到签名安装的完整验证需要实际发布及 Developer ID 证书；本地夹具验证不冒充真实远端更新或签名安装通过。首次正式版发布前，真实检查显示尚无正式版；发布后应能从旧 Beta 检测到同版本正式版，并验证真实安装包下载与校验。

参考：[electron-builder 更新](https://www.electron.build/v26/docs/features/auto-update/)、[Electron macOS 签名要求](https://www.electronjs.org/docs/latest/api/auto-updater)。

正式发布渠道与签名等级分开：v0.1.1 经操作者明确授权手动发布为非预发布 Release，沿用 ad-hoc 签名并在 Release 中声明；可检测、下载及校验后手动安装。签名正式发布工作流仍要求完整 Developer ID/公证配置，不会降级签名要求。后续获得证书后通过该工作流发布；首次从 ad-hoc 升级到 Developer ID 版本需手动安装。

下载期间，进度条与百分比同行展示，不再另建下载进度说明框；完成后隐藏进度行并恢复既有安装方式说明。此为 renderer 展示调整，宿主状态、下载安装校验及 CLI/API 协议不变。
