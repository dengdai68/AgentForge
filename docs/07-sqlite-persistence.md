# SQLite

业务元数据由 `server/persistence.mjs` 保存到 SQLite，Store 是领域写入入口。文件快照、提示词和执行正文由 Run Files 保存，不把大块文件内容写入业务状态。

认证使用独立数据库，保存密码摘要、会话摘要与登录限流。Runtime 私有配置独立存储，不进入公开目录读模型。

默认数据位于 `~/.agentforge/<实例>/`。测试使用临时目录。发布包不包含数据库、用户配置或凭据。

当前面向单机单管理员。没有分布式队列、多租户数据库或多节点写入协议。

extension_catalog 为独立元数据表（id/kind/name/search_text/created_at/deleted_at/value_json），kind/deleted_at/created_at/ID 索引服务目录查询。Store 状态中的 extensionCatalog 在 load 时读取，save 时从主快照剥离并增量写行，与员工变更、事件和主快照共用一个 SQLite 事务，回滚不推进缓存。列表通过参数化 SQL 过滤/分页，不访问 Runtime 文件。完整插件/MCP 配置继续保存在私有文件。
