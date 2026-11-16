import { test, expect } from '@playwright/test';
import { openFixture, rect, shot, CSS, SIZES } from './harness.mjs';

const COMPAT_START = '/* Composer height.';
const withoutComposerFix = () => {
  const i = CSS.indexOf(COMPAT_START);
  const j = CSS.indexOf('}', i);
  return CSS.slice(0, i) + CSS.slice(j + 1);
};
const MULTI = 'line 1<br>line 2<br>line 3<br>line 4<br>line 5<br>line 6';

for (const size of SIZES) {
  for (const bottom of ['block', 'row', 'column']) {
    test.describe(`composer ${size.w}x${size.h} parent=${bottom}`, () => {
      test.use({ viewport: { width: size.w, height: size.h } });

      test('empty composer is one compact line, aligned with the message area, controls usable', async ({ page }) => {
        await openFixture(page, { bottom }, { size });
        const box = await rect(page, '#composer-box');
        const wrap = await rect(page, '[data-slackify="composer-wrap"]');
        const col = await rect(page, '#column');
        const main = await rect(page, '[role="main"]');
        expect(box.height, 'single-line composer height').toBeLessThanOrEqual(72);
        expect(box.height).toBeGreaterThanOrEqual(36);
        expect(wrap.height - box.height, 'wrap adds no vertical slack').toBeLessThanOrEqual(2);
        // horizontally aligned with the message column (full width), inside the pane
        expect(Math.abs(box.left - col.left)).toBeLessThanOrEqual(20);
        expect(Math.abs(box.right - col.right)).toBeLessThanOrEqual(20);
        expect(box.left).toBeGreaterThanOrEqual(main.left);
        expect(box.right).toBeLessThanOrEqual(main.right);
        expect(box.bottom).toBeLessThanOrEqual(size.h);
        // controls
        const tb = page.locator('[role="textbox"]');
        await tb.click();
        await page.keyboard.type('hello');
        expect(await tb.textContent()).toBe('hello');
        await page.locator('#send').click({ trial: true });
        const sr = await rect(page, '#send');
        expect(sr.top).toBeGreaterThanOrEqual(box.top);
        expect(sr.bottom).toBeLessThanOrEqual(box.bottom);
        expect(sr.right).toBeLessThanOrEqual(box.right);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        await shot(page, `composer-${bottom}-${size.w}x${size.h}`);
      });

      test('multi-line text grows the composer naturally without clipping', async ({ page }) => {
        await openFixture(page, { bottom }, { size });
        const one = await rect(page, '#composer-box');
        await page.evaluate((h) => { document.querySelector('[role="textbox"]').innerHTML = h; }, MULTI);
        await page.waitForTimeout(100);
        const many = await rect(page, '#composer-box');
        const tb = await rect(page, '[role="textbox"]');
        expect(many.height, 'grew').toBeGreaterThan(one.height + 60);
        expect(tb.top).toBeGreaterThanOrEqual(many.top);
        expect(tb.bottom).toBeLessThanOrEqual(many.bottom);
        expect(await page.evaluate(() => { const b = document.getElementById('composer-box'); return b.scrollHeight - b.clientHeight; })).toBeLessThanOrEqual(1);
        expect(many.bottom).toBeLessThanOrEqual(size.h);
        await expect(page.locator('#send')).toBeVisible();
        await page.locator('#send').click({ trial: true });
        // text is fully rendered: the last line is inside the box
        expect(await page.evaluate(() => { const r = document.createRange(); const t = document.querySelector('[role="textbox"]'); r.selectNodeContents(t); const rr = r.getBoundingClientRect(); const b = document.getElementById('composer-box').getBoundingClientRect(); return rr.bottom <= b.bottom + 1; })).toBe(true);
      });
    });
  }
}

test.describe('composer root cause', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('without the compat rule, upstream flex:1 1 auto makes the composer tall in a column parent (hypothesis confirmed on the mock)', async ({ page }) => {
    await openFixture(page, { bottom: 'column' }, { css: withoutComposerFix() });
    const box = await rect(page, '#composer-box');
    expect(box.height, 'unfixed upstream rule: composer stretched by the grown wrap').toBeGreaterThan(120);
    await shot(page, 'composer-column-unfixed');
  });

  test('without the compat rule, a row parent stretches it too (cross-axis)', async ({ page }) => {
    await openFixture(page, { bottom: 'row' }, { css: withoutComposerFix() });
    expect((await rect(page, '#composer-box')).height).toBeGreaterThan(120);
  });
});

test.describe('own-message sender label (computed ::before)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  const label = (page) => page.evaluate(() => {
    const m = document.querySelector('[data-slackify="self-meta"]');
    return m ? getComputedStyle(m, '::before').content : null;
  });
  const OTHERS_FIRST = [
    { who: 'other', name: 'Alice Tanaka', time: '9:41 AM', text: 'hi' },
    { who: 'self', name: 'Jane Doe', time: '9:42 AM', text: 'mine' },
  ];

  test('account button -> its name', async ({ page }) => {
    await openFixture(page, { messages: OTHERS_FIRST, flagAll: true });
    expect(await label(page)).toBe('"Jane Doe"');
  });
  test('no account button, flag on everyone -> own-row name, never the first participant', async ({ page }) => {
    await openFixture(page, { messages: OTHERS_FIRST, flagAll: true, account: false });
    expect(await label(page)).toBe('"Jane Doe"');
  });
  test('no evidence at all -> neutral "You"', async ({ page }) => {
    await openFixture(page, { messages: OTHERS_FIRST, flagAll: true, account: false, selfName: 'none' });
    expect(await label(page)).toBe('"You"');
    await shot(page, 'self-label-neutral');
  });
  test('Google already shows a visible name -> no synthetic duplicate', async ({ page }) => {
    await openFixture(page, { messages: OTHERS_FIRST, selfName: 'visible' });
    expect(await page.evaluate(() => { const m = document.querySelector('[data-slackify="self-meta"]'); return m ? getComputedStyle(m, '::before').display : 'no-meta'; })).toBe('none');
  });
});
