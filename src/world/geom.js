import * as THREE from 'three';

// An irregular blob outline (unit radius, `rough` = how ragged), flat in xy.
export function splat(R, r, rough) {
  const sh = new THREE.Shape(), N = 28, ph = [R() * 6, R() * 6, R() * 6];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const k = r * (1 + rough * (0.5 * Math.sin(a * 2 + ph[0]) + 0.3 * Math.sin(a * 5 + ph[1]) + 0.2 * Math.sin(a * 9 + ph[2])));
    i ? sh.lineTo(Math.cos(a) * k, Math.sin(a) * k) : sh.moveTo(Math.cos(a) * k, Math.sin(a) * k);
  }
  return new THREE.ShapeGeometry(sh, 6);
}

// Where (0..1) does segment a-b enter the axis-aligned rectangle w? -1 if it misses (slab test).
export function segBox(ax, az, bx, bz, w) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, w.x0, w.x1], [az, dz, w.z0, w.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return -1; continue; }
    let u = (lo - p) / d, v = (hi - p) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return -1;
  }
  return t0;
}
