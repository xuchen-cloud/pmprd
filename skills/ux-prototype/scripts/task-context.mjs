// The first read contains requests and their captured targets, not rule documents.
import { clone, validate } from './document.mjs';
import { targetSources } from './target-source.mjs';

const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, clone(value[key])]));
export const annotationContext = value => value && pick(value, ['id', 'kind', 'body', 'anchor', 'prdSectionId', 'assignee', 'status']);

export function validateTaskScope(doc, task) {
  validate(doc);
  if (task?.format !== 'ux-review-task' || task.schemaVersion !== 1 || task.documentId !== doc.id || task.baseRevision !== doc.revision || typeof task.id !== 'string' || !task.id.trim()) throw new Error('任务的文档身份或修订不匹配。');
  if (!Array.isArray(task.selectedIds) || new Set(task.selectedIds).size !== task.selectedIds.length || typeof task.includePrdChanges !== 'boolean' || typeof task.clearResolved !== 'boolean') throw new Error('任务处理范围无效。');
  return task.selectedIds.map(key => {
    const annotation = typeof key === 'string' && doc.annotations[key];
    if (!annotation || annotation.kind !== 'change-request' || annotation.needsTypeConfirmation) throw new Error('任务只能选择已确认的修改意见：' + key);
    return annotation;
  });
}

export function pendingPrdEvents(doc) {
  return doc.changes.filter(event => event.actor === 'human' && event.revision > doc.agentCheckpoint && (event.patch.some(patch => patch.path === '/prd') || event.diff?.prd));
}

export function taskContext(doc, task, { source } = {}) {
  const selected = validateTaskScope(doc, task);
  const snippets = targetSources(source, selected.map(annotation => annotation.anchor));
  return {
    format: 'ux-review-context', schemaVersion: 1,
    task: pick(task, ['id', 'documentId', 'baseRevision', 'inputPath', 'outputPath', 'businessPath', 'contextPath', 'selectedIds', 'includePrdChanges', 'clearResolved', 'createNewVersion']),
    selectedRequests: selected.map((annotation, index) => ({ ...annotationContext(annotation), targetSource: snippets[index] })),
    prdPolicy: { mode: task.includePrdChanges ? 'scoped-update' : 'read-only' },
    scope: { mode: 'requests-and-targets', pendingPrdChangeCount: task.includePrdChanges ? pendingPrdEvents(doc).length : 0 },
    readOnDemand: { kinds: ['source', 'prd', 'explanations', ...(task.includePrdChanges ? ['prd-diff'] : [])], instruction: '先处理所选意见；缺少信息时按关键词、行号或标注 ID 补读。PRD 权限不要求读取或修改 PRD；未选修改意见不在执行范围。' },
  };
}
