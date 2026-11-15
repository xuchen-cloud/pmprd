/* Optional tiny helpers. No network requests or persistence. */
window.UX = (() => {
  const dialogOrigins = new WeakMap();
  const dialogStack = [];
  let savedOverflow, scrollLocked = false;
  let toastTimer;
  const q = (s, root = document) => root.querySelector(s);
  const topModal = () => [...dialogStack].reverse().find(dialog => dialog.open && dialog.matches(':modal')) || [...document.querySelectorAll('dialog:modal')].at(-1);
  function register(dialog) {
    const index = dialogStack.indexOf(dialog);
    if (index >= 0) dialogStack.splice(index, 1);
    dialogStack.push(dialog);
  }
  function toast(message) {
    let el = document.getElementById('ux-toast');
    if (!el) { el = document.createElement('div'); el.id = 'ux-toast'; el.className = 'ux-toast'; el.setAttribute('role', 'status'); document.body.append(el); }
    // Native modal dialogs live in the top layer, so place feedback inside the active dialog.
    const modal = topModal();
    (modal || document.body).append(el);
    el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
  }
  function open(dialog, focusSelector) {
    if (dialog.open) return;
    dialogOrigins.set(dialog, document.activeElement);
    dialog.showModal(); register(dialog);
    if (!scrollLocked) { savedOverflow = document.documentElement.style.overflow; scrollLocked = true; }
    document.documentElement.style.overflow = 'hidden';
    if (focusSelector) q(focusSelector, dialog)?.focus();
  }
  function close(dialog) { dialog.close(); }
  // Native showModal order, rather than document order, determines the top layer.
  document.addEventListener('beforetoggle', event => {
    if (event.target instanceof HTMLDialogElement && event.newState === 'open') register(event.target);
  }, true);
  document.addEventListener('close', event => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement)) return;
    const index = dialogStack.indexOf(dialog);
    if (index >= 0) dialogStack.splice(index, 1);
    const modal = topModal();
    if (!modal && scrollLocked) { document.documentElement.style.overflow = savedOverflow; scrollLocked = false; }
    const origin = dialogOrigins.get(dialog);
    if (origin?.isConnected && (!modal || modal.contains(origin))) origin.focus();
  }, true);
  document.addEventListener('click', event => {
    const btn = event.target.closest('[data-close]');
    if (btn) btn.closest('dialog')?.close();
  });
  // Keep keyboard navigation explicitly within the topmost modal.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const modal = topModal();
    if (!modal) return;
    const items = [...modal.querySelectorAll('button, input:not([type=hidden]), select, textarea, a[href], summary, [contenteditable=true], [tabindex]')].filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').sort((a,b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); modal.focus(); return; }
    if (!modal.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function job() {
    let timer, revision = 0;
    return {
      cancel() { revision++; clearTimeout(timer); },
      run(callback, delay = 1600) { this.cancel(); const id = revision; timer = setTimeout(() => { if (revision === id) callback(); }, delay); }
    };
  }
  return {q, toast, open, close, escapeHTML, job};
})();
