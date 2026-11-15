import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDocumentInput, MAX_DOCUMENT_BYTES } from '../src/document-input.mjs';
import { importedFileName } from '../src/filename.mjs';
import { create, write, metadataBlock, serializeJSON } from '../../../skills/ux-prototype/scripts/document.mjs';

const prototype = '<!DOCTYPE html><html><head><title>中文 &amp; 空格</title></head><body><button>确认</button></body></html>';

test('classifies by metadata content and validates offline design exports without converting', () => {
  assert.deepEqual(inspectDocumentInput(prototype), { kind: 'prototype', title: '中文 & 空格' });
  const doc = create({ title: '设计文档' });
  assert.deepEqual(inspectDocumentInput(write(prototype, doc)), { kind: 'design', title: '设计文档' });
  const offline = `<html><body><script id="ux-prototype-source" type="application/json">${serializeJSON(prototype)}</script>${metadataBlock(doc)}</body></html>`;
  assert.deepEqual(inspectDocumentInput(offline), { kind: 'design', title: '设计文档' });
  assert.throws(() => inspectDocumentInput(offline.replace(serializeJSON(prototype), '{broken')), /业务源码不是有效 JSON/);
  assert.throws(() => inspectDocumentInput(offline.replace(metadataBlock(doc), '')), /缺少完整/);
});

test('recognizes both supported legacy formats without treating script examples as metadata', () => {
  const legacy = prototype.replace('</body>', '<script id="ux-requirements" type="application/json">{"title":"旧版"}</script></body>');
  assert.equal(inspectDocumentInput(legacy).kind, 'legacy');
  const offline = prototype.replace('</body>', `<script>window.__PRD_OFFLINE__=${JSON.stringify({ prototype })};</script></body>`);
  assert.equal(inspectDocumentInput(offline).kind, 'legacy');
  const example = prototype.replace('</body>', '<script>const example = \'<script id="ux-requirements">\';</script><!-- <script id="ux-requirements"></script> --></body>');
  assert.equal(inspectDocumentInput(example).kind, 'prototype');
});

test('damaged or unsupported design metadata never falls back to prototype', () => {
  const canonical = write(prototype, create());
  for (const html of [
    canonical.replace('<!-- ux-document:start -->', ''),
    canonical.replace('"schemaVersion": 1', '"schemaVersion": 900'),
    canonical.replace('"format":', 'BROKEN:'),
    canonical.replace('</body>', metadataBlock(create()) + '</body>'),
  ]) assert.throws(() => inspectDocumentInput(html));
});

test('rejects empty, clearly non-HTML, fake tags in scripts, and oversized UTF-8 content', () => {
  for (const html of ['', '   ', null, '{}', '# Heading', '<html><body>\0</body></html>', '<script>const example = "<html><body></body></html>";</script>']) assert.throws(() => inspectDocumentInput(html));
  assert.throws(() => inspectDocumentInput('a'.repeat(MAX_DOCUMENT_BYTES + 1)), /50 MB/);
  assert.throws(() => inspectDocumentInput('中'.repeat(Math.ceil(MAX_DOCUMENT_BYTES / 3))), /50 MB/);
});

test('import filenames discard paths, preserve Chinese/spaces, and fit Windows and byte limits', () => {
  assert.equal(importedFileName('/outside/中文 空格.review.html'), '中文 空格.ux.html');
  assert.equal(importedFileName('C:\\fakepath\\CON.HTML'), '_CON.ux.html');
  assert.equal(importedFileName('LPT¹.htm'), '_LPT¹.ux.html');
  assert.equal(importedFileName('../.html'), 'prototype.ux.html');
  assert.equal(importedFileName('a: ?*.html', 1), 'a- -- (2).ux.html');
  assert.equal(importedFileName('prototype.ux.html', 2), 'prototype (3).ux.html');
  assert.ok(new TextEncoder().encode(importedFileName('中'.repeat(300) + '.html', 999)).byteLength < 255);
  for (const name of ['image.png', 'design.html.js', '', 'foo.html/']) assert.throws(() => importedFileName(name), /HTML/);
});
