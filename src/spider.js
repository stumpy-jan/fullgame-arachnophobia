import * as THREE from 'three';
import { clamp, damp, angleTo, rng } from './util.js';
import { legTextures, chitinTextures } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The specimen: a giant spider, animated entirely in code.
//
// Legs: three segments, as on a real spider: femur up from the hip to a high knee, tibia down and out,
// and a long metatarsus that drops almost vertically onto the foot. The leg is solved as two-bone IK
// to the ankle (the top of the metatarsus); the metatarsus hangs from the ankle to the foot.
//
// Footholds (after legged-robot foothold planning, not the usual game spider): a foot is only placed
// where the WHOLE leg (femur, tibia, metatarsus) clears the world by a margin, not just the foot.
// Candidates: the nominal spot (rest spot ahead by the velocity), the tops of obstacles met when
// marching from the hip out towards it (inset from their edges), the floor just before an obstacle's
// face, and spots to either side. The cheapest valid one wins; with none, the leg hovers, lifted above
// everything near it, and the other legs carry the body. Planted legs are re-checked every frame and
// step at once if the body's motion makes them clip.
//
// Gait: a leg steps when it drifts too far from where it should be (or turns invalid); it may lift only
// while its neighbours are down (wave gait), at most four at a time, the most urgent first. Steps
// over obstacles go up, across and down; on flat ground they're an arc.
//
// Body: rides above its planted feet, never lower than what's under it (with look-ahead) or than the
// crests its legs reach over, never so high a planted leg would over-stretch. Tilts with the feet; the
// abdomen hangs off a spring.

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export const spiderParams = {
  walk: 6.5, sprint: 12, accel: 5, turn: 4.2,
  ride: 2.3,         // body height above the average planted foot
  clearance: 0.95,   // ... above anything under the body
  crest: 0.35,       // ... and above the obstacles its legs reach over (inner part of each leg)
  lead: 0.3,         // s of velocity a foothold is chosen ahead
  stepAt: 1.2,       // m a foot may drift before it steps (grows with speed)
  stepTime: 0.28,    // s per step at a walk (shorter when fast)
  legMargin: 0.18,   // m every part of a leg must keep from the world
};

const FEMUR = 2.6, TIBIA = 2.6, META = 1.3, META_TILT = 0.22, REACH = FEMUR + TIBIA;

export class Spider {
  constructor(scene, world) {
    this.world = world;
    this.pos = new THREE.Vector3();      // ground position (x, z); y = body height
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.pitch = 0; this.roll = 0;
    this.bob = 0; this.bobV = 0;
    this.time = 0;
    this.events = [];                    // footfalls this frame (for camera shake, sound later)
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    scene.add(this.root);
    this.legs = [];
    this.build(scene);
  }

