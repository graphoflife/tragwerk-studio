// Reinforced-concrete design – EN 1992-1-1 (opts.code 'EC', default) and SIA 262 (opts.code 'SIA').
// Pure ES module (no DOM). See SPEC.md §5.
// DEVIATIONS FROM SPEC.md §5: (1) designRCSurfaces additionally returns `code` and `flags`
//   (Uint8Array per shell corner, FLAG_* bits); (2) designRCBeams: AsBot/AsTop are TOTAL areas in
//   m² per station (Asw in m²/m as specified); extra fields `code`, `b`, `h`, `d`; the array carries
//   `warnings` and `code`, skipped members are not in the array; (3) beam RC parameters are read
//   from the extension fields element.design.rc / section.rc / opts.rc.
//
// designRCSurfaces(model, mesh, staticResults, caseKeys, opts?) →
//   { asCorner: Float64Array(nShell·4·4) [axb, ayb, axt, ayt] m²/m (max over cases),
//     warnings: [string], code, flags: Uint8Array(nShell·4) (see FLAG_*) }
// designRCBeams(model, mesh, staticResults, caseKeys, opts?) →
//   [{ line, x:[], AsBot:[], AsTop:[] (m²), Asw:[] (m²/m), ok, notes, code, b, h, d }]
//
// Signs (SPEC §4): mx > 0 = tension at the −z (bottom) face; beam My > 0 = tension at the bottom
// (−z); N > 0 tension. "b"/"bottom" = −z face, "t"/"top" = +z face. Units: kN, m.
//
// ───────────────────────────── surfaces (slabs / shells / walls) ─────────────────────────────
// 1. Wood–Armer transformation of (mx, my, mxy) into design moments for the bottom (≥ 0) and top
//    (≤ 0) faces (Wood 1968 / Armer 1968, see woodArmer()).
// 2. Membrane forces (simplified, documented): design normal forces per direction from the
//    analogous yield-criterion transform of (nx, ny, nxy) (EN 1992-1-1 Annex F / SIA 262 4.2.1 type
//    reinforcement for in-plane forces):  Nx = nx + |nxy|, Ny = ny + |nxy|; if one of them is in
//    net compression (n + |nxy| < 0) it keeps its compression n + nxy²/|n| and the other direction
//    gets n_other + nxy²/|n|. Coupling of nxy with mxy (sandwich model) is neglected.
// 3. Per direction a 1 m strip is designed for (m*, N) with the rectangular stress block
//    (designMN): once for the bottom-face moment (tension bottom) and once for the top-face moment
//    (tension top); each layer gets the maximum of both designs. Small-eccentricity tension puts
//    reinforcement into both layers; compression reinforcement is added when x/d exceeds the limit
//    (EC: 0.45 for fck ≤ 50 MPa (5.5(4)), 0.35 above; SIA: 0.35, SIA 262 4.1.4.2.5) and flagged.
// 4. Effective depths: outer layer x: d = t − cover − dia/2, inner layer y: d − dia (both faces).
//    domain.rc = { cover = 0.03, dia = 0.012, fyk = 500000 } (defaults).
// 5. Minimum reinforcement where a layer needs tension reinforcement (As > 1e-7 m²/m):
//    EC 9.2.1.1(1) (via 9.3.1.1): As,min = max(0.26·fctm/fyk, 0.0013)·b·d;
//    SIA 262 (5.5.2 / 4.4.2.3, ductility "MRd ≥ Mcr"): As,min = fctm·h²/6 / (0.9·d·fsd).
//    Disable with opts.minReinf = false.
// 6. Slab shear without shear reinforcement is only CHECKED (warning + flag):
//    EC 6.2.2(1) vRd,c with ρl from the designed reinforcement; SIA 262 4.3.3.2: vRd = kd·τcd·dv,
//    τcd = 0.3·ηt·√fck/γc, kd = 1/(1 + εv·d·kg), εv = 1.5·fsd/Es (conservative), kg = 1 (Dmax 32).
// Material: EC fcd = αcc·fck/γc (αcc = opts.alphaCC ?? 1.0, γc = material.gammaM ?? 1.5),
//   λ/η of 3.1.7(3), fyd = fyk/1.15. SIA 262 2.3.2: fcd = ηfc·ηt·fck/γc with ηfc = (30/fck)^(1/3) ≤ 1,
//   ηt = 1.0 (opts.etaT), γc = 1.5; fsd = fsk/1.15; rectangular stress block fcd over 0.85·x
//   (SIA 262 4.2.1, εcu = 3 ‰) – NOTE: SIA 262 text not consulted, values per project specification.
//
// ─────────────────────────────────────── beams ───────────────────────────────────────
// Lines (beam | rib | truss) with concrete material and RECT or T section (T: flange at +z/top,
// dims h, b = flange width, tw, tf). Bending My + N with designMN at every station (T-beam in
// sagging: flange width if the stress block stays in the flange, otherwise the web width –
// conservative). Mz and torsion are not designed (note if significant).
// Defaults (element.design.rc or section.rc): cover 0.03 (to stirrups), dia 0.020, diaStirrup 0.010,
// fyk 500000, fywk = fyk → d = h − cover − diaStirrup − dia/2.
// Shear, z = 0.9·d:
//   EC 6.2.2/6.2.3: VEd ≤ VRd,c → minimum stirrups ρw,min = 0.08√fck/fyk (9.2.2(5)); otherwise
//   variable strut inclination: the largest cot θ ≤ 2.5 (opts.cotThetaMax) with VEd ≤ VRd,max(θ)
//   (6.9, ν1 = 0.6(1 − fck/250), αcw = 1), Asw/s = VEd/(z·fywd·cot θ) (6.8). opts.cotTheta fixes θ.
//   SIA 262 4.3.3.4: fixed compression-field angle α, cot α = opts.cotTheta ?? 1.0 (α = 45°,
//   allowed 25°…45° → cot 1…2.14), Asw/s = VEd/(z·fsd·cot α), VRd,c = bw·z·kc·fcd·sin α·cos α
//   with kc = 0.55; minimum stirrups ρw,min = 0.001·√(fck/30)·500/fsk (SIA 262 5.5.2.2).
// Shift rule (EC 6.2.3(7), analogous in SIA): ΔFtd = 0.5·VEd·cot θ is added to the tension
// reinforcement, limited to the maximum required along the member (same face, same case).
// Minimum longitudinal reinforcement as for surfaces (tension zone width), As,max = 0.04·Ac (ok=false).

