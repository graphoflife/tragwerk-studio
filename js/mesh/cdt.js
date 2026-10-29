// Tragwerk Studio – 2D constrained Delaunay triangulation for the domain mesher.
//
// Bowyer–Watson insertion (super triangle, walking point location), constraint recovery by edge
// flips (Sloan), inside/outside classification by boundary parity flood fill, optional Delaunay
// refinement (circumcentre insertion, constraint segments are never split) and Laplacian smoothing.
// Interior points are generated on a jittered equilateral lattice.
//
// Input points keep their indices (0..n-1) in the output; generated points are appended.

const SUPER = 3; // number of super-triangle vertices (mesh indices 0..2)

function growF64(a, n) { const b = new Float64Array(n); b.set(a); return b; }
function growI32(a, n, fill) { const b = new Int32Array(n); b.set(a); if (fill !== undefined) b.fill(fill, a.length); return b; }
function growU8(a, n) { const b = new Uint8Array(n); b.set(a); return b; }
function growI8(a, n) { const b = new Int8Array(n); b.set(a); return b; }

class TriMesh {
  constructor(pcap) {
    pcap = Math.max(64, pcap | 0);
    this.pcap = pcap; this.np = 0;
    this.px = new Float64Array(pcap); this.py = new Float64Array(pcap);
    this.vt = new Int32Array(pcap).fill(-1);
    this.ps = new Int32Array(pcap); this.pst = 0;          // vertex stamps
    this.sMap = new Int32Array(pcap); this.eMap = new Int32Array(pcap);
    const tcap = 2 * pcap + 64;
    this.tcap = tcap; this.nt = 0; this.free = [];
    this.V = new Int32Array(3 * tcap); this.N = new Int32Array(3 * tcap); this.C = new Uint8Array(3 * tcap);
    this.alive = new Uint8Array(tcap); this.ins = new Int8Array(tcap); this.mark = new Int32Array(tcap);
    this.stamp = 0; this.last = -1; this.rnd = 12345;
    this.newTris = [];
  }

  ensureP(k) {
    if (this.np + k <= this.pcap) return;
    let n = this.pcap * 2; while (n < this.np + k) n *= 2;
    this.px = growF64(this.px, n); this.py = growF64(this.py, n);
    this.vt = growI32(this.vt, n, -1); this.ps = growI32(this.ps, n);
    this.sMap = growI32(this.sMap, n); this.eMap = growI32(this.eMap, n);
    this.pcap = n;
  }

  ensureT(k) {
    if (this.nt + k <= this.tcap) return;
    let n = this.tcap * 2; while (n < this.nt + k) n *= 2;
    this.V = growI32(this.V, 3 * n); this.N = growI32(this.N, 3 * n); this.C = growU8(this.C, 3 * n);
    this.alive = growU8(this.alive, n); this.ins = growI8(this.ins, n); this.mark = growI32(this.mark, n);
    this.tcap = n;
  }

  addPoint(x, y) {
    this.ensureP(1);
    const i = this.np++;
    this.px[i] = x; this.py[i] = y;
    return i;
  }

  /** Create triangle (capacity must have been ensured). */
  makeTri(a, b, c) {
    const t = this.free.length ? this.free.pop() : this.nt++;
    const k = 3 * t, V = this.V, N = this.N, C = this.C;
    V[k] = a; V[k + 1] = b; V[k + 2] = c;
    N[k] = N[k + 1] = N[k + 2] = -1;
    C[k] = C[k + 1] = C[k + 2] = 0;
    this.alive[t] = 1; this.ins[t] = 0; this.mark[t] = 0;
    this.vt[a] = t; this.vt[b] = t; this.vt[c] = t;
    return t;
  }

