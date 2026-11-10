import * as THREE from 'three';
import { clamp, damp, angleTo, rng } from './util.js';
import { legTextures, chitinTextures } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { model } from './world/models.js';

// AI-made body parts (assets/pilot/spider_*: concept image, mesh, Blender finish), loaded by main.js before the
// spider is built (main.js picks which: ?spider=). Each fills the box the procedural part filled; without them the
// procedural body stays.
// how each mesh came out of the mesher, turned to the body's frame (up +y, front +z): the carapace was painted
// from straight above and meshed standing up, its dome facing the camera and its front at the top of the image;
// the abdomen lying turned, its spinnerets off to the front right
const PART_TURN = { spider_thorax: [-Math.PI / 2, 0, Math.PI], spider_abdomen: [0, 2.49, 0] };
function aiPart(name, size, look) {
  const m = model(name);
  if (!m) return null;
  m.rotation.set(...(PART_TURN[name] || [0, 0, 0]));
  const g = new THREE.Group(); g.add(m); g.updateMatrixWorld(true);
  // its core, not its bounding box: spines and bristles stick out past the body, so measure between the
  // 3rd and 97th percentile of its vertices on each axis and fit that to the box
  const xs = [], ys = [], zs = [], v = new THREE.Vector3();
  m.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); xs.push(v.x); ys.push(v.y); zs.push(v.z); }
    // the spider's satin over the part's own baked maps (the baked colour is near-black under our lights)
    o.material = look(o.material);
  });
  const span = (arr) => { arr.sort((p, q) => p - q); const lo = arr[Math.floor(arr.length * 0.03)], hi = arr[Math.floor(arr.length * 0.97)]; return [hi - lo, (hi + lo) / 2]; };
  const [sx, cx] = span(xs), [sy, cy] = span(ys), [sz, cz] = span(zs);
  m.position.set(-cx, -cy, -cz);
  g.scale.set(size.x / sx, size.y / sy, size.z / sz);
  return g;
}

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
  maxLead: 1.6,      // m: how far ahead of its rest spot a foot may be placed, however fast (stays in reach)
  raiseFront: false, // sprinting: the front pair lifts and is held up and forward (runs on six); off: all eight run
};

const STRIKE_REACH = 5.8; // m from the hip
// the face mask: placement on the body (pos, tilt up), size (scan units -> m), eye sockets (scan units,
// after maskFromHead's recentring) and eye radius (scan units)
const MASK = { pos: [0, 0.2, 0.92], tilt: -0.9, scale: 1.25 / 6.4, eye: [0.484, -0.09, 1.56], eyeR: 0.23 };
const FEMUR = 2.6, TIBIA = 2.6, META = 1.3, META_TILT = 0.22, REACH = FEMUR + TIBIA;

