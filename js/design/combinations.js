// Load-combination generator – EN 1990 (Eurocode, default) and SIA 260 (Swiss, opts.code = 'SIA').
// Pure ES module (no DOM), see SPEC.md §2.6 / §5.
// DEVIATIONS FROM SPEC.md (§2.6/§5): (1) combination objects carry the extra informative fields
//   `eq` (equation/clause) and `code`; (2) seismic combinations use type 'ULS-ACC' (SPEC has no
//   seismic type) and are named "SEIS n: …"; (3) extra options accidental, xi, maxCombos,
//   accidentalPsi, useGroupFactors; (4) optional group field `duration` (used by timber.js).
//
// generateCombinations(model, { code, uls:'6.10'|'6.10ab'|false, sls:true, accidental:true, xi:0.85,
//                               maxCombos:2000, accidentalPsi:'psi1'|'psi2', useGroupFactors:true })
//   → [{ name, type:'ULS'|'ULS-ACC'|'SLS-CHAR'|'SLS-FREQ'|'SLS-QP', factors:{[lcId]:factor}, eq, code }]
//   (without ids – the caller assigns them; `eq` and `code` are informative extra fields)
//
// ───────────────────────────── strategy (documented as required) ─────────────────────────────
// Actions. Every load group with ≥1 load case is one *action*. Load cases without (or with an
//   unknown) group form one virtual permanent group "G" (label = case name if it is the only one).
//   Unknown group types are treated as 'variable'.
// Options of an action. exclusive group → each of its load cases is an alternative (never two at
//   once); non-exclusive group → all of its cases act together with the same factor (one option).
// Permanent actions (EN 1990 Table A1.2(B) note 3 / SIA 260 Tab. 1 "single source" principle):
//   every permanent group is either unfavourable (γG,sup) or favourable (γG,inf) as a whole.
//   ≤ 3 permanent groups: all 2^n sup/inf variants are generated; > 3 groups: only "all sup" and
//   "all inf" (avoids combinatorial explosion). If γsup = γinf only one variant is generated.
//   Permanent actions are always present (factor 1.0 in SLS / accidental / seismic combinations).
// Variable actions (variable | snow | wind): each action takes the leading role in turn (with each
//   of its options); every other variable action is either absent (favourable, γQ,inf = 0) or
//   accompanying with each of its options. If that enumeration exceeds `maxCombos` (default 2000)
//   the accompanying actions are always present (no "absent" state) and the list is truncated.
// EC ULS (STR/GEO, set B):
//   6.10   : Σ γG,j Gk,j + γQ,1 Qk,1 + Σ γQ,i ψ0,i Qk,i
//   6.10ab : 6.10a  Σ γG,j Gk,j + Σ γQ,i ψ0,i Qk,i            (no leading action)
//            6.10b  Σ ξ γG,j,sup Gk,j + γQ,1 Qk,1 + Σ γQ,i ψ0,i Qk,i   (ξ = 0.85; γG,inf without ξ)
// SIA ULS (SIA 260:2013 4.4.3.4, type 2): Ed = E{γG Gk, γQ1 Qk1, ψ0i Qki}
//            – accompanying actions with ψ0 only (no γQ), γG,sup = 1.35, γG,inf = 0.80, γQ = 1.5.
// Accidental (EC 6.11b): Gk + Ad + ψ1,1 Qk,1 + Σ ψ2,i Qk,i (main accompanying action in turn;
//   opts.accidentalPsi = 'psi2' uses ψ2 for all). SIA 260 4.4.3.5: Gk + Ad + Σ ψ2i Qki.
//   Each accidental action (option) acts alone – accidental actions never act simultaneously.
// Seismic (EC 6.12b / SIA 260 4.4.3.5): Gk + AEd + Σ ψ2,i Qk,i, type 'ULS-ACC' (SPEC has no separate
//   seismic type; names start with "SEIS"). AEd is taken with ±1.0. A non-exclusive seismic group
//   with several cases (e.g. Ex, Ey) is combined by the 100 % / 30 % rule (EN 1998-1 4.3.3.5.2(2) /
//   SIA 261 16.2.4): each case leading with ±1.0, the others with ±0.3 (all sign variants for ≤ 3
//   cases, otherwise +0.3 only).
// SLS (EC 6.14b/6.15b/6.16b, SIA 260 4.4.4 rare/frequent/quasi-permanent):
//   characteristic (SIA: rare) Gk + Qk,1 + Σ ψ0,i Qk,i ; frequent Gk + ψ1,1 Qk,1 + Σ ψ2,i Qk,i ;
//   quasi-permanent Gk + Σ ψ2,i Qk,i.
// Deduplication: identical factor sets of the same combination type are generated only once
//   (terms with factor 0, e.g. ψ2 = 0, are dropped before comparison). Numbering per name prefix.
// γ/ψ values: explicit numeric fields of a load group (gammaSup, gammaInf, psi0, psi1, psi2) win
//   (the UI shows/edits them); missing ones come from DEFAULT_GROUP_PARAMS (EC) or SIA_GROUP_PARAMS
//   (SIA) by group type. opts.useGroupFactors = false uses the code tables only (e.g. after a code
//   switch, when the groups still carry the presets of the other code – SIA γG,inf = 0.80 vs EC 1.0).
//   The γQ,inf of variable groups is always 0 (absence), group.gammaInf is ignored for them.
// Roof imposed loads (category H) vs. snow/wind exclusivity (EN 1990 A1.2.1(3)) is not automated –
//   model it with ψ = 0 or separate exclusive groups.

