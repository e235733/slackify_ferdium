import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { INSTALLER, root, sha, ORIG_CSS, ORIG_JS, makeEnv, run, snapshot, mvShim, stagingLeftovers, RECIPE_PKG } from './helpers.mjs';

const withEnv = (opts, fn) => async (t) => { const e = makeEnv(opts); try { await fn(e, t); } finally { e.cleanup(); } };
const noChange = (e, before, label) => assert.deepEqual(snapshot(e.home), before, label);

test('recipe id mismatch: stops, nothing written', withEnv({}, (e) => {
  fs.writeFileSync(path.join(e.target, 'package.json'), RECIPE_PKG.replace('"hangoutschat"', '"somethingelse"'));
  const before = snapshot(e.home);
  const r = run(e, []);
  assert.equal(r.status, 1);
  assert.match(r.err, /E_NO_RECIPE/);
  noChange(e, before);
}));

test('serviceURL mismatch (same id): stops, nothing written', withEnv({}, (e) => {
  fs.writeFileSync(path.join(e.target, 'package.json'), RECIPE_PKG.replace('https://chat.google.com', 'https://chat.example.com'));
  const before = snapshot(e.home);
  const r = run(e, []);
  assert.equal(r.status, 1);
  assert.match(r.err, /E_NO_RECIPE/);
  noChange(e, before);
}));

test('missing webview.js: not a target', withEnv({}, (e) => {
  fs.rmSync(path.join(e.target, 'webview.js'));
  const before = snapshot(e.home);
  assert.match(run(e, []).err, /E_NO_RECIPE/);
  noChange(e, before);
}));

test('multiple candidates: stops without choosing', withEnv({ extraTarget: true, css: ORIG_CSS }, (e) => {
  const before = snapshot(e.home);
  const r = run(e, []);
  assert.equal(r.status, 1);
  assert.match(r.err, /E_MULTIPLE_RECIPES/);
  noChange(e, before);
}));

test('no Ferdium profile / no recipes dir', withEnv({}, (e) => {
  fs.rmSync(e.recipes, { recursive: true });
  assert.match(run(e, []).err, /E_NO_RECIPE/);
  fs.rmSync(e.fer, { recursive: true });
  assert.match(run(e, []).err, /E_NO_FERDIUM/);
  assert.ok(!fs.existsSync(e.manage));
}));

test('invalid package.json is skipped with a warning, not treated as the target', withEnv({}, (e) => {
  fs.writeFileSync(path.join(e.target, 'package.json'), '{ not json');
  const r = run(e, []);
  assert.equal(r.status, 1);
  assert.match(r.err, /E_NO_RECIPE/);
  assert.match(r.err, /解析できなかった/);
}));

test('unwritable recipe directory: stops before touching anything', withEnv({ css: ORIG_CSS, js: ORIG_JS }, (e) => {
  fs.chmodSync(e.target, 0o555);
  const before = snapshot(e.home);
  const r = run(e, []);
  fs.chmodSync(e.target, 0o755);
  assert.equal(r.status, 1);
  assert.match(r.err, /E_NOT_WRITABLE/);
  noChange(e, before);
}));

test('unwritable existing user.css: stops before touching anything', withEnv({ css: ORIG_CSS, js: ORIG_JS }, (e) => {
  fs.chmodSync(path.join(e.target, 'user.css'), 0o444);
  const before = snapshot(e.home);
  const r = run(e, []);
  assert.equal(r.status, 1);
  assert.match(r.err, /E_NOT_WRITABLE/);
  noChange(e, before);
}));

test('symlinks are refused (user.css, recipe dir, Ferdium dir)', withEnv({ js: ORIG_JS }, (e) => {
  const real = path.join(e.home, 'elsewhere.css');
  fs.writeFileSync(real, 'x');
  fs.symlinkSync(real, path.join(e.target, 'user.css'));
  let before = snapshot(e.home);
  let r = run(e, []);
  assert.match(r.err, /E_SYMLINK/);
  noChange(e, before);
  assert.equal(fs.readFileSync(real, 'utf8'), 'x');
  fs.rmSync(path.join(e.target, 'user.css'));
  const moved = path.join(e.home, 'moved-recipe');
  fs.renameSync(e.target, moved);
  fs.symlinkSync(moved, e.target);
  before = snapshot(e.home);
  r = run(e, []);
  assert.equal(r.status, 1, r.all);
  noChange(e, before);
  fs.rmSync(e.target);
  fs.renameSync(moved, e.target);
  const realFer = path.join(e.home, 'RealFerdium');
  fs.renameSync(e.fer, realFer);
  fs.symlinkSync(realFer, e.fer);
  assert.match(run(e, []).err, /E_SYMLINK/);
}));

