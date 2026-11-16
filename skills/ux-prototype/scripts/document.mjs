// Browser-safe canonical document model shared by the workbench, DSH host and CLI.
import { makePrdPatch, validatePrdPatch, prdPatchDiff, applyPrdOps } from './prd-patch.mjs';
export { applyPrdPatch, applyPrdOps } from './prd-patch.mjs';
export const FORMAT = 'ux-review-document';
export const START = '<!-- ux-document:start -->';
export const END = '<!-- ux-document:end -->';
export const now = () => new Date().toISOString();
export function id(prefix) {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) fail('当前环境缺少安全随机数 API。');
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => JSON.stringify(value, function (_key, item) {
  return object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const same = (a, b) => stable(a) === stable(b);
const fail = message => { throw new Error(message); };
const author = (value, fallback = 'human', name = fallback === 'agent' ? 'AI' : '产品') => object(value) && ['human', 'agent'].includes(value.kind)
  ? { ...clone(value), name: typeof value.name === 'string' && value.name.trim() ? value.name : name }
  : { kind: fallback, name: typeof value === 'string' && value.trim() ? value : name };

// Skip raw-text elements and HTML comments, so JSON/string content in business scripts
// cannot masquerade as another metadata block or closing body tag.
export function inspectHtml(html) {
  if (typeof html !== 'string') fail('HTML 必须是字符串。');
  const tokens = [], pattern = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b(?:"[^"]*"|'[^']*'|[^'">])*>|<\/body\s*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const start = match.index, open = match[0];
    if (open.startsWith('<!--')) { tokens.push({ type: 'comment', start, end: pattern.lastIndex, text: open }); continue; }
    if (!match[1]) { tokens.push({ type: 'body-end', start, end: pattern.lastIndex }); continue; }
    const tag = match[1].toLowerCase();
    const endPattern = new RegExp(`</${tag}\\s*>`, 'gi'); endPattern.lastIndex = pattern.lastIndex;
    const closing = endPattern.exec(html);
    if (!closing) fail(`HTML 中的 ${tag} 元素未闭合。`);
    const attrs = {};
    for (const attr of open.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4];
    tokens.push({ type: tag, start, contentStart: pattern.lastIndex, contentEnd: closing.index, end: endPattern.lastIndex, content: html.slice(pattern.lastIndex, closing.index), attrs });
    pattern.lastIndex = endPattern.lastIndex;
  }
  return tokens;
}

function documentBlock(html, required = true) {
  const tokens = inspectHtml(html);
  const scripts = tokens.filter(t => t.type === 'script' && t.attrs.id === 'ux-document');
  const starts = tokens.filter(t => t.type === 'comment' && t.text === START);
  const ends = tokens.filter(t => t.type === 'comment' && t.text === END);
  if (!scripts.length && !starts.length && !ends.length && !required) return null;
  if (scripts.length !== 1 || starts.length !== 1 || ends.length !== 1) fail('文档必须包含唯一且完整的 ux-document 元数据块。');
  const script = scripts[0], begin = starts[0], end = ends[0];
  if (script.attrs.type !== 'application/json' || begin.end > script.start || script.end > end.start || html.slice(begin.end, script.start).trim() || html.slice(script.end, end.start).trim()) fail('ux-document 元数据块结构无效。');
  return { start: begin.start, end: end.end, json: script.content };
}