  build(scene) {
    const R = rng(99);
    // chitin with a velvet sheen (the hair, from a distance) and a thin wet clearcoat
    // Chitin: satin, not glossy. No clearcoat (that's what made it read as plastic): the shine comes from a
    // roughness map with pits and creases, a normal map with fine wrinkles and bristle streaks, and a
    // faint sheen for the hair. Specular tinted warm so highlights aren't white.
    const ch = chitinTextures(71, [48, 34, 30]), abT = chitinTextures(72, [54, 36, 30]), lg = legTextures();
    const satin = (t, extra = {}) => new THREE.MeshPhysicalMaterial({
      map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: t.rough, roughness: 0.78, metalness: 0,
      specularIntensity: 1, specularColor: 0xffe2cc, sheen: 0.5, sheenColor: 0x7a5a44, sheenRoughness: 0.55, ...extra,
    });
    const chitin = satin(ch);
    const legMat = satin(lg);
    this.abMat = satin(abT);
    // glossy black beads with a red glow deep in them
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050203, emissive: 0xff2208, emissiveIntensity: 1.6, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
    const add = (parent, geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.scale.set(sx, sy, sz);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const sphere = new THREE.SphereGeometry(1, 40, 28);
    const lump = (amp, freq, seed) => lumpy(new THREE.SphereGeometry(1, 64, 48), amp, freq, seed);

    // cephalothorax (forward is +z): lean and low
    this.thorax = add(this.root, lump(0.05, 4, 1), chitin, 0, 0, 0.25, 0.72, 0.4, 0.88);
    add(this.root, lump(0.06, 5, 2), chitin, 0, 0.22, 0.32, 0.44, 0.24, 0.6); // the raised carapace hump
    // eyes: two big, six small, in a cluster at the front of the carapace
    const eyes = [[0.09, 0.27, 1.08, 0.075], [-0.09, 0.27, 1.08, 0.075], [0.24, 0.24, 0.99, 0.042], [-0.24, 0.24, 0.99, 0.042],
      [0.06, 0.37, 0.97, 0.038], [-0.06, 0.37, 0.97, 0.038], [0.18, 0.34, 0.87, 0.03], [-0.18, 0.34, 0.87, 0.03]];
    for (const [x, y, z, r] of eyes) add(this.root, sphere, eyeMat, x, y, z, r, r, r).castShadow = false;
    // chelicerae and fangs
    this.fangs = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.19, -0.05, 1.05);
      this.root.add(g);
      add(g, sphere, chitin, 0, -0.1, 0.1, 0.16, 0.28, 0.19);
      const fang = add(g, new THREE.ConeGeometry(0.06, 0.42, 10), legMat, 0, -0.4, 0.2);
      fang.rotation.x = 0.5;
      this.fangs.push(g);
    }
    // the abdomen: small and tight, hanging off a pivot behind the thorax
    this.abPivot = new THREE.Group();
    this.abPivot.position.set(0, 0.1, -0.6);
    this.root.add(this.abPivot);
    add(this.abPivot, sphere, chitin, 0, 0.03, -0.2, 0.3, 0.26, 0.32); // pedicel
    this.abdomen = add(this.abPivot, lump(0.05, 4, 5), this.abMat, 0, 0.18, -1.15, 0.78, 0.62, 1.05);
    this.abdomen.rotation.x = -0.15;
    this.abBase = this.abdomen.scale.clone();
    // spinnerets
    add(this.abPivot, new THREE.ConeGeometry(0.1, 0.26, 10), chitin, 0, 0.05, -2.2).rotation.x = -Math.PI / 2 - 0.4;

