// battle damage check: stand the spider in a guarded room (god mode), let them shoot, then look close at a wall and a soldier
import { chromium } from 'playwright-core';
const [query, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('[console]', m.text()); });
await page.goto('http://localhost:5391/?shot&' + query);
await page.waitForFunction(() => window.game && window.game.time > 20, null, { timeout: 200000 });
await page.screenshot({ path: out + '_game.png' });
const info = await page.evaluate(() => {
  const d = game.damage, P = game.people;
  const sol = P.list.find((h) => h.type === 'soldier' && P.alive(h) && Math.hypot(h.x - game.spider.pos.x, h.z - game.spider.pos.z) < 30);
  return { holes: d.holes.m.count, casings: d.cas.count, glass: d.glass.count, sol: sol ? [sol.x, sol.z] : null, hole: d.holes.m.count ? (() => { const m = new game.spider.root.matrix.constructor(); d.holes.m.getMatrixAt(0, m); return [m.elements[12], m.elements[13], m.elements[14]]; })() : null };
});
console.log(JSON.stringify(info));
if (info.sol) { await page.evaluate(([x, z]) => { window.__eye = [x + 1.5, 4.5, z + 3.5, x, 0, z]; }, info.sol); await page.waitForTimeout(400); await page.screenshot({ path: out + '_soldier.png' }); }
if (info.hole) { await page.evaluate(([x, y, z]) => { window.__eye = [x + 2.5, y + 1.5, z + 2.5, x, y, z]; }, info.hole); await page.waitForTimeout(400); await page.screenshot({ path: out + '_wall.png' }); }
await browser.close();
