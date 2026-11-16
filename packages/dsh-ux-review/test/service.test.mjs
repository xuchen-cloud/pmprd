import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ReviewService, sha256 } from '../src/service.mjs';
import { create, createAnnotation, clone, recordHuman, recordAgent, sourceOnly, write, parse, patchBetween, metadataBlock, serializeJSON } from '../../../skills/ux-prototype/scripts/document.mjs';
import { MAX_DOCUMENT_BYTES } from '../src/document-input.mjs';
const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../../skills/ux-prototype/scripts/uxdoc.mjs', import.meta.url));

async function fixture(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ux-host-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const writes = [], messages = []; let idle;
  const fsAdapter = {
    async resolve(file, opts = {}) {
      const absolute = path.resolve(opts.cwd || cwd, file);
      let real;
      try { real = await fs.realpath(absolute); } catch { real = path.join(await fs.realpath(path.dirname(absolute)), path.basename(absolute)); }
      return { targetKey: real, displayPath: absolute };
    },
    processPath: target => target.targetKey,
    contains: (root, file) => { const r = path.relative(root.targetKey, file.targetKey); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); },
    async stat(target) { try { const s = await fs.stat(target.targetKey); return { type: s.isFile() ? 'file' : 'directory', size: s.size, version: s.isFile() ? sha256(await fs.readFile(target.targetKey)) : 'dir' }; } catch (e) { if (e.code === 'ENOENT') return; throw e; } },
    readText: target => fs.readFile(target.targetKey, 'utf8'),
    async writeText(target, content, expected, signal, policy) {
      signal?.throwIfAborted();
      assert.equal(policy.workspaceRoot, cwd);
      if (policy.mode === 'read-only') throw new Error('Sandbox read-only');
      const current = await this.stat(target);
      if (expected.kind === 'createIfAbsent' && current) throw Object.assign(new Error('File exists'), { code: 'FS_NOT_OBSERVED' });
      if (expected.kind === 'replaceIfVersion' && expected.version !== current?.version) throw Object.assign(new Error('FS_STALE_VERSION'), { code: 'FS_STALE_VERSION' });
      await fs.writeFile(target.targetKey, content, { flag: expected.kind === 'createIfAbsent' ? 'wx' : 'w' });
      writes.push({ path: target.targetKey, expected, policy });
      return { version: sha256(content), before: null, after: content };
    },
  };
  const agent = { session: { id: 'test-session', header: { cwd } }, followup: message => messages.push(message), whenIdle: () => new Promise(resolve => { idle = resolve; }) };
  const dependencies = { fs: fsAdapter, resolveAgent: async id => ({ agent: id === 'test-session' ? agent : { ...agent, session: { ...agent.session, id } } }), policyFor: () => ({ mode: 'workspace-write', workspaceRoot: cwd }), makeMessage: prompt => ({ prompt }), skillsPath: path.join(cwd, 'skills') };
  const service = new ReviewService(dependencies);
  const doc = create({ title: 'Review', prd: '# PRD\nButton submits' });
  const after = clone(doc), request = createAnnotation({ kind: 'change-request', body: '改成确认', anchor: { kind: 'element', selector: '#submit' } }), explanation = createAnnotation({ body: '点击提交', anchor: { kind: 'element', selector: '#submit' } });
  after.annotations[request.id] = request; after.annotations[explanation.id] = explanation;
  const saved = recordHuman(doc, after, '添加评审批注');
  const file = path.join(await fs.realpath(cwd), 'product.ux.html'), html = write('<html><body><button id="submit">提交</button></body></html>', saved);
  await fs.writeFile(file, html);
  const args = { sessionId: agent.session.id, path: file }, exec = { agent, signal: new AbortController().signal };
  async function submit(clearResolved = false, createNewVersion) {
    const snapshot = await service.read(args);
    const result = await service.submit({ ...args, expectedVersion: snapshot.version, selectedIds: [request.id], includePrdChanges: false, clearResolved, ...(createNewVersion === undefined ? {} : { createNewVersion }) });
    return { result, manifest: service.tasks.get(result.id) };
  }
  async function output(task, options = {}) {
    const original = await fs.readFile(task.inputPath, 'utf8'), before = parse(original), uxBefore = sourceOnly(original), uxAfter = uxBefore.replace('>提交<', '>确认<');
    const next = recordAgent(before, { summary: '确认按钮文案', details: ['按钮改成确认'], selectedIds: task.selectedIds, resolvedIds: task.selectedIds, clearResolved: task.clearResolved, taskId: task.id, uxBefore, uxAfter, ...options });
    await fs.writeFile(task.outputPath, write(uxAfter, next));
    return next;
  }
  return { cwd, file, html, service, dependencies, agent, args, exec, submit, output, request, explanation, writes, messages, idle: () => idle() };
}

