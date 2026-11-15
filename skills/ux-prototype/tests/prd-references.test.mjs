import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnnotationReferences, tokenizePrdReferences } from '../scripts/prd-references.mjs';
import { markdownLexer } from '../scripts/vendor/markdown-lexer.mjs';

test('standalone references accept underscores, preserve duplicate order and retain CRLF source offsets', () => {
  const source = '# 需求\r\n\r\n业务规则。\r\n@annotation(ann-product_rule)\r\n   @annotation(ann-second)  \r\n\r\n@annotation(ann-product_rule)\r\n';
  const references = getAnnotationReferences(source, markdownLexer);
  assert.deepEqual(references.map(reference => [reference.annotationId, reference.occurrence, reference.index]), [
    ['ann-product_rule', 1, 1], ['ann-second', 1, 2], ['ann-product_rule', 2, 3],
  ]);
  assert.deepEqual(references.map(reference => reference.line), [4, 5, 7]);
  for (const reference of references) assert.equal(source.slice(reference.start, reference.end).trim(), `@annotation(${reference.annotationId})`);
});

test('only top-level standalone paragraph lines become references', () => {
  const source = [
    '```md\n@annotation(ann-code)\n```',
    '~~~\n@annotation(ann-tilde)\n~~~',
    '    @annotation(ann-indented)',
    '> @annotation(ann-quote)',
    '- @annotation(ann-list)',
    '<div>\n@annotation(ann-html)\n</div>',
    '<!--\n@annotation(ann-comment)\n-->',
    '正文 @annotation(ann-inline)',
    '@annotation(ann-trailing) 后续文字',
    '@annotation(ann-)',
    '@annotation(ann-invalid.id)',
    '@annotation(ann-real)',
  ].join('\n\n');
  assert.deepEqual(getAnnotationReferences(source, markdownLexer).map(reference => reference.annotationId), ['ann-real']);
  const tokens = tokenizePrdReferences(source, markdownLexer);
  assert.equal(tokens.filter(token => token.type === 'annotationReference').length, 1);
  assert.ok(tokens.some(token => token.type === 'code'));
  assert.ok(tokens.some(token => token.type === 'list'));
  assert.ok(tokens.some(token => token.type === 'blockquote'));
  assert.ok(tokens.some(token => token.type === 'html'));
});