    // legs: lathed segments (radius along the length: a thick base, a waist, a swelling before the next
    // joint) with bristles baked in; built at their real length, seg() only scales when IK stretches them
    const femurGeo = spiny(lathe(FEMUR, [[0, 0.15], [0.06, 0.18], [0.25, 0.17], [0.55, 0.14], [0.8, 0.125], [0.93, 0.145], [1, 0.1]]), FEMUR, 0.15, 28, R);
    const tibiaGeo = spiny(lathe(TIBIA, [[0, 0.11], [0.07, 0.125], [0.35, 0.1], [0.7, 0.08], [0.92, 0.075], [1, 0.06]]), TIBIA, 0.1, 22, R);
    const metaGeo = spiny(lathe(META, [[0, 0.065], [0.1, 0.07], [0.6, 0.045], [0.9, 0.03], [1, 0.006]]), META, 0.05, 10, R);
    const angles = [36, 70, 108, 146].map((d) => (d * Math.PI) / 180);
    const reach = [4.4, 4.1, 4.1, 4.6];
    for (let k = 0; k < 4; k++) {
      for (const s of [-1, 1]) {
        const leg = {
          s, k,
          hip: new THREE.Vector3(s * 0.52, -0.04, 0.68 - k * 0.3),
          rest: new THREE.Vector3(s * Math.sin(angles[k]) * reach[k], 0, Math.cos(angles[k]) * reach[k]),
          foot: new THREE.Vector3(), from: new THREE.Vector3(), target: new THREE.Vector3(),
          stepping: false, hover: false, willHover: false, t: 0, dur: 0.25, apex: 0, over: false, lastStep: 0, lastPlan: 0,
          jit: 0.9 + R() * 0.2,                 // a little per-leg irregularity in timing
          j: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], // hip, knee, ankle (world)
        };
        const mk = (geo, len) => { const m = new THREE.Mesh(geo, legMat); m.castShadow = true; m.receiveShadow = true; m.userData.len = len; scene.add(m); return m; };
        leg.femur = mk(femurGeo, FEMUR); leg.tibia = mk(tibiaGeo, TIBIA); leg.meta = mk(metaGeo, META);
        leg.knee = mk(sphere, 1); leg.knee.scale.setScalar(0.13);
        leg.ankle = mk(sphere, 1); leg.ankle.scale.setScalar(0.075);
        leg.hipBall = mk(sphere, 1); leg.hipBall.scale.setScalar(0.18);
        this.legs.push(leg);
      }
    }
    for (const l of this.legs) {
      l.neighbours = this.legs.filter((o) => o !== l && ((o.s === l.s && Math.abs(o.k - l.k) === 1) || (o.s !== l.s && o.k === l.k)));
    }
  }

  // ---------------------------------------------------------------- geometry of a leg
  // hip position in the world, optionally ahead along the velocity
  hipWorld(l, out, ahead = 0) {
    out.copy(l.hip).applyMatrix4(this.root.matrixWorld);
    out.x += this.vel.x * ahead; out.z += this.vel.z * ahead;
    return out;
  }

  // the joints for a hip and a foot: the metatarsus leans in from the foot towards the hip by META_TILT;
  // the knee is two-bone IK between hip and ankle, bent up (and a little out). Returns the true
  // hip-to-ankle distance (> REACH means over-stretched).
  solve(hip, foot, knee, ankle) {
    let dx = foot.x - hip.x, dz = foot.z - hip.z;
    const hd = Math.hypot(dx, dz) || 1;
    dx /= hd; dz /= hd;
    const st = Math.sin(META_TILT) * META;
    ankle.set(foot.x - dx * st, foot.y + Math.cos(META_TILT) * META, foot.z - dz * st);
    const ax = ankle.x - hip.x, ay = ankle.y - hip.y, az = ankle.z - hip.z;
    const reach = Math.hypot(ax, ay, az) || 1e-4;
    const ux = ax / reach, uy = ay / reach, uz = az / reach;
    const d = clamp(reach, Math.abs(FEMUR - TIBIA) + 0.05, REACH - 0.01);
    const x = (FEMUR * FEMUR - TIBIA * TIBIA + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, FEMUR * FEMUR - x * x));
    // pole: up, a little outward, made perpendicular to the hip->ankle line
    let px = dx * 0.3, py = 1, pz = dz * 0.3;
    const pd = px * ux + py * uy + pz * uz;
    px -= ux * pd; py -= uy * pd; pz -= uz * pd;
    const pl = Math.hypot(px, py, pz) || 1;
    knee.set(hip.x + ux * x + (px / pl) * h, hip.y + uy * x + (py / pl) * h, hip.z + uz * x + (pz / pl) * h);
    return reach;
  }

  // how far the whole leg stays clear of the world (m; negative = it clips), or -9 if out of reach
  clearance(hip, foot) {
    const r = this.solve(hip, foot, _K, _A);
    if (r > REACH - 0.02 || r < 1.2) return -9;
    const H = this.world.heightAt;
    let c = 99;
    const run = (a, b, n, upto) => {
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * upto;
        c = Math.min(c, a.y + (b.y - a.y) * t - H(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
      }
    };
    run(hip, _K, 8, 1); run(_K, _A, 12, 1); run(_A, foot, 6, 0.8); // (the claw tip may touch)
    return c;
  }

  // ---------------------------------------------------------------- footholds
  // Where a leg's foot should go if it stepped now. Sets out; returns false if there's nowhere valid
  // (then out is a hover point).
  foothold(l, out) {
    const H = this.world.heightAt, P = spiderParams;
    const hip = this.hipWorld(l, _H, l.dur * 0.6);
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const lead = P.lead + l.dur * 0.5;
    const nx = this.pos.x + l.rest.x * c + l.rest.z * s + this.vel.x * lead;
    const nz = this.pos.z - l.rest.x * s + l.rest.z * c + this.vel.z * lead;
    const ny = H(nx, nz);
    const cands = [[nx, nz]];
    // march from the hip out towards (and past) the nominal spot: the floor before each face, each top
    let ux = nx - hip.x, uz = nz - hip.z;
    const L = Math.hypot(ux, uz) || 1;
    ux /= L; uz /= L;
    const STEP = 0.15;
    let prev = H(hip.x + ux * 0.6, hip.z + uz * 0.6), runStart = -1, runTop = 0;
    for (let d = 0.6 + STEP; d < L + 1.5; d += STEP) {
      const h = H(hip.x + ux * d, hip.z + uz * d);
      if (runStart >= 0 && h < runTop - 0.2) {                       // the top ends here
        const a = runStart + 0.4, b = d - STEP - 0.4;
        if (b >= a) { const t = clamp(L, a, b); cands.push([hip.x + ux * t, hip.z + uz * t]); }
        runStart = -1;
      }
      if (h > prev + 0.2) {                                          // a face rises here
        if (d - 0.45 > 1.5) cands.push([hip.x + ux * (d - 0.45), hip.z + uz * (d - 0.45)]);
        runStart = d; runTop = h;
      }
      prev = h;
    }
    if (runStart >= 0) { const a = runStart + 0.4, b = L + 1.5 - 0.4; if (b >= a) { const t = clamp(L, a, b); cands.push([hip.x + ux * t, hip.z + uz * t]); } }
    // to either side of the nominal spot
    for (const o of [0.7, -0.7, 1.4, -1.4]) cands.push([nx - uz * o, nz + ux * o]);

    let best = -1, bestCost = 1e9;
    for (let i = 0; i < cands.length; i++) {
      const [x, z] = cands[i], y = H(x, z);
      const cost = Math.hypot(x - nx, z - nz) + Math.abs(y - ny) * 0.25;
      if (cost >= bestCost) continue;
      // not on an edge: the ground within 0.3 m is level
      let edge = false;
      for (const [ex, ez] of EDGE) if (Math.abs(H(x + ex, z + ez) - y) > 0.05) { edge = true; break; }
      if (edge) continue;
      _F.set(x, y, z);
      if (this.clearance(hip, _F) < P.legMargin) continue;
      bestCost = cost; best = i;
    }
    if (best >= 0) {
      const [x, z] = cands[best];
      out.set(x, H(x, z), z);
      return true;
    }
    // hover: lifted above everything round the nominal spot and on the way out to it
    let top = ny;
    for (let d = 1; d < L + 1; d += 0.3) top = Math.max(top, H(hip.x + ux * d, hip.z + uz * d));
    out.set(nx - ux * 0.8, Math.min(top + 0.9, hip.y + 1.0), nz - uz * 0.8);
    return false;
  }

  place(x, z, heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    let floor = 0;
    for (const [ox, oz] of [[0, 0], [2, 2], [-2, 2], [2, -2], [-2, -2]]) floor = Math.max(floor, this.world.heightAt(x + ox, z + oz));
    this.pos.y = floor + spiderParams.ride;
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, heading, 0);
    this.root.updateMatrixWorld();
    for (const l of this.legs) { l.hover = !this.foothold(l, l.foot); l.target.copy(l.foot); }
  }

  avgFootY() {
    let y = 0, n = 0;
    for (const l of this.legs) if (!l.hover && !l.stepping) { y += l.foot.y; n++; }
    if (!n) for (const l of this.legs) { y += l.foot.y; n++; }
    return y / n;
  }

  // input: {x, z} in world space (length 0..1), sprint: bool
  update(dt, input) {
    const P = spiderParams, H = this.world.heightAt;
    this.time += dt;
    this.events.length = 0;

    // --- move
    const max = input.sprint ? P.sprint : P.walk;
    const prevVel = _w.copy(this.vel);
    this.vel.x = damp(this.vel.x, input.x * max, P.accel, dt);
    this.vel.z = damp(this.vel.z, input.z * max, P.accel, dt);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.4) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      this.heading += clamp(angleTo(this.heading, want), -P.turn * dt, P.turn * dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // only the lab's outer walls hold it in (on the thorax and the abdomen behind it); it climbs over the rest
    for (let it = 0; it < 2; it++) {
      for (const [off, r] of [[0.3, 1.1], [-1.6, 0.9]]) {
        const ox = this.pos.x + Math.sin(this.heading) * off, oz = this.pos.z + Math.cos(this.heading) * off;
        _v.set(ox, 0, oz);
        this.world.collide(_v, r);
        this.pos.x += _v.x - ox; this.pos.z += _v.z - oz;
      }
    }
    const ax = (this.vel.x - prevVel.x) / Math.max(dt, 1e-4), az = (this.vel.z - prevVel.z) / Math.max(dt, 1e-4);
    const c = Math.cos(this.heading), s = Math.sin(this.heading);

    // --- body height. Hard floor: what's under the body (now and in a moment) and the crests the legs
    // reach over. Wish: ride above the planted feet, but no higher than every planted leg can reach.
    let hard = 0;
    for (const look of [0, 0.3, 0.6]) {
      const bx = this.pos.x + this.vel.x * look, bz = this.pos.z + this.vel.z * look;
      for (const [ox, oz] of FOOTPRINT) hard = Math.max(hard, H(bx + ox * c + oz * s, bz - ox * s + oz * c) + P.clearance);
    }
    let hi = 1e9;
    for (const l of this.legs) {
      if (l.hover) continue;
      const hx = this.pos.x + l.hip.x * c + l.hip.z * s, hz = this.pos.z - l.hip.x * s + l.hip.z * c;
      for (let t = 0.15; t <= 0.6; t += 0.15) hard = Math.max(hard, H(hx + (l.foot.x - hx) * t, hz + (l.foot.z - hz) * t) + P.crest);
      if (!l.stepping) {
        const horiz = Math.hypot(l.foot.x - hx, l.foot.z - hz) - Math.sin(META_TILT) * META, r = REACH * 0.96;
        if (horiz < r) hi = Math.min(hi, l.foot.y + Math.cos(META_TILT) * META + Math.sqrt(r * r - horiz * horiz));
      }
    }
    const wantY = Math.max(hard, Math.min(this.avgFootY() + P.ride, hi));
    this.pos.y = damp(this.pos.y, wantY, wantY > this.pos.y ? 9 : 5, dt);

    // bob: a damped spring kicked by each footfall, plus a slow breath
    this.bobV += (-this.bob * 60 - this.bobV * 9) * dt;
    this.bob += this.bobV * dt;

    // tilt: from the planted feet, front vs back and left vs right
    let front = 0, back = 0, left = 0, right = 0, nf = 0, nb = 0, nl = 0, nr = 0;
    for (const l of this.legs) {
      if (l.hover) continue;
      if (l.k < 2) { front += l.foot.y; nf++; } else { back += l.foot.y; nb++; }
      if (l.s < 0) { left += l.foot.y; nl++; } else { right += l.foot.y; nr++; }
    }
    const aFwd = ax * s + az * c, aSide = ax * c - az * s;
    const dFB = nf && nb ? front / nf - back / nb : 0, dLR = nl && nr ? right / nr - left / nl : 0;
    this.pitch = damp(this.pitch, clamp(Math.atan2(dFB, 3.6) - aFwd * 0.01, -0.35, 0.35), 5, dt);
    this.roll = damp(this.roll, clamp(Math.atan2(dLR, 5.0) + aSide * 0.008, -0.3, 0.3), 5, dt);

    this.root.position.set(this.pos.x, this.pos.y + this.bob * 0.25 + Math.sin(this.time * 1.7) * 0.04, this.pos.z);
    this.root.rotation.set(-this.pitch, this.heading, this.roll);
    this.root.updateMatrixWorld();

    // --- legs: who needs to step
    const fast = clamp(speed / P.sprint, 0, 1);
    const stepAt = P.stepAt + speed * 0.1;
    const want = [];
    for (const l of this.legs) {
      if (l.stepping) continue;
      // drift from where it should be: the rest spot ahead by the velocity (cheap; the full foothold
      // search only runs when it actually steps)
      const nx = this.pos.x + l.rest.x * c + l.rest.z * s + this.vel.x * P.lead;
      const nz = this.pos.z - l.rest.x * s + l.rest.z * c + this.vel.z * P.lead;
      const drift = Math.hypot(nx - l.foot.x, nz - l.foot.z);
      // about to clip or over-stretch: checked a moment ahead, so it lifts before it happens
      const invalid = !l.hover && this.clearance(this.hipWorld(l, _H, 0.15), l.foot) < 0.08;
      const idle = speed < 0.3 && drift > 0.35 && this.time - l.lastStep > 0.5 * l.jit;
      const replan = l.hover && this.time - l.lastPlan > 0.15;        // a hovering leg keeps looking
      if (invalid || drift > stepAt * l.jit || idle || replan) {
        want.push({ l, urgent: invalid || drift > stepAt * 2.2, score: (invalid ? 100 : 0) + drift });
      }
    }
    want.sort((a, b) => b.score - a.score);
    let swinging = 0;
    for (const l of this.legs) if (l.stepping) swinging++;
    for (const { l, urgent } of want) {
      if (swinging >= 4 && !urgent) continue;
      if (!urgent && l.neighbours.some((o) => o.stepping)) continue;
      l.dur = P.stepTime * (1 - fast * 0.4) * l.jit;
      l.lastPlan = this.time;
      const ok = this.foothold(l, l.target);
      if (l.hover && !ok) { l.foot.lerp(l.target, 0.25); continue; }  // still nowhere to stand: keep hovering
      l.stepping = true; l.t = 0;
      l.from.copy(l.foot);
      l.willHover = !ok;
      // the swing: up, across and down when something between is higher than both ends
      let top = Math.max(l.from.y, l.target.y);
      for (let i = 1; i < 8; i++) { const f = i / 8; top = Math.max(top, H(l.from.x + (l.target.x - l.from.x) * f, l.from.z + (l.target.z - l.from.z) * f)); }
      l.over = top > Math.max(l.from.y, l.target.y) + 0.15;
      l.apex = top + (l.over ? 0.55 : 0.4 + Math.hypot(l.target.x - l.from.x, l.target.z - l.from.z) * 0.1);
      // check the whole leg along the swing (where the hip will be by then); raise the arc until it clears
      for (let tries = 0; tries < 4 && !this.swingClear(l); tries++) { l.over = true; l.apex += 0.5; }
      swinging++;
    }

    // --- legs: move the stepping ones
    for (const l of this.legs) {
      if (!l.stepping) continue;
      l.t = Math.min(1, l.t + dt / l.dur);
      const t = l.t;
      this.swingAt(l, t, l.foot);
      if (t >= 1) {
        l.stepping = false; l.lastStep = this.time;
        l.foot.copy(l.target);
        l.hover = l.willHover;
        if (!l.hover) {
          this.bobV -= 0.3 + fast * 0.4;
          this.events.push({ type: 'step', pos: l.foot.clone(), k: l.k });
        }
      }
    }

    // abdomen: lags behind turns and accelerations, sags on landings, breathes
    const sw = this.abPivot.rotation;
    sw.y = damp(sw.y, clamp(-aSide * 0.02, -0.35, 0.35), 4, dt);
    sw.x = damp(sw.x, clamp(aFwd * 0.015 + this.bob * 0.4, -0.3, 0.3), 5, dt);
    const br = 1 + Math.sin(this.time * 1.7) * 0.025;
    this.abdomen.scale.set(this.abBase.x * br, this.abBase.y * br, this.abBase.z);
    for (const [i, f] of this.fangs.entries()) f.rotation.x = Math.sin(this.time * 6 + i * 2.1) * 0.12 * (0.4 + fast);

    // --- legs: pose the meshes
    for (const l of this.legs) this.pose(l);
  }

  // the foot's position at swing time t (0..1)
  swingAt(l, t, out) {
    let e, y;
    if (l.over) {
      e = smooth(clamp((t - 0.2) / 0.6, 0, 1));                       // across in the middle ...
      const up = smooth(clamp(t / 0.3, 0, 1)), down = smooth(clamp((t - 0.7) / 0.3, 0, 1));
      y = l.from.y + (l.apex - l.from.y) * up + (l.target.y - l.apex) * down; // ... up first, down last
    } else {
      e = smooth(t);
      const base = l.from.y + (l.target.y - l.from.y) * e;
      y = base + (l.apex - base) * 4 * t * (1 - t);
    }
    return out.set(l.from.x + (l.target.x - l.from.x) * e, y, l.from.z + (l.target.z - l.from.z) * e);
  }

  swingClear(l) {
    for (const t of [0.25, 0.5, 0.75]) {
      const c = this.clearance(this.hipWorld(l, _H2, l.dur * t), this.swingAt(l, t, _S));
      if (c < 0.05 && c > -9) return false;                          // (-9: out of reach mid-swing, fine)
    }
    return true;
  }

  pose(l) {
    const [hip, knee, ankle] = l.j;
    this.hipWorld(l, hip);
    this.solve(hip, l.foot, knee, ankle);
    seg(l.femur, hip, knee);
    seg(l.tibia, knee, ankle);
    seg(l.meta, ankle, l.foot);
    l.knee.position.copy(knee);
    l.ankle.position.copy(ankle);
    l.hipBall.position.copy(hip);
  }

  // Measurement (tools/clipcheck.mjs): how deep is any part of a leg, or the underside of the body,
  // inside an obstacle right now? Samples along femur, tibia and metatarsus (its last 15% is the claw,
  // which may touch). Returns { depth, legs } (deepest penetration in m, number of legs that clip).
  clipStats() {
    const H = this.world.heightAt;
    let depth = 0, legs = 0, kind = '';
    const p = new THREE.Vector3();
    for (const l of this.legs) {
      let d = 0;
      for (const [a, b, upto] of [[l.j[0], l.j[1], 1], [l.j[1], l.j[2], 1], [l.j[2], l.foot, 0.85]]) {
        for (let i = 0; i <= 12; i++) {
          p.lerpVectors(a, b, (i / 12) * upto);
          d = Math.max(d, H(p.x, p.z) - p.y);
        }
      }
      if (d > 0.05) legs++;
      if (d > depth) { depth = d; kind = l.stepping ? 'swing' : l.hover ? 'hover' : 'planted'; }
    }
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    for (const [oz, under] of [[0.3, 0.4], [-1.7, 0.45]]) {
      const d = H(this.pos.x + oz * s, this.pos.z + oz * c) - (this.root.position.y - under);
      if (d > depth) { depth = d; kind = 'body'; }
    }
    return { depth, legs, kind };
  }
}

