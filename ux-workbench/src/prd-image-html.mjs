import { prdAssetId, prdImageSource } from '../../skills/ux-prototype/scripts/prd-assets.mjs';

// Resolve before sanitization: custom asset: URLs must never reach a live img.
// Template contents stay inert until the caller sanitizes and renders them.
export function resolvePrdImageHtml(html, assets) {
  if (!html.includes('asset:img-')) return html;
  const template = document.createElement('template'); template.innerHTML = html;
  for (const img of template.content.querySelectorAll('img[src]')) {
    if (!prdAssetId(img.getAttribute('src'))) continue;
    const source = prdImageSource(assets, img.getAttribute('src'));
    if (source) img.setAttribute('src', source);
    else {
      const placeholder = document.createElement('span');
      placeholder.className = 'uxw-prd-image-placeholder'; placeholder.textContent = `图片资源缺失：${img.alt || '图片'}`;
      img.replaceWith(placeholder);
    }
  }
  return template.innerHTML;
}