test('mid-install failure at every step restores original bytes and leaves no residue', async () => {
  const cases = [];
  for (let n = 1; n <= 5; n++) cases.push([n, { css: ORIG_CSS, js: ORIG_JS }]);
  for (let n = 1; n <= 4; n++) cases.push([n, {}]);           // fresh install: files that did not exist must be removed again
  for (let n = 1; n <= 4; n++) cases.push([n, { css: ORIG_CSS }]);
  for (const [failAt, envOpts] of cases) {
    const e = makeEnv(envOpts);
    const shim = mvShim(failAt);
    try {
      if (fs.existsSync(path.join(e.target, 'user.js'))) fs.chmodSync(path.join(e.target, 'user.js'), 0o600);
      const before = snapshot(e.home);
      const r = run(e, [], { path: shim.dir });
      assert.equal(r.status, 1, `failAt=${failAt}: ${r.all}`);
      assert.match(r.err, /mv shim: injected failure/);
      assert.match(r.err, /元の状態を復元しました/, `failAt=${failAt}`);
      const after = snapshot(e.home, { skip: (rel) => rel.startsWith('Library/Application Support/Ferdium-Slackify') });
      const beforeNoManage = Object.fromEntries(Object.entries(before).filter(([k]) => !k.startsWith('Library/Application Support/Ferdium-Slackify')));
      assert.deepEqual(after, beforeNoManage, `failAt=${failAt}: Ferdium tree identical (bytes+modes)`);
      assert.deepEqual(stagingLeftovers(e.target), [], `failAt=${failAt}: no staging files`);
      assert.ok(!fs.existsSync(path.join(e.manage, 'state/ledger')), `failAt=${failAt}: no ledger`);
      assert.ok(!fs.existsSync(path.join(e.manage, 'lock')), `failAt=${failAt}: lock released`);
      const backups = fs.readdirSync(path.join(e.manage, 'backups'));
      assert.equal(backups.length, 1, 'backup kept for inspection');
      assert.match(fs.readFileSync(path.join(e.manage, 'backups', backups[0], 'manifest'), 'utf8'), /status=failed-restored/);
      // and a retry afterwards succeeds
      assert.equal(run(e, []).status, 0);
    } finally { e.cleanup(); fs.rmSync(shim.dir, { recursive: true, force: true }); }
  }
});

test('mid-update failure restores the previously installed version', async () => {
  const e = makeEnv({ css: ORIG_CSS, js: ORIG_JS });
  const { buildAltInstaller } = await import('./helpers.mjs');
  const alt = buildAltInstaller();
  try {
    assert.equal(run(e, []).status, 0);
    const v1 = snapshot(e.target);
    const ledger1 = fs.readFileSync(path.join(e.manage, 'state/ledger'));
    for (const failAt of [1, 2, 3, 4]) {
      const shim = mvShim(failAt);
      const r = run(e, [], { path: shim.dir, script: alt.path });
      fs.rmSync(shim.dir, { recursive: true, force: true });
      assert.equal(r.status, 1, `failAt=${failAt}: ${r.all}`);
      assert.deepEqual(snapshot(e.target), v1, `failAt=${failAt}`);
      assert.deepEqual(fs.readFileSync(path.join(e.manage, 'state/ledger')), ledger1, `failAt=${failAt}: ledger unchanged`);
    }
  } finally { e.cleanup(); }
});

test('a failing ledger write (after files are placed) also rolls everything back', async () => {
  const e = makeEnv({ css: ORIG_CSS, js: ORIG_JS });
  const shim = mvShim(5); // 5th mv = ledger
  try {
    const before = snapshot(e.target);
    const r = run(e, [], { path: shim.dir });
    assert.equal(r.status, 1, r.all);
    assert.deepEqual(snapshot(e.target), before);
    assert.ok(!fs.existsSync(path.join(e.manage, 'state/ledger')));
  } finally { e.cleanup(); fs.rmSync(shim.dir, { recursive: true, force: true }); }
});

test('failing manage.sh placement is only a warning', async () => {
  const e = makeEnv({});
  const shim = mvShim(4); // fresh install: rt, css, js, ledger = 4 mv calls, then manage.sh is the 5th
  fs.rmSync(shim.dir, { recursive: true, force: true });
  const s2 = mvShim(5);
  try {
    const r = run(e, [], { path: s2.dir });
    assert.equal(r.status, 0, r.all);
    assert.match(r.err, /manage\.sh を設置できません/);
    assert.ok(fs.existsSync(path.join(e.target, 'user.js')));
  } finally { e.cleanup(); fs.rmSync(s2.dir, { recursive: true, force: true }); }
});