export function normalize(value) {
  const doc = clone(value);
  if (!object(doc) || doc.format !== FORMAT || doc.schemaVersion !== 1) fail('不支持的文件格式版本，请升级程序或转换文件。');
  if (!object(doc.annotations)) return doc;
  for (const [key, a] of Object.entries(doc.annotations)) {
    if (!object(a)) continue;
    // Older preview picks used null for targets without a static anchor.
    // Keep their selector/context and use the protocol's absent-ID form.
    if (a.anchor?.id === null) delete a.anchor.id;
    if (!a.kind) {
      // Earlier exploratory files did not distinguish durable explanations from requests.
      // Preserve their exact annotation and require a deliberate type decision before AI use.
      const original = clone(a);
      a.kind = 'explanation'; a.needsTypeConfirmation = true;
      a.legacy = { ...(a.legacy || {}), unclassifiedAnnotation: original };
      delete a.status; delete a.assignee; delete a.resolution;
    }
    a.createdBy = a.createdBy ? clone(a.createdBy) : author(a.author);
    a.updatedBy = a.updatedBy ? clone(a.updatedBy) : author(a.createdBy);
    a.createdAt ||= a.at || doc.createdAt;
    a.updatedAt ||= a.createdAt;
    if (a.kind === 'change-request') {
      a.assignee ||= { kind: 'unassigned' };
      a.status ||= 'open';
    }
    // Keep unknown extension fields and the legacy author for lossless round trips.
    if (!a.id) a.id = key;
  }
  return doc;
}

export function validate(doc) {
  if (!object(doc) || doc.format !== FORMAT || doc.schemaVersion !== 1) fail('不支持的文件格式版本，请升级程序或转换文件。');
  if (typeof doc.id !== 'string' || !doc.id.trim() || typeof doc.title !== 'string' || typeof doc.prd !== 'string') fail('缺少文档身份、标题或 PRD。');
  if (!Number.isInteger(doc.uxVersion) || doc.uxVersion < 1 || !Number.isInteger(doc.revision) || doc.revision < 0) fail('版本号无效。');
  if (!object(doc.annotations) || !Array.isArray(doc.changes)) fail('标注或变更记录结构无效。');
  if (!Number.isInteger(doc.agentCheckpoint) || doc.agentCheckpoint > doc.revision || doc.agentCheckpoint < 0) fail('Agent 检查点无效。');
  if (!Number.isFinite(Date.parse(doc.createdAt)) || !Number.isFinite(Date.parse(doc.updatedAt))) fail('文档时间无效。');
  if (doc.preferences?.clearResolvedAfterAgent !== undefined && typeof doc.preferences.clearResolvedAfterAgent !== 'boolean') fail('自动清理选项无效。');
  for (const [key, a] of Object.entries(doc.annotations)) {
    if (!object(a) || !/^ann-[A-Za-z0-9_-]+$/.test(key) || key !== a.id || !['explanation', 'change-request'].includes(a.kind)) fail('标注 ID 或类型无效。');
    if (typeof a.body !== 'string' || !a.body.trim() || !object(a.anchor) || !['element', 'region'].includes(a.anchor.kind) || typeof a.anchor.selector !== 'string' || !a.anchor.selector.trim()) fail('标注内容或定位信息缺失。');
    if (a.anchor.id !== undefined && (typeof a.anchor.id !== 'string' || !a.anchor.id.trim())) fail('稳定锚点 ID 无效。');
    if (a.anchor.kind === 'region') {
      const r = a.anchor.region;
      if (!object(r) || ['x', 'y', 'width', 'height'].some(k => !Number.isFinite(r[k]) || r[k] < 0) || r.width <= 0 || r.height <= 0 || r.x + r.width > 1.001 || r.y + r.height > 1.001) fail('区域标注应使用容器内 0～1 的非空归一化坐标。');
    }
    for (const field of ['createdBy', 'updatedBy']) if (!object(a[field]) || !['human', 'agent'].includes(a[field].kind) || typeof a[field].name !== 'string' || !a[field].name.trim()) fail('标注创建者或编辑者无效。');
    if (![a.createdAt, a.updatedAt].every(t => typeof t === 'string' && Number.isFinite(Date.parse(t)))) fail('标注时间无效。');
    if (a.kind === 'explanation') {
      if (a.status !== undefined || a.assignee !== undefined || a.resolution !== undefined) fail('交互说明不能具有修改意见的处理状态。');
    } else {
      if (!['open', 'resolved'].includes(a.status) || !object(a.assignee) || !['unassigned', 'human', 'agent'].includes(a.assignee.kind)) fail('修改意见的处理状态或对象无效。');
    }
  }
  let revision = 0; const eventIds = new Set();
  for (const event of doc.changes) {
    if (!object(event) || typeof event.id !== 'string' || !event.id || eventIds.has(event.id) || typeof event.summary !== 'string' || !event.summary.trim() || !['human', 'agent', 'system'].includes(event.actor) || !Array.isArray(event.patch) || !Array.isArray(event.details) || event.details.some(d => typeof d !== 'string') || !Number.isFinite(Date.parse(event.at))) fail('变更记录缺少必要字段或 ID 重复。');
    if (event.revision !== revision + 1 || !Number.isInteger(event.uxVersion) || event.uxVersion < 1 || event.uxVersion > doc.uxVersion) fail('修订记录必须连续且不超过原型版本。');
    for (const p of event.patch) {
      if (!object(p) || !['add', 'replace', 'remove', 'text'].includes(p.op) || typeof p.path !== 'string' || !p.path.startsWith('/')) fail('变更差异结构无效。');
      if (p.op === 'text') validatePrdPatch(p);
    }
    revision = event.revision; eventIds.add(event.id);
  }
  if (revision !== doc.revision) fail('文档修订号与变更记录不一致。');
  return doc;
}

