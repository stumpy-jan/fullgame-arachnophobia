import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1116, height: 848 } });
for (const f of process.argv.slice(2)) { await page.goto(pathToFileURL(resolve(f)).href); await page.screenshot({ path: f.replace('.svg', '.png') }); }
await browser.close();