test('manual modification of managed files blocks update / rollback / uninstall', async () => {
  const e = makeEnv({ css: ORIG_CSS, js: ORIG_JS });
  const alt = (await import('./helpers.mjs')).buildAltInstaller();
  try {
    assert.equal(run(e, []).status, 0);
    fs.appendFileSync(path.join(e.target, 'user.js'), '// my edit\n');
    let before = snapshot(e.home);
    for (const args of [['--rollback'], ['--uninstall']]) {
      const r = run(e, args);
      assert.equal(r.status, 1, r.all);
      assert.match(r.err, /E_MODIFIED/);
      noChange(e, before, args.join(' '));
    }
    const u = run(e, [], { script: alt.path });
    assert.equal(u.status, 1, u.all);
    assert.match(u.err, /E_MODIFIED/);
    noChange(e, before, 'update');
    // .fs-runtime.cjs / .fs-original-user.cjs edits are protected too
    fs.writeFileSync(path.join(e.target, 'user.js'), fs.readFileSync(path.join(root, 'dist/user.js')));
    fs.appendFileSync(path.join(e.target, '.fs-original-user.cjs'), '// x\n');
    before = snapshot(e.home);
    assert.match(run(e, ['--uninstall']).err, /E_MODIFIED/);
    assert.match(run(e, [], { script: alt.path }).err, /E_MODIFIED/);
    noChange(e, before);
  } finally { e.cleanup(); }
});

test('manually edited user.css: update keeps edits; uninstall removes only the block', async () => {
  const e = makeEnv({ css: ORIG_CSS, js: ORIG_JS });
  try {
    assert.equal(run(e, []).status, 0);
    fs.appendFileSync(path.join(e.target, 'user.css'), '\n.mine{color:blue}\n');
    const rb = run(e, ['--rollback']);
    assert.equal(rb.status, 1, 'rollback refuses when user.css changed');
    const un = run(e, ['--uninstall']);
    assert.equal(un.status, 0, un.all);
    assert.match(un.err, /管理ブロックだけを削除/);
    const css = fs.readFileSync(path.join(e.target, 'user.css'), 'utf8');
    assert.ok(css.startsWith(ORIG_CSS) && css.includes('.mine{color:blue}'));
    assert.ok(!css.includes('FERDIUM-SLACKIFY'));
    assert.deepEqual(fs.readFileSync(path.join(e.target, 'user.js')), Buffer.from(ORIG_JS));
  } finally { e.cleanup(); }
});

test('corrupt or orphaned managed state stops safely', async () => {
  const e = makeEnv({ css: '/* BEGIN FERDIUM-SLACKIFY MANAGED */\nbroken, no end\n' });
  try {
    const before = snapshot(e.home);
    const r = run(e, []);
    assert.equal(r.status, 1);
    assert.match(r.err, /E_UNMANAGED|E_CSS_MARKERS/);
    noChange(e, before);
    fs.writeFileSync(path.join(e.target, 'user.css'), 'ok{}');
    fs.writeFileSync(path.join(e.target, '.fs-runtime.cjs'), '// orphan');
    const before2 = snapshot(e.home);
    assert.match(run(e, []).err, /E_UNMANAGED/);
    noChange(e, before2);
    fs.rmSync(path.join(e.target, '.fs-runtime.cjs'));
    fs.writeFileSync(path.join(e.target, 'user.js'), fs.readFileSync(path.join(root, 'dist/user.js')));
    assert.match(run(e, []).err, /E_UNMANAGED/);
  } finally { e.cleanup(); }
});

test('unsafe original user.js (self-referencing, ESM, non-CommonJS) is left untouched', async () => {
  for (const js of [
    'module.exports = () => { console.log(__filename); };',
    'module.exports = () => { require("./user.js"); };',
    'const p = require("path").basename("user.js"); module.exports = () => p;',
    'export default function () {}',
    'console.log("no export at all");',
  ]) {
    const e = makeEnv({ js, css: ORIG_CSS });
    try {
      const before = snapshot(e.home);
      const r = run(e, []);
      assert.equal(r.status, 1, js);
      assert.match(r.err, /E_ORIG_JS_UNSAFE/);
      noChange(e, before, js);
    } finally { e.cleanup(); }
  }
});

