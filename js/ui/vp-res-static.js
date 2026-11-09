// Result views of the analysis: static results (deformed shape, contours, beam diagrams, reactions)
// and mode shapes (eigen- and buckling modes). Registered in vp-results.js.
import { paletteColors, colorAt, label, ArrowBatch } from './vp-util.js';
import { getCase, caseLabel } from './results-data.js';
import { fmt } from '../core/units.js';
import { lineForces } from '../fem/index.js';
import { t } from '../i18n.js';
import { NSUB, visBeam, visShell, visNode, nodePos, maxDisp, deformedGeometry, autoScale, fixRange, usedNodes, ghostMesh, extremeLabels, diagramFill } from './vp-res-draw.js';

const resultOf = (st, cs) => cs.res || (st.resultView.envSide === 'min' ? cs.min : cs.max);

export const STATIC = {
  build: buildStatic,

  // node: displacements and reactions; member: internal forces at the cursor
  probe(st, hit) {
    const rv = st.resultView, mesh = st.results.mesh;
    const cs = getCase(st, rv.caseKey);
    if (!cs) return null;
    const r = resultOf(st, cs);
    if (hit.kind === 'node') {
      const i = mesh.modelNodeToMesh?.[hit.id];
      if (i == null) return null;
      const d = r.disp, R = r.reac;
      const rows = [[t('Knoten {id}', { id: hit.id }), '']];
      ['eX', 'eY', 'eZ'].forEach((k, j) => rows.push([k, fmt('disp', d[6 * i + j])]));
      if ([0, 1, 2].some((j) => Math.abs(R[6 * i + j]) > 1e-9)) ['Rx', 'Ry', 'Rz'].forEach((k, j) => rows.push([k, fmt('force', R[6 * i + j])]));
      return rows;
    }
    if (hit.kind !== 'line' || !st.idx.lines.get(hit.id)?.element) return null;
    let f;
    try { f = lineForces(mesh, r, hit.id); } catch (e) { return null; }
    if (!f?.x?.length) return null;
    const L = f.x[f.x.length - 1] || 1, x = (hit.t ?? 0.5) * L;
    let k = 0;
    for (let j = 1; j < f.x.length; j++) if (Math.abs(f.x[j] - x) < Math.abs(f.x[k] - x)) k = j;
    return [[t('Stab {id}', { id: hit.id }), `x = ${fmt('len', f.x[k])}`],
      ...[['N', 'force', 'Nx'], ['Vy', 'force'], ['Vz', 'force'], ['T', 'moment', 'Tx'], ['My', 'moment'], ['Mz', 'moment']].map(([c, q, lab]) => [lab || c, fmt(q, f[c][k])])];
  },

  // surface components and nodal values at the shell corners
  section(st, comp) {
    const rv = st.resultView, mesh = st.results.mesh, cs = getCase(st, rv.caseKey);
    if (!cs) return null;
    const pick = (fn) => (cs.env ? (e, k) => { const a = fn(cs.min, e, k), b = fn(cs.max, e, k); return rv.envSide === 'min' ? Math.min(a, b) : Math.max(a, b); } : (e, k) => fn(cs.res, e, k));
    if (comp.kind === 'shell') {
      const tmp = new Array(8);
      const val = (r, e, k) => {
        const A = rv.smooth ? r.shells : r.shellsRaw || r.shells;
        for (let c = 0; c < 8; c++) tmp[c] = A[(e * 4 + k) * 8 + c];
        return comp.d ? comp.d(tmp, mesh.shells[e].thickness || 0.2) : tmp[comp.c];
      };
      return { f: pick(val), q: comp.q, name: comp.short || comp.label.split(' ')[0], integralQ: { lineMoment: 'moment', lineForce: 'force' }[comp.q] || null, down: comp.q === 'lineMoment' };
    }
    if (comp.kind === 'nodal') {
      return { f: pick((r, e, k) => comp.f(r.disp, mesh.shells[e].nodes[k])), q: comp.q, name: comp.short || comp.label, integralQ: null, down: false };
    }
    return null;
  },
};

export const MODE = { build: buildMode };

