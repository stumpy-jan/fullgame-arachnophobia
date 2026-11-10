import * as THREE from 'three';
import { rng, boxUV } from '../util.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createMaterials } from './materials.js';
import * as KIT from './kit.js';
import { segBox } from './geom.js';
import { floorMaterial, floorGeometry } from './floors.js';

// Builds a level from a layout (layout.js: plain data, hand-made or generated) and answers the
// questions the game asks about it:
//   heightAt(x, z)   the highest walkable top under a point (a 10 cm grid of every solid)
//   collide(p, r)    push a circle back inside the outer walls
//   shotHit(a, b)    where a shot first hits a wall/column/tall prop below its top (-1: it gets through)
//   nav              a 0.5 m walk grid for people (floor cells clear of props), for path maps
//   roomAt(x, z)     which room a point is in
//   update(t)        lights that flicker and sweep, screens that shimmer
export function buildWorld(scene, layout) {
  const { bounds: B } = layout;
  const root = new THREE.Group();
  scene.add(root);
  const M = createMaterials();
  const solids = [], blockers = [];

  // ---------------------------------------------------------------- the build context the kit uses
  const ctx = {
    root, M, R: rng(layout.seed), screens: [], lamps: [], glows: [], beacons: [], breakables: [], locks: [], door: null, solids,
    mesh(geo, mat, x, y, z, { cast = true, receive = true } = {}) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = cast; m.receiveShadow = receive;
      root.add(m);
      return m;
    },
    // a box standing on y0, bevelled (a sharp CG edge never catches the light; a 3-4 cm round-over does)
    block(x, z, w, h, d, mat, y0 = 0, solid = true) {
      const r = Math.min(0.04, w * 0.2, h * 0.2, d * 0.2);
      const m = ctx.mesh(boxUV(new RoundedBoxGeometry(w, h, d, 2, r), 1.5), mat, x, y0 + h / 2, z);
      if (solid) ctx.solidBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y0 + h);
      if (y0 === 0) ctx.contact(x, z, w, d);
      return m;
    },
    // a soft dark footprint round the base of anything on the floor (faked ambient occlusion)
    contact(x, z, w, d, round = false) {
      const m = new THREE.Mesh(contactGeo, round ? M.aoRound : M.aoRect);
      const k = round ? 0.6 : 0.56; // the texture's blurred shape spans this much of the quad
      m.position.set(x, 0.002, z);
      m.scale.set((w + 0.5) / k, 1, (d + 0.5) / k);
      m.renderOrder = -1;
      root.add(m);
    },
    solidBox(x0, x1, z0, z1, top) { solids.push({ x0, x1, z0, z1, top }); },
    solidDisc(cx, cz, r, top) { solids.push({ cx, cz, r, top }); },
    solidWall(w) { solids.push({ ...w, top: KIT.WALL_H, prof: true }); },
    blocker(b) { blockers.push(b); },
    light(l, x, y, z) { l.position.set(x, y, z); root.add(l); },
  };
  const contactGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  // ---------------------------------------------------------------- floors: one slab per room, by type
  // (and a default slab under everything a room doesn't cover)
  const W = B.x1 - B.x0, D = B.z1 - B.z0;
  ctx.mesh(floorGeometry(B.x0, B.z0, B.x1, B.z1), floorMaterial('default'), 0, -0.01, 0, { cast: false });
  for (const r of layout.rooms) ctx.mesh(floorGeometry(r.x0, r.z0, r.x1, r.z1), floorMaterial(r.type), 0, 0, 0, { cast: false });
  const voidFloor = ctx.mesh(new THREE.PlaneGeometry(400, 400), M.void, 0, -0.02, 0, { cast: false });
  voidFloor.rotation.x = -Math.PI / 2;

  // ---------------------------------------------------------------- walls, columns at their ends, pieces
  const columns = new Map();
  for (const w of layout.walls) {
    KIT.wall(ctx, w);
    for (const [x, z] of [[w.x0, w.z0], [w.x1, w.z1]]) columns.set(`${x},${z}`, { x, z });
  }
  for (const c of columns.values()) KIT.column(ctx, c);
  for (const p of layout.pieces) {
    const build = KIT[p.type];
    if (!build) throw new Error(`layout: no kit piece "${p.type}"`);
    build(ctx, p);
  }
  scene.add(new THREE.HemisphereLight(0x7a93a8, 0x0d0d0f, 0.22));

  // ---------------------------------------------------------------- pooled lights
  // A forward renderer pays for every light on every pixel, so a level has a fixed set of real lights that go to
  // the lamps (and vat glows) nearest the camera's focus: 12 spots, the first 5 casting shadows, and 3 points.
  const SPOTS = Math.min(12, ctx.lamps.length), SHADOWS = Math.min(5, SPOTS), GLOWS = Math.min(3, ctx.glows.length);
  const spots = [], points = [];
  for (let i = 0; i < SPOTS; i++) {
    const l = new THREE.SpotLight(0xffe8cc, 0, 0, 0.72, 0.65, 2);
    if (i < SHADOWS) {
      l.castShadow = true; l.shadow.mapSize.set(1024, 1024);
      l.shadow.camera.near = 1; l.shadow.camera.far = 18; l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03;
    }
    root.add(l, l.target); spots.push(l);
  }
  for (let i = 0; i < GLOWS; i++) { const l = new THREE.PointLight(0xff3aa8, 0, 7, 2); root.add(l); points.push(l); }
  const near = (list, n, fx, fz) => list.map((o) => [(o.x - fx) ** 2 + (o.z - fz) ** 2, o]).sort((p, q) => p[0] - q[0]).slice(0, n).map((p) => p[1]);
  function assignLights(t, fx, fz) {
    // shadow casters first (the lamps marked for it), then the rest, nearest first
    const chosen = near(ctx.lamps, SPOTS, fx, fz).sort((p, q) => (q.shadow - p.shadow));
    chosen.forEach((L, i) => {
      const l = spots[i];
      l.position.set(L.x, 9.9, L.z); l.target.position.set(L.x, 0, L.z);
      const f = L.flicker && (Math.sin(t * 13.1 + L.i) * Math.sin(t * 7.7 + 1) > 0.55 || Math.sin(t * 0.9 + L.i) > 0.92) ? 0.08 : 1;
      l.intensity = L.base * f;
    });
    near(ctx.glows, GLOWS, fx, fz).forEach((G, i) => { points[i].position.set(G.x, G.y, G.z); points[i].intensity = G.ref.intensity; });
  }
  assignLights(0, layout.spawn.x, layout.spawn.z);

  // ---------------------------------------------------------------- height field
  // every solid rasterised at 10 cm; a cell holds the highest top over its centre; outside: floor
  const G = 0.1, GX = B.x0 - 1, GZ = B.z0 - 1, GW = Math.ceil((W + 2) / G), GD = Math.ceil((D + 2) / G);
  const grid = new Float32Array(GW * GD);
  for (const so of solids) {
    const round = so.r !== undefined;
    const x0 = round ? so.cx - so.r : so.x0, x1 = round ? so.cx + so.r : so.x1;
    const z0 = round ? so.cz - so.r : so.z0, z1 = round ? so.cz + so.r : so.z1;
    const i0 = Math.max(0, Math.ceil((x0 - GX) / G - 0.5)), i1 = Math.min(GW - 1, Math.floor((x1 - GX) / G - 0.5));
    const k0 = Math.max(0, Math.ceil((z0 - GZ) / G - 0.5)), k1 = Math.min(GD - 1, Math.floor((z1 - GZ) / G - 0.5));
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        const cx = GX + (i + 0.5) * G, cz = GZ + (k + 0.5) * G;
        if (round && (cx - so.cx) ** 2 + (cz - so.cz) ** 2 > so.r * so.r) continue;
        const top = so.prof ? KIT.wallHeightAt((so.horiz ? cz : cx) - so.c) : so.top;
        const j = k * GW + i;
        if (top > grid[j]) grid[j] = top;
      }
    }
  }
  function heightAt(x, z) {
    const i = Math.floor((x - GX) / G), k = Math.floor((z - GZ) / G);
    return i < 0 || k < 0 || i >= GW || k >= GD ? 0 : grid[k * GW + i];
  }

  // ---------------------------------------------------------------- queries
  const outer = solids.filter((s) => s.outer);
  function collide(p, r) {
    for (const s of outer) {
      const cx = Math.max(s.x0, Math.min(p.x, s.x1)), cz = Math.max(s.z0, Math.min(p.z, s.z1));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (s.open) continue; // (an exit door once it's open)
      if (d2 < r * r) { const d = Math.sqrt(d2) || 1e-4; p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d); }
    }
  }
  function shotHit(a, b) {
    let best = -1;
    for (const w of blockers) {
      const t = segBox(a.x, a.z, b.x, b.z, w);
      if (t < 0 || (best >= 0 && t >= best)) continue;
      if (a.y + (b.y - a.y) * t < w.top) best = t;
    }
    return best;
  }
  // the walk grid: 0.5 m cells whose whole area is open floor (people go round props, through doors)
  const NC = 0.5, NX = Math.round(W / NC), NZ = Math.round(D / NC);
  const pass = new Uint8Array(NX * NZ);
  for (let k = 0; k < NZ; k++) {
    for (let i = 0; i < NX; i++) {
      const x = B.x0 + (i + 0.5) * NC, z = B.z0 + (k + 0.5) * NC;
      let open = true;
      for (const [ox, oz] of [[0, 0], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) if (heightAt(x + ox, z + oz) > 0.3) { open = false; break; }
      pass[k * NX + i] = open ? 1 : 0;
    }
  }
  const nav = {
    cell: NC, x0: B.x0, z0: B.z0, nx: NX, nz: NZ, pass,
    index(x, z) { const i = Math.floor((x - B.x0) / NC), k = Math.floor((z - B.z0) / NC); return i < 0 || k < 0 || i >= NX || k >= NZ ? -1 : k * NX + i; },
    center(j, out) { out.x = B.x0 + ((j % NX) + 0.5) * NC; out.z = B.z0 + (Math.floor(j / NX) + 0.5) * NC; return out; },
    open(x, z) { const j = nav.index(x, z); return j >= 0 && pass[j] === 1; },
  };
  // knock a rectangle of the height field down to the floor (the exit door, once it has slid up out of the way)
  function clearHeight(x0, x1, z0, z1) {
    for (let k = Math.max(0, Math.floor((z0 - GZ) / G)); k <= Math.min(GD - 1, Math.floor((z1 - GZ) / G)); k++) {
      for (let i = Math.max(0, Math.floor((x0 - GX) / G)); i <= Math.min(GW - 1, Math.floor((x1 - GX) / G)); i++) grid[k * GW + i] = 0;
    }
  }
  function roomAt(x, z) { return layout.rooms.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) || null; }

  function update(t, focus) {
    if (focus) assignLights(t, focus.x, focus.z);
    for (const b of ctx.beacons) {
      const a = t * 2.4 + b.phase;
      b.l.target.position.set(b.x + Math.cos(a) * 7, 0, b.z + Math.sin(a) * 7);
    }
    for (const s of ctx.screens) s.material.color.setScalar(1.8 + Math.sin(t * 30 + s.id) * 0.1);
  }

  return {
    lights: spots, root, layout, bounds: B, rooms: layout.rooms, breakables: ctx.breakables, locks: ctx.locks, door: ctx.door, clearHeight, heightAt, collide, shotHit, nav, roomAt, update,
    route: layout.route.map(([x, z]) => new THREE.Vector2(x, z)),
    spawn: layout.spawn,
  };
}
