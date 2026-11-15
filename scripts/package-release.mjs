import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Build in a temporary workspace: the development package may be linked into
// an active DSH profile, so release packaging must never replace its live lib.
const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run npm run release:pack from the repository root.');
await fs.access(path.join(root, 'ux-workbench/node_modules/esbuild'));
const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'ux-review-release-'));
const output = path.join(root, 'release');
const packagePath = 'packages/dsh-ux-review';
const run = (script, args = []) => execFileSync(process.execPath, [script, ...args], { cwd: stage, stdio: 'inherit' });
try {
  for (const relative of [
    'ux-workbench/src', 'ux-workbench/scripts/build-review.mjs', 'ux-workbench/package.json',
    `${packagePath}/src`, `${packagePath}/scripts/build.mjs`, `${packagePath}/package.json`,
    `${packagePath}/README.md`, `${packagePath}/locale`, `${packagePath}/icon.svg`,
    `${packagePath}/cordis.patch.yml`, 'skills/ux-prototype', 'skills/opentiny-ux',
  ]) {
    const destination = path.join(stage, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(path.join(root, relative), destination, {
      recursive: true,
      filter: file => !path.relative(root, file).split(path.sep).some(part =>
        ['node_modules', 'tooling', '__pycache__', 'generated'].includes(part)) && !file.endsWith('.pyc'),
    });
  }
  await fs.symlink(path.join(root, 'ux-workbench/node_modules'), path.join(stage, 'ux-workbench/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  run(path.join(stage, 'ux-workbench/scripts/build-review.mjs'));
  run(path.join(stage, packagePath, 'scripts/build.mjs'));
  await fs.mkdir(output, { recursive: true });
  const [packed] = JSON.parse(execFileSync(process.execPath,
    [npmCli, 'pack', '--json', '--pack-destination', output],
    { cwd: path.join(stage, packagePath), encoding: 'utf8' }));
  const included = new Set(packed.files.map(file => file.path));
  for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml',
    'skills/ux-prototype/SKILL.md', 'skills/opentiny-ux/SKILL.md',
    'skills/ux-prototype/scripts/uxdoc.mjs', 'skills/ux-prototype/scripts/edit-session.mjs',
    'skills/ux-prototype/scripts/vendor/static-html.mjs', 'skills/ux-prototype/scripts/vendor/markdown-lexer.mjs']) {
    if (!included.has(required)) throw new Error(`Release missing ${required}`);
  }
  if ([...included].some(file => /(?:^|\/)(?:node_modules|\.ux-review-[^/]*|tooling|__pycache__)(?:\/|$)/.test(file))) {
    throw new Error('Release contains local development or task state.');
  }
  const archive = path.join(output, packed.filename);
  const checksum = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  await fs.writeFile(`${archive}.sha256`, `${checksum}  ${packed.filename}\n`);
  await fs.copyFile(path.join(root, 'docs/distribution.md'), path.join(output, 'INSTALL.md'));
  console.log(`Release: ${archive}\nSHA-256: ${checksum}\nFiles: ${included.size}`);
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
