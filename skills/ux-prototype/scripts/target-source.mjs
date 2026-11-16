import { parseHtml, htmlparser2Adapter, selectAll } from './vendor/static-html.mjs';
import { runtimeTargetSource } from './runtime-source.mjs';

const limit = 2400;
const nonTargets = new Set(['template', 'script', 'style', 'head', 'title', 'meta', 'link', 'base', 'noscript']);
const normalizeText = value => value.replace(/\s+/g, ' ').trim();
const textContent = node => nonTargets.has(node.name) ? '' : node.type === 'text' ? node.data : (node.children || []).map(textContent).join('');
const unavailable = (reason, extra = {}) => ({ status: 'unavailable', reason, ...extra });

// Parse once per task. Offsets refer to the exact business source supplied by Host.
// This never executes HTML or guesses a runtime element from its label.
export function targetSources(source, anchors) {
  if (!anchors.length) return [];
  if (typeof source !== 'string') return anchors.map(() => unavailable('source-not-provided'));
  const input = source.startsWith('\ufeff') ? ' ' + source.slice(1) : source;
  let root;
  try { root = parseHtml(input, { treeAdapter: htmlparser2Adapter, sourceCodeLocationInfo: true, scriptingEnabled: true }); }
  catch { return anchors.map(() => unavailable('invalid-source')); }
  const documentElement = root.children.find(node => node.name === 'html');
  const query = selector => selectAll(selector, root, { context: documentElement ? [documentElement] : undefined, relativeSelector: false });
  const elements = query('*'), offsets = new Map();
  for (const node of elements) {
    const offset = node.sourceCodeLocation?.startTag?.startOffset;
    if (offset !== undefined) offsets.set(offset, (offsets.get(offset) || 0) + 1);
  }
  return anchors.map(anchor => {
    const runtime = anchor && runtimeTargetSource(source, anchor, limit);
    if (runtime) return runtime;
    let matches = [], matchedBy = 'selector';
    if (anchor?.id) {
      matches = elements.filter(node => node.attribs['data-ux-anchor'] === anchor.id);
      matchedBy = 'anchor';
      if (matches.length > 1) return unavailable('ambiguous-anchor', { matches: matches.length });
    }
    if (!matches.length) {
      if (typeof anchor?.selector !== 'string' || !anchor.selector.trim()) return unavailable('missing-selector');
      try { matches = query(anchor.selector); matchedBy = 'selector'; }
      catch { return unavailable('unsupported-selector'); }
    }
    if (matches.length !== 1) return unavailable(matches.length ? 'ambiguous-selector' : 'not-in-static-source', { matches: matches.length });
    const node = matches[0], loc = node.sourceCodeLocation;
    for (let ancestor = node; ancestor; ancestor = ancestor.parent) if (nonTargets.has(ancestor.name)) return unavailable('non-business-element');
    if (!loc?.startTag || offsets.get(loc.startTag.startOffset) !== 1) return unavailable('no-unique-source-location');
    if (anchor.tag && (typeof anchor.tag !== 'string' || anchor.tag.toLowerCase() !== node.name.toLowerCase())) return unavailable('tag-mismatch');
    if (matchedBy === 'selector' && anchor.text && !node.attribs.id && (typeof anchor.text !== 'string' || !normalizeText(textContent(node)).includes(normalizeText(anchor.text)))) return unavailable('text-mismatch');
    const startOffset = loc.startTag.startOffset, endOffset = loc.endOffset;
    const full = source.slice(startOffset, endOffset), html = full.slice(0, limit);
    return { status: 'found', matchedBy, startLine: loc.startLine, endLine: loc.endLine, startOffset, endOffset,
      html, truncated: full.length > limit, ...(full.length > limit ? { totalChars: full.length, instruction: '片段已截断；需要剩余内容时按 source 行号继续读取。' } : {}) };
  });
}
