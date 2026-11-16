import Image from '@tiptap/extension-image';
import { closeHistory } from '@tiptap/pm/history';
import { prdAssetId, prdImageSource } from '../../skills/ux-prototype/scripts/prd-assets.mjs';

const embedded = src => /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp);base64,/i.test(src || '');
const dimension = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : null;
const escapeAttribute = value => String(value).replace(/[&"<>]/g, char => ({'&':'&amp;', '"':'&quot;', '<':'&lt;', '>':'&gt;'}[char]));

function imageView({ node, editor, getPos, getAssets }) {
  const imageSource = source => prdImageSource(getAssets(), source) || (embedded(source) ? source : null);
  if (!imageSource(node.attrs.src)) {
    const dom = document.createElement('span');
    dom.className = 'uxw-prd-image-placeholder';
    dom.dataset.prdImage = '';
    dom.textContent = prdAssetId(node.attrs.src) ? `图片资源缺失：${node.attrs.alt || '图片'}` : node.attrs.alt || '图片链接（原文保留）';
    return { dom };
  }
  const dom = document.createElement('div'), frame = document.createElement('div'), img = document.createElement('img');
  dom.className = 'uxw-prd-image'; dom.contentEditable = 'false';
  frame.className = 'uxw-prd-image-frame'; img.draggable = false;
  dom.append(frame); frame.append(img);
  let current = node, drag = null;
  const sync = () => {
    for (const name of ['src', 'alt', 'title', 'width', 'height']) {
      const value = name === 'src' ? imageSource(current.attrs.src) : ['width', 'height'].includes(name) ? dimension(current.attrs[name]) : current.attrs[name];
      if (value == null) img.removeAttribute(name);
      else if (img.getAttribute(name) !== String(value)) img.setAttribute(name, String(value));
    }
    frame.style.width = dimension(current.attrs.width) ? `${dimension(current.attrs.width)}px` : 'fit-content';
  };
  const ratio = () => img.naturalWidth / img.naturalHeight || img.getBoundingClientRect().width / img.getBoundingClientRect().height || 1;
  const clampWidth = value => Math.round(Math.max(Math.min(48, dom.clientWidth), Math.min(dom.clientWidth, value)));
  const commit = width => {
    const pos = getPos();
    if (!editor.isEditable || pos === undefined || editor.state.doc.nodeAt(pos)?.type !== current.type) { sync(); return; }
    const next = { ...current.attrs, width: clampWidth(width), height: Math.max(1, Math.round(clampWidth(width) / ratio())) };
    if (next.width === dimension(current.attrs.width) && next.height === dimension(current.attrs.height)) return;
    editor.view.dispatch(closeHistory(editor.state.tr.setNodeMarkup(pos, undefined, next)));
    // A following delete/typing action must not join this resize undo step.
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const finish = save => {
    if (!drag) return;
    const { handle, pointerId, startWidth } = drag;
    const width = img.getBoundingClientRect().width;
    drag = null; delete dom.dataset.resizing;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (save && Math.abs(width - startWidth) >= 1) commit(width);
    else sync();
  };
  for (const side of ['left', 'right']) {
    const handle = document.createElement('button');
    handle.type = 'button'; handle.className = `uxw-prd-image-handle is-${side}`;
    handle.setAttribute('aria-label', `${side === 'left' ? '左' : '右'}下角调整图片大小（方向键微调）`);
    handle.title = '拖动调整大小；方向键微调';
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !editor.isEditable || !img.naturalWidth || drag) return;
      const pos = getPos(); if (pos === undefined) return;
      event.preventDefault(); event.stopPropagation();
      editor.commands.setNodeSelection(pos);
      handle.focus({preventScroll:true});
      drag = { handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startWidth: img.getBoundingClientRect().width, ratio: ratio() };
      dom.dataset.resizing = 'true'; handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      // The image stays centered, so each horizontal edge moves half the width.
      const dx = (event.clientX - drag.x) * (side === 'left' ? -2 : 2), dy = (event.clientY - drag.y) * drag.ratio;
      frame.style.width = `${clampWidth(drag.startWidth + (Math.abs(dx) >= Math.abs(dy) ? dx : dy))}px`;
    });
    handle.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) finish(true); });
    handle.addEventListener('pointercancel', () => finish(false));
    handle.addEventListener('lostpointercapture', () => finish(false));
    handle.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); editor.commands.focus(); return; }
      if (!editor.isEditable || !img.naturalWidth || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 1 : 8;
      commit(img.getBoundingClientRect().width + (['ArrowRight', 'ArrowDown'].includes(event.key) ? step : -step));
    });
    frame.append(handle);
  }
  sync();
  return {
    dom,
    update(next) {
      if (next.type !== current.type || !imageSource(next.attrs.src)) return false;
      if (!next.eq(current)) { finish(false); current = next; sync(); }
      return true;
    },
    stopEvent: event => !!event.target.closest('.uxw-prd-image-handle'),
    ignoreMutation: () => true,
    destroy() { finish(false); },
  };
}

export const EmbeddedImage = Image.extend({
  addOptions() { return { ...this.parent(), getAssets: () => ({}) }; },
  renderHTML({ HTMLAttributes }) {
    const attributes = { ...HTMLAttributes, alt: HTMLAttributes.alt || '' };
    // Preserve the existing policy: remote image Markdown is never fetched.
    if (!embedded(attributes.src) && !prdAssetId(attributes.src)) return ['span', {class:'uxw-prd-image-placeholder', 'data-prd-image':''}, attributes.alt || '图片链接（原文保留）'];
    return ['img', attributes];
  },
  renderMarkdown(node, helpers) {
    if (!dimension(node.attrs?.width)) return this.parent(node, helpers);
    // Standard HTML carries dimensions through Markdown and the offline reader.
    const attributes = ['src', 'alt', 'title', 'width', 'height'].flatMap(name => {
      const value = ['width', 'height'].includes(name) ? dimension(node.attrs[name]) : node.attrs[name];
      return value == null ? [] : [`${name}="${escapeAttribute(value)}"`];
    });
    return `<img ${attributes.join(' ')}>`;
  },
  addNodeView() { return props => imageView({ ...props, getAssets: this.options.getAssets }); },
});
