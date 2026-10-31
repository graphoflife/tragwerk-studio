// Result rendering: deformed shapes, contours, beam diagrams, reactions, mode animation, design results.
import * as THREE from 'three';
import { paletteColors, colorAt, label, ArrowBatch } from './vp-util.js';
import { componentDef, getCase, DESIGN_COMPONENTS, caseLabel } from './results-data.js';
import { providedAreas } from '../design/concrete.js';
import { slabSuggestion, beamSuggestion, meshText, barsText, stirrupText, layerName, checkName } from './design-text.js';
import { fmt } from '../core/units.js';
import { sampleSection, sectionValues } from '../core/seclines.js';
import { t } from '../i18n.js';

const NSUB = 8;

export function buildResults(vp, group) {
  const st = vp.store, rv = st.resultView, R = st.results;
  const mesh = R.mesh;
  if (!mesh) return null;
  vp.vis = meshVisibility(st, mesh);
  let info = null;
  if (rv.kind === 'static' || rv.kind === 'spectrum') info = buildStatic(vp, group, mesh);
  else if (rv.kind === 'modal' || rv.kind === 'buckling') info = buildMode(vp, group, mesh);
  else if (rv.kind === 'steel' || rv.kind === 'timber') info = buildUtil(vp, group, mesh);
  else if (rv.kind === 'rc') info = buildRC(vp, group, mesh);
  if (info && st.model.sectionLines?.length) drawSectionLines(vp, group, mesh, info);
  return info;
}

/* ---------------- section lines (Schnittlinien) ---------------- */
// Corner value source of the current result component for section diagrams, or null when the
// component has no surface values (beam forces, mode shapes, utilisation …).
// integralQ: quantity of ∫ v ds (kNm/m → kNm, kN/m → kN, cm²/m → cm²), null if not meaningful.
export function sectionSource(st) {
  const rv = st.resultView, R = st.results, mesh = R.mesh;
  if (!mesh?.shells?.length || !rv.kind) return null;
  if (rv.kind === 'static' || rv.kind === 'spectrum') {
    const comp = componentDef(rv.component), cs = getCase(st, rv.caseKey);
    if (!comp || !cs) return null;
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
  }
  if (rv.kind === 'rc' && R.rc?.asCorner) {
    const comp = DESIGN_COMPONENTS.rc.find((c) => c.key === rv.component);
    if (comp?.kind === 'shear') return { f: (e, k) => { const v = R.rc.vRatio[e * 4 + k]; return v < 0 ? null : v; }, q: 'percent', name: 'vEd/vRd,c', integralQ: null, down: false };
    if (comp?.kind === 'rc') {
      const prov = new Map(st.model.domains.map((d) => [d.id, d.rcProv ? providedAreas(d.rcProv) : null]));
      const mode = rv.rcMode === 'prov' || rv.rcMode === 'miss' ? rv.rcMode : 'req';
      const f = (e, k) => {
        const req = R.rc.asCorner[(e * 4 + k) * 4 + comp.c], pv = prov.get(mesh.shells[e].domain);
        const have = pv ? pv[comp.c] : 0;
        return mode === 'req' ? req : mode === 'prov' ? have : Math.max(0, req - have);
      };
      return { f, q: 'reinf', name: comp.key, integralQ: 'reinfBeam', down: false };
    }
  }
  return null;
}

const sampleCache = new WeakMap();
export function sectionSample(mesh, sl) {
  let m = sampleCache.get(mesh);
  if (!m) { m = new Map(); sampleCache.set(mesh, m); }
  const key = `${sl.a.join(',')}|${sl.b.join(',')}`;
  if (!m.has(key)) m.set(key, sampleSection(mesh, sl.a, sl.b));
  return m.get(key);
}

