// Start the clipboard operation in the click handler, before saving/preparing
// finishes. Safari otherwise loses transient activation across those awaits.
export function copyTextWhenReady(value) {
  const text = Promise.resolve(value).then(value => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('没有可复制的修改说明。');
    return value;
  });
  // The preparation can still fail after a clipboard denial. Observe both
  // promises so that neither rejection becomes an unhandled browser error.
  text.catch(() => {});
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem === 'function') {
      const blob = text.then(value => new Blob([value], { type: 'text/plain' }));
      blob.catch(() => {});
      return Promise.resolve(navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]));
    }
    return text.then(value => {
      if (!navigator.clipboard?.writeText) throw new Error('当前环境无法自动复制。');
      return navigator.clipboard.writeText(value);
    });
  } catch (error) { return Promise.reject(error); }
}
