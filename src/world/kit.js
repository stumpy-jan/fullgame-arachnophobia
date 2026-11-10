import * as THREE from 'three';
import { boxUV, cylUV } from '../util.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from '../textures.js';
import { splat } from './geom.js';
import { pbrSet, floorGeometry } from './floors.js';
import { makeCanvas, fbm, canvasTexture } from '../util.js';

// The level kit: every piece the lab is built from. Each builder takes the build context (ctx, from
// world.js: the scene root, materials, a seeded random, and the registries for solids, bullet blockers,
// screens and lights) and one entry of a layout (a plain object: { type, x, z, ... }). Builders only
// make meshes and register what they occupy, so a generator can place any of them anywhere.
//
// Rules every piece follows: everything the spider can stand on is registered as a flat-topped solid
// (box or disc); everything that stops bullets is registered as a blocker; anything standing on the
// floor gets a contact shadow.

export const WALL_H = 3.4;   // dividing walls: height
export const COL = 0.78;    // columns: half-size
export const COL_H = WALL_H + 0.15;
// the wall cross-section: [distance from the centre line, height]
export const WALL_PROF = [[0.62, 0], [0.62, 0.25], [0.56, 0.31], [0.55, 3.1], [0.36, WALL_H], [-0.36, WALL_H], [-0.55, 3.1], [-0.56, 0.31], [-0.62, 0.25], [-0.62, 0]];
export const WALL_W = 1.24;
// height of the wall surface at distance d from its centre line (the height grid uses this)
export function wallHeightAt(d) {
  d = Math.abs(d);
  return d <= 0.36 ? WALL_H : d <= 0.55 ? WALL_H - ((d - 0.36) / 0.19) * 0.3 : d <= 0.56 ? 3.1 : 0.25;
}

const cylGeo = (...a) => cylUV(new THREE.CylinderGeometry(...a));

// ------------------------------------------------------------------ structure