test('guarded saves preserve history, detect stale files, and forward sandbox policy', async t => {
  const f = await fixture(t), snapshot = await f.service.read(f.args), before = parse(snapshot.html), next = clone(before);
  next.prd += '\n新增要求'; const changed = recordHuman(before, next, '修改需求');
  const saved = await f.service.save({ ...f.args, expectedVersion: snapshot.version, html: write(snapshot.html, changed) });
  assert.notEqual(saved.version, snapshot.version);
  await assert.rejects(f.service.save({ ...f.args, expectedVersion: snapshot.version, html: snapshot.html }), /其他编辑器/);
  assert.equal(f.writes.at(-1).expected.kind, 'replaceIfVersion');
  assert.equal(parse(await fs.readFile(f.file, 'utf8')).prd, next.prd);
});

test('workspace containment rejects traversal and escaping symlinks', async t => {
  const f = await fixture(t), outside = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'secret.html'), 'secret');
  await fs.symlink(outside, path.join(f.cwd, 'escape'));
  await assert.rejects(f.service.read({ ...f.args, path: path.join(outside, 'secret.html') }), /工作目录/);
  await assert.rejects(f.service.read({ ...f.args, path: 'escape/secret.html' }), /工作目录/);
});

test('metadata-only changes do not invalidate saves or submissions while writes retain filesystem guards', async t => {
  const f = await fixture(t), adapter = f.dependencies.fs, originalStat = adapter.stat;
  let metadata = 1;
  adapter.stat = async target => {
    const stat = await originalStat.call(adapter, target);
    return stat && {...stat, version: `${metadata}:${stat.version}`};
  };
  const snapshot = await f.service.read(f.args), before = parse(snapshot.html);
  metadata++;
  const changed = recordHuman(before, {...before, prd: before.prd + '\n图片说明'});
  const saved = await f.service.save({...f.args, expectedVersion: snapshot.version, html: write(snapshot.html, changed)});
  assert.equal(saved.version, sha256(saved.html));
  assert.ok(f.writes.at(-1).expected.version.startsWith('2:'));
  metadata++;
  await f.service.submit({...f.args, expectedVersion:saved.version, selectedIds:[f.request.id], includePrdChanges:false, clearResolved:false, destination:'external'});
  assert.equal(f.messages.length, 0);
});

test('a filesystem change between save validation and write still rejects replacement', async t => {
  const f = await fixture(t), snapshot = await f.service.read(f.args), adapter = f.dependencies.fs;
  const originalWrite = adapter.writeText;
  adapter.writeText = async function(target, ...args) {
    if (target.targetKey === f.file) await fs.appendFile(f.file, '\n<!-- external change -->');
    return originalWrite.call(this, target, ...args);
  };
  const before = parse(snapshot.html), changed = recordHuman(before, {...before, prd:'新增图片'});
  await assert.rejects(f.service.save({...f.args, expectedVersion:snapshot.version, html:write(snapshot.html,changed)}), /FS_STALE_VERSION/);
  assert.ok((await fs.readFile(f.file,'utf8')).endsWith('<!-- external change -->'));
});

test('submission snapshots source, persists manifest, rejects explanations, and deduplicates', async t => {
  const f = await fixture(t), { manifest, result } = await f.submit();
  assert.equal(f.messages.length, 1);
  assert.equal(manifest.baseHash, sha256(f.html));
  assert.equal(await fs.readFile(manifest.inputPath, 'utf8'), f.html);
  assert.notEqual(manifest.inputPath, f.file);
  assert.equal((await f.submit()).result.id, result.id);
  assert.equal(f.messages.length, 1);
  await assert.rejects(f.submit(false, true), /正在执行/);
  assert.equal(f.messages.length, 1);
  await assert.rejects(f.submit(false, 'false'), /新版本文件选项/);
  await assert.rejects(f.service.submit({ ...f.args, expectedVersion: sha256(f.html), selectedIds: [f.explanation.id], includePrdChanges: false, clearResolved: true }), /不是待处理/);
  const restored = new ReviewService(f.dependencies);
  assert.equal((await restored.task({ sessionId: 'test-session', id: result.id })).status, 'running');
  await assert.rejects(restored.task({ sessionId: 'another-session', id: result.id }), /不属于/);
});