function drawSectionLines(vp, group, mesh, info) {
  const st = vp.store, rv = st.resultView;
  const src = sectionSource(st);
  // follow the deformed surface when the deformed shape is shown
  const cs = (rv.kind === 'static' || rv.kind === 'spectrum') && info?.scaleUsed > 0 ? getCase(st, rv.caseKey) : null;
  const disp = cs?.res?.disp, dsc = info?.scaleUsed || 0;
  const onSurface = (pt) => {
    if (!disp || !pt.hit) return pt.p;
    const sh = mesh.shells[pt.hit.e];
    return pt.p.map((x, j) => x + dsc * pt.hit.k.reduce((a, k, i) => a + pt.hit.w[i] * disp[6 * sh.nodes[k] + j], 0));
  };
  const lines = st.model.sectionLines.filter((sl) => sl.on !== false);
  const base = [];
  const data = lines.map((sl) => {
    base.push(...sl.a, ...sl.b);
    if (!src) return null;
    const smp = sectionSample(mesh, sl);
    // hidden elements (parts) give no values
    const vals = sectionValues(smp, (e, k) => (visShell(vp, e) ? src.f(e, k) : null));
    return { sl, smp, vals };
  }).filter(Boolean);
  const bl = vp.lines.make(base, vp.C.sel, 2.2, { dashed: true, dashSize: vp.sz * 0.8, gapSize: vp.sz * 0.5, depthTest: false });
  if (bl) { bl.renderOrder = 6; group.add(bl); }
  for (const sl of lines) group.add(label(sl.name, sl.a, 'big'));
  if (!src || !data.length) return;
  let maxAbs = 0;
  for (const d of data) for (const v of d.vals) if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v));
  if (maxAbs < 1e-12) return;
  const sc = vp.sz * 5 * (rv.diagramScale || 1) / maxAbs * (src.down ? -1 : 1);
  const posTri = [], negTri = [], outline = [];
  for (const { smp, vals } of data) {
    let iMax = -1, iMin = -1;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v == null) continue;
      if (iMax < 0 || v > vals[iMax]) iMax = i;
      if (iMin < 0 || v < vals[iMin]) iMin = i;
      const u = vals[i + 1];
      if (u == null || i + 1 >= vals.length) continue;
      const pa = smp.pts[i], pb = smp.pts[i + 1];
      const ba = onSurface(pa), bb = onSurface(pb);
      const ta = ba.map((x, j) => x + pa.hit.ez[j] * v * sc), tb = bb.map((x, j) => x + pb.hit.ez[j] * u * sc);
      const tri = (v + u) / 2 >= 0 ? posTri : negTri;
      tri.push(...ba, ...ta, ...tb, ...ba, ...tb, ...bb);
      outline.push(...ta, ...tb);
      if (i % 8 === 0) outline.push(...ba, ...ta);
    }
    const tipOf = (i) => onSurface(smp.pts[i]).map((x, j) => x + smp.pts[i].hit.ez[j] * vals[i] * sc);
    if (iMax >= 0) group.add(label(fmt(src.q, vals[iMax]), tipOf(iMax), 'big ' + (vals[iMax] >= 0 ? 'pos' : 'neg')));
    if (iMin >= 0 && iMin !== iMax && Math.abs(vals[iMin] - vals[iMax]) > maxAbs * 0.05) group.add(label(fmt(src.q, vals[iMin]), tipOf(iMin), 'big ' + (vals[iMin] >= 0 ? 'pos' : 'neg')));
  }
  for (const [tri, col] of [[posTri, vp.C.pos], [negTri, vp.C.neg]]) {
    if (!tri.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const msh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    msh.renderOrder = 4;
    group.add(msh);
  }
  const ol = vp.lines.make(outline, vp.C.text === '#e9ebf3' ? 0xd5dae8 : 0x3d4354, 1.4, { opacity: 0.95 });
  if (ol) group.add(ol);
}

// Results are drawn (and their extremes taken) only for visible elements – hidden objects and the
// part filter (Teile/Geschosse) apply to results as in AxisVM. null = everything visible.
function meshVisibility(st, mesh) {
  const h = st.view.hidden;
  if (!h.lines.size && !h.domains.size && !h.nodes.size) return null;
  const beam = Uint8Array.from(mesh.beams, (b) => (b.line != null && h.lines.has(b.line) ? 0 : 1));
  const shell = Uint8Array.from(mesh.shells, (s) => (h.domains.has(s.domain) ? 0 : 1));
  const node = new Uint8Array(mesh.nodes.length / 3);
  mesh.beams.forEach((b, i) => { if (beam[i]) { node[b.n1] = 1; node[b.n2] = 1; } });
  mesh.shells.forEach((s, e) => { if (shell[e]) s.nodes.forEach((n) => { node[n] = 1; }); });
  return { beam, shell, node };
}
const visBeam = (vp, i) => !vp.vis || vp.vis.beam[i] === 1;
const visShell = (vp, e) => !vp.vis || vp.vis.shell[e] === 1;
const visNode = (vp, i) => !vp.vis || vp.vis.node[i] === 1;

