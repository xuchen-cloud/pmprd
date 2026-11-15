// Read-only navigation contract probe. Run with the installed Electron in Node
// mode so the SDK inside app.asar is read directly. This does not control DSH UI.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const sdkRoot = process.argv[2];
const taskFile = process.argv[3];
if (!sdkRoot || !taskFile) throw new Error('Usage: Electron(Node mode) repro-navigation-sdk.cjs SDK_NODE_MODULES TASK_STATE_JSON');
const esbuild = createRequire(path.resolve(__dirname, '../../../ux-workbench/package.json'))('esbuild');
const sdkPath = file => path.join(sdkRoot, '@deepseek-ai/dsh-client-ui-sidebar-right/src/client', file);
const sdk = require(path.join(sdkRoot, '@deepseek-ai/dsh-util-workspace-path/lib/index.js'));
const { fileAddress } = require('../src/address.mjs');
const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
assert.equal(task.status, 'completed');
assert.ok(fs.statSync(task.outputPath).isFile());
const address = fileAddress(task.sessionId, task.outputPath);
assert.equal(address, sdk.sessionFileAddress(task.sessionId, task.outputPath));
assert.deepEqual(sdk.parseFileAddress(address), { scope: 'session', sessionId: task.sessionId, path: task.outputPath });

// Transpile the installed SDK's actual methods, not copies of their algorithm.
// Dependencies below are only scaffolding for the observable-store boundary;
// no React renderer or application state is constructed in this probe.
function sourceModule(file, dependencies = {}) {
  const filename = sdkPath(file), source = fs.readFileSync(filename, 'utf8');
  const output = esbuild.transformSync(source, { loader: 'ts', format: 'cjs', target: 'node22' }).code;
  const module = { exports: {} };
  const untouched = new Proxy({}, { get: (_target, name) => () => { throw new Error(`Unexpected dependency call: ${String(name)}`); } });
  vm.runInNewContext(output, { module, exports: module.exports, require: name => dependencies[name] || untouched, AbortController, Map, Set, console }, { filename });
  return module.exports;
}
const { SidebarRightController } = sourceModule('service.ts');
const { TabDomain } = sourceModule('tab-domain.ts', {
  '@deepseek-ai/dsh-util-crypto': { randomUUID: crypto.randomUUID },
  '@deepseek-ai/dsh-client-store': { createSnapshotStore: initial => {
    let value = initial; return { getSnapshot: () => value, set: next => { value = next; } };
  } },
});
const calls = [];
const controller = Object.create(SidebarRightController.prototype);
controller.adopted = new Map([[task.sessionId, { store: { actions: {} } }]]);
controller.placeResource = (sessionId, actions, target, options) => calls.push({ sessionId, target, options });
const domain = new TabDomain(controller, () => {});
domain.navigate(task.sessionId, 'source-tab', { address: sdk.sessionFileAddress(task.sessionId, task.originalPath), params: undefined });
const actions = domain.occurrence(task.sessionId, { id: 'source-tab' }).tabActions;
actions.openResource(address);
assert.equal(calls.length, 1, 'An adopted session must receive a navigation intent');
assert.equal(calls[0].sessionId, task.sessionId);
assert.equal(calls[0].target, address);
assert.equal(Object.keys(calls[0].options).length, 1); // SDK supplies params: undefined.
controller.adopted.delete(task.sessionId);
actions.openResource(address);
assert.equal(calls.length, 1, 'The SDK explicitly ignores actions after session adoption is released');
domain.dispose();
console.log(JSON.stringify({
  taskId: task.id,
  officialAddressMatches: true,
  officialParserPreservesAbsolutePath: true,
  adoptedSessionReceivesOpenIntent: true,
  releasedSessionSilentlyIgnoresOpen: true,
  conclusion: 'Address and native action contract pass. This probe does not reproduce the reported live UI symptom or establish that its session was released.',
}, null, 2));
