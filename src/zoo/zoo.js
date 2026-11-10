import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Post } from '../post.js';
import { floorMaterial, floorGeometry } from '../world/floors.js';
import { Bodies } from '../people/bodies.js';
import { operator, silhouette } from './figures.js';
import { sculpted } from '../people/sculpted.js';
import { damp } from '../util.js';
import { loadModels, model, FIT } from '../world/models.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// The zoo: one approach to drawing the people per stage, side by side, in the game's own lighting and post
// pass, seen from the gameplay camera (V: or close up; O: orbit). Each stage: a scientist running, a
// soldier running, a soldier aiming. ?stage=n&view=close for captures.
const Q = new URLSearchParams(location.search);
const SHOT = Q.has('shot');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: SHOT });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020304);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.12;
scene.fog = new THREE.FogExp2(0x030506, 0.012);
scene.add(new THREE.HemisphereLight(0x7a93a8, 0x0d0d0f, 0.22));

const STAGES = [
  { name: 'A. Current', text: 'Capsules and spheres, instanced. Cheap, but the stiff limbs read as dolls.', make: null },
  { name: 'B. Sculpted', text: 'Procedural, sculpted (pass 2): proportions, lab coats with a swinging tail and collar, hair and skin variety, hazmat suits with respirator, tank and hose, a proper rifle; a run with folding knees, hip and shoulder twist, glances back; an aiming stance with recoil, laser sight and torch; hands; a flail when grabbed, a death fall, typing and looking round.', make: sculpted },
  { name: 'C. Operators', text: 'Abstract: no arms or legs, a hooded silhouette that glides; an oversized floating rifle with a laser sight and a torch cone; scientists carry a glowing tablet.', make: operator },
  { name: 'E. AI props', text: 'Left: the procedural stand-ins in the game today. Right: the same things from the team’s Modal pipeline (Qwen image, Pixal3D mesh), cut to budget with gltfpack, KTX2 textures. In front (?view=gear, ?turn=heading): the soldier gear tried on, procedural (left) and the AI hood, tank and rifle (right).', props: true },
  { name: 'D. Lights', text: 'Near-black silhouettes in the dark lab, read by what they emit: amber visor slits and torch cones (soldiers), reflective coat stripes (scientists).', make: silhouette },
];
const GAP = 14;
const label = document.getElementById('label');

// floor and a lamp over each stage
scene.add(new THREE.Mesh(floorGeometry(-10, -12, STAGES.length * GAP + 4, 12), floorMaterial('containment')));
scene.children.at(-1).receiveShadow = true;
STAGES.forEach((st, i) => {
  const x = i * GAP;
  const l = new THREE.SpotLight(0xffe8cc, 700, 0, 0.72, 0.65, 2);
  l.position.set(x, 9.9, 0); l.target.position.set(x, 0, 0); l.castShadow = true; l.shadow.mapSize.set(1024, 1024);
  scene.add(l, l.target);
});
// a red beacon sweeping across all of them, as in the lab
const beacon = new THREE.SpotLight(0xff2010, 300, 40, 0.5, 0.5, 2);
beacon.position.set(GAP * 1.5, 4, -9); scene.add(beacon, beacon.target);

// the generated models first: the props stage shows them and the sculpted soldiers wear the AI gear
await loadModels(renderer, Object.keys(FIT));

// the actors: per stage, [scientist running, soldier running, soldier aiming]
const bodies = new Bodies(scene, 8);
const actors = [];
STAGES.forEach((st, i) => {
  if (st.props) return;
  for (const [type, mode, k] of [['scientist', 'run', 0], ['soldier', 'run', 1], ['soldier', 'aim', 2], ['scientist', 'run', 3], ['scientist', 'idle', 4], ['scientist', 'grabbed', 5], ['soldier', 'die', 6], ['scientist', 'type', 7]]) {
    const a = { stage: i, type, mode, k, x: i * GAP, z: 0, heading: 0, phase: k * 2, stride: 0, aim: 0, lean: 0, fall: 0, tilt: 0, flail: false, y: 0 };
    a.fireT = 9; a.shot = 0; a.panic = 0;
    if (st.make) { a.fig = st.make(type, { seed: i * 10 + k + 1 }); scene.add(a.fig.group); }
    actors.push(a);
  }
});

