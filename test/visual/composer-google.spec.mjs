// Fixture copied from a REAL diagnostic table (docs/composer-diagnostic.js v2, Ferdium Google Chat): native card 104px,
// padding 16/24, pill min-height 64. Acceptance targets from the user's screenshots: empty ~110px -> 50-70px.
import { test, expect } from '@playwright/test';
import { openFixture, applySkin, shot, SIZES } from './harness.mjs';

const MULTI = 'line 1<br>line 2<br>line 3<br>line 4<br>line 5<br>line 6';
const m = (page) => page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height }; };
  const cs = (s) => getComputedStyle(document.querySelector(s));
  return { card: r('#composer-box'), wrap: r('#composer-outer'), toolbar: r('#toolbar'), editor: r('[role="textbox"]'), d1: r('#d1'), d5: r('#d5'), send: r('#send'), pad: [cs('#composer-box').paddingTop, cs('#composer-box').paddingBottom], minH: ['#d4', '#d5', '#d6'].map((s) => cs(s).minHeight) };
});

for (const size of SIZES) {
  for (const mode of ['light', 'dark']) {
    test.describe(`${size.w}x${size.h} ${mode}`, () => {
      test.use({ viewport: { width: size.w, height: size.h } });

      test('google-chain composer: native 104px -> compact, nothing clipped', async ({ page }) => {
        await openFixture(page, { composerKind: 'google', mode }, { size, skin: false });
        const native = await m(page);
        expect(native.card.height, 'fixture reproduces the real native height').toBeCloseTo(104, 0);
        await applySkin(page);
        // the compat rules must actually match the real-chain elements
        expect(await page.locator('[data-slackify="composer"]').evaluate((e) => e.id)).toBe('composer-box');
        expect(await page.locator('[data-slackify="composer-pill"]').evaluateAll((es) => es.map((e) => e.id).sort())).toEqual(expect.arrayContaining(['d5', 'd6']));
        const e = await m(page);
        expect(e.pad).toEqual(['6px', '6px']);
        expect(e.minH).toEqual(['0px', '0px', '0px']);
        expect(e.card.height, `empty card ${e.card.height}`).toBeGreaterThanOrEqual(50);
        expect(e.card.height).toBeLessThanOrEqual(70);
        expect(e.wrap.height - e.card.height).toBeLessThanOrEqual(2);
        // controls fully inside the card, not clipped
        expect(e.toolbar.top).toBeGreaterThanOrEqual(e.card.top);
        expect(e.toolbar.bottom).toBeLessThanOrEqual(e.card.bottom);
        expect(e.send.top).toBeGreaterThanOrEqual(e.card.top);
        expect(e.send.bottom).toBeLessThanOrEqual(e.card.bottom);
        expect(e.editor.top).toBeGreaterThanOrEqual(e.card.top);
        expect(e.editor.bottom).toBeLessThanOrEqual(e.card.bottom);
        await page.locator('#send').click({ trial: true });
        await page.locator('[role="textbox"]').click();
        await page.keyboard.type('hello');
        expect(await page.locator('[role="textbox"]').textContent()).toBe('hello');
        await shot(page, `composer-google-empty-${mode}-${size.w}x${size.h}`);

        // multi-line: grows only as needed, still inside, smaller than native multi-line
        await page.evaluate((h) => { document.querySelector('[role="textbox"]').innerHTML = h; }, MULTI);
        await page.waitForTimeout(80);
        const multi = await m(page);
        expect(multi.card.height).toBeGreaterThan(e.card.height + 60);
        expect(multi.editor.bottom).toBeLessThanOrEqual(multi.card.bottom);
        expect(multi.editor.top).toBeGreaterThanOrEqual(multi.card.top);
        expect(multi.toolbar.bottom).toBeLessThanOrEqual(multi.card.bottom);
        // no clipping: the scroll area shows every line (<= its max-height), editor fits in its own scroller
        expect(await page.evaluate(() => { const d = document.getElementById('d1'); return d.scrollHeight - d.clientHeight; })).toBeLessThanOrEqual(1);
        await page.evaluate(() => { document.querySelector('[role="textbox"]').innerHTML = ''; });
        await page.evaluate((h) => { document.querySelector('[role="textbox"]').innerHTML = h; }, MULTI);
        const nativeMulti = await (async () => { const p2 = await page.context().newPage(); await p2.setViewportSize({ width: size.w, height: size.h }); await openFixture(p2, { composerKind: 'google', mode }, { skin: false }); await p2.evaluate((h) => { document.querySelector('[role="textbox"]').innerHTML = h; }, MULTI); const v = await m(p2); await p2.close(); return v; })();
        expect(multi.card.height, 'multi-line is no taller than native and the padding saving carries over').toBeLessThanOrEqual(nativeMulti.card.height - 20);
        await shot(page, `composer-google-multi-${mode}-${size.w}x${size.h}`);
      });
    });
  }
}
