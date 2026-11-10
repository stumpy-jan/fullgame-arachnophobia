// headless check of the run's goal: tear down every lock, the door opens, walk out -> ESCAPED
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto('http://localhost:5391/?shot&god&seed=1');
await page.waitForFunction(() => window.game && window.game.time > 0.5);
const locks = await page.evaluate(() => game.lab.locks.map((L) => ({ x: L.x, z: L.z, w: L.w, d: L.d, kind: L.kind })));
console.log('locks', JSON.stringify(locks));
const aimAt = async (x, z) => {
  const s = await page.evaluate(([x, z]) => { const v = new game.spider.pos.constructor(x, 0, z).project(game.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, [x, z]);
  await page.mouse.move(s[0], s[1]);
};
for (const [i, L] of locks.entries()) {
  const t0 = Date.now();
  // stand off the lock's side that faces the middle of the facility
  const a = Math.atan2(0 - L.x, 2.5 - L.z), r = Math.max(L.w, L.d) / 2 + 2.4;
  const sx = L.x + Math.sin(a) * r, sz = L.z + Math.cos(a) * r;
  await page.evaluate(([x, z, h]) => game.spider.place(x, z, h), [sx, sz, a + Math.PI]);
  while (Date.now() - t0 < 25000) {
    await aimAt(L.x, L.z);
    const st = await page.evaluate((i) => ({ hp: game.lab.locks[i].hp, dead: game.lab.locks[i].destroyed, t: game.time }), i);
    if (st.dead) { console.log('lock', i, L.kind, 'destroyed at t', st.t.toFixed(1)); break; }
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `shots/goal_lock${i}.png` });
}
const d = await page.evaluate(() => ({ unlocked: game.lab.door?.unlocked, x: game.lab.door?.x, z: game.lab.door?.z }));
console.log('door', JSON.stringify(d));
await page.evaluate(([x, z]) => game.spider.place(x, z + 7, Math.PI), [d.x, d.z]);
await page.waitForTimeout(3500);
await page.screenshot({ path: 'shots/goal_door.png' });
await page.keyboard.down('KeyW');
const t1 = Date.now();
while (Date.now() - t1 < 15000) { if (await page.evaluate(() => game.state.over)) break; await page.waitForTimeout(250); }
await page.keyboard.up('KeyW');
await page.waitForTimeout(2200);
console.log('over', await page.evaluate(() => [game.state.over, document.querySelector('#menu h2')?.textContent, game.spider.pos.z.toFixed(2)]));
await page.screenshot({ path: 'shots/goal_end.png' });
await browser.close();
