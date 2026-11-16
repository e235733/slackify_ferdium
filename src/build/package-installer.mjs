// Embeds dist/user.css, dist/user.js and dist/.fs-runtime.cjs into installer/install.sh and writes
// dist/install.sh: a paste-able, self-contained script (no network access at run time).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const wrap = (b64) => b64.replace(/(.{76})/g, '$1\n').replace(/\n$/, '');
const pack = (buf) => wrap(zlib.gzipSync(buf, { level: 9, mtime: 0 }).toString('base64'));

export function buildInstaller(overrides = {}) {
  const css = overrides.css || read('dist/user.css');
  const rt = overrides.rt || read('dist/.fs-runtime.cjs');
  const js = overrides.js || read('dist/user.js');
  const version = JSON.parse(read('package.json')).version;
  const payloadId = sha(Buffer.from(`${sha(css)}${sha(rt)}${sha(js)}`)).slice(0, 16);
  let tpl = read('installer/install.sh').toString('utf8');
  const subs = {
    VERSION: version, PAYLOAD_ID: payloadId, SHA_CSS: sha(css), SHA_RT: sha(rt), SHA_JS: sha(js),
    B64_CSS: pack(css), B64_RT: pack(rt), B64_JS: pack(js),
  };
  for (const [k, v] of Object.entries(subs)) tpl = tpl.split(`@@${k}@@`).join(v);
  if (/@@[A-Z0-9_]+@@/.test(tpl)) throw new Error('unreplaced placeholder in installer');
  if (tpl.includes('__FERDIUM_SLACKIFY_EOF__')) throw new Error('heredoc delimiter collision');
  // Paste-safe wrapper: the heredoc keeps this working when pasted into zsh (macOS default), and the
  // real script runs in a bash child so `set -e` can never close the user's terminal.
  const head = `/usr/bin/env bash -c 'f=$(mktemp "\${TMPDIR:-/tmp}/fs-slackify-run.XXXXXX") || exit 1; trap "rm -f \\"$f\\"" EXIT; cat >"$f" || exit 1; /bin/bash "$f" "$@"' fs-slackify "$@" <<'__FERDIUM_SLACKIFY_EOF__'\n`;
  const out = `${head}${tpl.replace(/\n?$/, '\n')}__FERDIUM_SLACKIFY_EOF__\n`;
  return { out, payloadId, sizes: { css: css.length, rt: rt.length, js: js.length, installer: Buffer.byteLength(out) } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { out, payloadId, sizes } = buildInstaller();
  fs.writeFileSync(path.join(root, 'dist/install.sh'), out, { mode: 0o755 });
  console.log(`dist/install.sh ${sizes.installer} bytes (payload ${payloadId})`);
}
