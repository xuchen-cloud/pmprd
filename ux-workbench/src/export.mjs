import { parse, sourceOnly, metadataBlock, serializeJSON } from '../../skills/ux-prototype/scripts/document.mjs';
import { runtimeJs, runtimeCss } from './generated/review-runtime.mjs';
const escape = text => String(text).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));

export async function exportReviewHtml(html) {
  if (!runtimeJs) throw new Error('请先运行 npm run build:review 生成离线阅读器。');
  const doc = parse(html);
  const source = sourceOnly(html);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'">
<title>${escape(doc.title)} · 需求评审</title>
<style>${runtimeCss.replace(/<\/style/gi, '<\\/style')}</style></head><body>
<div id="root"></div>
${metadataBlock(doc)}
<script type="application/json" id="ux-prototype-source">${serializeJSON(source)}</script>
<script>${runtimeJs.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>\n`;
}

export function downloadHtml(html, name = 'review.html') {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
