import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewFileName } from '../src/filename.mjs';
import { fileAddress, parseAddress } from '../src/address.mjs';

test('review exports always use a safe HTML extension on Windows', () => {
  assert.equal(reviewFileName('商品草稿'), '商品草稿.review.html');
  assert.equal(reviewFileName('product.ux.html'), 'product.review.html');
  assert.equal(reviewFileName('product.review.html'), 'product.review.html');
  assert.equal(reviewFileName('需求: A/B?*'), '需求- A-B--.review.html');
  assert.equal(reviewFileName('CON'), '_CON.review.html');
  assert.equal(reviewFileName('..  '), 'prototype.review.html');
});

test('session file addresses round-trip absolute Mac and Windows paths', () => {
  for (const path of ['/Users/example/商品 #1.ux.html', 'C:/Users/example/商品 #1.ux.html']) assert.deepEqual(parseAddress(fileAddress('session #1', path)), { sessionId: 'session #1', path });
  assert.equal(parseAddress('https://example.test/file.ux.html'), null);
});
