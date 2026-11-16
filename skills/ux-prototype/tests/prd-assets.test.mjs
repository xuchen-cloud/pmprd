import test from 'node:test';
import assert from 'node:assert/strict';
import {storePrdImage, prdImageSource} from '../scripts/prd-assets.mjs';
import {create, recordHuman, write, parse, validate, clone} from '../scripts/document.mjs';

const dataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=';
test('image bytes are stored once outside Markdown and history, deduplicated and retained after deletion', () => {
  const initial=create({prd:'# 需求'}), stored=storePrdImage({},dataUrl,'配图');
  const repeated=storePrdImage(stored.assets,dataUrl,'同一张图片');
  assert.equal(repeated.source,stored.source);assert.equal(Object.keys(repeated.assets).length,1);
  const doc=recordHuman(initial,{...initial,prd:`# 需求\n\n![配图](${stored.source})`,assets:stored.assets});
  assert.equal(prdImageSource(doc.assets,stored.source),dataUrl);
  assert.ok(!JSON.stringify(doc.changes).includes('base64'));
  const html=write('<html><body>原型</body></html>',doc);
  assert.equal(html.split(dataUrl).length-1,1);assert.deepEqual(parse(html),doc);
  const deleted=recordHuman(doc,{...doc,prd:'# 需求'});
  assert.equal(prdImageSource(deleted.assets,stored.source),dataUrl);
  assert.equal(prdImageSource({},stored.source),null);
  const overwritten=clone(doc);Object.values(overwritten.assets)[0].dataUrl='data:image/png;base64,YQ==';
  assert.throws(()=>recordHuman(doc,overwritten),/不能覆盖/);
  const invalid=clone(doc);Object.values(invalid.assets)[0].dataUrl='https://example.com/image.png';
  assert.throws(()=>validate(invalid),/图片资源/);
});
