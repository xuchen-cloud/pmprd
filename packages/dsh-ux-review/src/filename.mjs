export function reviewFileName(value) {
  let stem = String(value || 'prototype').trim().replace(/(?:\.(?:ux|review))?\.html?$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim();
  if (!stem) stem = 'prototype';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  return Array.from(stem).slice(0, 150).join('') + '.review.html';
}

export function importedFileName(value, collision = 0) {
  // File.name is normally a basename. Discard both platform path syntaxes even
  // when an RPC caller supplies a path; it never grants access to that path.
  const name = String(value || '').trim().split(/[\\/]/).at(-1);
  if (!/\.html?$/i.test(name)) throw new Error('只支持 HTML 文件。');
  let stem = name.replace(/(?:\.(?:ux|review))?\.html?$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/^[. ]+|[. ]+$/g, '').trim();
  if (!stem) stem = 'prototype';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  // Leave room for the extension/collision suffix on byte-limited filesystems.
  let bytes = 0;
  stem = Array.from(stem).filter(char => (bytes += new TextEncoder().encode(char).byteLength) <= 200).join('').replace(/[. ]+$/g, '');
  return `${stem}${collision ? ` (${collision + 1})` : ''}.ux.html`;
}
