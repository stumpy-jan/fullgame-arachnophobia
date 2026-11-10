// Is every part of the spider attached, and do the legs stay out of the body? For each spider version and set of
// mutations: walk the gym's course on the autopilot, then
//   joints   the gap between every part and what it hangs from (spider.joints(): mask, fangs, pedicel, abdomen,
//            spinnerets, hips, every mutation part on its socket or leg segment); > 6 cm is reported as floating
//   legs     how often, and how deep, any leg segment went into a body part while walking (spider.legIntrusion)
//   node tools/attachcheck.mjs [seconds=25] [version,...] [mutations;...]
import { chromium } from 'playwright-core';
const [T = '25', vs = 'procedural,both', ms = ';devour,quills,scythes;pounce'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
let floating = 0;
for (const v of vs.split(',')) for (const m of ms.split(';')) {
  await page.goto(`http://localhost:${process.env.PORT || 5391}/?shot&gym&auto&nopost&bodycheck${process.env.EXTRA || ''}&spider=${v}${m ? '&mut=' + m : ''}`);
  await page.waitForFunction((t) => window.game && window.game.time >= t, +T, { timeout: 600000, polling: 250 });
  const r = await page.evaluate(() => {
    const sp = game.spider;
    // world-space vertices of an object's visible meshes (every k-th)
    const verts = (objs, cap) => {
      const out = [];
      for (const o of [].concat(objs)) {
        o.updateWorldMatrix(true, true);
        o.traverseVisible((q) => {
          if (!q.isMesh || q.material.visible === false) return;
          const p = q.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / cap));
          for (let i = 0; i < p.count; i += step) out.push(sp.pos.clone().fromBufferAttribute(p, i).applyMatrix4(q.matrixWorld));
        });
      }
      return out;
    };
    const gap = (part, hosts) => {
      const A = verts(part, 600), B = verts(hosts, 4000);
      let best = Infinity;
      for (const a of A) for (const b of B) { const d = a.distanceToSquared(b); if (d < best) best = d; }
      return Math.sqrt(best);
    };
    const joints = sp.joints().map(([name, part, hosts]) => [name, +gap(part, hosts).toFixed(3)]);
    return { joints, legs: game.bodyClip };
  });
  const bad = r.joints.filter(([, g]) => g > 0.06);
  floating += bad.length;
  const L = r.legs;
  console.log(`\n== ${v}${m ? ' + ' + m : ''}`);
  console.log(`  joints: ${r.joints.length} checked, ${bad.length} floating${bad.length ? ': ' + bad.map(([n, g]) => `${n} ${(g * 100).toFixed(0)} cm`).join(', ') : ''}`);
  console.log(`  legs into body: ${((100 * L.bad) / L.frames).toFixed(1)}% of frames > 5 cm, deepest ${(L.max * 100).toFixed(0)} cm (${L.maxAt})${Object.keys(L.by).length ? '  by: ' + Object.entries(L.by).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', ') : ''}`);
}
await browser.close();
console.log(floating ? `\n${floating} floating joints` : '\nall joints attached');
