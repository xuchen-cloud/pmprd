import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { prdChangeDiff } from '../../skills/ux-prototype/scripts/document.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { build } from 'esbuild';
import { create, createAnnotation, recordHuman, write, parse, sourceOnly } from '../../skills/ux-prototype/scripts/document.mjs';
import { getAnnotationReferences } from '../src/prd-references.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = `<!doctype html><html><head><title>PRD 引用原型</title><style>body{font:16px system-ui;padding:40px}button,input{padding:14px;margin:10px}</style></head><body>
  <input id="draft" placeholder="业务草稿"><button id="action" data-ux-anchor="action" type="button">保存草稿</button><button id="unreferenced" data-ux-anchor="unreferenced" type="button">其他操作</button>
  <script>window.businessClicks=0;document.querySelectorAll('button').forEach(button=>button.onclick=()=>window.businessClicks++);</script>
  </body></html>`;
const beforeCaret = '插入位置之前。', afterCaret = '插入位置之后。';
const originalPrd = `# 业务需求\n\n原始 **重点**。\n\n${beforeCaret}${afterCaret}\n\n* 首项保持原格式\n* 次项也保持原格式\n`;
const chosenBody = '保存成功反馈\n\n完整 **业务规则**：保存后保留输入，并显示成功结果。\n\n- 校验后提交\n- 成功后显示详情\n\n最终规则：不能丢弃未提交内容。';
const annotations = [
  createAnnotation({ id: 'ann-unselected', kind: 'explanation', body: '同一控件的未选中说明。', anchor: { kind: 'element', id: 'action', selector: '#action', text: '保存草稿' } }),
  createAnnotation({ id: 'ann-chosen', kind: 'explanation', body: chosenBody, anchor: { kind: 'element', id: 'action', selector: '#action', text: '保存草稿' } }),
  createAnnotation({ id: 'ann-other', kind: 'change-request', body: '修改意见不能加入 PRD：调整其他操作。', anchor: { kind: 'element', id: 'unreferenced', selector: '#unreferenced', text: '其他操作' } }),
];
const withReferences = originalPrd + '\n@annotation(ann-chosen)\n\n两处引用之间的需求。\n\n@annotation(ann-chosen)\n';
function documentFor(prd = originalPrd) {
  const initial = create({ title: 'PRD 与交互稿双向引用', prd });
  return recordHuman(initial, { ...initial, annotations: Object.fromEntries(annotations.map(annotation => [annotation.id, annotation])) }, '建立评审说明');
}
let server, browser, directory, origin;

