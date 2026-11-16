import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../../src/runtime/entry.js';
import { createLogger } from '../../src/runtime/diagnostics.js';
import { makeDom, until, tagged, sleep } from './helpers.mjs';

const quiet = () => createLogger({ console: { warn() {}, debug() {} } });
const start = async (opts = {}) => {
  const dom = makeDom(opts);
  const { window } = dom;
  const logger = quiet();
  const c = boot({ document: window.document, window, logger });
  assert.ok(await until(() => c.getStatus().active), `activates (status=${JSON.stringify(c.getStatus())})`);
  return { dom, window, doc: window.document, c, logger };
};

test('sidebar: rail, active row, space names, avatars', async () => {
  const { doc, c } = await start();
  const rail = tagged(doc, 'rail');
  assert.equal(rail.length, 1);
  assert.ok(rail[0].querySelector('[role="list"]'));
  assert.ok(!rail[0].querySelector('[role="main"]'));
  const active = doc.querySelectorAll('[role="listitem"][data-slackify="active"]');
  assert.deepEqual(Array.from(active).map((e) => e.getAttribute('data-group-id')), ['space/alpha']);
  assert.deepEqual(tagged(doc, 'spacename').map((e) => e.textContent), ['Project Alpha', 'Beta Team']);
  assert.ok(tagged(doc, 'avatar-wrap').length >= 4);
  c.destroy();
});

test('messages: bubbles, msgrow, avatar-wrap, stream, convo-title', async () => {
  const { doc, c } = await start();
  assert.ok(tagged(doc, 'bubble').length >= 6, 'every message bubble is tagged');
  assert.ok(tagged(doc, 'msgrow').length >= 1);
  assert.equal(tagged(doc, 'stream').length, 1);
  assert.equal(tagged(doc, 'stream')[0].id, 'column');
  const title = tagged(doc, 'convo-title');
  assert.equal(title.length, 1);
  assert.equal(title[0].textContent, 'Project Alpha');
  assert.ok(title[0].hasAttribute('data-sf-space'));
  c.destroy();
});

