// Flat 4-node shell element in the domain local system (ex, ey, ez):
//  - membrane: bilinear Q4 + Wilson/Taylor incompatible modes (QM6), condensed
//  - bending: MITC4 (Bathe–Dvorkin) Reissner–Mindlin plate with assumed transverse shear strains
//  - drilling: Hughes–Brezzi type penalty  γ∫(θz − ½(∂v/∂x − ∂u/∂y))² dA with small γ
// Local DOFs per node: [u v w θx θy θz].
//
// Kinematics (z = local normal): u(z) = z·θy, v(z) = −z·θx
//   κx = −∂θy/∂x, κy = ∂θx/∂y, κxy = ∂θx/∂x − ∂θy/∂y, strain ε(z) = ε_m − z·κ
//   γxz = ∂w/∂x + θy, γyz = ∂w/∂y − θx
// Result convention (SPEC §4): m = D_b κ  → mx > 0 = tension at the −z face,
//   σ_bottom = nx/t + 6mx/t²; v = −k·G·t·γ (vx = ∂mx/∂x + ∂mxy/∂y, consistent with beam Vz = dMy/dx).

import { invDense } from './linalg.js';

const GP = 1 / Math.sqrt(3);
export const GAUSS_R = [-GP, GP, GP, -GP];
export const GAUSS_S = [-GP, -GP, GP, GP];
const NR = [-1, 1, 1, -1];
const NS = [-1, -1, 1, 1];
const KSHEAR = 5 / 6;
export const DRILL_FACTOR = 1e-3;

/** Shape functions + Cartesian derivatives at (r,s) */
function geomAt(xy, r, s) {
  const N = new Float64Array(4), dNdr = new Float64Array(4), dNds = new Float64Array(4);
  let xr = 0, yr = 0, xs = 0, ys = 0;
  for (let a = 0; a < 4; a++) {
    N[a] = 0.25 * (1 + r * NR[a]) * (1 + s * NS[a]);
    dNdr[a] = 0.25 * NR[a] * (1 + s * NS[a]);
    dNds[a] = 0.25 * NS[a] * (1 + r * NR[a]);
    xr += dNdr[a] * xy[2 * a]; yr += dNdr[a] * xy[2 * a + 1];
    xs += dNds[a] * xy[2 * a]; ys += dNds[a] * xy[2 * a + 1];
  }
  const det = xr * ys - yr * xs;
  const i00 = ys / det, i01 = -yr / det, i10 = -xs / det, i11 = xr / det;
  const dNdx = new Float64Array(4), dNdy = new Float64Array(4);
  for (let a = 0; a < 4; a++) {
    dNdx[a] = i00 * dNdr[a] + i01 * dNds[a];
    dNdy[a] = i10 * dNdr[a] + i11 * dNds[a];
  }
  return { N, dNdx, dNdy, det, i00, i01, i10, i11 };
}

/** Project the 4 corner nodes into the local plane. coords: mesh.nodes, nodes: 4 indices, R: 9 */
export function localXY(coords, nodes, R) {
  const o = 3 * nodes[0];
  const xy = new Float64Array(8);
  for (let a = 0; a < 4; a++) {
    const q = 3 * nodes[a];
    const dx = coords[q] - coords[o], dy = coords[q + 1] - coords[o + 1], dz = coords[q + 2] - coords[o + 2];
    xy[2 * a] = R[0] * dx + R[1] * dy + R[2] * dz;
    xy[2 * a + 1] = R[3] * dx + R[4] * dy + R[5] * dz;
  }
  return xy;
}

