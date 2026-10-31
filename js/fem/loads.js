// Conversion of model loads into solver load data:
//   { F: Float64Array(6nn) equivalent global nodal loads (incl. span-load equivalents),
//     span: Array(nBeams) of span-load objects (local axes) for exact force recovery,
//     shellTemp: Array(nShells) of {dT, dTz},
//     presc: Map(globalDof → prescribed displacement) }

import { emptySpan, spanAddScaled, spanIsEmpty, fixedEndForces, condenseVector } from './beam.js';
import { shellThermalLoad } from './shell.js';
import { toGlobalVector } from './linalg.js';
import { lookup } from './assemble.js';
import { quadHit } from '../core/seclines.js';
import { panelLayout, panelLineLoads } from './panels.js';

const GDIR = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const LDIR = { x: 0, y: 1, z: 2 };

export function emptyLoads(data) {
  return {
    F: new Float64Array(6 * data.nn),
    span: new Array(data.beams.length).fill(null),
    shellTemp: new Array(data.shells.length).fill(null),
    presc: new Map(),
    lost: 0,
  };
}

const spanOf = (L, i) => (L.span[i] ||= emptySpan());

/** local axes (rows) of a model line from its end coordinates, SPEC §2.1 */
export function lineAxes(p1, p2, betaDeg = 0) {
  const ex = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
  const l = Math.hypot(...ex) || 1;
  ex[0] /= l; ex[1] /= l; ex[2] /= l;
  const r = Math.abs(ex[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  let ey = [r[1] * ex[2] - r[2] * ex[1], r[2] * ex[0] - r[0] * ex[2], r[0] * ex[1] - r[1] * ex[0]];
  const ly = Math.hypot(...ey);
  ey = ey.map((v) => v / ly);
  let ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  if (betaDeg) {
    const b = betaDeg * Math.PI / 180, c = Math.cos(b), s = Math.sin(b);
    const ny = ey.map((v, i) => c * v + s * ez[i]);
    const nz = ez.map((v, i) => -s * ey[i] + c * v);
    ey = ny; ez = nz;
  }
  return Float64Array.of(...ex, ...ey, ...ez);
}

const nodeXYZ = (data, n) => [data.coords[3 * n], data.coords[3 * n + 1], data.coords[3 * n + 2]];

/** direction of a load as global unit vector (for global dirs) or local index */
function parseDir(dir) {
  if (GDIR[dir]) return { global: GDIR[dir] };
  if (dir in LDIR) return { local: LDIR[dir] };
  return null;
}

/** Self weight of all elements (beams: ρgA per length, shells: ρgt per area) in −Z, times factor */
export function addSelfWeight(data, L, factor = 1) {
  const g = data.g;
  for (const be of data.beams) {
    if (be.kind === 'spring' || be.type === 'rigid') continue;
    const w = be.props.rho * g * be.props.A * factor;
    if (!w) continue;
    const sp = spanOf(L, be.idx);
    for (let k = 0; k < 3; k++) {
      const c = -be.R[k * 3 + 2] * w;   // local component of (0,0,−w)
      if (Math.abs(c) > 1e-14 * w) sp.dist.push({ dir: k, a: 0, b: be.L, q1: c, q2: c });
    }
  }
  for (const sh of data.shells) {
    const w = sh.rho * g * sh.t * factor;
    if (!w) continue;
    for (let a = 0; a < 4; a++) L.F[6 * sh.nodes[a] + 2] -= w * sh.nodeArea[a];
  }
}

function addNodeVector(L, n, v, rot) {
  const o = 6 * n + (rot ? 3 : 0);
  L.F[o] += v[0]; L.F[o + 1] += v[1]; L.F[o + 2] += v[2];
}

/** Add one model load to L (factor f) */
export function addLoad(data, L, ld, f = 1, warn = () => {}) {
  const mesh = data.mesh;
  switch (ld.type) {
    case 'node': {
      const n = lookup(mesh.modelNodeToMesh, ld.node);
      if (n == null) return warn(`Load ${ld.id}: node ${ld.node} not in mesh.`);
      const F = ld.F || [];
      for (let k = 0; k < 6; k++) L.F[6 * n + k] += (+F[k] || 0) * f;
      return;
    }
    case 'nodeDisp': {
      const n = lookup(mesh.modelNodeToMesh, ld.node);
      if (n == null) return warn(`Load ${ld.id}: node ${ld.node} not in mesh.`);
      const d = ld.d || [];
      for (let k = 0; k < 6; k++) {
        const v = +d[k] || 0;
        if (v) L.presc.set(6 * n + k, (L.presc.get(6 * n + k) || 0) + v * f);
      }
      return;
    }
    case 'lineDist': return addLineDist(data, L, ld, f, warn);
    case 'linePoint': return addLinePoint(data, L, ld, f, warn);
    case 'surface': return addSurface(data, L, ld, f, warn);
    case 'surfaceLine': return addSurfaceLine(data, L, ld, f, warn);
    case 'surfacePoint': return addSurfacePoint(data, L, ld, f, warn);
    case 'tempLine': {
      const beams = data.lineBeams.get(ld.line);
      if (!beams || !beams.length) return warn(`Load ${ld.id}: temperature on line ${ld.line} without elements ignored.`);
      for (const bi of beams) {
        const be = data.beams[bi];
        if (be.kind === 'spring' || be.type === 'rigid') continue;
        const sp = spanOf(L, bi);
        sp.dT += (+ld.dT || 0) * f;
        if (be.kind === 'beam') { sp.dTy += (+ld.dTy || 0) * f; sp.dTz += (+ld.dTz || 0) * f; }
      }
      return;
    }
    case 'tempDomain': {
      const elems = data.domainShells.get(ld.domain);
      if (!elems) return warn(`Load ${ld.id}: domain ${ld.domain} has no elements.`);
      for (const si of elems) {
        const t = (L.shellTemp[si] ||= { dT: 0, dTz: 0 });
        t.dT += (+ld.dT || 0) * f; t.dTz += (+ld.dTz || 0) * f;
      }
      return;
    }
    default:
      return warn(`Load ${ld.id}: unknown type '${ld.type}' ignored.`);
  }
}

function addLineDist(data, L, ld, f, warn) {
  const a = ld.a ?? 0, b = ld.b ?? 1;
  const q1 = (+ld.q1 || 0) * f, q2 = (ld.q2 == null ? +ld.q1 || 0 : +ld.q2) * f;
  if (!(b > a)) return warn(`Load ${ld.id}: invalid range a..b.`);
  const dir = parseDir(ld.dir);
  if (!dir) return warn(`Load ${ld.id}: invalid direction '${ld.dir}'.`);
  const qAt = (t) => q1 + (q2 - q1) * (t - a) / (b - a);
  const beams = (data.lineBeams.get(ld.line) || []).filter((i) => data.beams[i].kind !== 'spring');
  if (beams.length) {
    for (const bi of beams) {
      const be = data.beams[bi];
      const tA = Math.min(be.t0, be.t1), tB = Math.max(be.t0, be.t1);
      const ta = Math.max(a, tA), tb = Math.min(b, tB);
      if (tb - ta <= 1e-12) continue;
      const dt = be.t1 - be.t0;
      let sa = (ta - be.t0) / dt * be.L, sb = (tb - be.t0) / dt * be.L;
      let qa = qAt(ta), qb = qAt(tb);
      if (sa > sb) { [sa, sb] = [sb, sa]; [qa, qb] = [qb, qa]; }
      const comps = [0, 0, 0];
      if (dir.local != null) comps[dir.local] = 1;
      else {
        const d = dir.global, R = be.R;
        const ed = R[0] * d[0] + R[1] * d[1] + R[2] * d[2];
        const fac = ld.projected ? Math.sqrt(Math.max(0, 1 - ed * ed)) : 1;
        for (let k = 0; k < 3; k++) comps[k] = (R[k * 3] * d[0] + R[k * 3 + 1] * d[1] + R[k * 3 + 2] * d[2]) * fac;
      }
      const sp = spanOf(L, bi);
      for (let k = 0; k < 3; k++) {
        if (Math.abs(comps[k]) < 1e-14) continue;
        sp.dist.push({ dir: k, a: sa, b: sb, q1: qa * comps[k], q2: qb * comps[k] });
      }
    }
    return;
  }
  // line without elements: consistent nodal loads along the FE node chain
  const chain = lookup(data.mesh.lineNodes, ld.line);
  if (!chain || chain.length < 2) return warn(`Load ${ld.id}: line ${ld.line} has no mesh nodes.`);
  const Rl = chainAxes(data, ld.line, chain);
  const gp = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  for (let c = 0; c + 1 < chain.length; c++) {
    const ni = chain[c].node, nj = chain[c + 1].node, ti = chain[c].t, tj = chain[c + 1].t;
    const tA = Math.min(ti, tj), tB = Math.max(ti, tj);
    const ta = Math.max(a, tA), tb = Math.min(b, tB);
    if (tb - ta <= 1e-12 || tj === ti) continue;
    const pi = nodeXYZ(data, ni), pj = nodeXYZ(data, nj);
    const seg = [pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2]];
    const Ls = Math.hypot(...seg);
    let vec;
    if (dir.local != null) vec = [Rl[dir.local * 3], Rl[dir.local * 3 + 1], Rl[dir.local * 3 + 2]];
    else {
      const d = dir.global;
      const ed = (seg[0] * d[0] + seg[1] * d[1] + seg[2] * d[2]) / Ls;
      const fac = ld.projected ? Math.sqrt(Math.max(0, 1 - ed * ed)) : 1;
      vec = d.map((v) => v * fac);
    }
    const jac = Ls / Math.abs(tj - ti);     // ds/dt
    for (const g of gp) {
      const t = 0.5 * (ta + tb) + 0.5 * (tb - ta) * g;
      const w = 0.5 * (tb - ta) * jac;
      const xi = (t - ti) / (tj - ti);
      const q = qAt(t) * w;
      for (let k = 0; k < 3; k++) {
        L.F[6 * ni + k] += (1 - xi) * q * vec[k];
        L.F[6 * nj + k] += xi * q * vec[k];
      }
    }
  }
}

function chainAxes(data, lineId, chain) {
  const line = (data.model.lines || []).find((l) => l.id === lineId);
  const beta = line?.element?.beta || 0;
  return lineAxes(nodeXYZ(data, chain[0].node), nodeXYZ(data, chain[chain.length - 1].node), beta);
}

function addLinePoint(data, L, ld, f, warn) {
  const pos = ld.pos ?? 0.5;
  const P = (+ld.F || 0) * f;
  const isMom = !!ld.moment;
  const dir = parseDir(ld.dir);
  if (!dir) return warn(`Load ${ld.id}: invalid direction '${ld.dir}'.`);
  const beams = (data.lineBeams.get(ld.line) || []).filter((i) => data.beams[i].kind !== 'spring');
  if (beams.length) {
    let best = -1;
    for (const bi of beams) {
      const be = data.beams[bi];
      if (pos >= Math.min(be.t0, be.t1) - 1e-9 && pos <= Math.max(be.t0, be.t1) + 1e-9) { best = bi; break; }
    }
    if (best < 0) return warn(`Load ${ld.id}: position outside line.`);
    const be = data.beams[best];
    const s = (pos - be.t0) / (be.t1 - be.t0) * be.L;
    const R = be.R;
    // global vector of the load
    const gvec = dir.global ? dir.global.map((v) => v * P)
      : [R[dir.local * 3] * P, R[dir.local * 3 + 1] * P, R[dir.local * 3 + 2] * P];
    const atNode = s <= 1e-9 * be.L || s >= be.L * (1 - 1e-9);
    if (atNode) {
      addNodeVector(L, s <= be.L / 2 ? be.n1 : be.n2, gvec, isMom);
      return;
    }
    if (be.kind === 'truss' && isMom) {
      warn(`Load ${ld.id}: concentrated moment inside a truss element ignored.`);
      return;
    }
    const sp = spanOf(L, best);
    for (let k = 0; k < 3; k++) {
      const c = R[k * 3] * gvec[0] + R[k * 3 + 1] * gvec[1] + R[k * 3 + 2] * gvec[2];
      if (Math.abs(c) < 1e-14 * Math.abs(P)) continue;
      if (isMom) sp.mom.push({ dir: k, a: s, M: c });
      else sp.pt.push({ dir: k, a: s, P: c });
    }
    return;
  }
  const chain = lookup(data.mesh.lineNodes, ld.line);
  if (!chain || chain.length < 2) return warn(`Load ${ld.id}: line ${ld.line} has no mesh nodes.`);
  const Rl = chainAxes(data, ld.line, chain);
  const gvec = dir.global ? dir.global.map((v) => v * P)
    : [Rl[dir.local * 3] * P, Rl[dir.local * 3 + 1] * P, Rl[dir.local * 3 + 2] * P];
  for (let c = 0; c + 1 < chain.length; c++) {
    const ti = chain[c].t, tj = chain[c + 1].t;
    if (pos < Math.min(ti, tj) - 1e-9 || pos > Math.max(ti, tj) + 1e-9) continue;
    const xi = tj === ti ? 0 : Math.min(1, Math.max(0, (pos - ti) / (tj - ti)));
    addNodeVector(L, chain[c].node, gvec.map((v) => v * (1 - xi)), isMom);
    addNodeVector(L, chain[c + 1].node, gvec.map((v) => v * xi), isMom);
    return;
  }
  warn(`Load ${ld.id}: position outside line.`);
}

/** Intensity of a surface load at point p: constant, linear between p1 (q) and p2 (q2), or hydrostatic. */
export function surfaceQ(ld, p) {
  const q = +ld.q || 0;
  if (ld.dist === 'linear' && ld.p1 && ld.p2) {
    const d = [ld.p2[0] - ld.p1[0], ld.p2[1] - ld.p1[1], ld.p2[2] - ld.p1[2]];
    const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (!(L2 > 0)) return q;
    const s = ((p[0] - ld.p1[0]) * d[0] + (p[1] - ld.p1[1]) * d[1] + (p[2] - ld.p1[2]) * d[2]) / L2;
    return q + ((+ld.q2 || 0) - q) * Math.min(1, Math.max(0, s));
  }
  if (ld.dist === 'hydro') {
    const depth = (+ld.z0 || 0) - p[2];        // q = increase per metre of depth below level z0 (e.g. γw = 10 kN/m³)
    return depth > 0 ? q * depth : 0;
  }
  return q;
}

// unit load vector for a global/local direction on a shell (R rows = local axes)
function shellDirVector(sh, dir, projected) {
  if (dir.global) {
    const d = dir.global;
    const fac = projected ? Math.abs(sh.R[6] * d[0] + sh.R[7] * d[1] + sh.R[8] * d[2]) : 1;
    return d.map((c) => c * fac);
  }
  const k = dir.local;
  return [sh.R[3 * k], sh.R[3 * k + 1], sh.R[3 * k + 2]];
}

function addSurface(data, L, ld, f, warn) {
  const panel = (data.model.domains || []).find((d) => d.id === ld.domain && d.type === 'panel');
  if (panel) return addPanelLoad(data, L, ld, panel, f, warn);
  const elems = data.domainShells.get(ld.domain);
  if (!elems) return warn(`Load ${ld.id}: domain ${ld.domain} has no elements.`);
  const dir = parseDir(ld.dir || 'z');
  if (!dir) return warn(`Load ${ld.id}: invalid direction '${ld.dir}'.`);
  const variable = ld.dist === 'linear' || ld.dist === 'hydro';
  for (const si of elems) {
    const sh = data.shells[si];
    const v = shellDirVector(sh, dir, ld.projected);
    for (let a = 0; a < 4; a++) {
      const n = sh.nodes[a];
      const q = (variable ? surfaceQ(ld, nodeXYZ(data, n)) : +ld.q || 0) * f;
      const A = sh.nodeArea[a];
      const o = 6 * n;
      L.F[o] += v[0] * q * A; L.F[o + 1] += v[1] * q * A; L.F[o + 2] += v[2] * q * A;
    }
  }
}

// shell element of a domain containing point p → { sh, k, w } (barycentric weights on 3 corners)
function locateInDomain(data, ld, p) {
  const elems = data.domainShells.get(ld.domain);
  if (!elems) return null;
  for (const si of elems) {
    const sh = data.shells[si];
    const ps = Array.from(sh.nodes, (n) => nodeXYZ(data, n));
    const hit = quadHit(ps, p, Math.max(0.02, 0.6 * sh.t), [sh.R[6], sh.R[7], sh.R[8]]);
    if (hit) return { sh, ...hit };
  }
  return null;
}

/** Line load on a surface between points a and b (not bound to model lines): consistent nodal forces. */
function addSurfaceLine(data, L, ld, f, warn) {
  const dir = parseDir(ld.dir || 'Z');
  if (!dir) return warn(`Load ${ld.id}: invalid direction '${ld.dir}'.`);
  const a = ld.a, b = ld.b;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]);
  if (!(len > 0)) return warn(`Load ${ld.id}: zero length.`);
  const elems = data.domainShells.get(ld.domain);
  if (!elems) return warn(`Load ${ld.id}: domain ${ld.domain} has no elements.`);
  const hAvg = Math.sqrt(elems.reduce((s, i) => s + data.shells[i].area, 0) / elems.length);
  const n = Math.max(8, Math.min(4000, Math.ceil(len / (0.2 * hAvg))));
  const ds = len / n, q1 = (+ld.q1 || 0) * f, q2 = (ld.q2 == null ? +ld.q1 || 0 : +ld.q2) * f;
  let lost = 0;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) / n;
    const p = [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
    const hit = locateInDomain(data, ld, p);
    if (!hit) { lost++; continue; }
    let v;
    if (dir.global) {
      const fac = ld.projected ? Math.sqrt(Math.max(0, 1 - ((d[0] * dir.global[0] + d[1] * dir.global[1] + d[2] * dir.global[2]) / len) ** 2)) : 1;
      v = dir.global.map((c) => c * fac);
    } else v = shellDirVector(hit.sh, dir, false);
    const F = (q1 + (q2 - q1) * s) * ds;
    for (let j = 0; j < 3; j++) {
      const node = hit.sh.nodes[hit.k[j]], w = hit.w[j] * F;
      L.F[6 * node] += v[0] * w; L.F[6 * node + 1] += v[1] * w; L.F[6 * node + 2] += v[2] * w;
    }
  }
  if (lost) warn(`Load ${ld.id}: ${Math.round(lost / n * 100)} % of the line load lies outside domain ${ld.domain} and was ignored.`);
}

