// Static analysis: linear (one factorisation, all load cases, combinations by superposition) and
// nonlinear (each combination solved directly: tension/compression-only members, uplift supports,
// P-Δ with geometric stiffness updated from the current axial/membrane forces).

import { prepareModel, analyzeDofs, buildSystem, assembleK, DOF_NAMES, nodeLabel, beamKgGlobal, shellKgGlobal } from './assemble.js';
import { ldlFactor, ldlSolve, matVec } from './linalg.js';
import { buildCaseLoads, combineLoads } from './loads.js';
import { recoverCase, combineCases } from './post.js';

export const PIVOT_TOL = 1e-11;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function mechanismError(data, sys, eq, prefix = '') {
  const dof = sys.dofOfEq[eq];
  const node = (dof / 6) | 0, k = dof % 6;
  const nodeId = data.mesh.nodeModelId ? data.mesh.nodeModelId[node] : 0;
  return {
    code: 'MECHANISM', node, nodeId, dof: k, dofName: DOF_NAMES[k],
    message: `${prefix}Structure is unstable (mechanism / singular stiffness) at ${nodeLabel(data, node)}, DOF ${DOF_NAMES[k]}.`,
  };
}

/** Common setup: prepare model, check supports, suppress zero-stiffness DOFs */
export function setupModel(model, mesh, warnings) {
  const data = prepareModel(model, mesh);
  warnings.push(...data.warnings);
  if (data.error) return { error: data.error };
  if (!data.hasSupports) return { error: { code: 'NO_SUPPORTS', message: 'The model has no supports.' } };
  const dof = analyzeDofs(data);
  data.fict = dof.fict;
  warnings.push(...dof.warnings);
  return { data, mask: dof.mask };
}

/** Assemble + factorise; returns { sys, K } or { error } */
export function factorSystem(data, mask, opts = {}, onProgress) {
  const sys = opts.sys || buildSystem(data, mask);
  const K = assembleK(data, sys, opts);
  const fac = ldlFactor(K, PIVOT_TOL, onProgress);
  if (!fac.ok) return { error: mechanismError(data, sys, fac.eq, opts.errorPrefix || ''), sys };
  return { sys, K };
}

/** Full K·x (elements + springs) for prescribed-displacement load terms */
function kTimes(data, x, ctx) {
  const y = new Float64Array(x.length);
  const e = new Float64Array(24);
  for (const be of data.beams) {
    if (ctx.active && !ctx.active[be.idx]) continue;
    let any = false;
    for (let k = 0; k < 6; k++) { e[k] = x[6 * be.n1 + k]; e[6 + k] = x[6 * be.n2 + k]; if (e[k] || e[6 + k]) any = true; }
    if (!any) continue;
    const ue = e.subarray(0, 12);
    const f = matVec(be.kG, ue, 12);
    const N = ctx.kg?.beamN?.[be.idx];
    if (N) { const K = beamKgGlobal(be, N); if (K) { const g = matVec(K, ue, 12); for (let k = 0; k < 12; k++) f[k] += g[k]; } }
    for (let k = 0; k < 6; k++) { y[6 * be.n1 + k] += f[k]; y[6 * be.n2 + k] += f[6 + k]; }
  }
  for (const sh of data.shells) {
    let any = false;
    for (let a = 0; a < 4; a++) for (let k = 0; k < 6; k++) { const v = x[6 * sh.nodes[a] + k]; e[6 * a + k] = v; if (v) any = true; }
    if (!any) continue;
    const f = matVec(sh.kG, e, 24);
    const G = ctx.kg?.shellG?.[sh.idx];
    if (G) { const K = shellKgGlobal(sh, G); const g = matVec(K, e, 24); for (let k = 0; k < 24; k++) f[k] += g[k]; }
    for (let a = 0; a < 4; a++) for (let k = 0; k < 6; k++) y[6 * sh.nodes[a] + k] += f[6 * a + k];
  }
  for (const map of [ctx.springs || data.springs, data.fict]) {
    if (!map) continue;
    for (const [n, K] of map) for (let i = 0; i < 6; i++) {
      let s = 0;
      for (let j = 0; j < 6; j++) s += K[i * 6 + j] * x[6 * n + j];
      y[6 * n + i] += s;
    }
  }
  return y;
}

