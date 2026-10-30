// Model data structure (see SPEC.md §2) and editing operations.
import { t } from '../i18n.js';

export const SUPPORT_PRESETS = {
  fixed: ['F', 'F', 'F', 'F', 'F', 'F'],
  pinned: ['F', 'F', 'F', 0, 0, 0],
  rollerX: [0, 'F', 'F', 0, 0, 0],
  rollerY: ['F', 0, 'F', 0, 0, 0],
  rollerXY: [0, 0, 'F', 0, 0, 0],
  vertical: [0, 0, 'F', 0, 0, 0],
};

export function createModel(name) {
  const now = new Date().toISOString();
  return {
    version: 1,
    meta: { name: name || t('Neues Modell'), author: '', description: '', created: now, modified: now },
    settings: { meshSize: 1.0, beamDivisions: 4, g: 9.81, code: 'EC' },
    nodes: [], lines: [], domains: [], materials: [], sections: [], supports: [],
    loadGroups: [
      { id: 1, name: t('Ständige Lasten'), type: 'permanent', gammaSup: 1.35, gammaInf: 1.0, psi0: 1, psi1: 1, psi2: 1, exclusive: false },
      { id: 2, name: t('Nutzlasten'), type: 'variable', gammaSup: 1.5, gammaInf: 0, psi0: 0.7, psi1: 0.5, psi2: 0.3, exclusive: false },
    ],
    loadCases: [{ id: 1, name: t('Eigengewicht'), group: 1, selfWeight: true }],
    loads: [],
    combinations: [],
  };
}

export function nextId(arr) {
  let m = 0;
  for (const e of arr) if (e.id > m) m = e.id;
  return m + 1;
}

// Fast lookup maps, rebuilt by the store after each change.
export function buildIndex(model) {
  const idx = {
    nodes: new Map(), lines: new Map(), domains: new Map(), materials: new Map(), sections: new Map(),
    loadCases: new Map(), loadGroups: new Map(), combinations: new Map(), supports: new Map(), loads: new Map(),
    nodeLines: new Map(), // node id -> [line ids]
  };
  for (const k of ['nodes', 'lines', 'domains', 'materials', 'sections', 'loadCases', 'loadGroups', 'combinations', 'supports', 'loads']) {
    for (const e of model[k]) idx[k].set(e.id, e);
  }
  for (const l of model.lines) {
    for (const n of [l.n1, l.n2]) {
      if (!idx.nodeLines.has(n)) idx.nodeLines.set(n, []);
      idx.nodeLines.get(n).push(l.id);
    }
  }
  return idx;
}

/* ---------------- vector helpers ---------------- */
export const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  lerp: (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s],
};
export const P = (n) => [n.x, n.y, n.z];

/* ---------------- local axes (SPEC §2.1, §2.2) ---------------- */
export function lineAxes(p1, p2, betaDeg = 0) {
  const ex = V.norm(V.sub(p2, p1));
  let r = [0, 0, 1];
  if (Math.abs(V.dot(ex, r)) > 0.999) r = [1, 0, 0];
  let ey = V.norm(V.cross(r, ex));
  let ez = V.cross(ex, ey);
  if (betaDeg) {
    const b = betaDeg * Math.PI / 180, c = Math.cos(b), s = Math.sin(b);
    const ey2 = V.add(V.mul(ey, c), V.mul(ez, s));
    const ez2 = V.add(V.mul(ez, c), V.mul(ey, -s));
    ey = ey2; ez = ez2;
  }
  return { ex, ey, ez };
}

export function polygonNormal(pts) {
  // Newell's method
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

export function domainAxes(pts) {
  let n = V.norm(polygonNormal(pts));
  const e = 1e-6;
  if (n[2] < -e || (Math.abs(n[2]) <= e && (n[1] < -e || (Math.abs(n[1]) <= e && n[0] < 0)))) n = V.mul(n, -1);
  const proj = (g) => V.sub(g, V.mul(n, V.dot(g, n)));
  let ex = proj([1, 0, 0]);
  if (V.len(ex) < 1e-6) ex = proj([0, 1, 0]);
  ex = V.norm(ex);
  const ey = V.cross(n, ex);
  return { ex, ey, ez: n };
}

export function polygonArea(pts) { return V.len(polygonNormal(pts)) / 2; }

export function centroid(pts) {
  const c = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return V.mul(c, 1 / Math.max(1, pts.length));
}

export function lineLength(model, idx, line) {
  const a = idx.nodes.get(line.n1), b = idx.nodes.get(line.n2);
  return a && b ? V.dist(P(a), P(b)) : 0;
}

export function modelBounds(model) {
  if (!model.nodes.length) return { min: [-5, -5, 0], max: [5, 5, 3], size: 10, center: [0, 0, 1.5] };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const n of model.nodes) {
    const p = P(n);
    for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
  }
  const size = Math.max(V.dist(min, max), 1);
  return { min, max, size, center: V.mul(V.add(min, max), 0.5) };
}

