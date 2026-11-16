// Light/dark detection (ported from upstream apply.js detectMode) and html attribute application.
import meta from './upstream-meta.generated.json' with { type: 'json' };

const RGB = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/;

export function detectMode(document, window) {
  try {
    const t = document.body && document.body.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
  } catch { /* fall through */ }
  try {
    const el = document.querySelector('[role="main"]') || document.body;
    if (el) {
      const m = RGB.exec(window.getComputedStyle(el).backgroundColor || '');
      if (m && (m[4] === undefined || +m[4] > 0.1)) {
        const lum = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
        return lum < 128 ? 'dark' : 'light';
      }
    }
  } catch { /* fall through */ }
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch { /* fall through */ }
  return 'light';
}

export function applyMode(document, window) {
  const mode = detectMode(document, window);
  const html = document.documentElement;
  if (html.getAttribute('data-sf-mode') !== mode) html.setAttribute('data-sf-mode', mode);
  return mode;
}

export function applyTheme(document, settings) {
  const html = document.documentElement;
  html.setAttribute('data-sf-theme', settings.theme);
  for (const f of meta.FEATURES) {
    const attr = `data-sf-feat-${f.id}`;
    if (settings.features[f.id]) html.setAttribute(attr, '');
    else html.removeAttribute(attr);
  }
  const window = document.defaultView;
  if (window) applyMode(document, window);
}

export function clearTheme(document) {
  const html = document.documentElement;
  for (const a of Array.from(html.attributes)) {
    if (a.name === 'data-sf-on' || a.name.startsWith('data-sf-')) html.removeAttribute(a.name);
  }
}

// Calls callback() (coalesced) when Chat's appearance may have changed. Returns an unsubscribe fn.
export function watchTheme(document, window, callback) {
  let timer = null;
  let off = false;
  const fire = () => {
    if (off || timer !== null) return;
    timer = window.setTimeout(() => { timer = null; if (!off) callback(); }, 50);
  };
  const observers = [];
  const watch = (el, filter) => {
    if (!el || typeof window.MutationObserver !== 'function') return;
    const mo = new window.MutationObserver(fire);
    mo.observe(el, { attributes: true, attributeFilter: filter });
    observers.push(mo);
  };
  watch(document.documentElement, ['class', 'style', 'data-theme', 'data-darkmode']);
  watch(document.body, ['class', 'style', 'data-theme']);
  let mql = null;
  try {
    mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mql && mql.addEventListener) mql.addEventListener('change', fire);
  } catch { mql = null; }
  return () => {
    off = true;
    if (timer !== null) { window.clearTimeout(timer); timer = null; }
    for (const mo of observers) mo.disconnect();
    try { if (mql && mql.removeEventListener) mql.removeEventListener('change', fire); } catch { /* ignore */ }
  };
}
