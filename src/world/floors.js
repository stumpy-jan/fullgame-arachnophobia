import * as THREE from 'three';
import { makeCanvas, fbm, rng, canvasTexture } from '../util.js';
import { normalFromHeight } from '../textures.js';
import { spillShader } from '../spill.js';

// Floors by room type. Photo-scanned CC0 sets (Poly Haven, see CREDITS.md) at their real size, sampled
// with a no-tile shader so a 2.5 m texture never shows its grid; the server room is a raised access floor
// painted in code (its tiles are real, so they may repeat).
export const FLOOR_TYPES = {
  lab: { tex: 'concrete_floor_painted', size: 2, tint: 0xcfd9d4, rough: 0.85, normal: 0.5, contrast: 0.22 }, // sealed, satin (its blotches repeat: flattened)
  containment: { tex: 'brushed_concrete', size: 2.5, tint: 0xd8d8d4, rough: 1, normal: 0.8 },  // power-trowelled
  industrial: { tex: 'garage_floor', size: 1.89, tint: 0xa9adac, rough: 1, normal: 0.9, contrast: 0.6 }, // oily, cracked
  storage: { tex: 'brushed_concrete_2', size: 2.5, tint: 0xd0d0cc, rough: 1, normal: 0.8 },     // weathered
  server: { raised: true },
  default: { tex: 'brushed_concrete_2', size: 2.5, tint: 0xd0d0cc, rough: 1, normal: 0.8 },
};

