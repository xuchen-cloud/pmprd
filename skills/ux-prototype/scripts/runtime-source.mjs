import { inspectHtml, checksum } from './document.mjs';

export const normalizeScript = text => text.replace(/\r\n?/g, '\n');
export const scriptFingerprint = text => {
  const normalized = normalizeScript(text);
  return `${normalized.length}:${checksum(normalized)}`;
};
export const sourcePosition = (source, offset) => {
  const lines = source.slice(0, offset).split(/\r\n?|\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
};
export const inlineScripts = source => inspectHtml(source).filter(token => token.type === 'script');

// The preview may remove policy/base tags and normalize newlines. Match script
// contents, then store coordinates relative to that script, not to the iframe.
export function previewScriptMap(source, preview) {
  const original = inlineScripts(source);
  return inlineScripts(preview).flatMap((script, index) => {
    if (script.attrs.src || (script.attrs.type && !/^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(script.attrs.type))) return [];
    const fingerprint = scriptFingerprint(script.content);
    if (!original[index] || fingerprint !== scriptFingerprint(original[index].content)) return [];
    return [{ index, fingerprint, start: sourcePosition(preview, script.contentStart), end: sourcePosition(preview, script.contentEnd) }];
  });
}

// Resolve captured locations only against unchanged script contents. A line
// number by itself is not a trustworthy mapping after another edit or a reflow.
export function runtimeTargetSource(source, anchor, limit = 2400) {
  if (anchor.source?.kind !== 'runtime') return null;
  const locations = anchor.source.locations;
  if (!Array.isArray(locations) || !locations.length || locations.length > 3) return { status: 'unavailable', reason: 'invalid-runtime-source' };
  const scripts = inlineScripts(source), fragments = [];
  let remaining = limit;
  for (const location of locations) {
    if (!location || !Number.isInteger(location.index) || location.index < 0 || typeof location.fingerprint !== 'string' || !Number.isInteger(location.line) || location.line < 1 || !Number.isInteger(location.column) || location.column < 1) continue;
    let script = scripts[location.index];
    if (!script || scriptFingerprint(script.content) !== location.fingerprint) {
      const matches = scripts.filter(item => scriptFingerprint(item.content) === location.fingerprint);
      if (matches.length !== 1) continue;
      [script] = matches;
    }
    const lines = script.content.split(/\r\n?|\n/), line = lines[location.line - 1];
    if (line === undefined || location.column > line.length + 1) continue;
    const lineStarts = [0];
    for (const match of script.content.matchAll(/\r\n?|\n/g)) lineStarts.push(match.index + match[0].length);
    const point = script.contentStart + lineStarts[location.line - 1] + location.column - 1;
    if (fragments.some(fragment => point >= fragment.startOffset && point < fragment.endOffset)) continue;
    const budget = Math.min(remaining, fragments.length ? 400 : locations.length > 1 ? 1600 : limit);
    if (budget < 100) break;
    let startOffset = Math.max(script.contentStart, point - Math.floor(budget / 3));
    let endOffset = Math.min(script.contentEnd, startOffset + budget);
    startOffset = Math.max(script.contentStart, endOffset - budget);
    const start = sourcePosition(source, startOffset), end = sourcePosition(source, endOffset), call = sourcePosition(source, point);
    const html = source.slice(startOffset, endOffset);
    fragments.push({ html, startOffset, endOffset, startLine: start.line, startColumn: start.column, endLine: end.line, line: call.line, column: call.column, truncated: startOffset > script.contentStart || endOffset < script.contentEnd });
    remaining -= html.length;
  }
  if (!fragments.length) return { status: 'unavailable', reason: 'runtime-source-changed' };
  return { status: 'found', matchedBy: 'runtime', language: 'javascript', ...fragments[0], ...(fragments.length > 1 ? { callers: fragments.slice(1) } : {}) };
}
