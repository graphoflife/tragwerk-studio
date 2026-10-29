// Steel member checks – EN 1993-1-1 (opts.code 'EC', default) and SIA 263 (opts.code 'SIA').
// Pure ES module (no DOM). See SPEC.md §5.
// DEVIATIONS FROM SPEC.md §5: (1) extra fields per member: `code`, `notes` (string[]);
//   (2) the returned array carries the properties `warnings` (string[]) and `code`; members that
//   cannot be checked (missing section/material data, not meshed) are NOT in the array – the
//   reason is in `warnings`; (3) only applicable checks appear in `checks` (e.g. no 'LTB' for
//   hollow sections, only 'N','FB-y','FB-z' for trusses); (4) default caseKeys = all ULS
//   combinations ('CO:' keys of ULS* type) or all result keys; (5) optional section.cls (GENERIC).
//
// checkSteelMembers(model, mesh, staticResults, caseKeys, opts?) →
//   [{ line, eta, governing:{check, caseKey, x}, cls, code, checks:{ [name]:{eta, caseKey, x, detail} }, notes }]
//   + array property `warnings` (skipped members, missing result cases …).
// Check names: 'N','Vy','Vz','T','My','Mz','M+N','FB-y','FB-z','LTB','Interaction'.
//
// Members: model lines with element.type beam | rib | truss, material.type steel | aluminium and
// element.design?.steelCheck !== false. Aluminium is approximated with the same rules (f0 = fy,
// its own E) – EN 1999 is NOT implemented; a note is added.
//
// ───────────────────────── implementation notes / simplifications ─────────────────────────
// Sign conventions (SPEC §4): N > 0 tension; My > 0 = tension at −z (bottom). Compression is
//   handled internally as Nc = −N > 0.
// γM: EC γM0 = γM1 = 1.0; SIA 263 γM1 = 1.05 for ALL resistances (cross-section and stability).
//   material.gammaM overrides: number → γM0 = γM1 = value, or object { M0, M1 }.
// Cross-section class (EN 1993-1-1 Tab. 5.2 ≈ SIA 263 Tab. 5a/5b) is determined at every station
//   and case from the ELASTIC stress distribution of each plate element under N + My + Mz
//   (ψ = σ2/σ1, compressed fraction α = 1/(1−ψ) for ψ < 0). Using the elastic α also for the
//   class 1/2 limits is conservative compared with the plastic neutral axis and handles the
//   "pure compression" limit continuously. Outstand flanges are always classified with the
//   uniform-compression limits (9ε/10ε/14ε) when any part is compressed (conservative).
//   RECT/CIRC: class 1. GENERIC: class 3 (or section.cls if given). L: Tab. 5.2 sheet 3 under
//   compression, outstand limits on the longer leg in bending. T stem: outstand limits.
//   Member class for stability checks of one case = max class over the stations of that case.
// Class 4: effective properties approximated with EN 1993-1-5 4.4 effective widths (ρ for
//   internal / outstand elements); Aeff for pure compression, Weff = Wel·(1 − ΔI/I) with the
//   ineffective zones of the pure-bending state; neutral-axis shift (ΔM = N·eN) neglected.
//   CHS class 4 (EN 1993-1-6) is treated as class 3 with a note.
// Shear areas (EN 1993-1-1 6.2.6(3), η = 1.0 conservatively): see steelGeometry().
//   Shear buckling (hw/tw > 72ε/η) is only reported as a note (EN 1993-1-5 not checked).
// Torsion: St. Venant shear stress only (open: T·tmax/It, closed: Bredt T/(2·Am·t), CHS/CIRC:
//   T·r/It, RECT: Roark), check τt ≤ fy/(√3 γM0); shear resistances reduced per 6.2.7(9).
//   Warping torsion is not considered.
// Bending + shear (6.2.8): ρ = (2VEd/Vpl,Rd − 1)² for VEd > 0.5 Vpl,Rd; I/U/RHS/BOX: W − ρ·Aw²/(4tw)
//   (6.30), I weak axis: Wpl,z − ρ·tf·b²/2; other shapes (1 − ρ)·Mc,Rd. Included in 'My'/'Mz'/'M+N'.
// N + M (6.2.9): class 1/2 I/H (6.36–6.38, 6.41 α=2, β=5n≥1), RHS/BOX (6.39/6.40, α=β=1.66/(1−1.13n²)≤6),
//   CHS (MN = Mpl(1−n^1.7), resultant), RECT (MN = Mpl(1−n²), linear biaxial), CIRC (MN = Mpl(1−n²),
//   resultant); other shapes and class 3/4: linear 6.2.1(7) / 6.2.9.2 / 6.2.9.3. With a single
//   moment the reported value is M/MN (equivalent to the exponent form). Reported 'M+N' ≥ n.
//   SIA 263 5.1.9: the same plastic/elastic interaction formulas are used (with γM1 = 1.05).
// Flexural buckling (EC 6.3.1 / SIA 263 4.5.1): Ncr = π²EI/(K·L)², χ from curves a0…d (Table 6.2 by
//   shape / fabrication / h/b / tf / S460); SIA: curve a0 is mapped to a. L_cr = Ky·L, Kz·L.
//   Torsional / torsional-flexural buckling (6.3.1.4) is not checked (note for T/L/U).
// LTB: Mcr = C1·π²EIz/L²·√(Iw/Iz + L²GIt/(π²EIz)) (k = kw = 1, load at shear centre, monosymmetry
//   ignored), L = KLT·L, C1 = element.design.C1 (default 1.0). KLT ≤ 0 → laterally restrained.
//   EC: I sections 6.3.2.3 (λ̄LT,0 = 0.4, β = 0.75, curves b/c (rolled) c/d (welded), χLT,mod with
//   f from kc = 1/√C1 – a common approximation of Table 6.6), other open sections 6.3.2.2 (curve d,
//   RECT/generic) – χLT = 1 if MEd/Mcr ≤ λ̄LT,0². Closed sections (RHS/BOX/CHS/CIRC), L and
//   members with Iz ≥ Iy: χLT = 1 (not susceptible).
//   SIA 263 4.5.2: χD = 1/(Φ + √(Φ² − λ̄D²)), Φ = 0.5[1 + αD(λ̄D − 0.4) + λ̄D²], αD = 0.21 rolled,
//   0.49 welded (and for non-I open shapes).
// Interaction:
//   EC 6.3.3 (6.61/6.62) with Annex B (method 2), Tables B.1 (closed sections / not susceptible) and
//   B.2 (open sections susceptible to LTB). Cmy, Cmz, CmLT from Table B.3 using the actual moment
//   diagram of the case (end moments, ψ, span moment Ms; the "uniform load" column is used, which
//   is the conservative one). Ky > 1 (Kz > 1) is interpreted as a sway mode → Cm = 0.9.
//   NEd = max compression, MEd = max |M| along the member (Cm accounts for the distribution).
//   SIA 263 4.5.3 / 5.1.9 (as implemented):
//     in-plane : NEd/NK,y,Rd + ωy·My,Ed/((1−NEd/Ncr,y)·My,Rd) + ωz·Mz,Ed/((1−NEd/Ncr,z)·Mz,Rd) ≤ 1
//     with LTB : NEd/NK,z,Rd + ωy·My,Ed/((1−NEd/Ncr,y)·MD,Rd) + ωz·Mz,Ed/((1−NEd/Ncr,z)·Mz,Rd) ≤ 1
//     ω = 0.6 + 0.4ψ ≥ 0.4 for linear moment diagrams, ω = 1.0 with transverse loads / sway (K > 1).
//   NOTE: the SIA 263 text could not be consulted while implementing; clause numbers and the ω
//   interaction form follow the project specification and the classic Swiss formulation – verify.
// Tension members: N > 0 is ignored in stability checks (conservative).