test('explicit completion checks identity, history, source fingerprints and selected scope', async t => {
  const f = await fixture(t), { manifest } = await f.submit(true, true);
  await f.output(manifest);
  const result = await f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec);
  assert.equal(result.status, 'completed');
  assert.equal(result.outputPath, manifest.outputPath);
  assert.equal(result.delivery, 'new-version');
  const output = parse(await fs.readFile(manifest.outputPath, 'utf8'));
  assert.equal(output.annotations[f.request.id], undefined);
  assert.equal(output.annotations[f.explanation.id].body, '点击提交');
  assert.equal(await fs.readFile(f.file, 'utf8'), f.html);
  const restored = new ReviewService(f.dependencies);
  assert.equal((await restored.task({ sessionId: 'test-session', id: manifest.id })).status, 'completed');
});

test('submission prepares editable business source and scoped context before waking Agent', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  assert.equal(await fs.readFile(manifest.businessPath, 'utf8'), sourceOnly(f.html));
  const context = JSON.parse(await fs.readFile(manifest.contextPath, 'utf8'));
  assert.equal(context.format, 'ux-review-context');
  assert.equal(context.task.id, manifest.id);
  assert.equal(context.prdPolicy.mode, 'read-only');
  assert.deepEqual(context.selectedRequests.map(a => a.id), [f.request.id]);
  assert.equal(context.explanations, undefined);
  assert.equal(context.prd, undefined);
  assert.equal(context.humanChangesSinceAgent, undefined);
  assert.equal(context.selectedRequests[0].targetSource.html, '<button id="submit">提交</button>');
  assert.equal(context.changes, undefined);
  assert.ok(f.messages[0].prompt.includes(manifest.businessPath));
  assert.equal(f.messages[0].prompt, manifest.prompt);
  assert.ok(f.messages[0].prompt.includes(f.request.body));
  assert.ok(f.messages[0].prompt.includes('<button id="submit">提交</button>'));
  assert.ok(!f.messages[0].prompt.includes(manifest.contextPath));
  assert.ok(!f.messages[0].prompt.includes(path.join('opentiny-ux', 'SKILL.md')));
  for (const file of [manifest.businessPath, manifest.contextPath]) {
    assert.equal(f.writes.find(w => w.path === file).expected.kind, 'createIfAbsent');
  }
});

test('external preparation returns the same portable instruction without dispatching or watching DSH', async t => {
  const f = await fixture(t), snapshot = await f.service.read(f.args);
  f.agent.whenIdle = () => { throw Error('External work must not watch DSH idleness'); };
  const args = { ...f.args, expectedVersion: snapshot.version, selectedIds: [f.request.id], includePrdChanges: false, clearResolved: false, destination: 'external' };
  const task = await f.service.submit(args), manifest = f.service.tasks.get(task.id);
  assert.equal(task.destination, 'external');
  assert.equal(task.prompt, manifest.prompt);
  assert.ok(task.prompt.includes(f.request.body));
  assert.ok(task.prompt.includes(manifest.businessPath));
  assert.ok(task.prompt.includes(' finish '));
  assert.ok(!task.prompt.includes('ux_review_complete'));
  assert.equal(f.messages.length, 0);
  assert.equal((await f.service.submit(args)).id, task.id);
  const restored = new ReviewService(f.dependencies);
  assert.equal((await restored.read(f.args)).activeTask.id, task.id);
  await assert.rejects(restored.save({ ...f.args, html: snapshot.html, expectedVersion: snapshot.version }), /正在修改/);
  await assert.rejects(f.service.submit({ ...args, destination: 'dsh' }), /正在执行/);
  const cancelled = await f.service.cancel({ sessionId: f.args.sessionId, id: task.id });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await restored.read(f.args)).activeTask, null);
  assert.equal(await fs.readFile(manifest.inputPath, 'utf8'), snapshot.html);
  await f.output(manifest);
  await assert.rejects(f.service.complete({ taskId: task.id, outputPath: manifest.outputPath }, f.exec), /已结束/);
  assert.equal(await fs.readFile(f.file, 'utf8'), snapshot.html);
});