/* ---------------- creation ---------------- */
export function findNodeAt(model, p, tol = 1e-6) {
  for (const n of model.nodes) {
    if (Math.abs(n.x - p[0]) <= tol && Math.abs(n.y - p[1]) <= tol && Math.abs(n.z - p[2]) <= tol) return n;
  }
  return null;
}

const round = (v) => Math.round(v * 1e9) / 1e9;

export function addNode(model, p, tol = 1e-6) {
  const ex = findNodeAt(model, p, tol);
  if (ex) return ex.id;
  const id = nextId(model.nodes);
  model.nodes.push({ id, x: round(p[0]), y: round(p[1]), z: round(p[2]) });
  return id;
}

export function findLine(model, n1, n2) {
  return model.lines.find((l) => (l.n1 === n1 && l.n2 === n2) || (l.n1 === n2 && l.n2 === n1)) || null;
}

export function addLine(model, n1, n2, element = null) {
  if (n1 === n2) return null;
  const ex = findLine(model, n1, n2);
  if (ex) {
    if (element) ex.element = structuredClone(element);
    return ex.id;
  }
  const id = nextId(model.lines);
  model.lines.push({ id, n1, n2, element: element ? structuredClone(element) : null });
  return id;
}

export function addDomain(model, nodeIds, props) {
  const id = nextId(model.domains);
  model.domains.push({ id, nodes: [...nodeIds], holes: [], type: 'shell', thickness: 0.2, material: null, ...props });
  // make sure the boundary edges exist as geometry lines
  for (let i = 0; i < nodeIds.length; i++) addLine(model, nodeIds[i], nodeIds[(i + 1) % nodeIds.length], undefined);
  return id;
}

export function defaultLineElement(type, material, section) {
  const el = { type, material, section, beta: 0, releases: { i: [false, false, false, false, false, false], j: [false, false, false, false, false, false] }, nl: null };
  if (type === 'spring') { el.k = [1e4, 1e4, 1e4, 0, 0, 0]; delete el.section; delete el.material; }
  if (type === 'rigid') { delete el.section; delete el.material; }
  if (type === 'truss') { el.releases = null; }
  return el;
}

/* ---------------- deletion (with cascade) ---------------- */
export function removeEntities(model, { nodes = [], lines = [], domains = [], supports = [], loads = [] }) {
  const nodeSet = new Set(nodes), lineSet = new Set(lines), domSet = new Set(domains);
  const supSet = new Set(supports), loadSet = new Set(loads);
  model.supports = model.supports.filter((s) => !supSet.has(s.id));
  model.loads = model.loads.filter((l) => !loadSet.has(l.id));
  // lines attached to removed nodes
  for (const l of model.lines) if (nodeSet.has(l.n1) || nodeSet.has(l.n2)) lineSet.add(l.id);
  for (const d of model.domains) {
    if (d.nodes.some((n) => nodeSet.has(n))) domSet.add(d.id);
    if (d.holes?.length) d.holes = d.holes.filter((hh) => !hh.some((n) => nodeSet.has(n)));
  }
  model.lines = model.lines.filter((l) => !lineSet.has(l.id));
  model.domains = model.domains.filter((d) => !domSet.has(d.id));
  model.nodes = model.nodes.filter((n) => !nodeSet.has(n.id));
  model.supports = model.supports.filter((s) => !(s.type === 'node' && nodeSet.has(s.node)) && !(s.type === 'line' && lineSet.has(s.line)) && !(s.type === 'surface' && domSet.has(s.domain)));
  model.loads = model.loads.filter((ld) => !(ld.node && nodeSet.has(ld.node)) && !(ld.line && lineSet.has(ld.line)) && !(ld.domain && domSet.has(ld.domain)));
}