/**
 * Solve one load set with a factorised K.
 * ctx: { sys, K, mask, active, springs, kg }
 * Returns { u, ground, lost: {force, presc} }
 */
export function solveLoads(data, ctx, loads) {
  const { sys, K, mask } = ctx;
  const nd = 6 * data.nn;
  const rhs = new Float64Array(sys.neq);
  for (let j = 0; j < sys.neq; j++) rhs[j] = loads.F[sys.dofOfEq[j]];
  let lostForce = 0, lostPresc = 0;
  for (let d = 0; d < nd; d++) if (mask[d] === 2 && Math.abs(loads.F[d]) > 0) lostForce++;
  const up = new Float64Array(nd);
  let ground = null, anyUp = false;
  const springs = ctx.springs || data.springs;
  for (const [d, v] of loads.presc) {
    if (mask[d] === 1) { up[d] = v; anyUp = true; }
    else if (mask[d] === 0 && springs.has((d / 6) | 0) && springs.get((d / 6) | 0)[(d % 6) * 7] > 0) {
      (ground ||= new Float64Array(nd))[d] = v;
    } else lostPresc++;
  }
  if (anyUp) {
    const f = kTimes(data, up, ctx);
    for (let j = 0; j < sys.neq; j++) rhs[j] -= f[sys.dofOfEq[j]];
  }
  if (ground) {
    for (const [n, Ks] of springs) for (let i = 0; i < 6; i++) {
      const e = sys.eq[6 * n + i];
      if (e < 0) continue;
      let s = 0;
      for (let j = 0; j < 6; j++) s += Ks[i * 6 + j] * ground[6 * n + j];
      rhs[e] += s;
    }
  }
  ldlSolve(K, rhs);
  const u = up;
  for (let j = 0; j < sys.neq; j++) u[sys.dofOfEq[j]] = rhs[j];
  return { u, ground, lost: { force: lostForce, presc: lostPresc } };
}

function lostWarnings(key, lost, warnings) {
  if (lost.force) warnings.push(`${key}: ${lost.force} load component(s) act on suppressed DOFs without stiffness and were ignored.`);
  if (lost.presc) warnings.push(`${key}: ${lost.presc} prescribed displacement(s) on unsupported DOFs ignored.`);
}

function selectCases(model, sel) {
  const all = model.loadCases || [];
  if (sel == null || sel === 'all') return all;
  const ids = new Set(Array.isArray(sel) ? sel : [sel]);
  return all.filter((c) => ids.has(c.id));
}

function selectCombos(model, sel) {
  const all = model.combinations || [];
  if (sel === false) return [];
  if (sel == null || sel === true || sel === 'all') return all;
  const ids = new Set(Array.isArray(sel) ? sel : [sel]);
  return all.filter((c) => ids.has(c.id));
}

/**
 * runStatic(model, mesh, { nonlinear, pDelta, cases, combos, onProgress, maxIter })
 */
