// Plattenbalken (T-beam): ribs/beams lying in the plane of concrete slab domains.
// Pure ES module (no DOM).
//
// The FE model connects ribs concentrically to the slab, so a T-beam's bending is shared between
// the rib element and the slab strip next to it. As in AxisVM, the T-section is designed for the
// rib forces plus the slab forces integrated over the effective flange width:
//   M_T = M_rib + ∫ m_ss ds,  N_T = N_rib + ∫ n_ss ds,  |V_T| = |V_rib| + |∫ v_s ds| (conservative)
// with s = rib direction, m_ss = mx·c² + my·s² + 2·mxy·c·s in the domain axes.
// Effective width (EN 1992-1-1 5.3.2.1, also used for SIA 262):
//   beff = bw + Σ beff,i,  beff,i = min(0.2·bi + 0.1·l0, 0.2·l0, bi)
//   bi = clear distance from the web face to the slab edge, or half the clear distance to the next
//   parallel rib/beam in the slab; l0 = l0Factor·L (distance between zero-moment points, default 1.0·L).
// Integration: midpoint rule with K points per side from the rib axis to bw/2 + beff,i, slab values
// at the nearest mesh corner (nodal-averaged values).
import { pos } from './common.js';
import { sub, dot, cross, normalize as norm, raySegment2D } from '../mesh/geom.js';

const K = 5;
const P = (n) => [n.x, n.y, n.z];

/**
 * Finds the slab flanges of a rib. Returns null when no concrete slab lies next to it, otherwise
 * { beff, bw, hf, l0, sides:[{ domain, sgn, b, beffI, width }], ez } – ez = rib local z.
 */
export function tBeamSetup(ctx, line, segs, bw, L, opts = {}) {
  const A = ctx.nodes.get(line.n1), B = ctx.nodes.get(line.n2);
  if (!A || !B || !(L > 0)) return null;
  const a = P(A), b = P(B), s = norm(sub(b, a));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const ribEz = ctx.mesh.beams?.[segs[0]?.i]?.ez;
  if (!ribEz) return null;
  const l0 = pos(opts.l0, pos(opts.l0Factor, 1.0) * L);
  const sides = [];
  for (const dom of ctx.model.domains || []) {
    const elems = ctx.shellsByDomain.get(Number(dom.id));
    if (!elems?.length) continue;
    const sh = ctx.mesh.shells[elems[0]];
    const mat = ctx.materials.get(Number(sh.material ?? dom.material));
    if (!mat || mat.type !== 'concrete' || sh.type === 'membrane') continue;
    const F = ctx.frame(dom);
    if (!F || Math.abs(dot(s, F.ez)) > 0.02 || !F.containsSegment(a, b)) continue; // rib in or on the edge of the slab
    const m2 = F.to2(mid);
    const t = pos(sh.thickness, pos(dom.thickness, 0));
    for (const sgnSide of [1, -1]) {
      const n3 = norm(cross(F.ez, s)).map((v) => v * sgnSide);
      const d2 = [dot(n3, F.ex), dot(n3, F.ey)];
      const eps = Math.min(0.05, 0.01 * L);
      if (!F.inside2([m2[0] + d2[0] * eps, m2[1] + d2[1] * eps])) continue; // no slab on this side
      const hit = (q1, q2) => raySegment2D(m2, d2, q1, q2)?.s ?? Infinity;
      // distance to the slab edge …
      let dEdge = Infinity;
      for (const poly of F.loops) for (let i = 0; i < poly.length; i++) dEdge = Math.min(dEdge, hit(poly[i], poly[(i + 1) % poly.length]));
      // … and to the next parallel web in the slab
      let dRib = Infinity;
      for (const l of ctx.model.lines || []) {
        if (l.id === line.id || !l.element || !['beam', 'rib'].includes(l.element.type)) continue;
        const p1 = ctx.nodes.get(l.n1), p2 = ctx.nodes.get(l.n2);
        if (!p1 || !p2) continue;
        const q1 = P(p1), q2 = P(p2);
        if (Math.abs(F.dist(q1)) > F.tol || Math.abs(F.dist(q2)) > F.tol) continue;
        if (Math.abs(dot(norm(sub(q2, q1)), s)) < 0.9) continue;
        dRib = Math.min(dRib, hit(F.to2(q1), F.to2(q2)));
      }
      const bi = Math.max(0, Math.min(dEdge - bw / 2, Number.isFinite(dRib) ? (dRib - bw) / 2 : Infinity));
      if (!Number.isFinite(bi) || !(bi > 0)) continue;
      const beffI = Math.min(0.2 * bi + 0.1 * l0, 0.2 * l0, bi);
      sides.push({ domain: dom.id, elems, sgnSide, n3, b: bi, beffI, width: bw / 2 + beffI, t, sgn: dot(F.ez, ribEz) >= 0 ? 1 : -1 });
    }
  }
  if (!sides.length) return null;
  return {
    beff: bw + sides.reduce((x, sd) => x + sd.beffI, 0), bw, hf: Math.min(...sides.map((sd) => sd.t)), l0,
    sides, a, s, cache: null,
  };
}