test('portable finish receipt is adopted on polling and does not overwrite an already delivered file', async t => {
  const f = await fixture(t), snapshot = await f.service.read(f.args);
  const result = await f.service.submit({ ...f.args, expectedVersion: snapshot.version, selectedIds: [f.request.id], includePrdChanges: false, clearResolved: false, destination: 'external' });
  const manifest = f.service.tasks.get(result.id);
  await f.output(manifest);
  const candidate = await fs.readFile(manifest.outputPath, 'utf8');
  await fs.writeFile(f.file, candidate);
  await fs.writeFile(f.service.artifact(await f.service.scope('test-session'), manifest.id, 'finish.json'), JSON.stringify({ taskId: manifest.id, outputPath: manifest.outputPath }));
  const done = await f.service.task({ sessionId: 'test-session', id: manifest.id });
  assert.equal(done.status, 'completed');
  assert.equal(done.outputPath, f.file);
  assert.equal(done.delivery, 'updated-current');
  assert.equal(f.writes.filter(w => w.path === f.file).length, 0);
  assert.equal((await f.service.read(f.args)).activeTask, null);
  assert.deepEqual(await f.service.task({ sessionId: 'test-session', id: manifest.id }), done);
  assert.equal(f.messages.length, 0);
});

test('DSH idleness adopts a portable finish receipt before marking a task incomplete', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  await f.output(manifest);
  await fs.writeFile(f.service.artifact(await f.service.scope('test-session'), manifest.id, 'finish.json'), JSON.stringify({ taskId: manifest.id, outputPath: manifest.outputPath }));
  f.idle(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await f.service.task({ sessionId: 'test-session', id: manifest.id })).status, 'completed');
  assert.equal(await fs.readFile(f.file, 'utf8'), await fs.readFile(manifest.outputPath, 'utf8'));
});

for (const destination of ['dsh', 'external']) test(`${destination} uses the same CLI finish and restores the completed document after reopening`, async t => {
  const f = await fixture(t), snapshot = await f.service.read(f.args);
  const result = await f.service.submit({ ...f.args, expectedVersion: snapshot.version, selectedIds: [f.request.id], includePrdChanges: false, clearResolved: false, destination });
  const manifest = f.service.tasks.get(result.id);
  assert.equal(f.messages.length, destination === 'dsh' ? 1 : 0);
  if (f.messages.length) assert.equal(f.messages[0].prompt, result.prompt);
  await fs.writeFile(manifest.businessPath, sourceOnly(snapshot.html).replace('>提交<', '>确认<'));
  const { stdout } = await run(process.execPath, [cli, 'finish', manifest.businessPath, '--summary', '确认按钮文案']);
  assert.equal(JSON.parse(stdout).outputPath, f.file);
  const restored = new ReviewService(f.dependencies);
  const opened = await restored.read({ ...f.args, sessionId: 'another-session' });
  assert.equal(opened.activeTask, null);
  assert.match(sourceOnly(opened.html), />确认</);
  const done = await restored.task({ sessionId: 'test-session', id: result.id });
  assert.equal(done.status, 'completed');
  assert.equal(parse(opened.html).revision, parse(snapshot.html).revision + 1);
  assert.equal(f.writes.filter(w => w.path === f.file).length, 0);
  const cancelled = destination === 'external' ? await restored.cancel({ sessionId: 'test-session', id: result.id }) : done;
  assert.equal(cancelled.status, 'completed');
});

test('on-demand context is task-owned, snapshot-checked and narrowly read', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  const result = await f.service.context({ taskId: manifest.id, query: { kind: 'prd', search: 'Button' } }, f.exec);
  assert.deepEqual(result.matches.map(match => match.text), ['Button submits']);
  assert.equal(result.explanations, undefined);
  const explanation = await f.service.context({ taskId: manifest.id, query: { kind: 'explanations', selector: '#submit' } }, f.exec);
  assert.deepEqual(explanation.explanations.map(a => a.id), [f.explanation.id]);
  await assert.rejects(f.service.context({ taskId: manifest.id, query: { kind: 'prd' } }, f.exec), /不能默认读取全文/);
  const otherExec = { ...f.exec, agent: { session: { id: 'other-session' } } };
  await assert.rejects(f.service.context({ taskId: manifest.id, query: { kind: 'prd', search: 'Button' } }, otherExec), /不属于/);
  await fs.writeFile(manifest.inputPath, f.html + '\n');
  await assert.rejects(f.service.context({ taskId: manifest.id, query: { kind: 'prd', search: 'Button' } }, f.exec), /输入快照/);
});

