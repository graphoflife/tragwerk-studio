// Modal analysis with lumped (diagonal, translational) masses:
//  - self weight masses ρ·A·L/2 (beams/trusses) and ρ·t·∫N dA (shells)
//  - optional load case converted to mass: m = |Fz|/g of downward nodal loads × massFactor,
//    applied to all three translational directions
// Eigenproblem K φ = ω² M φ solved as M φ = (1/ω²) K φ with block Lanczos.
// Shapes are mass-normalised (φᵀMφ = 1). Participation Γ_d = φᵀ M r_d; effective mass ratio
// Γ_d² / totalMass_d where totalMass is the mass on free (unsupported) DOFs, so ratios sum to 1.

import { setupModel, factorSystem } from './static.js';
import { ldlSolve } from './linalg.js';
import { buildCaseLoads } from './loads.js';
import { blockLanczos } from './eigen.js';

export function buildMass(data, opts, warn = () => {}) {
  const m = new Float64Array(6 * data.nn);
  if (opts.selfWeightMass !== false) {
    for (const be of data.beams) {
      if (be.kind === 'spring' || be.type === 'rigid') continue;
      const half = 0.5 * be.props.rho * be.props.A * be.L;
      if (!half) continue;
      for (let k = 0; k < 3; k++) { m[6 * be.n1 + k] += half; m[6 * be.n2 + k] += half; }
    }
    for (const sh of data.shells) {
      const mt = sh.rho * sh.t;
      if (!mt) continue;
      for (let a = 0; a < 4; a++) for (let k = 0; k < 3; k++) m[6 * sh.nodes[a] + k] += mt * sh.nodeArea[a];
    }
  }
  if (opts.massCase != null) {
    const L = buildCaseLoads(data, opts.massCase, warn);
    const f = opts.massFactor ?? 1;
    for (let n = 0; n < data.nn; n++) {
      const Fz = L.F[6 * n + 2];
      if (Fz < 0) {
        const mm = -Fz / data.g * f;
        for (let k = 0; k < 3; k++) m[6 * n + k] += mm;
      }
    }
  }
  return m;
}

/**
 * runModal(model, mesh, { nModes, massCase, massFactor, selfWeightMass, onProgress })
 */
export function runModal(model, mesh, options = {}) {
  const opts = { nModes: 6, massCase: null, massFactor: 1, selfWeightMass: true, ...options };
  const out = { modes: [], totalMass: [0, 0, 0], totalMassAll: [0, 0, 0], warnings: [], error: null, stats: { dofs: 0, ms: 0 } };
  const prog = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const t0 = Date.now();
  try {
    prog(0, 'Preparing model');
    const setup = setupModel(model, mesh, out.warnings);
    if (setup.error) { out.error = setup.error; return out; }
    const { data, mask } = setup;
    const fs = factorSystem(data, mask, {}, (f) => prog(5 + 30 * f, 'Factorizing stiffness matrix'));
    if (fs.error) { out.error = fs.error; return out; }
    const { sys, K } = fs;
    out.stats.dofs = sys.neq;
    const mass = buildMass(data, opts, (m) => out.warnings.push(m));
    const mEq = new Float64Array(sys.neq);
    let nMass = 0;
    for (let j = 0; j < sys.neq; j++) { mEq[j] = mass[sys.dofOfEq[j]]; if (mEq[j] > 0) nMass++; }
    for (let n = 0; n < data.nn; n++) for (let k = 0; k < 3; k++) {
      out.totalMassAll[k] += mass[6 * n + k];
      if (mask[6 * n + k] === 0) out.totalMass[k] += mass[6 * n + k];
    }
    if (!nMass) { out.error = { code: 'NO_MASS', message: 'No mass on free DOFs (check density / mass load case).' }; return out; }
    const nev = Math.min(opts.nModes || 6, nMass);
    if (nev < (opts.nModes || 6)) out.warnings.push(`Only ${nMass} DOF(s) carry mass – ${nev} mode(s) computed.`);
    prog(40, 'Eigenvalue solution');
    const eig = blockLanczos({
      n: sys.neq, nev, positiveOnly: true, tol: opts.tol ?? 1e-9,
      applyA: (x, y) => { for (let i = 0; i < x.length; i++) y[i] = mEq[i] * x[i]; },
      solveB: (x) => ldlSolve(K, x),
      onProgress: (f) => prog(40 + 55 * f, 'Eigenvalue solution'),
    });
    if (!eig.converged) out.warnings.push('Eigenvalue iteration did not fully converge – results may be inaccurate.');
    for (let i = 0; i < eig.values.length; i++) {
      const mu = eig.values[i];
      if (!(mu > 0)) continue;
      const omega = 1 / Math.sqrt(mu);
      const x = eig.vectors[i];
      const s = 1 / Math.sqrt(mu);           // xᵀMx = μ  →  φ = x/√μ
      const shape = new Float64Array(6 * data.nn);
      let big = 0;
      for (let j = 0; j < sys.neq; j++) {
        const v = x[j] * s;
        shape[sys.dofOfEq[j]] = v;
        if (Math.abs(v) > Math.abs(big)) big = v;
      }
      if (big < 0) for (let d = 0; d < shape.length; d++) shape[d] = -shape[d];
      const partFactor = [0, 0, 0], effMass = [0, 0, 0];
      for (let n = 0; n < data.nn; n++) for (let k = 0; k < 3; k++) partFactor[k] += mass[6 * n + k] * shape[6 * n + k];
      for (let k = 0; k < 3; k++) effMass[k] = out.totalMass[k] > 0 ? partFactor[k] ** 2 / out.totalMass[k] : 0;
      const f = omega / (2 * Math.PI);
      out.modes.push({ omega, f, T: 1 / f, shape, partFactor, effMass });
    }
    out.modes.sort((a, b) => a.omega - b.omega);
    prog(100, 'Done');
  } catch (e) {
    out.error = { code: 'INTERNAL', message: String(e && e.message || e), stack: e && e.stack };
  }
  out.stats.ms = Date.now() - t0;
  return out;
}
