// Shared helpers for the design modules (js/design/*.js).
// Pure ES module – no DOM, no dependencies; runs in browser, Web Worker and Node 18.
// DEVIATIONS FROM SPEC.md: none (internal helpers). staticResults may be the runStatic() output
//   or its `cases` map; when caseKeys is empty, all ULS combinations (or all keys) are used.
//
// Units follow SPEC.md §1 (kN, m, kN/m², kNm). Stresses in detail strings are converted
// to N/mm² (1 N/mm² = 1000 kN/m²) for readability only.
//
// Design-code family: every public design function accepts `opts.code` = 'EC' | 'SIA'
// (default: model.settings.code ?? 'EC'), see SPEC.md §5 and `designCode()` below.

/** Upper bound for reported utilizations (avoids Infinity / NaN in results and JSON). */
export const ETA_CAP = 999;

/** Steel-like material types handled by checkSteelMembers. */
export const STEEL_TYPES = new Set(['steel', 'aluminium']);

/** Line element types that are designed as members (rib = eccentric beam, SPEC §2.1). */
export const MEMBER_TYPES = new Set(['beam', 'rib', 'truss']);

/** Resolve the design-code family from opts / model settings. */
export function designCode(model, opts) {
  const c = (opts && opts.code) ?? model?.settings?.code ?? 'EC';
  return String(c).toUpperCase() === 'SIA' ? 'SIA' : 'EC';
}

/** Finite number or fallback. */
export function num(v, fallback) {
  const x = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(x) ? x : fallback;
}

/** Positive finite number or fallback. */
export function pos(v, fallback) {
  const x = num(v, NaN);
  return x > 0 ? x : fallback;
}

/** Clamp a utilization to [0, ETA_CAP]; NaN → ETA_CAP (treated as failure, never silently 0). */
export function capEta(v) {
  if (Number.isNaN(v)) return ETA_CAP;
  if (!(v > 0)) return 0;
  return v > ETA_CAP ? ETA_CAP : v;
}

