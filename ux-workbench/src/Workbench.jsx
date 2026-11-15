import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  PanelRightOpen, PanelRightClose, Maximize2, Minimize2, EyeOff, MapPin, MessagesSquare,
  Info, MessageSquareDiff, Trash2, Check, X, Save, Download, FolderOpen, MousePointer2,
  Scan, Pencil, FileText, History, Sparkles, LoaderCircle, Undo2, ArrowRight,
  RotateCcw, CircleCheck, ChevronDown, Monitor, Copy,
} from 'lucide-react';
import { parse, sourceOnly, write, importHtml, clone, id, now, recordHuman, lineDiff, prdChangeDiff } from '../../skills/ux-prototype/scripts/document.mjs';
import { previewHtml, stampAnchor } from './preview.mjs';
// Base styles must precede the PRD reader/editor's typography overrides.
import './styles.css';
import Tooltip from './Tooltip.jsx';
import AutoTextarea from './AutoTextarea.jsx';
import useCanvasNavigation from './useCanvasNavigation.jsx';
import AnnotationFilters from './AnnotationFilters.jsx';
import AnnotationIndex from './AnnotationIndex.jsx';
import { PrdReferencesContent } from './PrdReference.jsx';
import { insertAnnotationReference, getAnnotationReferences, getReferencedIds } from './prd-references.mjs';
import { copyTextWhenReady } from './copy-text.mjs';