test('own messages: self-row, self-meta, notime for grouped, identity vars', async () => {
  const { doc, c } = await start();
  const rows = tagged(doc, 'self-row');
  assert.equal(rows.length, 3, 'one per own message');
  assert.ok(rows.every((r) => r.closest('[data-topic-id]')));
  assert.ok(!rows.some((r) => r.closest('[data-topic-id]').getAttribute('data-topic-id') === 'topic-0'), 'other person is not a self-row');
  const metas = tagged(doc, 'self-meta');
  assert.ok(metas.length >= 1 && metas.every((m) => m.hasAttribute('data-absolute-timestamp') || m.querySelector('[data-absolute-timestamp]')));
  assert.equal(doc.querySelectorAll('[data-sf-self-notime]').length, 1, 'grouped follow-up (hidden timestamp) is marked');
  assert.equal(doc.documentElement.style.getPropertyValue('--sf-self-name'), '"Jane Doe"');
  assert.match(doc.documentElement.style.getPropertyValue('--sf-self-avatar'), /^url\("/);
  c.destroy();
});

test('date dividers: heading dates, datewrap, unread line, English text fallback', async () => {
  const { doc, c } = await start({ lang: 'en' });
  assert.ok(tagged(doc, 'date').length >= 3);
  assert.ok(tagged(doc, 'datewrap').length >= 2);
  assert.equal(tagged(doc, 'unread-line').length, 1);
  assert.equal(tagged(doc, 'unread-label').length, 1);
  const textDates = tagged(doc, 'date').map((e) => e.textContent);
  assert.ok(textDates.includes('Monday, Oct 21'), 'text-based weekday label is tagged');
  c.destroy();
});

test('date dividers: Japanese labels tagged, but message body "今日" is not', async () => {
  const { doc, c } = await start({ lang: 'ja' });
  const dates = tagged(doc, 'date').map((e) => e.textContent);
  assert.ok(dates.includes('月曜日, 10月21日'));
  assert.ok(dates.includes('今日') && dates.includes('昨日'), 'heading dates (data-format=3) tagged');
  const body = doc.querySelector('[data-message-id="msg-4"] span');
  assert.equal(body.textContent, '今日');
  assert.equal(body.getAttribute('data-slackify'), null, 'message text that looks like a date label is left alone');
  c.destroy();
});

test('composer: tagged with wrapper; textbox and send button untouched', async () => {
  const { doc, c } = await start();
  const comp = tagged(doc, 'composer');
  assert.equal(comp.length, 1);
  assert.equal(comp[0].id, 'composer-box');
  assert.equal(tagged(doc, 'composer-wrap')[0].id, 'composer-outer');
  const tb = doc.querySelector('[role="textbox"]');
  assert.equal(tb.getAttribute('contenteditable'), 'true');
  assert.equal(tb.hasAttribute('data-slackify'), false);
  assert.equal(doc.getElementById('send').hasAttribute('data-slackify'), false);
  c.destroy();
});

test('threads and reactions', async () => {
  const { doc, c } = await start({ lang: 'en' });
  assert.equal(tagged(doc, 'reply-count').length, 1);
  assert.equal(tagged(doc, 'reply-count')[0].textContent, '2 replies');
  assert.equal(tagged(doc, 'thread-chip').length, 1);
  assert.equal(tagged(doc, 'reaction-pill').length, 2);
  assert.equal(tagged(doc, 'reactions').length, 2);
  assert.equal(tagged(doc, 'reaction-add').length, 2);
  c.destroy();
  const ja = await start({ lang: 'ja' });
  assert.equal(tagged(ja.doc, 'reply-count')[0].textContent, '2件の返信');
  ja.c.destroy();
});

test('recipe unread-count DOM is not modified', async () => {
  const dom = makeDom();
  const doc = dom.window.document;
  const snap = () => ['1', '2'].map((t) => doc.querySelector(`div[data-section-type="${t}"] div.TeR7uc`).outerHTML + doc.querySelector(`div[data-section-type="${t}"]`).getAttribute('data-section-type'));
  const before = snap();
  const c = boot({ document: doc, window: dom.window, logger: quiet() });
  await until(() => c.getStatus().active);
  assert.deepEqual(snap(), before);
  assert.equal(doc.querySelector('div[data-section-type="1"] div.TeR7uc').textContent, '3');
  assert.equal(doc.querySelector('div[data-section-type="2"] div.TeR7uc').textContent, '12');
  c.destroy();
});

test('tagging never rewrites Chat content', async () => {
  const dom = makeDom();
  const doc = dom.window.document;
  const strip = (h) => h.replace(/ data-slackify(?:-wide)?(?:="[^"]*")?/g, '').replace(/ data-sf-[a-z-]+(?:="[^"]*")?/g, '').replace(/ style="[^"]*"/g, '');
  const before = strip(doc.body.innerHTML);
  const c = boot({ document: doc, window: dom.window, logger: quiet() });
  await until(() => c.getStatus().active);
  await sleep(100);
  assert.equal(strip(doc.body.innerHTML), before, 'only attributes added; structure and text identical');
  c.destroy();
});

test('fault tolerance: empty, loading and login pages', async () => {
  const { doc, c: ce } = await start({ kind: 'empty' });
  assert.equal(tagged(doc, 'bubble').length, 0);
  assert.equal(tagged(doc, 'self-row').length, 0);
  ce.destroy();
  // a half-loaded app (no sidebar, no topics yet) must not be skinned
  const loading = makeDom({ kind: 'loading' });
  const cl = boot({ document: loading.window.document, window: loading.window, logger: quiet() });
  await sleep(300);
  assert.equal(cl.getStatus().state, 'waiting');
  assert.equal(loading.window.document.documentElement.hasAttribute('data-sf-on'), false);
  cl.destroy();
  const dom = makeDom({ kind: 'login' });
  const c = boot({ document: dom.window.document, window: dom.window, logger: quiet() });
  await sleep(400);
  assert.equal(c.getStatus().state, 'waiting');
  assert.equal(dom.window.document.documentElement.hasAttribute('data-sf-on'), false, 'CSS is not enabled on a non-chat page');
  c.destroy();
  const blank = makeDom({ html: '<!doctype html><html><body></body></html>' });
  const c2 = boot({ document: blank.window.document, window: blank.window, logger: quiet() });
  c2.refresh();
  await sleep(300);
  assert.equal(c2.getStatus().active, false);
  c2.destroy();
});

test('wrong host: inert controller, nothing set', () => {
  const dom = makeDom({ url: 'https://example.com/' });
  const c = boot({ document: dom.window.document, window: dom.window, logger: quiet() });
  assert.deepEqual(c.getStatus(), { state: 'inactive', reason: 'wrong-host', active: false });
  assert.equal(dom.window.document.documentElement.getAttributeNames().filter((n) => n.startsWith('data-sf')).length, 0);
  c.destroy();
});

test('MutationObserver: messages added later are tagged; login page activates once chat DOM appears', async () => {
  const { doc, window, c } = await start({ messages: [{ who: 'other', name: 'Alice Tanaka', time: '9:41 AM', text: 'first' }] });
  const n0 = tagged(doc, 'bubble').length;
  const column = doc.getElementById('column');
  const wrap = doc.createElement('div');
  wrap.innerHTML = '<c-wiz data-topic-id="late" style="display:block"><div data-w="700" style="display:flex;flex-direction:column;align-items:flex-end"><div style="background-color:rgb(211,227,253);border-radius:16px;padding:8px">late self</div></div></c-wiz>';
  column.appendChild(wrap.firstElementChild);
  assert.ok(await until(() => tagged(doc, 'bubble').length > n0), 'new bubble tagged');
  assert.ok(await until(() => tagged(doc, 'self-row').length === 1), 'new self-row tagged');
  c.destroy();

  const login = makeDom({ kind: 'login' });
  const c2 = boot({ document: login.window.document, window: login.window, logger: quiet() });
  await sleep(100);
  assert.equal(c2.getStatus().active, false);
  login.window.document.body.innerHTML = makeDom().window.document.body.innerHTML;
  assert.ok(await until(() => c2.getStatus().active), 'activates when the base DOM shows up');
  c2.destroy();
  void window;
});

test('re-render: dropped tags are restored on the next pass', async () => {
  const { doc, c } = await start();
  const topic = doc.querySelector('[data-topic-id="topic-1"]');
  const fresh = topic.cloneNode(true);
  for (const el of fresh.querySelectorAll('[data-slackify]')) el.removeAttribute('data-slackify');
  topic.replaceWith(fresh);
  assert.ok(await until(() => fresh.querySelector('[data-slackify="self-row"]')), 'self-row re-tagged after re-render');
  c.destroy();
});

test('re-initialisation: no duplicate observers, previous instance torn down', async () => {
  const dom = makeDom();
  const { window } = dom;
  let live = 0;
  const RealMO = window.MutationObserver;
  window.MutationObserver = class extends RealMO {
    constructor(cb) { super(cb); this._cb = cb; }
    observe(...a) { if (!this._on) { this._on = true; live++; } return super.observe(...a); }
    disconnect() { if (this._on) { this._on = false; live--; } return super.disconnect(); }
  };
  const logger = quiet();
  const c1 = boot({ document: window.document, window, logger });
  await until(() => c1.getStatus().active);
  const afterFirst = live;
  const c2 = boot({ document: window.document, window, logger });
  await until(() => c2.getStatus().active);
  assert.equal(c1.getStatus().state, 'destroyed');
  assert.equal(live, afterFirst, 'observer count unchanged after re-boot');
  assert.equal(tagged(window.document, 'rail').length, 1);
  c2.destroy();
  assert.equal(live, 0, 'all observers released');
});

test('destroy(): observers released, attributes removed, nothing runs afterwards', async () => {
  const { dom, window, doc, c } = await start();
  c.destroy();
  assert.equal(c.getStatus().state, 'destroyed');
  assert.deepEqual(doc.documentElement.getAttributeNames().filter((n) => n.startsWith('data-sf')), []);
  assert.equal(doc.querySelectorAll('[data-slackify], [data-slackify-wide]').length, 0);
  assert.equal(doc.documentElement.style.getPropertyValue('--sf-self-avatar'), '');
  let writes = 0;
  const orig = window.Element.prototype.setAttribute;
  window.Element.prototype.setAttribute = function (...a) { writes++; return orig.apply(this, a); };
  let csCalls = 0;
  const ocs = window.getComputedStyle.bind(window);
  window.getComputedStyle = (...a) => { csCalls++; return ocs(...a); };
  const col = doc.getElementById('column');
  for (let i = 0; i < 5; i++) col.appendChild(doc.createElement('div'));
  doc.body.setAttribute('data-theme', 'dark');
  window.dispatchEvent(new window.Event('resize'));
  await sleep(400);
  window.Element.prototype.setAttribute = orig;
  assert.equal(writes, 1 /* the test's own body write */, 'no runtime writes after destroy');
  assert.equal(csCalls, 0);
  assert.equal(doc.documentElement.hasAttribute('data-sf-mode'), false);
  assert.doesNotThrow(() => { c.destroy(); c.refresh(); });
  void dom;
});

test('mutation storm coalesces into few passes', async () => {
  const { doc, c } = await start();
  const before = c.getStatus().passes;
  const col = doc.getElementById('column');
  for (let i = 0; i < 500; i++) col.appendChild(doc.createElement('span'));
  await sleep(600);
  const passes = c.getStatus().passes - before;
  assert.ok(passes >= 1 && passes <= 6, `expected few passes, got ${passes}`);
  c.destroy();
});

test('theme: light/dark follow body[data-theme] live; OS fallback', async () => {
  const { doc, c } = await start({ mode: 'light' });
  assert.equal(doc.documentElement.getAttribute('data-sf-mode'), 'light');
  assert.equal(doc.documentElement.getAttribute('data-sf-theme'), 'aubergine');
  doc.body.setAttribute('data-theme', 'dark');
  assert.ok(await until(() => doc.documentElement.getAttribute('data-sf-mode') === 'dark'));
  c.destroy();
});

test('mail.google.com/chat/ (Ferdium "Google Chat" recipe) is a target; other Gmail paths are not', async () => {
  const on = makeDom({ url: 'https://mail.google.com/chat/u/0/' });
  const c = boot({ document: on.window.document, window: on.window, logger: quiet() });
  assert.ok(await until(() => c.getStatus().active));
  assert.equal(tagged(on.window.document, 'rail').length, 1);
  // SPA navigation away from /chat/ switches the skin off
  on.window.history.pushState({}, '', '/mail/u/0/');
  on.window.document.getElementById('column').appendChild(on.window.document.createElement('div'));
  assert.ok(await until(() => !on.window.document.documentElement.hasAttribute('data-sf-on')));
  on.window.history.pushState({}, '', '/chat/u/0/');
  on.window.document.getElementById('column').appendChild(on.window.document.createElement('div'));
  assert.ok(await until(() => on.window.document.documentElement.hasAttribute('data-sf-on')));
  c.destroy();
  for (const url of ['https://mail.google.com/mail/u/0/', 'https://mail.google.com/chatter', 'https://chat.google.com.evil.example/']) {
    const off = makeDom({ url });
    const c2 = boot({ document: off.window.document, window: off.window, logger: quiet() });
    assert.equal(c2.getStatus().reason, 'wrong-host', url);
  }
});

test('the hangouts recipe unread hooks (data-shortcut-type, data-is-unread) are left untouched', async () => {
  const dom = makeDom({ url: 'https://mail.google.com/chat/u/0/' });
  const doc = dom.window.document;
  doc.querySelector('[role="banner"]').insertAdjacentHTML('beforeend', '<div data-shortcut-type="1" aria-label="Home shortcut, 3 unread messages"><span>3</span></div>');
  const el = doc.querySelector('[data-shortcut-type="1"]');
  const before = el.outerHTML;
  const unread = Array.from(doc.querySelectorAll('span[data-is-unread="true"], [data-is-unread="true"]')).map((e) => e.getAttribute('data-is-unread'));
  const c = boot({ document: doc, window: dom.window, logger: quiet() });
  await until(() => c.getStatus().active);
  assert.equal(el.outerHTML, before);
  assert.deepEqual(Array.from(doc.querySelectorAll('[data-is-unread="true"]')).map((e) => e.getAttribute('data-is-unread')), unread);
  c.destroy();
});
