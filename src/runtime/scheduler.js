// A single coalescing work queue. The MutationObserver callback only sets a flag and schedules;
// all scanning happens in one idle callback (or a timeout fallback) with a time budget.
const BUDGET_MS = 8;
const FALLBACK_DELAY_MS = 150;

export function createScheduler({ window, run, logger, delay = FALLBACK_DELAY_MS }) {
  const topics = new Set();
  let dirty = true;
  let stopped = true;
  let scheduled = false;
  let handle = null;
  let usedIdle = false;
  let observer = null;
  const now = () => (window.performance && window.performance.now ? window.performance.now() : Date.now());

  function flush(deadline) {
    scheduled = false;
    handle = null;
    if (stopped) return;
    const wasDirty = dirty;
    dirty = false;
    try {
      run({ deadline, dirty: wasDirty, topics });
    } catch (e) {
      logger.error('scheduler.run', e);
    }
    if (!stopped && (topics.size || dirty)) schedule();
  }

  function schedule() {
    if (scheduled || stopped) return;
    scheduled = true;
    if (typeof window.requestIdleCallback === 'function') {
      usedIdle = true;
      handle = window.requestIdleCallback(flush, { timeout: 1000 });
    } else {
      usedIdle = false;
      handle = window.setTimeout(() => {
        const t0 = now();
        flush({ didTimeout: false, timeRemaining: () => Math.max(0, BUDGET_MS - (now() - t0)) });
      }, delay);
    }
  }

  return {
    markDirty() { dirty = true; schedule(); },
    queueTopic(el) { topics.add(el); schedule(); },
    start(root) {
      if (!stopped) return;
      stopped = false;
      dirty = true;
      if (root && typeof window.MutationObserver === 'function') {
        observer = new window.MutationObserver(() => { dirty = true; schedule(); });
        observer.observe(root, { childList: true, subtree: true });
      }
      schedule();
    },
    stop() {
      stopped = true;
      if (observer) { observer.disconnect(); observer = null; }
      if (handle !== null) {
        if (usedIdle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
        else window.clearTimeout(handle);
      }
      handle = null;
      scheduled = false;
      topics.clear();
    },
    isScheduled() { return scheduled; },
    isStopped() { return stopped; },
  };
}
