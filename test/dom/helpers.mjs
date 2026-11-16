import { JSDOM } from 'jsdom';
import { renderFixture } from '../fixtures/chat-fixture.mjs';

// jsdom has no layout engine: derive widths from the fixture's data-w / inline width / width attr.
function installLayoutStubs(window) {
  const widthOf = (el) => {
    if (el.style && el.style.display === 'none') return 0;
    if (el.hasAttribute && el.hasAttribute('data-w')) return +el.getAttribute('data-w');
    const m = /(?:^|;)\s*width:\s*(\d+(?:\.\d+)?)px/.exec(el.getAttribute && el.getAttribute('style') || '');
    if (m) return +m[1];
    if (el.getAttribute && el.getAttribute('width')) return parseFloat(el.getAttribute('width')) || 0;
    return 0;
  };
  window.Element.prototype.getBoundingClientRect = function () {
    const w = widthOf(this);
    const left = this.closest && this.closest('[role="main"]') ? 256 : 0;
    const top = this.closest && this.closest('#convo-header') ? 12 : 60;
    return { width: w, height: w ? 30 : 0, left, right: left + w, top, bottom: top + 30, x: left, y: top };
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return widthOf(this); }, configurable: true });
  // cssstyle does not expand the border-radius shorthand into longhands; Chromium does.
  const realGCS = window.getComputedStyle.bind(window);
  window.getComputedStyle = (el, pseudo) => {
    const cs = realGCS(el, pseudo);
    return new Proxy(cs, {
      get(t, p) {
        if ((p === 'borderTopLeftRadius' || p === 'borderBottomLeftRadius') && !t[p]) return (t.borderRadius || '').split(' ')[0];
        const v = t[p];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  };
  window.CSS = window.CSS || { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
}

export function makeDom(opts = {}) {
  const { html = renderFixture(opts), url = 'https://chat.google.com/u/0/', osDark = false, noIdle = true } = opts;
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  installLayoutStubs(window);
  window.matchMedia = window.matchMedia || ((q) => ({ matches: osDark && /dark/.test(q), addEventListener() {}, removeEventListener() {} }));
  if (noIdle) { delete window.requestIdleCallback; delete window.cancelIdleCallback; }
  return dom;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
  return !!fn();
}
export const tagged = (doc, name) => Array.from(doc.querySelectorAll(`[data-slackify="${name}"]`));
