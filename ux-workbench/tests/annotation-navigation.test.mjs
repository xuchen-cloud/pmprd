import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { previewHtml } from '../src/preview.mjs';

let browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

async function setup(t, source) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.setContent('<iframe sandbox="allow-scripts allow-forms" style="width:900px;height:600px"></iframe>');
  await page.evaluate(html => {
    window.messages = [];
    addEventListener('message', event => { if (event.source === document.querySelector('iframe').contentWindow) window.messages.push(event.data); });
    document.querySelector('iframe').srcdoc = html;
  }, previewHtml(source, 'navigation-test'));
  await page.waitForFunction(() => window.messages.some(message => message.type === 'ready'));
  const frame = page.frames()[1];
  const send = data => page.evaluate(data => document.querySelector('iframe').contentWindow.postMessage({ channel: 'craft-ux-host', token: 'navigation-test', ...data }, '*'), data);
  const wait = async (type, id) => {
    await page.waitForFunction(({ type, id }) => window.messages.some(message => message.type === type && (!id || message.id === id)), { type, id });
    return page.evaluate(({ type, id }) => window.messages.findLast(message => message.type === type && (!id || message.id === id)), { type, id });
  };
  const locate = async (id, anchor) => {
    await page.evaluate(() => { window.messages = []; });
    await send({ type: 'annotations', annotations: [{ id, anchor }] });
    await send({ type: 'locate', id });
    return wait('located', id);
  };
  return { page, frame, send, wait, locate };
}

test('capture retains explicit view context and reveal initializes a closed dialog asynchronously', async t => {
  const { frame, send, wait, locate } = await setup(t, `<!doctype html><html><body>
    <input id="draft" value="保留主页面草稿"><dialog id="editor"><input id="dialog-draft" value=""><button id="target">编辑规则</button></dialog>
    <script>
    window.initializations=0;
    window.__UX_REVIEW_NAVIGATION__={
      capture(element){return element.closest('#editor') ? {key:'editor',label:'编辑弹窗',recordId:'one'} : null;},
      async reveal(view, anchor, {signal}) {
        if(view.key!=='editor') return false;
        await new Promise(resolve=>setTimeout(resolve,60));
        if(signal.aborted) return false;
        window.initializations++;
        document.querySelector('#dialog-draft').value='初始化后的值';
        document.querySelector('#editor').showModal();
      }
    };
    document.querySelector('#editor').showModal();
    </script></body></html>`);
  await send({ type: 'mode', mode: 'element' });
  await frame.locator('#target').click();
  const picked = await wait('picked');
  assert.deepEqual(picked.anchor.view, { key: 'editor', label: '编辑弹窗', recordId: 'one' });
  assert.equal(JSON.stringify(picked.anchor).includes('保留主页面草稿'), false);
  await frame.evaluate(() => document.querySelector('#editor').close());
  const result = await locate('ann-dialog', picked.anchor);
  assert.equal(result.found, true);
  assert.equal(result.visible, true);
  assert.equal(result.reason, '');
  assert.equal(await frame.evaluate(() => window.initializations), 1);
  assert.equal(await frame.locator('#dialog-draft').inputValue(), '初始化后的值');
  assert.equal(await frame.locator('#draft').inputValue(), '保留主页面草稿');
});

test('a captured shared-panel tab is restored even when its target is already visible', async t => {
  const { page, frame, wait, locate } = await setup(t, `<!doctype html><html><body>
    <div role="tablist"><button id="tab-a" role="tab" aria-selected="true" aria-controls="shared">甲</button><button id="tab-b" role="tab" aria-selected="false" aria-controls="shared">乙</button></div>
    <section id="shared" role="tabpanel"><button id="shared-target">共享操作</button><input id="draft" value="不丢弃输入"></section>
    <script>window.selection='a';window.businessActions=0;
    for(const key of ['a','b']) document.querySelector('#tab-'+key).onclick=()=>{window.selection=key;for(const tab of document.querySelectorAll('[role=tab]')) tab.setAttribute('aria-selected',String(tab.id==='tab-'+key));};
    document.querySelector('#shared-target').onclick=()=>window.businessActions++;
    </script></body></html>`);
  await frame.locator('#shared-target').click({ button: 'right' });
  const captured = await wait('contextmenu');
  assert.deepEqual(captured.anchor.tabs, [{ selector: '#tab-a', panelSelector: '#shared' }]);
  await frame.locator('#tab-b').click();
  assert.equal(await frame.locator('#shared-target').isVisible(), true);
  const result = await locate('ann-shared', captured.anchor);
  assert.equal(result.visible, true);
  assert.equal(await frame.evaluate(() => window.selection), 'a');
  assert.equal(await frame.evaluate(() => window.businessActions), 0);
  assert.equal(await frame.locator('#draft').inputValue(), '不丢弃输入');
  assert.equal(await page.evaluate(() => window.messages.some(message => message.type === 'interaction')), false, 'Automatic tab activation must preserve the selected host marker');
});

