import test from "node:test";
import assert from "node:assert/strict";
import { cp, chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunFiles } from "../server/run-files.mjs";
import { createFixtureStore as createStore } from "./fixture-store.mjs";
import { executeRun } from "../server/orchestrator.mjs";
import { createRuntimeConfiguration } from "../server/runtime/configuration.mjs";
import { createHash } from 'node:crypto';

test('input material files are lossless, private, reusable and reject tampering, links and forged paths', async t => {
  const root=await mkdtemp(join(tmpdir(),'af-input-materials-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const files=createRunFiles({root}),content='原始长正文🌍\n'.repeat(1100),sha256=createHash('sha256').update(content).digest('hex'),name=`input-${sha256}.txt`;
  const directory=files.taskInputDirectory('run_test'),material={content,sha256,name,path:join(directory,name)};
  await files.writeTaskInputMaterials('run_test',[material]);await files.writeTaskInputMaterials('run_test',[material]);
  assert.equal(await readFile(material.path,'utf8'),content);assert.equal((await lstat(material.path)).mode&0o777,0o600);assert.equal((await lstat(directory)).mode&0o777,0o700);
  await assert.rejects(files.writeTaskInputMaterials('run_test',[{...material,path:join(root,'outside.txt')}]),/引用无效/);
  await writeFile(material.path,'tampered');await assert.rejects(files.writeTaskInputMaterials('run_test',[material]),/完整性/);
  await rm(material.path);const outside=join(root,'outside.txt');await writeFile(outside,content);await symlink(outside,material.path);await assert.rejects(files.writeTaskInputMaterials('run_test',[material]));
  assert.equal(await readFile(outside,'utf8'),content);
  const chatDirectory=files.communicationInputDirectory('chat_test');await files.writeCommunicationInputMaterials('chat_test',[{...material,path:join(chatDirectory,name)}]);assert.equal(await readFile(join(chatDirectory,name),'utf8'),content);
});

test('frozen workflow reuses a stable read path while preserving each Trace evidence file', async t => {
  const root=await mkdtemp(join(tmpdir(),'af-workflow-reference-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const files=createRunFiles({root}),workflow={name:'Frozen',nodes:[{id:'n',title:'Original',description:'UNCHANGED'}]};
  const first=await files.writeWorkflowContext('run_test','trace_first',workflow),next=await files.writeWorkflowContext('run_test','trace_next',workflow);
  assert.equal(first.path,next.path);assert.match(first.path,/workflow\/[^/]+\/workflow.md$/);
  assert.equal(await readFile(first.path,'utf8'),await readFile(join(files.traceDirectory('run_test','trace_first'),'workflow.md'),'utf8'));
  await readFile(join(files.traceDirectory('run_test','trace_next'),'workflow.md'));
  await writeFile(first.path,'corrupted');await assert.rejects(files.writeWorkflowContext('run_test','trace_failed',workflow),/完整性/);
});

test('working video metadata and descriptor streams do not read full media or weaken path checks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-video-'));t.after(()=>rm(root,{recursive:true,force:true}));const task={workspacePath:root},files=createRunFiles({root:join(root,'audit')});
 const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(1024*1024)]);await writeFile(join(root,'sample.mp4'),bytes);
 const meta=await files.readWorkingFile(task,'sample.mp4');assert.equal(meta.video,true);assert.equal(meta.content,null);assert.equal(meta.bytes,bytes.length);
 const video=await files.openWorkingVideo(task,'sample.mp4');assert.equal(video.mediaType,'video/mp4');const chunks=[];for await(const chunk of video.handle.createReadStream({start:4,end:11}))chunks.push(chunk);assert.equal(Buffer.concat(chunks).toString(),'ftypisom');
 await writeFile(join(root,'invalid.mp4'),'not a video');await symlink(join(root,'sample.mp4'),join(root,'linked.mp4'));
 for(const path of ['invalid.mp4','linked.mp4','../sample.mp4','.env','audit','missing.mp4'])await assert.rejects(files.openWorkingVideo(task,path));
});

