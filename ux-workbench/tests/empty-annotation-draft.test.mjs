import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { create, createAnnotation, recordHuman, write, parse, sourceOnly } from '../../skills/ux-prototype/scripts/document.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = '<!doctype html><html><head><title>空标注草稿</title><style>body{padding:40px;font:16px system-ui}button,input{padding:14px;margin:10px}#empty-area{margin-top:240px;width:220px;height:60px;background:#fafafa}</style></head><body><input id="business-input" placeholder="业务输入"><button id="target" type="button">添加说明的目标</button><div id="empty-area">原型空白区域</div></body></html>';
let server, browser, directory, origin;

before(async () => {
  directory = await fs.mkdtemp(resolve(os.tmpdir(), 'ux-empty-annotation-'));
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
const editor = page => page.getByRole('textbox', { name: '标注正文', exact: true }).filter({ visible: true });
const modeButton = (page, mode) => page.getByRole('button', { name: mode === 'expanded' ? '展开标注' : '显示标注', exact: true });

async function openPage(t, mode, doc = create({ title: '空标注不产生修改', prd: '# 需求\n\n原始需求。' })) {
  const snapshot = { path: '/workspace/empty-annotation.ux.html', name: 'empty-annotation.ux.html', version: '1', html: write(source, doc) };
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(snapshot => {
    if (window !== window.top) return;
    window.__saves = []; window.__dirty = false;
    window.__UX_REVIEW_HOST__ = {
      read: async () => snapshot,
      save: async args => { window.__saves.push(args); return { ...snapshot, html: args.html, version: String(window.__saves.length + 1) }; },
      onDirtyChange: dirty => { window.__dirty = dirty; },
    };
  }, snapshot);
  await page.goto(origin);
  await modeButton(page, mode).waitFor();
  await modeButton(page, mode).click();
  await frame(page).locator('#target').waitFor();
  await frame(page).locator('#business-input').fill('保留原型中的业务草稿');
  return { page, doc, snapshot };
}

async function clickInPrototype(page, selector, button = 'left') {
  const target = await frame(page).locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
  const box = await page.locator('iframe').boundingBox(), scale = box.width / Number(await page.locator('iframe').getAttribute('width'));
  await page.mouse.click(box.x + target.x * scale, box.y + target.y * scale, { button });
}

async function createDraft(page, body = '') {
  await clickInPrototype(page, '#target', 'right');
  await page.getByRole('menuitem', { name: '添加交互说明', exact: true }).click();
  await editor(page).waitFor();
  if (body) await editor(page).fill(body);
}

async function saveAndRead(page) {
  const count = await page.evaluate(() => window.__saves.length);
  await page.getByLabel('保存文档', { exact: true }).click();
  await page.waitForFunction(previous => window.__saves.length === previous + 1, count);
  return page.evaluate(() => window.__saves.at(-1).html);
}

async function assertCleanDismissal(page, doc, path) {
  await page.locator('.uxw-popover').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.__dirty === false);
  assert.equal(await page.locator('.uxw-marker').count(), 0, path + ': no empty marker remains');
  assert.equal(await page.locator('.uxw-note-rail .uxw-card').count(), 0, path + ': no empty rail card remains');
  assert.equal(await editor(page).count(), 0);
  assert.equal(await page.getByText('未保存', { exact: true }).count(), 0);
  // Draft persistence is debounced by 200ms. Check after its deadline so a
  // stale queued write cannot make a supposedly discarded empty draft reappear.
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(id => localStorage.getItem('ux-review:draft:' + id), doc.id), null, path + ': no empty recovery draft remains');
  assert.equal(await frame(page).locator('#target').getAttribute('data-ux-anchor'), null, path + ': empty creation must not stamp the live source');
  assert.equal(await frame(page).locator('#business-input').inputValue(), '保留原型中的业务草稿');
}