  /** Orientation of vertices a,b,c (evaluated in canonical index order → consistent signs). */
  orient(a, b, c) {
    const px = this.px, py = this.py;
    let s = 1, t;
    if (a > b) { t = a; a = b; b = t; s = -s; }
    if (b > c) { t = b; b = c; c = t; s = -s; }
    if (a > b) { t = a; a = b; b = t; s = -s; }
    return s * ((px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]));
  }

  inCircle(t, x, y) {
    const k = 3 * t, V = this.V, px = this.px, py = this.py;
    const a = V[k], b = V[k + 1], c = V[k + 2];
    const adx = px[a] - x, ady = py[a] - y, bdx = px[b] - x, bdy = py[b] - y, cdx = px[c] - x, cdy = py[c] - y;
    const ad = adx * adx + ady * ady, bd = bdx * bdx + bdy * bdy, cd = cdx * cdx + cdy * cdy;
    return adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
  }

  anyAlive() {
    for (let t = this.nt - 1; t >= 0; t--) if (this.alive[t]) return t;
    return -1;
  }

  /** Walk to the triangle containing (x,y). -1: outside, -2: blocked by a constraint (constrained mode). */
  locate(x, y, start, constrained) {
    let t = start;
    if (t < 0 || !this.alive[t]) t = this.last;
    if (t < 0 || !this.alive[t]) t = this.anyAlive();
    if (t < 0) return -1;
    const V = this.V, N = this.N, C = this.C, px = this.px, py = this.py;
    const maxIter = 3 * this.nt + 100;
    for (let it = 0; it < maxIter; it++) {
      const k = 3 * t;
      this.rnd = (Math.imul(this.rnd, 1103515245) + 12345) >>> 0;
      const r = (this.rnd >>> 16) % 3;
      let next = -1;
      for (let e = 0; e < 3; e++) {
        const i = (r + e) % 3;
        const a = V[k + i], b = V[k + (i === 2 ? 0 : i + 1)];
        // evaluate with a canonical vertex order so that both triangles sharing the edge agree
        const o = a < b
          ? (px[b] - px[a]) * (y - py[a]) - (py[b] - py[a]) * (x - px[a])
          : -((px[a] - px[b]) * (y - py[b]) - (py[a] - py[b]) * (x - px[b]));
        if (o < 0) {
          if (constrained && C[k + i]) return -2;
          next = N[k + i];
          if (next < 0) return -1;
          break;
        }
      }
      if (next < 0) return t;
      t = next;
    }
    return -1;
  }

  /**
   * Bowyer–Watson insertion. Unconstrained mode: returns new index or the index of a coincident
   * existing vertex; constrained (refinement) mode: cavity bounded by constraint edges, inside
   * triangles only, rejects encroaching points; returns -1 on failure.
   */
  insert(x, y, start, constrained) {
    const t0 = this.locate(x, y, start, constrained);
    if (t0 < 0) return -1;
    if (constrained && this.ins[t0] !== 1) return -1;
    let V = this.V, N = this.N, C = this.C, mark = this.mark;
    const px = this.px, py = this.py;
    const k0 = 3 * t0;
    for (let e = 0; e < 3; e++) {
      const v = V[k0 + e];
      const dx = px[v] - x, dy = py[v] - y;
      if (dx * dx + dy * dy < 1e-22) return constrained ? -1 : v;
    }
    let stamp = ++this.stamp;
    let cavity = [t0];
    mark[t0] = stamp;
    for (let h = 0; h < cavity.length; h++) {
      const t = cavity[h], k = 3 * t;
      for (let i = 0; i < 3; i++) {
        if (constrained && C[k + i]) continue;
        const n = N[k + i];
        if (n < 0 || mark[n] === stamp) continue;
        if (this.inCircle(n, x, y) > 0) { mark[n] = stamp; cavity.push(n); }
      }
    }
    // make the cavity star-shaped w.r.t. the new point (round-off safety)
    for (let guard = 0; guard < 50; guard++) {
      let changed = false;
      for (let h = 0; h < cavity.length && !changed; h++) {
        const t = cavity[h];
        if (mark[t] !== stamp) continue;
        const k = 3 * t;
        for (let i = 0; i < 3; i++) {
          const n = N[k + i];
          if (n >= 0 && mark[n] === stamp && !(constrained && C[k + i])) continue;
          const a = V[k + i], b = V[k + (i === 2 ? 0 : i + 1)];
          const ex = px[b] - px[a], ey = py[b] - py[a];
          const o = ex * (y - py[a]) - ey * (x - px[a]);
          if (o <= 1e-12 * (ex * ex + ey * ey)) {
            if (t === t0) {
              if (n >= 0 && !(constrained && C[k + i]) && mark[n] !== stamp) { mark[n] = stamp; cavity.push(n); changed = true; break; }
              return -1;
            }
            mark[t] = 0; changed = true; break;
          }
        }
      }
      if (!changed) break;
      const s2 = ++this.stamp;
      const comp = [t0];
      mark[t0] = s2;
      for (let h = 0; h < comp.length; h++) {
        const t = comp[h], k = 3 * t;
        for (let i = 0; i < 3; i++) {
          if (constrained && C[k + i]) continue;
          const n = N[k + i];
          if (n >= 0 && mark[n] === stamp) { mark[n] = s2; comp.push(n); }
        }
      }
      stamp = s2; cavity = comp;
    }
    // boundary of the cavity
    const bnd = [];
    const pst = ++this.pst, ps = this.ps;
    for (const t of cavity) {
      const k = 3 * t;
      for (let i = 0; i < 3; i++) {
        const n = N[k + i];
        const a = V[k + i], b = V[k + (i === 2 ? 0 : i + 1)];
        if (n >= 0 && mark[n] === stamp) {
          if (C[k + i]) return -1; // a constraint edge would be removed
          continue;
        }
        if (constrained && C[k + i]) {
          // encroachment: new point inside the diametral circle of a constrained edge
          const mx = 0.5 * (px[a] + px[b]), my = 0.5 * (py[a] + py[b]);
          const r2 = 0.25 * ((px[b] - px[a]) ** 2 + (py[b] - py[a]) ** 2);
          if ((x - mx) ** 2 + (y - my) ** 2 < r2) return -1;
        }
        bnd.push(a, b, n, C[k + i]);
        ps[a] = pst;
      }
    }
    // every cavity vertex must lie on the cavity boundary
    for (const t of cavity) {
      const k = 3 * t;
      if (ps[V[k]] !== pst || ps[V[k + 1]] !== pst || ps[V[k + 2]] !== pst) return -1;
    }
    const nb = bnd.length / 4;
    const insv = this.ins[t0];
    this.ensureT(nb + 2);
    this.ensureP(1);
    V = this.V; N = this.N; C = this.C;
    const p = this.np++;
    this.px[p] = x; this.py[p] = y;
    const alive = this.alive, ins = this.ins;
    for (const t of cavity) { alive[t] = 0; this.free.push(t); }
    const newTris = new Array(nb);
    const sMap = this.sMap, eMap = this.eMap;
    for (let e = 0; e < nb; e++) {
      const a = bnd[4 * e], b = bnd[4 * e + 1], n = bnd[4 * e + 2], c = bnd[4 * e + 3];
      const T = this.makeTri(a, b, p);
      ins[T] = insv;
      N[3 * T] = n; C[3 * T] = c;
      if (n >= 0) {
        const kn = 3 * n;
        for (let j = 0; j < 3; j++) {
          if (V[kn + j] === b && V[kn + (j === 2 ? 0 : j + 1)] === a) { N[kn + j] = T; break; }
        }
      }
      sMap[a] = T; eMap[b] = T;
      newTris[e] = T;
    }
    for (let e = 0; e < nb; e++) {
      const T = newTris[e], k = 3 * T;
      N[k + 1] = sMap[V[k + 1]];
      N[k + 2] = eMap[V[k]];
    }
    this.last = newTris[nb - 1];
    this.newTris = newTris;
    return p;
  }

  /** Triangles around vertex v. */
  fanOf(v) {
    const V = this.V, N = this.N;
    let t = this.vt[v];
    const has = (tt) => tt >= 0 && this.alive[tt] && (V[3 * tt] === v || V[3 * tt + 1] === v || V[3 * tt + 2] === v);
    if (!has(t)) {
      t = -1;
      for (let q = 0; q < this.nt; q++) if (has(q)) { t = q; break; }
      if (t < 0) return [];
      this.vt[v] = t;
    }
    const res = [];
    const start = t;
    let guard = 0;
    do {
      const k = 3 * t;
      const j = V[k] === v ? 0 : V[k + 1] === v ? 1 : 2;
      res.push(t);
      t = N[k + (j + 2) % 3];
      if (++guard > 100000) break;
    } while (t >= 0 && t !== start);
    if (t < 0) {
      t = start;
      for (;;) {
        const k = 3 * t;
        const j = V[k] === v ? 0 : V[k + 1] === v ? 1 : 2;
        const n = N[k + j];
        if (n < 0 || n === start) break;
        res.push(n); t = n;
        if (++guard > 200000) break;
      }
    }
    return res;
  }

  /** Find the edge a-b: returns [t, i] with edge i of t connecting a and b (any direction) or null. */
  findEdge(a, b) {
    const V = this.V;
    for (const t of this.fanOf(a)) {
      const k = 3 * t;
      const j = V[k] === a ? 0 : V[k + 1] === a ? 1 : 2;
      if (V[k + (j + 1) % 3] === b) return [t, j];
      if (V[k + (j + 2) % 3] === b) return [t, (j + 2) % 3];
    }
    return null;
  }

  setConstraint(t, i, flag) {
    const V = this.V, N = this.N, C = this.C;
    const k = 3 * t;
    C[k + i] = Math.max(C[k + i], flag);
    const a = V[k + i], b = V[k + (i + 1) % 3];
    const n = N[k + i];
    if (n >= 0) {
      const kn = 3 * n;
      for (let j = 0; j < 3; j++) {
        if (V[kn + j] === b && V[kn + (j + 1) % 3] === a) { C[kn + j] = Math.max(C[kn + j], flag); break; }
      }
    }
  }

  /** Flip edge i of triangle t1 (must be an interior, convex configuration). */
  flip(t1, i1) {
    const V = this.V, N = this.N, C = this.C;
    const k1 = 3 * t1;
    const u = V[k1 + i1], w = V[k1 + (i1 + 1) % 3], x = V[k1 + (i1 + 2) % 3];
    const t2 = N[k1 + i1], k2 = 3 * t2;
    let i2 = 0;
    for (; i2 < 3; i2++) if (V[k2 + i2] === w && V[k2 + (i2 + 1) % 3] === u) break;
    const y = V[k2 + (i2 + 2) % 3];
    const nWX = N[k1 + (i1 + 1) % 3], cWX = C[k1 + (i1 + 1) % 3];
    const nXU = N[k1 + (i1 + 2) % 3], cXU = C[k1 + (i1 + 2) % 3];
    const nUY = N[k2 + (i2 + 1) % 3], cUY = C[k2 + (i2 + 1) % 3];
    const nYW = N[k2 + (i2 + 2) % 3], cYW = C[k2 + (i2 + 2) % 3];
    // t1 := (u, y, x), t2 := (y, w, x)
    V[k1] = u; V[k1 + 1] = y; V[k1 + 2] = x;
    N[k1] = nUY; C[k1] = cUY; N[k1 + 1] = t2; C[k1 + 1] = 0; N[k1 + 2] = nXU; C[k1 + 2] = cXU;
    V[k2] = y; V[k2 + 1] = w; V[k2 + 2] = x;
    N[k2] = nYW; C[k2] = cYW; N[k2 + 1] = nWX; C[k2 + 1] = cWX; N[k2 + 2] = t1; C[k2 + 2] = 0;
    const fix = (n, a, b, t) => {
      if (n < 0) return;
      const kn = 3 * n;
      for (let j = 0; j < 3; j++) if (V[kn + j] === a && V[kn + (j + 1) % 3] === b) { N[kn + j] = t; return; }
    };
    fix(nUY, y, u, t1);
    fix(nWX, x, w, t2);
    const vt = this.vt;
    vt[u] = t1; vt[x] = t1; vt[y] = t1; vt[w] = t2;
  }

  /** Proper crossing of segments a-b and c-d (strict). */
  crosses(a, b, c, d) {
    const o1 = this.orient(a, b, c), o2 = this.orient(a, b, d);
    if (!((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))) return false;
    const o3 = this.orient(c, d, a), o4 = this.orient(c, d, b);
    return (o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0);
  }

  /** Enforce edge a-b (Sloan's flip algorithm). Returns true on success. */
  recoverEdge(a, b, flag) {
    let e = this.findEdge(a, b);
    if (e) { this.setConstraint(e[0], e[1], flag); return true; }
    const px = this.px, py = this.py;
    let V = this.V, N = this.N;
    const abx = px[b] - px[a], aby = py[b] - py[a];
    // starting triangle around a
    let t = -1, i = -1, r = -1, l = -1;
    for (const tt of this.fanOf(a)) {
      const k = 3 * tt;
      const j = V[k] === a ? 0 : V[k + 1] === a ? 1 : 2;
      const v1 = V[k + (j + 1) % 3], v2 = V[k + (j + 2) % 3];
      const o1 = this.orient(a, b, v1), o2 = this.orient(a, b, v2);
      if (o1 === 0 && (px[v1] - px[a]) * abx + (py[v1] - py[a]) * aby > 0) return false;
      if (o2 === 0 && (px[v2] - px[a]) * abx + (py[v2] - py[a]) * aby > 0) return false;
      if (o1 < 0 && o2 > 0) { t = tt; i = (j + 1) % 3; r = v1; l = v2; break; }
    }
    if (t < 0) return false;
    const queue = [];
    for (let guard = 0; ; guard++) {
      if (guard > 1000000) return false;
      queue.push(r, l);
      const n = N[3 * t + i];
      if (n < 0) return false;
      const kn = 3 * n;
      let jn = 0;
      for (; jn < 3; jn++) if (V[kn + jn] === l && V[kn + (jn + 1) % 3] === r) break;
      if (jn === 3) return false;
      const x = V[kn + (jn + 2) % 3];
      if (x === b) break;
      const ox = this.orient(a, b, x);
      if (ox < 0) { r = x; i = (jn + 2) % 3; } else if (ox > 0) { l = x; i = (jn + 1) % 3; } else return false;
      t = n;
    }
    let head = 0, iter = 0;
    const maxIter = 2000 + 200 * queue.length;
    while (head < queue.length) {
      if (++iter > maxIter) return false;
      const u = queue[head++], w = queue[head++];
      const ed = this.findEdge(u, w);
      if (!ed) continue;
      const [t1, i1] = ed;
      V = this.V; N = this.N;
      const k1 = 3 * t1;
      if (this.C[k1 + i1]) return false;
      const p0 = V[k1 + i1], p1 = V[k1 + (i1 + 1) % 3], x = V[k1 + (i1 + 2) % 3];
      const t2 = N[k1 + i1];
      if (t2 < 0) return false;
      const k2 = 3 * t2;
      let y = -1;
      for (let j = 0; j < 3; j++) if (V[k2 + j] === p1 && V[k2 + (j + 1) % 3] === p0) { y = V[k2 + (j + 2) % 3]; break; }
      if (y < 0) return false;
      const o0 = this.orient(x, y, p0), o1 = this.orient(x, y, p1);
      if (!((o0 > 0 && o1 < 0) || (o0 < 0 && o1 > 0))) { queue.push(u, w); continue; }
      this.flip(t1, i1);
      if ((x === a && y === b) || (x === b && y === a)) continue;
      if (this.crosses(a, b, x, y)) queue.push(x, y);
    }
    e = this.findEdge(a, b);
    if (!e) return false;
    this.setConstraint(e[0], e[1], flag);
    return true;
  }

  /** Mark triangles inside the domain (ins = 1) by parity of crossed boundary edges (C === 2). */
  classify() {
    const V = this.V, N = this.N, C = this.C, ins = this.ins, alive = this.alive;
    const q = [];
    for (let t = 0; t < this.nt; t++) {
      if (!alive[t]) continue;
      const k = 3 * t;
      if (V[k] < SUPER || V[k + 1] < SUPER || V[k + 2] < SUPER) { ins[t] = 0; q.push(t); } else ins[t] = -1;
    }
    for (let h = 0; h < q.length; h++) {
      const t = q[h], k = 3 * t;
      for (let i = 0; i < 3; i++) {
        const n = N[k + i];
        if (n < 0 || !alive[n] || ins[n] !== -1) continue;
        ins[n] = ins[t] ^ (C[k + i] === 2 ? 1 : 0);
        q.push(n);
      }
    }
    for (let t = 0; t < this.nt; t++) {
      if (!alive[t]) continue;
      const k = 3 * t;
      if (ins[t] === -1) ins[t] = 0;
      if (V[k] < SUPER || V[k + 1] < SUPER || V[k + 2] < SUPER) ins[t] = 0;
    }
  }
}

