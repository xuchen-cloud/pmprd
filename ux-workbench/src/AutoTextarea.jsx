import React, { useLayoutEffect, useRef } from 'react';

// Keep the native text control and use content sizing where available.
// Older offline browsers get the same grow/shrink behavior without a library.
export default function AutoTextarea({ value, autoFocus, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }); }, [autoFocus]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || CSS.supports('field-sizing', 'content')) return;
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = node.scrollHeight + 'px';
    };
    resize();
    let width = node.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = node.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(node);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, [value]);
  return <textarea {...props} ref={ref} rows={2} value={value} />;
}
