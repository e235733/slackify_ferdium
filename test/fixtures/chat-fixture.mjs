// Synthetic stand-in for the Google Chat DOM, used by the jsdom and Playwright tests.
// It is modelled on the selectors the pinned Slackify config.js relies on (role/data-* hooks).
// It is NOT a capture of the real Google Chat and passing against it proves nothing about production.
//
// All layout-relevant styles are inline so jsdom (computed style) and Chromium (real layout) agree.
// `data-w` carries the intended width for jsdom, which has no layout engine.

const PALETTE = {
  light: { page: 'rgb(255,255,255)', text: 'rgb(32,33,36)', other: 'rgb(241,243,244)', self: 'rgb(211,227,253)', rail: 'rgb(248,250,253)', composer: 'rgb(255,255,255)', border: 'rgb(218,220,224)' },
  dark: { page: 'rgb(32,33,36)', text: 'rgb(232,234,237)', other: 'rgb(60,64,67)', self: 'rgb(0,57,107)', rail: 'rgb(40,42,44)', composer: 'rgb(48,49,52)', border: 'rgb(95,99,104)' },
};

const AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='36' height='36' fill='%236b4fbb'/></svg>";
const SELF_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' fill='%23118a7e'/></svg>#googleusercontent.com";

const LABELS = {
  en: { today: 'Today', yesterday: 'Yesterday', weekday: 'Monday, Oct 21', replies: (n) => `${n} replies`, unread: 'New' },
  ja: { today: '今日', yesterday: '昨日', weekday: '月曜日, 10月21日', replies: (n) => `${n}件の返信`, unread: '新着' },
};

