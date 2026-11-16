// DOM tagging, ported from gchat-slackify v1.4.4 src/tagger.js.
//
// Differences from upstream (see docs/UPSTREAM.md): per-instance state instead of a module IIFE,
// no chrome.* storage/avatar cache, scheduling delegated to scheduler.js, an IntersectionObserver
// fallback, localized (Japanese) day-label matching, and a guard that never treats text inside a
// message body as a date label.
//
// The tagger only ever sets attributes (data-slackify, data-slackify-wide, data-sf-*) and
// html custom properties. It never moves/removes/replaces Chat's nodes or reads message text beyond
// short leaf labels.
import { TAGS, TAG_VALUES, TAG_ATTR, TOPIC_SEL } from './selectors.js';

const KNOWN_TAGS = new Set(Object.values(TAG_VALUES));
const MAX_TOPICS_WITHOUT_IO = 60;
const INITIAL_SYNC_TOPICS = 8;

const RGB = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/;
const rgb = (bg) => {
  const m = bg && RGB.exec(bg);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
};
const isGrey = (c) => !!c && Math.abs(c.r - c.g) < 6 && Math.abs(c.g - c.b) < 6 && c.r >= 232 && c.r <= 250;
const isWhite = (c) => !!c && c.r > 250 && c.g > 250 && c.b > 250;

const EN_WEEKDAY = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), /;
// Limited Japanese fallback: exact 今日/昨日, or "<曜日>, ..." / "<曜日>、..." day labels.
const JA_WEEKDAY = /^[日月火水木金土]曜日[,、]\s*\S/;
export const isDateLabel = (t) => t === 'Today' || t === 'Yesterday' || EN_WEEKDAY.test(t) ||
  t === '今日' || t === '昨日' || JA_WEEKDAY.test(t);

