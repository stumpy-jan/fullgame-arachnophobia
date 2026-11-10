import * as THREE from 'three';

// Effects shared by everything that shoots, bleeds or breaks: pooled, a handful of draw calls, all sized to read
// from the gameplay camera (34 m up).
//   burst(p, kind, n, dir)  particles of a kind (KINDS below): sparks, dust, smoke, blood, mist, fire, ichor ...
//   shot(a, b)              a rifle round: a bright streak racing from a to b and a smoke trail that lingers
//   flash(p)                a muzzle flash (and a little smoke)
//   impact(p, dir)          a round into concrete: sparks, chips and a dust cloud
//   wound(p, dir, k, pink)  a body hit: blood (or the spider's pink) spurting along dir, a red mist; k = how hard
//   swipe(c, yaw, r)        the slash: a pale arc through the air in front of the spider
//   ring(x, z, r, color)    a shockwave on the floor (the pounce landing)
//   stain(x, z, size)       a pool (into the spill, spill.js)
// Drops of blood and ichor that land go into the spill as spatter.
const KINDS = {
  //          blend   colour (linear, HDR)   size from-to   life        speed  grav  drag  alpha  wet
  spark:    ['add',  [6, 4, 1.6],            [0.09, 0.03], [0.2, 0.4],  9,     9,    1,    1,     0],
  flash:    ['add',  [14, 9, 3.5],           [1.1, 1.6],   [0.05, 0.07], 0,    0,    0,    1,     0],
  fire:     ['add',  [7, 2.6, 0.7],          [0.7, 2.4],   [0.3, 0.55], 3.5,   -2,   3,    1,     0],
  dust:     ['norm', [0.42, 0.4, 0.36],      [0.3, 1.8],   [0.9, 1.6],  2.2,   -0.3, 3.5,  0.55,  0],
  chips:    ['norm', [0.3, 0.29, 0.27],      [0.07, 0.05], [0.4, 0.7],  5,     14,   0.5,  1,     0],
  smoke:    ['norm', [0.1, 0.1, 0.1],        [0.8, 3.4],   [1.8, 3],    1.6,   -0.7, 2,    0.6,   0],
  trail:    ['norm', [0.62, 0.62, 0.6],      [0.22, 0.75], [0.55, 0.95], 0.25, -0.25, 2,   0.11,  0],
  blood:    ['norm', [0.42, 0.006, 0.004],   [0.12, 0.08], [0.6, 1.0],  6.5,   13,   0.4,  1,     1],
  mist:     ['norm', [0.36, 0.01, 0.008],    [0.35, 1.3],  [0.35, 0.6], 1.8,   0.5,  4,    0.6,   0],
  ichor:    ['norm', [0.6, 0.05, 0.32],      [0.12, 0.08], [0.6, 1.0],  6,     13,   0.4,  1,     2],
  ichormist:['norm', [0.5, 0.04, 0.28],      [0.35, 1.2],  [0.35, 0.6], 1.8,   0.5,  4,    0.5,   0],
  swipe:    ['add',  [2.2, 1.9, 1.7],        [0.5, 0.25],  [0.12, 0.18], 0,    0,    0,    0.9,   0],
};

