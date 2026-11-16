// Selector chains and tag names, taken verbatim from the pinned upstream config.js.
import meta from './upstream-meta.generated.json' with { type: 'json' };

export const SELECTORS = meta.SELECTORS;
export const TAGS = meta.TAGS;
// Runtime-only additions (not part of upstream config.js, never used by the CSS generator).
// selfAccount: the signed-in user's account button in the banner. Evidence: upstream config.js `selfAvatar` uses the
// English aria-label prefix "Google Account"; the Japanese prefix "Google アカウント" is an UNVERIFIED addition - if it is
// wrong it simply never matches and the neutral label is used.
export const RUNTIME_SELECTORS = Object.freeze({
  ...SELECTORS,
  selfAccount: ['[role="banner"] [aria-label^="Google Account"]', '[role="banner"] [aria-label^="Google アカウント"]'],
});
export const TOPIC_SEL = 'c-wiz[data-topic-id]';
export const TAG_ATTR = 'data-slackify';

// '[data-slackify="rail"]' -> 'rail' (also handles '[role="listitem"][data-slackify="active"]')
export const TAG_VALUES = Object.freeze(Object.fromEntries(
  Object.entries(TAGS).map(([k, v]) => [k, (/data-slackify="([^"]+)"/.exec(v) || [])[1]]).filter(([, v]) => v),
));

export function createSelectorApi(doc, selectors = RUNTIME_SELECTORS) {
  const sel = (key) => (selectors[key] || []).join(', ');
  const firstMatchEl = (key, root = doc) => {
    for (const s of selectors[key] || []) {
      try { const el = root.querySelector(s); if (el) return el; } catch { /* invalid selector in this engine */ }
    }
    return null;
  };
  const allMatchEls = (key, root = doc) => {
    for (const s of selectors[key] || []) {
      try { const els = root.querySelectorAll(s); if (els.length) return Array.from(els); } catch { /* ignore */ }
    }
    return [];
  };
  return { sel, firstMatchEl, allMatchEls, SELECTORS: selectors };
}
