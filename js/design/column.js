// Reinforced-concrete column design – EN 1992-1-1 (opts.code 'EC', default); 'SIA' = SIA 262 material
// values with the EN 1992-1-1 model-column method (approximation, see below).
// Pure ES module (no DOM). Units (SPEC.md §1): m, m², kN, kNm, kN/m². N > 0 tension, NEd < 0 compression.
//
// API
//   isColumn(model, line) → boolean
//   designRCColumns(model, mesh, staticResults, caseKeys, opts?) → [ColumnResult] (+ array props .warnings, .code)
//   columnSection(geom, As?) → column section with its bar layout (`sec` of the functions below)
//   axialLimits(sec, P) → { NRd (pure compression, ≤ 0), NRdt (pure tension, ≥ 0) }
//   interactionCurve(sec, P, axis, nPts = 40) → [[N, M], …] (N from NRd to NRdt, M ≥ 0)
//   columnResistance(sec, P, NEd, axis) → MRd ≥ 0 at NEd (0 when NEd lies outside [NRd, NRdt])
//   P = concreteParams(material, fyk, code) from concrete.js; axis 'y' = bending about local y (My,
//   depth h along local z), axis 'z' = bending about local z (Mz, depth b along local y).
//
// Candidates (isColumn): lines with element.type 'beam' (not 'rib'/'truss'), concrete material, section
// RECT (dims.h, dims.b) or CIRC (dims.d), and element.design.rc.member === 'column' or (member !== 'beam'
// and the line is inclined ≤ 30° from global Z). designRCColumns also warns (and skips) for candidates
// whose section / fck / length / mesh is missing; non-concrete or non-vertical lines are skipped silently
// unless member === 'column'.
// Parameters (section.rc, overridden by element.design.rc, overridden by opts.rc – same precedence as
// designRCBeams; undefined/null entries are ignored): cover (to the links) 0.03, dia 0.020,
// diaStirrup 0.010, fyk 500000, phiEf (effective creep ratio φef) 0; buckling factors element.design.Ky/Kz
// (default 1): l0y = Ky·L (bending My, uses h), l0z = Kz·L (bending Mz, uses b). K > 1 = sway member.
//
// ─────────────────────────────────── method (EN 1992-1-1) ───────────────────────────────────
// 1. First-order forces per result case (collectLineForces over all mesh segments of the line):
//    NEd = most compressive N along the member (if no station is in compression: the largest tension);
//    per axis the end moments M(0), M(L) (signed, beam convention → equal signs = tension on the same
//    side = single curvature), max |M| along the member and whether the diagram is linear (no
//    transverse load, momentDiagram()). M02 = end moment with the larger magnitude, M01 the other one.
// 2. Imperfection 5.2(7): ei = l0/400 per axis (simplified θi = 1/200, αh = αm = 1). 5.8.9(2): applied in
//    ONE direction at a time → every case gives two biaxial checks (ei in y only, then in z only); the
//    worse one counts. The minimum eccentricity 6.1(4) e0 = max(h/30, 20 mm) (h of that direction) is
//    applied in the same way: only to the direction carrying the imperfection (interpretation).
// 3. Slenderness 5.8.3.2: λ = l0/i, i = h/√12 (RECT, y) / b/√12 (RECT, z) / D/4 (CIRC).
//    Limit 5.8.3.1: λlim = 20·A·B·C/√n, A = 1/(1 + 0.2·φef), B = √(1 + 2ω), ω = As·fyd/(Ac·fcd),
//    n = NEd/(Ac·fcd) (compression positive); C = 1.7 − rm, rm = M01/M02 from the FIRST-ORDER end moments
//    (clamped to [−1, 1]). C = 0.7 for sway members (K > 1), for non-linear moment diagrams (transverse
//    load), and when the moments arise predominantly from the imperfection (|M02| ≤ NEd·ei).
//    ω is that of the reinforcement being checked: the As search iterates λlim, Kr (and so M2) with the
//    trial ω (instead of the "B = 1.1 if ω unknown" starting value). Tension/zero N: never slender.
// 4. Slender members (λ > λlim): nominal curvature 5.8.8. 1/r = Kr·Kφ·εyd/(0.45·d) (5.8.8.3),
//    εyd = fyd/Es (Es = 200 GPa), Kr = (nu − n)/(nu − nbal) ∈ [0, 1], nu = 1 + ω, nbal = 0.4,
//    Kφ = max(1, 1 + β·φef), β = 0.35 + fck[MPa]/200 − λ/150; e2 = (1/r)·l0²/c with c = 10 (≈ π², the
//    reduction towards c = 8 for constant first-order moments is NOT applied); M2 = NEd·e2 (5.8.8.2(3)).
//    d = h/2 + is (5.8.8.3(2)), is = radius of gyration of the bar layout about the bending axis
//    (4 corner bars: d = h − cover − diaStirrup − dia/2; CIRC: is = rs/√2, rs = radius of the bar circle).
//    Design moment (all first-order terms incl. the imperfection moment NEd·ei, if applied):
//      braced (K ≤ 1), 5.8.8.2(2): M02i = |M02| + N·ei, M01i = ±|M01| + N·ei (− for double curvature),
//        M0e = max(0.6·M02i + 0.4·M01i, 0.4·M02i); non-linear diagram → M0Ed = max(M0e, max|M| + N·ei);
//        MEd = max(M02i, M0Ed + M2, M01i + 0.5·M2)
//      sway (K > 1): MEd = max|M| + N·ei + M2 (2nd-order moment added at the critical end – conservative)
//    M2 is only added in a direction that carries a first-order moment (incl. imperfection) in that
//    check: a perfectly centric direction without imperfection stays straight (cf. 5.8.9(2)/(3)).
//    Non-slender: MEd = max|M| + N·ei. Compression direction with imperfection: MEd ≥ N·e0 (6.1(4)).
//    Members in tension: MEd = max|M| (no imperfection, no 2nd order, no e0).
// 5. Section resistance (6.1): strain compatibility with the rectangular stress block 3.1.7(3) (λ, η,
//    εcu from concreteParams; σc = η·fcd over λ·x, limited to the section depth), pivots of Fig. 6.1:
//    εcu at the compression edge while x ≤ h, then rotation about the point at (1 − εc2/εcu)·h with εc2 =
//    2 ‰ (EC Table 3.1 for fck > 50) → uniform εc2 in pure compression. Reinforcement elastic–perfectly
//    plastic (fyd, Es, horizontal branch, no strain limit 3.2.7(2)b), bars as points at their actual
//    positions; the concrete displaced by bars inside the stress block is subtracted (bar treated as a
//    strip of its diameter for a continuous N(x)). NRd = −(η·fcd·(Ac − As) + As·min(fyd, Es·εc2)),
//    NRdt = As·fyd. Uniaxial MRd(NEd) per principal axis by bisection on the neutral-axis depth x.
//    Biaxial 5.8.9(4): (MEdz/MRdz)^a + (MEdy/MRdy)^a ≤ 1, a = 1.0 / 1.5 / 2.0 for NEd/NRd = 0.1 / 0.7 /
//    1.0 (linear in between, a = 1 below 0.1 and for tension), NRd = Ac·fcd + As·fyd as defined there.
//    CIRC: resultant moment √(MEdy² + MEdz²) against MRd = min(MRd about y, MRd about z) of the layout.
//    Utilisation η = max(LHS^(1/a), |NEd|/|NRd,lim|) (NRd,lim = NRd or NRdt): LHS^(1/a) ≤ 1 ⇔ LHS ≤ 1, but it
//    is linear in the moments (uniaxial: η = MEd/MRd); the axial term only matters (η > 1) beyond the curve.
// 6. Reinforcement: RECT – 4 corner bars + intermediate bars on all faces so that the centre spacing
//    ≤ 0.30 m (9.5.2(4) corners; 300 mm spacing as in DIN EN 1992-1-1/NA 9.5.2(4) / practice), CIRC – n ≥ 6
//    bars (EC 9.5.2(4) asks ≥ 4; 6 per NA/practice), even n, spacing ≤ 0.30 m, all at cover + diaStirrup +
//    dia/2 from the surface. Equal bars; the required total As is the smallest value in [As,min, …] with
//    η ≤ 1 for all cases (geometric scan × 1.25, then bisection; ω-dependence of λlim/Kr included).
//    As,min = max(0.10·NEd/fyd, 0.002·Ac) (9.5.2(2), NEd = max compression over the cases);
//    SIA: As,min = 0.006·Ac (SIA 262 5.5.4 – value per project specification, VERIFY).
//    As,max = 0.04·Ac (9.5.2(3) outside laps; used for SIA too – verify) → ok = false with a note.
//    Suggested bars: same pattern, Ø from BAR_DIAS[code] ≥ max(12 mm, one step below the preferred Ø);
//    the candidate with the smallest total area ≥ As whose own check (actual bar positions) gives η ≤ 1.
//    Only if no such candidate stays ≤ As,max, denser patterns (1…3 extra bars per face / 2…6 more on
//    the circle, clear spacing ≥ max(Ø, 20 mm), 8.2(2)) are tried, then the best one beyond As,max.
//    η, design points and interaction curves are reported for the suggested bars.
// Not covered: shear and links (9.5.3), lap lengths, fire, the general / stiffness methods (5.8.6/5.8.7),
// sway-frame global analysis (5.8.5: K > 1 only changes l0, C and the M2 position), creep from loads.
//
// SIA 262: same procedure with SIA material values (concreteParams(…, 'SIA'): fcd = ηfc·ηt·fck/γc,
// stress block 0.85·x, εcu = 3 ‰). SIA 262 4.3.7 (second-order effects in compression members) is
// APPROXIMATED by the EN 1992-1-1 5.8.8 nominal-curvature method – the result must be verified
// (a note is added to every SIA result). SIA 262 text not consulted.
//
// DEVIATIONS FROM THE TASK SPEC: η = max(LHS^(1/a), |NEd|/|NRd,lim|) instead of the raw LHS (see 5.); d of
// 5.8.8.3 from the bar layout (d = h/2 + is); denser bar patterns as a fallback (see 6.); ColumnResult has
// extra fields (phiEf, K, NRd, NRdt, rhoProv, insufficient, section = suggested layout with bar positions,
// governing.{imp, a, MRdy, MRdz, e2y, e2z, Kr, Kphi, C, rm, n}); points hold both imperfection checks per
// case ({ caseKey, imp: 'y'|'z', NEd, MEdy, MEdz, eta }); lambdaLim = min over the cases (Infinity without
// compression); rho = As,req/Ac; for CIRC b = h = D (D = null for RECT); columnResistance returns 0 outside
// the N range.

