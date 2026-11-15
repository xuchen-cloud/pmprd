import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { create, createAnnotation, recordHuman, recordAgent, write } from '../../skills/ux-prototype/scripts/document.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = '<html><body><button id="target" data-ux-anchor="target">原操作</button></body></html>';
const base = create({ title: '通用 Agent 交接', prd: '# 需求\n\n保留当前需求。' });
const doc = recordHuman(base, { ...base, annotations: {
  'ann-request': createAnnotation({ id: 'ann-request', kind: 'change-request', body: '调整目标操作。', anchor: { kind: 'element', id: 'target', selector: '#target' } }),
} });
const snapshot = { path: '/workspace/交互稿.ux.html', name: '交互稿.ux.html', version: '1', html: write(source, doc) };
const updatedSource = source.replace('原操作', '已修改的操作');
const updated = { ...snapshot, version: '3', html: write(updatedSource, recordAgent(doc, { summary: '调整目标操作', details: ['调整目标操作'], selectedIds: ['ann-request'], resolvedIds: ['ann-request'], uxBefore: source, uxAfter: updatedSource })) };
const prompt = '请修改 /workspace/交互稿.business.html。\n意见 ann-request：调整目标操作。\n目标：#target\n完成后运行统一 finish 命令。';
let server, browser, directory, origin;

