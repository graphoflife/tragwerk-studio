// Timber member checks – EN 1995-1-1 (opts.code 'EC', default) and SIA 265 (opts.code 'SIA').
// Pure ES module (no DOM). See SPEC.md §5.
// DEVIATIONS FROM SPEC.md §5: same result shape as checkSteelMembers with `cls: null` and the
//   extra fields `code`, `notes`, `serviceClass`, `kind`; array property `warnings`; optional
//   load-group extension fields `duration` (EC kmod) and `etaT` (SIA ηt).
//
// checkTimberMembers(model, mesh, staticResults, caseKeys, opts?) → same shape as checkSteelMembers:
//   [{ line, eta, governing:{check, caseKey, x}, cls:null, code, checks:{ [name]:{eta, caseKey, x, detail} },
//      notes, serviceClass, kind }]  + array property `warnings`.
// Check names: 'N','Vy','Vz','T','My','Mz','M+N','FB-y','FB-z','LTB'.
//
// Members: lines (beam | rib | truss) whose material.type === 'timber' and which have
// material.timber = { fmk, ft0k, fc0k, fvk, E0mean, E005, Gmean, rhok, kind:'solid'|'glulam'|'lvl', serviceClass }
// (kN/m²). Sections: RECT (h along local z, b along y) and CIRC; other shapes with A, Iy, Iz,
// Wely, Welz from the section (km = 1, τ = 1.5·V/A, no LTB unless It is given).
//
// ───────────────────────────── strength modification ─────────────────────────────
// Load duration of a result case: the shortest duration of all load groups acting in it
//   (EN 1995-1-1 3.1.3(2)); group type → duration: permanent → permanent, variable → medium,
//   snow → short, wind → short, accidental/seismic → instantaneous; loadGroup.duration
//   ('permanent'|'long'|'medium'|'short'|'instantaneous') overrides. Load cases without group are
//   permanent. Case keys that cannot be resolved (no model combination) → 'medium' (kmod = 0.8 in
//   service class 1/2) – documented default.
// EC: fd = kmod·fk/γM with kmod from Table 3.1 (solid timber / glulam / LVL, service class 1–3),
//   γM = 1.3 solid, 1.25 glulam, 1.2 LVL (Table 2.3), material.gammaM overrides; accidental
//   combinations (type 'ULS-ACC') γM = 1.0 (2.4.1 Table 2.3 note).
//   kh (3.2(3)/3.3(3)): solid h < 150 mm: (150/h)^0.2 ≤ 1.3 (ρk ≤ 700 assumed); glulam h < 600 mm:
//   (600/h)^0.1 ≤ 1.1 – bending with the depth of the respective axis, tension with the larger
//   dimension. km = 0.7 for rectangular sections (6.1.6(2)), 1.0 otherwise.
// SIA 265: fd = ηM·ηt·ηw·fk/γM with γM = 1.7 solid (Vollholz), 1.5 glulam (Brettschichtholz);
//   ηw (moisture class 1/2/3) = 1.0 / 0.9 / 0.75; ηM = material.timber.etaM ?? 1.0;
//   ηt = 1.0 for all static load durations (the SIA 265 design values with γM 1.7/1.5 apply to
//   all load durations; ηt only reduces strengths for dynamic actions) – a load group may
//   specify `etaT` (the minimum of the acting groups is used). Source: Lignum HBT1 (2021, based
//   on SIA 265:2012): e.g. C24 fm,d = 24/1.7 = 14.1 N/mm², fc,0,d = 21/1.7 = 12.4 N/mm²,
//   "für andere Feuchteklassen und bei dynamischen Einwirkungen gelten die (ηw·ηt)-fachen
//   Bemessungswerte", ηw 1.0/0.9/0.75. The SIA 265 primary text was not consulted.
//   SIA path: kh = 1.0 and km = 1.0 (linear biaxial bending – conservative, not verified).
// Shear (EC 6.1.7): τ = 1.5·V/(kcr·b·h) with kcr = 0.67 (solid timber & glulam). The same kcr is
//   applied in the SIA path: with EN 338 fvk (C24: 4.0 N/mm²) this reproduces the SIA 265 design
//   value fv,d ≈ 0.67·4.0/1.7 = 1.58 ≈ 1.5 N/mm² (Lignum HBT1). opts.kcr overrides.
// Torsion (6.1.8): τtor ≤ kshape·fv,d, kshape = min(1 + 0.15·h/b, 2) (rect), 1.2 (circular).
//
// ───────────────────────────────────── stability ─────────────────────────────────────
// Column buckling (EC 6.3.2 / SIA 265 4.2.8 eq. 265.29–265.31 – identical formulation):
//   λrel = λ/π·√(fc,0,k/E0,05), k = 0.5[1 + βc(λrel − 0.3) + λrel²], kc = 1/(k + √(k² − λrel²)),
//   βc = 0.2 solid / 0.1 glulam, Lcr = Ky·L, Kz·L. Checks (6.23)/(6.24) evaluated at every station
//   with the local bending stresses; if λrel,y ≤ 0.3 and λrel,z ≤ 0.3 the M+N check (6.19/6.20)
//   governs and FB-y/FB-z report 0.
// Lateral torsional stability (EC 6.3.3): σm,crit = π·√(E0,05·Iz·G0,05·It)/(lef·Wy) with
//   G0,05 = Gmean·E0,05/E0,mean and lef = KLT·L/C1 (C1 from element.design, default 1; Table 6.1
//   values 0.9 (UDL) / 0.8 (point load) correspond to C1 ≈ 1.13 / 1.35; load at the centroid).
//   λrel,m = √(fm,k/σm,crit), kcrit per (6.34); checks (6.33) and, with compression, (6.35).
//   Only for bending about y of sections with Iz < Iy. SIA path uses the same formulation (documented).