import {
  ETA_CAP, STEEL_TYPES, MEMBER_TYPES, designCode, num, pos, capEta, fmt, fmtMPa,
  designContext, collectLineForces, fillSectionProps, CheckSet, momentDiagram,
} from './common.js';

const ALPHA = { a0: 0.13, a: 0.21, b: 0.34, c: 0.49, d: 0.76 };
const SQ3 = Math.sqrt(3);
const PI2 = Math.PI * Math.PI;
const CHECKS = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz', 'M+N', 'FB-y', 'FB-z', 'LTB', 'Interaction'];

const RULES = {
  EC: {
    code: 'EC', gM0: 1.0, gM1: 1.0,
    ref: {
      cls: 'EN 1993-1-1 Tab. 5.2', N: 'EN 1993-1-1 6.2.3/6.2.4', V: 'EN 1993-1-1 6.2.6', T: 'EN 1993-1-1 6.2.7',
      M: 'EN 1993-1-1 6.2.5', MV: '6.2.8', MN: 'EN 1993-1-1 6.2.9', MNlin: 'EN 1993-1-1 6.2.1(7)',
      FB: 'EN 1993-1-1 6.3.1', LTBs: 'EN 1993-1-1 6.3.2.3', LTBg: 'EN 1993-1-1 6.3.2.2', INT: 'EN 1993-1-1 6.3.3 / Annex B',
    },
  },
  SIA: {
    code: 'SIA', gM0: 1.05, gM1: 1.05,
    ref: {
      cls: 'SIA 263 Tab. 5a/5b', N: 'SIA 263 5.1 (N)', V: 'SIA 263 5.1 (V)', T: 'SIA 263 5.1 (T)',
      M: 'SIA 263 5.1 (M)', MV: 'M+V', MN: 'SIA 263 5.1.9', MNlin: 'SIA 263 5.1.9 (elastic)',
      FB: 'SIA 263 4.5.1', LTBs: 'SIA 263 4.5.2', LTBg: 'SIA 263 4.5.2', INT: 'SIA 263 4.5.3 / 5.1.9',
    },
  },
};

// ─────────────────────────────────── basic EC3 functions ───────────────────────────────────

/** Reduction factor for flexural buckling (EN 1993-1-1 6.49 / SIA 263 4.5.1). */
export function chiBuckling(lam, alpha) {
  if (!(lam > 0.2)) return 1;
  const phi = 0.5 * (1 + alpha * (lam - 0.2) + lam * lam);
  return Math.min(1, 1 / (phi + Math.sqrt(Math.max(0, phi * phi - lam * lam))));
}

/** Elastic critical LTB moment (k = kw = 1, load at shear centre). */
export function mcrLTB(E, G, Iz, Iw, It, L, C1 = 1) {
  if (!(L > 0) || !(Iz > 0)) return Infinity;
  const pe = PI2 * E * Iz / (L * L);
  return C1 * pe * Math.sqrt(Math.max(0, (Iw || 0) / Iz + L * L * G * (It || 0) / (PI2 * E * Iz)));
}

/** Class of an internal compression element (Tab. 5.2 sheet 1). σ: compression positive. */
export function classInternal(ct, eps, s1, s2) {
  if (!(s1 > 0)) return 1;
  const psi = Math.max(-50, s2 / s1);
  const alpha = psi >= 0 ? 1 : 1 / (1 - psi);
  const l1 = alpha > 0.5 ? 396 * eps / (13 * alpha - 1) : 36 * eps / alpha;
  const l2 = alpha > 0.5 ? 456 * eps / (13 * alpha - 1) : 41.5 * eps / alpha;
  const l3 = psi > -1 ? 42 * eps / (0.67 + 0.33 * psi) : 62 * eps * (1 - psi) * Math.sqrt(-psi);
  return ct <= l1 + 1e-9 ? 1 : ct <= l2 + 1e-9 ? 2 : ct <= l3 + 1e-9 ? 3 : 4;
}

/** Class of an outstand flange in compression (Tab. 5.2 sheet 2). */
export function classOutstand(ct, eps) {
  return ct <= 9 * eps + 1e-9 ? 1 : ct <= 10 * eps + 1e-9 ? 2 : ct <= 14 * eps + 1e-9 ? 3 : 4;
}

/** Class of a CHS (Tab. 5.2 sheet 3). */
export function classCHS(dt, eps) {
  const e2 = eps * eps;
  return dt <= 50 * e2 + 1e-9 ? 1 : dt <= 70 * e2 + 1e-9 ? 2 : dt <= 90 * e2 + 1e-9 ? 3 : 4;
}

/** EN 1993-1-5 4.4: reduction factor ρ for internal elements. */
function rhoInternal(ct, eps, psi) {
  const k = psi >= 1 ? 4 : psi >= 0 ? 8.2 / (1.05 + psi) : psi > -1 ? 7.81 - 6.29 * psi + 9.78 * psi * psi
    : psi >= -3 ? 5.98 * (1 - psi) ** 2 : 95.7;
  const lp = ct / (28.4 * eps * Math.sqrt(k));
  if (lp <= 0.5 + Math.sqrt(0.085 - 0.055 * psi)) return 1;
  return Math.max(0.05, Math.min(1, (lp - 0.055 * (3 + psi)) / (lp * lp)));
}

/** EN 1993-1-5 4.4: ρ for outstand elements in uniform compression (kσ = 0.43). */
function rhoOutstand(ct, eps) {
  const lp = ct / (28.4 * eps * Math.sqrt(0.43));
  if (lp <= 0.748) return 1;
  return Math.max(0.05, Math.min(1, (lp - 0.188) / (lp * lp)));
}