/** Concentrated force on a surface at point p. */
function addSurfacePoint(data, L, ld, f, warn) {
  const dir = parseDir(ld.dir || 'Z');
  if (!dir) return warn(`Load ${ld.id}: invalid direction '${ld.dir}'.`);
  const hit = locateInDomain(data, ld, ld.p || [0, 0, 0]);
  if (!hit) return warn(`Load ${ld.id}: point outside domain ${ld.domain} – ignored.`);
  const v = shellDirVector(hit.sh, dir, false), F = (+ld.F || 0) * f;
  for (let j = 0; j < 3; j++) {
    const node = hit.sh.nodes[hit.k[j]], w = hit.w[j] * F;
    L.F[6 * node] += v[0] * w; L.F[6 * node + 1] += v[1] * w; L.F[6 * node + 2] += v[2] * w;
  }
}

/** Surface load on a load panel → line loads on the supporting lines (see panels.js). */
function addPanelLoad(data, L, ld, dom, f, warn) {
  const cache = (data._panels ||= new Map());
  if (!cache.has(dom.id)) cache.set(dom.id, panelLayout(data.model, dom));
  const layout = cache.get(dom.id);
  if (!layout || !layout.targets.length) return warn(`Load ${ld.id}: load panel ${dom.id} has no supporting lines (beams, ribs, walls) – load ignored.`);
  const dir = parseDir(ld.dir || 'z');
  if (!dir) return warn(`Load ${ld.id}: invalid direction '${ld.dir}'.`);
  const ez = layout.ax.ez;
  // global direction vector of the load (panel normal for 'z'); projection onto the plan for projected loads
  let vec;
  if (dir.global) vec = dir.global.map((c) => c * (ld.projected ? Math.abs(dot3(ez, dir.global)) : 1));
  else vec = (dir.local === 2 ? ez : dir.local === 0 ? layout.ax.ex : layout.ax.ey).slice();
  const pieces = panelLineLoads(data.model, layout, (p) => surfaceQ(ld, p));
  for (const pc of pieces) {
    ['X', 'Y', 'Z'].forEach((dName, k) => {
      if (Math.abs(vec[k]) < 1e-12) return;
      const q = pc.q * vec[k];
      addLineDist(data, L, { id: ld.id, line: pc.line, dir: dName, q1: q, q2: q, a: pc.a, b: pc.b, projected: false }, f, warn);
    });
  }
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Condensed local equivalent nodal loads p (12) of a beam span load */
export function beamEquivalentLocal(be, span) {
  if (be.kind === 'spring' || spanIsEmpty(span)) return null;
  const ff = fixedEndForces(be.L, be.props, span, be.kind === 'truss');
  const p = new Float64Array(12);
  for (let i = 0; i < 12; i++) p[i] = -ff[i];
  return be.Tc ? condenseVector(be.Tc, p) : p;
}

/** Add equivalent nodal loads of span loads and shell temperatures to L.F */
export function finalizeLoads(data, L) {
  for (let i = 0; i < data.beams.length; i++) {
    const sp = L.span[i];
    if (!sp) continue;
    const be = data.beams[i];
    const p = beamEquivalentLocal(be, sp);
    if (!p) continue;
    const pg = toGlobalVector(p, be.R);
    for (let k = 0; k < 6; k++) { L.F[6 * be.n1 + k] += pg[k]; L.F[6 * be.n2 + k] += pg[6 + k]; }
  }
  for (let i = 0; i < data.shells.length; i++) {
    const tmp = L.shellTemp[i];
    if (!tmp || (!tmp.dT && !tmp.dTz)) continue;
    const sh = data.shells[i];
    const p = shellThermalLoad(sh.op, sh.type, sh.alpha, sh.t, tmp);
    const pg = toGlobalVector(p, sh.R);
    for (let a = 0; a < 4; a++) for (let k = 0; k < 6; k++) L.F[6 * sh.nodes[a] + k] += pg[6 * a + k];
  }
  return L;
}

/** Loads of one load case (incl. self weight) */
export function buildCaseLoads(data, lcId, warn = () => {}) {
  const L = emptyLoads(data);
  const lc = (data.model.loadCases || []).find((c) => c.id === lcId);
  if (lc && lc.selfWeight) addSelfWeight(data, L, 1);
  for (const ld of data.model.loads || []) if (ld.lc === lcId) addLoad(data, L, ld, 1, warn);
  return finalizeLoads(data, L);
}

/** Linear combination of already finalized load sets: list = [{loads, f}] */
export function combineLoads(data, list) {
  const out = emptyLoads(data);
  for (const { loads, f } of list) {
    if (!loads || !f) continue;
    for (let i = 0; i < out.F.length; i++) out.F[i] += f * loads.F[i];
    for (let i = 0; i < loads.span.length; i++) {
      if (loads.span[i]) spanAddScaled(spanOf(out, i), loads.span[i], f);
    }
    for (let i = 0; i < loads.shellTemp.length; i++) {
      const t = loads.shellTemp[i];
      if (!t) continue;
      const o = (out.shellTemp[i] ||= { dT: 0, dTz: 0 });
      o.dT += t.dT * f; o.dTz += t.dTz * f;
    }
    for (const [d, v] of loads.presc) out.presc.set(d, (out.presc.get(d) || 0) + v * f);
  }
  return out;
}