test('active document lock survives host restart and blocks edits and duplicate variants', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  const restored = new ReviewService(f.dependencies);
  const read = await restored.read(f.args);
  assert.equal(read.activeTask.id, manifest.id);
  assert.equal(read.activeTask.ownedBySession, true);
  assert.equal((await restored.read({ ...f.args, sessionId: 'another-session' })).activeTask.ownedBySession, false);
  await assert.rejects(restored.save({ ...f.args, expectedVersion: read.version, html: read.html }), /AI 正在修改/);
  const submit = { ...f.args, expectedVersion: read.version, selectedIds: [f.request.id], includePrdChanges: false, clearResolved: false };
  assert.equal((await restored.submit(submit)).id, manifest.id);
  await assert.rejects(restored.submit({ ...submit, createNewVersion: true }), /正在执行/);
  await assert.rejects(restored.submit({ ...submit, sessionId: 'another-session' }), /正在执行/);
  assert.equal(f.messages.length, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.html);
});

test('terminal statuses unlock persisted document locks and allow the next task', async t => {
  const f = await fixture(t), first = await f.submit();
  await f.service.fail({ taskId: first.manifest.id, reason: '用户调整意见后重试' }, f.exec);
  const restored = new ReviewService(f.dependencies);
  assert.equal((await restored.read(f.args)).activeTask, null);
  const second = await f.submit();
  assert.notEqual(second.manifest.id, first.manifest.id);
  assert.equal((await restored.read(f.args)).activeTask.id, second.manifest.id);
  await f.output(second.manifest);
  assert.equal((await f.service.complete({ taskId: second.manifest.id, outputPath: second.manifest.outputPath }, f.exec)).status, 'completed');
  assert.equal((await restored.read(f.args)).activeTask, null);
});

test('restored active tasks observe agent idleness so abandoned work does not stay locked', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  f.service.disposed = true;
  const restored = new ReviewService(f.dependencies);
  assert.equal((await restored.read(f.args)).activeTask.id, manifest.id);
  f.idle(); await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal((await restored.task({ sessionId: 'test-session', id: manifest.id })).status, 'needs-attention');
  assert.equal((await restored.read(f.args)).activeTask, null);
});

test('missing-result attention unlocks; an older resumed task cannot write over a new running task', async t => {
  const f = await fixture(t), old = await f.submit();
  f.idle(); await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal((await f.service.read(f.args)).activeTask, null);
  const next = await f.submit();
  await f.output(old.manifest);
  const result = await f.service.complete({ taskId: old.manifest.id, outputPath: old.manifest.outputPath }, f.exec);
  assert.equal(result.delivery, 'conflict');
  assert.equal((await f.service.read(f.args)).activeTask.id, next.manifest.id);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.html);
});

test('idle without result is attention, not success; later completion can recover', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  f.idle(); await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal((await f.service.task({ sessionId: 'test-session', id: manifest.id })).status, 'needs-attention');
  await f.output(manifest);
  assert.equal((await f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec)).status, 'completed');
});

test('completion rejects unrelated output, altered snapshot, and unauthorized deletion', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  await f.output(manifest);
  await assert.rejects(f.service.complete({ taskId: manifest.id, outputPath: f.file }, f.exec), /结果路径/);
  const good = await fs.readFile(manifest.outputPath, 'utf8'), doc = parse(good);
  delete doc.annotations[f.explanation.id];
  doc.changes.at(-1).patch = patchBetween(parse(f.html), doc);
  await fs.writeFile(manifest.outputPath, write(good, doc));
  await assert.rejects(f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec), /未授权标注/);
  await fs.writeFile(manifest.outputPath, good.replace('>确认<', '>偷偷改变<'));
  await assert.rejects(f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec), /实际业务源码/);
  await fs.writeFile(manifest.inputPath, f.html + '\n');
  await assert.rejects(f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec), /输入快照/);
  assert.notEqual(manifest.status, 'completed');
});

