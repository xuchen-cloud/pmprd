import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { create, createAnnotation, write, parse, sourceOnly } from '../scripts/document.mjs';

const cli = fileURLToPath(new URL('../scripts/uxdoc.mjs', import.meta.url));
const source = '<!doctype html><html><head><style>button{padding:8px}</style></head><body><button id="save" data-ux-anchor="save">保存</button><script>const limit=3;</script></body></html>';
const hash = value => createHash('sha256').update(value).digest('hex');
const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', input });

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ux-finish 中文 '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const id = randomUUID(), stem = path.join(dir, '.ux-review-' + id), originalPath = path.join(dir, '原稿.ux.html');
  const before = create({ prd: '提交上限为 3 条。\n保留其他说明。' });
  for (const name of ['selected', 'unselected']) before.annotations['ann-' + name] = createAnnotation({ id: 'ann-' + name, kind: 'change-request', body: name, anchor: { kind: 'element', id: 'save', selector: '#save' } });
  before.annotations['ann-explanation'] = createAnnotation({ id: 'ann-explanation', kind: 'explanation', body: '提交上限为 3 条', anchor: { kind: 'element', id: 'save', selector: '#save' } });
  const inputHtml = write(source, before), task = { format: 'ux-review-task', schemaVersion: 1, id, documentId: before.id, baseRevision: before.revision, baseHash: hash(inputHtml),
    originalPath, inputPath: stem + '.input.ux.html', outputPath: stem + '.result.ux.html', businessPath: stem + '.business.html',
    selectedIds: ['ann-selected'], clearResolved: false, includePrdChanges: true, createNewVersion: false, status: 'running',
    activePointerPath: path.join(dir, '.ux-review-active-test.json'), ...options };
  for (const [file, contents] of [[originalPath, inputHtml], [task.inputPath, inputHtml], [task.businessPath, source], [stem + '.task.json', JSON.stringify(task)], [stem + '.state.json', JSON.stringify(task)], [task.activePointerPath, JSON.stringify({ taskId: id, documentId: before.id })]]) await fs.writeFile(file, contents);
  return { dir, stem, task, before, inputHtml, finish: (...args) => run(['finish', task.businessPath, '--summary', '调整提交限制与按钮布局', ...args]) };
}

test('one finish records and delivers generic source edits, preserving unrelated content', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.task.businessPath, source.replace('padding:8px', 'padding:12px').replace('limit=3', 'limit=5'));
  const result = f.finish(); assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout), saved = await fs.readFile(f.task.originalPath, 'utf8'), doc = parse(saved);
  assert.equal(receipt.outputPath, f.task.originalPath); assert.equal(receipt.delivery, 'updated-current');
  assert.equal(receipt.candidatePath, f.task.outputPath); assert.equal(doc.revision, f.before.revision + 1);
  assert.match(sourceOnly(saved), /padding:12px/); assert.match(sourceOnly(saved), /limit=5/);
  assert.equal(doc.annotations['ann-selected'].status, 'resolved');
  assert.deepEqual(doc.annotations['ann-unselected'], f.before.annotations['ann-unselected']);
  assert.equal(doc.prd, f.before.prd); assert.deepEqual(doc.changes.slice(0, -1), f.before.changes);
  assert.deepEqual(doc.changes.at(-1).details, ['调整提交限制与按钮布局']);
  assert.equal(await fs.readFile(f.task.inputPath, 'utf8'), f.inputHtml);
  assert.equal(JSON.parse(await fs.readFile(f.stem + '.state.json', 'utf8')).status, 'running');
  const internal = JSON.parse(await fs.readFile(f.stem + '.finish.json', 'utf8'));
  assert.equal(internal.taskId, f.task.id); assert.equal(internal.outputPath, f.task.outputPath); assert.equal(internal.deliveredPath, f.task.originalPath);
});

test('new-version option leaves original untouched and returns final candidate path', async t => {
  const f = await fixture(t, { createNewVersion: true });
  await fs.writeFile(f.task.businessPath, source.replace('limit=3', 'limit=5'));
  const result = f.finish(); assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.delivery, 'new-version'); assert.equal(receipt.outputPath, f.task.outputPath);
  assert.equal(await fs.readFile(f.task.originalPath, 'utf8'), f.inputHtml);
});

test('inline JSON supports scoped PRD diff, explanation edits and explicitly partial completion', async t => {
  const f = await fixture(t, { clearResolved: true });
  await fs.writeFile(f.task.businessPath, source.replace('limit=3', 'limit=5'));
  const result = f.finish('--resolve', 'none', '--changes-json', JSON.stringify({ prdOps: [{ find: '上限为 3 条', replace: '上限为 5 条' }], annotationUpdates: [{ id: 'ann-explanation', body: '提交上限为 5 条' }] }));
  assert.equal(result.status, 0, result.stderr);
  const doc = parse(await fs.readFile(f.task.originalPath, 'utf8'));
  assert.equal(doc.prd, '提交上限为 5 条。\n保留其他说明。');
  assert.equal(doc.annotations['ann-explanation'].body, '提交上限为 5 条');
  assert.equal(doc.annotations['ann-selected'].status, 'open');
  assert.equal(doc.changes.at(-1).patch.find(p => p.path === '/prd').op, 'text');
  assert.deepEqual(doc.changes.at(-1).resolvedIds, []);
});

