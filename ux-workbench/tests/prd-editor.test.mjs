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
      window.mountPrd = (initial,readOnly=false) => { root.render(<App key={Date.now()} initial={initial} readOnly={readOnly}/>); };
      function App({initial,readOnly}) {const [value,setValue]=useState(initial); window.currentPrd=value; return <PrdEditor value={value} readOnly={readOnly} onChange={v=>{window.changes.push(v);setValue(v)}}/>;}
      window.changes=[];`, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, write: false, format: 'iife', outfile: 'test.js', define: { 'process.env.NODE_ENV': '"production"' },
  });
  js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  css = await fs.readFile('src/styles.css', 'utf8') + bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => browser?.close());

async function fixture(value, readOnly = false) {
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<html lang="zh-CN"><head><title>PRD editor test</title></head><body><main class="uxw" id="root" style="width:420px;margin:24px auto"></main></body></html>');
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

test('rich PRD inserts embedded images and tables; context menu adds rows and supports keyboard dismissal', async () => {
  const { page, errors } = await fixture('# 需求\n\n正文');
  try {
    await page.locator('.ProseMirror > p').click(); await page.keyboard.press('End');
    await page.getByRole('button', { name: '插入表格', exact: true }).click();
    await page.locator('.ProseMirror table').waitFor();
    assert.equal(await page.locator('.ProseMirror table tr').count(), 3);
    await page.locator('.ProseMirror table td').first().click({ button: 'right' });
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
    assert.ok(withImage.includes('data:image/png;base64,'));
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