test('read-only policy blocks writes and task submission before waking Agent', async t => {
  const f = await fixture(t), service = new ReviewService({ ...f.dependencies, policyFor: () => ({ mode: 'read-only', workspaceRoot: f.cwd }) });
  const snapshot = await service.read(f.args);
  await assert.rejects(service.save({ ...f.args, html: snapshot.html, expectedVersion: snapshot.version }), /只读/);
  await assert.rejects(service.submit({ ...f.args, expectedVersion: snapshot.version, selectedIds: [f.request.id], includePrdChanges: false, clearResolved: false }), /只读/);
  assert.equal(f.messages.length, 0);
});

test('default completion updates current file once, retains full backup and is idempotent', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  assert.equal(manifest.createNewVersion, false);
  assert.equal(manifest.baseFileVersion, sha256(f.html));
  assert.ok(path.basename(manifest.outputPath).startsWith('.ux-review-'));
  assert.ok(manifest.outputPath.endsWith('.result.ux.html'));
  const candidate = await f.output(manifest);
  const result = await f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec);
  assert.equal(result.outputPath, f.file);
  assert.equal(result.delivery, 'updated-current');
  assert.equal(result.backupPath, manifest.inputPath);
  assert.deepEqual(parse(await fs.readFile(f.file, 'utf8')), candidate);
  assert.equal(await fs.readFile(result.backupPath, 'utf8'), f.html);
  assert.equal(f.writes.filter(w => w.path === f.file).length, 1);
  const count = f.writes.length;
  await fs.unlink(manifest.outputPath);
  assert.deepEqual(await f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec), result);
  assert.equal(f.writes.length, count);
  const restored = new ReviewService(f.dependencies);
  assert.deepEqual(await restored.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec), result);
  assert.equal(f.writes.length, count);
});

test('changed originals keep the validated candidate and report a conflict without overwrite', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  await f.output(manifest);
  const before = parse(f.html), changed = clone(before); changed.prd += '\n同事的新要求';
  const external = write(f.html, recordHuman(before, changed, '同事修改需求'));
  await fs.writeFile(f.file, external);
  const result = await f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec);
  assert.equal(result.status, 'needs-attention');
  assert.equal(result.delivery, 'conflict');
  assert.equal(result.outputPath, manifest.outputPath);
  assert.equal(result.backupPath, manifest.inputPath);
  assert.equal(await fs.readFile(f.file, 'utf8'), external);
  assert.equal(await fs.readFile(manifest.inputPath, 'utf8'), f.html);
  assert.equal(f.writes.filter(w => w.path === f.file).length, 0);
  assert.ok(await fs.readFile(result.outputPath, 'utf8'));
});

test('conditional write conflicts are reported, while ordinary write errors still reject', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  await f.output(manifest);
  const originalWrite = f.dependencies.fs.writeText;
  f.dependencies.fs.writeText = async function (target, content, ...rest) {
    if (target.targetKey === f.file) throw Object.assign(new Error('Disk full'), { code: 'FS_IO_ERROR' });
    return originalWrite.call(this, target, content, ...rest);
  };
  await assert.rejects(f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec), /Disk full/);
  assert.equal((await f.service.task({ sessionId: 'test-session', id: manifest.id })).delivery, undefined);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.html);
  f.dependencies.fs.writeText = async function (target, content, ...rest) {
    if (target.targetKey === f.file) await fs.writeFile(f.file, 'external write between check and replace');
    return originalWrite.call(this, target, content, ...rest);
  };
  const result = await f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec);
  assert.equal(result.status, 'needs-attention'); assert.equal(result.delivery, 'conflict');
  assert.equal(await fs.readFile(f.file, 'utf8'), 'external write between check and replace');
  assert.equal(f.writes.filter(w => w.path === f.file).length, 0);
});

test('a filesystem version change conflicts even when original bytes match the baseline', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  await f.output(manifest);
  const originalStat = f.dependencies.fs.stat;
  f.dependencies.fs.stat = async function (target, ...rest) {
    const stat = await originalStat.call(this, target, ...rest);
    return target.targetKey === f.file && stat ? { ...stat, version: 'externally-replaced-same-content' } : stat;
  };
  const result = await f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec);
  assert.equal(result.delivery, 'conflict');
  assert.equal(await fs.readFile(f.file, 'utf8'), f.html);
  assert.equal(f.writes.filter(w => w.path === f.file).length, 0);
});

