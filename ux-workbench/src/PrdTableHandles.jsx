import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TableMap } from '@tiptap/pm/tables';
import { GripHorizontal, GripVertical } from 'lucide-react';

function cellTarget(editor, cell) {
  if (!cell?.isConnected || !editor.view.dom.contains(cell)) return null;
  const $pos = editor.state.doc.resolve(editor.view.posAtDOM(cell, 0));
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (!['cell', 'header_cell'].includes($pos.node(depth).type.spec.tableRole)) continue;
    const table = $pos.node(depth - 2), pos = $pos.before(depth);
    const rect = TableMap.get(table).findCell(pos - $pos.start(depth - 2));
    return { cell, pos, row: rect.top + 1, col: rect.left + 1 };
  }
  return null;
}

// Controls live outside contenteditable and the horizontally scrolling table
// wrapper. They never become part of the document or its Markdown output.
export default function PrdTableHandles({ editor, enabled, menu, onOpenMenu, onCloseMenu }) {
  const id = `prd-table-menu-${useId().replace(/:/g, '')}`;
  const controls = useRef(null), target = useRef(null);
  const latest = useRef({ menu, onCloseMenu }); latest.current = { menu, onCloseMenu };
  const [layout, setLayout] = useState(null);

  useLayoutEffect(() => {
    if (!editor || !enabled) {
      target.current = null; setLayout(null);
      if (latest.current.menu?.axis) latest.current.onCloseMenu();
      return;
    }
    const surface = editor.view.dom, root = surface.closest('.uxw-prd-editor');
    let frame = 0;
    const clear = () => {
      const table = target.current?.cell.closest('table');
      if (table) observer?.unobserve(table);
      target.current = null; setLayout(null);
    };
    const measure = () => {
      frame = 0;
      const current = target.current;
      if (!current?.cell.isConnected || !surface.getClientRects().length) { clear(); return; }
      const table = current.cell.closest('table'), wrapper = table.closest('.tableWrapper') || table;
      const tableBox = table.getBoundingClientRect(), wrapperBox = wrapper.getBoundingClientRect();
      const cellBox = current.cell.getBoundingClientRect(), rowBox = current.cell.parentElement.getBoundingClientRect();
      const clip = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: innerHeight };
      // Respect every clipping ancestor, including a hidden tab or sidebar.
      // The table wrapper is excluded here so the row control can sit outside it.
      for (let node = surface.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom);
        }
      }
      const header = root.querySelector('.uxw-prd-editor-header');
      if (header) clip.top = Math.max(clip.top, header.getBoundingClientRect().bottom);
      const left = Math.max(tableBox.left, wrapperBox.left), right = Math.min(tableBox.right, wrapperBox.right, clip.right);
      const colLeft = Math.max(cellBox.left, left, clip.left), colRight = Math.min(cellBox.right, right);
      const size = matchMedia('(pointer: coarse)').matches ? 44 : 24;
      // The visible grip is 10px across, with a 2px gap to the table. Keep its
      // larger transparent hit area separate from the document's alignment.
      const rowX = Math.max(clip.left, left - size / 2 - 7), rowY = rowBox.top + (rowBox.height - size) / 2, colY = tableBox.top - size / 2 - 7;
      const rowVisible = left < clip.right && right > clip.left && rowY >= clip.top && rowY + size <= clip.bottom;
      const colVisible = colRight - colLeft >= size && colY >= clip.top && colY + size <= clip.bottom;
      setLayout({
        row: current.row, col: current.col,
        rowStyle: rowVisible ? { left: rowX, top: rowY } : null,
        colStyle: colVisible ? { left: (colLeft + colRight) / 2 - size / 2, top: colY } : null,
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(surface);
    const show = cell => {
      if (target.current?.cell !== cell) {
        const next = cellTarget(editor, cell);
        if (!next) { clear(); return; }
        if (target.current) observer?.unobserve(target.current.cell.closest('table'));
        target.current = next; observer?.observe(cell.closest('table'));
      }
      schedule();
    };
    const move = event => {
      if (latest.current.menu || event.pointerType === 'touch') return;
      const element = event.target instanceof Element ? event.target : null;
      if (controls.current?.contains(element)) return;
      if (event.buttons) { clear(); return; }
      let cell = element?.closest('td,th');
      if (cell && surface.contains(cell)) { show(cell); return; }
      // Keep a continuous hit area between the cells and their controls. Also
      // allow entering directly through a table's top/left gutter.
      const area = root.closest('.uxw-document-body') || root.parentElement;
      if (element && area?.contains(element)) {
        for (const table of surface.querySelectorAll('table')) {
          const box = table.getBoundingClientRect(), wrapper = (table.closest('.tableWrapper') || table).getBoundingClientRect();
          const left = Math.max(box.left, wrapper.left), right = Math.min(box.right, wrapper.right);
          if (event.clientX < left - 28 || event.clientX > right || event.clientY < box.top - 24 || event.clientY > box.bottom) continue;
          cell = document.elementFromPoint(Math.max(left + 2, Math.min(right - 2, event.clientX)), Math.max(box.top + 2, Math.min(box.bottom - 2, event.clientY)))?.closest('td,th');
          if (cell && table.contains(cell)) { show(cell); return; }
        }
      }
      if (!controls.current?.contains(document.activeElement)) clear();
    };
    const selection = () => {
      if (latest.current.menu || !editor.isFocused) return;
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        if (['cell', 'header_cell'].includes($from.node(depth).type.spec.tableRole)) {
          show(editor.view.nodeDOM($from.before(depth))); return;
        }
      }
      clear();
    };
    const transaction = ({ transaction: tr }) => {
      if (!tr.docChanged) return;
      clear();
      if (latest.current.menu?.axis) latest.current.onCloseMenu();
    };
    const scroll = () => {
      if (latest.current.menu?.axis) latest.current.onCloseMenu();
      schedule();
    };
    const focus = event => {
      if (!latest.current.menu && !surface.contains(event.target) && !controls.current?.contains(event.target)) clear();
    };
    const leave = event => { if (!event.relatedTarget && !latest.current.menu) clear(); };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', focus);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    editor.on('selectionUpdate', selection); editor.on('transaction', transaction);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusin', focus); document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
      editor.off('selectionUpdate', selection); editor.off('transaction', transaction);
    };
  }, [editor, enabled]);

  if (!enabled || !layout || (menu && !menu.axis)) return null;
  const open = (event, axis, keyboard = event.detail === 0) => {
    event.preventDefault();
    if (menu?.axis === axis && !keyboard) { onCloseMenu(); return; }
    const current = target.current;
    if (!current) return;
    const doc = editor.state.doc, origin = event.currentTarget;
    origin.focus({ preventScroll: true, focusVisible: keyboard });
    onOpenMenu({ id, axis, keyboard, origin, anchorName: `--${id}-${axis}`, label: `第 ${axis === 'row' ? current.row : current.col} ${axis === 'row' ? '行' : '列'}操作`,
      run: method => {
        // A menu always owns its hovered cell, even when the caret is in a
        // different table. Refuse stale targets after an external document edit.
        if (editor.isDestroyed || !editor.isEditable || editor.state.doc !== doc) return;
        const resolved = cellTarget(editor, current.cell);
        if (resolved) editor.chain().focus().setCellSelection({ anchorCell: resolved.pos })[method]().run();
      },
    });
  };
  return createPortal(<div ref={controls} className="uxw-prd-table-handles">
    {['row', 'col'].map(axis => {
      const style = layout[`${axis}Style`], Icon = axis === 'row' ? GripVertical : GripHorizontal;
      return style && <button key={axis} type="button" className={`uxw-prd-table-handle is-${axis}`} style={{ ...style, anchorName: `--${id}-${axis}` }}
        aria-label={`第 ${layout[axis]} ${axis === 'row' ? '行' : '列'}操作`} aria-haspopup="menu" aria-expanded={menu?.axis === axis}
        aria-controls={menu?.axis === axis ? id : undefined}
        onPointerDown={event => event.preventDefault()} onClick={event => open(event, axis)}
        onKeyDown={event => { if (event.key === 'ArrowDown') open(event, axis, true); }}>
        <Icon size={12} aria-hidden="true" />
      </button>;
    })}
  </div>, document.body);
}
