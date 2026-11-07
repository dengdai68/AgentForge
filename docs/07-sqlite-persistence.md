# SQLite

业务元数据由 `server/persistence.mjs` 保存到 SQLite，Store 是领域写入入口。文件快照、提示词和执行正文由 Run Files 保存，不把大块文件内容写入业务状态。

认证使用独立数据库，保存密码摘要、会话摘要与登录限流。Runtime 私有配置独立存储，不进入公开目录读模型。

默认数据位于 `~/.agentforge/<实例>/`。测试使用临时目录。发布包不包含数据库、用户配置或凭据。

当前面向单机单管理员。没有分布式队列、多租户数据库或多节点写入协议。

extension_catalog 为独立元数据表（id/kind/name/search_text/created_at/deleted_at/value_json），kind/deleted_at/created_at/ID 索引服务目录查询。Store 状态中的 extensionCatalog 在 load 时读取，save 时从主快照剥离并增量写行，与员工变更、事件和主快照共用一个 SQLite 事务，回滚不推进缓存。列表通过参数化 SQL 过滤/分页，不访问 Runtime 文件。完整插件/MCP 配置继续保存在私有文件。

## 实体持久化和历史读取

`workspace_snapshots` 仅保存小型标量/设置；带 ID 的领域集合存 `workspace_entities(collection,id,position,value_json)`，事件与扩展沿用独立表。实体变更日志提供脏 ID/集合替换标记，增量写入与 `workspace_revision/workspace_changes` 同一事务；无变化事务不落盘。失败不推进持久缓存/水位，并由 Store 回滚内存逆操作。启动按 ID/位置建立稀疏集合，历史正文按需读取，干净强引用每集合最多 256 项；当前目录仍可按需查询完整详情。

集合尚未落入实体/事件表时，脏日志不能代表完整基线：首次保存必须全量物化该集合（包括空集合），再在同一事务移除快照内对应数组。干净日志和仅部分实体改动都不得跳过初始化；失败时保留原快照及未初始化标记，提交后才进入增量模式。这是当前领域数据的存储表示转换，不改写配置协议或冻结事实。

目录、自动化及触发记录在 SQL 内过滤、计数、分页，最后展开当前页对象。事件时间与错误索引用于全局日志 keyset；Run/成员/Trace/状态/会话索引用于控制台、未读与巡检。历史工具索引另存可丢弃派生库，以持久水位补齐变化。显式全快照仍用于隔离测试/内部检查，不进入 App/CLI 常规刷新路径。设计取舍见 [docs/28](28-performance-architecture.md)。
