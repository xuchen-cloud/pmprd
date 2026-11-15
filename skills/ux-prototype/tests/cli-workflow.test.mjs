import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { create, parse, write, prdChangeDiff } from '../scripts/document.mjs';

const skill = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(skill, 'scripts/uxdoc.mjs');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const source = '<!doctype html><html><head><title>原稿</title><style>button{color:navy}</style></head><body><button id="save">保存</button><p id="status"></p><script>document.querySelector("#save").onclick=()=>{document.querySelector("#status").textContent="已保存"}</script></body></html>';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ux-import 中文 '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, '原稿.html'), output = path.join(dir, '结果.ux.html');
  await fs.writeFile(input, source);
  return { dir, input, output };
}

test('every command has usable targeted help and rejects unrelated flags', async t => {
  for (const command of ['init', 'annotate', 'apply', 'prepare', 'extract', 'inspect', 'review', 'read', 'validate']) {
    const result = run(command, '--help');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp('uxdoc\\.mjs ' + command));
    assert.ok(result.stdout.length > 100);
    assert.equal(run('help', command).stdout, result.stdout);
    assert.equal(run(command, '-h').stdout, result.stdout);
  }
  assert.notEqual(run('help', 'import').status, 0);
  const f = await fixture(t);
  assert.match(run('init', f.input, '--task', 'ignored', '--output', f.output).stderr, /init 不接受 --task/);
  await assert.rejects(fs.access(f.output));
});

test('init PRD override keeps its initial snapshot accurate and reports legacy migration', async t => {
  const f = await fixture(t), prdPath = path.join(f.dir, '新需求.md');
  const legacy = { version: 3, title: '旧稿', prd: '# OLD_PRD', custom: 'unknown data' };
  await fs.writeFile(f.input, source.replace('</body>', '<!-- ux-requirements:start --><script id="ux-requirements" type="application/json">' + JSON.stringify(legacy) + '</script><!-- ux-requirements:end --></body>'));
  await fs.writeFile(prdPath, '# NEW_PRD\n点击后显示已保存。');
  const result = run('init', f.input, '--prd', prdPath, '--output', f.output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), f.output);
  assert.match(result.stderr, /导入报告/);
  const report = JSON.parse(result.stderr.replace(/^导入报告：/, ''));
  assert.equal(report.sourceFormat, 'ux-requirements');
  assert.ok(report.removed.length);
  const doc = parse(await fs.readFile(f.output, 'utf8'));
  assert.equal(doc.design.id, 'existing');
  assert.equal(doc.prd, '# NEW_PRD\n点击后显示已保存。');
  assert.equal(doc.changes[0].patch[0].value, doc.prd);
  assert.equal(doc.changes[0].diff, undefined);
  assert.match(prdChangeDiff(doc.changes[0]), /NEW_PRD/);
  assert.doesNotMatch(prdChangeDiff(doc.changes[0]), /OLD_PRD/);
  const designed = path.join(f.dir, 'OpenTiny.ux.html');
  assert.equal(run('init', f.input, '--output', designed, '--design', 'opentiny').status, 0);
  assert.equal(parse(await fs.readFile(designed, 'utf8')).design.id, 'opentiny');
});

test('no-task apply supports PRD-only updates without selectedIds and records history fields', async t => {
  const f = await fixture(t), changes = path.join(f.dir, 'changes.json'), candidate = path.join(f.dir, 'business.html');
  const before = create({ prd: '# 原需求' });
  await fs.writeFile(f.input, write(source, before));
  await fs.writeFile(candidate, source);
  await fs.writeFile(changes, JSON.stringify({ summary: '明确保存反馈', details: ['补充点击后的状态文案'], prd: '# 保存\n点击后显示已保存。' }));
  const result = run('apply', f.input, candidate, '--changes', changes, '--output', f.output);
  assert.equal(result.status, 0, result.stderr);
  const doc = parse(await fs.readFile(f.output, 'utf8'));
  assert.equal(doc.uxVersion, before.uxVersion);
  assert.equal(doc.revision, before.revision + 1);
  const event = doc.changes.at(-1);
  assert.deepEqual(event.selectedAnnotationIds, []);
  assert.deepEqual(event.resolvedAnnotationIds, []);
  assert.deepEqual(event.resolvedIds, []);
  assert.deepEqual(JSON.parse(result.stdout).resolvedIds, []);
  assert.match(prdChangeDiff(event), /保存/);
});

