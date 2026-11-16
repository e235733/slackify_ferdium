// READ-ONLY layout diagnostic for the Google Chat composer, v2 (compact, multi-line output).
// Paste into the service's DevTools console, press Enter, then paste the printed text back.
//
// It reads layout numbers only: tag names, role, data-slackify, the first CSS class names, computed sizing/flex
// properties and box heights. It never reads message text, input contents (no textContent, innerText, value, innerHTML),
// aria-labels, links, cookies, storage or account details, and it changes nothing in the DOM.
/* global copy */ // DevTools console helper
(() => {
  const n = (v) => Math.round(parseFloat(v) * 10) / 10 || 0;
  const tb = document.querySelector('[role="main"] [role="textbox"]') || document.querySelector('[role="textbox"]');
  if (!tb) { console.log('composer-v2 ERROR: no [role=textbox] found'); return 'no textbox'; }
  const html = document.documentElement;
  const lines = [`composer-v2 skin=${html.hasAttribute('data-sf-on')} mode=${html.getAttribute('data-sf-mode')} viewport=${innerWidth}x${innerHeight}@${devicePixelRatio}`];
  lines.push('d|tag|sf|rect(top,h,w)|minH|height|padT/padB|marT/marB|border T/B|display|dir|justify|align|alignSelf|grow|pos|ovY|kidsH|cls');
  let el = tb;
  let cardH = null;
  for (let d = 0; el && d < 18 && el !== document.body; d++, el = el.parentElement) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const sf = el.getAttribute('data-slackify') || '';
    if (sf === 'composer') cardH = n(r.height);
    const kids = Array.from(el.children).slice(0, 10).map((k) => n(k.getBoundingClientRect().height)).join(',');
    const cls = String(el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    lines.push([d, el.tagName.toLowerCase() + (el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''), sf, `${n(r.top)},${n(r.height)},${n(r.width)}`, cs.minHeight, cs.height, `${cs.paddingTop}/${cs.paddingBottom}`, `${cs.marginTop}/${cs.marginBottom}`, `${cs.borderTopWidth}/${cs.borderBottomWidth}`, cs.display, cs.flexDirection, cs.justifyContent, cs.alignItems, cs.alignSelf, cs.flexGrow, cs.position, cs.overflowY, kids, cls].join('|'));
    if (el.getAttribute('role') === 'main') break;
  }
  const card = tb.closest('[data-slackify="composer"]');
  const btns = card ? Array.from(card.querySelectorAll('button,[role="button"]')).map((b) => b.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => `${n(r.left)},${n(r.top)},${n(r.width)}x${n(r.height)}`) : [];
  lines.push(`composerCardHeight=${cardH} visibleButtons(left,top,WxH)=${btns.join(' ')}`);
  const text = lines.join('\n');
  console.log(text);
  if (typeof copy === 'function') copy(text);
  return text;
})();
