import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld } from './world/world.js';
import { makeLabLayout } from './world/layout.js';
import { makeGymLayout } from './world/gym.js';
import { makeFacility } from './world/generate.js';
import { loadModels } from './world/models.js';
import { Spider } from './spider.js';
import { Post, postParams } from './post.js';
import { softDot } from './textures.js';
import { damp, clamp } from './util.js';
import { FX } from './fx.js';
import { Spill } from './spill.js';
import { Damage } from './damage.js';
import { People } from './people/people.js';
import { Hud } from './hud.js';
import { sfx, falloff, audioOpts } from './audio.js';
import { Mutations, MUTATIONS, SLOTS, SLOT_NAMES, SLOT_KEYS } from './mutations.js';

// URL switches: ?auto (autopilot tour), ?shot (for tools/shot.mjs: no HUD, fixed time step),
// ?cam=x,z (start the camera / spider somewhere), ?nopost
const Q = new URLSearchParams(location.search);
const SHOT = Q.has('shot');
if (SHOT) document.documentElement.classList.add('shot');
if (Q.has('nopost')) postParams.on = false;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: SHOT });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020304);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.12;
scene.fog = new THREE.FogExp2(0x030506, 0.012);

// the level: a layout (plain data; hand-made now, generated later) built into meshes + query services
// (the AI-made models first: the kit places them as it builds)
// which spider: ?spider=procedural|abdomen|carapace|both (the gym has buttons for them); the game uses the AI abdomen
const VERSIONS = { procedural: 'Procedural', abdomen: 'AI abdomen', carapace: 'AI carapace', both: 'AI both' };
const VERSION_PARTS = { procedural: [], abdomen: ['spider_abdomen'], carapace: ['spider_thorax'], both: ['spider_abdomen', 'spider_thorax'] };
const version = VERSIONS[Q.get('spider')] ? Q.get('spider') : Q.has('classic') ? 'procedural' : Q.has('carapace') ? 'both' : 'abdomen';
await loadModels(renderer, ['generator', 'hazmat_locker', 'centrifuge', 'lab_trolley', ...VERSION_PARTS[version]]);
// ?gym: an obstacle course with nobody in it, for moving the spider around (world/gym.js)
const GYM = Q.has('gym');
if (GYM) audioOpts.siren = false;
// the level: a generated facility (?seed=N; a fresh one every run), or ?lab for the hand-made first lab
const SEED = Q.get('seed') ? +Q.get('seed') : Q.has('shot') ? 1 : Math.floor(Math.random() * 1e6);
const lab = buildWorld(scene, GYM ? makeGymLayout() : Q.has('lab') ? makeLabLayout() : makeFacility(SEED));
console.log('facility seed', SEED, lab.layout.info || '');
const spider = new Spider(scene, lab);
spider.place(lab.spawn.x, lab.spawn.z, lab.spawn.heading);
if (Q.get('at')) { const [x, z, h] = Q.get('at').split(',').map(Number); spider.place(x, z, h || 0); }

// the people (?nopeople: an empty lab), effects, the game's state
const fx = new FX(scene);
// liquids on the floor: blood, specimen fluid, oil (spill.js); everything that bleeds or breaks adds to it
const spill = new Spill(renderer, lab);
fx.spill = spill;
// battle damage: bullet holes, casings, glass, scorch (damage.js); the start bay's smashed tank has its glass round it
const damage = new Damage(scene, lab);
for (const pc of lab.layout.pieces) if (pc.type === 'tank' && pc.broken) damage.scatter(pc.x, pc.z, 70, 3.2);
const people = Q.has('nopeople') || GYM ? null : new People(scene, lab, spider, fx);
const state = { hp: 100, kills: 0, over: false, hurt: 0, log: [] };
const hud = new Hud();
// the gym's spider picker: reloads with the chosen version, the spider where it stood (V cycles)
if (GYM) {
  const go = (v) => { const q = new URLSearchParams(location.search); q.delete('classic'); q.delete('carapace'); q.set('spider', v); q.set('at', [spider.pos.x, spider.pos.z, spider.heading].map((n) => n.toFixed(2)).join(',')); location.search = q.toString().replace(/=(?=&|$)/g, ''); };
  hud.versions(VERSIONS, version, go);
  addEventListener('keydown', (e) => { if (e.code === 'KeyV') { const k = Object.keys(VERSIONS); go(k[(k.indexOf(version) + 1) % k.length]); } });
}