test('no-task apply rejects incomplete changes and historical aliases before creating output', async t => {
  const f = await fixture(t), changes = path.join(f.dir, 'changes.json'), candidate = path.join(f.dir, 'business.html');
  await fs.writeFile(f.input, write(source, create()));
  await fs.writeFile(candidate, source);
  const complete = { summary: '补充说明', details: ['记录保存反馈'] };
  for (const payload of [
    { details: complete.details }, { ...complete, details: [] },
    { ...complete, annotationUpdates: [{ kind: 'explanation', body: '点击保存', anchor: { kind: 'element', selector: '#save' } }] },
    { ...complete, resolvedAnnotationIds: [] }, { ...complete, selectedAnnotationIds: [] },
    { ...complete, resolvedIds: ['ann-unselected'] },
  ]) {
    await fs.writeFile(changes, JSON.stringify(payload));
    const result = run('apply', f.input, candidate, '--changes', changes, '--output', f.output);
    assert.notEqual(result.status, 0, JSON.stringify(payload));
    assert.ok(result.stderr.trim());
    await assert.rejects(fs.access(f.output));
  }
});

test('annotate imports in one command and reruns without duplicating notes or history', async t => {
  const f = await fixture(t), notes = path.join(f.dir, '说明.json');
  await fs.writeFile(notes, JSON.stringify([{ selector: '#save', body: '点击保存后，页面显示已保存。' }]));
  const result = run('annotate', f.input, '--annotations', notes, '--output', f.output);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout), original = await fs.readFile(f.output, 'utf8'), doc = parse(original);
  assert.equal(receipt.imported, true);
  assert.equal(receipt.unchanged, false);
  assert.equal(receipt.addedIds.length, 1);
  assert.equal(receipt.report.sourceFormat, 'plain-html');
  assert.equal(doc.uxVersion, 1);
  assert.equal(doc.annotations[receipt.addedIds[0]].createdBy.kind, 'agent');
  assert.equal(await fs.readFile(f.input, 'utf8'), source);
  const second = path.join(f.dir, '复查.ux.html');
  const repeat = run('annotate', f.output, '--annotations', notes, '--output', second);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(JSON.parse(repeat.stdout).unchanged, true);
  assert.equal(await fs.readFile(second, 'utf8'), original);
  assert.equal(run('annotate', f.output, '--annotations', notes, '--output', second).status, 1);
});

test('annotate validates the whole batch before writing or modifying any input', async t => {
  const f = await fixture(t), notes = path.join(f.dir, '说明.json');
  const text = JSON.stringify([{ selector: '#save', body: '保存反馈' }, { selector: '.missing', body: '不能猜测动态目标' }]);
  await fs.writeFile(notes, text);
  const result = run('annotate', f.input, '--annotations', notes, '--output', f.output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /匹配 0 个/);
  await assert.rejects(fs.access(f.output));
  assert.equal(await fs.readFile(f.input, 'utf8'), source);
  assert.equal(await fs.readFile(notes, 'utf8'), text);
  assert.notEqual(run('annotate', f.input, '--annotations', notes, '--output', notes).status, 0);
});

test('copied skill runs outside the repository without tooling or node_modules', async t => {
  const f = await fixture(t), portable = path.join(f.dir, 'portable-skill');
  await fs.cp(skill, portable, { recursive: true, filter: file => !path.relative(skill, file).split(path.sep).some(part => ['tooling', 'node_modules', '__pycache__'].includes(part)) });
  const notes = path.join(f.dir, 'notes.json');
  await fs.writeFile(notes, JSON.stringify([{ selector: '#save', id: 'ann-portable-save', body: '点击后显示已保存。' }]));
  const env = { ...process.env }; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [path.join(portable, 'scripts/uxdoc.mjs'), 'annotate', f.input, '--annotations', notes, '--output', f.output], { cwd: f.dir, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parse(await fs.readFile(f.output, 'utf8')).annotations['ann-portable-save'].body, '点击后显示已保存。');
  await assert.rejects(fs.access(path.join(portable, 'tooling')));
  await assert.rejects(fs.access(path.join(portable, 'node_modules')));
});
