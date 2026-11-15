import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { build } from 'esbuild';
import { create, createAnnotation, recordHuman, write, parse, sourceOnly } from '../../skills/ux-prototype/scripts/document.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = `<!doctype html><html><head><title>跨页面原型</title><style>
  body{font:16px system-ui;padding:32px} button,input{padding:12px;margin:8px} [hidden]{display:none!important}
  </style></head><body>
  <nav><button id="show-page-a">第一页</button><button id="show-page-b">第二页</button><button id="show-dialog">打开确认弹窗</button></nav>
  <input id="business-input" placeholder="业务输入">
  <section id="page-a"><h1>第一页</h1><button id="visible-help" data-ux-anchor="visible-help">当前页说明目标</button><button id="visible-action" data-ux-anchor="visible-action">当前页操作</button></section>
  <section id="page-b" hidden><h1>第二页</h1><button id="page-b-action" data-ux-anchor="page-b-action">第二页操作</button></section>
  <dialog id="confirm-dialog"><button id="dialog-confirm" data-ux-anchor="dialog-confirm">弹窗确认</button></dialog>
  <script>
  window.__businessActions={pages:0,dialogs:0,submits:0};
  for(const name of ['a','b']) document.querySelector('#show-page-'+name).onclick=()=>{
    window.__businessActions.pages++;
    document.querySelector('#page-a').hidden=name!=='a'; document.querySelector('#page-b').hidden=name!=='b';
  };
  document.querySelector('#show-dialog').onclick=()=>{window.__businessActions.dialogs++;document.querySelector('#confirm-dialog').showModal();};
  for(const id of ['visible-help','visible-action','page-b-action','dialog-confirm']) document.getElementById(id).onclick=()=>window.__businessActions.submits++;
  </script></body></html>`;

const hiddenBody = '**第二页输入说明**\n\n' + Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 条业务规则：跨页面查看时也应完整保留这段说明。`).join('\n\n') + '\n\n第二页说明的最后一句：保存后返回列表。';
const annotations = [
  createAnnotation({ id: 'ann-visible', kind: 'explanation', body: '**当前页说明**\n\n点击前保留输入内容。', anchor: { kind: 'element', id: 'visible-help', selector: '#visible-help', text: '当前页说明目标' } }),
  createAnnotation({ id: 'ann-page-b', kind: 'explanation', body: hiddenBody, anchor: { kind: 'element', id: 'page-b-action', selector: '#page-b-action', text: '第二页操作' } }),
  createAnnotation({ id: 'ann-dialog', kind: 'change-request', body: '弹窗确认前展示待提交内容。', anchor: { kind: 'element', id: 'dialog-confirm', selector: '#dialog-confirm', text: '弹窗确认' } }),
  createAnnotation({ id: 'ann-missing', kind: 'change-request', status: 'resolved', body: '已处理：旧按钮替换为新操作入口。', anchor: { kind: 'element', id: 'removed-action', selector: '#removed-action', text: '旧按钮' } }),
  createAnnotation({ id: 'ann-action', kind: 'change-request', body: '当前页操作需要防止重复提交。', anchor: { kind: 'element', id: 'visible-action', selector: '#visible-action', text: '当前页操作' } }),
];
const initial = create({ title: '跨页面标注目录测试', prd: '# 需求\n\n原始 PRD 内容。' });
const doc = recordHuman(initial, { ...initial, annotations: Object.fromEntries(annotations.map(annotation => [annotation.id, annotation])) }, '补充跨页面评审意见');
const snapshot = { path: '/workspace/annotation-index.ux.html', name: 'annotation-index.ux.html', version: '1', html: write(source, doc) };
let server, browser, directory, origin;

