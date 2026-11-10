import { chromium } from 'playwright-core';
const [query, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5391/?shot&' + query);
await page.waitForFunction(() => window.game && window.game.time > 2);
const pos = await page.evaluate(() => {
  const g = game, s = g.spider.pos, P = g.people;
  const h = P.list.filter((h) => P.alive(h)).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
  const d = { x: 1, y: 0, z: 0.3, clone() { return { ...this, setY() { return this; }, normalize() { return this; } }; } };
  h.x = s.x + 5; h.z = s.z + 1; P.R = () => 0.5; // (in the open, in front of the spider; sever two parts)
  P.hit(h, 9, d);
  return [h.x, h.z];
});
await page.evaluate(([x, z]) => { window.__eye = [x + 1, 8.5, z + 6.5, x + 2.5, 0, z]; }, pos);
const t0 = await page.evaluate(() => game.time);
for (const [dt, tag] of [[0.35, 'a'], [3, 'b'], [12, 'c']]) {
  await page.waitForFunction(([t, dt]) => game.time > t + dt, [t0, dt], { timeout: 120000 });
  await page.screenshot({ path: `${out}_${tag}.png` });
}
await browser.close();