/** EN 1993-1-1 Annex B Table B.3 (uniform-load column, conservative). */
export function cmAnnexB(dg, sway) {
  if (sway) return 0.9;
  if (!dg || dg.zero) return 1.0;
  const { linear, Mh, Ms, psi } = dg;
  let cm;
  if (linear) cm = 0.6 + 0.4 * psi;
  else if (Math.abs(Ms) <= Math.abs(Mh) && Math.abs(Mh) > 0) {
    const as = Ms / Mh;
    if (as >= 0) cm = 0.2 + 0.8 * as;
    else cm = psi >= 0 ? 0.1 - 0.8 * as : 0.1 * (1 - psi) - 0.8 * as;
  } else {
    const ah = Math.abs(Ms) > 0 ? Mh / Ms : 0;
    cm = ah >= 0 || psi >= 0 ? 0.95 + 0.05 * ah : 0.95 + 0.05 * ah * (1 + 2 * psi);
  }
  return Math.min(1, Math.max(0.4, cm));
}

/** SIA 263 4.5.3 moment-distribution factor ω (see header). */
export function omegaSIA(dg, sway) {
  if (sway || !dg || dg.zero || !dg.linear) return 1.0;
  return Math.min(1, Math.max(0.4, 0.6 + 0.4 * dg.psi));
}

function steelMaterial(mat, rules) {
  const fy = pos(mat.fy, NaN);
  if (!(fy > 0)) return null;
  const alu = mat.type === 'aluminium';
  const E = pos(mat.E, alu ? 70e6 : 210e6);
  const G = pos(mat.G, E / (2 * (1 + num(mat.nu, 0.3))));
  let gM0 = rules.gM0, gM1 = rules.gM1;
  const gm = mat.gammaM;
  if (Number.isFinite(gm) && gm > 0) { gM0 = gm; gM1 = gm; }
  else if (gm && typeof gm === 'object') {
    gM0 = pos(gm.M0 ?? gm.gM0 ?? gm.gammaM0, gM0);
    gM1 = pos(gm.M1 ?? gm.gM1 ?? gm.gammaM1, gM1);
  }
  return { fy, E, G, gM0, gM1, eps: Math.sqrt(235000 / fy), alu, s460: fy >= 440000 };
}

/**
 * Shape-specific data: plate elements for classification, shear areas, buckling curves,
 * LTB data, torsion data, N+M interaction type, plastic moduli of the shear areas (6.2.8).
 */
function steelGeometry(p, m, notes) {
  const d = p.dims || {};
  const welded = p.fabrication === 'welded';
  const cold = p.fabrication === 'cold';
  const g = {
    shape: p.shape, closed: false, open: true, elems: [], Avy: null, Avz: null,
    curveY: 'c', curveZ: 'c', ltb: { susceptible: false }, tors: null, mn: 'LIN',
    WvY: null, WvZ: null, fixedClass: 0, welded, h: null, b: null,
  };
  const A = p.A;
  switch (p.shape) {
    case 'I': {
      const { h, b, tw, tf } = d;
      if (!(h > 0 && b > 0 && tw > 0 && tf > 0)) break;
      const r = num(d.r, 0), hw = h - 2 * tf, cw = hw - 2 * r, cf = (b - tw - 2 * r) / 2;
      Object.assign(g, { h, b });
      g.elems.push({ kind: 'int', name: 'web', c: cw, t: tw, grad: 'z', half: cw / 2, off: 0, n: 1 });
      g.elems.push({ kind: 'out', name: 'flange', c: cf, t: tf, zmax: h / 2, ymax: b / 2, n: 4 });
      g.Avz = welded ? hw * tw : Math.max(A - 2 * b * tf + (tw + 2 * r) * tf, hw * tw);
      g.Avy = A - hw * tw;
      if (welded) { g.curveY = tf <= 0.04 ? 'b' : 'c'; g.curveZ = tf <= 0.04 ? 'c' : 'd'; }
      else if (h / b > 1.2) {
        if (tf <= 0.04) { g.curveY = m.s460 ? 'a0' : 'a'; g.curveZ = m.s460 ? 'a0' : 'b'; }
        else { g.curveY = m.s460 ? 'a' : 'b'; g.curveZ = m.s460 ? 'a' : 'c'; }
      } else if (tf <= 0.1) { g.curveY = m.s460 ? 'a' : 'b'; g.curveZ = m.s460 ? 'a' : 'c'; }
      else { g.curveY = m.s460 ? 'c' : 'd'; g.curveZ = m.s460 ? 'c' : 'd'; }
      g.ltb = {
        susceptible: p.Iz < p.Iy, isI: true,
        curveGen: welded ? (h / b <= 2 ? 'c' : 'd') : (h / b <= 2 ? 'a' : 'b'),
        curveSpec: welded ? (h / b <= 2 ? 'c' : 'd') : (h / b <= 2 ? 'b' : 'c'),
      };
      g.tors = { type: 'open', tmax: Math.max(tf, tw) };
      g.mn = 'I'; g.mnA = Math.min(0.5, Math.max(0, (A - 2 * b * tf) / A));
      g.WvY = hw * tw * hw * tw / (4 * tw); g.WvZ = tf * b * b / 2;
      if (hw / tw > 72 * m.eps) notes.push(`hw/tw = ${fmt(hw / tw, 1)} > 72ε: shear buckling (EN 1993-1-5) not checked`);
      break;
    }
    case 'U': {
      const { h, b, tw, tf } = d;
      if (!(h > 0 && b > 0 && tw > 0 && tf > 0)) break;
      const r = num(d.r, 0), hw = h - 2 * tf, cw = hw - 2 * r, cf = b - tw - r;
      Object.assign(g, { h, b });
      g.elems.push({ kind: 'int', name: 'web', c: cw, t: tw, grad: 'z', half: cw / 2, off: 0, n: 1 });
      g.elems.push({ kind: 'out', name: 'flange', c: cf, t: tf, zmax: h / 2, ymax: b, n: 2 });
      g.Avz = welded ? hw * tw : Math.max(A - 2 * b * tf + (tw + r) * tf, hw * tw);
      g.Avy = A - hw * tw;
      g.ltb = { susceptible: p.Iz < p.Iy, curveGen: 'd' };
      g.tors = { type: 'open', tmax: Math.max(tf, tw) };
      g.WvY = hw * tw / 4 * hw;
      notes.push('U section: torsional-flexural buckling and shear-centre eccentricity not checked');
      break;
    }
    case 'T': {
      const { h, b, tw, tf } = d;
      if (!(h > 0 && b > 0 && tw > 0 && tf > 0)) break;
      const r = num(d.r, 0);
      const zc = (b * tf * tf / 2 + (h - tf) * tw * (tf + (h - tf) / 2)) / (b * tf + (h - tf) * tw); // from top
      Object.assign(g, { h, b });
      g.elems.push({ kind: 'out', name: 'flange', c: (b - tw) / 2 - r, t: tf, zmax: zc, ymax: b / 2, n: 2 });
      g.elems.push({ kind: 'out', name: 'stem', c: h - tf - r, t: tw, zmax: h - zc, ymax: tw / 2, n: 1 });
      g.Avz = welded ? tw * (h - tf / 2) : A - b * tf + (tw + 2 * r) * tf / 2;
      g.Avy = b * tf;
      g.ltb = { susceptible: p.Iz < p.Iy, curveGen: 'd' };
      g.tors = { type: 'open', tmax: Math.max(tf, tw) };
      notes.push('T section: monosymmetry in Mcr and torsional-flexural buckling neglected');
      break;
    }
    case 'L': {
      const { h, b, t } = d;
      if (!(h > 0 && b > 0 && t > 0)) break;
      Object.assign(g, { h, b });
      g.elems.push({ kind: 'angle', h, b, t });
      g.Avz = h * t; g.Avy = b * t;
      g.curveY = 'b'; g.curveZ = 'b';
      g.tors = { type: 'open', tmax: t };
      notes.push('L section: checked about the geometric y/z axes (principal v-axis buckling and LTB not checked)');
      break;
    }
    case 'RHS':
    case 'BOX': {
      const { h, b } = d;
      const tw = p.shape === 'RHS' ? d.t : d.tw, tf = p.shape === 'RHS' ? d.t : d.tf;
      if (!(h > 0 && b > 0 && tw > 0 && tf > 0)) break;
      Object.assign(g, { h, b, closed: true, open: false });
      const ch = p.shape === 'RHS' ? h - 3 * tw : h - 2 * tf;
      const cb = p.shape === 'RHS' ? b - 3 * tf : b - 2 * tw;
      g.elems.push({ kind: 'int', name: 'web', c: ch, t: tw, grad: 'z', half: ch / 2, off: b / 2, n: 2 });
      g.elems.push({ kind: 'int', name: 'flange', c: cb, t: tf, grad: 'y', half: cb / 2, off: h / 2, n: 2 });
      if (p.shape === 'RHS') {
        g.Avz = A * h / (b + h); g.Avy = A * b / (b + h);
        g.curveY = g.curveZ = cold ? 'c' : (m.s460 ? 'a0' : 'a');
      } else {
        g.Avz = 2 * (h - 2 * tf) * tw; g.Avy = Math.max(A - g.Avz, 2 * (b - 2 * tw) * tf);
        g.curveY = g.curveZ = 'b';
      }
      g.tors = { type: 'closed', Am: (h - tf) * (b - tw), tmin: Math.min(tf, tw) };
      g.mn = 'RHS';
      g.mnAw = Math.min(0.5, Math.max(0, (A - 2 * b * tf) / A));
      g.mnAf = Math.min(0.5, Math.max(0, (A - 2 * h * tw) / A));
      const hw = h - 2 * tf, bw = b - 2 * tw;
      g.WvY = (2 * hw * tw) ** 2 / (4 * 2 * tw); g.WvZ = (2 * bw * tf) ** 2 / (4 * 2 * tf);
      break;
    }
    case 'CHS': {
      const D = d.d, t = d.t;
      if (!(D > 0 && t > 0)) break;
      Object.assign(g, { h: D, b: D, closed: true, open: false });
      g.elems.push({ kind: 'chs', d: D, t, r: D / 2 });
      g.Avz = g.Avy = 2 * A / Math.PI;
      g.curveY = g.curveZ = cold ? 'c' : (m.s460 ? 'a0' : 'a');
      g.tors = { type: 'circ', r: D / 2 };
      g.mn = 'CHS';
      break;
    }
    case 'RECT': {
      const { h, b } = d;
      if (!(h > 0 && b > 0)) break;
      Object.assign(g, { h, b, fixedClass: 1 });
      g.Avz = g.Avy = A;
      g.ltb = { susceptible: p.Iz < p.Iy, curveGen: 'd' };
      g.tors = { type: 'rect', a: Math.max(h, b), c: Math.min(h, b) };
      g.mn = 'RECT';
      break;
    }
    case 'CIRC': {
      const D = d.d;
      if (!(D > 0)) break;
      Object.assign(g, { h: D, b: D, fixedClass: 1, closed: true, open: false });
      g.Avz = g.Avy = A;
      g.tors = { type: 'circ', r: D / 2 };
      g.mn = 'CIRC';
      break;
    }
    default: break;
  }
  if (!g.elems.length && !g.fixedClass) {
    // GENERIC or incomplete dims: elastic class 3 unless the section states a class
    g.fixedClass = [1, 2, 3, 4].includes(p.cls) ? p.cls : 3;
    g.Avz = p.Avz > 0 ? p.Avz : null;
    g.Avy = p.Avy > 0 ? p.Avy : null;
    g.ltb = { susceptible: p.Iz < p.Iy && p.It > 0, curveGen: 'd' };
    g.tors = p.tmax > 0 ? { type: 'open', tmax: p.tmax } : null;
    g.mn = 'LIN';
    notes.push(`section shape ${p.shape || '?'} without usable dims: class ${g.fixedClass} assumed, curve c`);
    if (!g.Avz) notes.push('no shear area – shear not checked');
  }
  return g;
}

