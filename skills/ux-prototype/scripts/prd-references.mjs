// Shared by the standalone task context and the browser editor. Callers supply
// their existing Markdown lexer so the browser never bundles a second copy.
const REFERENCE_LINE = /^ {0,3}@annotation\((ann-[A-Za-z0-9_-]+)\)[\t ]*(?:\n|$)/gm;

// Only top-level paragraph lines are references. Code fences, indented code,
// HTML blocks, lists and blockquotes keep their original Markdown meaning.
export function tokenizePrdReferences(source, lexer) {
  const tokens = lexer(source);
  return tokens.flatMap(token => {
    if (!['paragraph', 'text'].includes(token.type)) return [token];
    const result = [];
    let offset = 0;
    for (const match of token.raw.matchAll(REFERENCE_LINE)) {
      if (match.index > offset) result.push(...lexer(token.raw.slice(offset, match.index)));
      result.push({ type: 'annotationReference', raw: match[0], annotationId: match[1] });
      offset = match.index + match[0].length;
    }
    if (!result.length) return [token];
    if (offset < token.raw.length) result.push(...lexer(token.raw.slice(offset)));
    return result;
  });
}

function originalOffsets(source) {
  const offsets = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\r' && source[index + 1] === '\n') index++;
    offsets.push(index + 1);
  }
  return offsets;
}

export function getAnnotationReferences(value = '', lexer) {
  const source = String(value), normalized = source.replace(/\r\n?|\n/g, '\n');
  const tokens = tokenizePrdReferences(normalized, lexer), offsets = originalOffsets(source);
  const occurrences = new Map(), references = [];
  let offset = 0;
  for (const token of tokens) {
    if (token.type === 'annotationReference') {
      const occurrence = (occurrences.get(token.annotationId) || 0) + 1;
      occurrences.set(token.annotationId, occurrence);
      const start = offsets[offset], end = offsets[offset + token.raw.length];
      references.push({
        annotationId: token.annotationId,
        referenceId: `${token.annotationId}:${occurrence}`,
        occurrence, index: references.length + 1, start, end,
        line: source.slice(0, start).split(/\r\n?|\n/).length,
      });
    }
    offset += token.raw.length;
  }
  return references;
}