import {
  MEMBER_TYPES, designCode, num, pos, fmt, fmtMPa, designContext, collectLineForces,
  fillSectionProps, CheckSet, caseFactors,
} from './common.js';
import { groupParams } from './combinations.js';

const CHECKS = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz', 'M+N', 'FB-y', 'FB-z', 'LTB'];
const DURATIONS = ['permanent', 'long', 'medium', 'short', 'instantaneous'];
const DUR_ALIAS = {
  'long-term': 'long', 'medium-term': 'medium', 'short-term': 'short', 'very-short': 'instantaneous',
  'very short': 'instantaneous', instant: 'instantaneous',
};
/** EN 1995-1-1 Table 3.1 (solid timber, glulam, LVL). */
export const KMOD = Object.freeze({
  1: Object.freeze({ permanent: 0.6, long: 0.7, medium: 0.8, short: 0.9, instantaneous: 1.1 }),
  2: Object.freeze({ permanent: 0.6, long: 0.7, medium: 0.8, short: 0.9, instantaneous: 1.1 }),
  3: Object.freeze({ permanent: 0.5, long: 0.55, medium: 0.65, short: 0.7, instantaneous: 0.9 }),
});
/** SIA 265 moisture factor ηw per moisture class (Feuchteklasse) – Lignum HBT1. */
export const ETA_W_SIA = Object.freeze({ 1: 1.0, 2: 0.9, 3: 0.75 });

function normDuration(d) {
  if (typeof d !== 'string') return null;
  const s = DUR_ALIAS[d] || d;
  return DURATIONS.includes(s) ? s : null;
}

/** Load-duration info of a result case: { dur, accidental, etaT, resolved }. */
function caseDuration(ctx, key, code) {
  const cf = caseFactors(ctx, key);
  if (!cf) return { dur: 'medium', accidental: false, etaT: 1, resolved: false };
  let idx = -1, accidental = cf.type === 'ULS-ACC', etaT = 1;
  for (const [lcId, f] of Object.entries(cf.factors)) {
    if (!(Math.abs(Number(f)) > 1e-12)) continue;
    const lc = ctx.loadCases.get(Number(lcId));
    const grp = lc && lc.group != null ? ctx.loadGroups.get(Number(lc.group)) : null;
    const p = groupParams(grp || { type: 'permanent' }, code);
    const dur = normDuration(grp && grp.duration) || normDuration(p.duration) || 'medium';
    idx = Math.max(idx, DURATIONS.indexOf(dur));
    if (p.type === 'accidental' || p.type === 'seismic') accidental = true;
    if (grp && Number.isFinite(grp.etaT) && grp.etaT > 0) etaT = Math.min(etaT, grp.etaT);
  }
  return { dur: idx >= 0 ? DURATIONS[idx] : 'medium', accidental, etaT, resolved: idx >= 0 };
}

