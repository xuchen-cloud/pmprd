import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { create, createAnnotation, write } from '../../skills/ux-prototype/scripts/document.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = `<!doctype html><html><head><style>
  html,body{margin:0;font:16px Arial}body{height:2000px;position:relative;background:white}
  button{position:absolute;padding:12px}.left{left:8%}.right{right:8%}.first{top:45px}.second{top:105px}
  input,textarea,[contenteditable]{position:absolute;left:35%;top:200px;width:180px;padding:10px}
  textarea{top:260px}[contenteditable]{top:340px;min-height:30px;border:1px solid #ddd}
</style></head><body tabindex="0">
<button class="left first" id="left-explanation" data-ux-anchor="left-explanation">左侧说明</button>
<button class="left second" id="left-request" data-ux-anchor="left-request">左侧意见</button>
<button class="right first" id="right-request" data-ux-anchor="right-request">右侧意见</button>
<button class="right second" id="right-explanation" data-ux-anchor="right-explanation">右侧说明</button>
<input id="business-input" aria-label="业务输入"><textarea id="business-textarea" aria-label="业务长文本"></textarea>
<div id="business-richtext" contenteditable="true" role="textbox" aria-label="业务富文本"></div>
<a id="business-link" href="#details" style="position:absolute;left:8%;top:430px">业务链接</a>
<script>window.prototypeInstance = Math.random().toString(36); window.prototypeClicks=0; document.querySelectorAll('button,a').forEach(el=>el.addEventListener('click',()=>window.prototypeClicks++));</script></body></html>`;
const doc = create({ title: '画布导航回归', prd: '# 需求\n\n编辑时保留空格与原型输入。' });
for (const [id, kind] of [['left-explanation', 'explanation'], ['left-request', 'change-request'], ['right-request', 'change-request'], ['right-explanation', 'explanation']]) {
  const annotation = createAnnotation({ kind, body: id, anchor: { kind: 'element', id, selector: '#' + id } });
  doc.annotations[annotation.id] = annotation;
}
const snapshot = { path: '/tmp/canvas-navigation.ux.html', name: 'canvas-navigation.ux.html', version: '1', html: write(source, doc) };

const scaleOf = page => page.locator('iframe').evaluate(el => el.getBoundingClientRect().width / Number(el.width));
const geometryOf = page => page.locator('iframe').evaluate(el => ({ width: el.width, height: el.height }));
const waitForScale = (page, previous, direction) => page.waitForFunction(({ previous, direction }) => {
  const frame = document.querySelector('iframe');
  const scale = frame.getBoundingClientRect().width / Number(frame.width);
  return direction > 0 ? scale > previous + .001 : scale < previous - .001;
}, { previous, direction }, { timeout: 4000 });
async function framePoint(page, x, y) {
  const rect = await page.locator('iframe').boundingBox();
  const scale = await scaleOf(page);
  return { x: rect.x + x * scale, y: rect.y + y * scale };
}
async function resetNavigation(page) {
  await page.locator('.uxw-canvas').focus();
  await page.keyboard.press('Control+0');
  await page.getByLabel('原型缩放', { exact: true }).selectOption('1');
  await page.locator('.uxw-canvas').evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
  await page.locator('.uxw-preview-area').evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
}

test('canvas navigation keeps the prototype interactive and lays out annotations responsively', { timeout: 60000 }, async t => {
  const cacheDir = await fs.mkdtemp(resolve(os.tmpdir(), 'ux-canvas-vite-'));
  const fixtureId = '/__canvas-test-mount.jsx';
  const server = await createServer({ root, cacheDir, server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'canvas-navigation-test-fixture',
    resolveId(id) { if (id === fixtureId) return '\0' + fixtureId; },
    load(id) { if (id === '\0' + fixtureId) return 'import React from "react"; import {createRoot} from "react-dom/client"; import Workbench from "/src/Workbench.jsx"; export const mount = (node, host) => createRoot(node).render(React.createElement(Workbench, {host}));'; },
  }] });
  await server.listen();
  t.after(async () => { await server.close(); await fs.rm(cacheDir, { recursive: true, force: true }); });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const open = async (viewport = { width: 1800, height: 1000 }) => {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(snapshot => {
      // DSH's white surface token must not override the warm canvas colour.
      document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--dsw-alias-bg-layer-2', '#fff'));
      window.__UX_REVIEW_HOST__ = { read: async () => snapshot, save: async args => ({ ...snapshot, html: args.html, version: '2' }) };
    }, snapshot);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.locator('.uxw-marker').first().waitFor();
    return { page, frame: page.frames().find(f => f.parentFrame()), errors };
  };

  await t.test('Ctrl shortcuts and wheel work over the canvas and iframe without reflow or reload', async () => {
    const { page, frame, errors } = await open();
    try {
      await frame.locator('#business-input').fill('保留尚未提交的业务输入');
      const instance = await frame.evaluate(() => window.prototypeInstance);
      const logicalSize = await geometryOf(page);
      const canvas = page.locator('.uxw-canvas');
      await canvas.focus();
      const initialScale = await scaleOf(page);
      await page.keyboard.press('Control+=');
      await waitForScale(page, initialScale, 1);
      const enlarged = await scaleOf(page);
      await page.keyboard.press('Control+-');
      await waitForScale(page, enlarged, -1);
      assert.deepEqual(await geometryOf(page), logicalSize, 'Zoom changes only display scale, not the iframe viewport');

      await frame.locator('body').focus();
      const fromIframe = await scaleOf(page);
      await page.keyboard.press('Control+=');
      await waitForScale(page, fromIframe, 1);
      await page.keyboard.press('Control+-');
      await waitForScale(page, fromIframe + .01, -1);
      assert.deepEqual(await geometryOf(page), logicalSize);

      const canvasBox = await canvas.boundingBox();
      await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + 8);
      const beforeCanvasWheel = await scaleOf(page);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -60);
      await page.keyboard.up('Control');
      await waitForScale(page, beforeCanvasWheel, 1);

      // The wheel must be cancelled in the document that receives it, before the
      // host browser gets a chance to zoom the entire DSH window.
      await frame.evaluate(() => {
        window.wheelEvents = [];
        const preventDefault = Event.prototype.preventDefault;
        Event.prototype.preventDefault = function () {
          preventDefault.call(this);
          if (this.type === 'wheel') window.wheelEvents.push({ ctrl: this.ctrlKey, prevented: this.defaultPrevented });
        };
      });
      const point = await framePoint(page, 900, 350);
      await page.mouse.move(point.x, point.y);
      const beforeWheel = await scaleOf(page);
      const hostScale = await page.evaluate(() => ({ ratio: devicePixelRatio, viewport: visualViewport.scale }));
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -180);
      await page.keyboard.up('Control');
      await waitForScale(page, beforeWheel, 1);
      assert.ok(await frame.evaluate(() => window.wheelEvents.some(event => event.ctrl && event.prevented)), 'Iframe Ctrl+wheel prevents host browser zoom');
      assert.deepEqual(await page.evaluate(() => ({ ratio: devicePixelRatio, viewport: visualViewport.scale })), hostScale);
      assert.deepEqual(await geometryOf(page), logicalSize);
      const zoomedPoint = await framePoint(page, 900, 350);
      assert.ok(Math.abs(zoomedPoint.x - point.x) < 2 && Math.abs(zoomedPoint.y - point.y) < 2, 'Wheel zoom keeps the logical point under the cursor stationary');
      assert.equal(await frame.evaluate(() => window.prototypeInstance), instance, 'Zoom never reloads the prototype');
      assert.equal(await frame.locator('#business-input').inputValue(), '保留尚未提交的业务输入');

      await page.evaluate(() => {
        const button = document.createElement('button'); button.id = 'host-outside'; button.textContent = '其他插件';
        button.style.cssText = 'position:fixed;right:0;bottom:0;z-index:99999'; document.body.append(button);
      });
      await page.locator('#host-outside').hover();
      await page.locator('#host-outside').focus();
      const scopedScale = await scaleOf(page);
      await page.keyboard.press('Control+=');
      assert.equal(await scaleOf(page), scopedScale, 'Keyboard shortcuts are scoped to the active workbench');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await t.test('hovering between multiple workbenches only changes the current canvas', async () => {
    const { page, errors } = await open();
    try {
      await page.evaluate(async () => {
        const first = document.getElementById('root');
        first.style.cssText = 'width:900px;height:100vh;flex:none';
        document.body.style.display = 'flex';
        const second = document.createElement('div'); second.id = 'second-workbench'; second.style.cssText = 'width:900px;height:100vh;flex:none';
        document.body.append(second);
        const { mount } = await import('/__canvas-test-mount.jsx'); mount(second, window.__UX_REVIEW_HOST__);
      });
      const first = page.locator('#root .uxw-canvas'), second = page.locator('#second-workbench .uxw-canvas');
      await second.locator('.uxw-marker').first().waitFor();
      const scale = canvas => canvas.locator('iframe').evaluate(el => el.getBoundingClientRect().width / Number(el.width));
      await page.evaluate(() => document.activeElement.blur());
      const beforeFirst = await scale(first), beforeSecond = await scale(second);
      await first.hover({ position: { x: 30, y: 8 } });
      await second.hover({ position: { x: 30, y: 8 } });
      await page.keyboard.press('Control+=');
      await page.waitForFunction(previous => {
        const frame = document.querySelector('#second-workbench iframe');
        return frame.getBoundingClientRect().width / Number(frame.width) > previous + .001;
      }, beforeSecond);
      assert.equal(await scale(first), beforeFirst, 'Leaving the first canvas revokes its shortcut ownership');
      const secondScale = await scale(second);
      await first.hover({ position: { x: 30, y: 8 } });
      await page.keyboard.press('Control+=');
      await waitForScale(page, beforeFirst, 1);
      assert.equal(await scale(second), secondScale, 'Returning to the first canvas does not also zoom the second');
      for (const focusPrevious of [() => first.focus(), () => page.frameLocator('#root iframe').locator('body').focus()]) {
        await focusPrevious();
        const box = await second.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 8);
        await page.waitForFunction(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#second-workbench'), { x: box.x + box.width / 2, y: box.y + 8 }, { timeout: 3000 });
        const previousFirst = await scale(first), previousSecond = await scale(second);
        await page.keyboard.press('Control+=');
        await page.waitForFunction(previous => {
          const frame = document.querySelector('#second-workbench iframe');
          return frame.getBoundingClientRect().width / Number(frame.width) > previous + .001;
        }, previousSecond, { timeout: 4000 });
        assert.equal(await scale(first), previousFirst, 'Hover ownership wins over stale canvas or iframe focus in another workbench');
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await t.test('hover navigation covers cards and UX controls while preserving only active canvas text input', async () => {
    const { page, frame, errors } = await open();
    try {
      const canvas = page.locator('.uxw-canvas');
      const ready = () => page.waitForFunction(() => document.querySelector('.uxw-canvas').classList.contains('is-panning-ready'), null, { timeout: 3000 });
      const released = () => page.waitForFunction(() => !document.querySelector('.uxw-canvas').classList.contains('is-panning-ready'), null, { timeout: 3000 });
      const wheel = async () => { await page.keyboard.down('Control'); await page.mouse.wheel(0, -80); await page.keyboard.up('Control'); };
      const richPrd = page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true });
      await richPrd.fill('PRD');
      await canvas.hover({ position: { x: 30, y: 8 } });
      await page.keyboard.down('Space'); await ready();
      assert.equal(await richPrd.textContent(), 'PRD', 'Hovering the canvas prevents a stale PRD focus from receiving Space');
      assert.equal(await richPrd.evaluate(el => el === document.activeElement), true, 'Temporary panning preserves the outside text focus');
      await page.keyboard.up('Space'); await released();
      await richPrd.hover(); await page.keyboard.press('Space');
      assert.equal((await richPrd.textContent()).replaceAll('\u00a0', ' '), 'PRD ', 'Typing resumes normally after the pointer leaves the canvas');

      // Neither a native UX button nor a link should activate when Space is
      // being used to grab the canvas.
      for (const selector of ['#left-explanation', '#business-link']) {
        await frame.locator(selector).focus(); await frame.locator(selector).hover();
        const clicks = await frame.evaluate(() => window.prototypeClicks);
        await page.keyboard.down('Space'); await ready();
        await page.keyboard.up('Space'); await released();
        assert.equal(await frame.evaluate(() => window.prototypeClicks), clicks);
        assert.equal(await frame.evaluate(() => location.hash), '');
      }

      await page.getByLabel('展开标注', { exact: true }).click();
      const cardTitle = page.locator('.uxw-note-rail .uxw-card-title').first();
      await cardTitle.focus(); await cardTitle.hover();
      const titleBox = await cardTitle.boundingBox();
      await page.keyboard.down('Space'); await ready();
      await page.mouse.down(); await page.mouse.move(titleBox.x + titleBox.width / 2 + 40, titleBox.y + titleBox.height / 2 + 25, { steps: 5 });
      await page.mouse.up(); await page.keyboard.up('Space'); await released();
      assert.ok(await canvas.evaluate(el => Number(el.dataset.panX) > 30 && Number(el.dataset.panY) > 15), 'Dragging can start on a card button');
      await richPrd.focus();
      await page.locator('.uxw-note-rail .uxw-card-body').first().hover();
      const beforeCardWheel = await scaleOf(page); await wheel(); await waitForScale(page, beforeCardWheel, 1);

      await page.getByLabel('显示标注', { exact: true }).click();
      await page.locator('.uxw-marker').first().click();
      const floatingTitle = page.locator('.uxw-popover .uxw-card-title');
      await floatingTitle.focus(); await floatingTitle.hover();
      await page.keyboard.down('Space'); await ready();
      assert.equal(await floatingTitle.evaluate(el => getComputedStyle(el).cursor), 'grab', 'Floating cards expose the same grab cursor');
      await page.keyboard.up('Space'); await released();
      await floatingTitle.hover();
      const beforePopupWheel = await scaleOf(page); await wheel(); await waitForScale(page, beforePopupWheel, 1);
      await page.locator('.uxw-document-heading').click();

      // Merely hovering an input is not editing it. Focus in a UX field is the
      // exception, even when the pointer has moved onto another canvas object.
      await resetNavigation(page);
      await frame.locator('#business-input').hover();
      const beforeUnfocusedWheel = await scaleOf(page); await wheel(); await waitForScale(page, beforeUnfocusedWheel, 1);
      await frame.locator('#business-input').fill('UX');
      await frame.locator('#left-explanation').hover();
      const editingScale = await scaleOf(page);
      await page.keyboard.press('Space'); await released();
      assert.equal(await frame.locator('#business-input').inputValue(), 'UX ');
      await wheel();
      assert.equal(await scaleOf(page), editingScale, 'An actually focused UX input keeps its own wheel interaction');
      await canvas.hover({ position: { x: 30, y: 8 } }); await wheel();
      assert.equal(await scaleOf(page), editingScale, 'The host also respects an input focused inside the sandbox');

      await page.getByLabel('展开标注', { exact: true }).click();
      await page.getByLabel('编辑标注正文', { exact: true }).first().click();
      const annotation = page.getByRole('textbox', { name: '标注正文', exact: true }).filter({ visible: true });
      await annotation.fill('批注');
      await canvas.hover({ position: { x: 30, y: 8 } });
      const annotationScale = await scaleOf(page);
      await page.keyboard.press('Space'); await released();
      assert.equal(await annotation.inputValue(), '批注 ');
      await wheel();
      assert.equal(await scaleOf(page), annotationScale, 'A focused annotation editor keeps its native text interactions');
      const prototypePoint = await framePoint(page, 900, 350);
      await page.mouse.move(prototypePoint.x, prototypePoint.y); await wheel();
      assert.equal(await scaleOf(page), annotationScale, 'Iframe wheel messages also preserve an annotation editor focused in the host');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await t.test('Space drags from canvas or iframe, while text fields keep typing normally', async () => {
    const { page, frame, errors } = await open({ width: 1520, height: 1000 });
    try {
      await resetNavigation(page);
      const canvas = page.locator('.uxw-canvas');
      await canvas.focus();
      const box = await canvas.boundingBox();
      const before = await page.locator('iframe').boundingBox();
      await page.mouse.move(box.x + 180, box.y + 8);
      await page.keyboard.down('Space');
      await page.mouse.down();
      await page.mouse.move(box.x + 60, box.y + 8, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.up('Space');
      const after = await page.locator('iframe').boundingBox();
      assert.ok(after.x < before.x - 50 || after.y < before.y - 30, 'Holding Space pans the canvas');
      assert.notEqual(await canvas.evaluate(el => getComputedStyle(el).cursor), 'grabbing');

      await resetNavigation(page);
      await frame.locator('body').focus();
      const point = await framePoint(page, 850, 420);
      const iframeBefore = await page.locator('iframe').boundingBox();
      await page.mouse.move(point.x, point.y);
      await page.keyboard.down('Space');
      // The cross-origin preview bridge must deliver Space before pointerdown.
      await page.waitForFunction(() => [...document.querySelectorAll('.uxw-preview-area,.uxw-canvas')].some(el => ['grab', 'grabbing'].includes(getComputedStyle(el).cursor)), null, { timeout: 4000 });
      await page.mouse.down();
      await page.mouse.move(point.x - 100, point.y - 50, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.up('Space');
      const iframeAfter = await page.locator('iframe').boundingBox();
      assert.ok(iframeAfter.x < iframeBefore.x - 50 || iframeAfter.y < iframeBefore.y - 25, 'Space inside the prototype hands panning to the workbench');
      await page.waitForFunction(() => ![...document.querySelectorAll('.uxw-preview-area,.uxw-canvas')].some(el => ['grab', 'grabbing'].includes(getComputedStyle(el).cursor)));

      await canvas.focus();
      await page.keyboard.down('Space');
      await page.waitForFunction(() => document.querySelector('.uxw-canvas').classList.contains('is-panning-ready'));
      await page.evaluate(() => dispatchEvent(new Event('blur')));
      await page.waitForFunction(() => !document.querySelector('.uxw-canvas').classList.contains('is-panning-ready'));
      await page.keyboard.up('Space');
      await canvas.focus();
      await page.mouse.move(box.x + 180, box.y + 8);
      await page.keyboard.down('Space');
      await page.mouse.down();
      await page.waitForFunction(() => document.querySelector('.uxw-canvas').classList.contains('is-panning'));
      await canvas.dispatchEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse' });
      await page.waitForFunction(() => !document.querySelector('.uxw-canvas').classList.contains('is-panning-ready'));
      await page.mouse.up();
      await page.keyboard.up('Space');

      await resetNavigation(page);
      for (const selector of ['#business-input', '#business-textarea', '#business-richtext']) {
        const field = frame.locator(selector);
        await field.fill('text');
        const beforeTyping = await scaleOf(page);
        await field.press('Space');
        assert.equal(await field.evaluate(el => (el.value ?? el.textContent).replaceAll('\u00a0', ' ')), 'text ', 'A business text field receives its literal space');
        await field.press('Control+=');
        assert.equal(await scaleOf(page), beforeTyping, 'Editing a business text field does not zoom the canvas');
      }
      await resetNavigation(page);
      await frame.evaluate(() => scrollTo(0, 0));
      await page.locator('.uxw-marker').first().click();
      await page.getByLabel('编辑标注正文', { exact: true }).filter({ visible: true }).click();
      const comment = page.getByRole('textbox', { name: '标注正文', exact: true }).filter({ visible: true });
      await comment.fill('comment');
      const commentScale = await scaleOf(page);
      await comment.press('Space');
      await comment.press('Control+=');
      assert.equal(await comment.inputValue(), 'comment ');
      assert.equal(await scaleOf(page), commentScale);
      await page.keyboard.press('Escape');
      const richPrd = page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true });
      await richPrd.hover();
      await richPrd.fill('需求');
      await richPrd.press('Space');
      await richPrd.press('Control+=');
      assert.equal(await richPrd.textContent().then(value => value.replaceAll('\u00a0', ' ')), '需求 ');
      assert.equal(await scaleOf(page), commentScale, 'PRD rich text input never triggers canvas zoom');
      await page.getByRole('button', { name: 'Markdown', exact: true }).click();
      const markdownPrd = page.getByRole('textbox', { name: 'PRD 正文', exact: true });
      await markdownPrd.fill('source');
      await markdownPrd.press('Space');
      await markdownPrd.press('Control+=');
      assert.equal(await markdownPrd.inputValue(), 'source ');
      assert.equal(await scaleOf(page), commentScale, 'PRD Markdown input never triggers canvas zoom');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await t.test('changing annotation display resets manual zoom and pan to fit the currently visible content', async () => {
    const { page, frame, errors } = await open();
    try {
      const canvas = page.locator('.uxw-canvas');
      await frame.locator('#business-input').fill('切换模式保留业务输入');
      const instance = await frame.evaluate(() => window.prototypeInstance);
      const pageFit = await scaleOf(page);
      const moveManually = async () => {
        await page.getByLabel('原型缩放', { exact: true }).selectOption('1.25');
        await canvas.focus();
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + 40, box.y + 8);
        await page.keyboard.down('Space');
        await page.mouse.down();
        await page.mouse.move(box.x + 140, box.y + 48, { steps: 5 });
        await page.mouse.up();
        await page.keyboard.up('Space');
        assert.ok(Math.abs(await scaleOf(page) - 1.25) < .001);
        assert.ok(await canvas.evaluate(el => Number(el.dataset.panX) !== 0 && Number(el.dataset.panY) !== 0), 'The reset starts from a manually zoomed and panned canvas');
      };
      const checkReset = async (label, expanded) => {
        await page.getByLabel(label, { exact: true }).click();
        await page.waitForFunction(expanded => {
          const canvas = document.querySelector('.uxw-canvas');
          return document.querySelector('[aria-label="原型缩放"]').value === 'fit' && canvas.dataset.panX === '0' && canvas.dataset.panY === '0' && document.querySelectorAll('.uxw-note-rail').length === (expanded ? 2 : 0);
        }, expanded);
        const bounds = await page.evaluate(() => {
          const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
          return { canvas: rect('.uxw-canvas'), frame: rect('.uxw-frame-space'), left: rect('.uxw-note-rail.is-left .uxw-card'), right: rect('.uxw-note-rail.is-right .uxw-card') };
        });
        const left = bounds.left?.left ?? bounds.frame.left, right = bounds.right?.right ?? bounds.frame.right;
        assert.ok(left >= bounds.canvas.left && right <= bounds.canvas.right, 'Fit shows all content included by the current mode');
        assert.ok(Math.abs((left + right) / 2 - (bounds.canvas.left + bounds.canvas.right) / 2) <= 2, 'The visible content is centred as a group');
        if (expanded) {
          assert.ok(await scaleOf(page) < pageFit, 'Expanded fit reserves room for annotation cards');
          assert.ok(Math.abs(bounds.frame.left - bounds.left.right - 24) <= 2 && Math.abs(bounds.right.left - bounds.frame.right - 24) <= 2, 'Expanded fit preserves both 24px gaps');
        } else assert.ok(Math.abs(await scaleOf(page) - pageFit) < .001, 'Marker and hidden modes fit only the prototype');
        assert.equal(await frame.locator('#business-input').inputValue(), '切换模式保留业务输入');
        assert.equal(await frame.evaluate(() => window.prototypeInstance), instance, 'Changing modes never reloads the prototype');
      };
      await moveManually();
      await checkReset('展开标注', true);
      await moveManually();
      await checkReset('显示标注', false);
      await moveManually();
      await checkReset('关闭标注', false);
      assert.equal(await page.locator('.uxw-marker').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  await t.test('annotation cards follow the prototype within one clipped canvas and adapt to its available width', async () => {
    const { page, frame, errors } = await open();
    try {
      await frame.locator('#business-input').fill('缩放与拖动保留输入');
      const readLayout = () => page.evaluate(() => {
        const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
        return { frame: rect('.uxw-frame-space'), left: rect('.uxw-note-rail.is-left .uxw-card'), right: rect('.uxw-note-rail.is-right .uxw-card'), canvas: rect('.uxw-canvas') };
      });
      const checkGaps = geometry => {
        if (geometry.left) assert.ok(Math.abs(geometry.frame.left - geometry.left.right - 24) <= 2, 'Left cards keep 24px of readable space beside the prototype');
        if (geometry.right) assert.ok(Math.abs(geometry.right.left - geometry.frame.right - 24) <= 2, 'Right cards keep 24px of readable space beside the prototype');
      };
      await page.getByLabel('设备宽度', { exact: true }).selectOption('390');
      await page.getByLabel('展开标注', { exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.uxw-note-rail').length === 2);
      for (const side of ['left', 'right']) {
        const rail = page.locator('.uxw-note-rail.is-' + side);
        assert.ok(await rail.locator('.uxw-card.is-explanation').count() > 0, 'Sides follow the anchor, not annotation type');
        assert.ok(await rail.locator('.uxw-card.is-change-request').count() > 0, 'Both annotation types can share either rail');
      }
      assert.equal(await page.locator('.uxw-rail-heading').count(), 0, 'Rails no longer carry fixed semantic titles');
      const canvasStyle = await page.evaluate(() => {
        const area = document.querySelector('.uxw-preview-area');
        const canvas = document.querySelector('.uxw-canvas'), frame = document.querySelector('.uxw-frame-space');
        const style = getComputedStyle(area);
        return { background: style.backgroundColor, dots: style.backgroundImage, gap: frame.getBoundingClientRect().top - canvas.getBoundingClientRect().top, shadow: getComputedStyle(frame).boxShadow };
      });
      assert.equal(canvasStyle.background, 'rgb(243, 243, 241)', 'Host white surface token cannot erase the warm canvas');
      assert.match(canvasStyle.dots, /radial-gradient/);
      assert.equal(await page.locator('.uxw-device-caption,.uxw-navigation-tools').count(), 0, 'Canvas starts immediately below the compact toolbar');
      assert.ok(canvasStyle.gap >= 8, 'Top padding leaves room for the prototype shadow');
      assert.notEqual(canvasStyle.shadow, 'none');
      const layoutBefore = await readLayout();
      checkGaps(layoutBefore);
      assert.ok(layoutBefore.left.left >= layoutBefore.canvas.left && layoutBefore.right.right <= layoutBefore.canvas.right, 'Fit includes the width of both annotation rails');
      const canvas = page.locator('.uxw-canvas');
      assert.equal(await page.locator('.uxw-note-rail').evaluateAll(rails => rails.every(rail => rail.closest('.uxw-canvas'))), true, 'Both annotation rails belong to the same canvas as the prototype');
      await canvas.focus();
      const beforeZoom = await scaleOf(page);
      await page.keyboard.press('Control+=');
      await waitForScale(page, beforeZoom, 1);
      const layoutZoomed = await readLayout();
      checkGaps(layoutZoomed);
      for (const side of ['left', 'right']) assert.ok(Math.abs(layoutZoomed[side].width - layoutBefore[side].width) <= 1, 'Zoom keeps annotation text at a readable card width');
      await page.keyboard.press('Control+0');
      await page.waitForFunction(() => document.querySelector('.uxw-canvas').dataset.panX === '0' && document.querySelector('.uxw-canvas').dataset.panY === '0');

      const beforePan = await readLayout();
      await page.mouse.move(beforePan.canvas.left + 40, beforePan.canvas.top + 8);
      await page.keyboard.down('Space');
      await page.mouse.down();
      await page.mouse.move(beforePan.canvas.left + 160, beforePan.canvas.top + 58, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.up('Space');
      const afterPan = await readLayout(), delta = { x: afterPan.frame.x - beforePan.frame.x, y: afterPan.frame.y - beforePan.frame.y };
      assert.ok(delta.x > 100 && delta.y > 40, 'Space dragging moves the prototype in both axes');
      for (const side of ['left', 'right']) {
        assert.ok(Math.abs(afterPan[side].x - beforePan[side].x - delta.x) <= 1, 'Cards pan horizontally with the prototype');
        assert.ok(Math.abs(afterPan[side].y - beforePan[side].y - delta.y) <= 1, 'Cards pan vertically with the prototype');
      }
      checkGaps(afterPan);

      // A large pan can move notes past the viewport. They must be clipped by
      // the canvas instead of floating above the PRD sidebar or host UI.
      await page.mouse.move(beforePan.canvas.left + 20, beforePan.canvas.top + 8);
      await page.keyboard.down('Space');
      await page.mouse.down();
      await page.mouse.move(beforePan.canvas.right - 20, beforePan.canvas.top + 8, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up('Space');
      const clipped = await readLayout();
      assert.ok(clipped.right.right > clipped.canvas.right + 20, 'Panning may place part of a card beyond the visible canvas');
      assert.ok(['hidden', 'clip'].includes(await canvas.evaluate(el => getComputedStyle(el).overflowX)), 'The canvas clips its content at the viewport');
      assert.equal(await page.evaluate(() => {
        const card = document.querySelector('.uxw-note-rail.is-right .uxw-card'), rect = card.getBoundingClientRect(), canvas = document.querySelector('.uxw-canvas').getBoundingClientRect();
        const x = Math.min(innerWidth - 2, Math.max(canvas.right + 4, rect.left + 4)), y = rect.top + 10;
        return card.contains(document.elementFromPoint(x, y));
      }), false, 'A clipped card cannot intercept the sidebar');
      await canvas.focus();
      await page.keyboard.press('Control+0');
      await page.waitForFunction(() => document.querySelector('.uxw-canvas').dataset.panX === '0' && document.querySelector('.uxw-canvas').dataset.panY === '0');
      assert.equal(await frame.locator('#business-input').inputValue(), '缩放与拖动保留输入');
      const artifacts = resolve(root, '..', 'artifacts', 'ux-review', 'canvas-editor');
      await fs.mkdir(artifacts, { recursive: true });
      await page.screenshot({ path: resolve(artifacts, 'canvas-two-rails.png') });

      await page.evaluate(() => { document.getElementById('root').style.width = '950px'; });
      await page.waitForFunction(() => document.querySelectorAll('.uxw-note-rail').length === 1);
      assert.equal(await page.locator('.uxw-note-rail.is-left').count(), 0);
      assert.equal(await page.locator('.uxw-note-rail.is-right .uxw-card').count(), 4, 'Single-sided layout keeps every annotation reachable');
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.uxw-canvas').getBoundingClientRect(), frame = document.querySelector('.uxw-frame-space').getBoundingClientRect(), card = document.querySelector('.uxw-note-rail.is-right .uxw-card').getBoundingClientRect();
        return frame.left >= canvas.left && card.right <= canvas.right;
      });
      checkGaps(await readLayout());
      await page.locator('#root').screenshot({ path: resolve(artifacts, 'canvas-one-rail.png') });
      await page.getByLabel('筛选标注', { exact: true }).click();
      const filters = page.getByRole('group', { name: '标注筛选条件', exact: true });
      await filters.waitFor({ state: 'visible' });
      await page.getByLabel('标注类型筛选', { exact: true }).selectOption('explanation');
      assert.equal(await page.locator('.uxw-note-rail .uxw-card').count(), 2);
      assert.equal(await filters.isVisible(), true, 'Changing a filter leaves the filter panel open');
      await page.getByLabel('处理状态筛选', { exact: true }).selectOption('open');
      assert.equal(await page.locator('.uxw-note-rail').count(), 0, 'Filtering to no annotations never reserves an empty rail');
      await filters.getByRole('button', { name: '清除筛选', exact: true }).click();
      assert.equal(await page.getByLabel('标注类型筛选', { exact: true }).inputValue(), 'all');
      assert.equal(await page.getByLabel('处理状态筛选', { exact: true }).inputValue(), 'all');
      assert.equal(await page.locator('.uxw-note-rail .uxw-card').count(), 4);
      assert.equal(await filters.isVisible(), true);
      await page.keyboard.press('Escape');
      await filters.waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});
