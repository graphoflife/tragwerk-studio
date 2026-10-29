// Linear buckling: K φ = λ (−K_G) φ for the reference load Σ factor_i·LC_i.
// K_G from beam axial forces (3D consistent geometric stiffness) and shell membrane forces.
// Solved as (−K_G) φ = μ K φ, μ = 1/λ, largest positive μ → lowest positive λ.
// Shapes normalised to max |translation| = 1.

import { setupModel, factorSystem, solveLoads } from './static.js';
import { ldlSolve, skyMatVec } from './linalg.js';
import { buildCaseLoads, combineLoads } from './loads.js';
import { recoverCase } from './post.js';
import { assembleK } from './assemble.js';
import { blockLanczos } from './eigen.js';

/**
 * runBuckling(model, mesh, { factors: {lcId: factor}, nModes: 4, onProgress })
 */
export function runBuckling(model, mesh, options = {}) {
  const opts = { nModes: 4, factors: {}, ...options };
  const out = { modes: [], warnings: [], error: null, stats: { dofs: 0, ms: 0 } };
  const prog = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const t0 = Date.now();
  try {
    prog(0, 'Preparing model');
    const setup = setupModel(model, mesh, out.warnings);
    if (setup.error) { out.error = setup.error; return out; }
    const { data, mask } = setup;
    const fs = factorSystem(data, mask, {}, (f) => prog(5 + 25 * f, 'Factorizing stiffness matrix'));
    if (fs.error) { out.error = fs.error; return out; }
    const { sys, K } = fs;
    out.stats.dofs = sys.neq;
    const list = [];
    for (const [id, f] of Object.entries(opts.factors || {})) {
      const lc = (model.loadCases || []).find((c) => String(c.id) === String(id));
      if (!lc) { out.warnings.push(`Load case ${id} not found.`); continue; }
      list.push({ loads: buildCaseLoads(data, lc.id, (m) => out.warnings.push(m)), f: +f });
    }
    if (!list.length) { out.error = { code: 'NO_LOADS', message: 'No load case factors given for buckling.' }; return out; }
    const loads = combineLoads(data, list);
    prog(35, 'Reference load state');
    const sol = solveLoads(data, { sys, K, mask }, loads);
    const rec = recoverCase(data, sol.u, loads, { mask, springs: data.springs, ground: sol.ground });
    const Kg = assembleK(data, sys, { kgOnly: true, kg: { beamN: rec.beamN, shellG: rec.shellG } });
    let any = false;
    for (let i = 0; i < Kg.a.length; i++) if (Kg.a[i] !== 0) { any = true; break; }
    if (!any) { out.warnings.push('No axial/membrane forces in the reference state – no buckling.'); return out; }
    prog(45, 'Eigenvalue solution');
    const nev = Math.min(opts.nModes || 4, sys.neq);
    const eig = blockLanczos({
      n: sys.neq, nev, positiveOnly: true, tol: opts.tol ?? 1e-9,
      applyA: (x, y) => { skyMatVec(Kg, x, y); for (let i = 0; i < y.length; i++) y[i] = -y[i]; },
      solveB: (x) => ldlSolve(K, x),
      onProgress: (f) => prog(45 + 50 * f, 'Eigenvalue solution'),
    });
    if (!eig.converged) out.warnings.push('Eigenvalue iteration did not fully converge – results may be inaccurate.');
    for (let i = 0; i < eig.values.length; i++) {
      const mu = eig.values[i];
      if (!(mu > 0)) continue;
      const x = eig.vectors[i];
      const shape = new Float64Array(6 * data.nn);
      for (let j = 0; j < sys.neq; j++) shape[sys.dofOfEq[j]] = x[j];
      let big = 0;
      for (let n = 0; n < data.nn; n++) for (let k = 0; k < 3; k++) {
        const v = shape[6 * n + k];
        if (Math.abs(v) > Math.abs(big)) big = v;
      }
      if (big === 0) for (const v of shape) if (Math.abs(v) > Math.abs(big)) big = v;
      if (big !== 0) for (let d = 0; d < shape.length; d++) shape[d] /= big;
      out.modes.push({ lambda: 1 / mu, shape });
    }
    out.modes.sort((a, b) => a.lambda - b.lambda);
    if (!out.modes.length) out.warnings.push('No positive buckling factor found (no compression in the reference state).');
    prog(100, 'Done');
  } catch (e) {
    out.error = { code: 'INTERNAL', message: String(e && e.message || e), stack: e && e.stack };
  }
  out.stats.ms = Date.now() - t0;
  return out;
}
