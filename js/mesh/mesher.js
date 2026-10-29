// Tragwerk Studio – FE mesher (SPEC §3).
//
//   import { buildMesh } from './js/mesh/mesher.js';
//   const mesh = buildMesh(model, { meshSize?, beamDivisions? });
//
// Pipeline
//  1. All model nodes go into a point registry that merges coincident points (tol = 1e-6 × model size).
//  2. Geometric segments = model lines + domain boundary/hole edges. Extra key points are generated
//     where in-plane lines cross each other / domain edges inside a domain, and where lines pierce a
//     domain. Every segment is split at all key points lying on it → "atoms" (unique, shared pieces).
//  3. Atoms lying on a domain boundary or inside a domain are "meshed": they get ONE global, even
//     division count (from the smallest adjacent mesh size; spacing graded with growth 0.4 next to
//     finer edges meeting at an end point), so all neighbours share identical nodes.
//     Other atoms used by line elements get the line's own division count.
//  4. 4-corner domains without holes / internal lines / internal nodes and with a reasonable shape
//     get a mapped (transfinite) quad mesh (opposite side counts equalised across neighbours).
//     All other domains: constrained Delaunay triangulation of every other boundary/constraint
//     point (+ lattice interior points, refinement, smoothing), then each triangle is split into
//     3 quads → conforming all-quad mesh matching the full even edge discretisation.
//  5. Line elements are split along their atoms; releases on the first/last segment only.
//
// Deviations / additions to SPEC §3 (documented as required):
//  * `stats` additionally contains `timeMs`, `mapped` and `free` (number of mapped/free domains).
//  * Only points used by beams or shells become mesh nodes. Model nodes that are not connected to
//    any element are absent from `modelNodeToMesh` (a warning is issued if a support/load uses one).
//  * Model nodes lying inside a domain (in its plane) always become mesh nodes of that domain.
//  * `lineNodes[lineId]` lists only chain points that are mesh nodes (a geometry-only line that is
//    neither on/in a domain nor connected to elements yields an empty array).
//  * Precedence of sizes: domain.meshSize > opts.meshSize > settings.meshSize > 1;
//    element.divisions > opts.beamDivisions > settings.beamDivisions > 4.
//  * Shell elements of one domain share the same ex/ey/ez array objects.

import { sub, dot, norm, lineAxes, domainAxes, pointInPolygon2D, distPointSeg2D, segSegIntersect2D } from './geom.js';
import { triangulateDomain } from './cdt.js';

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// ------------------------------------------------------------------ point registry with merging
class Registry {
  constructor(tol) {
    this.tol = tol; this.tol2 = tol * tol; this.inv = 1 / tol;
    this.x = []; this.y = []; this.z = [];
    this.modelId = []; this.isKey = [];
    this.hash = new Map();
  }
  get n() { return this.x.length; }
  static key(ix, iy, iz) { return Math.imul(ix | 0, 73856093) ^ Math.imul(iy | 0, 19349663) ^ Math.imul(iz | 0, 83492791); }
  find(x, y, z) {
    const ix = Math.floor(x * this.inv), iy = Math.floor(y * this.inv), iz = Math.floor(z * this.inv);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = this.hash.get(Registry.key(ix + dx, iy + dy, iz + dz));
      if (!arr) continue;
      for (const id of arr) {
        const ex = this.x[id] - x, ey = this.y[id] - y, ez = this.z[id] - z;
        if (ex * ex + ey * ey + ez * ez <= this.tol2) return id;
      }
    }
    return -1;
  }
  add(x, y, z, dedupe = true) {
    if (dedupe) { const f = this.find(x, y, z); if (f >= 0) return f; }
    const id = this.x.length;
    this.x.push(x); this.y.push(y); this.z.push(z);
    this.modelId.push(0); this.isKey.push(0);
    if (dedupe) {
      const k = Registry.key(Math.floor(x * this.inv), Math.floor(y * this.inv), Math.floor(z * this.inv));
      const arr = this.hash.get(k);
      if (arr) arr.push(id); else this.hash.set(k, [id]);
    }
    return id;
  }
  p(id) { return [this.x[id], this.y[id], this.z[id]]; }
}

const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** Even division count ≥ 2 for a segment of length L with target size h. */
function evenCount(L, h) {
  let n = Math.max(1, Math.ceil(L / h - 0.15));
  if (n % 2) n++;
  return n;
}

function oneDivType(type) { return type === 'truss' || type === 'spring' || type === 'rigid'; }

/**
 * Constrained Laplacian smoothing of a 2D quad mesh (free points only). A move is accepted if the
 * worst incident element (min. sine of its corner angles) does not get worse than min(before, 0.5).
 */