before(async () => {
  directory = await fs.mkdtemp(resolve(os.tmpdir(), 'ux-prd-reference-workbench-'));
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

const frame = page => page.frameLocator('iframe');
const reference = (page, occurrence = 1) => page.locator(`[data-prd-reference-id="ann-chosen:${occurrence}"]`);
const jumps = page => page.getByRole('menuitem', { name: /^跳转到 PRD/ });
const chosenCard = page => page.locator('.uxw-popover [data-annotation-id="ann-chosen"]');

async function openPage(t, prd = originalPrd) {
  const doc = documentFor(prd), snapshot = { path: '/workspace/prd-references.ux.html', name: 'prd-references.ux.html', version: '1', html: write(source, doc) };
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(snapshot => {
    if (window !== window.top) return;
    let current = JSON.parse(sessionStorage.getItem('reference-host:snapshot') || 'null') || snapshot;
    window.__saves = JSON.parse(sessionStorage.getItem('reference-host:saves') || '[]');
    window.__reads = Number(sessionStorage.getItem('reference-host:reads') || 0);
    window.__locations = []; window.__dirty = false;
    addEventListener('message', event => { if (event.data?.channel === 'craft-ux-preview' && event.data.type === 'located') window.__locations.push(event.data); });
    window.__UX_REVIEW_HOST__ = {
      read: async () => { sessionStorage.setItem('reference-host:reads', String(++window.__reads)); return current; },
      save: async args => {
        window.__saves.push(args); current = { ...current, html: args.html, version: String(Number(current.version) + 1) };
        sessionStorage.setItem('reference-host:snapshot', JSON.stringify(current));
        sessionStorage.setItem('reference-host:saves', JSON.stringify(window.__saves));
        return current;
      },
      onDirtyChange: dirty => { window.__dirty = dirty; },
    };
  }, snapshot);
  // The normal app entry passes the real PrdEditor to Workbench.
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).waitFor();
  await frame(page).locator('#action').waitFor();
  return { page, doc, snapshot };
}

async function clickInPrototype(page, selector, button = 'left') {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const point = await frame(page).locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
  const box = await page.locator('iframe').boundingBox(), scale = box.width / Number(await page.locator('iframe').getAttribute('width'));
  await page.mouse.click(box.x + point.x * scale, box.y + point.y * scale, { button });
}

test('collapsed PRD reopens from the far right without losing prototype input', async t => {
  const { page } = await openPage(t);
  await frame(page).locator('#draft').fill('保留业务草稿');
  for (const width of [1500, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: '收起 PRD', exact: true }).click();
    const reopen = page.getByRole('button', { name: '打开 PRD', exact: true });
    const button = await reopen.boundingBox();
    const toolbar = await page.locator('.uxw-interaction-toolbar').boundingBox();
    const zoom = await page.getByRole('combobox', { name: '原型缩放', exact: true }).boundingBox();
    assert.ok(button.x >= zoom.x + zoom.width, 'PRD 展开按钮应位于缩放控件右侧');
    assert.ok(toolbar.x + toolbar.width - button.x - button.width < 20, 'PRD 展开按钮应贴近工具栏右边缘');
    await page.getByRole('combobox', { name: '原型缩放', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await reopen.evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).waitFor();
    assert.equal(await frame(page).locator('#draft').inputValue(), '保留业务草稿');
  }
});

async function openChosenCard(page) {
  await page.getByRole('button', { name: '显示标注', exact: true }).click();
  await page.getByRole('button', { name: '标注 2：交互说明', exact: true }).click();
  await chosenCard(page).waitFor();
}

async function sourcePrd(page) {
  await page.getByRole('tab', { name: 'PRD', exact: true }).click();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const value = await page.getByRole('textbox', { name: 'PRD 正文', exact: true }).inputValue();
  await page.getByRole('button', { name: '富文本', exact: true }).click();
  return value;
}

async function saveAndRead(page) {
  const count = await page.evaluate(() => window.__saves.length);
  await page.getByLabel('保存文档', { exact: true }).click();
  await page.waitForFunction(previous => window.__saves.length === previous + 1, count);
  await page.getByText('已保存，PRD 与标注变更已写入文件。', { exact: true }).waitFor();
  return page.evaluate(() => window.__saves.at(-1).html);
}

async function expectReferenceSelected(page, occurrence) {
  await page.waitForFunction(referenceId => {
    const element = [...document.querySelectorAll('[data-prd-reference-id]')].find(item => item.dataset.prdReferenceId === referenceId);
    return element?.classList.contains('is-selected') && element.contains(document.activeElement);
  }, `ann-chosen:${occurrence}`);
  assert.equal(await page.getByRole('tab', { name: 'PRD', exact: true }).getAttribute('aria-selected'), 'true');
}

test('adding a selected explanation from its card uses the last PRD caret after switching tabs and survives save/reload', { timeout: 30000 }, async t => {
  const { page, doc, snapshot } = await openPage(t);
  await frame(page).locator('#draft').fill('引用导航不能改变业务草稿');
  const paragraph = page.locator('.ProseMirror > p').filter({ hasText: beforeCaret + afterCaret });
  await paragraph.click();
  await paragraph.evaluate((element, offset) => {
    const range = document.createRange(); range.setStart(element.firstChild, offset); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, beforeCaret.length);
  await page.waitForFunction(({ text, offset }) => {
    const selection = document.querySelector('.ProseMirror').editor.state.selection;
    return selection.empty && selection.$from.parent.textContent === text && selection.$from.parentOffset === offset;
  }, { text: beforeCaret + afterCaret, offset: beforeCaret.length });
  await page.getByRole('tab', { name: /^变更/ }).click();
  assert.equal(await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).isVisible(), false);
  await openChosenCard(page);
  await chosenCard(page).locator('.uxw-card-head').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加到 PRD', exact: true }).click();
  await reference(page).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'PRD', exact: true }).getAttribute('aria-selected'), 'true');
  assert.deepEqual(await page.locator('[data-prd-reference-annotation]').evaluateAll(elements => elements.map(element => element.dataset.prdReferenceAnnotation)), ['ann-chosen'], 'Sharing a UX target must not insert another annotation on that target');
  assert.equal(await reference(page).locator('details').evaluate(details => details.open), false);
  assert.equal(await reference(page).getByText('最终规则：不能丢弃未提交内容。', { exact: true }).isVisible(), false);
  await reference(page).locator('summary').click();
  assert.equal(await reference(page).getByText('最终规则：不能丢弃未提交内容。', { exact: true }).isVisible(), true);
  assert.equal(await reference(page).locator('.uxw-prd-reference-content strong').textContent(), '业务规则');
  await reference(page).getByRole('button', { name: /^定位 UX/ }).click();
  await page.waitForFunction(() => window.__locations.some(location => location.id === 'ann-chosen' && location.visible));
  assert.equal(await frame(page).locator('#draft').inputValue(), '引用导航不能改变业务草稿');
  assert.equal(await frame(page).locator('body').evaluate(() => window.businessClicks), 0);
  const prd = await sourcePrd(page);
  const references = getAnnotationReferences(prd);
  assert.deepEqual(references.map(item => item.annotationId), ['ann-chosen']);
  assert.ok(prd.indexOf(beforeCaret) >= 0 && prd.indexOf(beforeCaret) < references[0].start, 'Text preceding the last PRD caret must stay before the inserted reference');
  assert.ok(prd.indexOf(afterCaret) >= references[0].end, 'Inserting from a canvas card must split the remembered paragraph rather than append to the document');
  assert.ok(prd.startsWith('# 业务需求\n\n原始 **重点**。\n\n'), 'Unrelated preceding Markdown keeps its original formatting');
  assert.ok(prd.endsWith('* 首项保持原格式\n* 次项也保持原格式\n'), 'Following paragraphs and the original document ending must stay after the reference');
  assert.equal(prd.includes(chosenBody), false, 'The PRD stores an annotation reference, not a copied body');
  const savedHtml = await saveAndRead(page), saved = parse(savedHtml);
  assert.equal(saved.prd, prd);
  assert.deepEqual(saved.annotations, doc.annotations);
  assert.equal(sourceOnly(savedHtml), sourceOnly(snapshot.html));
  assert.match(prdChangeDiff(saved.changes.at(-1)), /\+@annotation\(ann-chosen\)/);
  assert.equal(saved.changes.length, doc.changes.length + 1);
  await page.reload();
  await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).waitFor();
  await reference(page).waitFor();
  assert.equal(await reference(page).locator('details').evaluate(details => details.open), false);
  assert.equal(await sourcePrd(page), prd);
  assert.deepEqual(await page.evaluate(() => ({ reads: window.__reads, saves: window.__saves.length })), { reads: 2, saves: 1 });
});

