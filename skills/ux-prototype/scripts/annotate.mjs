import { clone, id, importHtml, metadataBlock, parse, recordAgent, START, END } from './document.mjs';
import { parseHtml, htmlparser2Adapter, selectAll } from './vendor/static-html.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const anchorAttribute = 'data-ux-anchor';
const nonTargets = new Set(['template', 'script', 'style', 'head', 'title', 'meta', 'link', 'base', 'noscript']);

function parseSource(html) {
  // Browsers consume a UTF BOM before HTML tokenization. Use equal-width space
  // here so parse5 sees the same document structure while offsets stay exact.
  const input = html.startsWith('\ufeff') ? ' ' + html.slice(1) : html;
  return parseHtml(input, { treeAdapter: htmlparser2Adapter, sourceCodeLocationInfo: true, scriptingEnabled: true });
}

function selectStatic(selector, root) {
  // A document's :scope is its document element, as with querySelectorAll().
  const documentElement = root.children.find(node => node.name === 'html');
  return selectAll(selector, root, { context: documentElement ? [documentElement] : undefined, relativeSelector: false });
}

// Include template content in the inventory, but not in selector queries. css-select's
// htmlparser2 tree traversal correctly stops at its separate DocumentFragment root.
function inventory(root) {
  const elements = [], comments = [], pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (htmlparser2Adapter.isElementNode(node)) elements.push(node);
    if (htmlparser2Adapter.isCommentNode(node)) comments.push(node);
    if (node.children) pending.push(...[...node.children].reverse());
  }
  return { elements, comments };
}

function metadataRange(html, comments) {
  const markers = marker => comments.filter(node => {
    const loc = node.sourceCodeLocation;
    return loc && html.slice(loc.startOffset, loc.endOffset) === marker;
  });
  const starts = markers(START), ends = markers(END);
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || starts[0].sourceCodeLocation.endOffset > ends[0].sourceCodeLocation.startOffset) fail('文档必须包含唯一且完整的 ux-document 元数据块。');
  return { start: starts[0].sourceCodeLocation.startOffset, end: ends[0].sourceCodeLocation.endOffset };
}

function unwrapSource(html) {
  const roots = selectStatic('script[id="ux-prototype-source"]', parseSource(html));
  if (roots.length > 1) fail('评审导出包含多个业务源码块。');
  if (!roots.length) return html;
  let source;
  try { source = JSON.parse(roots[0].children.map(child => child.data || '').join('')); }
  catch { fail('评审导出的业务源码不是有效 JSON。'); }
  if (typeof source !== 'string') fail('评审导出的业务源码必须是 HTML 字符串。');
  if (selectStatic('script[id="ux-prototype-source"]', parseSource(source)).length) fail('不支持嵌套的评审导出。');
  return source;
}