// A dividing wall from (x0, z0) to (x1, z1), axis-aligned: cast concrete, plinth, near-vertical sides,
// chamfered top, flat crown. The kind explosives plants build between bays (and it stops bullets).
// Closed at both ends; it runs a little into the columns at its ends so the joint is hidden.
export function wall(ctx, { x0, z0, x1, z1, outer = false }) {
  const { M } = ctx;
  const horiz = Math.abs(z1 - z0) < 0.01;
  const L = horiz ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const ax = horiz ? Math.sign(x1 - x0) : 0, az = horiz ? 0 : Math.sign(z1 - z0); // along
  const px = horiz ? 0 : 1, pz = horiz ? 1 : 0;                                   // across
  const inset = COL - 0.3;                                                          // into each end column
  const sx = x0 + ax * inset, sz = z0 + az * inset, len = Math.max(0.1, L - 2 * inset);
  const pos = [], nor = [], uv = [], idx = [], groups = [];
  const at = (s, d, y) => [sx + ax * s + px * d, y, sz + az * s + pz * d];
  const quadOut = (a, b, c, e, n) => {
    const P = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const out = new THREE.Vector3().subVectors(P(b), P(a)).cross(new THREE.Vector3().subVectors(P(c), P(a))).dot(n) > 0;
    if (out) idx.push(a, b, c, b, e, c); else idx.push(a, c, b, b, c, e);
  };
  // the long faces, one quad per edge of the cross-section (flat-shaded)
  for (let i = 0; i < WALL_PROF.length - 1; i++) {
    const [d0, y0] = WALL_PROF[i], [d1, y1] = WALL_PROF[i + 1];
    const ed = d1 - d0, ey = y1 - y0, el = Math.hypot(ed, ey);
    const nd = ey / el, ny = -ed / el;
    const crown = Math.abs(ey) < 1e-3;
    const base = pos.length / 3;
    for (const [s, d, y] of [[0, d0, y0], [len, d0, y0], [0, d1, y1], [len, d1, y1]]) {
      pos.push(...at(s, d, y));
      nor.push(px * nd, ny, pz * nd);
      // u along the wall (one repeat = one 3 m panel); v = height on the faces, across on the crown
      uv.push(s / 3, crown ? (d + 0.36) / 0.72 : y / WALL_H);
    }
    groups.push([idx.length, 6, crown ? 1 : 0]);
    quadOut(base, base + 1, base + 2, base + 3, new THREE.Vector3(px * nd, ny, pz * nd));
  }
  // the two ends: the cross-section, triangulated
  const contour = WALL_PROF.map(([d, y]) => new THREE.Vector2(d, y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [s, sign] of [[0, -1], [len, 1]]) {
    const base = pos.length / 3, start = idx.length;
    for (const [d, y] of WALL_PROF) { pos.push(...at(s, d, y)); nor.push(ax * sign, 0, az * sign); uv.push(d / 3, y / WALL_H); }
    const n = new THREE.Vector3(ax * sign, 0, az * sign);
    for (const [a, b, c] of tris) {
      const P = (k) => new THREE.Vector3(pos[(base + k) * 3], pos[(base + k) * 3 + 1], pos[(base + k) * 3 + 2]);
      const out = new THREE.Vector3().subVectors(P(b), P(a)).cross(new THREE.Vector3().subVectors(P(c), P(a))).dot(n) > 0;
      if (out) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
    }
    groups.push([start, idx.length - start, 0]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  for (const [start, count, mi] of groups) geo.addGroup(start, count, mi);
  const m = new THREE.Mesh(geo, [M.wall, M.wallTop]);
  m.castShadow = m.receiveShadow = true;
  ctx.root.add(m);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const w = horiz ? L : WALL_W, d = horiz ? WALL_W : L;
  ctx.contact(cx, cz, w, d);
  ctx.solidWall({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, horiz, c: horiz ? cz : cx, outer });
  ctx.blocker({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, top: WALL_H });
}

// A square column with a chamfered cap (at every wall end and corner).
export function column(ctx, { x, z }) {
  const { M } = ctx;
  const h = COL_H - 0.3;
  ctx.mesh(boxUV(new RoundedBoxGeometry(COL * 2, h, COL * 2, 2, 0.04), 3, true), M.wall, x, h / 2, z); // (texture over its full height: plinth at the foot)
  // the cap: a square frustum (a four-sided cylinder turned 45 degrees), flat-shaded
  const capGeo = cylGeo(0.5 * Math.SQRT2, COL * Math.SQRT2, 0.3, 4, 1).toNonIndexed();
  capGeo.computeVertexNormals();
  const cap = ctx.mesh(capGeo, M.wallTop, x, COL_H - 0.15, z);
  cap.rotation.y = Math.PI / 4;
  ctx.contact(x, z, COL * 2, COL * 2);
  ctx.solidBox(x - COL, x + COL, z - COL, z + COL, h);
  ctx.solidBox(x - 0.5, x + 0.5, z - 0.5, z + 0.5, COL_H);
  ctx.blocker({ x0: x - COL, x1: x + COL, z0: z - COL, z1: z + COL, top: COL_H });
}

// Spray-stencilled lettering on a wall crown (the face the camera sees).
export function stencil(ctx, { x, z, text, across = false }) {
  const mat = new THREE.MeshStandardMaterial({ map: TX.stencilTexture(text), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = ctx.mesh(new THREE.PlaneGeometry(1.5, 0.5), mat, x, WALL_H + 0.004, z, { cast: false });
  m.rotation.set(-Math.PI / 2, 0, across ? Math.PI / 2 : 0);
}

// Hazard tape across a doorway, 8 m long; `across` runs it along z.
export function tape(ctx, { x, z, across = false }) {
  const m = ctx.mesh(new THREE.PlaneGeometry(8, 0.5), ctx.M.hazard, x, 0.004, z, { cast: false });
  m.rotation.set(-Math.PI / 2, 0, across ? Math.PI / 2 : 0);
}

// ------------------------------------------------------------------ props

// A lab bench with a black resin top and things on it (monitors, beakers, cases).
export function bench(ctx, { x, z, len = 6, alongX = true }) {
  const { M, R } = ctx;
  const w = alongX ? len : 1.2, d = alongX ? 1.2 : len;
  ctx.block(x, z, w - 0.1, 0.86, d - 0.1, M.cabinet);
  ctx.block(x, z, w, 0.06, d, M.benchTop, 0.86);
  const n = Math.floor(len / 1.4);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const px = alongX ? x + t * len : x + (R() - 0.5) * 0.4, pz = alongX ? z + (R() - 0.5) * 0.4 : z + t * len;
    const r = R();
    if (r < 0.35) { // a monitor
      const tex = TX.screenTexture(Math.floor(R() * 1000), R() < 0.8 ? '#46e0c8' : '#ffb347');
      ctx.block(px, pz, alongX ? 0.62 : 0.06, 0.4, alongX ? 0.06 : 0.62, M.darkSteel, 1.02, false);
      const scr = ctx.mesh(new THREE.PlaneGeometry(0.56, 0.34), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2) }), px + (alongX ? 0 : 0.035), 1.22, pz + (alongX ? 0.035 : 0), { cast: false, receive: false });
      if (!alongX) scr.rotation.y = Math.PI / 2;
      ctx.block(px, pz, 0.08, 0.1, 0.08, M.darkSteel, 0.92, false);
      ctx.solidBox(px - 0.32, px + 0.32, pz - 0.32, pz + 0.32, 1.42);
      ctx.screens.push(scr);
    } else if (r < 0.65) { // beakers
      for (let b = 0; b < 3; b++) {
        const bx = px + (R() - 0.5) * 0.5, bz = pz + (R() - 0.5) * 0.4, h = 0.18 + R() * 0.2;
        ctx.mesh(cylGeo(0.06, 0.07, h, 12), M.glass, bx, 0.92 + h / 2, bz, { cast: false });
        ctx.mesh(cylGeo(0.055, 0.065, h * 0.5, 12), M.fluid, bx, 0.92 + h * 0.25, bz, { cast: false });
      }
    } else if (r < 0.85) { // a steel case
      ctx.block(px, pz, 0.5, 0.18, 0.36, M.steel, 0.92);
    }
  }
}

// A tall cabinet / fume hood against a wall.
export function cabinet(ctx, { x, z, w = 2.6, h = 2.3, d = 1.2, mat = 'cabinet' }) {
  ctx.block(x, z, w, h, d, ctx.M[mat]);
}

// A containment tank: glass cylinder of glowing fluid on a steel collar; or the broken one, with its
// shards, its cap thrown aside and the ooze trail of what came out of it.
export function tank(ctx, { x, z, broken = false }) {
  const { M, R } = ctx;
  const r = 1.45, h = 2.6;
  ctx.mesh(cylGeo(r + 0.2, r + 0.3, 0.45, 40), M.darkSteel, x, 0.225, z);
  ctx.contact(x, z, (r + 0.3) * 2, (r + 0.3) * 2, true);
  if (!broken) {
    ctx.mesh(cylGeo(r, r, h, 40, 1, true), M.glass, x, 0.45 + h / 2, z, { cast: false });
    ctx.mesh(cylGeo(r - 0.06, r - 0.06, h * 0.8, 40), M.fluid, x, 0.45 + h * 0.4, z, { cast: false });
    ctx.mesh(cylGeo(r + 0.18, r + 0.18, 0.35, 40), M.darkSteel, x, 0.45 + h + 0.175, z);
    ctx.solidDisc(x, z, r + 0.2, 0.45 + h + 0.35);
    ctx.blocker({ x0: x - r, x1: x + r, z0: z - r, z1: z + r, top: 0.45 + h + 0.35 });
    ctx.light(new THREE.PointLight(0x7dff3a, 22, 9, 2), x, 1.6, z);
  } else {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + R() * 0.2, hh = 0.2 + R() * R() * 1.6;
      ctx.mesh(cylGeo(r, r, hh, 4, 1, true, a, 0.35 + R() * 0.15), M.glass, x, 0.45 + hh / 2, z, { cast: false });
    }
    const cap = ctx.mesh(cylGeo(r + 0.18, r + 0.18, 0.35, 40), M.darkSteel, x + 3.6, 0.5, z - 1.5);
    cap.rotation.set(0.35, 0, 0.9);
    ctx.solidDisc(x, z, r + 0.3, 0.45);
    const oz = ctx.mesh(splat(R, 1, 0.35), M.ooze, x + 0.6, 0.006, z + 1.2, { cast: false });
    oz.rotation.x = -Math.PI / 2; oz.scale.set(3.4, 2.6, 1);
    for (let i = 0; i < 12; i++) {
      const t = i / 12, s = 0.15 + R() * 0.35 * (1 - t);
      const sp = ctx.mesh(splat(R, 1, 0.5), M.ooze, x + 1.5 + t * 2 + (R() - 0.5) * 1.5, 0.006, z + 3.5 + t * 9 + R(), { cast: false });
      sp.rotation.x = -Math.PI / 2; sp.scale.set(s, s * (0.7 + R() * 0.8), 1);
    }
    for (let i = 0; i < 40; i++) {
      const g = ctx.mesh(new THREE.PlaneGeometry(0.12 + R() * 0.2, 0.08 + R() * 0.15), M.glass, x + (R() - 0.5) * 8, 0.01, z + (R() - 0.2) * 7, { cast: false });
      g.rotation.set(-Math.PI / 2, 0, R() * 6);
    }
    ctx.light(new THREE.PointLight(0x7dff3a, 8, 9, 2), x + 0.5, 2.2, z + 1.2);
  }
  const pipe = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(x - r - 0.25, 0.3, z), new THREE.Vector3(x - r - 0.6, 0.15, z), new THREE.Vector3(x - r - 2.5, 0.15, z - 0.5),
  ]), 16, 0.12, 8);
  ctx.mesh(pipe, M.steel, 0, 0, 0);
}