import { designCode } from './common.js';

/** EN 1990 Annex A1 (buildings) – typical γ/ψ per group type. `duration` is used by timber (EC5 kmod). */
export const DEFAULT_GROUP_PARAMS = Object.freeze({
  permanent: Object.freeze({ gammaSup: 1.35, gammaInf: 1.0, psi0: 1.0, psi1: 1.0, psi2: 1.0, exclusive: false, duration: 'permanent' }),
  // imposed loads category A (domestic/residential), EN 1990 Table A1.1
  variable: Object.freeze({ gammaSup: 1.5, gammaInf: 0, psi0: 0.7, psi1: 0.5, psi2: 0.3, exclusive: false, duration: 'medium' }),
  // snow, sites at altitude H ≤ 1000 m a.s.l. (except Finland, Iceland, Norway, Sweden)
  snow: Object.freeze({ gammaSup: 1.5, gammaInf: 0, psi0: 0.5, psi1: 0.2, psi2: 0.0, exclusive: false, duration: 'short' }),
  wind: Object.freeze({ gammaSup: 1.5, gammaInf: 0, psi0: 0.6, psi1: 0.2, psi2: 0.0, exclusive: true, duration: 'short' }),
  accidental: Object.freeze({ gammaSup: 1.0, gammaInf: 1.0, psi0: 1.0, psi1: 1.0, psi2: 1.0, exclusive: true, duration: 'instantaneous' }),
  seismic: Object.freeze({ gammaSup: 1.0, gammaInf: 1.0, psi0: 1.0, psi1: 1.0, psi2: 1.0, exclusive: false, duration: 'instantaneous' }),
});

/**
 * SIA 260:2013 – γ (Tab. 1, type 2 STR) and ψ (Tab. 3) per group type.
 * NOTE: the ψ values are those specified for this project (Nutzlasten Kat. A 0.7/0.5/0.3,
 * Schnee ≤ 1000 m 0.6/0.5/0, Wind 0.6/0.5/0, Temperatur 0.6/0.5/0); the primary SIA 260 text was not
 * accessible while implementing – verify against SIA 260:2013 Tab. 3 before production use.
 */
