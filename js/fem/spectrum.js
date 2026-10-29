// Response spectrum analysis (modal superposition, SRSS or CQC).
//
// Eurocode (code:'EC', default) – EN 1998-1:
//   3.2.2.2 elastic spectrum Se(T), Type 1 parameters Tab. 3.2 (ground types A–E)
//   3.2.2.3 vertical spectrum (avg/ag = 0.90, TB 0.05, TC 0.15, TD 1.0 s, Tab. 3.4, Type 1)
//   3.2.2.5 design spectrum Sd(T) with behaviour factor q, lower bound β·ag, β = 0.2
//   η = √(10/(5+ξ[%])) ≥ 0.55 (3.6); ag = γI·agR (importance factor)
// SIA (code:'SIA') – SIA 261:2020 chapter 16 (Erdbeben):
//   16.2.1 seismic zones Z1a/Z1b/Z2/Z3a/Z3b → agd = 0.4/0.6/1.0/1.3/1.6 m/s² (Tab. 24)
//   16.2.2 ground classes A–F, 16.2.3 parameters S, TB, TC, TD (Tab. 25) and spectra:
//     elastic  Se = agd·S·[1 + (2.5η−1)·T/TB] | 2.5η·agd·S | ·TC/T | ·TC·TD/T²
//     design   Sd = γf·agd·S·[0.67 + (2.5/q − 0.67)·T/TB] | 2.5·γf·agd·S/q | ·TC/T | ·TC·TD/T²
//     lower bound Sd ≥ 0.1·γf·agd
//   16.3 importance factor γf (BWK I/II/III = 1.0/1.2/1.4) = option `importance`
//   Ground class F requires a site-specific study (16.2.2); class D parameters are used as a
//   placeholder with a warning. Vertical component: 0.7·agd with the horizontal spectral shape
//   (assumption, SIA 261 16.2.3 – verify for the project).
// Clause numbers follow the project brief; check against the edition used.
//
// Units: ag / agd in m/s². Spectral acceleration Sd in m/s²; modal displacement amplitude
// Y_i = Γ_i·Sd(T_i)/ω_i² (Γ from the mass-normalised modes).

import { setupModel } from './static.js';
import { recoverCase, mapCaseResults } from './post.js';
import { emptyLoads } from './loads.js';
import { runModal } from './modal.js';

export const EC8_TYPE1 = {
  A: { S: 1.0, TB: 0.15, TC: 0.4, TD: 2.0 },
  B: { S: 1.2, TB: 0.15, TC: 0.5, TD: 2.0 },
  C: { S: 1.15, TB: 0.2, TC: 0.6, TD: 2.0 },
  D: { S: 1.35, TB: 0.2, TC: 0.8, TD: 2.0 },
  E: { S: 1.4, TB: 0.15, TC: 0.5, TD: 2.0 },
};
export const EC8_VERTICAL_TYPE1 = { ratio: 0.9, S: 1.0, TB: 0.05, TC: 0.15, TD: 1.0 };

export const SIA261_GROUND = {
  A: { S: 1.0, TB: 0.15, TC: 0.4, TD: 2.0 },
  B: { S: 1.2, TB: 0.15, TC: 0.5, TD: 2.0 },
  C: { S: 1.15, TB: 0.2, TC: 0.6, TD: 2.0 },
  D: { S: 1.35, TB: 0.2, TC: 0.8, TD: 2.0 },
  E: { S: 1.4, TB: 0.15, TC: 0.5, TD: 2.0 },
};
export const SIA261_ZONES = { Z1a: 0.4, Z1b: 0.6, Z2: 1.0, Z3a: 1.3, Z3b: 1.6 };

/** Resolve spectrum parameters from options. Returns { params, warnings } */
export function spectrumParams(o = {}) {
  const warnings = [];
  const code = (o.code || 'EC').toUpperCase() === 'SIA' ? 'SIA' : 'EC';
  const soil = (o.soil || 'B').toUpperCase();
  const q = o.q > 0 ? o.q : 1.5;
  const xi = o.damping ?? 0.05;
  const eta = o.eta > 0 ? o.eta : Math.max(Math.sqrt(10 / (5 + 100 * xi)), 0.55);
  const gamma = o.importance > 0 ? o.importance : 1;
  const vertical = (o.dir || 'X').toUpperCase() === 'Z';
  const type = o.type || (q > 1 ? 'design' : 'elastic');
  let ag = +o.ag || 0;
  let shape;
  if (code === 'SIA') {
    if (o.zone) {
      const z = SIA261_ZONES[o.zone];
      if (z == null) warnings.push(`Unknown SIA 261 zone '${o.zone}' – ag used.`);
      else ag = z;
    }
    shape = SIA261_GROUND[soil];
    if (!shape) {
      if (soil === 'F') warnings.push('SIA 261 16.2.2: ground class F requires a site-specific study – class D parameters used.');
      else warnings.push(`Unknown ground class '${soil}' – class D used.`);
      shape = SIA261_GROUND.D;
    }
    if (vertical) ag *= 0.7;
  } else {
    shape = EC8_TYPE1[soil];
    if (!shape) { warnings.push(`Unknown/unsupported EC8 ground type '${soil}' – type D used.`); shape = EC8_TYPE1.D; }
    if (vertical) {
      ag *= EC8_VERTICAL_TYPE1.ratio;
      shape = EC8_VERTICAL_TYPE1;
    }
  }
  return {
    params: { code, type, ag: ag * gamma, agBase: ag, gamma, q, eta, S: shape.S, TB: shape.TB, TC: shape.TC, TD: shape.TD, vertical },
    warnings,
  };
}

