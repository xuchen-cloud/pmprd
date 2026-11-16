import test from 'node:test';
import assert from 'node:assert/strict';
import { create, createAnnotation, clone, validate, parse, write, sourceOnly, metadataBlock, serializeJSON, recordHuman, recordAgent, review, importHtml, auditAnchors, hasPrototypeChanges, prdChangeDiff, lineDiff } from '../scripts/document.mjs';
const source = '<!doctype html><html><head><title>Test</title></head><body><button data-ux-anchor="save">保存</button><script>const closing = "</body>";</script></body></html>';
const anchor = { kind: 'element', id: 'save', selector: '[data-ux-anchor="save"]' };
function fixture() {
  const doc = create({ title: '逻辑说明与修改意见', prd: '# 提交\n成功后返回列表。' });
  const draft = clone(doc);
  for (const [key, kind, body] of [['ann-explanation', 'explanation', '提交前校验必填项'], ['ann-ai', 'change-request', '增加成功提示'], ['ann-human', 'change-request', '由研发确认接口']]) {
    draft.annotations[key] = createAnnotation({ id: key, kind, body, anchor });
  }
  draft.annotations['ann-human'].assignee = { kind: 'human', name: '小李' };
  return recordHuman(doc, draft);
}

test('single-file round trip escapes hostile strings and ignores markers inside scripts', () => {
  const doc = create({ prd: '</script><script>alert(1)</script>\n<!-- ux-document:start -->' });
  const html = write(source, doc);
  assert.deepEqual(parse(html), doc);
  assert.equal((html.match(/<script>alert/g) || []).length, 0);
  assert.equal(write(html, doc), html);
  assert.ok(html.includes('const closing = "</body>"'));
  const bundled = '<!doctype html><html><body><script>const START = "<!-- ux-document:start -->";const END="<!-- ux-document:end -->";</script>' + metadataBlock(doc) + '</body></html>';
  assert.deepEqual(parse(bundled), doc);
  assert.throws(() => parse(html.replace('</html>', metadataBlock(doc) + '</html>')), /唯一/);
});

test('review export round trips one canonical metadata and extracted source', () => {
  const doc = fixture(), business = sourceOnly(write(source, doc));
  const exported = `<!doctype html><html><body><main id="root"></main><script type="application/json" id="ux-prototype-source">${serializeJSON(business)}</script>${metadataBlock(doc)}<script>const marker="<!-- ux-document:start -->"</script></body></html>`;
  assert.deepEqual(parse(exported), doc);
  assert.equal(sourceOnly(exported), business);
  const restored = write(exported, doc);
  assert.ok(restored.includes('<button data-ux-anchor="save">'));
  assert.ok(!restored.includes('id="root"'));
  assert.deepEqual(parse(restored), doc);
});

test('new creation stores one initial PRD snapshot and renders its diff after later edits', () => {
  const prd = Array.from({ length: 1000 }, (_, i) => `初始需求 ${i}：提交成功后返回列表，并保留筛选条件。`).join('\n');
  const initial = create({ prd });
  assert.equal(initial.changes[0].diff, undefined);
  assert.equal(initial.changes[0].patch[0].value, prd);
  const legacy = clone(initial); legacy.changes[0].diff = { prd: lineDiff('', prd) };
  assert.ok(Buffer.byteLength(metadataBlock(initial)) < Buffer.byteLength(metadataBlock(legacy)) * .75);
  const draft = clone(initial); draft.prd = '# 修改后的需求';
  const saved = parse(write(source, recordHuman(initial, draft)));
  assert.equal(prdChangeDiff(saved.changes[0]), legacy.changes[0].diff.prd);
  assert.match(prdChangeDiff(saved.changes[0]), /\+初始需求 999/);
  assert.doesNotMatch(prdChangeDiff(saved.changes[0]), /修改后的需求/);
});