/* ---------------- deformation field ---------------- */
function nodePos(mesh, i) { const X = mesh.nodes; return [X[3 * i], X[3 * i + 1], X[3 * i + 2]]; }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Base points and displacement vectors along every mesh beam (Hermite interpolation of nodal dofs)
function beamCurves(mesh, disp) {
  const nb = mesh.beams.length;
  const base = new Float32Array(nb * (NSUB + 1) * 3), dv = new Float32Array(nb * (NSUB + 1) * 3);
  mesh.beams.forEach((b, bi) => {
    const p1 = nodePos(mesh, b.n1), p2 = nodePos(mesh, b.n2);
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const loc = (n) => {
      const tr = [disp[6 * n], disp[6 * n + 1], disp[6 * n + 2]], ro = [disp[6 * n + 3], disp[6 * n + 4], disp[6 * n + 5]];
      return { u: [dot(b.ex, tr), dot(b.ey, tr), dot(b.ez, tr)], r: [dot(b.ex, ro), dot(b.ey, ro), dot(b.ez, ro)] };
    };
    const a = loc(b.n1), c = loc(b.n2);
    const flex = b.type === 'beam' || b.type === 'rib';
    for (let k = 0; k <= NSUB; k++) {
      const s = k / NSUB, o = (bi * (NSUB + 1) + k) * 3;
      const ux = a.u[0] * (1 - s) + c.u[0] * s;
      let v, w;
      if (flex) {
        const N1 = 1 - 3 * s * s + 2 * s * s * s, N2 = s - 2 * s * s + s * s * s, N3 = 3 * s * s - 2 * s * s * s, N4 = -s * s + s * s * s;
        v = N1 * a.u[1] + N2 * L * a.r[2] + N3 * c.u[1] + N4 * L * c.r[2];
        w = N1 * a.u[2] - N2 * L * a.r[1] + N3 * c.u[2] - N4 * L * c.r[1];
      } else { v = a.u[1] * (1 - s) + c.u[1] * s; w = a.u[2] * (1 - s) + c.u[2] * s; }
      for (let j = 0; j < 3; j++) {
        base[o + j] = p1[j] + (p2[j] - p1[j]) * s;
        dv[o + j] = b.ex[j] * ux + b.ey[j] * v + b.ez[j] * w;
      }
    }
  });
  return { base, dv };
}

function maxDisp(mesh, disp, vis = null) {
  let m = 0;
  const nn = mesh.nodes.length / 3;
  for (let i = 0; i < nn; i++) if (!vis || vis.node[i]) m = Math.max(m, Math.hypot(disp[6 * i], disp[6 * i + 1], disp[6 * i + 2]));
  return m;
}

