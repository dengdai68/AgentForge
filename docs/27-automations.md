# 自动化

自动化是定时生成独立 Task/Run 的配置，不是普通任务。任务中心查询、bootstrap、通知仅包含普通任务；自动化触发记录通过分页接口访问，详情复用现有任务工作区。

## 配置与查询

名称 title、目标 objective、memberAgentIds/teamIds、workflowTemplateId、acceptanceCriteria 与普通任务共用验证，附加 cron（五段、数字及 * , - /）、timeZone（IANA）、enabled。团队在保存时展开成员，执行时冻结最新员工/工作流；历史保存配置版本及执行快照。优先级废弃，所有入口明确拒绝。

GET/POST /api/automations；GET/PUT/DELETE /api/automations/:id；GET /api/automations/:id/triggers；POST /api/automations/:id/trigger；POST /api/automations/preview。列表支持 search、status、page、pageSize，返回 items/total/page/pageSize/totalPages；触发按时间倒序，默认20条。删除仅允许无历史的配置，有历史请停用。

## 调度与完成

10秒检测，只同步领取到期记录并异步执行；同一计划时刻幂等。每个自动化最多一轮活跃执行（含暂停），重叠时记 skipped；离线错过不补跑。手动立即执行不改变计划时间。禁用不终止已运行任务。

实际创建下一轮前，在同一 Store 事务验证配置与 Runtime、创建新 Task/Run，并自动确认所有已无活动执行/待投递的待验收前轮。确认记录 actor=system、时间和下一触发ID，不生成协作消息。不确认错误、暂停、取消或执行中的记录；新配置失效或触发跳过时不确认。调度启动后的模型错误保留新轮失败，前轮确认不回滚。

自动化参与者只有经理和员工；提示词与领域命令拒绝向人类澄清、交接或人类消息。缺失事实先查资料或咨询经理，无法完成应明确失败，不编造。经理交付后仍为 awaiting_acceptance；操作者可提前确认。普通任务的人类角色、澄清、验收和原员工重试不变。

## 交互

左侧自动化入口；列表搜索/状态/分页。新建与编辑复用任务创建弹窗，内容优先，验收标准折叠，成员/工作流选择，调度预览五次；按钮取消、保存为停用、创建并启用。配置保存失败保留草稿，防重复提交。触发列表返回保留分页；详情保留协作、文件/CHANGE、控制台、任务详情及执行操作，自动化隐藏人类输入和筛选。

## 架构决策

采用固定版本 [cron-parser 5.4.0](https://github.com/harrisiirak/cron-parser) 计算时区、DST 和下一时间，不自行实现日期算法；仅开放五段数字 Cron，拒绝秒、宏、随机值及扩展语法。Store 拥有配置/触发与原子确认；独立 scheduler 不直接修改状态、不等待模型。SQLite 继续存元数据，不引入后台服务。离线策略以超过一分钟的未处理时刻视为错过，记录一次跳过并从当前时间计算下一时刻，避免睡眠恢复时洪泛补跑。

普通任务旧 priority 输入已废弃，调用方须删除字段；不重置实例、不重写历史冻结事实。

界面中的计划/触发时间按当前自动化所选时区显示；元数据保存 UTC 时间点，历史配置仍保留当时的时区与 Cron。
