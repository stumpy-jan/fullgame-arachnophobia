import * as THREE from 'three';
import { TYPES } from '../people/types.js';
import { softDot } from '../textures.js';
import { sculpted as sculpted2 } from './sculpted.js';

// Alternative ways to draw the people, for the zoo. Each maker returns { group, update(t, dt, pose) } where
// pose = { phase, stride (0..1), aim (0..1), lean }. All built in metres at the game's 1.25x people scale.
export const SCALE = 1.25;
const hex = (h) => new THREE.Color().setHex(h, THREE.SRGBColorSpace);
const lathe = (prof, seg = 14) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);

// ------------------------------------------------------------------ B: sculpted procedural
// Proper silhouettes (tapered limbs, shoulders, hood, a coat that flares) and, above all, joints that
// bend: knees, elbows, a pelvis that bobs, a torso that counter-twists. Dolls read as dolls because their
// limbs are stiff sticks.
export function sculpted(type, { dark = false } = {}) {
  const T = TYPES[type], soldier = type === 'soldier';
  const cloth = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: dark ? 0x0b0c0e : hex(c), roughness: r, metalness: 0 });
  const M = {
    torso: cloth(T.colors.torso, soldier ? 0.55 : 0.9), leg: cloth(T.colors.leg), arm: cloth(T.colors.arm, soldier ? 0.55 : 0.9),
    head: cloth(T.colors.head), boot: cloth(0x15161a, 0.7),
    visor: new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.08, metalness: 0.5, emissive: dark ? 0xff9a2a : 0x000000, emissiveIntensity: dark ? 3 : 0 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.5, metalness: 0.6 }),
    tank: cloth(0x5d6266, 0.5),
  };
  const mesh = (g, m, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body); body.scale.setScalar(SCALE);
  const pelvis = new THREE.Group(); pelvis.position.y = 0.95; body.add(pelvis);
  // torso: waist to shoulders, wider than deep
  const torso = new THREE.Group(); pelvis.add(torso);
  const t = mesh(lathe([[0.0, -0.06], [0.14, -0.04], [0.15, 0.1], [0.17, 0.3], [0.2, 0.44], [0.17, 0.52], [0.07, 0.57], [0.0, 0.57]]), M.torso, torso);
  t.scale.set(1.2, 1, 0.72);
  // head: a hood (soldier) or hair; neck
  mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8), M.head, torso, 0, 0.6, 0);
  const head = mesh(new THREE.SphereGeometry(0.115, 16, 12), M.head, torso, 0, 0.72, 0.01);
  head.scale.set(0.95, 1.12, 1.05);
  if (soldier) {
    mesh(new THREE.SphereGeometry(0.085, 14, 10, -0.9, 1.8, 0.9, 1.0), M.visor, head, 0, 0, 0.035).scale.setScalar(1.25);
    mesh(new THREE.CapsuleGeometry(0.075, 0.26, 3, 8), M.tank, torso, 0, 0.32, -0.15);
  } else {
    // the lab coat: hung from the shoulders, flaring to the knees, open at the front (two halves)
    for (const s of [-1, 1]) {
      const g = new THREE.LatheGeometry([[0.17, 0.5], [0.2, 0.25], [0.21, 0.0], [0.24, -0.25], [0.28, -0.48]].map(([r, y]) => new THREE.Vector2(r, y)), 10, s > 0 ? 0.25 : Math.PI, Math.PI * 0.75);
      const c = mesh(g, new THREE.MeshStandardMaterial({ color: dark ? 0x0b0c0e : hex(T.colors.coat), roughness: 0.9, side: THREE.DoubleSide }), torso);
      c.scale.set(1.15, 1, 0.8);
    }
  }
  // limbs: two tapered segments each, pivoting at hip/knee and shoulder/elbow
  const limb = (parent, x, y, l1, r1, l2, r2, mat, foot) => {
    const a = new THREE.Group(); a.position.set(x, y, 0); parent.add(a);
    mesh(lathe([[0, 0], [r1, -0.02], [r1 * 0.85, -l1 * 0.6], [r1 * 0.75, -l1], [0, -l1 - 0.01]], 10), mat, a);
    const b = new THREE.Group(); b.position.y = -l1; a.add(b);
    mesh(lathe([[0, 0], [r2, -0.02], [r2 * 0.8, -l2 * 0.7], [r2 * 0.6, -l2], [0, -l2 - 0.01]], 10), mat, b);
    if (foot) mesh(new THREE.BoxGeometry(0.09, 0.06, 0.22), M.boot, b, 0, -l2 - 0.02, 0.05);
    else mesh(new THREE.SphereGeometry(0.04, 8, 6), M.head, b, 0, -l2 - 0.02, 0);
    return [a, b];
  };
  const legs = [-1, 1].map((s) => limb(pelvis, 0.095 * s, 0, 0.45, 0.085, 0.45, 0.06, M.leg, true));
  const arms = [-1, 1].map((s) => limb(torso, 0.22 * s, 0.5, 0.29, 0.055, 0.27, 0.045, M.arm, false));
  let gun = null;
  if (soldier) gun = mesh(new THREE.BoxGeometry(0.06, 0.09, 0.75), M.gun, torso, 0.1, 0.38, 0.3);

  return {
    group: root,
    update(_t, _dt, { phase, stride, aim, lean }) {
      const s = Math.sin(phase) * stride, c = Math.cos(phase) * stride;
      pelvis.position.y = 0.95 - Math.abs(c) * 0.04 * stride;
      torso.rotation.set(lean + 0.05 * stride, -s * 0.18 * (1 - aim), 0);
      legs.forEach(([hip, knee], i) => {
        const sg = i ? 1 : -1;
        hip.rotation.x = -s * 0.75 * sg;
        knee.rotation.x = Math.max(0, Math.sin(phase * 1 + (i ? Math.PI : 0) - 0.6)) * 1.2 * stride + 0.05;
      });
      arms.forEach(([sh, el], i) => {
        const sg = i ? 1 : -1;
        const run = s * 0.6 * sg, aimA = -1.35 + (i ? 0 : -0.1);
        sh.rotation.set(run + (aimA - run) * aim, 0, sg * (0.1 + 0.25 * aim) * (aim > 0.5 ? -1 : 1));
        el.rotation.x = -(0.9 * stride + 0.3) * (1 - aim) - 0.25 * aim;
      });
      if (gun) { gun.position.set(0.08, 0.38 + 0.08 * aim, 0.3 + 0.05 * aim); gun.rotation.x = 0.9 * (1 - aim); }
    },
  };
}

