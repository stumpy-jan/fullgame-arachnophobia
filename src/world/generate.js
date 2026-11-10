import { rng } from '../util.js';

// A facility from a seed: the same layout data as the hand-made lab (layout.js has the format), so buildWorld
// builds it. Design/DESIGN.md "Generation":
//   1. split the site into rooms (a BSP: cut the biggest rectangles until rooms are 18-34 m)
//   2. doors: a random spanning tree over the rooms that share a wall, plus a few loops (people need doors; the
//      spider climbs walls anyway)
//   3. the start on the south wall (a containment bay, the broken tank); the exit on the north wall, in the room
//      furthest from it through the doors
//   4. depth (doors from the start) sets how full a room is: the first rooms are empty (room to learn to move),
//      then sparse with a few scientists, then furnished and guarded; the locks go deep, in separate rooms
//   5. each room furnished by its type (lab, server, industrial, storage, containment), clear of its doors
export const SITE = { x0: -66, x1: 66, z0: -48, z1: 48 };
const MIN = 18, MAX = 34, DOOR = 8, EXIT_W = 7; // (doors as wide as the lab's: the spider is ~9 m across its legs)

export function makeFacility(seed = 1) {
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const rr = (a, b) => a + R() * (b - a);
  const snap = (v) => Math.round(v * 2) / 2;

  // ---------------------------------------------------------------- 1. rooms
  const rooms = [], splits = [];
  (function split(r) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const canV = w >= 2 * MIN, canH = d >= 2 * MIN;
    if ((!canV && !canH) || (w <= MAX && d <= MAX && R() < 0.4)) { rooms.push({ ...r, id: `r${rooms.length}` }); return; }
    const vert = canV && (!canH || w > d * 1.15 || (d <= w * 1.15 && R() < 0.5));
    const lo = vert ? r.x0 : r.z0, len = vert ? w : d;
    const c = snap(lo + MIN + R() * (len - 2 * MIN));
    if (vert) { splits.push({ v: true, c, a0: r.z0, a1: r.z1 }); split({ ...r, x1: c }); split({ ...r, x0: c }); }
    else { splits.push({ v: false, c, a0: r.x0, a1: r.x1 }); split({ ...r, z1: c }); split({ ...r, z0: c }); }
  })({ ...SITE });
  for (const r of rooms) { r.cx = (r.x0 + r.x1) / 2; r.cz = (r.z0 + r.z1) / 2; r.doors = []; r.links = []; }

  // ---------------------------------------------------------------- 2. doors
  // neighbours: rooms on either side of a wall, sharing at least 13 m of it
  const pairs = [];
  for (const a of rooms) for (const b of rooms) {
    if (a === b) continue;
    if (a.x1 === b.x0) { const o0 = Math.max(a.z0, b.z0), o1 = Math.min(a.z1, b.z1); if (o1 - o0 >= 13) pairs.push({ a, b, v: true, c: a.x1, o0, o1 }); }
    if (a.z1 === b.z0) { const o0 = Math.max(a.x0, b.x0), o1 = Math.min(a.x1, b.x1); if (o1 - o0 >= 13) pairs.push({ a, b, v: false, c: a.z1, o0, o1 }); }
  }
  const doors = [];
  const connect = (p) => {
    const at = snap(rr(p.o0 + 5.5, p.o1 - 5.5));
    const door = { v: p.v, c: p.c, at, x: p.v ? p.c : at, z: p.v ? at : p.c };
    doors.push(door); p.a.doors.push(door); p.b.doors.push(door); p.a.links.push(p.b); p.b.links.push(p.a);
  };
  // a random spanning tree (Kruskal over shuffled pairs), then a quarter of the rest as loops
  const root = new Map(rooms.map((r) => [r, r]));
  const find = (r) => (root.get(r) === r ? r : find(root.get(r)));
  const shuffled = pairs.map((p) => [R(), p]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const extra = [];
  for (const p of shuffled) { const A = find(p.a), B = find(p.b); if (A !== B) { root.set(A, B); connect(p); } else extra.push(p); }
  for (const p of extra) if (R() < 0.25) connect(p);

  // ---------------------------------------------------------------- 3. start, depth, exit
  const south = rooms.filter((r) => r.z1 === SITE.z1);
  const start = south.reduce((b, r) => (Math.abs(r.cx) < Math.abs(b.cx) ? r : b)); // the middle of the south side
  for (const r of rooms) r.depth = Infinity;
  start.depth = 0;
  const queue = [start];
  while (queue.length) { const r = queue.shift(); for (const n of r.links) if (n.depth === Infinity) { n.depth = r.depth + 1; queue.push(n); } }
  const north = rooms.filter((r) => r.z0 === SITE.z0 && r.x1 - r.x0 >= EXIT_W + 6);
  const exit = north.reduce((b, r) => (r.depth > b.depth || (r.depth === b.depth && Math.hypot(r.cx - start.cx, r.cz - start.cz) > Math.hypot(b.cx - start.cx, b.cz - start.cz)) ? r : b));
  const exitX = snap(Math.max(exit.x0 + EXIT_W / 2 + 3, Math.min(exit.x1 - EXIT_W / 2 - 3, exit.cx)));
  const maxDepth = Math.max(...rooms.map((r) => r.depth));
  // the main path: start -> exit through the doors (vats prefer rooms off it)
  const onPath = new Set([exit]);
  for (let r = exit; r !== start;) { r = r.links.reduce((b, n) => (n.depth < b.depth ? n : b)); onPath.add(r); }

  // ---------------------------------------------------------------- walls
  const walls = [];
  const cut = (line, gaps, outer) => { // a wall line with door gaps taken out
    let a = line.a0;
    for (const g of gaps.sort((p, q) => p.at - q.at)) { if (g.at - g.w / 2 > a + 0.5) walls.push(seg(line, a, g.at - g.w / 2, outer)); a = g.at + g.w / 2; }
    if (line.a1 > a + 0.5) walls.push(seg(line, a, line.a1, outer));
  };
  const seg = (l, a, b, outer) => (l.v ? { x0: l.c, z0: a, x1: l.c, z1: b, outer } : { x0: a, z0: l.c, x1: b, z1: l.c, outer });
  for (const l of splits) cut(l, doors.filter((d) => d.v === l.v && d.c === l.c && d.at > l.a0 && d.at < l.a1).map((d) => ({ at: d.at, w: DOOR })), false);
  cut({ v: false, c: SITE.z0, a0: SITE.x0, a1: SITE.x1 }, [{ at: exitX, w: EXIT_W }], true);
  cut({ v: false, c: SITE.z1, a0: SITE.x0, a1: SITE.x1 }, [], true);
  cut({ v: true, c: SITE.x0, a0: SITE.z0, a1: SITE.z1 }, [], true);
  cut({ v: true, c: SITE.x1, a0: SITE.z0, a1: SITE.z1 }, [], true);

  // ---------------------------------------------------------------- 4. room roles
  const deep = rooms.filter((r) => r !== exit && r.depth >= Math.max(3, Math.ceil(maxDepth * 0.4)));
  const nLocks = Math.min(deep.length, R() < 0.5 ? 2 : 3);
  const lockRooms = [];
  while (lockRooms.length < nLocks) { // spread out: each next one the furthest from those chosen (and the start)
    const far = (r) => Math.min(...[start, ...lockRooms].map((o) => Math.hypot(r.cx - o.cx, r.cz - o.cz)));
    lockRooms.push(deep.filter((r) => !lockRooms.includes(r)).reduce((b, r) => (far(r) > far(b) ? r : b)));
  }
  for (const r of rooms) {
    r.type = r === start ? 'containment' : r === exit ? 'storage' : lockRooms.includes(r) ? pick(['industrial', 'industrial', 'server'])
      : pick(['lab', 'lab', 'lab', 'server', 'server', 'storage', 'storage', 'industrial', 'containment']);
    r.fill = r.depth <= 1 ? 'empty' : r.depth === 2 ? 'sparse' : 'full';
  }

  // specimen vats: 6-8, never in the start room, mostly off the main path (placed first in each room, below)
  const vatRooms = rooms.filter((r) => r !== start).map((r) => [R() * (onPath.has(r) ? 1 : 2.2), r]).sort((p, q) => q[0] - p[0]).map((p) => p[1]);
  const nVats = 6 + Math.floor(R() * 3);
  for (let i = 0; i < nVats; i++) { const r = vatRooms[i % vatRooms.length]; r.vats = (r.vats || 0) + 1; }

  // ---------------------------------------------------------------- 5. furnishing
  const P = [];
  const add = (type, o) => P.push({ type, ...o });
  const people = [];
  let bay = 1;
  for (const r of rooms) {
    // free floor: inside the room's walls, clear of its doors (a circle each) and of what's already placed
    const taken = r.doors.map((d) => ({ x0: d.x - 6, x1: d.x + 6, z0: d.z - 6, z1: d.z + 6 }));
    if (r === exit) taken.push({ x0: exitX - 7, x1: exitX + 7, z0: SITE.z0, z1: SITE.z0 + 9 }); // the way out
    const I = { x0: r.x0 + 2, x1: r.x1 - 2, z0: r.z0 + 2, z1: r.z1 - 2 };
    const fits = (x0, x1, z0, z1, pad = 0.8) => x0 >= I.x0 && x1 <= I.x1 && z0 >= I.z0 && z1 <= I.z1
      && !taken.some((t) => x0 < t.x1 + pad && x1 > t.x0 - pad && z0 < t.z1 + pad && z1 > t.z0 - pad);
    const place = (w, d, x, z, pad) => { if (!fits(x - w / 2, x + w / 2, z - d / 2, z + d / 2, pad)) return false; taken.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }); return true; };
    const anywhere = (w, d, tries = 30, pad) => { for (let i = 0; i < tries; i++) { const x = snap(rr(I.x0 + w / 2, I.x1 - w / 2)), z = snap(rr(I.z0 + d / 2, I.z1 - d / 2)); if (place(w, d, x, z, pad)) return { x, z }; } return null; };
    const W = I.x1 - I.x0, D = I.z1 - I.z0;
    for (let i = 0; i < (r.vats || 0); i++) { const v = anywhere(2.6, 2.6, 40, 1.5); if (v) add('vat', v); }

    if (r === start) { // the broken tank, two whole ones, nothing else
      add('tank', { x: r.cx, z: r.cz - 3, broken: true }); place(5, 5, r.cx, r.cz - 3);
      add('ring', { x: r.cx, z: r.cz - 3, r: 2.5 });
      for (const s of [-1, 1]) { const x = r.cx + s * Math.min(9, W / 2 - 3); if (place(5, 5, x, r.cz - 7)) { add('tank', { x, z: r.cz - 7 }); add('ring', { x, z: r.cz - 7, r: 2.5 }); } }
    } else if (r.fill !== 'empty') {
      const k = r.fill === 'sparse' ? 0.35 : 1; // sparse rooms get about a third of the furniture
      const maybe = () => R() < k;
      if (r.type === 'lab') {
        for (let z = I.z0 + 4; z < I.z1 - 2; z += 5.5) for (let x = I.x0 + 4; x < I.x1 - 3; x += 8.5) if (maybe() && place(6.4, 1.6, x, z)) add('bench', { x, z, len: 6 });
        for (let x = I.x0 + 1.4; x < I.x1 - 1.4; x += 3.2) if (maybe() && place(2.6, 1.2, x, I.z0 + 0.6, 0.1)) add('cabinet', { x, z: I.z0 + 0.6 }); // fume hoods
        for (let i = 0; i < 2; i++) { const p = maybe() && anywhere(1.4, 1.4); if (p) add('prop', { name: pick(['centrifuge', 'lab_trolley']), x: p.x, z: p.z, ry: rr(-0.6, 0.6) }); }
      } else if (r.type === 'server') {
        const n = Math.max(4, Math.min(14, Math.floor((D / 2 - 2) / 0.64)));
        for (let x = I.x0 + 2, f = 1; x < I.x1 - 1.5; x += 5, f = -f) for (const z0 of [I.z0 + 1, I.z1 - 1 - (n - 1) * 0.64]) {
          if (maybe() && place(1.2, n * 0.64 + 0.6, x, z0 + ((n - 1) * 0.64) / 2)) add('rackRow', { x, z0, n, face: f });
        }
      } else if (r.type === 'industrial') {
        for (let i = 0; i < 2; i++) { if (!maybe() && i) continue; const p = anywhere(5.2, 3.2, 40); if (p && p.z - 7 > r.z0) add('machine', p); else if (p) taken.pop(); }
        for (let i = 0; i < 3; i++) { const p = maybe() && anywhere(2.6, 1.8); if (p) add('cabinet', { x: p.x, z: p.z, w: 2.4, h: 1.6, d: 1.6 }); }
        const p = maybe() && anywhere(2.2, 2.2); if (p) for (let i = 0; i < 6; i++) add('drum', { x: p.x - 0.35 + (i % 2) * 0.7, z: p.z - 0.7 + Math.floor(i / 2) * 0.7, color: i % 3 ? 'yellow' : 'blue' });
        const g = anywhere(1.4, 1.4); if (g) add('gasBottles', g);
        add('paint', { x0: I.x0, z0: r.cz - 1.3, x1: I.x1, z1: r.cz - 1.3 }); add('paint', { x0: I.x0, z0: r.cz + 1.3, x1: I.x1, z1: r.cz + 1.3 });
      } else if (r.type === 'storage') {
        for (let x = I.x0 + 2; x < I.x1 - 1.5; x += 5.5) for (let z = I.z0 + 2; z < I.z1 - 1.5; z += 5) if (R() < 0.6 * k && place(1.8, 1.8, x + rr(-0.4, 0.4), z + rr(-0.4, 0.4))) { const t = taken[taken.length - 1]; add('crateStack', { x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2 }); }
        for (let i = 0; i < 2; i++) { const p = maybe() && anywhere(1.2, 1.2); if (p) add('drum', p); }
      } else if (r.type === 'containment') {
        for (let x = I.x0 + 4; x < I.x1 - 3; x += 9) for (let z = I.z0 + 4; z < I.z1 - 3; z += 9) if (maybe() && place(5, 5, x, z)) { add('tank', { x, z }); add('ring', { x, z, r: 2.5 }); }
        const p = maybe() && anywhere(6.4, 1.6); if (p) add('bench', { ...p, len: 6 });
      }
      // lockers by the doors to a guarded room
      if (r.fill === 'full' && R() < 0.5) { const p = anywhere(1.0, 1.0); if (p) add('prop', { name: 'hazmat_locker', x: p.x, z: p.z, ry: pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) }); }
    }
    if (lockRooms.includes(r)) { const p = anywhere(4.5, 4.5, 60) || { x: r.cx, z: r.cz }; add('lock', { x: p.x, z: p.z, kind: pick(['generator', 'pumps']), ry: pick([0, Math.PI / 2]) }); }

    // the floor: hatches and drains on free floor, tape across the doors, a bay number on a wall
    for (let i = 0; i < 2; i++) { const p = anywhere(1.6, 1.6, 10); if (p) add(R() < 0.5 ? 'hatch' : 'drain', p); }
    // lamps: an even grid, every other one casting shadows (world.js pools the actual lights)
    const nx = Math.max(1, Math.round((r.x1 - r.x0) / 12)), nz = Math.max(1, Math.round((r.z1 - r.z0) / 12));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) add('lamp', { x: r.x0 + ((i + 0.5) * (r.x1 - r.x0)) / nx, z: r.z0 + ((j + 0.5) * (r.z1 - r.z0)) / nz, shadow: (i + j) % 2 === 0, flicker: r.fill === 'empty' && R() < 0.15 });
    const wallSeg = walls.find((w) => !w.outer && w.x0 === w.x1 && (w.x0 === r.x0 || w.x0 === r.x1) && w.z1 - w.z0 > 8 && w.z0 >= r.z0 && w.z1 <= r.z1);
    if (wallSeg) add('stencil', { x: wallSeg.x0, z: (wallSeg.z0 + wallSeg.z1) / 2, text: r === start ? 'BAY 0' : `BAY ${bay++}`, across: true });

    // who's here: nobody in the first rooms; then scientists; soldiers deeper; locks and the exit guarded
    if (r.fill === 'sparse') people.push({ type: 'scientist', room: r.id, n: 2 + Math.floor(R() * 2) });
    if (r.fill === 'full') {
      const area = (r.x1 - r.x0) * (r.z1 - r.z0);
      people.push({ type: 'scientist', room: r.id, n: Math.round((area / 700) * rr(2, 4) * (r.type === 'lab' ? 1.4 : 1)) });
      const soldiers = lockRooms.includes(r) ? 4 + Math.floor(R() * 2) : r === exit ? 4 : R() < 0.35 + 0.08 * (r.depth - 3) ? 2 + Math.floor(R() * 2) : 0;
      if (soldiers) people.push({ type: 'soldier', room: r.id, n: soldiers });
    }
  }
  for (const d of doors) add('tape', { x: d.x, z: d.z, across: d.v });

  // the goal: the exit door in the north wall, beacons on its columns
  add('exitDoor', { x: exitX, z: SITE.z0, w: EXIT_W });
  add('beacon', { x: exitX - EXIT_W / 2, z: SITE.z0, phase: 0 }); add('beacon', { x: exitX + EXIT_W / 2, z: SITE.z0, phase: 2 });

  // the autopilot's tour: depth-first through the doors, every room once, ending at the exit
  const route = [], seen = new Set();
  (function tour(r) {
    seen.add(r); route.push([r.cx, r.cz]);
    for (const n of r.links) {
      if (seen.has(n)) continue;
      const d = r.doors.find((o) => n.doors.includes(o));
      route.push([d.x, d.z]); tour(n); route.push([d.x, d.z], [r.cx, r.cz]);
    }
  })(start);
  route.push([exitX, SITE.z0 + 5]);

  return {
    seed,
    bounds: { ...SITE },
    rooms: rooms.map(({ id, type, x0, x1, z0, z1, depth, fill }) => ({ id, type, x0, x1, z0, z1, depth, fill })),
    walls, pieces: P, people,
    spawn: { x: start.cx, z: start.cz + 3.5, heading: Math.PI },
    route,
    info: { rooms: rooms.length, doors: doors.length, depth: maxDepth, locks: nLocks, exit: exit.id, start: start.id },
  };
}
