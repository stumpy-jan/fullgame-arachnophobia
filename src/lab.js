import * as THREE from 'three';
import { rng, boxUV, cylUV } from './util.js';
const cylGeo = (...a) => cylUV(new THREE.CylinderGeometry(...a));
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';

// The lab: a walled floor plan of five rooms, flat-topped props the spider can walk over, and the lights.
// Everything the spider can stand on is registered as a solid (an axis-aligned box or an upright
// cylinder, both flat-topped), so heightAt(x, z) is just the highest top under the point.
//
//   x -32 .. -10            -10 .. 10              10 .. 32
//   wet lab        |                         |  machine room
//   ---- door ---- |   containment hall      |
//   server room    |   (the broken tank)     |  ---- door ----
//                  |                         |  storage

export const WALL_H = 3.4;
const WALL_T = 1.2; // thick enough for the spider to plant its feet on

// an irregular blob outline (unit radius, `rough` = how ragged), flat in xy
function splat(R, r, rough) {
  const sh = new THREE.Shape(), N = 28, ph = [R() * 6, R() * 6, R() * 6];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const k = r * (1 + rough * (0.5 * Math.sin(a * 2 + ph[0]) + 0.3 * Math.sin(a * 5 + ph[1]) + 0.2 * Math.sin(a * 9 + ph[2])));
    i ? sh.lineTo(Math.cos(a) * k, Math.sin(a) * k) : sh.moveTo(Math.cos(a) * k, Math.sin(a) * k);
  }
  return new THREE.ShapeGeometry(sh, 6);
}

