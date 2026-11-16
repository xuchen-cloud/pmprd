// Images live once in the document resource store; PRD and history use short URLs.
export const isPrdImageData = value => typeof value === 'string' && /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp);base64,[a-z0-9+/]+=*$/i.test(value);
export const prdAssetId = source => typeof source === 'string' ? /^asset:(img-[a-z0-9_-]+)$/i.exec(source)?.[1] : undefined;
export function prdImageSource(assets, source) {
  const data = assets?.[prdAssetId(source)]?.dataUrl;
  return isPrdImageData(data) ? data : null;
}
export function storePrdImage(assets, dataUrl, name = '图片') {
  if (!isPrdImageData(dataUrl)) throw new Error('图片资源格式无效。');
  const existing = Object.keys(assets).find(key => assets[key].dataUrl === dataUrl);
  if (existing) return { source: `asset:${existing}`, assets };
  const key = `img-${Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  return { source: `asset:${key}`, assets: { ...assets, [key]: { name, dataUrl } } };
}

export function validatePrdAssets(assets) {
  if (assets === undefined) return;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) throw new Error('图片资源区格式无效。');
  for (const [key, asset] of Object.entries(assets)) {
    if (!/^img-[a-z0-9_-]+$/i.test(key) || !asset || typeof asset.name !== 'string' || !isPrdImageData(asset.dataUrl)) throw new Error('图片资源格式无效。');
  }
}
