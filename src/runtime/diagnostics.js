// Console-only diagnostics. Never logs DOM content, message text, or error messages (which could
// embed page data): only a scope label, the error class name, and a bounded count.
const PREFIX = '[ferdium-gchat-slackify]';

export function createLogger({ console: con = globalThis.console, debug = false, maxPerScope = 3 } = {}) {
  const counts = new Map();
  return {
    error(scope, err) {
      const n = (counts.get(scope) || 0) + 1;
      counts.set(scope, n);
      if (n > maxPerScope || !con) return;
      const name = err && typeof err.name === 'string' ? err.name : 'Error';
      con.warn(`${PREFIX} ${scope} failed (${name})${n === maxPerScope ? ' - further reports suppressed' : ''}`);
    },
    debug(...args) { if (debug && con) con.debug(PREFIX, ...args); },
    counts() { return Object.fromEntries(counts); },
    total() { let t = 0; for (const v of counts.values()) t += v; return t; },
  };
}