function smoothQuads(X, Y, fixed, quads, passes) {
  const n = X.length;
  const cntQ = new Int32Array(n + 1);
  for (const q of quads) for (const v of q) cntQ[v + 1]++;
  for (let i = 0; i < n; i++) cntQ[i + 1] += cntQ[i];
  const fillQ = cntQ.slice(0, n), incQ = new Int32Array(cntQ[n]);
  quads.forEach((q, qi) => { for (const v of q) incQ[fillQ[v]++] = qi; });
  const nbs = new Array(n);
  for (let v = 0; v < n; v++) {
    if (fixed[v]) continue;
    const set = new Set();
    for (let k = cntQ[v]; k < cntQ[v + 1]; k++) {
      const q = quads[incQ[k]], j = q.indexOf(v);
      set.add(q[(j + 1) % 4]); set.add(q[(j + 3) % 4]);
    }
    nbs[v] = Array.from(set);
  }
  const qual = (q) => {
    let m = Infinity;
    for (let k = 0; k < 4; k++) {
      const a = q[(k + 3) % 4], b = q[k], c = q[(k + 1) % 4];
      const ux = X[b] - X[a], uy = Y[b] - Y[a], vx = X[c] - X[b], vy = Y[c] - Y[b];
      const s = (ux * vy - uy * vx) / (Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1);
      if (s < m) m = s;
    }
    return m;
  };
  const worst = (v) => {
    let m = Infinity;
    for (let k = cntQ[v]; k < cntQ[v + 1]; k++) m = Math.min(m, qual(quads[incQ[k]]));
    return m;
  };
  for (let pass = 0; pass < passes; pass++) {
    for (let v = 0; v < n; v++) {
      if (fixed[v] || !nbs[v] || nbs[v].length < 3) continue;
      let sx = 0, sy = 0;
      for (const w of nbs[v]) { sx += X[w]; sy += Y[w]; }
      const ox = X[v], oy = Y[v];
      const before = worst(v);
      X[v] = sx / nbs[v].length; Y[v] = sy / nbs[v].length;
      const after = worst(v);
      if (!(after > 0 && after >= Math.min(before, 0.5))) { X[v] = ox; Y[v] = oy; }
    }
  }
}

/** Orient quads CCW about the domain ez, drop degenerate ones, count non-convex ones. */
function orientQuads(quads, frame, X, Y, Z, minArea) {
  const { ex, ey } = frame;
  const cx = [0, 0, 0, 0], cy = [0, 0, 0, 0];
  const out = [];
  let degenerate = 0, nonConvex = 0;
  for (const qd of quads) {
    for (let k = 0; k < 4; k++) {
      const id = qd[k], x = X[id], y = Y[id], z = Z[id];
      cx[k] = x * ex[0] + y * ex[1] + z * ex[2];
      cy[k] = x * ey[0] + y * ey[1] + z * ey[2];
    }
    let area = 0;
    for (let k = 0; k < 4; k++) area += cx[k] * cy[(k + 1) & 3] - cx[(k + 1) & 3] * cy[k];
    area /= 2;
    const sg = area < 0 ? -1 : 1;
    if (sg * area <= minArea || qd[0] === qd[1] || qd[0] === qd[2] || qd[0] === qd[3] || qd[1] === qd[2] ||
      qd[1] === qd[3] || qd[2] === qd[3]) { degenerate++; continue; }
    for (let k = 0; k < 4; k++) {
      const a = (k + 3) & 3, d = (k + 1) & 3;
      if (sg * ((cx[k] - cx[a]) * (cy[d] - cy[k]) - (cy[k] - cy[a]) * (cx[d] - cx[k])) <= 0) { nonConvex++; break; }
    }
    out.push(sg > 0 ? qd : [qd[0], qd[3], qd[2], qd[1]]);
  }
  return { quads: out, degenerate, nonConvex };
}

const GRADE = 0.4; // max. growth of the element size per unit length along graded edges

/**
 * 1D size function s(x) = min(h, sa + g·x, sb + g·(L − x)) on [0, L]. Returns the cumulative
 * integral of 1/s (sampled) so that division points can be placed by inversion.
 */
function makeGrading(L, sa, sb, h) {
  const m = 256;
  const xs = new Float64Array(m + 1), F = new Float64Array(m + 1);
  const inv = (x) => 1 / Math.min(h, sa + GRADE * x, sb + GRADE * (L - x));
  let prev = inv(0);
  for (let i = 1; i <= m; i++) {
    const x = L * i / m, f = inv(x);
    xs[i] = x;
    F[i] = F[i - 1] + 0.5 * (prev + f) * (L / m);
    prev = f;
  }
  return { L, xs, F, N: F[m] };
}

/** Parameter t ∈ [0,1] where the cumulative "element count" reaches fraction q of the total. */
function gradedParam(g, q) {
  const target = q * g.N, F = g.F;
  let lo = 0, hi = F.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (F[mid] < target) lo = mid; else hi = mid; }
  const f = F[hi] > F[lo] ? (target - F[lo]) / (F[hi] - F[lo]) : 0;
  return (g.xs[lo] + f * (g.xs[hi] - g.xs[lo])) / g.L;
}

/**
 * Build the FE mesh of a model (SPEC §3).
 * @param {object} model
 * @param {{meshSize?:number, beamDivisions?:number}} [opts]
 */
