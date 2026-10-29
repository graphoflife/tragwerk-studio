// 3D beam element (12 DOF): Euler–Bernoulli / Timoshenko (shear areas Avy, Avz), torsion GIt,
// end releases by static condensation, geometric stiffness, fixed-end forces for arbitrary span
// loads and exact internal-force / deflection recovery along the element.
//
// Local DOF order: [u1 v1 w1 rx1 ry1 rz1  u2 v2 w2 rx2 ry2 rz2] in local axes (ex, ey, ez).
// End-force vector f (12) = forces exerted BY the nodes ON the element (local axes).
// Equivalent nodal loads p_eq = −f_fix (f_fix = end forces of the fully clamped element).
//
// Internal forces at x (left free body [0,x], cut resultants F_c, M_c acting on it), SPEC §4:
//   N = Fx_c, Vy = −Fy_c, Vz = −Fz_c, T = Mx_c, My = −My_c, Mz = Mz_c
// which yields My(x) = f_my,i + x·f_z,i + ∫(x−s)q_z ds,   Mz(x) = −f_mz,i + x·f_y,i + ∫(x−s)q_y ds,
// Vz = dMy/dx, Vy = dMz/dx; sagging under −z (−y) loads is positive.
// Curvatures: uz'' = My/EIy + κTz, uy'' = Mz/EIz + κTy; shear deflection u'_shear = −V/(G·Av)
// (∫V dx = ΔM minus concentrated-moment jumps).

import { solveDense } from './linalg.js';

export const NSTATIONS = 11;

/** Local elastic stiffness (12×12, row-major). type: 'beam' | 'truss' */
export function beamLocalStiffness(L, p, truss = false) {
  const k = new Float64Array(144);
  const set = (i, j, v) => { k[i * 12 + j] += v; if (i !== j) k[j * 12 + i] += v; };
  const ea = p.E * p.A / L;
  set(0, 0, ea); set(6, 6, ea); set(0, 6, -ea);
  if (truss) return k;
  const gj = p.G * p.It / L;
  set(3, 3, gj); set(9, 9, gj); set(3, 9, -gj);
  const L2 = L * L, L3 = L2 * L;
  // bending in x–y plane (v, rz), shear area Avy
  {
    const phi = p.Avy > 0 ? 12 * p.E * p.Iz / (p.G * p.Avy * L2) : 0;
    const c = p.E * p.Iz / ((1 + phi) * L3);
    set(1, 1, 12 * c); set(1, 5, 6 * L * c); set(1, 7, -12 * c); set(1, 11, 6 * L * c);
    set(5, 5, (4 + phi) * L2 * c); set(5, 7, -6 * L * c); set(5, 11, (2 - phi) * L2 * c);
    set(7, 7, 12 * c); set(7, 11, -6 * L * c); set(11, 11, (4 + phi) * L2 * c);
  }
  // bending in x–z plane (w, ry), shear area Avz; ry = −dw/dx
  {
    const phi = p.Avz > 0 ? 12 * p.E * p.Iy / (p.G * p.Avz * L2) : 0;
    const c = p.E * p.Iy / ((1 + phi) * L3);
    set(2, 2, 12 * c); set(2, 4, -6 * L * c); set(2, 8, -12 * c); set(2, 10, -6 * L * c);
    set(4, 4, (4 + phi) * L2 * c); set(4, 8, 6 * L * c); set(4, 10, (2 - phi) * L2 * c);
    set(8, 8, 12 * c); set(8, 10, 6 * L * c); set(10, 10, (4 + phi) * L2 * c);
  }
  return k;
}

/** Local geometric stiffness for axial force N (tension > 0), consistent cubic shape functions. */
export function beamLocalGeometric(L, N, p, truss = false) {
  const k = new Float64Array(144);
  if (N === 0) return k;
  const set = (i, j, v) => { k[i * 12 + j] += v; if (i !== j) k[j * 12 + i] += v; };
  const g = N / L;
  if (truss) {
    set(1, 1, g); set(7, 7, g); set(1, 7, -g);
    set(2, 2, g); set(8, 8, g); set(2, 8, -g);
    return k;
  }
  const L2 = L * L;
  set(1, 1, 1.2 * g); set(1, 5, 0.1 * L * g); set(1, 7, -1.2 * g); set(1, 11, 0.1 * L * g);
  set(5, 5, 2 * L2 / 15 * g); set(5, 7, -0.1 * L * g); set(5, 11, -L2 / 30 * g);
  set(7, 7, 1.2 * g); set(7, 11, -0.1 * L * g); set(11, 11, 2 * L2 / 15 * g);

  set(2, 2, 1.2 * g); set(2, 4, -0.1 * L * g); set(2, 8, -1.2 * g); set(2, 10, -0.1 * L * g);
  set(4, 4, 2 * L2 / 15 * g); set(4, 8, 0.1 * L * g); set(4, 10, -L2 / 30 * g);
  set(8, 8, 1.2 * g); set(8, 10, 0.1 * L * g); set(10, 10, 2 * L2 / 15 * g);
  // Wagner/torsion term N·Ip/A
  if (p.A > 0) {
    const gt = N * (p.Iy + p.Iz) / (p.A * L);
    set(3, 3, gt); set(9, 9, gt); set(3, 9, -gt);
  }
  return k;
}