export function runStatic(model, mesh, options = {}) {
  const t0 = now();
  const opts = { nonlinear: false, pDelta: false, cases: 'all', combos: true, ...options };
  const out = { cases: {}, warnings: [], error: null, stats: { dofs: 0, ms: 0 } };
  const prog = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const warn = (m) => out.warnings.push(m);
  try {
    prog(0, 'Preparing model');
    const setup = setupModel(model, mesh, out.warnings);
    if (setup.error) { out.error = setup.error; return out; }
    const { data, mask } = setup;
    const cases = selectCases(model, opts.cases);
    const combos = selectCombos(model, opts.combos);
    const nonlinear = !!(opts.nonlinear || opts.pDelta);
    // base structure must be stable (linear, all members active, supports in contact)
    prog(5, 'Factorizing stiffness matrix');
    const fs = factorSystem(data, mask, {}, (f) => prog(5 + 30 * f, 'Factorizing stiffness matrix'));
    out.stats.dofs = fs.sys.neq;
    if (fs.error) { out.error = fs.error; return out; }
    const baseCtx = { sys: fs.sys, K: fs.K, mask, active: null, springs: data.springs, kg: null };
    const loadCache = new Map();
    const caseLoads = (id) => {
      if (!loadCache.has(id)) loadCache.set(id, buildCaseLoads(data, id, warn));
      return loadCache.get(id);
    };

    if (!nonlinear) {
      // all load cases needed by the selected cases and combinations
      const need = new Map(cases.map((c) => [c.id, c]));
      for (const co of combos) for (const id of Object.keys(co.factors || {})) {
        const lc = (model.loadCases || []).find((c) => String(c.id) === String(id));
        if (lc) need.set(lc.id, lc);
        else warn(`Combination ${co.id}: load case ${id} not found.`);
      }
      const list = [...need.values()];
      list.forEach((lc, i) => {
        prog(35 + 55 * i / Math.max(1, list.length), `Load case ${lc.name ?? lc.id}`);
        const loads = caseLoads(lc.id);
        const sol = solveLoads(data, baseCtx, loads);
        lostWarnings(`LC ${lc.id}`, sol.lost, out.warnings);
        const rec = recoverCase(data, sol.u, loads, { mask, springs: data.springs, ground: sol.ground });
        out.cases['LC:' + lc.id] = rec.result;
      });
      for (const co of combos) {
        const rs = [], fs2 = [];
        for (const [id, f] of Object.entries(co.factors || {})) {
          const r = out.cases['LC:' + id];
          if (r && f) { rs.push(r); fs2.push(+f); }
        }
        const comb = rs.length ? combineCases(rs, fs2) : null;
        out.cases['CO:' + co.id] = comb || zeroResult(data);
      }
    } else {
      const targets = combos.length
        ? combos.map((c) => ({ key: 'CO:' + c.id, factors: c.factors || {} }))
        : cases.map((c) => ({ key: 'LC:' + c.id, factors: { [c.id]: 1 } }));
      targets.forEach((tg, i) => {
        prog(35 + 60 * i / Math.max(1, targets.length), `Nonlinear ${tg.key}`);
        const list = [];
        for (const [id, f] of Object.entries(tg.factors)) {
          const lc = (model.loadCases || []).find((c) => String(c.id) === String(id));
          if (!lc) { warn(`${tg.key}: load case ${id} not found.`); continue; }
          list.push({ loads: caseLoads(lc.id), f: +f });
        }
        const loads = combineLoads(data, list);
        const r = solveNonlinear(data, mask, loads, opts, fs, tg.key);
        out.warnings.push(...r.warnings);
        if (r.result) out.cases[tg.key] = r.result;
      });
    }
    prog(100, 'Done');
  } catch (e) {
    out.error = { code: 'INTERNAL', message: String(e && e.message || e), stack: e && e.stack };
  }
  out.stats.ms = Math.round(now() - t0);
  return out;
}

export function zeroResult(data) {
  const ns = data.shells.length;
  const z = () => new Float64Array(11);
  return {
    disp: new Float64Array(6 * data.nn), reac: new Float64Array(6 * data.nn),
    beams: data.beams.map((b) => {
      const x = new Float64Array(11);
      for (let k = 0; k < 11; k++) x[k] = b.L * k / 10;
      return { x, N: z(), Vy: z(), Vz: z(), T: z(), My: z(), Mz: z(), uy: z(), uz: z() };
    }),
    shells: new Float64Array(ns * 32), shellsRaw: new Float64Array(ns * 32),
  };
}

/**
 * Iterative solution of one load set:
 *  - tension-/compression-only members (opts.nonlinear) are switched off/on by sign of N / elongation
 *  - uplift supports (opts.nonlinear): contact released when Rz < 0, re-established when uz < 0
 *  - P-Δ (opts.pDelta): K + K_G(N, n) with forces from the previous iterate
 */