/** MITC4 covariant shear strains at the tying points as rows over the 12 bending DOFs [w θx θy]×4 */
function tyingRows(xy) {
  const x = (a) => xy[2 * a], y = (a) => xy[2 * a + 1];
  const row = (n1, n2, sgn1, sgn2, dx, dy) => {
    // γ = ½(sgn1·w_n1 + sgn2·w_n2) + ½(θy_n1+θy_n2)·dx − ½(θx_n1+θx_n2)·dy  (dx,dy = ½ edge vector)
    const r = new Float64Array(12);
    r[3 * n1] += 0.5 * sgn1; r[3 * n2] += 0.5 * sgn2;
    r[3 * n1 + 2] += 0.5 * dx; r[3 * n2 + 2] += 0.5 * dx;
    r[3 * n1 + 1] -= 0.5 * dy; r[3 * n2 + 1] -= 0.5 * dy;
    return r;
  };
  return {
    A: row(2, 3, 1, -1, 0.5 * (x(2) - x(3)), 0.5 * (y(2) - y(3))),   // γ_r at (0, 1)
    C: row(1, 0, 1, -1, 0.5 * (x(1) - x(0)), 0.5 * (y(1) - y(0))),   // γ_r at (0,−1)
    D: row(2, 1, 1, -1, 0.5 * (x(2) - x(1)), 0.5 * (y(2) - y(1))),   // γ_s at (1, 0)
    B: row(3, 0, 1, -1, 0.5 * (x(3) - x(0)), 0.5 * (y(3) - y(0))),   // γ_s at (−1,0)
  };
}

function materialD(E, nu, f) {
  const c = E * f / (1 - nu * nu);
  return [c, c * nu, 0, c * nu, c, 0, 0, 0, c * (1 - nu) / 2];
}

/**
 * All Gauss-point operators of the element. Returns
 * { gp:[{N,dNdx,dNdy,det, Bm(3×8), Bi(3×4), Bb(3×12), Bs(2×12)}], Dm, Db, ds, area, nodeArea }
 */
export function shellOperators(xy, E, nu, t) {
  const G = E / (2 * (1 + nu));
  const Dm = materialD(E, nu, t);
  const Db = materialD(E, nu, t * t * t / 12);
  const ds = KSHEAR * G * t;
  const g0 = geomAt(xy, 0, 0);
  const tie = tyingRows(xy);
  const gp = [];
  let area = 0;
  const nodeArea = new Float64Array(4);
  for (let g = 0; g < 4; g++) {
    const r = GAUSS_R[g], s = GAUSS_S[g];
    const ge = geomAt(xy, r, s);
    area += ge.det;
    for (let a = 0; a < 4; a++) nodeArea[a] += ge.N[a] * ge.det;
    // membrane
    const Bm = new Float64Array(24);
    for (let a = 0; a < 4; a++) {
      Bm[2 * a] = ge.dNdx[a];
      Bm[8 + 2 * a + 1] = ge.dNdy[a];
      Bm[16 + 2 * a] = ge.dNdy[a];
      Bm[16 + 2 * a + 1] = ge.dNdx[a];
    }
    // incompatible modes P1 = 1−r², P2 = 1−s² with J0⁻¹ and detJ0/detJ scaling (QM6)
    const f = g0.det / ge.det;
    const dP1dr = -2 * r, dP2ds = -2 * s;
    const p1x = g0.i00 * dP1dr * f, p1y = g0.i10 * dP1dr * f;
    const p2x = g0.i01 * dP2ds * f, p2y = g0.i11 * dP2ds * f;
    const Bi = Float64Array.of(
      p1x, p2x, 0, 0,
      0, 0, p1y, p2y,
      p1y, p2y, p1x, p2x);
    // bending
    const Bb = new Float64Array(36);
    for (let a = 0; a < 4; a++) {
      Bb[3 * a + 2] = -ge.dNdx[a];             // κx = −∂θy/∂x
      Bb[12 + 3 * a + 1] = ge.dNdy[a];         // κy = ∂θx/∂y
      Bb[24 + 3 * a + 1] = ge.dNdx[a];         // κxy = ∂θx/∂x − ∂θy/∂y
      Bb[24 + 3 * a + 2] = -ge.dNdy[a];
    }
    // MITC4 transverse shear: interpolate covariant strains, then to Cartesian with J⁻¹
    const Bs = new Float64Array(24);
    for (let k = 0; k < 12; k++) {
      const gr = 0.5 * (1 + s) * tie.A[k] + 0.5 * (1 - s) * tie.C[k];
      const gs = 0.5 * (1 + r) * tie.D[k] + 0.5 * (1 - r) * tie.B[k];
      Bs[k] = ge.i00 * gr + ge.i01 * gs;
      Bs[12 + k] = ge.i10 * gr + ge.i11 * gs;
    }
    gp.push({ N: ge.N, dNdx: ge.dNdx, dNdy: ge.dNdy, det: ge.det, Bm, Bi, Bb, Bs });
  }
  return { gp, Dm, Db, ds, G, area, nodeArea, minDet: Math.min(...gp.map((q) => q.det)) };
}