test('creation snapshot overrides stale legacy diff without rewriting stored history', () => {
  const doc = create({ prd: '# 正确初始需求' });
  doc.changes[0].diff = { prd: lineDiff('', '# 旧的默认内容'), extension: { preserved: true } };
  const oldEvent = clone(doc.changes[0]);
  assert.equal(prdChangeDiff(oldEvent), lineDiff('', '# 正确初始需求'));
  assert.deepEqual(parse(write(source, doc)).changes[0], oldEvent);
  assert.equal(prdChangeDiff({ ...oldEvent, patch: [] }), oldEvent.diff.prd);
  assert.equal(prdChangeDiff({ ...oldEvent, patch: [{ op: 'add', path: '/prd', value: '' }] }), '');
  assert.equal(prdChangeDiff({ ...oldEvent, kind: 'review' }), oldEvent.diff.prd);
  assert.equal(prdChangeDiff({ ...oldEvent, kind: 'prototype' }), oldEvent.diff.prd);
  assert.equal(prdChangeDiff({ kind: 'review', patch: [] }), '');
});

test('human and agent incremental diff payloads survive unchanged', () => {
  const initial = create({ prd: '# 初始' }), draft = clone(initial);
  draft.prd = '# 人工修改';
  const human = recordHuman(initial, draft);
  const agent = recordAgent(human, { summary: '补全规则', details: ['补全提交规则'], prd: '# AI 修改', uxBefore: source, uxAfter: source });
  const events = clone(agent.changes.slice(1));
  const roundTripped = parse(write(source, agent));
  assert.deepEqual(roundTripped.changes.slice(1), events);
  assert.match(prdChangeDiff(events[0]), /人工修改/);
  assert.equal(events[0].diff?.prd, undefined);
  assert.match(prdChangeDiff(events[1]), /AI 修改/);
  assert.equal(events[1].diff?.prd, undefined);
  assert.equal(events[1].diff.ux.changed, false);
});

test('human save records PRD diff and deletion content; no-op save is unchanged', () => {
  const before = fixture(), draft = clone(before);
  draft.prd = '# 提交\n成功后留在当前页面。';
  delete draft.annotations['ann-human'];
  const after = recordHuman(before, draft, '更新评审结论', '产品甲');
  assert.equal(after.uxVersion, before.uxVersion);
  assert.equal(after.revision, before.revision + 1);
  assert.match(prdChangeDiff(after.changes.at(-1)), /-成功后返回列表/);
  assert.match(prdChangeDiff(after.changes.at(-1)), /\+成功后留在当前页面/);
  assert.equal(after.changes.at(-1).patch.find(p => p.op === 'remove').before.body, '由研发确认接口');
  assert.deepEqual(recordHuman(after, clone(after)), after);
  assert.deepEqual(before.annotations['ann-human'].assignee, { kind: 'human', name: '小李' });
});

test('AI resolves only selected requests and cleanup preserves all explanations and other people work', () => {
  const before = fixture();
  const options = { summary: '增加提示', details: ['提交成功后显示提示'], selectedIds: ['ann-ai'], resolvedIds: ['ann-ai'], clearResolved: true, uxBefore: source, uxAfter: source.replace('保存</button>', '提交</button>'), taskId: 'task-1' };
  const after = recordAgent(before, options);
  assert.ok(!after.annotations['ann-ai']);
  assert.ok(after.annotations['ann-explanation']);
  assert.ok(after.annotations['ann-human']);
  assert.equal(after.uxVersion, before.uxVersion + 1);
  assert.equal(after.changes.at(-1).taskId, 'task-1');
  assert.equal(after.changes.at(-1).baseRevision, before.revision);
  assert.equal(after.changes.at(-1).resolvedSnapshots['ann-ai'].status, 'resolved');
  assert.throws(() => recordAgent(before, { ...options, resolvedIds: ['ann-human'] }), /未指定/);
  assert.throws(() => recordAgent(before, { ...options, selectedIds: ['ann-explanation'], resolvedIds: ['ann-explanation'] }), /修改意见/);
  assert.throws(() => recordAgent(after, { ...options, selectedIds: [], resolvedIds: [] }), /已经交付/);
});

test('AI can create explanations and maintain human notes without changing creator or UX version', () => {
  const before = fixture();
  const after = recordAgent(before, { summary: '完善说明', details: ['补充提交边界'], uxBefore: source, uxAfter: source, annotationUpdates: [{ id: 'ann-explanation', body: '提交前校验必填项；无效时定位首个错误' }, { id: 'ann-generated', kind: 'explanation', body: '只提交一次', anchor }] });
  assert.equal(after.uxVersion, before.uxVersion);
  assert.equal(after.annotations['ann-explanation'].createdBy.kind, 'human');
  assert.equal(after.annotations['ann-explanation'].updatedBy.kind, 'agent');
  assert.equal(after.annotations['ann-generated'].createdBy.kind, 'agent');
  assert.equal(after.annotations['ann-generated'].status, undefined);
  assert.equal(after.changes.at(-1).kind, 'documentation');
  assert.equal(review(after).explanations.length, 2);
  assert.equal(review(after).openAnnotations.length, 2);
});

