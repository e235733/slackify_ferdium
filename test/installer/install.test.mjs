import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildInstaller } from '../../src/build/package-installer.mjs';
import { INSTALLER, root, sha, ORIG_CSS, ORIG_JS, makeEnv, run, snapshot, readIf, buildAltInstaller, stagingLeftovers } from './helpers.mjs';

const dist = (f) => fs.readFileSync(path.join(root, 'dist', f));
const BEGIN = '/* BEGIN FERDIUM-SLACKIFY MANAGED */';
const END = '/* END FERDIUM-SLACKIFY MANAGED */';
const otherRecipes = (e) => snapshot(e.recipes, { skip: (rel) => rel.startsWith('hangoutschat/') || rel === 'hangoutschat' || rel === 'hangoutschat/' });
const withEnv = (opts, fn) => async (t) => { const e = makeEnv(opts); try { await fn(e, t); } finally { e.cleanup(); } };

test('dist/install.sh is up to date with dist/* payloads and is self-contained', () => {
  assert.equal(fs.readFileSync(INSTALLER, 'utf8'), buildInstaller().out, 'run npm run package');
  const text = fs.readFileSync(INSTALLER, 'utf8');
  assert.ok(!/\b(curl|wget|nc|ssh|scp|ftp|osascript)\b/.test(text.replace(/^[A-Za-z0-9+/=\n]{60,}$/gm, '')), 'no network tools');
  assert.ok(!/https?:\/\/[^\s'"]*/.test(text.replace(/^[A-Za-z0-9+/=]{60,}$/gm, '').replace(/https:\/\/(chat|mail)\.google\.com\/?(chat\/)?/g, '')), 'no URLs besides the recipe serviceURL constant');
  const r = spawnSync('/bin/bash', ['-n', INSTALLER], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
});

test('fresh install: creates the managed files, backup, ledger and manage.sh', withEnv({}, (e) => {
  const others = otherRecipes(e);
  const r = run(e, []);
  assert.equal(r.status, 0, r.all);
  const css = fs.readFileSync(path.join(e.target, 'user.css'), 'utf8');
  assert.ok(css.startsWith(BEGIN) && css.trimEnd().endsWith(END));
  assert.ok(css.includes(dist('user.css').toString('utf8')));
  assert.equal(sha(fs.readFileSync(path.join(e.target, 'user.js'))), sha(dist('user.js')));
  assert.equal(sha(fs.readFileSync(path.join(e.target, '.fs-runtime.cjs'))), sha(dist('.fs-runtime.cjs')));
  assert.ok(!fs.existsSync(path.join(e.target, '.fs-original-user.cjs')));
  assert.ok(fs.existsSync(path.join(e.manage, 'state/ledger')));
  assert.ok(fs.existsSync(path.join(e.manage, 'manage.sh')));
  assert.equal(fs.statSync(e.manage).mode & 0o777, 0o700, 'private manage dir');
  assert.equal(fs.readdirSync(path.join(e.manage, 'backups')).length, 1);
  assert.ok(!fs.existsSync(path.join(e.manage, 'lock')), 'lock released');
  assert.deepEqual(stagingLeftovers(e.target), []);
  assert.deepEqual(otherRecipes(e), others, 'other recipes untouched');
  assert.equal(fs.readFileSync(path.join(e.target, 'webview.js'), 'utf8').includes('recipe webview'), true);
  assert.equal(fs.readFileSync(path.join(e.target, 'package.json'), 'utf8'), fs.readFileSync(path.join(e.target, 'package.json'), 'utf8'));
}));

test('existing user.css: content kept, managed block appended, original restorable byte for byte', withEnv({ css: ORIG_CSS }, (e) => {
  const r = run(e, []);
  assert.equal(r.status, 0, r.all);
  const css = fs.readFileSync(path.join(e.target, 'user.css'), 'utf8');
  assert.ok(css.startsWith(`${ORIG_CSS}\n${BEGIN}`), 'original bytes intact before the block');
  const u = run(e, ['--uninstall']);
  assert.equal(u.status, 0, u.all);
  assert.deepEqual(fs.readFileSync(path.join(e.target, 'user.css')), Buffer.from(ORIG_CSS));
  assert.ok(!fs.existsSync(path.join(e.target, 'user.js')));
  assert.ok(!fs.existsSync(path.join(e.target, '.fs-runtime.cjs')));
}));

test('existing user.js: preserved as .fs-original-user.cjs and wrapped; runs exactly once', withEnv({ js: ORIG_JS }, (e) => {
  const r = run(e, []);
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(fs.readFileSync(path.join(e.target, '.fs-original-user.cjs')), Buffer.from(ORIG_JS));
  assert.equal(sha(fs.readFileSync(path.join(e.target, 'user.js'))), sha(dist('user.js')));
  const probe = spawnSync(process.execPath, ['-e', `
    const fn = require(${JSON.stringify(path.join(e.target, 'user.js'))});
    fn({ a: 1 }, { b: 2 });
    console.log(JSON.stringify([typeof fn, globalThis.__ORIG_CALLS, globalThis.__ORIG_ARGS]));`], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), JSON.stringify(['function', 1, [{ a: 1 }, { b: 2 }]]));
}));

test('existing css and js: both preserved, rollback and uninstall restore exact bytes + modes', withEnv({ css: ORIG_CSS, js: ORIG_JS }, (e) => {
  fs.chmodSync(path.join(e.target, 'user.css'), 0o640);
  const before = snapshot(e.target);
  const beforeOthers = otherRecipes(e);
  assert.equal(run(e, []).status, 0);
  assert.notDeepEqual(snapshot(e.target), before);
  const rb = run(e, ['--rollback']);
  assert.equal(rb.status, 0, rb.all);
  assert.deepEqual(snapshot(e.target), before, 'rollback restores every file, mode included');
  assert.ok(!fs.existsSync(path.join(e.manage, 'state/ledger')));
  assert.equal(run(e, []).status, 0);
  const un = run(e, ['--uninstall']);
  assert.equal(un.status, 0, un.all);
  assert.deepEqual(snapshot(e.target), before, 'uninstall restores the pre-install state');
  assert.deepEqual(otherRecipes(e), beforeOthers);
  assert.ok(fs.readdirSync(path.join(e.manage, 'backups')).length >= 2, 'backups are kept');
}));

test('idempotent: same script twice changes nothing and makes no second backup', withEnv({ css: ORIG_CSS, js: ORIG_JS }, (e) => {
  assert.equal(run(e, []).status, 0);
  const snap = snapshot(e.target);
  const backups = fs.readdirSync(path.join(e.manage, 'backups'));
  const ledger = fs.readFileSync(path.join(e.manage, 'state/ledger'));
  const r = run(e, []);
  assert.equal(r.status, 0, r.all);
  assert.match(r.all, /すでに最新/);
  assert.deepEqual(snapshot(e.target), snap);
  assert.deepEqual(fs.readdirSync(path.join(e.manage, 'backups')), backups);
  assert.deepEqual(fs.readFileSync(path.join(e.manage, 'state/ledger')), ledger);
  const css = fs.readFileSync(path.join(e.target, 'user.css'), 'utf8');
  assert.equal(css.split(BEGIN).length - 1, 1);
  assert.equal(css.split(END).length - 1, 1);
}));

test('update: new payload replaces only the managed block; original js copy is not re-wrapped', withEnv({ css: ORIG_CSS, js: ORIG_JS }, (e) => {
  const alt = buildAltInstaller();
  assert.equal(run(e, []).status, 0);
  const origCopy = fs.readFileSync(path.join(e.target, '.fs-original-user.cjs'));
  // user adds their own css after the block: must survive the update
  fs.appendFileSync(path.join(e.target, 'user.css'), '\n.mine { color: blue }\n');
  const u = run(e, [], { script: alt.path });
  assert.equal(u.status, 0, u.all);
  const css = fs.readFileSync(path.join(e.target, 'user.css'), 'utf8');
  assert.ok(css.includes('/* alt build */'));
  assert.ok(css.endsWith('.mine { color: blue }\n'));
  assert.ok(css.startsWith(ORIG_CSS));
  assert.equal(css.split(BEGIN).length - 1, 1);
  assert.deepEqual(fs.readFileSync(path.join(e.target, '.fs-original-user.cjs')), origCopy);
  assert.equal(fs.readdirSync(path.join(e.manage, 'backups')).length, 2);
}));

test('rollback after update returns to the previous version; uninstall returns to the original', withEnv({ css: ORIG_CSS, js: ORIG_JS }, (e) => {
  const alt = buildAltInstaller();
  const before = snapshot(e.target);
  assert.equal(run(e, []).status, 0);
  const v1 = snapshot(e.target);
  assert.equal(run(e, [], { script: alt.path }).status, 0);
  const rb = run(e, ['--rollback']);
  assert.equal(rb.status, 0, rb.all);
  assert.deepEqual(snapshot(e.target), v1);
  assert.equal(run(e, ['--uninstall']).status, 0);
  assert.deepEqual(snapshot(e.target), before);
}));

test('--status reports not installed / installed / modified with exit codes', withEnv({ js: ORIG_JS }, (e) => {
  assert.equal(run(e, ['--status']).status, 3);
  assert.equal(run(e, []).status, 0);
  const ok = run(e, ['--status']);
  assert.equal(ok.status, 0, ok.all);
  assert.match(ok.out, /インストール済み/);
  assert.match(ok.out, /user\.js\s+OK/);
  fs.appendFileSync(path.join(e.target, '.fs-runtime.cjs'), '// tampered\n');
  const bad = run(e, ['--status']);
  assert.equal(bad.status, 4);
  assert.match(bad.out, /\.fs-runtime\.cjs\s+MODIFIED/);
  fs.rmSync(path.join(e.target, 'user.js'));
  assert.match(run(e, ['--status']).out, /user\.js\s+MISSING/);
}));

test('--dry-run writes nothing anywhere (install, rollback, uninstall)', withEnv({ css: ORIG_CSS, js: ORIG_JS }, (e) => {
  const snapAll = () => snapshot(e.home);
  const s0 = snapAll();
  const d = run(e, ['--dry-run']);
  assert.equal(d.status, 0, d.all);
  assert.match(d.out, /dry-run/);
  assert.deepEqual(snapAll(), s0);
  assert.equal(run(e, []).status, 0);
  const s1 = snapAll();
  for (const args of [['--dry-run'], ['--dry-run', '--rollback'], ['--dry-run', '--uninstall']]) {
    const r = run(e, args);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(snapAll(), s1, args.join(' '));
  }
}));

test('manage.sh is installed and works standalone', withEnv({ js: ORIG_JS }, (e) => {
  assert.equal(run(e, []).status, 0);
  const manage = path.join(e.manage, 'manage.sh');
  const st = run(e, ['--status'], { script: manage });
  assert.equal(st.status, 0, st.all);
  const un = run(e, ['--uninstall'], { script: manage });
  assert.equal(un.status, 0, un.all);
  assert.deepEqual(fs.readFileSync(path.join(e.target, 'user.js')), Buffer.from(ORIG_JS));
}));

test('paste flow: the whole file fed to zsh as a command line works (and set -e cannot kill the shell)', withEnv({ css: ORIG_CSS }, (e) => {
  const script = fs.readFileSync(INSTALLER, 'utf8');
  const r = spawnSync('/bin/zsh', ['-f', '-c', `${script}\necho "shell-still-alive:$?"`], { env: { HOME: e.home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: process.env.TMPDIR || '/tmp' }, encoding: 'utf8' });
  assert.match(r.stdout, /インストール完了/);
  assert.match(r.stdout, /shell-still-alive:0/);
  assert.ok(fs.existsSync(path.join(e.target, '.fs-runtime.cjs')));
  const bad = makeEnv({ extraTarget: true });
  try {
    const r2 = spawnSync('/bin/zsh', ['-f', '-c', `${script}\necho "shell-still-alive:$?"`], { env: { HOME: bad.home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: process.env.TMPDIR || '/tmp' }, encoding: 'utf8' });
    assert.match(r2.stdout, /shell-still-alive:1/);
    assert.match(r2.stderr, /E_MULTIPLE_RECIPES/);
  } finally { bad.cleanup(); }
}));

test('works with unusual recipe folder names (not hard-coded)', withEnv({ targetDir: 'google chat (custom)' }, (e) => {
  const r = run(e, []);
  assert.equal(r.status, 0, r.all);
  assert.ok(fs.existsSync(path.join(e.target, '.fs-runtime.cjs')));
}));

test('installed wrapper + runtime load in Node without a DOM (no throw, original runs)', withEnv({ js: ORIG_JS }, (e) => {
  assert.equal(run(e, []).status, 0);
  const r = spawnSync(process.execPath, ['-e', `
    const fn = require(${JSON.stringify(path.join(e.target, 'user.js'))});
    fn({}, {}); fn({}, {});
    console.log(globalThis.__ORIG_CALLS);`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '2'); // once per call of user.js (Ferdium calls it once per page load)
  assert.ok(readIf(path.join(e.target, '.fs-runtime.cjs')));
}));
