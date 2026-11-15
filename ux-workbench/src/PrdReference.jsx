import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, MapPin, X } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getAnnotationReferences, splitPrdReferences } from './prd-references.mjs';
import './prd-editor.css';

export const PrdReferenceContext = createContext({ annotations: {}, readOnly: true });

function safeMarkdown(source) {
  const html = DOMPurify.sanitize(marked.parse(source || '', { breaks: true }), {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form'], FORBID_ATTR: ['style'],
  });
  const element = document.createElement('div'); element.innerHTML = html;
  element.querySelectorAll('img').forEach(image => {
    if (!/^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp);base64,/i.test(image.getAttribute('src') || '')) image.removeAttribute('src');
  });
  return element.innerHTML;
}

export function annotationReferenceTitle(annotation) {
  const line = String(annotation?.body || '').split(/\r?\n/).find(value => value.trim()) || '说明';
  return line.replace(/^\s*(?:#{1,6}\s+|[-*>]\s+)/, '').replace(/!?(?:\[([^\]]*)\]\([^)]*\))/g, '$1').replace(/[*_`~]/g, '').slice(0, 100);
}

export function PrdReferenceBlock({ annotationId, referenceId, annotations = {}, onLocateAnnotation, onRemove, selected = false }) {
  const annotation = annotations[annotationId], missing = !annotation;
  const unsupported = !missing && annotation.kind !== 'explanation';
  const number = Object.keys(annotations).indexOf(annotationId) + 1;
  const title = missing ? '标注已删除' : unsupported ? '仅支持引用说明' : annotationReferenceTitle(annotation);
  return <div className={`uxw-prd-reference${missing || unsupported ? ' is-missing' : ' is-explanation'}${selected ? ' is-selected' : ''}`}
    data-prd-reference-id={referenceId} data-prd-reference-annotation={annotationId} contentEditable={false}>
    <details>
      <summary><ChevronRight size={14} aria-hidden="true" /><span className="uxw-prd-reference-kind">{missing || unsupported ? '失效引用' : `说明${number > 0 ? ` ${number}` : ''}`}</span><span className="uxw-prd-reference-title">{title}</span></summary>
      <div className="uxw-prd-reference-content">
        {missing ? <p>原标注已移出当前文档。此处保留引用位置，可移除此引用。</p> : unsupported ? <p>此处的标注不是说明类型。PRD 仅支持引用说明；引用位置已保留，可移除后重新选择说明。</p> : <div className="uxw-markdown uxw-prd-content" dangerouslySetInnerHTML={{ __html: safeMarkdown(annotation.body) }} />}
      </div>
    </details>
    <div className="uxw-prd-reference-actions">
      <button type="button" className="uxw-prd-reference-locate" disabled={missing || unsupported || !onLocateAnnotation}
        aria-label={`定位 UX：${title}`} onClick={() => onLocateAnnotation?.(annotationId, { referenceId })}><MapPin size={13} aria-hidden="true" /><span>定位 UX</span></button>
      {onRemove && <button type="button" className="uxw-prd-reference-remove" aria-label={`移除 PRD 引用：${referenceId}`} onClick={onRemove}><X size={13} aria-hidden="true" /></button>}
    </div>
  </div>;
}

export function locatePrdReference(root, referenceId) {
  const element = [...(root?.querySelectorAll('[data-prd-reference-id]') || [])].find(item => item.dataset.prdReferenceId === referenceId);
  if (!element) return false;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ block: 'center', inline: 'nearest', container: 'nearest', behavior: reduced ? 'instant' : 'smooth' });
  element.querySelector('summary')?.focus({ preventScroll: true });
  return true;
}

// The offline reader reuses exactly the same reference block as the rich editor.
// Ordinary Markdown can use the host's renderer, retaining its heading IDs.
export function PrdReferencesContent({ value = '', annotations = {}, onLocateAnnotation, onRegisterReferenceActions, renderMarkdown, className = '' }) {
  const root = useRef(null), latest = useRef(value), [selectedReferenceId, setSelectedReferenceId] = useState(null);
  latest.current = value;
  const actions = useMemo(() => ({
    list: () => getAnnotationReferences(latest.current),
    locate: referenceId => { setSelectedReferenceId(referenceId); return locatePrdReference(root.current, referenceId); },
  }), []);
  useEffect(() => { onRegisterReferenceActions?.(actions); return () => onRegisterReferenceActions?.(null); }, [actions, onRegisterReferenceActions]);
  const markdown = useCallback((source, key) => renderMarkdown ? renderMarkdown(source, key) : <div key={key} className="uxw-markdown uxw-prd-content" dangerouslySetInnerHTML={{ __html: safeMarkdown(source) }} />, [renderMarkdown]);
  return <div ref={root} className={`uxw-prd-reference-document ${className}`}>
    {splitPrdReferences(value).map(part => part.type === 'annotation'
      ? <PrdReferenceBlock key={part.key} {...part.reference} annotations={annotations} onLocateAnnotation={onLocateAnnotation} selected={selectedReferenceId === part.reference.referenceId} />
      : markdown(part.source, part.key))}
  </div>;
}
