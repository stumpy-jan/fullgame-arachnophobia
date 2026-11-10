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

// ------------------------------------------------------------------------------------------------
// Dividing walls: cast concrete. Faces: u = 3 m panel (the V-groove joint at the edge), v = height
// (0 floor .. 1 top, 3.4 m). Formwork tie holes on a 0.75 m grid with rust bleeding down from some,
// water/grime streaks from the top, darker damp band at the foot, the plinth a touch darker.
export function blastWallTextures() {
  const W = 512, H = 512, R = rng(81);
  const n = fbm(W, H, 6, 5, 82), f = fbm(W, H, 64, 2, 83), st = fbm(W, H, 24, 3, 84);
  const h = new Float32Array(W * H), rough = new Float32Array(W * H), alb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H; // 0 at the floor
    for (let x = 0; x < W; x++) {
      const i = y * W + x, u = x / W;
      // vertical streaks: low-frequency in x, stretched in y
      const streak = fbmAt(st, W, H, x, Math.floor(y * 0.12)) ;
      let g = 0.5 + (n[i] - 0.5) * 0.25 + (f[i] - 0.5) * 0.12 - Math.max(0, streak - 0.55) * 0.5;
      if (v < 0.09) g *= 0.82;                                   // plinth
      g *= 0.78 + Math.min(1, v * 4) * 0.22;                     // damp at the foot
      let hh = f[i] * 0.3 + n[i] * 0.2;
      const joint = Math.min(u, 1 - u) * 3;                      // m from the panel joint
      if (joint < 0.012) { g *= 0.45; hh -= 1; } else if (joint < 0.02) hh -= 0.4;
      if (Math.abs(v - 0.09) < 0.004) { g *= 0.7; hh -= 0.4; }   // plinth line
      alb[i * 3] = g * 1.0; alb[i * 3 + 1] = g * 0.99; alb[i * 3 + 2] = g * 0.96;
      h[i] = hh;
      rough[i] = 0.82 + (f[i] - 0.5) * 0.15 - Math.max(0, streak - 0.6) * 0.3;
    }
  }
  // tie holes, some bleeding rust
  for (let ty = 1; ty < 5; ty++) for (let tx = 0; tx < 4; tx++) {
    const cx = Math.floor(((tx + 0.5) / 4) * W), cy = Math.floor((1 - ty * 0.2) * H);
    const rust = R() < 0.35, run = 20 + R() * 120;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dy * dy > 14) continue;
      const i = ((cy + dy + H) % H) * W + ((cx + dx + W) % W);
      alb[i * 3] *= 0.4; alb[i * 3 + 1] *= 0.4; alb[i * 3 + 2] *= 0.4; h[i] -= 0.8;
    }
    if (rust) for (let dy = 0; dy < run; dy++) {
      const wdt = 2 + dy * 0.03, fade = 1 - dy / run;
      for (let dx = -wdt; dx <= wdt; dx++) {
        const i = ((cy + dy + H) % H) * W + ((cx + Math.round(dx + Math.sin(dy * 0.15) * 2) + W) % W);
        const a = 0.5 * fade * (1 - Math.abs(dx) / (wdt + 1));
        alb[i * 3] = alb[i * 3] * (1 - a) + 0.42 * a; alb[i * 3 + 1] = alb[i * 3 + 1] * (1 - a) + 0.22 * a; alb[i * 3 + 2] = alb[i * 3 + 2] * (1 - a) + 0.1 * a;
      }
    }
  }
  return toSet(alb, h, rough, W, H, 4);
}

// The crowns (and column caps): u = 3 m along, v = across (0.72 m). Weathered, with two lifting-anchor
// recesses per panel, each with a rust stain, and the arrises chipped.
export function wallTopTextures() {
  const W = 512, H = 128;
  const n = fbm(W, H, 8, 4, 91), f = fbm(W, H, 64, 2, 92);
  const h = new Float32Array(W * H), rough = new Float32Array(W * H), alb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, u = x / W, v = y / H;
    let g = 0.46 + (n[i] - 0.5) * 0.25 + (f[i] - 0.5) * 0.12;
    let hh = f[i] * 0.4 + n[i] * 0.2;
    const edge = Math.min(v, 1 - v);
    if (edge < 0.05 && f[i] > 0.6) { g *= 0.7; hh -= 0.6; }    // chips along the arrises
    if (Math.min(u, 1 - u) * 3 < 0.012) { g *= 0.45; hh -= 1; } // panel joint
    for (const au of [0.22, 0.78]) {
      const dx = (u - au) * 3, dy = (v - 0.5) * 0.72, r = Math.hypot(dx, dy);
      if (r < 0.06) { g *= 0.35; hh -= 1; }
      else if (r < 0.16) { const a = (1 - (r - 0.06) / 0.1) * 0.5 * (0.6 + n[i] * 0.6); g = g * (1 - a) + 0.3 * a; }
    }
    alb[i * 3] = g * (1 + (g < 0.4 ? 0.12 : 0)); alb[i * 3 + 1] = g * 0.98; alb[i * 3 + 2] = g * (g < 0.4 ? 0.85 : 0.95);
    h[i] = hh;
    rough[i] = 0.85 + (f[i] - 0.5) * 0.15;
  }
  return toSet(alb, h, rough, W, H, 4);
}

// Spray-painted stencil lettering (alpha), worn.
export function stencilTexture(text) {
  const W = 384, H = 128;
  const [c, g] = makeCanvas(W, H);
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(220,180,40,0.92)';
  g.font = 'bold 92px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 4);
  // stencil bridges and wear
  const R = rng(text.length * 97);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + R() * 0.7})`; g.beginPath(); g.arc(R() * W, R() * H, 1 + R() * 5, 0, Math.PI * 2); g.fill(); }
  g.fillRect(0, H / 2 - 3, W, 4);
  return canvasTexture(c, { repeat: false });
}

function fbmAt(a, W, H, x, y) { return a[((y % H) + H) % H * W + ((x % W) + W) % W]; }

function toSet(alb, h, rough, W, H, strength) {
  const [c, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = Math.min(255, alb[i * 3] * 255); img.data[i * 4 + 1] = Math.min(255, alb[i * 3 + 1] * 255); img.data[i * 4 + 2] = Math.min(255, alb[i * 3 + 2] * 255); img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { map: canvasTexture(c), normal: normalFromHeight(h, W, H, strength), rough: greyTexture(rough, W, H) };
}