test('UX and card backlinks select the correct repeated PRD occurrence even when annotations and the PRD panel are hidden', { timeout: 30000 }, async t => {
  const { page } = await openPage(t, withReferences);
  await page.getByRole('button', { name: '关闭标注', exact: true }).click();
  await page.getByLabel('收起 PRD', { exact: true }).click();
  await clickInPrototype(page, '#unreferenced', 'right');
  assert.equal(await jumps(page).count(), 0, 'Unreferenced UX controls must not offer a PRD backlink');
  await page.keyboard.press('Escape');
  await clickInPrototype(page, '#action', 'right');
  await jumps(page).first().waitFor();
  assert.equal(await jumps(page).count(), 2);
  assert.match(await jumps(page).nth(0).innerText(), /第\s*1\s*处/);
  assert.match(await jumps(page).nth(1).innerText(), /第\s*2\s*处/);
  await jumps(page).nth(1).click();
  await expectReferenceSelected(page, 2);
  assert.equal(await page.locator('.uxw-docpanel.is-sidebar').isVisible(), true);
  await reference(page, 2).getByRole('button', { name: /^定位 UX/ }).click();
  await page.waitForFunction(() => window.__locations.some(location => location.id === 'ann-chosen' && location.visible));
  await openChosenCard(page);
  await chosenCard(page).locator('.uxw-card-head').click({ button: 'right' });
  assert.equal(await jumps(page).count(), 2);
  await jumps(page).nth(0).click();
  await expectReferenceSelected(page, 1);
  assert.equal(await sourcePrd(page), withReferences);
  assert.equal(await page.evaluate(() => window.__dirty), false);
  assert.equal(await page.evaluate(() => window.__saves.length), 0, 'Following either direction must not write a revision');
  assert.equal(await frame(page).locator('body').evaluate(() => window.businessClicks), 0);
});