// Remove nodes that are not used by any line, domain or support (optional cleanup)
export function removeOrphanNodes(model) {
  const used = new Set();
  for (const l of model.lines) { used.add(l.n1); used.add(l.n2); }
  for (const d of model.domains) { d.nodes.forEach((n) => used.add(n)); (d.holes || []).forEach((hh) => hh.forEach((n) => used.add(n))); }
  for (const s of model.supports) if (s.node) used.add(s.node);
  for (const l of model.loads) if (l.node) used.add(l.node);
  const before = model.nodes.length;
  model.nodes = model.nodes.filter((n) => used.has(n.id));
  return before - model.nodes.length;
}

/* ---------------- geometry operations ---------------- */
// Split a line into n equal parts (or at given relative positions). Element, supports and loads are carried over.
export function splitLine(model, lineId, n = 2, positions) {
  const line = model.lines.find((l) => l.id === lineId);
  if (!line) return [];
  const a = model.nodes.find((x) => x.id === line.n1), b = model.nodes.find((x) => x.id === line.n2);
  const ts = positions || Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
  const ids = [line.n1];
  for (const tt of ts) ids.push(addNode(model, V.lerp(P(a), P(b), tt)));
  ids.push(line.n2);
  const newLines = [];
  const bounds = [0, ...ts, 1];
  for (let i = 0; i < ids.length - 1; i++) {
    const el = line.element ? structuredClone(line.element) : null;
    if (el?.releases) {
      if (i > 0) el.releases.i = [false, false, false, false, false, false];
      if (i < ids.length - 2) el.releases.j = [false, false, false, false, false, false];
    }
    const id = nextId(model.lines);
    model.lines.push({ id, n1: ids[i], n2: ids[i + 1], element: el });
    newLines.push({ id, t0: bounds[i], t1: bounds[i + 1] });
  }
  // carry over supports
  for (const s of model.supports.filter((s) => s.type === 'line' && s.line === lineId)) {
    for (const nl of newLines) model.supports.push({ ...structuredClone(s), id: nextId(model.supports), line: nl.id });
  }
  // carry over line loads (re-map relative ranges)
  for (const ld of model.loads.filter((x) => x.line === lineId)) {
    for (const nl of newLines) {
      if (ld.type === 'lineDist') {
        const a0 = Math.max(ld.a ?? 0, nl.t0), b0 = Math.min(ld.b ?? 1, nl.t1);
        if (b0 - a0 < 1e-9) continue;
        const q = (tt) => ld.q1 + (ld.q2 - ld.q1) * ((tt - (ld.a ?? 0)) / (((ld.b ?? 1) - (ld.a ?? 0)) || 1));
        model.loads.push({ ...ld, id: nextId(model.loads), line: nl.id, a: (a0 - nl.t0) / (nl.t1 - nl.t0), b: (b0 - nl.t0) / (nl.t1 - nl.t0), q1: q(a0), q2: q(b0) });
      } else if (ld.type === 'linePoint') {
        if (ld.pos >= nl.t0 - 1e-9 && ld.pos <= nl.t1 + 1e-9) {
          model.loads.push({ ...ld, id: nextId(model.loads), line: nl.id, pos: (ld.pos - nl.t0) / (nl.t1 - nl.t0) });
        }
      } else model.loads.push({ ...ld, id: nextId(model.loads), line: nl.id });
    }
  }
  model.lines = model.lines.filter((l) => l.id !== lineId);
  model.supports = model.supports.filter((s) => !(s.type === 'line' && s.line === lineId));
  model.loads = model.loads.filter((x) => x.line !== lineId);
  return newLines.map((x) => x.id);
}

