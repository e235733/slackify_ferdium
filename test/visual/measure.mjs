// Developer helper: node test/visual/measure.mjs  -> prints composer heights for the google-chain fixture (native vs skinned).
import { chromium } from '@playwright/test';
import { openFixture } from './harness.mjs';
const b = await chromium.launch();
const out = {};
for (const skin of [false, true]) {
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await openFixture(page, { composerKind: 'google' }, { skin });
  const h = () => page.evaluate(() => document.getElementById('composer-box').getBoundingClientRect().height);
  const empty = await h();
  await page.evaluate(() => { document.querySelector('[role="textbox"]').innerHTML = 'a<br>b<br>c<br>d<br>e<br>f'; });
  out[skin ? 'skinned' : 'native'] = { empty, sixLines: await h() };
  await page.close();
}
console.log(JSON.stringify(out));
await b.close();