const LABELS = { explanation: '交互说明', 'change-request': '修改意见' };
const KIND = annotation => annotation.kind === 'change-request' ? 'change-request' : 'explanation';
const activeTask = task => ['queued', 'running'].includes(task?.status);
const referencedExplanationIds = doc => getReferencedIds(doc?.prd || '').filter(id => doc?.annotations[id]?.kind === 'explanation');
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('ux-review:' + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('ux-review:' + key, JSON.stringify(value)); } catch {} },
  remove(key) { try { localStorage.removeItem('ux-review:' + key); } catch {} },
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const time = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const slug = value => 'prd-' + value.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80);
// Interpret only the old renderer's trailing attributes; stored Markdown stays untouched.
const legacyAttributes = /\s*\{(?:route|spec|change)=(?:"[^"]*"|'[^']*'|[^{}\s]+)(?:\s+(?:route|spec|change)=(?:"[^"]*"|'[^']*'|[^{}\s]+))*\}\s*$/;
function prdPresentation(text) {
  const headings = [];
  let fence = null;
  const source = String(text || '').split('\n').map(line => {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) { if (!fence) fence = delimiter[1]; else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null; return line; }
    if (fence || /^(?: {4}|\t)/.test(line)) return line;
    const anchor = line.match(/\s*\{#([A-Za-z0-9._:-]+)\}\s*$/);
    let cleaned = anchor ? line.slice(0, anchor.index) : line;
    cleaned = cleaned.replace(legacyAttributes, '');
    const heading = cleaned.match(/^(#{1,6})\s+(.+)$/);
    if (heading) headings.push({ title: heading[2], level: heading[1].length, id: anchor?.[1] || slug(heading[2].replace(/[*_`]/g, '')) || 'prd-section-' + headings.length });
    return cleaned;
  }).join('\n');
  return { source, headings };
}
function markdown(text, withHeadings = false) {
  const presentation = withHeadings ? prdPresentation(text) : null;
  let html = marked.parse(presentation?.source ?? text ?? '', { breaks: true });
  if (withHeadings) { let index = 0; html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, n, title) => `<h${n} id="${presentation.headings[index++]?.id || slug(title.replace(/<[^>]+>/g, ''))}">${title}</h${n}>`); }
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] });
}
function IconButton({ icon: Icon, label, active, className = '', ...props }) {
  return <Tooltip label={label}><button type="button" className={`uxw-icon ${active ? 'is-active' : ''} ${className}`} aria-label={label} aria-pressed={active === undefined ? undefined : active} {...props}><Icon size={17} strokeWidth={1.8} /></button></Tooltip>;
}
function Markdown({ value, className = '', headings = false, ...props }) {
  return <div className={`uxw-markdown ${className}`} dangerouslySetInnerHTML={{ __html: markdown(value, headings) }} {...props} />;
}
function ChangePrdDiff({ change }) {
  const diff = useMemo(() => prdChangeDiff(change), [change]);
  return diff ? <pre>{diff}</pre> : null;
}
function LegacyHistory({ history }) {
  if (!history) return null;
  const text = typeof history === 'string' ? history : history.markdown;
  const entries = Array.isArray(history) ? history : Array.isArray(history.changes) ? history.changes : null;
  return <details className="uxw-change uxw-legacy"><summary><History size={14} /><div><strong>迁移前变更记录</strong><small>保留原始版本历史</small></div><ChevronDown size={13} /></summary>{typeof text === 'string' ? <Markdown value={text} /> : entries ? entries.map((entry, i) => <div className="uxw-legacy-entry" key={i}><strong>v{String(entry.version ?? i + 1).padStart(3, '0')} · {entry.summary || entry.title || '历史记录'}</strong>{entry.at && <small>{time(entry.at)}</small>}{Array.isArray(entry.details) && <ul>{entry.details.map((detail, n) => <li key={n}>{typeof detail === 'string' ? detail : JSON.stringify(detail)}</li>)}</ul>}</div>) : <pre>{JSON.stringify(history, null, 2)}</pre>}</details>;
}
function ErrorView({ message, onRetry, onOpen }) {
  return <div className="uxw-empty"><Info size={28} /><strong>暂时无法打开文档</strong><p>{message}</p>{onRetry && <button className="uxw-button" onClick={onRetry}>重新读取</button>}{onOpen && <button className="uxw-button is-primary" onClick={onOpen}><FolderOpen size={16} />打开设计文档</button>}</div>;
}

export default function Workbench({ host, readOnly: permanentlyReadOnly = false, editorComponent: PrdEditor }) {
  const rootRef = useRef(null), frameRef = useRef(null), canvasRef = useRef(null), areaRef = useRef(null), contentRef = useRef(null), prdScrollRef = useRef(null);
  const aiDialogRef = useRef(null);
  const promptDialogRef = useRef(null), externalActionRef = useRef(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const popoverRef = useRef(null);
  const prdReferenceActions = useRef(null);
  const [prdTarget, setPrdTarget] = useState(null);
  const registerPrdReferences = useCallback(actions => { prdReferenceActions.current = actions; }, []);
  const [floatingPosition, setFloatingPosition] = useState({ left: 16, top: 86 });
  const newVersionHelpId = useId();
  const tabsId = useId(), tabRefs = useRef(new Map());
  const nativeFocusGroup = Object.hasOwn(HTMLElement.prototype, 'focusGroup');
  const [createNewVersion, setCreateNewVersion] = useState(false);
  const openingResultRef = useRef(false);
  const [openingResult, setOpeningResult] = useState(false);
  const cardRefs = useRef(new Map()), tokenRef = useRef(''), pickerKindRef = useRef('explanation');
  const [file, setFile] = useState(null), [baseDoc, setBaseDoc] = useState(null), [doc, setDoc] = useState(null);
  const [source, setSource] = useState(''), [frameHtml, setFrameHtml] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(''), [notice, setNotice] = useState(null);
  const [panel, setPanel] = useState('sidebar'), [panelWidth, setPanelWidth] = useState(400), [tab, setTab] = useState('prd');
  const [annotationsMode, setAnnotationsMode] = useState(permanentlyReadOnly ? 'expanded' : 'markers');
  const [newKind, setNewKind] = useState(() => storage.get('new-kind', 'explanation'));
  const [width, setWidth] = useState(1280), [zoom, setZoom] = useState('fit'), [canvasSize, setCanvasSize] = useState({ width: 900, height: 800 });
  const [areaWidth, setAreaWidth] = useState(900);
  const [railHeight, setRailHeight] = useState(0);
  const [pickMode, setPickMode] = useState('interact'), [hoverRect, setHoverRect] = useState(null);
  const [measurements, setMeasurements] = useState([]), [activeId, setActiveId] = useState(null), [editingId, setEditingId] = useState(null);
  const [edits, setEdits] = useState({}), [filter, setFilter] = useState('all'), [statusFilter, setStatusFilter] = useState('all');
  const [contextMenu, setContextMenu] = useState(null), [deleted, setDeleted] = useState(null), [lines, setLines] = useState([]);
  const [author, setAuthor] = useState(() => storage.get('author', '产品'));
  const [selectedIds, setSelectedIds] = useState([]), [aiOpen, setAiOpen] = useState(false), [includePrdChanges, setIncludePrdChanges] = useState(true), [clearResolved, setClearResolved] = useState(false), [task, setTask] = useState(null);
  const submittingRef = useRef(false), [submitting, setSubmitting] = useState(false);
  const aiEditing = submitting || activeTask(task);
  const readOnly = permanentlyReadOnly || aiEditing || openingResult;
  const sourceRef = useRef(source), stateRef = useRef({});
  sourceRef.current = source;
  stateRef.current = { doc, baseDoc, source, file, newKind, annotationsMode, edits, editingId, activeId, readOnly, task, dirty: false };
  // Async callbacks from an editor/picker must obey the current lock, not the
  // render in which they were registered. The ref also covers the submit tick.
  const canEdit = () => !stateRef.current.readOnly && !submittingRef.current;
  const annotations = useMemo(() => {
    const all = { ...(doc?.annotations || {}) };
    for (const [key, edit] of Object.entries(edits)) if (edit.isNew) all[key] = { ...edit.annotation, body: edit.body };
    return Object.values(all);
  }, [doc?.annotations, edits]);
  const measured = useMemo(() => new Map(measurements.map(m => [m.id, m])), [measurements]);
  const prdReferences = useMemo(() => getAnnotationReferences(doc?.prd || '').filter(reference => doc?.annotations[reference.annotationId]?.kind === 'explanation'), [doc?.prd, doc?.annotations]);
  const referencedIds = useMemo(() => referencedExplanationIds(doc), [doc?.prd, doc?.annotations]);
  const filtered = useMemo(() => annotations.filter(a => (filter === 'all' || KIND(a) === filter) && (statusFilter === 'all' || (KIND(a) === 'change-request' && a.status === statusFilter))), [annotations, filter, statusFilter]);
  const numbered = useMemo(() => new Map(annotations.map((a, index) => [a.id, index + 1])), [annotations]);
  const pendingCount = annotations.filter(a => KIND(a) === 'change-request' && a.status !== 'resolved').length;
  const hasEdits = Object.values(edits).some(edit => !edit.isNew || edit.body.trim());
  const dirty = !!doc && (!equal(doc, baseDoc) || hasEdits || source !== (file ? sourceOnly(file.html) : ''));
  stateRef.current.dirty = dirty;
  const visible = useMemo(() => filtered.filter(a => measured.get(a.id)?.rect), [filtered, measured]);
  // New notes use a composer beside their target until committed. Appending a
  // focused editor to a long rail must not move the entire prototype to its end.
  const railVisible = visible.filter(a => !edits[a.id]?.isNew);
  const leftCards = areaWidth < 1120 ? [] : railVisible.filter(a => (measured.get(a.id).rect.x + measured.get(a.id).rect.width / 2) < width / 2);
  const rightCards = areaWidth < 1120 ? railVisible : railVisible.filter(a => !leftCards.includes(a));
  const otherCards = filtered.filter(a => !edits[a.id]?.isNew && !measured.get(a.id)?.rect);
  const railWidth = areaWidth < 780 ? 180 : 242, railGap = 24;
  const sides = { left: annotationsMode === 'expanded' && leftCards.length ? railWidth + railGap : 0, right: annotationsMode === 'expanded' && (rightCards.length || otherCards.length) ? railWidth + railGap : 0 };
  const fitScale = Math.max(.2, Math.min(1, (canvasSize.width - 40 - sides.left - sides.right) / width));
  const scale = zoom === 'fit' ? fitScale : Number(zoom);
  // Logical viewport stays stable when zoom changes: demo state and responsive layout do not reflow.
  const frameHeight = Math.max(480, Math.round((canvasSize.height - 40) / fitScale));
  const navigation = useCanvasNavigation({ rootRef, canvasRef, frameRef, tokenRef, scale, setZoom, width, height: frameHeight, size: canvasSize, sides, railHeight: annotationsMode === 'expanded' ? railHeight : 0, enabled: !!doc && !loading && panel !== 'full', identity: file?.path });
  const railStyle = side => ({ width: railWidth, left: navigation.frameStyle.left + (side === 'left' ? -railWidth - railGap : width * scale + railGap), top: navigation.frameStyle.top, transform: navigation.frameStyle.transform });
  const markerPositions = useMemo(() => {
    const positions = new Map(), occupied = [], size = 20, step = 24;
    const limitX = Math.max(0, width * scale - size), limitY = Math.max(0, frameHeight * scale - size);
    for (const annotation of filtered) {
      const rect = measured.get(annotation.id)?.rect;
      if (!rect || rect.y + rect.height < 0 || rect.y > frameHeight || rect.x + rect.width < 0 || rect.x > width) continue;
      const base = { x: Math.max(0, Math.min(limitX, (rect.x + rect.width - 8) * scale)), y: Math.max(0, Math.min(limitY, (rect.y - 8) * scale)) };
      let point = base, found = false;
      for (let radius = 0; radius < 40 && !found; radius++) {
        for (let dx = -radius; dx <= radius && !found; dx++) {
          const dy = radius - Math.abs(dx);
          for (const sign of dy ? [1, -1] : [1]) {
            const candidate = { x: base.x + dx * step, y: base.y + dy * sign * step };
            if (candidate.x < 0 || candidate.x > limitX || candidate.y < 0 || candidate.y > limitY) continue;
            if (occupied.every(p => Math.abs(p.x - candidate.x) >= size || Math.abs(p.y - candidate.y) >= size)) { point = candidate; found = true; break; }
          }
        }
      }
      occupied.push(point); positions.set(annotation.id, { x: point.x / scale, y: point.y / scale });
    }
    return positions;
  }, [filtered, measured, width, frameHeight, scale]);
  const actor = useMemo(() => ({ kind: 'human', name: author || '产品' }), [author]);
  const send = useCallback(data => frameRef.current?.contentWindow?.postMessage({ channel: 'craft-ux-host', token: tokenRef.current, ...data }, '*'), []);
  const notify = useCallback((message, tone = 'success') => setNotice({ message, tone }), []);

  const installFile = useCallback(snapshot => {
    const imported = importHtml(snapshot.html);
    const current = imported.doc;
    const original = sourceOnly(imported.html);
    const sameDocument = stateRef.current.doc?.id === current.id;
    setTask(previous => snapshot.activeTask || (sameDocument && !activeTask(previous) ? previous : null));
    tokenRef.current = crypto.randomUUID();
    setFile({ ...snapshot, html: imported.html }); setBaseDoc(clone(current)); setDoc(clone(current));
    setSource(original); setFrameHtml(previewHtml(original, tokenRef.current));
    setEdits({}); setActiveId(null); setEditingId(null); setMeasurements([]); setPickMode('interact'); setContextMenu(null);
    setSelectedIds([]); setError(''); setLoading(false); setDeleted(null);
    const recovered = !permanentlyReadOnly && storage.get('draft:' + current.id, null);
    setRecovery(recovered ? { ...recovered, stale: recovered.path !== snapshot.path || !equal(recovered.baseDoc, current) || recovered.baseSource !== original } : null);
    const pref = storage.get('view:' + current.id, {});
    setPanel(permanentlyReadOnly ? 'sidebar' : pref.panel || 'sidebar'); setPanelWidth(pref.panelWidth || 400);
    setAnnotationsMode(permanentlyReadOnly ? 'expanded' : pref.annotationsMode || 'markers');
    if (imported.imported) notify('已读取原型。保存后会写入 PRD 与标注格式。', 'info');
  }, [permanentlyReadOnly, notify]);
  const load = useCallback(async path => {
    setLoading(true); setError('');
    try { const snapshot = await host.read(path); if (!snapshot) { setLoading(false); return; } installFile(snapshot); }
    catch (e) { setError(e.message || String(e)); setLoading(false); }
  }, [host, installFile]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (doc) storage.set('view:' + doc.id, { panel, panelWidth, annotationsMode });
  }, [doc?.id, panel, panelWidth, annotationsMode]);
  useEffect(() => { storage.set('new-kind', newKind); }, [newKind]);
  useEffect(() => { storage.set('author', author); }, [author]);
  useEffect(() => { host.onDirtyChange?.(dirty); }, [host, dirty]);
  useEffect(() => {
    if (readOnly || !doc || !baseDoc || !file || recovery) return;
    const key = 'draft:' + doc.id;
    if (!dirty) { storage.remove(key); return; }
    const retainedEdits = Object.fromEntries(Object.entries(edits).filter(([, edit]) => !edit.isNew || edit.body.trim()));
    const payload = { path: file.path, baseVersion: file.version, baseDoc, baseSource: sourceOnly(file.html), doc, source, edits: retainedEdits, at: now() };
    const persist = () => storage.set(key, payload);
    const timer = setTimeout(persist, 200);
    // Persist the latest render on unmount as well as during ordinary editing.
    return () => { clearTimeout(timer); persist(); };
  }, [doc, baseDoc, file, source, edits, dirty, readOnly, recovery]);
  useEffect(() => {
    const beforeUnload = e => { if (stateRef.current.dirty && !readOnly) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [readOnly]);
  useEffect(() => {
    const node = canvasRef.current; if (!node) return;
    const observer = new ResizeObserver(([entry]) => { const { width: w, height: h } = entry.contentRect; if (w > 0 && h > 0) setCanvasSize({ width: w, height: h }); });
    observer.observe(node);
    const areaObserver = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setAreaWidth(entry.contentRect.width); });
    if (areaRef.current) areaObserver.observe(areaRef.current);
    return () => { observer.disconnect(); areaObserver.disconnect(); };
  }, [loading, !!doc]);
  useEffect(() => {
    send({ type: 'annotations', annotations, referencedIds, showAnnotations: annotationsMode !== 'off' });
    send({ type: 'annotation-visibility', value: annotationsMode });
  }, [annotations, referencedIds, annotationsMode, send, frameHtml]);
  useEffect(() => { send({ type: 'mode', mode: pickMode }); }, [pickMode, send]);
  useEffect(() => {
    if (!readOnly) return;
    setPickMode('interact'); setHoverRect(null); setContextMenu(null); setEditingId(null); setAiOpen(false);
    send({ type: 'mode', mode: 'interact' });
  }, [readOnly, send]);
  useEffect(() => {
    if (annotationsMode === 'off' || panel === 'full') { setPickMode('interact'); setHoverRect(null); setContextMenu(null); }
  }, [annotationsMode, panel]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer); }, [notice]);

  const updateAnnotation = useCallback((key, patch) => {
    if (!canEdit()) return;
    setDoc(prev => {
      if (!prev.annotations[key]) return prev;
      return { ...prev, annotations: { ...prev.annotations, [key]: { ...prev.annotations[key], ...patch, updatedAt: now(), updatedBy: { kind: 'human', name: author || '产品' } } } };
    });
  }, [author]);
  const dismissAnnotation = useCallback(() => {
    setEdits(previous => Object.fromEntries(Object.entries(previous).filter(([, edit]) => !edit.isNew || edit.body.trim())));
    setActiveId(null); setEditingId(null);
  }, []);
  const createAt = useCallback((anchor, requestedKind) => {
    if (!canEdit() || !anchor) return;
    const kind = requestedKind || stateRef.current.newKind;
    const resolved = anchor;
    const key = id('ann'), date = now(), creator = { kind: 'human', name: storage.get('author', '产品') };
    const annotation = { id: key, kind, body: '', anchor: resolved, createdAt: date, updatedAt: date, createdBy: creator, updatedBy: creator, ...(kind === 'change-request' ? { status: 'open', assignee: { kind: 'unassigned' } } : {}) };
    setEdits(prev => ({ ...Object.fromEntries(Object.entries(prev).filter(([, edit]) => !edit.isNew || edit.body.trim())), [key]: { isNew: true, annotation, body: '' } }));
    setActiveId(key); setEditingId(key); setAnnotationsMode(mode => mode === 'off' ? 'markers' : mode);
    setPickMode('interact'); setHoverRect(null); setContextMenu(null);
  }, [send]);
  useEffect(() => {
    const listener = event => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.token !== tokenRef.current || event.data?.channel !== 'craft-ux-preview') return;
      const data = event.data;
      if (data.type === 'ready') {
        const current = stateRef.current;
        send({ type: 'annotations', annotations: Object.values(current.doc?.annotations || {}), referencedIds: referencedExplanationIds(current.doc), showAnnotations: current.annotationsMode !== 'off' });
        send({ type: 'annotation-visibility', value: current.annotationsMode });
      }
      if (data.type === 'snapshot') setMeasurements(data.anchors || []);
      if (data.type === 'notice' && data.message) notify(data.message, 'info');
      if (data.type === 'hover') setHoverRect(data.rect);
      if (data.type === 'picked') createAt(data.anchor, pickerKindRef.current);
      if (data.type === 'cancel-pick') { setPickMode('interact'); setHoverRect(null); }
      if (data.type === 'contextmenu') {
        const current = stateRef.current;
        const linkedIds = referencedExplanationIds(current.doc).filter(id => data.annotationIds?.includes(id));
        const canAdd = canEdit() && current.annotationsMode !== 'off';
        if (!canAdd && !linkedIds.length) return;
        const box = frameRef.current.getBoundingClientRect();
        const ratio = box.width / Number(frameRef.current.getAttribute('width'));
        setContextMenu({ x: Math.max(8, Math.min(innerWidth - 230, box.left + (data.x ?? data.clientX ?? 0) * ratio)), y: Math.max(8, Math.min(innerHeight - 260, box.top + (data.y ?? data.clientY ?? 0) * ratio)), anchor: data.anchor, newKind: current.newKind, linkedIds, canAdd });
      }
      if (data.type === 'located' && (!data.found || !data.visible)) notify(data.reason || '暂时无法定位。请先打开对应页面或弹窗，或重新绑定目标。', 'info');
      if (data.type === 'interaction') { setContextMenu(null); if (stateRef.current.annotationsMode === 'markers' || stateRef.current.edits[stateRef.current.activeId]?.isNew) dismissAnnotation(); }
    };
    addEventListener('message', listener); return () => removeEventListener('message', listener);
  }, [send, createAt, notify, dismissAnnotation]);

  const startEdit = (annotation, event) => {
    if (!canEdit() || event?.target?.closest('a') || window.getSelection()?.toString()) return;
    event?.stopPropagation();
    setActiveId(annotation.id); setEditingId(annotation.id);
    setEdits(prev => prev[annotation.id] ? prev : { ...prev, [annotation.id]: { body: annotation.body, annotation, isNew: false } });
  };
  const commitEdit = key => {
    if (!canEdit()) return;
    const edit = edits[key]; if (!edit) return;
    if (!edit.body.trim()) { if (edit.isNew) cancelEdit(key); else notify('请填写标注内容，或取消本次编辑。', 'error'); return; }
    const annotation = { ...(doc.annotations[key] || edit.annotation), body: edit.body.trim(), updatedAt: now(), updatedBy: actor };
    if (edit.isNew) { const stamped = stampAnchor(sourceRef.current, annotation.anchor); annotation.anchor = stamped.anchor; setSource(stamped.source); send({ type: 'stamp', anchor: stamped.anchor }); }
    setDoc(prev => ({ ...prev, annotations: { ...prev.annotations, [key]: annotation } }));
    setEdits(prev => { const next = { ...prev }; delete next[key]; return next; }); setEditingId(null);
  };
  const cancelEdit = key => {
    if (!canEdit()) return;
    const isNew = edits[key]?.isNew;
    setEdits(prev => { const next = { ...prev }; delete next[key]; return next; }); setEditingId(null); if (isNew) setActiveId(null);
  };
  const deleteAnnotation = key => {
    if (!canEdit()) return;
    const annotation = doc.annotations[key] || edits[key]?.annotation;
    if (!annotation) return;
    setDeleted({ annotation, edit: edits[key] });
    setDoc(prev => { const next = { ...prev.annotations }; delete next[key]; return { ...prev, annotations: next }; });
    setEdits(prev => { const next = { ...prev }; delete next[key]; return next; });
    setSelectedIds(ids => ids.filter(i => i !== key)); setContextMenu(null); setActiveId(null); setEditingId(null);
    notify('标注已删除，可撤销。');
  };
  const undoDelete = () => {
    if (!canEdit() || !deleted) return;
    if (deleted.edit?.isNew) setEdits(prev => ({ ...prev, [deleted.annotation.id]: deleted.edit }));
    else setDoc(prev => ({ ...prev, annotations: { ...prev.annotations, [deleted.annotation.id]: deleted.annotation } }));
    setDeleted(null); notify('已恢复标注。');
  };
  const convert = annotation => {
    if (!canEdit()) return;
    const converted = { ...annotation, kind: KIND(annotation) === 'explanation' ? 'change-request' : 'explanation', updatedAt: now(), updatedBy: actor };
    delete converted.status; delete converted.assignee; delete converted.resolution;
    if (converted.kind === 'change-request') { converted.status = 'open'; converted.assignee = { kind: 'unassigned' }; }
    setDoc(prev => ({ ...prev, annotations: { ...prev.annotations, [annotation.id]: converted } })); setContextMenu(null);
  };
  const revealCard = key => {
    const box = cardRefs.current.get(key)?.getBoundingClientRect(), canvas = canvasRef.current?.getBoundingClientRect();
    if (!box || !canvas) return;
    const dx = box.left < canvas.left + 12 ? canvas.left + 12 - box.left : box.right > canvas.right - 12 ? canvas.right - 12 - box.right : 0;
    const dy = box.top < canvas.top + 12 ? canvas.top + 12 - box.top : box.bottom > canvas.bottom - 12 ? canvas.bottom - 12 - Math.min(box.height, canvas.height - 24) - box.top : 0;
    if (dx || dy) navigation.move({ x: navigation.pan.x + dx, y: navigation.pan.y + dy });
  };
  useLayoutEffect(() => {
    if (annotationsMode === 'expanded' && editingId && !edits[editingId]?.isNew) revealCard(editingId);
  }, [editingId, annotationsMode]);
  const locate = annotation => {
    if (panel === 'full') setPanel('sidebar');
    navigation.reset();
    setActiveId(annotation.id); setContextMenu(null);
    send({ type: 'locate', id: annotation.id });

  };
  const changeMode = value => { setAnnotationsMode(value); navigation.reset(); setContextMenu(null); dismissAnnotation(); };
  const locateFromIndex = annotation => {
    if (annotationsMode === 'off') setAnnotationsMode('markers');
    if (!filtered.some(item => item.id === annotation.id)) { setFilter('all'); setStatusFilter('all'); }
    setPickMode('interact');
    locate(annotation);
  };
  const locateFromPrd = annotationId => {
    const annotation = doc.annotations[annotationId];
    if (annotation?.kind === 'explanation') locateFromIndex(annotation);
  };
  const jumpToPrd = referenceId => {
    setContextMenu(null); setTab('prd');
    if (panel === 'hidden') setPanel('sidebar');
    setPrdTarget(referenceId);
  };
  const addToPrd = annotation => {
    if (!canEdit() || doc.annotations[annotation.id]?.kind !== 'explanation') return;
    let referenceId;
    if (PrdEditor) {
      referenceId = prdReferenceActions.current?.insert?.(annotation.id);
      if (typeof referenceId !== 'string') { notify('暂时无法插入说明，请在 PRD 中放置光标后重试。', 'info'); return; }
    } else {
      const textarea = rootRef.current?.querySelector('textarea.uxw-prd-editor');
      try {
        const inserted = insertAnnotationReference(doc.prd, annotation.id, textarea?.selectionStart ?? 0);
        setDoc(previous => ({ ...previous, prd: inserted.value }));
        referenceId = inserted.referenceId;
      } catch (error) { notify(error.message, 'info'); return; }
    }
    jumpToPrd(referenceId);
  };
  const updatePrd = value => { if (canEdit()) setDoc(previous => ({ ...previous, prd: value })); };
  useEffect(() => {
    if (!prdTarget || tab !== 'prd' || panel === 'hidden') return;
    const frame = requestAnimationFrame(() => {
      if (prdReferenceActions.current) prdReferenceActions.current.locate(prdTarget);
      else {
        const textarea = rootRef.current?.querySelector('textarea.uxw-prd-editor');
        const reference = getAnnotationReferences(doc?.prd).find(item => item.referenceId === prdTarget);
        if (textarea && reference) { textarea.focus({ preventScroll: true }); textarea.setSelectionRange(reference.start, reference.end); }
      }
      setPrdTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [prdTarget, tab, panel, doc?.prd]);
  const onTabKeyDown = event => {
    if (nativeFocusGroup || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const keys = ['prd', 'annotations', 'changes'], index = keys.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    tabRefs.current.get(keys[next])?.focus();
  };
  useEffect(() => {
    tabRefs.current.get(tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
  }, [tab]);
  const startPick = mode => {
    if (!canEdit()) return;
    dismissAnnotation(); pickerKindRef.current = newKind; setAnnotationsMode(value => value === 'off' ? 'markers' : value); setPickMode(mode); setContextMenu(null);
  };
  const save = useCallback(async (forSubmission = false) => {
    if (permanentlyReadOnly || activeTask(stateRef.current.task) || openingResultRef.current || (submittingRef.current && forSubmission !== true) || !doc || !host.save) return null;
    let current = clone(doc), currentSource = source;
    for (const [key, edit] of Object.entries(edits)) {
      if (!edit.body.trim()) { if (edit.isNew) continue; setActiveId(key); setEditingId(key); notify('请完成标注编辑，或取消后再保存。', 'error'); return null; }
      current.annotations[key] = { ...(current.annotations[key] || edit.annotation), body: edit.body.trim(), updatedAt: now(), updatedBy: actor };
      if (edit.isNew) { const stamped = stampAnchor(currentSource, current.annotations[key].anchor); currentSource = stamped.source; current.annotations[key].anchor = stamped.anchor; send({ type: 'stamp', anchor: stamped.anchor }); }
    }
    setBusy('save');
    try {
      const savedDoc = recordHuman(baseDoc, current, '', author || '产品');
      const html = write(currentSource, savedDoc);
      const saved = await host.save({ path: file.path, html, expectedVersion: file.version });
      if (!saved) return null;
      const snapshot = { ...file, ...saved, html: saved.html || html };
      const resultDoc = parse(snapshot.html);
      setFile(snapshot); setBaseDoc(clone(resultDoc)); setDoc(clone(resultDoc)); setSource(currentSource); setEdits({}); setEditingId(null); storage.remove('draft:' + resultDoc.id);
      notify('已保存，PRD 与标注变更已写入文件。'); return snapshot;
    } catch (e) { notify(e.message || String(e), 'error'); return null; }
    finally { setBusy(''); }
  }, [permanentlyReadOnly, doc, host, edits, actor, baseDoc, author, source, file, notify, send]);
  const exportDocument = async () => {
    if (!host.exportReview || !doc) return;
    if (hasEdits) { notify('请先完成当前标注编辑，再导出。', 'info'); return; }
    setBusy('export');
    try { const current = readOnly ? doc : recordHuman(baseDoc, doc, '', author || '产品'); await host.exportReview({ html: write(source, current), name: doc.title }); notify('已导出完整评审 HTML，包含 PRD、标注和变更记录。'); }
    catch (e) { notify(e.message || String(e), 'error'); }
    finally { setBusy(''); }
  };
  const submit = async (destination = 'dsh') => {
    if (!canEdit() || busy || !host.submit || (!selectedIds.length && !includePrdChanges)) return;
    submittingRef.current = true; setSubmitting(true);
    try {
      const saved = await save(true); if (!saved) return;
      setBusy('submit');
      const result = await host.submit({ path: saved.path, expectedVersion: saved.version, selectedIds, includePrdChanges, clearResolved, createNewVersion, destination });
      setTask(result); setAiOpen(false);
      if (destination === 'dsh') notify('修改说明已发送到 DSH。');
      return result;
    }
    catch (e) { notify(e.message || String(e), 'error'); }
    finally { submittingRef.current = false; setSubmitting(false); setBusy(''); }
  };
  const copySubmission = async () => {
    if (!canEdit() || busy || !host.submit) return;
    const preparing = submit('external');
    const copying = copyTextWhenReady(preparing.then(result => result?.prompt)).then(() => true, () => false);
    const result = await preparing;
    if (!result) return;
    if (await copying) notify('修改说明已复制，可粘贴给外部 Agent。');
    else { setPromptOpen(true); notify('自动复制未成功，请复制窗口中的修改说明。', 'info'); }
  };
  const copyTaskPrompt = async () => {
    try { await copyTextWhenReady(task?.prompt); notify('修改说明已复制。'); }
    catch { setPromptOpen(true); notify('自动复制未成功，可选中文字手动复制。', 'info'); }
  };
  const openTaskResult = useCallback(async (path, preserveDraft = false) => {
    if (openingResultRef.current) return;
    const current = stateRef.current, sameFile = path === current.file?.path;
    if (current.dirty) {
      if (!sameFile || !preserveDraft) { notify('你有未保存修改，已保留在当前页面。', 'info'); return; }
      storage.set('draft:' + current.doc.id, { path: current.file.path, baseVersion: current.file.version, baseDoc: current.baseDoc, baseSource: sourceOnly(current.file.html), doc: current.doc, source: current.source, edits: current.edits, at: now() });
    }
    openingResultRef.current = true; setOpeningResult(true);
    try {
      if (sameFile) await load(path);
      else if (host.openResult) await host.openResult(path);
      else await load(path);
    } catch (e) {
      notify('打开修改结果失败：' + (e.message || String(e)), 'error');
    } finally {
      openingResultRef.current = false; setOpeningResult(false);
    }
  }, [host, load, notify]);
  const readExternalResult = async () => {
    if (!task?.id || !host.task || externalActionRef.current) return;
    externalActionRef.current = true; setBusy('external-result');
    try {
      const next = await host.task(task.id); setTask(next);
      if (['completed', 'succeeded', 'done'].includes(next.status) && next.outputPath) await openTaskResult(next.outputPath);
      else notify(next.message || '暂未收到修改结果，外部 Agent 完成后可再次读取。', 'info');
    } catch (error) { notify('读取修改结果失败：' + error.message, 'error'); }
    finally { externalActionRef.current = false; setBusy(''); }
  };
  const cancelExternalTask = async () => {
    if (!task?.id || !host.cancel || externalActionRef.current) return;
    externalActionRef.current = true; setBusy('external-cancel');
    try {
      const next = await host.cancel(task.id); setTask(next); setPromptOpen(false);
      if (next.status === 'completed' && next.outputPath) await openTaskResult(next.outputPath);
      else notify('已结束等待，恢复文档编辑。');
    } catch (error) { notify('结束外部修改失败：' + error.message, 'error'); }
    finally { externalActionRef.current = false; setBusy(''); }
  };
  useEffect(() => {
    if (!task?.id || !host.task || ['completed', 'succeeded', 'done', 'failed', 'cancelled', 'canceled', 'needs-attention'].includes(task.status)) return;
    let alive = true, timer;
    const poll = async () => {
      try {
        // Another session may own a task for this document. Its private task
        // endpoint is not readable here; the document snapshot exposes the lock.
        if (task.ownedBySession === false) {
          const snapshot = await host.read(stateRef.current.file.path);
          if (!alive) return;
          if (!snapshot.activeTask) { installFile(snapshot); notify('AI 修改已结束，文档已更新并恢复编辑。'); return; }
          setTask(snapshot.activeTask);
        } else {
          const next = await host.task(task.id); if (!alive) return; setTask(next);
          if (['completed', 'succeeded', 'done'].includes(next.status) && next.outputPath) {
            if (stateRef.current.dirty) notify(next.delivery === 'updated-current' ? 'AI 已更新当前文件。你的未保存编辑仍在本页；打开结果时会保留为本地草稿供核对。' : 'AI 已完成。你有新的未保存修改，可保存后打开结果。', 'info');
            else await openTaskResult(next.outputPath);
            return;
          }
          if (['failed', 'cancelled', 'canceled', 'needs-attention'].includes(next.status)) { notify(next.message || '任务未完成，原文件和意见已保留。', 'info'); return; }
        }
      } catch (e) { if (alive) notify('任务状态读取失败：' + e.message, 'error'); }
      if (alive) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1200);
    return () => { alive = false; clearTimeout(timer); };
  }, [task?.id, task?.status, task?.ownedBySession, host, openTaskResult, installFile, notify]);
  useEffect(() => {
    const keyboard = e => {
      if (!rootRef.current?.contains(document.activeElement)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (canEdit()) save(); }
      if (e.key === 'Escape') { setContextMenu(null); dismissAnnotation(); setPickMode('interact'); setHoverRect(null); setAiOpen(false); }
    };
    addEventListener('keydown', keyboard); return () => removeEventListener('keydown', keyboard);
  }, [save, readOnly, dismissAnnotation]);

  useEffect(() => {
    const dialog = aiDialogRef.current;
    if (!aiOpen || !dialog) return;
    const returnFocus = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (returnFocus?.isConnected) returnFocus.focus(); };
  }, [aiOpen]);
  useEffect(() => {
    const dialog = promptDialogRef.current;
    if (!promptOpen || !task?.prompt || !dialog) return;
    const returnFocus = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (returnFocus?.isConnected) returnFocus.focus(); };
  }, [promptOpen, task?.prompt]);
  useEffect(() => { if (!task?.prompt) setPromptOpen(false); }, [task?.prompt]);

  const restoreDraft = () => {
    if (!canEdit() || !recovery || recovery.stale) return;
    setDoc(clone(recovery.doc)); setSource(recovery.source); setEdits(recovery.edits || {}); setRecovery(null);
    for (const annotation of Object.values(recovery.doc.annotations || {})) if (annotation.anchor?.id) send({ type: 'stamp', anchor: annotation.anchor });
    notify('已恢复未保存草稿，请核对后保存。', 'info');
  };
  const discardRecovery = () => { storage.remove('draft:' + doc.id); setRecovery(null); };
  const downloadRecovery = () => {
    try {
      const recoveredDoc = clone(recovery.doc);
      let recoveredSource = recovery.source;
      for (const [key, edit] of Object.entries(recovery.edits || {})) {
        if (!edit.body.trim()) continue;
        const annotation = { ...(recoveredDoc.annotations[key] || edit.annotation), body: edit.body.trim() };
        if (edit.isNew) { const stamped = stampAnchor(recoveredSource, annotation.anchor); recoveredSource = stamped.source; annotation.anchor = stamped.anchor; }
        recoveredDoc.annotations[key] = annotation;
      }
      const restored = recordHuman(recovery.baseDoc, recoveredDoc, '恢复本地未保存草稿', author || '产品');
      const html = write(recoveredSource, restored);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'recovered-draft.ux.html'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify('已下载草稿副本，包含已填写的标注正文；本地恢复记录仍保留。', 'info');
    } catch (e) { notify(e.message, 'error'); }
  };
  const resizePanel = event => {
    const start = event.clientX, initial = panelWidth;
    const handle = event.currentTarget, pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const root = rootRef.current;
    root.dataset.resizing = 'true';
    const move = e => setPanelWidth(Math.min(Math.max(280, Math.min(rootRef.current.clientWidth * .6, rootRef.current.clientWidth - 360)), Math.max(280, initial + start - e.clientX)));
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); removeEventListener('blur', up); delete root.dataset.resizing; if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId); document.body.style.cursor = ''; };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); addEventListener('blur', up); document.body.style.cursor = 'col-resize'; event.preventDefault();
  };
  useLayoutEffect(() => {
    const rails = [...(canvasRef.current?.querySelectorAll('.uxw-note-rail') || [])];
    if (!rails.length) { setRailHeight(0); return; }
    const measure = () => setRailHeight(Math.max(...rails.map(node => node.offsetHeight)));
    const observer = new ResizeObserver(measure);
    rails.forEach(node => observer.observe(node)); measure();
    return () => observer.disconnect();
  }, [annotationsMode, sides.left, sides.right, loading]);

  useLayoutEffect(() => {
    if (annotationsMode !== 'expanded' || panel === 'full') { setLines([]); return; }
    const update = () => {
      const origin = canvasRef.current?.getBoundingClientRect(), frame = frameRef.current?.getBoundingClientRect(), canvas = canvasRef.current?.getBoundingClientRect(); if (!origin || !frame || !canvas) return;
      const next = [];
      for (const annotation of visible) {
        const rect = measured.get(annotation.id).rect, cardNode = cardRefs.current.get(annotation.id), card = cardNode?.getBoundingClientRect();
        if (!card || rect.y + rect.height < 0 || rect.y > frameHeight) continue;
        const left = cardNode.closest('.uxw-note-rail')?.classList.contains('is-left');
        const x = frame.left + (left ? rect.x : rect.x + rect.width) * scale, y = frame.top + (rect.y + rect.height / 2) * scale;
        next.push({ id: annotation.id, x1: x - origin.left, y1: y - origin.top, x2: (left ? card.right : card.left) - origin.left, y2: card.top - origin.top + Math.min(card.height / 2, 50) });
      }
      setLines(next);
    };
    const raf = requestAnimationFrame(update);
    const area = areaRef.current; area?.addEventListener('scroll', update, true);
    return () => { cancelAnimationFrame(raf); area?.removeEventListener('scroll', update, true); };
  }, [annotationsMode, panel, visible, measured, scale, frameHeight, edits, navigation.pan, areaWidth]);

  useLayoutEffect(() => {
    const popup = popoverRef.current, root = rootRef.current;
    if (!popup || !root || (annotationsMode !== 'markers' && !edits[activeId]?.isNew) || panel === 'full') return;
    const position = () => {
      const bounds = root.getBoundingClientRect(), frame = frameRef.current?.getBoundingClientRect(), viewport = canvasRef.current?.getBoundingClientRect();
      const rect = measured.get(activeId)?.rect;
      const topEdge = viewport ? viewport.top - bounds.top + 8 : 76;
      const leftEdge = viewport ? viewport.left - bounds.left + 8 : 8;
      const rightEdge = viewport ? viewport.right - bounds.left - 8 : bounds.width - 8;
      const bottomEdge = viewport ? viewport.bottom - bounds.top - 8 : bounds.height - 8;
      const marker = root.querySelector('.uxw-marker.is-active')?.getBoundingClientRect();
      const x = marker ? marker.left - bounds.left : rect && frame ? frame.left - bounds.left + rect.x * scale : 16;
      const below = marker ? marker.bottom - bounds.top + 8 : rect && frame ? frame.top - bounds.top + (rect.y + rect.height) * scale + 8 : topEdge + 8;
      const above = marker ? marker.top - bounds.top - popup.offsetHeight - 8 : topEdge + 8;
      const y = below + popup.offsetHeight <= bottomEdge ? below : above;
      const next = { left: Math.max(leftEdge, Math.min(rightEdge - Math.min(popup.offsetWidth, rightEdge - leftEdge), x)), top: Math.max(topEdge, Math.min(bottomEdge - popup.offsetHeight, y)), maxWidth: rightEdge - leftEdge, maxHeight: bottomEdge - topEdge };
      setFloatingPosition(previous => equal(previous, next) ? previous : next);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popup); observer.observe(root);
    const area = areaRef.current; area?.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); area?.removeEventListener('scroll', position, true); };
  }, [activeId, annotationsMode, panel, measured, scale, loading, navigation.pan, !!edits[activeId]?.isNew]);

  const menuFor = (annotation, event) => {
    if (event.target.closest('textarea,input,select') || (readOnly && !referencedIds.includes(annotation.id))) return;
    event.preventDefault(); event.stopPropagation(); setActiveId(annotation.id);
    setContextMenu({ id: annotation.id, linkedIds: [annotation.id], x: Math.max(8, Math.min(innerWidth - 230, event.clientX)), y: Math.max(8, Math.min(innerHeight - 260, event.clientY)) });
  };
  const card = (annotation, { floating = false } = {}) => {
    const kind = KIND(annotation);
    const edit = edits[annotation.id], isEditing = !readOnly && editingId === annotation.id && !!edit;
    return <article key={annotation.id} data-annotation-id={annotation.id} className={`uxw-card is-${kind} ${activeId === annotation.id ? 'is-selected' : ''} ${floating ? 'is-floating' : ''} ${isEditing ? 'is-editing' : ''}`} ref={node => { if (!floating) { if (node) cardRefs.current.set(annotation.id, node); else cardRefs.current.delete(annotation.id); } }} onContextMenu={e => menuFor(annotation, e)}>
      <header className="uxw-card-head">
        <button type="button" className="uxw-card-title" aria-label={`定位标注 ${numbered.get(annotation.id)}：${LABELS[kind]}`} title="点击定位对应元素" onClick={() => locate(annotation)}>
          <span className={`uxw-number is-${kind}`}>{numbered.get(annotation.id)}</span><strong>{LABELS[kind]}</strong>
          {kind === 'change-request' && <span className={`uxw-status ${annotation.status === 'resolved' ? 'is-resolved' : ''}`}>{annotation.status === 'resolved' ? '已处理' : '待处理'}</span>}
        </button>
        {!readOnly && <IconButton icon={Trash2} label="删除标注" className="is-danger" onClick={() => deleteAnnotation(annotation.id)} />}
      </header>
      {isEditing ? <div className="uxw-card-editor" onContextMenu={e => e.stopPropagation()}>
        <div className="uxw-card-editor-field">
          <AutoTextarea autoFocus value={edit.body} onChange={e => { if (canEdit()) setEdits(prev => ({ ...prev, [annotation.id]: { ...prev[annotation.id], body: e.target.value } })); }} placeholder={kind === 'explanation' ? '描述操作逻辑、触发条件或业务规则…' : '描述需要修改的内容与预期结果…'} aria-label="标注正文" />
          <div className="uxw-card-edit-actions"><IconButton icon={X} label="取消编辑" onClick={() => cancelEdit(annotation.id)} /><IconButton icon={Check} label="完成编辑" className="uxw-confirm" onClick={() => commitEdit(annotation.id)} /></div>
        </div>
      </div> : <Markdown className={`uxw-card-body ${!readOnly ? 'is-editable' : ''}`} value={annotation.body || '*未填写内容*'} tabIndex={readOnly ? undefined : 0} role={readOnly ? undefined : 'button'} aria-label={readOnly ? undefined : '编辑标注正文'} onClick={e => startEdit(annotation, e)} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) startEdit(annotation, e); }} />}
      {!readOnly && edit && !isEditing && <button className="uxw-resume-draft uxw-text-button" onClick={() => { if (canEdit()) { setEditingId(annotation.id); setActiveId(annotation.id); } }}>继续草稿</button>}
    </article>;
  };

  const openDocument = async () => {
    try {
      // DSH opens a separate page; the existing tab and its unsaved edits remain.
      if (host.openDocument) { await host.openDocument(); return; }
      if (dirty && !confirm('当前有未保存修改，仍要打开其他文件吗？')) return;
      const selected = await host.pick(); if (selected) installFile(selected);
    } catch (reason) { if (doc) notify('打开设计文档失败：' + (reason.message || String(reason)), 'error'); else setError(reason.message || String(reason)); }
  };
  const canOpenDocument = !!(host.openDocument || host.pick);
  if (loading) return <div className="uxw uxw-loading"><LoaderCircle className="uxw-spin" size={25} /><span>正在打开设计文档…</span></div>;
  if (error && !doc) return <div className="uxw"><ErrorView message={error} onRetry={() => load()} onOpen={canOpenDocument ? openDocument : undefined} /></div>;
  if (!doc) return <div className="uxw"><div className="uxw-empty"><FileText size={36} /><strong>打开设计文档，开始评审</strong><p>交互稿、PRD、标注与变更都保存在同一个文档中。</p>{canOpenDocument && <button className="uxw-button is-primary" onClick={openDocument}><FolderOpen size={16} />打开设计文档</button>}</div></div>;
  const active = annotations.find(a => a.id === activeId);
  const menuAnnotation = contextMenu?.id && annotations.find(a => a.id === contextMenu.id);
  const menuReferences = prdReferences.filter(reference => contextMenu?.linkedIds?.includes(reference.annotationId));
  return <div ref={rootRef} className={`uxw ${readOnly ? 'is-readonly' : ''}`} onPointerDown={e => { if (!e.target.closest('.uxw-menu')) setContextMenu(null); if ((annotationsMode === 'markers' || edits[activeId]?.isNew) && !e.target.closest('.uxw-card,.uxw-marker,.uxw-menu,.uxw-tooltip,.uxw-annotation-index,.uxw-tabs')) dismissAnnotation(); }}>
    <header className="uxw-topbar"><div className="uxw-document-heading"><strong title={`${doc.title} · ${file.name || file.path || '原型评审文档'}`}>{doc.title}</strong></div><span className="uxw-version">v{String(doc.uxVersion).padStart(3, '0')} <span>· r{doc.revision}</span></span><div className="uxw-save-status" role="status"><span className={dirty ? 'is-dirty' : ''} />{aiEditing ? task?.destination === 'external' ? '等待外部修改 · 只读' : 'AI 修改中 · 只读' : readOnly ? '只读评审' : dirty ? '未保存' : '已保存'}</div><span className="uxw-spacer" />
      {!readOnly && <label className="uxw-author">作者 <input aria-label="作者名称" value={author} onChange={e => setAuthor(e.target.value)} /></label>}
      {canOpenDocument && <IconButton icon={FolderOpen} label="打开设计文档" onClick={openDocument} />}
      {!readOnly && <IconButton icon={busy === 'save' ? LoaderCircle : Save} label="保存文档" disabled={!!busy} onClick={save} className={busy === 'save' ? 'uxw-spin-child' : ''} />}
      {host.exportReview && <IconButton icon={Download} label="导出完整评审 HTML" disabled={!!busy} onClick={exportDocument} />}
      {!readOnly && host.submit && <button className="uxw-ai-button" onClick={() => { setCreateNewVersion(false); setAiOpen(true); if (!selectedIds.length) setSelectedIds(annotations.filter(a => KIND(a) === 'change-request' && a.status !== 'resolved').map(a => a.id)); }} disabled={!!busy || ['running', 'queued'].includes(task?.status)}><Sparkles size={16} />交给 AI 修改</button>}
    </header>
    {task && <div className={`uxw-taskbar is-${task.status}${task.destination === 'external' ? ' is-external' : ''}`}>
      <Sparkles size={14} aria-hidden="true" /><span className="uxw-task-message">{task.message || ({ queued: '任务已排队', running: 'AI 正在修改原型', completed: '修改完成', succeeded: '修改完成', failed: '任务未完成', cancelled: '任务已取消' }[task.status] || task.status)}</span>
      {task.outputPath && <button type="button" className="uxw-text-button" disabled={openingResult} aria-busy={openingResult} onClick={() => openTaskResult(task.outputPath, true)}>{openingResult ? <>正在打开修改结果 <LoaderCircle className="uxw-spin" size={12} /></> : <>打开修改结果 <ArrowRight size={12} /></>}</button>}
      <span className="uxw-spacer" />
      {task.destination === 'external' && task.ownedBySession !== false && activeTask(task) && <div className="uxw-task-actions">
        {task.prompt && <IconButton icon={Copy} label="复制修改说明" onClick={copyTaskPrompt} />}
        <button type="button" className="uxw-text-button" disabled={!!busy || openingResult} onClick={readExternalResult}>读取修改结果</button>
        {host.cancel && <IconButton icon={X} label="结束外部修改" disabled={!!busy} onClick={cancelExternalTask} />}
      </div>}
      {['completed', 'succeeded', 'done', 'failed', 'cancelled', 'canceled', 'needs-attention'].includes(task.status) && <IconButton icon={X} label="收起任务提示" onClick={() => setTask(null)} />}
    </div>}
    {recovery && <div className="uxw-recovery" role="status"><History size={14} /><span>{recovery.stale ? '发现旧版本的未保存草稿。当前文件已有更新，可下载草稿副本核对。' : '发现上次未保存的草稿，是否恢复继续编辑？'}</span><span className="uxw-spacer" />{!recovery.stale && <button className="uxw-text-button" disabled={readOnly} onClick={restoreDraft}>恢复草稿</button>}<button className="uxw-text-button" onClick={downloadRecovery}>下载草稿</button><button className="uxw-text-button" onClick={discardRecovery}>放弃草稿</button></div>}
    <div className="uxw-workspace">
      <main className="uxw-interaction" style={{ display: panel === 'full' ? 'none' : undefined }}>
        <div className="uxw-interaction-toolbar">
          <div className="uxw-segment" role="group" aria-label="标注展示">{[['off', EyeOff, '关闭标注'], ['markers', MapPin, '显示标注'], ['expanded', MessagesSquare, '展开标注']].map(([value, Icon, label]) => <IconButton key={value} icon={Icon} label={label} active={annotationsMode === value} onClick={() => changeMode(value)} />)}</div>
          <AnnotationFilters kind={filter} status={statusFilter} onKindChange={value => { setFilter(value); setActiveId(null); }} onStatusChange={value => { setStatusFilter(value); setActiveId(null); }} />
          {!readOnly && <><span className="uxw-tool-separator" /><div className="uxw-segment" role="group" aria-label="默认新增类型"><IconButton icon={Info} label="默认新增交互说明" active={newKind === 'explanation'} onClick={() => setNewKind('explanation')} /><IconButton icon={MessageSquareDiff} label="默认新增修改意见" active={newKind === 'change-request'} onClick={() => setNewKind('change-request')} /></div><IconButton icon={MousePointer2} label="选择元素添加标注" active={pickMode === 'element'} onClick={() => pickMode === 'element' ? setPickMode('interact') : startPick('element')} /><IconButton icon={Scan} label="框选区域添加标注" active={pickMode === 'region'} onClick={() => pickMode === 'region' ? setPickMode('interact') : startPick('region')} /></>}
          <span className="uxw-spacer" />
          <div className="uxw-viewport-controls"><Monitor size={14} /><select aria-label="设备宽度" value={width} onChange={e => setWidth(Number(e.target.value))}><option value="1440">桌面 1440</option><option value="1280">桌面 1280</option><option value="1024">平板 1024</option><option value="768">平板 768</option><option value="390">手机 390</option></select><select aria-label="原型缩放" value={zoom} onChange={e => e.target.value === 'fit' ? navigation.reset() : setZoom(e.target.value)}>{zoom !== 'fit' && !['0.5', '0.75', '1', '1.25'].includes(zoom) && <option value={zoom}>{Math.round(scale * 100)}%</option>}<option value="fit">适应 {Math.round(fitScale * 100)}%</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option></select></div>
          {panel === 'hidden' && <IconButton icon={PanelRightOpen} label="打开 PRD" onClick={() => setPanel('sidebar')} />}
        </div>
        {pickMode !== 'interact' && <div className="uxw-pick-hint"><MousePointer2 size={13} />{pickMode === 'element' ? '点击页面元素' : '拖动框选区域'}，添加{LABELS[pickerKindRef.current]}<span className="uxw-spacer" /><button onClick={() => { setPickMode('interact'); setHoverRect(null); }}>Esc 取消</button></div>}
        <div className={`uxw-preview-area ${annotationsMode === 'expanded' ? 'is-expanded' : ''}`} ref={areaRef} tabIndex={0} role="region" aria-label="原型与标注画布，Ctrl 加减缩放，空格拖动画布">
          <div className="uxw-visually-hidden" aria-live="polite">{navigation.feedback}</div>
          <div className="uxw-preview-content" ref={contentRef}>
          <div className={`uxw-canvas ${navigation.space ? 'is-panning-ready' : ''} ${navigation.dragging ? 'is-panning' : ''}`} data-pan-x={navigation.pan.x} data-pan-y={navigation.pan.y} tabIndex={0} aria-label="原型画布：Ctrl 加减缩放，空格拖动，方向键平移" ref={canvasRef} onPointerDown={e => { if (e.target === e.currentTarget) setActiveId(null); }}><div className="uxw-frame-space" style={{ width: width * scale, height: frameHeight * scale, ...navigation.frameStyle }}><div className="uxw-frame-logical" style={{ width, height: frameHeight, transform: `scale(${scale})` }}><iframe ref={frameRef} title="交互原型" srcDoc={frameHtml} width={width} height={frameHeight} sandbox="allow-scripts allow-forms" onLoad={() => { send({ type: 'annotations', annotations, referencedIds, showAnnotations: annotationsMode !== 'off' }); send({ type: 'annotation-visibility', value: annotationsMode }); }} />
            {hoverRect && pickMode !== 'interact' && <div className="uxw-hover-target" style={{ left: hoverRect.x, top: hoverRect.y, width: hoverRect.width, height: hoverRect.height }} />}
            {annotationsMode !== 'off' && filtered.map(annotation => {
              const rect = measured.get(annotation.id)?.rect;
              if (!rect || rect.y + rect.height < 0 || rect.y > frameHeight || rect.x + rect.width < 0 || rect.x > width) return null;
              return <React.Fragment key={annotation.id}>{activeId === annotation.id && <div className="uxw-target-selected" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />}<button className={`uxw-marker is-${KIND(annotation)} ${activeId === annotation.id ? 'is-active' : ''}`} aria-label={`标注 ${numbered.get(annotation.id)}：${LABELS[KIND(annotation)]}`} style={{ left: markerPositions.get(annotation.id)?.x, top: markerPositions.get(annotation.id)?.y, transform: `scale(${1 / scale})` }} onPointerDown={e => { if (e.button === 0) { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); } }} onClick={e => { e.stopPropagation(); setContextMenu(null); if (activeId === annotation.id && (annotationsMode === 'markers' || edits[annotation.id]?.isNew)) dismissAnnotation(); else { setActiveId(annotation.id); if (edits[annotation.id]) setEditingId(annotation.id); if (annotationsMode === 'expanded' && !edits[annotation.id]?.isNew) revealCard(annotation.id); } }} onContextMenu={e => menuFor(annotation, e)}>{numbered.get(annotation.id)}</button></React.Fragment>;
            })}
          </div></div>
          {annotationsMode === 'expanded' && leftCards.length > 0 && <aside className="uxw-note-rail is-left" aria-label="左侧标注" style={railStyle('left')}>{leftCards.map(a => card(a))}</aside>}
          {annotationsMode === 'expanded' && (rightCards.length > 0 || otherCards.length > 0) && <aside className="uxw-note-rail is-right" aria-label="右侧标注" style={railStyle('right')}>{rightCards.map(a => card(a))}{otherCards.length > 0 && <details className="uxw-unlocated" open={!visible.length}><summary>其他或未定位标注 · {otherCards.length}</summary>{otherCards.map(a => card(a))}</details>}</aside>}
          {annotationsMode === 'expanded' && <svg className="uxw-connectors" aria-hidden="true">{lines.map(line => <path key={line.id} className={activeId === line.id ? 'is-active' : ''} d={`M ${line.x1} ${line.y1} C ${(line.x1 + line.x2) / 2} ${line.y1}, ${(line.x1 + line.x2) / 2} ${line.y2}, ${line.x2} ${line.y2}`} />)}</svg>}
        </div></div></div>
      </main>
      <aside className={`uxw-docpanel is-${panel}`} style={{ width: panel === 'full' ? '100%' : panelWidth, display: panel === 'hidden' ? 'none' : undefined }}>
        <div className="uxw-panel-header">
          <div className="uxw-tabs" role="tablist" aria-label="设计文档" focusgroup={nativeFocusGroup ? 'tablist nomemory' : undefined} onKeyDown={onTabKeyDown}>{[['prd', FileText, 'PRD'], ['annotations', MessagesSquare, '标注', annotations.length], ['changes', History, '变更', doc.changes.length + (doc.legacyHistory ? 1 : 0)]].map(([key, Icon, label, count]) => <button type="button" role="tab" id={`${tabsId}-${key}`} aria-selected={tab === key} tabIndex={nativeFocusGroup || tab === key ? 0 : -1} focusgroupstart={nativeFocusGroup && tab === key ? '' : undefined} ref={node => { if (node) tabRefs.current.set(key, node); else tabRefs.current.delete(key); }} key={key} className={tab === key ? 'is-active' : ''} onFocus={() => setTab(key)} onClick={() => setTab(key)}><Icon size={14} aria-hidden="true" />{label}{count > 0 && <span>{count}</span>}</button>)}</div>
          <IconButton icon={panel === 'full' ? Minimize2 : Maximize2} label={panel === 'full' ? '返回侧栏' : `全屏查看 ${{ prd: 'PRD', annotations: '标注', changes: '变更' }[tab]}`} onClick={() => setPanel(panel === 'full' ? 'sidebar' : 'full')} /><IconButton icon={PanelRightClose} label="收起 PRD" onClick={() => setPanel('hidden')} />
        </div>
        <div className="uxw-document-body" ref={prdScrollRef}>
          <section role="tabpanel" aria-labelledby={`${tabsId}-prd`} hidden={tab !== 'prd'} tabIndex={readOnly && tab === 'prd' ? 0 : undefined} className="uxw-prd-section">{!readOnly && PrdEditor ? <PrdEditor key={doc.id} value={doc.prd} annotations={doc.annotations} onLocateAnnotation={locateFromPrd} onRegisterReferenceActions={registerPrdReferences} onChange={updatePrd} /> : !readOnly ? <textarea className="uxw-prd-editor" aria-label="PRD 正文" value={doc.prd} onChange={e => updatePrd(e.target.value)} placeholder="# 产品需求\n\n记录目标、用户流程和业务规则…" /> : doc.prd ? <PrdReferencesContent value={doc.prd} annotations={doc.annotations} onLocateAnnotation={locateFromPrd} onRegisterReferenceActions={registerPrdReferences} renderMarkdown={(source, key) => <Markdown key={key} value={source} className="uxw-prd-content" headings />} /> : <div className="uxw-soft-empty"><FileText size={24} /><p>还没有需求说明</p></div>}</section>
          <section role="tabpanel" aria-labelledby={`${tabsId}-annotations`} hidden={tab !== 'annotations'}><AnnotationIndex key={doc.id} annotations={annotations} numbered={numbered} measured={measured} activeId={activeId} active={tab === 'annotations' && panel !== 'hidden'} edits={edits} onLocate={locateFromIndex} onContextMenu={menuFor} renderBody={body => <Markdown value={body || '*未填写内容*'} className="uxw-index-body" />} /></section>
          <section role="tabpanel" aria-labelledby={`${tabsId}-changes`} tabIndex={tab === 'changes' ? 0 : undefined} hidden={tab !== 'changes'} className="uxw-changes">{!doc.changes.length && !doc.legacyHistory && <div className="uxw-soft-empty"><History size={24} /><p>保存修改后，变更记录会显示在这里。</p></div>}{[...doc.changes].reverse().map(change => <details key={change.id} open={change === doc.changes.at(-1)} className="uxw-change"><summary><span className={`uxw-change-dot is-${change.actor}`} /><div><strong>{change.summary}</strong><small>r{change.revision} · {({ agent: 'AI', human: '人工', system: '系统' }[change.actor] || change.actor || '系统')} · {time(change.at)}</small></div><ChevronDown size={13} /></summary><ul>{(change.details || []).map((detail, i) => <li key={i}>{detail}</li>)}</ul><ChangePrdDiff change={change} />{(change.patch || []).filter(p => p.path?.startsWith('/annotations/')).map((patch, i) => <div key={i} className="uxw-patch"><span>{patch.op === 'remove' ? '删除标注' : patch.op === 'add' ? '新增标注' : '更新标注'}</span>{patch.before?.body && <del>{patch.before.body}</del>}{patch.value?.body && <ins>{patch.value.body}</ins>}</div>)}</details>)}<LegacyHistory history={doc.legacyHistory} /></section>
        </div>
        {panel === 'sidebar' && <div className="uxw-divider" role="separator" aria-label="调整 PRD 侧栏宽度" aria-orientation="vertical" aria-valuenow={panelWidth} aria-valuemin={280} tabIndex={0} onPointerDown={resizePanel} onDoubleClick={() => setPanelWidth(400)} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPanelWidth(w => Math.max(280, Math.min(rootRef.current.clientWidth - 360, w + (e.key === 'ArrowLeft' ? 16 : -16)))); } }} />}
      </aside>
    </div>
    {panel !== 'full' && (annotationsMode === 'markers' || (annotationsMode === 'expanded' && edits[activeId]?.isNew)) && active && (measured.get(active.id)?.rect || editingId === active.id) && <div ref={popoverRef} className="uxw-popover" style={floatingPosition}>{card(active, { floating: true })}</div>}
    {contextMenu && <div className="uxw-menu" role="menu" aria-label="标注操作" style={{ left: contextMenu.x, top: contextMenu.y, maxHeight: Math.min(420, innerHeight - contextMenu.y - 8) }}>
      {!readOnly && contextMenu.anchor && contextMenu.canAdd && <button role="menuitem" onClick={() => createAt(contextMenu.anchor, contextMenu.newKind)}>{contextMenu.newKind === 'explanation' ? <Info size={15} /> : <MessageSquareDiff size={15} />}添加{LABELS[contextMenu.newKind]}</button>}
      {menuAnnotation && !readOnly && <>
        <button role="menuitem" onClick={e => { startEdit(menuAnnotation, e); setContextMenu(null); }}><Pencil size={15} />编辑正文</button>
        {doc.annotations[menuAnnotation.id]?.kind === 'explanation' && <button role="menuitem" onClick={() => addToPrd(menuAnnotation)}><FileText size={15} />添加到 PRD</button>}
      </>}
      {menuReferences.map((reference, index) => <button key={reference.referenceId} role="menuitem" onClick={() => jumpToPrd(reference.referenceId)}><FileText size={15} />跳转到 PRD{menuReferences.length > 1 ? ` · 第${index + 1}处` : ''}</button>)}
      {menuAnnotation && !readOnly && <>
        {doc.annotations[menuAnnotation.id] && <button role="menuitem" onClick={() => convert(menuAnnotation)}><RotateCcw size={15} />转为{LABELS[KIND(menuAnnotation) === 'explanation' ? 'change-request' : 'explanation']}</button>}
        {doc.annotations[menuAnnotation.id] && KIND(menuAnnotation) === 'change-request' && <button role="menuitem" onClick={() => { updateAnnotation(menuAnnotation.id, menuAnnotation.status === 'resolved' ? { status: 'open', resolution: undefined } : { status: 'resolved', resolution: { actor, at: now(), summary: '人工标记已处理' } }); setContextMenu(null); }}><CircleCheck size={15} />{menuAnnotation.status === 'resolved' ? '重新打开意见' : '标记已处理'}</button>}
        <button role="menuitem" className="is-danger" onClick={() => deleteAnnotation(menuAnnotation.id)}><Trash2 size={15} />删除标注</button>
      </>}
    </div>}
    {!readOnly && deleted && <div className="uxw-undo"><Trash2 size={13} /><span>已删除标注</span><button onClick={undoDelete}><Undo2 size={13} />撤销</button><IconButton icon={X} label="关闭撤销提示" onClick={() => setDeleted(null)} /></div>}
    {notice && <div className={`uxw-toast is-${notice.tone}`} role="status">{notice.tone === 'error' ? <Info size={16} /> : <CircleCheck size={16} />}<span>{notice.message}</span><IconButton icon={X} label="关闭提示" onClick={() => setNotice(null)} /></div>}
    {promptOpen && task?.prompt && <dialog ref={promptDialogRef} className="uxw-dialog uxw-prompt-dialog" aria-label="复制修改说明" onCancel={() => setPromptOpen(false)}>
      <header><div><Copy size={20} aria-hidden="true" /><h2>复制修改说明</h2></div><IconButton icon={X} label="关闭修改说明" onClick={() => setPromptOpen(false)} /></header>
      <p>粘贴给能访问本机工作文件的 Agent。完成后可在此读取修改结果。</p>
      <textarea className="uxw-prompt-text" aria-label="给外部 Agent 的修改说明" readOnly value={task.prompt} onFocus={event => event.currentTarget.select()} />
      <footer>{host.cancel && activeTask(task) && <button type="button" className="uxw-button" disabled={!!busy} onClick={cancelExternalTask}>结束外部修改</button>}<button type="button" className="uxw-button is-primary" onClick={copyTaskPrompt}><Copy size={15} aria-hidden="true" />复制修改说明</button></footer>
    </dialog>}
    {aiOpen && !readOnly && <dialog ref={aiDialogRef} className="uxw-dialog" aria-label="交给 AI 修改" onCancel={() => setAiOpen(false)} onClick={e => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) setAiOpen(false); } }}><header><div><Sparkles size={20} /><h2>交给 AI 修改</h2></div><IconButton icon={X} label="关闭 AI 修改窗口" onClick={() => setAiOpen(false)} /></header><p>选定本轮修改范围。交互说明作为需求上下文保留。</p><div className="uxw-ai-list">{annotations.filter(a => KIND(a) === 'change-request' && a.status !== 'resolved').map(a => <label key={a.id}><input type="checkbox" checked={selectedIds.includes(a.id)} onChange={e => setSelectedIds(prev => e.target.checked ? [...prev, a.id] : prev.filter(key => key !== a.id))} /><span><strong>#{numbered.get(a.id)} 修改意见</strong><small>{a.body}</small></span></label>)}{!pendingCount && <div className="uxw-soft-empty">没有待处理修改意见，可将 PRD 修改交给 AI。</div>}</div><label className="uxw-checkline"><input type="checkbox" checked={includePrdChanges} onChange={e => setIncludePrdChanges(e.target.checked)} />处理 PRD 修改，并同步本轮意见涉及的需求</label><small className="uxw-ai-note">只更新与本轮修改直接相关的需求；关闭后 PRD 保持原文。</small><label className="uxw-checkline"><input type="checkbox" name="createNewVersion" aria-describedby={newVersionHelpId} checked={createNewVersion} onChange={e => setCreateNewVersion(e.target.checked)} />生成新版本文件</label><small className="uxw-ai-note" id={newVersionHelpId}>{createNewVersion ? '另存结果文件，保留当前文件。' : '默认更新当前文件，保留修改前备份与完整变更记录。'}</small><label className="uxw-checkline"><input type="checkbox" checked={clearResolved} onChange={e => setClearResolved(e.target.checked)} />清理本轮 AI 已处理的修改意见</label><small className="uxw-ai-note">发送和复制使用同一份修改说明，并先保存文档；执行期间可查看，暂不能编辑。</small><footer><button className="uxw-button" onClick={() => setAiOpen(false)}>取消</button><button type="button" className="uxw-button" disabled={!!busy || (!selectedIds.length && !includePrdChanges)} onClick={copySubmission}><Copy size={15} aria-hidden="true" />复制给外部 Agent</button><button type="button" className="uxw-button is-primary" disabled={!!busy || (!selectedIds.length && !includePrdChanges)} onClick={() => submit('dsh')}>{busy ? <LoaderCircle className="uxw-spin" size={15} /> : <Sparkles size={15} aria-hidden="true" />}发送到 DSH {selectedIds.length ? `(${selectedIds.length})` : ''}</button></footer></dialog>}
  </div>;
}
