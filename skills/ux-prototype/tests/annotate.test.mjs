import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { annotateHtml } from '../scripts/annotate.mjs';
import { clone, create, createAnnotation, metadataBlock, parse, recordHuman, serializeJSON, START, END, write } from '../scripts/document.mjs';
import { parseHtml, htmlparser2Adapter, selectAll } from '../scripts/vendor/static-html.mjs';

const source = '<!doctype html><html><head><title>合成原型</title></head><body><button id="save">保存</button><button id="cancel">取消</button></body></html>';
const stableSource = source.replace('<button id="save">', '<button data-ux-anchor="save" id="save">');
const anchor = { kind: 'element', id: 'save', selector: '[data-ux-anchor="save"]' };
const note = { selector: '#save', body: '校验通过后保存，再返回列表。' };
const tree = html => parseHtml(html, { treeAdapter: htmlparser2Adapter, sourceCodeLocationInfo: true });
function stripMetadata(html) {
  const start = html.indexOf(START), end = html.indexOf(END) + END.length;
  return html.slice(0, start) + html.slice(end);
}
function removeInsertedAnchors(html) {
  const root = tree(html);
  const attrs = selectAll('[data-ux-anchor]', root).map(node => node.sourceCodeLocation.attrs['data-ux-anchor']).sort((a, b) => b.startOffset - a.startOffset);
  for (const attr of attrs) html = html.slice(0, attr.startOffset - 1) + html.slice(attr.endOffset);
  return html;
}
function existingAnnotation({ id = 'ann-human', kind = 'explanation', body = note.body, location = anchor, needsTypeConfirmation } = {}) {
  const before = create({ title: '保留身份', prd: '# 保存\n原始需求', uxVersion: 4, design: { id: 'existing', name: '客户视觉' } });
  const draft = clone(before);
  draft.annotations[id] = createAnnotation({ id, kind, body, anchor: location, actor: { kind: 'human', name: '原作者' }, ...(needsTypeConfirmation ? { needsTypeConfirmation } : {}) });
  const doc = recordHuman(before, draft, '人工评审', '原作者');
  return { doc, html: write(stableSource, doc) };
}

test('plain HTML imports in memory, creates explanation IDs and documentation history', () => {
  const result = annotateHtml(source, [note], { actorName: '原型助手' });
  const annotation = result.doc.annotations[result.addedIds[0]];
  assert.equal(result.imported, true);
  assert.equal(result.unchanged, false);
  assert.equal(result.report.sourceFormat, 'plain-html');
  assert.equal(result.doc.design.id, 'existing');
  assert.match(annotation.id, /^ann-[A-Za-z0-9_-]+$/);
  assert.equal(annotation.kind, 'explanation');
  assert.equal(annotation.status, undefined);
  assert.deepEqual(annotation.createdBy, { kind: 'agent', name: '原型助手' });
  assert.equal(result.doc.revision, 2);
  assert.equal(result.doc.uxVersion, 1);
  assert.equal(result.doc.changes.at(-1).kind, 'documentation');
  assert.equal(result.doc.changes.at(-1).diff.ux.changed, false);
  assert.deepEqual(parse(result.html), result.doc);
  assert.equal(selectAll(annotation.anchor.selector, tree(result.html)).length, 1);
});

test('only start-tag attributes and metadata are inserted; original business bytes survive', () => {
  const business = '\ufeff\n  <!DOCTYPE html>\r\n<HTML lang=zh><head><title>A &amp; B</title></head>\r\n<body>\r\n\t<BUTTON\n  id=save\tdata-x="a > b">保存 &nbsp; &amp;</BUTTON>\r\n<script>const fake = `<button id="save">`; const closing = "</body>"; const x = "data-ux-anchor";</script>\r\n  </body>\r\n</HTML>  \n';
  const result = annotateHtml(business, [note]);
  const reconstructed = removeInsertedAnchors(stripMetadata(result.html)).replace('\n</body>', '</body>');
  assert.equal(reconstructed, business);
  assert.ok(result.html.includes('\t<BUTTON data-ux-anchor="'));
  assert.ok(result.html.endsWith('</HTML>  \n'));
});