// A row of n server racks along z from z0, LED fronts facing +x (face = 1) or -x (face = -1).
export function rackRow(ctx, { x, z0, n = 15, face = 1 }) {
  const { M } = ctx;
  for (let i = 0; i < n; i++) {
    const geo = boxUV(new THREE.BoxGeometry(1.1, 2.1, 0.62), 1.5);
    const uv = geo.attributes.uv; // the front face (box faces 0 and 1 are +x and -x): the whole texture
    for (let f = 0; f < 2; f++) for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, k % 2, 1 - Math.floor(k / 2));
    const mats = face > 0 ? [M.rackFront, M.rackSide, M.rackSide, M.rackSide, M.rackSide, M.rackSide] : [M.rackSide, M.rackFront, M.rackSide, M.rackSide, M.rackSide, M.rackSide];
    ctx.mesh(geo, mats, x, 1.05, z0 + i * 0.64);
  }
  const z1 = z0 + (n - 1) * 0.64;
  ctx.solidBox(x - 0.55, x + 0.55, z0 - 0.31, z1 + 0.31, 2.1);
  ctx.blocker({ x0: x - 0.55, x1: x + 0.55, z0: z0 - 0.31, z1: z1 + 0.31, top: 2.1 });
  ctx.contact(x, (z0 + z1) / 2, 1.1, n * 0.64);
}