test('legacy semantic tabs and nested details reveal safely before scrolling and measuring', async t => {
  const { page, frame, locate } = await setup(t, `<!doctype html><html><body style="margin:0">
    <button id="tab" role="tab" aria-controls="panel" aria-selected="false">目标页</button>
    <section id="panel" hidden><details id="outer"><summary>外层</summary><details id="inner"><summary>内层</summary><div style="height:1500px"></div><button id="target">远处目标</button></details></details></section>
    <script>window.tabClicks=0;document.querySelector('#tab').onclick=()=>{window.tabClicks++;setTimeout(()=>{document.querySelector('#panel').hidden=false;document.querySelector('#tab').setAttribute('aria-selected','true');},50);};</script>
    </body></html>`);
  const result = await locate('ann-legacy', { kind: 'element', selector: '#target' });
  assert.equal(result.visible, true);
  assert.equal(await frame.evaluate(() => window.tabClicks), 1);
  assert.deepEqual(await frame.locator('details').evaluateAll(elements => elements.map(element => element.open)), [true, true]);
  const geometry = await frame.locator('#target').evaluate(element => ({ y: element.getBoundingClientRect().y, height: innerHeight, scrollY }));
  assert.ok(geometry.scrollY > 0);
  assert.ok(geometry.y >= 0 && geometry.y < geometry.height);
  const snapshot = await page.evaluate(() => window.messages.filter(message => message.type === 'snapshot').at(-1));
  assert.ok(Math.abs(snapshot.anchors[0].rect.y - geometry.y) <= 1, 'The host receives geometry after the final scroll');
});

test('hidden business controls and draft dialogs are left intact without an explicit navigation hook', async t => {
  const { frame, locate } = await setup(t, `<!doctype html><html><body>
    <button id="open">打开页面</button><section id="page" hidden><button id="hidden-target">保存</button></section>
    <dialog id="dialog"><input id="draft" value="尚未提交的弹窗内容"><button id="dialog-target">删除</button></dialog><button id="outside">页面目标</button>
    <form><button id="unsafe-tab" role="tab" aria-controls="unsafe-panel" aria-selected="false">有提交风险</button><section id="unsafe-panel" hidden><button id="unsafe-target">目标</button></section></form>
    <form><input type="submit" role="tab" aria-controls="input-panel" aria-selected="false" value="提交"><section id="input-panel" hidden><span id="input-target">输入提交目标</span></section></form>
    <script>window.actions=0;document.querySelectorAll('button').forEach(button=>button.onclick=()=>window.actions++);</script>
    </body></html>`);
  for (const selector of ['#hidden-target', '#dialog-target', '#unsafe-target', '#input-target']) {
    const result = await locate('ann-safe', { kind: 'element', selector });
    assert.equal(result.found, true);
    assert.equal(result.visible, false);
    assert.match(result.reason, /页面|弹窗/);
  }
  assert.equal(await frame.locator('#page').getAttribute('hidden'), '');
  assert.equal(await frame.locator('#dialog').evaluate(element => element.open), false);
  await frame.evaluate(() => document.querySelector('#dialog').showModal());
  const outside = await locate('ann-outside', { kind: 'element', selector: '#outside' });
  assert.equal(outside.visible, false);
  assert.match(outside.reason, /当前弹窗/);
  assert.equal(await frame.locator('#dialog').evaluate(element => element.open), true);
  assert.equal(await frame.locator('#draft').inputValue(), '尚未提交的弹窗内容');
  assert.equal(await frame.evaluate(() => window.actions), 0);
});