export const SIA_GROUP_PARAMS = Object.freeze({
  permanent: Object.freeze({ gammaSup: 1.35, gammaInf: 0.80, psi0: 1.0, psi1: 1.0, psi2: 1.0, exclusive: false, duration: 'permanent' }),
  variable: Object.freeze({ gammaSup: 1.5, gammaInf: 0, psi0: 0.7, psi1: 0.5, psi2: 0.3, exclusive: false, duration: 'medium' }),
  snow: Object.freeze({ gammaSup: 1.5, gammaInf: 0, psi0: 0.6, psi1: 0.5, psi2: 0.0, exclusive: false, duration: 'short' }),
  wind: Object.freeze({ gammaSup: 1.5, gammaInf: 0, psi0: 0.6, psi1: 0.5, psi2: 0.0, exclusive: true, duration: 'short' }),
  accidental: Object.freeze({ gammaSup: 1.0, gammaInf: 1.0, psi0: 1.0, psi1: 1.0, psi2: 1.0, exclusive: true, duration: 'instantaneous' }),
  seismic: Object.freeze({ gammaSup: 1.0, gammaInf: 1.0, psi0: 1.0, psi1: 1.0, psi2: 1.0, exclusive: false, duration: 'instantaneous' }),
});

/** EN 1990 Table A1.1 ψ values (for UI pick lists). */
export const EC_PSI_CATEGORIES = Object.freeze({
  A: [0.7, 0.5, 0.3], B: [0.7, 0.5, 0.3], C: [0.7, 0.7, 0.6], D: [0.7, 0.7, 0.6], E: [1.0, 0.9, 0.8],
  F: [0.7, 0.7, 0.6], G: [0.7, 0.5, 0.3], H: [0, 0, 0],
  'snow-nordic': [0.7, 0.5, 0.2], 'snow>1000m': [0.7, 0.5, 0.2], 'snow<=1000m': [0.5, 0.2, 0],
  wind: [0.6, 0.2, 0], temperature: [0.6, 0.5, 0],
});

/** SIA 260 Tab. 3 ψ values as used here (imposed-load categories per SIA 261 – verify, see above). */
export const SIA_PSI_CATEGORIES = Object.freeze({
  A: [0.7, 0.5, 0.3], B: [0.7, 0.5, 0.3], C: [0.7, 0.7, 0.6], D: [0.7, 0.7, 0.6], E: [1.0, 0.9, 0.8],
  F: [0.7, 0.7, 0.6], G: [0.7, 0.5, 0.3], H: [0, 0, 0],
  'snow<=1000m': [0.6, 0.5, 0], wind: [0.6, 0.5, 0], temperature: [0.6, 0.5, 0],
});

const VARIABLE_TYPES = new Set(['variable', 'snow', 'wind']);

/**
 * Effective γ/ψ parameters of a load group for the given code ('EC' | 'SIA').
 * useGroupFactors = false ignores the numeric γ/ψ fields of the group (code table only).
 */
export function groupParams(group, code = 'EC', useGroupFactors = true) {
  const table = code === 'SIA' ? SIA_GROUP_PARAMS : DEFAULT_GROUP_PARAMS;
  const type = group && table[group.type] ? group.type : 'variable';
  const p = Object.assign({}, table[type]);
  if (group) {
    if (useGroupFactors) {
      for (const k of ['gammaSup', 'gammaInf', 'psi0', 'psi1', 'psi2']) {
        if (Number.isFinite(group[k])) p[k] = group[k];
      }
    }
    if (typeof group.exclusive === 'boolean') p.exclusive = group.exclusive;
    if (typeof group.duration === 'string') p.duration = group.duration;
  }
  p.type = type;
  return p;
}

// ─────────────────────────────────────────── helpers ───────────────────────────────────────────

function* product(lists, cap = Infinity) {
  const n = lists.length;
  for (const l of lists) if (!l.length) return;
  const idx = new Array(n).fill(0);
  let count = 0;
  for (;;) {
    yield idx.map((k, i) => lists[i][k]);
    if (++count >= cap) return;
    let i = n - 1;
    while (i >= 0) {
      idx[i]++;
      if (idx[i] < lists[i].length) break;
      idx[i] = 0;
      i--;
    }
    if (i < 0) return;
  }
}