// One or two crates stacked (army green, grey case or wood).
export function crateStack(ctx, { x, z }) {
  const { M, R } = ctx;
  const mat = [M.crateGreen, M.crateGrey, M.crateWood][Math.floor(R() * 3)];
  const s = 1.1 + R() * 0.5;
  ctx.block(x, z, s, s * 0.85, s, mat);
  if (R() < 0.6) ctx.block(x + (R() - 0.5) * 0.2, z + (R() - 0.5) * 0.2, s * 0.9, s * 0.75, s * 0.85, mat, s * 0.85);
}

// An oil drum.
export function drum(ctx, { x, z, color = 'yellow' }) {
  const mat = color === 'blue' ? ctx.M.drumBlue : ctx.M.drumYellow;
  ctx.mesh(cylGeo(0.32, 0.32, 0.92, 20), mat, x, 0.46, z);
  ctx.contact(x, z, 0.64, 0.64, true);
  ctx.solidDisc(x, z, 0.32, 0.92);
}

// A cluster of gas bottles.
export function gasBottles(ctx, { x, z, n = 5 }) {
  for (let i = 0; i < n; i++) ctx.mesh(cylGeo(0.13, 0.13, 1.5, 12), ctx.M.drumBlue, x - 0.4 + (i % 3) * 0.3, 0.75, z - 0.2 + Math.floor(i / 3) * 0.3);
  ctx.solidDisc(x, z, 0.6, 1.5);
}

// A big machine (generator / compressor) with a control panel and a pipe up and away.
export function machine(ctx, { x, z }) {
  const { M } = ctx;
  ctx.block(x, z, 4.4, 2.4, 2.6, M.darkSteel);
  ctx.block(x - 1.2, z, 1.4, 0.5, 1.8, M.steel, 2.4);
  ctx.block(x + 1.1, z + 0.4, 1.0, 0.8, 1.0, M.cabinet, 2.4);
  ctx.blocker({ x0: x - 2.2, x1: x + 2.2, z0: z - 1.3, z1: z + 1.3, top: 2.4 });
  const pnl = ctx.mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ map: TX.screenTexture(77, '#ffb347'), color: new THREE.Color(2, 2, 2) }), x + 1.2, 1.4, z + 1.31, { cast: false });
  ctx.screens.push(pnl);
  const pipe = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(x - 1.2, 2.6, z), new THREE.Vector3(x - 1.2, 3.0, z - 2), new THREE.Vector3(x - 1.2, 3.0, z - 6.5),
  ]), 20, 0.28, 10);
  ctx.mesh(pipe, M.steel, 0, 0, 0);
}

// A cable snaking across the floor through points [[x, z], ...].
export function cable(ctx, { pts }) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0.05, z)));
  ctx.mesh(new THREE.TubeGeometry(curve, 80, 0.05, 6), ctx.M.cable, 0, 0, 0, { cast: false });
}

// ------------------------------------------------------------------ lights

