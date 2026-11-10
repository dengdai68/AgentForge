// Isolated desktop editing regression. No model calls or operator data changes.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createFixtureStore } from '../tests/fixture-store.mjs';
import { createAuth } from '../server/auth.mjs';
import { writeStorageLocation } from '../server/storage-layout.mjs';

const root = await mkdtemp(join(tmpdir(), 'agentforge-composer-caret-'));
const home = join(root, 'home'), data = join(home, '.agentforge/desktop'), workspace = join(root, 'work');
await mkdir(home, { recursive: true });
const password = randomBytes(20).toString('hex');
const auth = createAuth({ databasePath: join(data, 'auth.sqlite') });
await auth.setAdministrator('caret-qa', password); auth.close();
const store = createFixtureStore({ databasePath: join(workspace, 'records/agentforge.sqlite'), configurationDirectory: data, workspaceRoot: workspace });
store.setPluginUpdateSettings({ enabled: false });
const agents = store.listAgents().filter(row => row.status === 'active');
const privateChat = store.openCommunication({ kind: 'agent', targetId: agents[0].id });
const group = store.openCommunication({ kind: 'group', name: '光标回归夹具', memberAgentIds: agents.slice(0, 2).map(row => row.id) });
const run = store.createRun(store.listTasks()[0].id); store.pauseRun(run.id); store.close();
await writeStorageLocation(data, { version: 1, workspaceRoot: workspace, previousRuntimeRoots: [] });
const bundle = process.env.AGENTFORGE_COMPOSER_APP;
const app = await electron.launch({ ...(bundle ? { executablePath: join(resolve(bundle), 'Contents/MacOS/AgentForge') } : {}), args: bundle ? [] : ['apps/electron/main.mjs'], env: { ...process.env, HOME: home, AGENTFORGE_DESKTOP_DATA_ROOT: data, AGENTFORGE_LOG_DIR: join(root, 'logs') }, timeout: 60000 });
const evidence = { root, packaged: Boolean(bundle), cases: [], pageErrors: [] };
try {
  const page = await app.firstWindow(); page.on('pageerror', error => evidence.pageErrors.push(error.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
  const origin = new URL(page.url()).origin;
  await page.goto(origin + '/login'); await page.locator('#username').fill('caret-qa'); await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('#account-name').waitFor();
  for (const [theme, width] of [['minimal', 1280], ['warm', 760]]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 850), width);
    for (const [name, path, selector] of [['private', `/communication/${privateChat.id}`, '#communication-input'], ['group', `/communication/${group.id}`, '#communication-input'], ['task', `/runs/${run.id}`, '#instruction-text']]) {
      await page.goto(origin + path); const input = page.locator(selector); await input.waitFor();
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      // Capture submit without sending a real message or waking a Provider.
      await input.evaluate(el => { el.form.dataset.submits = '0'; el.form.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); el.form.dataset.submits = String(Number(el.form.dataset.submits) + 1); }, true); });
      const draft = Array.from({ length: 25 }, (_, i) => `第${i + 1}行：换行后应看到光标。`).join('\n');
      const metrics = () => input.evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight, line: parseFloat(getComputedStyle(el).lineHeight), height: el.clientHeight, padding: parseFloat(getComputedStyle(el).paddingTop), selection: el.selectionEnd, length: el.value.length }));
      for (const key of ['Shift+Enter', 'Meta+Enter', 'Alt+Enter', 'Control+Enter']) {
        await input.fill(draft); await input.press('Meta+ArrowDown');
        for (let i = 0; i < 8; i++) await input.press(key);
        assert.equal(await input.inputValue(), draft + '\n'.repeat(8));
        const m = await metrics(); assert.ok(m.top > 0 && m.max - m.top <= m.padding + m.line / 2 + 2, `${name} ${key}: end caret hidden ${JSON.stringify(m)}`);
      }
      // A middle edit must follow that caret, not force the end of the draft.
      const short = Array.from({ length: 40 }, (_, i) => `行${i}`).join('\n');
      for (const key of ['Shift+Enter', 'Meta+Enter', 'Alt+Enter', 'Control+Enter']) {
        await input.fill(short); await input.press('Meta+ArrowUp');
        for (let i = 0; i < 5; i++) await input.press('ArrowDown');
        for (let i = 0; i < 5; i++) await input.press(key);
        const m = await metrics(), row = (await input.inputValue()).slice(0, m.selection).split('\n').length - 1;
        assert.ok(row * m.line + m.padding - m.top >= -2 && (row + 1) * m.line + m.padding - m.top <= m.height + 4, `${name} ${key}: middle caret hidden ${JSON.stringify(m)}`);
        assert.ok(m.top < m.max / 2, 'middle editing must not jump to bottom');
      }
      // Soft wraps and replacement selection use the actual narrow/wide editor.
      await input.fill('长文本自动折行。'.repeat(300)); await input.press('Meta+ArrowDown'); await input.press('Shift+Enter');
      let m = await metrics(); assert.ok(m.max - m.top <= m.padding + m.line / 2 + 2);
      await input.fill(draft); await input.press('Meta+ArrowDown'); await input.press('Shift+Enter'); await input.press('Meta+z'); assert.equal(await input.inputValue(), draft, 'native newline undo');
      await input.fill('第一行\n被替换内容\n最后一行'); await input.evaluate(el => el.setSelectionRange(4, 9)); await input.press('Shift+Enter'); assert.equal(await input.inputValue(), '第一行\n\n\n最后一行');
      await input.fill('中文输入中'); await input.evaluate(el => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })); });
      assert.equal(await input.evaluate(el => el.form.dataset.submits), '0', 'IME Enter must not send');
      if (name !== 'private') { await input.fill('@'); await input.press('Enter'); assert.match(await input.inputValue(), /^@.+ /); assert.equal(await input.evaluate(el => el.form.dataset.submits), '0', '@ selection must not send'); }
      await input.fill('只验证发送快捷键，不发送到模型'); await input.press('Enter'); assert.equal(await input.evaluate(el => el.form.dataset.submits), '1');
      await input.fill(draft); await input.press('Meta+ArrowDown'); await input.press('Shift+Enter');
      if (name === 'task') {
        const before = await metrics();
        const message = await page.evaluate(async runId => {
          const response = await fetch(`/api/runs/${runId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '隔离夹具：编辑长草稿时收到新记录，任务保持暂停。' }) });
          if (!response.ok) throw new Error(`Fixture message HTTP ${response.status}`);
          return (await response.json()).message;
        }, run.id);
        await page.locator(`[data-collaboration-record="${message.id}"]`).waitFor();
        const after = await metrics(); assert.equal(after.selection, before.selection); assert.ok(Math.abs(after.top - before.top) <= 2, 'incoming collaboration must preserve the draft viewport');
        assert.equal(await input.evaluate(el => document.activeElement === el), true, 'incoming collaboration must preserve typing focus');
      }
      await input.screenshot({ path: join(root, `${name}-${theme}.png`) });
      evidence.cases.push({ name, theme, width, caret: await metrics() });
    }
  }
  assert.deepEqual(evidence.pageErrors, []); evidence.status = 'passed'; console.log(JSON.stringify(evidence));
} catch (error) { evidence.error = error.message; throw error; }
finally { await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); await app.close(); }
