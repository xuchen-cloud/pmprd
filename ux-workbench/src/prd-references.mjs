import { marked } from 'marked';
import { tokenizePrdReferences as sharedTokens, getAnnotationReferences as sharedReferences } from '../../skills/ux-prototype/scripts/prd-references.mjs';

const ANNOTATION_ID = /^ann-[A-Za-z0-9_-]+$/;

export function annotationReferenceMarkdown(annotationId) {
  if (!ANNOTATION_ID.test(annotationId || '')) throw new Error('标注引用需要有效的 ann-ID。');
  return `@annotation(${annotationId})`;
}

// Only top-level paragraph lines are references. Code fences, indented code,
// HTML blocks, lists and blockquotes keep their original Markdown meaning.
export function tokenizePrdReferences(source, lexer = value => marked.lexer(value)) {
  return sharedTokens(source, lexer);
}

export function getAnnotationReferences(value = '') {
  return sharedReferences(value, source => marked.lexer(source));
}

export function getReferencedIds(value) {
  return [...new Set(getAnnotationReferences(value).map(reference => reference.annotationId))];
}

export function appendAnnotationReference(value = '', annotationId) {
  const syntax = annotationReferenceMarkdown(annotationId), source = String(value);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const separator = !source || source.endsWith(newline + newline) ? '' : source.endsWith(newline) ? newline : newline + newline;
  return source + separator + syntax + newline;
}

// selectionStart uses the textarea's normalized LF offsets, even when the
// authoritative Markdown still contains CRLF. Preserve all original bytes.
export function insertAnnotationReference(value = '', annotationId, selectionStart = 0) {
  const syntax = annotationReferenceMarkdown(annotationId), source = String(value);
  const normalized = source.replace(/\r\n?|\n/g, '\n'), newline = source.includes('\r\n') ? '\r\n' : '\n';
  const offsets = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\r' && source[index + 1] === '\n') index++;
    offsets.push(index + 1);
  }
  let position = Math.max(0, Math.min(Number.isFinite(selectionStart) ? selectionStart : 0, normalized.length));
  const tokens = tokenizePrdReferences(normalized);
  if (tokens.map(token => token.raw).join('') !== normalized) throw new Error('当前 Markdown 格式无法安全确定引用位置，请在独立行插入引用。');
  let offset = 0;
  for (const token of tokens) {
    const end = offset + token.raw.length;
    if (position >= offset && position < end && !['paragraph', 'text', 'space'].includes(token.type)) {
      position = end; break;
    }
    offset = end;
  }
  const rawPosition = offsets[position], before = source.slice(0, rawPosition), after = source.slice(rawPosition);
  const beforeGap = !before || /\n[\t ]*\r?\n$/.test(before) ? '' : before.endsWith('\n') ? newline : newline + newline;
  const afterGap = !after ? newline : /^(?:\r?\n){2}/.test(after) ? '' : after.startsWith('\n') || after.startsWith('\r\n') ? newline : newline + newline;
  const next = before + beforeGap + syntax + afterGap + after;
  const reference = getAnnotationReferences(next).find(item => item.annotationId === annotationId && item.start === before.length + beforeGap.length);
  if (!reference) throw new Error('未能在当前位置创建独立说明引用，原文已保留。');
  return { value: next, referenceId: reference.referenceId, cursor: (before + beforeGap + syntax).replace(/\r\n?|\n/g, '\n').length };
}

export function removeAnnotationReference(value, referenceId) {
  const reference = getAnnotationReferences(value).find(item => item.referenceId === referenceId);
  return reference ? value.slice(0, reference.start) + value.slice(reference.end) : value;
}

export function splitPrdReferences(value = '') {
  const source = String(value), references = getAnnotationReferences(source), parts = [];
  let offset = 0;
  for (const reference of references) {
    if (reference.start > offset) parts.push({ type: 'markdown', source: source.slice(offset, reference.start), key: `text-${offset}` });
    parts.push({ type: 'annotation', reference, key: reference.referenceId });
    offset = reference.end;
  }
  if (offset < source.length || !parts.length) parts.push({ type: 'markdown', source: source.slice(offset), key: `text-${offset}` });
  return parts;
}
