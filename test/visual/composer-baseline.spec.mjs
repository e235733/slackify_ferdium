// Why the earlier composer tests missed the real-UI problem: they asserted absolute heights on ONE mock structure that
// I wrote (so a native 100px composer could never appear) and never compared against the native, un-skinned layout.
// These tests instead enforce an invariant that holds for ANY structure: Slackify must not make the composer taller than
// it is natively (beyond its own 1px border), for several parent/wrapper layouts and both empty and multi-line text.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFixture, applySkin, rect, shot, SIZES } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIAG = fs.readFileSync(path.join(here, '../../docs/composer-diagnostic.js'), 'utf8');
const MULTI = 'line 1<br>line 2<br>line 3<br>line 4<br>line 5<br>line 6';
const LAYOUTS = [
  { name: 'simple/block parent/row wrap', opts: { composerKind: 'simple', bottom: 'block', wrapDir: 'row' } },
  { name: 'simple/column parent/row wrap', opts: { composerKind: 'simple', bottom: 'column', wrapDir: 'row' } },
  { name: 'simple/row parent/row wrap', opts: { composerKind: 'simple', bottom: 'row', wrapDir: 'row' } },
  { name: 'rich/block parent/column wrap (upstream-documented variant)', opts: { composerKind: 'rich', bottom: 'block', wrapDir: 'column' } },
  { name: 'rich/column parent/column wrap', opts: { composerKind: 'rich', bottom: 'column', wrapDir: 'column' } },
  { name: 'rich/row parent/row wrap', opts: { composerKind: 'rich', bottom: 'row', wrapDir: 'row' } },
  { name: 'rich/grid parent/column wrap', opts: { composerKind: 'rich', bottom: 'grid', wrapDir: 'column' } },
  { name: 'google chain (from real diagnostic)/block parent', opts: { composerKind: 'google', bottom: 'block', wrapDir: 'row' } },
];

const measure = (page) => page.evaluate(() => {
  const h = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right }; };
  return { card: h('#composer-box'), wrap: h('#composer-outer'), editor: h('[role="textbox"]'), toolbar: h('#toolbar'), send: h('#send') };
});

