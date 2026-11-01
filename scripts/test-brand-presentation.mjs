// Real isolated Electron presentation QA, no Provider calls or operator data.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';
import { createCatalogFixtureStore } from '../tests/fixture-store.mjs';

await mkdir('.data', { recursive: true });
const root = await mkdtemp(resolve('.data/brand-presentation-'));
const bundle = process.env.AGENTFORGE_BRAND_APP, home = join(root, 'home');
const data = bundle ? join(home, '.agentforge/desktop') : join(root, 'client');
await mkdir(home, { recursive: true });
const password = randomBytes(24).toString('hex');
const auth = createAuth({ databasePath: join(data, 'auth.sqlite') });
await auth.setAdministrator('brand-qa', password); auth.close();
await writeFile(join(data, 'desktop-preferences.json'), JSON.stringify({closeMode:'tray'}), {mode:0o600});
const store = createCatalogFixtureStore({ databasePath: join(data, 'agentforge.sqlite'), workspaceRoot: join(root, 'work') });
store.updateAgent('agent_analyst', { status: 'inactive' }); store.close();
const source = join(root, 'plugin');
await mkdir(join(source, '.claude-plugin'), { recursive: true });
await mkdir(join(source, 'skills/brand'), { recursive: true });
await writeFile(join(source, 'skills/brand/SKILL.md'), '---\nname: brand\ndescription: Presentation fixture only\n---\nNo execution.');
await writeFile(join(source, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'brand-presentation-fixture', description: '仅用于静态展示，不执行插件。', version: '1.0.0', settings: {} }));
const app = await electron.launch({ ...(bundle ? { executablePath: resolve(bundle, 'Contents/MacOS/AgentForge') } : {}), args: bundle ? [] : ['apps/electron/main.mjs'], env: { ...process.env, HOME: home, AGENTFORGE_DESKTOP_DATA_ROOT: data, AGENTFORGE_LOG_DIR: join(root, 'logs') }, timeout: 90000 });
const evidence = { root, bundle: bundle || 'source', cases: [] }, errors = [];
const presentation = node => { const c = getComputedStyle(node); return Object.fromEntries(['backgroundColor','color','borderTopColor','borderTopWidth','borderTopStyle','borderRadius','padding','margin','fontSize','lineHeight'].map(k => [k, c[k]])); };
const luminance = rgb => { const v = rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return .2126*v[0] + .7152*v[1] + .0722*v[2]; };
const contrast = style => { const a = luminance(style.color), b = luminance(style.backgroundColor); return (Math.max(a,b)+.05)/(Math.min(a,b)+.05); };
try {
  const page = await app.firstWindow({ timeout: 90000 }); page.on('pageerror', e => errors.push(e.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 60000 });
  const origin = new URL(page.url()).origin; console.log('Client ready');
  await page.goto(origin + '/login'); await page.locator('#username').fill('brand-qa'); await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('#account-name').waitFor();
  const api = (path, body) => page.evaluate(async ({ path, body }) => { const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); const value = await r.json(); if (!r.ok) throw Error(JSON.stringify(value)); return value; }, { path, body });
  console.log('Importing display fixtures');
  await api('/api/runtime/marketplace', { path: source });
  await api('/api/runtime/mcp-marketplace', { name:'品牌 MCP 展示夹具', description:'静态展示夹具，不执行服务。', content:JSON.stringify({ mcpServers:{ fixture:{ command:'node', args:['--version'], cwd:root } } }) });
  const resize = async (width, height) => { await app.evaluate(({ BrowserWindow }, {origin,width,height}) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(origin)).setContentSize(width,height), {origin,width,height}); await page.waitForFunction(w => innerWidth === w, width); };
  for (const theme of ['minimal','warm']) {
    await page.goto(origin + '/settings/appearance'); await page.locator(`[name=theme][value=${theme}]`).check();
    for (const width of [1320,760]) { console.log('Checking',theme,width);
      await resize(width,760);
      await page.goto(origin + '/roles'); await page.locator('#roles-empty').waitFor();
      const empty = await page.locator('#roles-empty').evaluate(presentation);
      assert.equal(empty.borderTopStyle,'dashed'); assert.equal(empty.borderTopWidth,'1px'); assert.equal(empty.margin,'0px'); assert.ok(contrast(empty) >= 4.5, 'empty text contrast');
      await page.locator('#roles-search').fill('不存在'); assert.match(await page.locator('#roles-empty').innerText(),/没有匹配/); assert.deepEqual(await page.locator('#roles-empty').evaluate(presentation),empty);
      await page.locator('#roles-search').clear();
      const button = await page.locator('#roles-view .primary-button').evaluate(presentation); assert.ok(contrast(button) >= 4.5, 'primary button text contrast');
      await page.locator('#roles-search').focus(); await page.keyboard.press('Tab'); assert.equal(await page.locator('#roles-view .primary-button').evaluate(n => n === document.activeElement),true);
      const focus = await page.locator('#roles-view .primary-button').evaluate(n => ({width:getComputedStyle(n).outlineWidth,style:getComputedStyle(n).outlineStyle})); assert.notEqual(focus.width,'0px'); assert.equal(focus.style,'solid');
      await page.screenshot({ path:join(root,`${theme}-${width}-roles.png`) });
      let supportStyle;
      for (const view of ['marketplace','mcp-marketplace']) {
        await page.goto(origin + '/' + view); await page.locator('[data-market-list] .agent-card').first().waitFor();
        assert.equal(await page.locator('[data-market-list] .runtime-support, [data-market-list] .extension-runtime-badges').count(),0,'market cards omit Runtime support labels');
        assert.equal(await page.locator('[data-market-list] .extension-card-meta').first().locator('span').count(),1,'card metadata contains only version or ID');
        await page.locator('[data-extension-detail]').first().click(); await page.locator('.extension-detail-overview').waitFor();
        if(view==='marketplace') {
          const supported=await page.locator('.plugin-runtime-compatibility .runtime-support[data-supported=true]').first().evaluate(presentation);
          const unsupported=await page.locator('.plugin-runtime-compatibility .runtime-support[data-supported=false]').first().evaluate(presentation);
          assert.ok(contrast(supported)>=4.5);assert.ok(contrast(unsupported)>=4.5);
          supportStyle=supported;
        }
        assert.equal(await page.locator('.extension-detail-overview .agent-card-avatar').evaluate(n => { const c=getComputedStyle(n);return c.color===c.backgroundColor; }),false);
        await page.locator('[data-close-modal]').click();
        await page.screenshot({ path:join(root,`${theme}-${width}-${view}.png`) });
        await page.getByRole('searchbox').fill('不存在'); await page.locator('[data-market-empty]').filter({ hasText:'没有匹配的' }).waitFor();
        assert.deepEqual(await page.locator('[data-market-empty]').evaluate(presentation),empty,'all three directory empty styles match');
        assert.equal(await page.locator('[data-market-list]').isHidden(),true);
        await page.screenshot({ path:join(root,`${theme}-${width}-${view}-empty.png`) });
      }
      await page.goto(origin + '/agents'); await page.locator('.agent-status[data-status=active]').first().waitFor();
      const activeColor = await page.locator('.agent-status[data-status=active]').first().evaluate(n => getComputedStyle(n).color);
      assert.equal(activeColor,supportStyle.color,'employee availability and supported Runtime use one accent');
      const inactive = await page.locator('.agent-status[data-status=inactive]').evaluate(presentation); assert.ok(contrast(inactive)>=4.5); assert.notEqual(inactive.color,activeColor);
      const avatarStyles = await page.locator('.agent-card-avatar').evaluateAll(nodes => nodes.map(n => ({color:getComputedStyle(n).color,backgroundColor:getComputedStyle(n).backgroundColor})));
      assert.ok(avatarStyles.every(s => contrast(s) >= 4.5),'avatar initials contrast');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
      await page.waitForFunction(() => document.querySelector('.application-icon')?.naturalWidth===1024);
      const icon = await page.locator('.application-icon').evaluate(n => {
        const style=getComputedStyle(n), canvas=document.createElement('canvas'); canvas.width=canvas.height=1024;
        const c=canvas.getContext('2d');c.drawImage(n,0,0);const pixel=(x,y)=>[...c.getImageData(x,y,1,1).data];
        return {border:style.borderTopWidth,background:style.backgroundColor,shadow:style.boxShadow,corner:pixel(0,0),edge:pixel(512,2),width:n.width,height:n.height};
      });
      assert.equal(icon.border,'0px');assert.equal(icon.background,'rgba(0, 0, 0, 0)');assert.equal(icon.shadow,'none');
      assert.equal(icon.corner[3],0);assert.equal(icon.edge[3],255);assert.ok(Math.min(...icon.edge.slice(0,3))<100,'no white matte');
      assert.equal(icon.width,icon.height,'no distorted sidebar image');
      await page.screenshot({ path:join(root,`${theme}-${width}-agents.png`) });
      // Every directory uses the exact same surface and spans its full content row.
      const checkEmpty = async (selector, reference) => {
        const node=page.locator(selector); await node.waitFor();
        assert.deepEqual(await node.evaluate(presentation),empty,`${selector}: shared computed style`);
        const box=await node.boundingBox(), row=await page.locator(reference).boundingBox();
        assert.ok(Math.abs(box.x-row.x)<1 && Math.abs(box.x+box.width-row.x-row.width)<1,`${selector}: both edges align with full row`);
        assert.ok(box.height<=80,`${selector}: compact two-line height`);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      };
      for(const view of ['tasks','teams','workflows','agents','roles','marketplace','mcp-marketplace']) {
        await page.goto(origin+'/'+view);
        if(view==='tasks') {
          await page.locator('#task-search-form').waitFor();
          await page.locator('#task-search-form').getByRole('searchbox').fill('no-directory-match');
          await page.locator('#task-search-form').getByRole('button',{name:'搜索',exact:true}).click();
        } else {
          await page.getByRole('searchbox').fill('no-directory-match');
        }
        const selector=`#${view}-view .directory-empty`;
        await page.locator(selector).filter({hasText:'没有匹配的'}).waitFor();
        await checkEmpty(selector, view==='tasks'?'#task-search-form':`#${view}-view .directory-toolbar`);
        assert.equal(await page.locator('#live-indicator').count(),1);
        assert.equal(await page.locator('.user-card #live-indicator').count(),1);
        assert.equal(await page.locator('.topbar #live-indicator').count(),0);
        assert.equal(await page.locator('#live-indicator').isVisible(),true);
        await page.locator('#account-name').evaluate(n=>n.textContent='较长的管理员名称用于检查侧栏对齐');
        const sync=await page.locator('#live-indicator').boundingBox(),footer=await page.locator('.user-card').boundingBox();
        assert.ok(sync.x>=footer.x && sync.x+sync.width<=footer.x+footer.width+1,'sync stays within account footer');
        assert.ok(await page.locator('#live-indicator').getAttribute('aria-label'));
        await page.screenshot({path:join(root,`${theme}-${width}-${view}-aligned-empty.png`)});
      }
      await page.goto(origin+'/communication');
      await page.locator('[data-new-chat]').click();
      await page.locator('#communication-search').fill('no-directory-match');
      await checkEmpty('.communication-picker-list .directory-empty','#communication-search');
      await page.screenshot({path:join(root,`${theme}-${width}-communication-empty.png`)});
      await page.getByRole('button',{name:'关闭选择',exact:true}).click();
      evidence.cases.push({theme,width,empty,supported:supportStyle,button,activeColor,directories:8});
    }
  }
  const resources = bundle ? resolve(bundle,'Contents/Resources/app.asar/web/icons') : resolve('web/icons');
  const nativeIcons = await app.evaluate(({nativeImage}, root) => {
    const template=nativeImage.createFromPath(root+'/trayTemplate.png');
    const dock=nativeImage.createFromPath(root+'/application-dock.png');
    const data=dock.toBitmap();let minX=1024,minY=1024,maxX=-1,maxY=-1;
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(data[(y*1024+x)*4+3]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    return {template:template.isTemplateImage(),size:template.getSize(),scales:template.getScaleFactors(),dockBounds:[minX,minY,maxX+1,maxY+1]};
  },resources);
  assert.equal(nativeIcons.template,true);assert.deepEqual(nativeIcons.size,{width:18,height:18});
  assert.deepEqual(nativeIcons.scales,[1,2]);assert.deepEqual(nativeIcons.dockBounds,[100,100,924,924]);
  evidence.nativeIcons=nativeIcons;
  // The same full-width surface also represents a real HTTP read failure honestly.
  await page.route('**/api/runtime/marketplace', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'品牌验收：读取失败'})}));
  await page.goto(origin + '/marketplace'); await page.locator('[data-market-empty][role=alert]').waitFor();
  assert.match(await page.locator('[data-market-empty]').innerText(),/读取失败/);
  assert.equal(await page.locator('[data-market-list]').isHidden(),true);
  await page.screenshot({path:join(root,'read-failure.png')});
  // Native confirmation loads compact.css without the renderer stylesheet.
  const dialogFile = bundle ? resolve(bundle,'Contents/Resources/app.asar/apps/electron/cli-confirmation.html') : resolve('apps/electron/cli-confirmation.html');
  await app.evaluate(async ({ BrowserWindow }, file) => {
    const preview = new BrowserWindow({ width:560,height:470,show:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'brand-native-preview'} });
    await preview.loadFile(file);
  },dialogFile);
  const dialog = app.windows().find(p=>p.url().includes('/cli-confirmation.html')); assert.ok(dialog);
  await dialog.locator('[data-choice=install]').waitFor();
  const dialogButton = await dialog.locator('[data-choice=install]').evaluate(presentation);
  assert.equal(dialogButton.backgroundColor,'rgb(37, 88, 217)'); assert.ok(contrast(dialogButton)>=4.5,'native dialog retains readable brand action without renderer tokens');
  await dialog.screenshot({path:join(root,'native-dialog.png')}); await dialog.locator('[data-choice=cancel]').click();
  await app.evaluate(({ BrowserWindow })=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/cli-confirmation.html'))?.destroy());
  assert.deepEqual(errors,[]); evidence.result='PASS'; await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log('PASS brand presentation:',root);
} catch(error) { console.error('Evidence:',root);throw error; }
finally {await app.close();}
