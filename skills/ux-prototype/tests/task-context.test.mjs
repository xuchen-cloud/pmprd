import test from 'node:test';
import assert from 'node:assert/strict';
import { create, createAnnotation, clone, recordAgent, recordHuman } from '../scripts/document.mjs';
import { taskContext } from '../scripts/task-context.mjs';
import { readTaskContext } from '../scripts/task-read.mjs';
import { targetSources } from '../scripts/target-source.mjs';

function fixture() {
  let doc = create({ prd: '# 保存规则 {#save-rules}\n必填后保存。\n\n# 其他规则\n保留其他业务规则。' });
  const initial = clone(doc);
  for (const [id, kind, body, anchor] of [
    ['ann-selected', 'change-request', '旧按钮意见', 'save'],
    ['ann-other', 'change-request', 'UNSELECTED_REQUEST_OLD', 'other'],
    ['ann-rule', 'explanation', '提交前校验', 'save'],
    ['ann-global', 'explanation', '跨控件业务说明', 'other'],
  ]) initial.annotations[id] = createAnnotation({ id, kind, body, anchor: { kind: 'element', id: anchor, selector: `#${anchor}` } });
  doc = recordHuman(doc, initial, 'OLD_HISTORY_DO_NOT_EMIT');
  doc = recordAgent(doc, { summary: 'AI 基线', details: ['确认当前基线'] });
  const draft = clone(doc);
  draft.annotations['ann-selected'].body = '按钮改为保存并继续';
  draft.annotations['ann-other'].body = 'UNSELECTED_REQUEST_NEW';
  draft.annotations['ann-rule'].body = '填写完整后才能保存';
  draft.prd += '\n\n新的 PRD 条件。';
  doc = recordHuman(doc, draft, 'UNSELECTED_REQUEST_NEW is deliberately quoted in the event summary');
  return { doc, task: { format: 'ux-review-task', schemaVersion: 1, id: 'task-scoped', documentId: doc.id, baseRevision: doc.revision, inputPath: '/input.ux.html', outputPath: '/output.ux.html', selectedIds: ['ann-selected'], includePrdChanges: false, clearResolved: false } };
}


const source = '<html><body>\n<button id="save" data-ux-anchor="save">保存</button>\n<button id="other">其他</button>\n</body></html>';

test('initial context contains only selected requests and exact target snippets, regardless of PRD permission', () => {
  const { doc, task } = fixture(), snapshot = JSON.stringify(doc);
  doc.annotations['ann-selected'].anchor.text = '保存';
  doc.annotations['ann-selected'].anchor.view = { page: 'detail', tabs: ['product'] };
  for (const includePrdChanges of [false, true]) {
    const context = taskContext(doc, { ...task, includePrdChanges }, { source }), text = JSON.stringify(context);
    assert.deepEqual(context.selectedRequests.map(a => a.id), ['ann-selected']);
    assert.equal(context.selectedRequests[0].body, '按钮改为保存并继续');
    assert.deepEqual(context.selectedRequests[0].anchor, doc.annotations['ann-selected'].anchor);
    assert.equal(context.selectedRequests[0].targetSource.html, '<button id="save" data-ux-anchor="save">保存</button>');
    assert.equal(context.selectedRequests[0].targetSource.startLine, 2);
    assert.equal(context.prdPolicy.mode, includePrdChanges ? 'scoped-update' : 'read-only');
    assert.equal(context.scope.pendingPrdChangeCount, includePrdChanges ? 1 : 0);
    for (const key of ['prd', 'explanations', 'humanChangesSinceAgent', 'document', 'changes']) assert.equal(context[key], undefined);
    for (const hidden of ['UNSELECTED_REQUEST', 'OLD_HISTORY_DO_NOT_EMIT', '提交前校验', '填写完整后才能保存', '保留其他业务规则', '新的 PRD 条件']) assert.ok(!text.includes(hidden), hidden);
  }
  delete doc.annotations['ann-selected'].anchor.text; delete doc.annotations['ann-selected'].anchor.view;
  assert.equal(JSON.stringify(doc), snapshot);
});

test('PRD-only tasks initially expose availability, never automatically load diff or explanations', () => {
  const { doc, task } = fixture();
  const context = taskContext(doc, { ...task, selectedIds: [], includePrdChanges: true }, { source });
  assert.deepEqual(context.selectedRequests, []);
  assert.equal(context.scope.pendingPrdChangeCount, 1);
  assert.equal(JSON.stringify(context).includes('新的 PRD 条件'), false);
});

