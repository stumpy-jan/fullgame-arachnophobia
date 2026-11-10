import * as THREE from 'three';
import { rng, clamp, damp, angleTo } from '../util.js';
import { TYPES } from './types.js';
import { PathMaps } from './pathmaps.js';
import { sculpted } from './sculpted.js';
import { RigRenderer } from './rigs.js';

// Everyone in the lab who isn't the spider. Spawned from the layout's `people` list into its rooms.
// Behaviour (by type, see types.js):
//   scientists  mill about at walking pace; once the spider is within `panicAt` metres of walking
//               distance (or they hear shooting nearby), they run downhill on the flee map: round walls,
//               out through doors, away.
//   soldiers    close in along the shortest path; once they have a clear line of fire within `range`,
//               they stop, aim and fire bursts. Concrete stops bullets (world.shotHit), so the spider
//               breaks contact by getting a wall between them. Too close (`panicAt`): they back off.
// States: 'idle' | 'flee' | 'approach' | 'aim' | 'held' (in the spider's grip) | 'dead' | 'gone'.
//
// Hooks for the spider's attacks: nearest(x, z, r, filter), grab(h), kill(h), release(h).
// Events this frame (for the game): this.events = [{ type: 'shot', from, to, hit } ...]
export class People {
  constructor(scene, world, spider, fx, seed = 7) {
    this.world = world; this.spider = spider; this.fx = fx;
    this.R = rng(seed);
    this.list = [];
    this.maps = new PathMaps(world.nav);
    this.mapT = 1;
    this.events = [];
    this.alarm = 0;          // seconds since the last shot (the scientists hear it)
    for (const g of world.layout.people) {
      const room = world.rooms.find((r) => r.id === g.room);
      for (let i = 0; i < g.n; i++) this.spawn(g.type, room);
    }
    // drawn as sculpted figures (sculpted.js, as in the zoo), batched by part (rigs.js)
    this.rigs = new RigRenderer(scene, this.list.length * 2 + 8);
    this.list.forEach((h, i) => { h.seed = i + 1; h.rig = sculpted(h.type, { seed: h.seed }); h.rig.group.rotation.order = 'YXZ'; });
    this.time = 0;
  }

  spawn(type, room) {
    const { nav } = this.world, R = this.R;
    let x = 0, z = 0;
    for (let tries = 0; tries < 200; tries++) {
      x = room.x0 + 1.5 + R() * (room.x1 - room.x0 - 3); z = room.z0 + 1.5 + R() * (room.z1 - room.z0 - 3);
      if (nav.open(x, z) && Math.hypot(x - this.spider.pos.x, z - this.spider.pos.z) > 9) break;
    }
    const h = {
      type, T: TYPES[type], x, y: 0, z, heading: R() * 6.28, vx: 0, vz: 0,
      phase: R() * 6, stride: 0, lean: 0, aim: 0, fall: 0, tilt: 0, flail: false,
      hp: type === 'soldier' ? 3 : 1, stunT: 0,
      state: 'idle', wanderT: 0, wx: x, wz: z, burst: 0, shotT: 0, cool: R() * 1.5,
    };
    this.list.push(h);
    return h;
  }

  alive(h) { return h.state !== 'dead' && h.state !== 'gone' && h.state !== 'held'; }

