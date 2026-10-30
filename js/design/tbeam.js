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

const K = 5;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const P = (n) => [n.x, n.y, n.z];

function shellsByDomain(ctx) {
  if (ctx._shellsByDomain) return ctx._shellsByDomain;
  const map = new Map();
  (ctx.mesh.shells || []).forEach((s, e) => {
    if (!s) return;
    const id = Number(s.domain);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(e);
  });
  return (ctx._shellsByDomain = map);
}

// 2D polygon loops of a domain in its plane (outer + holes)
function domainLoops(ctx, dom, o, ex, ey) {
  const to2 = (id) => { const n = ctx.nodes.get(id); const v = sub(P(n), o); return [dot(v, ex), dot(v, ey)]; };
  return [dom.nodes, ...(dom.holes || [])].map((loop) => loop.map(to2));
}

function inside(loops, p) {
  let c = false;
  for (const poly of loops) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
  }
  return c;
}

// distance along the ray o + t·d (2D) to the first crossing of segment a–b, or Infinity
function rayHit(o, d, a, b) {
  const e = [b[0] - a[0], b[1] - a[1]];
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return Infinity;
  const w = [a[0] - o[0], a[1] - o[1]];
  const t = (w[0] * e[1] - w[1] * e[0]) / den;
  const u = (w[0] * d[1] - w[1] * d[0]) / den;
  return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

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
  const byDom = shellsByDomain(ctx);
  const sides = [];
  for (const dom of ctx.model.domains || []) {
    const elems = byDom.get(Number(dom.id));
    if (!elems?.length) continue;
    const sh = ctx.mesh.shells[elems[0]];
    const mat = ctx.materials.get(Number(sh.material ?? dom.material));
    if (!mat || mat.type !== 'concrete' || sh.type === 'membrane' || !sh.ez) continue;
    const ex = sh.ex, ey = sh.ey, ez = sh.ez;
    const o = P(ctx.nodes.get(dom.nodes[0]));
    const tol = 1e-3 + 0.01 * L;
    if (Math.abs(dot(sub(a, o), ez)) > tol || Math.abs(dot(sub(b, o), ez)) > tol || Math.abs(dot(s, ez)) > 0.02) continue;
    const loops = domainLoops(ctx, dom, o, ex, ey);
    const m2 = [dot(sub(mid, o), ex), dot(sub(mid, o), ey)];
    const t = pos(sh.thickness, pos(dom.thickness, 0));
    for (const sgnSide of [1, -1]) {
      const n3 = norm(cross(ez, s)).map((v) => v * sgnSide);
      const d2 = [dot(n3, ex), dot(n3, ey)];
      const eps = Math.min(0.05, 0.01 * L);
      if (!inside(loops, [m2[0] + d2[0] * eps, m2[1] + d2[1] * eps])) continue;
      // distance to the slab edge …
      let dEdge = Infinity;
      for (const poly of loops) for (let i = 0; i < poly.length; i++) dEdge = Math.min(dEdge, rayHit(m2, d2, poly[i], poly[(i + 1) % poly.length]));
      // … and to the next parallel web in the slab
      let dRib = Infinity;
      for (const l of ctx.model.lines || []) {
        if (l.id === line.id || !l.element || !['beam', 'rib'].includes(l.element.type)) continue;
        const p1 = ctx.nodes.get(l.n1), p2 = ctx.nodes.get(l.n2);
        if (!p1 || !p2) continue;
        const q1 = P(p1), q2 = P(p2);
        if (Math.abs(dot(sub(q1, o), ez)) > tol || Math.abs(dot(sub(q2, o), ez)) > tol) continue;
        if (Math.abs(dot(norm(sub(q2, q1)), s)) < 0.9) continue;
        dRib = Math.min(dRib, rayHit(m2, d2, [dot(sub(q1, o), ex), dot(sub(q1, o), ey)], [dot(sub(q2, o), ex), dot(sub(q2, o), ey)]));
      }
      const bi = Math.max(0, Math.min(dEdge - bw / 2, Number.isFinite(dRib) ? (dRib - bw) / 2 : Infinity));
      if (!Number.isFinite(bi) || !(bi > 0)) continue;
      const beffI = Math.min(0.2 * bi + 0.1 * l0, 0.2 * l0, bi);
      sides.push({ domain: dom.id, elems, sgnSide, n3, b: bi, beffI, width: bw / 2 + beffI, t, sgn: dot(ez, ribEz) >= 0 ? 1 : -1 });
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
