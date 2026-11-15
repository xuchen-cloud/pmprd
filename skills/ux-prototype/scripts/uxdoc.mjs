#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { importHtml, parse, write, review, sourceOnly, auditAnchors } from './document.mjs';
import { taskContext } from './task-context.mjs';
import { readTaskContext } from './task-read.mjs';
import { commandNames, helpFor, usage } from './cli-help.mjs';
import { buildEditResult, finishEdit, loadEditSession } from './edit-session.mjs';

const fail = message => { throw new Error(message); };
const sha256 = text => createHash('sha256').update(text).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const [command, input, ...rest] = process.argv.slice(2);
if (['--help', '-h', 'help'].includes(command) || ['--help', '-h'].includes(input) || rest.some(arg => ['--help', '-h'].includes(arg))) {
  const topic = command === 'help' ? input : ['--help', '-h'].includes(command) ? undefined : command;
  const help = helpFor(topic);
  if (!help) { console.error('未知命令：' + topic + '\n' + helpFor()); process.exit(1); }
  console.log(help); process.exit(0);
}
const valueFlags = new Set(['output', 'context', 'prd', 'title', 'version', 'design', 'annotations', 'summary', 'details', 'resolve', 'select', 'changes', 'changes-json', 'task', 'result', 'actor', 'kind', 'search', 'start-line', 'end-line', 'ids', 'anchor-id', 'selector', 'offset', 'limit']);
const booleanFlags = new Set(['clear-resolved', 'keep-resolved']);
const allowedFlags = {
  init: ['output', 'prd', 'title', 'version', 'design'],
  annotate: ['output', 'annotations', 'summary', 'details', 'actor'],
  inspect: [], review: [], validate: [], extract: ['output'],
  read: ['task', 'kind', 'search', 'start-line', 'end-line', 'ids', 'anchor-id', 'selector', 'offset', 'limit'],
  prepare: ['task', 'output', 'context'],
  apply: ['output', 'summary', 'details', 'resolve', 'select', 'changes', 'task', 'result', 'actor', 'clear-resolved', 'keep-resolved'],
  finish: ['summary', 'details', 'resolve', 'changes', 'changes-json', 'actor'],
};
const options = {}, positional = [];
function ids(value) { return (value || '').split(',').map(x => x.trim()).filter(Boolean); }
async function jsonFile(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { fail(`无法读取 JSON 文件 ${file}：${e.message}`); } }
async function submissionChanges() {
  if (options.changes && options['changes-json']) fail('--changes 和 --changes-json 不能同时使用。');
  let changes = {};
  if (options['changes-json'] !== undefined) changes = JSON.parse(options['changes-json']);
  else if (options.changes === '-') { let input = ''; for await (const chunk of process.stdin) input += chunk; changes = JSON.parse(input); }
  else if (options.changes) changes = await jsonFile(options.changes);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('提交内容必须是 JSON 对象。');
  return { ...changes, ...(options.summary !== undefined ? { summary: options.summary } : {}), ...(options.details !== undefined ? { details: JSON.parse(options.details) } : {}),
    ...(options.resolve !== undefined ? { resolvedIds: options.resolve === 'none' ? [] : ids(options.resolve) } : {}), ...(options.actor !== undefined ? { actorName: options.actor } : {}) };
}
async function writeNew(file, value) {
  const resolved = path.resolve(file);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  try { await fs.writeFile(resolved, value, { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') fail('输出文件已存在，拒绝覆盖：' + file); throw error; }
  return resolved;
}
async function absent(file) { try { await fs.lstat(file); fail('输出文件已存在，拒绝覆盖：' + file); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
async function sameInputPath(candidate, actual) {
  return await fs.realpath(path.resolve(candidate)) === await fs.realpath(path.resolve(actual));
}
async function checkedTask(file, doc, html) {
  const task = await jsonFile(file);
  if (task?.format !== 'ux-review-task' || task.schemaVersion !== 1 || typeof task.id !== 'string' || !task.id.trim() || task.documentId !== doc.id || task.baseRevision !== doc.revision || task.baseHash !== sha256(html)) fail('任务的文档身份、修订或原文件指纹不匹配。');
  if (typeof task.inputPath !== 'string' || !await sameInputPath(task.inputPath, input)) fail('任务的输入文件路径不匹配。');
  if (typeof task.outputPath !== 'string' || !task.outputPath.trim() || !Array.isArray(task.selectedIds) || typeof task.clearResolved !== 'boolean' || typeof task.includePrdChanges !== 'boolean') fail('任务文件缺少输出路径或处理范围。');
  if (path.resolve(task.outputPath) === path.resolve(input)) fail('任务输出必须另存新文件。');
  // Shared validation also checks confirmed annotation types and duplicate IDs.
  taskContext(doc, task);
  return task;
}

try {
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (Object.hasOwn(options, key)) fail('重复参数：' + arg);
    if (booleanFlags.has(key)) options[key] = true;
    else if (valueFlags.has(key)) {
      if (rest[i + 1] === undefined || (rest[i + 1] === '' && key !== 'resolve') || rest[i + 1].startsWith('--')) fail('缺少参数值：' + arg);
      options[key] = rest[++i];
    } else fail('未知参数：' + arg);
  }
  if (!input || !commandNames.includes(command)) fail(usage + '\n运行 node uxdoc.mjs --help 查看命令。');
  if (positional.length > (command === 'apply' ? 1 : 0)) fail('位置参数过多。' + usage);
  if (options['clear-resolved'] && options['keep-resolved']) fail('不能同时要求保留和清理。');
  for (const key of Object.keys(options)) if (!allowedFlags[command].includes(key)) fail(`${command} 不接受 --${key}；运行 ${command} --help 查看支持的选项。`);
  const html = await fs.readFile(input, 'utf8');
  if (command === 'inspect' || command === 'validate') {
    const doc = parse(html);
    // Parse the source block as well, so malformed review exports do not pass.
    const source = sourceOnly(html); write(source, doc);
    const anchors = auditAnchors(html, doc);
    if (anchors.duplicates.length) fail('稳定锚点重复：' + anchors.duplicates.map(a => a.anchorId).join(', '));
    console.log(JSON.stringify(command === 'validate' ? { valid: true, id: doc.id, uxVersion: doc.uxVersion, revision: doc.revision, annotations: Object.keys(doc.annotations).length, anchors } : doc, null, 2));
  } else if (command === 'review') console.log(JSON.stringify(review(parse(html)), null, 2));
  else if (command === 'read') {
    const session = /(?:^|[\\/])\.ux-review-[0-9a-f-]{36}\.business\.html$/i.test(input) ? await loadEditSession(input) : null;
    const doc = session?.doc || parse(html), task = session?.task || (options.task ? await checkedTask(options.task, doc, html) : null);
    if (session && options.task) fail('工作稿已关联修改会话，无需 --task。');
    const query = { kind: options.kind };
    for (const field of ['search', 'selector']) if (options[field] !== undefined) query[field] = options[field];
    if (options['anchor-id'] !== undefined) query.anchorId = options['anchor-id'];
    if (options.ids !== undefined) query.ids = ids(options.ids);
    for (const [flag, field] of [['start-line', 'startLine'], ['end-line', 'endLine'], ['offset', 'offset'], ['limit', 'limit']]) {
      if (options[flag] !== undefined) {
        if (!/^\d+$/.test(options[flag])) fail('--' + flag + ' 必须为整数。');
        query[field] = Number(options[flag]);
      }
    }
    console.log(JSON.stringify(readTaskContext(doc, task, query, sourceOnly(html)), null, 2));
  }
  else if (command === 'finish') {
    console.log(JSON.stringify(await finishEdit(input, await submissionChanges()), null, 2));
  }
  else if (command === 'prepare') {
    if (!options.task || !options.output || !options.context) fail('prepare 需要 --task、--output 与 --context。');
    if (Object.keys(options).some(key => !['task', 'output', 'context'].includes(key))) fail('prepare 只接受 --task、--output 与 --context。');
    const doc = parse(html), task = await checkedTask(options.task, doc, html);
    const outputPath = path.resolve(options.output), contextPath = path.resolve(options.context);
    const protectedPaths = [input, options.task, task.outputPath].map(value => path.resolve(value));
    if (outputPath === contextPath || [outputPath, contextPath].some(value => protectedPaths.includes(value))) fail('准备产物不能覆盖输入、任务或最终交付路径，两个输出也不能相同。');
    if ((task.businessPath && path.resolve(task.businessPath) !== outputPath) || (task.contextPath && path.resolve(task.contextPath) !== contextPath)) fail('准备产物路径与任务约定不一致。');
    const source = sourceOnly(html); write(source, doc);
    const context = taskContext(doc, task, { source });
    await absent(outputPath); await absent(contextPath);
    const created = [];
    try {
      await writeNew(outputPath, source + '\n'); created.push(outputPath);
      await writeNew(contextPath, JSON.stringify(context, null, 2) + '\n'); created.push(contextPath);
    } catch (error) { await Promise.all(created.map(file => fs.unlink(file))); throw error; }
    console.log(JSON.stringify({ prepared: true, taskId: task.id, businessPath: outputPath, contextPath, selectedRequests: context.selectedRequests.length }, null, 2));
  }
  else if (command === 'extract') {
    parse(html);
    const source = sourceOnly(html);
    if (options.output) console.log(await writeNew(options.output, source + '\n'));
    else process.stdout.write(source + '\n');
  } else if (command === 'annotate') {
    if (!options.annotations || !options.output) fail('annotate 需要 --annotations 和 --output。');
    if ([input, options.annotations].some(file => path.resolve(file) === path.resolve(options.output))) fail('输出路径必须不同于原稿和标注清单。');
    await absent(options.output);
    const notes = await jsonFile(options.annotations);
    const { annotateHtml } = await import('./annotate.mjs');
    const result = annotateHtml(html, notes, {
      ...(options.summary !== undefined ? { summary: options.summary } : {}),
      ...(options.details !== undefined ? { details: JSON.parse(options.details) } : {}),
      ...(options.actor !== undefined ? { actorName: options.actor } : {}),
    });
    const outputPath = await writeNew(options.output, result.html);
    console.log(JSON.stringify({ outputPath, documentId: result.doc.id, revision: result.doc.revision, uxVersion: result.doc.uxVersion, imported: result.imported, unchanged: result.unchanged, addedIds: result.addedIds, updatedIds: result.updatedIds, unchangedIds: result.unchangedIds, report: result.report }, null, 2));
  } else if (command === 'init') {
    const imported = importHtml(html);
    if (!imported.imported) fail('文件已有规范元数据，请使用 apply 追加修改。');
    const doc = imported.doc;
    if (options.prd) doc.prd = await fs.readFile(options.prd, 'utf8');
    if (options.title) doc.title = options.title;
    if (options.design !== undefined) {
      if (!options.design.trim()) fail('--design 必须为非空设计依据 ID。');
      doc.design = { id: options.design.trim() };
    }
    if (options.version) {
      const version = Number(options.version);
      if (!Number.isInteger(version) || version < 1) fail('--version 必须是正整数。');
      doc.uxVersion = version;
    }
    doc.changes[0].uxVersion = doc.uxVersion;
    doc.changes[0].patch = [{ op: 'add', path: '/prd', value: doc.prd }];
    delete doc.changes[0].diff;
    if (!options.output) fail('请通过 --output 指定新的 HTML 文件。');
    console.log(await writeNew(options.output, write(imported.html, doc)));
    if (imported.report) console.error('导入报告：' + JSON.stringify(imported.report, null, 2));
  } else if (command === 'apply') {
    if (!positional[0]) fail('apply 需要修改后的业务 HTML 文件。');
    const before = parse(html), modified = await fs.readFile(positional[0], 'utf8');
    const changes = options.changes ? await jsonFile(options.changes) : {};
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('--changes 必须是 JSON 对象。');
    const allowed = new Set(['summary', 'details', 'prd', 'prdOps', 'title', 'annotationUpdates', 'removeAnnotationIds', 'resolvedIds', 'selectedIds', 'clearResolved', 'actorName']);
    for (const key of Object.keys(changes)) if (!allowed.has(key)) fail('changes 中不支持的字段：' + key);
    let task;
    if (options.task) {
      task = await checkedTask(options.task, before, html);
      if (options.output && path.resolve(options.output) !== path.resolve(task.outputPath)) fail('--output 与任务约定的输出路径不一致。');
      if (changes.selectedIds && !equal([...changes.selectedIds].sort(), [...task.selectedIds].sort())) fail('changes 不能扩大或替换本轮任务范围。');
      if (options.select && !equal(ids(options.select).sort(), [...task.selectedIds].sort())) fail('--select 与任务范围不一致。');
      if (changes.clearResolved !== undefined && changes.clearResolved !== task.clearResolved) fail('changes 不能改变任务的清理选项。');
      if ((options['clear-resolved'] && !task.clearResolved) || (options['keep-resolved'] && task.clearResolved)) fail('清理参数与任务设置不一致。');
      // includePrdChanges describes input scope; an explicit prd edit must still come from the submitted task.
      if ((changes.prd !== undefined || changes.prdOps !== undefined) && !task.includePrdChanges) fail('本轮任务未包含 PRD 修改，不能改写 PRD。');
      if (changes.prd !== undefined) fail('修改任务使用 prdOps 提交局部修改，不接受整篇 prd。');
    }
    const args = { ...changes, summary: options.summary ?? changes.summary, details: options.details ? JSON.parse(options.details) : changes.details, resolvedIds: options.resolve ? ids(options.resolve) : changes.resolvedIds || [], selectedIds: task?.selectedIds || (options.select ? ids(options.select) : changes.selectedIds || []), clearResolved: task?.clearResolved ?? (options['clear-resolved'] ? true : options['keep-resolved'] ? false : changes.clearResolved ?? false), ...(options.actor ? { actorName: options.actor } : {}) };
    const output = options.output || task?.outputPath;
    if (!output) fail('apply 需要 --output 或任务中的 outputPath。');
    const outputPath = path.resolve(output);
    if (outputPath === path.resolve(input) || outputPath === path.resolve(positional[0])) fail('输出路径必须不同于输入和修改稿。');
    if (options.result && [input, positional[0], output, options.task, options.changes].filter(Boolean).some(p => path.resolve(p) === path.resolve(options.result))) fail('结果 JSON 路径不能覆盖其他输入或输出。');
    await absent(outputPath); if (options.result) await absent(path.resolve(options.result));
    const built = buildEditResult(html, modified, args, task);
    const receipt = { ...built.receipt, outputPath };
    await writeNew(outputPath, built.html);
    if (options.result) await writeNew(options.result, JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
