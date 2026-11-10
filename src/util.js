import * as THREE from 'three';

// Seeded random (mulberry32): the lab is the same every load.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Tileable fractal value noise, 0..1, w x h, `cells` lattice cells across at the first octave.
export function fbm(w, h, cells, octaves, seed) {
  const R = rng(seed);
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const g = cells << o;
    const lat = new Float32Array(g * g);
    for (let i = 0; i < lat.length; i++) lat[i] = R();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * g, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % g) * g, y1 = ((iy + 1) % g) * g;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * g, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % g, x1 = (ix + 1) % g;
        const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * sx;
        const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * sx;
        out[y * w + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export function canvasTexture(canvas, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Box UVs in metres: every face tiles `ts` metres per texture repeat, so a long wall doesn't stretch.
// fullV: side faces map the box's whole height to v 0..1 (for wall textures with bands at the base).
export function boxUV(geo, ts, fullV = false) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, h = bb.max.y - bb.min.y;
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const v = fullV ? (y - bb.min.y) / h : y / ts;
    if (ny > 0.5) uv.setXY(i, x / ts, z / ts);
    else if (nx > 0.5) uv.setXY(i, z / ts, v);
    else uv.setXY(i, x / ts, v);
  }
  uv.needsUpdate = true;
  return geo;
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export function angleTo(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
