// Supports, loads and local-axis glyphs for the viewport.
import * as THREE from 'three';
import { ArrowBatch, label } from './vp-util.js';
import { V, P, lineAxes, domainAxes, centroid } from '../core/model.js';
import { fmt } from '../core/units.js';
import { surfaceQ } from '../fem/loads.js';
import { t } from '../i18n.js';

const DIRS = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

export function loadDirection(dir, ax) {
  if (DIRS[dir]) return DIRS[dir];
  if (dir === 'x') return ax.ex;
  if (dir === 'y') return ax.ey;
  return ax.ez;
}

/* ---------------- supports ---------------- */
// Every glyph registers pick primitives in vp.glyphPicks: { kind, id, segs:[[a,b]], pts:[p] }
function picker(vp, kind, id) {
  const e = { kind, id, segs: [], pts: [] };
  vp.glyphPicks.push(e);
  return e;
}

export function buildSupports(vp, group) {
  const { model, idx } = vp.store;
  const C = vp.C, sz = vp.sz;
  const segs = [];
  const coneGeo = new THREE.ConeGeometry(sz * 0.55, sz * 1.1, 4);
  coneGeo.rotateX(Math.PI / 2); coneGeo.rotateZ(Math.PI / 4);
  coneGeo.translate(0, 0, -sz * 0.55);
  const boxGeo = new THREE.BoxGeometry(sz * 1.1, sz * 1.1, sz * 0.7);
  boxGeo.translate(0, 0, -sz * 0.35);
  const springGeo = new THREE.CylinderGeometry(sz * 0.18, sz * 0.18, sz * 1.1, 10);
  springGeo.rotateX(Math.PI / 2); springGeo.translate(0, 0, -sz * 0.55);
  const mat = new THREE.MeshLambertMaterial({ color: C.support, emissive: C.support, emissiveIntensity: 0.35 });
  const matSpring = new THREE.MeshLambertMaterial({ color: C.spring, emissive: C.spring, emissiveIntensity: 0.35 });
  const hidden = vp.store.view.hidden;

  for (const s of model.supports) {
    if (s.type === 'node') {
      const n = idx.nodes.get(s.node);
      if (!n || hidden.nodes.has(n.id)) continue;
      const d = s.dofs || [];
      const ft = d.slice(0, 3).filter((x) => x === 'F').length;
      const fr = d.slice(3).filter((x) => x === 'F').length;
      const springs = d.some((x) => typeof x === 'number' && x > 0);
      let mesh;
      if (ft === 3 && fr === 3) mesh = new THREE.Mesh(boxGeo, mat);
      else if (ft === 0 && springs) mesh = new THREE.Mesh(springGeo, matSpring);
      else mesh = new THREE.Mesh(coneGeo, ft === 3 ? mat : matSpring);
      mesh.position.set(n.x, n.y, n.z);
      group.add(mesh);
      const pk = picker(vp, 'support', s.id);
      pk.pts.push([n.x, n.y, n.z - sz * 0.6]);
      pk.segs.push([[n.x, n.y, n.z - sz * 0.25], [n.x, n.y, n.z - sz * 1.1]]);
      if (ft < 3 && ft > 0) {
        // roller: base line
        segs.push(n.x - sz * 0.7, n.y, n.z - sz * 1.35, n.x + sz * 0.7, n.y, n.z - sz * 1.35);
      }
      if (s.uplift) group.add(label('↑', [n.x + sz * 0.6, n.y, n.z - sz], 'small'));
    } else if (s.type === 'line') {
      const l = idx.lines.get(s.line);
      if (!l || hidden.lines.has(l.id)) continue;
      const a = P(idx.nodes.get(l.n1)), b = P(idx.nodes.get(l.n2));
      const L = V.dist(a, b);
      let off = [0, 0, -sz * 1.1];
      if (Math.abs(b[2] - a[2]) > 0.95 * L) off = [-sz * 1.1, 0, 0];
      const n = Math.max(2, Math.min(14, Math.round(L / (sz * 2.5))));
      const pk = picker(vp, 'support', s.id);
      for (let i = 0; i <= n; i++) {
        const p = V.lerp(a, b, i / n);
        const tip = p, base = V.add(p, off);
        segs.push(...tip, ...base);
      }
      segs.push(...V.add(a, off), ...V.add(b, off));
      const off2 = V.mul(off, 1.25);
      segs.push(...V.add(a, off2), ...V.add(b, off2));
      pk.segs.push([V.add(a, off), V.add(b, off)], [V.add(a, off2), V.add(b, off2)]);
    } else if (s.type === 'surface') {
      const d = idx.domains.get(s.domain);
      if (!d || hidden.domains.has(d.id)) continue;
      const pts = d.nodes.map((id) => P(idx.nodes.get(id)));
      const ax = domainAxes(pts);
      const off = V.mul(ax.ez, -sz * 0.9);
      const pk = picker(vp, 'support', s.id);
      for (let i = 0; i < pts.length; i++) {
        const p = V.add(pts[i], off), q = V.add(pts[(i + 1) % pts.length], off);
        segs.push(...p, ...q);
        segs.push(...pts[i], ...p);
        pk.segs.push([p, q]);
      }
      const c = centroid(pts);
      segs.push(...c, ...V.add(c, off));
      pk.pts.push(V.add(c, off));
    }
  }
  const ln = vp.lines.make(segs, C.support, 2);
  if (ln) group.add(ln);
}

