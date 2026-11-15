import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ListFilter } from 'lucide-react';
import Tooltip from './Tooltip.jsx';

export default function AnnotationFilters({ kind, status, onKindChange, onStatusChange }) {
  const id = 'uxw-filters-' + useId().replace(/:/g, '');
  const trigger = useRef(null), panel = useRef(null);
  const [open, setOpen] = useState(false);
  const native = 'popover' in HTMLElement.prototype;
  const anchored = native && CSS.supports('position-area: block-end');
  const active = kind !== 'all' || status !== 'all';
  useEffect(() => {
    const node = panel.current;
    if (!native || !node) return;
    const toggle = event => setOpen(event.newState === 'open');
    node.addEventListener('toggle', toggle);
    return () => node.removeEventListener('toggle', toggle);
  }, [native]);
  useEffect(() => {
    const node = panel.current;
    if (!open || !node) return;
    const position = () => {
      if (anchored) return;
      const box = trigger.current.getBoundingClientRect(), height = node.offsetHeight;
      node.style.left = Math.max(8, Math.min(innerWidth - node.offsetWidth - 8, box.left)) + 'px';
      node.style.top = Math.max(8, box.bottom + height + 8 < innerHeight ? box.bottom + 6 : box.top - height - 6) + 'px';
    };
    position();
    const outside = event => { if (!node.contains(event.target) && !trigger.current.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current.focus(); } };
    if (!native) { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true); }
    window.addEventListener('resize', position); document.addEventListener('scroll', position, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true); };
  }, [open, native, anchored]);
  const controls = <div ref={panel} id={id} className="uxw-filter-popover" popover={native ? 'auto' : undefined}
    hidden={!native && !open} role="group" aria-label="标注筛选条件"
    style={{ positionAnchor: '--' + id }}>
    <label><span>类型</span><select aria-label="标注类型筛选" value={kind} onChange={event => onKindChange(event.target.value)}>
      <option value="all">全部类型</option><option value="explanation">交互说明</option><option value="change-request">修改意见</option>
    </select></label>
    <label><span>处理状态</span><select aria-label="处理状态筛选" value={status} onChange={event => onStatusChange(event.target.value)}>
      <option value="all">全部状态</option><option value="open">待处理意见</option><option value="resolved">已处理意见</option>
    </select></label>
    <button type="button" disabled={!active} onClick={() => { onKindChange('all'); onStatusChange('all'); }}>清除筛选</button>
  </div>;
  return <>
    <Tooltip label="筛选标注"><button ref={trigger} type="button" className={`uxw-icon uxw-filter-trigger ${active ? 'is-active' : ''}`}
      aria-label="筛选标注" aria-expanded={open} aria-controls={id} style={{ anchorName: '--' + id }}
      popoverTarget={native ? id : undefined} onClick={native ? undefined : () => setOpen(value => !value)}>
      <ListFilter size={17} strokeWidth={1.8} />{active && <span className="uxw-filter-dot" aria-label="筛选已启用" />}
    </button></Tooltip>
    {native ? controls : createPortal(controls, document.body)}
  </>;
}