// dust in the air, drifting through the lamp light
const dust = (() => {
  const N = 900, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 64; pos[i * 3 + 1] = Math.random() * 6; pos[i * 3 + 2] = (Math.random() - 0.5) * 44; seed[i] = Math.random(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDot(), size: 0.09, color: 0x8a8070, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(m);
  return { m, pos, N, update(dt, t) { for (let i = 0; i < N; i++) { pos[i * 3 + 1] += Math.sin(t * 0.3 + i) * dt * 0.05; pos[i * 3] += Math.cos(t * 0.2 + i * 1.3) * dt * 0.06; } geo.attributes.position.needsUpdate = true; } };
})();

// camera: high and steep, a little behind (south of) the spider, leading where it's going
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 200);
const CAM = { height: 34, back: 17 };
if (Q.get('cam')) { const [h, b] = Q.get('cam').split(',').map(Number); CAM.height = h; CAM.back = b; }
const camTarget = new THREE.Vector3().copy(spider.pos);
let shake = 0;
// ?eye=x,y,z&look=x,y,z: a fixed debug camera; ?hide: no spider (for inspecting the level)
const EYE = Q.get('eye') && Q.get('eye').split(',').map(Number), LOOK = Q.get('look') ? Q.get('look').split(',').map(Number) : [0, 0, 0];
if (Q.has('hide')) spider.root.parent.traverse((o) => { if (o.isMesh && (o.parent === spider.root || spider.root.children.includes(o.parent) || o.material?.map === spider.legs[0].femur.material.map)) o.visible = false; });
function updateCamera(dt, t) {
  if (EYE) { camera.position.set(...EYE); camera.lookAt(...LOOK); return; }
  if (window.__eye) { const E = window.__eye; camera.position.set(E[0], E[1], E[2]); camera.lookAt(E[3], E[4], E[5]); return; } // (tools: a camera set from outside)
  const lead = new THREE.Vector3(spider.vel.x * 0.45, 0, spider.vel.z * 0.45);
  camTarget.x = damp(camTarget.x, spider.pos.x + lead.x, 3.5, dt);
  camTarget.z = damp(camTarget.z, spider.pos.z + lead.z, 3.5, dt);
  camTarget.y = damp(camTarget.y, spider.pos.y * 0.5, 3, dt);
  shake = Math.max(0, shake - dt * 3);
  const sx = (Math.sin(t * 61) + Math.sin(t * 37)) * shake * 0.08, sz = (Math.sin(t * 53) + Math.sin(t * 29)) * shake * 0.08;
  camera.position.set(camTarget.x + sx, camTarget.y + CAM.height, camTarget.z + CAM.back + sz);
  camera.lookAt(camTarget.x + sx * 0.5, camTarget.y, camTarget.z + sz * 0.5);
}

const post = new Post(renderer);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  post.resize();
});

// input
const keys = new Set();
let auto = Q.has('auto'), wp = 0;
// the cursor, on the floor: where the body turns to face when slow, and where a pounce lands
const mouse = new THREE.Vector2(0, 0), aim = new THREE.Vector3(), ray = new THREE.Raycaster(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
addEventListener('mousemove', (e) => mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));

// mutations: one per body slot, fixed keys per slot (mutations.js); ?mut=devour,quills,pounce to start with some
const mutations = new Mutations(scene, spider, fx);
const ctx = { people, world: lab, aim, quills: mutations.quills };
for (const id of (Q.get('mut') || '').split(',').filter(Boolean)) if (MUTATIONS[id]) mutations.take(id);
let choosing = null; // the offer on screen (the game waits)
function pick(i) {
  if (!choosing || !choosing[i]) return;
  mutations.take(choosing[i]);
  choosing = null;
  hud.closeChoice();
}
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyP') auto = !auto;
  if (e.code === 'KeyR' && state.over) location.reload();
  if (choosing) { if (/^Digit[123]$/.test(e.code)) pick(+e.code.slice(-1) - 1); return; }
  if (e.code === 'Digit1') postParams.on = !postParams.on;
  for (const [slot, key] of Object.entries(SLOT_KEYS)) if (e.code === 'Key' + key && !state.over && people) mutations.trigger(slot, ctx);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  let x = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
  let z = (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0);
  const sprint = k('ShiftLeft', 'ShiftRight');
  if (x || z) auto = false;
  if (auto) {
    const p = lab.route[wp % lab.route.length];
    x = p.x - spider.pos.x; z = p.y - spider.pos.z;
    if (Math.hypot(x, z) < 2.2) wp++;
    return { x: x / (Math.hypot(x, z) || 1), z: z / (Math.hypot(x, z) || 1), sprint: Q.has('fast') };
  }
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l, sprint, face: Math.atan2(aim.x - spider.pos.x, aim.z - spider.pos.z) };
}

