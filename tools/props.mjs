// Raw Pixal3D meshes (assets/pilot/<name>/raw_*.glb, ~700k triangles) -> game-ready props in public/models/props/<name>.glb:
// simplified to the asset's triangle budget, textures to KTX2 (BasisU) at 1K (2K for big ones), geometry meshopt-compressed.
//   node tools/props.mjs [name ...]   (AGGRESSIVE=1 meets the budget but smears textures across Pixal3D's UV seams;
//   the real fix is the team pipeline's Blender finish: remesh, unwrap, re-bake)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const BUDGET = { centrifuge: 4000, hazmat_locker: 5000, lab_trolley: 3000, generator: 15000, hazmat_hood: 2000, rifle: 1500, air_tank: 1500, spider_thorax: 4000, spider_abdomen: 4000 };
const TEX = { generator: 2048 };
const ROOT = 'assets/pilot', OUT = 'public/models/props';

function triangles(file) { // count from the GLB's JSON chunk
  const b = readFileSync(file), len = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  let t = 0;
  for (const m of json.meshes || []) for (const p of m.primitives) t += (p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count) / 3;
  return t;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BUDGET);
for (const n of names) {
  const dir = join(ROOT, n);
  // prefer the Blender-finished model (hero_asset.py finish, then tools/clean_floor.py): already at budget, re-baked maps
  const finished = [join(dir, n + '_clean.glb'), join(dir, n + '.glb')].find(existsSync);
  const raw = existsSync(dir) && readdirSync(dir).filter((f) => f.startsWith('raw_') && f.endsWith('.glb')).sort().pop();
  if (!finished && !raw) { console.log(n, 'no mesh yet'); continue; }
  const src = finished || join(dir, raw), tris = triangles(src), ratio = Math.min(1, (BUDGET[n] || tris) / tris); // (a finish baked above budget, so its maps stay clean, is simplified here)
  const out = join(OUT, `${n}.glb`);
  // the native gltfpack (tools/bin, from github.com/zeux/meshoptimizer releases): the npm build can't do KTX2
  execFileSync('tools/bin/gltfpack.exe', ['-i', src, '-o', out, '-si', ratio.toFixed(6), ...(process.env.AGGRESSIVE ? ['-sa'] : []), '-tc', '-tl', String(TEX[n] || 1024), '-cc'], { stdio: 'pipe' });
  console.log(`${n}: ${Math.round(tris)} -> ~${BUDGET[n]} triangles, ${(statSync(src).size / 1e6).toFixed(1)} MB -> ${(statSync(out).size / 1e6).toFixed(2)} MB`, triangles(out) ? `(${Math.round(triangles(out))})` : '');
}