// ------------------------------------------------------------------ C: abstract operators
// No arms or legs: a hooded, cloaked silhouette that glides (bob, hem sway); the soldier's rifle floats,
// oversized, in front, with a laser sight and a torch cone on the floor; the scientist carries a glowing
// tablet. Smaller (0.9 of the game scale): the props carry the read, not the anatomy.
export function operator(type) {
  const T = TYPES[type], soldier = type === 'soldier';
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body); body.scale.setScalar(SCALE * 0.9);
  const mat = new THREE.MeshStandardMaterial({ color: hex(soldier ? T.colors.torso : T.colors.coat), roughness: soldier ? 0.5 : 0.85 });
  const cloak = new THREE.Mesh(lathe([[0.0, 1.5], [0.14, 1.49], [0.25, 1.42], [0.28, 1.3], [0.26, 1.0], [0.29, 0.6], [0.33, 0.15], [0.3, 0.06], [0.0, 0.05]], 20), mat);
  cloak.castShadow = true; body.add(cloak);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: hex(soldier ? T.colors.head : 0x2b2420), roughness: 0.6 }));
  hood.position.set(0, 1.63, 0); hood.scale.set(1, 1.1, 1.08); hood.castShadow = true; body.add(hood);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8, -0.9, 1.8, 1.0, 0.9), new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.1, emissive: soldier ? 0xffa030 : 0x000000, emissiveIntensity: soldier ? 2.5 : 0 }));
  visor.position.set(0, 1.64, 0.06); body.add(visor);
  let gun = null, laser = null, glow = null;
  const add = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  if (soldier) {
    gun = new THREE.Group(); gun.position.set(0.0, 1.15, 0.42); body.add(gun);
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 1.25), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.45, metalness: 0.6 }));
    g.castShadow = true; gun.add(g);
    laser = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 14).translate(0, 0, 7), add.clone()); laser.material.color.setRGB(6, 0.2, 0.1);
    laser.position.set(0, 0.05, 0.62); gun.add(laser);
  } else {
    const tab = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.6, 2.4) }));
    tab.position.set(0, 1.12, 0.3); tab.rotation.x = -0.9; body.add(tab);
  }
  // a pool of light on the floor ahead (torch / tablet), additive
  glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: coneTex(), color: soldier ? new THREE.Color(0.8, 0.7, 0.5) : new THREE.Color(0.25, 0.6, 0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.set(0, 0.01, soldier ? 3.2 : 0.9); glow.scale.set(soldier ? 3.2 : 1.3, 1, soldier ? 5.5 : 1.3); glow.rotation.y = Math.PI; // (the cone's apex at the figure)
  root.add(glow);
  return {
    group: root,
    update(t, _dt, { phase, stride, aim }) {
      body.position.y = Math.abs(Math.sin(phase)) * 0.05 * stride + Math.sin(t * 2) * 0.01;
      body.rotation.x = 0.12 * stride;
      cloak.scale.set(1 + Math.sin(phase * 2) * 0.03 * stride, 1, 1 + Math.cos(phase * 2) * 0.04 * stride);
      if (gun) { gun.rotation.x = 0.5 * (1 - aim) + Math.sin(t * 3) * 0.02; gun.position.y = 1.15 + Math.sin(t * 2.3) * 0.03; laser.visible = aim > 0.5; }
    },
  };
}

// ------------------------------------------------------------------ D: silhouettes and lights
// The sculpted figures in near-black, read by what they emit: amber visor slits and a torch cone for
// soldiers, retroreflective stripes on the scientists' coats that flare in any light.
export function silhouette(type, opts = {}) {
  const f = sculpted2(type, { ...opts, dark: true });
  const soldier = type === 'soldier';
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: coneTex(), color: soldier ? new THREE.Color(0.9, 0.75, 0.5) : new THREE.Color(0.15, 0.15, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.set(0, 0.01, soldier ? 3.4 : 0.0); glow.scale.set(soldier ? 3.4 : 1.2, 1, soldier ? 6 : 1.2); glow.rotation.y = Math.PI;
  f.group.add(glow);
  if (!soldier) {
    // reflective bands: emissive-ish pale strips round the coat and arms
    const band = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xd8f0ff, emissiveIntensity: 0.55, roughness: 0.3 });
    for (const y of [0.85, 1.05]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.01, 4, 24), band);
      r.rotation.x = Math.PI / 2; r.position.y = y * SCALE; r.scale.set(1.15 * SCALE, 0.8 * SCALE, SCALE); f.group.add(r);
    }
  }
  return f;
}

// ------------------------------------------------------------------ helpers
let _cone = null;
function coneTex() {
  if (_cone) return _cone;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 128, 4, 64, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(64, 128); g.lineTo(0, 0); g.lineTo(128, 0); g.closePath(); g.fill();
  _cone = new THREE.CanvasTexture(c);
  _cone.colorSpace = THREE.SRGBColorSpace;
  return _cone;
}
export { softDot };