test('converting a request into explanation retains processing history but removes active workflow', () => {
  const before = fixture(), resolved = recordAgent(before, { summary: '已调整', details: ['完成修改'], selectedIds: ['ann-ai'], resolvedIds: ['ann-ai'] });
  const draft = clone(resolved); draft.annotations['ann-ai'].kind = 'explanation'; draft.annotations['ann-ai'].body = '成功后显示提示';
  const after = recordHuman(resolved, draft);
  assert.equal(after.annotations['ann-ai'].status, undefined);
  assert.equal(after.annotations['ann-ai'].assignee, undefined);
  assert.equal(after.annotations['ann-ai'].resolution, undefined);
  assert.equal(after.changes.at(-1).patch[0].before.status, 'resolved');
  assert.equal(after.annotations['ann-ai'].createdBy.kind, 'human');
});

test('legacy annotations stay readable and protected until type confirmation', () => {
  const doc = create();
  doc.annotations['ann-legacy'] = { id: 'ann-legacy', body: '旧的批注', status: 'open', anchor, author: '原作者' };
  const html = '<html><body>' + metadataBlockUnchecked(doc) + '</body></html>';
  const migrated = parse(html);
  const a = migrated.annotations['ann-legacy'];
  assert.equal(a.kind, 'explanation');
  assert.equal(a.needsTypeConfirmation, true);
  assert.equal(a.legacy.unclassifiedAnnotation.status, 'open');
  assert.equal(a.createdBy.name, '原作者');
  assert.equal(review(migrated).openAnnotations.length, 0);
  assert.deepEqual(parse(write(source, migrated)), migrated);
});
function metadataBlockUnchecked(doc) { return '<!-- ux-document:start --><script type="application/json" id="ux-document">' + serializeJSON(doc) + '</script><!-- ux-document:end -->'; }

test('legacy null anchor IDs are omitted on read without changing annotation content or history', () => {
  const legacy = fixture();
  legacy.annotations['ann-ai'].anchor.id = null;
  const original = clone(legacy), expected = clone(legacy);
  delete expected.annotations['ann-ai'].anchor.id;
  const parsed = parse('<html><body>' + metadataBlockUnchecked(legacy) + '</body></html>');
  assert.deepEqual(parsed, expected);
  assert.deepEqual(legacy, original);
  assert.deepEqual(parse(write(source, parsed)), expected);
});

test('saving an old draft with a null anchor ID preserves its selector, region and navigation context', () => {
  const before = create(), draft = clone(before);
  const location = { kind: 'region', id: null, selector: '#runtime-panel', text: '动态内容', region: { x: .1, y: .1, width: .5, height: .5 }, view: { key: 'details', itemId: '42' } };
  draft.annotations['ann-draft'] = createAnnotation({ id: 'ann-draft', kind: 'change-request', body: '保留上次填写的修改意见', anchor: location });
  const saved = recordHuman(before, draft), expected = { ...location };
  delete expected.id;
  assert.deepEqual(saved.annotations['ann-draft'].anchor, expected);
  assert.equal(saved.annotations['ann-draft'].body, '保留上次填写的修改意见');
  assert.deepEqual(saved.changes.at(-1).patch[0].value.anchor, expected);
  assert.equal(draft.annotations['ann-draft'].anchor.id, null, 'Do not mutate the recovery snapshot');
});

test('non-null invalid stable IDs remain errors when parsing or saving drafts', () => {
  for (const id of ['', '   ', 123, false, {}, []]) {
    const before = create(), draft = clone(before);
    draft.annotations['ann-invalid'] = createAnnotation({ id: 'ann-invalid', body: '无效锚点', anchor: { ...anchor, id } });
    assert.throws(() => recordHuman(before, draft), /稳定锚点 ID 无效/);
    assert.throws(() => parse('<html><body>' + metadataBlockUnchecked(draft) + '</body></html>'), /稳定锚点 ID 无效/);
  }
});