export function createTagger({ document, window, selectors: S, scheduler, logger }) {
  let destroyed = false;
  const getCS = (el) => window.getComputedStyle(el);
  const esc = (s) => (window.CSS && window.CSS.escape ? window.CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const safe = (scope, fn) => { try { fn(); } catch (e) { logger.error(scope, e); } };

  const setTag = (el, name) => {
    if (!KNOWN_TAGS.has(name)) throw new Error(`unknown tag ${name}`);
    el.setAttribute(TAG_ATTR, name);
  };
  const hasTag = (el) => el.hasAttribute(TAG_ATTR);
  const clearTag = (el) => el.removeAttribute(TAG_ATTR);
  const q = (sel, root = document) => root.querySelector(sel);

  // Text-based day labels are only trusted outside message bodies.
  const dateLeafOk = (el) => {
    const t = (el.textContent || '').trim();
    if (!t || t.length > 40 || !isDateLabel(t)) return false;
    return !(el.closest && el.closest('[data-message-id]'));
  };

  // ---- rail ----
  function tagRail() {
    const mainEl = S.firstMatchEl('conversationPane');
    const ex = q(TAGS.rail);
    if (ex && ex.isConnected && !(mainEl && ex.contains(mainEl))) return;
    if (ex) clearTag(ex);
    const anchor = S.firstMatchEl('dmList') || S.firstMatchEl('spacesList') || S.firstMatchEl('convRow');
    if (!anchor) return;
    const maxW = (window.innerWidth || 1280) * 0.5;
    let el = anchor;
    let rail = null;
    while (el && el !== document.documentElement) {
      if (mainEl && el.contains(mainEl)) break;
      const w = el.getBoundingClientRect().width;
      if (w > 0 && w < maxW) rail = el;
      el = el.parentElement;
    }
    if (rail) setTag(rail, 'rail');
  }

  // ---- active conversation row ----
  let lastActiveGroup;
  function tagActiveRow(pane, rail) {
    const g = pane && pane.getAttribute('data-group-id');
    const root = rail || document;
    if (g === lastActiveGroup && root.querySelector(TAGS.active)) return;
    if (lastActiveGroup !== undefined && g !== lastActiveGroup) rowNames = new Set();   // no identity carried across conversations
    lastActiveGroup = g;
    for (const el of root.querySelectorAll(TAGS.active)) {
      if (el.getAttribute('data-group-id') !== g) clearTag(el);
    }
    if (!g) return;
    for (const el of root.querySelectorAll(`[role="listitem"][data-group-id="${esc(g)}"]`)) setTag(el, 'active');
  }

  // ---- conversation header title ----
  let lastHeaderGid;
  function tagSpaceHeader(pane) {
    const g = (pane && pane.getAttribute('data-group-id')) || '';
    if (g === lastHeaderGid) return;
    lastHeaderGid = g;
    const ex = q(TAGS.convoTitle);
    if (ex) { clearTag(ex); ex.removeAttribute('data-sf-space'); }
    if (!g) return;
    const rail = q(TAGS.rail);
    const railRight = rail ? rail.getBoundingClientRect().right : 320;
    let best = null;
    let bestSize = 18;
    for (const btn of document.querySelectorAll('button[aria-haspopup="menu"]')) {
      const r = btn.getBoundingClientRect();
      if (r.top > 130 || r.left < railRight || r.width === 0) continue;
      for (const el of btn.querySelectorAll('span')) {
        if (el.children.length) continue;
        const t = (el.textContent || '').trim();
        if (!t || t.length > 40) continue;
        const fs = parseFloat(getCS(el).fontSize) || 0;
        if (fs > bestSize) { bestSize = fs; best = el; }
      }
    }
    if (best) {
      setTag(best, 'convo-title');
      if (g.startsWith('space/')) best.setAttribute('data-sf-space', '');
    }
  }

  // ---- centered max-width message column ----
  function tagStream(pane) {
    if (q(TAGS.stream)) return;
    const topic = pane && pane.querySelector(TOPIC_SEL);
    if (!topic) return;
    const mainW = pane.getBoundingClientRect().width;
    let n = topic;
    while (n && n !== pane && n !== document.body) {
      const mw = getCS(n).maxWidth;
      if (mw && mw.endsWith('px') && parseFloat(mw) > 200 && parseFloat(mw) < mainW) {
        setTag(n, 'stream');
        return;
      }
      n = n.parentElement;
    }
  }

  // ---- date dividers ----
  const datedGroups = new Set();
  function tagDate(el) {
    setTag(el, 'date');
    const p = el.parentElement;
    if (p && !hasTag(p)) setTag(p, 'datewrap');
  }
  function scanDates(pane) {
    const g = pane.getAttribute('data-group-id') || '';
    if (datedGroups.has(g)) return;
    datedGroups.add(g);
    const toTag = [];
    for (const el of pane.querySelectorAll('span, div')) {
      if (el.children.length || hasTag(el)) continue;
      if (dateLeafOk(el)) toTag.push(el);
    }
    for (const el of toTag) tagDate(el);
  }

  let seenDividerHeads = new WeakSet();
  function scanDividers(pane) {
    if (!pane) return;
    const dates = [];
    const unreads = [];
    for (const head of S.allMatchEls('dividerHeading', pane)) {
      if (seenDividerHeads.has(head)) continue;
      seenDividerHeads.add(head);
      const ts = head.querySelector(S.sel('dateHeading'));
      if (ts) { dates.push([head, ts]); continue; }
      const svg = head.querySelector('svg');
      if (svg && svg.parentElement && svg.parentElement.clientWidth > 200) unreads.push(head);
    }
    for (const [head, ts] of dates) {
      if (!hasTag(ts)) setTag(ts, 'date');
      if (!hasTag(head)) setTag(head, 'datewrap');
    }
    for (const head of unreads) {
      if (hasTag(head)) continue;
      setTag(head, 'unread-line');
      for (const c of head.children) {
        if (!c.querySelector('svg') && (c.textContent || '').trim()) { setTag(c, 'unread-label'); break; }
      }
    }
  }

  // ---- thread replies ----
  let threadScanned = new WeakSet();
  function scanThreadReplies(pane) {
    if (!pane) return;
    const chips = [];
    const counts = [];
    const curls = [];
    for (const cont of pane.querySelectorAll('[data-last-reply-time-msec]')) {
      if (threadScanned.has(cont)) continue;
      threadScanned.add(cont);
      for (const sp of cont.querySelectorAll('span')) {
        if (sp.children.length) continue;
        // English "N replies"/"N unread" plus Japanese "N件の返信"/"返信N件"/"N件の未読" forms.
        if (/^\s*\d+\s*(repl(y|ies)|unread)\s*$/i.test(sp.textContent || '') ||
            /^\s*(\d+\s*件の(返信|未読)|返信\s*\d+\s*件)\s*$/.test(sp.textContent || '')) {
          counts.push(sp);
          chips.push(sp.closest('[role="button"]') || cont);
        }
      }
      for (const d of cont.querySelectorAll('div, span')) {
        if (d.children.length || (d.textContent || '').trim() || hasTag(d)) continue;
        const r = d.getBoundingClientRect();
        if (r.width === 0 || r.width > 48 || r.height > 48) continue;
        const cs = getCS(d);
        if ((parseFloat(cs.borderBottomLeftRadius) || 0) >= 6 &&
            (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0) > 0) {
          curls.push(d);
        }
      }
    }
    for (const el of chips) if (!hasTag(el)) setTag(el, 'thread-chip');
    for (const el of counts) if (!hasTag(el)) setTag(el, 'reply-count');
    for (const el of curls) setTag(el, 'thread-curl');
  }

  // ---- reaction pills ----
  let nonPillEmojis = new WeakSet();
  function scanReactionPills(pane) {
    if (!pane) return;
    const pills = [];
    const strips = [];
    for (const em of pane.querySelectorAll('[data-emoji]')) {
      if (nonPillEmojis.has(em)) continue;
      const pill = em.closest('button, [role="button"]');
      if (!pill) { nonPillEmojis.add(em); continue; }
      if (hasTag(pill)) continue;
      if (!/\d/.test(pill.textContent || '')) continue;
      pills.push(pill);
      const strip = pill.parentElement && pill.parentElement.parentElement;
      if (strip && !hasTag(strip)) strips.push(strip);
    }
    for (const el of pills) setTag(el, 'reaction-pill');
    for (const el of strips) setTag(el, 'reactions');
    for (const s of strips) {
      for (const c of s.children) {
        if (hasTag(c)) continue;
        if (/\d/.test(c.textContent || '')) continue;
        if (c.matches('button, [role="button"]') || c.querySelector('button, [role="button"]')) setTag(c, 'reaction-add');
      }
    }
  }

  // ---- status chip ----
  function tagStatusChip() {
    if (q(TAGS.statusChip)) return;
    const topbar = q('[role="banner"]');
    if (!topbar) return;
    for (const btn of topbar.querySelectorAll('[role="button"], button')) {
      if (hasTag(btn)) continue;
      const bg = rgb(getCS(btn).backgroundColor);
      if (bg && bg.a > 0.3) { setTag(btn, 'status-chip'); return; }
    }
  }

  // ---- compose box ----
  function tagComposer() {
    const ex = q(TAGS.composer);
    if (ex && ex.isConnected) return;
    if (ex) clearTag(ex);
    for (const p of document.querySelectorAll(`${TAGS.composerPill}, ${TAGS.composerWrap}`)) {
      if (!p.isConnected) clearTag(p);
    }
    const tb = q('[role="main"] [role="textbox"]');
    if (!tb) return;
    let el = tb;
    for (let i = 0; i < 10 && el; i++) {
      const cs = getCS(el);
      const wide = el.getBoundingClientRect().width > 300;
      if (wide && (parseFloat(cs.borderTopLeftRadius) || 0) >= 16) setTag(el, 'composer-pill');
      const m = RGB.exec(cs.backgroundColor || '');
      const opaque = m && (m[4] === undefined || +m[4] > 0.5);
      if (opaque && wide) {
        setTag(el, 'composer');
        if (el.parentElement) setTag(el.parentElement, 'composer-wrap');
        const compW = el.getBoundingClientRect().width;
        for (const d of el.querySelectorAll(`div:not([${TAG_ATTR}])`)) {
          const r = d.getBoundingClientRect();
          if (r.width < compW * 0.6 || r.height > 120 || r.height < 20) continue;
          const dcs = getCS(d);
          if ((parseFloat(dcs.borderTopLeftRadius) || 0) < 16) continue;
          const dm = RGB.exec(dcs.backgroundColor || '');
          if (dm && (dm[4] === undefined || +dm[4] > 0.5)) setTag(d, 'composer-pill');
        }
        return;
      }
      el = el.parentElement;
    }
  }

  function highestRightAlignedAncestor(start, topic) {
    let found = null;
    for (let n = start, i = 0; n && n !== topic && i < 10; n = n.parentElement, i++) {
      const cs = getCS(n);
      if (cs.alignSelf === 'flex-end' || cs.alignItems === 'flex-end' || cs.justifyContent === 'flex-end') found = n;
    }
    return found;
  }

  // ---- per-topic scan ----
  let processedTopics = new WeakSet();
  let topicAnchor = new WeakMap();
  function scanTopic(topic) {
    if (destroyed || !topic || !topic.querySelectorAll || !topic.isConnected) return;   // detached (re-rendered away) topics carry no identity evidence
    const anchor = topicAnchor.get(topic);
    if (processedTopics.has(topic) && anchor && anchor.isConnected) return;
    const nodes = topic.querySelectorAll('div, span');
    if (!nodes.length) { retryLater(topic); return; }
    processedTopics.add(topic);
    const bubbles = [];
    const dates = [];
    const wides = [];
    const selfRows = [];
    for (const el of nodes) {                                   // READ phase
      if (hasTag(el)) continue;
      if (el.children.length === 0 && dateLeafOk(el)) { dates.push(el); continue; }
      const cs = getCS(el);
      const mwm = /(\d+(?:\.\d+)?)px/.exec(cs.maxWidth || '');
      if (mwm && cs.maxWidth !== 'none') { const px = +mwm[1]; if (px >= 360 && px <= 900) wides.push(el); }
      const r = parseFloat(cs.borderTopLeftRadius) || 0;
      if (r < 4) continue;
      if (!(el.textContent || '').trim()) continue;
      const bg = rgb(cs.backgroundColor);
      const grey = isGrey(bg);
      const colored = r >= 12 && bg && bg.a > 0.4 && !isWhite(bg) && !grey;
      if (grey || colored) bubbles.push(el);
      if (colored && el.tagName === 'DIV') {
        const row = highestRightAlignedAncestor(el, topic);
        if (row) selfRows.push(row);
      }
    }
    const avatarWraps = [];
    const msgRows = [];
    for (const img of topic.querySelectorAll('img')) {
      const p = img.parentElement;
      if (!p || hasTag(p)) continue;
      if (img.getBoundingClientRect().width < 24) continue;
      const r = parseFloat(getCS(p).borderTopLeftRadius) || 0;
      if (r >= 12) {
        avatarWraps.push(p);
        let row = p.parentElement;
        for (let i = 0; i < 6 && row && row !== topic; i++) {
          const cs = getCS(row);
          if (cs.display === 'flex' && row.getBoundingClientRect().width > 200) { msgRows.push(row); break; }
          row = row.parentElement;
        }
      }
    }
    for (const el of dates) tagDate(el);                        // WRITE phase
    for (const el of bubbles) setTag(el, 'bubble');
    for (const el of selfRows) {
      if (hasTag(el)) continue;
      if (selfRows.some((o) => o !== el && o.contains(el))) continue;
      setTag(el, 'self-row');
    }
    for (const el of topic.querySelectorAll(TAGS.selfRow)) {
      const t = el.querySelector('[data-absolute-timestamp]');
      const shown = !!t && t.getBoundingClientRect().width > 0;
      if (!shown) { el.setAttribute('data-sf-self-notime', ''); continue; }
      el.removeAttribute('data-sf-self-notime');
      const key = (t.textContent || '').replace(/[\s,]/g, '');
      if (!key) continue;
      let mr = t;
      let hops = 0;
      while (mr.parentElement && mr.parentElement !== el && hops < 5 &&
        (mr.parentElement.textContent || '').replace(/[\s,]/g, '') === key) { mr = mr.parentElement; hops += 1; }
      if (!hasTag(mr)) setTag(mr, 'self-meta');
    }
    for (const el of wides) el.setAttribute('data-slackify-wide', '');
    for (const el of avatarWraps) setTag(el, 'avatar-wrap');
    for (const el of msgRows) if (!hasTag(el)) setTag(el, 'msgrow');
    topicAnchor.set(topic, selfRows[0] || bubbles[0] || topic.firstElementChild);
    noteSelfRowNames(topic);
  }

  // ---- avatars outside the stream ----
  let seenAvatars = new WeakSet();
  function scanAvatars(rail) {
    const imgs = [];
    if (rail) for (const img of rail.querySelectorAll('img')) imgs.push(img);
    for (const row of document.querySelectorAll('[role="listitem"][data-group-type]')) {
      for (const img of row.querySelectorAll('img')) imgs.push(img);
    }
    for (const img of document.querySelectorAll('button[aria-haspopup="menu"] img')) imgs.push(img);
    const wraps = [];
    for (const img of imgs) {
      if (seenAvatars.has(img)) continue;
      seenAvatars.add(img);
      let e = img.parentElement;
      for (let i = 0; i < 6 && e && e !== rail; i++) {
        if (!hasTag(e)) {
          const cs = getCS(e);
          if ((parseFloat(cs.borderTopLeftRadius) || 0) >= 8 && cs.overflow === 'hidden') wraps.push(e);
        }
        e = e.parentElement;
      }
    }
    for (const p of wraps) setTag(p, 'avatar-wrap');
  }

  // ---- sidebar space names ----
  let spaceNamed = new WeakSet();
  function scanSpaceNames(rail) {
    const list = S.firstMatchEl('spacesList') || rail;
    if (!list) return;
    const toTag = [];
    for (const row of list.querySelectorAll('[role="listitem"][data-group-id^="space/"]')) {
      if (spaceNamed.has(row)) continue;
      spaceNamed.add(row);
      for (const sp of row.querySelectorAll('span[role="presentation"]')) {
        if ((sp.textContent || '').trim()) { toTag.push(sp); break; }
      }
    }
    for (const el of toTag) setTag(el, 'spacename');
  }

  // ---- lazy topic discovery ----
  let seenTopics = new WeakSet();
  let topicIO = null;
  if (typeof window.IntersectionObserver === 'function') {
    topicIO = new window.IntersectionObserver((entries) => {
      let any = false;
      for (const e of entries) {
        if (e.isIntersecting) { scheduler.queueTopic(e.target); topicIO.unobserve(e.target); any = true; }
      }
      if (any) scheduler.markDirty();
    }, { rootMargin: '600px 0px 600px 0px' });
  }
  function retryLater(topic) {
    if (topicIO) topicIO.observe(topic);
    else seenTopics.delete(topic);   // re-discovered on the next dirty pass
  }
  function discoverTopics(pane) {
    const all = pane.querySelectorAll(TOPIC_SEL);
    const start = topicIO ? 0 : Math.max(0, all.length - MAX_TOPICS_WITHOUT_IO);
    for (let i = start; i < all.length; i++) {
      const t = all[i];
      if (seenTopics.has(t)) continue;
      seenTopics.add(t);
      if (topicIO) topicIO.observe(t); else scheduler.queueTopic(t);
    }
  }
  function requeueRecentTopics(pane) {
    const ts = pane.querySelectorAll(TOPIC_SEL);
    for (let i = Math.max(0, ts.length - 4); i < ts.length; i++) scheduler.queueTopic(ts[i]);
  }

  // ---- self identity (avatar + name) -> CSS custom properties on <html> ----
  // Attribution safety rules (a message must never be labelled with someone else's name):
  //  * name: (1) the Google Account button in the banner (an element that exists only for the signed-in user), else
  //    (2) the native sender name found INSIDE a row we tagged "self-row" (own-message evidence: coloured,
  //    right-aligned bubble), and only if every self-row agrees; else (3) a neutral label ("You"/"自分").
  //    Upstream's document-wide `[data-compare-to-self-user="true"][data-name]` lookup is NOT used: nothing proves that
  //    attribute is exclusive to the current user, and "first match in the document" can be another participant.
  //  * avatar: only the image inside the Google Account button; otherwise unset (upstream CSS falls back to a plain tile).
  //  * nothing is latched: identity is recomputed on every dirty pass and row-derived names reset on conversation switch.
  let accountName = '';
  let accountAvatar = '';
  let rowNames = new Set();
  let appliedName = null;
  let appliedAvatar = null;
  const neutralName = () => (/^ja/i.test(document.documentElement.getAttribute('lang') || '') ? '自分' : 'You');

  function readAccount() {
    const el = S.firstMatchEl('selfAccount');
    accountName = '';
    accountAvatar = '';
    if (!el) return;
    const label = el.getAttribute('aria-label') || '';
    // "Google Account: Jane Doe \n(jane@x.com)" / "Google アカウント: 名前 (mail)": drop prefix and "(email)".
    accountName = label.replace(/^[^:：]*[:：]\s*/, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    const img = el.querySelector('img');
    accountAvatar = (img && (img.currentSrc || img.src)) || '';
  }

  function applyIdentity() {
    readAccount();
    const fromRows = rowNames.size === 1 ? Array.from(rowNames)[0] : '';
    const name = accountName || fromRows || neutralName();
    const de = document.documentElement.style;
    if (name !== appliedName) { de.setProperty('--sf-self-name', JSON.stringify(name)); appliedName = name; }
    if (accountAvatar !== appliedAvatar) {
      if (accountAvatar) de.setProperty('--sf-self-avatar', `url("${accountAvatar.replace(/["\\\n]/g, '')}")`);
      else de.removeProperty('--sf-self-avatar');
      appliedAvatar = accountAvatar;
    }
  }

  // Called after a topic's self-rows are tagged: remember the native sender name inside them (if any) and note whether
  // Google already shows a visible name there (then our synthetic name is suppressed to avoid a duplicate).
  function noteSelfRowNames(topic) {
    for (const row of topic.querySelectorAll(TAGS.selfRow)) {
      const nameEl = row.querySelector('span[data-name][data-is-message]');
      const n = nameEl ? (nameEl.getAttribute('data-name') || '').trim() : '';
      if (n) rowNames.add(n);
      const r = nameEl && nameEl.getBoundingClientRect();
      if (r && r.width > 8 && r.height > 4) row.setAttribute('data-sf-native-name', '');
      else row.removeAttribute('data-sf-native-name');
    }
    applyIdentity();
  }

  // ---- region work (cheap, once per dirty pass) ----
  function regionWork() {
    safe('tagRail', tagRail);
    safe('selfIdentity', applyIdentity);
    safe('statusChip', tagStatusChip);
    safe('composer', tagComposer);
    const pane = S.firstMatchEl('conversationPane');
    const rail = q(TAGS.rail);
    safe('activeRow', () => tagActiveRow(pane, rail));
    safe('header', () => tagSpaceHeader(pane));
    safe('avatars', () => scanAvatars(rail));
    safe('spaceNames', () => scanSpaceNames(rail));
    if (pane) {
      safe('stream', () => tagStream(pane));
      safe('dividers', () => scanDividers(pane));
      safe('dates', () => scanDates(pane));
      safe('threads', () => scanThreadReplies(pane));
      safe('reactions', () => scanReactionPills(pane));
      safe('discover', () => discoverTopics(pane));
      safe('requeue', () => requeueRecentTopics(pane));
    }
  }

  // One scheduler pass: region work when dirty, then time-budgeted topic scans.
  function pass({ deadline, dirty, topics }) {
    if (destroyed) return;
    if (dirty) regionWork();
    const hasTime = () => !deadline || typeof deadline.timeRemaining !== 'function' || deadline.timeRemaining() > 3;
    for (const t of topics) {
      if (!hasTime()) break;
      topics.delete(t);
      safe('topic', () => scanTopic(t));
    }
  }

  // Synchronous scan of `root` (initial activation / refresh / tests). Topics beyond `limit`
  // (newest first) are left to the lazy path.
  function scanRoot(root = document, { limit = Infinity } = {}) {
    if (destroyed) return;
    regionWork();
    const topics = Array.from(root.querySelectorAll(TOPIC_SEL));
    for (const t of topics.slice(-limit)) safe('topic', () => scanTopic(t));
  }

  function scanTopicPublic(topic) { safe('topic', () => scanTopic(topic)); }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (topicIO) { topicIO.disconnect(); topicIO = null; }
    safe('cleanup', () => {
      for (const el of document.querySelectorAll(`[${TAG_ATTR}], [data-slackify-wide], [data-sf-self-notime], [data-sf-space], [data-sf-native-name]`)) {
        el.removeAttribute(TAG_ATTR);
        el.removeAttribute('data-slackify-wide');
        el.removeAttribute('data-sf-self-notime');
        el.removeAttribute('data-sf-space');
        el.removeAttribute('data-sf-native-name');
      }
      document.documentElement.style.removeProperty('--sf-self-avatar');
      document.documentElement.style.removeProperty('--sf-self-name');
    });
    seenDividerHeads = threadScanned = nonPillEmojis = processedTopics = topicAnchor =
      seenAvatars = spaceNamed = seenTopics = null;
  }

  return { scanRoot, scanTopic: scanTopicPublic, pass, destroy, INITIAL_SYNC_TOPICS };
}