test('stdin submission avoids a changes file and honors clear-resolved scope', async t => {
  const f = await fixture(t, { clearResolved: true });
  const result = run(['finish', f.task.businessPath, '--changes', '-'], JSON.stringify({ summary: '补充规则说明', annotationUpdates: [{ id: 'ann-explanation', body: '点击保存后提交。' }] }));
  assert.equal(result.status, 0, result.stderr);
  const doc = parse(await fs.readFile(f.task.originalPath, 'utf8'));
  assert.equal(doc.annotations['ann-selected'], undefined); assert.ok(doc.annotations['ann-unselected']);
  assert.ok(doc.changes.at(-1).resolvedSnapshots['ann-selected']);
});

test('permission and scope errors do not produce a candidate or change original', async t => {
  for (const changes of [{ prdOps: [{ find: '上限为 3 条', replace: '上限为 5 条' }] }, { resolvedIds: ['ann-unselected'] }, { annotationUpdates: [{ id: 'ann-unselected', body: '越界修改' }] }]) {
    const f = await fixture(t, { includePrdChanges: false }), result = f.finish('--changes-json', JSON.stringify(changes));
    assert.notEqual(result.status, 0); await assert.rejects(fs.access(f.task.outputPath));
    assert.equal(await fs.readFile(f.task.originalPath, 'utf8'), f.inputHtml);
  }
});

test('conflicting original is preserved while the candidate remains available', async t => {
  const f = await fixture(t), other = f.inputHtml.replace('limit=3', 'limit=9');
  await fs.writeFile(f.task.originalPath, other);
  await fs.writeFile(f.task.businessPath, source.replace('limit=3', 'limit=5'));
  const result = f.finish(); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).delivery, 'conflict');
  assert.equal(await fs.readFile(f.task.originalPath, 'utf8'), other);
  assert.match(sourceOnly(await fs.readFile(f.task.outputPath, 'utf8')), /limit=5/);
});

test('cancelled or superseded sessions cannot overwrite a document', async t => {
  for (const mode of ['cancelled', 'superseded']) {
    const f = await fixture(t);
    if (mode === 'cancelled') await fs.writeFile(f.stem + '.state.json', JSON.stringify({ ...f.task, status: 'cancelled' }));
    else await fs.writeFile(f.task.activePointerPath, JSON.stringify({ taskId: randomUUID() }));
    assert.notEqual(f.finish().status, 0);
    assert.equal(await fs.readFile(f.task.originalPath, 'utf8'), f.inputHtml);
    await assert.rejects(fs.access(f.task.outputPath));
  }
});

test('same finish is idempotent, including after Host marks completed', async t => {
  const f = await fixture(t);
  assert.equal(f.finish().status, 0);
  const first = await fs.readFile(f.task.originalPath, 'utf8');
  await fs.writeFile(f.stem + '.state.json', JSON.stringify({ ...f.task, status: 'completed' }));
  const repeat = f.finish(); assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(await fs.readFile(f.task.originalPath, 'utf8'), first);
  await fs.writeFile(f.task.businessPath, source.replace('limit=3', 'limit=7'));
  assert.notEqual(f.finish().status, 0); assert.equal(await fs.readFile(f.task.originalPath, 'utf8'), first);
});

test('interrupted receipt write recovers an existing candidate without another revision', async t => {
  const f = await fixture(t);
  assert.equal(f.finish().status, 0);
  const first = await fs.readFile(f.task.outputPath, 'utf8');
  await fs.unlink(f.stem + '.finish.json');
  const repeat = f.finish(); assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(await fs.readFile(f.task.outputPath, 'utf8'), first);
  assert.equal(await fs.readFile(f.task.originalPath, 'utf8'), first);
});

test('read workfile loads only requested baseline metadata or latest edited source', async t => {
  const f = await fixture(t); await fs.writeFile(f.task.businessPath, source.replace('limit=3', 'limit=5'));
  const sourceRead = run(['read', f.task.businessPath, '--kind', 'source', '--search', 'limit=5']);
  assert.equal(sourceRead.status, 0, sourceRead.stderr); assert.equal(JSON.parse(sourceRead.stdout).totalMatches, 1);
  const prdRead = run(['read', f.task.businessPath, '--kind', 'prd', '--search', '上限']);
  assert.equal(prdRead.status, 0, prdRead.stderr); assert.match(JSON.parse(prdRead.stdout).matches[0].text, /3 条/);
});

test('malformed workfile and foreign existing candidate never overwrite original or candidate', async t => {
  const malformed = await fixture(t); await fs.writeFile(malformed.task.businessPath, '<div>incomplete</div>');
  assert.notEqual(malformed.finish().status, 0);
  assert.equal(await fs.readFile(malformed.task.originalPath, 'utf8'), malformed.inputHtml);
  await assert.rejects(fs.access(malformed.task.outputPath));
  const foreign = await fixture(t), existing = write(source, create({ prd: '另一份文档' }));
  await fs.writeFile(foreign.task.outputPath, existing);
  assert.notEqual(foreign.finish().status, 0);
  assert.equal(await fs.readFile(foreign.task.originalPath, 'utf8'), foreign.inputHtml);
  assert.equal(await fs.readFile(foreign.task.outputPath, 'utf8'), existing);
  await assert.rejects(fs.access(foreign.stem + '.finish.json'));
});