// Builds deformed beams (fat lines) + shell surface; returns updater for animation.
function deformedGeometry(vp, group, mesh, disp, scale, { colorsBeam = null, cornerColors = null, ghostShell = false, beamColor } = {}) {
  const C = vp.C;
  const { base, dv } = beamCurves(mesh, disp);
  const beamIdx = mesh.beams.map((_, i) => i).filter((i) => visBeam(vp, i));
  const segCount = beamIdx.length * NSUB;
  const pos = new Float32Array(segCount * 6);
  if (colorsBeam && beamIdx.length !== mesh.beams.length) colorsBeam = beamIdx.flatMap((bi) => colorsBeam.slice(bi * NSUB * 6, (bi + 1) * NSUB * 6));
  const updBeams = (f) => {
    let o = 0;
    for (const bi of beamIdx) {
      for (let k = 0; k < NSUB; k++) {
        const i0 = (bi * (NSUB + 1) + k) * 3, i1 = i0 + 3;
        for (let j = 0; j < 3; j++) { pos[o + j] = base[i0 + j] + f * dv[i0 + j]; pos[o + 3 + j] = base[i1 + j] + f * dv[i1 + j]; }
        o += 6;
      }
    }
  };
  updBeams(scale);
  let beamLine = null;
  if (segCount) {
    beamLine = vp.lines.make(Array.from(pos), beamColor ?? C.beam, 3, { vertexColors: colorsBeam });
    beamLine.frustumCulled = false;
    group.add(beamLine);
  }
  // shells
  const shellIdx = mesh.shells.map((_, e) => e).filter((e) => visShell(vp, e));
  const ns = shellIdx.length;
  let shellMesh = null, sBase = null, sDv = null, sPos = null, edgeLine = null, ePos = null, eBase = null, eDv = null;
  if (ns) {
    const nv = ns * 6;
    sBase = new Float32Array(nv * 3); sDv = new Float32Array(nv * 3); sPos = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3);
    const corner = [0, 1, 2, 0, 2, 3];
    const shellCol = new THREE.Color(C.shell);
    const edges = [];
    shellIdx.forEach((e, ei) => {
      const s = mesh.shells[e];
      corner.forEach((k, j) => {
        const n = s.nodes[k], o = (ei * 6 + j) * 3;
        for (let q = 0; q < 3; q++) { sBase[o + q] = mesh.nodes[3 * n + q]; sDv[o + q] = disp[6 * n + q]; }
        const c = cornerColors ? cornerColors[e * 4 + k] : (C[s.type] != null ? new THREE.Color(C[s.type]) : shellCol);
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      });
      for (let k = 0; k < 4; k++) edges.push(s.nodes[k], s.nodes[(k + 1) % 4]);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: !cornerColors, opacity: cornerColors ? 1 : (ghostShell ? 0.25 : 0.55),
      depthWrite: !!cornerColors, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    shellMesh = new THREE.Mesh(geo, mat);
    shellMesh.frustumCulled = false;
    group.add(shellMesh);
    // element edges (thin)
    if (vp.store.view.showMesh || !cornerColors) {
      eBase = new Float32Array(edges.length * 3); eDv = new Float32Array(edges.length * 3); ePos = new Float32Array(edges.length * 3);
      edges.forEach((n, i) => { for (let q = 0; q < 3; q++) { eBase[3 * i + q] = mesh.nodes[3 * n + q]; eDv[3 * i + q] = disp[6 * n + q]; } });
      for (let i = 0; i < ePos.length; i++) ePos[i] = eBase[i] + scale * eDv[i];
      edgeLine = vp.lines.make(Array.from(ePos), C.mesh, 0.8, { opacity: 0.45 });
      if (edgeLine) { edgeLine.frustumCulled = false; group.add(edgeLine); }
    }
  }
  const updShells = (f) => {
    if (!shellMesh) return;
    for (let i = 0; i < sPos.length; i++) sPos[i] = sBase[i] + f * sDv[i];
    shellMesh.geometry.attributes.position.needsUpdate = true;
    if (edgeLine) {
      for (let i = 0; i < ePos.length; i++) ePos[i] = eBase[i] + f * eDv[i];
      const d = edgeLine.geometry.attributes.instanceStart.data;
      d.array.set(ePos); d.needsUpdate = true;
    }
  };
  updShells(scale);
  return {
    update(f) {
      updBeams(f);
      if (beamLine) { const d = beamLine.geometry.attributes.instanceStart.data; d.array.set(pos); d.needsUpdate = true; }
      updShells(f);
    },
  };
}

function autoScale(vp, mesh, disp, mult) {
  const m = maxDisp(mesh, disp, vp.vis);
  if (m < 1e-14) return 0;
  return (vp.bounds.size * 0.06 / m) * (mult || 1);
}

/* ---------------- static results ---------------- */
function buildStatic(vp, group, mesh) {
  const st = vp.store, rv = st.resultView;
  const cs = getCase(st, rv.caseKey);
  if (!cs) return { title: t('Keine Ergebnisse'), empty: true };
  const comp = componentDef(rv.component) || componentDef('deformed');
  const res = cs.res || (rv.envSide === 'min' ? cs.min : cs.max);
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

function fixRange(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [0, 1];
  if (Math.abs(b - a) < 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))) return [a - 1e-9 - Math.abs(a) * 0.01, b + 1e-9 + Math.abs(b) * 0.01];
  return [a, b];
}

function usedNodes(mesh) {
  const used = new Uint8Array(mesh.nodes.length / 3);
  for (const b of mesh.beams) { used[b.n1] = 1; used[b.n2] = 1; }
  for (const s of mesh.shells) for (const n of s.nodes) if (n >= 0) used[n] = 1;
  return used;
}