function productSize(lists) {
  let s = 1;
  for (const l of lists) s *= l.length;
  return s;
}

function fmtFactor(f) {
  const s = Math.abs(f).toFixed(4).replace(/\.?0+$/, '');
  return s;
}

/** Collect actions (groups with their options) from the model. */
function collectActions(model, code, useGroupFactors) {
  const groups = Array.isArray(model?.loadGroups) ? model.loadGroups : [];
  const cases = Array.isArray(model?.loadCases) ? model.loadCases.filter((c) => c && c.id != null) : [];
  const byGroup = new Map();
  const ungrouped = [];
  const groupIds = new Set(groups.filter((g) => g && g.id != null).map((g) => Number(g.id)));
  for (const lc of cases) {
    const gid = lc.group == null ? null : Number(lc.group);
    if (gid == null || !groupIds.has(gid)) { ungrouped.push(lc); continue; }
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(lc);
  }
  const actions = [];
  const mk = (name, p, lcs) => {
    const exclusive = !!p.exclusive && lcs.length > 1;
    const options = exclusive
      ? lcs.map((lc) => ({ label: lc.name || `LC${lc.id}`, cases: [Number(lc.id)] }))
      : [{ label: name, cases: lcs.map((lc) => Number(lc.id)) }];
    return { name, type: p.type, p, exclusive, options, cases: lcs };
  };
  for (const g of groups) {
    if (!g || g.id == null) continue;
    const lcs = byGroup.get(Number(g.id));
    if (!lcs || !lcs.length) continue;
    const p = groupParams(g, code, useGroupFactors);
    actions.push(mk(g.name || `Group ${g.id}`, p, lcs));
  }
  if (ungrouped.length) {
    const p = groupParams({ type: 'permanent', exclusive: false }, code);
    const name = ungrouped.length === 1 ? (ungrouped[0].name || 'G') : 'G';
    actions.unshift(mk(name, p, ungrouped));
  }
  return {
    perm: actions.filter((a) => a.type === 'permanent'),
    vars: actions.filter((a) => VARIABLE_TYPES.has(a.type)),
    accs: actions.filter((a) => a.type === 'accidental'),
    seis: actions.filter((a) => a.type === 'seismic'),
  };
}

/** Permanent states: arrays of { a, opt, sup }. */
function permanentStates(perm, withInf, cap) {
  if (withInf && perm.length > 3) {
    const lists = perm.map((a) => a.options.map((opt) => ({ a, opt })));
    const res = [];
    for (const sup of [true, false]) {
      for (const c of product(lists, cap)) res.push(c.map((s) => ({ ...s, sup })));
    }
    return res;
  }
  const lists = perm.map((a) => {
    const ch = [];
    for (const opt of a.options) {
      ch.push({ a, opt, sup: true });
      if (withInf && a.p.gammaInf !== a.p.gammaSup) ch.push({ a, opt, sup: false });
    }
    return ch;
  });
  return [...product(lists, cap)];
}

/** Variable states: { lead: {a,opt}|null, acc: [{a,opt}] }. */
function variableStates(vars, withLeading, cap) {
  const accLists = (list, mult) => {
    let l = list.map((a) => [null, ...a.options.map((opt) => ({ a, opt }))]);
    if (productSize(l) * mult > cap) l = list.map((a) => a.options.map((opt) => ({ a, opt })));
    return l;
  };
  const states = [];
  if (!withLeading) {
    for (const c of product(accLists(vars, 1), cap)) states.push({ lead: null, acc: c.filter(Boolean) });
    return states;
  }
  states.push({ lead: null, acc: [] });
  vars.forEach((a, i) => {
    const others = vars.filter((_, j) => j !== i);
    const lists = accLists(others, a.options.length);
    for (const opt of a.options) {
      for (const c of product(lists, cap)) states.push({ lead: { a, opt }, acc: c.filter(Boolean) });
    }
  });
  return states;
}