/** EN 1995-1-1 6.3.2 / SIA 265 (265.30–265.31) buckling factor. */
export function kcBuckling(lamRel, betaC) {
  if (!(lamRel > 0.3)) return 1;
  const k = 0.5 * (1 + betaC * (lamRel - 0.3) + lamRel * lamRel);
  return Math.min(1, 1 / (k + Math.sqrt(Math.max(0, k * k - lamRel * lamRel))));
}

/** EN 1995-1-1 (6.34) kcrit. */
export function kcrit(lamRelM) {
  if (lamRelM <= 0.75) return 1;
  if (lamRelM <= 1.4) return 1.56 - 0.75 * lamRelM;
  return 1 / (lamRelM * lamRelM);
}

export function checkTimberMembers(model, mesh, staticResults, caseKeys, opts = {}) {
  const out = [];
  out.warnings = [];
  const code = designCode(model, opts);
  out.code = code;
  try {
    const ctx = designContext(model, mesh, staticResults, caseKeys, out.warnings, 'beams');
    for (const line of Array.isArray(model?.lines) ? model.lines : []) {
      const el = line && line.element;
      if (!el || !MEMBER_TYPES.has(el.type)) continue;
      const mat = ctx.materials.get(Number(el.material));
      if (!mat || mat.type !== 'timber') continue;
      try {
        const r = checkMember(ctx, code, line, el, mat, opts || {});
        if (r) out.push(r);
      } catch (e) {
        out.warnings.push(`Line ${line.id}: timber check failed (${e && e.message})`);
      }
    }
  } catch (e) {
    out.warnings.push(`Timber design aborted: ${e && e.message}`);
  }
  return out;
}