import { designCode, num, pos, fmt, designContext, collectLineForces, MEMBER_TYPES } from './common.js';

export const FLAG_COMPRESSION_REINF = 1;
export const FLAG_AS_MAX = 2;
export const FLAG_SHEAR = 4;
export const FLAG_FAIL = 8;

const ES = 200e6; // kN/m², reinforcing steel E modulus
const AS_EPS = 1e-7; // m²/m – below this a layer counts as "no reinforcement required"

/** Wood–Armer design moments: bottom (mxb, myb ≥ 0) and top (mxt, myt ≤ 0). */
export function woodArmer(mx, my, mxy) {
  const a = Math.abs(mxy);
  // bottom (positive moments)
  let mxb = mx + a, myb = my + a;
  if (mxb < 0) {
    mxb = 0;
    myb = Math.abs(mx) > 1e-12 ? my + (mxy * mxy) / Math.abs(mx) : my;
  } else if (myb < 0) {
    myb = 0;
    mxb = Math.abs(my) > 1e-12 ? mx + (mxy * mxy) / Math.abs(my) : mx;
  }
  mxb = Math.max(0, mxb); myb = Math.max(0, myb);
  // top (negative moments)
  let mxt = mx - a, myt = my - a;
  if (mxt > 0) {
    mxt = 0;
    myt = Math.abs(mx) > 1e-12 ? my - (mxy * mxy) / Math.abs(mx) : my;
  } else if (myt > 0) {
    myt = 0;
    mxt = Math.abs(my) > 1e-12 ? mx - (mxy * mxy) / Math.abs(my) : mx;
  }
  mxt = Math.min(0, mxt); myt = Math.min(0, myt);
  return { mxb, myb, mxt, myt };
}

