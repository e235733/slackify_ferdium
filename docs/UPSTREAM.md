# Upstream sources

Recorded on 2026-10-24 by cloning each repository at depth 1. Machine-readable copy with file hashes:
[`src/upstream/pins.json`](../src/upstream/pins.json) (verified by `test/unit/build.test.mjs`).

| Repository | Branch | Commit SHA (40 hex) | Commit date | License |
|---|---|---|---|---|
| https://github.com/sujeet100/gchat-slackify | main | `89fef5c139e5c167bdc5457c9121a8a9d35d2a0a` | 2026-07-16T00:32:01+05:30 (v1.4.4) | MIT |
| https://github.com/ferdium/ferdium-app | develop | `deabf8308f37cde7d9baba5729f90d885fab3341` | 2026-10-23T09:34:40Z | (reference only, nothing copied) |
| https://github.com/ferdium/ferdium-recipes | main | `d606edecc575a08a22f05d8f6113e8906e3d1012` | 2026-10-23T10:03:39+01:00 | (reference only, nothing copied) |

Upstream `manifest.json`/`package.json` both report version **1.4.4**, matching the version the task description
confirmed, so no structural re-evaluation was needed. The source structure (`SLACKIFY_CONFIG` / `SLACKIFY_THEMES` /
`SLACKIFY_STYLES.buildCSS()` globals, `data-slackify` tagging) matched the description.

## Slackify files used

| File | Use | Notes |
|---|---|---|
| `src/config.js` | **Verbatim**, evaluated at build time | selectors, `TAGS`, `FEATURES`; the runtime embeds the selector/tag/feature tables via `upstream-meta.generated.json` |
| `src/themes.js` | **Verbatim**, build time | theme variable blocks (Aubergine is the default) |
| `src/styles.js` | **Verbatim**, build time | `buildCSS()` + `mk()` produce `dist/user.css` inside a `node:vm` context |
| `src/tagger.js` | Kept as `src/upstream/tagger.reference.js` (not executed); **ported** to `src/runtime/tagger.js` | see below |
| `src/apply.js` | Kept as `apply.reference.js` (not executed); `detectMode()` ported to `src/runtime/theme.js`, rest re-implemented | |
| `fonts/lato-{400,700,900}.woff2` | Embedded as data URIs in `dist/user.css` | SIL OFL 1.1, read from the fonts' own name tables; see `LICENSES/OFL-Lato.txt` |
| `LICENSE` | `src/upstream/LICENSE`, `LICENSES/Slackify-MIT.txt` | MIT |
| `manifest.json`, `package.json` | Read only | load order / tooling |
| `controls.js`, `shortcuts.js`, `popup/` | **Not used** | popup UI and keyboard shortcuts are out of scope |

## Changes in `src/runtime/tagger.js` relative to upstream `tagger.js`

Ported unchanged in logic: `tagRail`, `tagActiveRow`, `tagSpaceHeader`, `tagStream`, `scanDividers`, `scanThreadReplies`,
`scanReactionPills`, `tagStatusChip`, `tagComposer`, `highestRightAlignedAncestor`, `scanTopic` (bubble / self-row /
self-meta / avatar-wrap / msgrow / wide), `scanAvatars`, `scanSpaceNames`, `ensureSelfAvatar` (steps 1 and 2), `scanDates`.

Changed or removed:

* **Chrome-only code removed:** `chrome.storage` avatar cache (`cacheSelfAvatar`, `pullCachedAvatar`, `storage.onChanged`).
  The Gmail-embedded-frame fallback is not applicable to Ferdium.
* **Structure:** module-level IIFE state became per-instance state inside `createTagger()`, so `destroy()` and re-boot are
  clean. The page-level `MutationObserver` and `requestIdleCallback` scheduling moved to `scheduler.js`
  (single coalesced queue, timeout fallback with an 8 ms budget instead of a fixed 8 ms `timeRemaining`).
* **`IntersectionObserver` fallback:** when unavailable, the newest 60 topics are queued instead of observing every topic.
* **Japanese day labels (`isDateLabel`):** upstream matched only English `Today`/`Yesterday`/`<Weekday>, `. Added exact
  `今日`/`昨日` and `<曜日>, ...`/`<曜日>、...`. The locale-independent `data-format="3"` timestamp path in `scanDividers` is
  unchanged and remains the primary mechanism.
* **False-positive guard:** text-based day-label matching (`scanDates`, `scanTopic`) skips anything inside a
  `[data-message-id]` container, so a message whose whole text is `Today` or `今日` is never styled as a divider.
* **Thread-reply count:** besides English `N replies`/`N unread`, also `N件の返信`/`返信N件`/`N件の未読`. These Japanese forms are an
  untested guess (see `docs/LIMITATIONS.md`); if they do not match nothing is tagged.
* **Tag writes** go through `setTag()`, which rejects any tag name that is not in upstream `TAGS` (checked by a static test).
* **Self identity (`applyIdentity`)** replaces `ensureSelfAvatar`: no latching, no document-wide `selfMessageAuthor` lookup, no
  banner `img[src*=googleusercontent]` fallback; neutral label when unsure. Detached topics are never scanned.
* **`destroy()`** removes every attribute/custom property the tagger added.

## Ferdium contract (verified from source, not changed)

* `src/webview/recipe.ts` `loadUserFiles()`: reads `<recipe.path>/user.css` into a `<style>` appended to `<head>`
  (`textContent`), and `require()`s `<recipe.path>/user.js`; if the export is a function it is called as
  `(config, userscript)`, after `DOMContentLoaded` when the document is still loading.
* `src/webview/lib/Userscript.ts`: the `userscript` object (badge/dialog helpers); not used by this project.
* `recipes/hangoutschat/package.json`: `id: "hangoutschat"`, `aliases: ["google-chat", "gChat"]`,
  `config.serviceURL: "https://chat.google.com"`.
* `recipes/hangoutschat/webview.js` reads unread counts from `div[data-section-type="1"] div.TeR7uc` and
  `...="2"...`; this project never styles or edits those nodes (static + DOM + browser tests).
* `recipes/hangoutschat/service.css`: **does not exist** in the recipe directory at this commit (the files are `icon.svg`,
  `index.js`, `package.json`, `webview.js`), although `webview.js` calls `injectCSS(.../service.css)`.
