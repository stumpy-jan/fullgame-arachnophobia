// Path maps over the world's walk grid (world.nav), after the "Dijkstra map" technique:
//   toSpider  walking distance (in cells) from every open cell to the spider, round walls and props
//   flee      a map to run down: -1.3 x toSpider, then relaxed again, so its slopes lead round the walls
//             and out through doors to safety rather than into the nearest corner
// People walk downhill on them (descend). Rebuilt a few times a second as the spider moves.
const SQ2 = Math.SQRT2;

export class PathMaps {
  constructor(nav) {
    this.nav = nav;
    const n = nav.nx * nav.nz;
    this.toSpider = new Float32Array(n);
    this.flee = new Float32Array(n);
    this.heap = new Heap(n * 8);
  }

  // the open cell nearest a point (the spider may stand on a wall or a bench)
  nearestOpen(x, z) {
    const { nav } = this;
    for (let r = 0; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const j = nav.index(x + dx * nav.cell, z + dz * nav.cell);
        if (j >= 0 && nav.pass[j]) return j;
      }
    }
    return -1;
  }

  update(sx, sz) {
    const { toSpider, flee, nav } = this;
    toSpider.fill(Infinity);
    const src = this.nearestOpen(sx, sz);
    if (src < 0) return;
    toSpider[src] = 0;
    this.relax(toSpider);
    for (let i = 0; i < flee.length; i++) flee[i] = nav.pass[i] && toSpider[i] < Infinity ? -1.3 * toSpider[i] : Infinity;
    this.relax(flee);
  }

  // Dijkstra from every finite cell (8 neighbours; diagonals only where both sides are open)
  relax(d) {
    const { nav, heap } = this, { nx, nz, pass } = nav;
    heap.clear();
    for (let i = 0; i < d.length; i++) if (d[i] < Infinity) heap.push(i, d[i]);
    while (heap.size) {
      const c = heap.topKey, i = heap.pop();
      if (c > d[i]) continue;
      const x = i % nx, z = (i - x) / nx;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const X = x + dx, Z = z + dz;
        if (X < 0 || Z < 0 || X >= nx || Z >= nz) continue;
        const j = Z * nx + X;
        if (!pass[j]) continue;
        if (dx && dz && (!pass[z * nx + X] || !pass[Z * nx + x])) continue;
        const nc = c + (dx && dz ? SQ2 : 1);
        if (nc < d[j]) { d[j] = nc; heap.push(j, nc); }
      }
    }
  }

  // the neighbouring cell lowest on map m (or the cell itself, if it's a pit)
  descend(m, j) {
    const { nx, nz, pass } = this.nav;
    const x = j % nx, z = (j - x) / nx;
    let best = j, bv = m[j];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Z = z + dz;
      if (X < 0 || Z < 0 || X >= nx || Z >= nz) continue;
      const k = Z * nx + X;
      if (!pass[k] || (dx && dz && (!pass[z * nx + X] || !pass[Z * nx + x]))) continue;
      if (m[k] < bv) { bv = m[k]; best = k; }
    }
    return best;
  }
}

// a binary min-heap of (index, key), duplicates allowed
class Heap {
  constructor(cap) { this.idx = new Int32Array(cap); this.key = new Float32Array(cap); this.size = 0; }
  clear() { this.size = 0; }
  get topKey() { return this.key[0]; }
  push(i, k) {
    if (this.size >= this.idx.length) return;
    let n = this.size++;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.key[p] <= k) break;
      this.idx[n] = this.idx[p]; this.key[n] = this.key[p]; n = p;
    }
    this.idx[n] = i; this.key[n] = k;
  }
  pop() {
    const top = this.idx[0], last = --this.size;
    if (last > 0) {
      const i = this.idx[last], k = this.key[last];
      let n = 0;
      for (;;) {
        let c = 2 * n + 1;
        if (c >= last) break;
        if (c + 1 < last && this.key[c + 1] < this.key[c]) c++;
        if (this.key[c] >= k) break;
        this.idx[n] = this.idx[c]; this.key[n] = this.key[c]; n = c;
      }
      this.idx[n] = i; this.key[n] = k;
    }
    return top;
  }
}
