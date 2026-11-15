import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '../..');
const require = createRequire(path.join(workspace, 'ux-workbench/package.json'));
const { build } = require('esbuild');
await fs.mkdir(path.join(root, 'lib'), { recursive: true });
await build({ entryPoints: [path.join(root, 'src/index.mjs')], outfile: path.join(root, 'lib/index.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-skill-filesystem'], sourcemap: true });
const client = await build({ entryPoints: [path.join(root, 'src/client.jsx')], bundle: true, write: false, platform: 'browser', format: 'cjs', target: 'chrome120', jsx: 'automatic', minify: false,
  nodePaths: [path.join(workspace, 'ux-workbench/node_modules')],
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'], loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } });
await fs.writeFile(path.join(root, 'lib/client.js'), `window.__ModuleLoader__.load({id:"dsh-ux-review",factory:require=>{var module={exports:{}};var exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
for (const skill of ['ux-prototype', 'opentiny-ux']) {
  const destination = path.join(root, 'skills', skill);
  await fs.rm(destination, { recursive: true, force: true });
  const source = path.join(workspace, 'skills', skill);
  await fs.cp(source, destination, { recursive: true, filter: file => !path.relative(source, file).split(path.sep).some(part => ['tooling', 'node_modules', '__pycache__'].includes(part)) && !file.endsWith('.pyc') });
}
console.log('Built DSH Host, Client, and bundled skills.');
