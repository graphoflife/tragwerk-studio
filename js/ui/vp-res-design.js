// Result views of the design modules: utilisation of steel/timber members and the reinforced-concrete
// results (slab reinforcement layers, slab shear, punching, RC beams, RC columns). Each view draws
// itself, answers the probe at the cursor and opens its detail on double-click. Registered in vp-results.js.
import { paletteColors, colorAt, label } from './vp-util.js';
import { DESIGN_COMPONENTS, RC_LAYERS, caseLabel } from './results-data.js';
import { providedAreas } from '../design/concrete.js';
import { slabSuggestion, beamSuggestion, meshText, barsText, stirrupText, layerName, checkName, POS_NAMES } from './design-text.js';
import { fmt } from '../core/units.js';
import { t } from '../i18n.js';
import { memberDetail } from './dialogs/member.js';
import { rcBeamDetail, rcPointDialog, nearestCorner, columnDetail } from './dialogs/rc.js';
import { visShell, deformedGeometry, ghostMesh, cornerPos, GRAY } from './vp-res-draw.js';

const RC_MODE_SUB = { req: 'erforderliche Bewehrung', prov: 'vorhandene Bewehrung', miss: 'fehlende Bewehrung (Zulage)' };
const pct = (v) => `${((v ?? 0) * 100).toFixed(0)} %`;
const DETAILS = () => [t('Doppelklick: Details'), ''];
const codeOf = (st) => (st.model.settings.code === 'SIA' ? 'SIA' : 'EC');
const memberResults = (st) => st.results.design[DESIGN_COMPONENTS[st.resultView.kind][0].source];
const findLine = (list, hit) => (hit.kind === 'line' ? list?.find((r) => r.line === hit.id) : null);
// station of a member result closest to the cursor (hit.t = relative position on the line)
function station(xs, hit) {
  const x = (hit.t ?? 0.5) * (xs[xs.length - 1] || 1);
  let k = 0;
  for (let j = 1; j < xs.length; j++) if (Math.abs(xs[j] - x) < Math.abs(xs[k] - x)) k = j;
  return k;
}

/* ---------------- steel / timber members ---------------- */
export const UTIL = {
  build: buildUtil,
  probe(st, hit) {
    const r = findLine(memberResults(st), hit);
    if (!r) return null;
    const checks = Object.entries(r.checks || {}).sort((a, b) => (b[1].eta ?? 0) - (a[1].eta ?? 0)).slice(0, 5);
    return [[t('Stab {id}', { id: hit.id }), pct(r.eta)], ...checks.map(([k, c]) => [checkName(k), pct(c.eta)]), DETAILS()];
  },
  open(app, hit) {
    if (hit.kind !== 'line') return false;
    memberDetail(app, app.store.resultView.kind, hit.id);
    return true;
  },
};

function buildUtil(vp, group, mesh) {
  const st = vp.store, rv = st.resultView;
  const list = memberResults(st);
  if (!list) return { title: t('Keine Ergebnisse'), empty: true };
  const { idx } = st;
  // component 'eta' = governing check, otherwise one check (AxisVM: separate result components per check)
  const check = rv.component && rv.component !== 'eta' ? rv.component : null;
  const etaOf = (r) => (check ? r.checks?.[check]?.eta : r.eta);
  const cols = paletteColors('utilization');
  const segsOk = [], colors = [], segsNa = [];
  const showLabels = st.view.labelsValues;
  // label only the most utilised members when there are many
  const sortedEta = list.map((r) => etaOf(r) ?? 0).sort((a, b) => b - a);
  const labelMin = list.length > 40 ? Math.max(sortedEta[Math.min(39, sortedEta.length - 1)], sortedEta[0] * 0.6) : 0;
  let maxEta = 0, n = 0, nFail = 0;
  for (const r of list) {
    const l = idx.lines.get(r.line);
    if (!l || st.view.hidden.lines.has(l.id)) continue;
    const a = idx.nodes.get(l.n1), b = idx.nodes.get(l.n2);
    const eta = etaOf(r);
    if (eta == null) { segsNa.push(a.x, a.y, a.z, b.x, b.y, b.z); continue; }
    maxEta = Math.max(maxEta, eta);
    if (eta > 1) nFail++;
    const c = colorAt(cols, Math.min(1, eta / 1.0), 0);
    segsOk.push(a.x, a.y, a.z, b.x, b.y, b.z);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if ((showLabels || eta > 1) && eta >= labelMin && n++ < 60) {
      group.add(label(`${(eta * 100).toFixed(0)}%`, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], 'big ' + (eta > 1 ? 'neg' : '')));
    }
  }
  ghostMesh(vp, group, mesh);
  const ln = vp.lines.make(segsOk, 0xffffff, 6, { vertexColors: colors });
  if (ln) group.add(ln);
  const na = vp.lines.make(segsNa, vp.C.ghost, 3);
  if (na) group.add(na);
  return {
    title: check ? `η ${checkName(check)}` : t('Ausnutzung η'), sub: (rv.kind === 'steel' ? t('Stahlbemessung') : t('Holzbemessung')) + (check ? '' : ' · ' + t('massgebender Nachweis')),
    min: 0, max: 1, palette: 'utilization', levels: 0, q: 'percent',
    extremes: [[t('max. η'), (maxEta * 100).toFixed(1) + ' %'], [t('Nicht erfüllt'), String(nFail)]],
  };
}

