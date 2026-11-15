import { useCallback, useEffect, useRef, useState } from 'react';

const editable = target => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
const zoomDirection = event => ['+', '='].includes(event.key) ? 1 : event.key === '-' ? -1 : 0;
const limitZoom = value => Math.max(.2, Math.min(3, Math.round(value * 1000) / 1000));
// Pointer ownership is shared by workbenches in the same document. A previously
// focused canvas must not also consume the hovered canvas's shortcuts.
const hoveredCanvases = new WeakMap(), navigationSurfaces = new WeakMap();

// The preview remains mounted: zoom and pan only move its outer presentation.
export default function useCanvasNavigation({ rootRef, canvasRef, frameRef, tokenRef, scale, setZoom, width, height, size, sides, railHeight, enabled, identity }) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [space, setSpace] = useState(false), [dragging, setDragging] = useState(false);
  const [feedback, setFeedback] = useState('');
  const current = useRef({}), drag = useRef(null), frameEditing = useRef(false), spaceRef = useRef(false);
  current.current = { scale, width, height, size, sides, railHeight, enabled, pan };
  const baseX = (s, w, viewport) => { const { left, right } = current.current.sides; return Math.max(20 + left, (viewport - w * s - left - right) / 2 + left); };
  const constrain = useCallback((next, s = current.current.scale) => {
    const { width: w, height: h, size: bounds, sides, railHeight } = current.current;
    const x = baseX(s, w, bounds.width) - sides.left;
    const totalWidth = w * s + sides.left + sides.right, totalHeight = Math.max(h * s, railHeight);
    // Leave at least 64px reachable; Fit also always restores the entire page.
    return { x: Math.max(64 - totalWidth - x, Math.min(bounds.width - 64 - x, next.x)), y: Math.max(44 - totalHeight, Math.min(bounds.height - 84, next.y)) };
  }, []);
  const move = useCallback(next => setPan(constrain(next)), [constrain]);
  const end = useCallback(() => { if (drag.current) setFeedback('画布位置已调整'); drag.current = null; setDragging(false); }, []);
  const release = useCallback(() => { spaceRef.current = false; setSpace(false); end(); }, [end]);
  const reset = useCallback(() => { setPan({ x: 0, y: 0 }); setZoom('fit'); release(); setFeedback('已恢复适应画布'); }, [setZoom, release]);
  const zoomAt = useCallback((factor, clientX, clientY) => {
    const c = current.current, node = canvasRef.current;
    if (!node || !c.enabled) return;
    const bounds = node.getBoundingClientRect(), next = limitZoom(c.scale * factor);
    const x = Number.isFinite(clientX) ? clientX - bounds.left : bounds.width / 2;
    const y = Number.isFinite(clientY) ? clientY - bounds.top : bounds.height / 2;
    const oldX = baseX(c.scale, c.width, c.size.width) + c.pan.x;
    setPan(constrain({ x: x - (x - oldX) * next / c.scale - baseX(next, c.width, c.size.width), y: y - (y - 20 - c.pan.y) * next / c.scale - 20 }, next));
    setZoom(String(next));
  }, [canvasRef, setZoom, constrain]);
  useEffect(() => { setPan(previous => constrain(previous)); }, [size.width, size.height, scale, width, height, sides.left, sides.right, railHeight, constrain]);
  useEffect(() => { setPan({ x: 0, y: 0 }); release(); }, [identity, width, release]);
  useEffect(() => { frameEditing.current = false; }, [identity]);
  useEffect(() => { if (!enabled) release(); }, [enabled, release]);

  useEffect(() => {
    const canvas = canvasRef.current, root = rootRef.current;
    if (!canvas || !root || !enabled) return;
    const inSurface = target => target instanceof Element && (canvas.contains(target) || (root.contains(target) && !!target.closest('.uxw-popover')));
    const enter = () => { hoveredCanvases.set(document, canvas); };
    const leave = () => { if (hoveredCanvases.get(document) === canvas) hoveredCanvases.delete(document); };
    const activate = event => { if (inSurface(event.target)) enter(); else leave(); };
    const over = event => { if (inSurface(event.target)) enter(); };
    const out = event => { if (inSurface(event.target) && !inSurface(event.relatedTarget)) leave(); };
    const blur = () => {
      release();
      // Focusing a sandboxed iframe blurs its parent Window without moving the
      // pointer or leaving this document. Only an actual app/window blur should
      // discard the currently hovered workbench.
      queueMicrotask(() => { if (!document.hasFocus()) leave(); });
    };
    const editingInCanvas = () => {
      const focused = document.activeElement;
      if (focused === frameRef.current) return frameEditing.current;
      // Floating comment editors live beside the canvas in the DOM, but remain
      // an editing exception just like expanded cards inside it.
      return editable(focused) && (canvas.contains(focused) || !!focused.closest('.uxw-card'));
    };
    const key = event => {
      if (event.defaultPrevented || event.isComposing || !current.current.enabled || editingInCanvas()) return;
      const focused = document.activeElement, hovered = hoveredCanvases.get(document);
      if (hovered ? hovered !== canvas : !canvas.contains(focused)) return;
      const direction = zoomDirection(event);
      if ((event.ctrlKey || event.metaKey) && (direction || event.key === '0')) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === '0') reset(); else zoomAt(direction > 0 ? 1.1 : 1 / 1.1);
      } else if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); event.stopPropagation(); spaceRef.current = true; setSpace(true);
        // A stale PRD focus need not be stolen: suppress this Space while the
        // pointer is over the canvas, then allow normal typing after it leaves.
        if (!editable(focused) || canvas.contains(focused)) canvas.focus({ preventScroll: true });
      } else if (focused === canvas && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const delta = event.shiftKey ? 80 : 24, p = current.current.pan;
        move({ x: p.x + (event.key === 'ArrowLeft' ? delta : event.key === 'ArrowRight' ? -delta : 0), y: p.y + (event.key === 'ArrowUp' ? delta : event.key === 'ArrowDown' ? -delta : 0) });
      } else if (event.key === 'Escape') release();
    };
    const up = event => { if (event.code === 'Space') release(); };
    const wheel = event => {
      if (!inSurface(event.target) || !(event.ctrlKey || event.metaKey) || editingInCanvas()) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      zoomAt(Math.exp(-Math.max(-240, Math.min(240, delta)) * .002), event.clientX, event.clientY);
    };
    const down = event => {
      if (!spaceRef.current || event.button !== 0 || !inSurface(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      canvas.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, pan: current.current.pan, id: event.pointerId };
      setDragging(true);
    };
    const pointerMove = event => {
      const start = drag.current; if (!start || start.id !== event.pointerId) return;
      event.preventDefault();
      move({ x: start.pan.x + event.clientX - start.x, y: start.pan.y + event.clientY - start.y });
    };
    const suppressClick = event => { if (spaceRef.current && inSurface(event.target)) { event.preventDefault(); event.stopPropagation(); } };
    const visibility = () => { if (document.hidden) release(); };
    const handleNavigation = data => {
      if (data.action !== 'pan-end' && editingInCanvas()) return;
      if (data.action === 'zoom' && Number.isFinite(data.factor)) {
        const box = frameRef.current.getBoundingClientRect();
        zoomAt(data.factor, Number.isFinite(data.x) ? box.left + data.x * current.current.scale : undefined, Number.isFinite(data.y) ? box.top + data.y * current.current.scale : undefined);
      }
      if (data.action === 'reset') reset();
      if (data.action === 'pan-start') { spaceRef.current = true; setSpace(true); canvas.focus({ preventScroll: true }); }
      if (data.action === 'pan-end') release();
    };
    navigationSurfaces.set(canvas, handleNavigation);
    const bridge = event => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.token !== tokenRef.current || event.data?.channel !== 'craft-ux-preview') return;
      const data = event.data;
      if (data.type === 'canvas-pointer') { enter(); return; }
      if (data.type === 'canvas-input-focus') { frameEditing.current = data.editing === true; return; }
      if (data.type !== 'canvas-navigation') return;
      // A keyboard event can originate in a previously focused iframe while
      // the pointer has moved to another workbench. Wheel coordinates always
      // belong to the iframe that actually received that wheel event.
      const target = Number.isFinite(data.x) ? canvas : hoveredCanvases.get(document) || canvas;
      (navigationSurfaces.get(target) || handleNavigation)(data);
    };
    document.addEventListener('pointerdown', activate, true);
    canvas.addEventListener('pointerenter', enter);
    canvas.addEventListener('pointerleave', leave);
    root.addEventListener('pointerover', over); root.addEventListener('pointerout', out);
    root.addEventListener('wheel', wheel, { passive: false });
    root.addEventListener('pointerdown', down, true);
    root.addEventListener('click', suppressClick, true);
    canvas.addEventListener('lostpointercapture', end);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', release);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    window.addEventListener('message', bridge);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      leave(); navigationSurfaces.delete(canvas);
      document.removeEventListener('pointerdown', activate, true); canvas.removeEventListener('pointerenter', enter);
      canvas.removeEventListener('pointerleave', leave);
      root.removeEventListener('pointerover', over); root.removeEventListener('pointerout', out);
      root.removeEventListener('wheel', wheel); root.removeEventListener('pointerdown', down, true); root.removeEventListener('click', suppressClick, true); canvas.removeEventListener('lostpointercapture', end);
      window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', release);
      window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); window.removeEventListener('message', bridge);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, identity, canvasRef, rootRef, frameRef, tokenRef, zoomAt, move, end, release, reset]);
  return { pan, space, dragging, reset, move, feedback, frameStyle: { left: baseX(scale, width, size.width), top: 20, transform: `translate(${pan.x}px, ${pan.y}px)` } };
}