/** Design normal forces for in-plane reinforcement (see header, item 2). */
export function membraneDesignForces(nx, ny, nxy) {
  const a = Math.abs(nxy);
  if (!(a > 0)) return { Nx: nx, Ny: ny };
  if (nx + a >= 0 && ny + a >= 0) return { Nx: nx + a, Ny: ny + a };
  // one direction in net compression: the concrete strut is carried by the more compressed one
  const k = (nxy * nxy) / Math.abs(Math.min(nx, ny));
  return { Nx: nx + k, Ny: ny + k };
}

/**
 * Concrete / reinforcement design parameters.
 * @returns { code, fck, fckM, fcd, fctm, fyk, fyd, lam, eta, xiLim, ecu, gc, ref }
 */
export function concreteParams(mat, fyk, code, opts = {}) {
  const fck = pos(mat && mat.fck, NaN);
  if (!(fck > 0)) return null;
  const fckM = fck / 1000;
  const gc = pos(mat.gammaM, 1.5);
  const gs = pos(opts.gammaS, 1.15);
  const fyd = fyk / gs;
  const fctmDef = (fckM <= 50 ? 0.3 * fckM ** (2 / 3) : 2.12 * Math.log(1 + (fckM + 8) / 10)) * 1000;
  const fctm = pos(mat.fctm, fctmDef);
  if (code === 'SIA') {
    const etaFc = Math.min(1, (30 / fckM) ** (1 / 3));
    const etaT = pos(opts.etaT, 1.0);
    return {
      code, fck, fckM, gc, fyk, fyd, fctm, etaFc, etaT,
      fcd: etaFc * etaT * fck / gc, lam: 0.85, eta: 1.0, xiLim: pos(opts.xiLim, 0.35), ecu: 0.003,
      ref: { M: 'SIA 262 4.2.1', V: 'SIA 262 4.3.3', min: 'SIA 262 5.5.2', xi: 'SIA 262 4.1.4.2.5' },
    };
  }
  const acc = pos(opts.alphaCC, 1.0);
  return {
    code: 'EC', fck, fckM, gc, fyk, fyd, fctm,
    fcd: acc * fck / gc,
    lam: fckM <= 50 ? 0.8 : 0.8 - (fckM - 50) / 400,
    eta: fckM <= 50 ? 1.0 : 1.0 - (fckM - 50) / 200,
    xiLim: pos(opts.xiLim, fckM <= 50 ? 0.45 : 0.35),
    ecu: fckM <= 50 ? 0.0035 : (2.6 + 35 * ((90 - fckM) / 100) ** 4) / 1000,
    ref: { M: 'EN 1992-1-1 6.1', V: 'EN 1992-1-1 6.2', min: 'EN 1992-1-1 9.2.1.1', xi: 'EN 1992-1-1 5.5(4)' },
  };
}

/**
 * Design of a rectangular section b×h for M ≥ 0 (tension at the side of As1, effective depth d)
 * and axial force N (> 0 tension), rectangular stress block.
 * @returns { As1, As2 (compression side / second layer), xi, comp, fail, mode }
 */
