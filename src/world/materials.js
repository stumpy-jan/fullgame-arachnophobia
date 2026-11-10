import * as THREE from 'three';
import * as TX from '../textures.js';

// Every material the level kit uses, made once and shared by all the pieces.
export function createMaterials() {
  // worn paint / metal: three variants so neighbouring props don't share the same chips
  const W1 = TX.wornTextures(101), W2 = TX.wornTextures(202), W3 = TX.wornTextures(303);
  // a worn surface: colour x grime map, normal map, roughness map (x the material's roughness)
  const worn = (w, color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({
    color, map: w.map, normalMap: w.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: w.rough, roughness, metalness, ...extra,
  });
  const wallT = TX.blastWallTextures(), topT = TX.wallTopTextures();
  const rack = TX.rackTextures(), hazard = TX.hazardTexture();
  hazard.repeat.set(8 / 1.2, 1); // door tapes are 8 m long, a stripe pair every 1.2 m
  const decal = (o) => ({ polygonOffset: true, polygonOffsetFactor: o, polygonOffsetUnits: o });
  const aoMat = (t, o) => new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, opacity: o, depthWrite: false, ...decal(-1) });
  return {
    void: new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 1 }),
    wall: new THREE.MeshStandardMaterial({ map: wallT.map, normalMap: wallT.normal, roughnessMap: wallT.rough, roughness: 1, metalness: 0 }),
    wallTop: new THREE.MeshStandardMaterial({ map: topT.map, normalMap: topT.normal, roughnessMap: topT.rough, roughness: 1, metalness: 0 }),
    cabinet: worn(W1, 0x8a949a, 1.0, 0.2),                       // painted steel
    benchTop: worn(W2, 0x2a2d30, 0.7, 0.0, { normalScale: new THREE.Vector2(0.2, 0.2) }), // black resin, satin
    steel: worn(W3, 0x8d959a, 0.75, 0.8),                        // bare steel, scuffed
    darkSteel: worn(W2, 0x40464b, 0.95, 0.5),
    rackFront: new THREE.MeshStandardMaterial({ map: rack.map, emissiveMap: rack.emissive, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.6, metalness: 0.4, normalMap: W3.normal, normalScale: new THREE.Vector2(0.4, 0.4) }),
    rackSide: worn(W3, 0x24282b, 0.9, 0.4),
    crateGreen: worn(W1, 0x56623f, 1.15, 0.05),                  // army-green paint
    crateGrey: worn(W2, 0x60666a, 1.0, 0.3),
    crateWood: worn(W3, 0x8a6a45, 1.25, 0.0),
    drumYellow: worn(W1, 0xc39222, 1.0, 0.2),
    drumBlue: worn(W2, 0x29537a, 1.0, 0.2),
    hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.7, ...decal(-2) }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe8e0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 }),
    fluid: new THREE.MeshStandardMaterial({ color: 0x2a6b1a, emissive: 0x7dff3a, emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.85 }),
    ooze: new THREE.MeshStandardMaterial({ color: 0x0a1405, emissive: 0x3c9a12, emissiveIntensity: 0.12, roughness: 0.03, metalness: 0.2, ...decal(-3) }),
    cable: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 }),
    beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.04).multiplyScalar(5) }),
    aoRect: aoMat(TX.contactTexture(false), 0.8),
    aoRound: aoMat(TX.contactTexture(true), 0.85),
  };
}
