import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import {
  Bold, Italic, Strikethrough, Code2, Highlighter, Heading1, Heading2, Heading3, Heading4,
  List, ListOrdered, ListTodo, Quote, Table2, ImagePlus, Minus, Type, MoreHorizontal,
  Copy, Scissors, ClipboardPaste, ArrowUpToLine, ArrowDownToLine, ArrowLeftToLine,
  ArrowRightToLine, Rows2, Columns2, Trash2, Combine, Split, PanelTop, Undo2, Redo2, FileCode2, ChevronRight, Check,
} from 'lucide-react';
import Tooltip from './Tooltip.jsx';
import { cleanPrdPaste, createPrdSourceLedger, prdExtensions, readEmbeddedImage } from './prd-markdown.mjs';
import { PrdReferenceContext, locatePrdReference } from './PrdReference.jsx';
import { getAnnotationReferences, insertAnnotationReference } from './prd-references.mjs';
import PrdReferencePicker from './PrdReferencePicker.jsx';
import './prd-editor.css';

const nativeFocusGroup = () => typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

function useToolbarNavigation(ref, enabled, mode) {
  useEffect(() => {
    const bar = ref.current;
    if (!bar || !enabled || nativeFocusGroup()) return;
    const items = () => [...bar.querySelectorAll('button')];
    const active = items().find(item => item === document.activeElement) || items()[0];
    items().forEach(item => { item.tabIndex = item === active ? 0 : -1; });
    const focus = event => items().forEach(item => { item.tabIndex = item === event.target ? 0 : -1; });
    const key = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = items(), current = buttons.indexOf(document.activeElement);
      if (current < 0) return;
      const rtl = getComputedStyle(bar).direction === 'rtl';
      const step = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : (rtl ? 1 : -1);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + step + buttons.length) % buttons.length;
      event.preventDefault(); buttons[next]?.focus();
    };
    bar.addEventListener('focusin', focus); bar.addEventListener('keydown', key);
    return () => { bar.removeEventListener('focusin', focus); bar.removeEventListener('keydown', key); };
  }, [ref, enabled, mode]);
  useEffect(() => {
    const bar = ref.current;
    if (!bar || !enabled) return;
    const measure = () => {
      bar.dataset.scrollStart = String(bar.scrollLeft > 1);
      bar.dataset.scrollEnd = String(bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1);
    };
    measure(); bar.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => { bar.removeEventListener('scroll', measure); observer?.disconnect(); };
  }, [ref, enabled, mode]);
}