test('deleting a referenced annotation preserves its missing-reference placeholder without rewriting the PRD', { timeout: 30000 }, async t => {
  const prd = originalPrd + '\n@annotation(ann-chosen)\n';
  const { page, doc } = await openPage(t, prd);
  await openChosenCard(page);
  await chosenCard(page).locator('.uxw-card-head').hover();
  await chosenCard(page).getByLabel('删除标注', { exact: true }).click();
  await reference(page).getByText('标注已删除', { exact: true }).waitFor();
  assert.equal(await reference(page).evaluate(element => element.classList.contains('is-missing')), true);
  assert.equal(await reference(page).getByRole('button', { name: /^定位 UX/ }).isDisabled(), true);
  await reference(page).locator('summary').click();
  assert.equal(await reference(page).getByText('原标注已移出当前文档。此处保留引用位置，可移除此引用。', { exact: true }).isVisible(), true);
  assert.equal(await sourcePrd(page), prd);
  await clickInPrototype(page, '#action', 'right');
  assert.equal(await jumps(page).count(), 0, 'Deleting the referenced annotation removes its live UX backlink');
  await page.keyboard.press('Escape');
  const saved = parse(await saveAndRead(page));
  assert.equal(saved.prd, prd);
  assert.equal(saved.annotations['ann-chosen'], undefined);
  assert.deepEqual(saved.annotations['ann-unselected'], doc.annotations['ann-unselected']);
  assert.deepEqual(saved.annotations['ann-other'], doc.annotations['ann-other']);
  assert.equal(saved.changes.at(-1).patch.some(patch => patch.path === '/prd'), false, 'Deleting the annotation does not silently delete or rewrite its PRD reference');
});

test('change requests cannot be added or linked to PRD, and handwritten request references stay invalid', { timeout: 30000 }, async t => {
  const prd = originalPrd + '\n@annotation(ann-other)\n';
  const { page, doc } = await openPage(t, prd);
  const unsupported = page.locator('[data-prd-reference-id="ann-other:1"]');
  await unsupported.waitFor();
  assert.equal(await unsupported.getByRole('button', { name: /^定位 UX/ }).isDisabled(), true);
  await unsupported.locator('summary').click();
  assert.match(await unsupported.innerText(), /仅支持.*说明|只支持.*说明/);
  assert.equal(await unsupported.getByText(annotations[2].body, { exact: true }).count(), 0, 'A request must not become a valid reference by writing its ID directly');
  await page.getByRole('button', { name: '标注 3：修改意见', exact: true }).click();
  const requestCard = page.locator('.uxw-popover [data-annotation-id="ann-other"]');
  await requestCard.locator('.uxw-card-head').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除标注', exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: '添加到 PRD', exact: true }).count(), 0);
  assert.equal(await jumps(page).count(), 0, 'A handwritten request reference must not create a card backlink');
  await page.keyboard.press('Escape');
  await clickInPrototype(page, '#unreferenced', 'right');
  assert.equal(await jumps(page).count(), 0, 'A handwritten request reference must not create a UX backlink');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭标注', exact: true }).click();
  await clickInPrototype(page, '#unreferenced', 'right');
  assert.equal(await jumps(page).count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await sourcePrd(page), prd);
  const saved = parse(await saveAndRead(page));
  assert.deepEqual(saved, doc, 'Rejecting a handwritten request reference preserves the source for user correction');
});

