import * as THREE from 'three';

// Liquids on the floor, the whole level at once: a texture over the level's bounds (12.5 cm a texel) holding how
// much blood (r), specimen fluid (g, the pink stuff in the vats, and the spider's own) and hydraulic oil (b) lies
// on each spot, and where blood has dried to a stain (a). Run on the GPU:
//   splats    add liquid: a soft, ragged disc per call (a wound, a pooling corpse, a broken vat, a footprint)
//   flow      30 times a second: what lies deeper than a thin film runs off to its neighbours, never into a wall
//             or under a prop (a mask from the world's height field), so pools spread, find the gaps, and stop
//   drying    films slowly evaporate; blood leaves its dried stain behind
// The floors read it (spillShader, in floors.js): liquid tints and darkens the floor, flattens its normal and
// makes it wet (glossier); dried blood stays as a dark stain; the specimen fluid glows faintly.
// A coarse copy on the CPU (wetAt) says where the spider's feet will pick blood up.

const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true;
export const spillUniforms = { uSpill: { value: blank }, uSpillBox: { value: new THREE.Vector4(0, 0, 1, 1) } };

// the floor patch: call from a material's onBeforeCompile (after any other patch)
export function spillShader(sh) {
  sh.uniforms.uSpill = spillUniforms.uSpill; sh.uniforms.uSpillBox = spillUniforms.uSpillBox;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSpW;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvSpW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D uSpill; uniform vec4 uSpillBox; varying vec3 vSpW;')
    .replace('#include <emissivemap_fragment>', /* glsl */ `
      vec4 sp = texture2D(uSpill, (vSpW.xz - uSpillBox.xy) / uSpillBox.zw);
      float wb = smoothstep(0.004, 0.04, sp.r), wi = smoothstep(0.004, 0.04, sp.g), wo = smoothstep(0.004, 0.04, sp.b);
      float wet = max(wb, max(wi, wo));
      float grain = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2));   // the floor's own texture shows through thin liquid
      // dried blood: a dark brown-red stain that stays
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.42, 0.1, 0.08), clamp(sp.a, 0.0, 1.0) * 0.8);
      // fresh liquid: thin films are lighter and show the floor; pools are dark and smooth; edges darken (a rim)
      vec3 blood = mix(vec3(0.26, 0.006, 0.004), vec3(0.11, 0.0015, 0.001), smoothstep(0.03, 0.35, sp.r));
      vec3 ichor = mix(vec3(0.3, 0.02, 0.17), vec3(0.12, 0.004, 0.065), smoothstep(0.03, 0.35, sp.g));
      vec3 oil = vec3(0.01, 0.009, 0.008);
      float tot = sp.r * wb + sp.g * wi + sp.b * wo + 1e-5, depth = sp.r + sp.g + sp.b;
      vec3 liq = (blood * sp.r * wb + ichor * sp.g * wi + oil * sp.b * wo) / tot;
      liq *= mix(0.6 + 0.5 * grain, 1.0, smoothstep(0.03, 0.2, depth));
      liq *= 1.0 - 0.45 * smoothstep(0.004, 0.02, depth) * (1.0 - smoothstep(0.02, 0.07, depth));
      diffuseColor.rgb = mix(diffuseColor.rgb, liq, wet * 0.95);
      roughnessFactor = mix(roughnessFactor, mix(0.55, 0.24, smoothstep(0.03, 0.25, depth)), wet);
      normal = normalize(mix(normal, nonPerturbedNormal, wet * smoothstep(0.02, 0.15, depth) * 0.9));
      #include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.5, 0.06, 0.3) * wi * 0.12;`);
}

const QUAD = new THREE.PlaneGeometry(2, 2);
const MAX_SPLATS = 512;

