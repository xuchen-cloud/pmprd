// Isolated SDK compatibility test. Synthetic loopback auth only; no user profile.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = process.argv[2];
if (!root) throw new Error('Pass the installed app.asar/dsh/node_modules directory.');
const { Context } = require(path.join(root, '@deepseek-ai/cordis/lib/index.js'));
const { HostConnectionService } = require(path.join(root, '@deepseek-ai/dsh-client-connection/lib/index.js'));
const { SkillRegistry } = require(path.join(root, '@deepseek-ai/dsh-skill/lib/index.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
for (const dependency of manifest.dsh.client.inject) assert.ok(fs.existsSync(path.join(root, dependency, 'package.json')), `Client dependency must exist: ${dependency}`);

(async () => {
  const ctx = new Context(); let connection;
  const server = http.createServer(async (req, res) => {
    const admission = connection.admit(req);
    if (admission.rejection) { res.writeHead(admission.rejection); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
    const response = await connection.createSharedFetchHandler('/api').fetch(request, admission.peer);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const authority = `127.0.0.1:${server.address().port}`;
  ctx.reflect.provide('webServer', { protocol: 'http:' });
  // Match the installed provider: webServer is NOT in its base inject declaration.
  // This catches definition-site guards that a root-context fixture misses.
  const provider = await ctx.plugin({ name: 'isolated-connection', apply(providerCtx) {
    connection = new HostConnectionService(providerCtx, [authority], { isAuthenticated: req => req.headers['x-test-owner'] === '1', authenticateApi: () => undefined });
  } });
  let fiber;
  const temporary = path.join(__dirname, '../lib', `.ux-review-sdk-${process.pid}.mjs`);
  try {
    const releaseGateway = connection.rpc.intercept('/api', () => true, async () => ({ ok: true, value: { gateway: true } }));
    const toolNames = [];
    ctx.reflect.provide('fs', { resolve: async value => ({ targetKey: value }), processPath: target => target.targetKey, contains: () => true, stat: async target => target.targetKey.endsWith('.html') ? ({ type: 'file', version: 'test-version', size: 13 }) : null, readText: async () => '<html></html>' });
    ctx.reflect.provide('sessionController', { resolveAgent: async id => ({ agent: { session: { id } } }) });
    ctx.reflect.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/workspace' }) });
    ctx.reflect.provide('tools', { register: tool => { toolNames.push(tool.name); return () => {}; } });
    const skills = new SkillRegistry(ctx);
    let hostSource = fs.readFileSync(path.join(__dirname, '../lib/index.js'), 'utf8');
    for (const dependency of Object.keys(manifest.peerDependencies)) hostSource = hostSource.replace(JSON.stringify(dependency), JSON.stringify(path.join(root, dependency, 'lib/index.js')));
    fs.writeFileSync(temporary, hostSource);
    fiber = await ctx.plugin(require(temporary));
    assert.equal(toolNames.length, 6);
    assert.ok(toolNames.includes('ux_review_context'));
    const catalog = await skills.list();
    assert.deepEqual(catalog.map(s => s.name).sort(), ['opentiny-ux', 'ux-prototype']);
    assert.ok(catalog.every(s => s.source === 'bundled' && s.provider === 'ux-review-bundled'));
    assert.ok((await skills.get('ux-prototype')).content.includes('finish'));
    assert.ok(fs.existsSync(path.join(__dirname, '../skills/ux-prototype/scripts/edit-session.mjs')));
    const body = JSON.stringify({ type: 'client-request', rpcId: 'test-request', method: 'ux-review/read', payload: { sessionId: 'example', path: '/workspace/product.ux.html' } });
    const request = async headers => fetch(`http://${authority}/api/ux-review/read`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    assert.equal((await request({})).status, 401);
    assert.equal((await request({ 'x-test-owner': '1', origin: 'http://untrusted.invalid' })).status, 403);
    const response = await request({ 'x-test-owner': '1', origin: `http://${authority}` });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.result.ok, true, JSON.stringify(value));
    assert.equal(value.result.value.html, '<html></html>');
    assert.equal(value.result.value.version, 'test-version');
    const nonOwner = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://${authority}/api/ux-review/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }), { principal: { kind: 'remote' } });
    assert.equal(nonOwner.status, 403);
    await fiber.dispose(); fiber = null;
    assert.equal((await skills.list()).length, 0);
    const disposed = await (await request({ 'x-test-owner': '1' })).json();
    assert.equal(disposed.result.value.gateway, true);
    await releaseGateway();
    console.log('Installed SDK: Host activates beside Gateway; authenticated routes enforce owner policy; bundled skills discover/load; plugin disposal removes routes and skills.');
  } finally {
    if (fiber) await fiber.dispose();
    fs.unlinkSync(temporary); await provider.dispose();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