test('invalid task scope fails; explicit human-assigned selection remains allowed', () => {
  const { doc, task } = fixture();
  for (const selectedIds of [['ann-rule'], ['ann-selected', 'ann-selected'], ['ann-missing']]) assert.throws(() => taskContext(doc, { ...task, selectedIds }));
  assert.throws(() => taskContext(doc, { ...task, baseRevision: 0 }));
  doc.annotations['ann-selected'].assignee = { kind: 'human', name: '同事' };
  assert.equal(taskContext(doc, task).selectedRequests[0].assignee.name, '同事');
  assert.equal(taskContext(doc, task).selectedRequests[0].targetSource.reason, 'source-not-provided');
});

test('explicit PRD reads search or slice only needed lines without rule/history fan-out', () => {
  const { doc, task } = fixture(), snapshot = JSON.stringify(doc);
  const found = readTaskContext(doc, task, { kind: 'prd', search: '保存' });
  assert.equal(found.matches.length, 2);
  assert.equal(found.matches[0].line, 1);
  const selected = readTaskContext(doc, task, { kind: 'prd', startLine: 2, endLine: 2 });
  assert.equal(selected.text, '必填后保存。');
  assert.equal(selected.nextLine, 3);
  assert.equal(selected.explanations, undefined);
  assert.throws(() => readTaskContext(doc, task, { kind: 'prd' }), /不能默认读取全文/);
  assert.throws(() => readTaskContext(doc, task, { kind: 'prd', search: '保存', startLine: 1 }), /不能同时/);
  assert.throws(() => readTaskContext(doc, { ...task, baseRevision: 0 }, { kind: 'prd', search: '保存' }), /不匹配/);
  assert.equal(JSON.stringify(doc), snapshot);
});

test('source reads preserve offsets and search excerpts include late matches on minified lines', () => {
  const { doc, task } = fixture(), minified = '<div>' + 'a'.repeat(20000) + 'NEEDLE' + 'b'.repeat(20000) + '</div>';
  const found = readTaskContext(doc, task, { kind: 'source', search: 'NEEDLE' }, minified);
  assert.match(found.matches[0].text, /NEEDLE/);
  assert.equal(found.matches[0].line, 1);
  assert.equal(found.matches[0].column, 19806);
  assert.ok(found.matches[0].text.length <= 1200);
  assert.equal(found.matches[0].truncated, true);
  const lines = Array.from({ length: 200 }, (_, i) => 'row' + i).join('\n');
  assert.throws(() => readTaskContext(doc, task, { kind: 'source', startLine: 1, endLine: 81 }, lines), /最多 80/);
  const page = readTaskContext(doc, task, { kind: 'source', search: 'row', limit: 2, offset: 3 }, lines);
  assert.deepEqual(page.matches.map(m => m.text), ['row3', 'row4']);
  assert.equal(page.nextOffset, 5);
  const longMatches = Array.from({ length: 20 }, (_, i) => String(i) + 'x'.repeat(2000) + 'MATCH' + 'y'.repeat(2000)).join('\n');
  const first = readTaskContext(doc, task, { kind: 'source', search: 'MATCH', limit: 20 }, longMatches);
  assert.equal(first.matches.length, 10);
  assert.equal(first.nextOffset, 10);
  assert.ok(first.matches.every(match => match.text.includes('MATCH')));
  const rest = readTaskContext(doc, task, { kind: 'source', search: 'MATCH', offset: first.nextOffset, limit: 20 }, longMatches);
  assert.equal(rest.matches[0].line, 11);
});

test('explicit explanation reads do not turn references or other requests into executable context', () => {
  const { doc, task } = fixture();
  doc.prd += '\n@annotation(ann-global)\n@annotation(ann-other)\n@annotation(ann-missing)';
  doc.annotations['ann-legacy'] = createAnnotation({ id: 'ann-legacy', kind: 'explanation', body: 'UNCONFIRMED', anchor: { kind: 'element', selector: '#legacy' }, needsTypeConfirmation: true });
  const linked = readTaskContext(doc, task, { kind: 'explanations', anchorId: 'save' });
  assert.deepEqual(linked.explanations.map(a => a.id), ['ann-rule']);
  const explicit = readTaskContext(doc, task, { kind: 'explanations', ids: ['ann-global', 'ann-other', 'ann-missing', 'ann-legacy'] });
  assert.deepEqual(explicit.explanations.map(a => a.id), ['ann-global']);
  assert.deepEqual(explicit.unavailableIds, ['ann-other', 'ann-missing', 'ann-legacy']);
  assert.equal(JSON.stringify(explicit).includes('UNSELECTED_REQUEST'), false);
  assert.equal(JSON.stringify(explicit).includes('UNCONFIRMED'), false);
  assert.throws(() => readTaskContext(doc, task, { kind: 'explanations' }), /只指定/);
  assert.throws(() => readTaskContext(doc, task, { kind: 'explanations', ids: [], search: '规则' }), /只指定/);
});

