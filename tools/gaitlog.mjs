// Step log: steps per leg per second over T game seconds of the autopilot, by reason (node tools/gaitlog.mjs [query=fast] [T=25])
import { chromium } from 'playwright-core';
const [query = 'fast', T = '25'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5391/?shot&auto&nopost&' + query);
await page.waitForFunction(() => window.game);
await page.evaluate(() => { window.game.spider.log = []; });
await page.waitForFunction((t) => window.game.time >= t, +T, { timeout: 300000, polling: 200 });
const log = await page.evaluate(() => window.game.spider.log);
await browser.close();
const per = {};
for (const [t, k, s, why, ok, d] of log) { const key = `${s < 0 ? 'L' : 'R'}${k + 1}`; (per[key] ||= { n: 0, why: {}, short: 0, hover: 0 }); per[key].n++; per[key].why[why] = (per[key].why[why] || 0) + 1; if (d < 0.6) per[key].short++; if (!ok) per[key].hover++; }
for (const key of Object.keys(per).sort()) console.log(key, (per[key].n / +T).toFixed(2) + '/s', 'short(<0.6m):', per[key].short, 'to-hover:', per[key].hover, JSON.stringify(per[key].why));
