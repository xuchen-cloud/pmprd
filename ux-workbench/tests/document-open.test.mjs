import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { create, write } from '../../skills/ux-prototype/scripts/document.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prototype = '<!DOCTYPE html><html><head><title>分享来的页面</title></head><body><button>交互按钮</button><script>window.__selectedFileExecuted = true;</script></body></html>';
const canonical = write(prototype, create({ title: '内容识别的设计文档', prd: '# 需求\n\n原始需求。' }));
const receipt = { path: '/workspace/分享来的页面.ux.html', name: '分享来的页面.ux.html', report: { unmigrated: [] } };
let server, browser, cacheDir, origin;

before(async () => {
  cacheDir = await fs.mkdtemp(resolve(os.tmpdir(), 'ux-document-open-vite-'));
  // A virtual entry mounts the real package component without changing either
  // application's production entry or adding a second copy of React.
  server = await createServer({
    root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
    resolve: { alias: ['react', 'react-dom', 'lucide-react'].map(name => ({ find: name, replacement: resolve(root, 'node_modules', name) })) },
    plugins: [{
      name: 'document-open-browser-fixture',
      resolveId(id) { if (id === '/__document-open-fixture.js') return '\0document-open-fixture.js'; },
      load(id) {
        if (id !== '\0document-open-fixture.js') return;
        return `import React from 'react';
          import { createRoot } from 'react-dom/client';
          import DocumentOpen from ${JSON.stringify('/@fs' + resolve(root, '../packages/dsh-ux-review/src/DocumentOpen.jsx'))};
          import ${JSON.stringify('/@fs' + resolve(root, '../packages/dsh-ux-review/src/document-open.css'))};
          createRoot(document.getElementById('root')).render(React.createElement(DocumentOpen, window.__documentHost));`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__document-open.html') return next();
          try {
            const html = await vite.transformIndexHtml(request.url, '<!DOCTYPE html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module" src="/__document-open-fixture.js"></script></body></html>');
            response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }],
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (cacheDir) await fs.rm(cacheDir, { recursive: true, force: true });
});

async function openPage(t, { width = 1024, result = receipt } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'File and navigation failures must not produce unhandled browser errors'); });
  await page.addInitScript(result => {
    window.__imports = []; window.__opens = [];
    window.__importMode = 'success'; window.__openMode = 'success';
    window.__documentHost = {
      importFile(args) {
        window.__imports.push(args);
        if (window.__importMode === 'pending') return new Promise((resolve, reject) => { window.__finishImport = () => resolve(result); window.__failImport = reject; });
        return Promise.resolve(result);
      },
      openDocument(path) {
        window.__opens.push(path);
        if (window.__openMode === 'throw') throw new Error('导航服务暂时不可用');
        if (window.__openMode === 'pending') return new Promise((resolve, reject) => { window.__finishOpen = resolve; window.__failOpen = reject; });
        window.__openedPath = path; return Promise.resolve();
      },
    };
  }, result);
  await page.goto(`${origin}/__document-open.html`);
  await page.getByRole('heading', { name: '打开设计文档', exact: true }).waitFor();
  return page;
}

const file = (name, html = prototype) => ({ name, mimeType: 'text/html', buffer: Buffer.from(html) });
const chooser = page => page.getByLabel('选择本地文件', { exact: true });
const confirm = page => page.getByRole('button', { name: '导入为设计文档', exact: true });
const calls = page => page.evaluate(() => ({ imports: window.__imports, opens: window.__opens }));
const waitOpened = page => page.waitForFunction(path => window.__openedPath === path, receipt.path);

test('content metadata opens an ordinary .html name automatically, preserves its BOM, and permits selecting the same file again', { timeout: 30000 }, async t => {
  const page = await openPage(t);
  const html = '\uFEFF' + canonical, selected = file('同事发来的文档.html', html);
  await chooser(page).setInputFiles(selected);
  await waitOpened(page);
  assert.deepEqual(await calls(page), { imports: [{ name: selected.name, html, allowConvert: false }], opens: [receipt.path] });
  assert.equal(await confirm(page).count(), 0, 'A canonical document must not be offered conversion based on its filename');
  assert.equal(await page.evaluate(() => window.__selectedFileExecuted), undefined, 'Selecting a document must not execute its prototype');
  assert.equal(await chooser(page).inputValue(), '', 'Reset the native input so choosing this same file fires change again');

  await chooser(page).setInputFiles(selected);
  await page.waitForFunction(() => window.__opens.length === 2);
  assert.equal((await calls(page)).imports.length, 2);
});

test('plain HTML requires explicit confirmation, cancel imports nothing, and the native picker and actions work by keyboard at 320px', { timeout: 30000 }, async t => {
  const page = await openPage(t, { width: 320 });
  await page.keyboard.press('Tab');
  assert.equal(await chooser(page).evaluate(input => input === document.activeElement), true);
  assert.match(await chooser(page).getAttribute('accept'), /\.html/);
  const focusRing = await page.locator('label[for]').evaluate(label => getComputedStyle(label).outlineStyle);
  assert.equal(focusRing, 'solid', 'Keyboard focus on the clipped native input must be visible on its label');
  const selected = file('别人发来的未转换交互稿'.repeat(8) + '.html');
  const picker = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await picker).setFiles(selected);
  const heading = page.getByRole('heading', { name: '这是普通交互稿', exact: true });
  await heading.waitFor();
  assert.equal(await heading.evaluate(node => node === document.activeElement), true);
  assert.deepEqual(await calls(page), { imports: [], opens: [] });
  assert.equal(await page.evaluate(() => window.__selectedFileExecuted), undefined);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Long filenames and actions must fit a narrow page');

  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: '取消', exact: true }).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press('Enter');
  await heading.waitFor({ state: 'detached' });
  assert.equal(await chooser(page).evaluate(input => input === document.activeElement), true);
  assert.deepEqual(await calls(page), { imports: [], opens: [] });
  await chooser(page).setInputFiles([]);
  assert.deepEqual(await calls(page), { imports: [], opens: [] }, 'An empty native selection must not import');

  await chooser(page).setInputFiles(selected);
  await heading.waitFor();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await confirm(page).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press('Enter');
  await waitOpened(page);
  assert.deepEqual((await calls(page)).imports, [{ name: selected.name, html: prototype, allowConvert: true }]);
});