// ?measure: leg / body clipping into obstacles, every frame (tools/clipcheck.mjs reads window.game.clip)
const clip = Q.has('measure') ? { frames: 0, bad: 0, deep: 0, max: 0, maxAt: 0, legFrames: 0, worst: [], kinds: {} } : null;
function measureClip() {
  const r = spider.clipStats();
  clip.frames++;
  clip.legFrames += r.legs;
  if (r.depth > 0.05) clip.bad++;
  if (r.depth > 0.3) clip.deep++;
  if (r.depth > clip.max) { clip.max = r.depth; clip.maxAt = time; }
  if (r.depth > 0.05) clip.kinds[r.kind] = (clip.kinds[r.kind] || 0) + 1;
  if (r.depth > 0.3) clip.worst.push([+time.toFixed(2), +r.depth.toFixed(2), +spider.pos.x.toFixed(1), +spider.pos.z.toFixed(1), r.kind]);
}

// the locks: the slash hits them like anyone else (spider.autoSlash targets); each blow sparks, and at zero
// they blow and go dark. When the last one goes, the exit door rolls up and daylight floods in.
const lockTargets = lab.locks.map((L) => ({ isTarget: true, x: L.x, z: L.z, y: L.h - 1.2, alive: () => !L.destroyed, onHit: (d) => hitLock(L, d) }));
function hitLock(L, d) {
  L.hp -= d * 1.8; // (about 6 s of steady slashing per lock: long enough to be a stand under fire)
  fx.burst(new THREE.Vector3(L.x + (Math.random() - 0.5) * L.w * 0.6, L.h * 0.8, L.z + (Math.random() - 0.5) * L.d * 0.6), 'spark', 14);
  shake = Math.min(1, shake + 0.15);
  sfx('metal');
  if (L.hp > 0) return;
  L.destroyed = true;
  L.lamp.material.color.setRGB(0.02, 0.02, 0.02); L.light.intensity = 0;
  L.group.rotation.z = 0.05;
  for (let i = 0; i < 4; i++) fx.burst(new THREE.Vector3(L.x, L.h * 0.6, L.z), 'spark', 30);
  // its fluids out across the floor: the pumps' hydraulic oil (a lot), the generator's (a little)
  spill.add(L.x, L.z, L.kind === 'pumps' ? 2.4 : 1.4, 0, 0, L.kind === 'pumps' ? 3 : 1.2);
  damage.scorch(L.x, L.z, 2.8);
  shake = 1.4; hitStop = 0.08;
  sfx('boom');
  if (lab.locks.every((o) => o.destroyed) && lab.door) { lab.door.unlocked = true; hud.notice('THE DOOR IS OPEN'); sfx('door'); }
}
function updateGoal(dt) {
  for (const L of lab.locks) {
    if (L.destroyed) continue;
    L.light.intensity = 10 + Math.sin(time * 6) * 6;
    L.pistons.forEach((r, i) => { r.position.y = 2.0 + Math.sin(time * 3.2 + i * 2.1) * 0.28; });
  }
  const D = lab.door;
  if (!D) return;
  for (const m of D.lights) m.material.color.setRGB(D.unlocked ? 0.2 : 5, D.unlocked ? 5 : 0.15, 0.05);
  if (!D.unlocked) return;
  D.open = Math.min(1, D.open + dt / 3);
  // the slab sinks into the floor (lifting it would put it in the camera's face); its top stays as a threshold plate
  D.slab.position.y = -4.15 * D.open * D.open * (3 - 2 * D.open);
  D.out.material.color.setRGB(3.2 * D.open, 3.0 * D.open, 2.6 * D.open);
  D.sun.intensity = 1600 * D.open;
  if (D.open > 0.6 && !D.solid.open) { D.solid.open = true; lab.clearHeight(D.x - D.w / 2, D.x + D.w / 2, D.z - 0.5, D.z + 0.5); }
  if (D.solid.open && !state.over && Math.abs(spider.pos.x - D.x) < D.w / 2 && spider.pos.z < D.z + 0.3) {
    state.over = true; hud.end('ESCAPED'); sfx('door');
  }
}

