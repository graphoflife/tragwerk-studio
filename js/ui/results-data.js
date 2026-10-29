// Result component definitions and case access (load cases, combinations, envelopes, spectrum).
import { t } from '../i18n.js';
import { envelope } from '../fem/index.js';

export const COMPONENTS = [
  { key: 'deformed', group: 'Verformung', label: 'Verformte Figur', kind: 'deform', icon: 'deformed' },
  { key: 'eX', group: 'Verschiebungen', label: 'eX', q: 'disp', kind: 'nodal', f: (d, i) => d[6 * i] },
  { key: 'eY', group: 'Verschiebungen', label: 'eY', q: 'disp', kind: 'nodal', f: (d, i) => d[6 * i + 1] },
  { key: 'eZ', group: 'Verschiebungen', label: 'eZ', q: 'disp', kind: 'nodal', f: (d, i) => d[6 * i + 2] },
  { key: 'eR', short: 'eR', group: 'Verschiebungen', label: 'eR (resultierend)', q: 'disp', kind: 'nodal', f: (d, i) => Math.hypot(d[6 * i], d[6 * i + 1], d[6 * i + 2]) },
  { key: 'fX', group: 'Verschiebungen', label: 'φX', q: 'rot', kind: 'nodal', f: (d, i) => d[6 * i + 3] },
  { key: 'fY', group: 'Verschiebungen', label: 'φY', q: 'rot', kind: 'nodal', f: (d, i) => d[6 * i + 4] },
  { key: 'fZ', group: 'Verschiebungen', label: 'φZ', q: 'rot', kind: 'nodal', f: (d, i) => d[6 * i + 5] },
  { key: 'N', short: 'N', group: 'Stabschnittgrössen', label: 'N (Normalkraft)', q: 'force', kind: 'beam', plane: 'z', sign: 1 },
  { key: 'Vy', group: 'Stabschnittgrössen', label: 'Vy', q: 'force', kind: 'beam', plane: 'y', sign: 1 },
  { key: 'Vz', group: 'Stabschnittgrössen', label: 'Vz', q: 'force', kind: 'beam', plane: 'z', sign: 1 },
  { key: 'T', short: 'T', group: 'Stabschnittgrössen', label: 'T (Torsion)', q: 'moment', kind: 'beam', plane: 'z', sign: 1 },
  { key: 'My', group: 'Stabschnittgrössen', label: 'My', q: 'moment', kind: 'beam', plane: 'z', sign: -1 },
  { key: 'Mz', group: 'Stabschnittgrössen', label: 'Mz', q: 'moment', kind: 'beam', plane: 'y', sign: -1 },
  { key: 'nx', group: 'Flächenschnittgrössen', label: 'nx', q: 'lineForce', kind: 'shell', c: 0 },
  { key: 'ny', group: 'Flächenschnittgrössen', label: 'ny', q: 'lineForce', kind: 'shell', c: 1 },
  { key: 'nxy', group: 'Flächenschnittgrössen', label: 'nxy', q: 'lineForce', kind: 'shell', c: 2 },
  { key: 'n1', short: 'n1', group: 'Flächenschnittgrössen', label: 'n1 (Hauptnormalkraft)', q: 'lineForce', kind: 'shell', d: (v) => princ(v[0], v[1], v[2], 1) },
  { key: 'n2', short: 'n2', group: 'Flächenschnittgrössen', label: 'n2 (Hauptnormalkraft)', q: 'lineForce', kind: 'shell', d: (v) => princ(v[0], v[1], v[2], -1) },
  { key: 'mx', group: 'Flächenschnittgrössen', label: 'mx', q: 'lineMoment', kind: 'shell', c: 3 },
  { key: 'my', group: 'Flächenschnittgrössen', label: 'my', q: 'lineMoment', kind: 'shell', c: 4 },
  { key: 'mxy', group: 'Flächenschnittgrössen', label: 'mxy', q: 'lineMoment', kind: 'shell', c: 5 },
  { key: 'm1', short: 'm1', group: 'Flächenschnittgrössen', label: 'm1 (Hauptmoment)', q: 'lineMoment', kind: 'shell', d: (v) => princ(v[3], v[4], v[5], 1) },
  { key: 'm2', short: 'm2', group: 'Flächenschnittgrössen', label: 'm2 (Hauptmoment)', q: 'lineMoment', kind: 'shell', d: (v) => princ(v[3], v[4], v[5], -1) },
  { key: 'vx', group: 'Flächenschnittgrössen', label: 'vx (Querkraft)', q: 'lineForce', kind: 'shell', c: 6 },
  { key: 'vy', group: 'Flächenschnittgrössen', label: 'vy (Querkraft)', q: 'lineForce', kind: 'shell', c: 7 },
  { key: 'vR', short: 'vR', group: 'Flächenschnittgrössen', label: 'vR (resultierend)', q: 'lineForce', kind: 'shell', d: (v) => Math.hypot(v[6], v[7]) },
  { key: 'sTop', short: 'σv↑', group: 'Spannungen', label: 'σ v. Mises oben', q: 'stress', kind: 'shell', d: (v, th) => vonMises(v, th, -1) },
  { key: 'sBot', short: 'σv↓', group: 'Spannungen', label: 'σ v. Mises unten', q: 'stress', kind: 'shell', d: (v, th) => vonMises(v, th, 1) },
  { key: 'sxTop', short: 'σx↑', group: 'Spannungen', label: 'σx oben', q: 'stress', kind: 'shell', d: (v, th) => v[0] / th - 6 * v[3] / (th * th) },
  { key: 'sxBot', short: 'σx↓', group: 'Spannungen', label: 'σx unten', q: 'stress', kind: 'shell', d: (v, th) => v[0] / th + 6 * v[3] / (th * th) },
  { key: 'R', group: 'Auflager', label: 'Auflagerkräfte', q: 'force', kind: 'reaction', icon: 'reactions' },
];

