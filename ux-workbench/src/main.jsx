import React from 'react';
import { createRoot } from 'react-dom/client';
import Workbench from './Workbench.jsx';
import PrdEditor from './PrdEditor.jsx';
import './prd-editor.css';

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function browserHost() {
  let current = null, revision = 0;
  return {
    async read(path) {
      if (current && !path) return current;
      const requested = path || new URLSearchParams(location.search).get('file');
      if (!requested) return null;
      const response = await fetch(requested);
      if (!response.ok) throw Error('无法读取原型文件：' + response.status);
      current = { path: requested, name: requested.split('/').pop(), html: await response.text(), version: String(++revision) };
      return current;
    },
    async pick() {
      return new Promise(resolve => {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.html,text/html';
        input.addEventListener('change', async () => { const file = input.files[0]; if (!file) return resolve(null); current = { path: file.name, name: file.name, html: await file.text(), version: String(++revision) }; resolve(current); }, { once: true });
        input.addEventListener('cancel', () => resolve(null), { once: true }); input.click();
      });
    },
    async save({ path, html, expectedVersion }) {
      if (current && expectedVersion !== current.version) throw Error('文件已变化，请重新打开。');
      const name = (path || 'prototype.ux.html').split(/[\\/]/).pop();
      download(html, name); current = { path, name, html, version: String(++revision) }; return current;
    },
    async exportReview({ html, name }) {
      const { exportReviewHtml } = await import('./export.mjs');
      download(await exportReviewHtml(html), (name || 'prototype').replace(/[\\/:*?"<>|]/g, '-') + '-review.html');
    },
  };
}
const root = document.getElementById('root');
root.style.height = '100vh';
document.body.style.margin = '0';
createRoot(root).render(<Workbench editorComponent={PrdEditor} host={window.__UX_REVIEW_HOST__ || browserHost()} />);
