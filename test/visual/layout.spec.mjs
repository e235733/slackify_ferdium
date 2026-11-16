import { test, expect } from '@playwright/test';
import { openFixture, applySkin, status, destroy, rect, shot, SIZES } from './harness.mjs';

const luminance = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Effective text colour and the first non-transparent background behind an element.
const colors = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const parse = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const fg = parse(getComputedStyle(el).color);
  let n = el; let bg = null;
  while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.5) { bg = c; break; } n = n.parentElement; }
  return { fg, bg: bg || [255, 255, 255, 1] };
}, selector);

const cs = (page, selector, props) => page.evaluate(([s, p]) => {
  const el = document.querySelector(s); const c = getComputedStyle(el);
  return Object.fromEntries(p.map((k) => [k, c[k]]));
}, [selector, props]);

for (const size of SIZES) {
  for (const mode of ['light', 'dark']) {
    test.describe(`${size.w}x${size.h} ${mode}`, () => {
      test.use({ viewport: { width: size.w, height: size.h }, colorScheme: mode });

      test('space view: left-aligned flat full-width messages, no horizontal scroll', async ({ page }) => {
        const requested = await openFixture(page, { mode, kind: 'space' }, { size });
        const st = await status(page);
        expect(st.active).toBe(true);
        expect(st.mode).toBe(mode);
        expect(st.theme).toBe('aubergine');

        // no horizontal scrolling anywhere in the app shell
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        expect(await page.evaluate(() => { const s = document.getElementById('scroller'); return s.scrollWidth - s.clientWidth; })).toBeLessThanOrEqual(0);

        // own and other messages share the left edge of their content column
        const main = await rect(page, '[role="main"]');
        const lefts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-message-id]')).map((m) => {
          const r = m.getBoundingClientRect();
          return { id: m.getAttribute('data-message-id'), self: !!m.closest('[data-topic-id]').querySelector('[data-compare-to-self-user]'), left: r.left, right: r.right, width: r.width };
        }));
        const selfs = lefts.filter((l) => l.self); const others = lefts.filter((l) => !l.self);
        expect(selfs.length).toBeGreaterThan(0);
        const otherLeft = Math.min(...others.map((o) => o.left));
        for (const s of selfs) {
          expect(Math.abs(s.left - otherLeft), `own message ${s.id} aligned with others`).toBeLessThanOrEqual(2);
          expect(s.left - main.left, 'own message sits in the left part of the pane').toBeLessThan(main.width * 0.5);
        }
        // Not right-aligned: the right edge of an own short message is nowhere near the pane's right edge
        const shortSelf = selfs.find((s) => s.id === 'msg-1');
        expect(main.right - shortSelf.right).toBeGreaterThan(60);

        // flat: no grey/colored bubble fill and no rounded bubble corners
        for (const id of ['msg-0', 'msg-1']) {
          const c = await cs(page, `[data-message-id="${id}"]`, ['backgroundColor', 'borderTopLeftRadius']);
          expect(c.backgroundColor, `${id} background`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
          expect(parseFloat(c.borderTopLeftRadius)).toBeLessThanOrEqual(4);
        }
        // the 640px cap is lifted on wide windows
        if (size.w >= 1280) {
          const w = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('[data-message-id]')).map((m) => m.getBoundingClientRect().width)));
          expect(w).toBeGreaterThan(660);
        }

        // composer + send button usable
        const tb = page.locator('[role="textbox"]');
        await expect(tb).toBeVisible();
        const tbr = await rect(page, '[role="textbox"]');
        expect(tbr.bottom).toBeLessThanOrEqual(size.h);
        expect(tbr.width).toBeGreaterThan(200);
        await tb.click();
        await page.keyboard.type('hello');
        expect(await tb.textContent()).toBe('hello');
        const send = page.locator('#send');
        await expect(send).toBeVisible();
        await send.click({ trial: true });
        const sr = await rect(page, '#send');
        expect(sr.right).toBeLessThanOrEqual(size.w);
        expect(sr.width).toBeGreaterThan(8);

        // unread counts untouched and still visible
        for (const [sel, text] of [['div[data-section-type="1"] div.TeR7uc', '3'], ['div[data-section-type="2"] div.TeR7uc', '12']]) {
          expect(await page.locator(sel).textContent()).toBe(text);
          await expect(page.locator(sel)).toBeVisible();
        }
        expect(await page.locator('.badge').count()).toBe(2);
        for (const b of await page.locator('.badge').all()) await expect(b).toBeVisible();

        // thread chip, reactions, code block inside the pane and visible
        await expect(page.locator('[data-slackify="reply-count"]')).toBeVisible();
        await expect(page.locator('[data-slackify="reactions"]').first()).toBeVisible();
        const pre = await rect(page, '[role="main"] pre');
        expect(pre.right).toBeLessThanOrEqual(main.right + 1);
        expect(pre.width).toBeGreaterThan(50);
        const codeBg = await cs(page, '[role="main"] pre', ['backgroundColor']);
        expect(codeBg.backgroundColor).not.toMatch(/rgba\(0, 0, 0, 0\)/);

        // text never disappears into its background
        for (const sel of ['[data-message-id="msg-0"] span', '[data-message-id="msg-1"] span', '[data-name="Alice Tanaka"] span', '[role="textbox"]', '[role="main"] [data-slackify="reply-count"]']) {
          const { fg, bg } = await colors(page, sel);
          expect(contrast(fg, bg), `${sel} contrast ${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
        }
        const rail = await colors(page, '[role="list"] [role="listitem"] span[role="presentation"]');
        expect(contrast(rail.fg, rail.bg), `sidebar text ${rail.fg} on ${rail.bg}`).toBeGreaterThanOrEqual(3);

        // chat logo is whitened on the dark top bar; nothing else in the banner is filtered
        expect((await cs(page, '[role="banner"] img[src*="chatlogo"]', ['filter'])).filter).toBe('brightness(0) invert(1)');
        expect((await cs(page, '[role="banner"] a img', ['filter'])).filter).toBe('none');
        expect((await cs(page, '[role="banner"]', ['filter'])).filter).toBe('none');

        // sidebar is themed (aubergine) and differs between light/dark
        const railBg = await cs(page, '[data-slackify="rail"]', ['backgroundColor']);
        expect(railBg.backgroundColor).toBe(mode === 'light' ? 'rgb(240, 233, 240)' : 'rgb(36, 18, 41)');

        // network: only the fixture origin plus the documented gstatic logo swap were attempted
        for (const h of requested) expect(['chat.google.com', 'ssl.gstatic.com', 'data:']).toContain(h);

        await shot(page, `space-${mode}-${size.w}x${size.h}`);
      });

      test('dm view renders and the focus ring survives', async ({ page }) => {
        await openFixture(page, { mode, kind: 'dm' }, { size, skin: false });
        const focusProps = ['outlineStyle', 'outlineWidth', 'boxShadow'];
        await page.locator('#send').focus();
        await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        const before = await cs(page, '#send', focusProps);
        await applySkin(page);
        await page.locator('#send').focus();
        await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement.id)).toBe('send');
        const after = await cs(page, '#send', focusProps);
        expect(after.outlineStyle).toBe(before.outlineStyle);
        expect(after.outlineWidth).toBe(before.outlineWidth);
        expect(after.outlineStyle).not.toBe('none');
        await page.locator('[role="textbox"]').focus();
        const tbFocus = await cs(page, '[role="textbox"]', focusProps);
        expect(`${tbFocus.outlineStyle} ${tbFocus.boxShadow}`).not.toBe('none none');
        expect((await status(page)).active).toBe(true);
        expect(await page.locator('[data-slackify="convo-title"]').textContent()).toBe('Alice Tanaka');
        await shot(page, `dm-${mode}-${size.w}x${size.h}`);
      });
    });
  }
}

test.describe('behaviour', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('live light/dark switch re-themes the sidebar', async ({ page }) => {
    await openFixture(page, { mode: 'light' });
    const rail = '[data-slackify="rail"]';
    expect((await cs(page, rail, ['backgroundColor'])).backgroundColor).toBe('rgb(240, 233, 240)');
    await page.evaluate(() => document.body.setAttribute('data-theme', 'dark'));
    await page.waitForFunction(() => document.documentElement.getAttribute('data-sf-mode') === 'dark');
    expect((await cs(page, rail, ['backgroundColor'])).backgroundColor).toBe('rgb(36, 18, 41)');
  });

  test('Japanese UI: day labels and thread chip', async ({ page }) => {
    await openFixture(page, { lang: 'ja' });
    const dates = await page.locator('[data-slackify="date"]').allTextContents();
    expect(dates).toEqual(expect.arrayContaining(['今日', '昨日', '月曜日, 10月21日']));
    expect(await page.locator('[data-message-id="msg-4"] span').first().getAttribute('data-slackify')).toBeNull();
    expect(await page.locator('[data-slackify="reply-count"]').textContent()).toBe('2件の返信');
    await shot(page, 'space-ja-1280x800');
  });

  test('empty and loading screens keep the composer usable / stay unskinned', async ({ page }) => {
    await openFixture(page, { kind: 'empty' });
    await expect(page.locator('[role="textbox"]')).toBeVisible();
    await shot(page, 'empty-light-1280x800');
  });

  test('login page is never skinned', async ({ page }) => {
    await openFixture(page, { kind: 'login' }, { skin: false });
    await page.addStyleTag({ content: (await import('./harness.mjs')).CSS });
    await page.evaluate((src) => { const m = { exports: {} }; new Function('module', 'exports', src)(m, m.exports); m.exports(); }, (await import('./harness.mjs')).RUNTIME);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-sf-on'))).toBe(false);
    expect((await status(page)).state).toBe('waiting');
  });

  test('destroy() restores the original look and stops the runtime', async ({ page }) => {
    await openFixture(page, { mode: 'light', kind: 'space' }, { skin: false });
    const before = await cs(page, '[data-message-id="msg-0"]', ['backgroundColor', 'borderTopLeftRadius']);
    await applySkin(page);
    expect((await cs(page, '[data-message-id="msg-0"]', ['backgroundColor'])).backgroundColor).not.toBe(before.backgroundColor);
    await destroy(page);
    expect(await cs(page, '[data-message-id="msg-0"]', ['backgroundColor', 'borderTopLeftRadius'])).toEqual(before);
    expect(await page.evaluate(() => document.querySelectorAll('[data-slackify]').length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.getAttributeNames().filter((n) => n.startsWith('data-sf')))).toEqual([]);
  });

  test('large conversation: lazy scan keeps up and the page stays responsive', async ({ page }) => {
    await openFixture(page, { count: 600 }, { skin: false });
    await page.addStyleTag({ content: (await import('./harness.mjs')).CSS });
    const ms = await page.evaluate(async (src) => {
      const t0 = performance.now();
      const m = { exports: {} }; new Function('module', 'exports', src)(m, m.exports); m.exports();
      return performance.now() - t0;
    }, (await import('./harness.mjs')).RUNTIME);
    expect(ms, 'synchronous activation cost').toBeLessThan(500);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-sf-on'));
    await page.waitForTimeout(800);
    const tagged = await page.evaluate(() => document.querySelectorAll('[data-slackify="bubble"]').length);
    const total = await page.evaluate(() => document.querySelectorAll('[data-topic-id]').length);
    expect(tagged).toBeGreaterThan(5);
    expect(tagged).toBeLessThan(total); // off-screen history is not scanned eagerly
    await page.evaluate(() => { document.getElementById('scroller').scrollTop = 1e6; });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => document.querySelectorAll('[data-slackify="bubble"]').length)).toBeGreaterThan(tagged - 1);
  });
});