import { designCode, num, pos, fmt, designContext, collectLineForces, capEta, momentDiagram, toMap } from './common.js';
import { concreteParams } from './concrete.js';
import { BAR_DIAS, barArea } from './rebar.js';

const ES = 200e6;                    // kN/m², reinforcing steel
const SQRT12 = Math.sqrt(12);
const S_MAX = 0.30;                  // max. centre spacing of longitudinal bars along a face / the circle
const AS_UPPER = 0.10;               // upper search limit of the required As (fraction of Ac)
const AS_MAX = 0.04;                 // EN 1992-1-1 9.5.2(3)
const MAX_EXTRA = 3;                 // denser bar patterns tried for the suggestion (extra bars per face)
const COS30 = Math.cos(Math.PI / 6);
const AXES = ['y', 'z'];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** εc2 (strain at the pivot for pure compression): EN 1992-1-1 Table 3.1, 2 ‰ for SIA. */
function epsC2(P) {
  const f = P.fckM;
  return P.code !== 'SIA' && f > 50 ? (2.0 + 0.085 * (f - 50) ** 0.53) / 1000 : 0.002;
}

// ───────────────────────────────────── section / bar layout ─────────────────────────────────────

/**
 * Column section with its bar layout.
 * @param geom { shape:'RECT'|'CIRC', b, h (RECT), D or d (CIRC), cover, diaStirrup, dia, extra }
 *             extra = additional intermediate bars per face (RECT) / 2·extra more bars (CIRC), default 0
 * @param As   total area (m²) distributed over equal bars; omitted/≤ 0 → real bars of Ø dia
 * @returns { shape, b, h, D, Ac, As, n, dia, a, spacing, bars:[{ y, z, A, d }], is:{ y, z } } or null
 *          (a = axis distance of the bars from the surface; is = radius of gyration of the bars about y / z)
 */
