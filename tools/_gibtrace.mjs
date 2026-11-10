import { chromium } from 'playwright-core';
const [query] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5391/?shot&nopost&' + query);
await page.waitForFunction(() => window.game && window.game.time > 2);
await page.evaluate(() => { const g = game, s = g.spider.pos, P = g.people; const h = P.list.filter((h) => P.alive(h))[0]; h.x = s.x + 5; h.z = s.z + 1; P.R = () => 0.5; P.hit(h, 9, { x: 1, y: 0, z: 0.3, clone() { return { ...this, setY() { return this; }, normalize() { return this; } }; } }); });
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  console.log(await page.evaluate(() => game.people.gibs.map((b) => [b.obj.position.x, b.obj.position.y, b.obj.position.z].map((v) => v.toFixed(2)).join(',') + (b.rest ? ' rest' : '') + ' vis ' + b.obj.children[0].visible + ' n ' + (() => { let n = 0; b.obj.traverseVisible((o) => { if (o.isMesh) n++; }); return n; })()).join(' | ') + '  spider ' + game.spider.pos.x.toFixed(1) + ',' + game.spider.pos.z.toFixed(1)));
}
await browser.close();