// the props stage: stand-ins (left) and generated models (right), the same objects in the same order
STAGES.forEach((st, i) => {
  if (!st.props) return;
  const x = i * GAP, grey = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3 });
  const stand = [
    ['centrifuge', new THREE.CylinderGeometry(0.45, 0.45, 1.1, 24), 0xd8d8d4, 0.55],
    ['hazmat_locker', new RoundedBoxGeometry(1.0, 1.9, 0.6, 2, 0.04), 0xc39222, 0.95],
    ['lab_trolley', new RoundedBoxGeometry(0.9, 0.9, 0.55, 2, 0.03), 0x9aa3a8, 0.45],
    ['generator', new RoundedBoxGeometry(2.8, 1.5, 1.2, 2, 0.04), 0x40464b, 0.75],
  ];
  stand.forEach(([name, geo, col, hh], k) => {
    const z = -3.3 + k * 2.2;
    const b = new THREE.Mesh(geo, grey(col)); b.position.set(x - 2.2, hh, z); b.castShadow = b.receiveShadow = true; scene.add(b);
    const m = model(name); if (m) { m.position.set(x + 2.2, 0, z); m.rotation.y = -0.5; scene.add(m); }
  });
  for (const [name, dx] of [['hazmat_hood', -0.9], ['rifle', 0.1], ['air_tank', 1.1]]) { const m = model(name); if (m) { m.position.set(x + dx, 0.6, 4.6); m.rotation.y = -0.6; scene.add(m); } }
  // the soldier gear, before and after: the procedural hood, tank and rifle (left), the AI ones (right), aiming
  for (const [dx, gear] of [[-1, false], [1, true]]) {
    const fig = sculpted('soldier', { seed: 3, gear });
    fig.group.position.set(x + dx, 0, 5.6); fig.group.rotation.y = +(Q.get('turn') || 1.25); // (?turn=: the try-on's heading)
    fig.update(0, 0, { phase: 0, aim: 1 });
    scene.add(fig.group);
  }
});

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.3, 300);
let stage = +(Q.get('stage') || 0), view = ['close', 'gear'].includes(Q.get('view')) ? Q.get('view') : 'game'; // (gear: the soldier gear try-on, props stage)
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enabled = false;
addEventListener('keydown', (e) => {
  if (e.code === 'ArrowRight') stage = Math.min(STAGES.length - 1, stage + 1);
  if (e.code === 'ArrowLeft') stage = Math.max(0, stage - 1);
  if (e.code === 'KeyV') view = view === 'game' ? 'close' : 'game';
  if (e.code === 'KeyO') orbit.enabled = !orbit.enabled;
});
const post = new Post(renderer);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post.resize(); });
const camPos = new THREE.Vector3(0, 34, 17), camLook = new THREE.Vector3();

let time = 0, last = performance.now();
function frame(now) {
  const dt = SHOT ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
  last = now; time += dt;
  // actors: runners circle the stage's centre, the aimer turns slowly, raising and lowering the rifle
  for (const a of actors) {
    const cx = a.stage * GAP;
    if (a.mode === 'run') {
      const r = a.k === 3 ? 3.8 : 2.6, w = (a.type === 'scientist' ? 1.8 : 1.4) / r, ang = time * w + a.k * Math.PI * 0.7;
      a.x = cx + Math.cos(ang) * r; a.z = Math.sin(ang) * r; a.heading = Math.atan2(-Math.sin(ang), Math.cos(ang));
      a.stride = 1; a.phase += w * r * 3.1 * dt; a.lean = a.type === 'scientist' ? 0.28 : 0.15; a.aim = 0; a.panic = a.type === 'scientist' ? 1 : 0;
    } else if (a.mode === 'grabbed') {
      // held up in the air (where the spider's leg would have them), thrashing
      a.x = cx - 3.2; a.z = -2.4; a.heading = time * 1.5; a.stride = 0; a.flail = 1; a.lean = 0;
      if (a.fig) a.fig.group.position.y = 1.6 + Math.sin(time * 3) * 0.15;
    } else if (a.mode === 'die') {
      // dies, lies a moment, and gets up to do it again
      const c = (time % 3.2) / 3.2;
      a.x = cx - 3.4; a.z = 2.4; a.heading = 0.6; a.stride = 0; a.aim = 0;
      a.fall = c < 0.15 ? 0 : Math.min(1, (c - 0.15) / 0.12) ** 2 * (c > 0.9 ? 1 - (c - 0.9) / 0.1 : 1);
    } else if (a.mode === 'type') {
      a.x = cx + 0.4; a.z = -3.6; a.heading = Math.PI; a.stride = 0; a.idle = 'type';
    } else if (a.mode === 'idle') {
      a.idle = 'look';
      a.x = cx + 2.4; a.z = -2.2; a.heading = 2.4 + Math.sin(time * 0.4) * 0.6; a.stride = 0; a.lean = 0.02;
    } else {
      a.x = cx + 0.0; a.z = 0; a.heading = Math.sin(time * 0.5) * 1.2; a.stride = 0; a.lean = 0.08;
      a.aim = damp(a.aim, Math.sin(time * 0.7) > -0.3 ? 1 : 0, 6, dt);
      // bursts of four while aimed
      a.fireT += dt; a.shot -= dt;
      if (a.aim > 0.9 && a.shot <= 0) { a.fireT = 0; a.burst = (a.burst || 0) + 1; a.shot = a.burst % 4 ? 0.11 : 0.9; }
    }
    if (a.fig) { a.fig.group.position.set(a.x, a.mode === 'grabbed' ? a.fig.group.position.y : 0, a.z); a.fig.group.rotation.y = a.heading; a.fig.update(time, dt, a); }
  }
  bodies.begin();
  for (const a of actors) if (!a.fig) bodies.add(a);
  bodies.end();
  beacon.target.position.set(GAP * 1.5 + Math.cos(time * 1.6) * 30, 0, Math.sin(time * 1.6) * 6);

  // camera
  const sx = stage * GAP;
  const want = view === 'game' ? [sx, 34, 17] : view === 'gear' ? [sx + 2.2, 2.6, 7.6] : [sx, 7.5, 9.5];
  const look = view === 'game' ? [sx, 0, 0] : view === 'gear' ? [sx + 0.9, 1.9, 5.6] : [sx, 0.6, -0.4];
  if (!orbit.enabled) {
    const k = SHOT ? 1 : 1 - Math.exp(-6 * dt);
    camPos.lerp(new THREE.Vector3(...want), k); camLook.lerp(new THREE.Vector3(...look), k);
    camera.position.copy(camPos); camera.lookAt(camLook); orbit.target.copy(camLook);
  } else orbit.update();
  label.innerHTML = `<b>${STAGES[stage].name}</b> <span style="opacity:.6">(${view === 'game' ? 'gameplay camera' : 'close up'})</span><br>${STAGES[stage].text}`;
  post.render(scene, camera, time);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.game = { get time() { return time; } }; // (for tools/shot.mjs)
