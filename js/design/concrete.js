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
import { tBeamSetup, tBeamForces } from './tbeam.js';
import { isColumn } from './column.js';

export const FLAG_COMPRESSION_REINF = 1;
export const FLAG_AS_MAX = 2;
export const FLAG_SHEAR = 4;
export const FLAG_FAIL = 8;
export const FLAG_MIN = 16; // minimum reinforcement governs at least one layer

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

/**
 * Layer layout of a slab/shell domain (domain.rc) for thickness t: the x bars form the outer layer
 * and the y bars the inner layer on both faces. Legacy fields cover/dia apply to both faces/directions.
 * @returns { coverB, coverT, diaX, diaY, fyk, t, d:{ xb, yb, xt, yt } } (effective depths, m)
 */
export function surfaceLayout(rc, t) {
  rc = rc || {};
  const coverB = pos(rc.coverB, pos(rc.cover, 0.03)), coverT = pos(rc.coverT, pos(rc.cover, 0.03));
  const diaX = pos(rc.diaX, pos(rc.dia, 0.012)), diaY = pos(rc.diaY, pos(rc.dia, 0.012));
  const fyk = pos(rc.fyk, 500000);
  return {
    coverB, coverT, diaX, diaY, fyk, t,
    d: { xb: t - coverB - diaX / 2, yb: t - coverB - diaX - diaY / 2, xt: t - coverT - diaX / 2, yt: t - coverT - diaX - diaY / 2 },
  };
}

/** Provided reinforcement of a domain (domain.rcProv = { xb:{dia, s}, yb, xt, yt }) → [xb, yb, xt, yt] m²/m. */
export function providedAreas(prov) {
  return ['xb', 'yb', 'xt', 'yt'].map((k) => {
    const l = prov && prov[k];
    return l && l.dia > 0 && l.s > 0 ? Math.PI * l.dia * l.dia / 4 / l.s : 0;
  });
}

/**
 * Required reinforcement for one set of surface forces f = [nx, ny, nxy, mx, my, mxy, vx, vy]
 * (no minimum reinforcement). Returns the Wood–Armer moments, membrane design forces and
 * as = [axb, ayb, axt, ayt] in m²/m.
 */
export function designSurfacePoint(f, L, P, type) {
  const t = L.t;
  const base = { b: 1, h: t, fcd: P.fcd, fyd: P.fyd, lam: P.lam, eta: P.eta, xiLim: P.xiLim, ecu: P.ecu };
  const wa = woodArmer(f[3], f[4], f[5]);
  const nd = type === 'plate' ? { Nx: 0, Ny: 0 } : membraneDesignForces(f[0], f[1], f[2]);
  const xb = designMN(wa.mxb, nd.Nx, { ...base, d: L.d.xb, d2: t - L.d.xt });
  const xt = designMN(-wa.mxt, nd.Nx, { ...base, d: L.d.xt, d2: t - L.d.xb });
  const yb = designMN(wa.myb, nd.Ny, { ...base, d: L.d.yb, d2: t - L.d.yt });
  const yt = designMN(-wa.myt, nd.Ny, { ...base, d: L.d.yt, d2: t - L.d.yb });
  const all = [xb, xt, yb, yt];
  return {
    wa, nd,
    as: [Math.max(xb.As1, xt.As2), Math.max(yb.As1, yt.As2), Math.max(xt.As1, xb.As2), Math.max(yt.As1, yb.As2)],
    comp: all.some((r) => r.comp), fail: all.some((r) => r.fail),
  };
}

/** Minimum reinforcement per layer [xb, yb, xt, yt] (m²/m). */
function surfaceMin(P, L) {
  return [L.d.xb, L.d.yb, L.d.xt, L.d.yt].map((d) => asMin(P, 1, L.t, d));
}

/** Slab shear (no shear reinforcement): vRd,c with ρl from the larger of required and provided areas. */
function surfaceShear(P, L, as, prov) {
  const dm = (L.d.xb + L.d.yb + L.d.xt + L.d.yt) / 4;
  const a = as.map((v, j) => Math.max(v, prov ? prov[j] : 0));
  const rhoL = (Math.max(a[0], a[2]) + Math.max(a[1], a[3])) / 2 / dm;
  return { vRd: shearResistanceNoStirrups(P, 1, dm, rhoL), dm, rhoL };
}

