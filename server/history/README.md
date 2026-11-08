# 历史查询

Bridge 的 env 是历史 MCP 自己的启动环境，Codex 必须全部转发；打包版的 ELECTRON_RUN_AS_NODE 不得遗漏，也不能泄漏到 Provider 环境。required=true 将历史初始化失败交回原有执行错误链。提示词里的能力说明不是工具就绪证据，验收必须实际调用。

Bridge 仅保留简短的历史核对行为规则；工具名、连接说明和分页参数不再重复注入应用系统指令，而由 MCP tools/list 的描述/schema 及服务 instructions 提供。原生注册后回调保存平台脱敏分层快照，不包含 Provider 自动生成的技能目录和工具定义。历史不重放，需要过去资料时按需查询。

`index.mjs` 提供 Store 历史投影和派生 SQLite 索引；`bridge.mjs` 管理调用级 socket/config；`mcp.mjs` 适配 stdio MCP。

当前全部数字员工可查询平台保存的历史，身份用于调用归属。查询只读，索引可重建，Store 是权威。分页先筛选紧凑元数据，再加载有限正文；协调仍包含内存扫描。

Artifact 按冻结信息验证。派发提示词快照及私有凭据不进入历史工具。临时目录 0700、配置 0600，调用结束清理；强杀可能留下无监听者的临时文件。

契约和范围见 [历史查询](../../docs/19-agent-history.md)。

索引不再投影独立问题清单集合；历史问题与处理反馈通过原有任务 Message/Trace 读取，不合成历史发言或改写权威记录。

新增只读 list_employees(query/status/page/limit) 与 read_employee(agentId)，共十个工具。详情复用 Store 员工配置并附角色；身份由服务绑定，不提供配置写入或登录凭据。

索引同步读取主库提交水位与变化 ID，不在每次工具查询遍历历史。主库正文按需加载，read_trace 使用位置/高水位分页；首次建索引与后续增量成本分别记录。所有已知员工按当前平台历史可见规则查询，入口验证身份，不维护记录与全部员工的笛卡尔关联。索引水位提交失败可重试，不推进主库或抹掉冻结记录。

withHistoryTools 对尚未映射 MCP 的 portable Runtime 仅调用 onPrompt 和原生执行，不伪造历史工具能力或创建不可达桥；既有三项历史 MCP 行为及身份边界不变。

Portable Runtime 的提示词快照由适配器在原生配置与实际指令合成后保存一次；桥仅转发调用，不提前生成第二个快照。历史 MCP 仍不向这些 Runtime 宣告。

九种 Runtime 共用同一个私有历史 MCP 桥；portable 适配器完成原生配置后发布一次提示词快照，历史桥不提前重复保存。
