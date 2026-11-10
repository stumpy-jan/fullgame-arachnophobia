// A 2D plan of a generated facility: rooms by depth (empty rooms pale), walls, doors, start, exit, locks, vats,
// people counts. node tools/plan.mjs [seed ...] -> shots/plan_<seed>.svg
import { writeFileSync } from 'node:fs';
import { makeFacility } from '../src/world/generate.js';
const S = 8; // px per metre
for (const seed of (process.argv.slice(2).length ? process.argv.slice(2) : ['1']).map(Number)) {
  const L = makeFacility(seed), B = L.bounds, X = (x) => (x - B.x0) * S + 20, Z = (z) => (z - B.z0) * S + 20;
  const out = [];
  const col = { lab: '#3d5560', server: '#334a3a', industrial: '#5a4a32', storage: '#4d4d45', containment: '#3a4f58' };
  for (const r of L.rooms) {
    out.push(`<rect x="${X(r.x0)}" y="${Z(r.z0)}" width="${(r.x1 - r.x0) * S}" height="${(r.z1 - r.z0) * S}" fill="${col[r.type]}" opacity="${r.fill === 'empty' ? 0.35 : r.fill === 'sparse' ? 0.65 : 1}"/>`);
    const ppl = L.people.filter((g) => g.room === r.id).map((g) => `${g.n} ${g.type === "soldier" ? "sol" : "sci"}`).join(' ');
    out.push(`<text x="${X(r.x0) + 6}" y="${Z(r.z0) + 16}" fill="#ddd" font-size="13" font-family="monospace">${r.type} d${r.depth} ${ppl}</text>`);
  }
  for (const p of L.pieces) {
    const at = (c, rad, fill) => out.push(`<circle cx="${X(p.x)}" cy="${Z(p.z ?? p.z0)}" r="${rad}" fill="${fill}"/>`);
    if (p.type === 'vat') at(0, 9, '#ff3aa8');
    else if (p.type === 'lock') out.push(`<rect x="${X(p.x) - 14}" y="${Z(p.z) - 14}" width="28" height="28" fill="#ff3020"/>`);
    else if (p.type === 'exitDoor') out.push(`<rect x="${X(p.x - 3.5)}" y="${Z(p.z) - 10}" width="${7 * S}" height="20" fill="#ffe680"/>`);
    else if (p.type === 'lamp') at(0, 2, '#ffe8cc');
    else if (['bench', 'rackRow', 'crateStack', 'machine', 'cabinet', 'tank', 'prop', 'drum', 'gasBottles'].includes(p.type)) at(0, p.type === 'tank' || p.type === 'machine' ? 7 : 4, '#9aa');
  }
  for (const w of L.walls) out.push(`<line x1="${X(w.x0)}" y1="${Z(w.z0)}" x2="${X(w.x1)}" y2="${Z(w.z1)}" stroke="${w.outer ? '#eee' : '#bbb'}" stroke-width="${w.outer ? 6 : 4}"/>`);
  out.push(`<circle cx="${X(L.spawn.x)}" cy="${Z(L.spawn.z)}" r="12" fill="#6cf"/>`);
  out.push(`<polyline points="${L.route.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="none" stroke="#6cf" stroke-width="1" opacity="0.35"/>`);
  const w = (B.x1 - B.x0) * S + 40, h = (B.z1 - B.z0) * S + 60;
  out.push(`<text x="20" y="${h - 14}" fill="#ccc" font-size="15" font-family="monospace">seed ${seed}: ${JSON.stringify(L.info)}  blue: start  yellow: exit  red: locks  pink: vats  pale: empty rooms</text>`);
  writeFileSync(`shots/plan_${seed}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#111"/>${out.join('')}</svg>`);
}