/** Prepared design data of one domain, or { skip: reason } (English, for warnings). */
function domainSetup(ctx, dom, s0, code, opts) {
  const mat = ctx.materials.get(Number(s0.material ?? dom.material));
  if (!mat || mat.type !== 'concrete') return null;
  const type = s0.type || dom.type;
  if (type && !['plate', 'shell', 'membrane'].includes(type)) return null;
  const t = pos(s0.thickness, pos(dom.thickness, NaN));
  const L = surfaceLayout(dom.rc, t);
  const P = concreteParams(mat, L.fyk, code, opts);
  if (!P) return { skip: 'concrete material without fck – RC design skipped' };
  if (!(t > 0)) return { skip: 'no thickness – RC design skipped' };
  if (!(Math.min(L.d.yb, L.d.yt) > 0.2 * t)) return { skip: `thickness ${fmt(t, 3)} m too small for cover/dia – skipped` };
  return { mat, type, t, L, P, prov: dom.rcProv ? providedAreas(dom.rcProv) : null };
}

export function designRCSurfaces(model, mesh, staticResults, caseKeys, opts = {}) {
  opts = opts || {};
  const code = designCode(model, opts);
  const warnings = [];
  const shells = mesh && Array.isArray(mesh.shells) ? mesh.shells : [];
  const nS = shells.length;
  const asCorner = new Float64Array(nS * 16);
  const flags = new Uint8Array(nS * 4);
  const gov = new Int16Array(nS * 16).fill(-1); // governing case index (into `keys`) per corner and layer
  const vRatio = new Float32Array(nS * 4);     // vEd / vRd,c per corner (0 = not checked, −1 = punching zone)
  const domains = [];
  const result = { asCorner, warnings, code, flags, gov, vRatio, keys: [], domains };
  try {
    const ctx = designContext(model, mesh, staticResults, caseKeys, warnings, 'shells');
    result.keys = ctx.keys;
    const useMin = opts.minReinf !== false;
    // Slab shear is not checked where other checks govern:
    //  opts.shearExclude = [{ p:[x,y,z], r }]  zones around columns (punching check),
    //  opts.shearExcludeSegs = [{ a, b, hb }]  beams/ribs (T-beam shear): within hb + d of the axis.
    const zones = Array.isArray(opts.shearExclude) ? opts.shearExclude : [];
    const segsX = Array.isArray(opts.shearExcludeSegs) ? opts.shearExcludeSegs : [];
    const X = mesh && mesh.nodes;
    const excluded = (e, c, d) => {
      if ((!zones.length && !segsX.length) || !X) return false;
      const nd = shells[e].nodes[c];
      const p = [X[3 * nd], X[3 * nd + 1], X[3 * nd + 2]];
      if (zones.some((z) => (p[0] - z.p[0]) ** 2 + (p[1] - z.p[1]) ** 2 + (p[2] - z.p[2]) ** 2 <= z.r * z.r)) return true;
      return segsX.some((sg) => {
        const v = [sg.b[0] - sg.a[0], sg.b[1] - sg.a[1], sg.b[2] - sg.a[2]], w = [p[0] - sg.a[0], p[1] - sg.a[1], p[2] - sg.a[2]];
        const ll = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
        const u = ll > 0 ? Math.max(0, Math.min(1, (w[0] * v[0] + w[1] * v[1] + w[2] * v[2]) / ll)) : 0;
        const r = sg.hb + d;
        return (w[0] - u * v[0]) ** 2 + (w[1] - u * v[1]) ** 2 + (w[2] - u * v[2]) ** 2 <= r * r;
      });
    };
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
      const D = domainSetup(ctx, dom, shells[elems[0]], code, opts);
      if (!D) continue;
      if (D.skip) { warnings.push(`Domain ${domId}: ${D.skip}`); continue; }
      const { type, t, L, P, prov } = D;
      const asMinL = surfaceMin(P, L);
      const sum = {
        id: domId, type, t, material: D.mat.id, fck: P.fck, fcd: P.fcd, fyd: P.fyd, layout: L, asMin: asMinL,
        max: [0, 0, 0, 0], maxAt: [-1, -1, -1, -1], maxCase: [-1, -1, -1, -1], minGoverns: [false, false, false, false],
        nCorners: elems.length * 4, nComp: 0, nMax: 0, nFail: 0, nShear: 0, vMax: 0, vMaxAt: -1, prov,
      };
      for (const e of elems) {
        for (let c = 0; c < 4; c++) {
          const o = (e * 4 + c) * 4, i0 = (e * 4 + c) * 8;
          let vEdMax = 0, flag = 0;
          ctx.keys.forEach((key, ki) => {
            const sv = ctx.cases[key].shells;
            if (!sv || sv.length < i0 + 8) return;
            const f = sv.subarray ? sv.subarray(i0, i0 + 8) : sv.slice(i0, i0 + 8);
            vEdMax = Math.max(vEdMax, Math.hypot(f[6], f[7]));
            const r = designSurfacePoint(f, L, P, type);
            if (r.comp) flag |= FLAG_COMPRESSION_REINF;
            if (r.fail) flag |= FLAG_FAIL;
            for (let j = 0; j < 4; j++) if (r.as[j] > asCorner[o + j]) { asCorner[o + j] = r.as[j]; gov[o + j] = ki; }
          });
          // minimum reinforcement (layers in tension only)
          for (let j = 0; j < 4; j++) {
            if (useMin && asCorner[o + j] > AS_EPS && asCorner[o + j] < asMinL[j]) { asCorner[o + j] = asMinL[j]; flag |= FLAG_MIN; if (!sum.minGoverns[j]) sum.minGoverns[j] = true; }
            if (!Number.isFinite(asCorner[o + j])) { asCorner[o + j] = 0.04 * t; flag |= FLAG_FAIL; }
            if (asCorner[o + j] > 0.04 * t) flag |= FLAG_AS_MAX;
            if (asCorner[o + j] > sum.max[j]) { sum.max[j] = asCorner[o + j]; sum.maxAt[j] = e * 4 + c; sum.maxCase[j] = gov[o + j]; }
          }
          // slab shear without shear reinforcement (check only); punching zones are checked separately
          if (excluded(e, c, (L.d.xb + L.d.yb) / 2)) vRatio[e * 4 + c] = -1;
          else if (type !== 'membrane' && vEdMax > 0) {
            const { vRd } = surfaceShear(P, L, asCorner.subarray(o, o + 4), prov);
            const ratio = vEdMax / vRd;
            vRatio[e * 4 + c] = ratio;
            if (ratio > sum.vMax) { sum.vMax = ratio; sum.vMaxAt = e * 4 + c; }
            if (ratio > 1) { flag |= FLAG_SHEAR; sum.nShear++; }
          }
          flags[e * 4 + c] = flag;
          if (flag & FLAG_COMPRESSION_REINF) sum.nComp++;
          if (flag & FLAG_AS_MAX) sum.nMax++;
          if (flag & FLAG_FAIL) sum.nFail++;
        }
      }
      domains.push(sum);
      if (sum.nComp) warnings.push(`Domain ${domId}: compression reinforcement required (x/d > ${P.xiLim}, ${P.ref.xi}) at ${sum.nComp} corner(s)`);
      if (sum.nMax) warnings.push(`Domain ${domId}: As > As,max = 0.04·Ac at ${sum.nMax} corner(s)`);
      if (sum.nFail) warnings.push(`Domain ${domId}: design not possible (section too small / missing data) at ${sum.nFail} corner(s)`);
      if (sum.nShear) warnings.push(`Domain ${domId}: vEd > vRd,c at ${sum.nShear} corner(s) (max ratio ${fmt(sum.vMax, 2)}, ${P.ref.V}) – shear reinforcement required, not designed`);
    }
  } catch (e) {
    warnings.push(`RC surface design aborted: ${e && e.message}`);
  }
  return result;
}

