import { hasDocument, parse, sourceOnly } from '../../../skills/ux-prototype/scripts/document.mjs';

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

// This is format inspection, not rendering. Ignore comments and raw-text
// contents so examples inside a script cannot impersonate document metadata.
function inspectHtml(html) {
  let title = '', legacy = false, offlineSource = false;
  const visible = html.replace(/<!--[\s\S]*?-->|<(script|style|textarea|title)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/\1\s*>/gi, (all, tag, attrs, content) => {
    if (!tag) return '';
    tag = tag.toLowerCase();
    if (tag === 'title' && !title) title = content;
    if (tag === 'script') {
      const id = attrs.match(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const scriptId = id?.[1] ?? id?.[2] ?? id?.[3];
      legacy ||= scriptId === 'ux-requirements' || /^\s*window\.__PRD_OFFLINE__=/.test(content);
      offlineSource ||= scriptId === 'ux-prototype-source';
    }
    return '';
  });
  if (!/<html(?:\s|>)/i.test(visible) || !/<body(?:\s|>)/i.test(visible) || !/<\/body\s*>/i.test(visible)) throw new Error('需要包含 html 与 body 的完整 HTML 文件。');
  title = title.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
  return { title: title || '导入的设计文档', legacy, offlineSource };
}

// Shared by the file picker and Host. Deliberately never converts an input or
// creates a document identity before the user confirms conversion.
export function inspectDocumentInput(html) {
  if (typeof html !== 'string' || !html.trim() || html.includes('\0')) throw new Error('HTML 内容为空或无效。');
  if (html.length > MAX_DOCUMENT_BYTES || new TextEncoder().encode(html).byteLength > MAX_DOCUMENT_BYTES) throw new Error('文件超过 50 MB，无法打开。');
  // hasDocument throws on partial/duplicate metadata rather than treating a
  // damaged design document as an ordinary prototype.
  const design = hasDocument(html), input = inspectHtml(html);
  if (design) {
    const doc = parse(html);
    inspectHtml(sourceOnly(html)); // Also validate offline review source blocks.
    return { kind: 'design', title: doc.title };
  }
  if (input.offlineSource) throw new Error('评审导出缺少完整的 ux-document 元数据。');
  return { kind: input.legacy ? 'legacy' : 'prototype', title: input.title };
}
