# 认证与登录态

二进制写入唯一例外为认证 POST `/api/communications/chat_<ID>/attachments` 的 `application/octet-stream`，仍要求精确 Host、同源 Origin 和管理员会话，单文件最多 20 MiB；其他写路由不接受该类型。下载、控制台、执行正文与提示词仍先校验资源归属，再验证文件完整性，不允许匿名或跨域上传。

## 实例

客户端首次启动在应用内设置管理员，没有默认密码或公开注册。服务要求客户端 IPC 与一次性 bootstrap 信息；不提供终端管理员初始化。

HTTP 页面、API、静态脚本、SSE 与文件预览经过统一认证。公开入口限登录资源、健康检查和受限的首次设置状态。

## 持久会话

密码使用 scrypt 加盐摘要，随机会话 token 仅保存 SHA-256 摘要。新会话默认不因时间过期，API 的 `expiresAt=null`。浏览器使用 HttpOnly、SameSite=Strict 持久 Cookie，400 天并随认证请求续存。退出或重置账户撤销会话。清除当前工作目录保留账号和有效会话。

CLI 默认使用客户端宿主发布的正式委托授权；客户端未登录时可保存独立私有会话，不读取浏览器存储或 SQLite，不保存密码。共享授权随客户端退出而撤销，具体机制见下文。

## HTTP 边界

写请求要求精确同源 Origin 与 JSON。服务只监听 127.0.0.1 随机端口，仅接受实际绑定的 origin；不读取公开域名、HOST 或 PORT 部署配置。登录限流持久化，不信任代理转发的客户端 IP。

SSE 在事件和心跳时检查会话。退出登录不等于终止任务。

## 首次设置与重置

Electron 自有子服务尚无管理员时，主进程以一次性私有 bootstrap token 换取短时 setup 会话；token 不写 URL、页面、日志或 Provider 环境。已有管理员不能重复使用该入口。

数据清除要求当前密码和准确确认文字；删除整个当前工作目录（包括其中用户文件），保留配置目录、账号和登录、Runtime、插件/MCP、Git 凭据及日志。工作目录外的旧任务文件和外部项目不扩展删除；不返回管理员首次设置。详见 docs/30-storage-layout.md。

主要接口：`GET /api/auth/session`、`POST /api/auth/login`、`POST /api/auth/logout`。配置路径见 [Electron](18-electron-client.md) 和 [CLI](21-configuration-cli.md)。

## 客户端授权供 CLI 使用

客户端宿主经 Electron 正式 Cookie API 获取自身登录会话，向认证的 `POST /api/auth/cli-session` 申请独立、关联父会话的委托 token；不把浏览器 Cookie 直接交给 CLI。服务仅在父会话仍有效时接受委托 token，父会话退出、账户重置或服务重启即失效。宿主在当前实例目录发布 0600 的 `desktop-cli-session.json`（目录0700），绑定 origin 与 instanceId；不进入 renderer、日志或 Provider。续存同一父会话复用委托，避免刷新使正在使用的 CLI 失效。

CLI 先验证私有 endpoint 和实例身份，再读取同目录的专用共享凭证；有有效客户端授权时优先使用，没有时使用自己的私有登录会话。显式 `--session-file` 隔离使用独立 CLI 会话。CLI 不读取 Chromium 存储或 SQLite。CLI logout 只撤销自己的独立会话，不能注销共享客户端会话；客户端授权由客户端退出登录管理。此能力不扩大权限，仍为本机同用户、单管理员。

任务附件二进制例外仅适用于 POST /api/runs/run_…/attachments（与沟通附件一致）；仍强制管理员会话、精确 Origin/Host，其他写接口继续要求 JSON。下载与图片预览同样鉴权，禁止活动 HTML/SVG 作为内联图片执行。