/** Cross-section class at one station (elastic stress distribution, see header). */
function classifyAt(g, p, m, Nc, My, Mz) {
  if (g.fixedClass) return g.fixedClass;
  const tol = 1e-6 * m.fy;
  let s0 = Nc / p.A; if (Math.abs(s0) < tol) s0 = 0;
  let sy = Math.abs(My) / p.Iy; if (sy * (g.h || 1) < tol) sy = 0;
  let sz = Math.abs(Mz) / p.Iz; if (sz * (g.b || 1) < tol) sz = 0;
  const eps = m.eps;
  let cls = 1;
  for (const e of g.elems) {
    let c = 1;
    if (e.kind === 'int') {
      const base = s0 + (e.grad === 'z' ? sz * e.off : sy * e.off);
      const dd = (e.grad === 'z' ? sy : sz) * e.half;
      c = classInternal(e.c / e.t, eps, base + dd, base - dd);
    } else if (e.kind === 'out') {
      if (s0 + sy * e.zmax + sz * e.ymax > tol) c = classOutstand(e.c / e.t, eps);
    } else if (e.kind === 'chs') {
      if (s0 + Math.hypot(sy, sz) * e.r > tol) c = classCHS(e.d / e.t, eps);
    } else if (e.kind === 'angle') {
      if (s0 > 0) c = (e.h / e.t <= 15 * eps && (e.b + e.h) / (2 * e.t) <= 11.5 * eps) ? 3 : 4;
      else if (sy > 0 || sz > 0) c = classOutstand((Math.max(e.h, e.b) - e.t) / e.t, eps);
    }
    if (c > cls) cls = c;
  }
  return cls;
}

