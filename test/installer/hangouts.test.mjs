// Regression: a real Ferdium profile has the Google Chat recipe as id "hangouts"
// (serviceURL https://mail.google.com/chat/), with no "hangoutschat" folder at all. The first installer only
// accepted id "hangoutschat" and failed with E_NO_RECIPE.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv, run, snapshot, RECIPE_PKG, HANGOUTS_PKG } from './helpers.mjs';

const REAL_USER_CSS = '/* Google Chatのヘッダーをフラットに */\nheader[role="banner"] {\n  box-shadow: none !important;\n}\n\n[role="main"] {\n  font-family: Inter, Arial, sans-serif !important;\n}\n';
const withEnv = (opts, fn) => async () => { const e = makeEnv({ layout: 'hangouts', ...opts }); try { await fn(e); } finally { e.cleanup(); } };

test('layout reproduces the real profile: no hangoutschat folder exists', withEnv({}, (e) => {
  assert.ok(!fs.existsSync(path.join(e.recipes, 'hangoutschat')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(e.target, 'package.json'), 'utf8')).id, 'hangouts');
  assert.equal(path.basename(e.target), 'hangouts');
}));

test('installs into recipes/hangouts, preserving the existing user.css byte for byte', withEnv({ css: REAL_USER_CSS }, (e) => {
  const others = snapshot(e.recipes, { skip: (rel) => rel.startsWith('hangouts') });
  const r = run(e, []);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /hangouts/);
  const css = fs.readFileSync(path.join(e.target, 'user.css'), 'utf8');
  assert.ok(css.startsWith(REAL_USER_CSS));
  assert.ok(css.includes('BEGIN FERDIUM-SLACKIFY MANAGED'));
  assert.ok(fs.existsSync(path.join(e.target, 'user.js')) && fs.existsSync(path.join(e.target, '.fs-runtime.cjs')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(e.target, 'package.json'), 'utf8')).id, 'hangouts');
  assert.equal(fs.readFileSync(path.join(e.target, 'package.json'), 'utf8'), HANGOUTS_PKG, 'recipe metadata untouched');
  assert.deepEqual(snapshot(e.recipes, { skip: (rel) => rel.startsWith('hangouts') }), others, 'other recipes untouched');
  assert.equal(run(e, ['--status']).status, 0);
  assert.equal(run(e, []).status, 0, 'idempotent');
  assert.equal(run(e, ['--uninstall']).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(e.target, 'user.css'), 'utf8'), REAL_USER_CSS);
  assert.ok(!fs.existsSync(path.join(e.target, 'user.js')));
}));

test('hangouts + hangoutschat both installed: stops, no guessing', withEnv({ extraTarget: true, css: REAL_USER_CSS }, (e) => {
  const before = snapshot(e.home);
  const r = run(e, []);
  assert.equal(r.status, 1);
  assert.match(r.err, /E_MULTIPLE_RECIPES/);
  assert.deepEqual(snapshot(e.home), before);
}));

test('id hangouts with an unexpected serviceURL is not a target', withEnv({}, (e) => {
  fs.writeFileSync(path.join(e.target, 'package.json'), HANGOUTS_PKG.replace('https://mail.google.com/chat/', 'https://example.invalid/'));
  const before = snapshot(e.home);
  const r = run(e, []);
  assert.match(r.err, /E_NO_RECIPE/);
  assert.deepEqual(snapshot(e.home), before);
}));

test('pairs are not mixed: hangoutschat id with the hangouts URL is rejected', withEnv({}, (e) => {
  fs.writeFileSync(path.join(e.target, 'package.json'), RECIPE_PKG.replace('https://chat.google.com', 'https://mail.google.com/chat/'));
  assert.match(run(e, []).err, /E_NO_RECIPE/);
}));

test('the error message names accepted recipes and what exists', async () => {
  const e = makeEnv({ layout: 'hangouts' });
  try {
    fs.rmSync(path.join(e.target, 'webview.js'));
    const r = run(e, []);
    assert.match(r.err, /id=hangouts \+ https:\/\/mail\.google\.com\/chat\//);
    assert.match(r.err, /slack/);
  } finally { e.cleanup(); }
});

test('rollback/uninstall refuse when the recorded folder no longer holds a Google Chat recipe', withEnv({ css: REAL_USER_CSS }, (e) => {
  assert.equal(run(e, []).status, 0);
  fs.writeFileSync(path.join(e.target, 'package.json'), '{"id":"slack","config":{"serviceURL":"https://x"}}');
  const before = snapshot(e.home);
  assert.match(run(e, ['--uninstall']).err, /E_RECIPE_MISMATCH/);
  assert.deepEqual(snapshot(e.home), before);
}));