export const DEFAULT_MESSAGES = [
  { who: 'other', name: 'Alice Tanaka', time: '9:41 AM', text: 'Morning! Did the deploy go out?', dateBefore: 'yesterday' },
  { who: 'self', name: 'Jane Doe', time: '9:42 AM', text: 'Yes, it finished a few minutes ago.', dateBefore: null },
  { who: 'other', name: 'Alice Tanaka', time: '9:43 AM', text: 'Great, thanks. Here is the config I used:', code: true, reactions: [{ emoji: '👍', count: 3 }] },
  { who: 'self', name: 'Jane Doe', time: '9:44 AM', text: 'A second message from me in a row, long enough to wrap onto several lines so that we can see how the full width layout treats a paragraph of text that keeps going and going.', grouped: true },
  { who: 'other', name: 'Bob Sato', time: '9:50 AM', text: '今日', dateBefore: 'today', thread: 2 },
  { who: 'self', name: 'Jane Doe', time: '9:51 AM', text: 'Quote: > keep it simple', reactions: [{ emoji: '🎉', count: 1 }] },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function messageHtml(m, i, P, o = {}) {
  const bubbleBg = m.who === 'self' ? P.self : P.other;
  const ts = `<span data-absolute-timestamp="${1729760000000 + i * 60000}" data-format="2" data-w="60" style="font-size:11px;margin-left:8px;${m.grouped ? 'display:none;' : ''}">${esc(m.time)}</span>`;
  // identity fixtures: `flagAll` puts data-compare-to-self-user="true" on EVERY sender span (the attribute is not known to be
  // exclusive to the current user); `selfName`: 'hidden' (screen-reader-only span), 'visible', or 'none' (no native name).
  const flag = (m.who === 'self' || o.flagAll) ? ' data-compare-to-self-user="true"' : '';
  const hiddenCss = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  const nameSpan = m.who === 'self'
    ? (o.selfName === 'none' ? '' : `<span${flag} data-name="${esc(m.name)}" data-hovercard-id="jane@example.com" data-member-id="user/human/123" data-is-message="true" ${o.selfName === 'visible' ? 'data-w="80"' : ''} style="${o.selfName === 'visible' ? 'font-size:12px' : hiddenCss}"><span>${esc(m.name)}</span></span>`)
    : `<span${flag} data-name="${esc(m.name)}" data-member-id="user/human/${esc(m.name.length)}" data-is-message="true" style="font-size:12px"><span>${esc(m.name)}</span></span>`;
  const code = m.code ? '<pre style="font-family:monospace;margin:6px 0 0;padding:6px;overflow:auto"><code>const x = 1;\nnpm run build</code></pre>' : '';
  const body = `<div data-message-id="msg-${i}" style="background-color:${bubbleBg};border-radius:16px;padding:8px 12px;max-width:min(90%, 640px)"><span>${esc(m.text)}</span>${code}</div>`;
  const reactions = (m.reactions || []).length
    ? `<div data-w="300" style="display:flex;gap:4px;margin-top:4px">${m.reactions.map((r) => `<div><button role="button" aria-label="${r.emoji} ${r.count}" style="display:inline-flex;align-items:center;border:1px solid ${P.border};background:transparent;color:inherit"><img data-emoji="${r.emoji}" width="16" height="16" alt="${r.emoji}" src="${AVATAR}"><span>${r.count}</span></button></div>`).join('')}<div><button aria-label="Add reaction" style="border:1px solid ${P.border};background:transparent;color:inherit"><span>+</span></button></div></div>`
    : '';
  const thread = m.thread
    ? `<div data-last-reply-time-msec="1729760100000" data-w="300"><div role="button" tabindex="0" style="cursor:pointer"><span>${esc(m.threadLabel)}</span><span> Last reply 9:55 AM</span></div></div>`
    : '';
  const inner = `<div>${nameSpan}${ts}</div>${body}${reactions}${thread}`;
  if (m.who === 'self') {
    return `<c-wiz data-topic-id="topic-${i}" style="display:block"><div data-w="700" style="padding:4px 16px"><div data-w="668" style="display:flex;flex-direction:column;align-items:flex-end">${inner}</div></div></c-wiz>`;
  }
  return `<c-wiz data-topic-id="topic-${i}" style="display:block"><div data-w="700" style="padding:4px 16px"><div data-w="668" style="display:flex;align-items:center"><div data-w="36" style="width:36px;height:36px;border-radius:50%;overflow:hidden;flex:none;margin-right:12px"><img width="36" height="36" alt="" src="${AVATAR}"></div><div>${inner}</div></div></div></c-wiz>`;
}

function railHtml(P) {
  const row = (gid, name, unread, count) => `<div role="listitem" data-group-id="${gid}"${unread ? ' data-is-unread="true"' : ''} data-w="256" style="display:flex;align-items:center;height:36px;padding:0 12px"><div data-w="24" style="width:24px;height:24px;border-radius:50%;overflow:hidden;margin-right:8px"><img width="24" height="24" alt="" src="${AVATAR}"></div><span role="presentation">${esc(name)}</span>${count ? `<span class="badge" style="margin-left:auto">${count}</span>` : ''}</div>`;
  return `<c-wiz data-w="256" style="display:block;width:256px;flex:none;background-color:${P.rail};overflow:hidden">
    <div data-section-type="1" data-w="256"><span>Direct messages</span><div class="TeR7uc" id="unread-dm">3</div></div>
    <div role="list" aria-label="List of Direct Messages" data-w="256">
      ${row('dm/alice', 'Alice Tanaka', true, 2)}
      ${row('dm/bob', 'Bob Sato', false, 0)}
    </div>
    <div data-section-type="2" data-w="256"><span>Spaces</span><div class="TeR7uc" id="unread-space">12</div></div>
    <div role="list" aria-label="List of spaces." data-w="256">
      ${row('space/alpha', 'Project Alpha', true, 10)}
      ${row('space/beta', 'Beta Team', false, 0)}
    </div>
  </c-wiz>`;
}

/**
 * @param {{mode?: 'light'|'dark', lang?: 'en'|'ja', kind?: 'dm'|'space'|'empty'|'loading'|'login', messages?: object[], count?: number, osDark?: boolean}} opts
 */
export function renderFixture({ mode = 'light', lang = 'en', kind = 'space', messages, count, account = true, flagAll = false, selfName = 'hidden', bottom = 'block', selfLabel = 'Jane Doe', composerText = '', composerKind = 'simple', wrapDir = 'row' } = {}) {
  const P = PALETTE[mode];
  const L = LABELS[lang];
  if (kind === 'login') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body style="margin:0"><form><input type="email"><input type="password"></form></body></html>`;
  }
  let msgs = messages || DEFAULT_MESSAGES;
  if (count) {
    msgs = Array.from({ length: count }, (_, i) => ({ who: i % 2 ? 'self' : 'other', name: i % 2 ? 'Jane Doe' : 'Alice Tanaka', time: '9:41 AM', text: `Message ${i} ${'lorem ipsum '.repeat(i % 5)}` }));
  }
  msgs = msgs.map((m) => (m.thread ? { ...m, threadLabel: L.replies(m.thread) } : m));
  const gid = kind === 'dm' ? 'dm/alice' : 'space/alpha';
  const title = kind === 'dm' ? 'Alice Tanaka' : 'Project Alpha';
  const dateRow = (label) => `<div role="heading" aria-level="2" data-w="700" style="display:flex;justify-content:center;padding:8px 0"><span data-absolute-timestamp="1729700000000" data-format="3" data-w="80">${esc(label)}</span></div>`;
  let stream = '';
  if (kind === 'space' || kind === 'dm') {
    msgs.forEach((m, i) => {
      if (m.dateBefore) stream += dateRow(L[m.dateBefore] || m.dateBefore);
      stream += messageHtml(m.who === 'self' && !m.keepName ? { ...m, name: selfLabel } : m, i, P, { flagAll, selfName });
      if (i === 1) stream += `<div data-w="700" style="padding:4px 16px"><span>${esc(L.weekday)}</span></div>`;
    });
    stream += `<div role="heading" aria-level="2" data-w="700" style="display:flex;align-items:center"><div data-w="600" style="width:600px;height:12px"><svg width="600" height="12"><path d="M0 6 Q 5 0 10 6 T 20 6" stroke="blue" fill="none"/></svg></div><div>${esc(L.unread)}</div></div>`;
  } else if (kind === 'loading') {
    stream = '<div style="height:200px" aria-busy="true"></div>';
  } else {
    stream = '<div style="padding:40px;text-align:center"><span>No messages yet</span></div>';
  }
  return `<!doctype html><html lang="${lang === 'ja' ? 'ja' : 'en'}"><head><meta charset="utf-8"><title>Chat</title></head>
<body data-theme="${mode}" style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:${P.text};background-color:${P.page}">
<header role="banner" data-w="1280" style="height:48px;display:flex;align-items:center;padding:0 16px;background-color:${P.page}">
  <img src="${AVATAR}#chatlogo" width="24" height="24" alt="Chat">
  <div role="search" style="margin:0 auto;width:400px"><input type="text" aria-label="Search" style="width:100%"></div>
  ${account ? `<a href="#" aria-label="Google Account: ${esc(selfLabel)}&#10;(jane@example.com)"><img src="${SELF_AVATAR}" width="32" height="32" alt="" style="border-radius:50%"></a>` : ''}
</header>
<div id="app" data-w="1280" style="display:flex;height:calc(100vh - 48px)">
  ${kind === 'loading' ? '' : railHtml(P)}
  <div role="main" data-group-id="${gid}" data-w="1024" style="flex:1;display:flex;flex-direction:column;min-width:0;background-color:${P.page}">
    <div id="convo-header" style="height:56px;display:flex;align-items:center;padding:0 16px;flex:none">
      <button aria-haspopup="menu" data-w="200" style="background:none;border:0;color:inherit;display:flex;align-items:center"><span style="font-size:20px">${esc(title)}</span></button>
    </div>
    <div id="scroller" style="flex:1;overflow-y:auto;overflow-x:hidden">
      <div id="column" data-w="700" style="max-width:700px;margin:0 auto">${stream}</div>
    </div>
    <div id="bottom" data-w="1024" style="flex:none;padding:8px 0 16px;${bottom === 'block' ? '' : bottom === 'grid' ? 'display:grid;grid-template-rows:1fr;height:200px;box-sizing:border-box' : `display:flex;flex-direction:${bottom};height:200px;box-sizing:border-box`}">
     <div id="composer-outer" data-w="1024" style="display:flex;flex-direction:${wrapDir};${wrapDir === 'row' ? 'justify-content:center' : 'align-items:center'};width:100%">
      ${composerKind === 'google' ? googleComposer(P, composerText) : composerKind === 'rich' ? richComposer(P, composerText) : simpleComposer(P, composerText)}
     </div>
    </div>
  </div>
</div>
</body></html>`;
}

export const FIXTURE_KINDS = ['dm', 'space', 'empty', 'loading', 'login'];

function simpleComposer(P, text) {
  return `<div id="composer-box" data-w="800" style="background-color:${P.composer};border:1px solid ${P.border};border-radius:24px;padding:8px 12px;display:flex;align-items:center;box-sizing:border-box;max-width:900px;width:100%">
        <div role="textbox" contenteditable="true" aria-label="History is on" data-w="700" tabindex="0" style="flex:1;min-height:24px;outline-offset:2px">${esc(text)}</div>
        <button id="send" aria-label="Send message" data-w="32" style="width:32px;height:32px;margin-left:8px">&gt;</button>
      </div>`;
}

// Heavier, Google-like guess: padded card holding an editor row (with min-height) and a separate toolbar row.
// The structure is an assumption (not a capture); tests use it to check that Slackify never makes it TALLER than native.
function richComposer(P, text) {
  const btn = (id, label) => `<button ${id ? `id="${id}"` : ''} aria-label="${label}" data-w="32" style="width:32px;height:32px;margin-right:4px">&#8226;</button>`;
  return `<div id="composer-box" data-w="800" style="background-color:${P.composer};border:1px solid ${P.border};border-radius:24px;padding:12px 16px;display:flex;flex-direction:column;box-sizing:border-box;max-width:900px;width:100%">
        <div id="editor-row" data-w="700" style="display:flex;align-items:center;min-height:40px;padding:4px 0">
          <div role="textbox" contenteditable="true" aria-label="History is on" data-w="680" tabindex="0" style="flex:1;min-height:24px;outline-offset:2px">${esc(text)}</div>
        </div>
        <div id="toolbar" data-w="700" style="display:flex;align-items:center;height:36px;margin-top:4px">${btn('attach', 'Attach')}${btn('emoji', 'Emoji')}${btn('fmt', 'Format')}<span style="flex:1"></span>${btn('send', 'Send message')}</div>
      </div>`;
}

// Mirrors the real chain reported by docs/composer-diagnostic.js (v2) on a real Ferdium Google Chat service
// (heights/min-heights/padding/flex values copied from that table; class names and text omitted). d<N> = depth above the textbox.
// Native card height there was 104px = padding 16 + 64 + 24; this fixture reproduces that number without the skin.
// The wrapper (#composer-outer, d9) is the parent of the card; a Slackify run tags d8 "composer" and d5/d6 "composer-pill".
function googleComposer(P, text) {
  const circle = (w, h, id) => `<button ${id ? `id="${id}"` : ''} data-w="${w}" style="width:${w}px;height:${h}px;flex:none;margin-left:4px;border:0;background:transparent;color:inherit">&#8226;</button>`;
  return `<div id="composer-box" data-w="998" style="display:flex;flex-direction:column;box-sizing:border-box;width:calc(100% - 32px);margin:0 16px;padding:16px 0 24px;background-color:${P.composer};border-radius:16px">
        <div id="d7" data-w="948" style="display:flex;flex-direction:column;min-height:0;position:static">
         <div id="d6" data-w="948" style="display:flex;flex-direction:row;min-height:48px;position:relative;border-radius:24px">
          <div id="d5" data-w="840" style="display:flex;flex-direction:row;justify-content:flex-end;align-items:center;flex-grow:1;min-height:64px;position:relative;border-radius:24px">
           <div id="d4" data-w="654" style="display:flex;flex-direction:row;align-items:center;flex-grow:1;min-height:64px;box-sizing:border-box">
            <div id="d3" data-w="654" style="display:flex;flex-direction:row;align-items:stretch;align-self:stretch;flex-grow:1">
             <div id="d2" data-w="654" style="display:flex;flex-direction:column;justify-content:center;overflow:auto;flex:1">
              <div id="d1" data-w="654" style="position:relative;padding:12px;overflow:auto;max-height:207px">
               <div role="textbox" contenteditable="true" data-w="622" tabindex="0" style="min-height:21px;line-height:21px;outline-offset:2px">${esc(text)}</div>
              </div>
             </div>
            </div>
           </div>
           <div id="toolbar" data-w="300" style="display:flex;align-items:center;height:54px;flex:none">${circle(32, 32)}${circle(32, 32)}${circle(32, 32)}${circle(32, 32)}${circle(32, 32)}${circle(22, 48)}${circle(38, 48, 'send')}</div>
          </div>
         </div>
        </div>
      </div>`;
}