export const DESIGN_COMPONENTS = {
  steel: [{ key: 'eta', label: 'Ausnutzung η', q: 'percent', kind: 'util' }],
  timber: [{ key: 'eta', label: 'Ausnutzung η', q: 'percent', kind: 'util' }],
  rc: [
    { key: 'axb', label: 'axb (x unten)', q: 'reinf', kind: 'rc', c: 0 },
    { key: 'ayb', label: 'ayb (y unten)', q: 'reinf', kind: 'rc', c: 1 },
    { key: 'axt', label: 'axt (x oben)', q: 'reinf', kind: 'rc', c: 2 },
    { key: 'ayt', label: 'ayt (y oben)', q: 'reinf', kind: 'rc', c: 3 },
    { key: 'AsBot', label: 'Balken As unten', q: 'reinfBeam', kind: 'rcbeam' },
    { key: 'AsTop', label: 'Balken As oben', q: 'reinfBeam', kind: 'rcbeam' },
    { key: 'Asw', label: 'Bügel asw', q: 'reinf', kind: 'rcbeam' },
  ],
};

export function componentDef(key) { return COMPONENTS.find((c) => c.key === key); }

function princ(a, b, c, s) { return (a + b) / 2 + s * Math.hypot((a - b) / 2, c); }
function vonMises(v, th, side) {
  const sx = v[0] / th + side * 6 * v[3] / (th * th);
  const sy = v[1] / th + side * 6 * v[4] / (th * th);
  const txy = v[2] / th + side * 6 * v[5] / (th * th);
  return Math.sqrt(Math.max(0, sx * sx - sx * sy + sy * sy + 3 * txy * txy));
}

