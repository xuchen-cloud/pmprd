import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { create, createAnnotation, recordHuman, clone, parse, write, sourceOnly, checksum } from '../scripts/document.mjs';
const cli = fileURLToPath(new URL('../scripts/uxdoc.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const source = '<!doctype html><html><head><title>原型</title></head><body><button data-ux-anchor="save">保存</button></body></html>';
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ux-protocol 中文 '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let doc = create({ prd: '# 表单\n必填后提交。' }); const draft = clone(doc);
  draft.annotations['ann-request'] = createAnnotation({ id: 'ann-request', kind: 'change-request', body: '按钮改为提交', anchor: { kind: 'element', id: 'save', selector: '[data-ux-anchor="save"]' } });
  doc = recordHuman(doc, draft);
  const input = path.join(dir, '原稿.ux.html'), modified = path.join(dir, '修改稿.html'), output = path.join(dir, '输出.ux.html');
  const html = write(source, doc); await fs.writeFile(input, html);
  await fs.writeFile(modified, source.replace('保存</button>', '提交</button>'));
  const task = { format: 'ux-review-task', schemaVersion: 1, id: 'task-actual', documentId: doc.id, baseRevision: doc.revision, baseHash: createHash('sha256').update(html).digest('hex'), inputPath: input, outputPath: output, selectedIds: ['ann-request'], includePrdChanges: false, clearResolved: true, createdAt: new Date().toISOString() };
  const taskPath = path.join(dir, 'task.json'), changesPath = path.join(dir, 'changes.json');
  await fs.writeFile(taskPath, JSON.stringify(task));
  await fs.writeFile(changesPath, JSON.stringify({ summary: '调整按钮文案', details: ['保存改为提交'], resolvedIds: ['ann-request'] }));
  return { dir, doc, input, modified, output, task, taskPath, changesPath };
}

test('CLI applies an exact task, produces verifiable receipt, preserves original and rejects overwrite', async t => {
  const f = await setup(t), receipt = path.join(f.dir, 'result.json');
  const original = await fs.readFile(f.input, 'utf8');
  const applied = run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath, '--result', receipt);
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(await fs.readFile(receipt, 'utf8')), output = parse(await fs.readFile(f.output, 'utf8'));
  assert.equal(result.taskId, f.task.id);
  assert.equal(output.changes.at(-1).taskId, f.task.id);
  assert.equal(output.uxVersion, f.doc.uxVersion + 1);
  assert.equal(output.annotations['ann-request'], undefined);
  assert.equal(await fs.readFile(f.input, 'utf8'), original);
  assert.equal(run('validate', f.output).status, 0);
  const again = run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath);
  assert.notEqual(again.status, 0); assert.match(again.stderr, /已存在/);
});

test('CLI rejects stale task hashes, wider resolve scope, forbidden PRD edits and metadata tampering', async t => {
  const f = await setup(t);
  await fs.appendFile(f.input, '\n');
  assert.match(run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath).stderr, /指纹/);
  await fs.writeFile(f.input, write(source, f.doc));
  await fs.writeFile(f.changesPath, JSON.stringify({ summary: '调整', details: ['调整'], resolvedIds: ['ann-other'] }));
  assert.match(run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath).stderr, /未指定/);
  await fs.writeFile(f.changesPath, JSON.stringify({ summary: '调整', details: ['调整'], prd: '# 擅自更改' }));
  assert.match(run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath).stderr, /未包含 PRD/);
  await fs.writeFile(f.changesPath, JSON.stringify({ summary: '调整', details: ['调整'] }));
  const changedDoc = clone(f.doc); changedDoc.title = '篡改';
  await fs.writeFile(f.modified, write(source, changedDoc));
  assert.match(run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath).stderr, /元数据被改写/);
  await assert.rejects(fs.access(f.output));
});

