import test from 'node:test';
import assert from 'node:assert/strict';
import { makePrdPatch, applyPrdPatch, applyPrdOps, prdPatchDiff } from '../scripts/prd-patch.mjs';
import { create, clone, recordHuman, recordAgent, parse, write, prdChangeDiff } from '../scripts/document.mjs';

test('line patches preserve exact text in both directions, including repeated lines and line endings', () => {
  const cases = [
    ['', '新需求'], ['新需求', ''], ['a\nb\na', 'a\nc\na'],
    ['a\r\nb\r\n', 'a\r\nc\r\n'], ['a\nb\n', 'a\nb'],
    ['a\nb\nc\nd\ne', 'x\na\nc\nD\ne\nz'], ['😀\n\n尾部', '😀\n\n新尾部'],
  ];
  // Deterministic broad coverage of insert/delete/repeated-line combinations.
  let seed = 817;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 400; i++) {
    const a = Array.from({ length: random(30) + 1 }, () => '行' + random(5)), b = a.slice();
    for (let j = 0; j < 5; j++) b.splice(random(b.length + 1), random(3), ...Array.from({ length: random(3) }, () => '值' + random(5)));
    cases.push([a.join('\n'), b.join('\n')]);
  }
  for (const [before, after] of cases) {
    const patch = makePrdPatch(before, after);
    if (before === after) { assert.equal(patch, null); continue; }
    assert.equal(applyPrdPatch(before, patch), after);
    assert.equal(applyPrdPatch(after, patch, { reverse: true }), before);
  }
});

test('sparse edits in large PRD store only affected lines and reject mismatched bases', () => {
  const lines = Array.from({ length: 4000 }, (_, i) => `需求 ${i}：保持原有说明。`), next = lines.slice();
  next[4] = '需求 4：更新名称。'; next[3996] = '需求 3996：新增反馈。';
  const patch = makePrdPatch(lines.join('\n'), next.join('\n'));
  assert.equal(patch.hunks.length, 2);
  assert.ok(JSON.stringify(patch).length < 500);
  assert.equal(applyPrdPatch(lines.join('\n'), patch), next.join('\n'));
  assert.equal(applyPrdPatch(next.join('\n'), patch, { reverse: true }), lines.join('\n'));
  assert.throws(() => applyPrdPatch('wrong', patch), /行数/);
  const wrong = lines.slice(); wrong[4] = '第三方改动';
  assert.throws(() => applyPrdPatch(wrong.join('\n'), patch), /原文/);
  assert.doesNotMatch(prdPatchDiff(patch), /需求 2000/);
});

test('prdOps are sequential exact replacements, ambiguity and failure never mutate input', () => {
  const original = '# 要求\n按钮名为商家入驻。\n其他规则保留。';
  assert.equal(applyPrdOps(original, [{ find: '按钮名为商家入驻。', replace: '按钮名为商家入驻申请。' }]), original.replace('入驻。', '入驻申请。'));
  assert.equal(applyPrdOps('A', [{ find: 'A', replace: 'B' }, { find: 'B', replace: 'C' }]), 'C');
  assert.equal(applyPrdOps('', [{ find: '', replace: '# 新需求' }]), '# 新需求');
  assert.equal(applyPrdOps('delete', [{ find: 'delete', replace: '' }]), '');
  assert.throws(() => applyPrdOps('aba aba', [{ find: 'aba', replace: 'x' }]), /多处/);
  assert.throws(() => applyPrdOps('aaa', [{ find: 'aa', replace: 'x' }]), /多处/);
  assert.throws(() => applyPrdOps(original, [{ find: '按钮名为商家入驻。', replace: '新名称' }, { find: '不存在', replace: '' }]), /未命中/);
  assert.throws(() => applyPrdOps(original, [{ find: '', replace: 'all' }]), /空 find/);
  const doc = create({ prd: original }), snapshot = clone(doc);
  assert.throws(() => recordAgent(doc, { summary: '编辑', details: ['局部改名'], prd: original, prdOps: [] }), /同时/);
  assert.deepEqual(doc, snapshot);
});

test('large line counts can be replayed and rendered without argument spread limits', () => {
  const before = 'a\n'.repeat(150000) + '旧值', after = 'a\n'.repeat(150000) + '新值';
  const patch = makePrdPatch(before, after);
  assert.equal(applyPrdPatch(before, patch), after);
  assert.equal(applyPrdPatch(after, patch, { reverse: true }), before);
  const inserted = makePrdPatch('标题', '标题\n' + '新增\n'.repeat(150000));
  assert.equal(applyPrdPatch('标题', inserted), '标题\n' + '新增\n'.repeat(150000));
  assert.ok(prdPatchDiff(inserted).includes('+新增'));
});

test('human and AI multi-round history reconstructs every PRD revision without full copies', () => {
  const original = Array.from({ length: 1000 }, (_, i) => `第 ${i} 项：原始内容。`).join('\n');
  let doc = create({ prd: original }); const texts = [original], baseBytes = JSON.stringify(doc).length;
  for (let i = 0; i < 20; i++) {
    const find = `第 ${i * 3} 项：原始内容。`, replace = `第 ${i * 3} 项：第 ${i} 轮修改。`;
    if (i % 2) doc = recordAgent(doc, { summary: '局部改名', details: ['更新一句需求'], prdOps: [{ find, replace }] });
    else { const draft = clone(doc); draft.prd = draft.prd.replace(find, replace); doc = recordHuman(doc, draft); }
    texts.push(doc.prd);
    const event = doc.changes.at(-1), patch = event.patch.find(p => p.path === '/prd');
    assert.equal(patch.before, undefined); assert.equal(patch.value, undefined); assert.equal(event.diff?.prd, undefined);
    assert.match(prdChangeDiff(event), /轮修改/);
  }
  assert.ok(JSON.stringify(doc).length - baseBytes < 20000);
  doc = parse(write('<html><body></body></html>', doc));
  let current = doc.prd;
  for (let i = doc.changes.length - 1; i > 0; i--) {
    current = applyPrdPatch(current, doc.changes[i].patch.find(p => p.path === '/prd'), { reverse: true });
    assert.equal(current, texts[i - 1]);
  }
});

test('new incremental history appends to legacy full snapshots without rewriting old events', () => {
  const doc = create({ prd: '旧正文' });
  const legacy = recordHuman(doc, { ...doc, prd: '人工正文' });
  legacy.changes[1].patch = [{ op: 'replace', path: '/prd', before: '旧正文', value: '人工正文' }];
  legacy.changes[1].diff = { prd: '--- before\n+++ after\n@@ -1,1 +1,1 @@\n-旧正文\n+人工正文' };
  const previous = clone(legacy.changes);
  const next = recordAgent(legacy, { summary: '改名', details: ['局部改名'], prdOps: [{ find: '人工', replace: '最新' }] });
  assert.deepEqual(next.changes.slice(0, 2), previous);
  assert.equal(prdChangeDiff(next.changes[1]), legacy.changes[1].diff.prd);
  assert.equal(parse(write('<html><body></body></html>', next)).prd, '最新正文');
});
