// Static validation shared by `npm run check` and test/unit/static.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

export function listFiles(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(rel, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

export function cssRules() {
  const ast = postcss.parse(read('dist/user.css'));
  const rules = [];
  ast.walkRules((r) => {
    if (r.parent && r.parent.type === 'atrule' && /keyframes$/i.test(r.parent.name)) return;
    rules.push(r);
  });
  return rules;
}

const results = [];
const check = (name, fn) => {
  try { const detail = fn(); results.push({ name, ok: true, detail }); } catch (e) { results.push({ name, ok: false, detail: e.message }); }
};

export function runStaticChecks() {
  results.length = 0;

  check('css parses', () => { postcss.parse(read('dist/user.css')); });

  check('commonjs contract: dist/user.js exports a function', () => {
    const m = require(path.join(root, 'dist/user.js'));
    if (typeof m !== 'function') throw new Error(`user.js exports ${typeof m}`);
  });
  check('commonjs contract: dist/.fs-runtime.cjs exports a function', () => {
    const m = require(path.join(root, 'dist/.fs-runtime.cjs'));
    if (typeof m !== 'function' || typeof m.boot !== 'function') throw new Error('runtime export shape wrong');
  });

  check('no Chrome-extension-only APIs in runtime/dist', () => {
    const bad = [];
    const files = [...listFiles('src/runtime', ['.js', '.cjs']), ...listFiles('src/ferdium', ['.cjs']), 'dist/user.js', 'dist/.fs-runtime.cjs'];
    for (const f of files) {
      const m = /\bchrome\s*\.\s*(storage|runtime|tabs|extension|action|scripting)\b|\bbrowser\s*\.\s*(storage|runtime)\b/.exec(read(f));
      if (m) bad.push(`${f}: ${m[0]}`);
    }
    if (bad.length) throw new Error(bad.join('; '));
  });

  check('no network or remote-code primitives in runtime/dist', () => {
    const bad = [];
    const files = [...listFiles('src/runtime', ['.js', '.cjs']), ...listFiles('src/ferdium', ['.cjs'])];
    for (const f of files) {
      const m = /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|importScripts|eval|child_process|https?\.request)\b\s*[(.]?/.exec(read(f).replace(/\/\/.*$/gm, ''));
      if (m) bad.push(`${f}: ${m[0]}`);
    }
    if (bad.length) throw new Error(bad.join('; '));
  });

  check('no innerHTML/outerHTML/insertAdjacentHTML writes in runtime', () => {
    for (const f of listFiles('src/runtime', ['.js'])) {
      if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(read(f))) throw new Error(f);
    }
  });

  check('every css rule is gated by html[data-sf-on] (or is a theme/mode/font variable block)', () => {
    const allowed = [/^html\[data-sf-on\]/, /^html\[data-sf-theme="[^"]+"\]\[data-sf-mode="(light|dark)"\]$/, /^html\[data-sf-mode="(light|dark)"\]$/, /^:root$/];
    const bad = [];
    for (const r of cssRules()) {
      for (const s of r.selectors) {
        if (!allowed.some((re) => re.test(s.trim()))) bad.push(s.trim().slice(0, 80));
      }
      if (r.selectors.some((s) => /^(html\[data-sf-theme|html\[data-sf-mode|:root)/.test(s.trim()))) {
        const nonVar = [];
        r.walkDecls((d) => { if (!d.prop.startsWith('--')) nonVar.push(d.prop); });
        if (nonVar.length) bad.push(`non-variable declarations in ungated rule: ${r.selector.slice(0, 60)}`);
      }
    }
    if (bad.length) throw new Error(`${bad.length} ungated: ${bad.slice(0, 3).join(' | ')}`);
  });

  check('css data-slackify tags are all produced by the tagger', () => {
    const css = read('dist/user.css');
    const meta = JSON.parse(read('src/runtime/upstream-meta.generated.json'));
    const tagValues = new Set(Object.values(meta.TAGS).map((v) => (/data-slackify="([^"]+)"/.exec(v) || [])[1]).filter(Boolean));
    const used = new Set([...css.matchAll(/\[data-slackify="([^"]+)"\]/g)].map((m) => m[1]));
    const tagger = read('src/runtime/tagger.js');
    const written = new Set([...tagger.matchAll(/setTag\([^,()]+(?:\([^()]*\))?[^,()]*,\s*'([a-z-]+)'\)/g)].map((m) => m[1]));
    // 'lightbtn' belongs to the Chrome popup; no runtime tag is intentionally produced for it.
    const missing = [...used].filter((t) => !written.has(t) && t !== 'lightbtn');
    const unknown = [...written].filter((t) => !tagValues.has(t));
    if (missing.length) throw new Error(`css uses tags the tagger never sets: ${missing.join(', ')}`);
    if (unknown.length) throw new Error(`tagger sets tags unknown to config: ${unknown.join(', ')}`);
    return `${used.size} css tags matched`;
  });

  check('priority tags exist in css and tagger', () => {
    const css = read('dist/user.css');
    const tagger = read('src/runtime/tagger.js');
    const prio = ['rail', 'bubble', 'msgrow', 'self-row', 'self-meta', 'stream', 'composer', 'composer-wrap', 'date', 'datewrap', 'avatar-wrap', 'reaction-pill', 'thread-chip', 'reply-count', 'spacename', 'convo-title'];
    // Upstream styles.js never selects reaction-pill directly (it styles the "reactions" strip); the
    // tag is still set because it is part of the required tag set and is used as a dedupe marker.
    const cssOptional = new Set(['reaction-pill']);
    const miss = prio.filter((t) => (!cssOptional.has(t) && !css.includes(`[data-slackify="${t}"]`)) || !tagger.includes(`'${t}'`));
    if (miss.length) throw new Error(miss.join(', '));
  });

  check('css never touches the Recipe notification DOM', () => {
    const css = read('dist/user.css');
    if (/TeR7uc|data-section-type|data-shortcut-type/.test(css)) throw new Error('forbidden selector found');
  });

  check('display:none appears only in expected, tag-scoped or default-off rules', () => {
    const bad = [];
    for (const r of cssRules()) {
      let hidden = false;
      r.walkDecls('display', (d) => { if (/^none/.test(d.value)) hidden = true; });
      if (!hidden) continue;
      const ok = r.selectors.every((s) => /data-slackify="(thread-curl|unread-line)"|::before|data-sf-feat-hidemeetings/.test(s));
      if (!ok) bad.push(r.selector.slice(0, 100));
    }
    if (bad.length) throw new Error(bad.join(' | '));
  });

  check('font license material present', () => {
    for (const f of ['LICENSES/OFL-Lato.txt', 'LICENSES/Slackify-MIT.txt']) if (!fs.existsSync(path.join(root, f))) throw new Error(`missing ${f}`);
  });

  return results.slice();
}
