import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, Search, MessageSquareText } from 'lucide-react';
import { annotationReferenceTitle } from './PrdReference.jsx';
import Tooltip from './Tooltip.jsx';

export default function PrdReferencePicker({ annotations = {}, disabled = false, onBeforeOpen, onInsert }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const trigger = useRef(null), panel = useRef(null), search = useRef(null);
  const uid = useId().replace(/:/g, ''), id = `prd-reference-picker-${uid}`, headingId = `${id}-heading`;
  const nativePopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
  const invokers = nativePopover && 'commandForElement' in HTMLButtonElement.prototype;
  const values = Object.values(annotations).filter(annotation => annotation.kind === 'explanation'), needle = query.trim().toLocaleLowerCase();
  const filtered = values.filter(annotation => !needle || `${annotation.body}\n${annotation.id}`.toLocaleLowerCase().includes(needle));
  const position = () => {
    if (!trigger.current || !panel.current) return;
    const rect = trigger.current.getBoundingClientRect(), box = panel.current.getBoundingClientRect();
    panel.current.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - box.width - 8))}px`;
    panel.current.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - box.height - 8))}px`;
  };
  const hide = restore => {
    if (nativePopover && panel.current?.matches(':popover-open')) panel.current.hidePopover();
    else setOpen(false);
    if (restore) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    const node = panel.current;
    if (!nativePopover || !node) return;
    const toggle = event => {
      const opened = event.newState === 'open'; setOpen(opened);
      if (opened) { position(); search.current?.focus(); }
    };
    node.addEventListener('toggle', toggle);
    return () => node.removeEventListener('toggle', toggle);
  }, [nativePopover]);
  useLayoutEffect(() => { if (open) { position(); if (!nativePopover) search.current?.focus(); } }, [open, query, annotations, nativePopover]);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) hide(false); };
    const resize = () => position();
    document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', resize, true); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', resize, true); window.removeEventListener('resize', resize); };
  }, [open]);
  const choose = annotation => { hide(false); onInsert?.(annotation.id); };
  const picker = <div ref={panel} id={id} className="uxw-prd-reference-picker" popover={nativePopover ? 'auto' : undefined}
    hidden={!nativePopover && !open} role="dialog" aria-labelledby={headingId}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!nativePopover) {event.preventDefault();hide(true);} }
    }}>
    <div className="uxw-prd-reference-picker-heading" id={headingId}>引用已有说明</div>
    <label className="uxw-prd-reference-search"><Search size={14} aria-hidden="true" /><input ref={search} aria-label="搜索已有说明" placeholder="搜索说明内容…" value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); panel.current.querySelector('.uxw-prd-reference-option')?.focus(); } }} /></label>
    <div className="uxw-prd-reference-options" onKeyDown={event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const items = [...panel.current.querySelectorAll('.uxw-prd-reference-option')], index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1);
      event.preventDefault(); if (next < 0) search.current?.focus(); else items[Math.min(next, items.length - 1)]?.focus();
    }}>
      {filtered.map(annotation => {
        return <button key={annotation.id} type="button" className="uxw-prd-reference-option is-explanation" onClick={() => choose(annotation)}
          aria-label={`引用说明：${annotationReferenceTitle(annotation)}`}><MessageSquareText size={15} aria-hidden="true" /><span><strong>{annotationReferenceTitle(annotation)}</strong><small>说明 · {Object.keys(annotations).indexOf(annotation.id) + 1}</small></span></button>;
      })}
      {!filtered.length && <p className="uxw-prd-reference-picker-empty">{values.length ? '没有匹配的说明' : '还没有可引用的说明'}</p>}
    </div>
  </div>;
  return <><Tooltip label="引用说明"><button ref={trigger} type="button" aria-label="引用说明" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
    commandfor={invokers ? id : undefined} command={invokers ? 'toggle-popover' : undefined}
    onMouseDown={event => event.preventDefault()} onClick={event => {
      if (!open) { setQuery(''); onBeforeOpen?.(); }
      if (invokers) return;
      event.preventDefault();
      if (open) hide(true);
      else if (nativePopover) panel.current.showPopover({ source: trigger.current });
      else { setQuery(''); setOpen(true); }
    }}><Link2 size={15} aria-hidden="true" /></button></Tooltip>{createPortal(picker, document.body)}</>;
}