test('legacy import shows unmigrated content before the user opens the saved document', { timeout: 30000 }, async t => {
  const result = { ...receipt, report: { unmigrated: [{ field: 'legacy.anchors', note: '旧版定位信息保留在原文件，需手动核对。' }] } };
  const page = await openPage(t, { result });
  const html = prototype.replace('</body>', '<script id="ux-requirements" type="application/json">{"title":"旧稿","prd":"旧需求"}</script></body>');
  await chooser(page).setInputFiles(file('旧交互稿.html', html));
  await page.getByRole('heading', { name: '这是旧版设计文档', exact: true }).waitFor();
  assert.deepEqual(await calls(page), { imports: [], opens: [] });
  await confirm(page).click();
  await page.getByRole('heading', { name: '已保存设计文档', exact: true }).waitFor();
  assert.deepEqual(await calls(page), { imports: [{ name: '旧交互稿.html', html, allowConvert: true }], opens: [] });
  await page.getByText('有 1 项旧内容未映射到新格式', { exact: true }).click();
  assert.equal(await page.getByText('legacy.anchors', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('这些内容仍保留在你选择的原文件中。', { exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '打开文档', exact: true }).click();
  await waitOpened(page);
  assert.equal((await calls(page)).imports.length, 1, 'Opening a migration receipt must reuse the saved file');
});

test('damaged metadata, non-HTML and invalid UTF-8 are rejected, multi-file drops explain the limit, and a single valid drop recovers', { timeout: 30000 }, async t => {
  const page = await openPage(t);
  for (const [selected, error] of [
    [file('不是HTML.txt', canonical), '请选择 HTML 格式的设计文档或交互稿'],
    [file('伪装的HTML.html', '# 这不是完整 HTML'), '需要包含 html 与 body 的完整 HTML 文件。'],
    [file('损坏的文档.html', canonical.replace('<!-- ux-document:start -->', '')), '文档必须包含唯一且完整的 ux-document 元数据块。'],
    [{ name: '错误编码.html', mimeType: 'text/html', buffer: Buffer.from([0xff, 0xfe, 0x41]) }, '无法读取文件编码，请将文档另存为 UTF-8 后重试。'],
  ]) {
    await chooser(page).setInputFiles(selected);
    await page.getByRole('alert').filter({ hasText: error }).waitFor();
    assert.equal(await chooser(page).getAttribute('aria-invalid'), 'true');
    assert.equal(await page.getByRole('alert').evaluate(node => node === document.activeElement), true);
    assert.equal(await confirm(page).count(), 0, `${selected.name} must not fall back to conversion`);
    assert.deepEqual(await calls(page), { imports: [], opens: [] });
  }

  const drop = async files => page.evaluate(files => {
    const dataTransfer = new DataTransfer();
    for (const selected of files) dataTransfer.items.add(new File([selected.html], selected.name, { type: 'text/html' }));
    const target = document.querySelector('main');
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, files);
  await drop([{ name: 'a.html', html: canonical }, { name: 'b.html', html: canonical }]);
  await page.getByRole('alert').filter({ hasText: '请一次选择一个设计文档。' }).waitFor();
  assert.deepEqual(await calls(page), { imports: [], opens: [] });
  await drop([{ name: '拖入的文档.html', html: canonical }]);
  await waitOpened(page);
  assert.deepEqual((await calls(page)).imports, [{ name: '拖入的文档.html', html: canonical, allowConvert: false }]);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.locator('main').evaluate(main => main.classList.contains('is-dragging')), false);
});

test('failed import and navigation remain recoverable, lock concurrent actions, and navigation retry never imports twice', { timeout: 30000 }, async t => {
  const page = await openPage(t);
  await chooser(page).setInputFiles(file('可恢复的交互稿.html'));
  await confirm(page).waitFor();
  await page.evaluate(() => { window.__importMode = 'pending'; });
  await confirm(page).evaluate(button => { button.click(); button.click(); });
  await page.getByRole('status').filter({ hasText: '正在导入设计文档…' }).waitFor();
  assert.equal(await confirm(page).isDisabled(), true);
  assert.equal(await chooser(page).isDisabled(), true);
  assert.equal(await page.locator('main').getAttribute('aria-busy'), 'true');
  assert.equal((await calls(page)).imports.length, 1);
  await page.evaluate(() => window.__failImport(new Error('网络中断，未保存文件')));
  await page.getByRole('alert').filter({ hasText: '网络中断，未保存文件' }).waitFor();
  assert.equal(await confirm(page).isEnabled(), true);
  assert.deepEqual((await calls(page)).opens, []);

  await page.evaluate(() => { window.__importMode = 'success'; window.__openMode = 'throw'; });
  await confirm(page).click();
  await page.getByRole('alert').filter({ hasText: '导航服务暂时不可用' }).waitFor();
  const open = page.getByRole('button', { name: '打开文档', exact: true });
  await open.waitFor();
  assert.equal((await calls(page)).imports.length, 2, 'Only the failed import is repeated');

  await page.evaluate(() => { window.__openMode = 'pending'; });
  await open.evaluate(button => { button.click(); button.click(); });
  await page.getByRole('status').filter({ hasText: '正在打开设计文档…' }).waitFor();
  assert.deepEqual((await calls(page)).opens, [receipt.path, receipt.path]);
  await page.evaluate(() => window.__failOpen(new Error('新页打开失败，请重试')));
  await page.getByRole('alert').filter({ hasText: '新页打开失败，请重试' }).waitFor();
  await page.evaluate(() => { window.__openMode = 'success'; });
  await open.click();
  await waitOpened(page);
  const finalCalls = await calls(page);
  assert.equal(finalCalls.imports.length, 2, 'Navigation retry must retain the receipt instead of duplicating the imported document');
  assert.deepEqual(finalCalls.opens, [receipt.path, receipt.path, receipt.path]);
  assert.equal(await page.getByRole('alert').count(), 0);
});

test('Workbench exposes the Host opener in the toolbar and error state while preserving unsaved PRD on the current page', { timeout: 30000 }, async t => {
  const snapshot = { path: '/workspace/current.ux.html', name: 'current.ux.html', version: '1', html: canonical };
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(7000);
  const errors = [], dialogs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); assert.deepEqual(dialogs, [], 'The Host opener creates another page and must not prompt to discard this draft'); });
  await page.addInitScript(snapshot => {
    window.__openCount = 0; window.__readCount = 0; window.__pickCount = 0; window.__saveCount = 0;
    window.__openMode = 'success';
    window.__UX_REVIEW_HOST__ = {
      read: async () => { window.__readCount++; return snapshot; },
      save: async () => { window.__saveCount++; return snapshot; },
      pick: async () => { window.__pickCount++; return null; },
      openDocument: async () => { window.__openCount++; if (window.__openMode === 'reject') throw new Error('入口暂时不可用'); },
    };
  }, snapshot);
  await page.goto(origin);
  const open = page.getByRole('button', { name: '打开设计文档', exact: true });
  await page.locator('header').getByRole('button', { name: '打开设计文档', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const prd = page.getByLabel('PRD 正文', { exact: true }), draft = '# 需求\n\nLOCAL_UNSAVED_DOCUMENT_OPEN';
  await prd.fill(draft);
  await page.getByText('未保存', { exact: true }).waitFor();
  const readCount = await page.evaluate(() => window.__readCount);
  await open.click();
  assert.equal(await page.evaluate(() => window.__openCount), 1);
  assert.equal(await prd.inputValue(), draft, 'Continuing in this page must retain the exact unsaved PRD');
  await page.evaluate(() => { window.__openMode = 'reject'; });
  await open.click();
  await page.getByText('打开设计文档失败：入口暂时不可用', { exact: true }).waitFor();
  assert.equal(await prd.inputValue(), draft);
  assert.deepEqual(await page.evaluate(() => ({ reads: window.__readCount, picks: window.__pickCount, saves: window.__saveCount })), { reads: readCount, picks: 0, saves: 0 });

  // A separate context avoids a beforeunload prompt and tests the real initial
  // read-error view, where an alternate document must still be reachable.
  const errorPage = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  errorPage.setDefaultTimeout(7000);
  t.after(() => errorPage.close());
  errorPage.on('pageerror', error => errors.push(error.message));
  await errorPage.addInitScript(() => {
    window.__openCount = 0;
    window.__UX_REVIEW_HOST__ = { read: async () => { throw new Error('原文件已移动'); }, openDocument: async () => { window.__openCount++; } };
  });
  await errorPage.goto(origin);
  await errorPage.getByText('暂时无法打开文档', { exact: true }).waitFor();
  await errorPage.getByRole('button', { name: '打开设计文档', exact: true }).click();
  assert.equal(await errorPage.evaluate(() => window.__openCount), 1);
});
