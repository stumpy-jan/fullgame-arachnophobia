// The kinds of people in the lab: data only (bodies.js draws them, people.js runs them).
// colours are sRGB hex; parts a kind doesn't list aren't drawn for it.
export const TYPES = {
  // harmless: work at their benches until the spider comes, then run for it
  scientist: {
    speed: 4.6, wander: 0.9, panicAt: 22, fight: false,
    colors: { torso: 0xd9dbd6, coat: 0xd9dbd6, arm: 0xd9dbd6, leg: 0x2c3242, head: 0x3a2a1e },
    parts: ['torso', 'coat', 'head', 'leg', 'arm'],
  },
  // soldiers in hazmat suits: hold their distance, shoot when they have a clear line, close in when they don't
  soldier: {
    speed: 3.8, wander: 0.6, panicAt: 7, fight: true, range: 26, burst: 4, shotGap: 0.09, rest: [1.2, 2.2], damage: 0.6, accuracy: 0.55,
    colors: { torso: 0xc2961f, arm: 0xc2961f, leg: 0xb08718, head: 0xa98319, tank: 0x5d6266, visor: 0x050608, gun: 0x15171a },
    parts: ['torso', 'head', 'leg', 'arm', 'tank', 'visor', 'gun'],
  },
};