const _H = new THREE.Vector3(), _H2 = new THREE.Vector3(), _S = new THREE.Vector3(), _F = new THREE.Vector3(), _K = new THREE.Vector3(), _A = new THREE.Vector3();
const EDGE = [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
const FOOTPRINT = [[0, 0], [0.65, 0], [-0.65, 0], [0, 1.1], [0, -0.8], [0, -1.6], [0, -2.3]];
const smooth = (t) => t * t * (3 - 2 * t);

// orient a +y mesh (built userData.len long) from a to b
function seg(m, a, b, tipAtB = false) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  d.divideScalar(len || 1);
  if (tipAtB) { m.position.copy(b); _q.setFromUnitVectors(UP, d.negate()); }
  else { m.position.copy(a); _q.setFromUnitVectors(UP, d); }
  m.quaternion.copy(_q);
  m.scale.set(1, len / (m.userData.len || 1), 1);
}

function lathe(len, prof) {
  return new THREE.LatheGeometry(prof.map(([t, r]) => new THREE.Vector2(r, t * len)), 14);
}

// push a geometry's vertices in and out along their normals with smooth 3D noise: lumpy, not egg-smooth
export function lumpy(geo, amp, freq, seed = 0) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const f = (x, y, z) => Math.sin(x * freq + seed) * Math.sin(y * freq * 1.3 + seed * 2) * Math.sin(z * freq * 0.9 + 1)
    + 0.5 * Math.sin(x * freq * 2.7 + 3) * Math.sin(z * freq * 2.3 + seed) * Math.sin(y * freq * 3.1);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), d = f(x, y, z) * amp;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}

// bake bristles into a leg segment: thin cones raked toward the tip, mostly on the outer/upper side
function spiny(geo, len, radius, n, R) {
  const parts = [geo];
  for (let i = 0; i < n; i++) {
    const f = 0.12 + R() * 0.8, a = (R() - 0.5) * Math.PI * 1.6; // around the segment, biased to one side
    const L = 0.12 + R() * R() * 0.32;
    const c = new THREE.ConeGeometry(0.012 + L * 0.02, L, 4).translate(0, L / 2, 0);
    c.rotateZ(-1.0 - R() * 0.3);                       // lean out from the segment ...
    c.rotateY(a);                                       // ... on some side of it
    c.translate(Math.cos(a) * radius * 0.9, f * len, -Math.sin(a) * radius * 0.9);
    parts.push(c.toNonIndexed());
  }
  parts[0] = parts[0].toNonIndexed();
  return mergeGeometries(parts);
}