export function designMN(M, N, s) {
  const { b, h, d, d2, fcd, fyd } = s;
  const lam = s.lam ?? 0.8, eta = s.eta ?? 1.0, xiLim = s.xiLim ?? 0.45, ecu = s.ecu ?? 0.0035;
  const r = { As1: 0, As2: 0, xi: 0, comp: false, fail: false, mode: 'bending' };
  M = Math.max(0, M || 0); N = N || 0;
  if (!(M > 0) && !(N !== 0)) return r;
  const zs1 = d - h / 2, zs2 = h / 2 - d2;
  // small-eccentricity tension: the whole section is cracked, both layers in tension
  if (N > 0 && M <= N * zs1) {
    const den = (zs1 + zs2) * fyd;
    r.As1 = (N * zs2 + M) / den;
    r.As2 = Math.max(0, (N * zs1 - M) / den);
    r.mode = 'tension';
    return r;
  }
  const Ms = M - N * zs1; // moment about the tension reinforcement
  if (!(Ms > 0)) return r;
  const fc = eta * fcd;
  const mu = Ms / (b * d * d * fc);
  const wLim = lam * xiLim;
  const muLim = wLim * (1 - wLim / 2);
  if (mu <= muLim) {
    const w = 1 - Math.sqrt(1 - 2 * mu);
    const z = d * (1 - w / 2);
    r.As1 = Math.max(0, (Ms / z + N) / fyd);
    r.xi = w / lam;
    return r;
  }
  // compression reinforcement keeps x = xiLim·d
  const x = xiLim * d;
  const ss2 = x > d2 ? Math.min(fyd, ES * ecu * (x - d2) / x) : 0;
  const dM = Ms - muLim * b * d * d * fc;
  r.comp = true;
  r.mode = 'compression reinforcement';
  r.xi = xiLim;
  if (!(ss2 > 0) || !(d - d2 > 0)) { r.fail = true; r.As2 = Infinity; r.As1 = Infinity; return r; }
  r.As2 = dM / ((d - d2) * ss2);
  r.As1 = Math.max(0, (wLim * b * d * fc + dM / (d - d2) + N) / fyd);
  if (N < 0 && -N > fc * b * h + r.As2 * ss2 + r.As1 * fyd) r.fail = true;
  return r;
}

/** Minimum tension reinforcement (m² for width b). */
function asMin(P, b, h, d) {
  if (P.code === 'SIA') return (P.fctm * b * h * h / 6) / (0.9 * d * P.fyd);
  return Math.max(0.26 * P.fctm / P.fyk, 0.0013) * b * d;
}

/** Concrete shear resistance of a member without shear reinforcement [kN per width b]. */
function shearResistanceNoStirrups(P, b, d, rhoL, sigmaCp = 0) {
  if (P.code === 'SIA') {
    const tcd = 0.3 * P.etaT * Math.sqrt(P.fckM) / P.gc; // MPa
    const ev = 1.5 * P.fyd / ES;
    const kd = 1 / (1 + ev * d * 1000 * 1.0);
    return kd * tcd * 1000 * d * b;
  }
  const k = Math.min(2, 1 + Math.sqrt(200 / (d * 1000)));
  const rho = Math.min(0.02, Math.max(0, rhoL));
  const cr = 0.18 / P.gc;
  const vmin = 0.035 * k ** 1.5 * Math.sqrt(P.fckM);
  const scp = Math.min(Math.max(0, sigmaCp / 1000), 0.2 * P.fcd / 1000); // MPa, compression > 0
  const v = Math.max(cr * k * Math.cbrt(100 * rho * P.fckM) + 0.15 * scp, vmin + 0.15 * scp);
  return v * 1000 * b * d;
}

function rcDefaults(src, defs) {
  const o = Object.assign({}, defs);
  if (src && typeof src === 'object') for (const k of Object.keys(defs)) if (Number.isFinite(src[k]) && src[k] > 0) o[k] = src[k];
  return o;
}

// ─────────────────────────────────────── surfaces ───────────────────────────────────────

