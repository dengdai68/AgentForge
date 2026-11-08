// Pure shared projection. Store owns validation; layout never becomes an AI instruction.
export function workflowConnections(workflow = {}) {
  if (Array.isArray(workflow.edges)) return workflow.edges.map(edge => ({ ...edge }));
  const pairs = new Map();
  for (const node of workflow.nodes || []) for (const [field, flag] of [['dependsOn', 'dependency'], ['handoffFrom', 'handoff']]) {
    for (const source of node[field] || []) {
      const key = JSON.stringify([source, node.id]);
      if (!pairs.has(key)) pairs.set(key, { id: `link_${pairs.size + 1}`, source, target: node.id, condition: '', description: '', dependency: false, handoff: false });
      pairs.get(key)[flag] = true;
    }
  }
  return [...pairs.values()];
}

export function workflowDescription(workflow = {}) {
  const title = value => String(value || '').replace(/[\r\n]+/g, ' ');
  const nodes = workflow.nodes || [], names = new Map(nodes.map(node => [node.id, title(node.title)]));
  const lines = [`# 工作流：${title(workflow.name)}`, '', '本文件是本次任务冻结的工作流说明。由项目经理结合实际状态选择员工、推进交接；连线文字是协作要求，不是自动执行的代码条件。'];
  if (workflow.description?.trim()) lines.push('', '## 总体说明', '', workflow.description.trim());
  lines.push('', '## 节点');
  for (const node of nodes) {
    lines.push('', `### ${title(node.id)} · ${title(node.title)}`);
    lines.push('', `节点类型：${node.type === 'condition' ? '条件节点；根据实际证据判断，选择满足条件的一条出线继续；条件不明时先澄清，不同时执行互斥分支。' : '流程节点；完成说明中的工作后按连线交接。'}`);
    if (node.description?.trim()) lines.push('', node.description.trim());
    if (node.staffingGuidance?.trim()) lines.push('', '人员需求：', node.staffingGuidance.trim());
    if (node.deliverable?.trim()) lines.push('', '交付要求：', node.deliverable.trim());
    if (node.artifactPaths?.length) lines.push('', '建议交付位置：', ...node.artifactPaths.map(path => `- ${path}`));
  }
  lines.push('', '## 连线与交接');
  const edges = workflowConnections(workflow);
  if (!edges.length) lines.push('', '未指定交接关系；项目经理根据任务目标和节点说明安排。');
  for (const edge of edges) {
    lines.push('', `### ${title(edge.source)}（${names.get(edge.source) || ''}） → ${title(edge.target)}（${names.get(edge.target) || ''}）`);
    if (edge.condition?.trim()) lines.push('', '分支条件：', edge.condition.trim());
    if (edge.dependency) lines.push('', '前置依赖：后者以前者为前置节点。');
    if (edge.handoff) lines.push('', '交接来源：后者应读取前者的相关交接。');
    if (edge.description?.trim()) lines.push('', edge.description.trim());
  }
  return lines.join('\n') + '\n';
}