test('extract then apply explanation-only changes leaves UX version unchanged', async t => {
  const f = await setup(t);
  const extracted = path.join(f.dir, 'extract.html');
  assert.equal(run('extract', f.input, '--output', extracted).status, 0);
  await fs.writeFile(f.changesPath, JSON.stringify({ summary: '补充说明', details: ['说明按钮逻辑'], annotationUpdates: [{ id: 'ann-explanation', kind: 'explanation', body: '必填后提交', anchor: { kind: 'element', selector: '[data-ux-anchor="save"]', id: 'save' } }] }));
  const result = run('apply', f.input, extracted, '--task', f.taskPath, '--changes', f.changesPath);
  assert.equal(result.status, 0, result.stderr);
  const doc = parse(await fs.readFile(f.output, 'utf8'));
  assert.equal(doc.uxVersion, f.doc.uxVersion);
  assert.equal(doc.annotations['ann-explanation'].createdBy.kind, 'agent');
  assert.equal(doc.annotations['ann-request'].status, 'open');
});

test('compact regenerated HTML records the delivered fingerprint and preserves raw JavaScript strings', async t => {
  const f = await setup(t);
  const original = await fs.readFile(f.input, 'utf8');
  const script = 'const literal = "</body><!-- ux-document:start -->"; const html = "<button>inner</button>";';
  const compact = '<!doctype html><html><head><title>原型</title></head><body><button data-ux-anchor="save">提交</button><script>' + script + '</script></body></html>';
  await fs.writeFile(f.modified, compact);
  const result = run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath);
  assert.equal(result.status, 0, result.stderr);
  const output = await fs.readFile(f.output, 'utf8'), doc = parse(output);
  const event = doc.changes.at(-1), deliveredSource = sourceOnly(output);
  assert.equal(event.diff.ux.before, checksum(sourceOnly(original)));
  assert.equal(event.diff.ux.after, checksum(deliveredSource));
  assert.equal(JSON.parse(result.stdout).outputHash, undefined);
  assert.ok(deliveredSource.includes('<script>' + script + '</script>'));
  assert.equal(doc.uxVersion, f.doc.uxVersion + 1);
  assert.equal(await fs.readFile(f.input, 'utf8'), original);
  assert.equal(await fs.readFile(f.modified, 'utf8'), compact);
});

test('unknown flags and missing values fail without writing output', async t => {
  const f = await setup(t);
  assert.match(run('apply', f.input, f.modified, '--unknown', 'x').stderr, /未知参数/);
  assert.match(run('apply', f.input, f.modified, '--summary').stderr, /缺少参数值/);
  await assert.rejects(fs.access(f.output));
});

test('prepare emits scoped working files, leaves input intact, and apply preserves unselected data', async t => {
  const f = await setup(t), draft = clone(f.doc);
  draft.annotations['ann-unselected'] = createAnnotation({ id: 'ann-unselected', kind: 'change-request', body: 'UNSELECTED_PAYLOAD', anchor: { kind: 'element', selector: '#other' } });
  const before = recordHuman(f.doc, draft), input = write(source, before);
  await fs.writeFile(f.input, input);
  const task = { ...f.task, baseRevision: before.revision, baseHash: createHash('sha256').update(input).digest('hex') };
  await fs.writeFile(f.taskPath, JSON.stringify(task));
  const business = path.join(f.dir, 'business.html'), contextPath = path.join(f.dir, 'context.json');
  const prepared = run('prepare', f.input, '--task', f.taskPath, '--output', business, '--context', contextPath);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal((await fs.readFile(business, 'utf8')).trim(), sourceOnly(input));
  const contextText = await fs.readFile(contextPath, 'utf8'), context = JSON.parse(contextText);
  assert.deepEqual(context.selectedRequests.map(a => a.id), ['ann-request']);
  assert.ok(!contextText.includes('UNSELECTED_PAYLOAD'));
  assert.equal(context.prd, undefined);
  assert.equal(context.explanations, undefined);
  assert.equal(context.humanChangesSinceAgent, undefined);
  assert.equal(await fs.readFile(f.input, 'utf8'), input);
  await fs.writeFile(business, (await fs.readFile(business, 'utf8')).replace('保存</button>', '提交</button>'));
  const applied = run('apply', f.input, business, '--task', f.taskPath, '--changes', f.changesPath);
  assert.equal(applied.status, 0, applied.stderr);
  const result = parse(await fs.readFile(f.output, 'utf8'));
  assert.deepEqual(result.annotations['ann-unselected'], before.annotations['ann-unselected']);
  assert.deepEqual(result.changes.slice(0, -1), before.changes);
  assert.equal(result.prd, before.prd);
  assert.equal(await fs.readFile(f.input, 'utf8'), input);
});