function BlockStyleSubmenu({ section, close, popover, focusgroup }) {
  const trigger = useRef(null), panel = useRef(null), list = useRef(null), enterOnOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const uid = useId().replace(/:/g, ''), id = `prd-block-styles-${uid}`, anchor = `--${id}`;
  const current = section.items.find(item => item.active) || section.items[0];
  const restore = () => { trigger.current?.focus(); if (popover && panel.current?.matches(':popover-open')) panel.current.hidePopover(); else setOpen(false); };
  const position = () => {
    if (popover && CSS.supports('position-area', 'block-end')) return;
    const rect = trigger.current.getBoundingClientRect(), box = panel.current.getBoundingClientRect();
    panel.current.style.left = `${Math.max(8, rect.right + box.width + 5 <= innerWidth ? rect.right + 5 : rect.left - box.width - 5)}px`;
    panel.current.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - box.height - 8))}px`;
  };
  const enter = () => list.current?.querySelector('button:not(:disabled)')?.focus();
  const show = (keyboard = false) => {
    enterOnOpen.current = keyboard;
    if (popover) {
      if (panel.current.matches(':popover-open')) { if (keyboard) enter(); }
      else panel.current.showPopover({ source: trigger.current });
      position();
    } else { setOpen(true); }
  };
  useLayoutEffect(() => {
    const node = panel.current;
    const toggle = event => {setOpen(event.newState === 'open'); if (event.newState === 'open') { position(); if (enterOnOpen.current) enter(); }};
    node?.addEventListener('toggle', toggle);
    return () => node?.removeEventListener('toggle', toggle);
  }, []);
  useLayoutEffect(() => {
    if (!popover && open) { position(); if (enterOnOpen.current) enter(); }
  }, [open, popover]);
  const keys = event => {
    if (['Escape', 'ArrowLeft'].includes(event.key)) {event.preventDefault();event.stopPropagation();restore();return;}
    if (event.key === 'Tab') {close(true);return;}
    if (focusgroup && !['Home', 'End'].includes(event.key)) return;
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...list.current.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    event.preventDefault(); event.stopPropagation(); buttons[next]?.focus();
  };
  return <div role="group" className="uxw-prd-block-picker">
    <button ref={trigger} type="button" className="uxw-prd-block-trigger" style={{ anchorName: anchor }}
      role="menuitem" aria-label="文本样式" aria-haspopup="menu" aria-expanded={open}
      commandfor={popover ? id : undefined} command={popover ? 'show-popover' : undefined}
      onMouseDown={event => event.preventDefault()} onPointerEnter={() => show(false)}
      onFocus={() => show(false)} onKeyDown={event => { if (event.key === 'ArrowRight') {event.preventDefault();event.stopPropagation();show(true);} }}
      onClick={event => {
        if (!popover || !('commandForElement' in HTMLButtonElement.prototype)) {event.preventDefault();show(event.detail === 0);}
        else if (event.detail === 0) {enterOnOpen.current = true;if(panel.current.matches(':popover-open')) enter();}
      }}>
      <current.icon size={14} aria-hidden="true" /><span>{current.label}</span><ChevronRight size={14} aria-hidden="true" />
    </button>
    <div ref={panel} id={id} className="uxw-prd-menu uxw-prd-submenu" popover={popover ? 'auto' : undefined}
      hidden={!popover && !open} style={{ positionAnchor: anchor }} onKeyDown={keys}>
      <div ref={list} focusgroup="menu nomemory" role="menu" aria-label="文本样式子菜单">
        {section.items.map(item => <button key={item.label} type="button" className="uxw-prd-menu-item"
          role="menuitem" tabIndex={focusgroup ? undefined : -1} aria-label={item.label}
          data-active={item.active || (item === current) || undefined} onMouseDown={event => event.preventDefault()}
          onPointerMove={event => {if(event.pointerType!=='touch') event.currentTarget.focus({focusVisible:false});}}
          onClick={() => {close(true);item.run();}}>
          <item.icon size={14} aria-hidden="true" /><span>{item.label}</span>{item === current && <Check size={14} aria-hidden="true" />}
        </button>)}
      </div>
    </div>
  </div>;
}

function EditorMenu({ state, groups, onClose, restoreFocus }) {
  const panel = useRef(null), point = useRef(null), group = useRef(null);
  const id = `--prd-menu-${useId().replace(/:/g, '')}`;
  const popover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
  // Native focusgroup supplies arrow navigation. Explicit menu semantics are
  // still needed by the current Chromium accessibility tree (verified in UI).
  const focusgroup = nativeFocusGroup();
  const close = useCallback((restore = false) => { if (restore) restoreFocus(state?.origin); onClose(); }, [onClose, restoreFocus, state]);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node || !state) return;
    const anchor = point.current;
    let openingFrame = 0, waitingForRelease = false;
    const position = () => {
      if (popover && CSS.supports('position-area', 'block-end')) return;
      const box = node.getBoundingClientRect();
      node.style.left = `${Math.max(8, Math.min(state.x, innerWidth - box.width - 8))}px`;
      node.style.top = `${Math.max(8, Math.min(state.y, innerHeight - box.height - 8))}px`;
    };
    if (!focusgroup) group.current?.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
    const enter = () => group.current?.querySelector('button:not(:disabled)')?.focus();
    if (!popover && state.keyboard) enter();
    const dismissed = event => {
      if (event.newState === 'closed') onClose();
      else if (state.keyboard) enter();
    };
    const outside = event => { if (!node.contains(event.target)) close(false); };
    const outsideFocus = event => { if (!node.contains(event.target) && event.target !== state.origin) close(false); };
    const escape = event => { if (event.key === 'Escape' && !event.target.closest('.uxw-prd-submenu')) { event.preventDefault(); event.stopPropagation(); close(true); } };
    const show = () => {
      openingFrame = 0;
      if (!node.isConnected) return;
      if (popover) node.showPopover({ source: anchor });
      position();
    };
    const afterRelease = event => {
      if (event && event.button !== 2) return;
      waitingForRelease = false;
      document.removeEventListener('pointerup', afterRelease, true);
      // Electron/macOS may light-dismiss popovers during the opening button's
      // pointerup. Enter the top layer only after that dispatch has finished.
      openingFrame = requestAnimationFrame(show);
    };
    const cancelOpening = () => { if (waitingForRelease || openingFrame) close(false); };
    node.addEventListener('toggle', dismissed);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outsideFocus);
    window.addEventListener('resize', position);
    if (popover && state.rightPress) {
      if (state.rightPress.down) {
        waitingForRelease = true;
        document.addEventListener('pointerup', afterRelease, true);
      } else afterRelease();
      window.addEventListener('blur', cancelOpening);
      document.addEventListener('pointercancel', cancelOpening, true);
    } else show();
    return () => {
      node.removeEventListener('toggle', dismissed);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outsideFocus);
      window.removeEventListener('resize', position);
      document.removeEventListener('pointerup', afterRelease, true);
      document.removeEventListener('pointercancel', cancelOpening, true);
      window.removeEventListener('blur', cancelOpening);
      if (openingFrame) cancelAnimationFrame(openingFrame);
    };
  }, [state, onClose, close, popover, focusgroup]);
  if (!state) return null;
  const onKeyDown = event => {
    if (event.target.closest('[focusgroup]') !== group.current) return;
    if (event.key === 'Tab') { close(true); return; }
    if (focusgroup && !['Home', 'End'].includes(event.key)) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...group.current.querySelectorAll('button:not(:disabled)')].filter(button => button.closest('[focusgroup]') === group.current);
    const current = buttons.indexOf(document.activeElement);
    const step = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + step + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus();
  };
  const body = <>
    <span ref={point} className="uxw-prd-menu-anchor" style={{ left: state.x, top: state.y, anchorName: id }} />
    <div ref={panel} className="uxw-prd-menu" popover={popover ? 'auto' : undefined} style={{ positionAnchor: id }}>
      <div ref={group} focusgroup="menu nomemory" role="menu" aria-label="PRD 编辑菜单" onKeyDown={onKeyDown}
        onFocusCapture={event => {
          if (!event.target.closest('.uxw-prd-block-picker')) {
            const submenu=panel.current?.querySelector('.uxw-prd-submenu');
            if (popover && submenu?.matches(':popover-open')) submenu.hidePopover();
          }
        }}>
        {groups.map((section, index) => <React.Fragment key={section.key}>
          {index > 0 && section.separator !== false && <hr />}
          {section.submenu ? <BlockStyleSubmenu section={section} close={close} popover={popover} focusgroup={focusgroup} /> : <>
          {section.label && <div className="uxw-prd-menu-label">{section.label}</div>}
          <div role="group" className={`uxw-prd-menu-group ${section.layout || 'is-list'}`} style={section.columns ? {gridTemplateColumns: `repeat(${section.columns}, minmax(0,1fr))`} : undefined}>
            {section.items.map(item => <button type="button" key={item.key || item.label}
              role="menuitem" aria-label={item.label} title={item.label}
              className={item.danger ? 'is-danger' : undefined} data-active={item.active || undefined}
              disabled={item.disabled} onPointerMove={event => { if (event.pointerType !== 'touch') event.currentTarget.focus({ focusVisible: false }); }}
              onMouseDown={event => event.preventDefault()} onClick={() => { close(true); item.run(); }}>
              <item.icon size={14} aria-hidden="true" />{section.layout !== 'is-inline' && <span>{item.label}</span>}
            </button>)}
          </div>
          </>}
        </React.Fragment>)}
      </div>
    </div>
  </>;
  return popover ? body : createPortal(body, document.body);
}

export default function PrdEditor({ value = '', onChange, readOnly = false, annotations = {}, onLocateAnnotation, onRegisterReferenceActions }) {
  const [mode, setMode] = useState('rich'), [menu, setMenu] = useState(null), [status, setStatus] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const rightPress = useRef(null);
  useEffect(() => {
    const release = event => {if(event.button === 2 && rightPress.current) rightPress.current.down = false;};
    const cancel = () => {if(rightPress.current) rightPress.current.down = false;};
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {document.removeEventListener('pointerup', release, true);document.removeEventListener('pointercancel', cancel, true);window.removeEventListener('blur', cancel);};
  }, []);
  const [, refresh] = useState(0);
  const latest = useRef({ value, onChange, readOnly, annotations, onLocateAnnotation }); latest.current = { value, onChange, readOnly, annotations, onLocateAnnotation };
  const current = useRef(value), richSource = useRef(value), documentGeneration = useRef(0), ledger = useRef(createPrdSourceLedger()), toolbar = useRef(null), imageInput = useRef(null);
  const imageSelection = useRef(null), pendingImages = useRef(0), source = useRef(null);
  const referenceSelection = useRef(null), sourceCursor = useRef(0);
  const actions = useRef({});
  const root = useRef(null), pendingReference = useRef(null), [selectedReferenceId, setSelectedReferenceId] = useState(null);
  const extensions = useMemo(prdExtensions, []);
  const editor = useEditor({
    extensions, content: '', editable: !readOnly,
    editorProps: {
      attributes: { class: 'uxw-prd-surface', role: 'textbox', 'aria-label': 'PRD 富文本正文', 'aria-multiline': 'true', spellcheck: 'false' },
      transformPastedHTML: cleanPrdPaste,
      handlePaste: (_view, event) => {
        const images = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
        if (images.length) { event.preventDefault(); actions.current.insertImages(images); return true; }
        const html = event.clipboardData?.getData('text/html'), text = event.clipboardData?.getData('text/plain');
        if (!html && text && /(?:^|\n)(?:#{1,6} |[-*] |\d+\. |```|> |\|.*\|)/.test(text)) {
          actions.current.pasteMarkdown(text); return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        const images = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith('image/'));
        if (!moved && images.length) {
          event.preventDefault();
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (position) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position.pos))));
          actions.current.insertImages(images); return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (latest.current.readOnly) return;
      const next = ledger.current.serialize(instance);
      if (next !== current.current) { current.current = next; richSource.current = next; latest.current.onChange?.(next); }
    },
    onSelectionUpdate: () => refresh(count => count + 1),
    onTransaction: () => refresh(count => count + 1),
  });
  const loadRich = useCallback(next => {
    if (!editor) return;
    documentGeneration.current++;
    editor.chain().setContent(ledger.current.load(next, editor), { emitUpdate: false }).setMeta('addToHistory', false).run();
    // setContent can leave an atomic final block selected. Start with a caret
    // instead, so immediately typing after a mode switch never replaces it.
    editor.commands.setTextSelection(1);
    current.current = next; richSource.current = next;
  }, [editor]);
  const initialized = useRef(false);
  useLayoutEffect(() => {
    if (!editor) return;
    if (!initialized.current || (mode === 'rich' && value !== current.current)) {
      loadRich(value); initialized.current = true;
    }
  }, [editor, loadRich, mode, value]);
  useEffect(() => { editor?.setEditable(!readOnly, false); }, [editor, readOnly]);
  useToolbarNavigation(toolbar, !!editor && !readOnly, mode);
  const closeMenu = useCallback(() => setMenu(null), []);
  const restoreFocus = useCallback(origin => {
    if (origin?.tagName === 'BUTTON' && origin.isConnected) origin.focus();
    else editor?.commands.focus();
  }, [editor]);
  const run = (command, ...args) => { if (!readOnly) editor?.chain().focus()[command](...args).run(); };
  const command = (label, icon, method, args = [], active) => ({ label, icon, active, run: () => run(method, ...args) });

  const insertImages = async files => {
    if (!editor || latest.current.readOnly) return;
    const selection = imageSelection.current || { from: editor.state.selection.from, to: editor.state.selection.to };
    imageSelection.current = null;
    const generation = documentGeneration.current, initialSource = current.current;
    pendingImages.current++; setImageBusy(true);
    try {
      const images = await Promise.all(files.map(readEmbeddedImage));
      if (editor.isDestroyed || latest.current.readOnly) return;
      if (generation !== documentGeneration.current) { setStatus('文档已切换，请在当前文档中重新插入图片。'); return; }
      const size = editor.state.doc.content.size;
      const target = initialSource === current.current ? selection : editor.state.selection;
      const from = Math.min(target.from, size), to = Math.min(target.to, size);
      editor.chain().focus().setTextSelection({ from, to }).insertContent(images.map(attrs => ({ type: 'image', attrs }))).run();
      setStatus(`已插入 ${images.length} 张图片`);
    } catch (error) { setStatus(error.message); }
    finally { pendingImages.current--; if (!editor.isDestroyed) setImageBusy(pendingImages.current > 0); }
  };
  const chooseImage = () => {
    imageSelection.current = { from: editor.state.selection.from, to: editor.state.selection.to };
    imageInput.current?.click();
  };
  actions.current = { insertImages, pasteMarkdown: text => {
    const imported = createPrdSourceLedger().load(text, editor);
    editor.chain().focus().insertContent(imported.content).run();
  } };
  const insertTable = () => run('insertTable', { rows: 3, cols: 3, withHeaderRow: true });
  const formatActions = editor ? [
    command('加粗', Bold, 'toggleBold', [], editor.isActive('bold')),
    command('斜体', Italic, 'toggleItalic', [], editor.isActive('italic')),
    command('删除线', Strikethrough, 'toggleStrike', [], editor.isActive('strike')),
    command('代码', Code2, 'toggleCode', [], editor.isActive('code')),
    command('着重', Highlighter, 'toggleHighlight', [], editor.isActive('highlight')),
  ] : [];
  const blockActions = editor ? [
    command('普通文本', Type, 'setParagraph'),
    ...[Heading1, Heading2, Heading3, Heading4].map((icon, index) => command(`标题 ${index + 1}`, icon, 'toggleHeading', [{ level: index + 1 }], editor.isActive('heading', { level: index + 1 }))),
    command('项目符号列表', List, 'toggleBulletList', [], editor.isActive('bulletList')),
    command('有序列表', ListOrdered, 'toggleOrderedList', [], editor.isActive('orderedList')),
    command('Todo 清单', ListTodo, 'toggleTaskList', [], editor.isActive('taskList')),
    command('引用', Quote, 'toggleBlockquote', [], editor.isActive('blockquote')),
    command('代码块', Code2, 'toggleCodeBlock', [], editor.isActive('codeBlock')),
  ] : [];
  const clipboard = async action => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const before = editor.state.doc;
    try {
      if (action === 'paste') {
        const text = await navigator.clipboard.readText();
        if (latest.current.readOnly || editor.isDestroyed) return;
        actions.current.pasteMarkdown(text);
      } else {
        const text = editor.state.doc.textBetween(from, to, '\n');
        await navigator.clipboard.writeText(text);
        const canCut = action === 'cut' && !latest.current.readOnly && !editor.isDestroyed && editor.state.doc === before;
        if (canCut) editor.chain().focus().deleteRange({ from, to }).run();
        setStatus(canCut ? '已剪切' : '已复制');
      }
    } catch { setStatus('无法访问剪贴板，请使用 Ctrl / ⌘ + C、X 或 V。'); }
  };
  const groups = editor ? [
    { key: 'clipboard', layout: 'is-quick', columns: 3, items: [
      { label: '剪切', icon: Scissors, disabled: readOnly || editor.state.selection.empty, run: () => clipboard('cut') },
      { label: '复制', icon: Copy, disabled: editor.state.selection.empty, run: () => clipboard('copy') },
      { label: '粘贴', icon: ClipboardPaste, disabled: readOnly, run: () => clipboard('paste') },
    ] },
    ...(!readOnly ? [
      ...(editor.isActive('table') && editor.state.selection.empty ? [{ key: 'table-insert', items: [
        command('上方插入行', ArrowUpToLine, 'addRowBefore'), command('下方插入行', ArrowDownToLine, 'addRowAfter'),
        command('左侧插入列', ArrowLeftToLine, 'addColumnBefore'), command('右侧插入列', ArrowRightToLine, 'addColumnAfter'),
      ] }, {key: 'table-cells', items: [
        { ...command('合并单元格', Combine, 'mergeCells'), disabled: !editor.can().mergeCells() },
        { ...command('拆分单元格', Split, 'splitCell'), disabled: !editor.can().splitCell() },
        command('切换首行表头', PanelTop, 'toggleHeaderRow'),
      ] }, {key: 'table-delete', items: [
        command('删除当前行', Rows2, 'deleteRow'), command('删除当前列', Columns2, 'deleteColumn'),
        { ...command('删除表格', Trash2, 'deleteTable'), danger: true },
      ] }] : [
        { key: 'blocks', submenu: true, items: blockActions },
        { key: 'formats', layout: 'is-inline', columns: 5, separator: false, items: [formatActions[4], ...formatActions.slice(0, 4)] },
        { key: 'shortcuts', layout: 'is-inline', columns: 6, separator: false, items: [...blockActions.slice(1, 5), blockActions[8], blockActions[7]] },
        ...(editor.state.selection.empty ? [{ key: 'insert', layout: 'is-grid', columns: 2, label: '新增区块', items: [
          blockActions[8], { label: '插入表格', icon: Table2, run: insertTable },
          { label: '插入图片', icon: ImagePlus, run: chooseImage }, blockActions[9], blockActions[7],
          command('分隔线', Minus, 'setHorizontalRule'),
        ] }] : []),
      ]),
    ] : []),
  ] : [];
  const openMenu = event => {
    if (event.target.closest('.uxw-prd-reference')) return;
    event.preventDefault();
    if (!editor) return;
    const keyboard = event.type === 'keydown' || (!event.clientX && !event.clientY);
    if (event.type === 'contextmenu' && !keyboard && editor.state.selection.empty) {
      const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (at) editor.commands.setTextSelection(at.pos);
    }
    const rect = event.currentTarget.getBoundingClientRect();
    // A pointer context menu belongs to the editing surface even if the host
    // delivers its focus event after contextmenu. The previously focused app
    // button is not the menu's owner or its focus-restoration target.
    const origin = event.type === 'contextmenu' ? editor.view.dom : document.activeElement;
    const pendingRightPress = event.type === 'contextmenu' && event.button === 2 && rightPress.current?.down ? rightPress.current : null;
    setMenu({ x: keyboard ? rect.left + 16 : event.clientX, y: keyboard ? rect.top + 28 : event.clientY, keyboard, origin, rightPress: pendingRightPress });
  };
  const changeMode = next => {
    if (pendingImages.current > 0) return;
    setMenu(null);
    if (next === 'rich' && mode !== 'rich' && latest.current.value !== richSource.current) loadRich(latest.current.value);
    setMode(next);
  };
  actions.current.insertReference = (annotationId, options = {}) => {
    if (!editor || latest.current.readOnly || latest.current.annotations[annotationId]?.kind !== 'explanation') return false;
    let insertedOccurrence = null;
    if (mode === 'markdown') {
      try {
        const inserted = insertAnnotationReference(current.current, annotationId, source.current?.selectionStart ?? sourceCursor.current);
        current.current = inserted.value; sourceCursor.current = inserted.cursor;
        latest.current.onChange?.(inserted.value); setSelectedReferenceId(inserted.referenceId);
        requestAnimationFrame(() => source.current?.setSelectionRange(inserted.cursor, inserted.cursor));
        return inserted.referenceId;
      } catch (error) { setStatus(error.message); return false; }
    } else {
      const end = editor.state.doc.content.size;
      let position = typeof options.position === 'number' ? Math.max(0, Math.min(options.position, end)) : editor.state.selection.from;
      const resolved = editor.state.doc.resolve(position);
      // Plain paragraphs split at the caret. Structured blocks remain intact,
      // because the portable reference syntax is a top-level Markdown block.
      if (resolved.depth && !(resolved.depth === 1 && resolved.parent.type.name === 'paragraph')) position = resolved.after(1);
      insertedOccurrence = 1;
      editor.state.doc.descendants((node, offset) => {
        if (offset < position && node.type.name === 'annotationReference' && node.attrs.annotationId === annotationId) insertedOccurrence++;
      });
      editor.chain().focus().insertContentAt(position, { type: 'annotationReference', attrs: { annotationId } }).run();
    }
    const candidates = getAnnotationReferences(current.current).filter(item => item.annotationId === annotationId);
    const reference = insertedOccurrence ? candidates.find(item => item.occurrence === insertedOccurrence) : candidates.at(-1);
    if (reference) {
      pendingReference.current = reference.referenceId;
      setSelectedReferenceId(reference.referenceId);
    }
    return reference?.referenceId || false;
  };
  actions.current.locateReference = referenceId => {
    if (!getAnnotationReferences(current.current).some(item => item.referenceId === referenceId)) return false;
    setSelectedReferenceId(referenceId);
    if (mode === 'markdown') {
      pendingReference.current = referenceId;
      if (latest.current.value !== richSource.current) loadRich(latest.current.value);
      setMode('rich');
      return true;
    }
    return locatePrdReference(root.current, referenceId);
  };
  const referenceActions = useMemo(() => ({
    insert: annotationId => actions.current.insertReference?.(annotationId),
    locate: referenceId => actions.current.locateReference?.(referenceId),
    list: () => getAnnotationReferences(current.current),
  }), []);
  useLayoutEffect(() => {
    if (mode !== 'rich' || !pendingReference.current) return;
    const frame = requestAnimationFrame(() => {
      if (locatePrdReference(root.current, pendingReference.current)) pendingReference.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, value, selectedReferenceId]);
  useEffect(() => { onRegisterReferenceActions?.(referenceActions); return () => onRegisterReferenceActions?.(null); }, [onRegisterReferenceActions, referenceActions]);
  const referenceContext = useMemo(() => ({ annotations, onLocateAnnotation, readOnly, selectedReferenceId, source: value }), [annotations, onLocateAnnotation, readOnly, selectedReferenceId, value]);
  const iconButton = item => <Tooltip key={item.label} label={item.label}><button type="button" aria-label={item.label}
    aria-pressed={typeof item.active === 'boolean' ? item.active : undefined} aria-disabled={item.disabled || undefined}
    onMouseDown={event => event.preventDefault()} onClick={() => { if (!item.disabled) item.run(); }}>
    <item.icon size={15} aria-hidden="true" />
  </button></Tooltip>;

  return <div ref={root} className="uxw-prd-editor" data-mode={mode}>
    {!readOnly && <div className="uxw-prd-editor-header">
      <div ref={toolbar} className="uxw-prd-toolbar" role="toolbar" focusgroup="toolbar wrap" aria-label="PRD 文本格式">
        {mode === 'rich' && editor && <>
        {blockActions.filter(item => ['标题 1', '标题 2', '标题 3'].includes(item.label)).map(iconButton)}
        <span role="separator" aria-orientation="vertical" />
        {formatActions.filter(item => ['加粗', '着重'].includes(item.label)).map(iconButton)}
        {iconButton(blockActions.find(item => item.label === '项目符号列表'))}
        <span role="separator" aria-orientation="vertical" />
        {iconButton({ label: '插入表格', icon: Table2, run: insertTable })}
        {iconButton({ label: '插入图片', icon: ImagePlus, run: chooseImage })}
        <PrdReferencePicker annotations={annotations} disabled={imageBusy}
          onBeforeOpen={() => { referenceSelection.current = { from: editor.state.selection.from, generation: documentGeneration.current }; setMenu(null); }}
          onInsert={annotationId => {
            const selected = referenceSelection.current;
            if (selected?.generation !== documentGeneration.current) { setStatus('文档已切换，请重新选择引用位置。'); return; }
            actions.current.insertReference(annotationId, { position: Math.min(selected.from, editor.state.doc.content.size) });
          }} />
        {iconButton({ label: '撤销 PRD 编辑', icon: Undo2, disabled: !editor.can().undo(), run: () => run('undo') })}
        {iconButton({ label: '重做 PRD 编辑', icon: Redo2, disabled: !editor.can().redo(), run: () => run('redo') })}
        <Tooltip label="更多文本格式"><button type="button" aria-label="更多文本格式" aria-haspopup="menu" aria-expanded={!!menu}
          onMouseDown={event => event.preventDefault()} onClick={openMenu} onKeyDown={event => { if (event.key === 'ArrowDown') openMenu(event); }}><MoreHorizontal size={16} aria-hidden="true" /></button></Tooltip>
        <span role="separator" aria-orientation="vertical" />
        </>}
        <Tooltip label={mode === 'rich' ? 'Markdown' : '富文本'}><button type="button" className="uxw-prd-source-toggle"
          aria-label={mode === 'rich' ? 'Markdown' : '富文本'} disabled={imageBusy}
          onClick={() => changeMode(mode === 'rich' ? 'markdown' : 'rich')}>
          {mode === 'rich' ? <FileCode2 size={15} aria-hidden="true" /> : <Type size={15} aria-hidden="true" />}
        </button></Tooltip>
      </div>
    </div>}
    {mode === 'markdown' && !readOnly && <textarea ref={source} className="uxw-prd-source" aria-label="PRD 正文" spellCheck={false}
      value={value} onSelect={event => { sourceCursor.current = event.currentTarget.selectionStart; }}
      onChange={event => { current.current = event.target.value; sourceCursor.current = event.target.selectionStart; onChange?.(event.target.value); }} />}
    <div className="uxw-prd-editor-body" hidden={mode === 'markdown' && !readOnly}
      onPointerDownCapture={event => {if(event.button === 2) rightPress.current = {down: true};}}
      onContextMenu={openMenu} onKeyDown={event => {
        if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') openMenu(event);
      }}><PrdReferenceContext.Provider value={referenceContext}><EditorContent editor={editor} /></PrdReferenceContext.Provider></div>
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp" multiple hidden
      onChange={event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) void insertImages(files); }} />
    <div className="uxw-prd-status" role="status">{status}</div>
    <EditorMenu state={menu} groups={groups} onClose={closeMenu} restoreFocus={restoreFocus} />
  </div>;
}
