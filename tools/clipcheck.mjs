// Run the autopilot headless for T game seconds and report how often legs / body clip into obstacles.
//   node tools/clipcheck.mjs [seconds=60] [extra query]
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
const [T = '60', extra = ''] = process.argv.slice(2);
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('[page error]', e.message));
await page.goto(`http://localhost:${process.env.PORT || 5391}/?shot&auto&measure&nopost&${extra}`);
await page.waitForFunction((t) => window.game && window.game.time >= t, +T, { timeout: 600000, polling: 200 });
const c = await page.evaluate(() => window.game.clip);
await browser.close();
const pct = (n) => ((100 * n) / c.frames).toFixed(1) + '%';
console.log(`frames ${c.frames}  clipping >5cm: ${pct(c.bad)}  >30cm: ${pct(c.deep)}  avg clipping legs/frame: ${(c.legFrames / c.frames).toFixed(2)}  max ${c.max.toFixed(2)} m at t=${c.maxAt.toFixed(2)}`);
// group the deep moments into episodes
const eps = [];
for (const w of c.worst) { const e = eps[eps.length - 1]; if (e && w[0] - e.end < 0.3) { e.end = w[0]; e.max = Math.max(e.max, w[1]); } else eps.push({ start: w[0], end: w[0], max: w[1], at: [w[2], w[3]], kind: w[4] }); }
console.log('clipping frames by cause:', JSON.stringify(c.kinds));
console.log(`${eps.length} deep episodes:`);
for (const e of eps.slice(0, 25)) console.log(`  t ${e.start}-${e.end}  max ${e.max} m  near (${e.at})  ${e.kind}`);
