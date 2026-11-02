// Isolated real Electron UI acceptance for role management: directory CRUD,
// search/pagination, employee inline multi-select binding and reference-rejected
// deletion. No Provider calls; never touches the operator's data or session.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import {spawn} from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';

await mkdir('.data', { recursive: true });
const root = await mkdtemp(resolve('.data/roles-ui-'));
assert.equal(dirname(root), resolve('.data')); assert.match(basename(root), /^roles-ui-[a-zA-Z0-9]+$/);
const bundle=process.env.AGENTFORGE_ROLES_APP;
const home = join(root, 'home'), data = bundle?join(home,'.agentforge','desktop'):join(root, 'client');
await mkdir(home, { recursive: true, mode: 0o700 });
const password = randomBytes(24).toString('hex');
const auth = createAuth({ databasePath: join(data, 'auth.sqlite') });
await auth.setAdministrator('roles-ui', password);
auth.close();
const seeded = createStore({ databasePath: join(data, 'agentforge.sqlite'), workspaceRoot: join(root, 'work') });
const employee = seeded.listAgents().find(item => item.kind === 'business');
assert.ok(employee, 'default catalog provides a business employee');
seeded.close();

const app = await electron.launch({ ...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/AgentForge')}:{args:['apps/electron/main.mjs']}), env: { ...process.env, HOME: home, AGENTFORGE_DESKTOP_DATA_ROOT: data, AGENTFORGE_LOG_DIR: join(root, 'logs') }, timeout: 180000 });
try {
  const page = await app.firstWindow({ timeout: 180000 });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 60000 });
  await page.waitForLoadState('load');
  const origin = new URL(page.url()).origin;
  const api = (path, body, method = 'POST') => page.evaluate(async ({ path, body, method }) => { const r = await fetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : body === null ? { method } : {}); const result = await r.json().catch(() => ({})); return { status: r.status, ...result }; }, { path, body, method });

  // The roles API is authenticated like every other configuration resource.
  const anonymous = await page.evaluate(async () => (await fetch('/api/roles')).status);
  assert.equal(anonymous, 401, 'roles API requires authentication');

  await page.goto(origin + '/login');
  await page.locator('#username').fill('roles-ui');
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('#account-name').waitFor();

  // Roles participates in the same persisted visibility choices as every
  // optional sidebar entry, including empty BUILD groups and default restore.
  await page.goto(origin + '/settings/appearance');
  const roleVisibility = page.getByRole('checkbox', { name: '显示角色', exact: true });
  await roleVisibility.waitFor();
  assert.ok(await roleVisibility.isChecked());
  await roleVisibility.uncheck();
  assert.ok(await page.locator('.nav-item[data-view="roles"]').isHidden());
  await page.reload();
  await roleVisibility.waitFor();
  assert.equal(await roleVisibility.isChecked(), false, 'role visibility survives reload');
  assert.ok(await page.locator('.nav-item[data-view="roles"]').isHidden());
  for (const id of ['agents', 'mcp-marketplace', 'marketplace']) await page.locator(`[data-nav-visible="${id}"]`).uncheck();
  assert.ok(await page.locator('[data-navigation-group="build"]').isHidden(), 'empty BUILD group is hidden');
  await page.locator('[data-reset-navigation]').click();
  assert.ok(await roleVisibility.isChecked());
  assert.ok(await page.locator('.nav-item[data-view="roles"]').isVisible());

  // Standalone BUILD-group navigation entry next to 数字员工.
  await page.locator('.nav-item[data-view="roles"]').click();
  await page.waitForURL(/\/roles$/);
  assert.equal(await page.locator('#breadcrumb-current').textContent(), '角色');
  await page.locator('#roles-empty').waitFor();
  const roleIcon = page.locator('.nav-item[data-view="roles"] .nav-icon');
  assert.ok(await roleIcon.isVisible());
  const roleMask = await roleIcon.evaluate(node => getComputedStyle(node, '::before').maskImage);
  assert.match(roleMask, /data:image\/svg\+xml/, 'desktop role icon has an SVG mask rather than an unmasked solid square');

  // Create through the modal; only name + plain-text prompt are requested.
  await page.locator('#roles-view .directory-toolbar [data-action="new-role"]').click();
  await page.locator('#role-form [name=name]').fill('界面验收角色');
  await page.locator('#role-form [name=prompt]').fill('UI_ROLE_MARK 第一行只写证据编号。');
  await page.locator('#role-form [type=submit]').click();
  await page.locator('#role-form').waitFor({ state: 'detached' });
  await page.locator('#roles-grid .agent-card h3', { hasText: '界面验收角色' }).waitFor();
  let roles = (await api('/api/roles', null, 'GET')).roles;
  assert.equal(roles.length, 1);
  const role = roles[0];
  assert.deepEqual(Object.keys(role).sort(), ['createdAt', 'id', 'name', 'prompt'].sort(), 'role holds only name and prompt plus system metadata');
  for (const theme of ['minimal', 'warm']) {
    await page.goto(origin + '/settings/appearance');
    await page.locator(`[name="theme"][value="${theme}"]`).check();
    await page.goto(origin + '/roles');
    await page.locator(`[data-edit-role="${role.id}"]`).waitFor();
    assert.ok(await roleIcon.isVisible(), `role icon is visible in ${theme} theme`);
    await page.screenshot({ path: join(root, `roles-${theme}-wide.png`) });
  }

  // Edit the prompt in place.
  await page.locator(`[data-edit-role="${role.id}"]`).click();
  await page.locator('#role-form [name=prompt]').fill('UI_ROLE_MARK_V2 更新后的角色提示词。');
  await page.locator('#role-form [type=submit]').click();
  await page.locator('#role-form').waitFor({ state: 'detached' });
  await page.locator('#roles-grid .agent-card', { hasText: 'UI_ROLE_MARK_V2' }).waitFor();

  // Cards carry a full-width title plus the role ID; duplicate names stay
  // distinguishable in the employee selector by that ID.
  const card = page.locator('#roles-grid .agent-card', { hasText: 'UI_ROLE_MARK_V2' });
  assert.ok((await card.textContent()).includes(role.id), 'role card shows its ID');
  const geometry = await card.evaluate(node => {
    const identity = node.querySelector('.agent-card-identity').getBoundingClientRect();
    const title = node.querySelector('h3').getBoundingClientRect();
    return { cardWidth: node.getBoundingClientRect().width, identityWidth: identity.width, titleHeight: title.height };
  });
  assert.ok(geometry.identityWidth > 100 && geometry.titleHeight < 40, 'title uses the card width instead of a narrow column: ' + JSON.stringify(geometry));
  const duplicate = (await api('/api/roles', { name: '界面验收角色', prompt: 'DUPLICATE_PROMPT_TEXT' })).role;
  await page.locator('.nav-item[data-view="agents"]').click();
  await page.locator(`[data-edit-agent="${employee.id}"]`).click();
  await page.locator('#employee-role').waitFor();
  await page.locator('#employee-role').click();
  const optionTexts = await page.locator('#employee-role-options [role=option]').allTextContents();
  for (const candidate of [role, duplicate]) assert.ok(optionTexts.some(text => text.includes(candidate.name) && text.includes(candidate.id)), 'same-name roles are distinguishable by ID: ' + candidate.id);
  await page.locator('#agent-form [data-close-modal]').click();
  await api(`/api/roles/${duplicate.id}`, {}, 'DELETE');
  await page.locator('.nav-item[data-view="roles"]').click();
  await page.locator('#roles-grid .agent-card').first().waitFor();

  // Search filters by name/prompt and restores on clear.
  await page.locator('#roles-search').fill('不存在的关键词');
  await page.getByText('没有匹配的角色', { exact: true }).waitFor();
  await page.locator('#roles-search').fill('UI_ROLE_MARK_V2');
  await page.waitForFunction(()=>document.querySelectorAll('#roles-grid .agent-card').length===1);
  assert.equal(await page.locator('#roles-grid .agent-card').count(), 1);
  await page.locator('#roles-search').fill('');
  await page.waitForFunction(()=>document.querySelectorAll('#roles-grid .agent-card').length===1);
  assert.equal(await page.locator('#roles-grid .agent-card').count(), 1);

  // Twenty-per-page pagination follows the shared directory rule.
  for (let index = 0; index < 21; index++) await api('/api/roles', { name: `分页角色-${String(index).padStart(2, '0')}`, prompt: `分页提示词 ${index}` });
  await page.goto(origin + '/roles');
  await page.locator('#roles-grid .agent-card').first().waitFor();
  assert.equal(await page.locator('#roles-grid .agent-card').count(), 20);
  await page.getByText('共 22 条 · 每页 20 条 · 第 1/2 页').waitFor();
  await page.locator('[data-pagination="roles"] [data-page="2"]').click();
  assert.equal(await page.locator('#roles-grid .agent-card').count(), 2);

  const pickerPlugins=[],pickerMcps=[];
  for(let index=0;index<2;index++){
    const source=join(root,'picker-plugin-'+index);await mkdir(join(source,'.claude-plugin'),{recursive:true});await mkdir(join(source,'skills/proof'),{recursive:true});
    await writeFile(join(source,'.claude-plugin/plugin.json'),JSON.stringify({name:'picker-proof-'+index,description:'多选框布局验证'}));
    await writeFile(join(source,'skills/proof/SKILL.md'),'---\nname: proof\ndescription: Layout only\n---\nDo not run');
    pickerPlugins.push((await api('/api/runtime/marketplace',{path:source})).plugins[0]);
    const mcp=await api('/api/runtime/mcp-marketplace',{name:'多选框验证 MCP '+index,description:'布局验证，不执行',content:JSON.stringify({mcpServers:{['picker_'+index]:{command:'node',args:['--version']}}})});pickerMcps.push(mcp.entry || mcp);
  }
  // All three fields share one inline token/search control, without role priority UI.
  await page.locator('.nav-item[data-view="agents"]').click();
  await page.locator(`[data-edit-agent="${employee.id}"]`).click();
  await page.locator('#employee-role').waitFor();
  await page.locator('#employee-role').fill(role.name);
  await page.locator(`#employee-role-options [data-add-extension="${role.id}"]`).click();
  await page.locator('#agent-form [type=submit]').click();
  await page.locator('#agent-form').waitFor({ state: 'detached' });
  await page.locator('#agents-grid .agent-card', { hasText: '界面验收角色' }).waitFor();
  assert.deepEqual((await api('/api/agents', null, 'GET')).agents.find(item => item.id === employee.id).roleIds,[role.id]);
  // Persisted selection is shown when the form reopens.
  await page.locator(`[data-edit-agent="${employee.id}"]`).click();
  assert.ok((await page.locator('#employee-role-selection .extension-picked').textContent()).includes(role.name));
  const another=roles.find(item=>item.id!==role.id) || (await api('/api/roles',null,'GET')).roles.find(item=>item.id!==role.id);
  await page.locator('#employee-role').click();
  await page.locator('#employee-role').fill(another.name);
  await page.locator(`#employee-role-options [data-add-extension="${another.id}"]`).click();
  assert.equal(await page.locator('[data-role-up],[data-role-down]').count(),0);
  assert.doesNotMatch(await page.locator('#employee-role-selection .extension-picked').textContent(),/^[12]\./);
  for(const [kind,items] of [['plugin',pickerPlugins],['mcp',pickerMcps]])for(const item of items){await page.locator(`#employee-${kind}-search`).click();await page.locator(`#employee-${kind}-search`).fill(item.name);await page.locator(`[data-picker="${kind}"] [data-add-extension="${item.id}"]`).click();}
  await page.getByRole('heading',{name:'编辑数字员工',exact:true}).click();
  for(const theme of ['minimal','warm'])for(const width of [1320,760]){
    // Match the two existing theme tokens without closing the current draft.
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,850),{origin,width});
    await page.waitForFunction(expected=>innerWidth===expected,width);
    const geometry=await page.locator('#agent-form .extension-picker').evaluateAll(pickers=>pickers.map(picker=>{
      const control=picker.querySelector('.extension-picker-control'),r=control.getBoundingClientRect(),style=getComputedStyle(control),inner=getComputedStyle(picker.querySelector('input')),chips=[...picker.querySelectorAll('.extension-chip')];
      return {innerBorder:inner.borderWidth,innerShadow:inner.boxShadow,count:chips.length,inside:chips.every(chip=>{const c=chip.getBoundingClientRect();return c.left>=r.left && c.right<=r.right+1 && c.top>=r.top && c.bottom<=r.bottom+1;}),border:style.border,background:style.backgroundColor,radius:style.borderRadius,outside:picker.querySelectorAll(':scope > .extension-picked').length};
    }));
    assert.equal(geometry.length,3);for(const result of geometry){assert.equal(result.innerBorder,'0px');assert.equal(result.innerShadow,'none');assert.equal(result.count,2);assert.equal(result.inside,true);assert.equal(result.outside,0);assert.equal(result.border,geometry[0].border);assert.equal(result.background,geometry[0].background);assert.equal(result.radius,geometry[0].radius);}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:join(root,`inline-select-${theme}-${width}.png`),animations:'disabled'});
  }
  await page.locator('#agent-form [type=submit]').click();
  await page.locator('#agent-form').waitFor({state:'detached'});
  const saved=(await api('/api/agents',null,'GET')).agents.find(item=>item.id===employee.id);
  assert.deepEqual(saved.roleIds,[role.id,another.id]);
  assert.deepEqual(saved.runtime.extensionSelection,{pluginIds:pickerPlugins.map(item=>item.id),mcpIds:pickerMcps.map(item=>item.id)});
  await page.locator(`[data-edit-agent="${employee.id}"]`).click();
  await page.locator('#employee-role-selection .extension-chip').first().waitFor();
  assert.equal(await page.locator('#employee-role-selection .extension-chip').count(),2);
  // Keyboard opens the same candidate list; Escape returns focus and keeps the modal.
  await page.locator('#employee-role').click();await page.locator('#employee-role').press('ArrowDown');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#employee-role').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#agent-form').count(),1);

  await page.locator('#agent-form [data-close-modal]').click();

  // A bound role cannot be deleted; the referencing employee is listed in place.
  await page.locator('.nav-item[data-view="roles"]').click();
  await page.locator('#roles-search').fill('界面验收角色');
  await page.locator(`[data-delete-role="${role.id}"]`).click();
  await page.locator('[data-confirm-configuration-delete]').click();
  await page.locator('[data-delete-error]', { hasText: employee.name }).waitFor();
  await page.locator('#modal-close').click();

  // Narrow window keeps the toolbar usable.
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(item => item.isVisible()); window.setSize(760, 800); });
  await page.waitForFunction(() => innerWidth <= 760);
  assert.ok(await roleIcon.isVisible(), 'role SVG remains visible in narrow icon-only navigation');
  const toolbar = await page.locator('#roles-view .directory-toolbar').evaluate(node => {
    const search = node.querySelector('input').getBoundingClientRect(), button = node.querySelector('button').getBoundingClientRect();
    return { separate: search.right <= button.left, fits: button.right <= innerWidth };
  });
  assert.deepEqual(toolbar, { separate: true, fits: true }, 'narrow layout keeps search and create on one usable row');
  await page.screenshot({ path: join(root, 'roles-narrow.png') });

  // Unbind, then deletion succeeds.
  await page.locator('.nav-item[data-view="agents"]').click();
  await page.locator(`[data-edit-agent="${employee.id}"]`).click();
  await page.locator('#employee-role-selection [data-remove-extension]').first().waitFor();
  await page.screenshot({path:join(root,'employee-multiple-roles-narrow.png')});
  while(await page.locator('#employee-role-selection [data-remove-extension]').count())await page.locator('#employee-role-selection [data-remove-extension]').first().click();
  await page.locator('#agent-form [type=submit]').click();
  await page.locator('#agent-form').waitFor({ state: 'detached' });
  assert.deepEqual((await api('/api/agents', null, 'GET')).agents.find(item => item.id === employee.id).roleIds, []);
  await page.locator('.nav-item[data-view="roles"]').click();
  await page.locator('#roles-search').fill('界面验收角色');
  await page.locator(`[data-delete-role="${role.id}"]`).click();
  await page.locator('[data-confirm-configuration-delete]').click();
  await page.locator('#modal-backdrop[aria-hidden="true"]').waitFor({ state: 'attached' });
  assert.equal((await api('/api/roles', null, 'GET')).roles.some(item => item.id === role.id), false);
  await page.getByText('没有匹配的角色', { exact: true }).waitFor();

  await page.screenshot({ path: join(root, 'roles-ui.png') });
  const source=join(root,'partial-plugin');
  await mkdir(join(source,'.claude-plugin'),{recursive:true});await mkdir(join(source,'skills/good'),{recursive:true});await mkdir(join(source,'skills/bad'),{recursive:true});await mkdir(join(source,'agents'));await mkdir(join(source,'hooks'));
  await writeFile(join(source,'.claude-plugin/plugin.json'),'{"name":"partial-ui"}');
  await writeFile(join(source,'skills/good/SKILL.md'),'---\nname: good\ndescription: Good skill\n---\nGood');
  await writeFile(join(source,'skills/bad/SKILL.md'),'---\nname: [bad\n---\nPRIVATE_SENTINEL');
  await writeFile(join(source,'agents/bad.md'),'---\nname: bad\ntools: 42\n---\nPRIVATE_SENTINEL');
  await writeFile(join(source,'hooks/hooks.json'),'invalid PRIVATE_SENTINEL');
  await page.goto(origin+'/marketplace');await page.locator('[data-install-plugin]').click();
  await page.locator('[name=sourceType][value=local]').check();await page.locator('#market-source').fill(source);await page.locator('#market-entry-form [type=submit]').click();
  await page.getByRole('heading',{name:'⚠️ 插件安装存在错误',exact:true}).waitFor();
  const warning=page.locator('#modal-content [role=alert]');assert.equal(await warning.locator('li').count(),3);assert.doesNotMatch(await warning.textContent(),/PRIVATE_SENTINEL/);
  for(const path of ['skills/bad/SKILL.md','agents/bad.md','hooks/hooks.json'])assert.ok((await warning.textContent()).includes(path));
  await page.locator('#modal-backdrop.open').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({path:join(root,'partial-install-warning-narrow.png'),animations:'disabled'});
  await page.getByRole('button',{name:'知道了',exact:true}).click();
  await page.locator('[data-market-list] .agent-card').filter({hasText:'partial-ui'}).getByRole('button',{name:'详情',exact:true}).click();
  await page.locator('[data-extension-detail-body] [role=alert]').waitFor();
  assert.equal(await page.locator('[data-extension-detail-body] [role=alert] li').count(),3);
  await page.waitForTimeout(250);
  await page.screenshot({path:join(root,'partial-install-detail.png'),animations:'disabled'});
  await page.locator('#modal-close').click();
  // Current HTTP and actual CLI agree on role arrays and reject the retired field.
  const old=await page.evaluate(async id=>{const r=await fetch('/api/agents/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({roleId:null})});return r.status;},employee.id);assert.equal(old,400);

  await page.goto(origin+'/agents');await page.locator('[data-action="new-agent"]').click();
  await page.locator('#agent-form [name=name]').fill('框内多选新建员工');
  const roleCandidate=(await api('/api/roles',null,'GET')).roles[0];
  for(const [inputId,item] of [['employee-role',roleCandidate],['employee-plugin-search',pickerPlugins[0]],['employee-mcp-search',pickerMcps[0]]]){
    const input=page.locator('#'+inputId);await input.click();await input.fill(item.name);
    const picker=input.locator('xpath=ancestor::*[contains(@class,"extension-picker-search")]');
    const control=await picker.locator('.extension-picker-control').boundingBox();
    await page.mouse.move(control.x+control.width/2,control.y+control.height-2);await page.mouse.move(control.x+control.width/2,control.y+control.height+2);
    assert.equal(await input.getAttribute('aria-expanded'),'true','the 4px gap remains inside the picker hover region');
    await picker.locator(`[data-add-extension="${item.id}"]`).click();
    assert.equal(await picker.locator('.extension-chip').count(),1);
  }
  const createdResponse=page.waitForResponse(response=>response.url().endsWith('/api/agents') && response.request().method()==='POST');
  await page.locator('#agent-form [type=submit]').click();const created=await (await createdResponse).json();assert.deepEqual(created.agent.roleIds,[roleCandidate.id]);
  assert.deepEqual(created.agent.runtime.extensionSelection,{pluginIds:[pickerPlugins[0].id],mcpIds:[pickerMcps[0].id]});
  await page.locator('#agent-form').waitFor({state:'detached'});
  const cli=(args,input='')=>new Promise((resolvePromise,reject)=>{
    const child=spawn(process.execPath,['cli/main.mjs',...args,'--endpoint-file',join(data,'desktop-endpoint.json'),'--session-file',join(root,'cli-session.json'),'--json'],{env:{...process.env,HOME:home},stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('close',code=>code===0?resolvePromise(JSON.parse(output).data):reject(new Error('CLI failed '+error)));child.stdin.end(input);
  });
  await cli(['auth','login','--username','roles-ui','--password-stdin'],password+'\n');
  const remaining=(await api('/api/roles',null,'GET')).roles.slice(0,2).map(item=>item.id);
  await cli(['agents','update',employee.id,'--file','-'],JSON.stringify({roleIds:remaining}));
  assert.deepEqual((await api('/api/agents',null,'GET')).agents.find(item=>item.id===employee.id).roleIds,remaining);
  await cli(['agents','update',employee.id,'--file','-'],JSON.stringify({roleIds:[]}));
  console.log('PASS roles UI acceptance and authenticated CLI arrays; evidence: ' + root);
} finally {
  await app.close();
}