test('pending PRD diff loads explicitly and excludes full old/new PRD and unrelated patches', () => {
  const { doc, task } = fixture();
  assert.throws(() => readTaskContext(doc, task, { kind: 'prd-diff' }), /未选择/);
  const diff = readTaskContext(doc, { ...task, includePrdChanges: true }, { kind: 'prd-diff' });
  assert.equal(diff.pendingCount, 1);
  assert.match(diff.text, /\+新的 PRD 条件/);
  assert.equal(diff.patch, undefined);
  assert.equal(JSON.stringify(diff).includes('UNSELECTED_REQUEST'), false);
  const legacy = clone(doc);
  legacy.changes.at(-1).patch = [{ op: 'replace', path: '/prd', before: 'OLD_FULL_PRD', value: 'NEW_FULL_PRD' }];
  legacy.changes.at(-1).diff = { prd: '--- before\n+++ after\n@@ -2 +2 @@\n-old\n+new' };
  const old = readTaskContext(legacy, { ...task, includePrdChanges: true }, { kind: 'prd-diff' });
  assert.match(old.text, /\+new/);
  assert.equal(JSON.stringify(old).includes('FULL_PRD'), false);
});

test('offline targeted reading shares explicit scopes without a task', () => {
  const { doc } = fixture();
  assert.equal(readTaskContext(doc, null, { kind: 'prd', search: '保存' }).taskId, null);
  assert.equal(readTaskContext(doc, null, { kind: 'prd-diff' }).pendingCount, 1);
  assert.throws(() => readTaskContext(doc, null, { kind: 'prd' }), /不能默认读取全文/);
});

test('static target extraction prefers unique stable anchors over stale selectors and script strings', () => {
  const html = '<html><body>\n<button data-ux-anchor="save">保存</button><button id="old">旧</button>\n<script>const t=\'<button data-ux-anchor="save">假的</button>\';</script></body></html>';
  const [result] = targetSources(html, [{ id: 'save', selector: '#old', tag: 'button', text: '旧文案' }]);
  assert.equal(result.status, 'found'); assert.equal(result.matchedBy, 'anchor');
  assert.equal(result.html, '<button data-ux-anchor="save">保存</button>');
  assert.equal(html.slice(result.startOffset, result.endOffset), result.html);
});

test('ambiguous, dynamic and implicit targets are reported instead of guessed', () => {
  const html = '<html><body><button data-ux-anchor="same">一</button><button data-ux-anchor="same">二</button><template><button id="future">隐藏</button></template><table><tr><td>x</td></tr></table></body></html>';
  const results = targetSources(html, [{ id: 'same', selector: 'button' }, { selector: '#runtime' }, { selector: 'button' }, { selector: '#future' }, { selector: 'tbody' }, { selector: 'button:unknown' }]);
  assert.deepEqual(results.map(r => r.reason), ['ambiguous-anchor', 'not-in-static-source', 'ambiguous-selector', 'not-in-static-source', 'no-unique-source-location', 'unsupported-selector']);
});

test('large target excerpts are bounded and selector fallback respects captured tag/text', () => {
  const html = '<html><body><section id="large">' + 'x'.repeat(10000) + '</section><button class="small">保存</button></body></html>';
  const [large, wrongTag, wrongText, good] = targetSources(html, [{ selector: '#large' }, { selector: '.small', tag: 'a' }, { selector: '.small', text: '删除' }, { id: 'runtime-only', selector: '.small', tag: 'button', text: '保存' }]);
  assert.equal(large.html.length, 2400); assert.equal(large.truncated, true);
  assert.equal(wrongTag.reason, 'tag-mismatch'); assert.equal(wrongText.reason, 'text-mismatch');
  assert.equal(good.status, 'found'); assert.equal(good.matchedBy, 'selector');
});