// footprints: a foot that steps in a pool soaks some up and prints it on the next few steps (spill.js)
const feetWet = new Map();
const _shotDir = new THREE.Vector3(), _shotFar = new THREE.Vector3();
function footprint(e) {
  if (e.pos.y > 0.25) return; // (on a bench or a wall top: the spill only covers the floor)
  const key = e.k * 2 + (e.s > 0 ? 1 : 0), w = feetWet.get(key) || [0, 0], [b, i] = spill.wetAt(e.pos.x, e.pos.z);
  if (b > 0.12 || i > 0.12) { w[0] = Math.min(1, w[0] + (b > 0.12 ? 0.7 : 0)); w[1] = Math.min(1, w[1] + (i > 0.12 ? 0.7 : 0)); }
  else if (w[0] + w[1] > 0.04) { spill.add(e.pos.x, e.pos.z, 0.2, w[0] * 0.2, w[1] * 0.2); w[0] *= 0.8; w[1] *= 0.8; }
  feetWet.set(key, w);
}

// a vat breaks when the spider crashes into it: glass everywhere, and a mutation to choose
function breakVat(b) {
  b.broken = true;
  for (const m of b.parts) m.visible = false;
  b.light.intensity = 2;
  const p = new THREE.Vector3(b.x, 1.2, b.z);
  fx.burst(p, 'spark', 30); fx.burst(p, 'ichor', 24);
  // the vat empties across the floor
  spill.add(b.x, b.z, 1.8, 0, 4);
  damage.shards(b.x, 0.35, b.z, 45, _shotDir.set(b.x - spider.pos.x, 0, b.z - spider.pos.z).normalize());
  for (let i = 0; i < 5; i++) { const a = Math.random() * 6.28, r = 1 + Math.random() * 1.2; spill.add(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r, 0.5 + Math.random() * 0.4, 0, 0.6); }
  shake = Math.min(1, shake + 0.5);
  sfx('glass');
  const offer = mutations.offer(3);
  if (offer.length) {
    choosing = offer;
    hud.choose(offer.map((id) => ({ id, ...MUTATIONS[id], slotName: SLOT_NAMES[MUTATIONS[id].slot], key: SLOT_KEYS[MUTATIONS[id].slot] })), pick);
  } else state.hp = Math.min(100, state.hp + 40); // every slot filled: (improvements to come) a heal for now
}

