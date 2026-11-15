import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { getAnnotationReferences, getReferencedIds, appendAnnotationReference, insertAnnotationReference, removeAnnotationReference } from '../src/prd-references.mjs';

let browser, js, css;
before(async () => {
  const bundle = await build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import PrdEditor from './src/PrdEditor.jsx';import {PrdReferencesContent} from './src/PrdReference.jsx';
      const root=createRoot(document.getElementById('root'));
      window.mountReferences=(initial,annotations,reader=false)=>root.render(<App key={Date.now()} initial={initial} initialAnnotations={annotations} reader={reader}/>);
      function App({initial,initialAnnotations,reader}) {const[value,setValue]=useState(initial);const[annotations,setAnnotations]=useState(initialAnnotations);
        window.currentPrd=value;window.updateAnnotations=setAnnotations;const Component=reader?PrdReferencesContent:PrdEditor;
        return <Component value={value} annotations={annotations} onChange={next=>{window.changes.push(next);setValue(next)}}
          onLocateAnnotation={(id,options)=>window.locations.push({id,...options})} onRegisterReferenceActions={actions=>{window.referenceActions=actions}}/>;}
      window.changes=[];window.locations=[];`, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, write: false, format: 'iife', outfile: 'test.js', define: { 'process.env.NODE_ENV': '"production"' },
  });
  js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  css = await fs.readFile('src/styles.css', 'utf8') + bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => browser?.close());

const annotations = {
  'ann-first': { id: 'ann-first', kind: 'explanation', body: '# 业务逻辑说明\n\n完整 **Markdown 正文**，描述产品功能和业务规则。\n\n| 条件 | 处理 |\n| --- | --- |\n| 未登录 | 保留草稿 |' },
  'ann-second': { id: 'ann-second', kind: 'change-request', body: '调整应用规则\n\n保留人工输入，再应用 AI 内容。' },
  'ann-save_rule': { id: 'ann-save_rule', kind: 'explanation', body: '下划线标注\n\n文件格式允许的现有标注。' },
};

async function fixture(value, reader = false) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<html lang="zh-CN"><head><title>PRD reference fixture</title></head><body><main class="uxw" id="root" style="width:430px;margin:20px auto"></main></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js });
  await page.evaluate(({ value, annotations, reader }) => window.mountReferences(value, annotations, reader), { value, annotations, reader });
  await page.waitForFunction(() => !!window.referenceActions);
  if (!reader) await page.getByRole('textbox', { name: 'PRD 富文本正文' }).waitFor();
  return { page, errors };
}
const reference = (page, referenceId) => page.locator(`[data-prd-reference-id="${referenceId}"]`);

test('reference syntax is standalone, fence-safe, ordered and CRLF lossless', () => {
  const source = '# 需求\r\n\r\n保留内容。\r\n\r\n@annotation(ann-first)\r\n@annotation(ann-second)\r\n\r\n```md\r\n@annotation(ann-code)\r\n```\r\n\r\n> @annotation(ann-quote)\r\n\r\n正文内 @annotation(ann-inline)\r\n\r\n@annotation(ann-first)\r\n';
  const refs = getAnnotationReferences(source);
  assert.deepEqual(refs.map(r => [r.annotationId, r.referenceId, r.index]), [['ann-first', 'ann-first:1', 1], ['ann-second', 'ann-second:1', 2], ['ann-first', 'ann-first:2', 3]]);
  assert.deepEqual(getReferencedIds(source), ['ann-first', 'ann-second']);
  assert.ok(refs.every(r => source.slice(r.start, r.end).trim() === `@annotation(${r.annotationId})`));
  const appended = appendAnnotationReference(source, 'ann-second');
  assert.ok(appended.startsWith(source)); assert.ok(appended.endsWith('@annotation(ann-second)\r\n'));
  assert.equal(removeAnnotationReference(source, 'ann-first:2'), source.slice(0, refs[2].start) + source.slice(refs[2].end));
  assert.equal(removeAnnotationReference(source, 'ann-nope:1'), source);
  assert.throws(() => appendAnnotationReference(source, 'bad)\n<script>'));
  assert.deepEqual(getReferencedIds('@annotation(ann-save_rule)\n'), ['ann-save_rule']);
  const atCaret = insertAnnotationReference('前段后段', 'ann-save_rule', 2);
  assert.equal(atCaret.value, '前段\n\n@annotation(ann-save_rule)\n\n后段');
  const crlf = '# 需求\r\n\r\n前段后段\r\n';
  assert.equal(insertAnnotationReference(crlf, 'ann-first', '# 需求\n\n前段'.length).value, '# 需求\r\n\r\n前段\r\n\r\n@annotation(ann-first)\r\n\r\n后段\r\n');
  const inList = '- 第一项\n- 第二项\n\n后续段落。';
  const fromList = insertAnnotationReference(inList, 'ann-first', 4).value;
  assert.ok(fromList.startsWith('- 第一项\n- 第二项\n\n@annotation(ann-first)'), fromList);
});

test('rich references stay folded and read the latest annotation without changing PRD source', async () => {
  const original = '# 产品需求\r\n\r\n原始 **重点**。\r\n\r\n@annotation(ann-first)\r\n@annotation(ann-second)\r\n\r\n尾部内容。\r\n';
  const { page, errors } = await fixture(original);
  try {
    const first = reference(page, 'ann-first:1');
    assert.equal(await page.locator('.uxw-prd-reference').count(), 2);
    assert.equal(await first.locator('details').getAttribute('open'), null);
    assert.equal(await first.locator('summary h1, summary h2, summary h3').count(), 0);
    assert.equal(await first.getByText('Markdown 正文', { exact: true }).isVisible(), false);
    await first.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await first.locator('details').evaluate(el => el.open), true);
    assert.equal(await first.locator('.uxw-prd-reference-content strong').textContent(), 'Markdown 正文');
    assert.equal(await first.locator('table').count(), 1);
    assert.equal(await first.locator('.uxw-prd-reference-content').textContent().then(text => text.includes('ann-first')), false);
    assert.equal(await first.locator('.uxw-prd-reference-kind').evaluate(el => getComputedStyle(el).color), 'rgb(43, 103, 209)');
    assert.equal(await reference(page, 'ann-second:1').getByRole('button', { name: '定位 UX：仅支持引用说明', exact: true }).isDisabled(), true);
    await first.getByRole('button', { name: '定位 UX：业务逻辑说明', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.locations), [{ id: 'ann-first', referenceId: 'ann-first:1' }]);
    await page.evaluate(annotations => window.updateAnnotations({ ...annotations, 'ann-first': { ...annotations['ann-first'], body: '产品说明已更新\n\n最新完整正文。' } }), annotations);
    await first.getByText('最新完整正文。', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.changes), []);
    assert.equal(await page.evaluate(() => window.currentPrd), original);
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'PRD 正文', exact: true }).inputValue(), original.replace(/\r\n/g, '\n'));
    await page.getByRole('button', { name: '富文本', exact: true }).click();
    assert.equal(await page.locator('.uxw-prd-reference').count(), 2);
    assert.deepEqual(await page.evaluate(() => window.changes), []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('external insertion and repeated backlinks round-trip through source and rich modes', async () => {
  const original = '# 需求\r\n\r\n* 原始列表\r\n* 保留格式\r\n\r\n<div data-custom="keep">原文块</div>\r\n';
  const { page, errors } = await fixture(original);
  try {
    await page.locator('.ProseMirror').evaluate(element => element.editor.commands.setTextSelection(element.editor.state.doc.content.size));
    const inserted = await page.evaluate(() => window.referenceActions.insert('ann-first'));
    assert.equal(inserted, 'ann-first:1', JSON.stringify(await page.evaluate(() => ({ source: window.currentPrd, json: document.querySelector('.ProseMirror').editor.getJSON() }))));
    await reference(page, inserted).waitFor();
    const firstSource = await page.evaluate(() => window.currentPrd);
    assert.ok(firstSource.startsWith(original), JSON.stringify(firstSource));
    assert.equal(firstSource.includes('完整 **Markdown 正文**'), false, 'The PRD stores a reference, not a body copy');
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    await page.getByRole('textbox', { name: 'PRD 正文', exact: true }).evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
    assert.equal(await page.evaluate(() => window.referenceActions.insert('ann-first')), 'ann-first:2');
    await page.waitForFunction(expected => window.currentPrd === expected, appendAnnotationReference(firstSource, 'ann-first'));
    const secondSource = await page.evaluate(() => window.currentPrd);
    assert.deepEqual((await page.evaluate(() => window.referenceActions.list())).map(r => r.referenceId), ['ann-first:1', 'ann-first:2']);
    await page.getByRole('button', { name: '富文本', exact: true }).click();
    assert.equal(await page.locator('.uxw-prd-reference').count(), 2);
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    assert.equal(await page.evaluate(() => window.referenceActions.locate('ann-first:2')), true);
    await page.waitForFunction(() => document.querySelector('.uxw-prd-editor').dataset.mode === 'rich');
    await page.waitForFunction(() => document.activeElement?.closest('[data-prd-reference-id]')?.dataset.prdReferenceId === 'ann-first:2');
    assert.equal(await reference(page, 'ann-first:2').evaluate(el => el.classList.contains('is-selected')), true);
    assert.equal(await page.evaluate(() => window.currentPrd), secondSource);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('deleting an annotation keeps a removable missing-reference placeholder', async () => {
  const original = '# 规则\n\n@annotation(ann-first)\n\n保留其他需求。\n';
  const { page, errors } = await fixture(original);
  try {
    await page.evaluate(() => window.updateAnnotations({}));
    const first = reference(page, 'ann-first:1');
    await first.getByText('标注已删除', { exact: true }).waitFor();
    assert.equal(await first.getByRole('button', { name: '定位 UX：标注已删除', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.currentPrd), original);
    await first.getByRole('button', { name: '移除 PRD 引用：ann-first:1', exact: true }).click();
    assert.equal(await page.locator('.uxw-prd-reference').count(), 0);
    const changed = await page.evaluate(() => window.currentPrd);
    assert.equal(getAnnotationReferences(changed).length, 0);
    assert.ok(changed.includes('# 规则\n\n') && changed.includes('保留其他需求。\n'));
    await page.getByRole('button', { name: '撤销 PRD 编辑', exact: true }).click();
    await reference(page, 'ann-first:1').waitFor();
    assert.equal(await page.evaluate(() => window.currentPrd), original);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('the searchable toolbar splits ordinary paragraphs at the caret and keeps complex blocks intact', async () => {
  const cases = [
    { value: '# 需求\n\n第一段保留全部文字。\n\n第二段继续保留。', target: '.ProseMirror > p', types: ['heading', 'paragraph', 'annotationReference', 'paragraph', 'paragraph'] },
    { value: '# 表格\n\n| 字段 | 说明 |\n| --- | --- |\n| 名称 | 保留单元格 |\n\n表格后继续保留。', target: '.ProseMirror td p', types: ['heading', 'table', 'annotationReference', 'paragraph'] },
    { value: '# 列表\n\n- 列表第一项\n- 列表第二项\n\n列表后继续保留。', target: '.ProseMirror li p', types: ['heading', 'bulletList', 'annotationReference', 'paragraph'] },
  ];
  for (const scenario of cases) {
    const { page, errors } = await fixture(scenario.value);
    try {
      const target = page.locator(scenario.target).first();
      await target.click();
      await target.evaluate(element => {
        const range = document.createRange(); range.setStart(element.firstChild, 1); range.setEnd(element.firstChild, 2);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      });
      const beforeText = await page.locator('.ProseMirror').evaluate(element => element.editor.state.doc.textContent);
      await page.getByRole('button', { name: '引用说明', exact: true }).click();
      const picker = page.getByRole('dialog', { name: '引用已有说明', exact: true });
      await picker.waitFor({ state: 'visible' });
      assert.equal(await picker.getByRole('button', { name: '引用说明：调整应用规则', exact: true }).count(), 0);
      await page.getByRole('textbox', { name: '搜索已有说明', exact: true }).fill('下划线');
      await page.waitForFunction(() => document.querySelectorAll('.uxw-prd-reference-option').length === 1);
      await picker.getByRole('button', { name: '引用说明：下划线标注', exact: true }).click();
      await reference(page, 'ann-save_rule:1').waitFor();
      assert.deepEqual(await page.locator('.ProseMirror').evaluate(element => element.editor.getJSON().content.map(node => node.type)), scenario.types);
      assert.equal(await page.locator('.ProseMirror').evaluate(element => element.editor.state.doc.textContent), beforeText);
      assert.equal(await page.locator('.ProseMirror table .uxw-prd-reference, .ProseMirror li .uxw-prd-reference').count(), 0);
      assert.equal(getAnnotationReferences(await page.evaluate(() => window.currentPrd))[0].annotationId, 'ann-save_rule');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test('change requests cannot be inserted and handwritten references remain removable placeholders', async () => {
  const original = '# 需求\n\n@annotation(ann-second)\n\n保留用户原文。';
  const { page, errors } = await fixture(original);
  try {
    assert.equal(await page.evaluate(() => window.referenceActions.insert('ann-second')), false);
    const block = reference(page, 'ann-second:1');
    await block.getByText('仅支持引用说明', { exact: true }).waitFor();
    assert.equal(await block.getByRole('button', { name: '定位 UX：仅支持引用说明', exact: true }).isDisabled(), true);
    await block.locator('summary').click();
    assert.equal(await block.locator('.uxw-prd-reference-content').textContent().then(text => text.includes('保留人工输入')), false);
    assert.equal(await page.evaluate(() => window.currentPrd), original);
    assert.deepEqual(await page.evaluate(() => window.changes), []);
    await block.getByRole('button', { name: '移除 PRD 引用：ann-second:1', exact: true }).click();
    assert.equal(await page.locator('.uxw-prd-reference').count(), 0);
    assert.ok((await page.evaluate(() => window.currentPrd)).includes('保留用户原文。'));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('external context actions retain the last rich and Markdown caret and never replace selected text', async () => {
  const original = '# 需求\n\n前段保留后段。\n\n末尾段落不变。\n\n@annotation(ann-first)\n';
  const { page, errors } = await fixture(original);
  try {
    const paragraph = page.locator('.ProseMirror > p').first();
    await paragraph.click();
    await paragraph.evaluate(element => {
      const range = document.createRange(); range.setStart(element.firstChild, 2); range.setEnd(element.firstChild, 4);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.waitForFunction(() => document.querySelector('.ProseMirror').editor.state.selection.to > document.querySelector('.ProseMirror').editor.state.selection.from);
    await page.evaluate(() => { const button = document.createElement('button'); button.id = 'annotation-context-target'; button.textContent = 'UX 说明卡片'; button.oncontextmenu = event => event.preventDefault(); document.body.append(button); });
    await page.locator('#annotation-context-target').click({ button: 'right' });
    assert.equal(await page.evaluate(() => window.referenceActions.insert('ann-first')), 'ann-first:1');
    await reference(page, 'ann-first:1').waitFor();
    assert.equal(await page.locator('.uxw-prd-reference').count(), 2, 'The newly inserted first reference must not jump to the existing later reference');
    const paragraphs = await page.locator('.ProseMirror > p').allTextContents();
    assert.deepEqual(paragraphs, ['前段', '保留后段。', '末尾段落不变。']);
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'PRD 正文', exact: true });
    const before = await page.evaluate(() => window.currentPrd), caret = before.indexOf('末尾') + 2;
    await source.focus(); await source.evaluate((element, caret) => element.setSelectionRange(caret, caret + 2), caret);
    await page.locator('#annotation-context-target').click({ button: 'right' });
    assert.equal(await page.evaluate(() => window.referenceActions.insert('ann-first')), 'ann-first:2');
    const expected = insertAnnotationReference(before, 'ann-first', caret).value;
    await page.waitForFunction(value => window.currentPrd === value, expected);
    assert.ok((await source.inputValue()).includes('末尾\n\n@annotation(ann-first)\n\n段落不变。'));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('the read-only renderer shares folded references, safe Markdown and ordered location actions', async () => {
  const source = '# 阅读\n\n@annotation(ann-first)\n\n中间说明。\n\n@annotation(ann-first)\n\n@annotation(ann-deleted)\n';
  const { page, errors } = await fixture(source, true);
  try {
    assert.equal(await page.locator('.uxw-prd-reference details[open]').count(), 0);
    assert.equal(await page.locator('.uxw-prd-reference-remove').count(), 0);
    assert.equal(await page.evaluate(() => window.referenceActions.list().length), 3);
    assert.equal(await page.evaluate(() => window.referenceActions.locate('ann-first:2')), true);
    await reference(page, 'ann-first:2').getByRole('button', { name: '定位 UX：业务逻辑说明', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.locations.at(-1)), { id: 'ann-first', referenceId: 'ann-first:2' });
    await reference(page, 'ann-first:2').locator('summary').click();
    assert.equal(await reference(page, 'ann-first:2').locator('table').count(), 1);
    await page.evaluate(annotations => window.updateAnnotations({ ...annotations, 'ann-first': { ...annotations['ann-first'], body: '<img src="https://example.invalid/tracking.png" onerror="window.BAD=true">\n\n保留安全内容。' } }), annotations);
    const image = reference(page, 'ann-first:2').locator('.uxw-prd-reference-content img');
    assert.equal(await image.getAttribute('src'), null); assert.equal(await image.getAttribute('onerror'), null);
    assert.equal(await page.evaluate(() => window.BAD), undefined);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