export class Spider {
  constructor(scene, world) {
    this.world = world;
    this.pos = new THREE.Vector3();      // ground position (x, z); y = body height
    this.vel = new THREE.Vector3();
    this.tuck = 1;
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
    this.thorax = add(this.root, lump(0.05, 4, 1), chitin, 0, 0, 0.18, 0.72, 0.4, 0.8); // (its front pulled back: the mask is the front of the head)
    const hump = add(this.root, lump(0.06, 5, 2), chitin, 0, 0.22, 0.32, 0.44, 0.24, 0.6); // the raised carapace hump
    const baked = (k) => (o) => satin({ map: o.map, normal: o.normalMap, rough: o.roughnessMap }, { color: new THREE.Color(k, k * 0.9, k * 0.85), roughness: 1, normalScale: new THREE.Vector2(1, 1) });
    const shell = aiPart('spider_thorax', new THREE.Vector3(1.5, 0.6, 1.55), baked(0.55));
    if (shell) { // the generated carapace replaces both lumps
      shell.position.set(0, 0.1, 0.16); this.root.add(shell);
      this.thorax.visible = hump.visible = false;
      shell.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    }
    // the face: a mask grown out of its own chitin over the front of the carapace (loadMask), two eyes in it
    this.maskMat = satin(chitinTextures(73, [92, 74, 64]), { normalScale: new THREE.Vector2(0.35, 0.35) }); // smoother: carved, not hairy
    this.eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x030102, emissive: 0xff1806, emissiveIntensity: 0.22, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 });
    this.eyeGeo = sphere;
    this.loadMask();
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
    const sac = aiPart('spider_abdomen', new THREE.Vector3(2, 2, 2), baked(2.6)); // (fills the unit sphere's box: the abdomen's scale still sizes and breathes it)
    if (sac) { this.abdomen.material = new THREE.MeshBasicMaterial({ visible: false }); this.abdomen.castShadow = false; this.abdomen.add(sac); }
    this.abBase = this.abdomen.scale.clone();
    // spinnerets
    add(this.abPivot, new THREE.ConeGeometry(0.1, 0.26, 10), chitin, 0, 0.05, -2.2).rotation.x = -Math.PI / 2 - 0.4;

    // body slots (Design/DESIGN.md): mutations hang their parts on these mounts (or on the legs, by pair)
    this.mat = { chitin, leg: legMat, abdomen: this.abMat };
    this.mounts = { maw: new THREE.Group(), carapace: new THREE.Group(), abdomen: new THREE.Group(), glands: new THREE.Group() };
    this.root.add(this.mounts.maw, this.mounts.carapace);
    this.mounts.carapace.position.set(0, 0.3, 0.3);
    this.abPivot.add(this.mounts.abdomen, this.mounts.glands);
    this.mounts.abdomen.position.set(0, 0.18, -1.15);
    this.mounts.glands.position.set(0, 0.05, -2.2);
    this.mawJaws = [];

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
          raised: false, air: 0, hoverGoal: new THREE.Vector3(), fv: new THREE.Vector3(),
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

  // ---------------------------------------------------------------- the face
  // The upper half of a human face (a head scan, see CREDITS.md), cut out, softened and set into the front
  // of the carapace, tilted up towards the camera: the creature's own chitin in the shape of a face, two
  // glossy eyes in its sockets, the chelicerae and fangs hanging below it.
  loadMask() {
    new GLTFLoader().load('./models/LeePerrySmith.glb', (gltf) => {
      let src = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o.geometry; });
      if (!src) return;
      const geo = maskFromHead(src);
      const mesh = new THREE.Mesh(geo, this.maskMat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.scale.setScalar(MASK.scale);
      const g = new THREE.Group();
      g.position.set(...MASK.pos);
      g.rotation.x = MASK.tilt;
      g.add(mesh);
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(this.eyeGeo, this.eyeMat);
        e.position.set(s * MASK.eye[0], MASK.eye[1], MASK.eye[2]);
        e.scale.set(MASK.eyeR, MASK.eyeR * 0.8, MASK.eyeR * 0.7);
        mesh.add(e);
      }
      this.root.add(g);
      this.mask = g;
    });
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
  // air (0..1): a leg in the air carries its metatarsus on out from the hip instead of hanging it down
  solve(hip, foot, knee, ankle, air = 0) {
    let dx = foot.x - hip.x, dz = foot.z - hip.z;
    const hd = Math.hypot(dx, dz) || 1;
    dx /= hd; dz /= hd;
    const st = Math.sin(META_TILT) * META;
    ankle.set(foot.x - dx * st, foot.y + Math.cos(META_TILT) * META, foot.z - dz * st);
    if (air > 0) {
      const fx = foot.x - hip.x, fy = foot.y - hip.y, fz = foot.z - hip.z, fl = Math.hypot(fx, fy, fz) || 1;
      const ax_ = foot.x - (fx / fl) * META * 0.95, ay_ = foot.y - (fy / fl) * META * 0.95 + 0.35, az_ = foot.z - (fz / fl) * META * 0.95;
      ankle.set(ankle.x + (ax_ - ankle.x) * air, ankle.y + (ay_ - ankle.y) * air, ankle.z + (az_ - ankle.z) * air);
    }
    const ax = ankle.x - hip.x, ay = ankle.y - hip.y, az = ankle.z - hip.z;
    const reach = Math.hypot(ax, ay, az) || 1e-4;
    const ux = ax / reach, uy = ay / reach, uz = az / reach;
    const d = clamp(reach, Math.abs(FEMUR - TIBIA) + 0.05, REACH - 0.01);
    const x = (FEMUR * FEMUR - TIBIA * TIBIA + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, FEMUR * FEMUR - x * x));
    // pole: up and a little outward, made perpendicular to the hip->ankle line
    // (in the air the knee bends outward: "up" flips across when the leg itself points up)
    let px = dx * (0.3 + air * 1.5), py = 1 - air * 0.5, pz = dz * (0.3 + air * 1.5);
    const pd = px * ux + py * uy + pz * uz;
    px -= ux * pd; py -= uy * pd; pz -= uz * pd;
    const pl = Math.hypot(px, py, pz) || 1;
    knee.set(hip.x + ux * x + (px / pl) * h, hip.y + uy * x + (py / pl) * h, hip.z + uz * x + (pz / pl) * h);
    return reach;
  }

  // how far the whole leg stays clear of the world (m; negative = it clips), or -9 if out of reach
  clearance(hip, foot, air = 0) {
    const r = this.solve(hip, foot, _K, _A, air);
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
    const [lx, lz] = this.leadOffset(P.lead + l.dur * 0.5), tk = this.tuck;
    const nx = this.pos.x + (l.rest.x * c + l.rest.z * s) * tk + lx;
    const nz = this.pos.z + (-l.rest.x * s + l.rest.z * c) * tk + lz;
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

  // velocity * t, but no longer than maxLead: at a sprint the feet can't be planted further ahead
  // than the legs reach (that's what made the front legs flicker between stepping and hovering)
  leadOffset(t) {
    const ox = this.vel.x * t, oz = this.vel.z * t, len = Math.hypot(ox, oz), k = len > spiderParams.maxLead ? spiderParams.maxLead / len : 1;
    return [ox * k, oz * k];
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

    // --- move (or fly, mid-pounce)
    const max = input.sprint ? P.sprint : P.walk;
    const prevVel = _w.copy(this.vel);
    const L = this.leap;
    if (L) {
      L.t = Math.min(1, L.t + dt / L.dur);
      const e = smooth(L.t);
      const nx = L.from.x + (L.to.x - L.from.x) * e, nz = L.from.z + (L.to.z - L.from.z) * e;
      this.vel.set((nx - this.pos.x) / Math.max(dt, 1e-4), 0, (nz - this.pos.z) / Math.max(dt, 1e-4));
      this.pos.x = nx; this.pos.z = nz;
    } else {
      this.vel.x = damp(this.vel.x, input.x * max, P.accel, dt);
      this.vel.z = damp(this.vel.z, input.z * max, P.accel, dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
    }
    const speed = L ? 0 : Math.hypot(this.vel.x, this.vel.z);
    this.speed = speed;
    if (speed > 0.4) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      this.heading += clamp(angleTo(this.heading, want), -P.turn * dt, P.turn * dt);
    } else if (input.face !== undefined && !L) {
      this.heading += clamp(angleTo(this.heading, input.face), -P.turn * 0.8 * dt, P.turn * 0.8 * dt);
    }
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
    if (L) {
      // the arc of the leap; legs tucked in under the body; landing hits everyone there
      this.pos.y = L.y0 + (Math.max(wantY, L.y0) - L.y0) * L.t + Math.sin(Math.PI * L.t) * 3.2;
      if (L.t >= 1) {
        this.leap = null;
        this.events.push({ type: 'land', pos: this.pos.clone() });
        for (const l of this.legs) if (!l.strike) { l.hover = true; l.lastPlan = -1; l.hoverGoal.copy(l.foot); }
      }
    }

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

    // legs come in closer to the body the faster it goes (more stride before a foot is left behind)
    this.tuck = 1 - 0.2 * clamp((speed - P.walk * 0.5) / (P.sprint - P.walk * 0.5), 0, 1);

    // --- striking legs: raise, stab, carry to the fangs (strikeUpdate)
    for (const l of this.legs) if (l.strike) this.strikeUpdate(l, dt);

    // --- sprinting: the front pair comes up off the ground and is held raised and forward, swaying with
    // the run; it comes back down (a normal step onto a foothold) a moment after the sprint ends
    const sprinting = P.raiseFront && speed > P.walk + 1.5;
    this.sprintT = sprinting ? (this.sprintT || 0) + dt : 0;
    this.calmT = sprinting ? 0 : (this.calmT || 0) + dt;
    for (const l of this.legs) {
      if (l.k !== 0) continue;
      if (!l.raised && this.sprintT > 0.2 && !l.stepping) {
        l.raised = true; l.hover = true;
        l.fv.set(0, 0, 0);
      }
      if (l.raised && this.calmT > 0.25) { l.raised = false; l.lastPlan = -1; l.hoverGoal.copy(l.foot); }
      if (l.raised) {
        const sw = Math.sin(this.time * 7 + (l.s > 0 ? 0 : Math.PI));
        _R.set(l.s * (2.7 + sw * 0.2), 1.7 + sw * 0.3, 2.7 + Math.cos(this.time * 7 + l.s) * 0.25); // a wide V, up and forward
        this.root.localToWorld(_R);
        // held clear of whatever it's running past: lift it until the whole leg clears
        const hip = this.hipWorld(l, _H);
        for (let i = 0; i < 6 && this.clearance(hip, _R, 1) < 0.25; i++) _R.y += 0.5;
        // a critically damped spring: no jumps, however the body moves
        const k = 160, d = 2 * Math.sqrt(k);
        l.fv.x += ((_R.x - l.foot.x) * k - l.fv.x * d) * dt; l.fv.y += ((_R.y - l.foot.y) * k - l.fv.y * d) * dt; l.fv.z += ((_R.z - l.foot.z) * k - l.fv.z * d) * dt;
        l.foot.addScaledVector(l.fv, dt);
        // and where it actually is (the spring lags at a sprint): never let it trail into anything
        for (let i = 0; i < 6 && this.clearance(hip, l.foot, l.air) < 0.1; i++) { l.foot.y += 0.3; l.fv.y = Math.max(l.fv.y, 0); }
      }
    }
    // hovering legs drift smoothly to where they're held (not snap)
    for (const l of this.legs) {
      if (!l.hover || l.raised || l.stepping || l.strike) continue;
      l.foot.x = damp(l.foot.x, l.hoverGoal.x, 8, dt); l.foot.y = damp(l.foot.y, l.hoverGoal.y, 8, dt); l.foot.z = damp(l.foot.z, l.hoverGoal.z, 8, dt);
    }
    // in the air or not: how the metatarsus is carried
    for (const l of this.legs) l.air = damp(l.air, l.hover && !l.stepping ? 1 : l.stepping ? 0.35 : 0, 8, dt);

    if (this.leap) {
      for (const l of this.legs) {
        if (l.strike) continue;
        l.stepping = false; l.hover = true; l.lastPlan = this.time;
        _R.set(l.rest.x * 0.45, -1.1, l.rest.z * 0.45 + (l.k < 2 ? 0.5 : -0.2));
        this.root.localToWorld(_R); l.hoverGoal.copy(_R);
      }
    }

    // --- legs: who needs to step
    const fast = clamp(speed / P.sprint, 0, 1);
    const stepAt = P.stepAt + speed * 0.1;
    const want = [];
    for (const l of this.legs) {
      if (l.stepping || l.raised || l.strike) continue;
      // drift from where it should be: the rest spot ahead by the velocity (cheap; the full foothold
      // search only runs when it actually steps)
      const [lx, lz] = this.leadOffset(P.lead), tk = this.tuck;
      const nx = this.pos.x + (l.rest.x * c + l.rest.z * s) * tk + lx;
      const nz = this.pos.z + (-l.rest.x * s + l.rest.z * c) * tk + lz;
      const drift = Math.hypot(nx - l.foot.x, nz - l.foot.z);
      // about to clip or over-stretch: checked a moment ahead, so it lifts before it happens
      const invalid = !l.hover && this.clearance(this.hipWorld(l, _H, Math.min(0.15, 0.6 / Math.max(speed, 0.1))), l.foot) < 0.08;
      const idle = speed < 0.3 && drift > 0.35 && this.time - l.lastStep > 0.5 * l.jit;
      const replan = l.hover && this.time - l.lastPlan > 0.3;         // a hovering leg keeps looking (not too eagerly)
      if (invalid || drift > stepAt * l.jit || idle || replan) {
        want.push({ l, urgent: invalid || drift > stepAt * 2.2, score: (invalid ? 100 : 0) + drift, why: invalid ? 'invalid' : replan ? 'replan' : idle ? 'idle' : 'drift' });
      }
    }
    want.sort((a, b) => b.score - a.score);
    let swinging = 0;
    for (const l of this.legs) if (l.stepping) swinging++;
    for (const { l, urgent, why } of want) {
      if (swinging >= 4 && !urgent) continue;
      if (!urgent && l.neighbours.some((o) => o.stepping)) continue;
      l.dur = P.stepTime * (1 - fast * 0.4) * l.jit;
      l.lastPlan = this.time;
      const ok = this.foothold(l, l.target);
      if (l.hover && !ok) { l.hoverGoal.copy(l.target); continue; }    // still nowhere to stand: keep hovering
      l.stepping = true; l.t = 0;
      if (this.log) this.log.push([+this.time.toFixed(2), l.k, l.s, why, ok ? 1 : 0, +Math.hypot(l.target.x - l.foot.x, l.target.z - l.foot.z).toFixed(2)]);
      l.from.copy(l.foot);
      l.willHover = !ok;
      // the swing: up, across and down when something between is higher than both ends
      let top = Math.max(l.from.y, l.target.y);
      for (let i = 1; i < 8; i++) { const f = i / 8; top = Math.max(top, H(l.from.x + (l.target.x - l.from.x) * f, l.from.z + (l.target.z - l.from.z) * f)); }
      l.over = top > Math.max(l.from.y, l.target.y) + 0.15;
      l.apex = top + (l.over ? 0.55 : 0.4 + Math.hypot(l.target.x - l.from.x, l.target.z - l.from.z) * 0.1);
      // check the whole leg along the swing (where the hip will be by then); raise the arc until it clears
      for (let tries = 0; tries < 6 && !this.swingClear(l); tries++) { l.over = true; l.apex += 0.45; }
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
        l.hoverGoal.copy(l.foot);
        if (!l.hover) {
          this.bobV -= 0.3 + fast * 0.4;
          this.events.push({ type: 'step', pos: l.foot.clone(), k: l.k, s: l.s });
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
    for (const t of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
      const c = this.clearance(this.hipWorld(l, _H2, l.dur * t), this.swingAt(l, t, _S));
      if (c < 0.05 && c > -9) return false;                          // (-9: out of reach mid-swing, fine)
    }
    return true;
  }

  // ---------------------------------------------------------------- the impale
  // Strike with every free leg that has someone in reach: the front pair on the move, the front two pairs
  // standing still (more legs to spare when it doesn't need them to walk). people: People (nearest,
  // grab, consume). Returns how many legs struck.
  // The autoattack: every free front leg brings its claw down on someone in the front arc (120 degrees).
  // Legs that walk can't slash: standing still, the front four; walking, the front pair; sprinting, none.
  autoSlash(people, opts = {}) {
    this.people = people;
    if (this.leap || this.feeding) return 0;
    const sp = this.speed || 0;
    const pairs = sp < 1.2 ? [0, 1] : sp < spiderParams.walk + 1 ? [0] : [];
    if (!pairs.length) return 0;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const taken = new Set(this.legs.filter((l) => l.strike).map((l) => l.strike.h));
    let n = 0;
    for (const l of this.legs) {
      if (!pairs.includes(l.k) || l.strike || this.time - (l.strikeEnd || -9) < (opts.rest ?? 0.45)) continue;
      const hip = this.hipWorld(l, _H);
      const h = people.nearest(hip.x, hip.z, STRIKE_REACH, (o) => {
        if (taken.has(o)) return false;
        const dx = o.x - this.pos.x, dz = o.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
        return (dx * fx + dz * fz) / d > 0.5 && (dx * Math.cos(this.heading) - dz * Math.sin(this.heading)) * l.s > -1.0;
      });
      // nobody in reach: a thing then (a lock machine: { isTarget, x, z, y, alive(), onHit(dmg) })
      let tgt = h;
      if (!tgt) for (const t of opts.targets || []) {
        if (!t.alive() || taken.has(t)) continue;
        const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
        if (Math.hypot(t.x - hip.x, t.z - hip.z) < STRIKE_REACH + 1 && (dx * fx + dz * fz) / d > 0.3) { tgt = t; break; }
      }
      if (!tgt) continue;
      taken.add(tgt);
      l.strike = { h: tgt, t: 0, phase: 'raise', from: new THREE.Vector3(), kind: 'slash', dmg: opts.dmg ?? 2 };
      l.stepping = false; l.hover = true;
      n++;
    }
    return n;
  }

  // Pounce: leap at (x, z), at most 11 m away; landing (event 'land') hits and stuns everyone there.
  pounce(x, z) {
    if (this.leap) return false;
    let dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) return false;
    const k = Math.min(1, 11 / d); dx *= k; dz *= k;
    this.leap = { from: this.pos.clone(), to: new THREE.Vector3(this.pos.x + dx, 0, this.pos.z + dz), t: 0, dur: 0.38 + Math.hypot(dx, dz) * 0.025, y0: this.pos.y };
    this.heading = Math.atan2(dx, dz);
    return true;
  }

  // Devour (and the old impale): a leg seizes someone and carries them to the jaws to be eaten.
  strike(people, opts = {}) {
    this.people = people;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const pairs = speed < 1 ? [0, 1] : [0];
    const taken = new Set(this.legs.filter((l) => l.strike).map((l) => l.strike.h));
    let n = 0;
    for (const l of this.legs) {
      if (opts.max && n >= opts.max) break;
      if (!pairs.includes(l.k) || l.strike || this.time - (l.strikeEnd || -9) < 0.15) continue;
      const hip = this.hipWorld(l, _H);
      const side = l.s * Math.cos(this.heading), sideZ = -l.s * Math.sin(this.heading); // this leg's side of the body
      const h = people.nearest(hip.x, hip.z, STRIKE_REACH, (o) => !taken.has(o)
        && ((o.x - this.pos.x) * side + (o.z - this.pos.z) * sideZ > -1.2 || l.k === 0));
      if (!h) continue;
      taken.add(h);
      l.strike = { h, t: 0, phase: 'raise', from: new THREE.Vector3() };
      l.stepping = false; l.hover = true;
      n++;
    }
    return n;
  }

  strikeUpdate(l, dt) {
    const S = l.strike, h = S.h, P = this.people;
    S.t += dt;
    if (S.phase === 'raise') {
      // up over the victim (tracking them), a beat to telegraph it
      if (!(h.isTarget ? h.alive() : P.alive(h))) { this.endStrike(l); return; }
      const hip = this.hipWorld(l, _H);
      _R.set(h.x + (hip.x - h.x) * 0.15, Math.max(h.y + 3.4, hip.y + 1.4), h.z + (hip.z - h.z) * 0.15);
      l.foot.x = damp(l.foot.x, _R.x, 16, dt); l.foot.y = damp(l.foot.y, _R.y, 16, dt); l.foot.z = damp(l.foot.z, _R.z, 16, dt);
      if (S.t > (S.kind === 'slash' ? 0.15 : 0.22)) { S.phase = 'stab'; S.t = 0; S.from.copy(l.foot); }
    } else if (S.phase === 'stab') {
      // down through them
      _R.set(h.x, h.y + 1.35, h.z);
      const e = Math.min(1, S.t / 0.07);
      l.foot.lerpVectors(S.from, _R, e * e);
      if (e >= 1 && S.kind === 'slash') {
        if (h.isTarget) h.onHit(S.dmg); else P.hit(h, S.dmg, _D.set(h.x - this.pos.x, 0, h.z - this.pos.z));
        this.events.push({ type: 'slash', h, pos: l.foot.clone() });
        this.endStrike(l);
        return;
      }
      if (e >= 1) {
        P.grab(h);
        this.events.push({ type: 'impale', h, pos: l.foot.clone() });
        S.phase = 'carry'; S.t = 0; S.from.copy(l.foot);
      }
    } else if (S.phase === 'carry' || S.phase === 'eat') {
      // lift them, swing them in to the fangs, hold them there while it feeds
      _R.set(0, -0.1, 1.5).applyMatrix4(this.root.matrixWorld);
      const e = S.phase === 'eat' ? 1 : smooth(Math.min(1, S.t / 0.5));
      l.foot.lerpVectors(S.from, _R, e);
      l.foot.y += Math.sin(Math.PI * e) * 1.2;
      h.x = l.foot.x; h.z = l.foot.z; h.y = l.foot.y - 1.35; h.tilt = 1.1 * e; h.heading += dt * 3;
      if (S.phase === 'carry' && S.t >= 0.5) { S.phase = 'eat'; S.t = 0; }
      else if (S.phase === 'eat' && S.t >= 0.4) {
        P.consume(h);
        this.events.push({ type: 'eat', h, pos: l.foot.clone() });
        this.endStrike(l);
      }
    }
  }

  endStrike(l) {
    l.strike = null; l.strikeEnd = this.time;
    l.hover = true; l.hoverGoal.copy(l.foot); l.lastPlan = -1; // back down: the next re-plan steps it onto a foothold
  }

  pose(l) {
    const [hip, knee, ankle] = l.j;
    this.hipWorld(l, hip);
    this.solve(hip, l.foot, knee, ankle, l.air);
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

const _D = new THREE.Vector3(), _R = new THREE.Vector3(), _H = new THREE.Vector3(), _H2 = new THREE.Vector3(), _S = new THREE.Vector3(), _F = new THREE.Vector3(), _K = new THREE.Vector3(), _A = new THREE.Vector3();
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

// Cut the mask out of the head scan (faces +z, up +y; nose tip near (0, 1.1, 2.6)): the triangles of the
// upper front of the face, from below the nose to the brow. Narrowed a little, the nose pressed back,
// recentred so the origin sits between the eyes at the back of the mask.
export function maskFromHead(src) {
  const pos = src.attributes.position.clone(), uv = src.attributes.uv && src.attributes.uv.clone();
  const keep = (i) => {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    return y > 0.92 && y < 3.5 && z > 0.6 && Math.abs(x) < 2.4;
  };
  const idx = src.index.array, out = [];
  for (let t = 0; t < idx.length; t += 3) if (keep(idx[t]) && keep(idx[t + 1]) && keep(idx[t + 2])) out.push(idx[t], idx[t + 1], idx[t + 2]);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    x *= 0.88;                                                   // narrower
    z = z * 0.6 + 0.9;                                           // flatter: the cheeks and brow come forward (a mask, not a head)
    const nose = Math.max(0, 1 - Math.abs(x) / 1.0) * Math.max(0, (z - 1.9) / 0.6) * Math.max(0, 1 - Math.max(0, y - 2.2) / 0.8);
    z -= nose * 0.15;                                            // a softer, smaller nose
    // the closed eyelids hollowed into sockets (the scan's eyes are shut; ours aren't)
    for (const ex of [-0.55 * 0.88, 0.55 * 0.88]) {
      const r = Math.hypot(x - ex, (y - 1.66) * 1.25);
      if (r < 0.45) z -= 0.32 * (1 - (r / 0.45) ** 2);
    }
    pos.setXYZ(i, x, y - 1.75, z - 0.15);                         // origin between the eyes, at the back
  }
  // Close it into a solid: a flat back behind the face and a rim round its cut edge. The camera looks down past
  // it from behind, and open, its culled back let the floor show through between the chelicerae.
  const P = [], U = [], I = [], front = new Map();
  // the face keeps the scan's UVs; the back and rim are projected (the scan's would stretch into streaks down the rim)
  const vert = (x, y, z, i) => { P.push(x, y, z); if (uv) { if (i >= 0) U.push(uv.getX(i), uv.getY(i)); else U.push((x + 0.5 * z) * 0.2, (y + z) * 0.2); } return P.length / 3 - 1; };
  let zMin = Infinity;
  for (const i of out) zMin = Math.min(zMin, pos.getZ(i));
  const zBack = zMin - 0.25;
  for (const i of new Set(out)) front.set(i, vert(pos.getX(i), pos.getY(i), pos.getZ(i), i));
  const back = new Map();
  for (const i of front.keys()) back.set(i, vert(pos.getX(i), pos.getY(i), zBack, -1));
  const edges = new Map(); // undirected edge -> its direction in the one front triangle that has it (an open edge)
  for (let t = 0; t < out.length; t += 3) {
    const [a, b, c] = [out[t], out[t + 1], out[t + 2]];
    I.push(front.get(a), front.get(b), front.get(c), back.get(a), back.get(c), back.get(b));
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? `${p},${q}` : `${q},${p}`; edges.set(k, edges.has(k) ? null : [p, q]); }
  }
  for (const e of edges.values()) {
    if (!e) continue;
    const [a, b] = e, f = (i, z) => vert(pos.getX(i), pos.getY(i), z, -1); // (its own vertices: a crisp rim)
    const fa = f(a, pos.getZ(a)), fb = f(b, pos.getZ(b)), ba = f(a, zBack), bb = f(b, zBack);
    I.push(fa, ba, bb, fa, bb, fb);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  geo.computeVertexNormals();
  return geo;
}
