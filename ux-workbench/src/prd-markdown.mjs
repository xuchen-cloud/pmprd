import { Extension, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Heading from '@tiptap/extension-heading';
import DOMPurify from 'dompurify';
import { DOMSerializer } from '@tiptap/pm/model';
import { PrdAnnotationReference } from './PrdReferenceNode.jsx';
import { tokenizePrdReferences } from './prd-references.mjs';
import { EmbeddedImage } from './PrdImage.mjs';

const blockTypes = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'codeBlock', 'horizontalRule', 'table', 'image', 'prdRaw', 'annotationReference'];
const sourceAttribute = Extension.create({
  name: 'prdSource',
  addGlobalAttributes: () => [{ types: blockTypes, attributes: { prdSourceId: { default: null, rendered: false } } }],
});

const headingSlug = value => 'prd-' + value.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80);
const legacyHeadingAttributes = /\s*\{(?:route|spec|change)=(?:"[^"]*"|'[^']*'|[^{}\s]+)(?:\s+(?:route|spec|change)=(?:"[^"]*"|'[^']*'|[^{}\s]+))*\}\s*$/;
function headingPresentation(token) {
  const raw = token.raw.trimEnd();
  if (token.type !== 'heading' || !/^#{1,6}\s+.+$/.test(raw)) return { source: raw };
  const anchor = raw.match(/\s*\{#([A-Za-z0-9._:-]+)\}\s*$/);
  let source = anchor ? raw.slice(0, anchor.index) : raw;
  source = source.replace(legacyHeadingAttributes, '');
  return { source, suffix: raw.slice(source.length), anchor: anchor?.[1] || null };
}
const PrdHeading = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), prdHeadingSuffix: { default: '', rendered: false, keepOnSplit: false }, prdHeadingAnchor: { default: null, rendered: false, keepOnSplit: false } };
  },
  renderHTML({ node, HTMLAttributes }) {
    return [`h${node.attrs.level}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      id: node.attrs.prdHeadingAnchor || headingSlug(node.textContent),
    }), 0];
  },
  renderMarkdown: (node, helpers) => `${'#'.repeat(node.attrs.level || 1)} ${helpers.renderChildren(node.content || [])}${node.attrs.prdHeadingSuffix || ''}`,
});

// HTML and syntax outside the editing schema remain visible and byte-preserved.
// They can be edited in source mode, never silently dropped by a schema parser.
const RawMarkdown = Node.create({
  name: 'prdRaw', group: 'block', atom: true, selectable: true,
  addAttributes: () => ({ source: { default: '' } }),
  parseHTML: () => [{ tag: 'pre[data-prd-raw]' }],
  renderHTML: ({ node }) => ['pre', { 'data-prd-raw': '', class: 'uxw-prd-raw', title: '此区块保留原始格式，可在 Markdown 中编辑' }, ['code', {}, node.attrs.source]],
  renderMarkdown: node => node.attrs.source,
});

// <mark> is portable in the existing marked-based reader; ==text== is not GFM.
const PortableHighlight = Highlight.extend({ renderMarkdown: (node, h) => `<mark>${h.renderChildren(node)}</mark>` });

export function prdExtensions({ getAssets = () => ({}) } = {}) {
  return [
    StarterKit.configure({ heading: false, link: { openOnClick: false, autolink: true }, underline: false, trailingNode: false }),
    PrdHeading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 48 }, tableHeader: { HTMLAttributes: { scope: 'col' } } }),
    EmbeddedImage.configure({ allowBase64: true, getAssets }), PortableHighlight,
    TaskList, TaskItem.configure({ nested: true }), sourceAttribute, RawMarkdown, PrdAnnotationReference, Markdown,
  ];
}

export const cleanPrdPaste = html => DOMPurify.sanitize(html, {
  USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form'],
  FORBID_ATTR: ['style', 'id'],
});

function fingerprint(node) {
  return JSON.stringify(node, (key, value) => key === 'prdSourceId' ? undefined : value);
}

function supportedToken(token) {
  if (token.type === 'def') return false;
  if (token.type === 'html') {
    // Sized images use standard HTML because Markdown has no size attributes.
    if (/^\s*<img\b[^>]*>\s*$/i.test(token.raw)) return !/\b(?:on\w+|style|class|data-[\w-]+)\s*=/i.test(token.raw);
    // Safe standard table markup, generated for merged/multiline cells, stays editable.
    if (!/^\s*<table[\s>]/i.test(token.raw)) return false;
    return !/<\/?(?!table\b|thead\b|tbody\b|tfoot\b|tr\b|td\b|th\b|colgroup\b|col\b|p\b|strong\b|b\b|em\b|i\b|s\b|code\b|mark\b|br\b|ul\b|ol\b|li\b|a\b|img\b)[a-z]/i.test(token.raw) && !/\bon\w+\s*=|<script\b/i.test(token.raw);
  }
  // Preserve inline HTML that the rich schema cannot represent.
  if (token.type === 'code') return true;
  if (/<!--|<\/?(?!a\b|strong\b|b\b|em\b|i\b|s\b|del\b|code\b|mark\b|br\b|img\b)[a-z][^>]*>/i.test(token.raw)) return false;
  if (/\b(?:style|data-[\w-]+|class)\s*=/.test(token.raw)) return false;
  return ['paragraph', 'heading', 'list', 'blockquote', 'code', 'hr', 'table', 'text'].includes(token.type);
}

function needsHtmlTable(node) {
  if (node.type !== 'table') return false;
  return node.content.some(row => row.content.some(cell =>
    (cell.attrs?.colspan || 1) !== 1 || (cell.attrs?.rowspan || 1) !== 1 || cell.attrs?.colwidth ||
    cell.content.length !== 1 || cell.content[0].type !== 'paragraph'));
}

// One source ledger per mounted editor. Unchanged blocks retain exact Markdown,
// so a tiny human edit produces a tiny diff instead of reformatting the PRD.
export function createPrdSourceLedger() {
  let original = '', originalFingerprint = '', leading = '', nextId = 0;
  const sources = new Map();
  return {
    load(source, editor) {
      original = String(source ?? ''); sources.clear(); leading = '';
      const normalized = original.replace(/\r\n?|\n/g, '\n');
      const offsets = [0];
      for (let index = 0; index < original.length; index++) {
        if (original[index] === '\r' && original[index + 1] === '\n') index++;
        offsets.push(index + 1);
      }
      const tokens = tokenizePrdReferences(normalized, value => editor.markdown.instance.lexer(value));
      const definitions = tokens.filter(token => token.type === 'def').map(token => token.raw).join('\n');
      const content = [];
      let offset = 0;
      const rawSlice = raw => {
        const value = original.slice(offsets[offset], offsets[offset + raw.length]);
        offset += raw.length;
        return value;
      };
      // Refuse to guess source offsets if a custom lexer ever normalizes more than newlines.
      if (tokens.map(token => token.raw).join('') !== normalized) {
        tokens.splice(0, tokens.length, { type: 'unknown', raw: normalized });
      }
      for (const token of tokens) {
        const raw = rawSlice(token.raw);
        if (token.type === 'space') {
          if (content.length) sources.get(content.at(-1).attrs.prdSourceId).raw += raw;
          else leading += raw;
          continue;
        }
        let parsed;
        const heading = headingPresentation(token);
        if (token.type === 'annotationReference') {
          parsed = [{ type: 'annotationReference', attrs: { annotationId: token.annotationId } }];
        } else if (supportedToken(token)) {
          try { parsed = editor.markdown.parse(heading.source + (definitions ? '\n\n' + definitions.trimEnd() : '')).content; } catch { /* Raw fallback below. */ }
        }
        // Multiple top-level outputs (e.g. mixed task/bullet lists) share a group
        // by keeping the original block opaque, avoiding duplicate source chunks.
        let node = parsed?.length === 1 ? parsed[0] : { type: 'prdRaw', attrs: { source: raw.trimEnd() } };
        const id = `source-${++nextId}`;
        node.attrs = { ...node.attrs, prdSourceId: id };
        if (node.type === 'heading') {
          node.attrs.prdHeadingSuffix = heading.suffix || '';
          node.attrs.prdHeadingAnchor = heading.anchor || null;
        }
        node = editor.schema.nodeFromJSON(node).toJSON();
        sources.set(id, { raw, fingerprint: fingerprint(node) });
        content.push(node);
      }
      const doc = { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
      const normalizedDoc = editor.schema.nodeFromJSON(doc).toJSON();
      originalFingerprint = fingerprint(normalizedDoc);
      return normalizedDoc;
    },
    serialize(editor) {
      const document = editor.getJSON();
      if (fingerprint(document) === originalFingerprint) return original;
      const nodes = document.content || [], used = new Set();
      let output = leading;
      nodes.forEach((node, index) => {
        const id = node.attrs?.prdSourceId;
        const old = !used.has(id) ? sources.get(id) : null;
        used.add(id);
        let raw;
        if (old?.fingerprint === fingerprint(node)) raw = old.raw;
        else if (node.type === 'prdRaw') raw = node.attrs.source;
        else {
          if (needsHtmlTable(node)) {
            const element = DOMSerializer.fromSchema(editor.schema).serializeNode(editor.schema.nodeFromJSON(node));
            raw = (element.matches?.('table') ? element : element.querySelector('table')).outerHTML;
          } else raw = editor.markdown.serialize({ type: 'doc', content: [node] });
          const trailing = old?.raw.match(/\s*$/)?.[0];
          raw = raw.trimEnd() + (trailing || (index < nodes.length - 1 ? '\n\n' : ''));
        }
        if (node.type === 'annotationReference' && !old && output && !/\n[\t ]*\r?\n$/.test(output)) {
          // A new reference must be separated from a preceding raw HTML block.
          // Existing source chunks, including tightly grouped references, stay exact.
          const newline = original.includes('\r\n') ? '\r\n' : '\n';
          output += output.endsWith('\n') ? newline : newline + newline;
        } else if (index > 0 && output && !output.endsWith('\n')) output += '\n\n';
        output += raw;
      });
      return output;
    },
  };
}

export function readEmbeddedImage(file) {
  if (!/^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.type)) return Promise.reject(new Error('请选择 PNG、JPEG、GIF、WebP、AVIF 或 BMP 图片。'));
  if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error('图片超过 15 MB，请压缩后再插入。'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
    reader.onload = () => resolve({ src: String(reader.result), alt: file.name.replace(/\.[^.]+$/, '') || '需求配图' });
    reader.readAsDataURL(file);
  });
}