export function designRCSurfaces(model, mesh, staticResults, caseKeys, opts = {}) {
  opts = opts || {};
  const code = designCode(model, opts);
  const warnings = [];
  const shells = mesh && Array.isArray(mesh.shells) ? mesh.shells : [];
  const nS = shells.length;
  const asCorner = new Float64Array(nS * 16);
  const flags = new Uint8Array(nS * 4);
  const result = { asCorner, warnings, code, flags };
  try {
    const ctx = designContext(model, mesh, staticResults, caseKeys, warnings, 'shells');
    const useMin = opts.minReinf !== false;
    // group shell elements by domain
    const byDomain = new Map();
    for (let e = 0; e < nS; e++) {
      const s = shells[e];
      if (!s) continue;
      const id = Number(s.domain);
      if (!byDomain.has(id)) byDomain.set(id, []);
      byDomain.get(id).push(e);
    }
    for (const [domId, elems] of byDomain) {
      const dom = ctx.domains.get(domId) || {};
      const s0 = shells[elems[0]];
      const mat = ctx.materials.get(Number(s0.material ?? dom.material));
      if (!mat || mat.type !== 'concrete') continue;
      const type = s0.type || dom.type;
      if (type && !['plate', 'shell', 'membrane'].includes(type)) continue;
      const rc = rcDefaults(dom.rc, { cover: 0.03, dia: 0.012, fyk: 500000 });
      const P = concreteParams(mat, rc.fyk, code, opts);
      if (!P) { warnings.push(`Domain ${domId}: concrete material without fck – RC design skipped`); continue; }
      let nComp = 0, nMax = 0, nShear = 0, nFail = 0, vMaxRatio = 0;
      for (const e of elems) {
        const sh = shells[e];
        const t = pos(sh.thickness, pos(dom.thickness, NaN));
        if (!(t > 0)) { nFail++; continue; }
        const dx = t - rc.cover - rc.dia / 2, dy = dx - rc.dia;
        if (!(dy > 0.2 * t)) { warnings.push(`Domain ${domId}: thickness ${fmt(t, 3)} m too small for cover/dia – skipped`); break; }
        const d2x = rc.cover + rc.dia / 2, d2y = rc.cover + 1.5 * rc.dia;
        const base = { b: 1, h: t, fcd: P.fcd, fyd: P.fyd, lam: P.lam, eta: P.eta, xiLim: P.xiLim, ecu: P.ecu };
        const SX = { ...base, d: dx, d2: d2x }; // outer (x) layers on both faces
        const SY = { ...base, d: dy, d2: d2y }; // inner (y) layers on both faces
        for (let c = 0; c < 4; c++) {
          const o = (e * 4 + c) * 16 / 4; // = (e*4+c)*4
          let vEdMax = 0, flag = 0;
          for (const key of ctx.keys) {
            const sv = ctx.cases[key].shells;
            const i0 = (e * 4 + c) * 8;
            if (!sv || sv.length < i0 + 8) continue;
            const nx = sv[i0], ny = sv[i0 + 1], nxy = sv[i0 + 2], mx = sv[i0 + 3], my = sv[i0 + 4], mxy = sv[i0 + 5];
            const vEd = Math.hypot(sv[i0 + 6], sv[i0 + 7]);
            if (vEd > vEdMax) vEdMax = vEd;
            const wa = woodArmer(mx, my, mxy);
            const nd = type === 'plate' ? { Nx: 0, Ny: 0 } : membraneDesignForces(nx, ny, nxy);
            // x direction
            const xb = designMN(wa.mxb, nd.Nx, SX), xt = designMN(-wa.mxt, nd.Nx, SX);
            const yb = designMN(wa.myb, nd.Ny, SY), yt = designMN(-wa.myt, nd.Ny, SY);
            const axb = Math.max(xb.As1, xt.As2), axt = Math.max(xt.As1, xb.As2);
            const ayb = Math.max(yb.As1, yt.As2), ayt = Math.max(yt.As1, yb.As2);
            if (xb.comp || xt.comp || yb.comp || yt.comp) flag |= FLAG_COMPRESSION_REINF;
            if (xb.fail || xt.fail || yb.fail || yt.fail) flag |= FLAG_FAIL;
            const k = o;
            if (axb > asCorner[k]) asCorner[k] = axb;
            if (ayb > asCorner[k + 1]) asCorner[k + 1] = ayb;
            if (axt > asCorner[k + 2]) asCorner[k + 2] = axt;
            if (ayt > asCorner[k + 3]) asCorner[k + 3] = ayt;
          }
          // minimum reinforcement (layers in tension only)
          const k = o;
          if (useMin) {
            const minX = asMin(P, 1, t, dx), minY = asMin(P, 1, t, dy);
            for (const [j, mn] of [[0, minX], [1, minY], [2, minX], [3, minY]]) {
              if (asCorner[k + j] > AS_EPS && asCorner[k + j] < mn) asCorner[k + j] = mn;
            }
          }
          for (let j = 0; j < 4; j++) {
            if (!Number.isFinite(asCorner[k + j])) { asCorner[k + j] = 0.04 * t; flag |= FLAG_FAIL; }
            if (asCorner[k + j] > 0.04 * t) flag |= FLAG_AS_MAX;
          }
          // slab shear without shear reinforcement (check only)
          if (type !== 'membrane' && vEdMax > 0) {
            const dm = (dx + dy) / 2;
            const rhoL = (Math.max(asCorner[k], asCorner[k + 2]) + Math.max(asCorner[k + 1], asCorner[k + 3])) / 2 / dm;
            const vRd = shearResistanceNoStirrups(P, 1, dm, rhoL);
            if (vEdMax > vRd) { flag |= FLAG_SHEAR; nShear++; vMaxRatio = Math.max(vMaxRatio, vEdMax / vRd); }
          }
          flags[e * 4 + c] = flag;
          if (flag & FLAG_COMPRESSION_REINF) nComp++;
          if (flag & FLAG_AS_MAX) nMax++;
          if (flag & FLAG_FAIL) nFail++;
        }
      }
      if (nComp) warnings.push(`Domain ${domId}: compression reinforcement required (x/d > ${P.xiLim}, ${P.ref.xi}) at ${nComp} corner(s)`);
      if (nMax) warnings.push(`Domain ${domId}: As > As,max = 0.04·Ac at ${nMax} corner(s)`);
      if (nFail) warnings.push(`Domain ${domId}: design not possible (section too small / missing data) at ${nFail} corner(s)`);
      if (nShear) warnings.push(`Domain ${domId}: vEd > vRd,c at ${nShear} corner(s) (max ratio ${fmt(vMaxRatio, 2)}, ${P.ref.V}) – shear reinforcement required, not designed`);
    }
  } catch (e) {
    warnings.push(`RC surface design aborted: ${e && e.message}`);
  }
  return result;
}