/* ---------------- loads ---------------- */
export function buildLoads(vp, group, lcId) {
  const { model, idx } = vp.store;
  const C = vp.C, sz = vp.sz;
  const hidden = vp.store.view.hidden;
  const showVals = vp.store.view.labelsValues;
  const loads = model.loads.filter((l) => l.lc === lcId);
  if (!loads.length) return;
  const maxF = Math.max(1e-9, ...loads.filter((l) => l.type === 'node').map((l) => Math.hypot(l.F[0], l.F[1], l.F[2])),
    ...loads.filter((l) => (l.type === 'linePoint' && !l.moment) || l.type === 'surfacePoint').map((l) => Math.abs(l.F)));
  const maxM = Math.max(1e-9, ...loads.filter((l) => l.type === 'node').map((l) => Math.hypot(l.F[3], l.F[4], l.F[5])),
    ...loads.filter((l) => l.type === 'linePoint' && l.moment).map((l) => Math.abs(l.F)));
  const maxQ = Math.max(1e-9, ...loads.filter((l) => l.type === 'lineDist' || l.type === 'surfaceLine').map((l) => Math.max(Math.abs(l.q1), Math.abs(l.q2 ?? l.q1))));
  // largest surface load intensity (variable loads: evaluated at the domain corners)
  const surfMax = (l) => {
    if (!l.dist || l.dist === 'const') return Math.abs(l.q);
    const d = idx.domains.get(l.domain);
    return Math.max(0, ...(d?.nodes || []).map((id) => Math.abs(surfaceQ(l, P(idx.nodes.get(id))))));
  };
  const maxS = Math.max(1e-9, ...loads.filter((l) => l.type === 'surface').map(surfMax));
  const len = (v, max) => sz * (1.4 + 2.6 * Math.min(1, Math.abs(v) / max));

  const arrows = new ArrowBatch(sz * 0.55, sz * 0.2);
  const segs = [], msegs = [], tsegs = [];
  let pk = null; // pick entry of the load being drawn
  const arrow = (tip, dir, L, color = C.load, store = segs) => {
    const d = V.norm(dir), tail = V.sub(tip, V.mul(d, L));
    store.push(...tail, ...V.sub(tip, V.mul(d, sz * 0.5)));
    arrows.add(tip, d, color);
    pk?.segs.push([tail, V.sub(tip, V.mul(d, sz * 0.5))]);
    return tail;
  };
  const dblArrow = (p, dir, L) => {
    const d = V.norm(dir), tail = V.sub(p, V.mul(d, L));
    msegs.push(...p, ...tail);
    arrows.add(V.add(tail, V.mul(d, sz * 0.55)), V.mul(d, -1), C.moment);
    arrows.add(tail, V.mul(d, -1), C.moment);
    pk?.segs.push([V.add(p, V.mul(d, -sz * 0.4)), tail]);
    return tail;
  };
  const lab = (txt, p, cls) => { if (showVals) group.add(label(txt, p, 'big ' + (cls || ''))); };

  for (const ld of loads) {
    pk = picker(vp, 'load', ld.id);
    if (ld.type === 'node' || ld.type === 'nodeDisp') {
      const n = idx.nodes.get(ld.node);
      if (!n || hidden.nodes.has(n.id)) continue;
      const p = P(n);
      if (ld.type === 'nodeDisp') {
        const d = ld.d.slice(0, 3);
        if (V.len(d) > 0) {
          const tail = arrow(p, d, sz * 2.2, C.temp);
          lab('δ ' + fmt('disp', V.len(d)), tail);
        }
        continue;
      }
      const F = ld.F.slice(0, 3), M = ld.F.slice(3);
      const fl = V.len(F), ml = V.len(M);
      if (fl > 0) {
        const tail = arrow(p, F, len(fl, maxF));
        lab(fmt('force', fl), tail);
      }
      if (ml > 0) {
        const tail = dblArrow(p, M, len(ml, maxM));
        lab(fmt('moment', ml), tail, 'mom');
      }
    } else if (ld.type === 'lineDist' || ld.type === 'linePoint' || ld.type === 'tempLine') {
      const l = idx.lines.get(ld.line);
      if (!l || hidden.lines.has(l.id)) continue;
      const a = P(idx.nodes.get(l.n1)), b = P(idx.nodes.get(l.n2));
      const ax = lineAxes(a, b, l.element?.beta || 0);
      if (ld.type === 'tempLine') {
        const off = V.mul(ax.ez, sz * 0.7), a2 = V.add(a, off), b2 = V.add(b, off);
        tsegs.push(...a2, ...b2);
        pk.segs.push([a2, b2]);
        lab(`ΔT ${fmt('temp', ld.dT || 0)}${ld.dTz ? ' / ΔTz ' + fmt('temp', ld.dTz) : ''}`, V.lerp(a2, b2, 0.5), 'temp');
        continue;
      }
      const dv = loadDirection(ld.dir, ax);
      if (ld.type === 'linePoint') {
        const p = V.lerp(a, b, ld.pos ?? 0.5);
        if (ld.moment) {
          const tail = dblArrow(p, V.mul(dv, Math.sign(ld.F) || 1), len(ld.F, maxM));
          lab(fmt('moment', Math.abs(ld.F)), tail);
        } else {
          const tail = arrow(p, V.mul(dv, Math.sign(ld.F) || 1), len(ld.F, maxF));
          lab(fmt('force', Math.abs(ld.F)), tail);
        }
        continue;
      }
      const ta = ld.a ?? 0, tb = ld.b ?? 1;
      const Lseg = V.dist(a, b) * (tb - ta);
      const n = Math.max(2, Math.min(24, Math.round(Lseg / (sz * 1.6))));
      const tails = [];
      for (let i = 0; i <= n; i++) {
        const s = i / n, tt = ta + (tb - ta) * s, q = ld.q1 + (ld.q2 - ld.q1) * s;
        const p = V.lerp(a, b, tt);
        if (Math.abs(q) < 1e-12) { tails.push(p); continue; }
        tails.push(arrow(p, V.mul(dv, Math.sign(q)), len(q, maxQ)));
      }
      for (let i = 0; i < tails.length - 1; i++) { segs.push(...tails[i], ...tails[i + 1]); pk.segs.push([tails[i], tails[i + 1]]); }
      if (Math.abs(ld.q1 - ld.q2) < 1e-9) lab(fmt('lineLoad', Math.abs(ld.q1)), V.lerp(tails[0], tails[tails.length - 1], 0.5));
      else { lab(fmt('lineLoad', Math.abs(ld.q1)), tails[0]); lab(fmt('lineLoad', Math.abs(ld.q2)), tails[tails.length - 1]); }
    } else if (ld.type === 'surfaceLine' || ld.type === 'surfacePoint') {
      const d = idx.domains.get(ld.domain);
      if (!d || hidden.domains.has(d.id)) continue;
      const ax = domainAxes(d.nodes.map((id) => P(idx.nodes.get(id))));
      const dv = loadDirection(ld.dir, ax);
      if (ld.type === 'surfacePoint') {
        const tail = arrow(ld.p, V.mul(dv, Math.sign(ld.F) || 1), len(ld.F, maxF));
        lab(fmt('force', Math.abs(ld.F)), tail);
        continue;
      }
      const q2 = ld.q2 ?? ld.q1;
      const n = Math.max(2, Math.min(24, Math.round(V.dist(ld.a, ld.b) / (sz * 1.6))));
      const tails = [];
      for (let i = 0; i <= n; i++) {
        const f = i / n, q = ld.q1 + (q2 - ld.q1) * f, p = V.lerp(ld.a, ld.b, f);
        tails.push(Math.abs(q) < 1e-12 ? p : arrow(p, V.mul(dv, Math.sign(q)), len(q, maxQ)));
      }
      for (let i = 0; i < tails.length - 1; i++) { segs.push(...tails[i], ...tails[i + 1]); pk.segs.push([tails[i], tails[i + 1]]); }
      segs.push(...ld.a, ...ld.b);
      if (Math.abs(ld.q1 - q2) < 1e-9) lab(fmt('lineLoad', Math.abs(ld.q1)), V.lerp(tails[0], tails[tails.length - 1], 0.5));
      else { lab(fmt('lineLoad', Math.abs(ld.q1)), tails[0]); lab(fmt('lineLoad', Math.abs(q2)), tails[tails.length - 1]); }
    } else if (ld.type === 'surface' && ld.dist && ld.dist !== 'const') {
      // variable surface load: arrows scaled with the local intensity
      const d = idx.domains.get(ld.domain);
      if (!d || hidden.domains.has(d.id)) continue;
      const pts = d.nodes.map((id) => P(idx.nodes.get(id)));
      const ax = domainAxes(pts);
      const dir0 = loadDirection(ld.dir, ax);
      const samples = samplePolygon(pts, (d.holes || []).map((hh) => hh.map((id) => P(idx.nodes.get(id)))), ax, sz * 2.5);
      let qmax = 0, pmax = null;
      for (const p of samples) {
        const q = surfaceQ(ld, p);
        if (Math.abs(q) < 1e-9) continue;
        const tail = arrow(p, V.mul(dir0, Math.sign(q)), len(q, maxS));
        if (Math.abs(q) > qmax) { qmax = Math.abs(q); pmax = tail; }
      }
      if (pmax) lab(`${fmt('areaLoad', qmax)} (${ld.dist === 'hydro' ? t('hydrostatisch') : t('linear')})`, pmax);
    } else if (ld.type === 'surface' || ld.type === 'tempDomain') {
      const d = idx.domains.get(ld.domain);
      if (!d || hidden.domains.has(d.id)) continue;
      const pts = d.nodes.map((id) => P(idx.nodes.get(id)));
      const ax = domainAxes(pts);
      const c = centroid(pts);
      if (ld.type === 'tempDomain') {
        const off = V.mul(ax.ez, sz * 0.5);
        for (let i = 0; i < pts.length; i++) {
          const p = V.add(pts[i], off), q = V.add(pts[(i + 1) % pts.length], off);
          tsegs.push(...p, ...q);
          pk.segs.push([p, q]);
        }
        lab(`ΔT ${fmt('temp', ld.dT || 0)}${ld.dTz ? ' / ΔTz ' + fmt('temp', ld.dTz) : ''}`, V.add(c, off), 'temp');
        continue;
      }
      const dv = V.mul(loadDirection(ld.dir, ax), Math.sign(ld.q) || 1);
      const L = len(ld.q, maxS);
      const samples = samplePolygon(pts, (d.holes || []).map((hh) => hh.map((id) => P(idx.nodes.get(id)))), ax, sz * 3);
      const tails = samples.map((p) => arrow(p, dv, L));
      // outline of the load plane
      const off = V.mul(dv, -L);
      for (let i = 0; i < pts.length; i++) {
        segs.push(...V.add(pts[i], off), ...V.add(pts[(i + 1) % pts.length], off));
        pk.segs.push([V.add(pts[i], off), V.add(pts[(i + 1) % pts.length], off)]);
      }
      lab(fmt('areaLoad', Math.abs(ld.q)), V.add(c, off));
      if (!tails.length) arrow(c, dv, L);
    }
  }
  const ln = vp.lines.make(segs, C.load, 1.6);
  if (ln) group.add(ln);
  const lm = vp.lines.make(msegs, C.moment, 2);
  if (lm) group.add(lm);
  const lt = vp.lines.make(tsegs, C.temp, 5, { opacity: 0.6 });
  if (lt) group.add(lt);
  const heads = arrows.build();
  if (heads) group.add(heads);
}

