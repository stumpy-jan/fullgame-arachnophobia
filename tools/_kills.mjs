import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5391/?shot&auto&autoattack&nopost');
await page.waitForFunction(() => window.game && window.game.time >= 40, null, { timeout: 300000, polling: 300 });
const r = await page.evaluate(() => { const g = window.game, c = {}; c.log = g.state.log.slice(0, 12).map((e) => e[1]).join(','); for (const h of g.people.list) c[h.type + ':' + h.state] = (c[h.type + ':' + h.state] || 0) + 1; return { kills: g.state.kills, hp: g.state.hp.toFixed(0), states: c }; });
console.log(JSON.stringify(r));
await browser.close();
