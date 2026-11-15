import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse, write, recordAgent, sourceOnly, hasDocument, auditAnchors } from './document.mjs';
import { validateTaskScope } from './task-context.mjs';

const fail = message => { throw new Error(message); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(value).digest('hex');
const changeFields = new Set(['summary', 'details', 'prd', 'prdOps', 'title', 'annotationUpdates', 'removeAnnotationIds', 'resolvedIds', 'selectedIds', 'clearResolved', 'actorName']);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

/** One document transformation for both the portable finish command and legacy apply. */
export function buildEditResult(inputHtml, businessHtml, changes, task = null) {
  const before = parse(inputHtml);
  if (!isObject(changes)) fail('changes 必须是 JSON 对象。');
  for (const key of Object.keys(changes)) if (!changeFields.has(key)) fail('changes 中不支持的字段：' + key);
  if (task) {
    validateTaskScope(before, task);
    if (task.baseHash !== hash(inputHtml)) fail('输入快照已变化，不能提交本轮修改。');
    if (changes.selectedIds && !equal([...changes.selectedIds].sort(), [...task.selectedIds].sort())) fail('changes 不能扩大或替换本轮任务范围。');
    if (changes.clearResolved !== undefined && changes.clearResolved !== task.clearResolved) fail('changes 不能改变任务的清理选项。');
    if ((changes.prd !== undefined || changes.prdOps !== undefined) && !task.includePrdChanges) fail('本轮未授权修改 PRD。');
    if (changes.prd !== undefined) fail('修改任务使用 prdOps 提交局部修改，不接受整篇 prd。');
  }
  if (hasDocument(businessHtml) && !equal(parse(businessHtml), before)) fail('工作稿中的协作元数据被改写；请通过提交参数修改 PRD 或标注。');
  const source = sourceOnly(write(businessHtml, before));
  const args = { ...changes, selectedIds: task?.selectedIds || changes.selectedIds || [], resolvedIds: changes.resolvedIds || [], clearResolved: task?.clearResolved ?? changes.clearResolved ?? false,
    uxBefore: sourceOnly(inputHtml), uxAfter: source, ...(task ? { taskId: task.id } : {}) };
  const doc = recordAgent(before, args), html = write(source, doc);
  if (auditAnchors(html, doc).duplicates.length) fail('交付稿包含重复稳定锚点。');
  return { html, doc, receipt: { format: 'ux-review-result', schemaVersion: 1, taskId: task?.id || null, documentId: doc.id, baseRevision: before.revision,
    revision: doc.revision, uxVersion: doc.uxVersion, resolvedIds: args.resolvedIds, summary: args.summary } };
}

export function editSessionPaths(workfile) {
  const businessPath = path.resolve(workfile), match = path.basename(businessPath).match(/^\.ux-review-([0-9a-f-]{36})\.business\.html$/i);
  if (!match) fail('该文件不是已准备的修改工作稿，请使用修改说明中的工作文件路径。');
  const stem = path.join(path.dirname(businessPath), '.ux-review-' + match[1]);
  return { id: match[1], businessPath, manifestPath: stem + '.task.json', statePath: stem + '.state.json', receiptPath: stem + '.finish.json', lockPath: stem + '.finish.lock' };
}

async function optionalJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function realFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('修改文件必须是普通文件：' + file);
  return fs.realpath(file);
}
function inDirectory(directory, file) {
  const relative = path.relative(directory, path.resolve(file));
  return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

/** Resolve private bookkeeping from the workfile; agents never need to read it. */
export async function loadEditSession(workfile) {
  const files = editSessionPaths(workfile), task = await optionalJson(files.manifestPath);
  if (!task || task.id !== files.id || task.format !== 'ux-review-task' || task.schemaVersion !== 1) fail('找不到此工作稿对应的修改会话。');
  const root = path.dirname(files.businessPath);
  for (const key of ['inputPath', 'outputPath', 'businessPath', 'originalPath']) {
    if (typeof task[key] !== 'string' || !inDirectory(root, task[key])) fail('修改会话中的文件路径无效：' + key);
  }
  if (await realFile(task.businessPath) !== await realFile(files.businessPath)) fail('工作文件与修改会话不匹配。');
  if ([task.originalPath, task.inputPath, task.businessPath].some(file => path.resolve(file) === path.resolve(task.outputPath))) fail('候选文件不能覆盖工作稿、输入快照或原文件。');
  if (task.inputPath === task.originalPath) fail('缺少独立的修改前备份。');
  const inputHtml = await fs.readFile(await realFile(task.inputPath), 'utf8'), doc = parse(inputHtml);
  validateTaskScope(doc, task);
  if (hash(inputHtml) !== task.baseHash) fail('输入快照已变化，不能使用此修改会话。');
  return { ...files, task, inputHtml, doc };
}

async function assertSessionActive(session) {
  const state = await optionalJson(session.statePath);
  if (state && (state.id !== session.id || state.documentId !== session.task.documentId)) fail('修改会话状态不匹配。');
  if (state && ['cancelled', 'canceled', 'failed'].includes(state.status)) fail('此修改已取消或结束，不能继续写回。');
  const fallback = path.join(path.dirname(session.businessPath), '.ux-review-active-' + hash(await fs.realpath(session.task.originalPath).catch(() => path.resolve(session.task.originalPath))) + '.json');
  const pointerPath = session.task.activePointerPath || fallback;
  if (!inDirectory(path.dirname(session.businessPath), pointerPath)) fail('修改会话锁路径无效。');
  const pointer = await optionalJson(pointerPath);
  if (pointer && pointer.taskId !== session.id) fail('文档已开始另一轮修改，不能写回旧结果。');
  return state;
}

async function acquireLock(file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const handle = await fs.open(file, 'wx'); await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.close(); return; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const lock = await optionalJson(file);
      if (lock?.pid && lock.pid !== process.pid) {
        try { process.kill(lock.pid, 0); }
        catch (probe) { if (probe.code === 'ESRCH') { await fs.unlink(file); continue; } }
      }
      fail('此修改正在提交，请稍后重试。');
    }
  }
  fail('无法取得修改提交锁。');
}