/** Format a number for detail strings. */
export function fmt(v, digits = 1) {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '-∞' : '–';
  const s = v.toFixed(digits);
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

/** kN/m² → N/mm² string. */
export function fmtMPa(v, digits = 1) { return fmt(v / 1000, digits); }

/** Build a Map id → object from an entity array (SPEC §2). */
export function toMap(arr) {
  const m = new Map();
  if (Array.isArray(arr)) for (const o of arr) if (o && o.id != null) m.set(Number(o.id), o);
  return m;
}

/** staticResults may be the runStatic() output ({ cases }) or the cases map itself. */
export function getCaseMap(staticResults) {
  if (!staticResults || typeof staticResults !== 'object') return {};
  if (staticResults.cases && typeof staticResults.cases === 'object') return staticResults.cases;
  return staticResults;
}

/** 'LC:<id>' / 'CO:<id>' → { kind, id } or null. */
export function parseCaseKey(key) {
  const m = /^(LC|CO):(.+)$/.exec(String(key));
  if (!m) return null;
  const id = Number(m[2]);
  return { kind: m[1], id: Number.isFinite(id) ? id : m[2] };
}

/**
 * Case keys to design for. If `caseKeys` is empty/undefined: all 'CO:' keys whose model
 * combination type starts with 'ULS' (if any exist), otherwise every key in the results.
 * Keys without a result (or without the needed result part) are dropped with a warning.
 */
export function resolveCaseKeys(model, cases, caseKeys, warnings, need = 'beams') {
  let keys = Array.isArray(caseKeys) && caseKeys.length ? caseKeys.slice() : null;
  if (!keys) {
    const all = Object.keys(cases || {});
    const combos = toMap(model?.combinations);
    const uls = all.filter((k) => {
      const p = parseCaseKey(k);
      if (!p || p.kind !== 'CO') return false;
      const c = combos.get(Number(p.id));
      return !!c && /^ULS/.test(String(c.type || ''));
    });
    keys = uls.length ? uls : all;
  }
  const out = [];
  for (const k of keys) {
    const r = cases ? cases[k] : null;
    if (r && r[need]) out.push(k);
    else if (warnings) warnings.push(`Result case '${k}' not available – ignored.`);
  }
  return out;
}

/** Map lineId → [{ i, t0, t1 }] (mesh beam index, parameter range), ordered by t0. */
export function lineSegments(mesh) {
  const map = new Map();
  const beams = mesh && Array.isArray(mesh.beams) ? mesh.beams : [];
  for (let i = 0; i < beams.length; i++) {
    const b = beams[i];
    if (!b || b.line == null) continue;
    const id = Number(b.line);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push({ i, t0: num(b.t0, 0), t1: num(b.t1, 1) });
  }
  for (const arr of map.values()) arr.sort((a, b) => a.t0 - b.t0);
  return map;
}

const FORCE_KEYS = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'];

/**
 * Internal forces of one model line for one CaseResult: concatenates the stations of all
 * mesh beams of the line (ordered by t0); x = t0·L + station x (m from line start).
 * (Own implementation instead of js/fem lineForces – see task description.)
 */
export function collectLineForces(mesh, caseResult, segs, L, nl = null) {
  const out = { x: [], N: [], Vy: [], Vz: [], T: [], My: [], Mz: [] };
  // tension-/compression-only members (e.g. X-bracing): the excluded sign of N is not checked,
  // because such members drop out in reality (nonlinear analysis) instead of buckling.
  const clampN = nl === 'tension' ? (v) => Math.max(0, v) : nl === 'compression' ? (v) => Math.min(0, v) : (v) => v;
  if (!caseResult || !Array.isArray(caseResult.beams) || !segs) return out;
  for (const s of segs) {
    const r = caseResult.beams[s.i];
    if (!r || !r.x) continue;
    const n = r.x.length;
    for (let k = 0; k < n; k++) {
      out.x.push(s.t0 * L + num(r.x[k], 0));
      for (const q of FORCE_KEYS) out[q].push(r[q] ? num(r[q][k], 0) : 0);
      out.N[out.N.length - 1] = clampN(out.N[out.N.length - 1]);
    }
  }
  return out;
}

/** Length of a model line from its node coordinates. */
export function lineLength(nodes, line) {
  const a = nodes.get(Number(line.n1)), b = nodes.get(Number(line.n2));
  if (!a || !b) return NaN;
  return Math.hypot(num(b.x, 0) - num(a.x, 0), num(b.y, 0) - num(a.y, 0), num(b.z, 0) - num(a.z, 0));
}

/** Everything the member-design loops need, built once per call. */
export function designContext(model, mesh, staticResults, caseKeys, warnings, need = 'beams') {
  const cases = getCaseMap(staticResults);
  const ctx = {
    model: model || {},
    mesh: mesh || {},
    nodes: toMap(model?.nodes),
    materials: toMap(model?.materials),
    sections: toMap(model?.sections),
    loadCases: toMap(model?.loadCases),
    loadGroups: toMap(model?.loadGroups),
    combinations: toMap(model?.combinations),
    domains: toMap(model?.domains),
    cases,
    keys: resolveCaseKeys(model, cases, caseKeys, warnings, need),
    segs: lineSegments(mesh),
    warnings,
  };
  ctx.lineLength = (line) => lineLength(ctx.nodes, line);
  return ctx;
}

/**
 * Load-case factors of a result key: { kind, factors:{lcId:f}, type } (type = combination type).
 * Unknown keys → null.
 */
export function caseFactors(ctx, key) {
  const p = parseCaseKey(key);
  if (!p) return null;
  if (p.kind === 'LC') return { kind: 'LC', factors: { [p.id]: 1 }, type: null };
  const c = ctx.combinations.get(Number(p.id));
  if (!c || !c.factors) return null;
  return { kind: 'CO', factors: c.factors, type: c.type || null };
}

/**
 * Tracker for per-check maxima: { eta, caseKey, x, detail }.
 * `detail` may be a function – it is evaluated only when the entry is updated.
 */
export class CheckSet {
  constructor(names) {
    this.checks = {};
    for (const n of names) this.checks[n] = { eta: 0, caseKey: null, x: 0, detail: '' };
  }
  update(name, eta, caseKey, x, detail) {
    let c = this.checks[name];
    if (!c) c = this.checks[name] = { eta: 0, caseKey: null, x: 0, detail: '' };
    const e = capEta(eta);
    if (c.caseKey === null || e > c.eta) {
      c.eta = e;
      c.caseKey = caseKey;
      c.x = x;
      c.detail = typeof detail === 'function' ? detail() : (detail || '');
    }
  }
  /** Set a detail text for checks that were never evaluated. */
  note(name, text) {
    const c = this.checks[name];
    if (c && c.caseKey === null && !c.detail) c.detail = text;
  }
  governing() {
    let best = null;
    for (const [name, c] of Object.entries(this.checks)) {
      if (c.caseKey === null) continue;
      if (!best || c.eta > best.eta) best = { check: name, caseKey: c.caseKey, x: c.x, eta: c.eta };
    }
    return best;
  }
}

/**
 * Section properties with missing values derived from `dims` where the shape allows it
 * (RECT, CIRC, CHS, I, RHS, BOX; A also for T/L/U). Never modifies the input object.
 * Root radii of I sections are included approximately in A only.
 */
export function fillSectionProps(sec) {
  const p = Object.assign({}, sec || {});
  const d = (sec && sec.dims) || {};
  const set = (k, v) => { if (!(p[k] > 0) && Number.isFinite(v) && v > 0) p[k] = v; };
  const shape = p.shape;
  if (shape === 'RECT' && d.h > 0 && d.b > 0) {
    const { h, b } = d;
    set('A', b * h); set('Iy', b * h ** 3 / 12); set('Iz', h * b ** 3 / 12);
    set('Wely', b * h * h / 6); set('Welz', h * b * b / 6);
    set('Wply', b * h * h / 4); set('Wplz', h * b * b / 4);
    const a = Math.max(h, b), c = Math.min(h, b);
    set('It', a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4))));
  } else if (shape === 'CIRC' && d.d > 0) {
    const D = d.d;
    set('A', Math.PI * D * D / 4); set('Iy', Math.PI * D ** 4 / 64); set('Iz', Math.PI * D ** 4 / 64);
    set('Wely', Math.PI * D ** 3 / 32); set('Welz', Math.PI * D ** 3 / 32);
    set('Wply', D ** 3 / 6); set('Wplz', D ** 3 / 6); set('It', Math.PI * D ** 4 / 32);
  } else if (shape === 'CHS' && d.d > 0 && d.t > 0) {
    const D = d.d, Di = d.d - 2 * d.t;
    const I = Math.PI * (D ** 4 - Di ** 4) / 64;
    set('A', Math.PI * (D * D - Di * Di) / 4); set('Iy', I); set('Iz', I);
    set('Wely', I / (D / 2)); set('Welz', I / (D / 2));
    set('Wply', (D ** 3 - Di ** 3) / 6); set('Wplz', (D ** 3 - Di ** 3) / 6); set('It', 2 * I);
  } else if (shape === 'I' && d.h > 0 && d.b > 0 && d.tw > 0 && d.tf > 0) {
    const { h, b, tw, tf } = d, r = num(d.r, 0), hw = h - 2 * tf;
    set('A', 2 * b * tf + hw * tw + (4 - Math.PI) * r * r);
    set('Iy', (b * h ** 3 - (b - tw) * hw ** 3) / 12);
    set('Iz', (2 * tf * b ** 3 + hw * tw ** 3) / 12);
    set('Wely', p.Iy / (h / 2)); set('Welz', p.Iz / (b / 2));
    set('Wply', b * tf * (h - tf) + tw * hw * hw / 4);
    set('Wplz', tf * b * b / 2 + hw * tw * tw / 4);
    set('It', (2 * b * tf ** 3 + (h - tf) * tw ** 3) / 3);
    set('Iw', tf * b ** 3 * (h - tf) ** 2 / 24);
  } else if ((shape === 'RHS' || shape === 'BOX') && d.h > 0 && d.b > 0 && (d.t > 0 || (d.tw > 0 && d.tf > 0))) {
    const { h, b } = d;
    const tw = shape === 'RHS' ? d.t : d.tw, tf = shape === 'RHS' ? d.t : d.tf;
    const bi = b - 2 * tw, hi = h - 2 * tf;
    set('A', b * h - bi * hi);
    set('Iy', (b * h ** 3 - bi * hi ** 3) / 12); set('Iz', (h * b ** 3 - hi * bi ** 3) / 12);
    set('Wely', p.Iy / (h / 2)); set('Welz', p.Iz / (b / 2));
    set('Wply', (b * h * h - bi * hi * hi) / 4); set('Wplz', (h * b * b - hi * bi * bi) / 4);
    const Am = (b - tw) * (h - tf);
    set('It', 4 * Am * Am / (2 * (b - tw) / tf + 2 * (h - tf) / tw));
  } else if (shape === 'T' && d.h > 0 && d.b > 0 && d.tw > 0 && d.tf > 0) {
    set('A', d.b * d.tf + (d.h - d.tf) * d.tw);
  } else if (shape === 'U' && d.h > 0 && d.b > 0 && d.tw > 0 && d.tf > 0) {
    set('A', 2 * d.b * d.tf + (d.h - 2 * d.tf) * d.tw);
  } else if (shape === 'L' && d.h > 0 && d.b > 0 && d.t > 0) {
    set('A', (d.h + d.b - d.t) * d.t);
  }
  if (p.A > 0) {
    if (p.Iy > 0) set('iy', Math.sqrt(p.Iy / p.A));
    if (p.Iz > 0) set('iz', Math.sqrt(p.Iz / p.A));
  }
  if (!(p.Iw >= 0)) p.Iw = 0;
  return p;
}