/** Approximate class-4 effective properties (see header). */
function effectiveProps(g, p, m) {
  const eps = m.eps;
  let dA = 0, dIy = 0, dIz = 0, rhoMin = 1;
  for (const e of g.elems) {
    if (e.kind === 'int') {
      const rc = rhoInternal(e.c / e.t, eps, 1);
      dA += e.n * (1 - rc) * e.c * e.t;
      const rb = rhoInternal(e.c / e.t, eps, -1);
      const bc = e.c / 2, beff = rb * bc, hole = bc - beff;
      const zc = e.half - (0.4 * beff + hole / 2);
      const dOwn = e.n * hole * e.t * zc * zc;
      const dOther = e.off > 0 ? (e.n / 2) * (1 - rc) * e.c * e.t * e.off * e.off : 0;
      if (e.grad === 'z') { dIy += dOwn; dIz += dOther; } else { dIz += dOwn; dIy += dOther; }
      rhoMin = Math.min(rhoMin, rc, rb);
    } else if (e.kind === 'out') {
      const ro = rhoOutstand(e.c / e.t, eps);
      const a = (1 - ro) * e.c * e.t;
      dA += e.n * a;
      dIy += Math.ceil(e.n / 2) * a * (e.zmax - e.t / 2) ** 2;
      dIz += Math.ceil(e.n / 2) * a * Math.max(0, e.ymax - (1 - ro) * e.c / 2) ** 2;
      rhoMin = Math.min(rhoMin, ro);
    } else if (e.kind === 'angle') {
      const rh = rhoOutstand((e.h - e.t) / e.t, eps), rb = rhoOutstand((e.b - e.t) / e.t, eps);
      dA += (1 - rh) * (e.h - e.t) * e.t + (1 - rb) * (e.b - e.t) * e.t;
      rhoMin = Math.min(rhoMin, rh, rb);
    }
  }
  const angle = g.elems.some((e) => e.kind === 'angle');
  return {
    A: Math.max(0.05 * p.A, p.A - dA),
    Wy: angle ? p.Wely * rhoMin : p.Wely * Math.max(0.05, 1 - dIy / p.Iy),
    Wz: angle ? p.Welz * rhoMin : p.Welz * Math.max(0.05, 1 - dIz / p.Iz),
  };
}

// ─────────────────────────────────────── main API ───────────────────────────────────────

/**
 * EN 1993-1-1 / SIA 263 member checks for all steel (and aluminium) members.
 * Never throws for normal input – problems are reported in `result.warnings` / member `notes`.
 */
export function checkSteelMembers(model, mesh, staticResults, caseKeys, opts = {}) {
  const out = [];
  out.warnings = [];
  const code = designCode(model, opts);
  out.code = code;
  try {
    const ctx = designContext(model, mesh, staticResults, caseKeys, out.warnings, 'beams');
    const rules = RULES[code];
    for (const line of Array.isArray(model?.lines) ? model.lines : []) {
      const el = line && line.element;
      if (!el || !MEMBER_TYPES.has(el.type)) continue;
      const mat = ctx.materials.get(Number(el.material));
      if (!mat || !STEEL_TYPES.has(mat.type)) continue;
      if (el.design && el.design.steelCheck === false) continue;
      try {
        const r = checkMember(ctx, rules, line, el, mat, opts || {});
        if (r) out.push(r);
      } catch (e) {
        out.warnings.push(`Line ${line.id}: steel check failed (${e && e.message})`);
      }
    }
  } catch (e) {
    out.warnings.push(`Steel design aborted: ${e && e.message}`);
  }
  return out;
}

