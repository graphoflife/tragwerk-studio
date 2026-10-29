// Generalised symmetric eigenproblem  A x = μ B x  (B = K positive definite, factorised)
// solved for the algebraically largest μ by a block Lanczos / Krylov–Rayleigh–Ritz method
// with full B-reorthogonalisation. Blocks (default size up to 4) resolve repeated eigenvalues
// (symmetric structures). Used as
//   modal:    A = M (lumped),   μ = 1/ω²
//   buckling: A = −K_G,         μ = 1/λ
// Convergence: residual ‖B⁻¹A x − μ x‖_B ≤ tol·|μ| for every wanted Ritz pair, estimated from the
// Gram matrix of the not-yet-orthonormalised next block (exact for this Krylov scheme).

import { symEig, rng, dot } from './linalg.js';

/**
 * @param {object} o
 *  n, applyA(x, y) (y = A x), solveB(x) (in place x ← B⁻¹x), nev, block, tol, maxBasis, seed,
 *  positiveOnly (only μ > 0 wanted), onProgress(frac)
 * @returns {{ values: number[], vectors: Float64Array[], converged: boolean, basis: number }}
 *  values descending, vectors B-normalised (xᵀ B x = 1)
 */
export function blockLanczos(o) {
  const n = o.n;
  const nev = Math.max(1, Math.min(o.nev, n));
  const b = Math.max(1, Math.min(o.block || Math.min(4, Math.max(2, nev)), n));
  const tol = o.tol ?? 1e-8;
  const cap = Math.min(n, o.maxBasis || Math.max(12 * nev + 40, 160));
  const rand = rng(o.seed ?? 20240611);
  const Q = [], P = [];
  const Hcol = [];          // Hcol[j][i] = q_i · A q_j for i < (basis size when column j was formed)

  const makeCand = (v) => {
    const z = new Float64Array(n);
    o.applyA(v, z);
    const w = Float64Array.from(z);
    o.solveB(w);
    const n0 = Math.sqrt(Math.max(dot(w, z), 0));
    return { w, bw: z, n0 };
  };
  const orth = (c, from, to, passes = 2) => {
    for (let p = 0; p < passes; p++) {
      for (let i = from; i < to; i++) {
        const coef = dot(P[i], c.w);
        if (coef === 0) continue;
        const q = Q[i], pp = P[i], w = c.w, bw = c.bw;
        for (let k = 0; k < n; k++) { w[k] -= coef * q[k]; bw[k] -= coef * pp[k]; }
      }
    }
  };
  const append = (cands) => {
    const start = Q.length;
    const added = [];
    for (const c of cands) {
      if (Q.length >= cap) break;
      orth(c, start, Q.length);
      const nr2 = dot(c.w, c.bw);
      if (!(nr2 > 0) || Math.sqrt(nr2) <= 1e-10 * c.n0 || !(c.n0 > 0)) continue;
      const s = 1 / Math.sqrt(nr2);
      for (let k = 0; k < n; k++) { c.w[k] *= s; c.bw[k] *= s; }
      Q.push(c.w); P.push(c.bw); added.push(Q.length - 1);
    }
    return added;
  };
  const randomCands = (cnt) => {
    const out = [];
    for (let k = 0; k < cnt; k++) {
      const v = new Float64Array(n);
      for (let i = 0; i < n; i++) v[i] = rand();
      const c = makeCand(v);
      orth(c, 0, Q.length);
      out.push(c);
    }
    return out;
  };

  let last = append(randomCands(b));
  let tries = 0;
  while (!last.length && tries++ < 3) last = append(randomCands(b));
  if (!last.length) return { values: [], vectors: [], converged: true, basis: 0 };

  let result = null;
  let converged = false;
  for (;;) {
    // expansion candidates w_j = B⁻¹ A q_j and Ritz-matrix columns
    const m = Q.length;
    const cands = [];
    for (const j of last) {
      const z = new Float64Array(n);
      o.applyA(Q[j], z);
      const col = new Float64Array(m);
      for (let i = 0; i < m; i++) col[i] = dot(Q[i], z);
      Hcol[j] = col;
      const w = Float64Array.from(z);
      o.solveB(w);
      cands.push({ w, bw: z, n0: Math.sqrt(Math.max(dot(w, z), 0)) });
    }
    for (const c of cands) orth(c, 0, m);
    // Gram matrix of the remainders (B inner product)
    const nb = cands.length;
    const G = new Float64Array(nb * nb);
    for (let a = 0; a < nb; a++) for (let c = a; c < nb; c++) {
      const v = dot(cands[a].w, cands[c].bw);
      G[a * nb + c] = v; G[c * nb + a] = v;
    }
    // Rayleigh–Ritz
    const H = new Float64Array(m * m);
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const hi = Math.max(i, j), lo = Math.min(i, j);
      H[i * m + j] = Hcol[hi] ? Hcol[hi][lo] : 0;
    }
    const { values, vectors } = symEig(H, m);
    const wanted = [];
    for (let k = m - 1; k >= 0 && wanted.length < nev; k--) {
      if (o.positiveOnly && !(values[k] > 0)) break;
      wanted.push(k);
    }
    let conv = wanted.length > 0;
    const scaleRef = Math.max(Math.abs(values[m - 1]), Math.abs(values[0]), 1e-300);
    for (const k of wanted) {
      let r2 = 0;
      for (let a = 0; a < nb; a++) for (let c = 0; c < nb; c++) {
        r2 += vectors[last[a] * m + k] * G[a * nb + c] * vectors[last[c] * m + k];
      }
      const res = Math.sqrt(Math.max(r2, 0));
      if (res > tol * Math.max(Math.abs(values[k]), 1e-12 * scaleRef)) { conv = false; break; }
    }
    if (conv && wanted.length < nev && m < Math.min(cap, 4 * nev + 40)) conv = false;
    result = { values, vectors, m, wanted };
    if (o.onProgress) o.onProgress(Math.min(0.99, m / cap));
    if (conv) { converged = true; break; }
    if (m >= cap) break;
    let added = append(cands);
    if (!added.length) {
      // invariant subspace: restart with fresh random directions
      added = append(randomCands(b));
      if (!added.length) { converged = true; break; }
    }
    last = added;
  }
  const { values, vectors, m, wanted } = result;
  const outV = [], outX = [];
  for (const k of wanted) {
    const x = new Float64Array(n);
    for (let i = 0; i < m; i++) {
      const s = vectors[i * m + k];
      if (s === 0) continue;
      const q = Q[i];
      for (let t = 0; t < n; t++) x[t] += s * q[t];
    }
    outV.push(values[k]);
    outX.push(x);
  }
  return { values: outV, vectors: outX, converged, basis: Q.length };
}