/**
 * End-moment / span-moment description of a moment diagram along a member:
 * { linear, Mh, Ms, psi, alpha, Mmax } (used for Cm (EC3 Annex B Table B.3) and ω (SIA 263)).
 * - linear: the diagram deviates < 2 % of |M|max from the straight line between the end values
 * - Mh: end moment with the larger magnitude, psi = other end / Mh
 * - Ms: moment at the interior station of largest deviation from that straight line
 */
export function momentDiagram(x, M) {
  const n = Math.min(x.length, M.length);
  const res = { linear: true, Mh: 0, Ms: 0, psi: 1, Mmax: 0, zero: true };
  if (n < 2) return res;
  let Mmax = 0;
  for (let i = 0; i < n; i++) Mmax = Math.max(Mmax, Math.abs(M[i]));
  res.Mmax = Mmax;
  if (!(Mmax > 1e-9)) return res;
  res.zero = false;
  const x0 = x[0], L = x[n - 1] - x[0];
  const M1 = M[0], M2 = M[n - 1];
  let dev = 0, kDev = -1;
  for (let i = 1; i < n - 1; i++) {
    const lin = L > 0 ? M1 + (M2 - M1) * (x[i] - x0) / L : M1;
    const d = Math.abs(M[i] - lin);
    if (d > dev) { dev = d; kDev = i; }
  }
  const Mh = Math.abs(M1) >= Math.abs(M2) ? M1 : M2;
  const Mo = Math.abs(M1) >= Math.abs(M2) ? M2 : M1;
  res.Mh = Mh;
  res.psi = Math.abs(Mh) > 1e-12 ? Mo / Mh : 1;
  res.linear = dev <= 0.02 * Mmax || kDev < 0;
  res.Ms = kDev >= 0 ? M[kDev] : 0;
  return res;
}
