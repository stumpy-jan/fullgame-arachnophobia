import * as THREE from 'three';
import { makeCanvas, fbm, canvasTexture, rng } from './util.js';

// All the lab's textures are painted here at load: no image files yet.

// Floor: poured concrete in 2 m slabs, 16 m per tile (2048 px), with stains, wet patches and scuffs.
// Returns { map, rough } (roughness: wet = glossy).
export function floorTextures() {
  const S = 2048, SLAB = S / 4;
  const n1 = fbm(S, S, 48, 3, 11), n2 = fbm(S, S, 4, 4, 12), n3 = fbm(S, S, 160, 2, 13);
  const R = rng(5);
  const slabTone = Array.from({ length: 64 }, () => 0.94 + R() * 0.12);
  const [c, g] = makeCanvas(S, S), [cr, gr] = makeCanvas(S, S);
  const img = g.createImageData(S, S), rim = gr.createImageData(S, S);
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const sx = Math.floor(x / SLAB), sy = Math.floor(y / SLAB);
      const lx = x % SLAB, ly = y % SLAB;
      const seam = Math.min(lx, ly, SLAB - 1 - lx, SLAB - 1 - ly);
      const stain = Math.max(0, n2[i] - 0.6) * 1.2; // broad dark staining
      const wet = Math.max(0, n2[(i + S * 700) % (S * S)] - 0.56) * 4.0;
      let v = (0.8 + (n1[i] - 0.5) * 0.3 + (n3[i] - 0.5) * 0.35) * slabTone[(sy * 8 + sx) % 64];
      v *= 1 - Math.min(0.18, stain * 0.5);
      v *= 1 - Math.min(0.1, wet * 0.15);
      if (seam < 2) v *= 0.55; else if (seam < 3) v *= 0.85;
      const k = i * 4;
      img.data[k] = Math.min(255, v * 92);
      img.data[k + 1] = Math.min(255, v * 96);
      img.data[k + 2] = Math.min(255, v * 100);
      img.data[k + 3] = 255;
      hgt[i] = n3[i] * 0.5 + n1[i] * 0.12 - (seam < 3 ? (3 - seam) * 0.35 : 0);
      let r = 0.72 - n3[i] * 0.1 - Math.min(0.22, wet * 0.5);
      if (seam < 3) r = 0.95;
      rim.data[k] = rim.data[k + 1] = rim.data[k + 2] = Math.max(0.08, r) * 255;
      rim.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  gr.putImageData(rim, 0, 0);
  // scuffs: long faint drag marks
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(40,40,40,${0.05 + R() * 0.12})`;
    g.lineWidth = 1 + R() * 3;
    g.beginPath();
    const x = R() * S, y = R() * S, a = R() * Math.PI * 2, l = 30 + R() * 200;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.4) * l * 0.5, y + Math.sin(a + 0.4) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return { map: canvasTexture(c), rough: canvasTexture(cr, { srgb: false }), normal: normalFromHeight(hgt, S, S, 3) };
}

// Partition walls: painted steel panels, dark scuffed base band, a hazard stripe, a lighter upper half.
// u: 2 m per repeat; v: 0 (floor) .. 1 (top).
export function wallTextures() {
  const W = 512, H = 512;
  const n = fbm(W, H, 6, 4, 21), f = fbm(W, H, 64, 2, 22);
  const [c, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  const hgt = new Float32Array(W * H), rough = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H; // 0 at the floor
    for (let x = 0; x < W; x++) {
      const i = y * W + x, k = i * 4;
      let r, gg, b;
      if (v < 0.13) { r = 46; gg = 50; b = 52; }             // kick plate
      else if (v < 0.155) {                                  // hazard stripe
        const s = Math.floor((x + y * 1.0) / 18) % 2;
        [r, gg, b] = s ? [196, 150, 30] : [26, 24, 20];
      } else if (v < 0.58) { r = 70; gg = 86; b = 86; }      // lower panel: lab teal-grey
      else { r = 132; gg = 138; b = 136; }                   // upper panel
      let m = 0.78 + n[i] * 0.4;
      if (v < 0.3) m *= 0.75 + v;                             // grime rising from the floor
      const px = x % 256;
      if (px < 2 || Math.abs(v - 0.58) < 0.004) m *= 0.45;   // panel seams
      if (px > 4 && px < 8 && (Math.abs(v - 0.25) < 0.006 || Math.abs(v - 0.9) < 0.006)) m *= 0.6; // rivets row
      hgt[i] = f[i] * 0.4 + n[i] * 0.3 - (px < 3 || Math.abs(v - 0.58) < 0.005 ? 1 : 0) - (v < 0.13 ? 0.3 : 0)
        + ((px - 128) ** 2 + ((v * 512) % 64 - 32) ** 2 < 9 ? 0.6 : 0); // seams, the kick plate step, bolts
      rough[i] = (v < 0.155 ? 0.55 : 0.68) + n[i] * 0.2 + (f[i] - 0.5) * 0.15;
      img.data[k] = r * m; img.data[k + 1] = gg * m; img.data[k + 2] = b * m; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { map: canvasTexture(c), normal: normalFromHeight(hgt, W, H, 4), rough: greyTexture(rough, W, H) };
}

// Generic grime: tinted by each material's colour (map * color).
export function grimeTexture() {
  const S = 512;
  const n = fbm(S, S, 4, 5, 31), e = fbm(S, S, 24, 2, 32);
  const [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = Math.min(1, 0.62 + n[i] * 0.45 + (e[i] - 0.5) * 0.15);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c);
}

// Server rack fronts: rows of LEDs and drive bays. Returns { map, emissive }.
export function rackTextures() {
  const W = 128, H = 512, R = rng(41);
  const [c, g] = makeCanvas(W, H), [ce, ge] = makeCanvas(W, H);
  g.fillStyle = '#15181b'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  for (let u = 0; u < 40; u++) {
    const y = 12 + u * 12;
    g.fillStyle = R() < 0.5 ? '#22272b' : '#1b1f22';
    g.fillRect(6, y, W - 12, 10);
    g.fillStyle = '#0c0d0e'; g.fillRect(6, y + 9, W - 12, 1);
    for (let k = 0; k < 6; k++) {
      if (R() < 0.55) {
        const col = R() < 0.7 ? '#3cff8a' : R() < 0.5 ? '#3cb4ff' : '#ffb03c';
        ge.fillStyle = col; g.fillStyle = col;
        const x = 12 + k * 6 + (R() < 0.3 ? 60 : 0);
        ge.fillRect(x, y + 3, 3, 3); g.fillRect(x, y + 3, 3, 3);
      }
    }
  }
  return { map: canvasTexture(c, { repeat: false }), emissive: canvasTexture(ce, { repeat: false }) };
}

// Monitor screens: a dark terminal with lines of readout and a trace.
export function screenTexture(seed, hue = '#46e0c8') {
  const W = 256, H = 160, R = rng(seed);
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = '#020807'; g.fillRect(0, 0, W, H);
  g.fillStyle = hue;
  for (let l = 0; l < 9; l++) {
    let x = 10;
    while (x < W * (0.4 + R() * 0.5)) { const w = 4 + R() * 22; g.globalAlpha = 0.4 + R() * 0.6; g.fillRect(x, 10 + l * 9, w, 4); x += w + 5; }
  }
  g.globalAlpha = 1; g.strokeStyle = hue; g.lineWidth = 2; g.beginPath();
  for (let x = 0; x < W; x += 4) { const y = 128 + Math.sin(x * 0.07 + seed) * 12 + (R() - 0.5) * 10; x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  return canvasTexture(c, { repeat: false });
}

// Diagonal hazard stripes, black/yellow.
export function hazardTexture() {
  const [c, g] = makeCanvas(256, 64);
  g.fillStyle = '#c9971c'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#16140f';
  for (let x = -64; x < 320; x += 64) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 32, 64); g.lineTo(x + 64, 0); g.lineTo(x + 32, 0); g.fill(); }
  const t = canvasTexture(c);
  return t;
}

// The spider's legs: lengthwise (v) bands, dark chitin with a rusty band and a pale ring at each joint.
export function legTextures() {
  const W = 128, H = 512;
  const n = fbm(W, H, 4, 3, 51), f = fbm(W, H, 32, 2, 52);
  const [c, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  const hgt = new Float32Array(W * H), rough = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, k = i * 4;
      let r = 34, gg = 24, b = 24;
      const e = Math.min(v, 1 - v);
      if (e < 0.1) { const t = (1 - e / 0.1) ** 2; r += 46 * t; gg += 14 * t; b += 8 * t; } // rusty joints
      const streak = Math.sin(x / W * Math.PI * 2 * 6 + n[i] * 4) * 0.5 + 0.5;            // lengthwise ridges
      const m = (0.7 + n[i] * 0.5) * (0.8 + streak * 0.3);
      hgt[i] = streak * 0.6 + f[i] * 0.5 + (Math.sin(v * 140 + n[i] * 6) > 0.92 ? 0.4 : 0); // ridges, pits, growth rings
      rough[i] = 0.48 + f[i] * 0.3 + (1 - streak) * 0.12;
      img.data[k] = r * m; img.data[k + 1] = gg * m; img.data[k + 2] = b * m; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { map: canvasTexture(c), normal: normalFromHeight(hgt, W, H, 3), rough: greyTexture(rough, W, H) };
}

// The abdomen: dark mottled chitin with a faint paler fleck (equirectangular, for a sphere). Also its bump.
export function abdomenTexture() {
  const W = 512, H = 256;
  const n = fbm(W, H, 8, 5, 62), f = fbm(W, H, 48, 2, 63);
  const [c, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const fleck = Math.max(0, f[i] - 0.62) * 3;
    const v = 0.7 + n[i] * 0.5 + fleck * 0.8;
    img.data[i * 4] = 30 * v; img.data[i * 4 + 1] = 21 * v; img.data[i * 4 + 2] = 22 * v; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c);
}

// A soft round sprite for dust and glows.
export function softDot() {
  const [c, g] = makeCanvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return canvasTexture(c, { repeat: false });
}

// ------------------------------------------------------------------------------------------------
// Surface detail: what keeps things from looking like plastic. Highlights break up on a normal map
// and on varied roughness; edges and chips catch the light differently from the flat paint.

// tangent-space normal map (OpenGL, +y = +v) from a tileable height field
export function normalFromHeight(h, W, H, strength) {
  const [c, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const yu = ((y - 1 + H) % H) * W, yd = ((y + 1) % H) * W;
    for (let x = 0; x < W; x++) {
      const xl = (x - 1 + W) % W, xr = (x + 1) % W;
      const dx = (h[y * W + xr] - h[y * W + xl]) * strength;
      const dy = (h[yd + x] - h[yu + x]) * strength;   // image rows go down, v goes up
      const l = Math.hypot(dx, dy, 1), k = (y * W + x) * 4;
      img.data[k] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c, { srgb: false });
}

// a greyscale data texture (roughness and the like) from a 0..1 array
export function greyTexture(a, W, H) {
  const [c, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = Math.max(0, Math.min(1, a[i])) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c, { srgb: false });
}

// Worn painted metal for the props: { map, normal, rough }. map is a grey multiplier for each
// material's colour: grime in the low spots, chipped paint (bright bare metal) and scratches.
// roughness: paint ~0.6-0.85, chips and scratches shinier. Material roughness multiplies it.
export function wornTextures(seed) {
  const S = 512, R = rng(seed);
  const big = fbm(S, S, 4, 5, seed + 1), fine = fbm(S, S, 64, 2, seed + 2), mid = fbm(S, S, 16, 3, seed + 3);
  const h = new Float32Array(S * S), alb = new Float32Array(S * S), rough = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const chip = Math.max(0, mid[i] - 0.68) * 8;                  // paint chipped off
    h[i] = fine[i] * 0.35 + big[i] * 0.4 - Math.min(1, chip) * 0.5;
    alb[i] = (0.62 + big[i] * 0.42 + (fine[i] - 0.5) * 0.2) * (1 + Math.min(1, chip) * 0.6);
    rough[i] = 0.62 + big[i] * 0.25 + (fine[i] - 0.5) * 0.15 - Math.min(1, chip) * 0.3;
  }
  // scratches: short straight scores, slightly shiny and slightly lighter
  for (let s = 0; s < 220; s++) {
    let x = R() * S, y = R() * S;
    const a = R() * Math.PI, l = 8 + R() * 60, dx = Math.cos(a), dy = Math.sin(a);
    for (let t = 0; t < l; t++) {
      const i = (((y | 0) % S + S) % S) * S + (((x | 0) % S + S) % S);
      h[i] -= 0.25; alb[i] *= 1.12; rough[i] -= 0.18;
      x += dx; y += dy;
    }
  }
  const [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { const v = Math.min(255, alb[i] * 255); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return { map: canvasTexture(c), normal: normalFromHeight(h, S, S, 6), rough: greyTexture(rough, S, S) };
}

// Chitin for the spider's body: { map, normal, rough } (equirectangular). Fine pits and wrinkles
// that break the highlight up, short bristle streaks running back along the body (u), a dull sheen.
export function chitinTextures(seed, base = [30, 21, 22]) {
  const W = 1024, H = 512;
  const n = fbm(W, H, 8, 5, seed), f = fbm(W, H, 96, 2, seed + 1), w = fbm(W, H, 24, 3, seed + 2);
  const h = new Float32Array(W * H), rough = new Float32Array(W * H);
  const [c, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  const R = rng(seed + 3);
  for (let i = 0; i < W * H; i++) {
    const wrinkle = Math.abs(w[i] - 0.5) * 2;                    // ridged noise: creases
    h[i] = f[i] * 0.5 + (1 - wrinkle) * 0.6;
    const fleck = Math.max(0, f[i] - 0.66) * 3;
    const v = 0.7 + n[i] * 0.5 + fleck * 0.6;
    img.data[i * 4] = base[0] * v; img.data[i * 4 + 1] = base[1] * v; img.data[i * 4 + 2] = base[2] * v; img.data[i * 4 + 3] = 255;
    rough[i] = 0.5 + f[i] * 0.3 + wrinkle * 0.1;
  }
  // bristles: thin streaks, lighter, rough
  for (let s = 0; s < 5000; s++) {
    let x = R() * W, y = R() * H;
    const l = 4 + R() * 10, dy = (R() - 0.5) * 0.3;
    for (let t = 0; t < l; t++) {
      const i = ((y | 0) % H) * W + ((x | 0) % W);
      h[i] += 0.5; rough[i] = 0.85;
      img.data[i * 4] = Math.min(255, img.data[i * 4] * 1.5 + 6); img.data[i * 4 + 1] = Math.min(255, img.data[i * 4 + 1] * 1.4 + 4); img.data[i * 4 + 2] = Math.min(255, img.data[i * 4 + 2] * 1.3 + 3);
      x += 1; y += dy;
    }
  }
  g.putImageData(img, 0, 0);
  return { map: canvasTexture(c), normal: normalFromHeight(h, W, H, 3), rough: greyTexture(rough, W, H) };
}

// Soft contact shadow under things (alpha in the green channel: white = dark). rect or round.
export function contactTexture(round) {
  const S = 128;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.filter = 'blur(14px)';
  g.fillStyle = '#fff';
  if (round) { g.beginPath(); g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2); g.fill(); }
  else g.fillRect(S * 0.22, S * 0.22, S * 0.56, S * 0.56);
  g.filter = 'none';
  return canvasTexture(c, { repeat: false, srgb: false });
}