/* ---------------- RC slabs ---------------- */
const slabResults = (st, mesh) => (st.results.design.rc?.asCorner && mesh.shells.length ? st.results.design.rc : null);
const noSlabResults = (comp) => ({ title: t(comp.label), empty: true, msg: t('Keine Bemessungsergebnisse für Flächen – „Flächen bemessen“ ausführen.') });

// reinforcement layer at shell corner (e, k): required, provided or missing (result view rcMode)
function layerValues(st, mesh, comp) {
  const rc = st.results.design.rc, rv = st.resultView;
  const mode = rv.rcMode === 'prov' || rv.rcMode === 'miss' ? rv.rcMode : 'req';
  const prov = new Map(st.model.domains.map((d) => [d.id, d.rcProv ? providedAreas(d.rcProv) : null]));
  const f = (e, k) => {
    const req = rc.asCorner[(e * 4 + k) * 4 + comp.c], pv = prov.get(mesh.shells[e].domain), have = pv ? pv[comp.c] : 0;
    return mode === 'req' ? req : mode === 'prov' ? have : Math.max(0, req - have);
  };
  return { mode, f, anyProv: mesh.shells.some((s) => prov.get(s.domain)) };
}

// slab point: all layers, slab shear and governing case at the mesh corner nearest to the cursor
function slabCorner(st, hit) {
  const mesh = st.results.mesh;
  if (!st.results.design.rc || !hit.p || (hit.kind !== 'domain' && hit.kind !== 'node')) return null;
  const dom = hit.kind === 'domain' ? hit.id : mesh.shells.find((s) => s.nodes.includes(mesh.modelNodeToMesh?.[hit.id]))?.domain;
  const cn = dom != null ? nearestCorner(mesh, dom, hit.p) : null;
  return cn && { dom, ...cn };
}
const SLAB_POINT = {
  probe(st, hit) {
    const cn = slabCorner(st, hit), rc = st.results.design.rc;
    if (!cn) return null;
    const k = cn.e * 4 + cn.c, vr = rc.vRatio[k];
    const rows = [[t('Fläche {id}', { id: cn.dom }), ''], ...RC_LAYERS.map((n, j) => [n, fmt('reinf', rc.asCorner[k * 4 + j])]),
      ['vEd/vRd,c', vr < 0 ? t('Durchstanzbereich') : pct(vr)]];
    const gi = rc.gov[k * 4 + Math.max(0, RC_LAYERS.indexOf(st.resultView.component))];
    if (gi >= 0) rows.push([t('massgebend'), caseLabel(st, rc.keys[gi])]);
    rows.push([t('Doppelklick: Berechnung'), '']);
    return rows;
  },
  open(app, hit) {
    const cn = hit.kind === 'domain' && slabCorner(app.store, hit);
    if (!cn) return false;
    rcPointDialog(app, cn.e, cn.c);
    return true;
  },
};

export const SLAB_LAYER = {
  ...SLAB_POINT,
  build: buildSlabLayer,
  section(st, comp) {
    return slabResults(st, st.results.mesh) && { f: layerValues(st, st.results.mesh, comp).f, q: 'reinf', name: comp.key, integralQ: 'reinfBeam', down: false };
  },
};

export const SLAB_SHEAR = {
  ...SLAB_POINT,
  build: buildSlabShear,
  section(st) {
    const rc = slabResults(st, st.results.mesh);
    return rc && { f: (e, k) => { const v = rc.vRatio[e * 4 + k]; return v < 0 ? null : v; }, q: 'percent', name: 'vEd/vRd,c', integralQ: null, down: false };
  },
};

