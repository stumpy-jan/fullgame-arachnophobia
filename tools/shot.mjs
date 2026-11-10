// Screenshots of the running dev server, in headless Edge (or Chrome) with the GPU.
//   node tools/shot.mjs "<query>" <name> <t1,t2,...> [width] [height]
// e.g. node tools/shot.mjs "auto" walk 3,6,9   ->  shots/walk_3.png, shots/walk_6.png, ...
// Times are game seconds (the game steps a fixed 1/60 s per frame with ?shot, so they repeat).
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';

const [query = '', name = 'shot', times = '3', W = '1600', H = '900'] = process.argv.slice(2);
const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const port = process.env.PORT || 5391;
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[page error]', e.message));
// PAGE=zoo.html for the zoo
await page.goto(`http://localhost:${port}/${process.env.PAGE || ''}?shot&${query}`);
await page.waitForFunction(() => window.game, null, { timeout: 30000 });
const t0 = Date.now();
for (const t of times.split(',').map(Number)) {
  await page.waitForFunction((t) => window.game.time >= t, t, { timeout: 180000, polling: 50 });
  const out = `shots/${name}_${t}.png`;
  await page.screenshot({ path: out });
  console.log(out, `(${((Date.now() - t0) / 1000).toFixed(1)} s real)`);
}
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const s = performance.now(); const f = () => { if (++n === 60) r(60000 / (performance.now() - s)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
console.log('fps', fps.toFixed(1), '(headless, fixed-step)');
await browser.close();