export function buildLab(scene) {
  const R = rng(1337);
  const root = new THREE.Group();
  scene.add(root);
  const solids = [];
  const box = (x0, x1, z0, z1, top, wall = false, outer = false) => solids.push({ x0, x1, z0, z1, top, wall, outer });
  const disc = (cx, cz, r, top) => solids.push({ cx, cz, r, top });

  // ---------------------------------------------------------------- materials
  const floorT = TX.floorTextures();
  for (const t of [floorT.map, floorT.rough, floorT.normal]) t.repeat.set(64 / 16, 44 / 16);
  // worn paint / metal: three variants so neighbouring props don't share the same chips
  const W1 = TX.wornTextures(101), W2 = TX.wornTextures(202), W3 = TX.wornTextures(303);
  // a worn surface: colour x grime map, normal map, roughness map (x the material's roughness)
  const worn = (w, color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({
    color, map: w.map, normalMap: w.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: w.rough, roughness, metalness, ...extra,
  });
  const hazard = TX.hazardTexture();
  const rack = TX.rackTextures();
  const M = {
    floor: new THREE.MeshStandardMaterial({ map: floorT.map, roughnessMap: floorT.rough, normalMap: floorT.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0 }),
    cabinet: worn(W1, 0x8a949a, 1.0, 0.2),                       // painted steel
    benchTop: worn(W2, 0x2a2d30, 0.7, 0.0, { normalScale: new THREE.Vector2(0.2, 0.2) }), // black resin, satin
    steel: worn(W3, 0x8d959a, 0.75, 0.8),                        // bare steel, scuffed
    darkSteel: worn(W2, 0x40464b, 0.95, 0.5),
    rackFront: new THREE.MeshStandardMaterial({ map: rack.map, emissiveMap: rack.emissive, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.6, metalness: 0.4, normalMap: W3.normal, normalScale: new THREE.Vector2(0.4, 0.4) }),
    rackSide: worn(W3, 0x24282b, 0.9, 0.4),
    crateGreen: worn(W1, 0x56623f, 1.15, 0.05),                  // army-green paint
    crateGrey: worn(W2, 0x60666a, 1.0, 0.3),
    crateWood: worn(W3, 0x8a6a45, 1.25, 0.0),
    drumYellow: worn(W1, 0xc39222, 1.0, 0.2),
    drumBlue: worn(W2, 0x29537a, 1.0, 0.2),
    hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe8e0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 }),
    fluid: new THREE.MeshStandardMaterial({ color: 0x2a6b1a, emissive: 0x7dff3a, emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.85 }),
    ooze: new THREE.MeshStandardMaterial({ color: 0x0a1405, emissive: 0x3c9a12, emissiveIntensity: 0.12, roughness: 0.03, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    puddle: new THREE.MeshStandardMaterial({ color: 0x0b0d0e, roughness: 0.03, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 }),
    lampShade: new THREE.MeshStandardMaterial({ color: 0x2d3236, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide }),
    bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.92, 0.78).multiplyScalar(6) }),
    beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.04).multiplyScalar(5) }),
  };

  const mesh = (geo, mat, x, y, z, { cast = true, receive = true, ry = 0 } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = cast; m.receiveShadow = receive;
    root.add(m);
    return m;
  };
  // a box standing on `y0`, size (w, h, d), metre-tiled UVs
  // (bevelled: a sharp CG edge never catches the light; a 3-4 cm round-over does)
  const block = (x, z, w, h, d, mat, y0 = 0, solid = true) => {
    const r = Math.min(0.04, w * 0.2, h * 0.2, d * 0.2);
    const geo = boxUV(new RoundedBoxGeometry(w, h, d, 2, r), 1.5);
    const m = mesh(geo, mat, x, y0 + h / 2, z);
    if (solid) box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y0 + h);
    if (y0 === 0) contact(x, z, w, d);
    return m;
  };
  // contact shadow: a soft dark footprint on the floor round the base of everything (ambient occlusion,
  // faked: what grounds an object; without it, things float)
  const aoRect = TX.contactTexture(false), aoRound = TX.contactTexture(true);
  const aoMat = (t, o) => new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const AO = { rect: aoMat(aoRect, 0.8), round: aoMat(aoRound, 0.85) };
  const contactGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  function contact(x, z, w, d, round = false) {
    // the texture's blurred shape spans the middle 56%; grow the quad so that matches the footprint + ~0.25 m
    const m = new THREE.Mesh(contactGeo, round ? AO.round : AO.rect);
    m.position.set(x, 0.002, z);
    m.scale.set((w + 0.5) / (round ? 0.6 : 0.56), 1, (d + 0.5) / (round ? 0.6 : 0.56));
    m.renderOrder = -1;
    root.add(m);
  }

  // ---------------------------------------------------------------- floor
  const floor = mesh(new THREE.PlaneGeometry(64, 44), M.floor, 0, 0, 0, { cast: false });
  floor.rotation.x = -Math.PI / 2;
  // beyond the walls: a dark void floor so the edge of the world isn't a hard cut
  const outer = mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 1 }), 0, -0.02, 0, { cast: false });
  outer.rotation.x = -Math.PI / 2;

  // ---------------------------------------------------------------- walls
  // Dividing walls: the kind explosives plants build between bays so a blast in one doesn't carry to
  // the next (and, it turns out, so gunfire doesn't either). Cast concrete: a plinth at the foot,
  // near-vertical sides, a chamfered top with a flat crown the spider walks along; 3 m panels (the
  // joints are in the texture) and a square column at every end and corner.
  // Profile: [distance from the centre line, height].
  const PROF = [[0.62, 0], [0.62, 0.25], [0.56, 0.31], [0.55, 3.1], [0.36, WALL_H], [-0.36, WALL_H], [-0.55, 3.1], [-0.56, 0.31], [-0.62, 0.25], [-0.62, 0]];
  const COL = 0.78, COL_H = WALL_H + 0.15; // column half-size, height
  const wallTex = TX.blastWallTextures(), topTex = TX.wallTopTextures();
  M.wall = new THREE.MeshStandardMaterial({ map: wallTex.map, normalMap: wallTex.normal, roughnessMap: wallTex.rough, roughness: 1, metalness: 0 });
  M.wallTop = new THREE.MeshStandardMaterial({ map: topTex.map, normalMap: topTex.normal, roughnessMap: topTex.rough, roughness: 1, metalness: 0 });
  const columns = new Map(), walls = [];
  const wall = (x0, z0, x1, z1, outer = false) => {
    const horiz = Math.abs(z1 - z0) < 0.01;
    const L = horiz ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const ax = horiz ? Math.sign(x1 - x0) : 0, az = horiz ? 0 : Math.sign(z1 - z0); // along the wall
    const px = horiz ? 0 : 1, pz = horiz ? 1 : 0;                                   // across it
    const sx = x0 + ax * COL, sz = z0 + az * COL, len = L - 2 * COL;                  // between its end columns
    const pos = [], nor = [], uv = [], idx = [], groups = [];
    for (let i = 0; i < PROF.length - 1; i++) {
      const [d0, y0] = PROF[i], [d1, y1] = PROF[i + 1];
      const ed = d1 - d0, ey = y1 - y0, el = Math.hypot(ed, ey);
      const nd = ey / el, ny = -ed / el;                 // outward normal of this edge in the cross-section
      const crown = Math.abs(ey) < 1e-3;
      const base = pos.length / 3;
      for (const [s, d, y] of [[0, d0, y0], [len, d0, y0], [0, d1, y1], [len, d1, y1]]) {
        pos.push(sx + ax * s + px * d, y, sz + az * s + pz * d);
        nor.push(px * nd, ny, pz * nd);
        // u along the wall (one texture repeat = one 3 m panel); v = height (bands at the foot), or across the crown
        uv.push(s / 3, crown ? (d + 0.36) / 0.72 : y / WALL_H);
      }
      const P = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
      const n = new THREE.Vector3(px * nd, ny, pz * nd);
      const a = base, b = base + 1, c = base + 2, e = base + 3;
      const facesOut = new THREE.Vector3().subVectors(P(b), P(a)).cross(new THREE.Vector3().subVectors(P(c), P(a))).dot(n) > 0;
      groups.push([idx.length, crown ? 1 : 0]);
      if (facesOut) idx.push(a, b, c, b, e, c); else idx.push(a, c, b, b, c, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    for (const [start, mi] of groups) geo.addGroup(start, 6, mi);
    const m = new THREE.Mesh(geo, [M.wall, M.wallTop]);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = horiz ? L : 1.24, d = horiz ? 1.24 : L;
    contact(cx, cz, w, d);
    solids.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, top: WALL_H, wall: true, outer, prof: { horiz, c: horiz ? cz : cx } });
    walls.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
    for (const [x, z] of [[x0, z0], [x1, z1]]) columns.set(`${x},${z}`, [x, z]);
  };
  // a column: a square post with a chamfered cap like the walls
  const column = (x, z) => {
    mesh(boxUV(new RoundedBoxGeometry(COL * 2, COL_H - 0.3, COL * 2, 2, 0.04), 3), M.wall, x, (COL_H - 0.3) / 2, z);
    const cap = mesh(new THREE.CylinderGeometry(0.5 * Math.SQRT2, COL * Math.SQRT2, 0.3, 4, 1), M.wallTop, x, COL_H - 0.15, z);
    cap.rotation.y = Math.PI / 4; // (a four-sided cylinder, turned: a square frustum)
    contact(x, z, COL * 2, COL * 2);
    box(x - COL, x + COL, z - COL, z + COL, COL_H - 0.3, true, false);
    box(x - 0.5, x + 0.5, z - 0.5, z + 0.5, COL_H, true, false);
    walls.push({ x0: x - COL, x1: x + COL, z0: z - COL, z1: z + COL });
  };
  // stencilled bay codes on the crowns (the face the camera sees)
  const stencil = (x, z, text, across) => {
    const m = mesh(new THREE.PlaneGeometry(1.5, 0.5), new THREE.MeshStandardMaterial({ map: TX.stencilTexture(text), transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }), x, WALL_H + 0.004, z, { cast: false });
    m.rotation.set(-Math.PI / 2, 0, across ? Math.PI / 2 : 0);
  };
  // outer shell
  wall(-32, -22, 32, -22, true); wall(-32, 22, 32, 22, true); wall(-32, -22, -32, 22, true); wall(32, -22, 32, 22, true);
  // partitions (doorways are the gaps)
  wall(-10, -22, -10, -4); wall(-10, 4, -10, 22);
  wall(10, -22, 10, -7); wall(10, 1, 10, 22);
  wall(-32, 0, -25, 0); wall(-17, 0, -10, 0);
  wall(10, 6, 17, 6); wall(25, 6, 32, 6);
  for (const [x, z] of columns.values()) column(x, z);
  stencil(-10, -13, 'BAY 2', true); stencil(-10, 13, 'BAY 3', true); stencil(10, -14, 'BAY 4', true); stencil(10, 13, 'BAY 5', true);
  stencil(-28.5, 0, 'W-1', false); stencil(28.5, 6, 'X-7', false);

  // hazard tape across each doorway
  // stripes run along the tape (u = length, 1.2 m per repeat); `across` turns it to run along z
  M.hazard.map.repeat.set(8 / 1.2, 1);
  const tape = (x, z, across) => {
    const m = mesh(new THREE.PlaneGeometry(8, 0.5), M.hazard, x, 0.004, z, { cast: false });
    m.rotation.set(-Math.PI / 2, 0, across ? Math.PI / 2 : 0);
  };
  tape(-10, 0, true); tape(10, -3, true); tape(-21, 0, false); tape(21, 6, false);

  // ---------------------------------------------------------------- props
  const screens = [];
  const bench = (x, z, len, alongX = true) => {
    const w = alongX ? len : 1.2, d = alongX ? 1.2 : len;
    block(x, z, w - 0.1, 0.86, d - 0.1, M.cabinet);
    block(x, z, w, 0.06, d, M.benchTop, 0.86);
    // things on top
    const n = Math.floor(len / 1.4);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const px = alongX ? x + t * len : x + (R() - 0.5) * 0.4, pz = alongX ? z + (R() - 0.5) * 0.4 : z + t * len;
      const r = R();
      if (r < 0.35) { // monitor
        const tex = TX.screenTexture(Math.floor(R() * 1000), R() < 0.8 ? '#46e0c8' : '#ffb347');
        const mon = block(px, pz, alongX ? 0.62 : 0.06, 0.4, alongX ? 0.06 : 0.62, M.darkSteel, 1.02, false);
        const scr = mesh(new THREE.PlaneGeometry(0.56, 0.34), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2) }), 0, 0, 0, { cast: false, receive: false });
        scr.position.set(px + (alongX ? 0 : 0.035), 1.22, pz + (alongX ? 0.035 : 0));
        if (!alongX) scr.rotation.y = Math.PI / 2;
        block(px, pz, 0.08, 0.1, 0.08, M.darkSteel, 0.92, false);
        box(px - 0.32, px + 0.32, pz - 0.32, pz + 0.32, 1.42);
        screens.push(scr);
        mon.castShadow = true;
      } else if (r < 0.65) { // beakers
        for (let b = 0; b < 3; b++) {
          const bx = px + (R() - 0.5) * 0.5, bz = pz + (R() - 0.5) * 0.4, h = 0.18 + R() * 0.2;
          mesh(cylGeo(0.06, 0.07, h, 12), M.glass, bx, 0.92 + h / 2, bz, { cast: false });
          mesh(cylGeo(0.055, 0.065, h * 0.5, 12), M.fluid, bx, 0.92 + h * 0.25, bz, { cast: false });
        }
      } else if (r < 0.85) { // a steel case
        block(px, pz, 0.5, 0.18, 0.36, M.steel, 0.92);
      }
    }
  };
  const tank = (x, z, broken = false) => {
    const r = 1.45, h = 2.6;
    mesh(cylGeo(r + 0.2, r + 0.3, 0.45, 40), M.darkSteel, x, 0.225, z);
    contact(x, z, (r + 0.3) * 2, (r + 0.3) * 2, true);
    if (!broken) {
      mesh(cylGeo(r, r, h, 40, 1, true), M.glass, x, 0.45 + h / 2, z, { cast: false });
      const fl = mesh(cylGeo(r - 0.06, r - 0.06, h * 0.8, 40), M.fluid, x, 0.45 + h * 0.4, z, { cast: false });
      fl.userData.fluid = true;
      mesh(cylGeo(r + 0.18, r + 0.18, 0.35, 40), M.darkSteel, x, 0.45 + h + 0.175, z);
      disc(x, z, r + 0.2, 0.45 + h + 0.35);
      const l = new THREE.PointLight(0x7dff3a, 22, 9, 2);
      l.position.set(x, 1.6, z);
      root.add(l);
    } else {
      // shards of the glass still standing in the collar, the cap thrown off to one side
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + R() * 0.2, hh = 0.2 + R() * R() * 1.6;
        const s = mesh(cylGeo(r, r, hh, 4, 1, true, a, 0.35 + R() * 0.15), M.glass, x, 0.45 + hh / 2, z, { cast: false });
        s.scale.set(1, 1, 1);
      }
      const cap = mesh(cylGeo(r + 0.18, r + 0.18, 0.35, 40), M.darkSteel, x + 3.6, 0.5, z - 1.5);
      cap.rotation.set(0.35, 0, 0.9);
      disc(x, z, r + 0.3, 0.45);
      // the ooze it came out in
      const oz = mesh(splat(R, 1, 0.35), M.ooze, x + 0.6, 0.006, z + 1.2, { cast: false });
      oz.rotation.x = -Math.PI / 2; oz.scale.set(3.4, 2.6, 1);
      // a trail of drips, out of the tank and away (where it went)
      for (let i = 0; i < 12; i++) {
        const t = i / 12, s = 0.15 + R() * 0.35 * (1 - t);
        const sp = mesh(splat(R, 1, 0.5), M.ooze, x + 1.5 + t * 2 + (R() - 0.5) * 1.5, 0.006, z + 3.5 + t * 9 + R(), { cast: false });
        sp.rotation.x = -Math.PI / 2; sp.scale.set(s, s * (0.7 + R() * 0.8), 1);
      }
      for (let i = 0; i < 40; i++) { // glass on the floor
        const g = mesh(new THREE.PlaneGeometry(0.12 + R() * 0.2, 0.08 + R() * 0.15), M.glass, x + (R() - 0.5) * 8, 0.01, z + (R() - 0.2) * 7, { cast: false });
        g.rotation.set(-Math.PI / 2, 0, R() * 6);
      }
      const l = new THREE.PointLight(0x7dff3a, 8, 9, 2);
      l.position.set(x + 0.5, 2.2, z + 1.2);
      root.add(l);
    }
    // feed pipes up the side of the tank and over to the wall
    const pipe = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(x - r - 0.25, 0.3, z), new THREE.Vector3(x - r - 0.6, 0.15, z), new THREE.Vector3(x - r - 2.5, 0.15, z - 0.5),
    ]), 16, 0.12, 8);
    mesh(pipe, M.steel, 0, 0, 0);
  };
  const rackRow = (x, z0, n, faceX) => {
    for (let i = 0; i < n; i++) {
      const z = z0 + i * 0.64;
      const geo = boxUV(new THREE.BoxGeometry(1.1, 2.1, 0.62), 1.5);
      // face +x or -x gets the LED front
      const mats = faceX > 0 ? [M.rackFront, M.rackSide, M.rackSide, M.rackSide, M.rackSide, M.rackSide] : [M.rackSide, M.rackFront, M.rackSide, M.rackSide, M.rackSide, M.rackSide];
      // the front UVs: whole texture on the face
      const uv = geo.attributes.uv;
      for (let f = 0; f < 2; f++) for (let k = 0; k < 4; k++) { const vi = f * 4 + k; uv.setXY(vi, k % 2, 1 - Math.floor(k / 2)); }
      const m = mesh(geo, mats, x, 1.05, z);
      void m;
    }
    box(x - 0.55, x + 0.55, z0 - 0.31, z0 + (n - 1) * 0.64 + 0.31, 2.1);
    contact(x, z0 + (n - 1) * 0.32, 1.1, n * 0.64);
  };
  const crateStack = (x, z) => {
    const mat = [M.crateGreen, M.crateGrey, M.crateWood][Math.floor(R() * 3)];
    const s = 1.1 + R() * 0.5;
    block(x, z, s, s * 0.85, s, mat);
    if (R() < 0.6) block(x + (R() - 0.5) * 0.2, z + (R() - 0.5) * 0.2, s * 0.9, s * 0.75, s * 0.85, mat, s * 0.85);
  };
  const drum = (x, z, mat) => {
    mesh(cylGeo(0.32, 0.32, 0.92, 20), mat, x, 0.46, z);
    contact(x, z, 0.64, 0.64, true);
    disc(x, z, 0.32, 0.92);
  };
  const machine = (x, z) => {
    block(x, z, 4.4, 2.4, 2.6, M.darkSteel);
    block(x - 1.2, z, 1.4, 0.5, 1.8, M.steel, 2.4);
    block(x + 1.1, z + 0.4, 1.0, 0.8, 1.0, M.cabinet, 2.4);
    const pnl = mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ map: TX.screenTexture(77, '#ffb347'), color: new THREE.Color(2, 2, 2) }), x + 1.2, 1.4, z + 1.31, { cast: false });
    screens.push(pnl);
    const pipe = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(x - 1.2, 2.6, z), new THREE.Vector3(x - 1.2, 3.0, z - 2), new THREE.Vector3(x - 1.2, 3.0, z - 6.5),
    ]), 20, 0.28, 10);
    mesh(pipe, M.steel, 0, 0, 0);
  };
  const cable = (pts) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0.05, z))), 80, 0.05, 6), M.cable, 0, 0, 0, { cast: false });
  const puddle = (x, z, s) => { const p = mesh(new THREE.CircleGeometry(1, 40), M.puddle, x, 0.005, z, { cast: false }); p.rotation.x = -Math.PI / 2; p.scale.set(s, s * (0.5 + R() * 0.5), 1); p.rotation.z = R() * 6; };

  // wet lab (top left)
  for (const z of [-17, -11, -5]) { bench(-26, z, 6); bench(-15.5, z, 6); }
  for (let x = -30; x < -12; x += 3.2) block(x, -20.4, 2.6, 2.3, 1.2, M.cabinet); // fume hoods on the north wall

  // server room (bottom left)
  rackRow(-27, 4, 15, 1); rackRow(-22, 4, 15, -1); rackRow(-17, 4, 15, 1);
  for (let x = -29; x < -12; x += 4.5) block(x, 20.6, 2.2, 1.8, 1.4, M.crateGrey);
  cable([[-27, 14], [-25, 15], [-24, 18], [-20, 19], [-17, 14]]);
  cable([[-22, 3], [-20, 1.5], [-16, 3], [-13, 6], [-12, 12]]);
  // containment hall
  tank(-6, -12); tank(6, -12); tank(0, -3, true);
  bench(-4, 13, 7); bench(5, 13, 5);
  for (let i = 0; i < 5; i++) mesh(cylGeo(0.13, 0.13, 1.5, 12), M.drumBlue, 8.6 + (i % 3) * 0.3, 0.75, -20.5 + Math.floor(i / 3) * 0.3);
  disc(9, -20.3, 0.6, 1.5);
  drum(-8.5, 18, M.drumYellow); drum(-7.8, 18.5, M.drumYellow); drum(-8.6, 19.1, M.drumBlue);
  cable([[-6, -10], [-3, -6], [0, -4.5]]); cable([[6, -10], [3, -6], [1, -4.5]]);

  // machine room (top right)
  machine(16, -16); machine(26, -16);
  block(14, -5, 2.4, 1.6, 1.6, M.cabinet); block(19, -4, 2.4, 1.6, 1.6, M.cabinet);
  for (let i = 0; i < 6; i++) drum(29 + (i % 2) * 0.7, -6 + Math.floor(i / 2) * 0.7, i % 3 ? M.drumYellow : M.drumBlue);

  // storage (bottom right)
  for (let gx = 0; gx < 4; gx++) for (let gz = 0; gz < 3; gz++) if (R() < 0.8) crateStack(14 + gx * 4.2 + (R() - 0.5), 10 + gz * 4 + (R() - 0.5));
  drum(30, 20, M.drumYellow); drum(30.7, 19.4, M.drumYellow);

  // ---------------------------------------------------------------- lights
  scene.add(new THREE.HemisphereLight(0x7a93a8, 0x0d0d0f, 0.22));
  const lamps = [];
  const lamp = (x, z, shadow, flicker = 0) => {
    const y = 10.2; // high: a lifted leg must not pass right by the bulb
    const l = new THREE.SpotLight(0xffe8cc, 700, 0, 0.72, 0.65, 2);
    l.position.set(x, y - 0.3, z);
    l.target.position.set(x, 0, z);
    root.add(l, l.target);
    if (shadow) {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.camera.near = 1; l.shadow.camera.far = 18;
      l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03;
    }
    // the fixture: a pendant shade on a cable up out of view
    // (no visible fixture: from up here a pendant shade is a big dark disc between you and the floor)
    lamps.push({ l, base: l.intensity, flicker });
  };
  lamp(-24, -13, true); lamp(-15, -6, false); lamp(-24, 9, true); lamp(-15, 16, false);
  lamp(0, -2, true, 1); lamp(0, 11, true); lamp(-5, -14, false); lamp(6, -14, false);
  lamp(18, -11, true); lamp(26, -3, false); lamp(16, 12, true); lamp(26, 17, false);

  // red alarm beacons, sweeping
  const beacons = [];
  const beacon = (x, z, phase) => {
    mesh(cylGeo(0.16, 0.2, 0.3, 16), M.beacon, x, COL_H + 0.15, z, { cast: false });
    const l = new THREE.SpotLight(0xff2010, 260, 30, 0.42, 0.5, 2);
    l.position.set(x, COL_H + 0.3, z);
    root.add(l, l.target);
    beacons.push({ l, x, z, phase });
  };
  beacon(-10, -4, 0); beacon(10, 1, 2); // on the door columns

  // ---------------------------------------------------------------- queries
  // The height field: every solid rasterised at 10 cm into a grid (the spider asks thousands of times
  // a frame). A cell holds the highest top over its centre; outside the grid it's floor.
  const G = 0.1, GX = -33, GZ = -23, GW = 660, GD = 460, grid = new Float32Array(GW * GD);
  for (const so of solids) {
    const x0 = so.r !== undefined ? so.cx - so.r : so.x0, x1 = so.r !== undefined ? so.cx + so.r : so.x1;
    const z0 = so.r !== undefined ? so.cz - so.r : so.z0, z1 = so.r !== undefined ? so.cz + so.r : so.z1;
    const i0 = Math.max(0, Math.ceil((x0 - GX) / G - 0.5)), i1 = Math.min(GW - 1, Math.floor((x1 - GX) / G - 0.5));
    const k0 = Math.max(0, Math.ceil((z0 - GZ) / G - 0.5)), k1 = Math.min(GD - 1, Math.floor((z1 - GZ) / G - 0.5));
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        if (so.r !== undefined) { const dx = GX + (i + 0.5) * G - so.cx, dz = GZ + (k + 0.5) * G - so.cz; if (dx * dx + dz * dz > so.r * so.r) continue; }
        const j = k * GW + i;
        let top = so.top;
        if (so.prof) { // a dividing wall: its cross-section, by distance from the centre line
          const d = Math.abs((so.prof.horiz ? GZ + (k + 0.5) * G : GX + (i + 0.5) * G) - so.prof.c);
          top = d <= 0.36 ? WALL_H : d <= 0.55 ? WALL_H - ((d - 0.36) / 0.19) * 0.3 : d <= 0.56 ? 3.1 : 0.25;
        }
        if (top > grid[j]) grid[j] = top;
      }
    }
  }
  function heightAt(x, z) {
    const i = Math.floor((x - GX) / G), k = Math.floor((z - GZ) / G);
    return i < 0 || k < 0 || i >= GW || k >= GD ? 0 : grid[k * GW + i];
  }
  // push a circle (the spider's body) back inside the outer walls
  function collide(p, r) {
    for (const s of solids) {
      if (!s.outer) continue; // only the outer shell holds it in: it climbs over the partitions
      const cx = Math.max(s.x0, Math.min(p.x, s.x1)), cz = Math.max(s.z0, Math.min(p.z, s.z1));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1e-4;
        p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d);
      }
    }
  }

  function update(t) {
    for (const L of lamps) {
      if (!L.flicker) continue;
      // the lamp over the broken tank: mostly on, stutters off
      const f = Math.sin(t * 13.1) * Math.sin(t * 7.7 + 1) > 0.55 || Math.sin(t * 0.9) > 0.92 ? 0.08 : 1;
      L.l.intensity = L.base * f;
    }
    for (const B of beacons) {
      const a = t * 2.4 + B.phase;
      B.l.target.position.set(B.x + Math.cos(a) * 7, 0, B.z + Math.sin(a) * 7);
    }
    for (const s of screens) s.material.color.setScalar(1.8 + Math.sin(t * 30 + s.id) * 0.1);
  }

  // the autopilot's tour: straight over the partition walls, through every room
  const route = [
    [0, 6], [-14, 10], [-14, -12], [-26, -12], [-26, 12], [0, 16], [27, 16], [27, -12], [0, -16], [0, 4],
  ].map(([x, z]) => new THREE.Vector2(x, z));

  // does a shot from a to b (x, z) pass through a wall or column? (the bullets stop on the concrete)
  function blocked(ax, az, bx, bz) {
    for (const w of walls) if (segBox(ax, az, bx, bz, w)) return true;
    return false;
  }
  return { root, heightAt, collide, update, route, blocked, walls, spawn: { x: 0, z: 2.5, heading: 0 } };
}

// does segment a-b cross the axis-aligned rectangle w (slab test)?
function segBox(ax, az, bx, bz, w) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, w.x0, w.x1], [az, dz, w.z0, w.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let u = (lo - p) / d, v = (hi - p) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}