// A ceiling lamp: a pool of light from 10 m up (no visible fixture: from up here it'd be a dark disc
// between the camera and the floor). shadow: casts shadows (keep these few); flicker: stutters.
export function lamp(ctx, { x, z, shadow = false, flicker = false }) {
  const l = new THREE.SpotLight(0xffe8cc, 700, 0, 0.72, 0.65, 2);
  l.target.position.set(x, 0, z);
  ctx.light(l, x, 9.9, z);
  ctx.root.add(l.target);
  if (shadow) {
    l.castShadow = true;
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.camera.near = 1; l.shadow.camera.far = 18;
    l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03;
  }
  ctx.lamps.push({ l, base: l.intensity, flicker });
}

// A red alarm beacon on top of a column, its beam sweeping round.
export function beacon(ctx, { x, z, phase = 0 }) {
  ctx.mesh(cylGeo(0.16, 0.2, 0.3, 16), ctx.M.beacon, x, COL_H + 0.15, z, { cast: false });
  const l = new THREE.SpotLight(0xff2010, 260, 30, 0.42, 0.5, 2);
  ctx.light(l, x, COL_H + 0.3, z);
  ctx.root.add(l.target);
  ctx.beacons.push({ l, x, z, phase });
}

// ------------------------------------------------------------------ floor markings

// A steel tread-plate access hatch set in the floor, with a painted hazard border.
export function hatch(ctx, { x, z, size = 1.4 }) {
  const s = pbrSet('metal_plate', 0.5);
  const plate = new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normal, roughnessMap: s.arm, metalnessMap: s.arm, roughness: 1, metalness: 1, color: 0x9a9e9f, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  ctx.mesh(floorGeometry(x - size / 2, z - size / 2, x + size / 2, z + size / 2), plate, 0, 0.006, 0, { cast: false });
  const tex = ctx.M.hazard.map.clone();
  tex.repeat.set((size + 0.3) / 1.2, 1);
  const border = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const [dx, dz, rot] of [[0, -1, 0], [0, 1, 0], [-1, 0, 1], [1, 0, 1]]) {
    const m = ctx.mesh(new THREE.PlaneGeometry(size + 0.3, 0.15), border, x + dx * (size / 2 + 0.075), 0.005, z + dz * (size / 2 + 0.075), { cast: false });
    m.rotation.set(-Math.PI / 2, 0, rot ? Math.PI / 2 : 0);
  }
}

// A round drain grate.
export function drain(ctx, { x, z, r = 0.45 }) {
  const m = ctx.mesh(new THREE.CircleGeometry(r, 32), drainMaterial(), x, 0.006, z, { cast: false });
  m.rotation.x = -Math.PI / 2;
}
let _drain = null;
function drainMaterial() {
  if (_drain) return _drain;
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#2a2c2d'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#050505';
  for (let i = -6; i <= 6; i++) g.fillRect(128 + i * 16 - 4, 40, 8, 176);  // slots
  g.strokeStyle = '#4a4d4f'; g.lineWidth = 14; g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.stroke(); // rim
  return (_drain = new THREE.MeshStandardMaterial({ map: canvasTexture(c, { repeat: false }), roughness: 0.55, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}

// A worn painted line on the floor from (x0, z0) to (x1, z1), axis-aligned or not.
export function paint(ctx, { x0, z0, x1, z1, w = 0.12, color = 0xd4a628 }) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const m = ctx.mesh(new THREE.PlaneGeometry(L, w), paintMaterial(color), (x0 + x1) / 2, 0.004, (z0 + z1) / 2, { cast: false });
  m.rotation.set(-Math.PI / 2, 0, -Math.atan2(z1 - z0, x1 - x0));
  m.geometry.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 0) a[i] = v * L / 3; }); // wear texture at 3 m
}
// A painted safety ring round something (a tank): yellow, worn.
export function ring(ctx, { x, z, r = 2.4, w = 0.14, color = 0xd4a628 }) {
  const m = ctx.mesh(new THREE.RingGeometry(r - w / 2, r + w / 2, 64), paintMaterial(color), x, 0.004, z, { cast: false });
  m.rotation.x = -Math.PI / 2;
}
const _paint = {};
function paintMaterial(color) {
  if (_paint[color]) return _paint[color];
  const S = 512, n = fbm(S, 64, 24, 3, 77);
  const [c, g] = makeCanvas(S, 64);
  const img = g.createImageData(S, 64);
  for (let i = 0; i < S * 64; i++) { const a = n[i] > 0.38 ? 1 : n[i] > 0.3 ? (n[i] - 0.3) / 0.08 : 0; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = a * 255; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const alpha = canvasTexture(c, { srgb: false });
  return (_paint[color] = new THREE.MeshStandardMaterial({ color, alphaMap: alpha, transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}
