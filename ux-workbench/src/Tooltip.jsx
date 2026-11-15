import React, { Children, cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './tooltip.css';

// A text-only hint. Actions and focus stay on the original button.
export default function Tooltip({ label, children, delay = 300 }) {
  const child = Children.only(children);
  const id = 'uxw-tooltip-' + useId().replace(/:/g, '');
  const trigger = useRef(null), hint = useRef(null);
  const timers = useRef({ open: null, close: null });
  const keyboardFocus = useRef(false), pointerFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const nativePopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
  const clearTimers = useCallback(() => {
    clearTimeout(timers.current.open); clearTimeout(timers.current.close);
  }, []);
  const close = useCallback(() => { clearTimers(); setOpen(false); }, [clearTimers]);
  const show = useCallback(() => {
    clearTimers();
    window.dispatchEvent(new CustomEvent('uxw-tooltip-open', { detail: id }));
    setOpen(true);
  }, [clearTimers, id]);
  const leave = useCallback(event => {
    if (keyboardFocus.current || (event.relatedTarget instanceof Node && hint.current?.contains(event.relatedTarget))) return;
    clearTimers(); timers.current.close = setTimeout(close, 120);
  }, [clearTimers, close]);

  useEffect(() => {
    const other = event => { if (event.detail !== id) close(); };
    const escape = event => { if (event.key === 'Escape') close(); };
    window.addEventListener('uxw-tooltip-open', other);
    document.addEventListener('keydown', escape, true);
    return () => {
      clearTimers(); window.removeEventListener('uxw-tooltip-open', other);
      document.removeEventListener('keydown', escape, true);
    };
  }, [id, close, clearTimers]);

  useLayoutEffect(() => {
    const node = hint.current, anchor = trigger.current;
    if (!node || !anchor) return;
    if (!open) {
      if (nativePopover && node.matches(':popover-open')) node.hidePopover();
      return;
    }
    if (nativePopover && !node.matches(':popover-open')) node.showPopover();
    const position = () => {
      const r = anchor.getBoundingClientRect();
      const host = anchor.closest('.uxw')?.getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const left = Math.max(0, host?.left ?? 0) + 8, right = Math.min(vw, host?.right ?? vw) - 8;
      const top = Math.max(0, host?.top ?? 0) + 8, bottom = Math.min(vh, host?.bottom ?? vh) - 8;
      node.style.maxWidth = Math.max(40, Math.min(320, right - left)) + 'px';
      const box = node.getBoundingClientRect();
      const x = Math.max(left, Math.min(right - box.width, r.left + (r.width - box.width) / 2));
      const below = r.bottom + 8, above = r.top - box.height - 8;
      const y = below + box.height <= bottom ? below : above >= top ? above : Math.max(top, Math.min(bottom - box.height, below));
      node.style.left = x + 'px'; node.style.top = y + 'px';
    };
    position();
    const dismissNative = event => { if (event.newState === 'closed') close(); };
    node.addEventListener('toggle', dismissNative);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : null;
    observer?.observe(anchor);
    const host = anchor.closest('.uxw');
    const toolbar = anchor.closest('.uxw-interaction-toolbar, .uxw-topbar');
    if (host) observer?.observe(host);
    if (toolbar) observer?.observe(toolbar);
    return () => {
      node.removeEventListener('toggle', dismissNative);
      window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true);
      observer?.disconnect();
    };
  }, [open, label, nativePopover, close]);

  const tooltip = <div ref={hint} id={id} role="tooltip" className="uxw-tooltip" popover={nativePopover ? 'hint' : undefined} data-open={open ? 'true' : 'false'} onPointerEnter={clearTimers} onPointerLeave={leave} onClick={close}>{label}</div>;
  // Native hint popovers escape clipping and remain above modal dialogs. The
  // dependency-free portal fallback covers older offline browsers.
  const target = typeof document !== 'undefined' ? trigger.current?.closest('dialog[open]') || document.body : null;
  // Icon buttons already expose this exact text as their accessible name.
  // Only add a description when the hint supplies additional information.
  const normalized = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const repeatsName = normalized(child.props['aria-label']) === normalized(label);
  const description = child.props['aria-describedby'] || (repeatsName ? undefined : id);
  return <span ref={trigger} className="uxw-tooltip-trigger"
    onPointerEnter={event => { if (event.pointerType === 'touch') return; clearTimers(); timers.current.open = setTimeout(show, delay); }}
    onPointerLeave={leave}
    onPointerDownCapture={() => { pointerFocus.current = true; keyboardFocus.current = false; close(); }}
    onFocusCapture={() => { if (!pointerFocus.current) { keyboardFocus.current = true; show(); } }}
    onBlurCapture={() => { keyboardFocus.current = false; pointerFocus.current = false; close(); }}
    onClickCapture={() => { pointerFocus.current = false; close(); }}>
    {cloneElement(child, { title: undefined, 'aria-describedby': description })}
    {nativePopover || !target ? tooltip : createPortal(tooltip, target)}
  </span>;
}