/** Uniform bucket grid over a bounding box (CSR built in two passes). */
class Buckets {
  constructor(minX, minY, maxX, maxY, cell) {
    this.cell = cell;
    this.minX = minX; this.minY = minY;
    this.gx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.gy = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
    this.items = []; // [id, ix0, iy0, ix1, iy1]
  }
  cx(x) { return Math.min(this.gx - 1, Math.max(0, Math.floor((x - this.minX) / this.cell))); }
  cy(y) { return Math.min(this.gy - 1, Math.max(0, Math.floor((y - this.minY) / this.cell))); }
  add(id, x0, y0, x1, y1) { this.items.push(id, this.cx(x0), this.cy(y0), this.cx(x1), this.cy(y1)); }
  build() {
    const nC = this.gx * this.gy;
    const cnt = new Int32Array(nC + 1);
    const it = this.items;
    for (let m = 0; m < it.length; m += 5) {
      for (let iy = it[m + 2]; iy <= it[m + 4]; iy++) for (let ix = it[m + 1]; ix <= it[m + 3]; ix++) cnt[iy * this.gx + ix + 1]++;
    }
    for (let c = 0; c < nC; c++) cnt[c + 1] += cnt[c];
    const fill = cnt.slice(0, nC);
    const data = new Int32Array(cnt[nC]);
    for (let m = 0; m < it.length; m += 5) {
      for (let iy = it[m + 2]; iy <= it[m + 4]; iy++) for (let ix = it[m + 1]; ix <= it[m + 3]; ix++) data[fill[iy * this.gx + ix]++] = it[m];
    }
    this.start = cnt; this.data = data; this.items = null;
  }
}

