// DSH's public session-file address format. No filesystem operations occur here.
export function fileAddress(sessionId, path) {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${normalized.split('/').map(s => encodeURIComponent(s).replace(/%3A/gi, ':')).join('/')}`;
}
export function parseAddress(address) {
  try {
    const url = new URL(address);
    if (url.protocol !== 'dsh-resource:' || url.hostname !== 'file') return null;
    const parts = url.pathname.split('/');
    if (parts[1] !== 'session' || !parts[2]) return null;
    return { sessionId: decodeURIComponent(parts[2]), path: parts.slice(3).map(decodeURIComponent).join('/') };
  } catch { return null; }
}