function buildStatic(vp, group, mesh, comp) {
  const st = vp.store, rv = st.resultView;
  const cs = getCase(st, rv.caseKey);
  if (!cs) return { title: t('Keine Ergebnisse'), empty: true };
  const res = resultOf(st, cs);
  const disp = res.disp;
  const showDef = rv.deformed && !cs.env && rv.kind !== 'spectrum';
  const scale = showDef ? autoScale(vp, mesh, disp, rv.scale) : 0;
  const info = { title: t(comp.label), sub: caseLabel(st, rv.caseKey), q: comp.q, scaleUsed: scale };
  const cols = paletteColors(rv.palette);

  if (comp.kind === 'deform' || comp.kind === 'reaction') {
    const sc = comp.kind === 'deform' ? (cs.env ? 0 : autoScale(vp, mesh, disp, rv.scale)) : scale;
    // undeformed ghost
    ghostMesh(vp, group, mesh);
    deformedGeometry(vp, group, mesh, disp, sc, {});
    if (comp.kind === 'reaction' || rv.showReactions) reactions(vp, group, mesh, res);
    const md = maxDisp(mesh, disp, vp.vis);
    info.extremes = [[t('max. Verschiebung'), fmt('disp', md)]];
    info.noScale = true;
    return info;
  }

  if (comp.kind === 'nodal') {
    const nn = mesh.nodes.length / 3;
    const vals = new Float64Array(nn);
    let vmin = Infinity, vmax = -Infinity, imin = 0, imax = 0;
    const used = usedNodes(mesh);
    for (let i = 0; i < nn; i++) {
      if (!used[i] || !visNode(vp, i)) continue;
      let v = comp.f(disp, i);
      if (cs.env) { const a = comp.f(cs.min.disp, i), b = comp.f(cs.max.disp, i); v = rv.envSide === 'min' ? Math.min(a, b) : Math.max(a, b); }
      vals[i] = v;
      if (v < vmin) { vmin = v; imin = i; }
      if (v > vmax) { vmax = v; imax = i; }
    }
    if (!Number.isFinite(vmin)) return info;
    const range = fixRange(vmin, vmax);
    const cOf = (v) => colorAt(cols, (v - range[0]) / (range[1] - range[0]), rv.levels);
    const corner = mesh.shells.length ? new Array(mesh.shells.length * 4) : null;
    mesh.shells.forEach((s, e) => s.nodes.forEach((n, k) => { corner[e * 4 + k] = cOf(vals[n]); }));
    const bc = [];
    mesh.beams.forEach((b) => {
      for (let k = 0; k < NSUB; k++) {
        const s0 = k / NSUB, s1 = (k + 1) / NSUB;
        const c0 = cOf(vals[b.n1] * (1 - s0) + vals[b.n2] * s0), c1 = cOf(vals[b.n1] * (1 - s1) + vals[b.n2] * s1);
        bc.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
      }
    });
    ghostMesh(vp, group, mesh);
    deformedGeometry(vp, group, mesh, disp, scale, { colorsBeam: bc.length ? bc : null, cornerColors: corner });
    extremeLabels(vp, group, mesh, disp, scale, [[imax, vmax], [imin, vmin]], comp.q);
    Object.assign(info, { min: range[0], max: range[1], palette: rv.palette, levels: rv.levels, extremes: [[t('Max'), fmt(comp.q, vmax)], [t('Min'), fmt(comp.q, vmin)]] });
    return info;
  }

  if (comp.kind === 'beam') {
    deformedGeometry(vp, group, mesh, disp, scale, { beamColor: vp.C.ghost });
    const r = beamDiagrams(vp, group, mesh, cs, comp, rv);
    Object.assign(info, r);
    if (rv.showReactions && cs.res) reactions(vp, group, mesh, res);
    return info;
  }

  if (comp.kind === 'shell') {
    if (!mesh.shells.length) return { ...info, empty: true, msg: t('Keine Flächenelemente im Modell.') };
    const ns = mesh.shells.length;
    const arr = (r) => (rv.smooth ? r.shells : r.shellsRaw || r.shells);
    const vals = new Float64Array(ns * 4);
    let vmin = Infinity, vmax = -Infinity, emin = 0, emax = 0;
    const tmp = new Array(8);
    const val = (A, e, k, th) => {
      for (let c = 0; c < 8; c++) tmp[c] = A[(e * 4 + k) * 8 + c];
      return comp.d ? comp.d(tmp, th) : tmp[comp.c];
    };
    for (let e = 0; e < ns; e++) {
      if (!visShell(vp, e)) continue;
      const th = mesh.shells[e].thickness || 0.2;
      for (let k = 0; k < 4; k++) {
        let v;
        if (cs.env) { const a = val(arr(cs.min), e, k, th), b = val(arr(cs.max), e, k, th); v = rv.envSide === 'min' ? Math.min(a, b) : Math.max(a, b); } else v = val(arr(res), e, k, th);
        vals[e * 4 + k] = v;
        if (v < vmin) { vmin = v; emin = e * 4 + k; }
        if (v > vmax) { vmax = v; emax = e * 4 + k; }
      }
    }
    const range = fixRange(vmin, vmax);
    const corner = Array.from(vals, (v) => colorAt(cols, (v - range[0]) / (range[1] - range[0]), rv.levels));
    deformedGeometry(vp, group, mesh, disp, scale, { cornerColors: corner, beamColor: vp.C.ghost });
    const nodeOf = (ci) => mesh.shells[Math.floor(ci / 4)].nodes[ci % 4];
    extremeLabels(vp, group, mesh, disp, scale, [[nodeOf(emax), vmax], [nodeOf(emin), vmin]], comp.q);
    Object.assign(info, { min: range[0], max: range[1], palette: rv.palette, levels: rv.levels, extremes: [[t('Max'), fmt(comp.q, vmax)], [t('Min'), fmt(comp.q, vmin)]] });
    return info;
  }
  return info;
}

