import * as THREE from 'three';
import { softDot } from './textures.js';
import { splat } from './world/geom.js';

// Effects shared by everything that shoots, bleeds or breaks: pooled, a handful of draw calls.
//   tracer(a, b)            a bright streak from a to b, gone in a few frames
//   flash(p)                a muzzle flash
//   burst(p, kind, n, dir)  particles: 'spark' (bullets on concrete), 'ichor' (the spider hit), 'blood'
//   stain(x, z, size)       a blood pool on the floor (into the spill, when there is one: spill.js)
export class FX {
  constructor(scene) {
    this.scene = scene;
    // tracers: thin boxes, additive, HDR-bright so the bloom picks them up
    const TR = 64;
    this.tr = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true }), TR);
    this.tr.frustumCulled = false;
    this.tr.count = TR;
    this.trLife = new Float32Array(TR); this.trA = []; this.trB = [];
    for (let i = 0; i < TR; i++) { this.trA.push(new THREE.Vector3()); this.trB.push(new THREE.Vector3()); this.tr.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); this.tr.setColorAt(i, new THREE.Color(0, 0, 0)); }
    this.trNext = 0;
    scene.add(this.tr);

    // particles: one Points cloud per blend mode
    this.parts = {};
    const dot = softDot();
    for (const [kind, blending] of [['add', THREE.AdditiveBlending], ['norm', THREE.NormalBlending]]) {
      const N = 900;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: kind === 'add' ? 0.16 : 0.2, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending }));
      pts.frustumCulled = false;
      scene.add(pts);
      this.parts[kind] = { pts, N, next: 0, life: new Float32Array(N), vel: new Float32Array(N * 3), col: new Float32Array(N * 3), grav: new Float32Array(N), wet: new Uint8Array(N) };
    }
    // stains on the floor
    this.stainMat = new THREE.MeshStandardMaterial({ color: 0x1e0303, roughness: 0.68, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, transparent: true, opacity: 0.92 });
    this.stains = [];
    this.R = Math.random;
  }

  tracer(a, b, color = [7, 5, 2]) {
    const i = this.trNext; this.trNext = (i + 1) % this.trLife.length;
    this.trA[i].copy(a); this.trB[i].copy(b); this.trLife[i] = 1;
    this.tr.setColorAt(i, new THREE.Color(...color));
  }

  flash(p) { this.burst(p, 'flash', 1); }

  burst(p, kind, n, dir) {
    const spec = {
      spark: ['add', [6, 4, 1.6], 9, 0.25, 9],
      flash: ['add', [12, 8, 3], 0.1, 0.06, 0],
      ichor: ['norm', [0.18, 0.22, 0.05], 5, 0.6, 9],
      blood: ['norm', [0.28, 0.02, 0.02], 4, 0.9, 9],
    }[kind];
    const [mode, c, speed, life, grav] = spec;
    const P = this.parts[mode];
    for (let k = 0; k < n; k++) {
      const i = P.next; P.next = (i + 1) % P.N;
      const pos = P.pts.geometry.attributes.position.array;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      let vx = (this.R() - 0.5) * 2, vy = this.R() * 1.2, vz = (this.R() - 0.5) * 2;
      if (dir) { vx += dir.x * 1.5; vy += dir.y * 1.5; vz += dir.z * 1.5; }
      const s = speed * (0.4 + this.R() * 0.6);
      P.vel[i * 3] = vx * s; P.vel[i * 3 + 1] = vy * s; P.vel[i * 3 + 2] = vz * s;
      P.col[i * 3] = c[0]; P.col[i * 3 + 1] = c[1]; P.col[i * 3 + 2] = c[2];
      P.life[i] = life * (0.6 + this.R() * 0.4);
      P.grav[i] = grav;
      P.wet[i] = kind === 'blood' ? 1 : kind === 'ichor' ? 2 : 0; // (lands as a drop in the spill)
    }
  }

  stain(x, z, size = 1) {
    if (this.spill) { this.spill.add(x, z, 0.6 * size, 0.35 * size); return; } // (a pool in the spill)
    const m = new THREE.Mesh(splat(this.R, 1, 0.45), this.stainMat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = this.R() * 6;
    m.position.set(x, 0.008, z);
    m.scale.setScalar(0.01);
    m.userData.size = size * (0.7 + this.R() * 0.5); m.userData.t = 0;
    this.scene.add(m);
    this.stains.push(m);
    if (this.stains.length > 120) { const old = this.stains.shift(); this.scene.remove(old); old.geometry.dispose(); }
  }

  update(dt) {
    // tracers: stretch from a to b, fade over ~70 ms
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), d = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), S = new THREE.Vector3();
    for (let i = 0; i < this.trLife.length; i++) {
      if (this.trLife[i] <= 0) continue;
      this.trLife[i] -= dt / 0.07;
      const L = d.subVectors(this.trB[i], this.trA[i]).length();
      if (this.trLife[i] <= 0 || L < 1e-3) { this.tr.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      q.setFromUnitVectors(Z, d.divideScalar(L));
      const w = 0.035 + 0.03 * this.trLife[i];
      m.compose(this.trA[i], q, S.set(w, w, L));
      this.tr.setMatrixAt(i, m);
    }
    this.tr.instanceMatrix.needsUpdate = true;
    if (this.tr.instanceColor) this.tr.instanceColor.needsUpdate = true;
    // particles
    for (const P of Object.values(this.parts)) {
      const pos = P.pts.geometry.attributes.position.array, col = P.pts.geometry.attributes.color.array;
      for (let i = 0; i < P.N; i++) {
        if (P.life[i] <= 0) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; if (P.pts.material.blending === THREE.NormalBlending) pos[i * 3 + 1] = -50; continue; }
        P.life[i] -= dt;
        P.vel[i * 3 + 1] -= P.grav[i] * dt;
        pos[i * 3] += P.vel[i * 3] * dt; pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.02) {
          if (P.wet[i] && this.spill) { const a = 0.025 + Math.random() * 0.04; this.spill.add(pos[i * 3], pos[i * 3 + 2], 0.06 + Math.random() * 0.1, P.wet[i] === 1 ? a : 0, P.wet[i] === 2 ? a : 0); P.wet[i] = 0; }
          pos[i * 3 + 1] = 0.02; P.vel[i * 3] *= 0.3; P.vel[i * 3 + 1] = 0; P.vel[i * 3 + 2] *= 0.3; }
        const f = Math.min(1, P.life[i] * 6);
        col[i * 3] = P.col[i * 3] * f; col[i * 3 + 1] = P.col[i * 3 + 1] * f; col[i * 3 + 2] = P.col[i * 3 + 2] * f;
      }
      P.pts.geometry.attributes.position.needsUpdate = true;
      P.pts.geometry.attributes.color.needsUpdate = true;
    }
    // stains spread out over a second or two
    for (const s of this.stains) {
      if (s.userData.t >= 1) continue;
      s.userData.t = Math.min(1, s.userData.t + dt / 1.8);
      s.scale.setScalar(s.userData.size * (1 - (1 - s.userData.t) ** 3));
    }
  }
}
