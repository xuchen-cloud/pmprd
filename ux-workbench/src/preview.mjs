// Runs in an opaque-origin iframe; this bridge has no filesystem or host API access.
function bridge(token) {
  let mode = 'interact', annotations = [], dragging = null, showAnnotations = true, frame = 0;
  let referencedIds = new Set();
  const send = data => parent.postMessage({ channel: 'craft-ux-preview', token, ...data }, '*');
  const css = value => CSS.escape(String(value));
  const editable = target => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
  const editing = () => document.hasFocus() && editable(document.activeElement);
  const reportEditing = () => send({ type: 'canvas-input-focus', editing: editing() });
  addEventListener('focusin', reportEditing, true);
  addEventListener('focusout', () => queueMicrotask(reportEditing), true);
  addEventListener('focus', reportEditing);
  addEventListener('blur', () => send({ type: 'canvas-input-focus', editing: false }));
  // Pointer events within a sandbox do not bubble to its host. Keep hover
  // ownership current even when moving directly between scaled iframes.
  let pointerNotice = 0;
  addEventListener('pointerover', () => send({ type: 'canvas-pointer' }), true);
  addEventListener('pointermove', () => {
    if (!pointerNotice) pointerNotice = requestAnimationFrame(() => { pointerNotice = 0; send({ type: 'canvas-pointer' }); });
  }, true);
  addEventListener('pointerout', event => {
    if (!event.relatedTarget) { cancelAnimationFrame(pointerNotice); pointerNotice = 0; }
  }, true);
  // Navigation crosses the sandbox only through this authenticated bridge.
  // Capture before demo scripts; ordinary scrolling and text input remain local.
  addEventListener('wheel', event => {
    if (!(event.ctrlKey || event.metaKey) || editing()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    send({ type: 'canvas-navigation', action: 'zoom', factor: Math.exp(-Math.max(-240, Math.min(240, delta)) * .002), x: event.clientX, y: event.clientY });
  }, { capture: true, passive: false });
  addEventListener('keydown', event => {
    if (event.isComposing || editing()) return;
    const direction = ['+', '='].includes(event.key) ? 1 : event.key === '-' ? -1 : 0;
    if ((event.ctrlKey || event.metaKey) && (direction || event.key === '0')) {
      event.preventDefault(); event.stopImmediatePropagation();
      send({ type: 'canvas-navigation', action: event.key === '0' ? 'reset' : 'zoom', factor: direction > 0 ? 1.1 : 1 / 1.1 });
    } else if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopImmediatePropagation();
      send({ type: 'canvas-navigation', action: 'pan-start' });
    }
  }, true);
  addEventListener('keyup', event => { if (event.code === 'Space' && !editable(event.target)) send({ type: 'canvas-navigation', action: 'pan-end' }); }, true);
  // Many standalone demos use browser storage. Keep it in this preview instance only.
  function memoryStorage() {
    const values = new Map();
    return { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: k => values.get(String(k)) ?? null, setItem: (k, v) => values.set(String(k), String(v)), removeItem: k => values.delete(String(k)), clear: () => values.clear() };
  }
  for (const name of ['localStorage', 'sessionStorage']) {
    try { window[name].getItem('__ux_probe__'); } catch { try { Object.defineProperty(window, name, { configurable: true, value: memoryStorage() }); } catch {} }
  }
  const text = element => (element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  function selector(element) {
    if (element.dataset.uxAnchor) return `[data-ux-anchor="${css(element.dataset.uxAnchor)}"]`;
    if (element.id && document.querySelectorAll('#' + css(element.id)).length === 1) return '#' + css(element.id);
    const parts = [];
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      if (node.dataset.uxAnchor) { parts.unshift(`[data-ux-anchor="${css(node.dataset.uxAnchor)}"]`); break; }
      if (node.id && document.querySelectorAll('#' + css(node.id)).length === 1) { parts.unshift('#' + css(node.id)); break; }
      const tag = node.tagName.toLowerCase();
      const siblings = node.parentElement ? [...node.parentElement.children].filter(n => n.tagName === node.tagName) : [node];
      parts.unshift(tag + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
    }
    return parts.length ? parts.join(' > ') : 'html';
  }
  function describe(element) {
    const anchor = { kind: 'element', id: element.dataset.uxAnchor || null, selector: selector(element), tag: element.tagName.toLowerCase(), text: text(element), viewport: { width: innerWidth, height: innerHeight } };
    const tabs = tabContexts(element, true);
    if (tabs.length) anchor.tabs = tabs;
    try {
      const navigation = window.__UX_REVIEW_NAVIGATION__;
      if (navigation && typeof navigation.capture === 'function') {
        const view = viewContext(navigation.capture(element));
        if (view) anchor.view = view;
      }
    } catch { send({ type: 'notice', message: '未能记录当前页面上下文；标注目标仍已保留。' }); }
    return anchor;
  }
  function unique(query) {
    try { const matches = document.querySelectorAll(query); return matches.length === 1 ? matches[0] : null; } catch { return null; }
  }
  function viewContext(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const encoded = JSON.stringify(value);
    if (!encoded || new TextEncoder().encode(encoded).byteLength > 32768) return null;
    const copy = JSON.parse(encoded);
    return copy && typeof copy === 'object' && !Array.isArray(copy) && typeof copy.key === 'string' && copy.key.trim() ? copy : null;
  }
  const controls = (tab, panel) => !!panel?.id && tab?.getAttribute('role') === 'tab' && (tab.getAttribute('aria-controls') || '').split(/\s+/).includes(panel.id);
  function tabContexts(element, selectedOnly = false) {
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    const tabs = [...document.querySelectorAll('[role="tab"][aria-controls]')];
    return ancestors.flatMap(panel => {
      const candidates = tabs.filter(tab => controls(tab, panel));
      const selected = candidates.filter(tab => tab.getAttribute('aria-selected') === 'true');
      const tab = selected.length === 1 ? selected[0] : !selectedOnly && candidates.length === 1 ? candidates[0] : null;
      return tab ? [{ selector: selector(tab), panelSelector: selector(panel) }] : [];
    });
  }
  function find(anchor, fallback = false) {
    if (!anchor || typeof anchor.selector !== 'string') return null;
    let element;
    try {
      const matches = document.querySelectorAll(anchor.id && !fallback ? `[data-ux-anchor="${css(anchor.id)}"]` : anchor.selector);
      if (matches.length !== 1) return null;
      element = matches[0];
    } catch { return null; }
    if (anchor.tag && element.tagName.toLowerCase() !== anchor.tag) return null;
    if ((!anchor.id || fallback) && anchor.text && !element.id && !text(element).includes(anchor.text)) return null;
    return element;
  }
  function rect(element, anchor) {
    const r = element.getBoundingClientRect();
    const modal = [...document.querySelectorAll('dialog:modal')].at(-1);
    if (modal && !modal.contains(element)) return null;
    if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || r.width <= 0 || r.height <= 0) return null;
    const region = anchor?.region;
    return region ? { x: r.x + region.x * r.width, y: r.y + region.y * r.height, width: region.width * r.width, height: region.height * r.height } : { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  function measure() {
    frame = 0;
    send({ type: 'snapshot', viewport: { width: innerWidth, height: innerHeight }, anchors: annotations.map(a => { const el = find(a.anchor); return { id: a.id, found: !!el, rect: el ? rect(el, a.anchor) : null }; }) });
  }
  function scheduleMeasure() { if (!frame) frame = requestAnimationFrame(measure); }
  let navigationRequest = null, clearHighlight = () => {};
  function abortable(work, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      if (signal.aborted) { reject(signal.reason); return; }
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  function layoutFrame(signal) {
    return new Promise((resolve, reject) => {
      let raf, timer;
      const finish = aborted => { cancelAnimationFrame(raf); clearTimeout(timer); signal.removeEventListener('abort', abort); aborted ? reject(signal.reason) : resolve(); };
      const abort = () => finish(true);
      if (signal.aborted) { reject(signal.reason); return; }
      signal.addEventListener('abort', abort, { once: true });
      raf = requestAnimationFrame(() => finish(false));
      timer = setTimeout(() => finish(false), 50); // Hidden host tabs may pause animation frames.
    });
  }
  function openDetails(element) {
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) if (node.tagName === 'DETAILS') ancestors.unshift(node);
    for (const details of ancestors) details.open = true;
  }
  async function restoreTabs(entries, signal) {
    if (!Array.isArray(entries) || entries.length > 16) return '标注的标签页上下文无效，请重新绑定目标。';
    for (const entry of entries) {
      if (signal.aborted) throw signal.reason;
      if (typeof entry?.selector !== 'string' || typeof entry?.panelSelector !== 'string') return '标注的标签页上下文无效，请重新绑定目标。';
      const tab = unique(entry.selector), panel = unique(entry.panelSelector);
      if (!controls(tab, panel)) return '未找到标注对应的标签页，请先打开对应页面或重新绑定目标。';
      openDetails(tab);
      if (tab.getAttribute('aria-selected') !== 'true') {
        // Only an explicitly associated tab can be activated. Never synthesize
        // form submission, external navigation, arbitrary buttons or dialogs.
        if (!rect(tab) || tab.matches(':disabled,[aria-disabled="true"],input,select,textarea,label,summary') || tab.closest('[inert]') || (tab instanceof HTMLButtonElement && tab.form && tab.type !== 'button') || (tab.matches('a[href]') && !tab.getAttribute('href').startsWith('#'))) return '无法安全切换标签页，请先打开对应页面或弹窗。';
        tab.click();
        while (true) {
          await layoutFrame(signal);
          const current = unique(entry.selector);
          if (!current || !controls(current, unique(entry.panelSelector))) return '标签页结构已变化，请重新绑定目标。';
          if (current.getAttribute('aria-selected') === 'true') break;
        }
      }
      await layoutFrame(signal);
    }
    return null;
  }
  async function settledTarget(anchor, signal, retry) {
    let previous = null, samples = 0;
    while (true) {
      await layoutFrame(signal);
      const element = find(anchor), bounds = element && rect(element, anchor);
      const signature = bounds && JSON.stringify(bounds);
      if (signature && signature === previous) return { element, bounds };
      if (!retry && ++samples >= 3 && !bounds) return { element, bounds: null };
      previous = signature;
    }
  }
  function hiddenReason(element) {
    if (!element) return '暂时找不到标注目标，请先打开对应页面或弹窗，或重新绑定目标。';
    const modal = [...document.querySelectorAll('dialog:modal')].at(-1);
    if (modal && !modal.contains(element)) return '当前弹窗遮住了目标；请先处理弹窗中的内容，再定位标注。';
    return '目标尚未显示；请先打开对应页面或弹窗，或为原型提供页面恢复接口。';
  }
  async function locate(id) {
    navigationRequest?.abort('superseded');
    clearHighlight();
    const request = new AbortController(), { signal } = request;
    navigationRequest = request;
    const timeout = setTimeout(() => request.abort('timeout'), 2500);
    const annotation = annotations.find(a => a.id === id), anchor = annotation?.anchor;
    const report = (visible, reason = '') => {
      if (navigationRequest !== request) return;
      const element = anchor && find(anchor);
      cancelAnimationFrame(frame); measure();
      send({ type: 'located', id, found: !!element, visible, reason });
    };
    try {
      if (!anchor) { report(false, hiddenReason(null)); return; }
      let navigated = false;
      if (anchor.view !== undefined) {
        const view = viewContext(anchor.view), navigation = window.__UX_REVIEW_NAVIGATION__;
        if (!view) { report(false, '标注的页面上下文无效，请重新绑定目标。'); return; }
        if (!navigation || typeof navigation.reveal !== 'function') { report(false, '原型未提供页面恢复接口，请先打开对应页面或弹窗。'); return; }
        const revealed = await abortable(Promise.resolve().then(() => {
          if (signal.aborted) throw signal.reason;
          return navigation.reveal(view, anchor, { signal });
        }), signal);
        if (revealed === false) { report(false, '原型暂时无法切换到目标页面，请先处理当前内容后重试。'); return; }
        navigated = true;
      }
      let element = find(anchor);
      if (element) openDetails(element);
      // Restore captured tabs even when a shared panel is already visible.
      const tabs = anchor.tabs ?? (element ? tabContexts(element) : []);
      const reason = await restoreTabs(tabs, signal);
      if (reason) { report(false, reason); return; }
      element = find(anchor);
      if (element) openDetails(element);
      let target = await settledTarget(anchor, signal, navigated || tabs.length > 0);
      if (!target.bounds) { report(false, hiddenReason(target.element)); return; }
      target.element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      target = await settledTarget(anchor, signal, false);
      if (!target.bounds) { report(false, hiddenReason(target.element)); return; }
      const highlighted = target.element, previous = highlighted.style.outline, offset = highlighted.style.outlineOffset;
      highlighted.style.outline = '2px solid #1890ff'; highlighted.style.outlineOffset = '4px';
      const timer = setTimeout(() => clearHighlight(), 1600);
      clearHighlight = () => { clearTimeout(timer); highlighted.style.outline = previous; highlighted.style.outlineOffset = offset; clearHighlight = () => {}; scheduleMeasure(); };
      report(true);
    } catch (error) {
      if (navigationRequest !== request || signal.reason === 'superseded') return;
      report(false, signal.reason === 'timeout' ? '页面恢复超时，请先打开对应页面或弹窗后重试。' : '原型未能恢复目标页面，请先打开对应页面或弹窗后重试。');
    } finally {
      clearTimeout(timeout);
      if (navigationRequest === request) navigationRequest = null;
    }
  }
  function meaningful(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('button,input,textarea,select,a,[role="button"],[data-ux-anchor]') || target.closest('label,img,[data-prd],[id],section,article,main,td,li,p,h1,h2,h3,div') || target;
  }
  document.addEventListener('pointermove', event => {
    if (mode === 'interact') return;
    if (dragging) {
      const r = dragging.element.getBoundingClientRect();
      const x = Math.max(r.left, Math.min(event.clientX, r.right)), y = Math.max(r.top, Math.min(event.clientY, r.bottom));
      send({ type: 'hover', rect: { x: Math.min(x, dragging.x), y: Math.min(y, dragging.y), width: Math.abs(x - dragging.x), height: Math.abs(y - dragging.y) } });
    } else { const el = meaningful(event.target); if (el) send({ type: 'hover', rect: rect(el) }); }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (mode !== 'region' || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    let element = meaningful(event.target);
    while (element?.parentElement && (element.getBoundingClientRect().width < 80 || element.getBoundingClientRect().height < 80)) element = element.parentElement;
    if (element) { dragging = { element, x: event.clientX, y: event.clientY }; try { element.setPointerCapture(event.pointerId); } catch {} }
  }, true);
  document.addEventListener('pointerup', event => {
    if (!dragging) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const { element, x, y } = dragging, r = element.getBoundingClientRect(); dragging = null;
    const endX = Math.max(r.left, Math.min(event.clientX, r.right)), endY = Math.max(r.top, Math.min(event.clientY, r.bottom));
    const region = { x: (Math.min(x, endX) - r.left) / r.width, y: (Math.min(y, endY) - r.top) / r.height, width: Math.abs(endX - x) / r.width, height: Math.abs(endY - y) / r.height };
    if (region.width * r.width >= 4 && region.height * r.height >= 4) send({ type: 'picked', anchor: { ...describe(element), kind: 'region', region } });
    mode = 'interact';
  }, true);
  document.addEventListener('pointercancel', () => { dragging = null; send({ type: 'cancel-pick' }); });
  document.addEventListener('click', event => {
    if (event.isTrusted) navigationRequest?.abort('superseded');
    if (mode !== 'interact') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (mode === 'element') { const el = meaningful(event.target); if (el) send({ type: 'picked', anchor: describe(el) }); mode = 'interact'; }
      return;
    }
    // Programmatic tab activation belongs to locating, not a business click:
    // the host must retain its selected marker. Real clicks interrupt locating.
    if (!navigationRequest || event.isTrusted) send({ type: 'interaction' });
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (link && !link.getAttribute('href').startsWith('#')) { event.preventDefault(); send({ type: 'notice', message: '演示原型中的外部链接未打开。' }); }
  }, true);
  document.addEventListener('contextmenu', event => {
    const element = meaningful(event.target); if (!element) return;
    const annotationIds = annotations.filter(annotation => {
      if (!referencedIds.has(annotation.id)) return false;
      const target = find(annotation.anchor);
      if (!target || !target.contains(event.target)) return false;
      const box = rect(target, annotation.anchor);
      return box && event.clientX >= box.x && event.clientX <= box.x + box.width && event.clientY >= box.y && event.clientY <= box.y + box.height;
    }).map(annotation => annotation.id);
    if (!showAnnotations && !annotationIds.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    send({ type: 'contextmenu', anchor: describe(element), annotationIds, x: event.clientX, y: event.clientY, rect: rect(element) });
  }, true);
  document.addEventListener('submit', event => {
    // Native method=dialog closes an in-page dialog and performs no network IO.
    const method = event.submitter?.getAttribute('formmethod') || event.target.getAttribute('method') || 'get';
    if (method.toLowerCase() !== 'dialog') event.preventDefault();
  }, true);
  addEventListener('keydown', event => { if (event.key === 'Escape' && mode !== 'interact') { dragging = null; mode = 'interact'; send({ type: 'cancel-pick' }); } });
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.token !== token || event.data?.channel !== 'craft-ux-host') return;
    const data = event.data;
    if (data.type === 'mode' && ['interact', 'element', 'region'].includes(data.mode)) { mode = data.mode; dragging = null; }
    if (data.type === 'annotation-visibility') showAnnotations = data.value !== 'off';
    if (data.type === 'annotations' && Array.isArray(data.annotations)) {
      annotations = data.annotations.filter(a => a && typeof a.id === 'string' && a.anchor).slice(0, 5000);
      referencedIds = new Set(Array.isArray(data.referencedIds) ? data.referencedIds : []);
      if (typeof data.showAnnotations === 'boolean') showAnnotations = data.showAnnotations;
      scheduleMeasure();
    }
    if (data.type === 'stamp' && data.anchor?.id) {
      const element = find(data.anchor, true);
      if (element) element.setAttribute('data-ux-anchor', data.anchor.id);
      scheduleMeasure();
    }
    if (data.type === 'locate') void locate(data.id);
  });
  document.addEventListener('scroll', scheduleMeasure, true);
  addEventListener('resize', scheduleMeasure);
  const start = () => {
    reportEditing();
    new MutationObserver(scheduleMeasure).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    new ResizeObserver(scheduleMeasure).observe(document.documentElement);
    send({ type: 'ready', title: document.title }); scheduleMeasure();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  setInterval(scheduleMeasure, 750); // Covers CSS animation and changes inside scroll containers.
}

export function previewHtml(source, token) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">`;
  const code = `(${bridge.toString()})(${JSON.stringify(token)});`.replace(/<\/script/gi, '<\\/script');
  const injected = policy + '<script>' + code + '</script>';
  let clean = source.replace(/<meta\b(?=[^>]*http-equiv\s*=\s*["']?Content-Security-Policy)[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '');
  if (/<head\b[^>]*>/i.test(clean)) return clean.replace(/<head\b[^>]*>/i, match => match + injected);
  if (/<html\b[^>]*>/i.test(clean)) return clean.replace(/<html\b[^>]*>/i, match => match + '<head>' + injected + '</head>');
  return '<!doctype html><html><head>' + injected + '</head><body>' + clean + '</body></html>';
}

export function stampAnchor(source, anchor) {
  const dom = new DOMParser().parseFromString(source, 'text/html');
  let element;
  try { const matches = dom.querySelectorAll(anchor.selector); if (matches.length === 1) element = matches[0]; } catch { return { source, anchor }; }
  if (!element || (anchor.tag && element.tagName.toLowerCase() !== anchor.tag) || (!element.id && anchor.text && !(element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.textContent || '').trim().replace(/\s+/g, ' ').includes(anchor.text))) return { source, anchor };
  const original = element.getAttribute('data-ux-anchor');
  const key = original || 'ux-' + (crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join(''));
  element.setAttribute('data-ux-anchor', key);
  // Keep the original selector for stamping the live iframe without reloading its state.
  return { source: '<!doctype html>\n' + dom.documentElement.outerHTML, anchor: { ...anchor, id: key } };
}