async function createExclusive(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, text, { flag: 'wx' });
    // Link publication is exclusive and atomic: a polling Host never reads half JSON.
    await fs.link(temporary, file);
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

function publicReceipt(receipt) {
  return { status: receipt.delivery === 'conflict' ? 'needs-attention' : 'completed', outputPath: receipt.deliveredPath,
    candidatePath: receipt.outputPath, delivery: receipt.delivery, revision: receipt.revision, uxVersion: receipt.uxVersion, summary: receipt.summary, resolvedIds: receipt.resolvedIds };
}

/** Portable, idempotent commit. DSH observes the same receipt as any external caller. */
export async function finishEdit(workfile, changes) {
  const session = await loadEditSession(workfile);
  await acquireLock(session.lockPath);
  try {
    const state = await assertSessionActive(session), businessHtml = await fs.readFile(session.businessPath, 'utf8');
    if (!isObject(changes)) fail('提交内容必须是 JSON 对象。');
    const normalized = { ...changes, details: changes.details ?? [changes.summary], resolvedIds: changes.resolvedIds ?? session.task.selectedIds };
    const requestHash = hash(JSON.stringify(canonical({ businessHtml, changes: normalized })));
    const previous = await optionalJson(session.receiptPath);
    if (previous) {
      if (previous.taskId !== session.id || previous.requestHash !== requestHash) fail('本轮已提交，新的修改请重新发起；未覆盖已有结果。');
      if (hash(await fs.readFile(previous.outputPath, 'utf8')) !== previous.outputHash) fail('已提交的候选文件发生变化，未重复写回。');
      return publicReceipt(previous);
    }
    if (state?.status === 'completed') fail('本轮已经完成，新的修改请重新发起。');
    const built = buildEditResult(session.inputHtml, businessHtml, normalized, session.task);
    let candidate = built.html, existing;
    try { existing = await fs.readFile(session.task.outputPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing !== undefined) {
      // Recover a crash after candidate creation without generating another history entry.
      const old = parse(existing), event = old.changes.at(-1), proposedEvent = built.doc.changes.at(-1);
      const withoutStamps = doc => {
        const value = structuredClone(doc); delete value.updatedAt;
        for (const note of Object.values(value.annotations)) { delete note.createdAt; delete note.updatedAt; if (note.resolution) delete note.resolution.at; }
        const tail = value.changes.at(-1); delete tail.id; delete tail.at;
        for (const patch of tail.patch) for (const key of ['value', 'before']) if (isObject(patch[key])) { delete patch[key].createdAt; delete patch[key].updatedAt; if (patch[key].resolution) delete patch[key].resolution.at; }
        for (const note of Object.values(tail.resolvedSnapshots || {})) { delete note.updatedAt; if (note.resolution) delete note.resolution.at; }
        return value;
      };
      if (event?.taskId !== session.id || proposedEvent?.taskId !== session.id || sourceOnly(existing) !== sourceOnly(candidate) || !equal(withoutStamps(old), withoutStamps(built.doc))) fail('候选文件已存在且内容不同，未覆盖。');
      candidate = existing;
    } else await createExclusive(session.task.outputPath, candidate);
    await assertSessionActive(session);
    let delivery = 'new-version', deliveredPath = session.task.outputPath;
    if (session.task.createNewVersion === false) {
      delivery = 'conflict';
      let current, stat;
      try { await realFile(session.task.originalPath); stat = await fs.stat(session.task.originalPath); current = await fs.readFile(session.task.originalPath, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current === candidate) { delivery = 'updated-current'; deliveredPath = session.task.originalPath; }
      else if (current === session.inputHtml) {
        const temporary = session.task.originalPath + '.ux-finish-' + randomUUID() + '.tmp';
        try {
          await fs.writeFile(temporary, candidate, { flag: 'wx', mode: stat.mode });
          await assertSessionActive(session);
          if (await fs.readFile(session.task.originalPath, 'utf8') === current) {
            await fs.rename(temporary, session.task.originalPath); delivery = 'updated-current'; deliveredPath = session.task.originalPath;
          }
        } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      }
    }
    const result = parse(candidate);
    const receipt = { format: 'ux-review-finish', schemaVersion: 1, taskId: session.id, outputPath: session.task.outputPath, deliveredPath, delivery,
      backupPath: session.task.inputPath, revision: result.revision, uxVersion: result.uxVersion, resolvedIds: normalized.resolvedIds,
      summary: normalized.summary, completedAt: new Date().toISOString(), requestHash, outputHash: hash(candidate) };
    await createExclusive(session.receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    return publicReceipt(receipt);
  } finally { await fs.unlink(session.lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
