import * as THREE from 'three';
import { makeCanvas, canvasTexture } from './util.js';

// Battle damage that accumulates over a run (Design/DESIGN.md "Look and feel"), all instanced, ring buffers:
//   hole(a, b)          a bullet stopped between a and b: a chipped hole where it meets concrete (found by
//                       marching the shot through the world's height field, so it sits on the real surface of a
//                       chamfered wall, not its bounding box), facing the open side
//   casing(from, dir)   a spent brass casing flicked out to the right of a rifle; it bounces and stays
//   shards(x, y, z, n, push)  glass flying out of a smashed vat; scatter(x, z, n, r): glass already lying there
//   scorch(x, z, r)     soot burnt into the floor where something blew up
export class Damage {
  constructor(scene, world) {
    this.world = world;
    const decal = (map, n, opts = {}) => {
      const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
        map, transparent: true, depthWrite: false, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, ...opts,
      }), n);
      m.count = 0; m.frustumCulled = false; m.receiveShadow = true; scene.add(m);
      return { m, n, next: 0 };
    };
    this.holes = decal(holeTexture(), 700);
    this.scorches = decal(sootTexture(), 24, { roughness: 1 });

    // casings: brass, a little oversized so they catch the light from up where the camera is
    this.cas = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 6), new THREE.MeshStandardMaterial({ color: 0xc8962e, roughness: 0.3, metalness: 0.9 }), 900);
    this.cas.count = 0; this.cas.frustumCulled = false; scene.add(this.cas);
    this.casData = []; this.casNext = 0;
    // glass: thin triangles, nearly clear, glinting
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.35, 0.5, 0, -0.2, 0.05, 0, 0.55], 3));
    tri.computeVertexNormals();
    this.glass = new THREE.InstancedMesh(tri, new THREE.MeshStandardMaterial({ color: 0xd6eef4, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.55, side: THREE.DoubleSide, envMapIntensity: 2 }), 600);
    this.glass.count = 0; this.glass.frustumCulled = false; scene.add(this.glass);
    this.glassData = []; this.glassNext = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  // a decal: position, normal, size
  put(D, p, n, size) {
    const i = D.next; D.next = (i + 1) % D.n; D.m.count = Math.max(D.m.count, i + 1);
    this._q.setFromUnitVectors(Z, n);
    this._q.multiply(_roll.setFromAxisAngle(Z, Math.random() * 6.28));
    this._m.compose(this._p.copy(p).addScaledVector(n, 0.012), this._q, this._s.set(size, size, 1));
    D.m.setMatrixAt(i, this._m); D.m.instanceMatrix.needsUpdate = true;
  }

  hole(a, b) {
    // march from a little before b to a little past it: the first spot under the surface of whatever's there
    const dir = _d.subVectors(b, a); const len = dir.length(); if (len < 1e-3) return false; dir.divideScalar(len);
    const p = _p0.copy(b).addScaledVector(dir, -0.8), H = this.world.heightAt;
    for (let s = 0; s < 50; s++) {
      if (H(p.x, p.z) > p.y) {
        p.addScaledVector(dir, -0.03);
        // the open side: where the height field drops below the hole's height
        const n = _n.set(0, 0, 0), e = 0.15;
        if (H(p.x + e, p.z) < p.y) n.x += 1; if (H(p.x - e, p.z) < p.y) n.x -= 1;
        if (H(p.x, p.z + e) < p.y) n.z += 1; if (H(p.x, p.z - e) < p.y) n.z -= 1;
        if (n.lengthSq() === 0) n.set(-dir.x, 0, -dir.z);
        if (p.y < 0.05) n.set(0, 1, 0);
        this.put(this.holes, p, n.normalize(), 0.09 + Math.random() * 0.07);
        return true;
      }
      p.addScaledVector(dir, 0.05);
    }
    return false;
  }

  scorch(x, z, r) { this.put(this.scorches, _p0.set(x, 0.01, z), _n.set(0, 1, 0), r * 2); }

  casing(from, dir) {
    const right = _r.set(dir.z, 0, -dir.x).normalize();
    const i = this.casNext; this.casNext = (i + 1) % this.cas.instanceMatrix.count;
    this.cas.count = Math.max(this.cas.count, i + 1);
    const c = this.casData[i] || (this.casData[i] = { p: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, tum: 0, w: 0, rest: false, bounces: 0 });
    c.p.copy(from).addScaledVector(dir, -0.35);
    c.v.copy(right).multiplyScalar(1.4 + Math.random() * 1.2).addScaledVector(dir, -0.4 + Math.random() * 0.3); c.v.y = 1.4 + Math.random() * 1.2;
    c.yaw = Math.random() * 6.28; c.tum = 0; c.w = 18 + Math.random() * 14; c.rest = false; c.bounces = 0;
  }

  shards(x, y0, z, n, push) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.28, y = y0 + Math.random() * 1.6;
      const g = this.newGlass();
      g.p.set(x + Math.cos(a) * 0.75, y, z + Math.sin(a) * 0.75);
      const sp = 1.5 + Math.random() * 3;
      g.v.set(Math.cos(a) * sp + (push?.x || 0) * 2, 0.5 + Math.random() * 2.5, Math.sin(a) * sp + (push?.z || 0) * 2);
      g.rest = false;
    }
  }
  scatter(x, z, n, r) { // glass already on the floor (the start bay's smashed tank)
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.28, d = r * Math.sqrt(Math.random());
      const g = this.newGlass(); g.p.set(x + Math.cos(a) * d, this.world.heightAt(x + Math.cos(a) * d, z + Math.sin(a) * d) + 0.005, z + Math.sin(a) * d); g.rest = true; g.dirty = true;
    }
  }
  newGlass() {
    const i = this.glassNext; this.glassNext = (i + 1) % this.glass.instanceMatrix.count;
    this.glass.count = Math.max(this.glass.count, i + 1);
    const g = this.glassData[i] || (this.glassData[i] = { i, p: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, s: 1, tilt: 0, spin: 0, rest: false });
    g.yaw = Math.random() * 6.28; g.s = 0.06 + Math.random() * 0.13; g.tilt = (Math.random() - 0.5) * 0.3; g.spin = Math.random() * 6.28;
    return g;
  }

  update(dt) {
    const H = this.world.heightAt, m = this._m, q = this._q;
    let any = false;
    for (let i = 0; i < this.casData.length; i++) {
      const c = this.casData[i];
      if (!c || c.rest) continue;
      any = true;
      c.v.y -= 9.8 * dt; c.p.addScaledVector(c.v, dt); c.tum += c.w * dt;
      const floor = H(c.p.x, c.p.z) + 0.009;
      if (c.p.y < floor) {
        c.p.y = floor; c.v.y *= -0.35; c.v.x *= 0.5; c.v.z *= 0.5; c.w *= 0.5; c.bounces++;
        if (c.bounces > 2 || Math.abs(c.v.y) < 0.3) { c.rest = true; c.tum = Math.PI / 2; }
      }
      this._e.set(c.rest ? Math.PI / 2 : c.tum, c.yaw, 0, 'YXZ');
      m.compose(c.p, q.setFromEuler(this._e), this._s.set(1, 1, 1));
      this.cas.setMatrixAt(i, m);
    }
    if (any) this.cas.instanceMatrix.needsUpdate = true;
    any = false;
    for (const g of this.glassData) {
      if (!g || (g.rest && !g.dirty)) continue;
      any = true; g.dirty = false;
      if (!g.rest) {
        g.v.y -= 9.8 * dt; g.p.addScaledVector(g.v, dt); g.spin += dt * 9;
        const floor = H(g.p.x, g.p.z) + 0.005;
        if (g.p.y < floor) { g.p.y = floor; if (g.v.y < -1) { g.v.y *= -0.2; g.v.x *= 0.4; g.v.z *= 0.4; } else g.rest = true; }
      }
      this._e.set(g.rest ? g.tilt : g.spin, g.yaw, g.rest ? g.tilt * 0.5 : g.spin * 0.7, 'YXZ');
      m.compose(g.p, q.setFromEuler(this._e), this._s.set(g.s, g.s, g.s));
      this.glass.setMatrixAt(g.i, m);
    }
    if (any) this.glass.instanceMatrix.needsUpdate = true;
  }
}

