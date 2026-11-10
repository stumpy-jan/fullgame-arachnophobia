// staged gore check: kill everyone near the spider with heavy blows, screenshot as it lands and once it has pooled
import { chromium } from 'playwright-core';
const [query = 'seed=1&god', out = 'shots/gore'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('[console]', m.text()); });
await page.goto('http://localhost:5391/?shot&' + query);
await page.waitForFunction(() => window.game && window.game.time > 2);
console.log(await page.evaluate(() => {
  const g = game, s = g.spider.pos, P = g.people, T = window.THREE_V || null;
  let n = 0;
  for (const h of P.list) {
    if (!P.alive(h) || Math.hypot(h.x - s.x, h.z - s.z) > 18) continue;
    const d = { x: h.x - s.x, y: 0, z: h.z - s.z, clone() { return { ...this, setY(v) { this.y = v; return this; }, normalize() { const l = Math.hypot(this.x, this.z) || 1; this.x /= l; this.z /= l; return this; } }; } };
    P.hit(h, 9, d); n++;
  }
  return 'killed ' + n + ', gibs ' + P.gibs.length;
}));
const t0 = await page.evaluate(() => game.time);
await page.waitForFunction((t) => game.time > t + 1.5, t0); await page.screenshot({ path: out + '_a.png' });
await page.waitForFunction((t) => game.time > t + 9, t0, { timeout: 120000 }); await page.screenshot({ path: out + '_b.png' });
console.log(await page.evaluate(() => 'gibs resting ' + game.people.gibs.filter((b) => b.rest).length + '/' + game.people.gibs.length));
await browser.close();
