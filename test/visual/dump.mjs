// Developer helper: node test/visual/dump.mjs <kind> <mode> <out.png>  (screenshot of the skinned fixture)
import { chromium } from '@playwright/test';
import { openFixture } from './harness.mjs';
const [kind = 'space', mode = 'light', out = 'test/visual/screenshots/dump.png'] = process.argv.slice(2);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await openFixture(page, { kind, mode });
await page.screenshot({ path: out });
console.log(JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[data-message-id]')).map((m) => [m.getAttribute('data-message-id'), Math.round(m.getBoundingClientRect().left), Math.round(m.getBoundingClientRect().right)]))));
await b.close();
