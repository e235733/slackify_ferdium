// Bundles the runtime into dist/.fs-runtime.cjs and copies the Ferdium entry to dist/user.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

await build({
  entryPoints: [path.join(root, 'src/runtime/index.cjs')],
  outfile: path.join(root, 'dist/.fs-runtime.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  legalComments: 'none',
  banner: { js: '/* ferdium-gchat-slackify runtime - port of gchat-slackify (MIT). Generated; do not edit. */' },
  logLevel: 'warning',
});
// dist/ is a CommonJS island inside this ESM project (Ferdium Recipe dirs have no "type" field).
fs.writeFileSync(path.join(root, 'dist/package.json'), '{"type":"commonjs"}\n');
fs.copyFileSync(path.join(root, 'src/ferdium/user-entry.cjs'), path.join(root, 'dist/user.js'));
const sz = (f) => fs.statSync(path.join(root, f)).size;
console.log(`dist/.fs-runtime.cjs ${sz('dist/.fs-runtime.cjs')} bytes, dist/user.js ${sz('dist/user.js')} bytes`);
