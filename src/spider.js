import * as THREE from 'three';
import { clamp, damp, angleTo, rng } from './util.js';
import { legTexture, abdomenTextures } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The specimen: a car-sized spider, animated entirely in code.
//
// Each of the 8 legs has a resting foot spot around the body. A planted foot stays put in the world while
// the body moves; once it lags too far behind its spot (or the spot ahead), it steps: an arc from where it
// is to where the spot will be, high enough to clear whatever is in between (the lab's heightAt). A leg
// only lifts while its neighbours (front, back, and its opposite) are down, which gives the rippling
// wave gait. The legs are two-bone IK (femur, tibia) with the knee pushed up and out, plus a short
// claw that always reaches straight down to the floor. The body rides at a height over its feet, tilts
// with them, bobs as they land; the abdomen hangs off a spring.

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export const spiderParams = {
  walk: 6.5, sprint: 12, accel: 5, turn: 4.2,
  ride: 2.0,         // body height above the average foot
  clearance: 1.15,   // ... and above anything under the body
  lead: 0.32,        // s of velocity a foot steps ahead
  stepAt: 1.25,      // m a foot may lag before it steps
  stepTime: 0.26,    // s per step at a walk (shorter when fast)
};

const FEMUR = 3.0, TIBIA = 3.1, CLAW = 0.8;

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
    const chitin = new THREE.MeshPhysicalMaterial({ color: 0x1c1418, roughness: 0.5, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.6, sheenColor: 0x4a3024, sheenRoughness: 0.5 });
    const legTex = legTexture();
    const legMat = new THREE.MeshPhysicalMaterial({ map: legTex, bumpMap: legTex, bumpScale: 3, roughness: 0.5, metalness: 0.05, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.6, sheenColor: 0x4a3024, sheenRoughness: 0.45 });
    const ab = abdomenTextures();
    this.abMat = new THREE.MeshPhysicalMaterial({ map: ab.map, emissiveMap: ab.emissive, emissive: 0x9cff4a, emissiveIntensity: 1.0, roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.5, sheenColor: 0x40242a, sheenRoughness: 0.5 });
    // glossy black beads with a red glow deep in them
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050203, emissive: 0xff2208, emissiveIntensity: 1.6, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.pustuleMat = new THREE.MeshStandardMaterial({ color: 0x8aa040, emissive: 0xc8ff50, emissiveIntensity: 1.6, roughness: 0.15 });
    const add = (parent, geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.scale.set(sx, sy, sz);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const sphere = new THREE.SphereGeometry(1, 40, 28);
    const lump = (amp, freq, seed) => lumpy(new THREE.SphereGeometry(1, 64, 48), amp, freq, seed);

    // cephalothorax (forward is +z)
    this.thorax = add(this.root, lump(0.05, 4, 1), chitin, 0, 0, 0.35, 1.05, 0.56, 1.2);
    add(this.root, lump(0.06, 5, 2), chitin, 0, 0.32, 0.45, 0.62, 0.32, 0.8); // the raised carapace hump
    // eyes: two big, six small, in a cluster at the front of the carapace
    const eyes = [[0.13, 0.36, 1.45, 0.1], [-0.13, 0.36, 1.45, 0.1], [0.34, 0.33, 1.33, 0.055], [-0.34, 0.33, 1.33, 0.055],
      [0.08, 0.5, 1.3, 0.05], [-0.08, 0.5, 1.3, 0.05], [0.26, 0.47, 1.17, 0.04], [-0.26, 0.47, 1.17, 0.04]];
    for (const [x, y, z, r] of eyes) add(this.root, sphere, eyeMat, x, y, z, r, r, r).castShadow = false;
    // chelicerae and fangs
    this.fangs = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.28, -0.05, 1.42);
      this.root.add(g);
      add(g, sphere, chitin, 0, -0.15, 0.15, 0.24, 0.4, 0.28);
      const fang = add(g, new THREE.ConeGeometry(0.09, 0.6, 10), legMat, 0, -0.55, 0.28);
      fang.rotation.x = 0.5;
      this.fangs.push(g);
    }
    // the abdomen hangs off a pivot behind the thorax
    this.abPivot = new THREE.Group();
    this.abPivot.position.set(0, 0.15, -0.75);
    this.root.add(this.abPivot);
    add(this.abPivot, sphere, chitin, 0, 0.05, -0.35, 0.5, 0.42, 0.5); // pedicel
    this.abdomen = add(this.abPivot, lump(0.07, 3.2, 5), this.abMat, 0, 0.35, -2.05, 1.5, 1.2, 1.95);
    this.abdomen.rotation.x = -0.12;
    // pustules: glowing sacs on the upper abdomen
    for (let i = 0; i < 14; i++) {
      const u = R() * Math.PI * 2, v = 0.15 + R() * 0.75;
      const x = Math.cos(u) * Math.sin(v * 1.4), y = Math.cos(v * 1.4), z = Math.sin(u) * Math.sin(v * 1.4);
      const r = 0.05 + R() * R() * 0.14;
      add(this.abPivot, sphere, this.pustuleMat, x * 1.47, 0.35 + y * 1.18, -2.05 + z * 1.92, r, r * 0.6, r);
    }
    // spinnerets
    add(this.abPivot, new THREE.ConeGeometry(0.18, 0.4, 10), chitin, 0, 0.0, -3.95).rotation.x = -Math.PI / 2 - 0.4;

    // legs
    // segments are built at their real length (y = 0 .. len) with spines baked in; seg() scales y only
    // when the IK has to stretch or squash one
    // lathed profiles (radius along the length): a thick base, a waist, a swelling before the next joint
    const femurGeo = spiny(lathe(FEMUR, [[0, 0.26], [0.06, 0.31], [0.25, 0.29], [0.55, 0.24], [0.8, 0.22], [0.93, 0.25], [1, 0.18]]), FEMUR, 0.26, 34, R);
    const tibiaGeo = spiny(lathe(TIBIA, [[0, 0.2], [0.07, 0.23], [0.3, 0.19], [0.65, 0.14], [0.9, 0.11], [1, 0.09]]), TIBIA, 0.17, 30, R);
    const clawGeo = new THREE.ConeGeometry(0.1, CLAW, 10).translate(0, -CLAW / 2, 0).rotateX(Math.PI); // tip at the origin, base at +y
    const angles = [38, 72, 108, 145].map((d) => (d * Math.PI) / 180);
    const reach = [4.6, 4.3, 4.3, 4.8];
    for (let k = 0; k < 4; k++) {
      for (const s of [-1, 1]) {
        const leg = {
          s, k,
          hip: new THREE.Vector3(s * 0.75, -0.05, 0.95 - k * 0.42),
          rest: new THREE.Vector3(s * Math.sin(angles[k]) * reach[k], 0, Math.cos(angles[k]) * reach[k]),
          foot: new THREE.Vector3(), from: new THREE.Vector3(), target: new THREE.Vector3(),
          stepping: false, t: 0, dur: 0.25, peak: 0, lastStep: 0,
        };
        const mk = (geo) => { const m = new THREE.Mesh(geo, legMat); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
        leg.femur = mk(femurGeo); leg.tibia = mk(tibiaGeo); leg.claw = mk(clawGeo);
        leg.knee = mk(sphere); leg.knee.scale.setScalar(0.2);
        leg.hipBall = mk(sphere); leg.hipBall.scale.setScalar(0.3);
        leg.femur.userData.len = FEMUR; leg.tibia.userData.len = TIBIA; leg.claw.userData.len = CLAW;
        this.legs.push(leg);
      }
    }
    for (const l of this.legs) {
      l.neighbours = this.legs.filter((o) => o !== l && ((o.s === l.s && Math.abs(o.k - l.k) === 1) || (o.s !== l.s && o.k === l.k)));
    }
  }

  // world position of a leg's rest spot, given the body's ground position and heading (no tilt)
  restWorld(leg, out, lead = 0) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const x = leg.rest.x, z = leg.rest.z;
    out.set(this.pos.x + x * c + z * s + this.vel.x * lead, 0, this.pos.z - x * s + z * c + this.vel.z * lead);
    out.y = this.world.heightAt(out.x, out.z);
    return out;
  }

  place(x, z, heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    for (const l of this.legs) { this.restWorld(l, l.foot); l.target.copy(l.foot); }
    this.pos.y = this.avgFootY() + spiderParams.ride;
  }

  avgFootY() { let y = 0; for (const l of this.legs) y += l.foot.y; return y / this.legs.length; }

  // input: {x, z} in world space (length 0..1), sprint: bool
  update(dt, input) {
    const P = spiderParams;
    this.time += dt;
    this.events.length = 0;

    // --- move
    const max = input.sprint ? P.sprint : P.walk;
    const prev = _w.copy(this.vel);
    this.vel.x = damp(this.vel.x, input.x * max, P.accel, dt);
    this.vel.z = damp(this.vel.z, input.z * max, P.accel, dt);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.4) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      const d = angleTo(this.heading, want);
      this.heading += clamp(d, -P.turn * dt, P.turn * dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // the walls push on the thorax and on the abdomen trailing behind it
    for (let it = 0; it < 2; it++) {
      for (const [off, r] of [[0.4, 1.5], [-2.7, 1.5]]) {
        const ox = this.pos.x + Math.sin(this.heading) * off, oz = this.pos.z + Math.cos(this.heading) * off;
        _v.set(ox, 0, oz);
        this.world.collide(_v, r);
        this.pos.x += _v.x - ox; this.pos.z += _v.z - oz;
      }
    }
    const accel = _v.copy(this.vel).sub(prev).divideScalar(Math.max(dt, 1e-4));

    // --- legs: who steps
    const fast = clamp(speed / P.sprint, 0, 1);
    const stepAt = P.stepAt + fast * 0.9;
    for (const l of this.legs) {
      if (l.stepping) continue;
      this.restWorld(l, l.target, P.lead);
      const dx = l.target.x - l.foot.x, dz = l.target.z - l.foot.z, d = Math.hypot(dx, dz);
      const dy = Math.abs(l.target.y - l.foot.y);
      const idle = speed < 0.3 && d > 0.35 && this.time - l.lastStep > 0.4;   // settle when standing
      const urgent = d > stepAt * 2.2;
      if ((d > stepAt || dy > 0.8 && d > 0.4 || idle) && (urgent || !l.neighbours.some((o) => o.stepping))) {
        l.stepping = true; l.t = 0;
        l.from.copy(l.foot);
        l.dur = P.stepTime * (1 - fast * 0.45);
        // arc over whatever is between: sample the ground along the way
        let top = Math.max(l.from.y, l.target.y);
        for (let i = 1; i < 6; i++) {
          const f = i / 6;
          top = Math.max(top, this.world.heightAt(l.from.x + dx * f, l.from.z + dz * f));
        }
        l.peak = top + 0.55 + d * 0.12;
      }
    }
    // --- legs: move the stepping ones
    for (const l of this.legs) {
      if (!l.stepping) continue;
      this.restWorld(l, l.target, P.lead);
      l.t = Math.min(1, l.t + dt / l.dur);
      const e = l.t * l.t * (3 - 2 * l.t);
      const base = l.from.y + (l.target.y - l.from.y) * e;
      const lift = 4 * l.t * (1 - l.t);
      l.foot.set(l.from.x + (l.target.x - l.from.x) * e, base + (l.peak - base) * lift, l.from.z + (l.target.z - l.from.z) * e);
      if (l.t >= 1) {
        l.stepping = false; l.lastStep = this.time;
        l.foot.copy(l.target);
        this.bobV -= 0.35 + fast * 0.5;
        this.events.push({ type: 'step', pos: l.foot.clone(), k: l.k });
      }
    }

    // --- body: height, bob, tilt
    let under = 0;
    for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1.4], [0, -1.6], [0, -3]]) {
      const c = Math.cos(this.heading), s = Math.sin(this.heading);
      under = Math.max(under, this.world.heightAt(this.pos.x + ox * c + oz * s, this.pos.z - ox * s + oz * c));
    }
    const wantY = Math.max(this.avgFootY() + P.ride, under + P.clearance);
    this.pos.y = damp(this.pos.y, wantY, 7, dt);
    // bob: a damped spring kicked by each footfall, plus a slow breath
    this.bobV += (-this.bob * 60 - this.bobV * 9) * dt;
    this.bob += this.bobV * dt;
    let front = 0, back = 0, left = 0, right = 0;
    for (const l of this.legs) {
      if (l.k < 2) front += l.foot.y; else back += l.foot.y;
      if (l.s < 0) left += l.foot.y; else right += l.foot.y;
    }
    const fwdX = Math.sin(this.heading), fwdZ = Math.cos(this.heading);
    const aFwd = accel.x * fwdX + accel.z * fwdZ, aSide = accel.x * fwdZ - accel.z * fwdX;
    const wantPitch = Math.atan2((front - back) / 4, 4.5) - aFwd * 0.012;
    const wantRoll = Math.atan2((right - left) / 4, 5.5) + aSide * 0.01;
    this.pitch = damp(this.pitch, clamp(wantPitch, -0.5, 0.5), 6, dt);
    this.roll = damp(this.roll, clamp(wantRoll, -0.4, 0.4), 6, dt);

    this.root.position.set(this.pos.x, this.pos.y + this.bob * 0.25 + Math.sin(this.time * 1.7) * 0.04, this.pos.z);
    this.root.rotation.set(-this.pitch, this.heading, this.roll);
    this.root.updateMatrixWorld();

    // abdomen: lags behind turns and accelerations, sags on landings, breathes
    const sw = this.abPivot.rotation;
    sw.y = damp(sw.y, clamp(-aSide * 0.02, -0.35, 0.35), 4, dt);
    sw.x = damp(sw.x, clamp(aFwd * 0.015 + this.bob * 0.4, -0.3, 0.3), 5, dt);
    const br = 1 + Math.sin(this.time * 1.7) * 0.025;
    this.abdomen.scale.set(1.5 * br, 1.2 * br, 1.95);
    this.abMat.emissiveIntensity = 0.45 + Math.sin(this.time * 2.3) * 0.2 + fast * 0.4;
    this.pustuleMat.emissiveIntensity = 0.8 + Math.sin(this.time * 3.1 + 1) * 0.4;
    for (const [i, f] of this.fangs.entries()) f.rotation.x = Math.sin(this.time * 6 + i * 2.1) * 0.12 * (0.4 + fast);

    // --- legs: IK and meshes
    for (const l of this.legs) this.pose(l);
  }

  pose(l) {
    const hip = _v.copy(l.hip).applyMatrix4(this.root.matrixWorld);
    const ankle = _w.copy(l.foot); ankle.y += CLAW;
    // knee: up and out from the body
    const out = new THREE.Vector3(hip.x - this.root.position.x, 0, hip.z - this.root.position.z).normalize();
    const pole = out.multiplyScalar(0.55).add(UP);
    const dir = new THREE.Vector3().subVectors(ankle, hip);
    let d = dir.length();
    dir.divideScalar(d || 1);
    d = clamp(d, Math.abs(FEMUR - TIBIA) + 0.05, FEMUR + TIBIA - 0.02);
    const x = (FEMUR * FEMUR - TIBIA * TIBIA + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, FEMUR * FEMUR - x * x));
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const knee = new THREE.Vector3().copy(hip).addScaledVector(dir, x).addScaledVector(pole, h);
    seg(l.femur, hip, knee);
    seg(l.tibia, knee, ankle);
    seg(l.claw, ankle, l.foot, true);
    l.knee.position.copy(knee);
    l.hipBall.position.copy(hip);
  }
}

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
    const L = 0.18 + R() * R() * 0.45;
    const c = new THREE.ConeGeometry(0.018 + L * 0.03, L, 4).translate(0, L / 2, 0);
    c.rotateZ(-1.0 - R() * 0.3);                       // lean out from the segment ...
    c.rotateY(a);                                       // ... on some side of it
    c.translate(Math.cos(a) * radius * 0.9, f * len, -Math.sin(a) * radius * 0.9);
    parts.push(c.toNonIndexed());
  }
  parts[0] = parts[0].toNonIndexed();
  return mergeGeometries(parts);
}
