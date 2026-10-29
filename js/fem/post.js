// Post-processing: beam station results, shell corner resultants (raw + nodal-averaged per domain),
// support reactions; result utilities combineCases / envelope / lineForces.

import { beamStations } from './beam.js';
import { shellRecover } from './shell.js';
import { toLocalVector, toGlobalVector, matVec } from './linalg.js';
import { beamKgLocal, shellKgGlobal } from './assemble.js';
import { beamEquivalentLocal } from './loads.js';

export const BEAM_FIELDS = ['x', 'N', 'Vy', 'Vz', 'T', 'My', 'Mz', 'uy', 'uz'];

/**
 * Recover all results of one solution.
 * u: full displacement vector (6nn); loads: finalized load set; ctx: {
 *   mask (Uint8Array 6nn: 1 = support-fixed), springs (Map node→36 reaction springs),
 *   active (Uint8Array per beam or null), kg ({beamN, shellG} for P-Δ or null), ground (Float64Array 6nn | null) }
 * Returns { result: CaseResult, beamN: Float64Array, shellG: Array<Float64Array> }
 */
export function recoverCase(data, u, loads, ctx) {
  const nn = data.nn;
  const fint = new Float64Array(6 * nn);
  const beamsOut = new Array(data.beams.length);
  const beamN = new Float64Array(data.beams.length);
  const ue = new Float64Array(12);
  for (const be of data.beams) {
    const i = be.idx;
    for (let k = 0; k < 6; k++) { ue[k] = u[6 * be.n1 + k]; ue[6 + k] = u[6 * be.n2 + k]; }
    const uL = toLocalVector(ue, be.R);
    if (ctx.active && !ctx.active[i]) {
      beamsOut[i] = beamStations(be.L, be.props, null, uL, null, 'inactive');
      continue;
    }
    const fi = matVec(be.kL, uL, 12);
    if (ctx.kg && ctx.kg.beamN && ctx.kg.beamN[i]) {
      const kg = beamKgLocal(be, ctx.kg.beamN[i]);
      if (kg) { const add = matVec(kg, uL, 12); for (let k = 0; k < 12; k++) fi[k] += add[k]; }
    }
    const fg = toGlobalVector(fi, be.R);
    for (let k = 0; k < 6; k++) { fint[6 * be.n1 + k] += fg[k]; fint[6 * be.n2 + k] += fg[6 + k]; }
    const span = loads.span[i];
    const f = Float64Array.from(fi);
    const p = span ? beamEquivalentLocal(be, span) : null;
    if (p) for (let k = 0; k < 12; k++) f[k] -= p[k];
    const st = beamStations(be.L, be.props, f, uL, span, be.kind);
    beamsOut[i] = st;
    let s = 0;
    for (let k = 0; k < st.N.length; k++) s += st.N[k];
    beamN[i] = s / st.N.length;
  }

  const ns = data.shells.length;
  const raw = new Float64Array(ns * 32);
  const shellG = new Array(ns);
  const us = new Float64Array(24);
  for (const sh of data.shells) {
    for (let a = 0; a < 4; a++) for (let k = 0; k < 6; k++) us[6 * a + k] = u[6 * sh.nodes[a] + k];
    const fg = matVec(sh.kG, us, 24);
    if (ctx.kg && ctx.kg.shellG && ctx.kg.shellG[sh.idx]) {
      const K = shellKgGlobal(sh, ctx.kg.shellG[sh.idx]);
      const add = matVec(K, us, 24);
      for (let k = 0; k < 24; k++) fg[k] += add[k];
    }
    for (let a = 0; a < 4; a++) for (let k = 0; k < 6; k++) fint[6 * sh.nodes[a] + k] += fg[6 * a + k];
    const uL = toLocalVector(us, sh.R);
    const r = shellRecover(sh.op, sh.type, sh.alpha, sh.t, uL, loads.shellTemp[sh.idx]);
    raw.set(r.corner, sh.idx * 32);
    shellG[sh.idx] = r.gauss;
  }
  const smooth = smoothShells(data, raw);

  // reactions: support-fixed DOFs R = K·u − F ; spring DOFs R = K_s (ground − u)
  const reac = new Float64Array(6 * nn);
  const mask = ctx.mask;
  for (let d = 0; d < 6 * nn; d++) if (mask[d] === 1) reac[d] = fint[d] - loads.F[d];
  const springs = ctx.springs || data.springs;
  const ground = ctx.ground;
  for (const [n, K] of springs) {
    for (let i = 0; i < 6; i++) {
      if (mask[6 * n + i] === 1 || mask[6 * n + i] === 2) continue;
      let s = 0;
      for (let j = 0; j < 6; j++) {
        const kij = K[i * 6 + j];
        if (!kij) continue;
        const dj = 6 * n + j;
        const gj = mask[dj] === 1 ? u[dj] : (ground ? ground[dj] : 0);
        s += kij * (gj - u[dj]);
      }
      reac[6 * n + i] += s;
    }
  }
  return {
    result: { disp: u, reac, beams: beamsOut, shells: smooth, shellsRaw: raw },
    beamN, shellG, fint,
  };
}