/* ---------------- beam diagrams ---------------- */
function beamDiagrams(vp, group, mesh, cs, comp, rv) {
  const sets = cs.env ? [[cs.max, 'max'], [cs.min, 'min']] : [[cs.res, null]];
  let maxAbs = 0;
  for (const [r] of sets) (r.beams || []).forEach((b, bi) => { if (b && visBeam(vp, bi)) for (const v of b[comp.key]) maxAbs = Math.max(maxAbs, Math.abs(v)); });
  const info = { q: comp.q, diagram: true, maxAbs };
  if (maxAbs < 1e-12) { info.extremes = [[t('Max'), fmt(comp.q, 0)]]; return info; }
  const H = vp.sz * 4 * (rv.diagramScale || 1);
  const sc = H / maxAbs;
  const posTri = [], negTri = [], outline = [];
  const lineExt = new Map();
  let gmax = -Infinity, gmin = Infinity;
  for (const [r] of sets) {
    mesh.beams.forEach((b, bi) => {
      const br = r.beams?.[bi];
      if (!br || b.type === 'spring' || b.type === 'rigid' || !visBeam(vp, bi)) return;
      const p1 = nodePos(mesh, b.n1);
      const dir = comp.plane === 'y' ? b.ey : b.ez;
      const sgn = comp.sign;
      const vals = br[comp.key], xs = br.x;
      const pts = [], tips = [];
      for (let k = 0; k < xs.length; k++) {
        const x = xs[k], v = vals[k];
        const p = [p1[0] + b.ex[0] * x, p1[1] + b.ex[1] * x, p1[2] + b.ex[2] * x];
        const tip = [p[0] + dir[0] * v * sc * sgn, p[1] + dir[1] * v * sc * sgn, p[2] + dir[2] * v * sc * sgn];
        pts.push(p); tips.push(tip);
        const e = lineExt.get(b.line) || { max: -Infinity, min: Infinity };
        if (v > e.max) { e.max = v; e.pmax = tip; }
        if (v < e.min) { e.min = v; e.pmin = tip; }
        lineExt.set(b.line, e);
        gmax = Math.max(gmax, v); gmin = Math.min(gmin, v);
      }
      for (let k = 0; k < xs.length - 1; k++) {
        const vm = (vals[k] + vals[k + 1]) / 2;
        const tri = vm >= 0 ? posTri : negTri;
        tri.push(...pts[k], ...tips[k], ...tips[k + 1], ...pts[k], ...tips[k + 1], ...pts[k + 1]);
        outline.push(...tips[k], ...tips[k + 1]);
      }
      outline.push(...pts[0], ...tips[0], ...pts[xs.length - 1], ...tips[xs.length - 1]);
    });
  }
  diagramFill(vp, group, posTri, negTri, { opacity: 0.42, renderOrder: 3 });
  const ol = vp.lines.make(outline, vp.C.text === '#e9ebf3' ? 0xb8bfd3 : 0x5b6275, 1.3, { opacity: 0.9 });
  if (ol) group.add(ol);
  if (vp.store.view.labelsValues) {
    let n = 0;
    const thr = maxAbs * 0.02;
    for (const [, e] of lineExt) {
      if (n > 400) break;
      if (Math.abs(e.max) > thr) { group.add(label(fmt(comp.q, e.max, { unit: false }), e.pmax, 'pos')); n++; }
      if (Math.abs(e.min) > thr && Math.abs(e.min - e.max) > thr * 0.5) { group.add(label(fmt(comp.q, e.min, { unit: false }), e.pmin, 'neg')); n++; }
    }
  }
  info.extremes = [[t('Max'), fmt(comp.q, gmax)], [t('Min'), fmt(comp.q, gmin)]];
  return info;
}

