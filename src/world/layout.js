import { rng } from '../util.js';

// A level layout: plain data, nothing but numbers and names, so a procedural generator can make one.
//   bounds   the outer walls' centre lines
//   rooms    named rectangles with a type (for floors, props and who spawns there)
//   walls    dividing walls, axis-aligned centre lines; `outer: true` for the shell (holds the spider in).
//            Columns go at every wall end automatically. Doorways are just gaps between walls.
//   pieces   everything else, each { type, ...params } with type a builder in kit.js
//   people   who's in which room at the start
//   spawn    where the spider starts; route: the autopilot's tour
//
// This is the hand-made first lab:
//   x -32 .. -10            -10 .. 10              10 .. 32
//   wet lab        |                         |  machine room
//   ---- door ---- |   containment hall      |
//   server room    |   (the broken tank)     |  ---- door ----
//                  |                         |  storage

export function makeLabLayout(seed = 1337) {
  const R = rng(seed);
  const P = [];
  const add = (type, o) => P.push({ type, ...o });

  // doorways and wall markings
  add('tape', { x: -10, z: 0, across: true }); add('tape', { x: 10, z: -3, across: true });
  add('tape', { x: -21, z: 0 }); add('tape', { x: 21, z: 6 });
  for (const [x, z, text, across] of [[-10, -13, 'BAY 2', true], [-10, 13, 'BAY 3', true], [10, -14, 'BAY 4', true], [10, 13, 'BAY 5', true], [-28.5, 0, 'W-1', false], [28.5, 6, 'X-7', false]]) {
    add('stencil', { x, z, text, across });
  }

  // wet lab
  for (const z of [-17, -11, -5]) { add('bench', { x: -26, z, len: 6 }); add('bench', { x: -15.5, z, len: 6 }); }
  for (let x = -30; x < -12; x += 3.2) add('cabinet', { x, z: -20.4 });                // fume hoods
  // server room
  add('rackRow', { x: -27, z0: 4, n: 15, face: 1 }); add('rackRow', { x: -22, z0: 4, n: 15, face: -1 }); add('rackRow', { x: -17, z0: 4, n: 15, face: 1 });
  for (let x = -29; x < -12; x += 4.5) add('cabinet', { x, z: 20.6, w: 2.2, h: 1.8, d: 1.4, mat: 'crateGrey' });
  add('cable', { pts: [[-27, 14], [-25, 15], [-24, 18], [-20, 19], [-17, 14]] });
  add('cable', { pts: [[-22, 3], [-20, 1.5], [-16, 3], [-13, 6], [-12, 12]] });
  // containment hall
  add('tank', { x: -6, z: -12 }); add('tank', { x: 6, z: -12 }); add('tank', { x: 0, z: -3, broken: true });
  add('bench', { x: -4, z: 13, len: 7 }); add('bench', { x: 5, z: 13, len: 5 });
  add('gasBottles', { x: 9, z: -20.3 });
  add('drum', { x: -8.5, z: 18 }); add('drum', { x: -7.8, z: 18.5 }); add('drum', { x: -8.6, z: 19.1, color: 'blue' });
  add('cable', { pts: [[-6, -10], [-3, -6], [0, -4.5]] }); add('cable', { pts: [[6, -10], [3, -6], [1, -4.5]] });
  // machine room
  add('machine', { x: 16, z: -16 }); add('machine', { x: 26, z: -16 });
  add('cabinet', { x: 14, z: -5, w: 2.4, h: 1.6, d: 1.6 }); add('cabinet', { x: 19, z: -4, w: 2.4, h: 1.6, d: 1.6 });
  for (let i = 0; i < 6; i++) add('drum', { x: 29 + (i % 2) * 0.7, z: -6 + Math.floor(i / 2) * 0.7, color: i % 3 ? 'yellow' : 'blue' });
  // storage
  for (let gx = 0; gx < 4; gx++) for (let gz = 0; gz < 3; gz++) if (R() < 0.8) add('crateStack', { x: 14 + gx * 4.2 + (R() - 0.5), z: 10 + gz * 4 + (R() - 0.5) });
  add('drum', { x: 30, z: 20 }); add('drum', { x: 30.7, z: 19.4 });

  // lights: a few cast shadows (they cost a render each); the one over the broken tank flickers
  for (const [x, z, shadow, flicker] of [[-24, -13, 1], [-15, -6], [-24, 9, 1], [-15, 16], [0, -2, 1, 1], [0, 11, 1], [-5, -14], [6, -14], [18, -11, 1], [26, -3], [16, 12, 1], [26, 17]]) {
    add('lamp', { x, z, shadow: !!shadow, flicker: !!flicker });
  }
  add('beacon', { x: -10, z: -4, phase: 0 }); add('beacon', { x: 10, z: 1, phase: 2 }); // on the door columns

  return {
    seed,
    bounds: { x0: -32, x1: 32, z0: -22, z1: 22 },
    rooms: [
      { id: 'wetlab', type: 'lab', x0: -32, x1: -10, z0: -22, z1: 0 },
      { id: 'servers', type: 'server', x0: -32, x1: -10, z0: 0, z1: 22 },
      { id: 'containment', type: 'containment', x0: -10, x1: 10, z0: -22, z1: 22 },
      { id: 'machines', type: 'industrial', x0: 10, x1: 32, z0: -22, z1: 6 },
      { id: 'storage', type: 'storage', x0: 10, x1: 32, z0: 6, z1: 22 },
    ],
    walls: [
      { x0: -32, z0: -22, x1: 32, z1: -22, outer: true }, { x0: -32, z0: 22, x1: 32, z1: 22, outer: true },
      { x0: -32, z0: -22, x1: -32, z1: 22, outer: true }, { x0: 32, z0: -22, x1: 32, z1: 22, outer: true },
      { x0: -10, z0: -22, x1: -10, z1: -4 }, { x0: -10, z0: 4, x1: -10, z1: 22 },
      { x0: 10, z0: -22, x1: 10, z1: -7 }, { x0: 10, z0: 1, x1: 10, z1: 22 },
      { x0: -32, z0: 0, x1: -25, z1: 0 }, { x0: -17, z0: 0, x1: -10, z1: 0 },
      { x0: 10, z0: 6, x1: 17, z1: 6 }, { x0: 25, z0: 6, x1: 32, z1: 6 },
    ],
    pieces: P,
    people: [
      { type: 'scientist', room: 'wetlab', n: 10 }, { type: 'scientist', room: 'servers', n: 7 },
      { type: 'scientist', room: 'containment', n: 6 }, { type: 'scientist', room: 'storage', n: 4 },
      { type: 'soldier', room: 'machines', n: 6 }, { type: 'soldier', room: 'storage', n: 4 },
    ],
    spawn: { x: 0, z: 2.5, heading: 0 },
    route: [[0, 6], [-14, 10], [-14, -12], [-26, -12], [-26, 12], [0, 16], [27, 16], [27, -12], [0, -16], [0, 4]],
  };
}