// main loop (fixed 60 Hz steps when shooting, so captures are repeatable)
let last = performance.now(), time = 0, hitStop = 0, feedT = 0;
function frame(now) {
  const real = clamp((now - last) / 1000, 0, 1 / 20);
  last = now;
  // hit-stop: a few frames of near-freeze on every strike, so it lands; and nothing moves while choosing
  let dt = SHOT ? 1 / 60 : real;
  if (hitStop > 0) { hitStop -= dt; dt *= 0.06; }
  if (choosing && Q.has('auto')) pick(0); // (the autopilot takes the first offer)
  if (choosing) dt = 0;
  ray.setFromCamera(mouse, camera); ray.ray.intersectPlane(floorPlane, aim);
  if (dt > 0) {
    time += dt;
    spider.update(dt, readInput());
    if (clip) measureClip();
    if (people && !state.over) {
      // feeding: hold F over a corpse (fast heal, no attacks); otherwise the slash, automatically
      const mouth = new THREE.Vector3(0, 0, 1.8).applyMatrix4(spider.root.matrixWorld);
      const meal = keys.has('KeyF') ? people.corpse(mouth.x, mouth.z, 3.2) : null;
      spider.feeding = !!meal;
      if (meal) {
        feedT += dt; state.hp = Math.min(100, state.hp + 30 * dt);
        if (feedT > 1.6) { people.consume(meal); feedT = 0; }
      } else { feedT = 0; spider.autoSlash(people, { targets: lockTargets }); }
      mutations.update(dt, ctx);
    }
    for (const e of spider.events) {
      if (e.type === 'step') { shake = Math.min(0.6, shake + 0.06); sfx('step', 0.6); footprint(e); }
      if (e.type === 'slash') { shake = Math.min(1, shake + 0.22); hitStop = 0.035; sfx('slash'); }
      if (e.type === 'impale') { shake = Math.min(1, shake + 0.4); hitStop = 0.06; sfx('slash'); sfx('squelch'); state.log.push(['impale', +time.toFixed(2)]); }
      if (e.type === 'eat') { state.hp = Math.min(100, state.hp + 30); sfx('squelch'); }
      if (e.type === 'land' && people) { // the pounce comes down: everyone close is hit and stunned
        shake = 1.2; hitStop = 0.05; sfx('land');
        fx.burst(e.pos.clone().setY(0.2), 'spark', 20);
        for (const h of people.list) {
          if (people.alive(h) && Math.hypot(h.x - e.pos.x, h.z - e.pos.z) < 3.4) { people.hit(h, 2, new THREE.Vector3(h.x - e.pos.x, 0, h.z - e.pos.z)); people.stun(h, 2.2); }
        }
      }
    }
    for (const b of lab.breakables) if (!b.broken && Math.hypot(spider.pos.x - b.x, spider.pos.z - b.z) < b.r + 1.5) breakVat(b);
    if (people) {
      people.update(dt, time);
      for (const e of people.events) {
        if (e.type === 'shot') {
          const vol = falloff(e.from.x, e.from.z, spider.pos.x, spider.pos.z);
          sfx('shot', vol); sfx('casing', vol * 0.6);
          const dir = _shotDir.subVectors(e.to, e.from).normalize();
          damage.casing(e.from, dir);
          if (e.blocked) damage.hole(e.from, e.to);
          else if (!e.hit) { // a miss flies on, into whatever is behind
            _shotFar.copy(e.to).addScaledVector(dir, 25);
            const t = lab.shotHit(e.to, _shotFar);
            if (t >= 0) damage.hole(e.to, _shotFar.lerpVectors(e.to, _shotFar, t));
          }
        }
        if (e.type === 'shot' && e.hit) fx.burst(new THREE.Vector3(e.to.x, e.to.y, e.to.z), 'ichor', 4, new THREE.Vector3(0, 0.5, 0)); // the spider bleeds its own pink
        if (e.type === 'shot' && e.hit && !state.over && !Q.has('god')) { state.hp -= e.damage; state.hurt = 1; state.lastHurt = time; shake = Math.min(0.8, shake + 0.08); }
      }
      state.kills = people.list.filter((h) => h.state === 'dead' || h.state === 'gone').length;
    }
    updateGoal(dt);
    // slow regeneration while not taking damage
    if (time - (state.lastHurt ?? -9) > 3) state.hp = Math.min(100, state.hp + 2.5 * dt);
    fx.update(dt);
    spill.update(dt);
    damage.update(dt);
  }
  // hurt: a red pulse in the post pass
  state.hurt = Math.max(0, state.hurt - real * 4);
  post.flash.set(0.16 * state.hurt, 0.004 * state.hurt, 0);
  if (state.hp <= 0 && !state.over) { state.over = true; hud.end('SPECIMEN TERMINATED'); }
  hud.set(state.hp, state.kills);
  hud.locks(lab.locks.filter((L) => L.destroyed).length, lab.locks.length, lab.door?.unlocked);
  hud.slots(SLOTS.map((slot) => {
    const id = mutations.have[slot];
    return { slot: SLOT_NAMES[slot], name: id ? MUTATIONS[id].name : null, key: SLOT_KEYS[slot], cd: mutations.cd[slot] || 0, max: id ? MUTATIONS[id].cooldown || 0 : 0 };
  }));
  lab.update(time, spider.pos);
  dust.update(dt, time);
  updateCamera(real, time);
  post.render(scene, camera, time);
  requestAnimationFrame(frame);
}
updateCamera(1, 0);
requestAnimationFrame(frame);

// for tools and the console
window.game = { seed: SEED, spill, damage, spider, lab, people, fx, state, mutations, pick, camera, postParams, CAM, renderer, clip, get time() { return time; } };
