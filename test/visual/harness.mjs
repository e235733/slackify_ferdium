import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFixture } from '../fixtures/chat-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CSS = fs.readFileSync(path.join(root, 'dist/user.css'), 'utf8');
export const RUNTIME = fs.readFileSync(path.join(root, 'dist/.fs-runtime.cjs'), 'utf8');
export const SHOTS = path.join(root, 'test/visual/screenshots');
export const SIZES = [{ w: 800, h: 600 }, { w: 1280, h: 800 }, { w: 1600, h: 900 }];
const GUARD = 'ferdium-gchat-slackify.controller';

/** Serve the synthetic fixture at https://chat.google.com/ and block every other network request. */
export async function openFixture(page, fixtureOpts, { skin = true, size, css } = {}) {
  const requested = new Set();
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    requested.add(u.hostname || u.protocol);
    if (u.hostname === 'chat.google.com') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: renderFixture(fixtureOpts) });
    }
    return route.abort();
  });
  if (size) await page.setViewportSize({ width: size.w, height: size.h });
  await page.goto('https://chat.google.com/u/0/');
  if (skin) await applySkin(page, css);
  return requested;
}

/** Mimic Ferdium: user.css as a <style> in <head>, then the runtime function. */
export async function applySkin(page, css = CSS) {
  await page.addStyleTag({ content: css });
  await page.evaluate((src) => {
    const module = { exports: {} };
    new Function('module', 'exports', src)(module, module.exports);
    module.exports();
  }, RUNTIME);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-sf-on'));
  // let the lazy topic scans (IntersectionObserver + idle callback) finish
  await page.waitForFunction(() => document.querySelectorAll('[data-topic-id]').length === 0 ||
    document.querySelector('[data-slackify="bubble"]'));
  await page.waitForTimeout(400);
}

export const status = (page) => page.evaluate((g) => window[Symbol.for(g)].getStatus(), GUARD);
export const destroy = (page) => page.evaluate((g) => window[Symbol.for(g)].destroy(), GUARD);

export const rect = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
}, selector);

export function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  return page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
