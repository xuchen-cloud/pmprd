import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

let browser, js, css;
before(async () => {
  const bundle = await build({
    stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import PrdEditor from './src/PrdEditor.jsx';
      import {Editor} from '@tiptap/core';
      import {createPrdSourceLedger,prdExtensions} from './src/prd-markdown.mjs';
      window.testLedger = {Editor,createPrdSourceLedger,prdExtensions};
      let root = createRoot(document.getElementById('root'));
      window.mountPrd = (initial,readOnly=false,initialAssets={}) => { root.render(<App key={Date.now()} initial={initial} initialAssets={initialAssets} readOnly={readOnly}/>); };
      function App({initial,initialAssets,readOnly}) {const [value,setValue]=useState(initial),[assets,setAssets]=useState(initialAssets); window.currentPrd=value; window.currentAssets=assets; return <PrdEditor value={value} assets={assets} readOnly={readOnly} onChange={(v,resources)=>{window.changes.push(v);if(resources?.assets)setAssets(resources.assets);setValue(v)}}/>;}
      window.changes=[];`, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, write: false, format: 'iife', outfile: 'test.js', define: { 'process.env.NODE_ENV': '"production"' },
  });
  js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  css = await fs.readFile('src/styles.css', 'utf8') + bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => browser?.close());

async function fixture(value, readOnly = false, { scroll = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<html lang="zh-CN"><head><title>PRD editor test</title></head><body>${scroll
    ? '<main class="uxw" style="width:420px;height:440px;margin:24px auto"><div class="uxw-document-body"><section class="uxw-prd-section" id="root"></section></div></main>'
    : '<main class="uxw" id="root" style="width:420px;margin:24px auto"></main>'}</body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js });
  await page.evaluate(({value,readOnly}) => window.mountPrd(value,readOnly), { value, readOnly });
  await page.getByRole('textbox', { name: 'PRD 富文本正文' }).waitFor();
  return { page, errors };
}

test('PRD keeps untouched Markdown, unknown blocks, and local diffs through rich/source switches', async () => {
  const original = '# 产品需求 {#requirements}\r\n\r\n第一段 **重点**。\r\n\r\n* 保留星号\r\n* 第二行\r\n\r\n<div data-custom="keep">不能丢失</div>\r\n';
  const { page, errors } = await fixture(original);
  try {
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'PRD 正文', exact: true }).inputValue(), original.replace(/\r\n/g, '\n'));
    await page.getByRole('button', { name: '富文本', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.changes), []);
    const paragraph = page.locator('.ProseMirror > p').first(); await paragraph.click();
    await paragraph.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await page.waitForFunction(() => document.querySelector('.ProseMirror').editor.state.selection.$from.parent.textContent.startsWith('第一段'));
    await page.keyboard.type(' 补充');
    const changed = await page.evaluate(() => window.currentPrd);
    assert.ok(changed.includes(' 补充'));
    assert.ok(changed.startsWith('# 产品需求 {#requirements}\r\n\r\n'));
    assert.ok(changed.includes('* 保留星号\r\n* 第二行\r\n\r\n'));
    assert.ok(changed.endsWith('<div data-custom="keep">不能丢失</div>\r\n'), JSON.stringify(changed));
    await page.getByRole('button', { name: '撤销 PRD 编辑', exact: true }).click();
    assert.equal(await page.evaluate(() => window.currentPrd), original);
    await page.getByRole('button', { name: '重做 PRD 编辑', exact: true }).click();
    assert.equal(await page.evaluate(() => window.currentPrd), changed);
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'PRD 正文', exact: true });
    await source.focus(); await source.evaluate(element => element.setSelectionRange(element.value.length,element.value.length)); await source.press('Space');
    assert.ok((await page.evaluate(() => window.currentPrd)).endsWith(' '));
    await page.getByRole('button', { name: '富文本', exact: true }).click();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('hovering a column resize edge does not change table or row heights', async () => {
  const { page } = await fixture('| A | B |\n| --- | --- |\n| 甲 | 乙 |');
  try {
    const table = page.locator('.ProseMirror table');
    const dimensions = () => table.evaluate(table => ({
      height: table.getBoundingClientRect().height,
      rows: [...table.rows].map(row => row.getBoundingClientRect().height),
    }));
    const before = await dimensions();
    const cell = await table.locator('th').first().boundingBox();
    await page.mouse.move(cell.x + cell.width - 1, cell.y + cell.height / 2);
    await table.locator('.column-resize-handle').first().waitFor({ state: 'attached' });
    assert.deepEqual(await dimensions(), before);
    await page.mouse.move(10, 10);
    assert.deepEqual(await dimensions(), before);
  } finally { await page.close(); }
});

test('table handles insert and delete the hovered row or column independently of the caret and other tables', async () => {
  const original = '# 需求\n\n正文。\n\n| A | B | C |\n| --- | --- | --- |\n| 甲 | 乙 | 丙 |\n| 丁 | 戊 | 己 |\n\n| X | Y |\n| --- | --- |\n| 一 | 二 |\n| 三 | 四 |\n\n结尾';
  const { page, errors } = await fixture(original);
  try {
    await page.locator('#root').evaluate(root => {root.style.paddingInline='24px';});
    const tables = page.locator('.ProseMirror table'), table = tables.nth(1);
    const firstTable = await tables.first().textContent();
    const rows = () => table.locator('tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));
    const open = async (axis, method) => {
      // Leave the caret in a different table, then hover the last cell here.
      await tables.first().locator('td').first().click();
      await table.locator('tr').last().locator('td').last().hover();
      await page.locator(`.uxw-prd-table-handle.is-${axis}`).click();
      await page.getByRole('menuitem', {name:method,exact:true}).click();
      assert.equal(await tables.first().textContent(), firstTable);
    };
    const undo = async () => {
      await page.getByRole('button', {name:'撤销 PRD 编辑',exact:true}).click();
      assert.equal(await page.evaluate(() => window.currentPrd), original);
    };
    await table.locator('td').last().hover();
    await page.getByRole('button', {name:'第 3 行操作',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => window.changes), [], 'opening a handle does not edit or serialize the table');
    await page.keyboard.press('Escape');
    await open('row', '上方插入行');
    assert.deepEqual(await rows(), [['X','Y'],['一','二'],['',''],['三','四']]); await undo();
    await open('row', '下方插入行');
    assert.deepEqual(await rows(), [['X','Y'],['一','二'],['三','四'],['','']]); await undo();
    await open('row', '删除当前行');
    assert.deepEqual(await rows(), [['X','Y'],['一','二']]); await undo();
    await open('col', '左侧插入列');
    assert.deepEqual(await rows(), [['X','','Y'],['一','','二'],['三','','四']]); await undo();
    await open('col', '右侧插入列');
    assert.deepEqual(await rows(), [['X','Y',''],['一','二',''],['三','四','']]); await undo();
    await open('col', '删除当前列');
    assert.deepEqual(await rows(), [['X'],['一'],['三']]); await undo();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('table context menu merges a dragged cell rectangle and splits it after a Markdown reload', async () => {
  const original = '| A | B | C |\n| --- | --- | --- |\n| 甲 | 乙 | 丙 |\n| 丁 | 戊 | 己 |';
  const { page, errors } = await fixture(original);
  try {
    const cells = page.locator('.ProseMirror td');
    const start = await cells.nth(0).boundingBox(), end = await cells.nth(4).boundingBox();
    await page.mouse.move(start.x + 32, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + 20, end.y + end.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.locator('.selectedCell').count(), 4);
    await cells.nth(0).click({ button: 'right' });
    await page.getByRole('menu', { name: '表格操作菜单', exact: true }).waitFor();
    assert.equal(await page.locator('.selectedCell').count(), 4, 'right-click preserves the selected rectangle');
    assert.equal(await page.getByRole('menuitem', {name:'切换首行表头',exact:true}).count(), 0);
    await page.getByRole('menuitem', { name: '合并单元格', exact: true }).click();
    const merged = page.locator('.ProseMirror td[colspan="2"][rowspan="2"]');
    await merged.waitFor();
    assert.equal(await merged.textContent(), '甲乙丁戊');
    const markdown = await page.evaluate(() => window.currentPrd);
    assert.ok(markdown.includes('colspan="2"') && markdown.includes('rowspan="2"'));
    await page.evaluate(value => window.mountPrd(value), markdown);
    await merged.waitFor();
    await merged.click({ button: 'right' });
    assert.equal(await page.getByRole('menuitem', { name: '合并单元格', exact: true }).count(), 0);
    await page.getByRole('menuitem', { name: '拆分单元格', exact: true }).click();
    assert.equal(await cells.count(), 6);
    assert.equal(await page.locator('.ProseMirror td[colspan="2"], .ProseMirror td[rowspan="2"]').count(), 0);
    assert.equal(await cells.first().textContent(), '甲乙丁戊', 'splitting preserves the merged contents in the first cell');
    assert.equal(await cells.nth(2).textContent(), '丙');
    assert.equal(await cells.nth(5).textContent(), '己');
    await page.getByRole('button', {name:'撤销 PRD 编辑',exact:true}).click();
    await merged.waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('context menus distinguish cell and text selections, target right-clicks, and limit header actions to the first row', async () => {
  const { page, errors } = await fixture('正文文字\n\n| A | B |\n| --- | --- |\n| 单元格文字 | 乙 |\n\n| X | Y |\n| --- | --- |\n| 一 | 二 |');
  try {
    const tables = page.locator('.ProseMirror table'), cell = tables.first().locator('td').first();
    await cell.click({ button: 'right' });
    const tableMenu = page.getByRole('menu', { name: '表格操作菜单', exact: true });
    await tableMenu.waitFor();
    for (const name of ['合并单元格', '拆分单元格', '切换首行表头', '文本样式']) {
      assert.equal(await tableMenu.getByRole('menuitem', {name,exact:true}).count(), 0);
    }
    await page.keyboard.press('Escape');
    await tables.first().locator('th').first().click({ button: 'right' });
    await tableMenu.getByRole('menuitem', {name:'切换首行表头',exact:true}).click();
    assert.equal(await tables.first().locator('th').count(), 0);
    await tables.first().locator('td').first().click({ button: 'right' });
    await tableMenu.getByRole('menuitem', {name:'切换首行表头',exact:true}).click();
    assert.equal(await tables.first().locator('th').count(), 2, 'first-row action remains available when changing back to header cells');

    await cell.click();
    await cell.locator('p').evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    await page.waitForFunction(() => !document.querySelector('.ProseMirror').editor.state.selection.empty);
    await cell.click({button:'right', position:{x:16,y:12}});
    const textMenu = page.getByRole('menu', {name:'文本格式菜单',exact:true});
    await textMenu.waitFor();
    assert.equal(await textMenu.getByRole('menuitem', {name:'文本样式',exact:true}).count(), 1);
    assert.equal(await textMenu.getByRole('menuitem', {name:'删除当前行',exact:true}).count(), 0);
    await page.keyboard.press('Escape');

    // A right-click outside the selected text belongs to the other table.
    await tables.nth(1).locator('td').first().click({button:'right'});
    await tableMenu.getByRole('menuitem', {name:'删除表格',exact:true}).click();
    assert.equal(await tables.count(), 1);
    assert.equal(await tables.first().locator('tr').count(), 2);
    assert.ok((await tables.first().textContent()).includes('单元格文字'));
    await page.getByRole('button', {name:'撤销 PRD 编辑',exact:true}).click();
    assert.equal(await tables.count(), 2);
    await cell.click();
    await page.getByRole('button', {name:'更多文本格式',exact:true}).click();
    await textMenu.waitFor();
    assert.equal(await textMenu.getByRole('menuitem', {name:'删除当前行',exact:true}).count(), 0);
    await page.keyboard.press('Escape');
    await cell.click(); await page.keyboard.press('Shift+F10');
    await tableMenu.waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('table handle menus toggle, freeze the hovered target, support keyboard focus, and disappear in source/read-only mode', async () => {
  const original = '| A | B |\n| --- | --- |\n| 甲 | 乙 |\n| 丙 | 丁 |';
  const { page, errors } = await fixture(original);
  try {
    const cells = page.locator('.ProseMirror td');
    await cells.first().hover();
    const rowHandle = page.locator('.uxw-prd-table-handle.is-row');
    await rowHandle.click();
    await page.getByRole('menu', {name:'第 2 行操作',exact:true}).waitFor();
    await cells.last().hover();
    assert.equal(await rowHandle.getAttribute('aria-label'), '第 2 行操作');
    await rowHandle.click();
    assert.equal(await page.getByRole('menu').count(), 0);
    await rowHandle.focus(); await rowHandle.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '上方插入行');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '删除当前行');
    await page.keyboard.press('Escape');
    assert.ok(await rowHandle.evaluate(button => button === document.activeElement));
    await rowHandle.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '上方插入行');
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('menu').count(), 0);
    await cells.last().hover();
    await page.locator('.uxw-prd-table-handle.is-col').click();
    await page.getByRole('button', {name:'Markdown',exact:true}).click();
    assert.equal(await page.locator('.uxw-prd-table-handles').count(), 0);
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await page.getByRole('textbox', {name:'PRD 正文',exact:true}).inputValue(), original);
    await page.evaluate(value => window.mountPrd(value, true), original);
    await page.waitForFunction(() => document.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'false');
    await page.locator('.ProseMirror td').first().hover();
    assert.equal(await page.locator('.uxw-prd-table-handles').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.changes), []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('PRD toolbar stays outside the scrolling body and table controls respect scrolling and clipping', async () => {
  const original = '# 需求\n\n| A | B | C |\n| --- | --- | --- |\n' + Array.from({length:40}, (_,i)=>`| 行${i+1} | B${i+1} | C${i+1} |`).join('\n');
  const { page, errors } = await fixture(original, false, {scroll:true});
  try {
    const scrollport = page.locator('.uxw-prd-editor-scroll'), toolbar = page.getByRole('toolbar', {name:'PRD 文本格式'});
    const headerBefore = await page.locator('.uxw-prd-editor-header').boundingBox();
    assert.equal(await scrollport.locator('.uxw-prd-toolbar').count(), 0, 'toolbar is outside the scrollport');
    const wrapper = page.locator('.tableWrapper'), cell = page.locator('.ProseMirror tr').nth(8).locator('td').last();
    await page.locator('.ProseMirror table').evaluate(table => { table.style.width='840px'; });
    await wrapper.evaluate(element => {element.scrollLeft=460;});
    await cell.hover();
    const rowHandle = page.locator('.uxw-prd-table-handle.is-row'), colHandle = page.locator('.uxw-prd-table-handle.is-col');
    await rowHandle.waitFor(); await colHandle.waitFor();
    let bounds = await wrapper.boundingBox(), row = await rowHandle.boundingBox(), col = await colHandle.boundingBox();
    assert.ok(row.x + row.width / 2 < bounds.x, 'row control stays on the left of the visible table');
    assert.ok(col.x >= bounds.x && col.x + col.width <= bounds.x + bounds.width, 'column control stays within the horizontally visible table');
    await rowHandle.click();
    await scrollport.evaluate(element => {element.scrollTop=130;});
    await page.waitForFunction(() => !document.querySelector('.uxw-prd-table-menu'));
    await page.waitForFunction(() => !document.querySelector('.uxw-prd-table-handle.is-col'));
    bounds = await scrollport.boundingBox();
    const header = await page.locator('.uxw-prd-editor-header').boundingBox();
    assert.deepEqual(header, headerBefore, 'toolbar does not move even by the initial section padding');
    assert.ok(header.y + header.height <= bounds.y, 'content starts below the toolbar rather than under it');
    assert.ok(await toolbar.isVisible());
    const cellBox = await cell.boundingBox(); row = await rowHandle.boundingBox();
    assert.ok(row && Math.abs(row.y + row.height/2 - cellBox.y - cellBox.height/2)<1, 'row control follows the scrolled row');
    await scrollport.evaluate(element => {element.scrollTop=600;});
    await rowHandle.waitFor({state:'detached'});
    for (const top of [1, 0, 800, 100000]) {
      await scrollport.evaluate((element, top) => {element.scrollTop=top;}, top);
      assert.deepEqual(await page.locator('.uxw-prd-editor-header').boundingBox(), headerBefore);
    }
    await page.getByRole('button', {name:'Markdown',exact:true}).click();
    await page.getByRole('textbox', {name:'PRD 正文',exact:true}).evaluate(element => {element.scrollTop=500;});
    assert.deepEqual(await page.locator('.uxw-prd-editor-header').boundingBox(), headerBefore);
    assert.deepEqual(await page.evaluate(() => window.changes), []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('rich PRD inserts embedded images and tables; row handle adds rows and context menu supports keyboard dismissal', async () => {
  const { page, errors } = await fixture('# 需求\n\n正文');
  try {
    await page.locator('.ProseMirror > p').click(); await page.keyboard.press('End');
    await page.getByRole('button', { name: '插入表格', exact: true }).click();
    await page.locator('.ProseMirror table').waitFor();
    assert.equal(await page.locator('.ProseMirror table tr').count(), 3);
    await page.locator('.ProseMirror table td').first().hover();
    await page.locator('.uxw-prd-table-handle.is-row').click();
    await page.locator('.uxw-prd-menu button[aria-label="下方插入行"]').click({timeout:2500});
    assert.equal(await page.locator('.ProseMirror table tr').count(), 4);
    const withTable = await page.evaluate(() => window.currentPrd);
    assert.ok(withTable.includes('|'));
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    await page.getByRole('button', { name: '富文本', exact: true }).click();
    assert.equal(await page.locator('.ProseMirror table tr').count(), 4);
    await page.evaluate(() => { const read = FileReader.prototype.readAsDataURL; FileReader.prototype.readAsDataURL = function(file) { setTimeout(() => read.call(this,file),150); }; });
    await page.locator('input[type=file]').setInputFiles({ name: '流程.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=', 'base64') });
    assert.ok(await page.getByRole('button', {name:'Markdown',exact:true}).isDisabled());
    await page.locator('.ProseMirror img').waitFor();
    const withImage = await page.evaluate(() => window.currentPrd);
    assert.ok(withImage.includes('asset:img-'));
    assert.ok(!withImage.includes('base64,'));
    assert.equal(await page.evaluate(() => Object.keys(window.currentAssets).length), 1);
    await page.waitForFunction(() => document.activeElement.matches('.ProseMirror'));
    await page.getByRole('button', { name: '更多文本格式', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !!document.activeElement.closest('.uxw-prd-menu'));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('image resources stay out of Markdown while centered resizing, undo, reload and the image menu preserve them', async () => {
  const { page, errors } = await fixture('# 需求\n\n图片位置\n\n结尾');
  try {
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=160;
      const context=canvas.getContext('2d'); context.fillStyle='#dce8f4';context.fillRect(0,0,320,160);
      return canvas.toDataURL('image/png');
    });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    await page.locator('.ProseMirror > p').first().click();
    await page.locator('input[type=file]').setInputFiles({name:'流程.png',mimeType:'image/png',buffer});
    const img=page.locator('.ProseMirror img'); await img.waitFor();
    const original = await page.evaluate(() => window.currentPrd);
    assert.ok(original.includes('asset:img-') && !original.includes('base64'));
    assert.deepEqual(await page.evaluate(() => Object.values(window.currentAssets).map(a=>a.dataUrl)), [dataUrl]);
    const center = async () => img.evaluate(img => {
      const box=img.getBoundingClientRect(), parent=img.closest('.uxw-prd-image').getBoundingClientRect();
      return Math.abs(box.x+box.width/2-parent.x-parent.width/2);
    });
    assert.ok(await center()<1);
    await img.click();
    const handle=page.getByRole('button',{name:'右下角调整图片大小（方向键微调）',exact:true});
    const box=await handle.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2-40,box.y+box.height/2-20,{steps:5});await page.mouse.up();
    assert.equal((await img.boundingBox()).width,240);
    assert.equal((await img.boundingBox()).height,120);
    assert.ok(await center()<1);
    const sized=await page.evaluate(() => window.currentPrd);
    assert.ok(sized.includes('width="240"') && sized.includes('asset:img-') && !sized.includes('base64'));
    await page.getByRole('button',{name:'撤销 PRD 编辑',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.currentPrd),original);assert.equal((await img.boundingBox()).width,320);
    await page.getByRole('button',{name:'重做 PRD 编辑',exact:true}).click();
    assert.equal((await img.boundingBox()).width,240);
    await page.getByRole('button',{name:'Markdown',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'PRD 正文',exact:true}).inputValue(),sized);
    await page.evaluate(()=>window.mountPrd(window.currentPrd,false,window.currentAssets));
    await img.waitFor();assert.equal((await img.boundingBox()).width,240);
    await img.click();await handle.focus();await handle.press('ArrowLeft');
    assert.equal((await img.boundingBox()).width,232);
    await handle.press('Escape');
    await img.click({button:'right'});
    const menu=page.getByRole('menu',{name:'图片操作菜单'});await menu.waitFor();
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['查看原图','下载图片','删除图片']);
    await menu.getByRole('menuitem',{name:'查看原图',exact:true}).click();
    const preview=page.getByRole('dialog',{name:'查看原图'});await preview.waitFor();
    assert.equal(await preview.locator('img').evaluate(img=>img.naturalWidth),320);
    assert.ok(await preview.evaluate(node=>node.matches(':modal')));
    await preview.getByRole('button',{name:'关闭原图'}).press('Escape');
    await preview.waitFor({state:'hidden'});
    await img.click({button:'right'});await menu.getByRole('menuitem',{name:'查看原图',exact:true}).click();
    await preview.getByRole('button',{name:'关闭原图'}).click();await preview.waitFor({state:'hidden'});
    await img.click({button:'right'});
    const downloadPromise=page.waitForEvent('download');await menu.getByRole('menuitem',{name:'下载图片',exact:true}).click();
    const download=await downloadPromise;assert.equal(download.suggestedFilename(),'流程.png');
    assert.deepEqual(await fs.readFile(await download.path()),buffer);
    await img.click({button:'right'});await menu.getByRole('menuitem',{name:'删除图片',exact:true}).click();
    assert.equal(await img.count(),0);
    await page.getByRole('button',{name:'撤销 PRD 编辑',exact:true}).click();await img.waitFor();
    assert.equal((await img.boundingBox()).width,232);
    await page.evaluate(()=>window.mountPrd(window.currentPrd,true,window.currentAssets));
    await img.waitFor();await img.click();
    assert.equal(await page.getByRole('button',{name:'右下角调整图片大小（方向键微调）',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
});

test('pasted embedded images are registered as reusable document resources', async () => {
  const {page,errors}=await fixture('粘贴位置');
  try {
    await page.locator('.ProseMirror').click();
    await page.locator('.ProseMirror').evaluate(element=>{
      const data=new DataTransfer();
      data.setData('text/html','<img alt="粘贴图片" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=">');
      element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    });
    await page.locator('.ProseMirror img').waitFor();
    assert.equal(await page.evaluate(()=>Object.keys(window.currentAssets).length),1);
    assert.ok(!(await page.evaluate(()=>window.currentPrd)).includes('base64'));
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
});

test('source ledger preserves merged table cells through HTML round-trips', async () => {
  const { page, errors } = await fixture('正文');
  try {
    const result = await page.evaluate(() => {
      const { Editor,createPrdSourceLedger,prdExtensions }=window.testLedger;
      const instance=new Editor({element:document.createElement('div'),extensions:prdExtensions(),content:''});
      const ledger=createPrdSourceLedger();
      instance.commands.setContent(ledger.load('# 标题\n\n原文',instance),{emitUpdate:false});
      instance.commands.insertTable({rows:2,cols:2,withHeaderRow:true});
      const cells=[]; instance.state.doc.descendants((node,pos)=>{if(node.type.name==='tableHeader') cells.push(pos)});
      instance.commands.setCellSelection({anchorCell:cells[0],headCell:cells[1]});
      instance.commands.mergeCells();
      const serialized=ledger.serialize(instance);
      const loaded=ledger.load(serialized,instance);
      instance.commands.setContent(loaded,{emitUpdate:false});
      const reserialized=ledger.serialize(instance);
      const json=instance.getJSON(); instance.destroy();
      return {serialized,reserialized,json};
    });
    assert.ok(result.serialized.includes('colspan="2"'));
    assert.equal(result.reserialized,result.serialized);
    assert.ok(JSON.stringify(result.json).includes('"colspan":2'));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('read-only PRD cannot mutate content and uses Project Mind typography', async () => {
  const { page, errors } = await fixture('# 标题\n\n正文', true);
  try {
    assert.equal(await page.getByRole('button', {name:'Markdown',exact:true}).count(),0);
    assert.equal(await page.locator('.ProseMirror').getAttribute('contenteditable'),'false');
    const styles=await page.locator('.ProseMirror').evaluate(element=>({body:getComputedStyle(element).fontSize,line:getComputedStyle(element).lineHeight,h1:getComputedStyle(element.querySelector('h1')).fontSize}));
    assert.deepEqual(styles,{body:'14px',line:'22.4px',h1:'20px'});
    const reading=await page.evaluate(()=>{const content=document.createElement('div');content.className='uxw-markdown uxw-prd-content';content.innerHTML='<h1>标题</h1><p>正文</p>';document.querySelector('.uxw').append(content);return {body:getComputedStyle(content).fontSize,line:getComputedStyle(content).lineHeight,h1:getComputedStyle(content.querySelector('h1')).fontSize,font:getComputedStyle(content).fontFamily};});
    assert.deepEqual({body:reading.body,line:reading.line,h1:reading.h1},styles);
    assert.equal(reading.font,await page.locator('.ProseMirror').evaluate(element=>getComputedStyle(element).fontFamily));
    assert.deepEqual(await page.evaluate(()=>window.changes),[]);
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});

test('compact toolbar stays in one row and legacy heading metadata remains hidden and lossless', async () => {
  const original = '# 目标 {route=/demo spec=goal}\n\n## 产品名称 {#product.name}\n\n### 普通标题 {example}\n\n正文';
  const { page, errors } = await fixture(original);
  try {
    const h1 = page.locator('.ProseMirror h1'), h2 = page.locator('.ProseMirror h2');
    assert.equal(await h1.textContent(), '目标');
    assert.equal(await h1.getAttribute('id'), 'prd-目标');
    assert.equal(await h2.textContent(), '产品名称');
    assert.equal(await h2.getAttribute('id'), 'product.name');
    assert.equal(await page.locator('.ProseMirror h3').textContent(), '普通标题 {example}');
    assert.deepEqual(await page.evaluate(() => window.changes), []);
    for (const label of ['标题 1', '标题 2', '标题 3', '加粗', '着重', '项目符号列表', '插入表格', '插入图片']) {
      assert.equal(await page.locator('.uxw-prd-toolbar').getByRole('button', {name:label, exact:true}).count(), 1);
    }
    await page.locator('#root').evaluate(element => {element.style.width='260px';});
    const row = await page.locator('.uxw-prd-toolbar').evaluate(element => ({
      height:element.getBoundingClientRect().height, overflows:element.scrollWidth>element.clientWidth,
      tops:[...element.querySelectorAll('button')].map(button=>button.getBoundingClientRect().top),
    }));
    assert.ok(row.overflows); assert.ok(row.height<=32); assert.ok(Math.max(...row.tops)-Math.min(...row.tops)<1);
    await h1.click();
    await h1.evaluate(element => {const range=document.createRange();range.selectNodeContents(element);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);});
    await page.waitForFunction(() => document.querySelector('.ProseMirror').editor.state.selection.$from.parent.type.name==='heading');
    await page.keyboard.type('更新');
    assert.ok((await page.evaluate(()=>window.currentPrd)).includes('# 目标更新 {route=/demo spec=goal}'));
    await page.getByRole('button', {name:'Markdown',exact:true}).click();
    assert.ok((await page.getByRole('textbox', {name:'PRD 正文',exact:true}).inputValue()).includes('## 产品名称 {#product.name}'));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('PRD context menu stays open after first right-click, focus changes, selection, and reopening', async () => {
  const { page, errors } = await fixture('# 产品需求\n\n第一段需要保留的文字。\n\n第二段支持菜单。');
  try {
    await page.evaluate(() => {const button=document.createElement('button');button.id='outside-editor';button.textContent='其他控件';document.body.append(button);});
    const paragraph=page.locator('.ProseMirror > p').first();
    for (const scenario of ['initial', 'blurred', 'selection', 'reopen', 'blurred-again']) {
      if (scenario.startsWith('blurred')) await page.locator('#outside-editor').click();
      if (scenario==='selection') {
        await paragraph.click();
        await paragraph.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);getSelection().removeAllRanges();getSelection().addRange(range);});
        await page.waitForFunction(()=>!document.querySelector('.ProseMirror').editor.state.selection.empty);
      }
      await paragraph.click({button:'right'});
      await page.waitForTimeout(350);
      assert.ok(await page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)').isVisible(),`右键菜单在 ${scenario} 后闪退`);
      if (scenario!=='selection') await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('PRD context menu survives completion of an in-flight image insertion', async () => {
  const { page, errors } = await fixture('# 需求\n\n正在编辑的正文。');
  try {
    await page.evaluate(() => {
      const button=document.createElement('button');button.id='outside-editor';button.textContent='其他控件';document.body.append(button);button.focus();
      const read=FileReader.prototype.readAsDataURL;
      FileReader.prototype.readAsDataURL=function(file){window.finishImageRead=()=>read.call(this,file);};
    });
    await page.locator('input[type=file]').setInputFiles({name:'图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=','base64')});
    await page.locator('.ProseMirror > p').click({button:'right'});
    await page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)').waitFor({state:'visible'});
    await page.evaluate(()=>window.finishImageRead());
    await page.locator('.ProseMirror img').waitFor();
    await page.waitForTimeout(350);
    assert.ok(await page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)').isVisible(),'图片插入的异步编辑器焦点使已打开菜单闪退');
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
});

test('PRD context menu stays open when contextmenu precedes the matching pointerup', async () => {
  const {page,errors}=await fixture('# 需求\n\n右键正文后保持菜单。');
  try {
    const paragraph=page.locator('.ProseMirror > p'),rect=await paragraph.boundingBox(),x=rect.x+25,y=rect.y+rect.height/2;
    await page.mouse.move(x,y);await page.mouse.down({button:'right'});
    await paragraph.evaluate((element,{x,y})=>element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:x,clientY:y})),{x,y});
    assert.equal(await page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)').isVisible(),false,'右键仍按下时先等待release');
    await page.mouse.up({button:'right'});
    await page.waitForTimeout(350);
    assert.ok(await page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)').isVisible(),'右键释放后菜单应保持显示');
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
});

test('PRD defers native popover until the opening right-button release has finished', async () => {
  const {page,errors}=await fixture('# 需求\n\nMac 原生右键时序。');
  try {
    // Captured DSH sequence: contextmenu → open popover → pointerup → native
    // toggle:closed, without an outside-pointerdown/focus close. Reproduce the
    // host's native dismissal, so newer headless Chromium cannot mask the bug.
    await page.evaluate(()=>{
      window.nativeDismissals=0;
      document.addEventListener('pointerup',event=>{
        if(event.button!==2)return;
        const menu=document.querySelector('.uxw-prd-menu:not(.uxw-prd-submenu)');
        if(menu?.matches(':popover-open')) {window.nativeDismissals++;menu.hidePopover();}
      },true);
    });
    const paragraph=page.locator('.ProseMirror > p'),rect=await paragraph.boundingBox(),x=rect.x+25,y=rect.y+rect.height/2;
    await page.mouse.move(x,y);await page.mouse.down({button:'right'});
    await paragraph.evaluate((element,{x,y})=>element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:x,clientY:y})),{x,y});
    await page.mouse.up({button:'right'});
    await page.waitForTimeout(350);
    const menu=page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)');
    assert.ok(await menu.isVisible(),'匹配的pointerup原生dismiss不应关闭刚打开的右键菜单');
    assert.equal(await page.evaluate(()=>window.nativeDismissals),0,'当前右键仍按下时不应提前显示原生popover');
    await page.mouse.click(10,10);assert.equal(await menu.count(),0,'真正的外部点击仍关闭菜单');
    // Windows/Linux can deliver contextmenu after pointerup: there is no
    // outstanding button release to wait for in that ordering.
    await paragraph.evaluate((element,{x,y})=>element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:x,clientY:y})),{x,y});
    await menu.waitFor({state:'visible',timeout:1500});
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
});

test('PRD right-click menu survives the editor receiving focus after contextmenu', async () => {
  const {page,errors}=await fixture('# 需求\n\n尚未获得焦点的正文。');
  try {
    await page.evaluate(()=>{const button=document.createElement('button');button.id='other-focus';button.textContent='其他控件';document.body.append(button);button.focus();});
    const paragraph=page.locator('.ProseMirror > p'),rect=await paragraph.boundingBox();
    await paragraph.evaluate((element,rect)=>element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:rect.x+20,clientY:rect.y+10})),rect);
    const menu=page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)');await menu.waitFor({state:'visible'});
    await page.getByRole('textbox',{name:'PRD 富文本正文'}).focus();
    await page.waitForTimeout(350);
    assert.ok(await menu.isVisible(),'contextmenu 后编辑区正常获得焦点时菜单闪退');
    await page.locator('#other-focus').focus();
    assert.equal(await menu.count(),0,'用户转向外部控件时仍应关闭菜单');
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
});

test('PRD uses the compact Project Mind menu and block-style submenu without a body focus frame', async () => {
  const {page,errors}=await fixture('# 需求\n\n这里编辑正文。');
  try {
    const body=page.getByRole('textbox',{name:'PRD 富文本正文'});await body.focus();
    const focus=await body.evaluate(element=>({outline:getComputedStyle(element).outlineStyle,shadow:getComputedStyle(element).boxShadow}));
    assert.deepEqual(focus,{outline:'none',shadow:'none'});
    await page.locator('.ProseMirror > p').click({button:'right'});
    const menu=page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)');
    await menu.waitFor({state:'visible'});
    assert.equal(Math.round((await menu.boundingBox()).width),176);
    assert.equal(await menu.locator('.is-quick button').count(),3);
    assert.equal(await menu.locator('.is-inline').count(),2);
    const picker=menu.getByRole('menuitem',{name:'文本样式',exact:true});
    await menu.getByRole('menuitem',{name:'粘贴',exact:true}).focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement.getAttribute('aria-label')==='文本样式');
    await picker.focus();await picker.press('ArrowRight');
    const submenu=page.locator('.uxw-prd-submenu');await submenu.waitFor({state:'visible'});
    await page.waitForFunction(()=>!!document.activeElement.closest('.uxw-prd-submenu'));
    await page.keyboard.press('Escape');
    assert.ok(await menu.isVisible());assert.equal(await submenu.isVisible(),false);
    assert.ok(await picker.evaluate(element=>element===document.activeElement));
    await picker.press('ArrowRight');
    await submenu.getByLabel('标题 2',{exact:true}).click();
    await page.locator('.ProseMirror h2').waitFor();
    assert.equal(await menu.count(),0);
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
});

test('PRD block-style submenu remains open on the first click after hover', async () => {
  const {page,errors}=await fixture('# 需求\n\n正文格式。');
  try {
    await page.locator('.ProseMirror > p').click({button:'right'});
    const menu=page.locator('.uxw-prd-menu:not(.uxw-prd-submenu)');await menu.waitFor({state:'visible'});
    const picker=menu.getByRole('menuitem',{name:'文本样式',exact:true}),submenu=page.locator('.uxw-prd-submenu');
    await picker.hover();await submenu.waitFor({state:'visible'});
    await picker.click();await page.waitForTimeout(80);
    assert.ok(await submenu.isVisible(),'hover预展开后第一次点击应保持子菜单显示');
    await submenu.getByRole('menuitem',{name:'标题 2',exact:true}).click();
    await page.locator('.ProseMirror h2').waitFor();
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
});