/**
 * Static condensation of released local DOFs (rel: 12 flags).
 * Returns T (12×12) such that u_full = T·u (released rows expressed through retained DOFs);
 * condensed K = Tᵀ K T, condensed loads p = Tᵀ p. Sequential elimination handles
 * zero-stiffness released DOFs (e.g. torsion released at both ends).
 */
export function releaseTransform(K, rel) {
  const T = new Float64Array(144);
  for (let i = 0; i < 12; i++) T[i * 13] = 1;
  let Kc = Float64Array.from(K);
  let maxd = 0;
  for (let i = 0; i < 12; i++) maxd = Math.max(maxd, Math.abs(K[i * 13]));
  for (let c = 0; c < 12; c++) {
    if (!rel[c]) continue;
    // S = I with row c replaced by −K_cj/K_cc (and S_cc = 0)
    const S = new Float64Array(144);
    for (let i = 0; i < 12; i++) S[i * 13] = 1;
    S[c * 13] = 0;
    const kcc = Kc[c * 13];
    if (kcc > 1e-12 * maxd) for (let j = 0; j < 12; j++) if (j !== c) S[c * 12 + j] = -Kc[c * 12 + j] / kcc;
    Kc = tripleProduct(Kc, S);
    // T = T S
    const Tn = new Float64Array(144);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let m = 0; m < 12; m++) s += T[i * 12 + m] * S[m * 12 + j];
      Tn[i * 12 + j] = s;
    }
    T.set(Tn);
  }
  // clean released rows/cols exactly
  for (let c = 0; c < 12; c++) if (rel[c]) for (let j = 0; j < 12; j++) { Kc[c * 12 + j] = 0; Kc[j * 12 + c] = 0; }
  return { T, K: Kc };
}

/** Sᵀ K S for 12×12 */
export function tripleProduct(K, S) {
  const KS = new Float64Array(144);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    let s = 0;
    for (let m = 0; m < 12; m++) s += K[i * 12 + m] * S[m * 12 + j];
    KS[i * 12 + j] = s;
  }
  const R = new Float64Array(144);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    let s = 0;
    for (let m = 0; m < 12; m++) s += S[m * 12 + i] * KS[m * 12 + j];
    R[i * 12 + j] = s;
  }
  // symmetrise
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const v = 0.5 * (R[i * 12 + j] + R[j * 12 + i]);
    R[i * 12 + j] = v; R[j * 12 + i] = v;
  }
  return R;
}