function ghostMesh(vp, group, mesh) {
  const pos = [];
  const X = mesh.nodes;
  mesh.beams.forEach((b, i) => { if (visBeam(vp, i)) pos.push(X[3 * b.n1], X[3 * b.n1 + 1], X[3 * b.n1 + 2], X[3 * b.n2], X[3 * b.n2 + 1], X[3 * b.n2 + 2]); });
  const ln = vp.lines.make(pos, vp.C.ghost, 1.2, { opacity: 0.8 });
  if (ln) group.add(ln);
}

function extremeLabels(vp, group, mesh, disp, scale, items, q) {
  if (!vp.store.view.labelsValues) return;
  const seen = new Set();
  for (const [n, v] of items) {
    if (seen.has(n)) continue;
    seen.add(n);
    const p = nodePos(mesh, n).map((x, j) => x + scale * disp[6 * n + j]);
    group.add(label(fmt(q, v), p, 'big ' + (v >= 0 ? 'pos' : 'neg')));
  }
}

/* ---------------- beam diagrams ---------------- */
function beamDiagrams(vp, group, mesh, cs, comp, rv) {
  const C = vp.C;
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
  for (const [tri, col] of [[posTri, C.pos], [negTri, C.neg]]) {
    if (!tri.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }));
    m.renderOrder = 3;
    group.add(m);
  }
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

/* ---------------- design: utilisation ---------------- */
function buildUtil(vp, group, mesh) {
  const st = vp.store, rv = st.resultView;
  const list = rv.kind === 'steel' ? st.results.steel : st.results.timber;
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

/* ---------------- design: RC ---------------- */
const RC_MODE_SUB = { req: 'erforderliche Bewehrung', prov: 'vorhandene Bewehrung', miss: 'fehlende Bewehrung (Zulage)' };
const GRAY = { r: 0.72, g: 0.74, b: 0.78 };

function cornerPos(mesh, k) {
  const nd = mesh.shells[Math.floor(k / 4)].nodes[k % 4];
  return [mesh.nodes[3 * nd], mesh.nodes[3 * nd + 1], mesh.nodes[3 * nd + 2]];
}

function buildRC(vp, group, mesh) {
  const st = vp.store, rv = st.resultView;
  const code = st.model.settings.code === 'SIA' ? 'SIA' : 'EC';
  const comp = DESIGN_COMPONENTS.rc.find((c) => c.key === rv.component) || DESIGN_COMPONENTS.rc[0];
  const cols = paletteColors(rv.palette);
  if (comp.kind === 'rcbeam') return buildRCBeams(vp, group, mesh, comp, cols, code);
  if (comp.kind === 'punch') return buildPunching(vp, group, mesh);
  const rc = st.results.rc;
  if (!rc?.asCorner || !mesh.shells.length) return { title: t(comp.label), empty: true, msg: t('Keine Bemessungsergebnisse für Flächen – „Flächen bemessen“ ausführen.') };
  if (comp.kind === 'shear') {
    const util = paletteColors('utilization');
    let mx = 0, n = 0, nz = 0;
    const corner = [];
    for (let k = 0; k < mesh.shells.length * 4; k++) {
      const r = rc.vRatio[k];
      if (r < 0) { corner.push(GRAY); nz++; continue; }
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
  // reinforcement layer: required / provided / missing
  const mode = rv.rcMode === 'prov' || rv.rcMode === 'miss' ? rv.rcMode : 'req';
  const provOf = new Map(st.model.domains.map((d) => [d.id, d.rcProv ? providedAreas(d.rcProv) : null]));
  const A = rc.asCorner, nS = mesh.shells.length;
  const vals = new Float64Array(nS * 4);
  let anyProv = false;
  for (let e = 0; e < nS; e++) {
    const pv = provOf.get(mesh.shells[e].domain);
    if (pv) anyProv = true;
    for (let c = 0; c < 4; c++) {
      const req = A[(e * 4 + c) * 4 + comp.c], have = pv ? pv[comp.c] : 0;
      vals[e * 4 + c] = mode === 'req' ? req : mode === 'prov' ? have : Math.max(0, req - have);
    }
  }
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

function buildRCBeams(vp, group, mesh, comp, cols, code) {
  const st = vp.store, rv = st.resultView;
  const list = st.results.rcBeams || [];
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

function buildPunching(vp, group, mesh) {
  const st = vp.store;
  const P = st.results.punching;
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