function buildSlabShear(vp, group, mesh, comp) {
  const st = vp.store, rc = slabResults(st, mesh);
  if (!rc) return noSlabResults(comp);
  const util = paletteColors('utilization');
  let mx = 0, n = 0;
  const corner = [];
  for (let k = 0; k < mesh.shells.length * 4; k++) {
    const r = rc.vRatio[k];
    if (r < 0) { corner.push(GRAY); continue; }
    if (visShell(vp, Math.floor(k / 4))) { mx = Math.max(mx, r); if (r > 1) n++; }
    corner.push(colorAt(util, Math.min(1, r), 0));
  }
  deformedGeometry(vp, group, mesh, new Float64Array(mesh.nodes.length * 2), 0, { cornerColors: corner, beamColor: vp.C.ghost });
  for (const d of rc.domains) if (d.vMaxAt >= 0 && d.vMax > 0 && !st.view.hidden.domains.has(d.id)) group.add(label(`${(d.vMax * 100).toFixed(0)} %`, cornerPos(mesh, d.vMaxAt), 'big ' + (d.vMax > 1 ? 'neg' : '')));
  return {
    title: t('Querkraft vEd / vRd,c'), sub: t('Platte ohne Schubbewehrung · grau: Durchstanzbereich'), min: 0, max: 1, palette: 'utilization', levels: 0, q: 'percent',
    extremes: [[t('max.'), (mx * 100).toFixed(0) + ' %'], [t('> 100 %'), String(n)]],
  };
}

function buildSlabLayer(vp, group, mesh, comp) {
  const st = vp.store, rv = st.resultView, rc = slabResults(st, mesh);
  if (!rc) return noSlabResults(comp);
  const code = codeOf(st), cols = paletteColors(rv.palette);
  const { mode, f, anyProv } = layerValues(st, mesh, comp);
  const vals = new Float64Array(mesh.shells.length * 4);
  for (let k = 0; k < vals.length; k++) vals[k] = f(Math.floor(k / 4), k % 4);
  let mx = 0, mxAt = -1;
  for (let k = 0; k < vals.length; k++) if (vals[k] > mx && visShell(vp, Math.floor(k / 4))) { mx = vals[k]; mxAt = k; }
  const corner = Array.from(vals, (v) => (mode === 'miss' && !(v > 1e-9) ? GRAY : colorAt(cols, mx > 0 ? v / mx : 0, rv.levels)));
  deformedGeometry(vp, group, mesh, new Float64Array(mesh.nodes.length * 2), 0, { cornerColors: corner, beamColor: vp.C.ghost });
  // per domain: maximum with a bar suggestion
  const byDom = new Map();
  for (let k = 0; k < vals.length; k++) {
    if (!visShell(vp, Math.floor(k / 4))) continue;
    const id = mesh.shells[Math.floor(k / 4)].domain;
    const b = byDom.get(id);
    if (!b || vals[k] > b.v) byDom.set(id, { v: vals[k], k });
  }
  let nl = 0;
  for (const [id, b] of byDom) {
    if (!(b.v > 1e-9) || nl++ > 80) continue;
    const sum = rc.domains.find((d) => d.id === id);
    const sug = mode === 'prov' ? null : slabSuggestion(b.v, comp.key, sum?.layout, code);
    group.add(label(`${fmt(comp.q, b.v)}${sug ? ' · ' + meshText(sug) : ''}`, cornerPos(mesh, b.k), 'big'));
  }
  const nMiss = mode === 'miss' ? new Set([...byDom].filter(([, b]) => b.v > 1e-9).map(([id]) => id)).size : 0;
  return {
    title: `${comp.key} – ${layerName(comp.key)}`, sub: t(RC_MODE_SUB[mode]) + (mode !== 'req' && !anyProv ? ' · ' + t('keine Vorgabe') : ''),
    min: 0, max: mx || 1, palette: rv.palette, levels: rv.levels, q: comp.q,
    extremes: [[t('Max'), fmt(comp.q, mx)], ...(mode === 'req' && mx > 0 ? [[t('Vorschlag'), meshText(slabSuggestion(mx, comp.key, rc.domains.find((d) => d.id === mesh.shells[Math.floor(mxAt / 4)].domain)?.layout, code))]] : []),
      ...(mode === 'miss' ? [[t('Flächen mit Zulage'), String(nMiss)]] : [])],
  };
}