before(async () => {
  directory = await fs.mkdtemp(resolve(os.tmpdir(), 'ux-agent-handoff-'));
  server = await createServer({ root, cacheDir: resolve(directory, 'vite'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => { await browser?.close(); await server?.close(); await fs.rm(directory, { recursive: true, force: true }); });

async function pageFor(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(({ snapshot, updated, prompt, options }) => {
    if (window !== window.top) return;
    window.__saves = []; window.__submissions = []; window.__dshSent = []; window.__clipboardCalls = 0; window.__taskReads = 0; window.__cancelCalls = 0;
    window.__current = snapshot; window.__status = 'running'; window.__denyClipboard = options.denyClipboard; window.__saveFailure = options.saveFailure;
    window.ClipboardItem = class { constructor(data) { this.data = data; } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write(items) {
        window.__clipboardCalls++;
        if (window.__denyClipboard) return Promise.reject(new DOMException('Clipboard denied', 'NotAllowedError'));
        return Promise.resolve(items[0].data['text/plain']).then(blob => blob.text()).then(text => { window.__copied = text; });
      },
    } });
    const result = () => ({ id: 'handoff-task', status: window.__status, destination: window.__destination, ...(window.__status === 'running' ? { prompt, message: '等待外部修改' } : {}), ...(window.__status === 'completed' ? { outputPath: snapshot.path, delivery: 'updated-current' } : {}) });
    window.__UX_REVIEW_HOST__ = {
      read: async () => window.__current,
      save: async args => { window.__saves.push(args); if (window.__saveFailure) throw new Error('保存失败，请重试'); return window.__current = { ...window.__current, html: args.html, version: '2' }; },
      submit: args => {
        window.__submissions.push(args); window.__destination = args.destination;
        const finish = () => { const next = result(); window.__current.activeTask = next; if (args.destination === 'dsh') window.__dshSent.push(prompt); return next; };
        return options.deferSubmit ? new Promise(resolve => { window.__finishSubmit = () => resolve(finish()); }) : Promise.resolve(finish());
      },
      task: async () => { window.__taskReads++; if (window.__status === 'completed') window.__current = updated; return result(); },
      cancel: async () => { window.__cancelCalls++; window.__status = 'cancelled'; window.__current.activeTask = null; return result(); },
    };
  }, { snapshot, updated, prompt, options });
  await page.goto(origin);
  await page.frameLocator('iframe').locator('#target').waitFor();
  return page;
}

async function openHandoff(page) {
  await page.getByRole('button', { name: '交给 AI 修改', exact: true }).click();
  assert.equal(await page.getByLabel('生成新版本文件', { exact: true }).isChecked(), false);
}

test('external copy starts clipboard in click, waits for saved task and copies exact prompt without DSH dispatch', { timeout: 20000 }, async t => {
  const page = await pageFor(t, { deferSubmit: true });
  await openHandoff(page);
  await page.getByRole('button', { name: '复制给外部 Agent', exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => window.__submissions.length === 1);
  assert.equal(await page.evaluate(() => window.__clipboardCalls), 1);
  assert.equal(await page.evaluate(() => window.__copied), undefined);
  assert.equal(await page.getByRole('button', { name: '保存文档', exact: true }).count(), 0);
  await page.evaluate(() => window.__finishSubmit());
  await page.waitForFunction(() => !!window.__copied);
  assert.equal(await page.evaluate(() => window.__copied), prompt);
  assert.deepEqual(await page.evaluate(() => window.__dshSent), []);
  assert.equal(await page.evaluate(() => window.__saves.length), 1);
  const submitted = await page.evaluate(() => window.__submissions[0]);
  assert.deepEqual(submitted.selectedIds, ['ann-request']);
  assert.equal(submitted.destination, 'external');
  assert.equal(submitted.expectedVersion, '2');
  assert.equal(submitted.createNewVersion, false);
  await page.getByText('等待外部修改 · 只读', { exact: true }).waitFor();
  await page.getByRole('button', { name: '读取修改结果', exact: true }).waitFor();
  await page.getByRole('button', { name: '结束外部修改', exact: true }).click();
  await page.getByRole('button', { name: '保存文档', exact: true }).waitFor();
});

test('direct DSH action uses same saved selection and prompt without clipboard', { timeout: 15000 }, async t => {
  const page = await pageFor(t);
  await openHandoff(page);
  await page.getByRole('button', { name: /^发送到 DSH/ }).click();
  await page.waitForFunction(() => window.__dshSent.length === 1);
  assert.equal(await page.evaluate(() => window.__dshSent[0]), prompt);
  assert.equal(await page.evaluate(() => window.__submissions[0].destination), 'dsh');
  assert.equal(await page.evaluate(() => window.__submissions[0].expectedVersion), '2');
  assert.equal(await page.evaluate(() => window.__clipboardCalls), 0);
  assert.equal(await page.getByRole('button', { name: '结束外部修改', exact: true }).count(), 0);
});

test('clipboard denial preserves selectable prompt, permits retry and cancellation restores editing', { timeout: 15000 }, async t => {
  const page = await pageFor(t, { denyClipboard: true });
  await openHandoff(page);
  await page.getByRole('button', { name: '复制给外部 Agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '复制修改说明', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: '给外部 Agent 的修改说明' }).inputValue(), prompt);
  assert.equal(await page.getByRole('button', { name: '保存文档', exact: true }).count(), 0);
  await page.evaluate(() => { window.__denyClipboard = false; });
  await dialog.getByRole('button', { name: '复制修改说明', exact: true }).click();
  await page.waitForFunction(() => !!window.__copied);
  assert.equal(await page.evaluate(() => window.__copied), prompt);
  assert.equal(await page.evaluate(() => window.__submissions.length), 1);
  await dialog.getByRole('button', { name: '结束外部修改', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '保存文档', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__cancelCalls), 1);
});

test('external result receipt reloads current document and releases editor lock', { timeout: 15000 }, async t => {
  const page = await pageFor(t);
  await openHandoff(page);
  await page.getByRole('button', { name: '复制给外部 Agent', exact: true }).click();
  await page.getByRole('button', { name: '读取修改结果', exact: true }).waitFor();
  await page.evaluate(() => { window.__status = 'completed'; });
  await page.getByRole('button', { name: '读取修改结果', exact: true }).click();
  await page.frameLocator('iframe').getByText('已修改的操作', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存文档', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '结束外部修改', exact: true }).count(), 0);
});

test('failed preparation with early clipboard denial leaves no task or stranded lock', { timeout: 15000 }, async t => {
  const page = await pageFor(t, { saveFailure: true, denyClipboard: true });
  await openHandoff(page);
  await page.getByRole('button', { name: '复制给外部 Agent', exact: true }).click();
  await page.getByText('保存失败，请重试', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存文档', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__submissions), []);
  assert.equal(await page.getByRole('dialog', { name: '复制修改说明', exact: true }).count(), 0);
});