export function columnSection(geom, As) {
  const g = geom || {};
  const shape = g.shape === 'CIRC' ? 'CIRC' : 'RECT';
  const dia = pos(g.dia, 0.020);
  const a = pos(g.cover, 0.03) + pos(g.diaStirrup, 0.010) + dia / 2;
  const extra = Math.max(0, Math.round(num(g.extra, 0)));
  const pts = [];
  let b, h, D = null, Ac, spacing;
  if (shape === 'CIRC') {
    D = pos(g.D, pos(g.d, NaN));
    b = h = D;
    const rs = D / 2 - a;
    if (!(rs > 1e-3)) return null;
    let n = Math.max(6, Math.ceil(2 * Math.PI * rs / S_MAX - 1e-9));
    if (n % 2) n++; // even n → layout symmetric about both axes
    n += 2 * extra;
    for (let k = 0; k < n; k++) {
      const t = 2 * Math.PI * k / n;
      pts.push([rs * Math.cos(t), rs * Math.sin(t)]);
    }
    Ac = Math.PI * D * D / 4;
    spacing = 2 * rs * Math.sin(Math.PI / n);
  } else {
    b = pos(g.b, NaN); h = pos(g.h, NaN);
    const yb = b / 2 - a, zb = h / 2 - a;
    if (!(yb > 1e-3 && zb > 1e-3)) return null;
    const ny = Math.max(0, Math.ceil(2 * yb / S_MAX - 1e-9) - 1) + extra; // intermediate bars on the faces z = ±zb
    const nz = Math.max(0, Math.ceil(2 * zb / S_MAX - 1e-9) - 1) + extra; // intermediate bars on the faces y = ±yb
    pts.push([yb, zb], [-yb, zb], [-yb, -zb], [yb, -zb]);
    for (let k = 1; k <= ny; k++) { const y = -yb + 2 * yb * k / (ny + 1); pts.push([y, zb], [y, -zb]); }
    for (let k = 1; k <= nz; k++) { const z = -zb + 2 * zb * k / (nz + 1); pts.push([yb, z], [-yb, z]); }
    Ac = b * h;
    spacing = Math.min(2 * yb / (ny + 1), 2 * zb / (nz + 1));
  }
  const n = pts.length;
  const Ab = As > 0 ? As / n : barArea(dia);
  const bars = pts.map(([y, z]) => ({ y, z, A: Ab, d: dia }));
  let sy = 0, sz = 0;
  for (const [y, z] of pts) { sy += y * y; sz += z * z; }
  return { shape, b, h, D, Ac, As: Ab * n, n, dia, a, extra, spacing, bars, is: { y: Math.sqrt(sz / n), z: Math.sqrt(sy / n) } };
}

/** Geometry of `sec` for bending about `axis`: depth H, width W, bar coordinates u along the depth. */
function axisGeom(sec, axis) {
  const circ = sec.shape === 'CIRC';
  const D = circ ? pos(sec.D, pos(sec.dims && sec.dims.d, NaN)) : NaN;
  const b = pos(sec.b, pos(sec.dims && sec.dims.b, NaN)), h = pos(sec.h, pos(sec.dims && sec.dims.h, NaN));
  const H = circ ? D : axis === 'z' ? b : h;
  const W = circ ? D : axis === 'z' ? h : b;
  const bars = Array.isArray(sec.bars) ? sec.bars.filter((br) => br && num(br.A, 0) > 0) : [];
  const u = Float64Array.from(bars, (br) => num(axis === 'z' ? br.y : br.z, 0));
  const A = Float64Array.from(bars, (br) => num(br.A, 0));
  const r = Float64Array.from(bars, (br) => Math.max(0, num(br.d, 0)) / 2);
  let sym = true;
  for (let i = 0; i < u.length && sym; i++) {
    let found = false;
    for (let j = 0; j < u.length && !found; j++) found = Math.abs(u[i] + u[j]) < 1e-9 && Math.abs(A[i] - A[j]) <= 1e-12 + 1e-9 * A[i];
    sym = found;
  }
  return { circ, H, W, R: D / 2, u, A, r, sym, Ac: circ ? Math.PI * D * D / 4 : b * h };
}

/**
 * Internal forces (compression positive) for neutral-axis depth x measured from the compression edge
 * (at +u for sgn = +1, at −u for sgn = −1). M > 0 = compression on that edge.
 */