/* ---------------- punching ---------------- */
export const PUNCHING = {
  build: buildPunching,
  probe(st, hit) {
    const it = hit.kind === 'node' && st.results.design.punching?.items.find((i) => i.node === hit.id);
    if (!it) return null;
    return [[t('Knoten {id}', { id: hit.id }), t(POS_NAMES[it.type])], ['VEd', fmt('force', it.VEd)], ['d', fmt('dim', it.d)], ['η', pct(it.eta)],
      [it.fail ? t('verstärken') : it.needsReinf ? t('Durchstanzbewehrung erforderlich') : t('ohne Bewehrung erfüllt'), '']];
  },
};

/* ---------------- RC beams and columns ---------------- */
export const RC_BEAM = {
  build: buildRCBeams,
  probe(st, hit) {
    const r = findLine(st.results.design.rcBeams, hit);
    if (!r?.x?.length) return null;
    const k = station(r.x, hit);
    return [[t('Balken {id}', { id: hit.id }), `x = ${fmt('len', r.x[k])}`],
      ...(r.env ? [['My max / min', `${fmt('moment', r.env.MyMax[k], { unit: false })} / ${fmt('moment', r.env.MyMin[k])}`]] : []),
      [t('As unten'), fmt('reinfBeam', r.AsBot[k])], [t('As oben'), fmt('reinfBeam', r.AsTop[k])], ['asw', fmt('reinf', r.Asw[k])], DETAILS()];
  },
  open(app, hit) {
    if (!findLine(app.store.results.design.rcBeams, hit)) return false;
    rcBeamDetail(app, hit.id);
    return true;
  },
};

export const RC_COLUMN = {
  build: buildRCColumns,
  probe(st, hit) {
    const c = findLine(st.results.design.rcCols, hit);
    if (!c) return null;
    const g = c.governing || {};
    return [[t('Stütze {id}', { id: hit.id }), pct(c.eta)], ['NEd', fmt('force', g.NEd ?? 0)], ['MEd,y / MEd,z', `${fmt('moment', g.MEdy ?? 0, { unit: false })} / ${fmt('moment', g.MEdz ?? 0)}`],
      [t('As erforderlich'), fmt('reinfBeam', c.As)], [t('Vorschlag'), c.bars ? `${c.bars.n} Ø${Math.round(c.bars.dia * 1000)}` : '–'], DETAILS()];
  },
  open(app, hit) {
    if (!findLine(app.store.results.design.rcCols, hit)) return false;
    columnDetail(app, hit.id);
    return true;
  },
};

function buildRCBeams(vp, group, mesh, comp) {
  const st = vp.store, rv = st.resultView, code = codeOf(st), cols = paletteColors(rv.palette);
  const list = st.results.design.rcBeams || [];
  if (!list.length) return { title: t(comp.label), empty: true, msg: t('Keine Betonbalken bemessen – „Balken bemessen“ ausführen.') };
  let mx = 0;
  const hiddenL = st.view.hidden.lines;
  for (const r of list) if (!hiddenL.has(r.line)) for (const v of r[comp.key] || []) if (Number.isFinite(v)) mx = Math.max(mx, v);
  const { idx } = st;
  const segs = [], colors = [];
  let n = 0;
  for (const r of list) {
    const l = idx.lines.get(r.line);
    if (!l || hiddenL.has(l.id)) continue;
    const a = idx.nodes.get(l.n1), b = idx.nodes.get(l.n2);
    const vals = r[comp.key] || [0];
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
    let vmax = 0;
    for (let i = 0; i < vals.length - 1; i++) {
      const s0 = Math.min(1, r.x[i] / L), s1 = Math.min(1, r.x[i + 1] / L);
      const c = colorAt(cols, mx > 0 ? vals[i] / mx : 0, rv.levels);
      segs.push(a.x + (b.x - a.x) * s0, a.y + (b.y - a.y) * s0, a.z + (b.z - a.z) * s0, a.x + (b.x - a.x) * s1, a.y + (b.y - a.y) * s1, a.z + (b.z - a.z) * s1);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      vmax = Math.max(vmax, vals[i], vals[i + 1]);
    }
    if (n++ < 300 && vmax > 0) {
      const sug = beamSuggestion(r, code);
      const txt = comp.key === 'Asw' ? stirrupText(sug.stirrups) : barsText(comp.key === 'AsBot' ? sug.bot : sug.top);
      group.add(label(st.view.labelsValues ? `${fmt(comp.q, vmax)} · ${txt}` : txt, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], 'big' + (r.ok === false ? ' neg' : '')));
    }
  }
  ghostMesh(vp, group, mesh);
  const ln = vp.lines.make(segs, 0xffffff, 6, { vertexColors: colors });
  if (ln) group.add(ln);
  const nT = list.filter((r) => r.tBeam).length;
  return { title: t(comp.label), sub: t('Stahlbetonbalken') + (nT ? ' · ' + t('{n} Plattenbalken', { n: nT }) : ''), min: 0, max: mx || 1, palette: rv.palette, levels: rv.levels, q: comp.q, extremes: [[t('Max'), fmt(comp.q, mx)], [t('nicht erfüllt'), String(list.filter((r) => r.ok === false).length)]] };
}