/** Average corner values per mesh node within the same domain */
export function smoothShells(data, raw) {
  const out = new Float64Array(raw.length);
  const nn = data.nn;
  const sum = new Float64Array(nn * 8);
  const cnt = new Float64Array(nn);
  for (const [, elems] of data.domainShells) {
    for (const ei of elems) {
      const sh = data.shells[ei];
      for (let c = 0; c < 4; c++) {
        const n = sh.nodes[c];
        cnt[n]++;
        for (let k = 0; k < 8; k++) sum[n * 8 + k] += raw[ei * 32 + c * 8 + k];
      }
    }
    for (const ei of elems) {
      const sh = data.shells[ei];
      for (let c = 0; c < 4; c++) {
        const n = sh.nodes[c];
        for (let k = 0; k < 8; k++) out[ei * 32 + c * 8 + k] = sum[n * 8 + k] / cnt[n];
      }
    }
    for (const ei of elems) {
      const sh = data.shells[ei];
      for (let c = 0; c < 4; c++) {
        const n = sh.nodes[c];
        cnt[n] = 0;
        for (let k = 0; k < 8; k++) sum[n * 8 + k] = 0;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result utilities
// ---------------------------------------------------------------------------

export function mapCaseResults(results, fn) {
  // fn(arrays[]) → Float64Array; applied to every numeric array of the CaseResult structure
  const r0 = results[0];
  const out = {
    disp: fn(results.map((r) => r.disp)),
    reac: fn(results.map((r) => r.reac)),
    beams: r0.beams.map((b, i) => {
      const o = {};
      for (const k of BEAM_FIELDS) {
        o[k] = k === 'x' ? Float64Array.from(b.x) : fn(results.map((r) => r.beams[i][k]));
      }
      return o;
    }),
    shells: fn(results.map((r) => r.shells)),
    shellsRaw: fn(results.map((r) => r.shellsRaw)),
  };
  return out;
}

/** Linear combination Σ factors[i]·caseResults[i] (null entries are skipped) */
export function combineCases(caseResults, factors) {
  const list = [], fac = [];
  caseResults.forEach((r, i) => { if (r) { list.push(r); fac.push(factors?.[i] ?? 1); } });
  if (!list.length) return null;
  return mapCaseResults(list, (arrs) => {
    const o = new Float64Array(arrs[0].length);
    for (let j = 0; j < arrs.length; j++) {
      const a = arrs[j], f = fac[j];
      if (!f) continue;
      for (let k = 0; k < o.length; k++) o[k] += f * a[k];
    }
    return o;
  });
}

/** Component-wise min/max over case results */
export function envelope(caseResults) {
  const list = caseResults.filter(Boolean);
  if (!list.length) return { min: null, max: null };
  const red = (op) => (arrs) => {
    const o = Float64Array.from(arrs[0]);
    for (let j = 1; j < arrs.length; j++) {
      const a = arrs[j];
      for (let k = 0; k < o.length; k++) o[k] = op(o[k], a[k]);
    }
    return o;
  };
  return { min: mapCaseResults(list, red(Math.min)), max: mapCaseResults(list, red(Math.max)) };
}

/** Concatenate stations of all FE beams of a model line, x measured from the line start */
export function lineForces(mesh, caseResult, lineId) {
  const out = { x: [], N: [], Vy: [], Vz: [], T: [], My: [], Mz: [], uy: [], uz: [] };
  const segs = [];
  (mesh.beams || []).forEach((b, i) => { if (b.line === lineId) segs.push(i); });
  if (!segs.length || !caseResult) return out;
  const t0 = (i) => Math.min(mesh.beams[i].t0 ?? 0, mesh.beams[i].t1 ?? 1);
  segs.sort((a, b) => t0(a) - t0(b));
  // total line length from the segment lengths
  const nodes = mesh.nodes;
  const len = (b) => Math.hypot(nodes[3 * b.n2] - nodes[3 * b.n1], nodes[3 * b.n2 + 1] - nodes[3 * b.n1 + 1],
    nodes[3 * b.n2 + 2] - nodes[3 * b.n1 + 2]);
  let Ltot = 0;
  for (const i of segs) Ltot += len(mesh.beams[i]);
  for (const i of segs) {
    const b = mesh.beams[i];
    const r = caseResult.beams[i];
    if (!r) continue;
    const dt = Math.abs((b.t1 ?? 1) - (b.t0 ?? 0));
    const start = t0(i) * (dt > 0 ? len(b) / dt : Ltot);
    const rev = (b.t1 ?? 1) < (b.t0 ?? 0);
    const ns = r.x.length;
    const Lb = len(b);
    for (let k = 0; k < ns; k++) {
      const kk = rev ? ns - 1 - k : k;
      out.x.push(start + (rev ? Lb - r.x[kk] : r.x[kk]));
      for (const f of ['N', 'Vy', 'Vz', 'T', 'My', 'Mz', 'uy', 'uz']) out[f].push(r[f][kk]);
    }
  }
  return out;
}
