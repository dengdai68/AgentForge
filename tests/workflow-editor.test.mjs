import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCatalogFixtureStore} from './fixture-store.mjs';
import {workflowConnections,workflowDescription} from '../client/workflow-description.mjs';
import {createRunFiles} from '../server/run-files.mjs';
import {resources} from '../cli/commands.mjs';
import {validateInput} from '../cli/client.mjs';
import ELK from 'elkjs/lib/elk.bundled.js';
import {workflowRoute,formatWorkflowLayout} from '../web/workflow-layout.mjs';

const definition = () => ({name:'极简协作',description:'完整总体说明\n第二行',nodes:[
  {id:'write',title:'编写',description:'NODE_BODY\n保留完整说明',position:{x:30,y:40}},
  {id:'review',title:'审阅',description:'独立检查'}],
  edges:[{id:'submit',source:'write',target:'review',description:'EDGE_BODY\n检查文件后交接'},
    {id:'rework',source:'review',target:'write',description:'不满足时说明原因并返工'}]});
async function fixture(t) {const root=await mkdtemp(join(tmpdir(),'af-workflow-canvas-'));let store=createCatalogFixtureStore({databasePath:join(root,'store.sqlite'),workspaceRoot:root});t.after(()=>{store.close();return rm(root,{recursive:true,force:true});});return {root,store,reopen:()=>{store.close();store=createCatalogFixtureStore({databasePath:join(root,'store.sqlite'),workspaceRoot:root});return store;}};}

test('process nodes reject extra exits atomically; condition nodes and four-side ports round-trip',async t=>{
 const {store,reopen}=await fixture(t),nodes=[{id:'a',title:'A'},{id:'b',title:'B'},{id:'c',title:'C'}],edges=[{source:'a',target:'b',sourcePort:'top',targetPort:'bottom'},{source:'a',target:'c'}];
 assert.throws(()=>store.createWorkflowTemplate({name:'非法多出口',nodes,edges}),/最多一条出口/);
 const saved=store.createWorkflowTemplate({name:'明确条件分支',nodes:[{...nodes[0],type:'condition'},...nodes.slice(1)],edges});
 assert.equal(saved.edges[0].sourcePort,'top');assert.equal(saved.edges[0].targetPort,'bottom');
 assert.throws(()=>store.updateWorkflowTemplate(saved.id,{name:saved.name,nodes,edges}),/最多一条出口/);
 assert.deepEqual(store.listWorkflowTemplates().find(w=>w.id===saved.id),saved);
 for(const key of ['sourcePort','targetPort'])for(const value of ['in','out','unknown',null]){
  const input={name:'坏端口',nodes,edges:[{source:'a',target:'b',[key]:value}]};
  assert.throws(()=>validateInput(input,resources.workflows.schema));assert.throws(()=>store.createWorkflowTemplate(input),/连接点/);
 }
 assert.deepEqual(reopen().listWorkflowTemplates().find(w=>w.id===saved.id),saved);
});

test('formatting a branched cyclic graph keeps identities and separates nodes; routes prefer zero or one bend',async()=>{
 const nodes=[{id:'a',position:{x:0,y:0}},{id:'b',type:'condition',position:{x:0,y:0}},{id:'c',position:{x:0,y:0}}],edges=[{source:'a',target:'b'},{source:'b',target:'c'},{source:'b',target:'a'}];
 const positions=await formatWorkflowLayout(nodes,edges,new ELK());assert.deepEqual(positions.map(n=>n.id).sort(),['a','b','c']);
 for(let i=0;i<positions.length;i++)for(let j=0;j<i;j++)assert.ok(Math.abs(positions[i].position.x-positions[j].position.x)>=140||Math.abs(positions[i].position.y-positions[j].position.y)>=76);
 assert.equal(nodes[0].position.x,0,'formatting returns positions without mutating the definition');
 const row=[{id:'a',position:{x:0,y:0}},{id:'b',position:{x:260,y:0}}];assert.equal(workflowRoute(row,{source:'a',target:'b'}).vertices.length,0);
 row[1].position.y=140;assert.equal(workflowRoute(row,{source:'a',target:'b'}).vertices.length,1);
 const pinned=workflowRoute(row,{source:'a',target:'b',sourcePort:'right',targetPort:'top'});assert.equal(pinned.sourcePort,'right');assert.equal(pinned.targetPort,'top');
 row[1].position.y=0;assert.equal(workflowRoute(row,{source:'a',target:'b',sourcePort:'top',targetPort:'top'}),null,'impossible one-bend routes use orthogonal fallback instead of a diagonal');
});