for (const mode of ['markers', 'expanded']) {
  test(`${mode}: confirming or dismissing an empty new annotation leaves no document change or recovery draft`, { timeout: 30000 }, async t => {
    const { page, doc, snapshot } = await openPage(t, mode);
    const dismissals = [
      ['confirm', '', () => page.getByLabel('完成编辑', { exact: true }).filter({ visible: true }).click()],
      ['whitespace confirm', ' \n\t  ', () => page.getByLabel('完成编辑', { exact: true }).filter({ visible: true }).click()],
      ['cancel', '  ', () => page.getByLabel('取消编辑', { exact: true }).filter({ visible: true }).click()],
      ['Escape', ' \n ', () => page.keyboard.press('Escape')],
      ['canvas click', '', () => page.locator('.uxw-canvas').click({ position: { x: 5, y: 5 } })],
      ['iframe click', '  ', () => clickInPrototype(page, '#empty-area')],
      ['same marker click', '', () => page.locator('.uxw-marker').click()],
    ];
    for (const [path, body, dismiss] of dismissals) {
      const before = await page.locator('iframe').boundingBox();
      await createDraft(page, body);
      assert.equal(await page.locator('.uxw-popover').count(), 1, 'New notes use a target-adjacent composer in both modes');
      assert.equal(await page.locator('.uxw-note-rail .uxw-card').count(), 0, 'Unconfirmed new notes must not append an editor to the rail');
      if (mode === 'expanded') {
        const after = await page.locator('iframe').boundingBox();
        for (const key of ['x', 'y', 'width']) assert.ok(Math.abs(after[key] - before[key]) <= 1, `An empty expanded composer must not shift the prototype's ${key}`);
      }
      await dismiss();
      await assertCleanDismissal(page, doc, path);
    }
    await page.getByRole('tab', { name: /^标注/ }).click();
    assert.equal(await page.locator('[data-annotation-index-id]').count(), 0);
    assert.equal(await page.evaluate(() => window.__saves.length), 0, 'Dismissal must not save automatically');
    const saved = await saveAndRead(page);
    assert.deepEqual(parse(saved), doc, 'Saving after empty dismissal must preserve annotations, revision and history exactly');
    assert.equal(sourceOnly(saved), sourceOnly(snapshot.html), 'No source anchor may be added for a discarded empty draft');
  });
}

test('nonempty new drafts survive outside clicks and Escape in both modes and can still be confirmed', { timeout: 30000 }, async t => {
  for (const mode of ['markers', 'expanded']) {
    const { page, doc } = await openPage(t, mode);
    const body = `${mode}：已输入的说明应保留，继续后可以确认。`;
    await createDraft(page, body);
    await clickInPrototype(page, '#empty-area');
    await page.locator('.uxw-popover').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.uxw-marker').count(), 1);
    assert.equal(await page.evaluate(() => window.__dirty), true);
    await page.waitForFunction(({ id, body }) => {
      const draft = JSON.parse(localStorage.getItem('ux-review:draft:' + id) || 'null');
      return Object.values(draft?.edits || {}).some(edit => edit.body === body && edit.isNew);
    }, { id: doc.id, body });
    await page.locator('.uxw-marker').click();
    assert.equal(await editor(page).inputValue(), body);
    await page.keyboard.press('Escape');
    await page.locator('.uxw-popover').waitFor({ state: 'detached' });
    await page.locator('.uxw-marker').click();
    assert.equal(await editor(page).inputValue(), body);
    await page.getByLabel('完成编辑', { exact: true }).filter({ visible: true }).click();
    await editor(page).waitFor({ state: 'detached' });
    if (mode === 'expanded') {
      assert.equal(await page.locator('.uxw-popover').count(), 0);
      await page.locator('.uxw-note-rail .uxw-card').waitFor();
    }
    const saved = await saveAndRead(page), savedDoc = parse(saved), [annotation] = Object.values(savedDoc.annotations);
    assert.equal(Object.keys(savedDoc.annotations).length, 1);
    assert.equal(annotation.body, body);
    assert.match(annotation.anchor.id, /^ux-/);
    assert.equal(savedDoc.changes.length, doc.changes.length + 1);
    assert.equal(await page.evaluate(id => localStorage.getItem('ux-review:draft:' + id), doc.id), null);
  }
});

test('clearing an existing annotation cannot silently delete its saved body when confirmed', { timeout: 30000 }, async t => {
  const originalBody = '已有说明：提交前保留用户输入。';
  for (const mode of ['markers', 'expanded']) {
    const initial = create({ title: '已有标注清空保护', prd: '# 原需求' });
    const annotation = createAnnotation({ body: originalBody, anchor: { kind: 'element', selector: '#target' } });
    const doc = recordHuman(initial, { ...initial, annotations: { [annotation.id]: annotation } }, '已有说明');
    const { page, snapshot } = await openPage(t, mode, doc);
    if (mode === 'markers') await page.locator('.uxw-marker').click();
    await page.getByLabel('编辑标注正文', { exact: true }).filter({ visible: true }).click();
    await editor(page).fill(' \n\t ');
    await page.getByLabel('完成编辑', { exact: true }).filter({ visible: true }).click();
    await page.getByRole('status').filter({ hasText: '请填写标注内容，或取消本次编辑。' }).waitFor();
    assert.equal(await editor(page).isVisible(), true, 'A blank replacement requires correction or explicit cancellation');
    assert.equal(await page.locator('.uxw-marker').count(), 1);
    await page.getByLabel('取消编辑', { exact: true }).filter({ visible: true }).click();
    await editor(page).waitFor({ state: 'detached' });
    assert.equal(await page.getByText(originalBody, { exact: true }).filter({ visible: true }).count(), 1);
    await page.waitForFunction(() => window.__dirty === false);
    const saved = await saveAndRead(page);
    assert.deepEqual(parse(saved), doc, 'Original text, annotation identity and change history must survive the rejected blank edit');
    assert.equal(sourceOnly(saved), sourceOnly(snapshot.html));
    assert.equal(await page.evaluate(id => localStorage.getItem('ux-review:draft:' + id), doc.id), null);
  }
});
