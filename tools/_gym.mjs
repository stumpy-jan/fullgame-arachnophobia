import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5391/?gym&shot');
for (const name of ['AI both', 'Procedural', 'AI carapace', 'AI abdomen']) {
  await page.waitForFunction(() => window.game && window.game.time > 1);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(700); await page.keyboard.up('KeyD');
  const before = await page.evaluate(() => [game.spider.pos.x.toFixed(1), game.spider.pos.z.toFixed(1)]);
  await Promise.all([page.waitForNavigation(), page.click(`button:has-text("${name}")`)]);
  await page.waitForFunction(() => window.game && window.game.time > 1.5);
  const after = await page.evaluate(() => [location.search, game.spider.pos.x.toFixed(1), game.spider.pos.z.toFixed(1), game.spider.root.children.filter((c) => c.type === 'Group' && c.children[0]?.children?.length).length]);
  console.log(name, 'stood at', before.join(','), '->', after.join(' | '));
  await page.screenshot({ path: `shots/gym_v_${name.replace(' ', '_')}.png` });
}
await page.keyboard.press('KeyV'); await page.waitForNavigation().catch(() => {});
await page.waitForFunction(() => window.game && window.game.time > 0.5);
console.log('V ->', await page.evaluate(() => location.search));
await browser.close();