test('same element/body is idempotent across selector spelling and duplicate batch entries', () => {
  const first = annotateHtml(source, [note, { ...note, selector: 'body > button:first-child' }]);
  assert.equal(first.addedIds.length, 1);
  assert.equal(first.doc.changes.at(-1).patch.length, 1);
  const again = annotateHtml(first.html, [{ ...note, selector: '#save, button:first-child' }]);
  assert.equal(again.html, first.html);
  assert.deepEqual(again.doc, first.doc);
  assert.equal(again.unchanged, true);
  assert.deepEqual(again.unchangedIds, first.addedIds);
  assert.deepEqual(again.addedIds, []);
  assert.deepEqual(again.updatedIds, []);
});

test('different bodies on one element create independent explanations and share one anchor', () => {
  const result = annotateHtml(source, [note, { selector: '#save', body: '网络失败时保留表单。' }]);
  assert.equal(result.addedIds.length, 2);
  assert.equal(new Set(Object.values(result.doc.annotations).map(value => value.anchor.id)).size, 1);
  assert.equal(selectAll('[data-ux-anchor]', tree(result.html)).length, 1);
  const again = annotateHtml(result.html, [note, { selector: '#save', body: '网络失败时保留表单。' }]);
  assert.equal(again.html, result.html);
  assert.equal(again.doc.revision, result.doc.revision);
});

test('explicit ID updates an explanation while preserving identity, creator and unrelated data', () => {
  const { html, doc } = existingAnnotation();
  const result = annotateHtml(html, [{ ...note, id: 'ann-human', body: '保存失败时保留输入。' }], { summary: '明确保存失败行为', details: ['失败时保留输入并允许重试'], actorName: '协作助手' });
  assert.equal(result.imported, false);
  assert.equal(result.doc.id, doc.id);
  assert.equal(result.doc.createdAt, doc.createdAt);
  assert.equal(result.doc.prd, doc.prd);
  assert.deepEqual(result.doc.design, doc.design);
  assert.equal(result.doc.uxVersion, doc.uxVersion);
  assert.equal(result.doc.revision, doc.revision + 1);
  assert.deepEqual(result.doc.changes.slice(0, -1), doc.changes);
  assert.deepEqual(result.doc.annotations['ann-human'].createdBy, doc.annotations['ann-human'].createdBy);
  assert.equal(result.doc.annotations['ann-human'].createdAt, doc.annotations['ann-human'].createdAt);
  assert.deepEqual(result.doc.annotations['ann-human'].updatedBy, { kind: 'agent', name: '协作助手' });
  assert.equal(result.doc.changes.at(-1).summary, '明确保存失败行为');
  assert.deepEqual(result.doc.changes.at(-1).details, ['失败时保留输入并允许重试']);
  assert.deepEqual(result.updatedIds, ['ann-human']);
  assert.equal(stripMetadata(result.html), stripMetadata(html));
});

test('editing the same target keeps navigation context; retargeting clears the old route', () => {
  const view = { key: 'rule-editor', label: '规则配置', recordId: 'sample' };
  const tabs = [{ selector: '#rules-tab', panelSelector: '#rules' }];
  const { html } = existingAnnotation({ location: { ...anchor, view, tabs } });
  const updated = annotateHtml(html, [{ ...note, id: 'ann-human', body: '更新交互说明正文。' }]);
  assert.deepEqual(updated.doc.annotations['ann-human'].anchor.view, view);
  assert.deepEqual(updated.doc.annotations['ann-human'].anchor.tabs, tabs);
  const moved = annotateHtml(updated.html, [{ selector: '#cancel', id: 'ann-human', body: '另一处说明。' }]);
  assert.equal(moved.doc.annotations['ann-human'].anchor.view, undefined);
  assert.equal(moved.doc.annotations['ann-human'].anchor.tabs, undefined);
});

test('explicit ID may retarget an explanation; omitted ID never guesses an overwrite', () => {
  const { html, doc } = existingAnnotation();
  const separate = annotateHtml(html, [{ ...note, body: '这是另一条独立说明。' }]);
  assert.equal(separate.addedIds.length, 1);
  assert.deepEqual(separate.doc.annotations['ann-human'], doc.annotations['ann-human']);
  const moved = annotateHtml(html, [{ selector: '#cancel', body: note.body, id: 'ann-human' }]);
  assert.deepEqual(moved.updatedIds, ['ann-human']);
  assert.equal(selectAll(moved.doc.annotations['ann-human'].anchor.selector, tree(moved.html))[0].attribs.id, 'cancel');
});

