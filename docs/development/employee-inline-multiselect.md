# 员工框内多选

目标与范围：将角色、插件、MCP 的已选标签统一放入输入框内部，移除角色上下箭头、序号和优先级说明。只改 renderer 的选择与呈现，HTTP/CLI 绑定数组、服务端校验、角色提示词注入和冻结历史不变；无需重跑模型业务流程，不自动发布 Release。

实现：web/marketplace.mjs 导出共用 createEmployeeMultiSelect；app.js 使用同一个选择器绑定角色，插件/MCP 保留各自的兼容校验和目录读取。标签与搜索在一个边框内，删除按钮可键盘访问，长名称/多项换行，同名角色候选显示 ID，已选标签保留 ID 提示。统一焦点/方向键/Enter/Escape/Tab、移除后焦点归还及4px候选间隙悬停区域。空值只显示框内占位，不新增框下已选区。

验证：

- 实际只读检查本机原表单，确认角色排序与插件/MCP 框外标签现状；未修改真实员工。
- npm test：599 pass / 0 fail；规定 AI/影响门禁、四个 node --check 及 git diff --check 通过。CLI 没有字段或语义变化；复用实际认证 CLI 数组写入/清空回归。
- node scripts/test-roles-ui.mjs：三控件各选2项，在 minimal/warm、1320/760 宽度核对标签全部位于边框内、无框外已选区、三者边框/背景/圆角一致，内层输入无第二道边框或阴影。验证角色无排序按钮/编号，添加/移除、重新打开、键盘 Escape、同名 ID 区分、4px间隙鼠标穿越，以及新建员工的三类绑定实际保存成功。证据隔离检出 .data/roles-ui-MrX6hL。
- 打包版同一验收通过：AGENTFORGE_ROLES_APP 指向 .data/inline-multiselect-build/mac-arm64/AgentForge.app；证据隔离检出 .data/roles-ui-me6NXl。源码最终截图另见 .data/roles-ui-6dapPJ。
- 首轮测试暴露下拉间隙悬停区域不连续；增加共同的透明悬停桥后通过。截图检查还发现宿主主题覆盖导致内部搜索再次出现边框，按员工控件范围明确覆盖并增加 computed style 断言后通过。

限制：此轮仅统一员工表单多选界面；既有角色数组仍按保存值进入系统指令，界面不将其表现为可配置优先级。未改变模型或兼容执行机制。测试全部为隔离数据，不触发所选 MCP/插件业务工具。
