import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, DEFAULT_SETTINGS, FORCED_OFF } from '../../src/runtime/settings.js';
import { TAG_VALUES, createSelectorApi, SELECTORS } from '../../src/runtime/selectors.js';
import { detectMode } from '../../src/runtime/theme.js';
import { createScheduler } from '../../src/runtime/scheduler.js';
import { createLogger } from '../../src/runtime/diagnostics.js';
import { isDateLabel } from '../../src/runtime/tagger.js';
import { loadUpstream } from '../../src/build/generate-css.mjs';

test('settings: aubergine, upstream defaults, opt-out features forced off', () => {
  assert.equal(DEFAULT_SETTINGS.theme, 'aubergine');
  for (const id of FORCED_OFF) assert.equal(DEFAULT_SETTINGS.features[id], false, id);
  for (const id of ['typography', 'sidebar', 'topbar', 'flatten', 'fullwidth', 'density', 'rowhover', 'msgalign', 'sendername', 'selfslack', 'composer', 'datedividers', 'threadreplies', 'codestyle']) {
    assert.equal(DEFAULT_SETTINGS.features[id], true, id);
  }
  const up = loadUpstream().SLACKIFY_CONFIG;
  for (const f of up.FEATURES) {
    if (!FORCED_OFF.includes(f.id)) assert.equal(DEFAULT_SETTINGS.features[f.id], f.default, `${f.id} follows upstream default`);
  }
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
  assert.equal(createSettings({ theme: 'nope' }).theme, 'aubergine');
  assert.equal(createSettings({ features: { pills: false, bogus: true } }).features.pills, false);
  assert.equal('bogus' in createSettings({ features: { bogus: true } }).features, false);
});

test('selectors: embedded metadata equals the pinned upstream config', () => {
  const up = loadUpstream().SLACKIFY_CONFIG;
  assert.deepEqual(JSON.parse(JSON.stringify(SELECTORS)), JSON.parse(JSON.stringify(up.SELECTORS)));
  assert.equal(TAG_VALUES.rail, 'rail');
  assert.equal(TAG_VALUES.active, 'active');
  assert.equal(TAG_VALUES.selfRow, 'self-row');
  assert.equal(Object.keys(TAG_VALUES).length, Object.keys(up.TAGS).length - 1, 'every tag but the value-less msgWide');
});

test('selectors: fallback chain skips invalid selectors', () => {
  const doc = { querySelector: (s) => { if (s === 'bad') throw new Error('x'); return s === 'ok' ? { id: 1 } : null; }, querySelectorAll: () => [] };
  const api = createSelectorApi(doc, { k: ['bad', 'ok'] });
  assert.deepEqual(api.firstMatchEl('k'), { id: 1 });
  assert.equal(api.sel('k'), 'bad, ok');
  assert.deepEqual(api.allMatchEls('k'), []);
});

test('theme: detectMode order body[data-theme] > background > OS > light', () => {
  const mk = ({ theme, bg, os }) => ({
    doc: { body: { getAttribute: () => theme }, querySelector: () => ({}) },
    win: { getComputedStyle: () => ({ backgroundColor: bg || '' }), matchMedia: () => ({ matches: !!os }) },
  });
  let { doc, win } = mk({ theme: 'dark', bg: 'rgb(255,255,255)', os: false });
  assert.equal(detectMode(doc, win), 'dark');
  ({ doc, win } = mk({ theme: 'light', bg: 'rgb(0,0,0)', os: true }));
  assert.equal(detectMode(doc, win), 'light');
  ({ doc, win } = mk({ bg: 'rgb(20,20,20)', os: false }));
  assert.equal(detectMode(doc, win), 'dark');
  ({ doc, win } = mk({ bg: 'rgb(250,250,250)', os: true }));
  assert.equal(detectMode(doc, win), 'light');
  ({ doc, win } = mk({ bg: 'rgba(0,0,0,0)', os: true }));
  assert.equal(detectMode(doc, win), 'dark', 'transparent background falls through to OS');
  ({ doc, win } = mk({ bg: 'rgba(0,0,0,0)', os: false }));
  assert.equal(detectMode(doc, win), 'light');
  assert.equal(detectMode({ body: null, querySelector() { throw new Error('boom'); } }, {}), 'light');
});