function hash01(i, j, s) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Triangulate a 2D domain.
 * @param {object} o
 * @param {ArrayLike<number>} o.xs, o.ys        input point coordinates (fixed points)
 * @param {number[]} o.boundaryEdges           flat pairs of input indices (outer + hole boundary, coarse)
 * @param {number[]} o.constraintEdges         flat pairs (internal constraint segments)
 * @param {number[]} o.isolated                input indices of isolated fixed points
 * @param {number}   o.H                       target triangle edge length
 * @returns {{x:Float64Array, y:Float64Array, nInput:number, tris:Int32Array, warnings:string[]}}
 */
export function triangulateDomain(o) {
  const { xs, ys } = o;
  const nIn = xs.length;
  const bE = o.boundaryEdges || [], cE = o.constraintEdges || [], iso = o.isolated || [];
  const warnings = [];
  const doRefine = o.refine !== false, nSmooth = o.smooth ?? 3, doLattice = o.lattice !== false;
  // normalisation
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < nIn; i++) {
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }
  const S = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = 0.5 * (minX + maxX), cy = 0.5 * (minY + maxY);
  const Hn = o.H / S;
  const nx = new Float64Array(nIn), ny = new Float64Array(nIn);
  for (let i = 0; i < nIn; i++) { nx[i] = (xs[i] - cx) / S; ny[i] = (ys[i] - cy) / S; }
  const bx0 = (minX - cx) / S, by0 = (minY - cy) / S, bx1 = (maxX - cx) / S, by1 = (maxY - cy) / S;

  const est = Math.min(nIn + Math.ceil(2.5 * (bx1 - bx0) * (by1 - by0) / (Hn * Hn)) + 16, 1 << 21); // arrays grow on demand
  const M = new TriMesh(est + SUPER);
  M.addPoint(-100, -100); M.addPoint(100, -100); M.addPoint(0, 100);
  M.ensureT(1);
  M.makeTri(0, 1, 2);

  const map = new Int32Array(nIn); // input → mesh index
  for (let i = 0; i < nIn; i++) {
    const p = M.insert(nx[i], ny[i], M.last, false);
    if (p < 0) { warnings.push('triangulation: failed to insert input point'); map[i] = -1; continue; }
    map[i] = p;
  }
  const firstFree = M.np;

  // ---- clearance grid of all coarse edges / isolated points, and size field sources
  const cell = Math.max(Hn, 1 / 1024);
  const segs = []; // flat [a,b] in mesh indices
  for (let m = 0; m < bE.length; m += 2) segs.push(map[bE[m]], map[bE[m + 1]]);
  for (let m = 0; m < cE.length; m += 2) segs.push(map[cE[m]], map[cE[m + 1]]);
  for (const i of iso) segs.push(map[i], map[i]);
  const px = () => M.px, py = () => M.py;
  const SG = new Buckets(bx0 - cell, by0 - cell, bx1 + cell, by1 + cell, cell);
  for (let s = 0; s < segs.length; s += 2) {
    const a = segs[s], b = segs[s + 1];
    if (a < 0 || b < 0) continue;
    const X = px(), Y = py();
    SG.add(s, Math.min(X[a], X[b]), Math.min(Y[a], Y[b]), Math.max(X[a], X[b]), Math.max(Y[a], Y[b]));
  }
  SG.build();
  const clearance = (x, y, lim) => {
    const X = M.px, Y = M.py;
    const ix = SG.cx(x), iy = SG.cy(y);
    let best = Infinity;
    for (let jy = Math.max(0, iy - 1); jy <= Math.min(SG.gy - 1, iy + 1); jy++) {
      for (let jx = Math.max(0, ix - 1); jx <= Math.min(SG.gx - 1, ix + 1); jx++) {
        const c = jy * SG.gx + jx;
        for (let q = SG.start[c]; q < SG.start[c + 1]; q++) {
          const s = SG.data[q];
          const a = segs[s], b = segs[s + 1];
          const ax = X[a], ay = Y[a], dx = X[b] - ax, dy = Y[b] - ay;
          const l2 = dx * dx + dy * dy;
          let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
          if (d < best) { best = d; if (best < lim) return best; }
        }
      }
    }
    return best;
  };

  // size field: coarse points with local spacing finer than Hn
  const GRAD = 0.5;
  const spacing = new Map();
  const addSp = (v, l) => { const e = spacing.get(v); if (e) { e[0] += l; e[1]++; } else spacing.set(v, [l, 1]); };
  for (let s = 0; s < segs.length - 2 * iso.length; s += 2) {
    const a = segs[s], b = segs[s + 1];
    if (a < 0 || b < 0) continue;
    const l = Math.hypot(M.px[b] - M.px[a], M.py[b] - M.py[a]);
    addSp(a, l); addSp(b, l);
  }
  const srcV = [], srcS = [];
  for (const [v, [sum, n]] of spacing) {
    const s = sum / n;
    if (s < 0.85 * Hn) { srcV.push(v); srcS.push(s); }
  }
  let sizeAt = () => Hn;
  if (srcV.length) {
    const FG = new Buckets(bx0 - cell, by0 - cell, bx1 + cell, by1 + cell, cell);
    for (let q = 0; q < srcV.length; q++) {
      const v = srcV[q], R = (Hn - srcS[q]) / GRAD;
      FG.add(q, M.px[v] - R, M.py[v] - R, M.px[v] + R, M.py[v] + R);
    }
    FG.build();
    sizeAt = (x, y) => {
      const c = FG.cy(y) * FG.gx + FG.cx(x);
      let s = Hn;
      for (let q = FG.start[c]; q < FG.start[c + 1]; q++) {
        const id = FG.data[q], v = srcV[id];
        const val = srcS[id] + GRAD * Math.hypot(x - M.px[v], y - M.py[v]);
        if (val < s) s = val;
      }
      return s;
    };
  }

  // ---- lattice interior points
  if (doLattice && Hn > 0) {
    const dyRow = Hn * Math.sqrt(3) / 2;
    const bxy = [];
    for (let m = 0; m < bE.length; m += 2) {
      const a = map[bE[m]], b = map[bE[m + 1]];
      if (a >= 0 && b >= 0) bxy.push(M.px[a], M.py[a], M.px[b], M.py[b]);
    }
    const nRows = Math.floor((by1 - by0) / dyRow);
    const off = 0.5 * ((by1 - by0) - nRows * dyRow);
    for (let j = 0; j <= nRows; j++) {
      const y0 = by0 + off + j * dyRow;
      const xc = [];
      for (let m = 0; m < bxy.length; m += 4) {
        const ya = bxy[m + 1], yb = bxy[m + 3];
        if ((ya > y0) !== (yb > y0)) xc.push(bxy[m] + (y0 - ya) * (bxy[m + 2] - bxy[m]) / (yb - ya));
      }
      if (xc.length < 2) continue;
      xc.sort((p, q) => p - q);
      const row = [];
      for (let m = 0; m + 1 < xc.length; m += 2) {
        const xa = xc[m], xb = xc[m + 1];
        const i0 = Math.ceil((xa - bx0) / Hn - 0.5 * (j & 1)) - 1;
        for (let i = i0; ; i++) {
          const x0 = bx0 + (i + 0.5 * (j & 1)) * Hn;
          if (x0 > xb) break;
          if (x0 < xa) continue;
          const x = x0 + (hash01(i, j, 1) - 0.5) * 0.04 * Hn;
          const y = y0 + (hash01(i, j, 2) - 0.5) * 0.04 * Hn;
          if (x <= xa || x >= xb) continue;
          if (clearance(x, y, 0.6 * Hn) < 0.6 * Hn) continue;
          if (sizeAt(x, y) < 0.85 * Hn) continue;
          row.push(x, y);
        }
      }
      if (j & 1) {
        for (let m = row.length - 2; m >= 0; m -= 2) M.insert(row[m], row[m + 1], M.last, false);
      } else {
        for (let m = 0; m < row.length; m += 2) M.insert(row[m], row[m + 1], M.last, false);
      }
    }
  }

  // ---- constraint recovery
  let failed = 0;
  for (let m = 0; m < bE.length; m += 2) {
    const a = map[bE[m]], b = map[bE[m + 1]];
    if (a < 0 || b < 0 || a === b || !M.recoverEdge(a, b, 2)) failed++;
  }
  for (let m = 0; m < cE.length; m += 2) {
    const a = map[cE[m]], b = map[cE[m + 1]];
    if (a < 0 || b < 0 || a === b || !M.recoverEdge(a, b, 1)) failed++;
  }
  if (failed) warnings.push(`triangulation: ${failed} constraint edge(s) could not be recovered`);
  M.classify();

  // ---- Delaunay refinement (constraint segments are not split)
  if (doRefine) {
    const queue = [];
    for (let t = 0; t < M.nt; t++) if (M.alive[t] && M.ins[t] === 1) queue.push(t);
    const budget = 4 * M.np + 2000;
    let inserted = 0;
    const QB = 1.1; // circumradius / shortest edge (≈ 23.6° min angle)
    for (let h = 0; h < queue.length && inserted < budget; h++) {
      const t = queue[h];
      if (!M.alive[t] || M.ins[t] !== 1) continue;
      const V = M.V, X = M.px, Y = M.py, k = 3 * t;
      const a = V[k], b = V[k + 1], c = V[k + 2];
      const ax = X[a], ay = Y[a];
      const bxr = X[b] - ax, byr = Y[b] - ay, cxr = X[c] - ax, cyr = Y[c] - ay;
      const d = 2 * (bxr * cyr - byr * cxr);
      if (!(d > 0)) continue;
      const b2 = bxr * bxr + byr * byr, c2 = cxr * cxr + cyr * cyr;
      const ux = (cyr * b2 - byr * c2) / d, uy = (bxr * c2 - cxr * b2) / d;
      const R = Math.hypot(ux, uy);
      const l2 = Math.min(b2, c2, (X[c] - X[b]) ** 2 + (Y[c] - Y[b]) ** 2);
      const lmin = Math.sqrt(l2);
      const sz = sizeAt(ax + (bxr + cxr) / 3, ay + (byr + cyr) / 3);
      const big = R > 0.8 * sz;
      const skinny = R / lmin > QB && lmin > 0.2 * sz;
      if (!big && !skinny) continue;
      const p = M.insert(ax + ux, ay + uy, t, true);
      if (p < 0) continue;
      inserted++;
      for (const nt of M.newTris) queue.push(nt);
    }
  }

  // ---- Laplacian smoothing of free points
  if (nSmooth > 0 && M.np > firstFree) {
    const np = M.np, V = M.V;
    const cnt = new Int32Array(np + 1);
    const tl = [];
    for (let t = 0; t < M.nt; t++) {
      if (!M.alive[t] || M.ins[t] !== 1) continue;
      tl.push(t);
      const k = 3 * t;
      cnt[V[k] + 1]++; cnt[V[k + 1] + 1]++; cnt[V[k + 2] + 1]++;
    }
    for (let i = 0; i < np; i++) cnt[i + 1] += cnt[i];
    const fillp = cnt.slice(0, np);
    const inc = new Int32Array(cnt[np]);
    for (const t of tl) { const k = 3 * t; inc[fillp[V[k]]++] = t; inc[fillp[V[k + 1]]++] = t; inc[fillp[V[k + 2]]++] = t; }
    const X = M.px, Y = M.py;
    for (let pass = 0; pass < nSmooth; pass++) {
      for (let v = firstFree; v < np; v++) {
        const s0 = cnt[v], s1 = cnt[v + 1];
        if (s1 - s0 < 3) continue;
        let sx = 0, sy = 0, n = 0;
        for (let q = s0; q < s1; q++) {
          const k = 3 * inc[q];
          for (let e = 0; e < 3; e++) { const w = V[k + e]; if (w !== v) { sx += X[w]; sy += Y[w]; n++; } }
        }
        const minAr = () => {
          let m = Infinity;
          for (let q = s0; q < s1; q++) {
            const k = 3 * inc[q];
            const a = V[k], b = V[k + 1], c = V[k + 2];
            const ar = (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]);
            if (ar < m) m = ar;
          }
          return m;
        };
        const ox = X[v], oy = Y[v];
        const before = minAr();
        X[v] = sx / n; Y[v] = sy / n;
        const after = minAr();
        if (!(after > 0.5 * before && after > 0)) { X[v] = ox; Y[v] = oy; }
      }
    }
  }

  // ---- output
  const outIdx = new Int32Array(M.np).fill(-1);
  for (let i = 0; i < nIn; i++) if (map[i] >= 0 && outIdx[map[i]] < 0) outIdx[map[i]] = i;
  let nOut = nIn;
  const tris = [];
  const V = M.V;
  for (let t = 0; t < M.nt; t++) {
    if (!M.alive[t] || M.ins[t] !== 1) continue;
    const k = 3 * t;
    for (let e = 0; e < 3; e++) {
      const v = V[k + e];
      if (outIdx[v] < 0) outIdx[v] = nOut++;
      tris.push(outIdx[v]);
    }
  }
  const X = new Float64Array(nOut), Y = new Float64Array(nOut);
  for (let i = 0; i < nIn; i++) { X[i] = xs[i]; Y[i] = ys[i]; }
  for (let v = SUPER; v < M.np; v++) {
    const q = outIdx[v];
    if (q >= nIn) { X[q] = M.px[v] * S + cx; Y[q] = M.py[v] * S + cy; }
  }
  const inputMap = new Int32Array(nIn);
  for (let i = 0; i < nIn; i++) inputMap[i] = map[i] >= 0 ? outIdx[map[i]] : -1;
  return { x: X, y: Y, nInput: nIn, tris: Int32Array.from(tris), inputMap, warnings };
}