export function hasDocument(html) { return Boolean(documentBlock(html, false)); }

export function parse(html) {
  const block = documentBlock(html);
  let value;
  try { value = JSON.parse(block.json); } catch { fail('ux-document 不是有效的 JSON。'); }
  return validate(normalize(value));
}

export function sourceOnly(html) {
  const scripts = inspectHtml(html).filter(t => t.type === 'script' && t.attrs.id === 'ux-prototype-source');
  if (scripts.length > 1) fail('评审导出包含多个业务源码块。');
  if (scripts.length) {
    let source;
    try { source = JSON.parse(scripts[0].content); } catch { fail('评审导出的业务源码不是有效 JSON。'); }
    if (typeof source !== 'string') fail('评审导出的业务源码必须是 HTML 字符串。');
    if (inspectHtml(source).some(t => t.type === 'script' && t.attrs.id === 'ux-prototype-source')) fail('不支持嵌套的评审导出。');
    const block = documentBlock(source, false);
    return (block ? source.slice(0, block.start) + source.slice(block.end) : source).trim();
  }
  const block = documentBlock(html, false);
  return (block ? html.slice(0, block.start) + html.slice(block.end) : html).trim();
}

export function auditAnchors(html, doc = parse(html)) {
  const source = sourceOnly(html), tokens = inspectHtml(source);
  let visible = source;
  for (const token of [...tokens].reverse()) {
    const from = token.type === 'comment' ? token.start : token.contentStart;
    const to = token.type === 'comment' ? token.end : token.contentEnd;
    if (from !== undefined) visible = visible.slice(0, from) + ' '.repeat(to - from) + visible.slice(to);
  }
  const counts = new Map();
  for (const match of visible.matchAll(/<[a-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const found = match[0].match(/\sdata-ux-anchor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (found) { const key = found[1] ?? found[2] ?? found[3]; counts.set(key, (counts.get(key) || 0) + 1); }
  }
  return {
    duplicates: [...counts].filter(([, count]) => count > 1).map(([anchorId, count]) => ({ anchorId, count })),
    missing: Object.values(doc.annotations).filter(a => a.anchor.id && !counts.has(a.anchor.id)).map(a => ({ annotationId: a.id, anchorId: a.anchor.id, message: '静态源码未找到稳定锚点；请在相应运行状态中核对或重新绑定。' })),
    unverified: Object.values(doc.annotations).filter(a => !a.anchor.id).map(a => ({ annotationId: a.id, selector: a.anchor.selector, message: '标注没有稳定锚点 ID；静态检查无法验证选择器，请在相应运行状态中核对或重新绑定。' })),
    checked: counts.size,
  };
}

export function serializeJSON(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
export function metadataBlock(doc) {
  validate(doc);
  return `${START}\n<script type="application/json" id="ux-document">\n${serializeJSON(doc)}\n</script>\n${END}`;
}
export function write(html, doc) {
  const source = sourceOnly(html), endings = inspectHtml(source).filter(t => t.type === 'body-end');
  if (!/<html\b/i.test(source) || !endings.length) fail('需要包含 html 与 body 的完整 HTML 文件。');
  const offset = endings.at(-1).start;
  return source.slice(0, offset).trimEnd() + '\n' + metadataBlock(doc) + '\n' + source.slice(offset) + '\n';
}

export function create({ title = '未命名原型', prd = '', uxVersion = 1, legacyHistory = null, design = { id: 'opentiny' } } = {}) {
  const at = now();
  return validate({ format: FORMAT, schemaVersion: 1, id: id('doc'), title, uxVersion, revision: 1, agentCheckpoint: 0, createdAt: at, updatedAt: at, prd, annotations: {}, changes: [{ id: id('change'), actor: 'system', kind: 'created', revision: 1, uxVersion, at, summary: '创建 UX 协作文档', details: ['建立单文件原型、PRD 与变更记录'], patch: [{ op: 'add', path: '/prd', value: prd }] }], preferences: { clearResolvedAfterAgent: false }, design: clone(design), ...(legacyHistory !== null ? { legacyHistory: clone(legacyHistory) } : {}) });
}

export function createAnnotation({ kind = 'explanation', body, anchor, actor = { kind: 'human', name: '产品' }, ...extras }) {
  const at = now(), result = { ...clone(extras), id: extras.id || id('ann'), kind, body, anchor: clone(anchor), createdBy: author(actor), updatedBy: author(actor), createdAt: at, updatedAt: at };
  if (kind === 'change-request') { result.assignee = clone(extras.assignee || { kind: 'unassigned' }); result.status = extras.status || 'open'; }
  return result;
}

function textFromHtml(text) {
  return text.replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n\n' + '#'.repeat(Number(n)) + ' ').replace(/<li[^>]*>/gi, '\n- ').replace(/<\/(p|h[1-6]|ul|ol|div)>/gi, '\n\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

export function importHtml(input) {
  const report = { sourceFormat: 'plain-html', migrated: [], removed: [], unmigrated: [], notes: [] };
  if (documentBlock(input, false)) {
    report.sourceFormat = FORMAT;
    report.notes.push('沿用现有文档身份、PRD、标注和变更记录，不重建文档。');
    return { html: input, doc: parse(input), imported: false, report };
  }
  let html = input, prd = '', title = '', uxVersion = 1, legacyHistory = null;
  const offlinePrefix = /^\s*window\.__PRD_OFFLINE__=/;
  const offline = inspectHtml(html).find(t => t.type === 'script' && offlinePrefix.test(t.content));
  if (offline) {
    const payload = JSON.parse(offline.content.replace(offlinePrefix, '').replace(/;\s*$/, ''));
    if (!object(payload) || typeof payload.prototype !== 'string') fail('旧版评审文件缺少原型源码。');
    report.sourceFormat = '__PRD_OFFLINE__';
    html = payload.prototype;
    if (payload.content?.docs !== undefined && !Array.isArray(payload.content.docs)) fail('旧版离线 docs 必须是数组。');
    const docs = Array.isArray(payload.content?.docs) ? payload.content.docs : [];
    const prdDoc = docs.find(d => d?.id === 'prd'), changesDoc = docs.find(d => d?.id === 'changes');
    prd = prdDoc?.source || ''; legacyHistory = changesDoc?.source || null;
    report.migrated.push({ field: 'prototype', target: 'html', note: '取出业务原型源码。' });
    if (prdDoc?.source) report.migrated.push({ field: 'content.docs[prd].source', target: 'prd', note: '保留 PRD 原文。' });
    if (changesDoc?.source) report.migrated.push({ field: 'content.docs[changes].source', target: 'legacyHistory', note: '保留迁移前历史原文。' });
    report.removed.push({ field: 'offline-review-shell', note: '移除业务原型之外的旧离线评审界面和脚本。' });
    for (const key of Object.keys(payload).filter(key => !['prototype', 'content'].includes(key))) report.unmigrated.push({ field: key, note: '旧离线扩展字段未写入规范文档。' });
    for (const key of Object.keys(payload.content || {}).filter(key => key !== 'docs')) report.unmigrated.push({ field: `content.${key}`, note: '旧内容扩展字段未写入规范文档。' });
    docs.forEach((entry, index) => {
      if (entry !== prdDoc && entry !== changesDoc) report.unmigrated.push({ field: `content.docs[${index}]`, note: '仅迁移首个 prd 和 changes 文档，其他文档未迁移。' });
      else for (const key of Object.keys(entry).filter(key => !['id', 'source'].includes(key))) report.unmigrated.push({ field: `content.docs[${index}].${key}`, note: '文档描述或扩展字段未迁移。' });
    });
    uxVersion = Number(prd.match(/v(\d+)/)?.[1]) || 1;
    if (prd.match(/v(\d+)/)) report.migrated.push({ field: 'content.docs[prd].source', target: 'uxVersion', note: '沿用旧导入规则，从 PRD 的 v数字 提取原型版本。' });
  }
  if (!offline) report.migrated.push({ field: 'html', target: 'html', note: '保留业务原型源码；插入元数据时会调整块边界空白。' });
  const old = inspectHtml(html).find(t => t.type === 'script' && t.attrs.id === 'ux-requirements');
  if (old) {
    const data = JSON.parse(old.content);
    if (!object(data)) fail('旧版 ux-requirements 必须是 JSON 对象。');
    if (!offline) report.sourceFormat = 'ux-requirements';
    const usesPrd = !prd, usesHistory = !legacyHistory;
    prd ||= textFromHtml(data.prd || ''); title = data.title || '';
    uxVersion = Number(data.changes?.at(-1)?.version) || uxVersion; legacyHistory ||= data.changes || data;
    if (data.title) report.migrated.push({ field: 'ux-requirements.title', target: 'title', note: '保留旧文档标题。' });
    if (data.prd) report[usesPrd ? 'migrated' : 'unmigrated'].push({ field: 'ux-requirements.prd', ...(usesPrd ? { target: 'prd' } : {}), note: usesPrd ? '将旧 HTML PRD 转为文本；富文本格式、图片和链接目标不保留。' : '已采用离线 PRD 原文，未合并另一份 PRD。' });
    report[usesHistory ? 'migrated' : 'unmigrated'].push({ field: data.changes ? 'ux-requirements.changes' : 'ux-requirements', ...(usesHistory ? { target: 'legacyHistory' } : {}), note: usesHistory ? '归档原始历史；不转换成新修订事件。' : '已采用离线历史，未合并另一份历史。' });
    if (data.changes?.at(-1)?.version) report.migrated.push({ field: 'ux-requirements.changes[last].version', target: 'uxVersion', note: '沿用旧原型版本。' });
    for (const key of Object.keys(data).filter(key => !['title', 'prd', 'changes'].includes(key))) report.unmigrated.push({ field: `ux-requirements.${key}`, note: usesHistory && !data.changes ? '仅随原始数据归档到 legacyHistory，未映射为规范字段。' : '旧扩展字段未写入规范文档。' });
    const tokens = inspectHtml(html);
    const begin = tokens.find(t => t.type === 'comment' && t.text === '<!-- ux-requirements:start -->');
    const end = tokens.find(t => t.type === 'comment' && t.text === '<!-- ux-requirements:end -->' && t.start >= old.end);
    const shell = begin && end && begin.end <= old.start;
    html = shell ? html.slice(0, begin.start) + html.slice(end.end) : html.slice(0, old.start) + html.slice(old.end);
    report.removed.push({ field: shell ? 'ux-requirements-shell' : 'ux-requirements-script', note: shell ? '移除标记范围内的旧评审界面和元数据。' : '移除旧元数据脚本；未标记的其他旧界面不保证移除。' });
    const withoutButtons = html.replace(/<button\b[^>]*data-ux-docs-open[^>]*>[\s\S]*?<\/button>/g, '');
    if (withoutButtons !== html) report.removed.push({ field: 'data-ux-docs-open', note: '移除旧需求面板入口按钮。' });
    html = withoutButtons;
  }
  if (!title) {
    const htmlTitle = inspectHtml(html).find(t => t.type === 'title')?.content;
    title = textFromHtml(htmlTitle || '导入的 UX 原型');
    if (htmlTitle) report.migrated.push({ field: 'html.title', target: 'title', note: '沿用业务原型的页面标题文本。' });
  }
  if (report.sourceFormat === 'plain-html') report.notes.push('未检测到支持的旧元数据；未推断 PRD、标注或设计体系。');
  else report.notes.push('仅迁移报告列出的内容，不保证旧格式扩展完整无损；请保留原文件。');
  report.notes.push('未识别既有设计依据，design.id 设为 existing。');
  const doc = create({ title, prd, uxVersion, legacyHistory, design: { id: 'existing' } });
  return { html: write(html, doc), doc, imported: true, report };
}

export function prdChangeDiff(event) {
  const incremental = event?.patch?.find(p => p.op === 'text' && p.path === '/prd');
  if (incremental) return prdPatchDiff(incremental);
  // The creation snapshot is authoritative: older init --prd files can have a stale diff.
  // Leave stored events untouched, and retain diff-only legacy creation records.
  if (event?.kind === 'created') {
    const snapshot = event.patch?.find(p => p.path === '/prd' && ['add', 'replace'].includes(p.op) && typeof p.value === 'string');
    if (snapshot) return lineDiff('', snapshot.value);
  }
  return typeof event?.diff?.prd === 'string' ? event.diff.prd : '';
}

export function lineDiff(before = '', after = '') {
  return prdPatchDiff(makePrdPatch(before, after));
}

export function patchBetween(before, after) {
  const patch = [];
  for (const key of ['title', 'prd', 'preferences', 'design']) if (!same(before[key], after[key])) {
    if (key === 'prd') patch.push(makePrdPatch(before.prd, after.prd));
    else patch.push({ op: own(before, key) ? 'replace' : 'add', path: '/' + key, ...(own(before, key) ? { before: clone(before[key]) } : {}), value: clone(after[key]) });
  }
  for (const key of new Set([...Object.keys(before.annotations), ...Object.keys(after.annotations)])) {
    const a = before.annotations[key], b = after.annotations[key];
    if (same(a, b)) continue;
    patch.push({ op: !a ? 'add' : !b ? 'remove' : 'replace', path: '/annotations/' + key, ...(a ? { before: clone(a) } : {}), ...(b ? { value: clone(b) } : {}) });
  }
  return patch;
}

function stampAnnotation(previous, next, editor, at) {
  const a = clone(next);
  // Unsaved recovery drafts can still contain the old preview's null ID.
  if (a.anchor?.id === null) delete a.anchor.id;
  if (previous) { a.createdBy = clone(previous.createdBy); a.createdAt = previous.createdAt; }
  else { a.createdBy = clone(editor); a.createdAt = at; }
  a.updatedBy = clone(editor); a.updatedAt = at;
  if (previous && previous.kind !== a.kind) {
    delete a.needsTypeConfirmation;
    if (a.kind === 'explanation') { delete a.status; delete a.assignee; delete a.resolution; }
    else { a.status = 'open'; a.assignee = { kind: 'unassigned' }; delete a.resolution; }
  }
  if (a.kind === 'change-request') {
    a.assignee ||= { kind: 'unassigned' }; a.status ||= 'open';
    if (a.status === 'open') delete a.resolution;
    else if (!previous || previous.status !== 'resolved') a.resolution = { by: clone(editor), at, summary: a.resolution?.summary || '已处理' };
  }
  return a;
}

export function recordHuman(before, draft, summary = '', actorName = '产品') {
  validate(before);
  const result = clone(before), at = now(), editor = author({ kind: 'human', name: actorName });
  for (const field of ['title', 'prd', 'preferences', 'annotations', 'design']) if (own(draft, field)) result[field] = clone(draft[field]);
  for (const [key, a] of Object.entries(result.annotations)) if (!same(before.annotations[key], a)) result.annotations[key] = stampAnnotation(before.annotations[key], a, editor, at);
  const patch = patchBetween(before, result);
  if (!patch.length) return result;
  result.revision++; result.updatedAt = at;
  const details = patch.map(op => op.path === '/prd' ? '修改 PRD' : op.path === '/preferences' ? '修改意见清理设置' : op.path === '/title' ? '修改文档标题' : op.path === '/design' ? '修改设计依据' : `${op.op === 'add' ? '新增' : op.op === 'remove' ? '删除' : '修改'}${(op.value || op.before).kind === 'explanation' ? '交互说明' : '修改意见'}：${(op.value || op.before).body}`);
  result.changes.push({ id: id('change'), actor: 'human', author: editor, kind: 'review', revision: result.revision, uxVersion: result.uxVersion, at, summary: summary.trim() || details.join('；').slice(0, 140), details, patch });
  return validate(result);
}

export function hasPrototypeChanges(before, after) {
  const comparable = html => {
    const source = sourceOnly(html || '<html><body></body></html>');
    const tokens = inspectHtml(source);
    return source.replace(/<[a-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, (tag, offset) => {
      if (tokens.some(t => t.type === 'comment' ? offset >= t.start && offset < t.end : t.contentStart !== undefined && offset >= t.contentStart && offset < t.contentEnd)) return tag;
      return tag.replace(/\s+data-ux-anchor\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    });
  };
  return comparable(before) !== comparable(after);
}

export function recordAgent(before, options) {
  validate(before);
  const { summary, details, selectedIds = [], resolvedIds = [], clearResolved = false, uxBefore = '', uxAfter = '', annotationUpdates = [], removeAnnotationIds = [], actorName = 'AI', taskId } = options;
  if (typeof summary !== 'string' || !summary.trim() || !Array.isArray(details) || !details.length || details.some(d => typeof d !== 'string' || !d.trim())) fail('AI 修改必须提供变更摘要与具体改动说明。');
  for (const ids of [selectedIds, resolvedIds, removeAnnotationIds]) if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string') || new Set(ids).size !== ids.length) fail('修改意见范围必须是无重复 ID 的数组。');
  if (typeof clearResolved !== 'boolean' || !Array.isArray(annotationUpdates)) fail('AI 修改参数无效。');
  if (taskId && before.changes.some(c => c.taskId === taskId)) fail('本轮任务已经交付，不能重复追加。');
  const selected = new Set(selectedIds), resolved = new Set(resolvedIds);
  for (const key of selected) if (before.annotations[key]?.kind !== 'change-request' || before.annotations[key]?.needsTypeConfirmation) fail('任务只能选择已确认类型的修改意见：' + key);
  for (const key of resolved) if (!selected.has(key)) fail('不能处理本轮未指定的修改意见：' + key);
  for (const key of removeAnnotationIds) if (!clearResolved || !resolved.has(key)) fail('AI 删除只允许本轮指定并已处理、已开启清理的修改意见。');
  const result = clone(before), at = now(), editor = author({ kind: 'agent', name: actorName });
  if (own(options, 'prd') && own(options, 'prdOps')) fail('prd 和 prdOps 不能同时提供。');
  if (own(options, 'prd')) { if (typeof options.prd !== 'string') fail('PRD 必须是文本。'); result.prd = options.prd; }
  if (own(options, 'prdOps')) result.prd = applyPrdOps(before.prd, options.prdOps);
  if (own(options, 'title')) result.title = options.title;
  const updatedIds = new Set();
  for (const update of annotationUpdates) {
    if (!object(update) || typeof update.id !== 'string' || !/^ann-[A-Za-z0-9_-]+$/.test(update.id) || updatedIds.has(update.id)) fail('AI 标注修改必须指定唯一且有效的 ann-ID。');
    updatedIds.add(update.id);
    const previous = result.annotations[update.id];
    if (previous?.needsTypeConfirmation) fail('旧标注需要人工确认类型后才能交给 AI 更新。');
    if (previous?.kind === 'change-request' && !selected.has(update.id)) fail('不能改写本轮未指定的修改意见：' + update.id);
    const merged = previous ? { ...clone(previous), ...clone(update) } : createAnnotation({ ...update, actor: editor });
    // Converting a permanent explanation into a request requires an explicit human decision.
    if (previous?.kind === 'explanation' && merged.kind !== 'explanation') fail('AI 不能把交互说明自动转为修改意见。');
    result.annotations[update.id] = stampAnnotation(previous, merged, editor, at);
  }
  for (const key of resolved) {
    const a = result.annotations[key];
    if (a?.kind !== 'change-request') fail('交互说明不能标记完成或自动清理：' + key);
    a.status = 'resolved'; a.updatedAt = at; a.updatedBy = editor;
    a.resolution = { by: editor, at, summary, ...(taskId ? { taskId } : {}) };
  }
  const cleared = clearResolved ? [...resolved] : [];
  // Preserve the resolved state in the same event before removing the active annotation.
  const resolvedSnapshots = Object.fromEntries(cleared.map(key => [key, clone(result.annotations[key])]));
  for (const key of cleared) delete result.annotations[key];
  const sourceChanged = hasPrototypeChanges(uxBefore, uxAfter);
  const patch = patchBetween(before, result);
  result.uxVersion += sourceChanged ? 1 : 0; result.revision++; result.updatedAt = at;
  result.changes.push({ id: id('change'), actor: 'agent', author: editor, kind: sourceChanged ? 'prototype' : 'documentation', revision: result.revision, uxVersion: result.uxVersion, at, summary, details, patch, diff: { ux: { changed: sourceChanged, before: checksum(uxBefore), after: checksum(uxAfter) } }, selectedAnnotationIds: [...selected], resolvedAnnotationIds: [...resolved], resolvedIds: [...resolved], clearedAnnotationIds: cleared, ...(cleared.length ? { resolvedSnapshots } : {}), basedOnRevision: before.revision, baseRevision: before.revision, ...(taskId ? { taskId } : {}) });
  result.agentCheckpoint = result.revision;
  return validate(result);
}

// Audit display fingerprint only; hosts/CLI use SHA-256 for file conflicts.
export function checksum(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); }

export function review(doc) {
  validate(doc);
  const annotations = Object.values(doc.annotations);
  return { id: doc.id, title: doc.title, uxVersion: doc.uxVersion, revision: doc.revision, agentCheckpoint: doc.agentCheckpoint, prd: doc.prd, design: doc.design, explanations: annotations.filter(a => a.kind === 'explanation'), openAnnotations: annotations.filter(a => a.kind === 'change-request' && a.status === 'open' && !a.needsTypeConfirmation), changeRequests: annotations.filter(a => a.kind === 'change-request'), unclassifiedAnnotations: annotations.filter(a => a.needsTypeConfirmation), humanChangesSinceAgent: doc.changes.filter(e => e.actor === 'human' && e.revision > doc.agentCheckpoint), preferences: doc.preferences };
}
