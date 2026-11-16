import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { create, createAnnotation, recordHuman, recordAgent, write, parse, sourceOnly, clone, metadataBlock } from '../../skills/ux-prototype/scripts/document.mjs';
import { taskContext } from '../../skills/ux-prototype/scripts/task-context.mjs';

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
    if (options.newKind) localStorage.setItem('ux-review:new-kind', JSON.stringify(options.newKind));
    if (options.recovery) localStorage.setItem('ux-review:draft:' + options.recovery.doc.id, JSON.stringify(options.recovery));
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
      task: async () => { window.__taskReads++; if (window.__status === 'completed') window.__current = window.__updated || updated; return result(); },
      cancel: async () => { window.__cancelCalls++; window.__status = 'cancelled'; window.__current.activeTask = null; return result(); },
    };
  }, { snapshot: options.snapshot || snapshot, updated, prompt, options });
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

const dynamicSource = '<!doctype html><html><body><script>const target = document.createElement("button"); target.id = "target"; target.textContent = "动态操作"; target.style.cssText = "margin:40px;width:300px;height:100px"; document.body.append(target); window.__UX_REVIEW_NAVIGATION__ = { capture: () => ({ key: "details", itemId: "42" }) };</script></body></html>';

async function submitDynamicRequest(page, initial, expectedBody, runtime = true) {
  await openHandoff(page);
  await page.getByRole('button', { name: /^发送到 DSH/ }).click();
  await page.waitForFunction(() => window.__submissions.length > 0 || document.body.textContent.includes('稳定锚点 ID 无效'));
  assert.equal(await page.getByText('稳定锚点 ID 无效。', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.__submissions.length), 1);
  const { html } = await page.evaluate(() => window.__saves[0]);
  const saved = parse(html), [annotation] = Object.values(saved.annotations);
  const submitted = await page.evaluate(() => window.__submissions[0]);
  assert.deepEqual(submitted.selectedIds, [annotation.id]);
  assert.equal(submitted.destination, 'dsh');
  assert.equal(saved.prd, initial.prd);
  assert.equal(annotation.body, expectedBody);
  assert.equal(Object.hasOwn(annotation.anchor, 'id'), false);
  assert.equal(annotation.anchor.selector, '#target');
  assert.deepEqual(annotation.anchor.view, { key: 'details', itemId: '42' });
  assert.equal(sourceOnly(html), sourceOnly(write(dynamicSource, initial)));
  // New picks carry the generating code through save and Host preparation.
  // Old drafts without provenance retain their selector-based fallback.
  const context = taskContext(saved, { format: 'ux-review-task', schemaVersion: 1, id: 'dynamic-task', documentId: saved.id, baseRevision: saved.revision, ...submitted }, { source: sourceOnly(html) });
  assert.deepEqual(context.selectedRequests[0].anchor, annotation.anchor);
  const target = context.selectedRequests[0].targetSource;
  if (runtime) {
    assert.equal(annotation.anchor.source.kind, 'runtime');
    assert.equal(target.matchedBy, 'runtime');
    assert.ok(target.html.includes('target.textContent = "动态操作"'));
  } else assert.equal(target.reason, 'not-in-static-source');
  await page.getByText('AI 修改中 · 只读', { exact: true }).waitFor();
  return annotation;
}

for (const mode of ['element', 'region', 'contextmenu']) {
  test(`DSH submission accepts a runtime target selected via ${mode}`, { timeout: 15000 }, async t => {
    const initial = create({ title: '动态元素提交回归', prd: '# 保留需求' });
    const page = await pageFor(t, { snapshot: { ...snapshot, html: write(dynamicSource, initial) }, newKind: 'change-request' });
    const target = page.frameLocator('iframe').locator('#target');
    if (mode === 'contextmenu') {
      await target.click({ button: 'right' });
      await page.getByRole('menuitem', { name: '添加修改意见', exact: true }).click();
    } else {
      await page.getByRole('button', { name: mode === 'element' ? '选择元素添加标注' : '框选区域添加标注', exact: true }).click();
      if (mode === 'element') await target.click();
      else {
        const rect = await target.evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        const frameBox = await page.locator('iframe').boundingBox(), scale = frameBox.width / Number(await page.locator('iframe').getAttribute('width'));
        await page.mouse.move(frameBox.x + (rect.x + rect.width * .1) * scale, frameBox.y + (rect.y + rect.height * .1) * scale);
        await page.mouse.down();
        await page.mouse.move(frameBox.x + (rect.x + rect.width * .8) * scale, frameBox.y + (rect.y + rect.height * .8) * scale);
        await page.mouse.up();
      }
    }
    const body = '将动态操作的文案改为确认';
    await page.getByRole('textbox', { name: '标注正文', exact: true }).filter({ visible: true }).fill(body);
    // Cover both explicit confirmation and saving an open composer on submit.
    if (mode !== 'region') await page.getByRole('button', { name: '完成编辑', exact: true }).filter({ visible: true }).click();
    const annotation = await submitDynamicRequest(page, initial, body);
    assert.equal(annotation.anchor.kind, mode === 'region' ? 'region' : 'element');
    if (mode === 'region') assert.ok(annotation.anchor.region.width > 0 && annotation.anchor.region.width < 1);
  });
}

