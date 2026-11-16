// Sender attribution: our synthetic "own message" name/avatar must never be another participant's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../../src/runtime/entry.js';
import { createLogger } from '../../src/runtime/diagnostics.js';
import { makeDom, until, tagged, sleep } from './helpers.mjs';

const quiet = () => createLogger({ console: { warn() {}, debug() {} } });
const start = async (opts = {}) => {
  const dom = makeDom(opts);
  const c = boot({ document: dom.window.document, window: dom.window, logger: quiet() });
  assert.ok(await until(() => c.getStatus().active));
  await sleep(60);
  return { dom, doc: dom.window.document, window: dom.window, c };
};
const selfName = (doc) => doc.documentElement.style.getPropertyValue('--sf-self-name');
const selfAvatar = (doc) => doc.documentElement.style.getPropertyValue('--sf-self-avatar');
const ALICE_FIRST = [
  { who: 'other', name: 'Alice Tanaka', time: '9:41 AM', text: 'hi' },
  { who: 'other', name: 'Bob Sato', time: '9:42 AM', text: 'hello' },
  { who: 'self', name: 'Jane Doe', time: '9:43 AM', text: 'mine' },
];
const OTHERS_ONLY = ALICE_FIRST.slice(0, 2);

test('account button is the preferred source; other participants are never used', async () => {
  const { doc, c } = await start({ messages: ALICE_FIRST });
  assert.equal(selfName(doc), '"Jane Doe"');
  assert.match(selfAvatar(doc), /^url\("data:image/);
  c.destroy();
});

test('every sender span flagged data-compare-to-self-user (not exclusive to me): first match (Alice) is NOT used', async () => {
  for (const flagAll of [true, false]) {
    const { doc, c } = await start({ messages: ALICE_FIRST, account: false, flagAll });
    assert.equal(doc.querySelector('[data-compare-to-self-user="true"][data-name]').getAttribute('data-name'), flagAll ? 'Alice Tanaka' : 'Jane Doe', 'fixture sanity');
    // the only evidence: the native name inside the row we identified as ours
    assert.equal(selfName(doc), '"Jane Doe"', `flagAll=${flagAll}`);
    assert.notEqual(selfName(doc), '"Alice Tanaka"');
    c.destroy();
  }
});

test('no reliable source -> neutral label, never a participant name', async () => {
  // account button missing, own message has no native name, flag on everything
  const { doc, c } = await start({ messages: ALICE_FIRST, account: false, flagAll: true, selfName: 'none' });
  assert.equal(selfName(doc), '"You"');
  assert.equal(selfAvatar(doc), '', 'no avatar copied from anyone');
  c.destroy();
  // only other people in the conversation
  const o = await start({ messages: OTHERS_ONLY, account: false, flagAll: true });
  assert.equal(selfName(o.doc), '"You"');
  assert.equal(tagged(o.doc, 'self-row').length, 0);
  o.c.destroy();
  // Japanese UI -> 自分
  const ja = await start({ messages: OTHERS_ONLY, account: false, lang: 'ja' });
  assert.equal(selfName(ja.doc), '"自分"');
  ja.c.destroy();
});

test('ambiguous evidence (self rows disagree) -> neutral', async () => {
  const msgs = [
    { who: 'self', name: 'Jane Doe', keepName: true, time: '9:41 AM', text: 'a' },
    { who: 'self', name: 'Somebody Else', keepName: true, time: '9:42 AM', text: 'b' },
  ];
  const { doc, c } = await start({ messages: msgs, account: false });
  assert.equal(tagged(doc, 'self-row').length, 2);
  assert.equal(selfName(doc), '"You"');
  c.destroy();
});

test('account name wins over row evidence and updates when the account changes (no stale value)', async () => {
  const { doc, window, c } = await start({ messages: ALICE_FIRST, selfLabel: 'Jane Doe' });
  assert.equal(selfName(doc), '"Jane Doe"');
  doc.querySelector('[role="banner"] a').setAttribute('aria-label', 'Google Account: Taro Yamada\n(taro@example.com)');
  doc.getElementById('column').appendChild(doc.createElement('div'));
  assert.ok(await until(() => selfName(doc) === '"Taro Yamada"'));
  doc.querySelector('[role="banner"] a').remove();                 // signed out / button gone
  doc.getElementById('column').appendChild(doc.createElement('div'));
  assert.ok(await until(() => selfName(doc) === '"Jane Doe"' || selfName(doc) === '"You"'), 'falls back, never keeps stale Taro');
  assert.notEqual(selfName(doc), '"Taro Yamada"');
  assert.equal(selfAvatar(doc), '');
  c.destroy();
  void window;
});

test('conversation switch resets row-derived names (no stale identity)', async () => {
  const { doc, window, c } = await start({ messages: ALICE_FIRST, account: false });
  assert.equal(selfName(doc), '"Jane Doe"');
  // switch to another conversation whose visible self message carries a different native name
  const main = doc.querySelector('[role="main"]');
  main.setAttribute('data-group-id', 'space/beta');
  const column = doc.getElementById('column');
  column.innerHTML = '<c-wiz data-topic-id="b1" style="display:block"><div data-w="668" style="display:flex;flex-direction:column;align-items:flex-end"><span data-name="Jane D." data-is-message="true" style="position:absolute;width:1px;height:1px;overflow:hidden"><span>Jane D.</span></span><div style="background-color:rgb(211,227,253);border-radius:16px;padding:8px">hi</div></div></c-wiz>';
  assert.ok(await until(() => selfName(doc) === '"Jane D."'), `got ${selfName(doc)}`);
  // and a conversation with no own message at all returns to neutral instead of keeping a previous name
  main.setAttribute('data-group-id', 'space/gamma');
  column.innerHTML = '<c-wiz data-topic-id="g1" style="display:block"><div data-w="668" style="display:flex"><span data-name="Alice Tanaka" data-is-message="true"><span>Alice Tanaka</span></span><div style="background-color:rgb(241,243,244);border-radius:16px;padding:8px">hey</div></div></c-wiz>';
  assert.ok(await until(() => selfName(doc) === '"You"'), `got ${selfName(doc)}`);
  c.destroy();
  void window;
});

test('re-rendered own message keeps one correct identity and never adopts another participant', async () => {
  const { doc, c } = await start({ messages: ALICE_FIRST, account: false, flagAll: true });
  const own = doc.querySelector('[data-topic-id="topic-2"]');
  const fresh = own.cloneNode(true);
  for (const el of fresh.querySelectorAll('[data-slackify]')) el.removeAttribute('data-slackify');
  own.replaceWith(fresh);
  assert.ok(await until(() => fresh.querySelector('[data-slackify="self-row"]')));
  assert.equal(selfName(doc), '"Jane Doe"');
  // other participants keep their own native names and are never tagged as self
  for (const id of ['topic-0', 'topic-1']) assert.equal(doc.querySelector(`[data-topic-id="${id}"] [data-slackify="self-row"]`), null);
  assert.deepEqual(Array.from(doc.querySelectorAll('[data-topic-id] span[data-name]')).map((e) => e.textContent).slice(0, 2), ['Alice Tanaka', 'Bob Sato']);
  c.destroy();
});

test('both users in one conversation: attribution stays separate; native visible name suppresses the synthetic one', async () => {
  const { doc, c } = await start({ selfName: 'visible' });
  assert.equal(selfName(doc), '"Jane Doe"');
  const rows = tagged(doc, 'self-row');
  assert.ok(rows.length >= 3);
  assert.ok(rows.every((r) => r.hasAttribute('data-sf-native-name')), 'Google already shows a name -> no duplicate');
  assert.equal(doc.querySelectorAll('[data-topic-id="topic-0"] [data-slackify="self-row"]').length, 0);
  c.destroy();
  const h = await start({ selfName: 'hidden' });
  assert.ok(tagged(h.doc, 'self-row').every((r) => !r.hasAttribute('data-sf-native-name')), 'sr-only name does not count as visible');
  h.c.destroy();
});

test('Chat content is never modified by identity handling', async () => {
  const dom = makeDom({ messages: ALICE_FIRST, account: false, flagAll: true });
  const doc = dom.window.document;
  const names = () => Array.from(doc.querySelectorAll('[data-name]')).map((e) => `${e.getAttribute('data-name')}|${e.textContent}|${e.getAttribute('data-member-id')}`);
  const before = names();
  const c = boot({ document: doc, window: dom.window, logger: quiet() });
  await until(() => c.getStatus().active); await sleep(80);
  assert.deepEqual(names(), before);
  c.destroy();
  assert.equal(doc.documentElement.style.getPropertyValue('--sf-self-name'), '');
});