function buildRCColumns(vp, group, mesh, comp) {
  const st = vp.store, rv = st.resultView, cols = paletteColors(rv.palette);
  const list = st.results.design.rcCols || [];
  if (!list.length) return { title: t(comp.label), empty: true, msg: t('Keine Stützen bemessen – „Stützen bemessen“ ausführen.') };
  const util = comp.key === 'colEta';
  const pal = util ? paletteColors('utilization') : cols;
  const hiddenL = st.view.hidden.lines;
  let mx = 0;
  for (const r of list) if (!hiddenL.has(r.line)) mx = Math.max(mx, util ? r.eta || 0 : r.As || 0);
  const segs = [], colors = [];
  let nFail = 0;
  for (const r of list) {
    const l = st.idx.lines.get(r.line);
    if (!l || hiddenL.has(l.id)) continue;
    const a = st.idx.nodes.get(l.n1), b = st.idx.nodes.get(l.n2);
    const v = util ? r.eta || 0 : r.As || 0;
    if (r.ok === false || r.eta > 1) nFail++;
    const c = colorAt(pal, util ? Math.min(1, v) : (mx > 0 ? v / mx : 0), util ? 0 : rv.levels);
    segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    const txt = `${r.bars ? `${r.bars.n} Ø${Math.round(r.bars.dia * 1000)}` : '–'} · ${(100 * (r.eta || 0)).toFixed(0)} %`;
    group.add(label(txt, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], 'big' + (r.ok === false || r.eta > 1 ? ' neg' : '')));
  }
  ghostMesh(vp, group, mesh);
  const ln = vp.lines.make(segs, 0xffffff, 7, { vertexColors: colors });
  if (ln) group.add(ln);
  return util
    ? { title: t('Stützen: Ausnutzung η'), sub: t('mit vorgeschlagener Bewehrung, inkl. Theorie II. Ordnung'), min: 0, max: 1, palette: 'utilization', levels: 0, q: 'percent', extremes: [[t('max. η'), (mx * 100).toFixed(0) + ' %'], [t('nicht erfüllt'), String(nFail)]] }
    : { title: t('Stützen: As erforderlich'), sub: t('Längsbewehrung gesamt'), min: 0, max: mx || 1, palette: rv.palette, levels: rv.levels, q: 'reinfBeam', extremes: [[t('Max'), fmt('reinfBeam', mx)]] };
}

function buildPunching(vp, group, mesh) {
  const st = vp.store;
  const P = st.results.design.punching;
  ghostMesh(vp, group, mesh);
  if (!P?.items?.length) return { title: t('Durchstanzen'), empty: true, msg: t('Keine Stützen oder Punktlager unter Betonplatten gefunden.') };
  const util = paletteColors('utilization');
  const segs = [], colors = [];
  let mx = 0;
  for (const it of P.items) {
    if (st.view.hidden.nodes.has(it.node)) continue;
    mx = Math.max(mx, it.eta);
    const c = colorAt(util, Math.min(1, it.eta), 0);
    const pts = it.perimeter;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > 4 * it.a) continue; // gap at slab edges
      segs.push(...a, ...b);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    group.add(label(`${(it.eta * 100).toFixed(0)} %`, it.center, 'big ' + (it.eta > 1 ? 'neg' : '')));
  }
  const ln = vp.lines.make(segs, 0xffffff, 5, { vertexColors: colors });
  if (ln) group.add(ln);
  const nR = P.items.filter((i) => i.needsReinf && !i.fail).length, nF = P.items.filter((i) => i.fail).length;
  return {
    title: t('Durchstanzen'), sub: st.model.settings.code === 'SIA' ? 'SIA 262 4.3.6' : 'EN 1992-1-1 6.4', min: 0, max: 1, palette: 'utilization', levels: 0, q: 'percent',
    extremes: [[t('max. η'), (mx * 100).toFixed(0) + ' %'], [t('Durchstanzbewehrung'), String(nR)], [t('nicht möglich'), String(nF)]],
  };
}