function stateAt(G, P, ec2, x, sgn) {
  const H = G.H, ecu = P.ecu, fc = P.eta * P.fcd, fyd = P.fyd;
  const a = Math.min(P.lam * x, H);
  let N = 0, M = 0;
  if (a > 0) {
    if (G.circ) {
      const R = G.R;
      if (a >= 2 * R) N = fc * Math.PI * R * R;
      else {
        const phi = Math.acos(clamp(1 - a / R, -1, 1)), th = 2 * phi, k = th - Math.sin(th);
        const yc = k > 1e-12 ? 4 * R * Math.sin(phi) ** 3 / (3 * k) : R - 0.4 * a;
        N = fc * R * R * k / 2;
        M = N * yc;
      }
    } else {
      N = fc * G.W * a;
      M = N * (H / 2 - a / 2);
    }
  }
  const pivotC = x > H;
  const tC = Math.max(0, (1 - ec2 / ecu) * H);
  for (let i = 0; i < G.u.length; i++) {
    const u = sgn * G.u[i], t = H / 2 - u;
    const eps = pivotC ? ec2 * (x - t) / (x - tC) : ecu * (x - t) / x;
    let s = ES * eps;
    if (s > fyd) s = fyd; else if (s < -fyd) s = -fyd;
    const r = G.r[i];
    if (a > t - r) s -= (r > 0 ? Math.min(1, (a - t + r) / (2 * r)) : 1) * fc; // displaced concrete
    const F = G.A[i] * s;
    N += F;
    M += F * u;
  }
  return { N, M };
}

/** Pure compression (Nc0, compression positive) and pure tension (Nt0) resistances. */
function limitsOf(G, P, ec2) {
  const fc = P.eta * P.fcd, s0 = Math.min(P.fyd, ES * ec2);
  let As = 0;
  for (let i = 0; i < G.A.length; i++) As += G.A[i];
  return { Nc0: fc * (G.Ac - As) + As * s0, Nt0: As * P.fyd, As };
}

/** MRd ≥ 0 at NEd (compression negative) – min over both bending senses unless the layout is symmetric. */
function mrdOf(G, P, ec2, lim, NEd) {
  const target = -NEd;
  const tol = 1e-9 * (lim.Nc0 + lim.Nt0) + 1e-12;
  if (!(G.H > 0) || target > lim.Nc0 + tol || target < -lim.Nt0 - tol) return 0;
  let best = Infinity;
  for (const sgn of G.sym ? [1] : [1, -1]) {
    let lo = Math.log(1e-7 * G.H), hi = Math.log(1e6 * G.H), st = null;
    for (let it = 0; it < 100 && hi - lo > 1e-13; it++) {
      const mid = 0.5 * (lo + hi);
      st = stateAt(G, P, ec2, Math.exp(mid), sgn);
      if (Math.abs(st.N - target) <= tol) break;
      if (st.N < target) lo = mid; else hi = mid;
    }
    best = Math.min(best, Math.max(0, st ? st.M : 0));
  }
  return Number.isFinite(best) ? best : 0;
}

function checkSecP(sec, P) {
  return !!(sec && P && P.fcd > 0 && P.fyd > 0 && P.ecu > 0 && P.lam > 0 && P.eta > 0);
}

/** Pure compression / tension resistance: { NRd ≤ 0, NRdt ≥ 0 } (kN). */
export function axialLimits(sec, P) {
  if (!checkSecP(sec, P)) return { NRd: NaN, NRdt: NaN };
  const lim = limitsOf(axisGeom(sec, 'y'), P, epsC2(P));
  return { NRd: -lim.Nc0, NRdt: lim.Nt0 };
}

/** Uniaxial bending resistance MRd (kNm, ≥ 0) about `axis` at the axial force NEd (kN, compression < 0). */
export function columnResistance(sec, P, NEd, axis) {
  if (!checkSecP(sec, P) || !Number.isFinite(NEd)) return NaN;
  const G = axisGeom(sec, axis === 'z' ? 'z' : 'y');
  const ec2 = epsC2(P);
  return mrdOf(G, P, ec2, limitsOf(G, P, ec2), NEd);
}

/** N–M interaction curve [[N, M], …] with nPts points evenly spaced in N from NRd (compression) to NRdt. */
export function interactionCurve(sec, P, axis, nPts = 40) {
  if (!checkSecP(sec, P)) return [];
  const G = axisGeom(sec, axis === 'z' ? 'z' : 'y');
  const ec2 = epsC2(P);
  const lim = limitsOf(G, P, ec2);
  const n = Math.max(2, Math.round(num(nPts, 40)));
  const out = [];
  for (let k = 0; k < n; k++) {
    const N = -lim.Nc0 + (lim.Nc0 + lim.Nt0) * k / (n - 1);
    out.push([N, k === 0 || k === n - 1 ? (G.sym ? 0 : mrdOf(G, P, ec2, lim, N)) : mrdOf(G, P, ec2, lim, N)]);
  }
  return out;
}

// ───────────────────────────────────────── candidates ─────────────────────────────────────────

/** Classification of a line: null (not a column), { skip } (candidate that cannot be designed) or data. */
function classify(ctx, line) {
  const el = line && line.element;
  if (!el || el.type !== 'beam') return null;
  const member = el.design && el.design.rc ? el.design.rc.member : undefined;
  if (member === 'beam') return null;
  const forced = member === 'column';
  if (!forced) {
    const a = ctx.nodes.get(Number(line.n1)), b = ctx.nodes.get(Number(line.n2));
    if (!a || !b) return null;
    const dx = num(b.x, 0) - num(a.x, 0), dy = num(b.y, 0) - num(a.y, 0), dz = num(b.z, 0) - num(a.z, 0);
    const L = Math.hypot(dx, dy, dz);
    if (!(L > 0) || Math.abs(dz) / L < COS30 - 1e-9) return null;
  }
  const mat = ctx.materials.get(Number(el.material));
  if (!mat || mat.type !== 'concrete') return forced ? { skip: mat ? `material type '${mat.type}' is not concrete` : 'no material' } : null;
  const sec = ctx.sections.get(Number(el.section));
  if (!sec) return { skip: 'no section' };
  const d = sec.dims || {};
  let geo;
  if (sec.shape === 'RECT' && pos(d.h, 0) > 0 && pos(d.b, 0) > 0) geo = { shape: 'RECT', b: d.b, h: d.h, D: null };
  else if (sec.shape === 'CIRC' && pos(d.d, 0) > 0) geo = { shape: 'CIRC', b: d.d, h: d.d, D: d.d };
  else return { skip: `section shape ${sec.shape} not supported (RECT/CIRC only)` };
  if (!(pos(mat.fck, 0) > 0)) return { skip: 'concrete material without fck' };
  return { el, mat, sec, geo };
}

