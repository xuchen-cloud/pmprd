import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MapPin, MessagesSquare, Search, X } from 'lucide-react';

const kindOf = annotation => annotation.kind === 'change-request' ? 'change-request' : 'explanation';
const labels = { explanation: '交互说明', 'change-request': '修改意见' };

// A document-wide reading index, independent of the canvas's visible controls and filters.
export default function AnnotationIndex({ annotations, numbered, measured, activeId, active, edits, onLocate, onContextMenu, renderBody }) {
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [status, setStatus] = useState('all');
  const id = useId(), listRef = useRef(null);
  const items = useMemo(() => annotations.filter(annotation => {
    const type = kindOf(annotation);
    const body = edits[annotation.id]?.body ?? annotation.body;
    return (kind === 'all' || type === kind) && (status === 'all' || (type === 'change-request' && annotation.status === status)) &&
      (!query.trim() || [body, annotation.anchor?.text, annotation.anchor?.view?.label, numbered.get(annotation.id)].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  }), [annotations, query, kind, status, edits, numbered]);
  useEffect(() => {
    if (!active || !activeId) return;
    const node = [...(listRef.current?.children || [])].find(item => item.firstElementChild?.dataset.annotationIndexId === activeId);
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
  }, [active, activeId]);
  const filtered = query.trim() || kind !== 'all' || status !== 'all';
  const clear = () => { setQuery(''); setKind('all'); setStatus('all'); };
  return <div className="uxw-annotation-index">
    <div className="uxw-index-controls">
      <div className="uxw-index-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label="搜索标注" placeholder="搜索标注内容或控件" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="清空标注搜索" onClick={() => setQuery('')}><X size={13} /></button>}</div>
      <div className="uxw-index-filters">
        <label htmlFor={id + '-kind'} className="uxw-visually-hidden">列表标注类型</label><select id={id + '-kind'} value={kind} onChange={event => setKind(event.target.value)}><option value="all">全部类型</option><option value="explanation">交互说明</option><option value="change-request">修改意见</option></select>
        <label htmlFor={id + '-status'} className="uxw-visually-hidden">列表处理状态</label><select id={id + '-status'} value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="open">待处理意见</option><option value="resolved">已处理意见</option></select>
        <span>{filtered ? `${items.length} / ${annotations.length}` : `${annotations.length} 条`}</span>
      </div>
    </div>
    <ul className="uxw-index-list" role="list" ref={listRef}>{items.map(annotation => {
      const kind = kindOf(annotation), measurement = measured.get(annotation.id);
      const location = annotation.anchor?.view?.label || annotation.anchor?.text;
      return <li key={annotation.id}><article onContextMenu={event => onContextMenu?.(annotation, event)} data-annotation-index-id={annotation.id} className={`uxw-index-item is-${kind} ${activeId === annotation.id ? 'is-selected' : ''}`} onClick={event => {
        if (!event.target.closest('a,button') && !window.getSelection()?.toString()) onLocate(annotation);
      }}>
        <button type="button" className="uxw-index-title" aria-label={`定位标注 ${numbered.get(annotation.id)}：${labels[kind]}`} aria-current={activeId === annotation.id ? 'true' : undefined} onClick={() => onLocate(annotation)}>
          <span className={`uxw-number is-${kind}`}>{numbered.get(annotation.id)}</span><strong>{labels[kind]}</strong>
          {kind === 'change-request' && <span className={`uxw-status ${annotation.status === 'resolved' ? 'is-resolved' : ''}`}>{annotation.status === 'resolved' ? '已处理' : '待处理'}</span>}
          <MapPin size={13} className="uxw-index-locate" aria-hidden="true" />
        </button>
        {renderBody(edits[annotation.id]?.body ?? annotation.body)}
        <div className="uxw-index-location">{location && <span title={location}>{location}</span>}{!measurement?.rect && <small>{!measurement ? '正在查找位置' : measurement.found ? '当前页面未显示' : '暂未找到控件'}</small>}{edits[annotation.id] && <small>未完成编辑</small>}</div>
      </article></li>;
    })}</ul>
    {!items.length && <div className="uxw-soft-empty"><MessagesSquare size={24} /><p>{annotations.length ? '没有符合条件的标注' : '还没有标注'}</p>{filtered && <button type="button" className="uxw-text-button" onClick={clear}>清除筛选</button>}</div>}
  </div>;
}