const Z = new THREE.Vector3(0, 0, 1), _roll = new THREE.Quaternion();
const _d = new THREE.Vector3(), _p0 = new THREE.Vector3(), _n = new THREE.Vector3(), _r = new THREE.Vector3();

// a bullet hole in concrete: a dark pit, a ragged chipped crater round it (lighter: fresh concrete), dust
function holeTexture() {
  const S = 128, [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  // a few random bumps round the rim (not petals): the chips that came off
  const bumps = Array.from({ length: 7 }, () => [Math.random() * 6.28, 0.08 + Math.random() * 0.14, 0.25 + Math.random() * 0.5]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2), r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    let edge = 0.42;
    for (const [ba, amp, w] of bumps) { const da = Math.atan2(Math.sin(a - ba), Math.cos(a - ba)); edge += amp * Math.exp(-(da * da) / (w * w * 0.2)); }
    const n = Math.random();
    let v = 0, al = 0;
    if (r < 0.13) { v = 0.03; al = 1; }                                        // the pit
    else if (r < 0.22) { v = 0.14 + 0.06 * n; al = 1; }                        // its throat
    else if (r < edge) { v = 0.42 + 0.16 * n; al = 0.8 * (1 - 0.3 * (r / edge)); } // chipped concrete, a little paler
    else if (r < edge + 0.35) { v = 0.12; al = 0.45 * (1 - (r - edge) / 0.35) * (0.6 + 0.4 * n); } // soot and dust
    const o = (y * S + x) * 4;
    img.data[o] = img.data[o + 1] = v * 235; img.data[o + 2] = v * 228; img.data[o + 3] = al * 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c, { repeat: false });
}
// soot: a black burn, ragged, darkest in the middle
function sootTexture() {
  const S = 256, [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2), r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const edge = 0.75 + 0.12 * Math.sin(a * 4 + 2) + 0.07 * Math.sin(a * 9) + 0.05 * Math.sin(a * 23 + 1);
    const al = Math.max(0, 1 - Math.pow(r / edge, 2.2)) * (0.75 + 0.25 * Math.sin(x * 0.7) * Math.sin(y * 0.9));
    const o = (y * S + x) * 4;
    img.data[o] = 14; img.data[o + 1] = 12; img.data[o + 2] = 11; img.data[o + 3] = Math.min(255, al * 255);
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c, { repeat: false });
}
