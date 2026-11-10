import * as THREE from 'three';

// Draws many rigs (the sculpted people: Object3D skeletons with meshes on them, never added to the scene)
// as instanced batches: one InstancedMesh per (shared geometry, material look), filled every frame from
// each rig's world matrices, with each mesh's own colour as the instance colour. So 40 people of ~30
// parts each cost one draw call per part type, not 1,200.
export class RigRenderer {
  constructor(scene, capacity) {
    this.scene = scene;
    this.cap = capacity;
    this.batches = new Map();
  }

  batch(mesh) {
    const m = mesh.material;
    const key = `${mesh.geometry.uuid}|${m.type}|${m.roughness}|${m.metalness}|${m.normalMap?.uuid}|${m.map?.uuid}|${m.side}|${m.transparent}|${m.blending}|${m.emissive?.getHexString()}|${m.emissiveIntensity}`;
    let b = this.batches.get(key);
    if (!b) {
      const mat = m.clone();
      mat.color.setRGB(1, 1, 1); // the instance colour carries each person's colour (it multiplies this)
      const im = new THREE.InstancedMesh(mesh.geometry, mat, this.cap);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = !mat.transparent; im.receiveShadow = !mat.transparent;
      this.scene.add(im);
      b = { im, n: 0 };
      this.batches.set(key, b);
    }
    return b;
  }

  begin() { for (const b of this.batches.values()) b.n = 0; }

  add(group) {
    group.updateMatrixWorld(true);
    group.traverseVisible((o) => {
      if (!o.isMesh) return;
      const b = this.batch(o);
      if (b.n >= this.cap) return;
      b.im.setMatrixAt(b.n, o.matrixWorld);
      b.im.setColorAt(b.n, o.material.color);
      b.n++;
    });
  }

  end() {
    for (const b of this.batches.values()) {
      b.im.count = b.n;
      b.im.instanceMatrix.needsUpdate = true;
      if (b.im.instanceColor) b.im.instanceColor.needsUpdate = true;
    }
  }
}
