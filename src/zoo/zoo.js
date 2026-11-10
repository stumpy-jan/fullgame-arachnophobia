import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Post } from '../post.js';
import { floorMaterial, floorGeometry } from '../world/floors.js';
import { Bodies } from '../people/bodies.js';
import { sculpted, operator, silhouette } from './figures.js';
import { damp } from '../util.js';

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
  { name: 'B. Sculpted', text: 'Procedural, but shaped: tapered limbs, shoulders, a hood, a flared coat, and joints that bend (knees, elbows, pelvis bob, torso twist).', make: sculpted },
  { name: 'C. Operators', text: 'Abstract: no arms or legs, a hooded silhouette that glides; an oversized floating rifle with a laser sight and a torch cone; scientists carry a glowing tablet.', make: operator },
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

// the actors: per stage, [scientist running, soldier running, soldier aiming]
const bodies = new Bodies(scene, 8);
const actors = [];
STAGES.forEach((st, i) => {
  for (const [type, mode, k] of [['scientist', 'run', 0], ['soldier', 'run', 1], ['soldier', 'aim', 2]]) {
    const a = { stage: i, type, mode, k, x: i * GAP, z: 0, heading: 0, phase: k * 2, stride: 0, aim: 0, lean: 0, fall: 0, tilt: 0, flail: false, y: 0 };
    if (st.make) { a.fig = st.make(type); scene.add(a.fig.group); }
    actors.push(a);
  }
});

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.3, 300);
let stage = +(Q.get('stage') || 0), view = Q.get('view') === 'close' ? 'close' : 'game';
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
      const r = 2.6, w = (a.type === 'scientist' ? 1.8 : 1.4) / r, ang = time * w + a.k * Math.PI;
      a.x = cx + Math.cos(ang) * r; a.z = Math.sin(ang) * r; a.heading = Math.atan2(-Math.sin(ang), Math.cos(ang));
      a.stride = 1; a.phase += w * r * 3.1 * dt; a.lean = a.type === 'scientist' ? 0.28 : 0.15; a.aim = 0;
    } else {
      a.x = cx + 0.0; a.z = 0; a.heading = Math.sin(time * 0.5) * 1.2; a.stride = 0; a.lean = 0.08;
      a.aim = damp(a.aim, Math.sin(time * 0.7) > -0.3 ? 1 : 0, 6, dt);
    }
    if (a.fig) { a.fig.group.position.set(a.x, 0, a.z); a.fig.group.rotation.y = a.heading; a.fig.update(time, dt, a); }
  }
  bodies.begin();
  for (const a of actors) if (!a.fig) bodies.add(a);
  bodies.end();
  beacon.target.position.set(GAP * 1.5 + Math.cos(time * 1.6) * 30, 0, Math.sin(time * 1.6) * 6);

  // camera
  const sx = stage * GAP;
  const want = view === 'game' ? [sx, 34, 17] : [sx, 7.5, 9.5];
  const look = view === 'game' ? [sx, 0, 0] : [sx, 0.6, -0.4];
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