/** Spectral acceleration [m/s²] at period T for resolved parameters */
export function spectrumOrdinate(T, p) {
  const { ag, S, TB, TC, TD, q, eta } = p;
  T = Math.max(T, 0);
  if (p.type === 'elastic') {
    if (T <= TB) return ag * S * (1 + T / TB * (eta * 2.5 - 1));
    if (T <= TC) return ag * S * eta * 2.5;
    if (T <= TD) return ag * S * eta * 2.5 * TC / T;
    return ag * S * eta * 2.5 * TC * TD / (T * T);
  }
  if (p.code === 'SIA') {
    // SIA 261 16.2.3 design spectrum, lower bound 0.1·γf·agd
    let v;
    if (T < TB) v = ag * S * (0.67 + (2.5 / q - 0.67) * T / TB);
    else if (T < TC) v = 2.5 * ag * S / q;
    else if (T < TD) v = 2.5 * ag * S / q * TC / T;
    else v = 2.5 * ag * S / q * TC * TD / (T * T);
    return Math.max(v, 0.1 * ag);
  }
  // EN 1998-1 3.2.2.5 (4)P, β = 0.2
  const beta = 0.2;
  if (T <= TB) return ag * S * (2 / 3 + T / TB * (2.5 / q - 2 / 3));
  if (T <= TC) return ag * S * 2.5 / q;
  if (T <= TD) return Math.max(ag * S * 2.5 / q * TC / T, beta * ag);
  return Math.max(ag * S * 2.5 / q * TC * TD / (T * T), beta * ag);
}

/** CQC correlation coefficient (equal damping ζ) */
export function cqcRho(wi, wj, zeta) {
  const r = wj / wi;
  const z2 = zeta * zeta;
  return 8 * z2 * (1 + r) * r ** 1.5 / ((1 - r * r) ** 2 + 4 * z2 * r * (1 + r) ** 2);
}

/**
 * runSpectrum(model, mesh, modal, { code, dir, ag, soil, zone, q, eta, importance, rule, damping, type })
 * → CaseResult with positive (combined) values, plus `spectrum` info and `warnings`.
 */
export function runSpectrum(model, mesh, modal, options = {}) {
  const opts = { dir: 'X', rule: 'CQC', damping: 0.05, code: model.settings?.code ?? 'EC', ...options };
  const warnings = [];
  const prog = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  if (!modal || !modal.modes) modal = runModal(model, mesh, opts.modalOptions || {});
  if (modal.error) return { error: modal.error, warnings: modal.warnings || [] };
  const setup = setupModel(model, mesh, warnings);
  if (setup.error) return { error: setup.error, warnings };
  const { data, mask } = setup;
  const { params, warnings: w2 } = spectrumParams(opts);
  warnings.push(...w2);
  const d = { X: 0, Y: 1, Z: 2 }[(opts.dir || 'X').toUpperCase()] ?? 0;
  const empty = emptyLoads(data);
  const modeResults = [], info = [];
  modal.modes.forEach((m, i) => {
    prog(100 * i / Math.max(1, modal.modes.length), `Mode ${i + 1}`);
    const Sd = spectrumOrdinate(m.T, params);
    const G = m.partFactor[d];
    const Y = G * Sd / (m.omega * m.omega);
    const u = new Float64Array(m.shape.length);
    for (let k = 0; k < u.length; k++) u[k] = Y * m.shape[k];
    const rec = recoverCase(data, u, empty, { mask, springs: data.springs });
    modeResults.push(rec.result);
    info.push({ mode: i + 1, T: m.T, Sd, partFactor: G, effMass: m.effMass[d], Y });
  });
  const omegas = modal.modes.map((m) => m.omega);
  const z = opts.damping ?? 0.05;
  const cqc = (opts.rule || 'CQC').toUpperCase() === 'CQC';
  const nm = modeResults.length;
  let rho = null;
  if (cqc) {
    rho = new Float64Array(nm * nm);
    for (let i = 0; i < nm; i++) for (let j = 0; j < nm; j++) rho[i * nm + j] = cqcRho(omegas[i], omegas[j], z);
  }
  const res = nm ? mapCaseResults(modeResults, (arrs) => {
    const o = new Float64Array(arrs[0].length);
    for (let k = 0; k < o.length; k++) {
      let s = 0;
      if (cqc) {
        for (let i = 0; i < nm; i++) {
          const ri = arrs[i][k];
          if (!ri) continue;
          for (let j = 0; j < nm; j++) s += rho[i * nm + j] * ri * arrs[j][k];
        }
      } else for (let i = 0; i < nm; i++) s += arrs[i][k] * arrs[i][k];
      o[k] = Math.sqrt(Math.max(s, 0));
    }
    return o;
  }) : null;
  if (!res) return { error: { code: 'NO_MODES', message: 'Modal result has no modes.' }, warnings };
  res.spectrum = { ...params, rule: cqc ? 'CQC' : 'SRSS', dir: 'XYZ'[d], modes: info };
  const effSum = info.reduce((s, m) => s + m.effMass, 0);
  if (effSum < 0.9) warnings.push(`Sum of effective modal masses in ${'XYZ'[d]} = ${(100 * effSum).toFixed(1)} % < 90 % – consider more modes.`);
  res.warnings = warnings;
  res.error = null;
  prog(100, 'Done');
  return res;
}