// helper: K += Bᵀ D B · w  (B: m×n row-major, D: m×m)
function addBtDB(K, n, B, D, m, w, map) {
  const DB = new Float64Array(m * n);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += D[i * m + k] * B[k * n + j];
    DB[i * n + j] = s;
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += B[k * n + i] * DB[k * n + j];
    if (s !== 0) K[map(i) * 24 + map(j)] += s * w;
  }
}

/** Membrane parts: Kcc(8×8), Kci(8×4), Kii(4×4) */
function membraneParts(op) {
  const Kcc = new Float64Array(64), Kci = new Float64Array(32), Kii = new Float64Array(16);
  const D = op.Dm;
  for (const g of op.gp) {
    const w = g.det;
    const DBm = new Float64Array(24), DBi = new Float64Array(12);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 8; j++) DBm[i * 8 + j] = D[i * 3] * g.Bm[j] + D[i * 3 + 1] * g.Bm[8 + j] + D[i * 3 + 2] * g.Bm[16 + j];
      for (let j = 0; j < 4; j++) DBi[i * 4 + j] = D[i * 3] * g.Bi[j] + D[i * 3 + 1] * g.Bi[4 + j] + D[i * 3 + 2] * g.Bi[8 + j];
    }
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) Kcc[i * 8 + j] += (g.Bm[i] * DBm[j] + g.Bm[8 + i] * DBm[8 + j] + g.Bm[16 + i] * DBm[16 + j]) * w;
      for (let j = 0; j < 4; j++) Kci[i * 4 + j] += (g.Bm[i] * DBi[j] + g.Bm[8 + i] * DBi[4 + j] + g.Bm[16 + i] * DBi[8 + j]) * w;
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      Kii[i * 4 + j] += (g.Bi[i] * DBi[j] + g.Bi[4 + i] * DBi[4 + j] + g.Bi[8 + i] * DBi[8 + j]) * w;
    }
  }
  const KiiInv = invDense(Kii, 4);
  return { Kcc, Kci, Kii, KiiInv };
}

/**
 * Local 24×24 stiffness. type: 'shell' | 'plate' | 'membrane'.
 */
export function shellLocalStiffness(op, type) {
  const K = new Float64Array(576);
  const mem = type !== 'plate', bend = type !== 'membrane';
  if (mem) {
    const { Kcc, Kci, KiiInv } = membraneParts(op);
    // condensed: Kcc − Kci Kii⁻¹ Kic
    const X = new Float64Array(32); // Kii⁻¹ Kic (4×8)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += KiiInv[i * 4 + k] * Kci[j * 4 + k];
      X[i * 8 + j] = s;
    }
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      let s = Kcc[i * 8 + j];
      for (let k = 0; k < 4; k++) s -= Kci[i * 4 + k] * X[k * 8 + j];
      const I = 6 * (i >> 1) + (i & 1), J = 6 * (j >> 1) + (j & 1);
      K[I * 24 + J] += s;
    }
  }
  if (bend) {
    const mapB = (i) => 6 * ((i / 3) | 0) + 2 + (i % 3);
    const Ds = [op.ds, 0, 0, op.ds];
    for (const g of op.gp) {
      addBtDB(K, 12, g.Bb, op.Db, 3, g.det, mapB);
      addBtDB(K, 12, g.Bs, Ds, 2, g.det, mapB);
    }
  }
  if (type === 'shell') {
    // drilling penalty, rows over [u v θz]×4
    const gam = DRILL_FACTOR * op.Dm[8];   // Dm[8] = E·t/(2(1+ν)) = G·t
    const mapD = (i) => 6 * ((i / 3) | 0) + [0, 1, 5][i % 3];
    for (const g of op.gp) {
      const b = new Float64Array(12);
      for (let a = 0; a < 4; a++) {
        b[3 * a] = 0.5 * g.dNdy[a];
        b[3 * a + 1] = -0.5 * g.dNdx[a];
        b[3 * a + 2] = g.N[a];
      }
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
        K[mapD(i) * 24 + mapD(j)] += gam * b[i] * b[j] * g.det;
      }
    }
  }
  // symmetrise
  for (let i = 0; i < 24; i++) for (let j = i + 1; j < 24; j++) {
    const v = 0.5 * (K[i * 24 + j] + K[j * 24 + i]);
    K[i * 24 + j] = v; K[j * 24 + i] = v;
  }
  return K;
}