test('unchanged canonical input returns its exact bytes, including metadata formatting', () => {
  const { html, doc } = existingAnnotation();
  const custom = ' \n' + html.replace('"schemaVersion": 1,', '"schemaVersion" : 1,') + '\t\n';
  const result = annotateHtml(custom, [{ ...note, id: 'ann-human' }]);
  assert.equal(result.html, custom);
  assert.equal(result.unchanged, true);
  assert.deepEqual(result.doc, doc);
  assert.equal(result.doc.revision, doc.revision);
});

test('existing selector-only explanation is upgraded to a stable anchor once', () => {
  const { doc } = existingAnnotation({ location: { kind: 'element', selector: '#save' } });
  const html = write(source, doc);
  const first = annotateHtml(html, [note]);
  assert.deepEqual(first.updatedIds, ['ann-human']);
  assert.equal(first.addedIds.length, 0);
  assert.equal(first.doc.annotations['ann-human'].createdBy.name, '原作者');
  assert.equal(annotateHtml(first.html, [note]).html, first.html);
});

test('existing entity-encoded anchor is reused with a correct escaped CSS selector', () => {
  const html = source.replace('<button id="save">', '<button id="save" data-ux-anchor="a&amp;b&quot;c&#10;d\\e">');
  const result = annotateHtml(html, [note]);
  const annotation = result.doc.annotations[result.addedIds[0]];
  assert.equal(annotation.anchor.id, 'a&b"c\nd\\e');
  assert.equal(selectAll(annotation.anchor.selector, tree(result.html)).length, 1);
  assert.ok(result.html.includes('data-ux-anchor="a&amp;b&quot;c&#10;d\\e"'));
  assert.equal(selectAll('[data-ux-anchor]', tree(result.html)).length, 1);
});

test('static CSS structural selectors use the HTML5 tree and decoded attribute values', () => {
  const html = '<html><body><ul><li>A<li data-key="a&amp;b"><button class="target">B</button></ul><p>C</body></html>';
  const result = annotateHtml(html, [{ selector: 'ul > li:nth-child(2):has(> button.target)[data-key="a&b"] > button:not(.disabled)', body: '第二项的操作。' }]);
  assert.equal(result.addedIds.length, 1);
  assert.ok(result.html.includes('<li>A<li data-key="a&amp;b">'));
  assert.equal(annotateHtml(source, [{ ...note, selector: ':scope > body > #save' }]).addedIds.length, 1);
});

test('unquoted slash values and self-closing foreign elements preserve original semantics', () => {
  const html = '<html><body><img id=save src=x/><svg><path id="path" d="M0 0"/></svg></body></html>';
  const result = annotateHtml(html, [note, { selector: '#path', body: '路径。' }]);
  assert.equal(selectAll('#save', tree(result.html))[0].attribs.src, 'x/');
  assert.ok(result.html.includes('id=save src=x/>'));
  assert.ok(result.html.includes('id="path" d="M0 0"/>'));
});

test('zero matches, duplicate IDs and general multi-matches reject the entire batch', () => {
  assert.throws(() => annotateHtml(source, [{ selector: '#missing', body: '不存在' }]), /匹配 0 个/);
  assert.throws(() => annotateHtml(source, [{ selector: 'button', body: '不唯一' }]), /匹配 2 个/);
  assert.throws(() => annotateHtml(source.replace('id="cancel"', 'id="save"'), [note]), /匹配 2 个/);
  const { html, doc } = existingAnnotation();
  const snapshot = JSON.stringify(doc);
  assert.throws(() => annotateHtml(html, [{ ...note, body: '第一条本来可新增' }, { selector: '#missing', body: '第二条失败' }]), /匹配 0 个/);
  assert.equal(JSON.stringify(doc), snapshot);
  assert.deepEqual(parse(html), doc);
});

test('script strings, comments, raw text, inert templates and implicit containers are not targets', () => {
  const html = '<html><body><!-- <button id="comment"> -->' +
    '<script>const a = "<button id=script-string>"; const b = `<button id="template-string">`;</script>' +
    '<textarea><button id="raw-text"></textarea><template id="template"><button id="inert">T</button></template>' +
    '<table><tr><td>cell</td></tr></table><button id="save">S</button></body></html>';
  for (const selector of ['#comment', '#script-string', '#template-string', '#raw-text', '#inert']) assert.throws(() => annotateHtml(html, [{ selector, body: '不应注入' }]), /匹配 0 个/);
  for (const selector of ['#template', 'tbody', 'head', 'script']) assert.throws(() => annotateHtml(html, [{ selector, body: '不应注入' }]), /不能静态注入/);
  assert.equal(annotateHtml(html, [note]).addedIds.length, 1);
  const reconstructed = '<html><body><b><i>one</b>two</i></body></html>';
  assert.throws(() => annotateHtml(reconstructed, [{ selector: 'b > i', body: '同一起始标签会产生两个节点' }]), /不能静态注入/);
});

