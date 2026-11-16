import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInstaller } from '../../src/build/package-installer.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const INSTALLER = path.join(root, 'dist/install.sh');
export const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export const ORIG_CSS = '/* user css */\r\nbody { color: red }'; // CRLF, no trailing newline
export const ORIG_JS = 'module.exports = function (config, userscript) { globalThis.__ORIG_CALLS = (globalThis.__ORIG_CALLS || 0) + 1; globalThis.__ORIG_ARGS = [config, userscript]; };\n';

export const RECIPE_PKG = JSON.stringify({ id: 'hangoutschat', name: 'Hangouts Chat', version: '1.8.4', aliases: ['google-chat', 'gChat'], config: { serviceURL: 'https://chat.google.com', hasNotificationSound: true, hasIndirectMessages: true } }, null, 2);

export function mkdtemp(prefix = 'fs-inst-') { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); }

/** A fake HOME with a Ferdium profile: the target recipe, a decoy recipe with the same id but another URL, and others. */
// Exact metadata of the Google Chat recipe found in a real Ferdium profile (id "hangouts").
export const HANGOUTS_PKG = JSON.stringify({ id: 'hangouts', name: 'Google Chat', version: '1.5.3', license: 'MIT', config: { serviceURL: 'https://mail.google.com/chat/', hasNotificationSound: true }, defaultIcon: 'https://cdn.jsdelivr.net/gh/ferdium/ferdium-recipes@main/recipes/hangouts/icon.svg' }, null, 2);

export function makeEnv({ css, js, extraTarget = false, targetDir = 'hangoutschat', layout = 'hangoutschat' } = {}) {
  const home = mkdtemp();
  const fer = path.join(home, 'Library/Application Support/Ferdium');
  const recipes = path.join(fer, 'recipes');
  const mk = (name, pkg, files = {}) => {
    const d = path.join(recipes, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg));
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, f), c);
    return d;
  };
  const isHangouts = layout === 'hangouts';
  if (isHangouts) targetDir = 'hangouts';
  const target = mk(targetDir, isHangouts ? HANGOUTS_PKG : RECIPE_PKG, { 'webview.js': '// recipe webview\nmodule.exports = () => {};\n', 'icon.svg': '<svg/>' });
  if (css !== undefined) fs.writeFileSync(path.join(target, 'user.css'), css);
  if (js !== undefined) fs.writeFileSync(path.join(target, 'user.js'), js);
  mk('slack', { id: 'slack', config: { serviceURL: 'https://{teamId}.slack.com' } }, { 'webview.js': 'x', 'user.css': '.slack{}', 'user.js': 'module.exports=()=>{}' });
  mk('gmail', { id: 'gmail', config: { serviceURL: 'https://mail.google.com' } }, { 'webview.js': 'x' });
  if (isHangouts) { mk('temp', '{}'); fs.rmSync(path.join(recipes, 'temp/package.json')); }
  if (!isHangouts) mk('other-chat-decoy', { id: 'hangoutschat', config: { serviceURL: 'https://example.invalid' } }, { 'webview.js': 'x', 'user.css': '.decoy{}' });
  mk('no-webview', { id: 'whatever', config: { serviceURL: 'https://x.invalid' } });
  if (extraTarget) mk(isHangouts ? 'hangoutschat' : 'hangoutschat-copy', isHangouts ? RECIPE_PKG : RECIPE_PKG, { 'webview.js': 'x' });
  return { home, fer, recipes, target, manage: path.join(home, 'Library/Application Support/Ferdium-Slackify'), cleanup() { try { fs.chmodSync(target, 0o755); } catch { /* removed by the test */ } fs.rmSync(home, { recursive: true, force: true }); } };
}

export function run(env, args = [], { script = INSTALLER, path: pathPrefix, extraEnv = {} } = {}) {
  const r = spawnSync('/bin/bash', [script, ...args], {
    env: { HOME: env.home, PATH: `${pathPrefix ? `${pathPrefix}:` : ''}/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8', ...extraEnv },
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

export function snapshot(dir, { skip = () => false } = {}) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (skip(rel)) continue;
      if (e.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p); } else if (e.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(p)}`;
      else out[rel] = `${sha(fs.readFileSync(p))}:${(fs.statSync(p).mode & 0o777).toString(8)}`;
    }
  };
  walk(dir);
  return out;
}

export const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);

/** A PATH shim that makes the Nth `mv` call fail (once). */
export function mvShim(failAt) {
  const dir = mkdtemp('fs-shim-');
  const counter = path.join(dir, 'count');
  fs.writeFileSync(counter, '0');
  fs.writeFileSync(path.join(dir, 'mv'), `#!/bin/bash\nn=$(cat "${counter}"); n=$((n+1)); echo $n > "${counter}"\nif [ "$n" = "${failAt}" ]; then echo "mv shim: injected failure" >&2; exit 1; fi\nexec /bin/mv "$@"\n`, { mode: 0o755 });
  return { dir, count: () => +fs.readFileSync(counter, 'utf8') };
}

/** Build a second installer whose payload differs (to test updates). */
export function buildAltInstaller() {
  const dir = mkdtemp('fs-alt-');
  const css = Buffer.from(`${fs.readFileSync(path.join(root, 'dist/user.css'), 'utf8')}\n/* alt build */\n`);
  const { out } = buildInstaller({ css });
  const p = path.join(dir, 'install-alt.sh');
  fs.writeFileSync(p, out, { mode: 0o755 });
  return { path: p, css, dir };
}

export const stagingLeftovers = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('.fs-tmp') || f.startsWith('.fs-probe'));