/** Thermal initial strains: ε0 = α·dT·[1,1,0], κ0 = −α·dTz/t·[1,1,0] */
function thermalStrains(alpha, t, temp) {
  const e0 = alpha * (temp?.dT || 0);
  const k0 = -alpha * (temp?.dTz || 0) / t;
  return { e0, k0 };
}

/** Equivalent local nodal loads (24) of a temperature field */
export function shellThermalLoad(op, type, alpha, t, temp) {
  const p = new Float64Array(24);
  const { e0, k0 } = thermalStrains(alpha, t, temp);
  if (type !== 'plate' && e0 !== 0) {
    const { Kci, KiiInv } = membraneParts(op);
    const n0 = [op.Dm[0] * e0 + op.Dm[1] * e0, op.Dm[3] * e0 + op.Dm[4] * e0, 0];
    const fc = new Float64Array(8), fi = new Float64Array(4);
    for (const g of op.gp) {
      for (let j = 0; j < 8; j++) fc[j] += (g.Bm[j] * n0[0] + g.Bm[8 + j] * n0[1]) * g.det;
      for (let j = 0; j < 4; j++) fi[j] += (g.Bi[j] * n0[0] + g.Bi[4 + j] * n0[1]) * g.det;
    }
    // condensed: fc − Kci Kii⁻¹ fi
    const y = new Float64Array(4);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) y[i] += KiiInv[i * 4 + k] * fi[k];
    for (let j = 0; j < 8; j++) {
      let s = fc[j];
      for (let k = 0; k < 4; k++) s -= Kci[j * 4 + k] * y[k];
      p[6 * (j >> 1) + (j & 1)] += s;
    }
  }
  if (type !== 'membrane' && k0 !== 0) {
    const m0 = [op.Db[0] * k0 + op.Db[1] * k0, op.Db[3] * k0 + op.Db[4] * k0, 0];
    for (const g of op.gp) {
      for (let j = 0; j < 12; j++) {
        const v = (g.Bb[j] * m0[0] + g.Bb[12 + j] * m0[1]) * g.det;
        p[6 * ((j / 3) | 0) + 2 + (j % 3)] += v;
      }
    }
  }
  return p;
}

// extrapolation weights Gauss point → corner
const SQ3 = Math.sqrt(3);
const EXW = [1 + SQ3 / 2, -0.5, 1 - SQ3 / 2, -0.5];

/**
 * Stress resultants. uL: local element displacements (24).
 * Returns { corner: Float64Array(32) [nx ny nxy mx my mxy vx vy]×4 corners, gauss: Float64Array(32) }
 */