function checkMember(ctx, code, line, el, mat, opts) {
  const W = (msg) => { ctx.warnings.push(`Line ${line.id}: ${msg} – timber check skipped`); return null; };
  const SIA = code === 'SIA';
  const tm = mat.timber;
  if (!tm || typeof tm !== 'object') return W('material without timber properties');
  const fmk = pos(tm.fmk, NaN), ft0k = pos(tm.ft0k, NaN), fc0k = pos(tm.fc0k, NaN), fvk = pos(tm.fvk, NaN);
  if (!(fmk > 0 && fc0k > 0)) return W('timber strengths fmk/fc0k missing');
  const kind = tm.kind === 'glulam' ? 'glulam' : tm.kind === 'lvl' ? 'lvl' : 'solid';
  const E0mean = pos(tm.E0mean, pos(mat.E, NaN));
  const E005 = pos(tm.E005, E0mean * (kind === 'solid' ? 0.67 : 0.833));
  const Gmean = pos(tm.Gmean, pos(mat.G, E0mean / 16));
  const G005 = Gmean * E005 / E0mean;
  const sc = [1, 2, 3].includes(Number(opts.serviceClass)) ? Number(opts.serviceClass)
    : [1, 2, 3].includes(Number(tm.serviceClass)) ? Number(tm.serviceClass) : 1;
  const sec0 = ctx.sections.get(Number(el.section));
  if (!sec0) return W('no section');
  const p = fillSectionProps(sec0);
  const L = ctx.lineLength(line);
  if (!(L > 0)) return W('zero length');
  const segs = ctx.segs.get(Number(line.id));
  if (!segs || !segs.length) return W('no mesh beams');
  const notes = [];
  const d = p.dims || {};
  let shape = 'GEN', h, b, D;
  if (p.shape === 'RECT' && d.h > 0 && d.b > 0) { shape = 'RECT'; h = d.h; b = d.b; }
  else if (p.shape === 'CIRC' && d.d > 0) { shape = 'CIRC'; D = d.d; h = b = D; }
  if (!(p.A > 0 && p.Iy > 0 && p.Iz > 0)) return W('section lacks A/Iy/Iz');
  const Wy = p.Wely > 0 ? p.Wely : (h ? p.Iy / (h / 2) : NaN);
  const Wz = p.Welz > 0 ? p.Welz : (b ? p.Iz / (b / 2) : NaN);
  if (shape === 'GEN') notes.push(`section shape ${p.shape}: km = 1, τ = 1.5·V/A, kh = 1`);
  if (!(fvk > 0)) notes.push('fvk missing – shear not checked');
  if (!(ft0k > 0)) notes.push('ft0k missing – tension checked with fc0k');

  // code-dependent factors
  const gMbase = pos(mat.gammaM, SIA ? (kind === 'solid' ? 1.7 : 1.5) : (kind === 'solid' ? 1.3 : kind === 'glulam' ? 1.25 : 1.2));
  const etaM = pos(tm.etaM, 1.0), etaW = ETA_W_SIA[sc];
  const kh = (dim) => {
    if (SIA || shape === 'GEN' || !(dim > 0)) return 1;
    const mm = dim * 1000;
    if (kind === 'solid') return mm < 150 ? Math.min(1.3, (150 / mm) ** 0.2) : 1;
    if (kind === 'glulam') return mm < 600 ? Math.min(1.1, (600 / mm) ** 0.1) : 1;
    return 1;
  };
  const khy = kh(h), khz = kh(b), kht = kh(Math.max(h || 0, b || 0));
  const km = SIA ? 1.0 : (shape === 'RECT' ? 0.7 : 1.0);
  const kcr = pos(opts.kcr, 0.67);
  const ref = SIA
    ? { N: 'SIA 265 4.2', V: 'SIA 265 4.2 (Schub)', T: 'SIA 265 4.2 (Torsion)', M: 'SIA 265 4.2 (Biegung)', MN: 'SIA 265 4.2.8.5', FB: 'SIA 265 4.2.8 (265.29–265.31)', LTB: 'SIA 265 4.2 (Kippen)' }
    : { N: 'EN 1995-1-1 6.1.2/6.1.4', V: 'EN 1995-1-1 6.1.7', T: 'EN 1995-1-1 6.1.8', M: 'EN 1995-1-1 6.1.6', MN: 'EN 1995-1-1 6.2.3/6.2.4', FB: 'EN 1995-1-1 6.3.2 (6.23/6.24)', LTB: 'EN 1995-1-1 6.3.3' };

  // stability data
  const dz = el.design || {};
  const Ky = pos(dz.Ky, 1), Kz = pos(dz.Kz, 1), KLT = num(dz.KLT, 1), C1 = pos(dz.C1, 1);
  const betaC = kind === 'solid' ? 0.2 : 0.1;
  const iy = Math.sqrt(p.Iy / p.A), iz = Math.sqrt(p.Iz / p.A);
  const lry = (Ky * L / iy) / Math.PI * Math.sqrt(fc0k / E005);
  const lrz = (Kz * L / iz) / Math.PI * Math.sqrt(fc0k / E005);
  const kcy = kcBuckling(lry, betaC), kcz = kcBuckling(lrz, betaC);
  const buckling = lry > 0.3 || lrz > 0.3;
  const lef = KLT * L / C1;
  const ltbOn = el.type !== 'truss' && p.Iz < p.Iy && lef > 0 && p.It > 0 && shape !== 'CIRC';
  let sCrit = Infinity, lrm = 0, kcr_m = 1;
  if (ltbOn) {
    sCrit = Math.PI * Math.sqrt(E005 * p.Iz * G005 * p.It) / (lef * Wy);
    lrm = Math.sqrt(fmk / sCrit);
    kcr_m = kcrit(lrm);
  }
  // torsion
  const tauTor = (T) => {
    const a = Math.abs(T);
    if (!(a > 0)) return 0;
    if (shape === 'RECT') { const A = Math.max(h, b), c = Math.min(h, b); return a * (3 * A + 1.8 * c) / (A * A * c * c); }
    if (shape === 'CIRC') return 16 * a / (Math.PI * D ** 3);
    return p.It > 0 && p.tmax > 0 ? a * p.tmax / p.It : 0;
  };
  const kshape = shape === 'RECT' ? Math.min(2, 1 + 0.15 * Math.max(h, b) / Math.min(h, b)) : shape === 'CIRC' ? 1.2 : 1;
  const shearFac = shape === 'CIRC' ? 4 / 3 : 1.5;

  const cs = new CheckSet(CHECKS);
  const isTruss = el.type === 'truss';
  const durSeen = new Set();
  for (const ck of ctx.keys) {
    const f = collectLineForces(ctx.mesh, ctx.cases[ck], segs, L, el?.nl);
    const n = f.x.length;
    if (!n) continue;
    const du = caseDuration(ctx, ck, code);
    if (!du.resolved) notes.push(`case ${ck}: load duration unknown – medium-term assumed`);
    durSeen.add(du.dur);
    let fac, facTxt;
    if (SIA) {
      fac = etaM * du.etaT * etaW / gMbase;
      facTxt = `ηM=${fmt(etaM, 2)}, ηt=${fmt(du.etaT, 2)}, ηw=${fmt(etaW, 2)}, γM=${fmt(gMbase, 2)}`;
    } else {
      const dur = du.accidental ? 'instantaneous' : du.dur;
      const kmod = KMOD[sc][dur];
      const gM = du.accidental && !(mat.gammaM > 0) ? 1.0 : gMbase;
      fac = kmod / gM;
      facTxt = `kmod=${fmt(kmod, 2)} (${dur}, SC${sc}), γM=${fmt(gM, 2)}`;
    }
    const fmyd = khy * fmk * fac, fmzd = khz * fmk * fac;
    const ft0d = kht * (ft0k > 0 ? ft0k : fc0k) * fac, fc0d = fc0k * fac, fvd = fvk > 0 ? fvk * fac : NaN;

    for (let j = 0; j < n; j++) {
      const x = f.x[j], N = f.N[j];
      const Vy = isTruss ? 0 : f.Vy[j], Vz = isTruss ? 0 : f.Vz[j], T = isTruss ? 0 : f.T[j];
      const My = isTruss ? 0 : f.My[j], Mz = isTruss ? 0 : f.Mz[j];
      const sN = N / p.A, smy = Math.abs(My) / Wy, smz = Math.abs(Mz) / Wz;
      const ry = Wy > 0 ? smy / fmyd : 0, rz = Wz > 0 ? smz / fmzd : 0;
      const bend = Math.max(ry + km * rz, km * ry + rz);

      // N (6.1.2 / 6.1.4)
      if (N >= 0) cs.update('N', sN / ft0d, ck, x, () => `${ref.N}: σt,0,d=${fmtMPa(sN, 2)} N/mm² ≤ kh·ft,0,d=${fmtMPa(ft0d, 2)} N/mm² (${facTxt})`);
      else cs.update('N', -sN / fc0d, ck, x, () => `${ref.N}: σc,0,d=${fmtMPa(-sN, 2)} N/mm² ≤ fc,0,d=${fmtMPa(fc0d, 2)} N/mm² (${facTxt})`);
      // column buckling (6.23 / 6.24)
      const sc0 = N < 0 ? -sN : 0;
      if (sc0 > 0 && buckling) {
        const ey = sc0 / (kcy * fc0d) + ry + km * rz, ez = sc0 / (kcz * fc0d) + km * ry + rz;
        cs.update('FB-y', ey, ck, x, () => `${ref.FB}: σc=${fmtMPa(sc0, 2)} N/mm², kc,y=${fmt(kcy, 3)}, λrel,y=${fmt(lry, 3)}, βc=${betaC}, Lcr=${fmt(Ky * L, 2)} m, σm,y/fm,y,d=${fmt(ry, 3)}, σm,z/fm,z,d=${fmt(rz, 3)}`);
        cs.update('FB-z', ez, ck, x, () => `${ref.FB}: σc=${fmtMPa(sc0, 2)} N/mm², kc,z=${fmt(kcz, 3)}, λrel,z=${fmt(lrz, 3)}, βc=${betaC}, Lcr=${fmt(Kz * L, 2)} m, σm,y/fm,y,d=${fmt(ry, 3)}, σm,z/fm,z,d=${fmt(rz, 3)}`);
      } else {
        const why = sc0 > 0 ? `λrel,y=${fmt(lry, 3)}, λrel,z=${fmt(lrz, 3)} ≤ 0.3 – (6.19/6.20) govern` : 'no compression';
        cs.update('FB-y', 0, ck, x, why);
        cs.update('FB-z', 0, ck, x, why);
      }
      if (isTruss) continue;
      // bending (6.1.6)
      if (Wy > 0) cs.update('My', ry, ck, x, () => `${ref.M}: σm,y,d=${fmtMPa(smy, 2)} N/mm² ≤ fm,y,d=${fmtMPa(fmyd, 2)} N/mm² (kh=${fmt(khy, 3)}, ${facTxt})`);
      if (Wz > 0) cs.update('Mz', rz, ck, x, () => `${ref.M}: σm,z,d=${fmtMPa(smz, 2)} N/mm² ≤ fm,z,d=${fmtMPa(fmzd, 2)} N/mm² (kh=${fmt(khz, 3)}, ${facTxt})`);
      // shear (6.1.7) and torsion (6.1.8)
      if (fvd > 0) {
        const tz = shearFac * Math.abs(Vz) / (kcr * p.A), ty = shearFac * Math.abs(Vy) / (kcr * p.A);
        cs.update('Vz', tz / fvd, ck, x, () => `${ref.V}: τd=${fmtMPa(tz, 3)} N/mm² (kcr=${kcr}) ≤ fv,d=${fmtMPa(fvd, 2)} N/mm²`);
        cs.update('Vy', ty / fvd, ck, x, () => `${ref.V}: τd=${fmtMPa(ty, 3)} N/mm² (kcr=${kcr}) ≤ fv,d=${fmtMPa(fvd, 2)} N/mm²`);
        const tt = tauTor(T);
        cs.update('T', tt / (kshape * fvd), ck, x, () => `${ref.T}: τtor,d=${fmtMPa(tt, 3)} N/mm² ≤ kshape·fv,d=${fmtMPa(kshape * fvd, 2)} N/mm² (kshape=${fmt(kshape, 2)})`);
      }
      // combined (6.17/6.18 tension, 6.19/6.20 compression)
      const etaMN = N >= 0 ? sN / ft0d + bend : (sc0 / fc0d) ** 2 + bend;
      cs.update('M+N', etaMN, ck, x, () => `${ref.MN}: ${N >= 0 ? 'σt/ft,0,d' : '(σc/fc,0,d)²'}=${fmt(N >= 0 ? sN / ft0d : (sc0 / fc0d) ** 2, 3)}, σm,y/fm,y,d=${fmt(ry, 3)}, σm,z/fm,z,d=${fmt(rz, 3)}, km=${km}`);
      // lateral torsional stability (6.33 / 6.35)
      if (ltbOn) {
        const e33 = smy / (kcr_m * fmyd);
        const e35 = sc0 > 0 ? e33 * e33 + sc0 / (kcz * fc0d) : 0;
        cs.update('LTB', Math.max(e33, e35), ck, x, () => `${ref.LTB}: σm,d=${fmtMPa(smy, 2)} N/mm², kcrit=${fmt(kcr_m, 3)}, λrel,m=${fmt(lrm, 3)}, σm,crit=${fmtMPa(sCrit, 1)} N/mm², lef=${fmt(lef, 2)} m${sc0 > 0 ? `, (6.35) ${fmt(e35, 3)}` : ''}`);
      }
    }
  }
  const checks = cs.checks;
  if (!(fvk > 0) || isTruss) { delete checks.Vy; delete checks.Vz; delete checks.T; }
  if (isTruss) { delete checks.My; delete checks.Mz; delete checks['M+N']; delete checks.LTB; }
  if (!ltbOn) delete checks.LTB;
  for (const k of Object.keys(checks)) if (checks[k].caseKey === null) delete checks[k];
  const gov = cs.governing();
  return {
    line: line.id,
    eta: gov ? gov.eta : 0,
    governing: gov ? { check: gov.check, caseKey: gov.caseKey, x: gov.x } : null,
    cls: null,
    code,
    checks,
    notes: [...new Set(notes)],
    serviceClass: sc,
    kind,
  };
}

export const timberHelpers = { kcBuckling, kcrit, caseDuration };
