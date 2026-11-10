import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rng, makeCanvas, fbm, canvasTexture } from '../util.js';
import { normalFromHeight } from '../textures.js';

// B, second pass: sculpted procedural people.
// A skeleton of groups (hips > spine > chest > neck > head; hips > thigh > shin > foot; chest > upper arm >
// forearm > hand), lathed and rounded parts on it, clothes over that, and a run cycle with real
// contact poses. Variety from a seed: hair style and colour, skin tone, size, coat length.
//
// pose: { phase, stride (0..1), aim (0..1), lean, panic (0..1: glances back), fireT (s since the last shot) }
export const SCALE = 1.25;

const HAIR = [0x1d1612, 0x3b2a1e, 0x5a3c22, 0x8a6a45, 0xb8a27a, 0x6e6a66, 0x111111];
const SKIN = [0xe0b39a, 0xc68e6c, 0x9a6648, 0x6e4430, 0xf1cdb4];
const hex = (h) => new THREE.Color().setHex(h, THREE.SRGBColorSpace);
const lathe = (prof, seg = 14) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);

// fabric: soft wrinkles running down the cloth, and a fine weave
let _cloth = null;
function clothNormal() {
  if (_cloth) return _cloth;
  const S = 256, n = fbm(S, S, 6, 3, 911), f = fbm(S, S, 64, 1, 912);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    h[i] = Math.sin(x / S * Math.PI * 6 + n[i] * 5) * 0.4 + f[i] * 0.15 + n[i] * 0.4; // soft folds hanging along v
  }
  return (_cloth = normalFromHeight(h, S, S, 2.5));
}