test('offline read-only export retains folded references and both navigation directions without mutation controls', { timeout: 30000 }, async t => {
  const doc = documentFor(withReferences + '\n@annotation(ann-other)\n');
  // Exercise the real current offline entry and exporter without modifying
  // generated source or accidentally loading a reader from a previous build.
  const reader = await build({ entryPoints: [resolve(root, 'src/review-entry.jsx')], bundle: true, minify: true, write: false, format: 'iife', target: ['chrome110'], outfile: resolve(directory, 'reader.js'), define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline' });
  const runtimeJs = reader.outputFiles.find(file => file.path.endsWith('.js')).text, runtimeCss = reader.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const exporter = await build({
    entryPoints: [resolve(root, 'src/export.mjs')], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'current-review-runtime', setup(build) {
      build.onResolve({ filter: /generated\/review-runtime\.mjs$/ }, args => ({ path: args.path, namespace: 'test-runtime' }));
      build.onLoad({ filter: /.*/, namespace: 'test-runtime' }, () => ({ contents: `export const runtimeJs = ${JSON.stringify(runtimeJs)}; export const runtimeCss = ${JSON.stringify(runtimeCss)};` }));
    } }],
  });
  const { exportReviewHtml } = await import('data:text/javascript;base64,' + Buffer.from(exporter.outputFiles[0].text).toString('base64'));
  const html = await exportReviewHtml(write(source, doc));
  assert.deepEqual(parse(html), doc);
  const path = resolve(directory, 'prd-references.review.html');
  await fs.writeFile(path, html);
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, offline: true });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [], requests = [];
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.addInitScript(() => {
    window.__locations = [];
    addEventListener('message', event => { if (event.data?.channel === 'craft-ux-preview' && event.data.type === 'located') window.__locations.push(event.data); });
  });
  await page.goto(pathToFileURL(path).href);
  await page.getByText('只读评审', { exact: true }).waitFor();
  await reference(page).waitFor();
  assert.equal(await page.locator('.uxw-prd-reference').count(), 3);
  assert.equal(await page.locator('.uxw-prd-reference details[open]').count(), 0);
  assert.equal(await page.locator('.uxw-prd-reference-remove').count(), 0);
  const unsupported = page.locator('[data-prd-reference-id="ann-other:1"]');
  assert.equal(await unsupported.getByRole('button', { name: /^定位 UX/ }).isDisabled(), true);
  await unsupported.locator('summary').click();
  assert.match(await unsupported.innerText(), /仅支持.*说明|只支持.*说明/);
  await page.getByRole('button', { name: '关闭标注', exact: true }).click();
  await page.getByLabel('收起 PRD', { exact: true }).click();
  await clickInPrototype(page, '#unreferenced', 'right');
  assert.equal(await jumps(page).count(), 0, 'Read-only offline rendering also excludes handwritten request backlinks');
  await page.keyboard.press('Escape');
  await clickInPrototype(page, '#action', 'right');
  await jumps(page).first().waitFor();
  assert.equal(await jumps(page).count(), 2);
  assert.equal(await page.getByRole('menuitem', { name: '添加到 PRD', exact: true }).count(), 0);
  await jumps(page).nth(1).click();
  await expectReferenceSelected(page, 2);
  await reference(page, 2).locator('summary').click();
  assert.equal(await reference(page, 2).getByText('最终规则：不能丢弃未提交内容。', { exact: true }).isVisible(), true);
  await reference(page, 2).getByRole('button', { name: /^定位 UX/ }).click();
  await page.waitForFunction(() => window.__locations.some(location => location.id === 'ann-chosen' && location.visible));
  await openChosenCard(page);
  await chosenCard(page).locator('.uxw-card-head').click({ button: 'right' });
  await jumps(page).first().waitFor();
  assert.equal(await jumps(page).count(), 2);
  assert.equal(await page.getByRole('menuitem', { name: '添加到 PRD', exact: true }).count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: '删除标注', exact: true }).count(), 0);
  await jumps(page).nth(0).click();
  await expectReferenceSelected(page, 1);
  assert.equal(await page.getByLabel('保存文档', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '标注正文', exact: true }).count(), 0);
  assert.equal(await frame(page).locator('body').evaluate(() => window.businessClicks), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});
