import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { previewHtml } from '../src/preview.mjs';
import { targetSources } from '../../skills/ux-prototype/scripts/target-source.mjs';
import { editPrompt } from '../../skills/ux-prototype/scripts/edit-prompt.mjs';

let browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

async function pick(t, source) {
  const page = await browser.newPage();
  t.after(() => page.close());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<iframe sandbox="allow-scripts allow-forms" style="width:900px;height:650px"></iframe>');
  await page.evaluate(html => {
    window.messages = [];
    addEventListener('message', event => { if (event.source === document.querySelector('iframe').contentWindow) window.messages.push(event.data); });
    document.querySelector('iframe').srcdoc = html;
  }, previewHtml(source, 'source-test'));
  const frame = page.frames()[1];
  await frame.locator('#target').waitFor();
  await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ channel: 'craft-ux-host', token: 'source-test', type: 'mode', mode: 'element' }, '*'));
  await frame.locator('#target').click();
  await page.waitForFunction(() => window.messages.some(message => message.type === 'picked'));
  const anchor = await page.evaluate(() => window.messages.find(message => message.type === 'picked').anchor);
  assert.deepEqual(errors, []);
  return { anchor, page, frame };
}

for (const [name, code] of [
  ['createElement', 'const target = document.createElement("button"); target.id = "target"; target.textContent = "保存草稿"; document.body.append(target);'],
  ['async creation', 'setTimeout(() => { const target = document.createElement("button");\n target.id = "target";\n target.textContent = "保存草稿";\n document.body.append(target); }, 0);'],
  ['innerHTML', 'document.querySelector("#mount").innerHTML = \'<div><button id="target">保存草稿</button></div>\';'],
  ['insertAdjacentHTML', 'document.querySelector("#mount").insertAdjacentHTML("beforeend", \'<button id="target">保存草稿</button>\');'],
  ['cloneNode', 'const target = document.querySelector("template").content.firstElementChild.cloneNode(true); target.id = "target"; document.body.append(target);'],
]) {
  test(`runtime ${name} maps the picked element to generating code in the AI prompt`, async t => {
    const source = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src self"><base href="https://invalid.test"></head><body>\n<div id="mount"></div><template><button>保存草稿</button></template>\n<script>const unrelated = "保留其他脚本";</script>\n<script>\n' + code + '\n</script></body></html>';
    const { anchor } = await pick(t, source);
    assert.equal(anchor.source?.kind, 'runtime', 'The picker must record the actual script call site');
    const [target] = targetSources(source, [anchor]);
    assert.equal(target.status, 'found');
    assert.equal(target.matchedBy, 'runtime');
    assert.ok(target.html.includes(name === 'cloneNode' ? 'cloneNode' : '保存草稿'));
    assert.equal(source.slice(target.startOffset, target.endOffset), target.html);
    assert.equal(source.slice(0, target.startOffset).split('\n').length, target.startLine);
    const prompt = editPrompt({ originalPath: '/test.ux.html', businessPath: '/work.html' }, { selectedRequests: [{ id: 'ann-runtime', body: '改成确认', anchor, targetSource: target }], scope: {} }, { scriptsPath: '/scripts' });
    assert.match(prompt, /动态生成代码/);
    assert.match(prompt, /```javascript/);
    assert.doesNotMatch(prompt, /目标暂不能静态定位/);
  });
}

test('runtime mapping survives source formatting and rejects changed generating code', async t => {
  const script = 'const target = document.createElement("button");\r\n target.id="target"; target.textContent="保存草稿"; document.body.append(target);';
  const source = '<html><body><script>\r\n' + script + '\r\n</script></body></html>';
  const { anchor } = await pick(t, source);
  assert.equal(anchor.source?.kind, 'runtime');
  assert.equal(targetSources(source.replace('<body>', '<body>\n\n'), [anchor])[0].matchedBy, 'runtime');
  assert.equal(targetSources(source.replace('保存草稿', '完全不同的代码'), [anchor])[0].status, 'unavailable');
});

test('single-line fragments map the exact assignment and preserve business behavior', async t => {
  const source = '<script>const target=document.createElement("button");target.id="target";target.textContent="保存";target.onclick=()=>target.textContent="成功";document.body.append(target);</script>';
  const { anchor, frame } = await pick(t, source);
  const [target] = targetSources(source, [anchor]);
  const callOffset = target.column - 1;
  assert.equal(target.line, 1);
  assert.ok(callOffset >= source.indexOf('target.textContent=') && callOffset <= source.indexOf('="保存"'));
  await frame.locator('#target').click();
  assert.equal(await frame.locator('#target').textContent(), '成功');
});

test('helper rendering includes a distant caller within a bounded prompt', async t => {
  const code = 'function render(label){ const target=document.createElement("button"); target.id="target"; target.textContent=label; document.body.append(target); }\n' + '// unrelated code\n'.repeat(300) + 'render("调用处的文案");';
  const source = '<html><body><script>\n' + code + '\n</script></body></html>';
  const { anchor } = await pick(t, source);
  const [target] = targetSources(source, [anchor]);
  assert.equal(target.matchedBy, 'runtime');
  assert.ok(target.html.includes('target.textContent=label'));
  assert.ok(target.callers.some(caller => caller.html.includes('render("调用处的文案")')));
  assert.ok([target, ...target.callers].reduce((length, part) => length + part.html.length, 0) <= 2400);
});

test('runtime locations survive script insertion and reject malformed or ambiguous stale references', async t => {
  const source = '<html><body><script>const target=document.createElement("button");target.id="target";target.textContent="保存";document.body.append(target);</script></body></html>';
  const { anchor } = await pick(t, source);
  const prefix = '<script>const unrelated=1;</script>';
  assert.equal(targetSources(prefix + source, [anchor])[0].matchedBy, 'runtime');
  assert.equal(targetSources(prefix + source + source, [anchor])[0].status, 'unavailable');
  for (const locations of [null, [], [{ ...anchor.source.locations[0], line: -1 }], [{ ...anchor.source.locations[0], column: 999999 }]]) {
    assert.equal(targetSources(source, [{ ...anchor, source: { kind: 'runtime', locations } }])[0].status, 'unavailable');
  }
});

test('unmapped custom source URLs keep the ordinary location fallback', async t => {
  const source = '<html><body><script>const target=document.createElement("button");target.id="target";target.textContent="保存";document.body.append(target);\n//# sourceURL=virtual-renderer.js\n</script></body></html>';
  const { anchor } = await pick(t, source);
  assert.equal(anchor.source, undefined);
  assert.equal(targetSources(source, [anchor])[0].reason, 'not-in-static-source');
});