/** True for concrete column candidates (see header). `line` may be a line object or its id. */
export function isColumn(model, line) {
  try {
    const ln = line && typeof line === 'object' ? line : (Array.isArray(model?.lines) ? model.lines.find((l) => l && Number(l.id) === Number(line)) : null);
    const ctx = { nodes: toMap(model?.nodes), materials: toMap(model?.materials), sections: toMap(model?.sections) };
    const c = classify(ctx, ln);
    return !!(c && !c.skip);
  } catch (e) {
    return false;
  }
}

// ─────────────────────────────────────────── design ───────────────────────────────────────────

/** Exponent a of EN 1992-1-1 5.8.9(4) for NEd/NRd. */
function biaxExp(r) {
  if (!(r > 0.1)) return 1;
  if (r <= 0.7) return 1 + 0.5 * (r - 0.1) / 0.6;
  if (r <= 1) return 1.5 + 0.5 * (r - 0.7) / 0.3;
  return 2;
}

/** First-order data of one moment diagram. */
function axisData(x, M) {
  const n = M.length;
  let Mmax = 0, xMax = x[0];
  for (let j = 0; j < n; j++) if (Math.abs(M[j]) > Mmax) { Mmax = Math.abs(M[j]); xMax = x[j]; }
  const Mb = M[0], Mt = M[n - 1];
  const top02 = Math.abs(Mt) > Math.abs(Mb);
  return {
    Mb, Mt, Mmax, xMax,
    M02: top02 ? Mt : Mb, M01: top02 ? Mb : Mt, x02: top02 ? x[n - 1] : x[0], x01: top02 ? x[0] : x[n - 1],
    linear: momentDiagram(x, M).linear,
  };
}

/** Design moment of one direction (k) in one check (imperfection in this direction or not). */
function designMoment(Dd, ak, k, withImp, Nc) {
  const f = ak.f;
  if (!(Nc > 0)) return { MEd: f.Mmax, M0: f.Mmax, M2: 0, ei: 0, x: f.xMax, e0: false };
  const ei = withImp ? ak.ei : 0, Nei = Nc * ei;
  const M02i = Math.abs(f.M02) + Nei;
  const M01i = (f.M01 * f.M02 >= 0 ? Math.abs(f.M01) : -Math.abs(f.M01)) + Nei;
  const M0max = f.Mmax + Nei;
  const xm = f.Mmax > 1e-9 ? f.xMax : Dd.L / 2;
  const M2 = ak.slender && M0max > Nc * 1e-6 ? Nc * ak.e2 : 0;
  let MEd, M0, x;
  if (!M2) { MEd = M0 = M0max; x = xm; }
  else if (ak.sway) { M0 = M0max; MEd = M0max + M2; x = xm; }
  else {
    const M0e = Math.max(0.6 * M02i + 0.4 * M01i, 0.4 * M02i);
    const M0Ed = f.linear ? M0e : Math.max(M0e, M0max);
    const c = [[M02i, M02i, f.x02], [M0Ed + M2, M0Ed, f.linear ? Dd.L / 2 : xm], [M01i + 0.5 * M2, M01i, f.x01]];
    let best = c[0];
    for (const cc of c) if (cc[0] > best[0]) best = cc;
    [MEd, M0, x] = best;
  }
  let e0 = false;
  if (withImp) {
    const e0v = Math.max(Dd.H[k] / 30, 0.02);
    if (MEd < Nc * e0v) { MEd = Nc * e0v; e0 = true; }
  }
  return { MEd, M0, M2, ei, x, e0 };
}

/**
 * Check of a bar layout `s` for all cases → { eta, governing, points, lamLim, slenderCases, … }.
 * Dd = prepared member data (cases, P, l0, λ, K, H, φef, L).
 */
