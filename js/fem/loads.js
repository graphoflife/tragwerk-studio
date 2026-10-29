// Conversion of model loads into solver load data:
//   { F: Float64Array(6nn) equivalent global nodal loads (incl. span-load equivalents),
//     span: Array(nBeams) of span-load objects (local axes) for exact force recovery,
//     shellTemp: Array(nShells) of {dT, dTz},
//     presc: Map(globalDof → prescribed displacement) }

import { emptySpan, spanAddScaled, spanIsEmpty, fixedEndForces, condenseVector } from './beam.js';
import { shellThermalLoad } from './shell.js';
import { toGlobalVector } from './linalg.js';
import { lookup } from './assemble.js';

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

function addSurface(data, L, ld, f, warn) {
  const elems = data.domainShells.get(ld.domain);
  if (!elems) return warn(`Load ${ld.id}: domain ${ld.domain} has no elements.`);
  const q = (+ld.q || 0) * f;
  const dir = parseDir(ld.dir || 'z');
  if (!dir) return warn(`Load ${ld.id}: invalid direction '${ld.dir}'.`);
  for (const si of elems) {
    const sh = data.shells[si];
    let v;
    if (dir.global) {
      const d = dir.global;
      const fac = ld.projected ? Math.abs(sh.R[6] * d[0] + sh.R[7] * d[1] + sh.R[8] * d[2]) : 1;
      v = d.map((c) => c * q * fac);
    } else {
      const k = dir.local;
      v = [sh.R[3 * k] * q, sh.R[3 * k + 1] * q, sh.R[3 * k + 2] * q];
    }
    for (let a = 0; a < 4; a++) {
      const A = sh.nodeArea[a];
      const o = 6 * sh.nodes[a];
      L.F[o] += v[0] * A; L.F[o + 1] += v[1] * A; L.F[o + 2] += v[2] * A;
    }
  }
}

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
