# ferdium-gchat-slackify

A Slack/Mattermost-style skin for **Google Chat inside Ferdium (macOS)**, ported from
[gchat-slackify](https://github.com/sujeet100/gchat-slackify) v1.4.4 (MIT).

> **Status: not verified on a real Ferdium or the real Google Chat.** Everything was tested against a synthetic
> mock page only. Read [docs/LIMITATIONS.md](docs/LIMITATIONS.md) before installing.

## What it does

Flat messages (no bubbles), your own messages left-aligned with your avatar, full-width layout, aubergine sidebar/top bar,
compact density, sender names, date dividers, Slack-style thread links, reaction pills, code styling, flat composer,
light/dark following Google Chat. It is cosmetic only: no element is replaced, removed or re-parented, no event is
intercepted, nothing is sent over the network, and the unread-count DOM that Ferdium's Recipe reads
(`div[data-section-type="1|2"] div.TeR7uc`) is never touched.

## How it works

* **CSS**: upstream `config.js`/`themes.js`/`styles.js` are run once at build time (`node:vm`) to produce `dist/user.css`
  (every rule gated by `html[data-sf-on]`). The runtime never contains the CSS generator.
* **JS**: `dist/.fs-runtime.cjs` sets `data-sf-*` attributes on `<html>`, tags elements with `data-slackify="…"` (ported
  `tagger.js`), and watches DOM/theme changes through one coalesced idle-time queue.
* **Ferdium**: Ferdium injects `<recipe>/user.css` and `require()`s `<recipe>/user.js`. The installer places those (see below).
  Only a Google Chat recipe is modified: `id=hangouts` + `https://mail.google.com/chat/` (Ferdium's "Google Chat", the one found in the author's profile) or `id=hangoutschat` + `https://chat.google.com`. If both are installed the installer stops instead of choosing.
* Default theme **Aubergine**; `hidemeetings`, `dimmeetings`, `readablewidth` and `shortcuts` are off.

## Install (one paste)

1. Quit nothing; Ferdium may stay open.
2. Open `dist/install.sh` in a text editor, copy **the whole file**, paste into Terminal, press Return.
   (Or: `bash dist/install.sh`.)
3. In Ferdium, reload the Google Chat service (right-click its tab → *Reload Service*, or the View menu's reload).
4. If you do not see changes, check `bash "$HOME/Library/Application Support/Ferdium-Slackify/manage.sh" --status`.

The script contains the CSS and JS itself, downloads nothing, needs only macOS built-in tools, and stops with an
`ERROR[E_...]` message (changing nothing) if the recipe is missing, ambiguous, symlinked, not writable, or your files were
edited by hand. Preview first with `bash dist/install.sh --dry-run`.

### What gets written

In the recipe folder (found by scanning `~/Library/Application Support/Ferdium/recipes/*/package.json`, never hard-coded):

| File | Content |
|---|---|
| `user.css` | your existing CSS untouched + a block between `/* BEGIN FERDIUM-SLACKIFY MANAGED */` and `/* END … */` |
| `user.js` | a CommonJS wrapper: runs your previous `user.js` (if any) once, then the runtime |
| `.fs-runtime.cjs` | the runtime |
| `.fs-original-user.cjs` | byte-exact copy of your previous `user.js`, only if you had one |

Backups, the ledger and `manage.sh` live **outside** the recipe (survives recipe updates):
`~/Library/Application Support/Ferdium-Slackify/{backups,state,manage.sh}`. Backups are private (`chmod 700`) and never deleted.

### Manage / restore

```bash
M="$HOME/Library/Application Support/Ferdium-Slackify/manage.sh"
bash "$M" --status      # installed? any file modified or missing?
bash "$M" --dry-run     # preview (also: --dry-run --rollback / --dry-run --uninstall)
bash "$M" --rollback    # undo the last install/update
bash "$M" --uninstall   # remove everything managed; restore the original user.css/user.js
```

If installation fails midway, the installer restores the previous bytes automatically. Files you edited after installing
are never overwritten: the operation stops and lists them (an edited `user.css` can still be uninstalled by removing only
the managed block). Manual fallback: copy files from `…/backups/<id>/files/` back into the recipe folder.

### Updating

Download/build the new `dist/install.sh` and run it again: only the managed block and managed files are replaced; running
the same version twice is a no-op. After a Ferdium **recipe update**, re-run the installer if `--status` shows `MISSING`.
After a **Google Chat redesign**, the skin may look partly unstyled until selectors are updated.

## Development

Requires Node ≥ 20 and macOS (the installer tests use `plutil`, `shasum`, BSD `stat`/`sed`).

```bash
npm ci
npx playwright install chromium     # one-time; the visual tests FAIL (not skip) without a browser
npm run build      # dist/user.css, dist/user.js, dist/.fs-runtime.cjs
npm run check      # syntax, CommonJS contract, no chrome.* APIs, CSS<->tag consistency, gating
npm run lint
npm run test:unit  && npm run test:dom && npm run test:visual
npm run package    # dist/install.sh (self-contained)
npm run test:installer
npm run verify     # everything above, in order
npm run report     # runs the pipeline and rewrites docs/TEST_REPORT.md from the real results
```

Layout: `src/upstream` (pinned Slackify files, see [docs/UPSTREAM.md](docs/UPSTREAM.md)), `src/build`, `src/runtime`,
`src/ferdium/user-entry.cjs`, `installer/install.sh` (template), `test/{unit,dom,visual,installer,fixtures}`.

Composer layout diagnostic (read-only, reads no text): paste [docs/composer-diagnostic.js](docs/composer-diagnostic.js) into the service DevTools console.

Debugging in the service DevTools: `window[Symbol.for('ferdium-gchat-slackify.controller')].getStatus()`.

## Credits

Based on [gchat-slackify](https://github.com/sujeet100/gchat-slackify) (MIT); Ferdium ([ferdium-app](https://github.com/ferdium/ferdium-app), [ferdium-recipes](https://github.com/ferdium/ferdium-recipes)) was read for the recipe/`user.css`/`user.js` contract only.

## Workflow

This repo is the source of truth. Change code → `npm run verify && npm run package` → commit → push. Installing into the real Ferdium is a separate, manual step (`dist/install.sh`); nothing syncs automatically.

## Unverified

Real Ferdium behaviour, real Google Chat DOM match, Japanese UI strings, CSP handling of the embedded font — see
[docs/LIMITATIONS.md](docs/LIMITATIONS.md). Test evidence: [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## Licenses

This is a personal project published for reference; it is not maintained as an open-source project (no support, issues or PRs are expected). No license has been granted yet. Third-party notices that must be kept: gchat-slackify (MIT) and Lato (SIL OFL 1.1) — texts in [LICENSES/](LICENSES/).