const loader = new THREE.TextureLoader();
const sets = {};
// a Poly Haven set (public/textures/<id>/diff|nor_gl|arm.jpg), repeat in metres
export function pbrSet(id, size) {
  if (sets[id]) return sets[id];
  const load = (m, srgb) => {
    const t = loader.load(`./textures/${id}/${m}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.repeat.set(1 / size, 1 / size);
    return t;
  };
  return (sets[id] = { map: load('diff', true), normal: load('nor_gl', false), arm: load('arm', false) });
}

const mats = {};
export function floorMaterial(type) {
  const spec = FLOOR_TYPES[type] || FLOOR_TYPES.default;
  const key = FLOOR_TYPES[type] ? type : 'default';
  if (mats[key]) return mats[key];
  if (spec.raised) return (mats[key] = raisedFloorMaterial());
  const s = pbrSet(spec.tex, spec.size);
  const m = new THREE.MeshStandardMaterial({
    map: s.map, normalMap: s.normal, normalScale: new THREE.Vector2(spec.normal, spec.normal),
    roughnessMap: s.arm, roughness: spec.rough, metalness: 0, color: spec.tint,
  });
  noTile(m, spec.contrast ?? 0.85);
  return (mats[key] = m);
}

// A floor slab for a rectangle, UVs in world metres (textures repeat by their real size).
export function floorGeometry(x0, z0, x1, z1) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
  return g;
}

// ------------------------------------------------------------------ the no-tile patch
// Inigo Quilez's texture-repetition technique 3: a slow noise picks, per region, one of 8 offsets into the
// texture and blends between neighbours, so the repeat never lines up. Applied to the colour, normal and
// roughness lookups alike (same offsets), plus world-scale variation in tone and roughness.
const NOTILE = /* glsl */ `
varying vec3 vNtWorld;
float ntHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ntNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ntHash(i), ntHash(i + vec2(1, 0)), f.x), mix(ntHash(i + vec2(0, 1)), ntHash(i + vec2(1, 1)), f.x), f.y);
}
vec4 textureNoTile(sampler2D samp, vec2 uv) {
  float l = ntNoise(uv * 0.45) * 8.0, i = floor(l), f = fract(l);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec4 a = textureGrad(samp, uv + sin(vec2(3.0, 7.0) * i), dx, dy);
  vec4 b = textureGrad(samp, uv + sin(vec2(3.0, 7.0) * (i + 1.0)), dx, dy);
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * dot(a.xyz - b.xyz, vec3(1.0))));
}`;
export function noTile(material, contrast = 1) {
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNtWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvNtWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const chunk = (name) => THREE.ShaderChunk[name].split('texture2D(').join('textureNoTile(');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOTILE}`)
      .replace('#include <map_fragment>', chunk('map_fragment') + `
        // less of the photo's own contrast: towards its average colour (its smallest mip), so distinctive
        // blotches don't read as a repeat; the world-scale variation below carries the floor instead
        diffuseColor.rgb = mix(diffuse * textureLod(map, vec2(0.5), 12.0).rgb, diffuseColor.rgb, ${contrast.toFixed(2)});
        diffuseColor.rgb *= 0.86 + 0.26 * ntNoise(vNtWorld.xz * 0.07) * (0.7 + 0.3 * ntNoise(vNtWorld.xz * 0.31));`)
      .replace('#include <roughnessmap_fragment>', chunk('roughnessmap_fragment') + `
        roughnessFactor = clamp(roughnessFactor * (0.85 + 0.3 * ntNoise(vNtWorld.xz * 0.2 + 17.0)), 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', chunk('normal_fragment_maps'));
    spillShader(sh); // liquids on the floor (spill.js)
  };
  material.customProgramCacheKey = () => 'notile' + contrast;
}

// ------------------------------------------------------------------ the server room's raised floor
// 600 mm tiles, 3 mm seams, each tile its own tone, one in six a perforated vent tile with a faint cool
// glow from under the floor. 16 x 16 tiles per texture (9.6 m), so it rarely repeats visibly.
function raisedFloorMaterial() {
  const S = 2048, N = 16, T = S / N, R = rng(404);
  const n = fbm(S, S, 32, 3, 405);
  const [c, g] = makeCanvas(S, S), [ce, ge] = makeCanvas(S, S);
  const img = g.createImageData(S, S), em = ge.createImageData(S, S);
  const h = new Float32Array(S * S);
  const tone = [], vent = [];
  for (let i = 0; i < N * N; i++) { tone.push(0.9 + R() * 0.14); vent.push(R() < 0.16); }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, tx = Math.floor(x / T), ty = Math.floor(y / T), lx = x % T, ly = y % T, k = ty * N + tx;
      const seam = Math.min(lx, ly, T - 1 - lx, T - 1 - ly);
      let v = (0.42 + (n[i] - 0.5) * 0.08) * tone[k], hh = 0, glow = 0;
      if (vent[k] && seam > 10) {
        const hole = ((lx % 8) - 4) ** 2 + ((ly % 8) - 4) ** 2 < 5;
        if (hole) { v *= 0.18; hh = -1; glow = 1; } else v *= 0.85;
      }
      if (seam < 2) { v *= 0.25; hh = -1.5; } else if (seam < 4) { v *= 1.06; hh = 0.3; }
      const o = i * 4;
      img.data[o] = v * 228; img.data[o + 1] = v * 232; img.data[o + 2] = v * 236; img.data[o + 3] = 255;
      em.data[o] = 20 * glow; em.data[o + 1] = 60 * glow; em.data[o + 2] = 80 * glow; em.data[o + 3] = 255;
      h[i] = hh;
    }
  }
  g.putImageData(img, 0, 0); ge.putImageData(em, 0, 0);
  const rep = 1 / (N * 0.6);
  const tex = [canvasTexture(c), canvasTexture(ce), normalFromHeight(h, S, S, 2)];
  for (const t of tex) t.repeat.set(rep, rep);
  const m = new THREE.MeshStandardMaterial({ map: tex[0], emissiveMap: tex[1], emissive: 0xffffff, emissiveIntensity: 1.5, normalMap: tex[2], roughness: 0.5, metalness: 0.15 });
  m.onBeforeCompile = spillShader; m.customProgramCacheKey = () => 'raised-spill';
  return m;
}