test("working downloads preserve complete bytes beyond preview size and retain file-read boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "af-download-"));
  try {
    const task = { workspacePath: root, workflowSnapshot: { nodes: [] } };
    const files = createRunFiles({ root: join(root, "audit") });
    await mkdir(join(root, "docs"));
    const bytes = Buffer.alloc(600 * 1024, 0xab);
    await writeFile(join(root, "docs/下载 '样例'.bin"), bytes);
    await writeFile(join(root, "docs/empty.txt"), "");
    for (const [path, expected] of [["docs/下载 '样例'.bin", bytes], ["docs/empty.txt", Buffer.alloc(0)]]) {
      const result = await files.readWorkingFile(task, path, { download: true });
      const chunks = [];
      for await (const chunk of result.content) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), expected);
      assert.equal(result.fileName, path.split("/").at(-1));
    }
    await assert.rejects(files.readWorkingFile(task, "docs/下载 '样例'.bin"), /预览上限/);
    await writeFile(join(root, "outside.txt"), "outside sentinel");
    const rootDownload=await files.readWorkingFile(task,'outside.txt',{download:true});for await(const chunk of rootDownload.content)assert.equal(chunk.toString(),'outside sentinel');
    await symlink(join(root, "outside.txt"), join(root, "docs/link.txt"));
    for (const path of ["../outside.txt", "docs/.env", "docs/link.txt", "docs/missing.txt", "docs",'.git/config','.agentforge/private.json']) {
      await assert.rejects(files.readWorkingFile(task, path, { download: true }));
    }
    await assert.rejects(files.readWorkingFile(task, "docs/empty.txt", { raw: true, download: true }), /不能同时/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("console content references cannot cross Run, Trace or actor boundaries", () => {
  const store = createStore(), run = store.createRun(store.listTasks()[0].id);
  const trace = store.createTrace(run.id, { agentId: run.manager.id, workflowNodeId: store.getRunTask(run.id).workflowSnapshot.nodes[0].id, type: 'manager' });
  const contentRef = { storagePath: `runs/${run.id}/traces/${trace.id}/content-11111111-1111-4111-8111-111111111111.json`, bytes: 30, sha256: 'a'.repeat(64) };
  const event = store.addEvent({ type: 'runtime.event', runId: run.id, actor: { id: run.manager.id }, message: 'summary', data: { auditVersion: 2, traceId: trace.id, contentRef } });
  assert.deepEqual(store.getConsoleContentReference(run.id, event.id), contentRef);
  assert.throws(() => store.getConsoleContentReference('other-run', event.id), /不存在/);
  const wrongActor = store.addEvent({ type: 'runtime.event', runId: run.id, actor: { id: 'other' }, message: 'summary', data: { auditVersion: 2, traceId: trace.id, contentRef } });
  assert.throws(() => store.getConsoleContentReference(run.id, wrongActor.id), /不存在/);
  const wrongPath = store.addEvent({ type: 'runtime.event', runId: run.id, actor: { id: run.manager.id }, message: 'summary', data: { auditVersion: 2, traceId: trace.id, contentRef: { ...contentRef, storagePath: 'runs/other/traces/other/content.json' } } });
  assert.throws(() => store.getConsoleContentReference(run.id, wrongPath.id), /关联无效/);
});

test("execution content is file-backed, private and rejects tampering or symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), 'af-console-content-'));
  try {
    const files = createRunFiles({ root });
    const content = { version: 1, fields: { text: { text: 'actual output', truncated: false, redacted: false } } };
    const ref = await files.writeConsoleContent('run_test', 'trace_test', content);
    assert.deepEqual(await files.readConsoleContent(ref), content);
    assert.equal((await lstat(join(root, ref.storagePath))).mode & 0o777, 0o600);
    await writeFile(join(root, ref.storagePath), '{}');
    await assert.rejects(files.readConsoleContent(ref), /完整性/);
    await rm(join(root, ref.storagePath));
    const target = join(root, 'outside.json'); await writeFile(target, JSON.stringify(content));
    await symlink(target, join(root, ref.storagePath));
    await assert.rejects(files.readConsoleContent(ref), /符号链接/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dispatch prompt snapshots are per-Trace, integrity-bound and boundary-checked", async () => {
  const root = await mkdtemp(join(tmpdir(), 'af-prompt-snapshot-'));
  try {
    const files = createRunFiles({ root });
    const store = createStore(), run = store.createRun(store.listTasks()[0].id);
    const trace = store.createTrace(run.id, { agentId: run.manager.id, workflowNodeId: store.getRunTask(run.id).workflowSnapshot.nodes[0].id, type: 'manager' });
    assert.throws(() => store.getTracePromptReference(run.id, trace.id), /不存在或当时未保存/);
    const snapshot = { version: 1, kind: 'prompt-snapshot', prompt: { text: '实际派发提示词', truncated: false, redacted: false } };
    const ref = await files.writePromptSnapshot(run.id, trace.id, snapshot);
    assert.equal((await lstat(join(root, ref.storagePath))).mode & 0o777, 0o600);
    assert.deepEqual(await files.readConsoleContent(ref), snapshot);
    const attached = store.attachTracePrompt(trace.id, ref);
    assert.deepEqual(attached.promptRef, ref);
    assert.deepEqual(store.getTracePromptReference(run.id, trace.id), ref);
    assert.throws(() => store.getTracePromptReference('other-run', trace.id), /不存在/);
    assert.throws(() => store.attachTracePrompt(trace.id, ref), /关联无效/);
    assert.throws(() => store.attachTracePrompt(store.createTrace(run.id, { agentId: run.manager.id, workflowNodeId: trace.workflowNodeId, type: 'manager' }).id, { ...ref, storagePath: `runs/${run.id}/traces/other/prompt-snapshot.json` }), /关联无效/);
    await assert.rejects(files.writePromptSnapshot(run.id, trace.id, snapshot));
    await writeFile(join(root, ref.storagePath), '{}');
    await assert.rejects(files.readConsoleContent(ref), /完整性/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workspace readiness marker rejects a symlink before it can overwrite an external file", async () => {
  const root = await mkdtemp(join(tmpdir(), "af-ready-marker-"));
  try {
    const task = {
      id: "task_workspace_marker",
      workspaceManaged: true,
      workspacePath: join(root, "workspace"),
      repositoryMode: "agent",
      repositorySources: [],
      workflowSnapshot: { nodes: [] }
    };
    const files = createRunFiles({ root: join(root, "audit") });
    assert.deepEqual(await files.prepareRunWorkspace(task), []);

    const marker = join(task.workspacePath, ".agentforge", "workspace-ready.json");
    assert.equal(JSON.parse(await readFile(marker, "utf8")).taskId, task.id);
    const outside = join(root, "outside-marker.json");
    const original = JSON.stringify({ taskId: task.id, preparedAt: "outside sentinel" });
    await writeFile(outside, original);
    await rm(marker);
    await symlink(outside, marker);

    await assert.rejects(files.prepareRunWorkspace(task), /就绪标记不允许符号链接/);
    assert.equal(await readFile(outside, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace readers reject a Task root symlink before it reveals external files", async () => {
  const root = await mkdtemp(join(tmpdir(), "af-workspace-root-link-"));
  try {
    const workspace = join(root, "workspace"), outside = join(root, "outside");
    await mkdir(join(outside, "docs"), { recursive: true });
    await mkdir(join(outside, "repos", "app", "src"), { recursive: true });
    await writeFile(join(outside, "docs", "outside.md"), "OUTSIDE_WORKSPACE_SENTINEL");
    await writeFile(join(outside, "repos", "app", "src", "outside.js"), "export const outside = true;\n");
    await symlink(outside, workspace);

    const files = createRunFiles({ root: join(root, "audit") });
    const task = { id: "task_workspace_root_link", workspacePath: workspace, repositoryMode: "agent", repositorySources: [{ path: "repos/app" }], workflowSnapshot: { nodes: [] } };

    await assert.rejects(files.listWorkingDirectory(task), /工作目录不允许读取符号链接/);
    await assert.rejects(files.readWorkingFile(task, "docs/outside.md"), /工作目录不允许读取符号链接/);
    await assert.rejects(files.listRepositoryTree(workspace, "repos/app"), /工作目录不允许读取符号链接/);
    assert.equal(await readFile(join(outside, "docs", "outside.md"), "utf8"), "OUTSIDE_WORKSPACE_SENTINEL");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private Git host tokens reach only their matching HTTPS clone helper", async () => {
  const root = await mkdtemp(join(tmpdir(), "af-git-token-clone-"));
  const previousPath = process.env.PATH, previousCapture = process.env.GIT_CAPTURE_PATH;
  try {
    const bin = join(root, "bin"), capture = join(root, "git-capture.json"), fakeGit = join(bin, "git");
    await mkdir(bin);
    await writeFile(fakeGit, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const helperEntry = args.find((arg) => arg.startsWith("credential.helper=!"));
const credential = (host) => {
  if (!helperEntry) return "";
  const command = helperEntry.slice("credential.helper=".length + 1);
  return spawnSync("/bin/sh", ["-c", command + " get"], { input: "protocol=https\\nhost=" + host + "\\n\\n", encoding: "utf8", env: process.env }).stdout;
};
if (args.includes("clone")) {
  const target = args.at(-1);
  mkdirSync(target + "/.git", { recursive: true });
  writeFileSync(target + "/README.md", "fixture\\n");
  writeFileSync(process.env.GIT_CAPTURE_PATH, JSON.stringify({ args, github: credential("github.com"), gitlab: credential("gitlab.com"), foreign: credential("redirect.example") }));
} else if (args.includes("rev-parse")) console.log("0123456789012345678901234567890123456789");
else if (args.includes("config") && args.includes("remote.origin.url")) console.log(process.env.GIT_FAKE_ORIGIN || "");
`);
    await chmod(fakeGit, 0o755);
    process.env.PATH = `${bin}:${previousPath}`;
    process.env.GIT_CAPTURE_PATH = capture;
    const configuration = createRuntimeConfiguration(join(root, "runtime-config"));
    const githubToken = "GITHUB_PULL_TOKEN_SENTINEL", gitlabToken = "GITLAB_PULL_TOKEN_SENTINEL";
    await configuration.saveGitCredential("github", githubToken);
    await configuration.saveGitCredential("gitlab", gitlabToken);
    const prepare = async (id, url) => {
      process.env.GIT_FAKE_ORIGIN = url;
      const task = { id, workspaceManaged: true, workspacePath: join(root, id), repositoryMode: "agent", repositorySources: [{ path: "repos/app", url, ref: "main" }], workflowSnapshot: { nodes: [] } };
      const files = createRunFiles({ root: join(root, `${id}-audit`), resolveGitCredential: (repositoryUrl) => configuration.resolveGitCredential(repositoryUrl) });
      await files.prepareRunWorkspace(task);
      return { task, marker: await readFile(join(task.workspacePath, ".agentforge", "workspace-ready.json"), "utf8"), capture: JSON.parse(await readFile(capture, "utf8")) };
    };

    const github = await prepare("github-workspace", "https://github.com/acme/private.git");
    assert.equal(github.capture.github, "username=x-access-token\npassword=GITHUB_PULL_TOKEN_SENTINEL\n");
    assert.equal(github.capture.gitlab, "");
    assert.equal(github.capture.foreign, "");
    assert.ok(github.capture.args.includes("--no-recurse-submodules"));
    assert.doesNotMatch(JSON.stringify({ args: github.capture.args, marker: github.marker, task: github.task }), /GITHUB_PULL_TOKEN_SENTINEL|GITLAB_PULL_TOKEN_SENTINEL/);

    const gitlab = await prepare("gitlab-workspace", "https://gitlab.com/acme/private.git");
    assert.equal(gitlab.capture.github, "");
    assert.equal(gitlab.capture.gitlab, "username=oauth2\npassword=GITLAB_PULL_TOKEN_SENTINEL\n");
    assert.equal(gitlab.capture.foreign, "");
    assert.doesNotMatch(JSON.stringify({ args: gitlab.capture.args, marker: gitlab.marker, task: gitlab.task }), /GITHUB_PULL_TOKEN_SENTINEL|GITLAB_PULL_TOKEN_SENTINEL/);

    await configuration.removeGitCredential("github");
    const anonymous = await prepare("anonymous-workspace", "https://github.com/acme/public.git");
    assert.equal(anonymous.capture.github, "");
    assert.equal(anonymous.capture.args.some((arg) => arg.startsWith("credential.helper=!")), false);
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousCapture === undefined) delete process.env.GIT_CAPTURE_PATH; else process.env.GIT_CAPTURE_PATH = previousCapture;
    delete process.env.GIT_FAKE_ORIGIN;
    await rm(root, { recursive: true, force: true });
  }
});

test("a managed workspace completes a fixture Run with a regular readiness marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "af-ready-marker-run-"));
  try {
    const executable = join(root, "provider.mjs");
    await writeFile(executable, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
const userPrompt = process.argv.at(-1) || "";
const instructionFlag = process.argv.indexOf("--append-system-prompt-file");
const systemPrompt = instructionFlag < 0 ? "" : (await import("node:fs")).readFileSync(process.argv[instructionFlag+1],"utf8");
const prompt = "[应用系统指令]" + String.fromCharCode(10) + systemPrompt + String.fromCharCode(10,10) + "[本轮输入]" + String.fromCharCode(10) + userPrompt;
const reviewCriteria = JSON.parse((prompt.split("任务验收标准：")[1] || "[]").split(String.fromCharCode(10))[0]);
const reviewEvidence = [...prompt.matchAll(/"id":"(artifact_[^"]+)"/g)].map((match) => match[1]).slice(0, 1);
const result = { kind: "node_result", summary: "fixture delivery", artifacts: [], decisions: [], needsHuman: false, consultation: null, inputAssessment: { sufficient: true, sourceNodeIds: [], rationale: "fixture input is sufficient", missingEvidence: [] }, deliveryReview: null, managerDecision: null };
if (prompt.includes('"purpose":"delivery_review"')) result.deliveryReview = { verdict: "pass", restartFromNodeId: "verify", findings: ["fixture evidence reviewed"] };
else if (prompt.includes("任务级项目经理")) result.managerDecision = { nextNodeId: prompt.includes('"type":"node"') ? null : "verify", rationale: "fixture routes the remaining responsibility" };
else { mkdirSync("docs/verify", { recursive: true }); mkdirSync("docs/testing", { recursive: true }); writeFileSync("docs/verify/marker.md", "x".repeat(524289)); writeFileSync("docs/testing/review.md", "# Fixture test report"); }
if(result.managerDecision?.nextNodeId) result.managerDecision.nextAgentId=JSON.parse((prompt.split("可咨询角色：")[1]||"[]").split(String.fromCharCode(10))[0]).find(row=>row.type==="agent" && row.taskRole!=="manager")?.id;
console.log(JSON.stringify({ type: "result", result: JSON.stringify(result) }));
`);
    await chmod(executable, 0o755);

    const store = createStore({ workspaceRoot: join(root, "workspaces") });
    const verifier = store.createAgent({ name: "验证员工", role: "验证工程师", runtime: { provider: "claude-code", executable } });
    const team = store.createTeam({ name: "工作目录验证团队", memberAgentIds: [verifier.id,store.listAgents().find(item=>item.kind==='manager').id] });
    const workflow = store.createWorkflowTemplate({ name: "工作目录验证", nodes: [{ id: "verify", title: "验证", staffingGuidance: "验证工程师", artifactPaths: ["docs/verify/", "docs/testing/"], dependsOn: [] }] });
    const task = store.createTask({managerAgentId:'system_project_manager', title: "工作目录标记运行", objective: "验证受管工作目录启动", memberAgentIds: team.memberAgentIds, workflowTemplateId: workflow.id, nodeAssignments: { verify: verifier.id }, managerRuntime: { provider: "claude-code", executable } });
    const run = store.createRun(task.id);

    await executeRun(store, run.id, { runFilesRoot: join(root, "run-files") });
    assert.equal(store.getRun(run.id).status, "awaiting_acceptance");
    assert.ok(store.getRunWorkspace(run.id).artifacts.some((artifact) => artifact.name === "docs/verify/marker.md" && artifact.bytes === 524289));
    const marker = join(store.getRunTask(run.id).workspacePath, ".agentforge", "workspace-ready.json");
    assert.equal((await lstat(marker)).isFile(), true);
    assert.deepEqual(JSON.parse(await readFile(marker, "utf8")).repositoryRevisions, []);
    store.confirmRunCompletion(run.id);
    assert.equal(store.getRun(run.id).status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('managed tasks reject a linked tasks parent before creating a task directory outside the workspace',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-tasks-parent-'));t.after(()=>rm(root,{recursive:true,force:true}));const work=join(root,'work'),outside=join(root,'outside');await mkdir(work);await mkdir(outside);await symlink(outside,join(work,'tasks'));const files=createRunFiles({root:join(root,'records')});
 await assert.rejects(files.prepareTaskWorkspace({workspaceManaged:true,workspacePath:join(work,'tasks','task_test')}),/上级目录不能是符号链接/);await assert.rejects(lstat(join(outside,'task_test')),{code:'ENOENT'});
});


test('common records preserve communication content refs while attachments stay in pinned shared cwd',async t=>{
 const root=await mkdtemp(join(tmpdir(),'af-comm-records-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const records=join(root,'workspace/records'),shared=join(root,'workspace/communications'),key='chat_recordtest',pinned=join(shared,key);
 const files=createRunFiles({root:records,communicationsRoot:shared,resolveCommunicationWorkspace:()=>pinned});
 const attachment=await files.writeCommunicationAttachment(key,'readme.txt',Buffer.from('shared bytes'));
 assert.equal(await readFile(join(pinned,attachment.path),'utf8'),'shared bytes');
 await assert.rejects(lstat(join(records,'communications',key,attachment.path)),{code:'ENOENT'});
 const reference=await files.writeCommunicationContent(key,'chat_delivery_test',1,{type:'text',text:'immutable body'});
 assert.match(reference.storagePath,/^communications\/chat_recordtest\/\.agentforge\//);
 assert.deepEqual(await files.readConsoleContent(reference),{type:'text',text:'immutable body'});
 await assert.rejects(lstat(join(pinned,'.agentforge')),{code:'ENOENT'});
 const attempt=await files.prepareCommunicationAttempt(key,'agent_a','chat_delivery_test',1);
 assert.equal(attempt,join(records,'communications',key,'agent_a/chat_delivery_test/1'));
 const other=join(root,'other/records');await cp(records,other,{recursive:true});
 const moved=createRunFiles({root:other,communicationsRoot:join(root,'other/communications'),resolveCommunicationWorkspace:()=>pinned});
 assert.deepEqual(await moved.readConsoleContent(reference),await files.readConsoleContent(reference));
 assert.deepEqual(await moved.readCommunicationAttachment(key,attachment),Buffer.from('shared bytes'));
 const opened=await moved.openAttachment('communications',key,attachment);let result='';for await(const chunk of opened.stream)result+=chunk;assert.equal(result,'shared bytes');
 await writeFile(join(pinned,attachment.path),'altered');await assert.rejects(moved.validateAttachment('communications',key,attachment),/完整性/);
 await assert.rejects(moved.writeCommunicationContent('../outside','chat_delivery_test',1,{}),/ID/);
});
