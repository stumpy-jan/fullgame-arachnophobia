import * as THREE from 'three';
import { sfx } from './audio.js';

// Mutations: one per body slot (Design/DESIGN.md). Each grows its slot's part on the spider (part(spider):
// returns an undo) and does something: `auto` every frame, or `power` when its slot's key is pressed
// (cooldown in seconds). A vat offers three mutations for three different empty slots; a filled slot is
// never offered again.
export const SLOTS = ['maw', 'forelegs', 'carapace', 'abdomen', 'hindlegs', 'glands'];
export const SLOT_NAMES = { maw: 'Maw', forelegs: 'Forelegs', carapace: 'Carapace', abdomen: 'Abdomen', hindlegs: 'Hind legs', glands: 'Glands' };
export const SLOT_KEYS = { maw: 'Q', forelegs: 'E', carapace: 'R' }; // fixed keys per slot (only slots with powers need one)

export const MUTATIONS = {
  devour: {
    slot: 'maw', name: 'Devour', cooldown: 8,
    text: 'Q: seize the nearest person with a foreleg, carry them to your jaws and eat them. Heals fast.',
    part: (sp) => { // bigger, serrated mandibles in place of the fangs
      for (const f of sp.fangs) f.visible = false;
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        const m = new THREE.Group(); m.position.set(s * 0.2, -0.08, 1.02); g.add(m);
        const base = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), sp.mat.chitin); base.scale.set(0.17, 0.3, 0.22); m.add(base);
        for (let i = 0; i < 3; i++) {
          const t = new THREE.Mesh(new THREE.ConeGeometry(0.07 - i * 0.015, 0.5 - i * 0.1, 8), sp.mat.leg);
          t.position.set(-s * 0.04 * i, -0.35 - i * 0.05, 0.22 + i * 0.08); t.rotation.set(0.7 + i * 0.15, 0, s * 0.3); m.add(t);
        }
        sp.mawJaws.push(m);
      }
      sp.mounts.maw.add(g);
      return () => { sp.mounts.maw.remove(g); sp.mawJaws.length = 0; for (const f of sp.fangs) f.visible = true; };
    },
    power: (sp, ctx) => sp.strike(ctx.people, { max: 1, kind: 'devour' }) > 0,
  },
  quills: {
    slot: 'abdomen', name: 'Rear quills',
    text: 'Automatic: spines fire from your abdomen at anyone behind you. Walls stop them.',
    part: (sp) => { // a ridge of quills along the top and back of the abdomen, raking backwards
      const g = new THREE.Group(), geo = new THREE.ConeGeometry(0.05, 0.85, 6).translate(0, 0.425, 0);
      const bone = new THREE.MeshStandardMaterial({ color: 0xd2c2a8, roughness: 0.45 }); // pale bone: the mutation has to read at a glance
      sp.quillMeshes = [];
      for (let i = 0; i < 26; i++) {
        const u = (i % 13) / 12, side = i < 13 ? -1 : 1;
        const q = new THREE.Mesh(geo, bone);
        const a = 0.25 + u * 1.75; // over the abdomen (an ellipsoid, 0.78 x 0.62 x 1.05), from the top round to the back
        q.position.set(side * (0.16 + 0.1 * Math.sin(u * 3)), 0.6 * Math.cos(a), -1.0 * Math.sin(a));
        q.rotation.set(-(a + 0.55), 0, side * 0.3); // pointing out and back
        q.castShadow = true;
        g.add(q); sp.quillMeshes.push(q);
      }
      sp.mounts.abdomen.add(g);
      return () => { sp.mounts.abdomen.remove(g); sp.quillMeshes = []; };
    },
    auto: (sp, ctx, dt, st) => {
      st.t = (st.t || 0) - dt;
      if (st.t > 0) return;
      // up to three people behind (within 65 degrees of straight back), in range, with a clear line
      const bx = -Math.sin(sp.heading), bz = -Math.cos(sp.heading);
      const from = _F.set(0, 0.6, -2.0).applyMatrix4(sp.root.matrixWorld);
      const targets = ctx.people.list.filter((h) => ctx.people.alive(h)).map((h) => {
        const dx = h.x - sp.pos.x, dz = h.z - sp.pos.z, d = Math.hypot(dx, dz);
        return { h, d, cos: (dx * bx + dz * bz) / (d || 1) };
      }).filter((o) => o.d < 15 && o.cos > Math.cos(65 * Math.PI / 180)
        && ctx.world.shotHit(from, _T.set(o.h.x, 1.4, o.h.z)) < 0).sort((a, b) => a.d - b.d).slice(0, 3);
      if (!targets.length) { st.t = 0.2; return; }
      st.t = 1.3;
      for (const o of targets) ctx.quills.fire(from, o.h);
      if (targets.length) sfx('quill');
    },
  },
  pounce: {
    slot: 'forelegs', name: 'Pounce', cooldown: 10,
    text: 'E: leap to the cursor (up to 11 m) and come down hard: everyone there is hit and stunned.',
    part: (sp) => { // hooked bone spurs on the front legs
      const added = [];
      for (const l of sp.legs) {
        if (l.k > 1) continue;
        for (const [y, sc] of [[0.6, 1], [1.4, 0.8]]) {
          const spur = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.45 * sc, 7).translate(0, 0.22 * sc, 0), sp.mat.leg);
          spur.position.set(0.09 * l.s, y, 0.05); spur.rotation.set(-0.5, 0, -0.9 * l.s);
          l.tibia.add(spur); added.push([l.tibia, spur]);
        }
      }
      return () => { for (const [p, c] of added) p.remove(c); };
    },
    power: (sp, ctx) => sp.pounce(ctx.aim.x, ctx.aim.z),
  },
};