function checkMember(ctx, rules, line, el, mat, opts) {
  const W = (msg) => { ctx.warnings.push(`Line ${line.id}: ${msg} – steel check skipped`); return null; };
  const sec0 = ctx.sections.get(Number(el.section));
  if (!sec0) return W('no section');
  const p = fillSectionProps(sec0);
  const m = steelMaterial(mat, rules);
  if (!m) return W('material without fy');
  if (!(p.A > 0 && p.Iy > 0 && p.Iz > 0)) return W(`section '${p.name || p.id}' lacks A/Iy/Iz`);
  const L = ctx.lineLength(line);
  if (!(L > 0)) return W('zero length');
  const segs = ctx.segs.get(Number(line.id));
  if (!segs || !segs.length) return W('no mesh beams');

  const notes = [];
  if (m.alu) notes.push('aluminium approximated with EN 1993-1-1 rules (EN 1999 not implemented)');
  const R = rules.ref;
  const SIA = rules.code === 'SIA';
  const g = steelGeometry(p, m, notes);
  if (!(p.Wely > 0)) p.Wely = p.zmax > 0 ? p.Iy / p.zmax : (g.h ? p.Iy / (g.h / 2) : NaN);
  if (!(p.Welz > 0)) p.Welz = p.ymax > 0 ? p.Iz / p.ymax : (g.b ? p.Iz / (g.b / 2) : NaN);
  if (!(p.Wely > 0 && p.Welz > 0)) notes.push('elastic section moduli missing – bending checks skipped');
  const { fy, E, G, gM0, gM1 } = m;
  const fyd0 = fy / gM0, fyd1 = fy / gM1;
  const eff = effectiveProps(g, p, m);
  const isTruss = el.type === 'truss';

  // resistances per class (cross-section, γM0)
  const resC = [];
  let wplNoted = false;
  const res = (cls) => {
    if (resC[cls]) return resC[cls];
    let A = p.A, Wy, Wz, wl;
    const chs4 = cls === 4 && g.shape === 'CHS';
    if (cls <= 2 && p.Wply > 0 && p.Wplz > 0) { Wy = p.Wply; Wz = p.Wplz; wl = 'Wpl'; }
    else if (cls === 4 && !chs4) { A = eff.A; Wy = eff.Wy; Wz = eff.Wz; wl = 'Weff'; }
    else {
      Wy = p.Wely; Wz = p.Welz; wl = 'Wel';
      if (cls <= 2 && !wplNoted) { notes.push('Wpl missing – elastic moduli used'); wplNoted = true; }
    }
    if (chs4) notes.push('CHS class 4 (EN 1993-1-6) treated as class 3');
    return (resC[cls] = { A, Wy, Wz, wl, plastic: wl === 'Wpl' });
  };

  const NtRd = p.A * fyd0;
  const Vply = g.Avy ? g.Avy * fyd0 / SQ3 : null;
  const Vplz = g.Avz ? g.Avz * fyd0 / SQ3 : null;
  const tauRd = fyd0 / SQ3;
  const torsRed = (tau) => {
    if (!(tau > 0)) return 1;
    return g.closed ? Math.max(0, 1 - tau / tauRd) : Math.sqrt(Math.max(0, 1 - tau / (1.25 * tauRd)));
  };
  const tauT = (T) => {
    const t = g.tors, a = Math.abs(T);
    if (!t || !(a > 0)) return 0;
    if (t.type === 'open') return p.It > 0 ? a * t.tmax / p.It : 0;
    if (t.type === 'closed') return a / (2 * t.Am * t.tmin);
    if (t.type === 'circ') return p.It > 0 ? a * t.r / p.It : 0;
    if (t.type === 'rect') return a * (3 * t.a + 1.8 * t.c) / (t.a * t.a * t.c * t.c);
    return 0;
  };
  const rhoV = (V, Vpl) => (Vpl > 0 && Math.abs(V) > 0.5 * Vpl ? Math.min(1, (2 * Math.abs(V) / Vpl - 1) ** 2) : 0);

  // stability base data
  const dz = el.design || {};
  const Ky = pos(dz.Ky, 1), Kz = pos(dz.Kz, 1), KLT = num(dz.KLT, 1), C1 = pos(dz.C1, 1);
  const Lcy = Ky * L, Lcz = Kz * L, Lltb = KLT * L;
  const Ncry = PI2 * E * p.Iy / (Lcy * Lcy), Ncrz = PI2 * E * p.Iz / (Lcz * Lcz);
  const curveY = SIA && g.curveY === 'a0' ? 'a' : g.curveY;
  const curveZ = SIA && g.curveZ === 'a0' ? 'a' : g.curveZ;
  const ltbOn = !isTruss && g.ltb.susceptible && Lltb > 0;
  let Mcr = Infinity;
  if (ltbOn) {
    if (!(p.It > 0)) notes.push('It missing – LTB not checked');
    else Mcr = mcrLTB(E, G, p.Iz, p.Iw, p.It, Lltb, C1);
  } else if (!isTruss && g.ltb.susceptible && !(Lltb > 0)) notes.push('KLT ≤ 0: laterally restrained, χLT = 1');
  const ltbActive = ltbOn && Number.isFinite(Mcr) && Mcr > 0;

  const fbData = (cls) => {
    const A = res(cls).A;
    const ly = Math.sqrt(A * fy / Ncry), lz = Math.sqrt(A * fy / Ncrz);
    return {
      A, ly, lz,
      chiy: chiBuckling(ly, ALPHA[curveY]), chiz: chiBuckling(lz, ALPHA[curveZ]),
    };
  };
  const ltbData = (cls, MEd) => {
    if (!ltbActive) return { chi: 1, lam: 0, method: 'n/a' };
    const Wy = res(cls).Wy;
    const lam = Math.sqrt(Wy * fy / Mcr);
    if (SIA) {
      const a = g.welded || !(g.ltb.isI || g.shape === 'U') ? 0.49 : 0.21;
      if (lam <= 0.4) return { chi: 1, lam, alpha: a, method: R.LTBs };
      const phi = 0.5 * (1 + a * (lam - 0.4) + lam * lam);
      return { chi: Math.min(1, 1 / (phi + Math.sqrt(Math.max(0, phi * phi - lam * lam)))), lam, alpha: a, method: R.LTBs };
    }
    if (g.ltb.isI && opts.ltbMethod !== 'general') {
      const curve = g.ltb.curveSpec, a = ALPHA[curve], l0 = 0.4, beta = 0.75;
      if (lam <= l0 || MEd / Mcr <= l0 * l0) return { chi: 1, lam, curve, method: R.LTBs };
      const phi = 0.5 * (1 + a * (lam - l0) + beta * lam * lam);
      let chi = 1 / (phi + Math.sqrt(Math.max(0, phi * phi - beta * lam * lam)));
      chi = Math.min(1, chi, 1 / (lam * lam));
      const kc = Math.min(1, Math.max(0.5, 1 / Math.sqrt(C1)));
      const f = Math.min(1, 1 - 0.5 * (1 - kc) * (1 - 2 * (lam - 0.8) ** 2));
      return { chi: Math.min(1, chi / f), chiRaw: chi, f, lam, curve, method: R.LTBs };
    }
    const curve = g.ltb.isI ? g.ltb.curveGen : (g.ltb.curveGen || 'd');
    if (lam <= 0.2 || MEd / Mcr <= 0.04) return { chi: 1, lam, curve, method: R.LTBg };
    return { chi: chiBuckling(lam, ALPHA[curve]), lam, curve, method: R.LTBg };
  };

  const cs = new CheckSet(CHECKS);
  let clsMax = 1;
  const clsTag = (c) => `class ${c}`;

  for (const ck of ctx.keys) {
    const f = collectLineForces(ctx.mesh, ctx.cases[ck], segs, L, el?.nl);
    const ns = f.x.length;
    if (!ns) continue;
    let clsCase = 1, NcMax = 0, xN = f.x[0], MyMax = 0, xMy = f.x[0], MzMax = 0, xMz = f.x[0];

    for (let j = 0; j < ns; j++) {
      const x = f.x[j], N = f.N[j], Nc = -N;
      const Vy = isTruss ? 0 : f.Vy[j], Vz = isTruss ? 0 : f.Vz[j], T = isTruss ? 0 : f.T[j];
      const My = isTruss ? 0 : f.My[j], Mz = isTruss ? 0 : f.Mz[j];
      const cls = classifyAt(g, p, m, Nc, My, Mz);
      if (cls > clsCase) clsCase = cls;
      if (Nc > NcMax) { NcMax = Nc; xN = x; }
      if (Math.abs(My) > MyMax) { MyMax = Math.abs(My); xMy = x; }
      if (Math.abs(Mz) > MzMax) { MzMax = Math.abs(Mz); xMz = x; }
      const rc = res(cls);
      const NcRd = rc.A * fyd0;

      // N – EC 6.2.3 / 6.2.4
      if (N >= 0) cs.update('N', N / NtRd, ck, x, () => `${R.N}: NEd=${fmt(N)} kN (tension), Nt,Rd=${fmt(NtRd)} kN`);
      else cs.update('N', Nc / NcRd, ck, x, () => `${R.N}: NEd=${fmt(N)} kN, Nc,Rd=${fmt(NcRd)} kN (${cls === 4 ? 'Aeff' : 'A'}, ${clsTag(cls)})`);

      // torsion (St. Venant) – EC 6.2.7
      const tau = tauT(T);
      if (g.tors) cs.update('T', tau / tauRd, ck, x, () => `${R.T}: TEd=${fmt(T, 2)} kNm, τt,Ed=${fmtMPa(tau)} N/mm², τRd=${fmtMPa(tauRd)} N/mm² (St. Venant only)`);
      const red = torsRed(tau);

      // shear – EC 6.2.6 (+ 6.2.7(9) torsion reduction)
      const VplyT = Vply ? Vply * red : 0, VplzT = Vplz ? Vplz * red : 0;
      if (Vplz) cs.update('Vz', VplzT > 0 ? Math.abs(Vz) / VplzT : (Math.abs(Vz) > 0 ? ETA_CAP : 0), ck, x,
        () => `${R.V}: VEd=${fmt(Vz)} kN, Vpl,z,Rd=${fmt(VplzT)} kN (Av=${fmt(g.Avz * 1e4, 2)} cm²${red < 1 ? `, torsion red. ${fmt(red, 3)}` : ''})`);
      if (Vply) cs.update('Vy', VplyT > 0 ? Math.abs(Vy) / VplyT : (Math.abs(Vy) > 0 ? ETA_CAP : 0), ck, x,
        () => `${R.V}: VEd=${fmt(Vy)} kN, Vpl,y,Rd=${fmt(VplyT)} kN (Av=${fmt(g.Avy * 1e4, 2)} cm²${red < 1 ? `, torsion red. ${fmt(red, 3)}` : ''})`);

      if (!(rc.Wy > 0 && rc.Wz > 0)) continue;
      // bending + shear – EC 6.2.5 / 6.2.8
      const rz = rhoV(Vz, VplzT), ry = rhoV(Vy, VplyT);
      const McyRd = rc.Wy * fyd0, MczRd = rc.Wz * fyd0;
      const redM = (Mc, rho, Wv, W, Wpl) => {
        if (!(rho > 0)) return Mc;
        if (Wv && rc.plastic) return Math.max(0, Math.min(Mc, (W - rho * Wv) * fyd0));
        if (Wv && Wpl > 0) return Math.max(0, Mc * (1 - rho * Wv / Wpl));
        return Math.max(0, (1 - rho) * Mc);
      };
      const MyRd = redM(McyRd, rz, g.WvY, rc.Wy, p.Wply);
      const MzRd = redM(MczRd, ry, g.WvZ, rc.Wz, p.Wplz);
      cs.update('My', MyRd > 0 ? Math.abs(My) / MyRd : ETA_CAP, ck, x,
        () => `${R.M}: MEd=${fmt(My, 2)} kNm, Mc,y,Rd=${fmt(MyRd, 2)} kNm (${rc.wl}, ${clsTag(cls)}${rz > 0 ? `, ${R.MV} ρ=${fmt(rz, 3)}` : ''})`);
      cs.update('Mz', MzRd > 0 ? Math.abs(Mz) / MzRd : ETA_CAP, ck, x,
        () => `${R.M}: MEd=${fmt(Mz, 2)} kNm, Mc,z,Rd=${fmt(MzRd, 2)} kNm (${rc.wl}, ${clsTag(cls)}${ry > 0 ? `, ${R.MV} ρ=${fmt(ry, 3)}` : ''})`);

      // N + M (+V) – EC 6.2.9 / 6.2.1(7)
      const NRdV = (rc.A - Math.max(rz * (g.Avz || 0), ry * (g.Avy || 0))) * fyd0;
      const n = NRdV > 0 ? Math.abs(N) / NRdV : ETA_CAP;
      const mn = interactionMN(g, rc, cls, n, Math.abs(My), Math.abs(Mz), MyRd, MzRd);
      cs.update('M+N', Math.max(n, mn.eta), ck, x,
        () => `${cls <= 2 && mn.type !== 'LIN' ? R.MN : R.MNlin}: NEd=${fmt(N)} kN, n=${fmt(n, 3)}, My=${fmt(My, 2)}/${fmt(mn.MNy, 2)}, Mz=${fmt(Mz, 2)}/${fmt(mn.MNz, 2)} kNm (${mn.text}, ${clsTag(cls)})`);
    }
    if (clsCase > clsMax) clsMax = clsCase;

    // ───── member stability for this case (member class = max over stations) ─────
    const rc = res(clsCase);
    const fb = fbData(clsCase);
    const NRk = fb.A * fy;
    if (NcMax > 0) {
      const NbyRd = fb.chiy * NRk / gM1, NbzRd = fb.chiz * NRk / gM1;
      cs.update('FB-y', NcMax / NbyRd, ck, xN, () => `${R.FB}: NEd=${fmt(-NcMax)} kN, Nb,y,Rd=${fmt(NbyRd)} kN, χy=${fmt(fb.chiy, 3)}, λ̄y=${fmt(fb.ly, 3)}, Lcr=${fmt(Lcy, 2)} m, curve ${curveY}`);
      cs.update('FB-z', NcMax / NbzRd, ck, xN, () => `${R.FB}: NEd=${fmt(-NcMax)} kN, Nb,z,Rd=${fmt(NbzRd)} kN, χz=${fmt(fb.chiz, 3)}, λ̄z=${fmt(fb.lz, 3)}, Lcr=${fmt(Lcz, 2)} m, curve ${curveZ}`);
    } else {
      cs.update('FB-y', 0, ck, xN, 'no compression');
      cs.update('FB-z', 0, ck, xN, 'no compression');
    }
    if (isTruss || !(rc.Wy > 0 && rc.Wz > 0)) continue;
    const MyRk = rc.Wy * fy, MzRk = rc.Wz * fy;
    const lt = ltbData(clsCase, MyMax);
    if (ltbActive) {
      const MbRd = lt.chi * MyRk / gM1;
      cs.update('LTB', MyMax / MbRd, ck, xMy, () => `${lt.method}: MEd=${fmt(MyMax, 2)} kNm, Mb,Rd=${fmt(MbRd, 2)} kNm, χLT=${fmt(lt.chi, 3)}${lt.f ? ` (χ=${fmt(lt.chiRaw, 3)}, f=${fmt(lt.f, 3)})` : ''}, λ̄LT=${fmt(lt.lam, 3)}, Mcr=${fmt(Mcr, 1)} kNm, C1=${fmt(C1, 2)}, L=${fmt(Lltb, 2)} m${lt.curve ? `, curve ${lt.curve}` : ''}${lt.alpha ? `, αD=${lt.alpha}` : ''}`);
    }

    // interaction
    if (!(NcMax > 0) && !(MyMax > 0) && !(MzMax > 0)) { cs.update('Interaction', 0, ck, xMy, 'no action'); continue; }
    const xInt = MyMax > 0 ? xMy : MzMax > 0 ? xMz : xN;
    const dgY = momentDiagram(f.x, f.My), dgZ = momentDiagram(f.x, f.Mz);
    if (SIA) {
      const wy = omegaSIA(dgY, Ky > 1), wz = omegaSIA(dgZ, Kz > 1);
      const NkyRd = fb.chiy * NRk / gM1, NkzRd = fb.chiz * NRk / gM1;
      const ay = 1 - NcMax / Ncry, az = 1 - NcMax / Ncrz;
      const MyRd = MyRk / gM1, MzRd = MzRk / gM1, MDRd = lt.chi * MyRk / gM1;
      let e1, e2;
      if (ay <= 0 || az <= 0) { e1 = e2 = ETA_CAP; }
      else {
        e1 = NcMax / NkyRd + wy * MyMax / (ay * MyRd) + wz * MzMax / (az * MzRd);
        e2 = NcMax / NkzRd + wy * MyMax / (ay * MDRd) + wz * MzMax / (az * MzRd);
      }
      cs.update('Interaction', Math.max(e1, e2), ck, xInt, () => `${R.INT}: in-plane ${fmt(e1, 3)}, with LTB ${fmt(e2, 3)}; NEd=${fmt(-NcMax)} kN, My=${fmt(MyMax, 2)}, Mz=${fmt(MzMax, 2)} kNm, ωy=${fmt(wy, 2)}, ωz=${fmt(wz, 2)}, 1−N/Ncr,y=${fmt(ay, 3)}, 1−N/Ncr,z=${fmt(az, 3)}, χD=${fmt(lt.chi, 3)}`);
    } else {
      const Cmy = cmAnnexB(dgY, Ky > 1), Cmz = cmAnnexB(dgZ, Kz > 1), CmLT = cmAnnexB(dgY, false);
      const ny = NcMax / (fb.chiy * NRk / gM1), nz = NcMax / (fb.chiz * NRk / gM1);
      const plastic = clsCase <= 2;
      const susceptible = ltbActive; // open section without LTB restraint → Table B.2
      let kyy, kzz, kyz, kzy;
      if (plastic) {
        kyy = Cmy * Math.min(1 + (fb.ly - 0.2) * ny, 1 + 0.8 * ny);
        kzz = g.open && g.shape !== 'RECT'
          ? Cmz * Math.min(1 + (2 * fb.lz - 0.6) * nz, 1 + 1.4 * nz)
          : Cmz * Math.min(1 + (fb.lz - 0.2) * nz, 1 + 0.8 * nz);
        kyz = 0.6 * kzz;
        if (!susceptible) kzy = 0.6 * kyy;
        else if (fb.lz >= 0.4) kzy = Math.max(1 - 0.1 * fb.lz * nz / (CmLT - 0.25), 1 - 0.1 * nz / (CmLT - 0.25));
        else kzy = Math.min(0.6 + fb.lz, 1 - 0.1 * fb.lz * nz / (CmLT - 0.25));
      } else {
        kyy = Cmy * Math.min(1 + 0.6 * fb.ly * ny, 1 + 0.6 * ny);
        kzz = Cmz * Math.min(1 + 0.6 * fb.lz * nz, 1 + 0.6 * nz);
        kyz = kzz;
        kzy = !susceptible ? 0.8 * kyy : Math.max(1 - 0.05 * fb.lz * nz / (CmLT - 0.25), 1 - 0.05 * nz / (CmLT - 0.25));
      }
      const My1 = MyMax / (lt.chi * MyRk / gM1), Mz1 = MzMax / (MzRk / gM1);
      const e1 = ny + kyy * My1 + kyz * Mz1;
      const e2 = nz + kzy * My1 + kzz * Mz1;
      cs.update('Interaction', Math.max(e1, e2), ck, xInt, () => `${R.INT}: (6.61) ${fmt(e1, 3)}, (6.62) ${fmt(e2, 3)}; NEd=${fmt(-NcMax)} kN, My=${fmt(MyMax, 2)}, Mz=${fmt(MzMax, 2)} kNm, χy=${fmt(fb.chiy, 3)}, χz=${fmt(fb.chiz, 3)}, χLT=${fmt(lt.chi, 3)}, kyy=${fmt(kyy, 3)}, kyz=${fmt(kyz, 3)}, kzy=${fmt(kzy, 3)}, kzz=${fmt(kzz, 3)}, Cmy=${fmt(Cmy, 2)}, Cmz=${fmt(Cmz, 2)}, CmLT=${fmt(CmLT, 2)} (Table ${susceptible ? 'B.2' : 'B.1'})`);
    }
  }

  // drop checks that do not apply to this member
  const checks = cs.checks;
  if (!g.tors) delete checks.T;
  if (!Vply) delete checks.Vy;
  if (!Vplz) delete checks.Vz;
  if (!ltbActive) delete checks.LTB;
  if (isTruss) { delete checks.Vy; delete checks.Vz; delete checks.T; delete checks.My; delete checks.Mz; delete checks['M+N']; delete checks.Interaction; }
  for (const k of Object.keys(checks)) if (checks[k].caseKey === null) delete checks[k];
  const gov = cs.governing();
  return {
    line: line.id,
    eta: gov ? gov.eta : 0,
    governing: gov ? { check: gov.check, caseKey: gov.caseKey, x: gov.x } : null,
    cls: clsMax,
    code: rules.code,
    checks,
    notes: [...new Set(notes)],
  };
}