class Pool {
  constructor(scene, N, blending) {
    this.N = N; this.next = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.alpha = new Float32Array(N); this.size = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute vec3 color; attribute float alpha, size; uniform float uScale; varying vec3 vC; varying float vA;
        void main() { vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = vA * (1.0 - smoothstep(0.35, 1.0, r)); if (a < 0.004) discard; gl_FragColor = vec4(vC, a); }`,
      transparent: true, depthWrite: false, blending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false;
    scene.add(this.pts);
    // simulation
    this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N);
    this.s0 = new Float32Array(N); this.s1 = new Float32Array(N); this.a0 = new Float32Array(N);
    this.grav = new Float32Array(N); this.drag = new Float32Array(N); this.wet = new Uint8Array(N); this.base = new Float32Array(N * 3);
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.pools = { add: new Pool(scene, 3000, THREE.AdditiveBlending), norm: new Pool(scene, 14000, THREE.NormalBlending) };
    // bullet streaks: thin bright boxes that race along the shot
    const TR = 96;
    this.tr = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), TR);
    this.tr.frustumCulled = false; this.tr.count = TR;
    this.trs = [];
    for (let i = 0; i < TR; i++) { this.trs.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), t: 1, len: 0 }); this.tr.setMatrixAt(i, ZERO); this.tr.setColorAt(i, new THREE.Color(5, 3.6, 1.6)); }
    this.trNext = 0;
    scene.add(this.tr);
    // shockwave rings on the floor
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xd8cfc0, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; scene.add(m); this.rings.push({ m, t: 1, r: 1 });
    }
    this.R = Math.random;
    this.camera = null; // (set by main: the particles' size in pixels depends on it)
  }

  burst(p, kind, n = 8, dir = null, spread = 1) {
    const K = KINDS[kind] || KINDS.spark;
    const [mode, c, [sa, sb], [la, lb], speed, grav, drag, alpha, wet] = K;
    const P = this.pools[mode], R = this.R;
    for (let k = 0; k < n; k++) {
      const i = P.next; P.next = (i + 1) % P.N;
      P.pos[i * 3] = p.x; P.pos[i * 3 + 1] = p.y; P.pos[i * 3 + 2] = p.z;
      let vx = (R() - 0.5) * 2 * spread, vy = R() * 1.2 * spread, vz = (R() - 0.5) * 2 * spread;
      if (dir) { vx += dir.x * 1.6; vy += dir.y * 1.6; vz += dir.z * 1.6; }
      const s = speed * (0.35 + R() * 0.65);
      P.vel[i * 3] = vx * s; P.vel[i * 3 + 1] = vy * s; P.vel[i * 3 + 2] = vz * s;
      P.base[i * 3] = c[0]; P.base[i * 3 + 1] = c[1]; P.base[i * 3 + 2] = c[2];
      P.max[i] = P.life[i] = la + R() * (lb - la);
      const sz = 0.8 + R() * 0.4; P.s0[i] = sa * sz; P.s1[i] = sb * sz; P.a0[i] = alpha;
      P.grav[i] = grav; P.drag[i] = drag; P.wet[i] = wet;
    }
  }

  // one particle at p with its own velocity (for trails and arcs)
  dot(p, kind, v) { this.burst(p, kind, 1, null, 0); const P = this.pools[KINDS[kind][0]], i = (P.next + P.N - 1) % P.N; P.vel[i * 3] = v?.x || 0; P.vel[i * 3 + 1] = v?.y || 0; P.vel[i * 3 + 2] = v?.z || 0; }

  shot(a, b) {
    // the round: a short streak racing from the muzzle to where it stops
    const S = this.trs[this.trNext]; this.trNext = (this.trNext + 1) % this.trs.length;
    S.a.copy(a); S.b.copy(b); S.t = 0; S.len = a.distanceTo(b);
    // its smoke: soft puffs strung along the line, drifting and spreading as they fade
    const n = Math.min(110, Math.ceil(S.len / 0.24));
    for (let k = 0; k < n; k++) { _v.lerpVectors(a, b, (k + this.R()) / n); _w.set((this.R() - 0.5) * 0.3, 0.1 + this.R() * 0.2, (this.R() - 0.5) * 0.3); this.dot(_v, 'trail', _w); }
  }
  tracer(a, b) { this.shot(a, b); } // (the old name)

  flash(p) { this.burst(p, 'flash', 1); this.burst(p, 'spark', 3, null, 0.6); this.burst(p, 'trail', 3, null, 0.5); }

  impact(p, dir) {
    this.burst(p, 'spark', 6, dir);
    this.burst(p, 'chips', 5, dir);
    this.burst(p, 'dust', 5, dir ? _v.copy(dir).multiplyScalar(0.5) : null, 0.7);
  }

  wound(p, dir, k = 1, pink = false) {
    this.burst(p, pink ? 'ichor' : 'blood', Math.round(18 * k), dir, 0.8);
    this.burst(p, pink ? 'ichormist' : 'mist', Math.round(3 * k), dir ? _v.copy(dir).multiplyScalar(0.4) : null, 0.6);
  }

  swipe(c, yaw, r = 3.2, h = 1.6, arc = 2.26) {
    // a fan of bright dots along an arc in front (130 degrees unless told), swept quickly so it reads as a stroke
    const n = Math.round((26 * arc) / 2.26);
    for (let k = 0; k < n; k++) {
      const a = yaw - arc / 2 + (k / (n - 1)) * arc, rr = r * (0.92 + this.R() * 0.12);
      _v.set(c.x + Math.sin(a) * rr, h + Math.sin((k / (n - 1)) * Math.PI) * 0.5, c.z + Math.cos(a) * rr);
      _w.set(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(-3);
      this.dot(_v, 'swipe', _w);
    }
  }

  ring(x, z, r = 4, color = 0xd8cfc0) {
    const g = this.rings.find((o) => o.t >= 1) || this.rings[0];
    g.t = 0; g.r = r; g.m.position.set(x, 0.05, z); g.m.material.color.set(color); g.m.visible = true;
  }

  stain(x, z, size = 1) { if (this.spill) this.spill.add(x, z, 0.6 * size, 0.35 * size); }

  update(dt) {
    if (this.camera) { // size in metres -> pixels
      const s = innerHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      for (const P of Object.values(this.pools)) P.mat.uniforms.uScale.value = s * Math.min(devicePixelRatio, 2);
    }
    // streaks: 1.8 m long, at 260 m/s
    for (let i = 0; i < this.trs.length; i++) {
      const S = this.trs[i];
      if (S.t >= 1) { this.tr.setMatrixAt(i, ZERO); continue; }
      S.t = Math.min(1, S.t + (dt * 260) / Math.max(1, S.len));
      const head = _v.lerpVectors(S.a, S.b, S.t), tail = _w.lerpVectors(S.a, S.b, Math.max(0, S.t - 1.8 / Math.max(1, S.len)));
      const L = head.distanceTo(tail);
      _q.setFromUnitVectors(Z, _d.subVectors(head, tail).normalize());
      _m.compose(tail, _q, _s.set(0.04, 0.04, Math.max(0.01, L)));
      this.tr.setMatrixAt(i, S.t >= 1 ? ZERO : _m);
    }
    this.tr.instanceMatrix.needsUpdate = true;
    // rings: grow out and fade
    for (const g of this.rings) {
      if (g.t >= 1) continue;
      g.t = Math.min(1, g.t + dt / 0.45);
      const e = 1 - (1 - g.t) ** 3;
      g.m.scale.setScalar(0.3 + g.r * e); g.m.material.opacity = 0.55 * (1 - g.t);
      if (g.t >= 1) g.m.visible = false;
    }
    // particles
    for (const P of Object.values(this.pools)) {
      const { pos, col, alpha, size, vel, life, max } = P;
      for (let i = 0; i < P.N; i++) {
        if (life[i] <= 0) { if (alpha[i] !== 0) { alpha[i] = 0; size[i] = 0; } continue; }
        life[i] -= dt;
        const dr = Math.max(0, 1 - P.drag[i] * dt);
        vel[i * 3] *= dr; vel[i * 3 + 1] = vel[i * 3 + 1] * dr - P.grav[i] * dt; vel[i * 3 + 2] *= dr;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.03) {
          if (P.wet[i] && this.spill) { const a = 0.03 + Math.random() * 0.05; this.spill.add(pos[i * 3], pos[i * 3 + 2], 0.07 + Math.random() * 0.12, P.wet[i] === 1 ? a : 0, P.wet[i] === 2 ? a : 0); P.wet[i] = 0; life[i] = Math.min(life[i], 0.05); }
          pos[i * 3 + 1] = 0.03; vel[i * 3] *= 0.3; vel[i * 3 + 1] = 0; vel[i * 3 + 2] *= 0.3;
        }
        const t = 1 - Math.max(0, life[i]) / max[i]; // 0 -> 1 over its life
        size[i] = P.s0[i] + (P.s1[i] - P.s0[i]) * Math.sqrt(t);
        alpha[i] = P.a0[i] * Math.min(1, (1 - t) * 3) * Math.min(1, t * 12 + 0.3);
        col[i * 3] = P.base[i * 3]; col[i * 3 + 1] = P.base[i * 3 + 1]; col[i * 3 + 2] = P.base[i * 3 + 2];
      }
      const g = P.pts.geometry.attributes;
      g.position.needsUpdate = g.color.needsUpdate = g.alpha.needsUpdate = g.size.needsUpdate = true;
    }
  }
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