export function sculpted(type, { dark = false, seed = 1 } = {}) {
  const R = rng(seed * 7919 + 13);
  const soldier = type === 'soldier';
  const pick = (a) => a[Math.floor(R() * a.length)];
  const size = 0.94 + R() * 0.12;
  const c = (h, rough = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color: dark ? 0x0b0c0e : hex(h), roughness: rough, metalness: 0, ...extra });
  const cloth = (h, rough) => c(h, rough, { normalMap: clothNormal(), normalScale: new THREE.Vector2(0.22, 0.22) });
  const M = soldier ? {
    suit: cloth(0xc2961f, 0.48), boot: c(0x141518, 0.6), glove: c(0x16171a, 0.55), hood: cloth(0xb08718, 0.5),
    band: c(0xd2581c, 0.6), tank: c(0x5d6266, 0.45, { metalness: 0.4 }), belt: c(0x2a2a2c, 0.7),
    gun: c(0x15171a, 0.45, { metalness: 0.6 }),
  } : {
    coat: cloth(0xe2e3df, 0.9), trousers: cloth(pick([0x2c3242, 0x3a3d40, 0x4a4036, 0x22262c]), 0.9),
    shirt: cloth(pick([0x6d8aa8, 0x8c8c86, 0x9a6b6b, 0x5c6b58]), 0.9), skin: c(pick(SKIN), 0.6),
    hair: c(pick(HAIR), 0.75), shoe: c(0x1a1716, 0.6),
  };
  const visor = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.06, metalness: 0.6, emissive: dark ? 0xff9a2a : 0x000000, emissiveIntensity: dark ? 3 : 0 });
  const add = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const G = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const root = new THREE.Group();
  const body = G(root); body.scale.setScalar(SCALE * size);
  const bulk = soldier ? 1.12 : 1; // a hazmat suit adds bulk

  // --- skeleton
  const hips = G(body, 0, 0.93, 0);
  const spine = G(hips, 0, 0.08, 0);
  const chest = G(spine, 0, 0.26, 0);
  const neck = G(chest, 0, 0.26, 0);
  const head = G(neck, 0, 0.1, 0.01);
  const legs = [-1, 1].map((s) => { const thigh = G(hips, 0.092 * s, 0, 0); const shin = G(thigh, 0, -0.44, 0); const foot = G(shin, 0, -0.43, 0); return { thigh, shin, foot, s }; });
  const arms = [-1, 1].map((s) => { const up = G(chest, 0.2 * s * bulk, 0.2, -0.01); const fore = G(up, 0, -0.29, 0); const hand = G(fore, 0, -0.26, 0); return { up, fore, hand, s }; });

  // --- body: pelvis, torso (wider than deep), neck
  const lower = soldier ? M.suit : M.trousers, upper = soldier ? M.suit : M.shirt;
  add(lathe([[0, -0.1], [0.13, -0.09], [0.155, 0.0], [0.145, 0.1], [0, 0.11]]), lower, hips).scale.set(1.18 * bulk, 1, 0.82 * bulk);
  add(lathe([[0, 0], [0.13, 0.0], [0.135, 0.1], [0.165, 0.24], [0.19, 0.4], [0.2, 0.46], [0.16, 0.52], [0.06, 0.55], [0, 0.55]]), upper, spine).scale.set(1.22 * bulk, 1, 0.7 * bulk);
  add(new THREE.CylinderGeometry(0.045, 0.052, 0.1, 10), soldier ? M.hood : M.skin, neck, 0, 0.0, 0);

  // --- limbs: tapered segments with a rounded joint at each end
  const seg = (parent, len, r0, r1, mat) => add(lathe([[0, 0.01], [r0 * 0.9, 0], [r0, -0.03], [(r0 + r1) / 2 * 0.98, -len * 0.55], [r1, -len + 0.02], [r1 * 0.8, -len], [0, -len - 0.01]], 12), mat, parent);
  for (const L of legs) {
    seg(L.thigh, 0.44, 0.083 * bulk, 0.06 * bulk, lower);
    seg(L.shin, 0.43, 0.06 * bulk, 0.044 * bulk, lower);
    const shoe = add(new RoundedBoxGeometry(0.095 * bulk, soldier ? 0.12 : 0.07, 0.25, 2, 0.03), soldier ? M.boot : M.shoe, L.foot, 0, soldier ? -0.02 : -0.01, 0.05);
    void shoe;
    if (soldier) add(new THREE.CylinderGeometry(0.052, 0.05, 0.14, 10), M.boot, L.shin, 0, -0.37, 0); // boot shaft
  }
  for (const A of arms) {
    seg(A.up, 0.29, 0.052 * bulk, 0.044 * bulk, soldier ? M.suit : M.coat);
    seg(A.fore, 0.26, 0.046 * bulk, 0.036 * bulk, soldier ? M.suit : M.coat);
    if (!soldier) add(new THREE.CylinderGeometry(0.052, 0.046, 0.06, 10), M.coat, A.fore, 0, -0.23, 0); // cuff
    const hand = add(new THREE.SphereGeometry(0.042, 10, 8), soldier ? M.glove : M.skin, A.hand, 0, -0.03, 0.005);
    hand.scale.set(0.8, 1.15, 0.6);
    if (soldier && A.s > 0) add(new THREE.CylinderGeometry(0.056, 0.056, 0.05, 10), M.band, A.up, 0, -0.06, 0); // orange shoulder band
  }

  // --- head and clothes
  let coatTail = null, gun = null, flash = null;
  if (soldier) {
    const hood = add(new THREE.SphereGeometry(0.13, 18, 14), M.hood, head, 0, 0.02, -0.01);
    hood.scale.set(0.98, 1.08, 1.04);
    const mask = add(new THREE.SphereGeometry(0.1, 16, 12, -1.0, 2.0, 0.85, 1.0), visor, head, 0, 0.03, 0.04);
    mask.scale.set(1.2, 1.15, 1.15);
    for (const s of [-1, 1]) { const can = add(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), M.tank, head, 0.07 * s, -0.06, 0.09); can.rotation.set(1.2, 0, -0.5 * s); }
    add(new THREE.TorusGeometry(0.165, 0.022, 6, 20), M.belt, hips, 0, 0.03, 0).rotation.x = Math.PI / 2;
    const tank = add(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), M.tank, chest, 0, 0.12, -0.17);
    void tank;
    const hose = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.05, 0.32, -0.17), new THREE.Vector3(0.14, 0.38, -0.05), new THREE.Vector3(0.1, 0.42, 0.08), new THREE.Vector3(0.06, 0.58, 0.12)]), 12, 0.015, 6);
    add(hose, M.belt, chest);
    // the rifle, held by the right hand: body, stock, magazine, barrel
    gun = G(chest, 0.1, 0.2, 0.22);
    add(new THREE.BoxGeometry(0.06, 0.1, 0.42), M.gun, gun, 0, 0, 0.05);
    add(new THREE.BoxGeometry(0.05, 0.09, 0.22), M.gun, gun, 0, -0.02, -0.25);
    add(new THREE.BoxGeometry(0.04, 0.14, 0.06), M.gun, gun, 0, -0.1, 0.1).rotation.x = 0.2;
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), M.gun, gun, 0, 0.02, 0.4).rotation.x = Math.PI / 2;
    flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6, 2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.set(0, 0.02, 0.6); flash.visible = false; gun.add(flash);
  } else {
    const skull = add(new THREE.SphereGeometry(0.1, 16, 12), M.skin, head, 0, 0.05, 0);
    skull.scale.set(0.9, 1.08, 1.0);
    const style = pick(['short', 'short', 'bun', 'ponytail', 'bald', 'long']);
    if (style !== 'bald') {
      const cap = add(new THREE.SphereGeometry(0.107, 16, 10, 0, Math.PI * 2, 0, style === 'long' ? 2.0 : 1.75), M.hair, head, 0, 0.055, -0.008);
      cap.scale.set(0.93, 1.1, 1.06);
      if (style === 'bun') add(new THREE.SphereGeometry(0.05, 10, 8), M.hair, head, 0, 0.13, -0.08);
      if (style === 'ponytail') add(new THREE.CapsuleGeometry(0.03, 0.14, 3, 8), M.hair, head, 0, 0.0, -0.11).rotation.x = 0.35;
    }
    // the coat: shoulders and body on the chest, the skirt on the hips (it swings), a collar
    add(lathe([[0.0, 0.0], [0.15, 0.0], [0.17, 0.22], [0.205, 0.4], [0.21, 0.46], [0.17, 0.53], [0.06, 0.56], [0, 0.56]]), M.coat, spine).scale.set(1.26, 1, 0.76);
    add(new THREE.TorusGeometry(0.075, 0.025, 6, 16, Math.PI * 1.4), M.coat, chest, 0, 0.26, -0.005).rotation.set(Math.PI / 2, 0, -Math.PI * 0.2 + Math.PI);
    coatTail = G(hips, 0, 0.12, 0);
    const len = 0.5 + R() * 0.12;
    for (const s of [-1, 1]) {
      const g = new THREE.LatheGeometry([[0.17, 0.0], [0.185, -0.15], [0.2, -0.3], [0.225, -len]].map(([r, y]) => new THREE.Vector2(r, y)), 10, s > 0 ? 0.2 : Math.PI, Math.PI * 0.8);
      add(g, new THREE.MeshStandardMaterial({ color: dark ? 0x0b0c0e : hex(0xe2e3df), roughness: 0.9, side: THREE.DoubleSide, normalMap: clothNormal(), normalScale: new THREE.Vector2(0.22, 0.22) }), coatTail).scale.set(1.18, 1, 0.82);
    }
  }

  const st = { tail: 0, tailV: 0, look: 0, lookT: R() * 3 };
  return {
    group: root,
    update(t, dt, { phase, stride = 0, aim = 0, lean = 0, panic = 0, fireT = 9 }) {
      const s = Math.sin(phase), cph = Math.cos(phase), k = stride;
      // hips: bob at each footfall, twist with the stride; the chest counter-twists
      hips.position.y = 0.93 - (0.045 - Math.abs(cph) * 0.045) * k - 0.04 * aim;
      hips.rotation.y = s * 0.14 * k;
      spine.rotation.set(lean + 0.06 * k, -s * 0.22 * k * (1 - aim) - 0.35 * aim, 0);
      chest.rotation.y = -0.1 * aim;
      // legs: thigh swings; the knee folds as the leg swings forward and straightens to land; feet stay flat
      for (const L of legs) {
        const p = phase + (L.s > 0 ? Math.PI : 0), sw = Math.sin(p);
        L.thigh.rotation.set(-sw * 0.72 * k - 0.1 * k - 0.25 * aim * (L.s > 0 ? -0.4 : 1), 0, L.s * 0.12 * aim);
        const fold = Math.max(0, Math.sin(p - 0.9)) * 1.35 + Math.max(0, -sw) * 0.25;
        L.shin.rotation.x = fold * k + 0.06 + 0.3 * aim;
        L.foot.rotation.x = -(L.thigh.rotation.x + L.shin.rotation.x) * 0.85;
      }
      // arms: pumped, elbows bent, against the legs; or round the rifle
      for (const A of arms) {
        const p = phase + (A.s > 0 ? 0 : Math.PI), sw = Math.sin(p);
        const run = -sw * 0.65 * k, elbow = -(1.25 * k + 0.25) - Math.max(0, sw) * 0.4 * k;
        const aimUp = A.s > 0 ? -1.05 : -1.3, aimEl = A.s > 0 ? -1.1 : -0.45, aimZ = A.s > 0 ? 0.25 : -0.45;
        A.up.rotation.set(run + (aimUp - run) * aim, 0, A.s * 0.08 * (1 - aim) + aimZ * aim);
        A.fore.rotation.x = elbow + (aimEl - elbow) * aim;
      }
      // the coat tail: a spring that trails the run
      if (coatTail) {
        st.tailV += ((-0.35 * k - lean * 0.6 + Math.sin(phase * 2) * 0.08 * k) - st.tail) * 40 * dt - st.tailV * 7 * dt;
        st.tail += st.tailV * dt;
        coatTail.rotation.x = st.tail;
      }
      // a frightened glance back over the shoulder now and then
      st.lookT -= dt;
      if (st.lookT < 0) st.lookT = 1.5 + Math.random() * 2.5;
      const want = panic > 0 && st.lookT < 0.6 ? (seed % 2 ? 1 : -1) * 1.3 * panic : 0;
      st.look += (want - st.look) * Math.min(1, dt * 10);
      neck.rotation.y = st.look * 0.6; head.rotation.y = st.look * 0.5; spine.rotation.y += st.look * 0.25;
      // rifle: carried low, or shouldered; recoil kicks it and the shoulder back
      if (gun) {
        const kick = fireT < 0.08 ? 1 - fireT / 0.08 : 0;
        gun.position.set(0.1 - 0.04 * aim, 0.2 + 0.14 * aim, 0.22 + 0.06 * aim - 0.05 * kick);
        gun.rotation.set(0.95 * (1 - aim) - 0.12 * kick, -0.08 * aim, 0);
        chest.rotation.x = -0.04 * kick;
        flash.visible = fireT < 0.04;
        flash.scale.setScalar(0.8 + Math.random() * 0.6);
      }
    },
  };
}