test('minimal canvas and CLI definitions share defaults, return loops and deterministic complete text',async t=>{
  const {store}=await fixture(t),input=definition();validateInput(input,resources.workflows.schema);
  const saved=store.createWorkflowTemplate(input);
  assert.equal(saved.nodes[0].type,'process');assert.equal(saved.edges[0].condition,'');assert.equal(saved.nodes[0].staffingGuidance,'');assert.deepEqual(saved.nodes[0].position,{x:30,y:40});
  assert.deepEqual(saved.nodes[1].handoffFrom,['write']);assert.deepEqual(saved.nodes[0].handoffFrom,['review']);
  assert.deepEqual(saved.nodes[0].dependsOn,[]);assert.equal(saved.edges[0].handoff,true);
  const markdown=workflowDescription(saved);assert.match(markdown,/NODE_BODY\n保留完整说明/);assert.match(markdown,/EDGE_BODY\n检查文件后交接/);
  assert.match(markdown,/review（审阅） → write（编写）/);assert.doesNotMatch(markdown,/position|坐标|"x"/);
  assert.equal(workflowDescription(saved),markdown);assert.equal(workflowConnections(saved).length,2);
});
test('process and condition nodes round-trip branch labels without evaluating expressions',async t=>{
  const {store,reopen}=await fixture(t);
  const input={name:'分支判断',nodes:[{id:'judge',type:'condition',title:'是否通过',description:'核对实际证据'},{id:'yes',type:'process',title:'交付'},{id:'no',title:'修改'}],edges:[{source:'judge',target:'yes',condition:'结果满足要求',description:'保留完整交付说明'},{source:'judge',target:'no',condition:'结果不满足要求'}]};
  validateInput(input,resources.workflows.schema);const saved=store.createWorkflowTemplate(input);
  assert.equal(saved.nodes[0].type,'condition');assert.match(saved.nodes[0].deliverable,/说明理由并交回经理/);assert.equal(saved.nodes[2].type,'process');assert.equal(saved.edges[1].condition,'结果不满足要求');
  const markdown=workflowDescription(saved);assert.match(markdown,/条件节点/);assert.match(markdown,/选择满足条件的一条出线/);assert.match(markdown,/分支条件：\n结果满足要求/);assert.match(markdown,/保留完整交付说明/);
  assert.deepEqual(reopen().listWorkflowTemplates().find(flow=>flow.id===saved.id),saved);
});
test('invalid node types and branch text reject equally through CLI and Store',async t=>{
  const {store}=await fixture(t);
  for(const staffingGuidance of [0,false,null]){const input=definition();input.nodes[0].staffingGuidance=staffingGuidance;assert.throws(()=>validateInput(input,resources.workflows.schema));assert.throws(()=>store.createWorkflowTemplate(input),/人员需求/);}
  for(const type of ['',null,'decision',true]){const input=definition();input.nodes[0].type=type;assert.throws(()=>validateInput(input,resources.workflows.schema));assert.throws(()=>store.createWorkflowTemplate(input),/节点类型/);}
  for(const condition of [null,true,'a'.repeat(2001)]){const input=definition();input.edges[0].condition=condition;assert.throws(()=>validateInput(input,resources.workflows.schema));assert.throws(()=>store.createWorkflowTemplate(input),/分支条件/);}
});
test('node relationships normalize to one directed connection and conflicting explicit relationships reject atomically',async t=>{
  const {store}=await fixture(t);
  const flow=store.createWorkflowTemplate({name:'原有人员与交接要求',nodes:[{id:'a',title:'A',staffingGuidance:'人员要求',deliverable:'实际交付',artifactPaths:['reports/a/']},{id:'b',title:'B',dependsOn:['a'],handoffFrom:['a']}]});
  assert.equal(flow.edges.length,1);assert.equal(flow.edges[0].dependency,true);assert.equal(flow.edges[0].handoff,true);
  assert.match(workflowDescription(flow),/人员要求/);assert.match(workflowDescription(flow),/实际交付/);assert.match(workflowDescription(flow),/reports\/a\//);
  assert.throws(()=>store.updateWorkflowTemplate(flow.id,{name:flow.name,nodes:flow.nodes,edges:[]}),/不一致/);
  assert.deepEqual(store.listWorkflowTemplates().find(item=>item.id===flow.id),flow);
  const simple=store.createWorkflowTemplate({name:'自动编号',nodes:[{title:'独立工作',description:''}],edges:[]});assert.equal(simple.nodes[0].id,'node_1');
});
test('invalid canvas edges, coordinates and dependency cycles fail through CLI validation and Store',async t=>{
  const {store}=await fixture(t);
  for(const edges of [
    [{source:'write',target:'missing'}],[{source:'write',target:'write'}],
    [{source:'write',target:'review'},{source:'write',target:'review'}],
    [{id:'same',source:'write',target:'review'},{id:'same',source:'review',target:'write'}],
    [{source:'write',target:'review',dependency:true},{source:'review',target:'write',dependency:true}],
    [{source:'write',target:'review',dependency:false,handoff:false}]
  ])assert.throws(()=>store.createWorkflowTemplate({...definition(),edges}));
  for(const position of [{x:Infinity,y:1},{x:100001,y:0},{x:1},{x:1,y:1,other:1}]){
    const input=definition();input.nodes[0].position=position;assert.throws(()=>store.createWorkflowTemplate(input));assert.throws(()=>validateInput(input,resources.workflows.schema));
  }
  const input=definition();input.edges[0].handoff='true';assert.throws(()=>validateInput(input,resources.workflows.schema));assert.throws(()=>store.createWorkflowTemplate(input));
});
test('saved positions and edge text survive restart; catalog edits leave frozen tasks and Runs unchanged',async t=>{
  const {store,reopen}=await fixture(t),saved=store.createWorkflowTemplate(definition());
  const members=store.listAgents().filter(a=>['system_project_manager','agent_analyst'].includes(a.id)).map(a=>a.id);
  const task=store.createTask({managerAgentId:'system_project_manager',title:'冻结图',objective:'不执行模型',memberAgentIds:members,workflowTemplateId:saved.id});
  const frozen=structuredClone(store.getTask(task.id).workflowSnapshot),run=store.createRun(task.id);
  const edited=definition();edited.description='新版本';edited.edges[0].description='新的连线正文';edited.edges[0].condition='新的条件';edited.nodes[0].type='condition';store.updateWorkflowTemplate(saved.id,edited);
  assert.deepEqual(store.getRunTask(run.id).workflowSnapshot,frozen);
  const reopened=reopen();
  assert.equal(reopened.listWorkflowTemplates().find(item=>item.id===saved.id).edges[0].description,'新的连线正文');
  assert.deepEqual(reopened.getTask(task.id).workflowSnapshot,frozen);
});
test('workflow context is a private immutable per-Trace file with a matching digest; replacement and links reject',async t=>{
  const root=await mkdtemp(join(tmpdir(),'af-workflow-context-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const files=createRunFiles({root}),frozen=definition();
  const ref=await files.writeWorkflowContext('run_context','trace_context',frozen),content=await readFile(ref.path);
  assert.equal(content.toString(),workflowDescription(frozen));assert.equal(ref.bytes,content.length);assert.equal(ref.sha256,createHash('sha256').update(content).digest('hex'));
  assert.equal((await stat(ref.path)).mode&0o777,0o600);
  await assert.rejects(files.writeWorkflowContext('run_context','trace_context',frozen),{code:'EEXIST'});
  const folder=await files.prepareTrace('run_context','trace_link');await symlink(ref.path,join(folder,'workflow.md'));
  await assert.rejects(files.writeWorkflowContext('run_context','trace_link',frozen),{code:'EEXIST'});
  await symlink(folder,join(root,'runs/run_context/traces/trace_parent'));
  await assert.rejects(files.writeWorkflowContext('run_context','trace_parent',frozen));
  await assert.rejects(files.writeWorkflowContext('run_context','trace_large',{name:'过大',description:'x'.repeat(1024*1024),nodes:[]}),/1 MiB/);
});
