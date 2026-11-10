// The gym (?gym): one big bright hall with an obstacle course and nobody in it, for moving the spider around and
// watching how it walks. A layout like any other (layout.js has the format), so it's built by buildWorld.
//
//   z 12..17   open floor (the start): room to run and turn
//   z  8       the steps: blocks from 0.4 m to 3.2 m high, one after another
//   z  0       the walls: three dividing walls across the lane, then a tank
//   z -10      the clutter: racks, crate stacks, a drum field, a bench, a machine
export function makeGymLayout() {
  const P = [];
  const add = (type, o) => P.push({ type, ...o });

  // the steps
  [0.4, 0.8, 1.2, 1.6, 2.0, 2.6, 3.2].forEach((h, i) => {
    add('cabinet', { x: -21 + i * 6.5, z: 8, w: 2.6, h, d: 3, mat: i % 2 ? 'crateGrey' : 'cabinet' });
    add('stencil', { x: -21 + i * 6.5, z: 10.4, text: `${h.toFixed(1)} M`, across: false });
  });
  // the walls lane: the walls themselves are in `walls` below
  add('tank', { x: 15, z: 0 }); add('ring', { x: 15, z: 0, r: 2.5 });
  add('stencil', { x: -23, z: 3.6, text: 'WALLS', across: false });
  // the clutter
  add('rackRow', { x: -20, z0: -14, n: 7, face: 1 });
  add('crateStack', { x: -13, z: -9 }); add('crateStack', { x: -10, z: -12 }); add('crateStack', { x: -12, z: -15 });
  for (let i = 0; i < 12; i++) add('drum', { x: -4 + (i % 4) * 0.9, z: -11 + Math.floor(i / 4) * 0.9, color: i % 3 ? 'yellow' : 'blue' });
  add('bench', { x: 6, z: -9, len: 6 });
  add('machine', { x: 15, z: -11 });
  add('gasBottles', { x: 22, z: -16.3 });

  // lane markings
  for (const z of [5.2, -4.2]) add('paint', { x0: -25, z0: z, x1: 25, z1: z, w: 0.1, color: 0xd8d8d0 });
  for (const [x, z] of [[-18, 14], [0, 14], [18, 14]]) add('hatch', { x, z });

  // bright and even: shadows from every other lamp
  let i = 0;
  for (const z of [-11, 0, 11]) for (const x of [-18, -6, 6, 18]) add('lamp', { x, z, shadow: i++ % 2 === 0 });

  return {
    seed: 0,
    bounds: { x0: -26, x1: 26, z0: -18, z1: 18 },
    rooms: [{ id: 'gym', type: 'containment', x0: -26, x1: 26, z0: -18, z1: 18 }],
    walls: [
      { x0: -26, z0: -18, x1: 26, z1: -18, outer: true }, { x0: -26, z0: 18, x1: 26, z1: 18, outer: true },
      { x0: -26, z0: -18, x1: -26, z1: 18, outer: true }, { x0: 26, z0: -18, x1: 26, z1: 18, outer: true },
      { x0: -14, z0: -3, x1: -14, z1: 3 }, { x0: -5, z0: -3, x1: -5, z1: 3 }, { x0: 4, z0: -3, x1: 4, z1: 3 },
    ],
    pieces: P,
    people: [],
    spawn: { x: -4, z: 13.5, heading: -Math.PI / 2 },
    // the autopilot: along the steps, back through the walls, along the clutter, home
    route: [[-24, 8], [22, 8], [22, 0], [-22, 0], [-22, -10], [22, -10], [22, 14], [-4, 13.5]],
  };
}