test('new requests cancel stale asynchronous navigation and timeout aborts the hook', async t => {
  const { page, frame, send, wait, locate } = await setup(t, `<!doctype html><html><body><button id="target">目标</button>
    <script>window.visits=[];window.aborts=[];
    window.__UX_REVIEW_NAVIGATION__={async reveal(view,anchor,{signal}){
      signal.addEventListener('abort',()=>window.aborts.push(view.key),{once:true});
      if(view.key==='never') return new Promise(()=>{});
      if(view.key==='slow') await new Promise(resolve=>setTimeout(resolve,200));
      if(signal.aborted) return false;
      window.visits.push(view.key);
    }};</script></body></html>`);
  const annotations = ['slow', 'fast'].map(key => ({ id: 'ann-' + key, anchor: { kind: 'element', selector: '#target', view: { key } } }));
  await send({ type: 'annotations', annotations });
  await send({ type: 'locate', id: 'ann-slow' });
  await frame.waitForFunction(() => window.__UX_REVIEW_NAVIGATION__ && window.visits.length === 0);
  await send({ type: 'locate', id: 'ann-fast' });
  const fast = await wait('located', 'ann-fast');
  assert.equal(fast.visible, true);
  await frame.waitForFunction(() => window.aborts.includes('slow'));
  assert.deepEqual(await frame.evaluate(() => window.visits), ['fast']);
  assert.equal(await page.evaluate(() => window.messages.some(message => message.type === 'located' && message.id === 'ann-slow')), false);
  const timeout = await locate('ann-timeout', { kind: 'element', selector: '#target', view: { key: 'never' } });
  assert.equal(timeout.found, true);
  assert.equal(timeout.visible, false);
  assert.match(timeout.reason, /超时/);
  assert.deepEqual(await frame.evaluate(() => window.aborts), ['slow', 'never']);
  assert.deepEqual(await frame.evaluate(() => window.visits), ['fast']);
});

test('refused, failed and missing view hooks return actionable results without falling through', async t => {
  const { frame, locate } = await setup(t, `<!doctype html><html><body><button id="target">目标</button>
    <script>window.__UX_REVIEW_NAVIGATION__={reveal(view){if(view.key==='refuse')return false;throw new Error('private failure');}};</script></body></html>`);
  for (const key of ['refuse', 'throw']) {
    const result = await locate('ann-' + key, { kind: 'element', selector: '#target', view: { key } });
    assert.equal(result.found, true);
    assert.equal(result.visible, false, 'A visible shared element must not override a refused view change');
    assert.match(result.reason, /原型/);
    assert.equal(result.reason.includes('private failure'), false);
  }
  await frame.evaluate(() => { delete window.__UX_REVIEW_NAVIGATION__; });
  const missing = await locate('ann-no-hook', { kind: 'element', selector: '#target', view: { key: 'page-b' } });
  assert.equal(missing.visible, false);
  assert.match(missing.reason, /未提供页面恢复接口/);
});

test('a real user click cancels a pending locate and still reports business interaction', async t => {
  const { page, frame, send, wait } = await setup(t, `<!doctype html><html><body><button id="target">继续编辑</button>
    <script>window.started=false;window.aborted=false;window.__UX_REVIEW_NAVIGATION__={reveal(view,anchor,{signal}){window.started=true;signal.addEventListener('abort',()=>window.aborted=true,{once:true});return new Promise(()=>{});}};</script></body></html>`);
  await send({ type: 'annotations', annotations: [{ id: 'ann-pending', anchor: { kind: 'element', selector: '#target', view: { key: 'pending' } } }] });
  await send({ type: 'locate', id: 'ann-pending' });
  await frame.waitForFunction(() => window.started);
  await frame.locator('#target').click();
  await wait('interaction');
  assert.equal(await frame.evaluate(() => window.aborted), true);
  assert.equal(await page.evaluate(() => window.messages.some(message => message.type === 'located')), false);
});

test('unserializable capture cannot prevent a human annotation and async reveal can create the target', async t => {
  const { frame, send, wait, locate } = await setup(t, `<!doctype html><html><body><button id="capture">选择目标</button>
    <script>window.__UX_REVIEW_NAVIGATION__={capture(){const view={key:'cycle'};view.self=view;return view;},async reveal(view,anchor,{signal}){await new Promise(resolve=>setTimeout(resolve,70));if(signal.aborted)return false;document.body.insertAdjacentHTML('beforeend','<div style="height:1100px"></div><button id="dynamic">异步目标</button>');}};</script></body></html>`);
  await send({ type: 'mode', mode: 'element' });
  await frame.locator('#capture').click();
  assert.equal((await wait('picked')).anchor.view, undefined);
  assert.match((await wait('notice')).message, /上下文/);
  const result = await locate('ann-dynamic', { kind: 'element', selector: '#dynamic', view: { key: 'dynamic' } });
  assert.equal(result.found, true);
  assert.equal(result.visible, true);
});
