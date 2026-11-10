import * as THREE from 'three';

// After Skyward's post pass (Paolo): the scene goes to an HDR target, a quarter- and a sixteenth-res
// Gaussian blur of it make a soft haze and a two-level bloom, then a composite adds chromatic fringing
// at the edges, a vignette, tone mapping, a gradient map in colour-blend mode, fine animated grain and
// a dither so the dark gradients don't band.

export const postParams = {
  on: true,
  haze: 0.22,        // share of the blurred image mixed back in
  glow: 0.55,        // bloom strength
  threshold: 0.75,   // bloom threshold (linear HDR)
  chroma: 0.0005,    // fringing at the edges
  vignette: 0.55,
  noise: 0.045,
  grad: { a: '#0b2730', b: '#f2c79a', posA: 0.15, posB: 0.75, contrast: 1.15, strength: 0.28 },
};

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const hex = (v, h) => { const n = parseInt(h.slice(1), 16); return v.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const hdr = { type: THREE.HalfFloatType };
    this.target = new THREE.WebGLRenderTarget(1, 1, { ...hdr, samples: 4 });
    this.blurA = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.blurB = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.blurC = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.blurD = new THREE.WebGLRenderTarget(1, 1, hdr);
    this.res = new THREE.Vector2();

    this.blurMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          float w[5] = float[](0.2270, 0.1945, 0.1216, 0.0540, 0.0162);
          vec3 c = min(texture2D(tSrc, vUv).rgb, vec3(40.0)) * w[0];
          for (int i = 1; i < 5; i++) {
            vec2 o = uDir * float(i) * 2.6;
            c += (min(texture2D(tSrc, vUv + o).rgb, vec3(40.0)) + min(texture2D(tSrc, vUv - o).rgb, vec3(40.0))) * w[i];
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });

    this.mat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture }, tHaze: { value: this.blurB.texture }, tWide: { value: this.blurD.texture },
        uOn: { value: 1 }, uHaze: { value: 0 }, uGlow: { value: 0 }, uThreshold: { value: 1 }, uChroma: { value: 0 },
        uVignette: { value: 0 }, uNoise: { value: 0 }, uTime: { value: 0 }, uFlash: { value: new THREE.Vector3() },
        uGradA: { value: new THREE.Vector3() }, uGradB: { value: new THREE.Vector3() }, uGradPos: { value: new THREE.Vector2() },
        uGradContrast: { value: 1 }, uGradStrength: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene, tHaze, tWide;
        uniform float uOn, uHaze, uGlow, uThreshold, uChroma, uVignette, uNoise, uTime, uGradContrast, uGradStrength;
        uniform vec3 uGradA, uGradB, uFlash;
        uniform vec2 uGradPos;
        varying vec2 vUv;
        float gLum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
        vec3 gClip(vec3 c) {
          float l = gLum(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);
          if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5);
          if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5);
          return c;
        }
        vec3 gColor(vec3 base, vec3 blend) { return gClip(blend + (gLum(base) - gLum(blend))); }
        vec3 bicubic(sampler2D t, vec2 uv) {
          vec2 sz = vec2(textureSize(t, 0)), p = uv * sz - 0.5, f = fract(p), i = floor(p);
          vec2 f2 = f * f, f3 = f2 * f;
          vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
          vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
          vec2 g0 = w0 + w1, g1 = w2 + w3, h0 = (w1 / g0 - 1.0 + i + 0.5) / sz, h1 = (w3 / g1 + 1.0 + i + 0.5) / sz;
          return (texture2D(t, vec2(h0.x, h0.y)).rgb * g0.x + texture2D(t, vec2(h1.x, h0.y)).rgb * g1.x) * g0.y
               + (texture2D(t, vec2(h0.x, h1.y)).rgb * g0.x + texture2D(t, vec2(h1.x, h1.y)).rgb * g1.x) * g1.y;
        }
        float hash(uvec3 v) {
          v = v * 1664525u + 1013904223u;
          v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
          v ^= v >> 16u; v.x += v.y * v.z;
          return float(v.x) / 4294967295.0;
        }
        void main() {
          vec2 d = vUv - 0.5;
          vec3 c;
          if (uOn > 0.5) {
            vec2 ca = d * dot(d, d) * uChroma * 40.0;
            c = vec3(texture2D(tScene, vUv + ca).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - ca).b);
            vec3 haze = bicubic(tHaze, vUv), wide = bicubic(tWide, vUv);
            c = mix(c, mix(haze, wide, 0.4), uHaze);
            c += max(haze - uThreshold, 0.0) * uGlow * 0.7 + max(wide - uThreshold * 0.7, 0.0) * uGlow * 1.2;
            c += uFlash * smoothstep(0.45, 1.0, length(d * vec2(1.25, 1.0)) * 1.4); // hurt: red at the edges only
            c *= 1.0 - uVignette * smoothstep(0.25, 0.95, length(d * vec2(1.25, 1.0)) * 1.3);
          } else c = texture2D(tScene, vUv).rgb;
          c = toneMapping(c);
          c = linearToOutputTexel(vec4(c, 1.0)).rgb;
          if (uOn > 0.5) {
            float L = clamp((gLum(c) - 0.5) * uGradContrast + 0.5, 0.0, 1.0);
            vec3 gm = mix(uGradA, uGradB, smoothstep(uGradPos.x, uGradPos.y, L));
            // (strong reds are left out of the grade: blood stays blood, not teal-grey)
            float red = clamp((c.r - max(c.g, c.b)) * 5.0, 0.0, 1.0);
            c = mix(c, gColor(clamp(c, 0.0, 1.0), gm), uGradStrength * (1.0 - 0.85 * red));
            c = mix(c, c * vec3(1.12, 0.92, 0.92), red * 0.6);
            c += (hash(uvec3(gl_FragCoord.xy, uint(uTime * 24.0))) - 0.5) * uNoise * (1.2 - gLum(c));
          }
          vec2 dp = gl_FragCoord.xy + float(uint(uTime * 60.0) % 64u) * vec2(7.0, 13.0);
          c += (hash(uvec3(dp, 7u)) + hash(uvec3(dp, 11u)) - 1.0) / 255.0;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.flash = new THREE.Vector3();
    this.resize();
  }

  resize() {
    this.renderer.getDrawingBufferSize(this.res);
    this.target.setSize(this.res.x, this.res.y);
    const qx = Math.max(1, this.res.x >> 2), qy = Math.max(1, this.res.y >> 2);
    this.blurA.setSize(qx, qy); this.blurB.setSize(qx, qy);
    this.blurC.setSize(Math.max(1, qx >> 2), Math.max(1, qy >> 2)); this.blurD.setSize(Math.max(1, qx >> 2), Math.max(1, qy >> 2));
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera, t) {
    const P = postParams;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    if (P.on) {
      const b = this.blurMat.uniforms;
      b.tSrc.value = this.target.texture; b.uDir.value.set(1 / this.blurA.width, 0); this.pass(this.blurMat, this.blurA);
      b.tSrc.value = this.blurA.texture; b.uDir.value.set(0, 1 / this.blurB.height); this.pass(this.blurMat, this.blurB);
      b.tSrc.value = this.blurB.texture; b.uDir.value.set(1 / this.blurC.width, 0); this.pass(this.blurMat, this.blurC);
      b.tSrc.value = this.blurC.texture; b.uDir.value.set(0, 1 / this.blurD.height); this.pass(this.blurMat, this.blurD);
    }
    const u = this.mat.uniforms;
    u.uOn.value = P.on ? 1 : 0;
    u.uHaze.value = P.haze; u.uGlow.value = P.glow; u.uThreshold.value = P.threshold;
    u.uChroma.value = P.chroma; u.uVignette.value = P.vignette; u.uNoise.value = P.noise; u.uTime.value = t;
    u.uFlash.value.copy(this.flash);
    hex(u.uGradA.value, P.grad.a); hex(u.uGradB.value, P.grad.b); u.uGradPos.value.set(P.grad.posA, P.grad.posB);
    u.uGradContrast.value = P.grad.contrast; u.uGradStrength.value = P.grad.strength;
    this.pass(this.mat, null);
  }
}