/* ---------------- reactions ---------------- */
function reactions(vp, group, mesh, res) {
  const C = vp.C, sz = vp.sz;
  const nn = mesh.nodes.length / 3;
  let maxR = 0;
  for (let i = 0; i < nn; i++) if (visNode(vp, i)) maxR = Math.max(maxR, Math.hypot(res.reac[6 * i], res.reac[6 * i + 1], res.reac[6 * i + 2]));
  if (maxR < 1e-12) return;
  const arrows = new ArrowBatch(sz * 0.6, sz * 0.22);
  const segs = [];
  const showLabels = vp.store.view.labelsValues;
  let count = 0;
  for (let i = 0; i < nn; i++) {
    const R = [res.reac[6 * i], res.reac[6 * i + 1], res.reac[6 * i + 2]];
    const m = Math.hypot(...R);
    if (m < maxR * 1e-4 || !visNode(vp, i)) continue;
    const p = nodePos(mesh, i);
    const parts = [];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(R[k]) < maxR * 1e-4) continue;
      const d = [0, 0, 0]; d[k] = Math.sign(R[k]);
      const L = sz * (1.5 + 2.5 * Math.abs(R[k]) / maxR);
      const tail = [p[0] - d[0] * (L + sz * 1.3), p[1] - d[1] * (L + sz * 1.3), p[2] - d[2] * (L + sz * 1.3)];
      const tip = [p[0] - d[0] * sz * 1.3, p[1] - d[1] * sz * 1.3, p[2] - d[2] * sz * 1.3];
      segs.push(...tail, ...tip);
      arrows.add(tip, d, C.react);
      parts.push(`R${'XYZ'[k]} ${fmt('force', R[k], { unit: false })}`);
    }
    if (showLabels && parts.length && count++ < 300) group.add(label(parts.join(' · '), [p[0], p[1], p[2] - sz * 2], 'big'));
  }
  const ln = vp.lines.make(segs, C.react, 2.4);
  if (ln) group.add(ln);
  const a = arrows.build();
  if (a) group.add(a);
}

/* ---------------- mode shapes ---------------- */
function buildMode(vp, group, mesh) {
  const st = vp.store, rv = st.resultView;
  const data = rv.kind === 'modal' ? st.results.modal : st.results.buckling;
  const mode = data?.modes?.[rv.mode];
  if (!mode) return { title: t('Keine Ergebnisse'), empty: true };
  const shape = mode.shape;
  const md = maxDisp(mesh, shape, vp.vis);
  const scale = md > 0 ? (vp.bounds.size * 0.08 / md) * (rv.scale || 1) : 0;
  // colour by normalised displacement
  const nn = mesh.nodes.length / 3;
  const cols = paletteColors(rv.palette);
  const val = (i) => (md > 0 ? Math.hypot(shape[6 * i], shape[6 * i + 1], shape[6 * i + 2]) / md : 0);
  const corner = mesh.shells.length ? [] : null;
  mesh.shells.forEach((s) => s.nodes.forEach((n) => corner.push(colorAt(cols, val(n), rv.levels))));
  const bc = [];
  mesh.beams.forEach((b) => {
    for (let k = 0; k < NSUB; k++) {
      const s0 = k / NSUB, s1 = (k + 1) / NSUB;
      const c0 = colorAt(cols, val(b.n1) * (1 - s0) + val(b.n2) * s0), c1 = colorAt(cols, val(b.n1) * (1 - s1) + val(b.n2) * s1);
      bc.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
    }
  });
  ghostMesh(vp, group, mesh);
  const geo = deformedGeometry(vp, group, mesh, shape, scale, { colorsBeam: bc.length ? bc : null, cornerColors: corner });
  if (rv.animate) {
    setTimeout(() => vp.startAnimation((tt) => geo.update(scale * Math.sin(tt * Math.PI * 2 * 0.7))), 0);
  }
  const title = rv.kind === 'modal' ? t('Eigenform {n}', { n: rv.mode + 1 }) : t('Knickform {n}', { n: rv.mode + 1 });
  const extremes = rv.kind === 'modal'
    ? [[t('Frequenz'), fmt('freq', mode.f)], [t('Periode'), fmt('period', mode.T)]]
    : [[t('Lastfaktor αcr'), mode.lambda.toFixed(3)]];
  return { title, sub: t('normierte Verschiebung'), min: 0, max: 1, palette: rv.palette, levels: rv.levels, q: 'none', extremes };
}
