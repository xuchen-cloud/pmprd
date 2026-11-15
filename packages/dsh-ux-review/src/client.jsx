import React, { useMemo } from 'react';
import { FolderOpen } from 'lucide-react';
import Workbench from '../../../ux-workbench/src/Workbench.jsx';
import styles from '../../../ux-workbench/src/styles.css';
import PrdEditor from '../../../ux-workbench/src/PrdEditor.jsx';
import prdStyles from '../../../ux-workbench/src/prd-editor.css';
import tooltipStyles from '../../../ux-workbench/src/tooltip.css';
import { exportReviewHtml } from '../../../ux-workbench/src/export.mjs';
import { fileAddress, parseAddress } from './address.mjs';
import { reviewFileName } from './filename.mjs';
import DocumentOpen from './DocumentOpen.jsx';
import openStyles from './document-open.css';

export const inject = ['slots', 'sidebarRightTabs', 'connection'];
const ID = 'dsh-ux-review';
const OPEN_ID = ID + '/open';
const OPEN_KIND = 'ux-review-open';
const basename = address => { try { return decodeURIComponent(address.slice(address.lastIndexOf('/') + 1)); } catch { return address; } };

function ReviewTab({ useTabInfo, sessionId, rpc }) {
  const { tab } = useTabInfo();
  const address = parseAddress(tab.contentId);
  const host = useMemo(() => {
    const session = address?.sessionId || sessionId;
    const invoke = async (operation, args) => {
      const result = await rpc.call('/api', 'ux-review/' + operation, { ...args, sessionId: session });
      if (!result.ok) throw new Error(result.error?.message || '评审操作失败。');
      return result.value;
    };
    return {
      read: path => invoke('read', { path: path || address?.path }),
      save: args => invoke('save', args),
      submit: args => invoke('submit', args),
      task: id => invoke('task', { id }),
      cancel: id => invoke('cancel', { id }),
      openDocument: () => tab.actions.openTab(OPEN_KIND),
      openResult: path => tab.actions.openResource(fileAddress(session, path)),
      async exportReview({ html, name }) {
        const output = await exportReviewHtml(html), url = URL.createObjectURL(new Blob([output], { type: 'text/html;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = reviewFileName(name);
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    };
  }, [address?.sessionId, address?.path, sessionId, rpc, tab.actions]);
  return <div className="dsh-ux-review" style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}><style>{styles + tooltipStyles + prdStyles}</style><Workbench editorComponent={PrdEditor} host={host} /></div>;
}

export function OpenDocumentTab({ useTabInfo, sessionId, rpc }) {
  const { tab } = useTabInfo();
  const importFile = async args => {
    const result = await rpc.call('/api', 'ux-review/importFile', { ...args, sessionId });
    if (!result.ok) throw new Error(result.error?.message || '无法打开设计文档。');
    return result.value;
  };
  return <><style>{openStyles}</style><DocumentOpen importFile={importFile} openDocument={path => tab.actions.openResource(fileAddress(sessionId, path))} /></>;
}

export function apply(ctx) {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: OPEN_ID, kind: OPEN_KIND, keepMounted: true,
    title: () => '打开设计文档',
    guide: [{ id: 'open', order: 15, title: () => '打开设计文档', description: () => '打开本地或收到的交互稿、PRD 与标注', icon: FolderOpen }],
  }), 'ux-review: open document entry');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: OPEN_ID,
    inject: sessionId => ({ sessionId, rpc: ctx.connection.rpc }),
  }, OpenDocumentTab)), 'ux-review: open document renderer');
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID, kind: 'ux-review', keepMounted: true,
    patterns: ['*.ux.html'], priority: 'extension',
    canOpen: address => !!parseAddress(address), title: basename,
  }), 'ux-review: tab type');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: ID,
    inject: sessionId => ({ sessionId, rpc: ctx.connection.rpc }),
  }, ReviewTab)), 'ux-review: tab renderer');
}
