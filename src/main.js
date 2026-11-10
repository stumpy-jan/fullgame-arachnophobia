import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld } from './world/world.js';
import { makeLabLayout } from './world/layout.js';
import { Spider } from './spider.js';
import { Post, postParams } from './post.js';
import { softDot } from './textures.js';
import { damp, clamp } from './util.js';
import { FX } from './fx.js';
import { People } from './people/people.js';
import { Hud } from './hud.js';

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
const lab = buildWorld(scene, makeLabLayout());
const spider = new Spider(scene, lab);
spider.place(lab.spawn.x, lab.spawn.z, lab.spawn.heading);
if (Q.get('at')) { const [x, z, h] = Q.get('at').split(',').map(Number); spider.place(x, z, h || 0); }

// the people (?nopeople: an empty lab), effects, the game's state
const fx = new FX(scene);
const people = Q.has('nopeople') ? null : new People(scene, lab, spider, fx);
const state = { hp: 100, kills: 0, over: false, hurt: 0, log: [] };
const hud = new Hud();

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
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyP') auto = !auto;
  if (e.code === 'Digit1') postParams.on = !postParams.on;
  if (e.code === 'KeyR' && state.over) location.reload();
  if (e.code === 'Space') { e.preventDefault(); strike(); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousedown', (e) => { if (e.button === 0) strike(); });
// the attack: every free leg with someone in reach impales them (spider.strike)
function strike() { if (people && !state.over) spider.strike(people); }
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
  return { x: x / l, z: z / l, sprint };
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

// main loop (fixed 60 Hz steps when shooting, so captures are repeatable)
let last = performance.now(), time = 0, hitStop = 0, autoT = 0;
function frame(now) {
  const real = clamp((now - last) / 1000, 0, 1 / 20);
  last = now;
  const steps = SHOT ? 1 : 1;
  // hit-stop: a few frames of near-freeze on every impale, so it lands
  let dt = SHOT ? 1 / 60 : real;
  if (hitStop > 0) { hitStop -= dt; dt *= 0.06; }
  for (let i = 0; i < steps; i++) {
    time += dt;
    spider.update(dt, readInput());
    if (clip) measureClip();
    for (const e of spider.events) if (e.type === 'step') shake = Math.min(0.6, shake + 0.06);
    if (people && Q.has('autoattack') && (autoT += dt) > 0.3) { autoT = 0; strike(); }
    for (const e of spider.events) {
      if (e.type === 'impale') { shake = Math.min(1, shake + 0.4); hitStop = 0.06; state.log.push(['impale', +time.toFixed(2)]); }
      if (e.type === 'eat') { state.kills++; state.hp = Math.min(100, state.hp + 8); }
    }
    if (people) {
      people.update(dt, time);
      for (const e of people.events) {
        if (e.type === 'shot' && e.hit && !state.over && !Q.has('god')) { state.hp -= e.damage; state.hurt = 1; shake = Math.min(0.8, shake + 0.08); }
      }
    }
    fx.update(dt);
  }
  // hurt: a red pulse in the post pass
  state.hurt = Math.max(0, state.hurt - dt * 4);
  post.flash.set(0.16 * state.hurt, 0.004 * state.hurt, 0);
  if (state.hp <= 0 && !state.over) { state.over = true; hud.end('SPECIMEN TERMINATED'); }
  hud.set(state.hp, state.kills);
  lab.update(time);
  dust.update(dt, time);
  updateCamera(dt, time);
  post.render(scene, camera, time);
  requestAnimationFrame(frame);
}
updateCamera(1, 0);
requestAnimationFrame(frame);

// for tools and the console
window.game = { spider, lab, people, fx, state, camera, postParams, CAM, renderer, clip, get time() { return time; } };
