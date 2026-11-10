import * as THREE from 'three';
import { TYPES } from './types.js';

// People drawn as procedural figures: capsules and spheres, one InstancedMesh per part for everyone
// (about nine draw calls however many there are), posed in code each frame. No faces: scientists show
// hair and a white coat from above, soldiers a hazmat hood with a dark visor.
//
// Pose, from a person's state: x, y, z, heading; phase (the run cycle), stride (0..1, how hard they run),
// lean; aim (0..1, rifle up); fall (0..1, collapsing face down); tilt (extra pitch, e.g. skewered).

const PARTS = {
  torso: { geo: () => new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), per: 1 },
  coat: { geo: () => new THREE.CylinderGeometry(0.2, 0.31, 0.78, 12, 1, true), per: 1, side: THREE.DoubleSide },
  head: { geo: () => new THREE.SphereGeometry(0.14, 14, 10), per: 1 },
  leg: { geo: () => new THREE.CapsuleGeometry(0.075, 0.7, 3, 8), per: 2 },
  arm: { geo: () => new THREE.CapsuleGeometry(0.058, 0.48, 3, 8), per: 2 },
  tank: { geo: () => new THREE.CapsuleGeometry(0.1, 0.3, 3, 8), per: 1 },
  visor: { geo: () => new THREE.SphereGeometry(1, 12, 8), per: 1, glossy: true },
  gun: { geo: () => new THREE.BoxGeometry(0.07, 0.1, 0.78), per: 1 },
};

const _B = new THREE.Matrix4(), _U = new THREE.Matrix4(), _m = new THREE.Matrix4(), _t = new THREE.Matrix4();
const _c = new THREE.Color();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
// drawn 25% over life size: at this camera height a 1.75 m figure is a thin stick; next to a monster this size nobody minds
export const SCALE = 1.25;

export class Bodies {
  constructor(scene, capacity) {
    this.meshes = {};
    for (const [name, p] of Object.entries(PARTS)) {
      const mat = p.glossy
        ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.3 })
        : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, side: p.side || THREE.FrontSide });
      const m = new THREE.InstancedMesh(p.geo(), mat, capacity * p.per);
      m.castShadow = true; m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      for (let i = 0; i < capacity * p.per; i++) m.setMatrixAt(i, HIDE);
      scene.add(m);
      this.meshes[name] = m;
    }
    this.n = { };
  }

  // per frame: begin, add each person, end
  begin() { for (const k in this.meshes) this.n[k] = 0; }
  end() {
    for (const [k, m] of Object.entries(this.meshes)) {
      m.count = this.n[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  put(part, matrix, color) {
    const m = this.meshes[part], i = this.n[part]++;
    m.setMatrixAt(i, matrix);
    m.setColorAt(i, _c.setHex(color, THREE.SRGBColorSpace));
  }

  add(h) {
    const T = TYPES[h.type], has = (p) => T.parts.includes(p), col = T.colors;
    // the body frame: position, heading, then a fall (pitching forward about the feet) or a tilt
    _B.makeTranslation(h.x, h.y, h.z).multiply(_t.makeRotationY(h.heading)).multiply(_t.makeScale(SCALE, SCALE, SCALE));
    if (h.fall > 0) _B.multiply(_t.makeTranslation(0, 0.17 * h.fall, 0)).multiply(_t.makeRotationX(h.fall * Math.PI * 0.5));
    if (h.tilt) _B.multiply(_t.makeTranslation(0, 0.9, 0)).multiply(_t.makeRotationX(h.tilt)).multiply(_t.makeTranslation(0, -0.9, 0));
    const sw = Math.sin(h.phase) * 0.75 * h.stride;
    // legs from the hips
    for (const s of [-1, 1]) {
      _m.copy(_B).multiply(_t.makeTranslation(0.1 * s, 0.9, 0)).multiply(_t.makeRotationX(sw * s)).multiply(_t.makeTranslation(0, -0.43, 0));
      this.put('leg', _m, col.leg);
    }
    // the upper body leans from the hips
    _U.copy(_B).multiply(_t.makeTranslation(0, 0.9, 0)).multiply(_t.makeRotationX(h.lean));
    _m.copy(_U).multiply(_t.makeTranslation(0, 0.34, 0));
    this.put('torso', _m, col.torso);
    _m.copy(_U).multiply(_t.makeTranslation(0, 0.74, 0.02));
    this.put('head', _m, col.head);
    // arms: swinging opposite the legs, or both forward round the rifle when aiming, or flailing
    for (const s of [-1, 1]) {
      const run = -sw * s * 0.9, aim = -1.35 - (s > 0 ? 0 : 0.15);
      let a = run + (aim - run) * h.aim;
      if (h.flail) a = -2.2 + Math.sin(h.phase * 3 + s) * 0.9;
      _m.copy(_U).multiply(_t.makeTranslation(0.23 * s, 0.56, 0)).multiply(_t.makeRotationX(a)).multiply(_t.makeRotationZ(0.12 * s * (1 - h.aim))).multiply(_t.makeTranslation(0, -0.3, 0));
      this.put('arm', _m, col.arm);
    }
    if (has('coat')) { _m.copy(_U).multiply(_t.makeTranslation(0, 0.02, 0)); this.put('coat', _m, col.coat); }
    if (has('tank')) { _m.copy(_U).multiply(_t.makeTranslation(0, 0.36, -0.22)); this.put('tank', _m, col.tank); }
    if (has('visor')) { _m.copy(_U).multiply(_t.makeTranslation(0, 0.75, 0.1)).multiply(_t.makeScale(0.1, 0.075, 0.07)); this.put('visor', _m, col.visor); }
    if (has('gun')) {
      _m.copy(_U).multiply(_t.makeTranslation(0.14, 0.42 + 0.06 * h.aim, 0.22)).multiply(_t.makeRotationX(0.9 * (1 - h.aim)));
      this.put('gun', _m, col.gun);
    }
  }

  // where a person's rifle muzzle is (world), for tracers
  muzzle(h, out) {
    _U.makeTranslation(h.x, h.y, h.z).multiply(_t.makeRotationY(h.heading)).multiply(_t.makeScale(SCALE, SCALE, SCALE)).multiply(_t.makeTranslation(0, 0.9, 0)).multiply(_t.makeRotationX(h.lean));
    return out.set(0.14, 0.48, 0.62).applyMatrix4(_U);
  }
}