// sample → nearest shell corner, per station (cached for the station layout)
function samples(setup, ctx, xs) {
  if (setup.cache && setup.cache.n === xs.length) return setup.cache.list;
  const X = ctx.mesh.nodes;
  const corners = new Map(); // domain → [{node, e, c}]
  for (const sd of setup.sides) {
    if (corners.has(sd.domain)) continue;
    const seen = new Set(), arr = [];
    for (const e of sd.elems) ctx.mesh.shells[e].nodes.forEach((nd, c) => { if (!seen.has(nd)) { seen.add(nd); arr.push({ nd, e, c }); } });
    corners.set(sd.domain, arr);
  }
  const list = xs.map((x) => {
    const out = [];
    for (const sd of setup.sides) {
      const sh = ctx.mesh.shells[sd.elems[0]];
      const cs = dot(setup.s, sh.ex), sn = dot(setup.s, sh.ey);
      for (let k = 0; k < K; k++) {
        const w = (k + 0.5) / K * sd.width;
        const p = [0, 1, 2].map((j) => setup.a[j] + setup.s[j] * x + sd.n3[j] * w);
        let best = null, bd = Infinity;
        for (const cn of corners.get(sd.domain)) {
          const d = (X[3 * cn.nd] - p[0]) ** 2 + (X[3 * cn.nd + 1] - p[1]) ** 2 + (X[3 * cn.nd + 2] - p[2]) ** 2;
          if (d < bd) { bd = d; best = cn; }
        }
        if (best) out.push({ i: (best.e * 4 + best.c) * 8, wt: sd.width / K, cs, sn, sgn: sd.sgn });
      }
    }
    return out;
  });
  setup.cache = { n: xs.length, list };
  return list;
}

/** Slab share of the T-beam forces at the stations xs for one result case: { M, N, V } arrays. */
export function tBeamForces(setup, ctx, caseResult, xs) {
  const sv = caseResult?.shells;
  const n = xs.length;
  const M = new Array(n).fill(0), N = new Array(n).fill(0), V = new Array(n).fill(0);
  if (!sv) return { M, N, V };
  const list = samples(setup, ctx, xs);
  for (let j = 0; j < n; j++) {
    for (const q of list[j]) {
      const f = (k) => sv[q.i + k] || 0;
      const c2 = q.cs * q.cs, s2 = q.sn * q.sn, cs = 2 * q.cs * q.sn;
      M[j] += q.wt * q.sgn * (f(3) * c2 + f(4) * s2 + f(5) * cs);
      N[j] += q.wt * (f(0) * c2 + f(1) * s2 + f(2) * cs);
      V[j] += q.wt * (f(6) * q.cs + f(7) * q.sn);
    }
  }
  return { M, N, V };
}
