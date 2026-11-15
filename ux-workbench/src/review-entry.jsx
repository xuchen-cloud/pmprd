import React from 'react';
import { createRoot } from 'react-dom/client';
import Workbench from './Workbench.jsx';
import './prd-editor.css';

const capturedHtml = '<!doctype html>\n' + document.documentElement.outerHTML;
const host = { read: async () => ({ path: 'review.html', name: '完整评审 HTML', html: capturedHtml, version: 'readonly' }) };
let root = document.getElementById('ux-review-root');
if (!root) { root = document.createElement('div'); root.id = 'ux-review-root'; document.body.append(root); }
root.style.height = '100vh';
document.body.style.margin = '0';
createRoot(root).render(<Workbench host={host} readOnly />);