test('legacy persisted tasks without the option continue publishing a new file', async t => {
  const f = await fixture(t), { manifest } = await f.submit(false, true);
  delete manifest.createNewVersion; delete manifest.baseFileVersion;
  const scope = await f.service.scope('test-session'); await f.service.persist(scope, manifest);
  await f.output(manifest);
  const restored = new ReviewService(f.dependencies);
  const result = await restored.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec);
  assert.equal(result.outputPath, manifest.outputPath); assert.equal(result.delivery, 'new-version');
  assert.equal(await fs.readFile(f.file, 'utf8'), f.html);
});

test('a failed completed-state write recovers after restart without a second file overwrite', async t => {
  const f = await fixture(t), { manifest } = await f.submit();
  await f.output(manifest);
  const originalWrite = f.dependencies.fs.writeText;
  f.dependencies.fs.writeText = async function (target, content, ...rest) {
    if (target.targetKey.endsWith('.state.json') && JSON.parse(content).status === 'completed') throw new Error('Disk full');
    return originalWrite.call(this, target, content, ...rest);
  };
  await assert.rejects(f.service.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec), /Disk full/);
  assert.equal((await f.service.task({ sessionId: 'test-session', id: manifest.id })).status, 'running');
  assert.equal(f.writes.filter(w => w.path === f.file).length, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), await fs.readFile(manifest.outputPath, 'utf8'));
  f.dependencies.fs.writeText = originalWrite;
  const restored = new ReviewService(f.dependencies);
  const result = await restored.complete({ taskId: manifest.id, outputPath: manifest.outputPath }, f.exec);
  assert.equal(result.status, 'completed'); assert.equal(result.delivery, 'updated-current');
  assert.equal(result.outputPath, f.file);
  assert.equal(f.writes.filter(w => w.path === f.file).length, 1);
});

test('imports canonical and offline design documents byte-for-byte without starting Agent work', async t => {
  const f = await fixture(t), canonical = '\ufeff  ' + f.html.replace(/\n/g, '\r\n') + '\r\n  ';
  const result = await f.service.importFile({ sessionId: 'test-session', name: '中文 空格.html', html: canonical, allowConvert: false });
  assert.equal(result.name, '中文 空格.ux.html');
  assert.equal(result.html, canonical);
  assert.equal(await fs.readFile(result.path, 'utf8'), canonical);
  assert.deepEqual(parse(result.html), parse(f.html));
  assert.deepEqual(await f.service.read({ sessionId: 'test-session', path: result.path }), { ...result, activeTask: null });
  const offline = `<html><body><script id="ux-prototype-source" type="application/json">${serializeJSON(sourceOnly(f.html))}</script>${metadataBlock(parse(f.html))}</body></html>`;
  const exported = await f.service.importFile({ sessionId: 'test-session', name: 'received.review.html', html: offline, allowConvert: false });
  assert.equal(exported.name, 'received.ux.html');
  assert.equal(await fs.readFile(exported.path, 'utf8'), offline);
  assert.equal(f.messages.length, 0);
  assert.equal(f.service.tasks.size, 0);
  assert.ok(f.writes.every(w => w.expected.kind === 'createIfAbsent'));
});

test('plain and legacy HTML need explicit conversion even with a .ux.html filename', async t => {
  const f = await fixture(t), html = '<html><head><title>普通原型</title></head><body>正文</body></html>';
  const args = { sessionId: 'test-session', name: 'plain.ux.html', html };
  await assert.rejects(f.service.importFile(args), /确认导入/);
  await assert.rejects(f.service.importFile({ ...args, allowConvert: false }), /确认导入/);
  await assert.rejects(f.service.importFile({ ...args, allowConvert: 'true' }), /确认选项/);
  assert.equal(f.writes.length, 0);
  const result = await f.service.importFile({ ...args, allowConvert: true });
  assert.equal(parse(result.html).title, '普通原型');
  assert.equal(result.report.sourceFormat, 'plain-html');
  const legacy = html.replace('</body>', '<script id="ux-requirements" type="application/json">{"title":"旧需求","prd":"<p>保留 PRD</p>","changes":[{"version":2}],"extra":"扩展"}</script></body>');
  await assert.rejects(f.service.importFile({ ...args, html: legacy, allowConvert: false }), /确认导入/);
  const converted = await f.service.importFile({ ...args, html: legacy, allowConvert: true });
  assert.equal(converted.report.sourceFormat, 'ux-requirements');
  assert.equal(parse(converted.html).prd, '保留 PRD');
  assert.deepEqual(parse(converted.html).legacyHistory, [{ version: 2 }]);
  assert.equal(converted.report.unmigrated[0].field, 'ux-requirements.extra');
  assert.equal(f.messages.length, 0);
});