function evaluate(Dd, s) {
  const { P, ec2 } = Dd;
  const G = { y: axisGeom(s, 'y'), z: axisGeom(s, 'z') };
  const lim = limitsOf(G.y, P, ec2);
  const NRd = -lim.Nc0, NRdt = lim.Nt0;
  const Ac = s.Ac, As = lim.As;
  const omega = As * P.fyd / (Ac * P.fcd);
  const NRd59 = Ac * P.fcd + As * P.fyd; // 5.8.9(4)
  const A = 1 / (1 + 0.2 * Dd.phiEf), B = Math.sqrt(1 + 2 * omega), nu = 1 + omega;
  const r0 = { y: (P.fyd / ES) / (0.45 * (Dd.H.y / 2 + s.is.y)), z: (P.fyd / ES) / (0.45 * (Dd.H.z / 2 + s.is.z)) };
  const lamLim = { y: Infinity, z: Infinity };
  const slenderCases = { y: 0, z: 0 };
  const points = [];
  let best = null, tension = 0, beyond = 0;
  for (const c of Dd.cases) {
    const Nc = Math.max(0, -c.NEd);
    const n = Nc / (Ac * P.fcd);
    if (c.NEd > 0) tension++;
    const ax = {};
    for (const k of AXES) {
      const f = c[k];
      const sway = Dd.K[k] > 1 + 1e-9;
      const ei = Dd.l0[k] / 400;
      let C = 0.7, rm = null;
      if (!sway && f.linear && Math.abs(f.M02) > Nc * ei && Math.abs(f.M02) > 1e-9) { rm = clamp(f.M01 / f.M02, -1, 1); C = 1.7 - rm; }
      const ll = Nc > 0 ? 20 * A * B * C / Math.sqrt(n) : Infinity;
      if (ll < lamLim[k]) lamLim[k] = ll;
      const slender = Nc > 0 && Dd.lambda[k] > ll;
      let e2 = 0, Kr = 1, Kphi = 1;
      if (slender) {
        slenderCases[k]++;
        Kr = clamp((nu - n) / (nu - 0.4), 0, 1);
        Kphi = Math.max(1, 1 + (0.35 + P.fckM / 200 - Dd.lambda[k] / 150) * Dd.phiEf);
        e2 = Kr * Kphi * r0[k] * Dd.l0[k] ** 2 / 10;
      }
      ax[k] = { f, sway, ei, C, rm, lamLim: ll, slender, e2, Kr, Kphi };
    }
    const inRange = c.NEd >= NRd - 1e-9 * lim.Nc0 && c.NEd <= NRdt + 1e-9 * lim.Nt0;
    if (!inRange) beyond++;
    let MRy = 0, MRz = 0;
    if (inRange) {
      MRy = mrdOf(G.y, P, ec2, lim, c.NEd);
      MRz = mrdOf(G.z, P, ec2, lim, c.NEd);
      if (Dd.circ) MRy = MRz = Math.min(MRy, MRz);
    }
    const a = c.NEd < 0 ? biaxExp(Nc / NRd59) : 1;
    const axial = c.NEd < 0 ? (NRd < 0 ? c.NEd / NRd : Infinity) : c.NEd > 0 ? (NRdt > 0 ? c.NEd / NRdt : Infinity) : 0;
    for (const imp of AXES) {
      const my = designMoment(Dd, ax.y, 'y', imp === 'y', Nc);
      const mz = designMoment(Dd, ax.z, 'z', imp === 'z', Nc);
      const ratio = (M, MR) => (M <= 1e-12 ? 0 : MR > 0 ? M / MR : Infinity);
      let em = 0, ry = 0, rz = 0;
      if (inRange) {
        if (Dd.circ) em = ry = rz = ratio(Math.hypot(my.MEd, mz.MEd), MRy);
        else {
          ry = ratio(my.MEd, MRy); rz = ratio(mz.MEd, MRz);
          em = Number.isFinite(ry) && Number.isFinite(rz) ? (ry ** a + rz ** a) ** (1 / a) : Infinity;
        }
      }
      const eta = capEta(Math.max(em, axial));
      points.push({ caseKey: c.key, imp, NEd: c.NEd, MEdy: my.MEd, MEdz: mz.MEd, eta });
      if (!best || eta > best.eta) {
        best = {
          eta, caseKey: c.key, imp, x: (Dd.circ ? (my.MEd >= mz.MEd) : ry >= rz) ? my.x : mz.x,
          NEd: c.NEd, MEdy: my.MEd, MEdz: mz.MEd, M0y: my.M0, M0z: mz.M0, M2y: my.M2, M2z: mz.M2,
          eiy: my.ei, eiz: mz.ei, e0y: my.e0, e0z: mz.e0, MRdy: MRy, MRdz: MRz, a, n,
          lambdaLim: { y: ax.y.lamLim, z: ax.z.lamLim }, C: { y: ax.y.C, z: ax.z.C }, rm: { y: ax.y.rm, z: ax.z.rm },
          Kr: { y: ax.y.Kr, z: ax.z.Kr }, Kphi: { y: ax.y.Kphi, z: ax.z.Kphi }, e2: { y: ax.y.e2, z: ax.z.e2 },
        };
      }
    }
  }
  return { eta: best ? best.eta : 0, governing: best, points, lamLim, slenderCases, omega, NRd, NRdt, tension, beyond };
}

/** Bar diameters for the suggestion: BAR_DIAS[code] ≥ max(12 mm, one step below the preferred Ø). */
function candidateDias(code, dia) {
  const list = BAR_DIAS[code === 'SIA' ? 'SIA' : 'EC'];
  let i = list.findIndex((d) => d >= dia - 1e-9);
  if (i < 0) i = list.length - 1;
  const dmin = Math.max(0.012, list[Math.max(0, i - 1)]);
  return list.filter((d) => d >= dmin - 1e-9);
}

export function designRCColumns(model, mesh, staticResults, caseKeys, opts = {}) {
  opts = opts || {};
  const code = designCode(model, opts);
  const out = [];
  out.warnings = [];
  out.code = code;
  try {
    const ctx = designContext(model, mesh, staticResults, caseKeys, out.warnings, 'beams');
    for (const line of Array.isArray(model?.lines) ? model.lines : []) {
      let cls;
      try { cls = classify(ctx, line); } catch (e) { cls = null; }
      if (!cls) continue;
      if (cls.skip) { out.warnings.push(`Line ${line.id}: ${cls.skip} – RC column design skipped`); continue; }
      try {
        const r = designColumn(ctx, code, line, cls, opts);
        if (r) out.push(r);
      } catch (e) {
        out.warnings.push(`Line ${line.id}: RC column design failed (${e && e.message}) – RC column design skipped`);
      }
    }
  } catch (e) {
    out.warnings.push(`RC column design aborted: ${e && e.message}`);
  }
  return out;
}