export function buildMesh(model, opts = {}) {
  const T0 = nowMs();
  opts = opts || {};
  const warnings = [];
  const settings = (model && model.settings) || {};
  const defH = posNum(opts.meshSize) ?? posNum(settings.meshSize) ?? 1;
  const defDiv = Math.max(1, Math.round(posNum(opts.beamDivisions) ?? posNum(settings.beamDivisions) ?? 4));
  const mNodes = (model && model.nodes) || [];
  const mLines = (model && model.lines) || [];
  const mDoms = (model && model.domains) || [];

  // ---------------------------------------------------------------- tolerances
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const n of mNodes) {
    const c = [n.x, n.y, n.z];
    for (let k = 0; k < 3; k++) { if (c[k] < lo[k]) lo[k] = c[k]; if (c[k] > hi[k]) hi[k] = c[k]; }
  }
  const size = mNodes.length ? Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1e-3) : 1;
  const tolM = Math.max(1e-6 * size, 1e-9);
  const tolOn = 10 * tolM;
  const reg = new Registry(tolM);

  // ---------------------------------------------------------------- model nodes
  const nodeReg = new Map();
  for (const n of mNodes) {
    if (![n.x, n.y, n.z].every(Number.isFinite)) { warnings.push(`Node ${n.id}: invalid coordinates – ignored`); continue; }
    const id = reg.add(n.x, n.y, n.z);
    nodeReg.set(n.id, id);
    if (!reg.modelId[id]) reg.modelId[id] = n.id;
    else if (reg.modelId[id] !== n.id) warnings.push(`Nodes ${reg.modelId[id]} and ${n.id} coincide – merged`);
    reg.isKey[id] = 1;
  }

  // ---------------------------------------------------------------- segments
  const segs = [];
  const lineSeg = new Map();
  for (const ln of mLines) {
    const a = nodeReg.get(ln.n1), b = nodeReg.get(ln.n2);
    if (a === undefined || b === undefined) { warnings.push(`Line ${ln.id}: missing node – ignored`); continue; }
    if (a === b) { warnings.push(`Line ${ln.id}: zero length – ignored`); continue; }
    const s = { a, b, line: ln, dom: -1, atoms: null };
    segs.push(s); lineSeg.set(ln.id, s);
  }

  const doms = [];
  for (const d of mDoms) {
    const toLoop = (ids) => {
      const out = [];
      for (const nid of ids || []) {
        const r = nodeReg.get(nid);
        if (r === undefined) return null;
        if (out.length && out[out.length - 1] === r) continue;
        out.push(r);
      }
      while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
      return out;
    };
    const outer = toLoop(d.nodes);
    if (!outer || outer.length < 3) { warnings.push(`Domain ${d.id}: invalid outline (missing nodes or < 3 corners) – ignored`); continue; }
    const pts = outer.map((r) => reg.p(r));
    const ax = domainAxes(pts);
    if (!ax) { warnings.push(`Domain ${d.id}: degenerate outline – ignored`); continue; }
    const loops = [outer];
    for (const h of d.holes || []) {
      const hl = toLoop(h);
      if (!hl || hl.length < 3) { warnings.push(`Domain ${d.id}: invalid hole – ignored`); continue; }
      loops.push(hl);
    }
    const o = ax.origin;
    const D = {
      def: d, id: d.id, idx: doms.length, loops, frame: ax, h: posNum(d.meshSize) ?? defH,
      edgeSegs: [], poly2: null, bb3: null, inPlane: [], internal: [], fixed: [], structured: false, quads: null,
    };
    D.to2 = (p) => { const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]]; return [dot(v, ax.ex), dot(v, ax.ey)]; };
    D.sd = (p) => (p[0] - o[0]) * ax.ez[0] + (p[1] - o[1]) * ax.ez[1] + (p[2] - o[2]) * ax.ez[2];
    D.poly2 = loops.map((l) => l.map((r) => D.to2(reg.p(r))));
    const bl = [Infinity, Infinity, Infinity], bh = [-Infinity, -Infinity, -Infinity];
    let offPlane = 0;
    for (const l of loops) for (const r of l) {
      const p = reg.p(r);
      offPlane = Math.max(offPlane, Math.abs(D.sd(p)));
      for (let k = 0; k < 3; k++) { bl[k] = Math.min(bl[k], p[k] - tolOn); bh[k] = Math.max(bh[k], p[k] + tolOn); }
    }
    D.bb3 = [bl, bh];
    if (offPlane > Math.max(tolOn, 1e-4 * size)) warnings.push(`Domain ${d.id}: corner nodes are not planar (max deviation ${offPlane.toExponential(2)} m)`);
    loops.forEach((l, li) => {
      const es = [];
      for (let k = 0; k < l.length; k++) {
        const s = { a: l[k], b: l[(k + 1) % l.length], line: null, dom: D.idx, loop: li, atoms: null };
        segs.push(s); es.push(s);
      }
      D.edgeSegs.push(es);
    });
    doms.push(D);
  }

  /** 1 strictly inside, 0 on boundary, -1 outside (2D, domain plane). */
  const classify2 = (D, x, y) => {
    for (const poly of D.poly2) {
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        if (distPointSeg2D(x, y, a[0], a[1], b[0], b[1]) <= tolOn) return 0;
      }
    }
    if (!pointInPolygon2D(x, y, D.poly2[0])) return -1;
    for (let h = 1; h < D.poly2.length; h++) if (pointInPolygon2D(x, y, D.poly2[h])) return -1;
    return 1;
  };
  const boxOverlap = (p, q, bb) => {
    for (let k = 0; k < 3; k++) {
      if (Math.max(p[k], q[k]) < bb[0][k] || Math.min(p[k], q[k]) > bb[1][k]) return false;
    }
    return true;
  };
  const addKey = (P) => { const id = reg.add(P[0], P[1], P[2]); reg.isKey[id] = 1; return id; };

  // ---------------------------------------------------------------- generated key points (intersections)
  for (const D of doms) {
    const cand = [];
    for (const s of segs) {
      const pa = reg.p(s.a), pb = reg.p(s.b);
      if (!boxOverlap(pa, pb, D.bb3)) continue;
      const da = D.sd(pa), db = D.sd(pb);
      if (Math.abs(da) <= tolOn && Math.abs(db) <= tolOn) {
        cand.push({ s, A: D.to2(pa), B: D.to2(pb), own: s.dom === D.idx, pa, pb });
      } else if ((da > tolOn && db < -tolOn) || (da < -tolOn && db > tolOn)) {
        const t = da / (da - db);
        const P = [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]), pa[2] + t * (pb[2] - pa[2])];
        const q = D.to2(P);
        if (classify2(D, q[0], q[1]) >= 0) addKey(P);
      }
    }
    D.inPlane = cand.filter((c) => !c.own).map((c) => c.s);
    for (let i = 0; i < cand.length; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        const ci = cand[i], cj = cand[j];
        if (ci.own && cj.own) continue;
        const r = segSegIntersect2D(ci.A, ci.B, cj.A, cj.B, 1e-9);
        if (!r) continue;
        const qx = ci.A[0] + r.t * (ci.B[0] - ci.A[0]), qy = ci.A[1] + r.t * (ci.B[1] - ci.A[1]);
        if (classify2(D, qx, qy) < 0) continue;
        addKey([ci.pa[0] + r.t * (ci.pb[0] - ci.pa[0]), ci.pa[1] + r.t * (ci.pb[1] - ci.pa[1]), ci.pa[2] + r.t * (ci.pb[2] - ci.pa[2])]);
      }
    }
  }

  // ---------------------------------------------------------------- key point range queries
  const keys = [];
  for (let i = 0; i < reg.n; i++) if (reg.isKey[i]) keys.push(i);
  const coordArr = [reg.x, reg.y, reg.z];
  const sortedKeys = [0, 1, 2].map((k) => {
    const ids = keys.slice().sort((p, q) => coordArr[k][p] - coordArr[k][q]);
    return { ids, v: Float64Array.from(ids, (id) => coordArr[k][id]) };
  });
  const lowerBound = (arr, x) => { let l = 0, h = arr.length; while (l < h) { const m = (l + h) >> 1; if (arr[m] < x) l = m + 1; else h = m; } return l; };
  const upperBound = (arr, x) => { let l = 0, h = arr.length; while (l < h) { const m = (l + h) >> 1; if (arr[m] <= x) l = m + 1; else h = m; } return l; };
  const keysInBox = (bl, bh) => {
    let best = null, bestN = Infinity;
    for (let k = 0; k < 3; k++) {
      const s = sortedKeys[k];
      const i0 = lowerBound(s.v, bl[k]), i1 = upperBound(s.v, bh[k]);
      if (i1 - i0 < bestN) { bestN = i1 - i0; best = [k, i0, i1]; }
    }
    const out = [];
    const s = sortedKeys[best[0]];
    for (let q = best[1]; q < best[2]; q++) {
      const id = s.ids[q];
      const x = reg.x[id], y = reg.y[id], z = reg.z[id];
      if (x < bl[0] || x > bh[0] || y < bl[1] || y > bh[1] || z < bl[2] || z > bh[2]) continue;
      out.push(id);
    }
    return out;
  };

  // ---------------------------------------------------------------- split segments into atoms
  const atoms = new Map();
  const getAtom = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    let at = atoms.get(key);
    if (!at) {
      const pa = reg.p(a), pb = reg.p(b);
      at = { a, b, len: norm(sub(pb, pa)), lineSegs: [], meshed: false, h: Infinity, n: 1, n0: 1, pts: null };
      atoms.set(key, at);
    }
    return at;
  };
  for (const s of segs) {
    const pa = reg.p(s.a), pb = reg.p(s.b);
    const d = sub(pb, pa), L2 = dot(d, d), L = Math.sqrt(L2);
    const bl = [0, 1, 2].map((k) => Math.min(pa[k], pb[k]) - tolOn);
    const bh = [0, 1, 2].map((k) => Math.max(pa[k], pb[k]) + tolOn);
    const on = [];
    for (const id of keysInBox(bl, bh)) {
      if (id === s.a || id === s.b) continue;
      const q = reg.p(id);
      const t = dot(sub(q, pa), d) / L2;
      if (t * L <= tolOn || (1 - t) * L <= tolOn) continue;
      const e = [q[0] - pa[0] - t * d[0], q[1] - pa[1] - t * d[1], q[2] - pa[2] - t * d[2]];
      if (norm(e) <= tolOn) on.push([t, id]);
    }
    on.sort((p, q) => p[0] - q[0]);
    const chain = [s.a, ...on.map((x) => x[1]), s.b];
    s.atoms = [];
    for (let k = 0; k + 1 < chain.length; k++) {
      if (chain[k] === chain[k + 1]) continue;
      const at = getAtom(chain[k], chain[k + 1]);
      s.atoms.push({ atom: at, rev: at.a !== chain[k] });
      if (s.line) at.lineSegs.push(s);
    }
  }

  // ---------------------------------------------------------------- classify atoms per domain
  for (const D of doms) {
    const seen = new Set();
    for (const es of D.edgeSegs) for (const s of es) for (const { atom } of s.atoms) {
      seen.add(atom); atom.meshed = true; atom.h = Math.min(atom.h, D.h);
    }
    for (const s of D.inPlane) for (const { atom } of s.atoms) {
      if (seen.has(atom)) continue;
      seen.add(atom);
      const pa = reg.p(atom.a), pb = reg.p(atom.b);
      const q = D.to2([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]);
      if (classify2(D, q[0], q[1]) === 1) {
        D.internal.push(atom); atom.meshed = true; atom.h = Math.min(atom.h, D.h);
      }
    }
    for (const id of keysInBox(D.bb3[0], D.bb3[1])) {
      const p = reg.p(id);
      if (Math.abs(D.sd(p)) > tolOn) continue;
      const q = D.to2(p);
      if (classify2(D, q[0], q[1]) === 1) D.fixed.push(id);
    }
  }

  // ---------------------------------------------------------------- division counts
  // meshed atoms: uniform spacing from the smallest adjacent mesh size, graded (growth GRADE) next to
  // finer atoms meeting at the same end point
  const hv = new Map();
  for (const at of atoms.values()) {
    if (!at.meshed) continue;
    at.su = at.len / evenCount(at.len, at.h);
    for (const v of [at.a, at.b]) hv.set(v, Math.min(hv.get(v) ?? Infinity, at.su));
  }
  for (const at of atoms.values()) {
    if (at.meshed) {
      const sa = hv.get(at.a), sb = hv.get(at.b);
      if (sa >= 0.9 * at.su && sb >= 0.9 * at.su) { at.grade = null; at.n = evenCount(at.len, at.su); }
      else {
        at.grade = makeGrading(at.len, sa, sb, at.su);
        let n = Math.max(1, Math.ceil(at.grade.N - 0.15));
        if (n % 2) n++;
        at.n = n;
      }
    } else {
      let n = 1;
      for (const s of at.lineSegs) {
        const el = s.line.element;
        if (!el) continue;
        if (oneDivType(el.type)) continue;
        const div = posNum(el.divisions) ? Math.max(1, Math.round(el.divisions)) : defDiv;
        const Ls = norm(sub(reg.p(s.b), reg.p(s.a)));
        n = Math.max(n, Math.max(1, Math.round(div * at.len / Ls)));
      }
      at.n = n;
    }
    at.n0 = at.n;
  }

  // ---------------------------------------------------------------- structured (mapped) domains
  const quadShapeOK = (D) => {
    const c = D.poly2[0];
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = c[(i + 3) % 4], b = c[i], d = c[(i + 1) % 4];
      const u = [a[0] - b[0], a[1] - b[1]], v = [d[0] - b[0], d[1] - b[1]];
      const cr = u[0] * v[1] - u[1] * v[0];
      const s = Math.sign(cr);
      if (s === 0 || (sign && s !== sign)) return false;
      sign = s;
      const ang = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))))) * 180 / Math.PI;
      if (ang < 30 || ang > 150) return false;
    }
    const len = (i) => Math.hypot(c[(i + 1) % 4][0] - c[i][0], c[(i + 1) % 4][1] - c[i][1]);
    const r1 = len(0) / len(2), r2 = len(1) / len(3);
    return r1 > 0.4 && r1 < 2.5 && r2 > 0.4 && r2 < 2.5;
  };
  const structured = [];
  for (const D of doms) {
    D.structured = D.loops.length === 1 && D.loops[0].length === 4 && D.internal.length === 0 &&
      D.fixed.length === 0 && quadShapeOK(D);
    if (D.structured) {
      D.sides = D.edgeSegs[0].map((s) => s.atoms.map((x) => x.atom));
      structured.push(D);
    }
  }
  const sideSum = (side) => side.reduce((acc, a) => acc + a.n, 0);
  const sideSum0 = (side) => side.reduce((acc, a) => acc + a.n0, 0);
  for (let iter = 0, changed = true; changed && iter < 500; iter++) {
    changed = false;
    for (const D of structured) {
      if (!D.structured) continue;
      for (const [p, q] of [[0, 2], [1, 3]]) {
        const sa = sideSum(D.sides[p]), sb = sideSum(D.sides[q]);
        if (sa === sb) continue;
        const side = sa < sb ? D.sides[p] : D.sides[q];
        const target = Math.max(sa, sb);
        if (target > 3 * sideSum0(side) + 2) { D.structured = false; changed = true; break; }
        let need = target - Math.min(sa, sb);
        while (need > 0) {
          let best = side[0];
          for (const a of side) if (a.len / a.n > best.len / best.n) best = a;
          best.n += 2; need -= 2;
        }
        changed = true;
      }
    }
  }
  for (const D of structured) {
    if (D.structured && (sideSum(D.sides[0]) !== sideSum(D.sides[2]) || sideSum(D.sides[1]) !== sideSum(D.sides[3]))) D.structured = false;
  }

  // ---------------------------------------------------------------- discretise atoms
  for (const at of atoms.values()) {
    const pa = reg.p(at.a), pb = reg.p(at.b);
    at.pts = [at.a];
    for (let k = 1; k < at.n; k++) {
      const t = at.grade ? gradedParam(at.grade, k / at.n) : k / at.n;
      at.pts.push(reg.add(pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]), pa[2] + t * (pb[2] - pa[2])));
    }
    at.pts.push(at.b);
  }
  const chainOf = (s) => {
    const out = [];
    for (const { atom, rev } of s.atoms) {
      const p = rev ? atom.pts.slice().reverse() : atom.pts;
      for (let k = out.length ? 1 : 0; k < p.length; k++) out.push(p[k]);
    }
    return out;
  };

  // ---------------------------------------------------------------- domain meshing
  let nMapped = 0, nFree = 0;
  const meshMapped = (D) => {
    const sides = D.edgeSegs[0].map(chainOf);
    const n0 = sides[0].length - 1, n1 = sides[1].length - 1;
    if (sides[2].length - 1 !== n0 || sides[3].length - 1 !== n1) return null;
    const B = sides[0], R = sides[1], Tp = sides[2].slice().reverse(), Lf = sides[3].slice().reverse();
    const P = (id) => reg.p(id);
    const arc = (ch) => {
      const s = [0];
      for (let k = 1; k < ch.length; k++) s.push(s[k - 1] + norm(sub(P(ch[k]), P(ch[k - 1]))));
      const L = s[s.length - 1];
      return s.map((v) => v / L);
    };
    const sB = arc(B), sT = arc(Tp), sL = arc(Lf), sR = arc(R);
    const c0 = P(B[0]), c1 = P(B[n0]), c2 = P(R[n1]), c3 = P(Tp[0]);
    const W = n0 + 1;
    const G = new Int32Array(W * (n1 + 1));
    for (let i = 0; i <= n0; i++) { G[i] = B[i]; G[n1 * W + i] = Tp[i]; }
    for (let j = 0; j <= n1; j++) { G[j * W] = Lf[j]; G[j * W + n0] = R[j]; }
    for (let j = 1; j < n1; j++) {
      const pL = P(Lf[j]), pR = P(R[j]);
      for (let i = 1; i < n0; i++) {
        const xB = sB[i], xT = sT[i], eL = sL[j], eR = sR[j];
        const xi = (xB + eL * (xT - xB)) / (1 - (eR - eL) * (xT - xB));
        const eta = eL + xi * (eR - eL);
        const pB = P(B[i]), pT = P(Tp[i]);
        const q = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          q[k] = (1 - eta) * pB[k] + eta * pT[k] + (1 - xi) * pL[k] + xi * pR[k]
            - ((1 - xi) * (1 - eta) * c0[k] + xi * (1 - eta) * c1[k] + xi * eta * c2[k] + (1 - xi) * eta * c3[k]);
        }
        G[j * W + i] = reg.add(q[0], q[1], q[2], false);
      }
    }
    const quads = [];
    let sign = 0;
    for (let j = 0; j < n1; j++) {
      for (let i = 0; i < n0; i++) {
        const qd = [G[j * W + i], G[j * W + i + 1], G[(j + 1) * W + i + 1], G[(j + 1) * W + i]];
        const c = qd.map((id) => D.to2(P(id)));
        let s0 = 0;
        for (let k = 0; k < 4; k++) {
          const a = c[(k + 3) % 4], b = c[k], d = c[(k + 1) % 4];
          const cr = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]);
          const sg = Math.sign(cr);
          if (sg === 0 || (s0 && sg !== s0)) return null;
          s0 = sg;
        }
        if (sign && s0 !== sign) return null;
        sign = s0;
        quads.push(qd);
      }
    }
    return quads;
  };

  const meshFree = (D) => {
    const localOf = new Map();
    const ids = [], xs = [], ys = [];
    const loc = (rid) => {
      let l = localOf.get(rid);
      if (l === undefined) {
        l = ids.length; localOf.set(rid, l); ids.push(rid);
        const q = D.to2(reg.p(rid)); xs.push(q[0]); ys.push(q[1]);
      }
      return l;
    };
    const midMap = new Map();
    const ek = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
    const addChain = (pts, target) => {
      for (let m = 0; m + 2 < pts.length; m += 2) {
        const a = loc(pts[m]), b = loc(pts[m + 2]);
        target.push(a, b);
        midMap.set(ek(a, b), pts[m + 1]);
      }
    };
    const bE = [], cE = [], iso = [];
    for (const es of D.edgeSegs) for (const s of es) for (const { atom, rev } of s.atoms) addChain(rev ? atom.pts.slice().reverse() : atom.pts, bE);
    for (const atom of D.internal) addChain(atom.pts, cE);
    for (const id of D.fixed) if (!localOf.has(id)) iso.push(loc(id));
    const r = triangulateDomain({ xs, ys, boundaryEdges: bE, constraintEdges: cE, isolated: iso, H: 2 * D.h });
    for (const w of r.warnings) warnings.push(`Domain ${D.id}: ${w}`);
    // local 2D quad mesh: CDT points, then edge midpoints and centroids (tri → 3 quads)
    const nT = r.x.length;
    const qx = Array.from(r.x), qy = Array.from(r.y);
    const fixedP = new Array(nT), regOf = new Array(nT);
    for (let i = 0; i < nT; i++) { fixedP[i] = i < r.nInput; regOf[i] = i < r.nInput ? ids[i] : -1; }
    const newPt = (x, y, fixed, rid) => { qx.push(x); qy.push(y); fixedP.push(fixed); regOf.push(rid); return qx.length - 1; };
    const midLocal = new Map();
    const mid = (u, v) => {
      const k = ek(u, v);
      let m = midLocal.get(k);
      if (m !== undefined) return m;
      const rid = u < r.nInput && v < r.nInput ? midMap.get(k) : undefined;
      if (rid !== undefined) { const q = D.to2(reg.p(rid)); m = newPt(q[0], q[1], true, rid); }
      else m = newPt((qx[u] + qx[v]) / 2, (qy[u] + qy[v]) / 2, false, -1);
      midLocal.set(k, m);
      return m;
    };
    const quads = [];
    const T = r.tris;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t], b = T[t + 1], c = T[t + 2];
      const g = newPt((qx[a] + qx[b] + qx[c]) / 3, (qy[a] + qy[b] + qy[c]) / 3, false, -1);
      const mab = mid(a, b), mbc = mid(b, c), mca = mid(c, a);
      quads.push([a, mab, g, mca], [b, mbc, g, mab], [c, mca, g, mbc]);
    }
    smoothQuads(qx, qy, fixedP, quads, 4);
    const { ex, ey } = D.frame, o = D.frame.origin;
    for (let i = 0; i < qx.length; i++) {
      if (regOf[i] >= 0) continue;
      const x = qx[i], y = qy[i];
      regOf[i] = reg.add(o[0] + x * ex[0] + y * ey[0], o[1] + x * ex[1] + y * ey[1], o[2] + x * ex[2] + y * ey[2], false);
    }
    return quads.map((q) => q.map((i) => regOf[i]));
  };

  for (const D of doms) {
    let q = null;
    if (D.structured) q = meshMapped(D);
    if (q) nMapped++;
    else { q = meshFree(D); nFree++; }
    D.quads = q;
  }

  // ---------------------------------------------------------------- shells (orientation, validity)
  const shellsRaw = []; // { nodes (reg ids), D }
  for (const D of doms) {
    D.shellIdx = [];
    const res = orientQuads(D.quads, D.frame, reg.x, reg.y, reg.z, 1e-10 * D.h * D.h);
    for (const nodes of res.quads) {
      D.shellIdx.push(shellsRaw.length);
      shellsRaw.push({ nodes, D });
    }
    if (res.degenerate) warnings.push(`Domain ${D.id}: ${res.degenerate} degenerate element(s) removed`);
    if (res.nonConvex) warnings.push(`Domain ${D.id}: ${res.nonConvex} distorted (non-convex) element(s)`);
  }

  // ---------------------------------------------------------------- beams
  const beamsRaw = [];
  for (const ln of mLines) {
    const s = lineSeg.get(ln.id);
    if (!s || !ln.element) continue;
    const el = ln.element;
    const type = el.type || 'beam';
    const pa = reg.p(s.a), pb = reg.p(s.b);
    const ax = lineAxes(pa, pb, el.beta || 0);
    if (!ax) continue;
    const chain = chainOf(s);
    const d = sub(pb, pa), L2 = dot(d, d);
    const tOf = (id) => Math.min(1, Math.max(0, dot(sub(reg.p(id), pa), d) / L2));
    const relOK = type === 'beam' || type === 'rib';
    const rel = (arr) => (relOK && Array.isArray(arr) && arr.some(Boolean) ? arr.slice(0, 6).map(Boolean) : null);
    const nSeg = chain.length - 1;
    for (let k = 0; k < nSeg; k++) {
      beamsRaw.push({
        n1: chain[k], n2: chain[k + 1], line: ln.id, type,
        material: el.material ?? null, section: el.section ?? null, beta: el.beta || 0,
        ex: ax.ex, ey: ax.ey, ez: ax.ez,
        relI: k === 0 ? rel(el.releases && el.releases.i) : null,
        relJ: k === nSeg - 1 ? rel(el.releases && el.releases.j) : null,
        t0: k === 0 ? 0 : tOf(chain[k]), t1: k === nSeg - 1 ? 1 : tOf(chain[k + 1]),
        nl: el.nl ?? null, k: el.k ? el.k.slice() : null,
      });
    }
  }

  // ---------------------------------------------------------------- compaction
  const meshIdx = new Int32Array(reg.n).fill(-1);
  for (const b of beamsRaw) { meshIdx[b.n1] = 0; meshIdx[b.n2] = 0; }
  for (const s of shellsRaw) for (const id of s.nodes) meshIdx[id] = 0;
  let nn = 0;
  for (let i = 0; i < reg.n; i++) if (meshIdx[i] === 0) meshIdx[i] = nn++;
  const nodes = new Float64Array(3 * nn);
  const nodeModelId = new Int32Array(nn);
  for (let i = 0; i < reg.n; i++) {
    const m = meshIdx[i];
    if (m < 0) continue;
    nodes[3 * m] = reg.x[i]; nodes[3 * m + 1] = reg.y[i]; nodes[3 * m + 2] = reg.z[i];
    nodeModelId[m] = reg.modelId[i];
  }
  const beams = beamsRaw.map((b) => ({ ...b, n1: meshIdx[b.n1], n2: meshIdx[b.n2] }));
  const shells = [];
  const domainElems = {}, domainNodes = {};
  const nodeMark = new Int32Array(nn).fill(-1);
  for (const D of doms) {
    const d = D.def;
    const ex = D.frame.ex.slice(), ey = D.frame.ey.slice(), ez = D.frame.ez.slice();
    const elems = [];
    const nset = [];
    for (const si of D.shellIdx) {
      const q = shellsRaw[si].nodes;
      const nodesM = [meshIdx[q[0]], meshIdx[q[1]], meshIdx[q[2]], meshIdx[q[3]]];
      for (const m of nodesM) if (nodeMark[m] !== D.idx) { nodeMark[m] = D.idx; nset.push(m); }
      elems.push(shells.length);
      shells.push({
        nodes: nodesM, domain: d.id, type: d.type || 'shell', material: d.material ?? null,
        thickness: d.thickness ?? 0, ex, ey, ez,
      });
    }
    domainElems[d.id] = elems;
    domainNodes[d.id] = nset.sort((a, b) => a - b);
  }

  const modelNodeToMesh = {};
  for (const [mid, rid] of nodeReg) if (meshIdx[rid] >= 0) modelNodeToMesh[mid] = meshIdx[rid];

  const lineNodes = {};
  for (const ln of mLines) {
    const s = lineSeg.get(ln.id);
    if (!s) { lineNodes[ln.id] = []; continue; }
    const pa = reg.p(s.a), pb = reg.p(s.b);
    const d = sub(pb, pa), L2 = dot(d, d);
    const out = [];
    for (const id of chainOf(s)) {
      if (meshIdx[id] < 0) continue;
      out.push({ node: meshIdx[id], t: Math.min(1, Math.max(0, dot(sub(reg.p(id), pa), d) / L2)) });
    }
    if (out.length && meshIdx[s.a] >= 0) out[0].t = 0;
    if (out.length && meshIdx[s.b] >= 0) out[out.length - 1].t = 1;
    lineNodes[ln.id] = out;
  }

  // nodes referenced by supports / loads but not part of the mesh
  const needNode = new Set();
  for (const sp of (model && model.supports) || []) if (sp.type === 'node') needNode.add(sp.node);
  for (const ld of (model && model.loads) || []) if (ld.type === 'node' || ld.type === 'nodeDisp') needNode.add(ld.node);
  for (const nid of needNode) {
    if (nodeReg.has(nid) && modelNodeToMesh[nid] === undefined) warnings.push(`Node ${nid} is used by a support/load but not connected to any element`);
  }

  return {
    nodes, nodeModelId, beams, shells, lineNodes, domainElems, domainNodes, modelNodeToMesh, warnings,
    stats: { nodes: nn, beams: beams.length, shells: shells.length, mapped: nMapped, free: nFree, timeMs: Math.round((nowMs() - T0) * 10) / 10 },
  };
}