export function solveNonlinear(data, baseMask, loads, opts, base, key) {
  const warnings = [];
  const useNl = !!opts.nonlinear;
  const pDelta = !!opts.pDelta;
  const maxIter = opts.maxIter || 50;
  const nb = data.beams.length;
  const active = new Uint8Array(nb).fill(1);
  const nlBeams = useNl ? data.beams.filter((b) => b.nl === 'tension' || b.nl === 'compression') : [];
  const uplift = useNl ? data.uplift : [];
  const contact = new Uint8Array(uplift.length).fill(1);
  let kg = null, prevU = null, sys = base.sys, prevMaskKey = null;
  let maxF = 0;
  for (let i = 0; i < loads.F.length; i++) maxF = Math.max(maxF, Math.abs(loads.F[i]));
  const tolR = 1e-9 * Math.max(maxF, 1e-9);
  let last = null;
  for (let it = 0; it < maxIter; it++) {
    const mask = Uint8Array.from(baseMask);
    let springs = data.springs;
    const changedSprings = [];
    uplift.forEach((up, k) => {
      if (up.kind === 'F') mask[up.dof] = contact[k] ? 1 : 0;
      else if (!contact[k]) changedSprings.push(up);
    });
    if (changedSprings.length) {
      springs = new Map(data.springs);
      for (const up of changedSprings) {
        const K = Float64Array.from(springs.get(up.node));
        K[2 * 7] -= up.k;
        springs.set(up.node, K);
      }
    }
    const maskKey = uplift.map((up, k) => (up.kind === 'F' ? contact[k] : 1)).join('');
    if (maskKey !== prevMaskKey && it > 0) sys = null;
    prevMaskKey = maskKey;
    const isBase = it === 0 && !kg && contact.every((c) => c) && active.every((a) => a);
    let K;
    if (isBase && sys === base.sys) K = base.K;
    else {
      const fs = factorSystem(data, mask, { sys: sys || undefined, active, springs, kg });
      if (fs.error) {
        const msg = pDelta && kg ? 'P-Δ: load exceeds the critical load or structure unstable – ' : 'Nonlinear: ';
        warnings.push(`${key}: ${msg}${fs.error.message}`);
        return { result: null, warnings, error: fs.error };
      }
      sys = fs.sys; K = fs.K;
    }
    const ctx = { sys, K, mask, active, springs, kg };
    const sol = solveLoads(data, ctx, loads);
    if (it === 0) lostWarnings(key, sol.lost, warnings);
    const rec = recoverCase(data, sol.u, loads, { mask, springs, active, kg, ground: sol.ground });
    last = rec;
    const u = sol.u;
    let changed = false;
    let maxN = 0;
    for (let i = 0; i < nb; i++) maxN = Math.max(maxN, Math.abs(rec.beamN[i]));
    const tolN = 1e-9 * Math.max(maxN, 1e-9);
    for (const be of nlBeams) {
      const i = be.idx;
      const tension = be.nl === 'tension';
      if (active[i]) {
        const N = rec.beamN[i];
        if ((tension && N < -tolN) || (!tension && N > tolN)) { active[i] = 0; changed = true; }
      } else {
        // elongation of the (inactive) chord minus free thermal elongation
        let d = 0;
        for (let k = 0; k < 3; k++) d += be.R[k] * (u[6 * be.n2 + k] - u[6 * be.n1 + k]);
        const sp = loads.span[i];
        if (sp && sp.dT) d -= be.props.alpha * sp.dT * be.L;
        if ((tension && d > 1e-12) || (!tension && d < -1e-12)) { active[i] = 1; changed = true; }
      }
    }
    uplift.forEach((up, k) => {
      if (up.kind === 'F') {
        if (contact[k]) { if (rec.result.reac[up.dof] < -tolR) { contact[k] = 0; changed = true; } }
        else if (u[up.dof] < -1e-12) { contact[k] = 1; changed = true; }
      } else if (contact[k]) { if (u[up.dof] > 1e-12) { contact[k] = 0; changed = true; } }
      else if (u[up.dof] < -1e-12) { contact[k] = 1; changed = true; }
    });
    let conv = true;
    if (pDelta) {
      let du = 0, um = 0;
      for (let d = 0; d < u.length; d++) {
        um = Math.max(um, Math.abs(u[d]));
        if (prevU) du = Math.max(du, Math.abs(u[d] - prevU[d]));
      }
      conv = !!prevU && du <= 1e-7 * Math.max(um, 1e-12);
      kg = { beamN: rec.beamN, shellG: rec.shellG };
      prevU = u;
    }
    if (!changed && conv) {
      const nOff = nlBeams.filter((b) => !active[b.idx]).length;
      const nLift = uplift.filter((_, k) => !contact[k]).length;
      if (nOff) warnings.push(`${key}: ${nOff} tension/compression-only member(s) inactive.`);
      if (nLift) warnings.push(`${key}: ${nLift} uplift support(s) lifted off.`);
      rec.result.iterations = it + 1;
      return { result: rec.result, warnings, iterations: it + 1 };
    }
  }
  warnings.push(`${key}: nonlinear iteration did not converge in ${maxIter} iterations – last iterate returned.`);
  if (last) last.result.iterations = maxIter;
  return { result: last ? last.result : null, warnings, converged: false };
}
