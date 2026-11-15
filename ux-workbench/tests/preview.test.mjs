import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { previewHtml, stampAnchor } from '../src/preview.mjs';
let browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); });
const source = `<!doctype html><html><head><title>原型测试</title></head><body style="margin:30px;height:1600px"><button id="action">提交申请</button><input id="name" placeholder="姓名"><button id="open">打开弹窗</button><dialog id="dialog"><button id="confirm">确认申请</button></dialog><div id="region" style="width:400px;height:200px;margin-top:40px">列表区域</div><script>window.count=0;document.querySelector('#action').onclick=()=>window.count++;document.querySelector('#open').onclick=()=>document.querySelector('#dialog').showModal();localStorage.setItem('draft','原型草稿');</script></body></html>`;
async function setup() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent('<iframe id="preview" sandbox="allow-scripts allow-forms" style="width:900px;height:650px"></iframe>');
  await page.evaluate(html => { window.messages = []; addEventListener('message', e => { if (e.source === document.querySelector('iframe').contentWindow) window.messages.push(e.data); }); document.querySelector('iframe').srcdoc = html; }, previewHtml(source, 'test-token'));
  await page.waitForFunction(() => window.messages.some(m => m.type === 'ready'));
  return { page, frame: page.frames()[1], send: data => page.evaluate(data => document.querySelector('iframe').contentWindow.postMessage({ channel: 'craft-ux-host', token: 'test-token', ...data }, '*'), data) };
}
async function message(page, type) {
  await page.waitForFunction(type => window.messages.some(m => m.type === type), type);
  return page.evaluate(type => window.messages.filter(m => m.type === type).at(-1), type);
}
test('preview preserves business interaction, input and private demo storage while annotating', async () => {
  const { page, frame, send } = await setup();
  await frame.locator('#action').click(); await frame.locator('#name').fill('保留输入');
  assert.equal(await frame.evaluate(() => window.count), 1);
  assert.equal(await frame.evaluate(() => localStorage.getItem('draft')), '原型草稿');
  await send({ type: 'mode', mode: 'element' }); await frame.locator('#action').click();
  const picked = await message(page, 'picked'); assert.equal(picked.anchor.selector, '#action');
  assert.equal(await frame.evaluate(() => window.count), 1);
  assert.equal(await frame.locator('#name').inputValue(), '保留输入');
  const anchor = { ...picked.anchor, id: 'ux-stable-button' };
  await send({ type: 'stamp', anchor }); await send({ type: 'annotations', annotations: [{ id: 'ann-one', anchor }] });
  await page.waitForFunction(() => window.messages.some(m => m.type === 'snapshot' && m.anchors[0]?.found));
  assert.equal(await frame.locator('#action').getAttribute('data-ux-anchor'), 'ux-stable-button');
  await frame.locator('#action').click(); assert.equal(await frame.evaluate(() => window.count), 2);
  await page.close();
});
test('right click creates target context only while annotations are visible', async () => {
  const { page, frame, send } = await setup();
  await send({ type: 'annotation-visibility', value: 'off' });
  await frame.locator('#action').click({ button: 'right' });
  assert.equal(await page.evaluate(() => window.messages.filter(m => m.type === 'contextmenu').length), 0);
  await send({ type: 'annotation-visibility', value: 'markers' });
  await frame.locator('#action').click({ button: 'right' });
  const menu = await message(page, 'contextmenu'); assert.equal(menu.anchor.selector, '#action'); assert.ok(menu.x > 0);
  await page.close();
});
test('hidden modal anchors become visible when the prototype opens the dialog', async () => {
  const { page, frame, send } = await setup();
  await send({ type: 'annotations', annotations: [{ id: 'ann-dialog', anchor: { kind: 'element', selector: '#confirm', tag: 'button' } }] });
  await page.waitForFunction(() => window.messages.some(m => m.type === 'snapshot' && m.anchors[0]?.id === 'ann-dialog'));
  assert.equal((await message(page, 'snapshot')).anchors[0].rect, null);
  await frame.locator('#open').click();
  await page.waitForFunction(() => window.messages.some(m => m.type === 'snapshot' && m.anchors[0]?.rect?.width > 0));
  await frame.locator('#confirm').click({ button: 'right' });
  assert.equal((await message(page, 'contextmenu')).anchor.selector, '#confirm');
  await page.close();
});
test('region picking reports normalized coordinates without activating a business action', async () => {
  const { page, frame, send } = await setup();
  await send({ type: 'mode', mode: 'region' });
  const box = await frame.locator('#region').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 180, box.y + 100); await page.mouse.up();
  const { anchor } = await message(page, 'picked');
  assert.equal(anchor.kind, 'region'); assert.ok(anchor.region.width > 0 && anchor.region.width < 1); assert.ok(anchor.region.height > 0 && anchor.region.height < 1);
  await page.close();
});
test('wrong channel tokens cannot trigger picking or trusted stamping', async () => {
  const { page, frame } = await setup();
  await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ channel: 'craft-ux-host', token: 'other-token', type: 'mode', mode: 'element' }, '*'));
  await frame.locator('#action').click();
  assert.equal(await frame.evaluate(() => window.count), 1);
  assert.equal(await page.evaluate(() => window.messages.filter(m => m.type === 'picked').length), 0);
  await page.close();
});
test('local form submit handlers and method=dialog work while external form navigation stays blocked', async () => {
  const { page, frame } = await setup();
  const initialUrl = frame.url();
  const requests = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await frame.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<form id="local-form" action="https://example.invalid/submit"><button id="local-submit">本地保存</button></form><dialog id="native-dialog"><form method="dialog"><button id="native-close">关闭弹窗</button></form></dialog>');
    window.submits = 0;
    document.querySelector('#local-form').addEventListener('submit', () => window.submits++);
  });
  await frame.locator('#local-submit').click();
  assert.equal(await frame.evaluate(() => window.submits), 1);
  assert.equal(frame.url(), initialUrl);
  await frame.evaluate(() => document.querySelector('#local-form').submit());
  assert.equal(frame.url(), initialUrl);
  await frame.evaluate(() => document.querySelector('#native-dialog').showModal());
  await frame.locator('#native-close').click();
  assert.equal(await frame.locator('#native-dialog').evaluate(dialog => dialog.open), false);
  assert.deepEqual(requests, []);
  await page.close();
});
test('static anchor stamping preserves unique IDs', async () => {
  const page = await browser.newPage();
  const result = await page.evaluate(({ source, fn }) => {
    const stamp = new Function('return (' + fn + ')')();
    const first = stamp(source, { kind: 'element', selector: '#action', tag: 'button', text: '提交申请' });
    return { first, second: stamp(first.source, first.anchor) };
  }, { source, fn: stampAnchor.toString() });
  assert.ok(result.first.anchor.id.startsWith('ux-'));
  assert.equal(result.first.anchor.id, result.second.anchor.id);
  assert.equal((result.second.source.match(/data-ux-anchor=/g) || []).length, 1);
  await page.close();
});