test('imports sanitize Windows filenames and increment conflicts without overwriting', async t => {
  const f = await fixture(t), args = { sessionId: 'test-session', name: 'C:\\received\\CON.html', html: f.html, allowConvert: false };
  const [first, second] = await Promise.all([f.service.importFile(args), f.service.importFile(args)]);
  assert.deepEqual([first.name, second.name].sort(), ['_CON (2).ux.html', '_CON.ux.html']);
  assert.equal(path.dirname(first.path), path.dirname(f.file));
  const collision = await f.service.importFile({ ...args, name: 'product.ux.html' });
  assert.equal(collision.name, 'product (2).ux.html');
  assert.equal(await fs.readFile(f.file, 'utf8'), f.html);
  assert.equal(f.writes.filter(w => w.path === f.file).length, 0);
});

test('a concurrent creator wins the name and import retries without overwriting it', async t => {
  const f = await fixture(t), originalWrite = f.dependencies.fs.writeText;
  let raced = false;
  f.dependencies.fs.writeText = async function (target, content, ...rest) {
    if (!raced) { raced = true; await fs.writeFile(target.targetKey, 'concurrent content'); }
    return originalWrite.call(this, target, content, ...rest);
  };
  const result = await f.service.importFile({ sessionId: 'test-session', name: 'new.html', html: f.html });
  assert.equal(result.name, 'new (2).ux.html');
  assert.equal(await fs.readFile(path.join(f.cwd, 'new.ux.html'), 'utf8'), 'concurrent content');
  assert.equal(await fs.readFile(result.path, 'utf8'), f.html);
});

test('import uses supplied content without reading an external path or extending read/save access', async t => {
  const f = await fixture(t), outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ux-import-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const external = path.join(outside, 'external.ux.html');
  await fs.writeFile(external, 'external content');
  await fs.symlink(external, path.join(f.cwd, 'external.ux.html'));
  const readText = f.dependencies.fs.readText;
  f.dependencies.fs.readText = () => { throw new Error('Import must not read source paths'); };
  const result = await f.service.importFile({ sessionId: 'test-session', name: external, path: external, html: f.html });
  f.dependencies.fs.readText = readText;
  assert.equal(result.name, 'external (2).ux.html');
  assert.equal(await fs.readFile(external, 'utf8'), 'external content');
  await assert.rejects(f.service.read({ ...f.args, path: external }), /工作目录/);
  await assert.rejects(f.service.save({ ...f.args, path: external, html: f.html }), /工作目录/);
});

test('imports reject read-only sessions, invalid files, oversize content, and damaged metadata before writing', async t => {
  const f = await fixture(t), args = { sessionId: 'test-session', name: 'bad.html', html: f.html, allowConvert: true };
  const readOnly = new ReviewService({ ...f.dependencies, policyFor: () => ({ mode: 'read-only', workspaceRoot: f.cwd }) });
  await assert.rejects(readOnly.importFile(args), /只读/);
  await assert.rejects(f.service.importFile({ ...args, name: 'design.txt' }), /HTML/);
  await assert.rejects(f.service.importFile({ ...args, html: '' }), /为空/);
  await assert.rejects(f.service.importFile({ ...args, html: 'not HTML' }), /完整 HTML/);
  await assert.rejects(f.service.importFile({ ...args, html: 'a'.repeat(MAX_DOCUMENT_BYTES + 1) }), /50 MB/);
  for (const html of [f.html.replace('<!-- ux-document:start -->', ''), f.html.replace('"format":', 'BROKEN:'), f.html.replace('"schemaVersion": 1', '"schemaVersion": 99')]) await assert.rejects(f.service.importFile({ ...args, html }));
  assert.equal(f.writes.length, 0);
  assert.equal(f.messages.length, 0);
});