test('tampered embedded payload is rejected before anything is written', async () => {
  const e = makeEnv({ css: ORIG_CSS });
  try {
    const text = fs.readFileSync(INSTALLER, 'utf8');
    const i = text.indexOf("PAYLOAD_RT_B64='") + 16 + 200;
    const flipped = text.slice(0, i) + (text[i] === 'A' ? 'B' : 'A') + text.slice(i + 1);
    const p = path.join(e.home, 'tampered.sh');
    fs.writeFileSync(p, flipped);
    const before = snapshot(e.home);
    const r = run(e, [], { script: p });
    assert.equal(r.status, 1, r.all);
    assert.match(r.err, /E_PAYLOAD/);
    noChange(e, before);
  } finally { e.cleanup(); }
});

test('exclusive lock: a live holder blocks, a dead holder is cleaned up', async () => {
  const e = makeEnv({});
  try {
    fs.mkdirSync(path.join(e.manage, 'lock'), { recursive: true });
    const holder = spawn('sleep', ['30']);
    fs.writeFileSync(path.join(e.manage, 'lock/pid'), `${holder.pid}\n`);
    const before = snapshot(e.target);
    const r = run(e, []);
    holder.kill();
    assert.equal(r.status, 1, r.all);
    assert.match(r.err, /E_LOCK/);
    assert.deepEqual(snapshot(e.target), before);
    fs.writeFileSync(path.join(e.manage, 'lock/pid'), '999999\n');
    const r2 = run(e, []);
    assert.equal(r2.status, 0, r2.all);
    assert.match(r2.err, /古いロック/);
    assert.ok(!fs.existsSync(path.join(e.manage, 'lock')));
  } finally { e.cleanup(); }
});

test('two concurrent installers: exactly one proceeds, result is consistent', async () => {
  const e = makeEnv({ css: ORIG_CSS, js: ORIG_JS });
  try {
    const env = { HOME: e.home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: process.env.TMPDIR || '/tmp' };
    const go = () => new Promise((res) => { const c = spawn('/bin/bash', [INSTALLER], { env }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('close', (code) => res({ code, o })); });
    const [a, b] = await Promise.all([go(), go()]);
    assert.ok([a.code, b.code].includes(0), `${a.o}\n${b.o}`);
    const st = run(e, ['--status']);
    assert.equal(st.status, 0, st.all);
    const css = fs.readFileSync(path.join(e.target, 'user.css'), 'utf8');
    assert.equal(css.split('BEGIN FERDIUM-SLACKIFY MANAGED').length - 1, 1);
    assert.deepEqual(fs.readFileSync(path.join(e.target, '.fs-original-user.cjs')), Buffer.from(ORIG_JS));
  } finally { e.cleanup(); }
});

test('only the Google Chat recipe changes: every other file under Ferdium is byte-identical', async () => {
  const e = makeEnv({ css: ORIG_CSS, js: ORIG_JS });
  try {
    const skip = (rel) => rel.startsWith('recipes/hangoutschat/user.') || rel.startsWith('recipes/hangoutschat/.fs-');
    const before = snapshot(e.fer, { skip });
    assert.equal(run(e, []).status, 0);
    assert.deepEqual(snapshot(e.fer, { skip }), before);
    // recipe's own files untouched
    for (const f of ['webview.js', 'package.json', 'icon.svg']) assert.ok(fs.existsSync(path.join(e.target, f)));
    assert.equal(sha(fs.readFileSync(path.join(e.target, 'webview.js'))), sha(Buffer.from('// recipe webview\nmodule.exports = () => {};\n')));
    assert.equal(run(e, ['--uninstall']).status, 0);
    assert.deepEqual(snapshot(e.fer, { skip }), before);
  } finally { e.cleanup(); }
});

test('rollback/uninstall with nothing installed fail cleanly', async () => {
  const e = makeEnv({ css: ORIG_CSS });
  try {
    const before = snapshot(e.home);
    for (const a of ['--rollback', '--uninstall']) {
      const r = run(e, [a]);
      assert.equal(r.status, 1);
      assert.match(r.err, /E_NOT_INSTALLED/);
    }
    noChange(e, before);
    assert.equal(run(e, ['--bogus']).status, 2);
  } finally { e.cleanup(); }
});

test('recipe replaced by Ferdium (files gone): reinstall works and uninstall restores the new baseline', async () => {
  const e = makeEnv({ css: ORIG_CSS });
  try {
    assert.equal(run(e, []).status, 0);
    for (const f of ['user.css', 'user.js', '.fs-runtime.cjs']) fs.rmSync(path.join(e.target, f));
    assert.equal(run(e, ['--status']).status, 4);
    const r = run(e, []);
    assert.equal(r.status, 0, r.all);
    assert.equal(run(e, ['--status']).status, 0);
    stagingLeftovers(e.target);
  } finally { e.cleanup(); }
});