/** N + My + Mz cross-section interaction (see header). Returns { eta, MNy, MNz, type, text }. */
function interactionMN(g, rc, cls, n, My, Mz, MyRd, MzRd) {
  const lin = () => ({
    eta: n + (MyRd > 0 ? My / MyRd : (My > 0 ? ETA_CAP : 0)) + (MzRd > 0 ? Mz / MzRd : (Mz > 0 ? ETA_CAP : 0)),
    MNy: MyRd, MNz: MzRd, type: 'LIN', text: 'linear',
  });
  if (cls > 2 || g.mn === 'LIN') return lin();
  if (n >= 1) return { eta: n + (My > 0 || Mz > 0 ? 1 : 0), MNy: 0, MNz: 0, type: g.mn, text: 'n ≥ 1' };
  const comb = (ry, rz, a, b) => {
    if (!(ry > 0)) return rz; // single-moment cases reported linearly
    if (!(rz > 0)) return ry;
    return ry ** a + rz ** b;
  };
  switch (g.mn) {
    case 'I': {
      const a = g.mnA;
      const MNy = Math.min(MyRd, MyRd * (1 - n) / (1 - 0.5 * a));
      const MNz = n <= a ? MzRd : MzRd * (1 - ((n - a) / (1 - a)) ** 2);
      const beta = Math.max(1, 5 * n);
      return { eta: comb(My / MNy, MNz > 0 ? Mz / MNz : (Mz > 0 ? ETA_CAP : 0), 2, beta), MNy, MNz, type: 'I', text: `α=2, β=${fmt(beta, 2)}` };
    }
    case 'RHS': {
      const MNy = Math.min(MyRd, MyRd * (1 - n) / (1 - 0.5 * g.mnAw));
      const MNz = Math.min(MzRd, MzRd * (1 - n) / (1 - 0.5 * g.mnAf));
      const q = 1 - 1.13 * n * n;
      const ex = q > 0 ? Math.min(6, 1.66 / q) : 6;
      return { eta: comb(My / MNy, Mz / MNz, ex, ex), MNy, MNz, type: 'RHS', text: `α=β=${fmt(ex, 2)}` };
    }
    case 'CHS': {
      const MN = MyRd * (1 - n ** 1.7);
      return { eta: MN > 0 ? Math.hypot(My, Mz) / MN : ETA_CAP, MNy: MN, MNz: MN, type: 'CHS', text: 'resultant, MN=Mpl(1−n^1.7)' };
    }
    case 'CIRC': {
      const MN = MyRd * (1 - n * n);
      return { eta: MN > 0 ? Math.hypot(My, Mz) / MN : ETA_CAP, MNy: MN, MNz: MN, type: 'CIRC', text: 'resultant, MN=Mpl(1−n²)' };
    }
    case 'RECT': {
      const MNy = MyRd * (1 - n * n), MNz = MzRd * (1 - n * n);
      return { eta: (MNy > 0 ? My / MNy : 0) + (MNz > 0 ? Mz / MNz : 0), MNy, MNz, type: 'RECT', text: 'MN=Mpl(1−n²), linear biaxial' };
    }
    default: return lin();
  }
}

/** Internals exposed for unit tests. */
export const steelHelpers = { chiBuckling, mcrLTB, classInternal, classOutstand, classCHS, cmAnnexB, omegaSIA, rhoInternal, rhoOutstand };