test('validation rejects unexplained history discontinuity and invalid region coordinates', () => {
  const doc = fixture(); doc.changes.at(-1).revision = 80;
  assert.throws(() => validate(doc), /连续/);
  const invalid = fixture(); invalid.annotations['ann-explanation'].anchor = { kind: 'region', selector: 'body', region: { x: .9, y: 0, width: .5, height: .1 } };
  assert.throws(() => validate(invalid), /归一化/);
});

test('import preserves plain prototype and returns valid initial creation', () => {
  const imported = importHtml(source);
  assert.ok(imported.imported);
  assert.equal(imported.doc.title, 'Test');
  assert.equal(imported.doc.revision, 1);
  assert.equal(imported.doc.changes[0].actor, 'system');
  assert.deepEqual(imported.doc.design, { id: 'existing' });
  assert.deepEqual(create().design, { id: 'opentiny' });
  assert.equal(imported.report.sourceFormat, 'plain-html');
  assert.deepEqual(imported.report.unmigrated, []);
  assert.equal(imported.doc.report, undefined);
  assert.deepEqual(importHtml(imported.html).doc, imported.doc);
});

test('canonical import keeps document identity, content, history and extension fields', () => {
  const doc = fixture();
  doc.legacyHistory = [{ version: 1, summary: '原始历史', extension: { kept: true } }];
  doc.extension = { originalId: 'legacy-123' };
  const html = write(source, doc), imported = importHtml(html);
  assert.equal(imported.imported, false);
  assert.equal(imported.html, html);
  assert.deepEqual(imported.doc, doc);
  assert.equal(imported.report.sourceFormat, 'ux-review-document');
  assert.deepEqual(imported.report.removed, []);
  assert.deepEqual(imported.report.unmigrated, []);
  assert.equal(imported.doc.report, undefined);
});

test('requirements import reports conversion, removed shell and unmigrated extensions', () => {
  const history = [{ version: 4, summary: '既有版本', details: ['原始记录'], custom: { retained: true } }];
  const payload = { title: '原文档标题', prd: '<h1>目标</h1><p>保留业务规则</p>', changes: history, fileBase: 'original', annotations: [{ note: '旧标注' }] };
  const shell = '<button data-ux-docs-open>旧入口</button><!-- ux-requirements:start --><aside id="old-review">旧面板</aside><script type="application/json" id="ux-requirements">' + serializeJSON(payload) + '</script><!-- ux-requirements:end -->';
  const imported = importHtml(source.replace('</body></html>', shell + '</body></html>'));
  assert.equal(imported.report.sourceFormat, 'ux-requirements');
  assert.equal(imported.doc.title, payload.title);
  assert.equal(imported.doc.prd, '# 目标\n\n保留业务规则');
  assert.equal(imported.doc.uxVersion, 4);
  assert.deepEqual(imported.doc.legacyHistory, history);
  assert.deepEqual(imported.doc.annotations, {});
  assert.deepEqual(imported.doc.design, { id: 'existing' });
  assert.deepEqual(imported.report.unmigrated.map(item => item.field), ['ux-requirements.fileBase', 'ux-requirements.annotations']);
  assert.ok(imported.report.migrated.some(item => item.field === 'ux-requirements.prd' && /富文本/.test(item.note)));
  assert.deepEqual(imported.report.removed.map(item => item.field), ['ux-requirements-shell', 'data-ux-docs-open']);
  assert.doesNotMatch(sourceOnly(imported.html), /old-review|data-ux-docs-open|ux-requirements/);
  assert.ok(sourceOnly(imported.html).includes('<button data-ux-anchor="save">保存</button>'));
  assert.equal(imported.doc.report, undefined);
});

test('requirements payload without changes is archived without claiming extension migration', () => {
  const payload = { title: '旧需求', prd: '<p>保留说明</p>', annotations: [{ note: '旧标注' }] };
  const imported = importHtml(source.replace('</body></html>', '<script type="application/json" id="ux-requirements">' + serializeJSON(payload) + '</script></body></html>'));
  assert.deepEqual(imported.doc.legacyHistory, payload);
  assert.deepEqual(imported.doc.annotations, {});
  assert.match(imported.report.unmigrated[0].note, /仅随原始数据归档/);
  assert.equal(imported.report.removed[0].field, 'ux-requirements-script');
});

