// Line-based, reversible PRD edits. Current text stays in doc.prd; history stores
// changed lines once, without another copy of either full document.
const fail = message => { throw new Error(message); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validatePrdPatch(patch) {
  if (patch?.op !== 'text' || patch.path !== '/prd' || patch.encoding !== 'lines-v1' ||
      !Number.isInteger(patch.beforeLines) || patch.beforeLines < 1 ||
      !Number.isInteger(patch.afterLines) || patch.afterLines < 1 || !Array.isArray(patch.hunks) || !patch.hunks.length) fail('PRD 增量差异结构无效。');
  let end = 0, delta = 0;
  for (const h of patch.hunks) {
    if (!h || !Number.isInteger(h.start) || h.start < end || h.start > patch.beforeLines ||
        !Array.isArray(h.removed) || !Array.isArray(h.added) || !h.removed.length && !h.added.length ||
        [...h.removed, ...h.added].some(line => typeof line !== 'string' || line.includes('\n')) ||
        h.start + h.removed.length > patch.beforeLines) fail('PRD 增量差异行范围无效。');
    end = h.start + h.removed.length;
    delta += h.added.length - h.removed.length;
  }
  if (patch.beforeLines + delta !== patch.afterLines) fail('PRD 增量差异行数不一致。');
  return patch;
}

// Myers' shortest edit path is inexpensive for the small, repeated edits this
// format targets. Bound the trace for wholesale rewrites, preserving common ends.
function edits(a, b) {
  if (!a.length) return b.map(text => ['+', text]);
  if (!b.length) return a.map(text => ['-', text]);
  const trace = [], frontier = new Map([[1, 0]]);
  for (let d = 0; d <= a.length + b.length; d++) {
    if (d * d > 1000000) return [...a.map(text => ['-', text]), ...b.map(text => ['+', text])];
    trace.push(new Map(frontier));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || k !== d && (frontier.get(k - 1) ?? -Infinity) < (frontier.get(k + 1) ?? -Infinity)
        ? (frontier.get(k + 1) ?? 0) : (frontier.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
      frontier.set(k, x);
      if (x < a.length || y < b.length) continue;
      const result = [];
      for (let depth = d; depth >= 0; depth--) {
        const previous = trace[depth], diagonal = x - y;
        const previousK = diagonal === -depth || diagonal !== depth && (previous.get(diagonal - 1) ?? -Infinity) < (previous.get(diagonal + 1) ?? -Infinity) ? diagonal + 1 : diagonal - 1;
        const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK;
        while (x > previousX && y > previousY) { result.push([' ', a[--x]]); y--; }
        if (!depth) break;
        if (x === previousX) result.push(['+', b[--y]]);
        else result.push(['-', a[--x]]);
      }
      return result.reverse();
    }
  }
}

export function makePrdPatch(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') fail('PRD 必须是文本。');
  if (before === after) return null;
  const a = before.split('\n'), b = after.split('\n');
  let start = 0, aEnd = a.length, bEnd = b.length;
  while (start < aEnd && start < bEnd && a[start] === b[start]) start++;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd--; }
  const hunks = []; let position = start, current = null;
  for (const [kind, text] of edits(a.slice(start, aEnd), b.slice(start, bEnd))) {
    if (kind === ' ') { current = null; position++; continue; }
    if (!current) { current = { start: position, removed: [], added: [] }; hunks.push(current); }
    if (kind === '-') { current.removed.push(text); position++; }
    else current.added.push(text);
  }
  return validatePrdPatch({ op: 'text', path: '/prd', encoding: 'lines-v1', beforeLines: a.length, afterLines: b.length, hunks });
}

export function applyPrdPatch(text, patch, { reverse = false } = {}) {
  validatePrdPatch(patch);
  if (typeof text !== 'string') fail('PRD 必须是文本。');
  const lines = text.split('\n'), output = []; let cursor = 0, delta = 0;
  if (lines.length !== (reverse ? patch.afterLines : patch.beforeLines)) fail('PRD 增量差异基线行数不匹配。');
  for (const h of patch.hunks) {
    const start = h.start + (reverse ? delta : 0), removed = reverse ? h.added : h.removed, added = reverse ? h.removed : h.added;
    if (!equal(lines.slice(start, start + removed.length), removed)) fail('PRD 增量差异原文不匹配。');
    for (let i = cursor; i < start; i++) output.push(lines[i]);
    for (const line of added) output.push(line);
    cursor = start + removed.length;
    delta += h.added.length - h.removed.length;
  }
  for (let i = cursor; i < lines.length; i++) output.push(lines[i]);
  return output.join('\n');
}

export function prdPatchDiff(patch) {
  if (!patch) return '';
  validatePrdPatch(patch);
  const lines = ['--- before', '+++ after']; let delta = 0;
  for (const h of patch.hunks) {
    const oldLine = h.start + (h.removed.length ? 1 : 0), newLine = h.start + delta + (h.added.length ? 1 : 0);
    lines.push(`@@ -${oldLine},${h.removed.length} +${newLine},${h.added.length} @@`);
    for (const line of h.removed) lines.push('-' + line);
    for (const line of h.added) lines.push('+' + line);
    delta += h.added.length - h.removed.length;
  }
  return lines.join('\n');
}

export function applyPrdOps(prd, operations) {
  if (typeof prd !== 'string' || !Array.isArray(operations)) fail('prdOps 必须是局部替换操作数组。');
  let next = prd;
  for (const op of operations) {
    if (!op || typeof op !== 'object' || Array.isArray(op) || Object.keys(op).some(key => !['find', 'replace'].includes(key)) || typeof op.find !== 'string' || typeof op.replace !== 'string' || !op.find && next !== '') fail('prdOps 每项需要 find 原文和 replace 新文；非空 PRD 不能使用空 find。');
    const position = next.indexOf(op.find);
    if (position < 0) fail('prdOps 原文未命中，请按需重新读取相关 PRD 片段。');
    if (op.find && next.indexOf(op.find, position + 1) !== -1) fail('prdOps 原文匹配多处，请补充相邻原文以唯一定位。');
    next = next.slice(0, position) + op.replace + next.slice(position + op.find.length);
  }
  return next;
}