before(async () => {
  directory = await fs.mkdtemp(resolve(os.tmpdir(), 'ux-annotation-index-'));
  server = await createServer({ root, cacheDir: resolve(directory, 'vite'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

async function openPage(t) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(snapshot => {
    window.__saves = []; window.__locations = [];
    addEventListener('message', event => { if (event.data?.channel === 'craft-ux-preview' && event.data?.type === 'located') window.__locations.push(event.data); });
    window.__UX_REVIEW_HOST__ = { read: async () => snapshot, save: async args => { window.__saves.push(args); return { ...snapshot, html: args.html, version: '2' }; } };
  }, snapshot);
  await page.goto(origin);
  await page.getByRole('tab', { name: /^标注/ }).waitFor();
  await page.frameLocator('iframe').locator('#visible-help').waitFor();
  return page;
}

const indexTab = page => page.getByRole('tab', { name: /^标注/ });
const rows = page => page.locator('[data-annotation-index-id]');
const row = (page, id) => page.locator(`[data-annotation-index-id="${id}"]`);
const rowIds = page => rows(page).evaluateAll(elements => elements.map(element => element.dataset.annotationIndexId));
const frame = page => page.frameLocator('iframe');
async function locate(page, id) {
  await page.evaluate(() => { window.__locations = []; });
  await row(page, id).getByRole('button', { name: /^定位标注/ }).click();
  await page.waitForFunction(id => window.__locations.some(location => location.id === id), id);
  return page.evaluate(id => window.__locations.findLast(location => location.id === id), id);
}

test('the index includes full off-page annotations and has independent search, type and status filters', { timeout: 30000 }, async t => {
  const page = await openPage(t);
  await page.getByLabel('筛选标注', { exact: true }).click();
  await page.getByLabel('标注类型筛选', { exact: true }).selectOption('change-request');
  await page.getByLabel('处理状态筛选', { exact: true }).selectOption('resolved');
  await page.keyboard.press('Escape');
  await indexTab(page).click();
  assert.deepEqual(await rowIds(page), annotations.map(annotation => annotation.id), 'Canvas filters must not hide annotations from the document index');
  const secondPage = row(page, 'ann-page-b');
  assert.match(await secondPage.innerText(), /第二页说明的最后一句：保存后返回列表。/);
  await secondPage.getByText('第二页说明的最后一句：保存后返回列表。', { exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await secondPage.getByText('第二页说明的最后一句：保存后返回列表。', { exact: true }).isVisible(), true);
  assert.equal(await secondPage.locator('strong').filter({ hasText: '第二页输入说明' }).isVisible(), true, 'The list renders the complete Markdown body');
  assert.equal(await secondPage.evaluate(element => getComputedStyle(element).webkitLineClamp), 'none');
  assert.equal(await frame(page).locator('#page-b').isVisible(), false);
  assert.equal(await rows(page).getByRole('textbox', { name: '标注正文', exact: true }).count(), 0, 'The index must not duplicate canvas editors');

  await page.getByLabel('搜索标注', { exact: true }).fill('保存后返回列表');
  assert.deepEqual(await rowIds(page), ['ann-page-b'], 'Search must include the end of a long hidden annotation');
  await page.getByLabel('搜索标注', { exact: true }).fill('');
  await page.getByLabel('列表标注类型', { exact: true }).selectOption('change-request');
  assert.deepEqual(await rowIds(page), ['ann-dialog', 'ann-missing', 'ann-action']);
  await page.getByLabel('列表处理状态', { exact: true }).selectOption('resolved');
  assert.deepEqual(await rowIds(page), ['ann-missing']);
  await page.getByLabel('列表处理状态', { exact: true }).selectOption('open');
  assert.deepEqual(await rowIds(page), ['ann-dialog', 'ann-action']);
  await page.getByLabel('列表标注类型', { exact: true }).selectOption('all');
  await page.getByLabel('列表处理状态', { exact: true }).selectOption('all');
  assert.equal(await rows(page).count(), annotations.length);
  assert.deepEqual(await frame(page).locator('body').evaluate(() => window.__businessActions), { pages: 0, dialogs: 0, submits: 0 });
});

test('locating from the index restores the canvas, turns annotations on and clears canvas filters that hide the target', { timeout: 30000 }, async t => {
  const page = await openPage(t);
  await frame(page).locator('#business-input').fill('页面业务输入不能丢失');
  await page.getByLabel('筛选标注', { exact: true }).click();
  await page.getByLabel('标注类型筛选', { exact: true }).selectOption('change-request');
  await page.getByLabel('处理状态筛选', { exact: true }).selectOption('resolved');
  await page.keyboard.press('Escape');
  await page.getByLabel('关闭标注', { exact: true }).click();
  await indexTab(page).click();
  await page.getByRole('button', { name: /^全屏查看/ }).click();
  const location = await locate(page, 'ann-visible');
  assert.equal(location.found, true);
  assert.equal(location.visible, true);
  assert.equal(await page.locator('.uxw-docpanel.is-sidebar').isVisible(), true);
  assert.equal(await page.getByLabel('显示标注', { exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: '标注 1：交互说明', exact: true }).isVisible(), true);
  assert.equal(await row(page, 'ann-visible').getByRole('button', { name: /^定位标注/ }).getAttribute('aria-current'), 'true');
  await page.getByLabel('筛选标注', { exact: true }).click();
  assert.equal(await page.getByLabel('标注类型筛选', { exact: true }).inputValue(), 'all');
  assert.equal(await page.getByLabel('处理状态筛选', { exact: true }).inputValue(), 'all');
  assert.equal(await frame(page).locator('#business-input').inputValue(), '页面业务输入不能丢失');
  assert.deepEqual(await frame(page).locator('body').evaluate(() => window.__businessActions), { pages: 0, dialogs: 0, submits: 0 });
});

test('hidden and missing targets report how to open them without running business actions; manually opened pages become locatable', { timeout: 30000 }, async t => {
  const page = await openPage(t);
  await indexTab(page).click();
  for (const [id, found] of [['ann-page-b', true], ['ann-dialog', true], ['ann-missing', false]]) {
    const location = await locate(page, id);
    assert.equal(location.found, found);
    assert.equal(location.visible, false);
    await page.getByRole('status').filter({ hasText: /对应页面或弹窗/ }).waitFor();
    assert.equal(await row(page, id).getByRole('button', { name: /^定位标注/ }).getAttribute('aria-current'), 'true');
    assert.deepEqual(await frame(page).locator('body').evaluate(() => window.__businessActions), { pages: 0, dialogs: 0, submits: 0 }, 'Index navigation must not execute prototype business actions');
    await page.getByLabel('关闭提示', { exact: true }).click();
  }
  assert.equal(await frame(page).locator('#confirm-dialog').evaluate(dialog => dialog.open), false);
  // This is the fixture's explicit user navigation; locating the annotation
  // above must never synthesize this business action on the user's behalf.
  await frame(page).locator('#show-page-b').evaluate(button => button.click());
  const location = await locate(page, 'ann-page-b');
  assert.equal(location.found, true);
  assert.equal(location.visible, true);
  assert.equal(await frame(page).locator('#page-b').isVisible(), true);
  assert.deepEqual(await frame(page).locator('body').evaluate(() => window.__businessActions), { pages: 1, dialogs: 0, submits: 0 });
});

test('PRD, annotations and changes use keyboard tabs and preserve the unsaved PRD through list navigation', { timeout: 30000 }, async t => {
  const page = await openPage(t);
  const prdTab = page.getByRole('tab', { name: 'PRD', exact: true });
  const changesTab = page.getByRole('tab', { name: /^变更/ });
  assert.equal(await page.getByRole('tablist').count(), 1);
  assert.equal(await page.getByRole('tab').count(), 3);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const draft = '# 未保存需求\n\n切换到标注或变更仍保留这段原文。';
  await page.getByLabel('PRD 正文', { exact: true }).fill(draft);
  await prdTab.focus();
  assert.equal(await prdTab.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await indexTab(page).evaluate(element => element === document.activeElement), true, await page.evaluate(() => JSON.stringify({ active: document.activeElement.textContent, nativeFocusGroup: Object.hasOwn(HTMLElement.prototype, 'focusGroup'), tabs: [...document.querySelectorAll('[role="tab"]')].map(tab => ({ text: tab.textContent, selected: tab.getAttribute('aria-selected'), tabIndex: tab.tabIndex })) })));
  assert.equal(await indexTab(page).getAttribute('aria-selected'), 'true');
  assert.equal(await rows(page).count(), annotations.length);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: /^全屏查看/ }).evaluate(element => element === document.activeElement), true, 'Tab must leave the tab group instead of visiting every inactive tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await indexTab(page).evaluate(element => element === document.activeElement), true, 'Returning to the tab group must focus its selected tab');
  await page.keyboard.press('ArrowRight');
  assert.equal(await changesTab.evaluate(element => element === document.activeElement), true);
  assert.equal(await changesTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByText('补充跨页面评审意见', { exact: true }).isVisible(), true);
  await page.keyboard.press('Home');
  assert.equal(await prdTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByLabel('PRD 正文', { exact: true }).inputValue(), draft);
  await page.keyboard.press('End');
  assert.equal(await changesTab.getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowLeft');
  await locate(page, 'ann-visible');
  await prdTab.click();
  assert.equal(await page.getByLabel('PRD 正文', { exact: true }).inputValue(), draft);
  assert.equal(await page.getByText('未保存', { exact: true }).isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.__saves), [], 'Browsing the index must not save or replace the PRD');
});

test('a human annotation captures view and shared-tab context, survives stamping and save/reload, and restores its page from the index', { timeout: 30000 }, async t => {
  const navigationSource = `<!doctype html><html><head><title>人工标注导航</title><style>
    body{font:16px system-ui;padding:32px}button,input{padding:12px;margin:8px}
    </style></head><body>
    <div role="tablist"><button id="tab-catalog" type="button" role="tab" aria-controls="shared-panel" aria-selected="true">目录页</button><button id="tab-recent" type="button" role="tab" aria-controls="shared-panel" aria-selected="false">最近页</button></div>
    <section id="shared-panel" role="tabpanel"><h1 id="page-title">目录页</h1><p id="record-label">记录 A</p><form id="business-form"><input id="business-draft" aria-label="业务草稿" value="原始输入"><button id="shared-target" type="submit">提交共享记录</button></form></section>
    <script>
    window.selectedPage='catalog';window.recordId='record-a';window.submissions=0;window.inputEvents=0;window.reveals=[];
    document.querySelector('#business-form').onsubmit=event=>{event.preventDefault();window.submissions++;};
    document.querySelector('#business-draft').oninput=()=>window.inputEvents++;
    for(const key of ['catalog','recent']) document.querySelector('#tab-'+key).onclick=()=>{
      window.selectedPage=key;window.recordId=key==='catalog'?'record-a':'record-b';
      document.querySelector('#page-title').textContent=key==='catalog'?'目录页':'最近页';
      document.querySelector('#record-label').textContent=key==='catalog'?'记录 A':'记录 B';
      for(const tab of document.querySelectorAll('[role=tab]')) tab.setAttribute('aria-selected',String(tab.id==='tab-'+key));
    };
    window.__UX_REVIEW_NAVIGATION__={
      capture(element){return element.closest('#shared-panel')?{key:'record',label:'目录页记录 A',recordId:window.recordId}:null;},
      async reveal(view,anchor,{signal}){
        if(view.key!=='record'||signal.aborted)return false;
        window.reveals.push(view);window.recordId=view.recordId;
        document.querySelector('#record-label').textContent=view.recordId==='record-a'?'记录 A':'记录 B';
      }
    };
    </script></body></html>`;
  const initialSnapshot = { path: '/workspace/human-navigation.ux.html', name: 'human-navigation.ux.html', version: '1', html: write(navigationSource, create({ title: '人工标注导航', prd: '# 需求\n\n保留原始需求。' })) };
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(initialSnapshot => {
    if (window !== window.top) return;
    let current = JSON.parse(sessionStorage.getItem('annotation-host:snapshot') || 'null') || initialSnapshot;
    window.__saves = JSON.parse(sessionStorage.getItem('annotation-host:saves') || '[]');
    window.__readCount = Number(sessionStorage.getItem('annotation-host:reads') || 0);
    window.__locations = []; window.__captures = [];
    addEventListener('message', event => {
      if (event.data?.channel !== 'craft-ux-preview') return;
      if (event.data.type === 'located') window.__locations.push(event.data);
      if (event.data.type === 'contextmenu') window.__captures.push(event.data.anchor);
    });
    window.__UX_REVIEW_HOST__ = {
      read: async () => { sessionStorage.setItem('annotation-host:reads', String(++window.__readCount)); return current; },
      save: async args => {
        window.__saves.push(args);
        current = { ...current, html: args.html, version: String(Number(current.version) + 1) };
        sessionStorage.setItem('annotation-host:snapshot', JSON.stringify(current));
        sessionStorage.setItem('annotation-host:saves', JSON.stringify(window.__saves));
        return current;
      },
    };
  }, initialSnapshot);
  await page.goto(origin);
  await indexTab(page).waitFor();
  await frame(page).locator('#shared-target').waitFor();
  const clickInPrototype = async (selector, button = 'left') => {
    const target = await frame(page).locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
    const box = await page.locator('iframe').boundingBox(), scale = box.width / Number(await page.locator('iframe').getAttribute('width'));
    await page.mouse.click(box.x + target.x * scale, box.y + target.y * scale, { button });
  };
  await frame(page).locator('#business-draft').fill('业务输入不能写入标注上下文');
  assert.equal(await frame(page).locator('#shared-target').getAttribute('data-ux-anchor'), null);
  await page.getByLabel('默认新增交互说明', { exact: true }).click();
  await clickInPrototype('#shared-target', 'right');
  await page.getByRole('menuitem', { name: '添加交互说明', exact: true }).click();
  const body = '目录页的共享记录提交前须展示确认信息。';
  await page.getByRole('textbox', { name: '标注正文', exact: true }).fill(body);
  const captured = await page.evaluate(() => window.__captures.at(-1));
  const expectedView = { key: 'record', label: '目录页记录 A', recordId: 'record-a' };
  const expectedTabs = [{ selector: '#tab-catalog', panelSelector: '#shared-panel' }];
  assert.equal(captured.id, null);
  assert.deepEqual(captured.view, expectedView);
  assert.deepEqual(captured.tabs, expectedTabs);

  // Save while the newly created annotation is still an edit. This exercises
  // Workbench.save's stampAnchor path rather than seeding persisted metadata.
  await page.getByLabel('保存文档', { exact: true }).click();
  await page.getByText('已保存，PRD 与标注变更已写入文件。', { exact: true }).waitFor();
  const savedHtml = await page.evaluate(() => window.__saves[0].html);
  const savedDoc = parse(savedHtml), [annotation] = Object.values(savedDoc.annotations);
  assert.equal(Object.keys(savedDoc.annotations).length, 1);
  assert.equal(annotation.body, body);
  assert.match(annotation.anchor.id, /^ux-/);
  assert.deepEqual(annotation.anchor.view, expectedView);
  assert.deepEqual(annotation.anchor.tabs, expectedTabs);
  assert.equal(await page.evaluate(({ html, id }) => new DOMParser().parseFromString(html, 'text/html').querySelector('#shared-target').dataset.uxAnchor === id, { html: sourceOnly(savedHtml), id: annotation.anchor.id }), true);
  assert.equal(JSON.stringify(annotation.anchor).includes('业务输入不能写入标注上下文'), false);
  assert.equal(sourceOnly(savedHtml).includes('业务输入不能写入标注上下文'), false, 'Stamping must not serialize live business input');
  assert.equal(await frame(page).locator('#business-draft').inputValue(), '业务输入不能写入标注上下文', 'Saving an annotation must not reload or rewrite the live prototype');

  await page.reload();
  await indexTab(page).waitFor();
  await frame(page).locator('#shared-target').waitFor();
  assert.equal(await page.evaluate(() => window.__readCount), 2, 'Reload must read the Host snapshot saved by the human annotation flow');
  assert.equal(await frame(page).locator('#shared-target').getAttribute('data-ux-anchor'), annotation.anchor.id);
  await frame(page).locator('#business-draft').fill('切页后仍未提交的业务草稿');
  await clickInPrototype('#tab-recent');
  assert.equal(await frame(page).locator('#tab-recent').getAttribute('aria-selected'), 'true');
  assert.equal(await frame(page).locator('#shared-target').isVisible(), true, 'The shared control remains visible on the wrong page, so visibility alone cannot establish location');
  const inputEvents = await frame(page).locator('body').evaluate(() => window.inputEvents);
  await indexTab(page).click();
  assert.equal(await row(page, annotation.id).getByText(body, { exact: true }).isVisible(), true);
  const located = await locate(page, annotation.id);
  assert.equal(located.found, true);
  assert.equal(located.visible, true);
  assert.equal(await frame(page).locator('#tab-catalog').getAttribute('aria-selected'), 'true');
  assert.equal(await frame(page).locator('#page-title').textContent(), '目录页');
  assert.deepEqual(await frame(page).locator('body').evaluate(() => ({ page: window.selectedPage, recordId: window.recordId, reveals: window.reveals })), { page: 'catalog', recordId: 'record-a', reveals: [expectedView] });
  assert.equal(await row(page, annotation.id).getByRole('button', { name: /^定位标注/ }).getAttribute('aria-current'), 'true');
  assert.equal(await page.locator('.uxw-marker.is-active').count(), 1, 'Programmatic tab activation must retain the selected canvas marker');
  assert.equal(await page.locator('.uxw-target-selected').isVisible(), true);
  assert.equal(await frame(page).locator('#business-draft').inputValue(), '切页后仍未提交的业务草稿');
  assert.deepEqual(await frame(page).locator('body').evaluate(() => ({ inputEvents: window.inputEvents, submissions: window.submissions })), { inputEvents, submissions: 0 });
  assert.equal(await page.evaluate(() => window.__saves.length), 1, 'Reloading and locating must not write another document revision');
  assert.deepEqual(parse(await page.evaluate(() => window.__saves[0].html)).annotations[annotation.id].anchor, annotation.anchor);
});

test('a freshly exported offline review includes a readable, searchable, locatable index without editing controls', { timeout: 30000 }, async t => {
  // Build the current reader in memory and inject it into the real exporter.
  // This avoids changing generated source or accidentally testing a stale build.
  const reader = await build({ entryPoints: [resolve(root, 'src/review-entry.jsx')], bundle: true, minify: true, write: false, format: 'iife', target: ['chrome110'], outfile: resolve(directory, 'reader.js'), define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline' });
  const runtimeJs = reader.outputFiles.find(file => file.path.endsWith('.js')).text;
  const runtimeCss = reader.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const exporter = await build({
    entryPoints: [resolve(root, 'src/export.mjs')], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'current-review-runtime', setup(build) {
      build.onResolve({ filter: /generated\/review-runtime\.mjs$/ }, args => ({ path: args.path, namespace: 'test-runtime' }));
      build.onLoad({ filter: /.*/, namespace: 'test-runtime' }, () => ({ contents: `export const runtimeJs = ${JSON.stringify(runtimeJs)}; export const runtimeCss = ${JSON.stringify(runtimeCss)};` }));
    } }],
  });
  const { exportReviewHtml } = await import('data:text/javascript;base64,' + Buffer.from(exporter.outputFiles[0].text).toString('base64'));
  const html = await exportReviewHtml(snapshot.html);
  assert.deepEqual(parse(html).annotations, doc.annotations);
  const path = resolve(directory, 'offline-review.html');
  await fs.writeFile(path, html);
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, offline: true });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [], requests = [];
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(path).href);
  await page.getByText('只读评审', { exact: true }).waitFor();
  await indexTab(page).click();
  assert.equal(await rows(page).count(), annotations.length);
  await page.getByLabel('搜索标注', { exact: true }).fill('保存后返回列表');
  assert.deepEqual(await rowIds(page), ['ann-page-b']);
  assert.match(await row(page, 'ann-page-b').innerText(), /第二页说明的最后一句：保存后返回列表。/);
  await row(page, 'ann-page-b').getByRole('button', { name: /^定位标注/ }).click();
  await page.getByRole('status').filter({ hasText: /对应页面或弹窗/ }).waitFor();
  assert.equal(await frame(page).locator('#page-b').isVisible(), false);
  for (const name of ['保存文档', '删除标注', '编辑标注正文']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '标注正文', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], 'Offline reading and locating must not require network access');
});