function designColumn(ctx, code, line, cls, opts) {
  const W = (msg) => { ctx.warnings.push(`Line ${line.id}: ${msg} – RC column design skipped`); return null; };
  const { el, mat, sec, geo } = cls;
  const rcIn = {};
  for (const src of [sec.rc, el.design && el.design.rc, opts.rc]) {
    if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) if (v !== undefined && v !== null && v !== '') rcIn[k] = v;
  }
  const rc = {
    cover: pos(rcIn.cover, 0.03), dia: pos(rcIn.dia, 0.020), diaStirrup: pos(rcIn.diaStirrup, 0.010),
    fyk: pos(rcIn.fyk, 500000), phiEf: Math.max(0, num(rcIn.phiEf, 0)),
  };
  const P = concreteParams(mat, rc.fyk, code, opts);
  if (!P) return W('concrete material without fck');
  const L = ctx.lineLength(line);
  if (!(L > 0)) return W('zero length');
  const segs = ctx.segs.get(Number(line.id));
  if (!segs || !segs.length) return W('no mesh beams');
  const g = { shape: geo.shape, b: geo.b, h: geo.h, D: geo.D, cover: rc.cover, diaStirrup: rc.diaStirrup, dia: rc.dia };
  const s0 = columnSection(g, 1e-4);
  if (!s0) return W('cover/bar diameters too large for the section');
  const SIA = code === 'SIA';
  const circ = geo.shape === 'CIRC';
  const Ac = s0.Ac;
  const Ky = pos(el.design && el.design.Ky, 1), Kz = pos(el.design && el.design.Kz, 1);
  const l0 = { y: Ky * L, z: Kz * L };
  const iy = circ ? geo.D / 4 : geo.h / SQRT12, iz = circ ? geo.D / 4 : geo.b / SQRT12;
  const lambda = { y: l0.y / iy, z: l0.z / iz };
  const notes = [];

  // first-order forces per case
  const cases = [];
  for (const key of ctx.keys) {
    const f = collectLineForces(ctx.mesh, ctx.cases[key], segs, L, el.nl || null);
    if (!f.x.length) continue;
    let Nmin = Infinity, Nmax = -Infinity;
    for (const v of f.N) { if (v < Nmin) Nmin = v; if (v > Nmax) Nmax = v; }
    cases.push({ key, NEd: Nmin < 0 ? Nmin : Nmax, y: axisData(f.x, f.My), z: axisData(f.x, f.Mz) });
  }
  if (!cases.length) notes.push('no result cases – minimum reinforcement only');
  const Dd = { P, ec2: epsC2(P), cases, L, l0, lambda, K: { y: Ky, z: Kz }, H: { y: geo.h, z: geo.b }, phiEf: rc.phiEf, circ };

  // minimum / maximum reinforcement
  let NEdc = 0;
  for (const c of cases) NEdc = Math.max(NEdc, -c.NEd);
  const AsMinN = 0.10 * NEdc / P.fyd, AsMinA = (SIA ? 0.006 : 0.002) * Ac;
  const AsMin = SIA ? AsMinA : Math.max(AsMinN, AsMinA);
  const AsMax = AS_MAX * Ac;

  // required total As (equal bars, layout for the preferred Ø)
  const evalAs = (As) => evaluate(Dd, columnSection(g, As));
  const AsUp = Math.max(AS_UPPER * Ac, 2 * AsMin);
  let As = AsMin, insufficient = false;
  if (evalAs(AsMin).eta > 1) {
    let lo = AsMin, hi = null;
    while (lo < AsUp) {
      const next = Math.min(AsUp, lo * 1.25);
      if (evalAs(next).eta <= 1) { hi = next; break; }
      lo = next;
    }
    if (hi === null) { As = AsUp; insufficient = true; }
    else {
      for (let it = 0; it < 40 && hi - lo > 1e-5 * hi; it++) {
        const mid = 0.5 * (lo + hi);
        if (evalAs(mid).eta <= 1) hi = mid; else lo = mid;
      }
      As = hi;
    }
  }

  // suggested bars: same pattern, real diameters (smallest area ≥ As with η ≤ 1 at the actual bar
  // positions); only if that is impossible within As,max, denser patterns (extra bars per face, clear
  // spacing ≥ max(Ø, 20 mm)) are tried.
  const dias = candidateDias(code, rc.dia);
  let pick = null, over = null, last = null;
  for (let extra = 0; extra <= MAX_EXTRA && !pick; extra++) {
    const cands = [];
    for (const d of dias) {
      const s = columnSection({ ...g, dia: d, extra });
      if (s && (extra === 0 || s.spacing - d >= Math.max(d, 0.02) - 1e-9)) cands.push(s);
    }
    cands.sort((p, q) => p.As - q.As || q.dia - p.dia);
    if (extra === 0 && cands.length) last = cands[cands.length - 1];
    for (const s of cands) {
      if (s.As < As * (1 - 1e-9)) continue;
      const ev = evaluate(Dd, s);
      if (ev.eta <= 1) {
        if (s.As <= AsMax * (1 + 1e-9)) pick = { s, ev };
        else if (!over) over = { s, ev };
        break;
      }
    }
  }
  let barsShort = false;
  if (!pick) pick = over;
  if (!pick) {
    const s = last || columnSection(g, As);
    pick = { s, ev: evaluate(Dd, s) };
    barsShort = true;
  }
  const chosen = pick.s, ev = pick.ev;
  const gv = ev.governing;
  const curve = { y: interactionCurve(chosen, P, 'y'), z: interactionCurve(chosen, P, 'z') };
  const lambdaLim = { y: ev.lamLim.y, z: ev.lamLim.z };
  const slender = { y: lambda.y > lambdaLim.y, z: lambda.z > lambdaLim.z };

  // notes
  const ref = SIA ? 'EN 1992-1-1, used for SIA 262' : 'EN 1992-1-1';
  const cm2 = (v) => fmt(v * 1e4, 2);
  for (const k of AXES) {
    const lam = fmt(lambda[k], 1), K = k === 'y' ? Ky : Kz;
    if (!Number.isFinite(lambdaLim[k])) notes.push(`λ${k} = ${lam}: no compression – 2nd-order effects not relevant`);
    else if (slender[k]) notes.push(`λ${k} = ${lam} > λlim = ${fmt(lambdaLim[k], 1)}: slender – 2nd-order moments (nominal curvature, ${ref} 5.8.8)`);
    else notes.push(`λ${k} = ${lam} ≤ λlim = ${fmt(lambdaLim[k], 1)}: not slender – 2nd-order effects neglected (${ref} 5.8.3.1)`);
    if (K > 1 + 1e-9) notes.push(`K${k} = ${fmt(K, 2)} > 1: sway member – C = 0.7, MEd = M0,max + M2 (conservative)`);
  }
  notes.push(`imperfection ei = l0/400 (${fmt(l0.y / 400 * 1000, 1)} / ${fmt(l0.z / 400 * 1000, 1)} mm, ${ref} 5.2(7)) and minimum eccentricity e0 = max(h/30, 20 mm) (6.1(4)), applied in one direction at a time (5.8.9(2))`);
  notes.push(rc.phiEf > 0
    ? `φef = ${fmt(rc.phiEf, 2)}: A = ${fmt(1 / (1 + 0.2 * rc.phiEf), 3)} (5.8.3.1), Kφ = 1 + β·φef (5.8.8.3(4))`
    : 'φef = 0: creep not considered (set design.rc.phiEf; 5.8.4)');
  if (gv) {
    notes.push(circ
      ? `governing ${gv.caseKey} (imperfection in ${gv.imp}): resultant MEd = ${fmt(Math.hypot(gv.MEdy, gv.MEdz), 1)} kNm vs MRd = ${fmt(gv.MRdy, 1)} kNm at NEd = ${fmt(gv.NEd, 1)} kN → η = ${fmt(gv.eta, 3)}`
      : `governing ${gv.caseKey} (imperfection in ${gv.imp}): biaxial (MEdz/MRdz)^a + (MEdy/MRdy)^a, a = ${fmt(gv.a, 2)} (${ref} 5.8.9(4)); NEd = ${fmt(gv.NEd, 1)} kN, MEdy = ${fmt(gv.MEdy, 1)}/${fmt(gv.MRdy, 1)}, MEdz = ${fmt(gv.MEdz, 1)}/${fmt(gv.MRdz, 1)} kNm → η = ${fmt(gv.eta, 3)}`);
  }
  if (gv && (gv.imp === 'y' ? gv.e0y : gv.e0z)) notes.push(`minimum eccentricity e0 = ${fmt(Math.max(Dd.H[gv.imp] / 30, 0.02) * 1000, 1)} mm governs MEd${gv.imp} (${ref} 6.1(4))`);
  if (ev.tension) notes.push(`${ev.tension} case(s) with tension: designed for N + M without imperfection / 2nd-order effects`);
  if (As <= AsMin * (1 + 1e-9)) {
    notes.push(SIA
      ? `As,min = 0.6 %·Ac = ${cm2(AsMin)} cm² governs (SIA 262 5.5.4 – verify)`
      : `As,min = max(0.10·NEd/fyd, 0.002·Ac) = ${cm2(AsMin)} cm² governs (EN 1992-1-1 9.5.2(2))`);
  }
  let ok = !insufficient && !barsShort && ev.eta <= 1 + 1e-9;
  if (insufficient) notes.push(`η > 1 even with As = ${fmt(AS_UPPER * 100, 0)} %·Ac – section too small`);
  if (As > AsMax * (1 + 1e-9)) { ok = false; notes.push(`As,req = ${cm2(As)} cm² > As,max = 0.04·Ac = ${cm2(AsMax)} cm² (EN 1992-1-1 9.5.2(3)) – section too small`); }
  else if (chosen.As > AsMax * (1 + 1e-9)) { ok = false; notes.push(`provided ${chosen.n} Ø${fmt(chosen.dia * 1000, 0)} = ${cm2(chosen.As)} cm² > As,max = 0.04·Ac (EN 1992-1-1 9.5.2(3))`); }
  if (barsShort && !insufficient) notes.push(`no bar diameter ≤ Ø${fmt(chosen.dia * 1000, 0)} satisfies η ≤ 1 with the ${chosen.n}-bar pattern`);
  if (chosen.extra > 0) notes.push(`denser bar pattern (${chosen.n} bars) – the ${S_MAX * 1000} mm pattern is not sufficient within As,max`);
  if (chosen.spacing - chosen.dia < Math.max(chosen.dia, 0.02) - 1e-9) notes.push(`clear bar spacing ${fmt((chosen.spacing - chosen.dia) * 1000, 0)} mm < max(Ø, 20 mm) (EN 1992-1-1 8.2(2))`);
  if (ev.beyond) notes.push(`|NEd| exceeds the axial resistance in ${ev.beyond} case(s)`);
  notes.push('shear and links not designed (links: EN 1992-1-1 9.5.3)');
  if (SIA) notes.push('SIA 262 4.3.7 (second-order effects) approximated by the EN 1992-1-1 5.8.8 nominal-curvature method with SIA material values – verify');

  return {
    line: line.id, shape: geo.shape, b: geo.b, h: geo.h, D: geo.D,
    cover: rc.cover, dia: rc.dia, diaStirrup: rc.diaStirrup, fyk: rc.fyk, phiEf: rc.phiEf, K: { y: Ky, z: Kz },
    L, l0y: l0.y, l0z: l0.z, iy, iz, lambda, lambdaLim, slender,
    As, AsMin, AsMax, rho: As / Ac, rhoProv: chosen.As / Ac, insufficient,
    bars: { n: chosen.n, dia: chosen.dia, area: chosen.As },
    eta: ev.eta,
    governing: gv ? {
      caseKey: gv.caseKey, x: gv.x, NEd: gv.NEd, MEdy: gv.MEdy, MEdz: gv.MEdz, M0y: gv.M0y, M0z: gv.M0z,
      M2y: gv.M2y, M2z: gv.M2z, eiy: gv.eiy, eiz: gv.eiz, imp: gv.imp, a: gv.a, MRdy: gv.MRdy, MRdz: gv.MRdz,
      e2y: gv.e2.y, e2z: gv.e2.z, Kr: gv.Kr, Kphi: gv.Kphi, C: gv.C, rm: gv.rm, n: gv.n,
    } : null,
    points: ev.points, curve, NRd: ev.NRd, NRdt: ev.NRdt,
    section: chosen,
    ok, notes, code,
  };
}