/** Seismic options with explicit term factors (±1.0, 100/30 rule). */
function seismicOptions(a) {
  const cs = a.cases;
  const opts = [];
  const lab = (lc) => lc.name || `LC${lc.id}`;
  if (a.exclusive || cs.length === 1) {
    for (const lc of cs) for (const s of [1, -1]) opts.push([{ label: lab(lc), cases: [Number(lc.id)], f: s }]);
    return opts;
  }
  const n = cs.length;
  for (let i = 0; i < n; i++) {
    const others = cs.filter((_, j) => j !== i);
    const signLists = others.map(() => (n <= 3 ? [0.3, -0.3] : [0.3]));
    for (const s of [1, -1]) {
      for (const signs of product(signLists)) {
        const terms = [{ label: lab(cs[i]), cases: [Number(cs[i].id)], f: s }];
        others.forEach((lc, k) => terms.push({ label: lab(lc), cases: [Number(lc.id)], f: signs[k] }));
        opts.push(terms);
      }
    }
  }
  return opts;
}

// ─────────────────────────────────────────── main ───────────────────────────────────────────

/**
 * Generate EN 1990 / SIA 260 load combinations (see header for the strategy).
 * Never throws for normal input; returns [] if the model has no load cases.
 */
export function generateCombinations(model, options = {}) {
  const code = designCode(model, options);
  const o = Object.assign({ uls: '6.10', sls: true, accidental: true, xi: 0.85, maxCombos: 2000, accidentalPsi: 'psi1' }, options || {});
  const cap = Math.max(10, Math.floor(o.maxCombos) || 2000);
  let A;
  try { A = collectActions(model, code, o.useGroupFactors !== false); } catch (e) { return []; }
  const { perm, vars, accs, seis } = A;
  if (!perm.length && !vars.length && !accs.length && !seis.length) return [];

  const out = [];
  const seen = new Set();
  const counters = {};

  /** terms: [{ label, cases:[ids], f }] */
  const push = (type, prefix, eq, terms) => {
    const factors = {};
    const used = [];
    for (const t of terms) {
      if (!(Math.abs(t.f) > 1e-12)) continue;
      used.push(t);
      for (const c of t.cases) factors[c] = (factors[c] || 0) + t.f;
    }
    for (const k of Object.keys(factors)) if (!(Math.abs(factors[k]) > 1e-12)) delete factors[k];
    const keys = Object.keys(factors);
    if (!keys.length) return;
    const key = type + '|' + keys.map(Number).sort((a, b) => a - b)
      .map((k) => `${k}:${Math.round(factors[k] * 1e9)}`).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    counters[prefix] = (counters[prefix] || 0) + 1;
    let txt = '';
    used.forEach((t, i) => {
      const neg = t.f < 0;
      const body = Math.abs(Math.abs(t.f) - 1) < 1e-12 ? t.label : `${fmtFactor(t.f)}·${t.label}`;
      txt += i === 0 ? (neg ? '-' : '') + body : (neg ? ' - ' : ' + ') + body;
    });
    out.push({ name: `${prefix} ${counters[prefix]}: ${txt}`, type, factors, eq, code });
  };

  const permTerms = (P, fn) => P.map((s) => ({ label: s.opt.label, cases: s.opt.cases, f: fn(s) }));
  const varTerms = (V, leadF, accF) => {
    const t = [];
    if (V.lead) t.push({ label: V.lead.opt.label, cases: V.lead.opt.cases, f: leadF(V.lead.a) });
    for (const s of V.acc) t.push({ label: s.opt.label, cases: s.opt.cases, f: accF(s.a) });
    return t;
  };

  // ───── ULS (fundamental / persistent-transient) ─────
  if (o.uls) {
    const P_uls = permanentStates(perm, true, cap);
    const gam = (s) => (s.sup ? s.a.p.gammaSup : s.a.p.gammaInf);
    if (code === 'SIA') {
      const V = variableStates(vars, true, cap);
      for (const P of P_uls) for (const v of V) {
        push('ULS', 'ULS', 'SIA 260 4.4.3.4', [
          ...permTerms(P, gam),
          ...varTerms(v, (a) => a.p.gammaSup, (a) => a.p.psi0),
        ]);
      }
    } else if (String(o.uls) === '6.10ab') {
      const xi = Number.isFinite(o.xi) ? o.xi : 0.85;
      const Va = variableStates(vars, false, cap);
      for (const P of P_uls) for (const v of Va) {
        push('ULS', 'ULS', 'EN 1990 6.10a', [...permTerms(P, gam), ...varTerms(v, () => 0, (a) => a.p.gammaSup * a.p.psi0)]);
      }
      const Vb = variableStates(vars, true, cap).filter((v) => v.lead);
      for (const P of P_uls) for (const v of Vb) {
        push('ULS', 'ULS', 'EN 1990 6.10b', [
          ...permTerms(P, (s) => (s.sup ? xi * s.a.p.gammaSup : s.a.p.gammaInf)),
          ...varTerms(v, (a) => a.p.gammaSup, (a) => a.p.gammaSup * a.p.psi0),
        ]);
      }
    } else {
      const V = variableStates(vars, true, cap);
      for (const P of P_uls) for (const v of V) {
        push('ULS', 'ULS', 'EN 1990 6.10', [
          ...permTerms(P, gam),
          ...varTerms(v, (a) => a.p.gammaSup, (a) => a.p.gammaSup * a.p.psi0),
        ]);
      }
    }
  }

  const P_unit = permanentStates(perm, false, cap);
  const one = () => 1;

  // ───── accidental (EC 6.11b / SIA 260 4.4.3.5) ─────
  if (o.accidental !== false && accs.length) {
    const sia = code === 'SIA';
    const psiLead = !sia && o.accidentalPsi !== 'psi2' ? 'psi1' : 'psi2';
    const V = variableStates(vars, !sia, cap);
    const eq = sia ? 'SIA 260 4.4.3.5' : 'EN 1990 6.11b';
    for (const a of accs) for (const opt of a.options) for (const P of P_unit) for (const v of V) {
      push('ULS-ACC', 'ACC', eq, [
        ...permTerms(P, one),
        { label: opt.label, cases: opt.cases, f: 1 },
        ...varTerms(v, (g) => g.p[psiLead], (g) => g.p.psi2),
      ]);
    }
  }

  // ───── seismic (EC 6.12b / SIA 260 4.4.3.5) ─────
  if (o.accidental !== false && seis.length) {
    const V = variableStates(vars, false, cap);
    const eq = code === 'SIA' ? 'SIA 260 4.4.3.5' : 'EN 1990 6.12b';
    for (const a of seis) for (const eTerms of seismicOptions(a)) for (const P of P_unit) for (const v of V) {
      push('ULS-ACC', 'SEIS', eq, [...permTerms(P, one), ...eTerms, ...varTerms(v, () => 0, (g) => g.p.psi2)]);
    }
  }

  // ───── SLS ─────
  if (o.sls !== false) {
    const sia = code === 'SIA';
    const Vl = variableStates(vars, true, cap);
    for (const P of P_unit) for (const v of Vl) {
      push('SLS-CHAR', 'SLS-CHAR', sia ? 'SIA 260 4.4.4 (rare)' : 'EN 1990 6.14b',
        [...permTerms(P, one), ...varTerms(v, () => 1, (a) => a.p.psi0)]);
    }
    for (const P of P_unit) for (const v of Vl) {
      push('SLS-FREQ', 'SLS-FREQ', sia ? 'SIA 260 4.4.4 (frequent)' : 'EN 1990 6.15b',
        [...permTerms(P, one), ...varTerms(v, (a) => a.p.psi1, (a) => a.p.psi2)]);
    }
    const Vq = variableStates(vars, false, cap);
    for (const P of P_unit) for (const v of Vq) {
      push('SLS-QP', 'SLS-QP', sia ? 'SIA 260 4.4.4 (quasi-permanent)' : 'EN 1990 6.16b',
        [...permTerms(P, one), ...varTerms(v, () => 0, (a) => a.p.psi2)]);
    }
  }
  return out;
}
