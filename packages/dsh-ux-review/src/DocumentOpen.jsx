import React, { useEffect, useId, useRef, useState } from 'react';
import { FileText, FolderOpen, Upload, LoaderCircle, ArrowRight, CircleCheck } from 'lucide-react';
import { inspectDocumentInput, MAX_DOCUMENT_BYTES } from './document-input.mjs';

// File selection grants only these bytes. The Host never receives a source path
// or authority to read arbitrary files outside the session workspace.
export default function DocumentOpen({ importFile, openDocument }) {
  const inputId = useId(), helpId = useId(), errorId = useId();
  const inputRef = useRef(null), headingRef = useRef(null), errorRef = useRef(null);
  const locked = useRef(false), alive = useRef(true), delivered = useRef(null), dragDepth = useRef(0);
  const [pending, setPending] = useState(null), [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [dragging, setDragging] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (!busy && (pending || saved)) headingRef.current?.focus(); }, [pending, saved, busy]);
  const reportError = reason => { if (alive.current) setError(reason.message || String(reason)); };
  const navigate = async result => {
    // Keep the saved receipt if navigation fails. Retrying must not import again.
    delivered.current = result;
    if (alive.current) setSaved(result);
    await openDocument(result.path);
  };
  const persist = async (selection, allowConvert) => {
    const result = await importFile({ name: selection.name, html: selection.html, allowConvert });
    delivered.current = result;
    if (!alive.current) return;
    setPending(null); setSaved(result);
    if (!result.report?.unmigrated?.length) await navigate(result);
  };
  const selectFiles = async files => {
    if (locked.current || !files?.length) return;
    locked.current = true; setBusy('正在识别文档…'); setError(''); setPending(null); setSaved(null); delivered.current = null;
    try {
      if (files.length !== 1) throw new Error('请一次选择一个设计文档。');
      const file = files[0];
      if (!/\.html?$/i.test(file.name)) throw new Error('请选择 HTML 格式的设计文档或交互稿（.html 或 .htm）。');
      if (file.size > MAX_DOCUMENT_BYTES) throw new Error('文件超过 50 MB，请选择更小的文档。');
      const buffer = await file.arrayBuffer();
      let html;
      try { html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
      catch { throw new Error('无法读取文件编码，请将文档另存为 UTF-8 后重试。'); }
      const info = inspectDocumentInput(html), selection = { name: file.name, html, ...info };
      if (!alive.current) return;
      if (info.kind === 'design') { setBusy('正在打开设计文档…'); await persist(selection, false); }
      else setPending(selection);
    } catch (reason) { reportError(reason); }
    finally { locked.current = false; if (alive.current) setBusy(''); }
  };
  const convert = async () => {
    if (locked.current || !pending) return;
    locked.current = true; setBusy('正在导入设计文档…'); setError('');
    try { await persist(pending, true); } catch (reason) { reportError(reason); }
    finally { locked.current = false; if (alive.current) setBusy(''); }
  };
  const openSaved = async () => {
    if (locked.current || !delivered.current) return;
    locked.current = true; setBusy('正在打开设计文档…'); setError('');
    try { await navigate(delivered.current); } catch (reason) { reportError(reason); }
    finally { locked.current = false; if (alive.current) setBusy(''); }
  };
  const reset = () => { if (locked.current) return; setPending(null); setSaved(null); setError(''); delivered.current = null; inputRef.current?.focus(); };
  const fileDrag = event => Array.from(event.dataTransfer.types || []).includes('Files');
  return <main className={`dsh-ux-open ${dragging ? 'is-dragging' : ''}`} aria-busy={!!busy}
    onDragEnter={event => { if (!fileDrag(event)) return; event.preventDefault(); if (++dragDepth.current === 1) setDragging(true); }}
    onDragOver={event => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }}
    onDragLeave={event => { if (!fileDrag(event)) return; if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDrop={event => { if (!fileDrag(event)) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); void selectFiles(Array.from(event.dataTransfer.files)); }}>
    <section className="dsh-ux-open-content">
      <div className="dsh-ux-open-glyph" aria-hidden="true"><FileText size={32} strokeWidth={1.5} /></div>
      <h1>打开设计文档</h1>
      <p className="dsh-ux-open-intro">从本机选择，或拖入别人发来的文档。</p>
      <div className={`dsh-ux-open-drop ${dragging ? 'is-dragging' : ''}`}>
        <Upload size={22} aria-hidden="true" />
        <p>交互稿、PRD、标注与变更，一起打开。</p>
        <input ref={inputRef} id={inputId} className="dsh-ux-open-input" name="design-document" type="file" accept=".html,.htm,text/html" disabled={!!busy}
          aria-invalid={error ? true : undefined} aria-describedby={`${helpId}${error ? ' ' + errorId : ''}`}
          onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; void selectFiles(files); }} />
        <label className="dsh-ux-open-button is-primary" htmlFor={inputId}><FolderOpen size={16} aria-hidden="true" />选择本地文件</label>
        <small id={helpId}>支持 .ux.html、.review.html 和普通 HTML，按内容识别文档类型。</small>
      </div>
      <p className="dsh-ux-open-storage">文件将保存到当前会话目录，原文件保留；同名文件自动区分。</p>
      {busy && <p className="dsh-ux-open-status" role="status"><LoaderCircle size={16} className="dsh-ux-open-spin" aria-hidden="true" />{busy}</p>}
      {error && <p id={errorId} ref={errorRef} tabIndex={-1} role="alert" className="dsh-ux-open-error">{error}</p>}
      {pending && <section className="dsh-ux-open-confirm" aria-labelledby={`${inputId}-confirm`}>
        <h2 ref={headingRef} tabIndex={-1} id={`${inputId}-confirm`}>{pending.kind === 'legacy' ? '这是旧版设计文档' : '这是普通交互稿'}</h2>
        <p className="dsh-ux-open-filename">{pending.name}</p>
        <p>{pending.kind === 'legacy' ? '迁移已有 PRD 与历史，转换为当前设计文档格式。' : '保留现有页面，加入 PRD、标注与变更记录的保存能力。'}</p>
        <div className="dsh-ux-open-actions"><button type="button" className="dsh-ux-open-button" disabled={!!busy} onClick={reset}>取消</button><button type="button" className="dsh-ux-open-button is-primary" disabled={!!busy} onClick={convert}>导入为设计文档<ArrowRight size={15} aria-hidden="true" /></button></div>
      </section>}
      {saved && !busy && <section className="dsh-ux-open-confirm" aria-labelledby={`${inputId}-saved`}>
        <h2 ref={headingRef} tabIndex={-1} id={`${inputId}-saved`}><CircleCheck size={18} aria-hidden="true" />已保存设计文档</h2>
        <p className="dsh-ux-open-filename">{saved.name}</p>
        {!!saved.report?.unmigrated?.length && <details className="dsh-ux-open-report"><summary>有 {saved.report.unmigrated.length} 项旧内容未映射到新格式</summary><ul>{saved.report.unmigrated.map((item, index) => <li key={index}><strong>{item.field}</strong>：{item.note}</li>)}</ul><p>这些内容仍保留在你选择的原文件中。</p></details>}
        <div className="dsh-ux-open-actions"><button type="button" className="dsh-ux-open-button" onClick={reset}>打开其他文档</button><button type="button" className="dsh-ux-open-button is-primary" onClick={openSaved}>打开文档<ArrowRight size={15} aria-hidden="true" /></button></div>
      </section>}
    </section>
  </main>;
}