/** p_c = Tᵀ p */
export function condenseVector(T, p) {
  const out = new Float64Array(12);
  for (let j = 0; j < 12; j++) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += T[i * 12 + j] * p[i];
    out[j] = s;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Span loads (local axes, positions in m from element start)
//   span = { dist:[{dir,a,b,q1,q2}], pt:[{dir,a,P}], mom:[{dir,a,M}], dT, dTy, dTz }
// ---------------------------------------------------------------------------

export function emptySpan() { return { dist: [], pt: [], mom: [], dT: 0, dTy: 0, dTz: 0 }; }

export function spanIsEmpty(s) {
  return !s || (!s.dist.length && !s.pt.length && !s.mom.length && !s.dT && !s.dTy && !s.dTz);
}

/** Merge span src·factor into dst */
export function spanAddScaled(dst, src, f) {
  for (const d of src.dist) dst.dist.push({ dir: d.dir, a: d.a, b: d.b, q1: d.q1 * f, q2: d.q2 * f });
  for (const d of src.pt) dst.pt.push({ dir: d.dir, a: d.a, P: d.P * f });
  for (const d of src.mom) dst.mom.push({ dir: d.dir, a: d.a, M: d.M * f });
  dst.dT += src.dT * f; dst.dTy += src.dTy * f; dst.dTz += src.dTz * f;
  return dst;
}

const FACT = [1, 1, 2, 6, 24, 120];

/** n-th repeated integral of the load in local direction dir: Q_n(x) = ∫_0^x (x−s)^{n−1}/(n−1)! q(s) ds */
export function Qn(span, dir, x, n) {
  let r = 0;
  for (const d of span.dist) {
    if (d.dir !== dir || x <= d.a) continue;
    const e = Math.min(x, d.b);
    const len = d.b - d.a;
    const k = len > 0 ? (d.q2 - d.q1) / len : 0;
    const c0 = d.q1 + k * (x - d.a);        // q(s) = c0 − k·u with u = x − s
    const U1 = x - d.a, U0 = x - e;
    const pw = (u, m) => u ** m / FACT[m];
    r += c0 * (pw(U1, n) - pw(U0, n)) - k * n * (pw(U1, n + 1) - pw(U0, n + 1));
  }
  for (const d of span.pt) {
    if (d.dir !== dir || x <= d.a) continue;
    r += d.P * (x - d.a) ** (n - 1) / FACT[n - 1];
  }
  return r;
}

/** Contribution of concentrated moments about local axis dir: Σ M·(x−a)^k/k! for x > a */
function Mk(span, dir, x, k) {
  let r = 0;
  for (const d of span.mom) if (d.dir === dir && x > d.a) r += d.M * (x - d.a) ** k / FACT[k];
  return r;
}

/** thermal curvature data */
function thermal(p, span) {
  return {
    eps: p.alpha * (span.dT || 0),
    kz: p.h > 0 ? -p.alpha * (span.dTz || 0) / p.h : 0,   // uz'' contribution
    ky: p.b > 0 ? -p.alpha * (span.dTy || 0) / p.b : 0,   // uy'' contribution
  };
}

/**
 * End forces (node → element, local) of the fully clamped element under span loads.
 * Derived by the flexibility method with exact Timoshenko kinematics, so it is consistent with
 * beamLocalStiffness. For trusses the transverse loads are lumped like a simply supported beam.
 */
export function fixedEndForces(L, p, span, truss = false) {
  const f = new Float64Array(12);
  if (spanIsEmpty(span)) return f;
  const th = thermal(p, span);
  const EA = p.E * p.A;
  // axial: ∫N dx = −EA·αΔT·L
  f[0] = EA * th.eps - Qn(span, 0, L, 2) / L;
  f[6] = -f[0] - Qn(span, 0, L, 1);
  if (truss) {
    // simply supported lumping of transverse loads (no moments)
    for (const [dir, ii, jj] of [[1, 1, 7], [2, 2, 8]]) {
      const Q1 = Qn(span, dir, L, 1), Q2 = Qn(span, dir, L, 2);
      // p_eq,i = Q2/L, p_eq,j = Q1 − Q2/L ; f = −p_eq
      f[ii] = -Q2 / L;
      f[jj] = -(Q1 - Q2 / L);
    }
    return f;
  }
  // torsion: ∫T dx = 0
  f[3] = -Mk(span, 0, L, 1) / L;
  f[9] = -f[3] - Mk(span, 0, L, 0);
  // x–z plane: unknowns a = f_my,i, b = f_z,i
  {
    const EI = p.E * p.Iy;
    const s = p.Avz > 0 ? EI / (p.G * p.Avz) : 0;
    const L2v = Qn(span, 2, L, 2) + Mk(span, 1, L, 0);
    const L3v = Qn(span, 2, L, 3) + Mk(span, 1, L, 1);
    const L4v = Qn(span, 2, L, 4) + Mk(span, 1, L, 2);
    const A = [L, L * L / 2, L * L / 2, L ** 3 / 6 - L * s];
    // shear term uses ∫Vz dx = L·b + Q2 (concentrated moments do not enter the shear integral)
    const rhs = [-L3v - EI * th.kz * L, -L4v - EI * th.kz * L * L / 2 + s * Qn(span, 2, L, 2)];
    const x = solveDense(A, 2, rhs);
    const a = x[0], b = x[1];
    f[4] = a; f[2] = b;
    f[8] = -b - Qn(span, 2, L, 1);
    f[10] = -(a + L * b + L2v);
  }
  // x–y plane: unknowns a = f_mz,i, b = f_y,i ; Mz = −a + x·b + Ly2
  {
    const EI = p.E * p.Iz;
    const s = p.Avy > 0 ? EI / (p.G * p.Avy) : 0;
    const L2v = Qn(span, 1, L, 2) - Mk(span, 2, L, 0);
    const L3v = Qn(span, 1, L, 3) - Mk(span, 2, L, 1);
    const L4v = Qn(span, 1, L, 4) - Mk(span, 2, L, 2);
    const A = [-L, L * L / 2, -L * L / 2, L ** 3 / 6 - L * s];
    const rhs = [-L3v - EI * th.ky * L, -L4v - EI * th.ky * L * L / 2 + s * Qn(span, 1, L, 2)];
    const x = solveDense(A, 2, rhs);
    const a = x[0], b = x[1];
    f[5] = a; f[1] = b;
    f[7] = -b - Qn(span, 1, L, 1);
    f[11] = -a + L * b + L2v;
  }
  return f;
}

/**
 * Internal forces and local deflections at NSTATIONS equidistant stations.
 * f: local end forces (node → element), uL: local end displacements (12), span: span loads.
 */
export function beamStations(L, p, f, uL, span, kind, ns = NSTATIONS) {
  const r = {
    x: new Float64Array(ns), N: new Float64Array(ns), Vy: new Float64Array(ns), Vz: new Float64Array(ns),
    T: new Float64Array(ns), My: new Float64Array(ns), Mz: new Float64Array(ns),
    uy: new Float64Array(ns), uz: new Float64Array(ns),
  };
  const sp = span || null;
  for (let k = 0; k < ns; k++) r.x[k] = L * k / (ns - 1);
  if (kind === 'inactive') {
    for (let k = 0; k < ns; k++) {
      const t = ns > 1 ? k / (ns - 1) : 0;
      r.uy[k] = uL[1] + (uL[7] - uL[1]) * t;
      r.uz[k] = uL[2] + (uL[8] - uL[2]) * t;
    }
    return r;
  }
  if (kind === 'spring' || L <= 0) {
    for (let k = 0; k < ns; k++) {
      r.N[k] = -f[0]; r.Vy[k] = f[1]; r.Vz[k] = f[2]; r.T[k] = -f[3]; r.My[k] = f[4]; r.Mz[k] = -f[5];
      const t = ns > 1 ? k / (ns - 1) : 0;
      r.uy[k] = uL[1] + (uL[7] - uL[1]) * t;
      r.uz[k] = uL[2] + (uL[8] - uL[2]) * t;
    }
    return r;
  }
  const truss = kind === 'truss';
  const Q = sp ? (dir, x, n) => Qn(sp, dir, x, n) : () => 0;
  const M = sp ? (dir, x, k) => Mk(sp, dir, x, k) : () => 0;
  for (let k = 0; k < ns; k++) r.N[k] = -f[0] - Q(0, r.x[k], 1);
  if (truss) {
    for (let k = 0; k < ns; k++) {
      const t = k / (ns - 1);
      r.uy[k] = uL[1] + (uL[7] - uL[1]) * t;
      r.uz[k] = uL[2] + (uL[8] - uL[2]) * t;
    }
    return r;
  }
  const th = sp ? thermal(p, sp) : { eps: 0, kz: 0, ky: 0 };
  const EIy = p.E * p.Iy, EIz = p.E * p.Iz;
  const cz = p.Avz > 0 ? 1 / (p.G * p.Avz) : 0;
  const cy = p.Avy > 0 ? 1 / (p.G * p.Avy) : 0;
  const My0 = f[4], Mz0 = -f[5];
  // particular deflection parts (without the chord term C·x)
  const wz = (x, My) => (f[4] * x * x / 2 + f[2] * x ** 3 / 6 + Q(2, x, 4) + M(1, x, 2)) / EIy
    + th.kz * x * x / 2 - (My - My0 - M(1, x, 0)) * cz;
  const wy = (x, Mz) => (-f[5] * x * x / 2 + f[1] * x ** 3 / 6 + Q(1, x, 4) - M(2, x, 2)) / EIz
    + th.ky * x * x / 2 - (Mz - Mz0 + M(2, x, 0)) * cy;
  const MyAt = (x) => f[4] + x * f[2] + Q(2, x, 2) + M(1, x, 0);
  const MzAt = (x) => -f[5] + x * f[1] + Q(1, x, 2) - M(2, x, 0);
  const czL = (uL[8] - uL[2] - wz(L, MyAt(L))) / L;
  const cyL = (uL[7] - uL[1] - wy(L, MzAt(L))) / L;
  for (let k = 0; k < ns; k++) {
    const x = r.x[k];
    r.Vy[k] = f[1] + Q(1, x, 1);
    r.Vz[k] = f[2] + Q(2, x, 1);
    r.T[k] = -f[3] - M(0, x, 0);
    const My = MyAt(x), Mz = MzAt(x);
    r.My[k] = My; r.Mz[k] = Mz;
    r.uz[k] = uL[2] + czL * x + wz(x, My);
    r.uy[k] = uL[1] + cyL * x + wy(x, Mz);
  }
  return r;
}