export function shellRecover(op, type, alpha, t, uL, temp) {
  const gauss = new Float64Array(32);
  const { e0, k0 } = thermalStrains(alpha, t, temp);
  const mem = type !== 'plate', bend = type !== 'membrane';
  let alphaInc = null;
  const um = new Float64Array(8), ub = new Float64Array(12);
  for (let a = 0; a < 4; a++) {
    um[2 * a] = uL[6 * a]; um[2 * a + 1] = uL[6 * a + 1];
    ub[3 * a] = uL[6 * a + 2]; ub[3 * a + 1] = uL[6 * a + 3]; ub[3 * a + 2] = uL[6 * a + 4];
  }
  if (mem) {
    const { Kci, KiiInv } = membraneParts(op);
    // α = Kii⁻¹ (f_i − Kic u)
    const rhs = new Float64Array(4);
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 8; k++) s -= Kci[k * 4 + j] * um[k];
      rhs[j] = s;
    }
    if (e0 !== 0) {
      const n0 = [op.Dm[0] * e0 + op.Dm[1] * e0, op.Dm[3] * e0 + op.Dm[4] * e0];
      for (const g of op.gp) for (let j = 0; j < 4; j++) rhs[j] += (g.Bi[j] * n0[0] + g.Bi[4 + j] * n0[1]) * g.det;
    }
    alphaInc = new Float64Array(4);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) alphaInc[i] += KiiInv[i * 4 + k] * rhs[k];
  }
  for (let gi = 0; gi < 4; gi++) {
    const g = op.gp[gi];
    const o = gi * 8;
    if (mem) {
      const eps = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        let s = 0;
        for (let k = 0; k < 8; k++) s += g.Bm[i * 8 + k] * um[k];
        for (let k = 0; k < 4; k++) s += g.Bi[i * 4 + k] * alphaInc[k];
        eps[i] = s;
      }
      eps[0] -= e0; eps[1] -= e0;
      for (let i = 0; i < 3; i++) gauss[o + i] = op.Dm[i * 3] * eps[0] + op.Dm[i * 3 + 1] * eps[1] + op.Dm[i * 3 + 2] * eps[2];
    }
    if (bend) {
      const kap = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        let s = 0;
        for (let k = 0; k < 12; k++) s += g.Bb[i * 12 + k] * ub[k];
        kap[i] = s;
      }
      kap[0] -= k0; kap[1] -= k0;
      for (let i = 0; i < 3; i++) gauss[o + 3 + i] = op.Db[i * 3] * kap[0] + op.Db[i * 3 + 1] * kap[1] + op.Db[i * 3 + 2] * kap[2];
      let gx = 0, gy = 0;
      for (let k = 0; k < 12; k++) { gx += g.Bs[k] * ub[k]; gy += g.Bs[12 + k] * ub[k]; }
      gauss[o + 6] = -op.ds * gx;
      gauss[o + 7] = -op.ds * gy;
    }
  }
  const corner = new Float64Array(32);
  for (let c = 0; c < 4; c++) {
    for (let gi = 0; gi < 4; gi++) {
      const w = EXW[(gi - c + 4) % 4];
      for (let k = 0; k < 8; k++) corner[c * 8 + k] += w * gauss[gi * 8 + k];
    }
  }
  return { corner, gauss };
}

/** Local geometric stiffness from membrane forces at the Gauss points (gauss: [nx ny nxy ...]×4, stride 8).
 *  Acts on u, v and w (string-type terms ∫∇Nᵀ S ∇N). */
export function shellLocalGeometric(op, gauss, stride = 8) {
  const K = new Float64Array(576);
  for (let gi = 0; gi < 4; gi++) {
    const g = op.gp[gi];
    const nx = gauss[gi * stride], ny = gauss[gi * stride + 1], nxy = gauss[gi * stride + 2];
    if (nx === 0 && ny === 0 && nxy === 0) continue;
    for (let a = 0; a < 4; a++) {
      const ax = g.dNdx[a] * nx + g.dNdy[a] * nxy;
      const ay = g.dNdx[a] * nxy + g.dNdy[a] * ny;
      for (let b = 0; b < 4; b++) {
        const v = (ax * g.dNdx[b] + ay * g.dNdy[b]) * g.det;
        for (let k = 0; k < 3; k++) K[(6 * a + k) * 24 + 6 * b + k] += v;
      }
    }
  }
  return K;
}