test('offline import accepts leading whitespace and reports unsupported fields without executing scripts', () => {
  const prd = '# v004 需求\n\n保留原始 **Markdown**。', history = '## v003\n\n旧版本原文';
  const payload = { prototype: source, extension: { note: '不迁移' }, content: { title: '旧壳标题', docs: [{ id: 'prd', source: prd, title: '需求' }, { id: 'changes', source: history }, { id: 'extra', source: '额外文档' }] } };
  const input = '<html><body><div id="old-offline">旧评审壳</div><script>\n \twindow.__PRD_OFFLINE__=' + serializeJSON(payload) + ';\n</script></body></html>';
  const imported = importHtml(input);
  assert.equal(imported.report.sourceFormat, '__PRD_OFFLINE__');
  assert.equal(imported.doc.title, 'Test');
  assert.equal(imported.doc.prd, prd);
  assert.equal(imported.doc.uxVersion, 4);
  assert.equal(imported.doc.legacyHistory, history);
  assert.deepEqual(imported.doc.design, { id: 'existing' });
  assert.equal(imported.html, write(source, imported.doc));
  assert.deepEqual(imported.report.unmigrated.map(item => item.field), ['extension', 'content.title', 'content.docs[0].title', 'content.docs[2]']);
  assert.equal(imported.report.removed[0].field, 'offline-review-shell');
  assert.ok(imported.report.notes.some(note => /不保证.*完整无损/.test(note)));
  assert.equal(imported.doc.report, undefined);
  globalThis.__offlineImportExecuted = false;
  try {
    assert.throws(() => importHtml('<html><body><script> window.__PRD_OFFLINE__=(globalThis.__offlineImportExecuted = true);</script></body></html>'), SyntaxError);
    assert.equal(globalThis.__offlineImportExecuted, false);
    const unrelated = '<html><body><script>const demo = "window.__PRD_OFFLINE__=";</script></body></html>';
    assert.equal(importHtml(unrelated).report.sourceFormat, 'plain-html');
  } finally { delete globalThis.__offlineImportExecuted; }
});


test('anchor audit distinguishes duplicate targets from not-yet-rendered targets', () => {
  const doc = fixture();
  doc.annotations['ann-human'].anchor.id = 'dialog-only';
  delete doc.annotations['ann-explanation'].anchor.id;
  const audit = auditAnchors(source.replace('</body></html>', '<button data-ux-anchor="save">另一个按钮</button></body></html>'), doc);
  assert.equal(audit.duplicates[0].anchorId, 'save');
  assert.equal(audit.missing[0].annotationId, 'ann-human');
  assert.deepEqual(audit.unverified.map(item => [item.annotationId, item.selector]), [['ann-explanation', anchor.selector]]);
  assert.equal(audit.checked, 1);
  const scriptOnly = source.replace('<script>', `<script>const fake = '<div data-ux-anchor="save">';`);
  assert.equal(auditAnchors(scriptOnly, fixture()).duplicates.length, 0);
});


test('AI rejects prototype-sensitive annotation keys before applying updates', () => {
  assert.throws(() => recordAgent(fixture(), { summary: '修改', details: ['修改'], annotationUpdates: [{ id: '__proto__', kind: 'explanation', body: 'bad', anchor }] }), /ann-ID/);
});


test('adding stable anchors for explanations does not bump UX version; behavior edits do', () => {
  const unanchored = '<html><body><button>提交</button></body></html>';
  const anchored = unanchored.replace('<button>', '<button data-ux-anchor="submit">');
  assert.equal(hasPrototypeChanges(unanchored, anchored), false);
  const after = recordAgent(create(), { summary: '补充说明', details: ['绑定提交说明'], uxBefore: unanchored, uxAfter: anchored, annotationUpdates: [{ id:'ann-rule', kind:'explanation', body:'提交后展示结果', anchor:{kind:'element',id:'submit',selector:'[data-ux-anchor="submit"]'} }] });
  assert.equal(after.uxVersion, 1);
  assert.equal(after.changes.at(-1).kind, 'documentation');
  assert.equal(hasPrototypeChanges(anchored, anchored.replace('提交</button>', '保存</button>')), true);
  assert.equal(hasPrototypeChanges('<html><body><script>const a=`<button data-ux-anchor="a">`</script></body></html>', '<html><body><script>const a=`<button data-ux-anchor="b">`</script></body></html>'), true);
});