// Closest points between segments p1-p2 and q1-q2; returns params s,t and distance.
function segSeg(p1, p2, q1, q2) {
  const d1 = V.sub(p2, p1), d2 = V.sub(q2, q1), r = V.sub(p1, q1);
  const a = V.dot(d1, d1), e = V.dot(d2, d2), f = V.dot(d2, r);
  const c = V.dot(d1, r), b = V.dot(d1, d2), den = a * e - b * b;
  let s = den > 1e-14 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  let tt = (b * s + f) / e;
  if (tt < 0) { tt = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (tt > 1) { tt = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  const pa = V.add(p1, V.mul(d1, s)), pb = V.add(q1, V.mul(d2, tt));
  return { s, t: tt, d: V.dist(pa, pb), p: pa };
}

// Split lines at mutual intersections and at nodes lying on them.
export function intersectLines(model, lineIds, tol = 1e-4) {
  const ids = new Set(lineIds && lineIds.length ? lineIds : model.lines.map((l) => l.id));
  const nodeOf = new Map(model.nodes.map((n) => [n.id, n]));
  const cuts = new Map(); // lineId -> [t]
  const lines = model.lines.filter((l) => ids.has(l.id));
  const addCut = (lid, tt) => { if (tt > 1e-6 && tt < 1 - 1e-6) { if (!cuts.has(lid)) cuts.set(lid, []); cuts.get(lid).push(tt); } };
  for (let i = 0; i < lines.length; i++) {
    const A = lines[i], a1 = P(nodeOf.get(A.n1)), a2 = P(nodeOf.get(A.n2));
    for (let j = i + 1; j < lines.length; j++) {
      const B = lines[j];
      if (B.n1 === A.n1 || B.n1 === A.n2 || B.n2 === A.n1 || B.n2 === A.n2) continue;
      const b1 = P(nodeOf.get(B.n1)), b2 = P(nodeOf.get(B.n2));
      const r = segSeg(a1, a2, b1, b2);
      if (r.d < tol) { addCut(A.id, r.s); addCut(B.id, r.t); }
    }
    // nodes lying on the line
    const L = V.dist(a1, a2);
    for (const n of model.nodes) {
      if (n.id === A.n1 || n.id === A.n2) continue;
      const p = P(n), tt = V.dot(V.sub(p, a1), V.sub(a2, a1)) / (L * L);
      if (tt <= 0 || tt >= 1) continue;
      if (V.dist(p, V.lerp(a1, a2, tt)) < tol) addCut(A.id, tt);
    }
  }
  let count = 0;
  for (const [lid, ts] of cuts) {
    const uniq = [...new Set(ts.map((x) => Math.round(x * 1e7) / 1e7))].sort((x, y) => x - y);
    splitLine(model, lid, 0, uniq);
    count += uniq.length;
  }
  return count;
}

// Merge coincident nodes; remap all references; drop degenerate/duplicate lines.
export function mergeNodes(model, tol = 1e-4) {
  const map = new Map();
  const keep = [];
  const sorted = [...model.nodes].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    if (map.has(n.id)) continue;
    keep.push(n);
    for (let j = i + 1; j < sorted.length && sorted[j].x - n.x <= tol; j++) {
      const m = sorted[j];
      if (!map.has(m.id) && Math.abs(m.y - n.y) <= tol && Math.abs(m.z - n.z) <= tol) map.set(m.id, n.id);
    }
  }
  if (!map.size) return 0;
  const r = (id) => map.get(id) ?? id;
  model.nodes = model.nodes.filter((n) => !map.has(n.id));
  for (const l of model.lines) { l.n1 = r(l.n1); l.n2 = r(l.n2); }
  const seen = new Set();
  model.lines = model.lines.filter((l) => {
    if (l.n1 === l.n2) return false;
    const k = Math.min(l.n1, l.n2) + '_' + Math.max(l.n1, l.n2);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const d of model.domains) { d.nodes = d.nodes.map(r); d.holes = (d.holes || []).map((hh) => hh.map(r)); }
  for (const s of model.supports) if (s.node) s.node = r(s.node);
  for (const l of model.loads) if (l.node) l.node = r(l.node);
  const lineIds = new Set(model.lines.map((l) => l.id));
  model.supports = model.supports.filter((s) => s.type !== 'line' || lineIds.has(s.line));
  model.loads = model.loads.filter((l) => !l.line || lineIds.has(l.line));
  return map.size;
}

// Apply a point transform to the selection. copies=0 → move in place; copies=n → n transformed copies
// (each applying the transform cumulatively). connect → join original and copied nodes with lines.
export function transformSelection(model, sel, xf, { copies = 0, connect = false, connectElement = null } = {}) {
  const nodeIds = new Set(sel.nodes);
  const lines = model.lines.filter((l) => sel.lines.has(l.id));
  const domains = model.domains.filter((d) => sel.domains.has(d.id));
  for (const l of lines) { nodeIds.add(l.n1); nodeIds.add(l.n2); }
  for (const d of domains) { d.nodes.forEach((n) => nodeIds.add(n)); (d.holes || []).forEach((hh) => hh.forEach((n) => nodeIds.add(n))); }
  const nodes = model.nodes.filter((n) => nodeIds.has(n.id));
  const newSel = { nodes: new Set(), lines: new Set(), domains: new Set() };

  if (!copies) {
    for (const n of nodes) { const p = xf(P(n), 1); n.x = round(p[0]); n.y = round(p[1]); n.z = round(p[2]); }
    sel.nodes.forEach((x) => newSel.nodes.add(x)); sel.lines.forEach((x) => newSel.lines.add(x)); sel.domains.forEach((x) => newSel.domains.add(x));
    mergeNodes(model, 1e-6);
    return newSel;
  }
  let prevMap = new Map(nodes.map((n) => [n.id, n.id]));
  for (let c = 1; c <= copies; c++) {
    const map = new Map();
    for (const n of nodes) {
      const p = xf(P(n), c);
      map.set(n.id, addNode(model, p, 1e-6));
    }
    for (const n of nodes) {
      if (sel.nodes.has(n.id)) newSel.nodes.add(map.get(n.id));
      for (const s of model.supports.filter((s) => s.type === 'node' && s.node === n.id && sel.nodes.has(n.id))) {
        if (!model.supports.some((x) => x.type === 'node' && x.node === map.get(n.id))) model.supports.push({ ...structuredClone(s), id: nextId(model.supports), node: map.get(n.id) });
      }
    }
    for (const l of lines) {
      const id = addLine(model, map.get(l.n1), map.get(l.n2), l.element);
      if (id) {
        newSel.lines.add(id);
        for (const s of model.supports.filter((s) => s.type === 'line' && s.line === l.id)) model.supports.push({ ...structuredClone(s), id: nextId(model.supports), line: id });
        for (const ld of model.loads.filter((x) => x.line === l.id)) model.loads.push({ ...structuredClone(ld), id: nextId(model.loads), line: id });
      }
    }
    for (const d of domains) {
      const nd = structuredClone(d);
      nd.id = nextId(model.domains);
      nd.nodes = d.nodes.map((n) => map.get(n));
      nd.holes = (d.holes || []).map((hh) => hh.map((n) => map.get(n)));
      model.domains.push(nd);
      newSel.domains.add(nd.id);
      for (const s of model.supports.filter((s) => s.type === 'surface' && s.domain === d.id)) model.supports.push({ ...structuredClone(s), id: nextId(model.supports), domain: nd.id });
      for (const ld of model.loads.filter((x) => x.domain === d.id)) model.loads.push({ ...structuredClone(ld), id: nextId(model.loads), domain: nd.id });
    }
    if (connect) {
      for (const n of nodes) {
        const a = prevMap.get(n.id), b = map.get(n.id);
        if (a !== b) { const id = addLine(model, a, b, connectElement); if (id) newSel.lines.add(id); }
      }
    }
    prevMap = map;
  }
  return newSel;
}

// Rotation of point p about axis (unit vector u) through point c by angle (rad)
export function rotatePoint(p, c, u, ang) {
  const v = V.sub(p, c), cs = Math.cos(ang), sn = Math.sin(ang);
  const r = V.add(V.add(V.mul(v, cs), V.mul(V.cross(u, v), sn)), V.mul(u, V.dot(u, v) * (1 - cs)));
  return V.add(c, r);
}

// Find closed loop through the selected lines (for "domain from selection")
export function loopFromLines(model, lineIds) {
  const lines = model.lines.filter((l) => lineIds.has(l.id));
  if (lines.length < 3) return null;
  const adj = new Map();
  for (const l of lines) {
    for (const [a, b] of [[l.n1, l.n2], [l.n2, l.n1]]) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push(b);
    }
  }
  if ([...adj.values()].some((v) => v.length !== 2)) return null;
  const start = lines[0].n1;
  const loop = [start];
  let prev = null, cur = start;
  for (let i = 0; i < lines.length; i++) {
    const nb = adj.get(cur).find((x) => x !== prev);
    if (nb === start) break;
    loop.push(nb); prev = cur; cur = nb;
  }
  return loop.length === lines.length ? loop : null;
}

/* ---------------- validation ---------------- */
export function validateModel(model) {
  const issues = [];
  const idx = buildIndex(model);
  const add = (level, msg, ref) => issues.push({ level, msg, ref });
  if (!model.nodes.length) add('err', t('Das Modell enthält keine Knoten.'));
  const structural = model.lines.filter((l) => l.element);
  if (!structural.length && !model.domains.length) add('err', t('Keine Stab- oder Flächenelemente definiert.'));
  if (!model.supports.length) add('err', t('Keine Lager definiert – das System ist kinematisch.'));
  if (!model.loadCases.length) add('warn', t('Keine Lastfälle definiert.'));
  for (const l of model.lines) {
    if (!idx.nodes.has(l.n1) || !idx.nodes.has(l.n2)) add('err', t('Linie {id} verweist auf fehlende Knoten.', { id: l.id }), { lines: [l.id] });
    else if (lineLength(model, idx, l) < 1e-6) add('err', t('Linie {id} hat die Länge null.', { id: l.id }), { lines: [l.id] });
    const el = l.element;
    if (!el) continue;
    if (['beam', 'truss', 'rib'].includes(el.type)) {
      if (!idx.materials.has(el.material)) add('err', t('Stab {id}: kein Material zugewiesen.', { id: l.id }), { lines: [l.id] });
      if (!idx.sections.has(el.section)) add('err', t('Stab {id}: kein Querschnitt zugewiesen.', { id: l.id }), { lines: [l.id] });
    }
  }
  for (const d of model.domains) {
    if (!idx.materials.has(d.material)) add('err', t('Fläche {id}: kein Material zugewiesen.', { id: d.id }), { domains: [d.id] });
    if (!(d.thickness > 0)) add('err', t('Fläche {id}: ungültige Dicke.', { id: d.id }), { domains: [d.id] });
    const pts = d.nodes.map((n) => idx.nodes.get(n)).filter(Boolean).map(P);
    if (pts.length < 3) { add('err', t('Fläche {id}: weniger als 3 Eckpunkte.', { id: d.id }), { domains: [d.id] }); continue; }
    const ax = domainAxes(pts), c = centroid(pts);
    const size = Math.max(...pts.map((p) => V.dist(p, c)));
    const off = Math.max(...pts.map((p) => Math.abs(V.dot(V.sub(p, c), ax.ez))));
    if (off > 1e-3 * size + 1e-6) add('err', t('Fläche {id} ist nicht eben.', { id: d.id }), { domains: [d.id] });
  }
  // coincident nodes
  const sorted = [...model.nodes].sort((a, b) => a.x - b.x);
  let dup = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].x - sorted[i].x < 1e-5; j++) {
      if (Math.abs(sorted[j].y - sorted[i].y) < 1e-5 && Math.abs(sorted[j].z - sorted[i].z) < 1e-5) dup++;
    }
  }
  if (dup) add('warn', t('{n} doppelte Knoten gefunden – „Knoten vereinen“ empfohlen.', { n: dup }));
  // unconnected nodes
  const used = new Set();
  for (const l of model.lines) if (l.element) { used.add(l.n1); used.add(l.n2); }
  for (const d of model.domains) d.nodes.forEach((n) => used.add(n));
  const loose = model.supports.filter((s) => s.type === 'node' && !used.has(s.node));
  if (loose.length) add('warn', t('{n} Lager an Knoten ohne Element.', { n: loose.length }), { nodes: loose.map((s) => s.node) });
  for (const ld of model.loads) {
    if (!idx.loadCases.has(ld.lc)) add('warn', t('Last {id} gehört zu keinem Lastfall.', { id: ld.id }));
  }
  for (const c of model.combinations) {
    if (!Object.keys(c.factors || {}).length) add('warn', t('Kombination „{name}“ ist leer.', { name: c.name }));
  }
  return issues;
}

export function modelStats(model) {
  return {
    nodes: model.nodes.length,
    lines: model.lines.length,
    beams: model.lines.filter((l) => l.element && ['beam', 'rib'].includes(l.element.type)).length,
    trusses: model.lines.filter((l) => l.element?.type === 'truss').length,
    domains: model.domains.length,
    supports: model.supports.length,
    loadCases: model.loadCases.length,
    loads: model.loads.length,
    combinations: model.combinations.length,
  };
}
