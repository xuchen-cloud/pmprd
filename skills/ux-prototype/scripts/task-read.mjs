import { prdChangeDiff, validate } from './document.mjs';
import { annotationContext, pendingPrdEvents, validateTaskScope } from './task-context.mjs';

const fail = message => { throw new Error(message); };
const own = (value, key) => Object.hasOwn(value, key);
const maxChars = 12000;
const positiveInteger = (value, name, max) => {
  if (!Number.isInteger(value) || value < 1 || value > max) fail(`${name} 必须为 1～${max} 的整数。`);
  return value;
};
const nonempty = (value, name) => { if (typeof value !== 'string' || !value.trim()) fail(`${name} 必须为非空文本。`); return value; };

function readText(value, query, defaultRange = false) {
  const lines = value.split('\n');
  if (own(query, 'search')) {
    if (own(query, 'startLine') || own(query, 'endLine')) fail('search 与行号范围不能同时使用。');
    const search = nonempty(query.search, 'search'), matching = [];
    lines.forEach((text, index) => { if (text.includes(search)) matching.push(index); });
    const offset = query.offset ?? 0, limit = positiveInteger(query.limit ?? 10, 'limit', 20);
    const selected = matching.slice(offset, offset + limit);
    let budget = maxChars;
    const matches = [];
    for (const index of selected) {
      if (budget <= 0) break;
      const text = lines[index], column = Math.max(0, text.indexOf(search) - 200), excerpt = text.slice(column, column + Math.min(1200, Math.max(0, budget)));
      budget -= excerpt.length;
      matches.push({ line: index + 1, column: column + 1, text: excerpt, ...(excerpt.length < text.length ? { truncated: true } : {}) });
    }
    return { totalLines: lines.length, totalMatches: matching.length, matches, ...(offset + matches.length < matching.length ? { nextOffset: offset + matches.length } : {}) };
  }
  if (own(query, 'offset') || own(query, 'limit')) fail('文本的 offset/limit 仅用于 search。');
  if (!own(query, 'startLine') && !defaultRange) fail('按需读取必须指定 search 或 startLine，不能默认读取全文。');
  const startLine = positiveInteger(query.startLine ?? 1, 'startLine', Math.max(1, lines.length));
  const endLine = positiveInteger(query.endLine ?? Math.min(startLine + 39, lines.length), 'endLine', Math.max(1, lines.length));
  if (endLine < startLine || endLine - startLine >= 80) fail('单次行号范围最多 80 行，且 endLine 不能早于 startLine。');
  const selected = lines.slice(startLine - 1, endLine), full = selected.join('\n'), text = full.slice(0, maxChars);
  return { totalLines: lines.length, startLine, endLine, text,
    ...(text.length < full.length ? { truncated: true, instruction: '此范围包含超长行，按关键词搜索定位具体内容。' } : {}),
    ...(endLine < lines.length ? { nextLine: endLine + 1 } : {}) };
}

/** Explicit, bounded reads from the immutable task input. Never broadens edit scope. */
export function readTaskContext(doc, task, query, source = '') {
  if (task) validateTaskScope(doc, task); else validate(doc);
  if (!query || typeof query !== 'object' || Array.isArray(query)) fail('读取条件必须为对象。');
  const allowed = {
    prd: ['kind', 'search', 'startLine', 'endLine', 'offset', 'limit'],
    source: ['kind', 'search', 'startLine', 'endLine', 'offset', 'limit'],
    explanations: ['kind', 'ids', 'anchorId', 'selector', 'search', 'offset', 'limit'],
    'prd-diff': ['kind', 'search', 'startLine', 'endLine', 'offset', 'limit'],
  };
  if (!own(allowed, query.kind) || Object.keys(query).some(key => !allowed[query.kind].includes(key))) fail('按需读取类型或参数无效。');
  if (own(query, 'offset') && (!Number.isInteger(query.offset) || query.offset < 0)) fail('offset 必须为非负整数。');
  const base = { taskId: task?.id ?? null, documentId: doc.id, revision: doc.revision, kind: query.kind };
  if (query.kind === 'prd') return { ...base, ...readText(doc.prd, query) };
  if (query.kind === 'source') return { ...base, ...readText(source, query) };
  if (query.kind === 'prd-diff') {
    if (task && !task.includePrdChanges) fail('本轮未选择处理 PRD 差异。');
    const events = pendingPrdEvents(doc);
    const text = events.map(event => `# r${event.revision}\n${prdChangeDiff(event)}`).join('\n\n');
    return { ...base, pendingCount: events.length, ...readText(text, query, true) };
  }
  const filters = ['ids', 'anchorId', 'selector', 'search'].filter(key => own(query, key));
  if (filters.length !== 1) fail('说明读取需要指定且只指定 ids、anchorId、selector 或 search 之一。');
  let match;
  if (own(query, 'ids')) {
    if (!Array.isArray(query.ids) || !query.ids.length || query.ids.length > 20 || query.ids.some(id => typeof id !== 'string' || !/^ann-[A-Za-z0-9_-]+$/.test(id))) fail('ids 需要 1～20 个 ann-ID。');
    const ids = new Set(query.ids); match = annotation => ids.has(annotation.id);
  } else if (own(query, 'anchorId')) { const id = nonempty(query.anchorId, 'anchorId'); match = annotation => annotation.anchor?.id === id; }
  else if (own(query, 'selector')) { const selector = nonempty(query.selector, 'selector'); match = annotation => annotation.anchor?.selector === selector; }
  else { const search = nonempty(query.search, 'search'); match = annotation => annotation.body.includes(search); }
  const all = Object.values(doc.annotations).filter(annotation => annotation.kind === 'explanation' && !annotation.needsTypeConfirmation && match(annotation));
  const offset = query.offset ?? 0, limit = positiveInteger(query.limit ?? 10, 'limit', 20), selected = all.slice(offset, offset + limit);
  return { ...base, totalMatches: all.length, explanations: selected.map(annotationContext),
    ...(query.ids ? { unavailableIds: query.ids.filter(id => !all.some(annotation => annotation.id === id)) } : {}),
    ...(offset + selected.length < all.length ? { nextOffset: offset + selected.length } : {}) };
}