test('prepare validates before writing and never overwrites either output', async t => {
  const f = await setup(t), business = path.join(f.dir, 'business.html'), context = path.join(f.dir, 'context.json');
  const prepare = () => run('prepare', f.input, '--task', f.taskPath, '--output', business, '--context', context);
  await fs.appendFile(f.input, '\n');
  assert.match(prepare().stderr, /指纹/);
  await assert.rejects(fs.access(business)); await assert.rejects(fs.access(context));
  await fs.writeFile(f.input, write(source, f.doc));
  await fs.writeFile(context, 'keep existing');
  assert.match(prepare().stderr, /已存在/);
  await assert.rejects(fs.access(business)); assert.equal(await fs.readFile(context, 'utf8'), 'keep existing');
  await fs.unlink(context);
  await fs.writeFile(f.taskPath, JSON.stringify({ ...f.task, selectedIds: ['ann-unknown'] }));
  assert.match(prepare().stderr, /已确认的修改意见/);
  await assert.rejects(fs.access(business)); await assert.rejects(fs.access(context));
  assert.equal(run('--help').status, 0);
});

test('task PRD changes use atomic prdOps and reject full text or ambiguous replacements', async t => {
  const f = await setup(t), task = { ...f.task, includePrdChanges: true };
  await fs.writeFile(f.taskPath, JSON.stringify(task));
  const change = { summary: '完善提交要求', details: ['补充提交反馈'], resolvedIds: ['ann-request'] };
  await fs.writeFile(f.changesPath, JSON.stringify({ ...change, prd: '# 全篇重写' }));
  assert.match(run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath).stderr, /prdOps/);
  await fs.writeFile(f.changesPath, JSON.stringify({ ...change, prdOps: [{ find: '必填后提交。', replace: '必填后提交并提示成功。' }, { find: '不存在的原文', replace: '' }] }));
  assert.match(run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath).stderr, /未命中/);
  await assert.rejects(fs.access(f.output));
  assert.equal(parse(await fs.readFile(f.input, 'utf8')).prd, f.doc.prd);
  await fs.writeFile(f.changesPath, JSON.stringify({ ...change, prdOps: [{ find: '必填后提交。', replace: '必填后提交并提示成功。' }] }));
  const result = run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath);
  assert.equal(result.status, 0, result.stderr);
  const next = parse(await fs.readFile(f.output, 'utf8'));
  assert.equal(next.prd, '# 表单\n必填后提交并提示成功。');
  const event = next.changes.at(-1), patch = event.patch.find(p => p.path === '/prd');
  assert.equal(patch.op, 'text'); assert.equal(patch.before, undefined); assert.equal(patch.value, undefined);
  assert.equal(event.diff.prd, undefined); assert.equal(JSON.parse(result.stdout).outputHash, undefined);
});

test('PRD read permission does not grant PRD edits and read never defaults to full content', async t => {
  const f = await setup(t);
  assert.notEqual(run('read', f.input, '--kind', 'prd').status, 0);
  const result = run('read', f.input, '--kind', 'prd', '--task', f.taskPath, '--search', '必填');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).matches[0].text, '必填后提交。');
  const offline = run('read', f.input, '--kind', 'prd', '--start-line', '2', '--end-line', '2');
  assert.equal(offline.status, 0, offline.stderr);
  assert.equal(JSON.parse(offline.stdout).text, '必填后提交。');
  assert.notEqual(run('read', f.input, '--kind', 'prd', '--start-line', 'NaN').status, 0);
  await fs.writeFile(f.changesPath, JSON.stringify({ summary: '改需求', details: ['改需求'], prdOps: [{ find: '必填', replace: '选填' }] }));
  assert.match(run('apply', f.input, f.modified, '--task', f.taskPath, '--changes', f.changesPath).stderr, /未包含 PRD/);
  assert.notEqual(run('read', f.input, '--kind', 'prd-diff', '--task', f.taskPath).status, 0);
  await assert.rejects(fs.access(f.output));
});