// ─────────────────────────────────────── beams ───────────────────────────────────────

export function designRCBeams(model, mesh, staticResults, caseKeys, opts = {}) {
  opts = opts || {};
  const code = designCode(model, opts);
  const out = [];
  out.warnings = [];
  out.code = code;
  try {
    const ctx = designContext(model, mesh, staticResults, caseKeys, out.warnings, 'beams');
    for (const line of Array.isArray(model?.lines) ? model.lines : []) {
      const el = line && line.element;
      if (!el || !MEMBER_TYPES.has(el.type)) continue;
      const mat = ctx.materials.get(Number(el.material));
      if (!mat || mat.type !== 'concrete') continue;
      try {
        const r = designBeam(ctx, code, line, el, mat, opts);
        if (r) out.push(r);
      } catch (e) {
        out.warnings.push(`Line ${line.id}: RC beam design failed (${e && e.message})`);
      }
    }
  } catch (e) {
    out.warnings.push(`RC beam design aborted: ${e && e.message}`);
  }
  return out;
}

function designBeam(ctx, code, line, el, mat, opts) {
  const W = (msg) => { ctx.warnings.push(`Line ${line.id}: ${msg} – RC beam design skipped`); return null; };
  const sec = ctx.sections.get(Number(el.section));
  if (!sec) return W('no section');
  const dims = sec.dims || {};
  let bw, bf = 0, hf = 0, h;
  if (sec.shape === 'RECT' && dims.h > 0 && dims.b > 0) { h = dims.h; bw = dims.b; }
  else if (sec.shape === 'T' && dims.h > 0 && dims.b > 0 && dims.tw > 0 && dims.tf > 0) { h = dims.h; bw = dims.tw; bf = dims.b; hf = dims.tf; }
  else return W(`section shape ${sec.shape} not supported (RECT/T only)`);
  const rc = rcDefaults(Object.assign({}, sec.rc || {}, (el.design && el.design.rc) || {}, opts.rc || {}),
    { cover: 0.03, dia: 0.020, diaStirrup: 0.010, fyk: 500000, fywk: 0 });
  if (!(rc.fywk > 0)) rc.fywk = rc.fyk;
  const P = concreteParams(mat, rc.fyk, code, opts);
  if (!P) return W('concrete material without fck');
  const L = ctx.lineLength(line);
  if (!(L > 0)) return W('zero length');
  const segs = ctx.segs.get(Number(line.id));
  if (!segs || !segs.length) return W('no mesh beams');
  const d = h - rc.cover - rc.diaStirrup - rc.dia / 2;
  const d2 = rc.cover + rc.diaStirrup + rc.dia / 2;
  if (!(d > 0.5 * h)) return W('cover/bar diameters too large for the section height');
  const z = 0.9 * d;
  const fywd = rc.fywk / pos(opts.gammaS, 1.15);
  const Ac = sec.shape === 'T' ? bf * hf + bw * (h - hf) : bw * h;
  const notes = [];
  const base = { h, d, d2, fcd: P.fcd, fyd: P.fyd, lam: P.lam, eta: P.eta, xiLim: P.xiLim, ecu: P.ecu };

  // shear model parameters
  const SIA = code === 'SIA';
  const cotFixed = Number.isFinite(opts.cotTheta) ? opts.cotTheta : (SIA ? 1.0 : null);
  const cotMax = SIA ? 2.14 : pos(opts.cotThetaMax, 2.5);
  const nu1 = 0.6 * (1 - P.fckM / 250);
  const rhoWmin = SIA ? 0.001 * Math.sqrt(P.fckM / 30) * 500 / (rc.fywk / 1000) : 0.08 * Math.sqrt(P.fckM) / (rc.fywk / 1000);
  const AswMin = rhoWmin * bw;

  let xs = null, AsBot = null, AsTop = null, Asw = null;
  let ok = true, compAt = null, vmaxFail = null, failAt = null, MzSig = false, TSig = false, MyAbsMax = 0;
  let cotUsedMin = Infinity;
  for (const key of ctx.keys) {
    const f = collectLineForces(ctx.mesh, ctx.cases[key], segs, L);
    const n = f.x.length;
    if (!n) continue;
    if (!xs) {
      xs = f.x.slice();
      AsBot = new Array(n).fill(0); AsTop = new Array(n).fill(0); Asw = new Array(n).fill(0);
    }
    if (n !== xs.length) { notes.push(`case ${key}: station count mismatch – ignored`); continue; }
    const aB = new Array(n), aT = new Array(n), dF = new Array(n);
    for (let j = 0; j < n; j++) {
      const My = f.My[j], N = f.N[j], V = Math.abs(f.Vz[j]);
      MyAbsMax = Math.max(MyAbsMax, Math.abs(My));
      if (Math.abs(f.Mz[j]) > Math.max(1, 0.05 * Math.abs(My))) MzSig = true;
      if (Math.abs(f.T[j]) > 1) TSig = true;
      // bending: sagging (My ≥ 0) → bottom in tension, compression zone in the (top) flange
      let rB, rT;
      if (My >= 0) {
        rB = designMN(My, N, { ...base, b: bf > 0 ? bf : bw });
        if (bf > 0 && rB.xi * P.lam * d > hf) rB = designMN(My, N, { ...base, b: bw });
        aB[j] = rB.As1; aT[j] = rB.As2;
      } else {
        rT = designMN(-My, N, { ...base, b: bw });
        aT[j] = rT.As1; aB[j] = rT.As2;
      }
      const r = rB || rT;
      if (r.comp && compAt === null) compAt = f.x[j];
      if (r.fail) { ok = false; if (failAt === null) failAt = f.x[j]; }
      // shear
      let asw = AswMin, cot = cotFixed ?? cotMax;
      if (SIA) {
        cot = Math.min(cotMax, Math.max(1, cot));
        const sc = 1 / Math.sqrt(1 + cot * cot);       // sin α
        const VRdc = bw * z * 0.55 * P.fcd * sc * (cot * sc); // bw·z·kc·fcd·sinα·cosα
        if (V > VRdc) { ok = false; if (vmaxFail === null) vmaxFail = { x: f.x[j], V, VR: VRdc }; }
        asw = Math.max(AswMin, V / (z * fywd * cot));
      } else {
        const rhoL = Math.max(aB[j], aT[j]) / (bw * d);
        const VRdc = shearResistanceNoStirrups(P, bw, d, rhoL, -N / Ac);
        const K = bw * z * nu1 * P.fcd;
        if (cotFixed != null) {
          cot = Math.max(1, Math.min(cotMax, cotFixed));
        } else if (V > 0) {
          const rr = K / V;
          if (rr >= cotMax + 1 / cotMax) cot = cotMax;
          else if (rr >= 2) cot = (rr + Math.sqrt(rr * rr - 4)) / 2;
          else cot = 1;
        }
        const VRdmax = K / (cot + 1 / cot);
        if (V > VRdmax) { ok = false; if (vmaxFail === null) vmaxFail = { x: f.x[j], V, VR: VRdmax }; }
        if (V > VRdc) { asw = Math.max(AswMin, V / (z * fywd * cot)); cotUsedMin = Math.min(cotUsedMin, cot); }
      }
      dF[j] = 0.5 * V * cot;
      if (asw > Asw[j]) Asw[j] = asw;
    }
    // shift rule: + ΔFtd/fyd on the tension face, limited to the max along the member
    let maxB = 0, maxT = 0;
    for (let j = 0; j < n; j++) { maxB = Math.max(maxB, aB[j]); maxT = Math.max(maxT, aT[j]); }
    for (let j = 0; j < n; j++) {
      const tensionBottom = f.My[j] >= 0;
      if (tensionBottom) aB[j] = Math.max(aB[j], Math.min(maxB, aB[j] + dF[j] / P.fyd));
      else aT[j] = Math.max(aT[j], Math.min(maxT, aT[j] + dF[j] / P.fyd));
      if (aB[j] > AsBot[j]) AsBot[j] = aB[j];
      if (aT[j] > AsTop[j]) AsTop[j] = aT[j];
    }
  }
  if (!xs) {
    notes.push('no result cases – nothing designed');
    return { line: line.id, x: [], AsBot: [], AsTop: [], Asw: [], ok: true, notes, code, b: bw, h, d };
  }
  // minimum / maximum reinforcement
  if (opts.minReinf !== false) {
    const minB = asMin(P, bw, h, d), minT = asMin(P, bf > 0 ? bf : bw, h, d);
    for (let j = 0; j < xs.length; j++) {
      if (AsBot[j] > AS_EPS && AsBot[j] < minB) AsBot[j] = minB;
      if (AsTop[j] > AS_EPS && AsTop[j] < minT) AsTop[j] = minT;
    }
  }
  let asMaxHit = false;
  for (let j = 0; j < xs.length; j++) {
    if (!Number.isFinite(AsBot[j]) || !Number.isFinite(AsTop[j])) { ok = false; asMaxHit = true; }
    if (AsBot[j] + AsTop[j] > 0.04 * Ac) { ok = false; asMaxHit = true; }
  }
  if (compAt !== null) notes.push(`compression reinforcement required (x/d > ${P.xiLim}, ${P.ref.xi}) e.g. at x=${fmt(compAt, 2)} m`);
  if (failAt !== null) notes.push(`bending design not possible at x=${fmt(failAt, 2)} m (section too small)`);
  if (asMaxHit) notes.push('As > As,max = 0.04·Ac (EN 1992-1-1 9.2.1.1(3)) – section too small');
  if (vmaxFail) notes.push(`${SIA ? 'VRd,c (concrete compression field, kc = 0.55)' : 'VRd,max'} exceeded: VEd=${fmt(vmaxFail.V)} kN > ${fmt(vmaxFail.VR)} kN at x=${fmt(vmaxFail.x, 2)} m (${P.ref.V})`);
  if (MzSig) notes.push('significant Mz – weak-axis bending not designed');
  if (TSig) notes.push('torsion not designed');
  notes.push(SIA
    ? `shear: fixed compression field cot α = ${fmt(Math.min(cotMax, Math.max(1, cotFixed ?? 1)), 2)}, z = 0.9d (${P.ref.V})`
    : `shear: variable strut, cot θ ${Number.isFinite(cotUsedMin) ? `≥ ${fmt(cotUsedMin, 2)}` : `= ${fmt(cotFixed ?? cotMax, 2)}`} (≤ ${fmt(cotMax, 2)}), z = 0.9d (${P.ref.V})`);
  return { line: line.id, x: xs, AsBot, AsTop, Asw, ok, notes, code, b: bw, h, d };
}
