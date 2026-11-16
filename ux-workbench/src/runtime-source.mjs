// Serialized into the preview before business scripts. Captured locations are
// kept in a WeakMap; no attributes, source edits, or stack strings are persisted.
export function trackRuntimeSources(scripts, insertion) {
  const origins = new WeakMap(), NativeError = Error, captureStack = Error.captureStackTrace;
  const scriptText = document.currentScript?.textContent || '', injectedLines = scriptText.split('\n');
  const extraLines = injectedLines.length - 1, endLine = insertion.line + extraLines;
  const endColumn = extraLines ? injectedLines.at(-1).length + insertion.suffixLength + 1 : insertion.column + insertion.prefixLength + scriptText.length + insertion.suffixLength;
  function capture(wrapper) {
    if (typeof captureStack !== 'function') return null;
    try {
      const error = new NativeError(); captureStack(error, wrapper);
      if (typeof error.stack !== 'string') return null;
      const locations = [];
      for (const frame of error.stack.split('\n').slice(1)) {
        if (frame.includes('eval at ')) continue;
        const match = frame.match(/(?:\(|\s)about:srcdoc:(\d+):(\d+)\)?$/);
        if (!match) continue;
        let line = Number(match[1]), column = Number(match[2]);
        if (line < endLine || (line === endLine && column < endColumn)) continue;
        if (line === endLine) column = column - endColumn + insertion.column;
        line -= extraLines;
        const script = scripts.find(item => (line > item.start.line || line === item.start.line && column >= item.start.column) && (line < item.end.line || line === item.end.line && column <= item.end.column));
        if (!script) continue;
        locations.push({ index: script.index, fingerprint: script.fingerprint, line: line - script.start.line + 1, column: line === script.start.line ? column - script.start.column + 1 : column });
        if (locations.length === 3) break;
      }
      return locations.length ? { kind: 'runtime', locations } : null;
    } catch { return null; }
  }
  function markTree(node, origin) {
    if (!origin) return;
    if (node instanceof Element) origins.set(node, origin);
    for (const child of node.children || []) markTree(child, origin);
  }
  function method(prototype, key, handler) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (!descriptor?.value || !descriptor.configurable) return;
    const native = descriptor.value;
    const wrapped = function (...args) {
      const origin = capture(wrapped);
      return handler.call(this, native, args, origin);
    };
    Object.defineProperty(prototype, key, { ...descriptor, value: wrapped });
  }
  for (const key of ['createElement', 'createElementNS']) method(Document.prototype, key, function (native, args, origin) {
    const element = Reflect.apply(native, this, args);
    if (this === document && origin) origins.set(element, origin);
    return element;
  });
  method(Node.prototype, 'cloneNode', function (native, args, origin) {
    const node = Reflect.apply(native, this, args); markTree(node, origin); return node;
  });
  method(Element.prototype, 'insertAdjacentHTML', function (native, args, origin) {
    const parent = /^(beforebegin|afterend)$/i.test(args[0]) ? this.parentElement : this;
    const before = new Set(parent?.children || []), result = Reflect.apply(native, this, args);
    for (const node of parent?.children || []) if (!before.has(node)) markTree(node, origin);
    return result;
  });
  for (const [prototype, key] of [[Element.prototype, 'innerHTML'], [Node.prototype, 'textContent'], [HTMLElement.prototype, 'innerText']]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (!descriptor?.set || !descriptor.configurable) continue;
    const wrapped = function (value) {
      const origin = key === 'innerHTML' || origins.has(this) ? capture(wrapped) : null;
      const result = Reflect.apply(descriptor.set, this, [value]);
      if (key === 'innerHTML') { for (const child of this.children || []) markTree(child, origin); }
      else if (origin && this instanceof Element) origins.set(this, origin);
      return result;
    };
    Object.defineProperty(prototype, key, { ...descriptor, set: wrapped });
  }
  return origins;
}