// Options for the case selector
export function caseOptions(store) {
  const { model, results } = store;
  const out = [];
  const st = results.static;
  if (st?.cases) {
    const lcs = model.loadCases.filter((lc) => st.cases['LC:' + lc.id]).map((lc) => ({ value: 'LC:' + lc.id, label: lc.name }));
    if (lcs.length) out.push({ group: t('Lastfälle'), options: lcs });
    const cos = model.combinations.filter((c) => st.cases['CO:' + c.id]).map((c) => ({ value: 'CO:' + c.id, label: c.name }));
    if (cos.length) {
      out.push({ group: t('Kombinationen'), options: cos });
      const env = [{ value: 'ENV:ALL', label: t('Umhüllende aller Kombinationen') }];
      const types = [...new Set(model.combinations.filter((c) => st.cases['CO:' + c.id]).map((c) => c.type))];
      for (const tp of types) env.push({ value: 'ENV:' + tp, label: t('Umhüllende {type}', { type: tp }) });
      out.push({ group: t('Umhüllende'), options: env });
    }
  }
  if (results.spectrum?.cases) {
    out.push({ group: t('Erdbeben (Antwortspektrum)'), options: Object.keys(results.spectrum.cases).map((k) => ({ value: k, label: t('Spektrum {dir}', { dir: k.split(':')[1] }) })) });
  }
  return out;
}

const envCache = new WeakMap();
// Returns { res } for a single case or { env: true, min, max } for envelopes.
export function getCase(store, key) {
  const { model, results } = store;
  if (!key) return null;
  if (key.startsWith('SP:')) return results.spectrum?.cases?.[key] ? { res: results.spectrum.cases[key] } : null;
  const st = results.static;
  if (!st?.cases) return null;
  if (key.startsWith('ENV:')) {
    const tp = key.slice(4);
    let cache = envCache.get(st);
    if (!cache) { cache = {}; envCache.set(st, cache); }
    if (!cache[key]) {
      const list = model.combinations.filter((c) => (tp === 'ALL' || c.type === tp) && st.cases['CO:' + c.id]).map((c) => st.cases['CO:' + c.id]);
      if (!list.length) return null;
      cache[key] = { env: true, ...envelope(list) };
    }
    return cache[key];
  }
  return st.cases[key] ? { res: st.cases[key] } : null;
}

export function caseLabel(store, key) {
  if (!key) return '';
  const [p, id] = key.split(':');
  if (p === 'LC') return store.idx.loadCases.get(+id)?.name || key;
  if (p === 'CO') return store.idx.combinations.get(+id)?.name || key;
  if (p === 'ENV') return id === 'ALL' ? t('Umhüllende aller Kombinationen') : t('Umhüllende {type}', { type: id });
  if (p === 'SP') return t('Spektrum {dir}', { dir: id });
  return key;
}

// default case key after an analysis
export function defaultCaseKey(store) {
  const opts = caseOptions(store);
  return opts[0]?.options[0]?.value ?? null;
}

// Max |value| summary of a static case (for side panel)
export function caseSummary(store, key) {
  const c = getCase(store, key);
  const mesh = store.results.mesh;
  if (!c || !mesh) return null;
  const r = c.res || c.max;
  const r2 = c.res || c.min;
  const nn = mesh.nodes.length / 3;
  let maxU = 0, maxUNode = -1, maxZ = 0, sumR = [0, 0, 0];
  for (const rr of [r, r2]) {
    for (let i = 0; i < nn; i++) {
      const u = Math.hypot(rr.disp[6 * i], rr.disp[6 * i + 1], rr.disp[6 * i + 2]);
      if (u > maxU) { maxU = u; maxUNode = i; }
      if (Math.abs(rr.disp[6 * i + 2]) > Math.abs(maxZ)) maxZ = rr.disp[6 * i + 2];
    }
  }
  if (c.res) for (let i = 0; i < nn; i++) for (let k = 0; k < 3; k++) sumR[k] += r.reac[6 * i + k];
  const ext = (comp) => {
    let mx = 0;
    for (const rr of [r, r2]) for (const b of rr.beams || []) if (b) for (const v of b[comp]) if (Math.abs(v) > Math.abs(mx)) mx = v;
    return mx;
  };
  return { maxU, maxUNode, maxZ, sumR: c.res ? sumR : null, N: ext('N'), Vz: ext('Vz'), My: ext('My'), Mz: ext('Mz'), T: ext('T') };
}