test('duplicate or blank stable anchors cannot be reused or silently overwritten', () => {
  assert.throws(() => annotateHtml(stableSource.replace('<button id="cancel">', '<button data-ux-anchor="save" id="cancel">'), [note]), /data-ux-anchor 不唯一/);
  assert.throws(() => annotateHtml(source.replace('<button id="save">', '<button data-ux-anchor=" " id="save">'), [note]), /已有空/);
  const templated = stableSource.replace('</body>', '<template><button data-ux-anchor="save">T</button></template></body>');
  assert.throws(() => annotateHtml(templated, [note]), /data-ux-anchor 不唯一/);
});

test('requests and unclassified annotations are protected from explicit ID updates', () => {
  for (const settings of [{ kind: 'change-request' }, { needsTypeConfirmation: true }]) {
    const { html } = existingAnnotation(settings);
    assert.throws(() => annotateHtml(html, [{ ...note, id: 'ann-human', body: '不能覆盖' }]), /不能覆写/);
    const result = annotateHtml(html, [note]);
    assert.equal(result.addedIds.length, 1);
    assert.deepEqual(result.doc.annotations['ann-human'], parse(html).annotations['ann-human']);
  }
});

test('invalid notes, selector syntax, non-explanation kind and conflicting IDs reject', () => {
  for (const notes of [[], null, {}, [null], [{ body: 'x' }], [{ selector: '#save', body: ' ' }], [{ ...note, kind: 'change-request' }], [{ ...note, id: '__proto__' }], [{ ...note, createdBy: { kind: 'human', name: 'fake' } }]]) assert.throws(() => annotateHtml(source, notes));
  assert.throws(() => annotateHtml(source, [{ selector: 'button[', body: 'x' }]), /CSS selector 无效/);
  assert.throws(() => annotateHtml(source, [{ ...note, id: 'ann-one' }, { ...note, id: 'ann-one', body: '冲突' }]), /互相冲突/);
  assert.throws(() => annotateHtml(source, [note], { summary: '' }), /变更摘要/);
  assert.throws(() => annotateHtml(source, [note], { details: [] }), /具体改动说明/);
  assert.throws(() => annotateHtml(source, [note], { actorName: '' }), /作者名称/);
});

test('review export annotations target the embedded business source, preserving its bytes', () => {
  const doc = create({ title: '导出' });
  const business = ' \n' + source + '\n\t';
  const exported = '<html><body><button id="save">评审壳</button><script type="application/json" id="ux-prototype-source">' + serializeJSON(business) + '</script>' + metadataBlock(doc) + '</body></html>';
  const result = annotateHtml(exported, [note]);
  assert.equal(result.doc.id, doc.id);
  assert.equal(result.imported, false);
  assert.ok(!result.html.includes('评审壳'));
  assert.equal(removeInsertedAnchors(stripMetadata(result.html)).replace('\n</body>', '</body>'), business);
});

test('caller notes/options remain unchanged and explicit new IDs are supported', () => {
  const notes = [{ ...note, id: 'ann-explicit', kind: 'explanation' }], options = { summary: '新增说明', details: ['绑定保存按钮'], actorName: 'Agent' };
  const before = JSON.stringify({ notes, options });
  const result = annotateHtml(source, notes, options);
  assert.deepEqual(result.addedIds, ['ann-explicit']);
  assert.equal(JSON.stringify({ notes, options }), before);
});

test('copied runtime works without tooling or node_modules', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ux-annotate-runtime-'));
  try {
    for (const name of ['annotate.mjs', 'document.mjs', 'prd-patch.mjs', 'prd-assets.mjs', 'vendor']) await cp(new URL(`../scripts/${name}`, import.meta.url), join(temporary, name), { recursive: true });
    const copied = await import(pathToFileURL(join(temporary, 'annotate.mjs')).href);
    assert.equal(copied.annotateHtml(source, [note]).addedIds.length, 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
