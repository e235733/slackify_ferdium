# Limitations and unverified items

Read this before relying on the skin.

1. **Not verified on a real Ferdium.** Ferdium was never launched. The `user.css` / `user.js` contract was read from
   Ferdium's source (`src/webview/recipe.ts`) and tested against Node `require()` and a headless Chromium, nothing more.
2. **Not verified against the real Google Chat DOM.** Google Chat was never contacted, and no real conversation or
   account was used. All selectors and detection heuristics come from Slackify v1.4.4's assumptions; the tests run on a
   synthetic fixture (`test/fixtures/chat-fixture.mjs`) that was written from those assumptions.
3. **Passing mock-DOM tests is not proof of production compatibility.** The jsdom and Playwright suites show the code does
   what it was designed to do on the fixture; they cannot show the fixture resembles the real page.
4. **Google Chat updates can break selectors.** Slackify keys on `role`/`aria-*`/`data-*` hooks plus computed-style
   heuristics (bubble radius/colour, right-aligned flex ancestors, max-width caps). Any change there silently degrades the
   look: tags are skipped (nothing is rewritten), and the page keeps working with partially applied styling.
5. **If something goes wrong on your machine, the fix is driven by that observation.** Send what you see (screenshot,
   which element looks wrong, optionally the output of `getStatus()` below) and the selectors/heuristics get adjusted from
   it. Do not expect fixes to be guessable in advance.
6. **Japanese UI is best-effort.** Day labels `今日`/`昨日`/`<曜日>, ...` and thread counts `N件の返信` are handled, but the
   exact strings Google Chat shows in Japanese were not observed. The primary divider path (`data-format="3"` timestamp
   inside a `role="heading"`) does not depend on text. Unmatched labels are simply left unstyled.
7. **Fonts.** Lato is embedded as `data:` URIs inside `user.css`. If Google Chat's Content-Security-Policy refuses
   `data:` fonts the stack falls back to the system font; nothing breaks.
8. **No external URLs.** Upstream's Chat-logo swap (an image on `ssl.gstatic.com`) is replaced at build time by
   `filter: brightness(0) invert(1)` on the same upstream selector (`[role="banner"] img[src*="chatlogo"]`, dark top-bar
   themes only). The logo becomes all white (its colours are lost). The selector is upstream's, confirmed only on the mock DOM.
9. **Recipe updates.** If Ferdium replaces the Google Chat recipe folder, `user.css`, `user.js` and the helper files may
   disappear. `manage.sh --status` shows `MISSING`; running the installer again re-applies them.
10. **Installer scope.** Only a Recipe with (`id=hangouts`, `https://mail.google.com/chat/`) or (`id=hangoutschat`,
    `https://chat.google.com`) is touched, and only when exactly one exists. A Custom Website service has no recipe folder of
    its own, so it is never a target (Ferdium has no per-service user.css/user.js for it). Symlinked Ferdium/recipe paths, unwritable files and ambiguous setups stop the installer.
    Existing `user.js` files that reference `__filename`, `require.main`, `user.js` by name, or that are not CommonJS are
    not wrapped (the installer stops without changes).
11. **Performance** figures in the design (8 ms idle slices, 100-250 ms fallback delay) are budgets, not measurements.
12. **Not implemented by design:** popup/settings UI, keyboard shortcuts (`shortcuts`), "hide/dim meetings", readable-width
    mode, Gmail-embedded Chat, other Ferdium services.

14. **Own-message sender name.** The real cause could not be confirmed (no real DOM access). The most likely cause is upstream's
    document-wide lookup `[data-compare-to-self-user="true"][data-name]` taking the first match: nothing shows that attribute is
    exclusive to the current user. It is no longer used. Names now come only from (1) the banner's Google Account button, (2) a
    native sender name inside a row identified as your own (coloured right-aligned bubble), only if all such rows agree, else
    (3) a neutral label (`You`, or `自分` when `<html lang>` is `ja`). The Japanese account-button prefix `Google アカウント` is an
    unverified guess; if it does not match, the label is neutral. The avatar is taken only from the account button.
15. **Composer height (real chain from diagnostic v2, Ferdium, 1384x911@2x, dark; native = skin off).** Facts: native card 104px =
    padding 16 + pill 64 + padding 24; Slackify added only a 1px border each side. The 64px comes from Google's own `min-height: 64px`
    on `composer-pill` (d5) and its direct child div (d4); inner pill d6 has `min-height: 48px`; the pill's content (buttons 32-48px,
    a 54px child) is ~54px. Fix (`src/css/compat.css`): card padding 6/6 and `min-height: 0` on `composer-pill` and its direct child
    divs. On a fixture built from that table: empty 104 -> 68px; 6 lines 190 -> 164px. UNVERIFIED on the real UI: (a) a sibling
    child of the pill (a 64px entry in its child list) may carry an explicit height rather than a min-height and would keep the pill
    at 64px; (b) the real 6-line layout (toolbar below the text, 255px measured) was not captured, so the multi-line saving there is
    only the ~28px of padding plus any min-height floors. If still tall, run `docs/composer-diagnostic.js` again with ~6 lines typed.

## Diagnostics

In the service's DevTools console (Ferdium: service context menu → Open Dev Tools):

```js
window[Symbol.for('ferdium-gchat-slackify.controller')].getStatus()
// { state: 'active' | 'waiting' | 'destroyed' | ..., mode, theme, passes, errors }
```

`state: 'waiting'` means the sidebar/message DOM was not recognised and the skin was deliberately not enabled.

13. **`mail.google.com/chat/` frame structure unverified.** The runtime accepts `chat.google.com` and `mail.google.com/chat/*`
    in the top frame. If Chat is rendered inside a cross-origin iframe there, Ferdium's `user.css`/`user.js` (top frame only)
    cannot reach it; the skin then stays off (`state: 'waiting'`) rather than misbehaving.