  // the nearest living person within r of (x, z)
  nearest(x, z, r, filter = () => true) {
    let best = null, bd = r * r;
    for (const h of this.list) {
      if (!this.alive(h) || !filter(h)) continue;
      const d = (h.x - x) ** 2 + (h.z - z) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // damage (the slash, quills, a pounce): blood, a stagger; dead at 0 hp
  hit(h, dmg, dir) {
    if (!this.alive(h)) return;
    h.hp -= dmg;
    const p = new THREE.Vector3(h.x, 1.3, h.z), d = dir ? dir.clone().setY(0).normalize() : null;
    this.fx.burst(p, 'blood', 12, d);
    if (h.hp <= 0) { this.kill(h); if (d) { h.x += d.x * 0.6; h.z += d.z * 0.6; h.heading = Math.atan2(d.x, d.z); } }
    else { h.stunT = Math.max(h.stunT, 0.35); this.alarm = 0; }
  }
  stun(h, t) { if (this.alive(h)) h.stunT = Math.max(h.stunT, t); }
  // the nearest corpse within r (for feeding)
  corpse(x, z, r) {
    let best = null, bd = r * r;
    for (const h of this.list) if (h.state === 'dead') { const d = (h.x - x) ** 2 + (h.z - z) ** 2; if (d < bd) { bd = d; best = h; } }
    return best;
  }

  grab(h) {
    h.state = 'held'; h.flail = true; h.aim = 0;
    this.fx.burst(new THREE.Vector3(h.x, h.y + 1.4, h.z), 'blood', 18);
    this.fx.stain(h.x, h.z, 0.7);
    this.alarm = 0; // a scream: everyone nearby hears it
  }
  // eaten: gone, leaving the mess
  consume(h) {
    h.state = 'gone';
    this.fx.burst(new THREE.Vector3(h.x, h.y + 1.2, h.z), 'blood', 26);
    this.fx.stain(h.x, h.z, 1.1);
  }
  release(h, kill = true) { h.flail = false; if (kill) this.kill(h); else h.state = 'flee'; }
  kill(h) {
    h.state = 'dead'; h.flail = false; h.fall = 0; h.deadT = 0;
    this.fx.stain(h.x, h.z, 0.9);
    for (let i = 0; i < 3; i++) this.fx.burst(new THREE.Vector3(h.x, 0.8, h.z), 'blood', 10);
  }

  update(dt, time) {
    const { world, spider, maps, R } = this, { nav } = world;
    this.events.length = 0;
    this.alarm += dt;
    // path maps a few times a second
    this.mapT += dt;
    if (this.mapT > 0.25) { this.mapT = 0; maps.update(spider.pos.x, spider.pos.z); }

    const target = _S.set(spider.pos.x, spider.root.position.y + 0.1, spider.pos.z); // where they aim: the body
    for (const h of this.list) {
      if (h.state === 'gone') continue;
      if (h.state === 'dead') { h.fall = Math.min(1, h.fall + dt / 0.45); h.stride = damp(h.stride, 0, 8, dt); continue; }
      if (h.state === 'held') { h.phase += dt * 9; continue; } // the spider moves it
      if (h.stunT > 0) { h.stunT -= dt; h.aim = damp(h.aim, 0, 10, dt); h.stride = damp(h.stride, 0, 10, dt); h.burst = 0; continue; } // reeling
      const T = h.T, j = nav.index(h.x, h.z);
      const walkDist = j >= 0 ? maps.toSpider[j] * nav.cell : 1e9;
      const dx = spider.pos.x - h.x, dz = spider.pos.z - h.z, dist = Math.hypot(dx, dz);

      // --- decide
      let goal = null, speed = 0, face = null;
      if (T.fight) {
        h.muzzle = this.muzzle(h, h.muzzle || new THREE.Vector3());
        const clear = dist < T.range && world.shotHit(h.muzzle, target) < 0;
        if (walkDist < T.panicAt) { h.state = 'flee'; }
        else if (clear) { h.state = 'aim'; }
        else if (walkDist < 60) { h.state = 'approach'; }
        else h.state = 'idle';
        if (h.state === 'aim') { face = Math.atan2(dx, dz); h.aim = damp(h.aim, 1, 8, dt); }
        else h.aim = damp(h.aim, 0, 6, dt);
      } else {
        if (walkDist < T.panicAt || (this.alarm < 2 && walkDist < T.panicAt * 2)) h.state = 'flee';
        else if (h.state === 'flee' && walkDist > T.panicAt * 1.6) h.state = 'idle';
      }
      if (h.state === 'flee' && j >= 0) { goal = maps.descend(maps.flee, j); speed = T.speed; }
      else if (h.state === 'approach' && j >= 0) { goal = maps.descend(maps.toSpider, j); speed = T.speed * 0.8; }
      else if (h.state === 'idle') {
        // potter about: pick a nearby open spot now and then
        h.wanderT -= dt;
        if (h.wanderT <= 0) {
          h.wanderT = 2 + R() * 4;
          const wx = h.x + (R() - 0.5) * 6, wz = h.z + (R() - 0.5) * 6;
          if (nav.open(wx, wz)) { h.wx = wx; h.wz = wz; }
        }
        if (Math.hypot(h.wx - h.x, h.wz - h.z) > 0.4) { _G.x = h.wx; _G.z = h.wz; speed = T.wander; }
      }
      if (goal !== null && goal >= 0) nav.center(goal, _G);

      // --- move: towards the goal, pushed apart from neighbours, kept on open floor
      let wantX = 0, wantZ = 0;
      if (speed > 0) {
        const gx = _G.x - h.x, gz = _G.z - h.z, gl = Math.hypot(gx, gz) || 1;
        wantX = (gx / gl) * speed; wantZ = (gz / gl) * speed;
      }
      h.vx = damp(h.vx, wantX, 6, dt); h.vz = damp(h.vz, wantZ, 6, dt);
      for (const o of this.list) { // separation
        if (o === h || !this.alive(o)) continue;
        const sx = h.x - o.x, sz = h.z - o.z, s2 = sx * sx + sz * sz;
        if (s2 < 0.49 && s2 > 1e-6) { const s = Math.sqrt(s2), k = (0.7 - s) * 6; h.vx += (sx / s) * k * dt * 10; h.vz += (sz / s) * k * dt * 10; }
      }
      const nx = h.x + h.vx * dt, nz = h.z + h.vz * dt;
      if (nav.open(nx, nz)) { h.x = nx; h.z = nz; }
      else if (nav.open(nx, h.z)) { h.x = nx; h.vz = 0; }
      else if (nav.open(h.x, nz)) { h.z = nz; h.vx = 0; }
      else { h.vx = h.vz = 0; }

      // --- animate
      const v = Math.hypot(h.vx, h.vz);
      if (face === null && v > 0.3) face = Math.atan2(h.vx, h.vz);
      if (face !== null) h.heading += clamp(angleTo(h.heading, face), -9 * dt, 9 * dt);
      h.phase += v * 3.1 * dt;
      h.stride = damp(h.stride, clamp(v / 3.5, 0, 1), 8, dt);
      h.lean = damp(h.lean, h.state === 'flee' ? 0.28 * h.stride : h.state === 'aim' ? 0.08 : 0.05, 6, dt);

      // --- shoot: bursts while aiming
      if (T.fight) this.shoot(h, dt, target, dist);
    }

    // draw everyone: pose each rig from its person's state, then batch
    this.time = time;
    this.rigs.begin();
    for (const h of this.list) {
      if (h.state === 'gone') continue;
      if (Math.abs(h.x - spider.pos.x) > 46 || Math.abs(h.z - spider.pos.z) > 34) continue; // off screen: not posed or drawn
      const r = h.rig;
      r.group.position.set(h.x, h.y, h.z);
      r.group.rotation.set(h.tilt || 0, h.heading, 0);
      r.update(time, dt, {
        phase: h.phase, stride: h.stride, aim: h.aim, lean: h.lean,
        panic: h.type === 'scientist' && h.state === 'flee' ? 1 : 0,
        fireT: time - (h.lastShot ?? -9),
        flail: h.state === 'held' ? 1 : 0,
        fall: h.state === 'dead' ? h.fall : 0,
        idle: h.state === 'idle' && h.seed % 2 ? 'look' : null,
      });
      // a laser sight ends where it hits concrete (or 16 m out)
      if (h.type === 'soldier' && h.rig.laserRay(_LA, _LD)) {
        r.group.updateMatrixWorld(true);
        h.rig.laserRay(_LA, _LD);
        const t = this.world.shotHit(_LA, _LB.copy(_LA).addScaledVector(_LD, 16));
        h.rig.laserLength(t >= 0 ? t * 16 : 16);
      }
      this.rigs.add(r.group);
    }
    this.rigs.end();
  }

  // the rifle's muzzle (from the rig's last pose; before the first, roughly at the chest)
  muzzle(h, out) {
    const m = h.rig.muzzle(out);
    if (!m || (m.x - h.x) ** 2 + (m.z - h.z) ** 2 > 4) out.set(h.x + Math.sin(h.heading) * 0.8, 1.7, h.z + Math.cos(h.heading) * 0.8);
    return out;
  }

  shoot(h, dt, target, dist) {
    const T = h.T;
    h.cool -= dt;
    if (h.state !== 'aim' || h.aim < 0.8) { h.burst = 0; return; }
    if (h.burst === 0 && h.cool <= 0) { h.burst = T.burst; h.shotT = 0; }
    if (h.burst <= 0) return;
    h.shotT -= dt;
    if (h.shotT > 0) return;
    h.shotT = T.shotGap; h.burst--;
    if (h.burst === 0) h.cool = T.rest[0] + this.R() * (T.rest[1] - T.rest[0]);
    this.alarm = 0;
    // aim at the body, with spread growing with range; concrete in the way stops it
    const spread = 0.35 + dist * 0.03;
    _A.set(target.x + (this.R() - 0.5) * spread * 2, target.y + (this.R() - 0.5) * spread, target.z + (this.R() - 0.5) * spread * 2);
    const from = this.muzzle(h, _M);
    h.lastShot = this.time;
    const t = this.world.shotHit(from, _A);
    const end = t >= 0 ? _E.lerpVectors(from, _A, t) : _E.copy(_A);
    this.fx.tracer(from, end);
    this.fx.flash(from);
    const hit = t < 0 && this.R() < T.accuracy;
    if (t >= 0) this.fx.burst(end, 'spark', 7, _D.subVectors(from, end).normalize());
    else if (hit) this.fx.burst(end, 'ichor', 6);
    this.events.push({ type: 'shot', from: from.clone(), to: end.clone(), hit, damage: hit ? T.damage : 0, blocked: t >= 0 });
  }
}

const _LA = new THREE.Vector3(), _LB = new THREE.Vector3(), _LD = new THREE.Vector3(), _S = new THREE.Vector3(), _G = new THREE.Vector3(), _A = new THREE.Vector3(), _M = new THREE.Vector3(), _E = new THREE.Vector3(), _D = new THREE.Vector3();