// The run's mutation state: which slot holds what, cooldowns, auto-power state, and the quills in flight.
export class Mutations {
  constructor(scene, spider, fx) {
    this.spider = spider;
    this.have = {};        // slot -> mutation id
    this.cd = {};          // slot -> seconds until ready
    this.st = {};          // slot -> scratch state for auto powers
    this.undo = {};
    this.quills = new Quills(scene, fx);
  }

  // up to n mutations for empty slots, each a different slot (random order)
  offer(n = 3, R = Math.random) {
    const free = Object.entries(MUTATIONS).filter(([, m]) => !this.have[m.slot]);
    const bySlot = new Map();
    for (const [id, m] of free.sort(() => R() - 0.5)) if (!bySlot.has(m.slot)) bySlot.set(m.slot, id);
    return [...bySlot.values()].slice(0, n);
  }

  take(id) {
    const m = MUTATIONS[id];
    this.undo[m.slot]?.();
    this.have[m.slot] = id;
    this.cd[m.slot] = 0;
    this.undo[m.slot] = m.part(this.spider);
  }

  // a slot's key pressed: use its power if it has one and it's ready
  trigger(slot, ctx) {
    const id = this.have[slot], m = id && MUTATIONS[id];
    if (!m || !m.power || this.cd[slot] > 0) return false;
    if (m.power(this.spider, ctx)) { this.cd[slot] = m.cooldown; return true; }
    return false;
  }

  update(dt, ctx) {
    for (const slot in this.cd) this.cd[slot] = Math.max(0, this.cd[slot] - dt);
    for (const [slot, id] of Object.entries(this.have)) {
      const m = MUTATIONS[id];
      if (m.auto && typeof m.auto === 'function') m.auto(this.spider, ctx, dt, (this.st[slot] ||= {}));
    }
    this.quills.update(dt, ctx);
  }
}

// Quills in flight: thin spines that home on their target, stop on concrete, hit for 1.5.
class Quills {
  constructor(scene, fx) {
    this.fx = fx;
    this.list = [];
    this.mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 1.1, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.35, emissive: 0x6a3020, emissiveIntensity: 0.8 }), 64);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    scene.add(this.mesh);
  }
  fire(from, h) {
    const v = new THREE.Vector3(h.x - from.x, 1.2 - from.y + 2.5, h.z - from.z).normalize().multiplyScalar(26); // up and out first
    this.list.push({ p: from.clone(), v, h, life: 1.6 });
    this.fx.burst(from, 'trail', 4, null, 0.6); this.fx.burst(from, 'spark', 3, v.clone().normalize(), 0.4);
  }
  update(dt, ctx) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);
    let n = 0;
    for (const s of this.list) {
      s.life -= dt;
      const t = _T.set(s.h.x, s.h.y + 1.3, s.h.z);
      const want = t.sub(s.p).normalize().multiplyScalar(30);
      s.v.lerp(want, Math.min(1, dt * 7)); // homing
      const next = _F.copy(s.p).addScaledVector(s.v, dt);
      if (ctx.world.shotHit(s.p, next) >= 0 || ctx.world.heightAt(next.x, next.z) > next.y) { // into concrete
        this.fx.impact(next, _D.copy(s.v).normalize().negate()); s.life = 0;
      } else if (ctx.people.alive(s.h) && next.distanceTo(_G.set(s.h.x, s.h.y + 1.2, s.h.z)) < 0.7) {
        ctx.people.hit(s.h, 1.5, s.v); s.life = 0;
      }
      s.p.copy(next);
      if (s.life > 0) { this.fx.dot(s.p, 'trail', null); this.fx.dot(s.p, 'spark', null); } // the trail it leaves
      if (s.life > 0 && n < 64) { q.setFromUnitVectors(Z, _D.copy(s.v).normalize()); m.compose(s.p, q, _S.set(1, 1, 1)); this.mesh.setMatrixAt(n++, m); }
    }
    this.list = this.list.filter((s) => s.life > 0);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const _F = new THREE.Vector3(), _T = new THREE.Vector3(), _G = new THREE.Vector3(), _D = new THREE.Vector3(), _S = new THREE.Vector3();
