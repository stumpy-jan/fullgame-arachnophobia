import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Generated models (assets/pilot -> public/models/props/<name>.glb: KTX2 textures, meshopt geometry).
// loadModels() before building anything that uses them; model(name) hands out a clone, fitted to its
// real size (FIT: metres along one axis), standing on the floor at the origin, facing +z.
export const FIT = {
  centrifuge: ['y', 1.1], hazmat_locker: ['y', 1.9], lab_trolley: ['y', 0.9], generator: ['max', 2.8],
  hazmat_hood: ['y', 0.34], rifle: ['max', 0.9],
  spider_thorax: ['max', 1.7], spider_abdomen: ['max', 2.1],
};

let loader = null;
function getLoader(renderer) {
  if (loader) return loader;
  const ktx2 = new KTX2Loader().setTranscoderPath('./basis/').detectSupport(renderer);
  loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

const cache = new Map();
export async function loadModels(renderer, names) {
  await Promise.all(names.map((n) => getLoader(renderer).loadAsync(`./models/props/${n}.glb`).then((g) => cache.set(n, fit(n, g.scene))).catch((e) => console.warn('model', n, e.message))));
}
export function model(name) { const s = cache.get(name); return s ? s.clone(true) : null; }
export function hasModel(name) { return cache.has(name); }

// scale to its real size, stand it on the floor, centre it
function fit(name, scene) {
  const root = new THREE.Group();
  root.add(scene);
  const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3());
  const [axis, metres] = FIT[name] || ['y', 1];
  const ext = axis === 'max' ? Math.max(size.x, size.y, size.z) : size[axis]; // ('max': the longest side, whichever way it lies)
  const k = metres / (ext || 1);
  scene.scale.setScalar(k);
  box.setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  scene.position.set(-c.x, -box.min.y, -c.z);
  scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  root.userData.size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return root;
}