function fakeWindow({ idle }) {
  const timers = []; const idles = []; let observers = 0; let cb = null; let obsDisconnects = 0;
  const w = {
    timers, idles,
    setTimeout: (f) => { timers.push(f); return timers.length; },
    clearTimeout: (h) => { timers[h - 1] = null; },
    MutationObserver: class { constructor(f) { cb = f; observers++; } observe() {} disconnect() { obsDisconnects++; } },
    fire: () => cb(),
    get observers() { return observers; },
    get disconnects() { return obsDisconnects; },
  };
  if (idle) {
    w.requestIdleCallback = (f) => { idles.push(f); return idles.length; };
    w.cancelIdleCallback = (h) => { idles[h - 1] = null; };
  }
  return w;
}

test('scheduler: bursts coalesce into a single scheduled run (idle)', () => {
  const w = fakeWindow({ idle: true });
  const runs = [];
  const s = createScheduler({ window: w, run: (c) => runs.push(c.dirty), logger: createLogger({ console: null }) });
  s.start({});
  for (let i = 0; i < 1000; i++) w.fire();
  s.markDirty(); s.queueTopic({});
  assert.equal(w.idles.length, 1, 'exactly one pending idle callback');
  w.idles[0]({ timeRemaining: () => 10 });
  assert.deepEqual(runs, [true]);
  assert.equal(w.idles.length, 2, 'leftover topic queue reschedules');
  w.idles[1]({ timeRemaining: () => 10 }); // topics not consumed by this fake run -> keeps rescheduling
  s.stop();
});

test('scheduler: setTimeout fallback with time budget; stop() cancels everything', () => {
  const w = fakeWindow({ idle: false });
  const seen = [];
  const s = createScheduler({ window: w, run: ({ deadline }) => seen.push(deadline.timeRemaining()), logger: createLogger({ console: null }) });
  s.start({});
  assert.equal(w.timers.length, 1);
  w.timers[0]();
  assert.ok(seen[0] <= 8 && seen[0] >= 0, 'budget is bounded (<= 8ms)');
  s.markDirty();
  assert.equal(w.timers.length, 2);
  s.stop();
  assert.equal(w.timers[1], null, 'pending timer cleared');
  assert.equal(w.disconnects, 1);
  s.markDirty(); s.queueTopic({});
  assert.equal(w.timers.length, 2, 'nothing scheduled after stop');
});

test('scheduler: a throwing run is contained and logged', () => {
  const w = fakeWindow({ idle: true });
  const warns = [];
  const s = createScheduler({ window: w, run() { throw new TypeError('secret message text'); }, logger: createLogger({ console: { warn: (m) => warns.push(m) } }) });
  s.start({});
  assert.doesNotThrow(() => w.idles[0]({ timeRemaining: () => 10 }));
  assert.equal(warns.length, 1);
  assert.ok(!warns[0].includes('secret'));
});

test('diagnostics: bounded, content-free', () => {
  const warns = [];
  const l = createLogger({ console: { warn: (m) => warns.push(m), debug: () => warns.push('debug') } });
  for (let i = 0; i < 50; i++) l.error('scan', new RangeError('message body: hello alice@example.com'));
  assert.equal(warns.length, 3);
  assert.ok(warns.every((w) => !/alice|hello/.test(w)));
  l.debug('x');
  assert.equal(warns.length, 3, 'debug is off by default');
  assert.equal(l.total(), 50);
});

test('isDateLabel: English, limited Japanese, and rejects look-alikes', () => {
  for (const ok of ['Today', 'Yesterday', 'Monday, Oct 21', '今日', '昨日', '月曜日, 10月21日', '火曜日、10月22日']) assert.ok(isDateLabel(ok), ok);
  for (const no of ['today', 'Todays', 'Monday', '今日は', 'いつ今日', '月曜日', '昨日の件', 'Today is fine', '']) assert.ok(!isDateLabel(no), no);
});