export class Spill {
  constructor(renderer, world) {
    this.renderer = renderer;
    const B = world.bounds;
    this.x0 = B.x0 - 1; this.z0 = B.z0 - 1; this.w = B.x1 - B.x0 + 2; this.d = B.z1 - B.z0 + 2;
    const TX = Math.max(0.125, Math.max(this.w, this.d) / 1100);
    this.W = Math.ceil(this.w / TX); this.H = Math.ceil(this.d / TX);
    const rt = () => new THREE.WebGLRenderTarget(this.W, this.H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.a = rt(); this.b = rt();
    for (const t of [this.a, this.b]) { renderer.setRenderTarget(t); renderer.setClearColor(0x000000, 0); renderer.clear(); }
    renderer.setRenderTarget(null);

    // where liquid can't go: under anything standing on the floor (walls, props), from the height field
    const mask = new Uint8Array(this.W * this.H);
    for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) {
      const x = this.x0 + ((i + 0.5) / this.W) * this.w, z = this.z0 + ((j + 0.5) / this.H) * this.d;
      mask[j * this.W + i] = world.heightAt(x, z) > 0.06 ? 255 : 0;
    }
    this.mask = new THREE.DataTexture(mask, this.W, this.H, THREE.RedFormat, THREE.UnsignedByteType);
    this.mask.needsUpdate = true;

    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // flow and drying
    this.simMat = new THREE.ShaderMaterial({
      uniforms: { uPrev: { value: null }, uMask: { value: this.mask }, uTexel: { value: new THREE.Vector2(1 / this.W, 1 / this.H) }, uSize: { value: new THREE.Vector2(this.w, this.d) }, uDt: { value: 1 / 30 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D uPrev, uMask; uniform vec2 uTexel, uSize; uniform float uDt; varying vec2 vUv;
        const vec3 FILM = vec3(0.05, 0.045, 0.07); // what wets the floor and stays put (oil runs less)
        // the floor isn't flat: a fixed bumpiness says how much each spot holds, so pools spread in fingers and
        // lobes, not circles
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        float hold(vec2 uv) { vec2 m = uv * uSize; float n = 0.45 * vnoise(m * 1.3) + 0.35 * vnoise(m * 3.6 + 7.0) + 0.2 * vnoise(m * 9.0 + 3.0); return 0.08 + 3.2 * n * n; }
        vec3 excess(vec2 uv, vec3 self) {
          if (texture2D(uMask, uv).r > 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return self; // a wall: no flow
          return max(texture2D(uPrev, uv).rgb - FILM * hold(uv), 0.0);
        }
        void main() {
          vec4 c = texture2D(uPrev, vUv);
          if (texture2D(uMask, vUv).r > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, c.a); return; }
          vec3 ex = max(c.rgb - FILM * hold(vUv), 0.0);
          vec3 flow = excess(vUv + vec2(uTexel.x, 0.0), ex) + excess(vUv - vec2(uTexel.x, 0.0), ex)
                    + excess(vUv + vec2(0.0, uTexel.y), ex) + excess(vUv - vec2(0.0, uTexel.y), ex) - 4.0 * ex;
          vec3 v = c.rgb + flow * vec3(0.2, 0.22, 0.12);
          v = max(v - uDt * vec3(0.0016, 0.0022, 0.0004), 0.0);   // drying
          float a = max(c.a, min(1.0, c.r * 5.0));                 // blood leaves its stain
          gl_FragColor = vec4(v, a);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.simQuad = new THREE.Mesh(QUAD, this.simMat); this.simQuad.frustumCulled = false;
    this.simScene = new THREE.Scene(); this.simScene.add(this.simQuad);

    // splats: instanced quads in the texture's space, added on
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', QUAD.attributes.position); g.setIndex(QUAD.index); g.setAttribute('uv', QUAD.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLATS * 4), 4); // uv centre, radius (uv x, uv y)
    this.iAmt = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLATS * 4), 4); // blood, ichor, oil, seed
    this.iPos.setUsage(THREE.DynamicDrawUsage); this.iAmt.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iAmt', this.iAmt);
    g.instanceCount = 0;
    this.splatGeo = g;
    const splatMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec4 iPos, iAmt; varying vec2 vQ; varying vec4 vAmt;
        void main() { vQ = position.xy; vAmt = iAmt; gl_Position = vec4((iPos.xy + position.xy * iPos.zw) * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying vec4 vAmt;
        void main() {
          // a ragged disc: its edge wobbles with the angle (each splat its own wobble)
          float ang = atan(vQ.y, vQ.x), s = vAmt.w;
          float edge = 0.78 + 0.12 * sin(ang * 3.0 + s * 6.3) + 0.08 * sin(ang * 7.0 + s * 17.0) + 0.05 * sin(ang * 13.0 + s * 3.1);
          float r = length(vQ) / edge;
          float f = 1.0 - smoothstep(0.55, 1.0, r);
          gl_FragColor = vec4(vAmt.rgb * f, 0.0);
        }`,
      // (plain one-plus-one: three's additive blend would scale by the alpha, which is 0 here: the stain channel)
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, transparent: true, depthTest: false, depthWrite: false,
    });
    this.splatMesh = new THREE.Mesh(g, splatMat); this.splatMesh.frustumCulled = false;
    this.splatScene = new THREE.Scene(); this.splatScene.add(this.splatMesh);
    this.queue = [];
    this.acc = 0;

    // the coarse CPU copy (50 cm cells): only for "is there blood under this foot"
    this.CW = Math.ceil(this.w / 0.5); this.CH = Math.ceil(this.d / 0.5);
    this.cpu = new Float32Array(this.CW * this.CH * 2); // blood, ichor

    spillUniforms.uSpillBox.value.set(this.x0, this.z0, this.w, this.d);
    spillUniforms.uSpill.value = this.a.texture;
  }

  // add liquid: radius in metres, amounts in "depth" (0.1 a thin smear, 0.5 a pool, 2 a vat)
  add(x, z, r, blood = 0, ichor = 0, oil = 0) {
    if (this.queue.length >= MAX_SPLATS - 4) return;
    // a big pour lands as a few overlapping lobes, not one disc
    const n = r > 0.5 ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.28, o = k ? r * (0.35 + Math.random() * 0.4) : 0, rr = k ? r * (0.45 + Math.random() * 0.3) : r * 0.8;
      this.queue.push([(x + Math.cos(a) * o - this.x0) / this.w, (z + Math.sin(a) * o - this.z0) / this.d, rr / this.w, rr / this.d, blood / n * 1.4, ichor / n * 1.4, oil / n * 1.4, Math.random()]);
    }
    // the CPU copy: roughly where it went (it doesn't flow, it just fades)
    const ci = Math.floor((x - this.x0) / 0.5), cj = Math.floor((z - this.z0) / 0.5), cr = Math.ceil(r / 0.5);
    for (let j = cj - cr; j <= cj + cr; j++) for (let i = ci - cr; i <= ci + cr; i++) {
      if (i < 0 || j < 0 || i >= this.CW || j >= this.CH) continue;
      const k = (j * this.CW + i) * 2;
      this.cpu[k] = Math.min(2, this.cpu[k] + blood); this.cpu[k + 1] = Math.min(2, this.cpu[k + 1] + ichor);
    }
  }
  // what's under a point: [blood, ichor] (roughly)
  wetAt(x, z) {
    const i = Math.floor((x - this.x0) / 0.5), j = Math.floor((z - this.z0) / 0.5);
    if (i < 0 || j < 0 || i >= this.CW || j >= this.CH) return [0, 0];
    const k = (j * this.CW + i) * 2;
    return [this.cpu[k], this.cpu[k + 1]];
  }

  update(dt) {
    const R = this.renderer, prevTarget = R.getRenderTarget(), prevAuto = R.autoClear;
    R.autoClear = false;
    if (this.queue.length) {
      const P = this.iPos.array, A = this.iAmt.array;
      this.queue.forEach((s, i) => { P.set(s.slice(0, 4), i * 4); A.set(s.slice(4, 8), i * 4); });
      this.iPos.needsUpdate = this.iAmt.needsUpdate = true;
      this.splatGeo.instanceCount = this.queue.length;
      R.setRenderTarget(this.a); R.render(this.splatScene, this.cam);
      this.queue.length = 0;
    }
    // flow at a steady 30 Hz, four small steps each (fast enough that pools find the floor's low spots rather
    // than just diffusing out in rings)
    this.acc = Math.min(this.acc + dt, 2 / 30);
    while (this.acc >= 1 / 30) {
      this.acc -= 1 / 30;
      for (let k = 0; k < 4; k++) {
        this.simMat.uniforms.uPrev.value = this.a.texture;
        this.simMat.uniforms.uDt.value = k === 0 ? 1 / 30 : 0; // (dry once a tick)
        R.setRenderTarget(this.b); R.render(this.simScene, this.cam);
        [this.a, this.b] = [this.b, this.a];
      }
    }
    spillUniforms.uSpill.value = this.a.texture;
    R.setRenderTarget(prevTarget); R.autoClear = prevAuto;
    // the CPU copy dries too
    const k = Math.exp(-dt / 40);
    for (let i = 0; i < this.cpu.length; i++) this.cpu[i] *= k;
  }
}