/**
 * Full design trace at one shell corner (element e, corner c) – used for the result probe and the
 * design report: forces, Wood–Armer moments and required reinforcement per case, minimum
 * reinforcement and the slab shear check. Returns null when the element is not designed.
 */
export function rcSurfaceDetail(model, mesh, staticResults, caseKeys, e, c, opts = {}) {
  const code = designCode(model, opts);
  const sh = mesh?.shells?.[e];
  if (!sh) return null;
  const ctx = designContext(model, mesh, staticResults, caseKeys, [], 'shells');
  const dom = ctx.domains.get(Number(sh.domain)) || {};
  const D = domainSetup(ctx, dom, sh, code, opts);
  if (!D || D.skip) return null;
  const { type, L, P, prov } = D;
  const i0 = (e * 4 + c) * 8;
  const cases = [];
  const as = [0, 0, 0, 0], gov = [null, null, null, null];
  let vEd = 0, vCase = null;
  for (const key of ctx.keys) {
    const sv = ctx.cases[key].shells;
    if (!sv || sv.length < i0 + 8) continue;
    const f = Array.from(sv.slice ? sv.slice(i0, i0 + 8) : sv.subarray(i0, i0 + 8));
    const r = designSurfacePoint(f, L, P, type);
    cases.push({ key, f, ...r });
    for (let j = 0; j < 4; j++) if (r.as[j] > as[j]) { as[j] = r.as[j]; gov[j] = key; }
    const v = Math.hypot(f[6], f[7]);
    if (v > vEd) { vEd = v; vCase = key; }
  }
  const min = surfaceMin(P, L);
  const final = as.map((a, j) => (opts.minReinf !== false && a > AS_EPS && a < min[j] ? min[j] : a));
  const shear = type !== 'membrane' && vEd > 0 ? surfaceShear(P, L, final, prov) : null;
  return {
    domain: dom.id, type, code, layout: L, P, cases, required: as, as: final, min, gov, prov,
    minGoverns: final.map((a, j) => a > as[j]),
    shear: shear ? { vEd, vRd: shear.vRd, ratio: vEd / shear.vRd, caseKey: vCase, d: shear.dm, rhoL: shear.rhoL } : null,
  };
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
      if (isColumn(model, line)) continue; // columns: column.js (N-M interaction, second order)
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
  const rcIn = Object.assign({}, sec.rc || {}, (el.design && el.design.rc) || {}, opts.rc || {});
  const rc = rcDefaults(rcIn, { cover: 0.03, dia: 0.020, diaStirrup: 0.010, fyk: 500000, fywk: 0 });
  if (!(rc.fywk > 0)) rc.fywk = rc.fyk;
  const P = concreteParams(mat, rc.fyk, code, opts);
  if (!P) return W('concrete material without fck');
  const L = ctx.lineLength(line);
  if (!(L > 0)) return W('zero length');
  const segs = ctx.segs.get(Number(line.id));
  if (!segs || !segs.length) return W('no mesh beams');
  let bw, bf = 0, hf = 0, h, shape = sec.shape, tb = null;
  if (sec.shape === 'RECT' && dims.h > 0 && dims.b > 0) {
    h = dims.h; bw = dims.b;
    // Plattenbalken: rib/beam in the plane of a concrete slab → T-section with effective flange
    if (rcIn.tBeam !== false && (el.type === 'rib' || el.type === 'beam')) {
      tb = tBeamSetup(ctx, line, segs, bw, L, { l0: rcIn.l0, l0Factor: rcIn.l0Factor });
      if (tb && h > tb.hf + 1e-3) { bf = tb.beff; hf = tb.hf; shape = 'T'; }
      else if (tb) { bw = tb.beff; h = Math.max(h, tb.hf); }
    }
  } else if (sec.shape === 'T' && dims.h > 0 && dims.b > 0 && dims.tw > 0 && dims.tf > 0) { h = dims.h; bw = dims.tw; bf = dims.b; hf = dims.tf; }
  else return W(`section shape ${sec.shape} not supported (RECT/T only)`);
  const d = h - rc.cover - rc.diaStirrup - rc.dia / 2;
  const d2 = rc.cover + rc.diaStirrup + rc.dia / 2;
  if (!(d > 0.5 * h)) return W('cover/bar diameters too large for the section height');
  const eccZ = ctx.mesh.beams?.[segs[0].i]?.ecc || 0; // eccentric member (mesher offset along local z)
  const z = 0.9 * d;
  const fywd = rc.fywk / pos(opts.gammaS, 1.15);
  const Ac = bf > 0 ? bf * hf + bw * (h - hf) : bw * h;
  const notes = [];
  const base = { h, d, d2, fcd: P.fcd, fyd: P.fyd, lam: P.lam, eta: P.eta, xiLim: P.xiLim, ecu: P.ecu };

  // shear model parameters
  const SIA = code === 'SIA';
  const cotFixed = Number.isFinite(opts.cotTheta) ? opts.cotTheta : (SIA ? 1.0 : null);
  const cotMax = SIA ? 2.14 : pos(opts.cotThetaMax, 2.5);
  const nu1 = 0.6 * (1 - P.fckM / 250);
  const rhoWmin = SIA ? 0.001 * Math.sqrt(P.fckM / 30) * 500 / (rc.fywk / 1000) : 0.08 * Math.sqrt(P.fckM) / (rc.fywk / 1000);
  const AswMin = rhoWmin * bw;

  let xs = null, AsBot = null, AsTop = null, Asw = null, env = null;
  let ok = true, compAt = null, vmaxFail = null, failAt = null, MzSig = false, TSig = false, MyAbsMax = 0;
  let cotUsedMin = Infinity;
  for (const key of ctx.keys) {
    const f = collectLineForces(ctx.mesh, ctx.cases[key], segs, L);
    const n = f.x.length;
    if (!n) continue;
    if (!xs) {
      xs = f.x.slice();
      AsBot = new Array(n).fill(0); AsTop = new Array(n).fill(0); Asw = new Array(n).fill(0);
      env = { MyMax: new Array(n).fill(-Infinity), MyMin: new Array(n).fill(Infinity), MyRibMax: new Array(n).fill(-Infinity), MyRibMin: new Array(n).fill(Infinity), V: new Array(n).fill(0) };
    }
    if (n !== xs.length) { notes.push(`case ${key}: station count mismatch – ignored`); continue; }
    // Plattenbalken: add the slab share within the effective width
    const slab = tb ? tBeamForces(tb, ctx, ctx.cases[key], f.x) : null;
    const aB = new Array(n), aT = new Array(n), dF = new Array(n);
    for (let j = 0; j < n; j++) {
      // T-section moment about its mid-height: eccentric rib (axis at ecc below the slab mid-plane) and slab
      // normal force act with lever arms; concentric ribs keep the slab mid-plane as reference.
      const lever = slab && hf > 0 && eccZ ? -(f.N[j] * (h / 2 - hf / 2 + eccZ) + slab.N[j] * (h / 2 - hf / 2)) : 0;
      const My = f.My[j] + (slab ? slab.M[j] : 0) + lever, N = f.N[j] + (slab ? slab.N[j] : 0);
      const V = Math.abs(f.Vz[j]) + (slab ? Math.abs(slab.V[j]) : 0);
      env.MyMax[j] = Math.max(env.MyMax[j], My); env.MyMin[j] = Math.min(env.MyMin[j], My);
      env.MyRibMax[j] = Math.max(env.MyRibMax[j], f.My[j]); env.MyRibMin[j] = Math.min(env.MyRibMin[j], f.My[j]);
      env.V[j] = Math.max(env.V[j], V);
      f.My[j] = My;
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
  if (eccZ) notes.push(`eccentric member: axis ${fmt(eccZ, 3)} m from the line (local z)`);
  if (tb) notes.push(`T-beam: beff = ${fmt(tb.beff, 2)} m (${tb.sides.map((sd) => fmt(sd.beffI, 2)).join(' + ')} + bw), hf = ${fmt(tb.hf, 3)} m, l0 = ${fmt(tb.l0, 2)} m – slab forces within beff added (EN 1992-1-1 5.3.2.1)`);
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
  return {
    line: line.id, x: xs, AsBot, AsTop, Asw, ok, notes, code, b: bw, h, d,
    section: { shape, bw, bf, hf, h, d, d2, cover: rc.cover, dia: rc.dia, diaStirrup: rc.diaStirrup, fyk: rc.fyk },
    tBeam: tb ? { beff: tb.beff, hf: tb.hf, l0: tb.l0, sides: tb.sides.map((sd) => ({ domain: sd.domain, b: sd.b, beffI: sd.beffI })) } : null,
    env, z, P: { fcd: P.fcd, fyd: P.fyd, fck: P.fck, ref: P.ref }, AswMin, asMin: opts.minReinf !== false ? { bot: asMin(P, bw, h, d), top: asMin(P, bf > 0 ? bf : bw, h, d) } : null,
  };
}
