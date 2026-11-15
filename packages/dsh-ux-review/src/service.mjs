import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { parse, sourceOnly, validate, checksum, hasPrototypeChanges, patchBetween, lineDiff, prdChangeDiff, importHtml } from '../../../skills/ux-prototype/scripts/document.mjs';
import { taskContext } from '../../../skills/ux-prototype/scripts/task-context.mjs';
import { readTaskContext } from '../../../skills/ux-prototype/scripts/task-read.mjs';
import { editPrompt } from '../../../skills/ux-prototype/scripts/edit-prompt.mjs';
import { inspectDocumentInput, MAX_DOCUMENT_BYTES } from './document-input.mjs';
import { importedFileName } from './filename.mjs';

export const sha256 = text => createHash('sha256').update(text).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const active = task => ['queued', 'running'].includes(task.status);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, name) => { assert(typeof value === 'string' && value.length > 0 && !value.includes('\0'), `${name} 无效。`); return value; };
const LIMIT = MAX_DOCUMENT_BYTES;

// All persistence uses the Host filesystem service with session sandbox policy.
// Only Agent followup and message creation are injected, so filesystem and task
// association can be tested independently of a running model.
export class ReviewService {
  constructor({ fs, resolveAgent, policyFor, makeMessage, skillsPath }) {
    Object.assign(this, { fs, resolveAgent, policyFor, makeMessage, skillsPath });
    this.tasks = new Map(); this.locks = new Map(); this.taskMonitors = new Set();
  }
  async locked(key, action) {
    const previous = this.locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.locks.set(key, current);
    try { return await current; } finally { if (this.locks.get(key) === current) this.locks.delete(key); }
  }
  async scope(sessionId) {
    text(sessionId, '会话');
    const result = await this.resolveAgent(sessionId);
    assert(result.agent, result.error?.message || '无法恢复当前会话。');
    const agent = result.agent, policy = this.policyFor(agent.session);
    assert(agent.session.id === sessionId, '会话身份不一致。');
    const root = await this.fs.resolve(policy.workspaceRoot);
    return { agent, policy, root, sessionId, cwd: this.fs.processPath(root) };
  }
  async target(scope, file, htmlOnly = false) {
    text(file, '文件路径');
    if (htmlOnly) assert(/\.html?$/i.test(file), '只支持 HTML 文件。');
    const target = await this.fs.resolve(file, { cwd: scope.cwd });
    assert(this.fs.contains(scope.root, target), '文件必须位于当前会话的工作目录内。');
    return target;
  }
  async readTarget(target, signal) {
    const before = await this.fs.stat(target, signal);
    if (before?.type !== 'file') throw Object.assign(new Error('文件不存在或不是普通文件。'), { code: before ? 'FS_NOT_REGULAR_FILE' : 'FS_NOT_FOUND' });
    assert(before.size === undefined || before.size <= LIMIT, '文件超过 50 MB，无法打开。');
    const html = await this.fs.readText(target, signal);
    assert(Buffer.byteLength(html) <= LIMIT, '文件超过 50 MB，无法打开。');
    const after = await this.fs.stat(target, signal);
    if (after?.version !== before.version) throw Object.assign(new Error('文件在读取期间发生变化，请重新读取。'), { code: 'FS_STALE_VERSION' });
    const file = this.fs.processPath(target);
    return { path: file, name: path.basename(file), html, version: before.version };
  }
  async read(args, signal) {
    const scope = await this.scope(args.sessionId), target = await this.target(scope, args.path, true);
    let task = await this.activeDocumentTask(scope, target, signal);
    if (task && await this.reconcileTask(scope, task, signal)) task = await this.activeDocumentTask(scope, target, signal);
    const snapshot = await this.readTarget(target, signal);
    return { ...snapshot, activeTask: task ? { ...this.publicTask(task), ownedBySession: task.sessionId === scope.sessionId } : null };
  }
  async importFile(args, signal) {
    const scope = await this.scope(args.sessionId);
    assert(scope.policy.mode !== 'read-only', '当前会话为只读，不能导入设计文档。');
    text(args.name, '文件名');
    importedFileName(args.name);
    assert(args.allowConvert === undefined || typeof args.allowConvert === 'boolean', '导入确认选项无效。');
    const input = inspectDocumentInput(args.html);
    assert(input.kind === 'design' || args.allowConvert === true, '此文件需要先确认导入为设计文档。');
    const converted = input.kind === 'design' ? null : importHtml(args.html);
    const html = converted?.html ?? args.html;
    assert(Buffer.byteLength(html) <= LIMIT, '转换后的文件超过 50 MB，无法导入。');
    // Serialise picker imports in a workspace; createIfAbsent is still the
    // authority when another process creates a candidate name concurrently.
    return this.locked(`import:${scope.root.targetKey}`, async () => {
      for (let collision = 0; collision < 1000; collision++) {
        signal?.throwIfAborted();
        const name = importedFileName(args.name, collision);
        const target = await this.fs.resolve(name, { cwd: scope.cwd });
        // An existing escaping symlink occupies the name, not a destination.
        if (!this.fs.contains(scope.root, target) || this.fs.processPath(target) !== path.join(scope.cwd, name) || await this.fs.stat(target, signal)) continue;
        try {
          const out = await this.fs.writeText(target, html, { kind: 'createIfAbsent' }, signal, scope.policy);
          const file = this.fs.processPath(target);
          return { path: file, name: path.basename(file), html, version: out.version, ...(converted ? { report: converted.report } : {}) };
        } catch (error) {
          if (['FS_NOT_OBSERVED', 'FS_ALREADY_EXISTS', 'EEXIST'].includes(error.code)) continue;
          throw error;
        }
      }
      throw new Error('同名文件过多，请重命名后重试。');
    });
  }
  async save(args, signal) {
    const scope = await this.scope(args.sessionId), target = await this.target(scope, args.path, true);
    assert(scope.policy.mode !== 'read-only', '当前会话为只读，不能保存文档。');
    return this.locked(target.targetKey, async () => {
      assert(!await this.activeDocumentTask(scope, target, signal), 'AI 正在修改此文档，完成后才能继续编辑。');
      assert(typeof args.html === 'string' && Buffer.byteLength(args.html) <= LIMIT, 'HTML 内容无效或超过 50 MB。');
      const before = await this.readTarget(target, signal);
      assert(args.expectedVersion === before.version, '文件已被其他编辑器修改，请重新读取后合并。');
      const next = parse(args.html);
      let old;
      try { old = parse(before.html); } catch { /* First explicit import may add protocol metadata. */ }
      if (old) {
        assert(old.id === next.id, '保存不能替换文档身份。');
        assert(next.revision >= old.revision && equal(next.changes.slice(0, old.changes.length), old.changes), '已有变更记录不能删除或修改。');
        assert((equal(next, old) && sourceOnly(args.html) === sourceOnly(before.html)) || next.revision > old.revision, '文档修改必须附带新的变更记录。');
      }
      const out = await this.fs.writeText(target, args.html, { kind: 'replaceIfVersion', version: before.version }, signal, scope.policy);
      return { path: before.path, name: before.name, html: args.html, version: out.version };
    });
  }
  artifact(scope, id, suffix) { return path.join(scope.cwd, `.ux-review-${id}.${suffix}`); }
  async activePointer(scope, target) {
    return this.target(scope, path.join(scope.cwd, `.ux-review-active-${sha256(target.targetKey)}.json`));
  }
  async activeDocumentTask(scope, target, signal) {
    const pointer = await this.activePointer(scope, target), stat = await this.fs.stat(pointer, signal);
    if (!stat) return [...this.tasks.values()].find(task => task.originalPath === this.fs.processPath(target) && active(task)) || null;
    const value = JSON.parse((await this.readTarget(pointer, signal)).html);
    assert(typeof value.taskId === 'string' && /^[0-9a-f-]{36}$/.test(value.taskId), '文档任务锁无效。');
    const task = JSON.parse((await this.readTarget(await this.target(scope, this.artifact(scope, value.taskId, 'state.json')), signal)).html);
    assert(task.id === value.taskId && task.format === 'ux-review-task' && task.schemaVersion === 1 && task.documentId === value.documentId, '文档任务锁与任务记录不匹配。');
    const original = await this.target(scope, task.originalPath, true);
    assert(original.targetKey === target.targetKey, '文档任务锁的原文件不匹配。');
    this.tasks.set(task.id, task);
    if (task.sessionId === scope.sessionId && active(task) && task.destination !== 'external') this.watchTask(scope, task);
    return active(task) ? task : null;
  }
  watchTask(scope, task) {
    if (task.destination === 'external' || this.taskMonitors.has(task.id)) return;
    this.taskMonitors.add(task.id);
    // Quiescence is only a missing-result signal, never success evidence.
    // Reattach this observer when a persisted active task is restored after restart.
    void scope.agent.whenIdle().then(async () => {
      if (this.disposed) return;
      let completionError;
      try { await this.reconcileTask(scope, task); } catch (error) { completionError = error; }
      return this.locked(task.id, async () => {
        const current = this.tasks.get(task.id);
        if (this.disposed || !current || !active(current)) return;
        await this.persist(scope, { ...current, status: 'needs-attention', message: completionError ? `修改结果未能载入：${completionError.message}` : 'AI 已停止，但尚未保存修改结果。可在会话中继续，工作文件与原稿均保留。' });
      });
    }).catch(() => {});
  }
  async claimDocumentTask(scope, target, task, signal) {
    const pointer = await this.activePointer(scope, target), stat = await this.fs.stat(pointer, signal);
    const running = await this.activeDocumentTask(scope, target, signal);
    assert(!running || running.id === task.id, '此文档已有正在执行的 AI 修改任务。');
    await this.fs.writeText(pointer, JSON.stringify({ taskId: task.id, documentId: task.documentId }) + '\n', stat ? { kind: 'replaceIfVersion', version: stat.version } : { kind: 'createIfAbsent' }, signal, scope.policy);
  }
  async persist(scope, task, signal, create = false) {
    assert(scope.policy.mode !== 'read-only', '当前会话为只读，不能保存任务状态。');
    const target = await this.target(scope, this.artifact(scope, task.id, 'state.json'));
    const stat = await this.fs.stat(target, signal);
    assert(!create || !stat, '任务 ID 已存在。');
    await this.fs.writeText(target, JSON.stringify(task, null, 2) + '\n', stat ? { kind: 'replaceIfVersion', version: stat.version } : { kind: 'createIfAbsent' }, signal, scope.policy);
    this.tasks.set(task.id, task);
  }
  async loadTask(scope, id, signal) {
    assert(typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id), '任务 ID 无效。');
    let task = this.tasks.get(id);
    if (!task) {
      const snapshot = await this.readTarget(await this.target(scope, this.artifact(scope, id, 'state.json')), signal);
      task = JSON.parse(snapshot.html);
      assert(task.id === id && task.format === 'ux-review-task' && task.schemaVersion === 1, '任务记录无效。');
      this.tasks.set(id, task);
    }
    assert(task.sessionId === scope.sessionId, '任务不属于当前会话。');
    return task;
  }
  publicTask(task) {
    return { id: task.id, status: task.status, message: task.message,
      ...((task.status === 'completed' || task.delivery === 'conflict') ? { outputPath: task.deliveredPath || task.outputPath } : {}),
      ...(task.delivery ? { delivery: task.delivery } : {}),
      ...(task.backupPath ? { backupPath: task.backupPath } : {}),
      createNewVersion: task.createNewVersion !== false,
      destination: task.destination || 'dsh',
      ...(task.prompt ? { prompt: task.prompt } : {}),
      documentId: task.documentId, baseRevision: task.baseRevision, selectedIds: task.selectedIds, createdAt: task.createdAt };
  }
  async task(args, signal) {
    const scope = await this.scope(args.sessionId), task = await this.loadTask(scope, args.id, signal);
    return await this.reconcileTask(scope, task, signal) || this.publicTask(task);
  }
  async reconcileTask(scope, task, signal) {
    if (!['queued', 'running', 'needs-attention'].includes(task.status)) return null;
    const target = await this.target(scope, this.artifact(scope, task.id, 'finish.json'));
    if (!await this.fs.stat(target, signal)) return null;
    const receipt = JSON.parse((await this.readTarget(target, signal)).html);
    assert(receipt.taskId === task.id && receipt.outputPath === task.outputPath, '修改结果与当前任务不匹配。');
    // The universal runner may already have written the original. complete is
    // idempotent and accepts the delivered bytes without writing them again.
    const owner = scope.sessionId === task.sessionId ? scope : await this.scope(task.sessionId);
    return this.complete({ taskId: task.id, outputPath: task.outputPath }, { agent: owner.agent, signal });
  }
  async cancel(args, signal) {
    const scope = await this.scope(args.sessionId);
    const current = await this.loadTask(scope, args.id, signal);
    assert(current.destination === 'external', '只能在此结束外部修改。');
    const completed = await this.reconcileTask(scope, current, signal);
    if (completed) return completed;
    return this.locked(args.id, async () => {
      const task = await this.loadTask(scope, args.id, signal);
      assert(task.destination === 'external', '只能在此结束外部修改。');
      if (!active(task)) return this.publicTask(task);
      const next = { ...task, status: 'cancelled', message: '外部修改已结束，文档恢复编辑；工作文件与备份保留。' };
      await this.persist(scope, next, signal);
      return this.publicTask(next);
    });
  }
  async context(args, exec) {
    const scope = await this.scope(exec.agent.session.id), task = await this.loadTask(scope, args.taskId, exec.signal);
    const input = await this.readTarget(await this.target(scope, task.inputPath, true), exec.signal);
    assert(sha256(input.html) === task.baseHash, '输入快照已被修改，无法读取任务上下文。');
    return readTaskContext(parse(input.html), task, args.query, sourceOnly(input.html));
  }
  async submit(args, signal) {
    const scope = await this.scope(args.sessionId), target = await this.target(scope, args.path, true);
    assert(scope.policy.mode !== 'read-only', '当前会话为只读，不能创建修改任务。');
    const destination = args.destination ?? 'dsh';
    assert(['dsh', 'external'].includes(destination), '修改方式无效。');
    return this.locked(target.targetKey, async () => {
      const snapshot = await this.readTarget(target, signal);
      assert(snapshot.version === args.expectedVersion, '文件已变化，请保存并重新提交。');
      const doc = parse(snapshot.html);
      assert(Array.isArray(args.selectedIds) && args.selectedIds.every(s => typeof s === 'string'), '所选标注无效。');
      const selectedIds = [...new Set(args.selectedIds)];
      assert(typeof args.includePrdChanges === 'boolean' && typeof args.clearResolved === 'boolean', '任务选项无效。');
      assert(args.createNewVersion === undefined || typeof args.createNewVersion === 'boolean', '生成新版本文件选项无效。');
      const createNewVersion = args.createNewVersion ?? false;
      assert(selectedIds.length || args.includePrdChanges, '请至少选择一条修改意见或 PRD 差异。');
      for (const key of selectedIds) {
        const a = doc.annotations[key];
        assert(a?.kind === 'change-request' && a.status === 'open' && !a.needsTypeConfirmation, `标注 ${key} 不是待处理的修改意见。`);
      }
      const running = await this.activeDocumentTask(scope, target, signal), baseHash = sha256(snapshot.html);
      const duplicate = running && running.sessionId === scope.sessionId && (running.destination || 'dsh') === destination && running.baseHash === baseHash && equal(running.selectedIds, selectedIds) && running.includePrdChanges === args.includePrdChanges && running.clearResolved === args.clearResolved && (running.createNewVersion !== false) === createNewVersion && (createNewVersion || running.baseFileVersion === snapshot.version) ? running : null;
      if (duplicate) return this.publicTask(duplicate);
      assert(!running, '此文档已有正在执行的 AI 修改任务，请等待完成。');
      const id = randomUUID(), stem = snapshot.path.replace(/(?:\.ux)?\.html?$/i, '');
      const task = { format: 'ux-review-task', schemaVersion: 1, id, sessionId: scope.sessionId, documentId: doc.id,
        baseRevision: doc.revision, baseHash, baseFileVersion: snapshot.version, originalPath: snapshot.path,
        inputPath: this.artifact(scope, id, 'input.ux.html'), outputPath: createNewVersion ? `${stem}.review-${id.slice(0, 8)}.ux.html` : this.artifact(scope, id, 'result.ux.html'),
        businessPath: this.artifact(scope, id, 'business.html'), contextPath: this.artifact(scope, id, 'context.json'),
        selectedIds, includePrdChanges: args.includePrdChanges, clearResolved: args.clearResolved, createNewVersion, destination,
        activePointerPath: this.fs.processPath(await this.activePointer(scope, target)),
        createdAt: new Date().toISOString(), status: 'queued', message: '任务已排队，等待 AI 读取已保存的评审内容。' };
      const input = await this.target(scope, task.inputPath, true);
      await this.fs.writeText(input, snapshot.html, { kind: 'createIfAbsent' }, signal, scope.policy);
      // Prepare deterministic work before the model starts. The full immutable
      // snapshot remains the authority for apply and final verification.
      const source = sourceOnly(snapshot.html);
      await this.fs.writeText(await this.target(scope, task.businessPath, true), source, { kind: 'createIfAbsent' }, signal, scope.policy);
      const context = taskContext(doc, task, { source });
      await this.fs.writeText(await this.target(scope, task.contextPath), JSON.stringify(context, null, 2) + '\n', { kind: 'createIfAbsent' }, signal, scope.policy);
      task.prompt = editPrompt(task, context, { scriptsPath: path.join(this.skillsPath, 'ux-prototype', 'scripts') });
      const manifestPath = this.artifact(scope, id, 'task.json');
      await this.fs.writeText(await this.target(scope, manifestPath), JSON.stringify(task, null, 2) + '\n', { kind: 'createIfAbsent' }, signal, scope.policy);
      await this.persist(scope, task, signal, true);
      try {
        await this.claimDocumentTask(scope, target, task, signal);
        if (destination === 'dsh') scope.agent.followup(this.makeMessage(task.prompt));
        task.status = 'running'; task.message = destination === 'external' ? '修改说明已准备，等待外部 Agent 修改。' : 'AI 正在处理所选修改意见与 PRD 差异。';
        await this.persist(scope, task, signal);
        this.watchTask(scope, task);
      } catch (error) {
        task.status = 'failed'; task.message = error.message || String(error);
        await this.persist(scope, task);
        throw error;
      }
      return this.publicTask(task);
    });
  }
  async complete(args, exec) {
    const scope = await this.scope(exec.agent.session.id);
    return this.locked(args.taskId, async () => {
      const task = await this.loadTask(scope, args.taskId, exec.signal);
      if (task.status === 'completed') return this.publicTask(task);
      assert(!['cancelled', 'canceled', 'failed'].includes(task.status), '此修改已结束，不能继续写回。');
      const outputTarget = await this.target(scope, args.outputPath, true);
      const expectedTarget = await this.target(scope, task.outputPath, true);
      assert(outputTarget.targetKey === expectedTarget.targetKey, '结果路径与提交任务不一致。');
      assert(task.outputPath !== task.originalPath && task.outputPath !== task.inputPath, '任务必须输出到新文件。');
      const input = await this.readTarget(await this.target(scope, task.inputPath, true), exec.signal);
      assert(sha256(input.html) === task.baseHash, '输入快照已被修改，无法验证结果。');
      const before = parse(input.html), output = await this.readTarget(outputTarget, exec.signal), doc = validate(parse(output.html));
      assert(before.id === task.documentId && before.revision === task.baseRevision && doc.id === task.documentId, '结果文档身份或基线不一致。');
      assert(doc.revision === before.revision + 1 && equal(doc.changes.slice(0, before.changes.length), before.changes), '结果必须保留已有历史，并新增一条本轮变更。');
      assert(doc.uxVersion === before.uxVersion + (hasPrototypeChanges(input.html, output.html) ? 1 : 0) && doc.agentCheckpoint === doc.revision, '结果版本号或 Agent 检查点与实际改动不一致。');
      const last = doc.changes.at(-1), resolved = last.resolvedAnnotationIds || last.resolvedIds || [], cleared = last.clearedAnnotationIds || [];
      assert(equal(last.patch, patchBetween(before, doc)) && prdChangeDiff(last) === lineDiff(before.prd, doc.prd), '变更记录中的差异与实际 PRD / 标注修改不一致。');
      assert(last.diff?.ux?.before === checksum(sourceOnly(input.html)) && last.diff?.ux?.after === checksum(sourceOnly(output.html)), '变更记录与实际业务源码不一致。');
      assert(last.actor === 'agent' && last.taskId === task.id && (last.baseRevision ?? last.basedOnRevision) === task.baseRevision, '结果缺少当前任务关联的 AI 变更记录。');
      assert(equal([...(last.selectedAnnotationIds || [])].sort(), [...task.selectedIds].sort()), '结果中的请求集合与提交任务不一致。');
      assert(resolved.every(id => task.selectedIds.includes(id)) && cleared.every(id => resolved.includes(id)) && (task.clearResolved || !cleared.length), '结果解决或清理了本轮范围之外的标注。');
      for (const [id, annotation] of Object.entries(before.annotations)) {
        if (!doc.annotations[id]) assert(annotation.kind === 'change-request' && cleared.includes(id), '结果删除了未授权标注或交互说明。');
        else if (!task.selectedIds.includes(id) && annotation.kind === 'change-request') assert(equal(doc.annotations[id], annotation), '结果修改了未选择的修改意见。');
        else if (resolved.includes(id)) assert(doc.annotations[id].status === 'resolved', '标注处理状态与变更记录不一致。');
      }
      assert(task.includePrdChanges || doc.prd === before.prd, '本轮未授权修改 PRD。');
      const outputHash = sha256(output.html);
      const completed = { ...task, status: 'completed', message: last.summary, completedAt: new Date().toISOString(), outputHash, resultRevision: doc.revision, backupPath: task.inputPath };
      // Persisted tasks from before this option retain their original new-file behavior.
      if (task.createNewVersion !== false) {
        Object.assign(completed, { delivery: 'new-version', deliveredPath: task.outputPath });
        await this.persist(scope, completed, exec.signal);
        return this.publicTask(completed);
      }
      assert(task.baseFileVersion !== undefined, '任务缺少原文件基线版本，不能写回。');
      assert(scope.policy.mode !== 'read-only', '当前会话为只读，不能写回文档。');
      const originalTarget = await this.target(scope, task.originalPath, true);
      return this.locked(originalTarget.targetKey, async () => {
        const conflict = async () => {
          const next = { ...task, status: 'needs-attention', delivery: 'conflict', deliveredPath: task.outputPath, backupPath: task.inputPath, outputHash, resultRevision: doc.revision,
            message: '原文件在任务期间已变化，未覆盖。AI 候选结果与原始备份已保留，可打开候选核对或合并。' };
          await this.persist(scope, next, exec.signal);
          return this.publicTask(next);
        };
        const running = await this.activeDocumentTask(scope, originalTarget, exec.signal);
        if (running && running.id !== task.id) return conflict();
        const stat = await this.fs.stat(originalTarget, exec.signal);
        if (!stat || stat.type !== 'file') return conflict();
        let current;
        try { current = await this.readTarget(originalTarget, exec.signal); }
        catch (error) {
          if (['FS_STALE_VERSION', 'FS_NOT_FOUND', 'FS_NOT_REGULAR_FILE', 'ENOENT'].includes(error.code)) return conflict();
          throw error;
        }
        // A previous write may have succeeded before state persistence failed.
        // Matching bytes recover the status without performing a second overwrite.
        if (sha256(current.html) !== outputHash) {
          if (current.version !== task.baseFileVersion || sha256(current.html) !== task.baseHash) return conflict();
          try { await this.fs.writeText(originalTarget, output.html, { kind: 'replaceIfVersion', version: task.baseFileVersion }, exec.signal, scope.policy); }
          catch (error) { if (error.code === 'FS_STALE_VERSION') return conflict(); throw error; }
        }
        Object.assign(completed, { delivery: 'updated-current', deliveredPath: task.originalPath });
        await this.persist(scope, completed, exec.signal);
        return this.publicTask(completed);
      });
    });
  }
  async fail(args, exec) {
    const scope = await this.scope(exec.agent.session.id);
    return this.locked(args.taskId, async () => {
      const task = await this.loadTask(scope, args.taskId, exec.signal);
      assert(task.status !== 'completed', '已完成的任务不能标记为失败。');
      const failed = { ...task, status: 'failed', message: text(args.reason, '失败原因') };
      await this.persist(scope, failed, exec.signal); return this.publicTask(failed);
    });
  }
}
