import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { exportReviewHtml } from '../src/export.mjs';
import { create, createAnnotation, recordHuman, clone, write, parse, sourceOnly } from '../../skills/ux-prototype/scripts/document.mjs';

test('full review export works offline, preserves metadata, and hides editing controls', async () => {
  const source = '<!doctype html><html><head><title>Offline prototype</title></head><body><form id="local-form"><input id="draft" placeholder="草稿"><button id="save" data-ux-anchor="save" type="submit">保存草稿</button></form><output id="result"></output><script>document.querySelector("#local-form").onsubmit=e=>{e.preventDefault();document.querySelector("#result").textContent="已保存";};</script></body></html>';
  const initial = create({ title: '离线交接测试', prd: '# 保存流程\n\n原始需求\n\n<script>window.diffExecuted=true</script>' });
  const changed = clone(initial);
  changed.prd += '\n\n人工修改需求\n\n| 字段 | 规则 |\n| --- | --- |\n| 名称 | 必填 |\n\n<table><tbody><tr><th colspan="2"><p>合并表头</p></th></tr><tr><td><p>目标</p></td><td><p>离线可读</p></td></tr></tbody></table>\n\n![需求示意](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=)';
  for (const [kind, body] of [['explanation', '保存当前草稿，保持输入内容。'], ['change-request', '按钮文案改为保存并继续。']]) {
    const annotation = createAnnotation({ kind, body, anchor: { kind: 'element', id: 'save', selector: '#save' } });
    changed.annotations[annotation.id] = annotation;
  }
  const doc = recordHuman(initial, changed, '评审补充');
  assert.equal(doc.changes[0].diff, undefined);
  const input = write(source, doc), exported = await exportReviewHtml(input);
  assert.deepEqual(parse(exported), doc);
  assert.equal(sourceOnly(exported), sourceOnly(input));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ux-export-'));
  const file = path.join(directory, 'review.html'); await fs.writeFile(file, exported);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true });
    const page = await context.newPage(), errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await page.goto(pathToFileURL(file).href);
    await page.getByText('只读评审', { exact: true }).waitFor();
    assert.equal(await page.locator('script#ux-document').count(), 1);
    assert.equal(await page.getByRole('button', { name: '保存文档', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '默认新增交互说明', exact: true }).count(), 0);
    assert.ok(await page.getByText('人工修改需求', { exact: true }).isVisible());
    assert.equal(await page.locator('.uxw-prd-content table').count(), 2);
    assert.equal(await page.locator('.uxw-prd-content th[colspan="2"]').innerText(), '合并表头');
    await page.waitForFunction(() => document.querySelector('.uxw-prd-content img')?.naturalWidth === 1);
    assert.equal(await page.locator('.uxw-prd-content').evaluate(el => getComputedStyle(el).fontSize), '14px');
    assert.equal(await page.locator('.uxw-prd-content h1').evaluate(el => getComputedStyle(el).fontSize), '20px');
    await page.getByRole('button', { name: '显示标注', exact: true }).click();
    await page.getByRole('button', { name: '标注 1：交互说明', exact: true }).click();
    assert.ok(await page.locator('.uxw-popover').getByText('保存当前草稿，保持输入内容。', { exact: true }).isVisible());
    await page.locator('.uxw-popover .uxw-card-body').click();
    assert.equal(await page.getByRole('textbox', { name: '标注正文', exact: true }).count(), 0);
    await page.getByRole('button', { name: '关闭标注', exact: true }).first().click();
    await page.getByRole('button', { name: '收起 PRD', exact: true }).click();
    const reopen = await page.getByRole('button', { name: '打开 PRD', exact: true }).boundingBox();
    const toolbar = await page.locator('.uxw-interaction-toolbar').boundingBox();
    assert.ok(toolbar.x + toolbar.width - reopen.x - reopen.width < 20, '离线阅读器的展开按钮也应位于最右端');
    const frame = page.frameLocator('iframe');
    await frame.locator('#draft').fill('离线输入');
    // Evaluate only this test's authored business action, avoiding scaled-frame
    // coordinate limitations in Playwright; UI annotation clicks above are real.
    await frame.locator('#save').evaluate(button => button.click());
    assert.equal(await frame.locator('#result').textContent(), '已保存');
    await page.getByRole('button', { name: '打开 PRD', exact: true }).click();
    await page.getByRole('button', { name: '全屏查看 PRD', exact: true }).click();
    await page.getByRole('button', { name: '返回侧栏', exact: true }).click();
    assert.equal(await frame.locator('#draft').inputValue(), '离线输入');
    await page.locator('.uxw-tabs button').filter({ hasText: '变更' }).click();
    assert.ok(await page.getByText('评审补充', { exact: true }).isVisible());
    const creation = page.locator('.uxw-change').filter({ has: page.getByText('创建 UX 协作文档', { exact: true }) });
    await creation.locator('summary').click();
    assert.ok(await creation.locator('pre').isVisible());
    assert.match(await creation.locator('pre').textContent(), /\+原始需求/);
    assert.doesNotMatch(await creation.locator('pre').textContent(), /人工修改需求/);
    assert.match(await creation.locator('pre').textContent(), /\+<script>window.diffExecuted=true<\/script>/);
    assert.equal(await creation.locator('pre script').count(), 0);
    assert.equal(await page.evaluate(() => window.diffExecuted), undefined);
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
  } finally { await browser.close(); await fs.rm(directory, { recursive: true, force: true }); }
});