// Sample points on a regular grid inside a planar polygon (local 2D), capped in count
export function samplePolygon(pts, holes, ax, spacing) {
  const o = pts[0];
  const to2 = (p) => [V.dot(V.sub(p, o), ax.ex), V.dot(V.sub(p, o), ax.ey)];
  const poly = pts.map(to2), hp = holes.map((hh) => hh.map(to2));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of poly) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  let step = spacing;
  while ((maxx - minx) / step * (maxy - miny) / step > 120) step *= 1.4;
  const out = [];
  for (let x = minx + step / 2; x < maxx; x += step) {
    for (let y = miny + step / 2; y < maxy; y += step) {
      if (!pointInPoly([x, y], poly) || hp.some((hh) => pointInPoly([x, y], hh))) continue;
      out.push(V.add(V.add(o, V.mul(ax.ex, x)), V.mul(ax.ey, y)));
    }
  }
  return out;
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------------- local axes ---------------- */
export function buildAxes(vp, group) {
  const { model, idx } = vp.store;
  const C = vp.C, s = vp.sz * 1.6;
  const xs = [], ys = [], zs = [];
  const push = (c, ax) => {
    xs.push(...c, ...V.add(c, V.mul(ax.ex, s)));
    ys.push(...c, ...V.add(c, V.mul(ax.ey, s)));
    zs.push(...c, ...V.add(c, V.mul(ax.ez, s)));
  };
  for (const l of model.lines) {
    if (!l.element || vp.store.view.hidden.lines.has(l.id)) continue;
    const a = P(idx.nodes.get(l.n1)), b = P(idx.nodes.get(l.n2));
    push(V.lerp(a, b, 0.5), lineAxes(a, b, l.element.beta || 0));
  }
  for (const d of model.domains) {
    if (vp.store.view.hidden.domains.has(d.id)) continue;
    const pts = d.nodes.map((id) => P(idx.nodes.get(id)));
    push(centroid(pts), domainAxes(pts));
  }
  for (const [arr, col] of [[xs, C.axisX], [ys, C.axisY], [zs, C.axisZ]]) {
    const ln = vp.lines.make(arr, col, 2.2, { depthTest: false });
    if (ln) { ln.renderOrder = 10; group.add(ln); }
  }
}