for (const committed of [true, false]) {
  test(`DSH submission recovers a legacy null-ID ${committed ? 'confirmed' : 'unconfirmed'} draft`, { timeout: 15000 }, async t => {
    const initial = create({ title: '旧草稿提交回归', prd: '# 保留需求' }), draft = clone(initial);
    const annotation = createAnnotation({ id: 'ann-recovered', kind: 'change-request', body: '保留上次写的意见', anchor: { kind: 'element', id: null, selector: '#target', tag: 'button', text: '动态操作', view: { key: 'details', itemId: '42' } } });
    if (committed) draft.annotations[annotation.id] = annotation;
    const original = sourceOnly(write(dynamicSource, initial));
    const recovery = { path: snapshot.path, baseDoc: initial, baseSource: original, source: original, doc: draft, edits: committed ? {} : { [annotation.id]: { annotation, isNew: true, body: annotation.body } } };
    const page = await pageFor(t, { snapshot: { ...snapshot, html: write(dynamicSource, initial) }, recovery });
    await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
    await submitDynamicRequest(page, initial, annotation.body, false);
  });
}

test('opening an in-place AI result after stamping a new annotation does not recover a phantom draft', { timeout: 20000 }, async t => {
  const initial = create({ title: '原文件交付草稿回归', prd: '# 保留需求' });
  const staticSource = '<html><body><button id="target">原操作</button></body></html>';
  // Existing AI-authored files need not use write()'s exact whitespace around
  // metadata. Saving canonicalizes it without changing the user's prototype.
  const htmlBefore = staticSource.replace('</body>', metadataBlock(initial) + '</body>');
  const page = await pageFor(t, { snapshot: { ...snapshot, html: htmlBefore }, newKind: 'change-request' });
  await page.getByRole('button', { name: '选择元素添加标注', exact: true }).click();
  await page.frameLocator('iframe').locator('#target').click();
  await page.getByRole('textbox', { name: '标注正文', exact: true }).filter({ visible: true }).fill('把原操作改成已完成');
  await page.getByRole('button', { name: '完成编辑', exact: true }).filter({ visible: true }).click();
  await openHandoff(page);
  await page.getByRole('button', { name: /^发送到 DSH/ }).click();
  await page.getByText('AI 修改中 · 只读', { exact: true }).waitFor();
  const { html } = await page.evaluate(() => window.__saves[0]), saved = parse(html);
  const [annotation] = Object.values(saved.annotations);
  assert.ok(annotation.anchor.id, 'This regression requires adding an anchor to static source');
  const uxBefore = sourceOnly(html), uxAfter = uxBefore.replace('原操作', '已完成');
  const completed = recordAgent(saved, { taskId: 'handoff-task', summary: '已修改原文件', details: ['修改按钮文案'], selectedIds: [annotation.id], resolvedIds: [annotation.id], uxBefore, uxAfter });
  await page.evaluate(updated => { window.__updated = updated; window.__status = 'completed'; }, { ...snapshot, html: write(uxAfter, completed), version: '3' });
  await page.frameLocator('iframe').getByRole('button', { name: '已完成', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '打开修改结果', exact: true }).count(), 0, 'Do not offer a second navigation when the current file already shows this task result');
  assert.equal(await page.locator('.uxw-recovery').count(), 0, 'A successful save must not be resurrected as an old unsaved draft when opening the in-place result');
  assert.equal(await page.evaluate(id => localStorage.getItem('ux-review:draft:' + id), initial.id), null);
  assert.equal(await page.getByText('未保存', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page.getByRole('textbox', { name: 'PRD 正文', exact: true }).fill('# 用户在交付后继续编辑');
  await page.getByText('未保存', { exact: true }).waitFor();
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('ux-review:draft:' + id) || 'null')?.doc.prd === '# 用户在交付后继续编辑', initial.id);
  assert.equal(await page.getByRole('button', { name: '打开修改结果', exact: true }).count(), 0, 'A stale task action must not reload over later real edits');
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