function cssString(value) {
  return value.replace(/[\u0000-\u001f\u007f"\\]/g, char => char === '"' || char === '\\' ? '\\' + char : '\\' + char.codePointAt(0).toString(16) + ' ');
}

function selectorFor(anchorId) { return `[${anchorAttribute}="${cssString(anchorId)}"]`; }

function applyEdits(source, edits) {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

function validateNotes(notes, options) {
  if (!Array.isArray(notes) || !notes.length) fail('notes 必须是至少包含一条交互说明的数组。');
  if (!object(options)) fail('annotate options 必须是对象。');
  if (own(options, 'summary') && (typeof options.summary !== 'string' || !options.summary.trim())) fail('变更摘要必须是非空文本。');
  if (own(options, 'details') && (!Array.isArray(options.details) || !options.details.length || options.details.some(value => typeof value !== 'string' || !value.trim()))) fail('具体改动说明必须是非空文本数组。');
  if (own(options, 'actorName') && (typeof options.actorName !== 'string' || !options.actorName.trim())) fail('AI 作者名称必须是非空文本。');
  return notes.map((note, index) => {
    const label = `第 ${index + 1} 条说明`;
    if (!object(note)) fail(`${label}必须是对象。`);
    if (Object.keys(note).some(key => !['selector', 'body', 'id', 'kind'].includes(key))) fail(`${label}只支持 selector、body、id 和 kind 字段。`);
    if (typeof note.selector !== 'string' || !note.selector.trim() || typeof note.body !== 'string' || !note.body.trim()) fail(`${label}必须提供非空 selector 和 body。`);
    if (own(note, 'kind') && note.kind !== 'explanation') fail(`${label}只能是 explanation 交互说明。`);
    if (own(note, 'id') && (typeof note.id !== 'string' || !/^ann-[A-Za-z0-9_-]+$/.test(note.id))) fail(`${label}必须使用有效的 ann-ID。`);
    return { ...note, selector: note.selector.trim(), label };
  });
}

/**
 * Attach explanations to uniquely matched static elements, without serializing the
 * DOM or doing file I/O. Failure never exposes a partially updated HTML/document.
 * options: { summary?, details?, actorName? }.
 */
export function annotateHtml(inputHtml, notes, options = {}) {
  const normalizedNotes = validateNotes(notes, options);
  const imported = importHtml(inputHtml);
  // importHtml's general writer normalizes surrounding whitespace. For ordinary
  // HTML, retain the caller's exact text and only insert the metadata block below.
  const source = unwrapSource(imported.imported && imported.report?.sourceFormat === 'plain-html' ? inputHtml : imported.html);
  const root = parseSource(source), { elements, comments } = inventory(root);
  const block = metadataRange(source, comments);
  const activeElements = selectStatic('*', root);
  const sourceCounts = new Map(), anchorCounts = new Map();
  for (const node of activeElements) {
    const offset = node.sourceCodeLocation?.startTag?.startOffset;
    if (offset !== undefined) sourceCounts.set(offset, (sourceCounts.get(offset) || 0) + 1);
  }
  for (const node of elements) {
    if (!own(node.attribs, anchorAttribute)) continue;
    const key = node.attribs[anchorAttribute];
    anchorCounts.set(key, (anchorCounts.get(key) || 0) + 1);
  }
  const anchors = new Map(), anchorEdits = [];
  function query(selector, label) {
    let matches;
    try { matches = selectStatic(selector, root); }
    catch (error) { fail(`${label}的 CSS selector 无效或不支持：${selector}（${error.message}）`); }
    if (matches.length !== 1) fail(`${label}的 selector 必须唯一匹配静态元素，当前匹配 ${matches.length} 个：${selector}。动态元素或 template 内容请在业务源码中提供可定位的静态容器。`);
    const node = matches[0], loc = node.sourceCodeLocation?.startTag;
    if (nonTargets.has(node.name) || !loc || sourceCounts.get(loc.startOffset) !== 1) fail(`${label}的目标不能静态注入锚点：${selector}。请选择有唯一源码起始标签的业务元素，不支持 template、脚本或隐式容器。`);
    if (block && loc.startOffset >= block.start && loc.startOffset < block.end) fail(`${label}不能标注协作文档元数据。`);
    return node;
  }
  function anchorFor(node, label) {
    if (anchors.has(node)) return anchors.get(node);
    let key = node.attribs[anchorAttribute];
    if (own(node.attribs, anchorAttribute)) {
      if (!key.trim()) fail(`${label}的目标已有空 data-ux-anchor，请先修复该锚点。`);
      if (anchorCounts.get(key) !== 1) fail(`${label}的 data-ux-anchor 不唯一：${key}。`);
    } else {
      do { key = id('ux'); } while (anchorCounts.has(key));
      anchorCounts.set(key, 1);
      const start = node.sourceCodeLocation.startTag.startOffset;
      // Parse5 has already recognized this start tag. Inserting after its name
      // also preserves unquoted values and the distinction between x/> and x />.
      const name = source.slice(start + 1, node.sourceCodeLocation.startTag.endOffset).match(/^[^\s/>]+/)?.[0];
      if (!name || name.toLowerCase() !== node.name.toLowerCase()) fail(`${label}的源码起始标签无法安全注入。`);
      const offset = start + name.length + 1;
      anchorEdits.push({ start: offset, end: offset, text: ` ${anchorAttribute}="${key}"` });
    }
    const anchor = { kind: 'element', id: key, selector: selectorFor(key) };
    anchors.set(node, anchor);
    return anchor;
  }
  const targets = normalizedNotes.map(note => ({ ...note, node: query(note.selector, note.label) }));
  const explicitIds = new Map();
  for (const note of targets) {
    if (!note.id) continue;
    const previous = imported.doc.annotations[note.id];
    if (previous && (previous.kind !== 'explanation' || previous.needsTypeConfirmation)) fail(`${note.label}不能覆写修改意见或未分类标注：${note.id}。`);
    const repeated = explicitIds.get(note.id);
    if (repeated && (repeated.node !== note.node || repeated.body !== note.body)) fail(`同一批次对 ${note.id} 提供了互相冲突的说明。`);
    explicitIds.set(note.id, note);
  }
  // Resolve old annotations only for conservative deduplication, never to guess
  // which explanation a different body was meant to overwrite.
  const resolvedNodes = new Map();
  function annotationNode(annotation) {
    if (resolvedNodes.has(annotation.id)) return resolvedNodes.get(annotation.id);
    let matches = [];
    if (annotation.anchor.kind === 'element') {
      if (annotation.anchor.id) matches = activeElements.filter(node => node.attribs[anchorAttribute] === annotation.anchor.id);
      else {
        try { matches = selectStatic(annotation.anchor.selector, root); } catch { /* Unresolvable old selector is not a deduplication candidate. */ }
      }
    }
    const node = matches.length === 1 ? matches[0] : null;
    resolvedNodes.set(annotation.id, node);
    return node;
  }
  const planned = new Map(Object.entries(imported.doc.annotations));
  const updates = new Map(), addedIds = new Set(), updatedIds = new Set(), unchangedIds = new Set();
  const reservedIds = new Set([...planned.keys(), ...explicitIds.keys()]);
  for (const note of targets) {
    const anchor = anchorFor(note.node, note.label);
    const previous = note.id ? planned.get(note.id) : [...planned.values()].find(annotation => annotation.kind === 'explanation' && !annotation.needsTypeConfirmation && annotation.body === note.body && annotationNode(annotation) === note.node);
    if (previous && previous.body === note.body && previous.anchor.kind === 'element' && previous.anchor.id === anchor.id && annotationNode(previous) === note.node) {
      if (!updates.has(previous.id)) unchangedIds.add(previous.id);
      continue;
    }
    let annotationId = note.id || previous?.id;
    if (!annotationId) {
      do { annotationId = id('ann'); } while (reservedIds.has(annotationId));
      reservedIds.add(annotationId);
    }
    // A body edit on the same target must retain its captured page/tab context.
    // Retargeting cannot safely reuse the old location's navigation information.
    const retained = previous && annotationNode(previous) === note.node ? Object.fromEntries(['view', 'tabs'].filter(key => own(previous.anchor, key)).map(key => [key, previous.anchor[key]])) : {};
    const update = { id: annotationId, kind: 'explanation', body: note.body, anchor: { ...clone(retained), ...clone(anchor) } };
    planned.set(annotationId, { ...clone(previous), ...update });
    resolvedNodes.set(annotationId, note.node);
    updates.set(annotationId, update);
    unchangedIds.delete(annotationId);
    (own(imported.doc.annotations, annotationId) ? updatedIds : addedIds).add(annotationId);
  }
  const resultBase = { imported: imported.imported, addedIds: [...addedIds], updatedIds: [...updatedIds], unchangedIds: [...unchangedIds], report: imported.report };
  if (!updates.size && !anchorEdits.length) return { html: imported.imported ? imported.html : inputHtml, doc: imported.doc, unchanged: !imported.imported, ...resultBase };

  const anchoredSource = applyEdits(source, anchorEdits);
  const summary = options.summary ?? `补充交互说明：新增 ${addedIds.size} 条，更新 ${updatedIds.size} 条`;
  const details = options.details ?? [...updates.values()].map(update => `${addedIds.has(update.id) ? '新增' : '更新'}交互说明 ${update.id}：${update.body}`);
  const doc = recordAgent(imported.doc, { summary, details, actorName: options.actorName ?? 'AI', annotationUpdates: [...updates.values()], uxBefore: source, uxAfter: anchoredSource });
  if (doc.uxVersion !== imported.doc.uxVersion) fail('添加说明意外改变了业务源码，已取消全部标注。');
  let metadataEdit;
  if (block) metadataEdit = { ...block, text: metadataBlock(doc) };
  else {
    const body = activeElements.find(node => node.name === 'body');
    const offset = body?.sourceCodeLocation?.endTag?.startOffset;
    if (offset === undefined) fail('需要包含明确 body 结束标签的完整 HTML 文件。');
    metadataEdit = { start: offset, end: offset, text: metadataBlock(doc) + '\n' };
  }
  const html = applyEdits(source, [...anchorEdits, metadataEdit]);
  parse(html);
  const finalRoot = parseSource(html);
  for (const anchor of anchors.values()) if (selectStatic(anchor.selector, finalRoot).length !== 1) fail(`结果中的稳定锚点不唯一，已取消全部标注：${anchor.id}。`);
  return { html, doc, unchanged: false, ...resultBase };
}
