import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import os from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, createAnnotation, write } from '../../skills/ux-prototype/scripts/document.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let browser, server, temporary, origin;
before(async () => {
  temporary = await fs.mkdtemp(resolve(os.tmpdir(), 'ux-expanded-position-'));
  server = await createServer({ root, cacheDir: resolve(temporary, 'vite'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => { await browser?.close(); await server?.close(); if (temporary) await fs.rm(temporary, { recursive: true, force: true }); });
const source = '<!doctype html><html><head><style>body{margin:0;height:1800px;font:16px system-ui}button{margin:80px;padding:14px}input{padding:12px}</style></head><body><button id="target" data-ux-anchor="target">添加说明目标</button><button id="new-target">新增说明位置</button><input id="draft" value="保留输入"></body></html>';
const position = page => page.evaluate(() => {
  const f = document.querySelector('iframe'), c = document.querySelector('.uxw-canvas'), r = f.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, panX: Number(c.dataset.panX), panY: Number(c.dataset.panY), scrollTop: c.scrollTop, scrollLeft: c.scrollLeft };
});
async function open(t, count = Number(process.env.CARD_COUNT || 12)) {
  const doc = create({ title: '展开新增定位回归', prd: '# 需求\n保持新增前画布位置。' });
  for (let i = 0; i < count; i++) {
    const a = createAnnotation({ id: 'ann-old-' + i, kind: 'explanation', body: `第 ${i + 1} 条已有说明。\n\n该控件在当前页显示，添加新批注时保留页面位置。`, anchor: { kind: 'element', id: 'target', selector: '#target' } });
    doc.annotations[a.id] = a;
  }
  const snapshot = { path: '/tmp/expanded-position.ux.html', name: 'expanded-position.ux.html', version: '1', html: write(source, doc) };
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } }); page.setDefaultTimeout(7000); t.after(() => page.close());
  await page.addInitScript(snapshot => { window.__UX_REVIEW_HOST__ = { read: async () => snapshot, save: async args => ({ ...snapshot, html: args.html, version: '2' }) }; }, snapshot);
  await page.goto(origin); await page.getByLabel('展开标注', { exact: true }).click();
  await page.locator('.uxw-note-rail .uxw-card').last().waitFor();
  const frame = page.frameLocator('iframe'); await frame.locator('#target').waitFor();
  await page.waitForTimeout(120);
  return { page, frame };
}
for (const manual of [false, true]) test(`adding an expanded annotation preserves ${manual ? 'manual zoom and pan' : 'fit view'}`, async t => {
  const { page, frame } = await open(t);
  if (manual) {
    await page.getByLabel('原型缩放', { exact: true }).selectOption('0.75');
    await page.locator('.uxw-canvas').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
  }
  const before = await position(page);
  const local = await frame.locator('#new-target').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const box = await page.locator('iframe').boundingBox(), scale = box.width / 1280;
  await page.mouse.click(box.x + local.x * scale, box.y + local.y * scale, { button: 'right' });
  await page.getByRole('menuitem', { name: '添加交互说明', exact: true }).click();
  await page.locator('textarea[aria-label="标注正文"]').waitFor({ state: 'attached' });
  await page.waitForTimeout(200);
  const after = await position(page);
  assert.ok(Math.abs(after.x - before.x) < 4, `新增批注不应水平移动UX: x ${before.x} → ${after.x}`);
  assert.equal(after.width, before.width);
  assert.ok(Math.abs(after.y - before.y) < 4, `新增批注不应移走UX: y ${before.y} → ${after.y}`);
  const editor = await page.getByRole('textbox', { name: '标注正文', exact: true }).boundingBox();
  const canvas = await page.locator('.uxw-canvas').boundingBox();
  assert.ok(editor.y >= canvas.y && editor.y + editor.height <= canvas.y + canvas.height, '新标注编辑框应在画布内可见');
});
