import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { create, createAnnotation, recordHuman, write, parse } from '../../skills/ux-prototype/scripts/document.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = '<html><body><button id="target" data-ux-anchor="target" onclick="this.textContent=\'浏览交互仍可用\'">操作目标</button></body></html>';
const initial = create({ title: 'AI 修改锁', prd: '# 需求\n\n保留原需求。\n\n@annotation(ann-rule)\n' });
const doc = recordHuman(initial, { ...initial, annotations: {
  'ann-rule': createAnnotation({ id: 'ann-rule', kind: 'explanation', body: '这是帮助理解的业务说明。', anchor: { kind: 'element', id: 'target', selector: '#target' } }),
  'ann-request': createAnnotation({ id: 'ann-request', kind: 'change-request', body: '修改操作目标的文字。', anchor: { kind: 'element', id: 'target', selector: '#target' } }),
} });
const snapshot = { path: '/workspace/locked.ux.html', name: 'locked.ux.html', version: '1', html: write(source, doc) };
let server, browser, directory, origin;

before(async () => {
  directory = await fs.mkdtemp(resolve(os.tmpdir(), 'ux-ai-lock-'));
  server = await createServer({ root, cacheDir: resolve(directory, 'vite'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => { await browser?.close(); await server?.close(); await fs.rm(directory, { recursive: true, force: true }); });

async function pageFor(t, activeTask = null) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(({ snapshot, activeTask }) => {
    if (window !== window.top) return;
    window.__current = { ...snapshot, activeTask }; window.__saves = []; window.__submissions = []; window.__dirty = false; window.__taskReads = 0;
    addEventListener('message', event => { if (event.data?.channel === 'craft-ux-preview') window.__previewToken = event.data.token; });
    window.__status = activeTask?.status || 'queued';
    window.__UX_REVIEW_HOST__ = {
      read: async () => window.__current,
      save: args => new Promise(resolve => { window.__saves.push(args); window.__finishSave = () => resolve(window.__current = { ...window.__current, html: args.html, version: '2' }); }),
      submit: args => new Promise(resolve => { window.__submissions.push(args); window.__finishSubmit = () => resolve({ id: 'active-task', status: 'queued' }); }),
      task: async () => { window.__taskReads++; return { id: 'active-task', status: window.__status, message: window.__status === 'failed' ? '修改失败，恢复编辑' : window.__status === 'needs-attention' ? '需要人工处理' : 'AI 正在修改' }; },
      onDirtyChange: dirty => { window.__dirty = dirty; },
    };
  }, { snapshot, activeTask });
  await page.goto(origin);
  await page.frameLocator('iframe').locator('#target').waitFor();
  return page;
}

async function assertLocked(page) {
  await page.getByText('AI 修改中 · 只读', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('PRD 正文', { exact: true }).count(), 0);
  for (const label of ['保存文档', '选择元素添加标注', '框选区域添加标注', '删除标注']) assert.equal(await page.getByLabel(label, { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '交给 AI 修改', exact: true }).count(), 0);
}

test('submission locks immediately through save, queue and running; reading works and failure unlocks', { timeout: 30000 }, async t => {
  const page = await pageFor(t);
  await page.getByRole('button', { name: '交给 AI 修改', exact: true }).click();
  await page.getByRole('button', { name: /^发送到 DSH/ }).evaluate(button => { button.click(); button.click(); });
  await assertLocked(page);
  assert.equal(await page.evaluate(() => window.__saves.length), 1, 'The double click must not submit/save twice');
  await page.evaluate(() => window.__finishSave());
  await page.waitForFunction(() => window.__submissions.length === 1);
  await assertLocked(page);
  await page.evaluate(() => window.__finishSubmit());
  await assertLocked(page);
  await page.evaluate(() => { window.__status = 'running'; });
  await page.waitForFunction(() => window.__taskReads > 0);

  // PRD references, index, canvas controls and ordinary prototype interactions remain usable.
  const reference = page.locator('[data-prd-reference-id="ann-rule:1"]');
  await reference.locator('summary').click();
  await reference.locator('.uxw-prd-reference-content').getByText('这是帮助理解的业务说明。', { exact: true }).waitFor();
  assert.equal(await reference.getByLabel('移除 PRD 引用：ann-rule:1', { exact: true }).count(), 0);
  await reference.getByRole('button', { name: /^定位 UX/ }).click();
  await page.getByRole('button', { name: '展开标注', exact: true }).click();
  const card = page.locator('[data-annotation-id="ann-rule"]');
  await card.locator('.uxw-card-body').click();
  assert.equal(await page.getByLabel('标注正文', { exact: true }).count(), 0);
  await card.locator('.uxw-card-head').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '跳转到 PRD', exact: true }).waitFor();
  for (const label of ['编辑正文', '添加到 PRD', '删除标注', '转为修改意见']) assert.equal(await page.getByRole('menuitem', { name: label, exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /^标注/ }).click();
  await page.getByLabel('搜索标注', { exact: true }).fill('业务说明');
  await page.getByRole('button', { name: '定位标注 1：交互说明', exact: true }).filter({ visible: true }).last().click();
  await page.getByLabel('设备宽度', { exact: true }).selectOption('1024');
  await page.getByLabel('原型缩放', { exact: true }).selectOption('0.75');
  await page.frameLocator('iframe').locator('#target').click();
  await page.frameLocator('iframe').getByText('浏览交互仍可用', { exact: true }).waitFor();

  // A late preview pick/context message must not create any draft while locked.
  const token = await page.evaluate(() => window.__previewToken);
  await page.frameLocator('iframe').locator('body').evaluate((_, token) => {
    const anchor = { kind: 'element', id: 'target', selector: '#target' };
    parent.postMessage({ channel: 'craft-ux-preview', token, type: 'picked', anchor }, '*');
    parent.postMessage({ channel: 'craft-ux-preview', token, type: 'contextmenu', anchor, annotationIds: [], x: 20, y: 20 }, '*');
  }, token);
  assert.equal(await page.getByLabel('标注正文', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: /^添加/ }).count(), 0);
  await page.locator('.uxw-canvas').focus();
  await page.keyboard.press('Control+s');
  assert.equal(await page.evaluate(() => window.__saves.length), 1);
  assert.equal(await page.evaluate(() => window.__dirty), false);
  assert.equal(parse(await page.evaluate(() => window.__saves[0].html)).prd, doc.prd);

  await page.evaluate(() => { window.__status = 'failed'; });
  await page.getByText('修改失败，恢复编辑', { exact: true }).first().waitFor();
  await page.getByRole('tab', { name: 'PRD', exact: true }).click();
  await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page.getByLabel('PRD 正文', { exact: true }).fill('# 恢复编辑后的需求');
  await page.getByText('未保存', { exact: true }).waitFor();
});

test('opening a document with an active task restores the lock; needs-attention unlocks', { timeout: 15000 }, async t => {
  const page = await pageFor(t, { id: 'active-task', status: 'running', ownedBySession: true });
  await assertLocked(page);
  await page.evaluate(() => { window.__status = 'needs-attention'; });
  await page.getByText('需要人工处理', { exact: true }).first().waitFor();
  await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__saves.length), 0);
});

test('a task in another session locks this view and uses document polling until released', { timeout: 15000 }, async t => {
  const page = await pageFor(t, { id: 'other-session-task', status: 'running', ownedBySession: false });
  await assertLocked(page);
  await page.evaluate(() => { window.__current.activeTask = null; });
  await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__taskReads), 0, 'Never read another session’s private task endpoint');
});
