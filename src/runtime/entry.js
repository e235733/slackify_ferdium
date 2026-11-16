// boot(): wires theme, tagger and scheduler together and returns a Controller.
import { DEFAULT_SETTINGS } from './settings.js';
import { createSelectorApi } from './selectors.js';
import { applyTheme, applyMode, clearTheme, watchTheme } from './theme.js';
import { createScheduler } from './scheduler.js';
import { createTagger } from './tagger.js';
import { createLogger } from './diagnostics.js';

export const TARGET_HOST = 'chat.google.com';
// Ferdium's "Google Chat" recipe (id: hangouts) loads https://mail.google.com/chat/; upstream Slackify also matches it.
export const isTargetLocation = (loc) => !!loc && (loc.hostname === TARGET_HOST ||
  (loc.hostname === 'mail.google.com' && /^\/chat(\/|$)/.test(loc.pathname || '')));
const GUARD = Symbol.for('ferdium-gchat-slackify.controller');

function inertController(state, reason) {
  return {
    destroy() {},
    refresh() {},
    getStatus: () => ({ state, reason, active: false }),
  };
}

export function boot({ document: doc = globalThis.document, window: win = globalThis.window, settings = DEFAULT_SETTINGS, logger } = {}) {
  const log = logger || createLogger();
  try {
    if (!doc || !win || !doc.documentElement) return inertController('inactive', 'no-document');

    // 1) no double start: tear down any previous instance on this window
    const prev = win[GUARD];
    if (prev) { try { prev.destroy(); } catch (e) { log.error('previous.destroy', e); } }

    // 2) host check
    let onTarget = false;
    try { onTarget = isTargetLocation(win.location); } catch { /* ignore */ }
    if (!onTarget) return inertController('inactive', 'wrong-host');
    const stillOnTarget = () => { try { return isTargetLocation(win.location); } catch { return false; } };

    const S = createSelectorApi(doc);
    let state = 'waiting';
    let passes = 0;
    let stopTheme = null;
    let destroyed = false;
    let tagger = null;

    // Base-DOM check: sidebar rows/lists or a message topic. A login page has none of these.
    const baseDomPresent = () => !!(S.firstMatchEl('convRow') || S.firstMatchEl('dmList') ||
      S.firstMatchEl('spacesList') || S.firstMatchEl('messageTopic'));

    const onTheme = () => { if (!destroyed) applyMode(doc, win); };

    function activate() {
      applyTheme(doc, settings);                       // data-sf-theme/mode/feat-*
      tagger.scanRoot(doc, { limit: tagger.INITIAL_SYNC_TOPICS });
      doc.documentElement.setAttribute('data-sf-on', '');
      if (!stopTheme) stopTheme = watchTheme(doc, win, onTheme);
      state = 'active';
    }

    const scheduler = createScheduler({
      window: win,
      logger: log,
      run(ctx) {
        passes += 1;
        if (!stillOnTarget()) {            // SPA navigated away (e.g. mail.google.com/chat/ -> Gmail): switch off
          if (state === 'active') { doc.documentElement.removeAttribute('data-sf-on'); state = 'waiting'; }
          return;
        }
        if (state === 'waiting') {
          if (baseDomPresent()) activate();
          return;
        }
        tagger.pass(ctx);
      },
    });
    tagger = createTagger({ document: doc, window: win, selectors: S, scheduler, logger: log });

    const controller = {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        state = 'destroyed';
        scheduler.stop();
        if (stopTheme) { stopTheme(); stopTheme = null; }
        tagger.destroy();
        clearTheme(doc);
        if (win[GUARD] === controller) delete win[GUARD];
      },
      refresh() {
        if (destroyed) return;
        if (state === 'waiting') { scheduler.markDirty(); return; }
        applyTheme(doc, settings);
        scheduler.markDirty();
      },
      getStatus: () => ({
        state,
        active: state === 'active',
        mode: doc.documentElement.getAttribute('data-sf-mode'),
        theme: doc.documentElement.getAttribute('data-sf-theme'),
        passes,
        errors: log.total(),
      }),
    };
    win[GUARD] = controller;

    const start = () => { if (!destroyed) scheduler.start(doc.documentElement); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    if (doc.readyState === 'loading') {
      const origDestroy = controller.destroy;
      controller.destroy = () => { doc.removeEventListener('DOMContentLoaded', start); origDestroy(); };
    }
    return controller;
  } catch (e) {
    log.error('boot', e);
    return inertController('failed', 'exception');
  }
}
