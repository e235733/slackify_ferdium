import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build, loadUpstream } from '../../src/build/generate-css.mjs';
import { runStaticChecks, root } from '../../scripts/static-checks.mjs';

const require = createRequire(import.meta.url);

test('static checks all pass', () => {
  const failed = runStaticChecks().filter((r) => !r.ok);
  assert.deepEqual(failed, []);
});

test('generated CSS equals a fresh build and contains the main Slackify rules', () => {
  const { css } = build();
  assert.equal(fs.readFileSync(path.join(root, 'dist/user.css'), 'utf8'), css, 'dist/user.css is up to date (run npm run build)');
  for (const f of ['flatten', 'fullwidth', 'selfslack', 'composer', 'datedividers', 'threadreplies', 'codestyle', 'msgalign', 'sendername', 'sidebar', 'topbar', 'typography', 'density', 'rowhover']) {
    assert.ok(css.includes(`html[data-sf-on][data-sf-feat-${f}]`), `rules for ${f}`);
  }
  assert.ok(css.includes('html[data-sf-theme="aubergine"][data-sf-mode="light"]'));
  assert.ok(css.includes('html[data-sf-theme="aubergine"][data-sf-mode="dark"]'));
  assert.match(css, /@font-face\{font-family:'SlackifyLato'[^}]*data:font\/woff2;base64,/);
  // Policy: no external URLs at all (upstream's gstatic logo swap is stripped at build time).
  const urls = css.replace(/data:[^)'"]+/g, '').match(/https?:\/\/[^\s)'"]+/g) || [];
  assert.deepEqual(urls, []);
  // logo: filter replaces upstream's image swap, scoped to the chatlogo img on dark top bars only
  const logoRules = [...css.matchAll(/(html\[data-sf-on\]\[data-sf-feat-topbar\][^{]*img\[src\*="chatlogo"\])\s*\{([^}]*)\}/g)];
  assert.ok(logoRules.length >= 2);
  for (const m of logoRules) assert.equal(m[2].replace(/\s+/g, ' ').replace('filter:', 'filter: ').replace(/ +/g, ' ').trim(), 'filter: brightness(0) invert(1) !important;');
  assert.ok(!/content:\s*url/.test(logoRules.map((m) => m[0]).join('')));
});

test('css generation ran in an isolated context (no host globals leaked in)', () => {
  const up = loadUpstream();
  assert.equal(typeof up.SLACKIFY_STYLES.buildCSS, 'function');
  assert.equal(up.process, undefined);
  assert.equal(up.require, undefined);
});

test('upstream sources are pinned snapshots with license', () => {
  assert.ok(fs.readFileSync(path.join(root, 'src/upstream/LICENSE'), 'utf8').startsWith('MIT License'));
  assert.equal(loadUpstream().SLACKIFY_CONFIG.FEATURES.length > 20, true);
});

function runUserJs(dir) {
  const calls = [];
  globalThis.__calls = calls;
  const entry = path.join(dir, 'user.js');
  delete require.cache[require.resolve(entry)];
  const fn = require(entry);
  assert.equal(typeof fn, 'function');
  fn({ cfg: 1 }, { us: 1 });
  return calls;
}

function stage(origSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-user-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}');
  fs.copyFileSync(path.join(root, 'dist/user.js'), path.join(dir, 'user.js'));
  fs.writeFileSync(path.join(dir, '.fs-runtime.cjs'), 'module.exports = (c, u) => { globalThis.__calls.push(["runtime", c.cfg, u.us]); };');
  if (origSrc !== undefined) fs.writeFileSync(path.join(dir, '.fs-original-user.cjs'), origSrc);
  return dir;
}

test('user.js coexistence: no original -> runtime once', () => {
  assert.deepEqual(runUserJs(stage()), [['runtime', 1, 1]]);
});

test('user.js coexistence: original runs exactly once, before the runtime, with the same args', () => {
  const dir = stage('module.exports = function (c, u) { globalThis.__calls.push(["orig", c.cfg, u.us, require("./helper.cjs")]); };');
  fs.writeFileSync(path.join(dir, 'helper.cjs'), 'module.exports = "relative-require-ok";');
  assert.deepEqual(runUserJs(dir), [['orig', 1, 1, 'relative-require-ok'], ['runtime', 1, 1]]);
});

test('user.js coexistence: broken or non-function original never blocks the runtime', () => {
  const saved = console.error; console.error = () => {};
  try {
    assert.deepEqual(runUserJs(stage('throw new Error("boom")')), [['runtime', 1, 1]]);
    assert.deepEqual(runUserJs(stage('module.exports = { notAFunction: true }')), [['runtime', 1, 1]]);
    assert.deepEqual(runUserJs(stage('module.exports = function () { throw new Error("x") }')), [['runtime', 1, 1]]);
  } finally { console.error = saved; }
});

test('runtime bundle is self-contained CommonJS with no requires of non-builtins', () => {
  const src = fs.readFileSync(path.join(root, 'dist/.fs-runtime.cjs'), 'utf8');
  const reqs = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  assert.deepEqual(reqs, []);
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(src, sandbox);
  assert.equal(typeof sandbox.module.exports, 'function');
  assert.equal(typeof sandbox.module.exports.boot, 'function');
});

test('pinned upstream snapshots match their recorded SHA-256 and the recorded commit SHAs are 40 hex digits', async () => {
  const crypto = await import('node:crypto');
  const pins = JSON.parse(fs.readFileSync(path.join(root, 'src/upstream/pins.json'), 'utf8'));
  for (const [file, want] of Object.entries(pins['gchat-slackify'].files)) {
    const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src/upstream', file))).digest('hex');
    assert.equal(got, want, file);
  }
  for (const [name, p] of Object.entries(pins)) assert.match(p.commit, /^[0-9a-f]{40}$/, name);
  const doc = fs.readFileSync(path.join(root, 'docs/UPSTREAM.md'), 'utf8');
  for (const p of Object.values(pins)) assert.ok(doc.includes(p.commit), `UPSTREAM.md lists ${p.commit}`);
});
