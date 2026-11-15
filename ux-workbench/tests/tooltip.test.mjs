import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const source = `
import React from 'react'; import {createRoot} from 'react-dom/client'; import Tooltip from './Tooltip.jsx';
window.clicked=0;
createRoot(document.getElementById('app')).render(<div className="uxw" style={{position:'absolute',left:800,top:20,width:300,height:400,overflow:'hidden',containerType:'inline-size'}}>
<div className="uxw-topbar" style={{height:40,overflow:'hidden',display:'flex',justifyContent:'flex-end'}}>
<Tooltip label="保存当前版本，保留所有标注与需求说明"><button aria-label="保存" onClick={()=>window.clicked++}>保存</button></Tooltip>
<Tooltip label="正在保存，请稍候"><button aria-label="禁用操作" disabled>禁用</button></Tooltip>
</div><button id="outside">移出焦点</button><Tooltip label="关闭"><button aria-label="关闭">×</button></Tooltip></div>);
`;
const bundle = await build({ stdin: { contents: source, loader: 'jsx', resolveDir: fileURLToPath(new URL('../src/', import.meta.url)) }, bundle: true, write: false, outdir: 'tooltip-test', format: 'iife' });
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(f => f.path.endsWith('.css')).text;

test('tooltip hover, keyboard, disabled controls, clipping and fallback', async t => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close());
  for (const fallback of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<div id="app"></div>');
    if (fallback) await page.evaluate(() => { delete HTMLElement.prototype.popover; });
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js });
    const button = page.getByRole('button', { name: '保存', exact: true }); await button.waitFor();
    assert.equal(await page.getByRole('button', { name: '关闭', exact: true }).getAttribute('aria-describedby'), null);
    const tip = page.locator('.uxw-tooltip[data-open="true"]');
    await button.hover(); await page.waitForTimeout(100); assert.equal(await tip.count(), 0);
    await tip.waitFor({ state: 'visible' });
    assert.equal(await button.getAttribute('title'), null);
    assert.equal(await tip.getAttribute('role'), 'tooltip');
    assert.equal(await button.getAttribute('aria-describedby'), await tip.getAttribute('id'));
    const rect = await tip.boundingBox(); assert.ok(rect.x >= 808); assert.ok(rect.x + rect.width <= 1092);
    assert.ok(rect.y >= 48); // Hint extends outside the clipped 40px toolbar.
    assert.equal(await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.getAttribute('role'), {x:rect.x+10,y:rect.y+10}), 'tooltip');
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.waitForTimeout(180); assert.equal(await tip.isVisible(), true); // Hoverable hint.
    await page.mouse.move(20, 600); await page.waitForTimeout(180); assert.equal(await tip.count(), 0);
    await button.focus(); await tip.waitFor({ state: 'visible', timeout: 200 });
    await page.keyboard.press('Escape'); assert.equal(await tip.count(), 0);
    assert.equal(await button.evaluate(el => el === document.activeElement), true);
    await page.locator('#outside').focus(); await button.focus(); await tip.waitFor({ state: 'visible', timeout: 200 });
    await page.locator('#outside').focus(); assert.equal(await tip.count(), 0);
    await button.hover(); await tip.waitFor({ state: 'visible' }); await button.click();
    assert.equal(await page.evaluate(() => window.clicked), 1); assert.equal(await tip.count(), 0);
    const disabled = page.getByRole('button', { name: '禁用操作' });
    // The wrapper receives hover even though native disabled buttons swallow pointer events.
    const disabledBox = await disabled.boundingBox(); await page.mouse.move(disabledBox.x + 8, disabledBox.y + 8);
    await tip.waitFor({ state: 'visible' }); assert.match(await tip.textContent(), /正在保存/);
    await page.keyboard.press('Escape'); assert.equal(await tip.count(), 0);
    assert.deepEqual(errors, []); await page.close();
  }
});