for (const size of SIZES) {
  for (const layout of LAYOUTS) {
    test.describe(`${size.w}x${size.h} ${layout.name}`, () => {
      test.use({ viewport: { width: size.w, height: size.h } });

      test('skin never makes the composer taller than native; nothing clipped', async ({ page }) => {
        await openFixture(page, layout.opts, { size, skin: false });
        const nativeEmpty = await measure(page);
        await page.evaluate((h) => { document.querySelector('[role="textbox"]').innerHTML = h; }, MULTI);
        const nativeMulti = await measure(page);
        await page.evaluate(() => { document.querySelector('[role="textbox"]').innerHTML = ''; });

        await applySkin(page);
        // the compat rule must actually match the intended element (specificity / selector check)
        const wrap = await page.evaluate(() => { const e = document.querySelector('[data-slackify="composer-wrap"]'); if (!e) return null; const c = getComputedStyle(e); return { grow: c.flexGrow, shrink: c.flexShrink, minH: c.minHeight, alignSelf: c.alignSelf, w: c.width }; });
        expect(wrap, 'composer-wrap is tagged').not.toBeNull();
        expect(wrap.grow).toBe('0');
        expect(wrap.alignSelf).toBe('flex-end');
        expect(await page.locator('[data-slackify="composer"]').count()).toBe(1);

        const skinEmpty = await measure(page);
        expect(skinEmpty.card.height, `empty card ${skinEmpty.card.height} vs native ${nativeEmpty.card.height}`).toBeLessThanOrEqual(nativeEmpty.card.height + 2.5);
        expect(skinEmpty.wrap.height, 'wrapper not taller than native').toBeLessThanOrEqual(nativeEmpty.wrap.height + 2.5);
        expect(skinEmpty.wrap.height - skinEmpty.card.height, 'wrapper adds no slack around the card').toBeLessThanOrEqual(2);
        expect(skinEmpty.editor.height, 'editor not taller than native').toBeLessThanOrEqual(nativeEmpty.editor.height + 1);
        if (skinEmpty.toolbar) {
          expect(skinEmpty.toolbar.height).toBeLessThanOrEqual(nativeEmpty.toolbar.height + 1);
          if (layout.opts.composerKind === 'rich') expect(skinEmpty.toolbar.top, 'toolbar below the editor').toBeGreaterThanOrEqual(skinEmpty.editor.bottom - 1);
          expect(skinEmpty.toolbar.bottom).toBeLessThanOrEqual(skinEmpty.card.bottom);
        }
        expect(skinEmpty.send.top).toBeGreaterThanOrEqual(skinEmpty.card.top);
        expect(skinEmpty.send.bottom).toBeLessThanOrEqual(skinEmpty.card.bottom);

        await page.evaluate((h) => { document.querySelector('[role="textbox"]').innerHTML = h; }, MULTI);
        await page.waitForTimeout(80);
        const skinMulti = await measure(page);
        expect(skinMulti.card.height, `multi card ${skinMulti.card.height} vs native ${nativeMulti.card.height}`).toBeLessThanOrEqual(nativeMulti.card.height + 2.5 + 6 * 1.5); // + Lato vs system-font line height (<=1.5px per line)
        expect(skinMulti.card.height, 'grew with content').toBeGreaterThan(skinEmpty.card.height + 50);
        expect(skinMulti.wrap.height - skinMulti.card.height).toBeLessThanOrEqual(2);
        expect(skinMulti.editor.top).toBeGreaterThanOrEqual(skinMulti.card.top);
        expect(skinMulti.editor.bottom).toBeLessThanOrEqual(skinMulti.card.bottom);
        if (skinMulti.toolbar) {
          if (layout.opts.composerKind === 'rich') expect(skinMulti.toolbar.top).toBeGreaterThanOrEqual(skinMulti.editor.bottom - 1);
          expect(skinMulti.toolbar.bottom).toBeLessThanOrEqual(skinMulti.card.bottom);
        }
        expect(await page.evaluate(() => { const b = document.getElementById('composer-box'); return b.scrollHeight - b.clientHeight; })).toBeLessThanOrEqual(1);
        await expect(page.locator('#send')).toBeVisible();
        await page.locator('#send').click({ trial: true });
        // horizontal alignment preserved
        const col = await rect(page, '#column');
        expect(Math.abs(skinMulti.card.left - col.left)).toBeLessThanOrEqual(20);
        expect(Math.abs(skinMulti.card.right - col.right)).toBeLessThanOrEqual(20);
        if (size.w === 1280) await shot(page, `composerbase-${layout.name.replace(/[^a-z]+/gi, '-')}`);
      });
    });
  }
}

test.describe('read-only DevTools diagnostic (docs/composer-diagnostic.js)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('reports sizes and layout properties, leaks no text, changes nothing, stays compact', async ({ page }) => {
    await openFixture(page, { composerKind: 'rich', wrapDir: 'column', composerText: 'SECRET-DRAFT-TEXT-123' });
    const snapshot = () => page.evaluate(() => document.documentElement.outerHTML.length + '|' + document.documentElement.getAttribute('style') + '|' + document.querySelectorAll('*').length + '|' + document.documentElement.outerHTML);
    const before = await snapshot();
    const text = await page.evaluate(DIAG);
    expect(await snapshot(), 'DOM unchanged').toBe(before);
    expect(text.length, 'compact enough to paste without console truncation').toBeLessThan(4500);
    for (const secret of ['SECRET-DRAFT-TEXT-123', 'Alice Tanaka', 'Jane Doe', 'jane@example.com', 'Send message', 'History is on', 'Attach']) expect(text, `no ${secret}`).not.toContain(secret);
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^composer-v2 skin=true mode=light/);
    expect(lines.some((l) => l.split('|')[2] === 'composer')).toBe(true);
    expect(lines.some((l) => l.split('|')[2] === 'composer-wrap')).toBe(true);
    expect(lines.some((l) => l.split('|')[1] === 'div[textbox]')).toBe(true);
    expect(text).toMatch(/composerCardHeight=\d+/);
    expect(text).toMatch(/visibleButtons\(left,top,WxH\)=(\S+ ){3}\S+/);
  });

  test('works without the skin and when no composer exists', async ({ page }) => {
    await openFixture(page, { composerKind: 'rich' }, { skin: false });
    const r = await page.evaluate(DIAG);
    expect(r).toMatch(/^composer-v2 skin=false/);
    expect(r).toMatch(/composerCardHeight=null/);
    await openFixture(page, { kind: 'login' }, { skin: false });
    expect(await page.evaluate(DIAG)).toBe('no textbox');
  });
});
