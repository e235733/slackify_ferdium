import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { listFiles, root, runStaticChecks } from './static-checks.mjs';

let failed = 0;
const syntaxFiles = [
  ...listFiles('src', ['.js', '.mjs', '.cjs']).filter((f) => !f.includes('upstream/')),
  ...listFiles('src/upstream', ['.js']),
  ...listFiles('scripts', ['.mjs']),
  ...listFiles('test', ['.js', '.mjs', '.cjs']),
  'dist/user.js', 'dist/.fs-runtime.cjs',
];
for (const f of syntaxFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`FAIL syntax ${f}\n${r.stderr}`); }
}
console.log(`syntax: ${syntaxFiles.length} files checked`);
const sh = spawnSync('bash', ['-n', 'installer/install.sh'], { cwd: root, encoding: 'utf8' });
if (sh.status !== 0) { failed++; console.error(`FAIL bash -n installer/install.sh\n${sh.stderr}`); } else console.log('syntax: installer/install.sh (bash -n) ok');
if (fs.existsSync(`${root}/dist/install.sh`)) {
  const d = spawnSync('bash', ['-n', 'dist/install.sh'], { cwd: root, encoding: 'utf8' });
  if (d.status !== 0) { failed++; console.error(`FAIL bash -n dist/install.sh\n${d.stderr}`); } else console.log('syntax: dist/install.sh (bash -n) ok');
}
for (const r of runStaticChecks()) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ` - ${r.detail}` : ''}`);
  if (!r.ok) failed++;
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
