// Model preparation (element data, supports), automatic suppression of DOFs without stiffness,
// equation numbering (RCM) and skyline assembly.

import { buildNodeGraph, rcmOrder, Skyline, addElement, symEig, toGlobalMatrix } from './linalg.js';
import { beamLocalStiffness, beamLocalGeometric, releaseTransform, tripleProduct } from './beam.js';
import { shellOperators, shellLocalStiffness, shellLocalGeometric, localXY } from './shell.js';

export const DOF_NAMES = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
const RIGID_FACTOR = 1e4;

const isFixed = (d) => d === 'F' || d === 'f' || d === true;
const springVal = (d) => (typeof d === 'number' && d > 0 ? d : (typeof d === 'string' && +d > 0 ? +d : 0));

/** Lookup in a plain object or Map keyed by (numeric) id */
export function lookup(obj, key) {
  if (!obj) return undefined;
  if (obj instanceof Map) return obj.get(key) ?? obj.get(String(key));
  return obj[key] ?? obj[String(key)];
}

function rowsFromAxes(ex, ey, ez) {
  return Float64Array.of(ex[0], ex[1], ex[2], ey[0], ey[1], ey[2], ez[0], ez[1], ez[2]);
}

/** R·Rᵀ-style local transform of a global matrix: K_L = T K_G Tᵀ */
export function toLocalMatrix(KG, nd, R) {
  const Rt = Float64Array.of(R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]);
  return toGlobalMatrix(KG, nd, Rt);
}

function sectionHeight(sec, A, I, key) {
  const d = sec.dims || {};
  if (key === 'h') {
    if (d.h > 0) return d.h;
    if (d.d > 0) return d.d;
    if (sec.zmax > 0) return 2 * sec.zmax;
  } else {
    if (d.b > 0) return d.b;
    if (d.d > 0) return d.d;
    if (sec.ymax > 0) return 2 * sec.ymax;
  }
  return A > 0 && I > 0 ? Math.sqrt(12 * I / A) : 0;
}

/**
 * Build all solver-side data structures from model + mesh.
 * Returns data = { nn, coords, beams[], shells[], fixed, springs, uplift[], lineBeams, ... , warnings, error }
 */
export function prepareModel(model, mesh) {
  const warnings = [];
  const coords = mesh.nodes;
  const nn = (coords.length / 3) | 0;
  const mats = new Map((model.materials || []).map((m) => [m.id, m]));
  const secs = new Map((model.sections || []).map((s) => [s.id, s]));
  const g = model.settings?.g ?? 9.81;
  const data = {
    model, mesh, nn, coords, g, warnings, error: null,
    beams: [], shells: [], lineBeams: new Map(),
    fixed: new Uint8Array(6 * nn), springs: new Map(), uplift: [], hasSupports: false,
  };
  const fail = (message) => { data.error = { code: 'INVALID_MODEL', message }; return data; };
  const meshBeams = mesh.beams || [];
  const meshShells = mesh.shells || [];

  // --- beam properties (first pass: non-rigid) -------------------------------------------
  const ref = { kA: 0, kB3: 0, kB1: 0, kT: 0 };
  const props = new Array(meshBeams.length);
  const lengths = new Float64Array(meshBeams.length);
  for (let i = 0; i < meshBeams.length; i++) {
    const b = meshBeams[i];
    const p1 = 3 * b.n1, p2 = 3 * b.n2;
    lengths[i] = Math.hypot(coords[p2] - coords[p1], coords[p2 + 1] - coords[p1 + 1], coords[p2 + 2] - coords[p1 + 2]);
    const type = b.type || 'beam';
    if (type === 'rigid' || type === 'spring') continue;
    const mat = mats.get(b.material), sec = secs.get(b.section);
    if (!mat) return fail(`Line ${b.line}: material ${b.material} not found`);
    if (!sec) return fail(`Line ${b.line}: section ${b.section} not found`);
    const E = mat.E, nu = mat.nu ?? 0.3;
    const G = mat.G > 0 ? mat.G : E / (2 * (1 + nu));
    const A = sec.A || 0, Iy = sec.Iy || 0, Iz = sec.Iz || 0;
    if (!(E > 0) || !(A > 0)) return fail(`Line ${b.line}: E and A must be > 0`);
    const p = {
      E, G, A, Iy, Iz, It: sec.It || 0, Avy: sec.Avy || 0, Avz: sec.Avz || 0,
      alpha: mat.alpha || 0, rho: mat.rho || 0,
      h: sectionHeight(sec, A, Iy, 'h'), b: sectionHeight(sec, A, Iz, 'b'),
    };
    if (type !== 'truss' && (!(Iy > 0) || !(Iz > 0))) return fail(`Line ${b.line}: Iy and Iz must be > 0 for beams`);
    props[i] = p;
    const L = lengths[i];
    if (L > 0) {
      ref.kA = Math.max(ref.kA, E * A / L);
      if (type !== 'truss') {
        const EI = E * Math.max(Iy, Iz);
        ref.kB3 = Math.max(ref.kB3, EI / L ** 3);
        ref.kB1 = Math.max(ref.kB1, EI / L);
        ref.kT = Math.max(ref.kT, G * p.It / L);
      }
    }
  }
  // shells contribute to the rigid reference stiffness when there are no beams
  if (ref.kA === 0) {
    for (const s of meshShells) {
      const m = mats.get(s.material);
      if (!m) continue;
      ref.kA = Math.max(ref.kA, m.E * s.thickness);
      ref.kB1 = Math.max(ref.kB1, m.E * s.thickness ** 3 / 12);
      ref.kB3 = Math.max(ref.kB3, m.E * s.thickness ** 3 / 12);
    }
  }
  if (ref.kA === 0) { ref.kA = 1e10; ref.kB1 = 1e10; ref.kB3 = 1e10; }
  if (ref.kB1 === 0) { ref.kB1 = ref.kA; ref.kB3 = ref.kA; }

  // --- beams ------------------------------------------------------------------------------
  let missingIt = 0;
  for (let i = 0; i < meshBeams.length; i++) {
    const b = meshBeams[i];
    const type = b.type || 'beam';
    const L = lengths[i];
    const R = rowsFromAxes(b.ex || [1, 0, 0], b.ey || [0, 1, 0], b.ez || [0, 0, 1]);
    const be = {
      idx: i, n1: b.n1, n2: b.n2, line: b.line, type, L, R, t0: b.t0 ?? 0, t1: b.t1 ?? 1,
      nl: b.nl || null, kind: type === 'truss' ? 'truss' : type === 'spring' ? 'spring' : 'beam',
      props: null, kL: null, Tc: null, kG: null,
    };
    if (type === 'spring') {
      const k = b.k || [0, 0, 0, 0, 0, 0];
      const KG = new Float64Array(144);
      for (let d = 0; d < 6; d++) {
        const v = +k[d] || 0;
        KG[d * 13] = v; KG[(d + 6) * 13] = v; KG[d * 12 + d + 6] = -v; KG[(d + 6) * 12 + d] = -v;
      }
      be.kG = KG;
      be.kL = toLocalMatrix(KG, 12, R);
      be.props = { E: 0, G: 0, A: 0, Iy: 0, Iz: 0, It: 0, Avy: 0, Avz: 0, alpha: 0, rho: 0, h: 0, b: 0 };
    } else {
      if (!(L > 0)) return fail(`Line ${b.line}: zero-length element`);
      let p = props[i];
      if (type === 'rigid') {
        const EA = RIGID_FACTOR * ref.kA * L;
        const EI = RIGID_FACTOR * Math.max(ref.kB3 * L ** 3, ref.kB1 * L);
        const GJ = RIGID_FACTOR * Math.max(ref.kT, ref.kB1) * L;
        p = { E: 1, G: 1, A: EA, Iy: EI, Iz: EI, It: GJ, Avy: 0, Avz: 0, alpha: 0, rho: 0, h: 0, b: 0 };
      }
      if (be.kind === 'beam' && type !== 'rigid' && !(p.It > 0)) missingIt++;
      be.props = p;
      let kL = beamLocalStiffness(L, p, be.kind === 'truss');
      const rel = new Uint8Array(12);
      let anyRel = false;
      if (be.kind === 'beam' && type !== 'rigid') {
        for (let d = 0; d < 6; d++) {
          if (b.relI && b.relI[d]) { rel[d] = 1; anyRel = true; }
          if (b.relJ && b.relJ[d]) { rel[6 + d] = 1; anyRel = true; }
        }
      }
      if (anyRel) {
        const c = releaseTransform(kL, rel);
        kL = c.K; be.Tc = c.T; be.rel = rel;
      }
      be.kL = kL;
      be.kG = toGlobalMatrix(kL, 12, R);
    }
    data.beams.push(be);
    if (b.line != null) {
      if (!data.lineBeams.has(b.line)) data.lineBeams.set(b.line, []);
      data.lineBeams.get(b.line).push(i);
    }
  }
  for (const arr of data.lineBeams.values()) {
    arr.sort((x, y) => Math.min(data.beams[x].t0, data.beams[x].t1) - Math.min(data.beams[y].t0, data.beams[y].t1));
  }
  if (missingIt) warnings.push(`${missingIt} beam element(s) without torsion constant It – torsional stiffness 0.`);

  // --- shells -------------------------------------------------------------------------------
  let badJac = 0;
  for (let i = 0; i < meshShells.length; i++) {
    const s = meshShells[i];
    const mat = mats.get(s.material);
    if (!mat) return fail(`Domain ${s.domain}: material ${s.material} not found`);
    const t = s.thickness;
    if (!(t > 0)) return fail(`Domain ${s.domain}: thickness must be > 0`);
    const R = rowsFromAxes(s.ex, s.ey, s.ez);
    const nodes = Int32Array.from(s.nodes);
    const xy = localXY(coords, nodes, R);
    const E = mat.E, nu = mat.nu ?? 0.2;
    const op = shellOperators(xy, E, nu, t);
    if (!(op.minDet > 0)) badJac++;
    const type = s.type || 'shell';
    const kL = shellLocalStiffness(op, type);
    data.shells.push({
      idx: i, nodes, domain: s.domain, type, R, xy, E, nu, t, alpha: mat.alpha || 0, rho: mat.rho || 0,
      op, kG: toGlobalMatrix(kL, 24, R), nodeArea: op.nodeArea, area: op.area,
    });
  }
  if (badJac) warnings.push(`${badJac} shell element(s) with non-positive Jacobian (distorted or wrongly oriented).`);
  data.domainShells = new Map();
  for (const sh of data.shells) {
    if (!data.domainShells.has(sh.domain)) data.domainShells.set(sh.domain, []);
    data.domainShells.get(sh.domain).push(sh.idx);
  }

  // --- supports -------------------------------------------------------------------------------
  const spring = (n) => {
    let K = data.springs.get(n);
    if (!K) { K = new Float64Array(36); data.springs.set(n, K); }
    return K;
  };
  for (const s of model.supports || []) {
    if (s.type === 'node' || s.type == null) {
      const n = lookup(mesh.modelNodeToMesh, s.node);
      if (n == null) { warnings.push(`Support ${s.id}: node ${s.node} not in mesh – ignored.`); continue; }
      const dofs = s.dofs || [];
      for (let k = 0; k < 6; k++) {
        const d = dofs[k];
        if (isFixed(d)) { data.fixed[6 * n + k] = 1; data.hasSupports = true; }
        else if (springVal(d) > 0) { spring(n)[k * 7] += springVal(d); data.hasSupports = true; }
      }
      if (s.uplift) {
        const d = dofs[2];
        if (isFixed(d)) data.uplift.push({ node: n, dof: 6 * n + 2, kind: 'F', k: 0, support: s.id });
        else if (springVal(d) > 0) data.uplift.push({ node: n, dof: 6 * n + 2, kind: 'spring', k: springVal(d), support: s.id });
      }
    } else if (s.type === 'line') {
      const chain = lookup(mesh.lineNodes, s.line);
      if (!chain || chain.length < 2) { warnings.push(`Line support ${s.id}: line ${s.line} has no mesh nodes – ignored.`); continue; }
      const trib = chainTributary(coords, chain);
      const dofs = s.dofs || [];
      for (let c = 0; c < chain.length; c++) {
        const n = chain[c].node;
        for (let k = 0; k < 6; k++) {
          const d = dofs[k];
          if (isFixed(d)) { data.fixed[6 * n + k] = 1; data.hasSupports = true; }
          else if (springVal(d) > 0) { spring(n)[k * 7] += springVal(d) * trib[c]; data.hasSupports = true; }
        }
      }
    } else if (s.type === 'surface') {
      const elems = data.domainShells.get(s.domain);
      if (!elems) { warnings.push(`Surface support ${s.id}: domain ${s.domain} has no shell elements – ignored.`); continue; }
      const k = s.k || [0, 0, 0];
      for (const ei of elems) {
        const sh = data.shells[ei];
        const R = sh.R;
        // K3 = Σ_k k_k e_k e_kᵀ (e_k = local axis k in global coordinates)
        const K3 = new Float64Array(9);
        for (let a = 0; a < 3; a++) {
          const kk = +k[a] || 0;
          if (!kk) continue;
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) K3[i * 3 + j] += kk * R[a * 3 + i] * R[a * 3 + j];
        }
        for (let a = 0; a < 4; a++) {
          const K = spring(sh.nodes[a]);
          const A = sh.nodeArea[a];
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) K[i * 6 + j] += K3[i * 3 + j] * A;
        }
      }
      if (k.some((v) => +v > 0)) data.hasSupports = true;
    }
  }
  return data;
}

/** Tributary lengths of a node chain [{node,t}] */
export function chainTributary(coords, chain) {
  const trib = new Float64Array(chain.length);
  for (let c = 0; c + 1 < chain.length; c++) {
    const p = 3 * chain[c].node, q = 3 * chain[c + 1].node;
    const L = Math.hypot(coords[q] - coords[p], coords[q + 1] - coords[p + 1], coords[q + 2] - coords[p + 2]);
    trib[c] += L / 2; trib[c + 1] += L / 2;
  }
  return trib;
}

/**
 * Identify DOFs without stiffness and suppress them.
 * mask: 0 = free, 1 = fixed by support, 2 = suppressed (no stiffness, no reaction).
 * Rotational null directions are always suppressed; translational ones only at nodes
 * touched by plate/membrane elements (otherwise they indicate a genuine mechanism).
 * Null directions not aligned with a global axis get a tiny fictitious spring.
 */
export function analyzeDofs(data) {
  const nn = data.nn;
  const blocks = new Float64Array(nn * 36);
  const flags = new Uint8Array(nn);
  const addBlocks = (nodes, K, nd) => {
    const nb = nd / 6;
    for (let a = 0; a < nb; a++) {
      const n = nodes[a];
      const o = n * 36;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) blocks[o + i * 6 + j] += K[(6 * a + i) * nd + 6 * a + j];
    }
  };
  for (const be of data.beams) {
    addBlocks([be.n1, be.n2], be.kG, 12);
    flags[be.n1] |= 1; flags[be.n2] |= 1;
  }
  for (const sh of data.shells) {
    addBlocks(sh.nodes, sh.kG, 24);
    for (const n of sh.nodes) flags[n] |= sh.type === 'shell' ? 1 : 3;
  }
  for (const [n, K] of data.springs) for (let i = 0; i < 36; i++) blocks[n * 36 + i] += K[i];

  const mask = Uint8Array.from(data.fixed);
  const fict = new Map();
  let maxT = 0, maxR = 0;
  for (let n = 0; n < nn; n++) {
    for (let k = 0; k < 3; k++) {
      maxT = Math.max(maxT, blocks[n * 36 + k * 7]);
      maxR = Math.max(maxR, blocks[n * 36 + (k + 3) * 7]);
    }
  }
  let nSupp = 0, nIso = 0, nFict = 0;
  const example = [];
  for (let n = 0; n < nn; n++) {
    if (!(flags[n] & 1)) {
      let any = false;
      for (let k = 0; k < 6; k++) if (mask[6 * n + k] === 0) { mask[6 * n + k] = 2; any = true; }
      if (any) nIso++;
      continue;
    }
    for (const blk of [0, 3]) {
      if (blk === 0 && !(flags[n] & 2)) continue;
      const free = [];
      for (let k = 0; k < 3; k++) if (mask[6 * n + blk + k] === 0) free.push(blk + k);
      const m = free.length;
      if (!m) continue;
      const sub = new Float64Array(m * m);
      for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) sub[i * m + j] = blocks[n * 36 + free[i] * 6 + free[j]];
      const { values, vectors } = symEig(sub, m);
      const lmax = Math.max(values[m - 1], 0);
      const refv = blk ? maxR : maxT;
      const allNull = !(lmax > 1e-12 * refv);
      const isNull = (i) => allNull || values[i] <= 1e-8 * lmax;
      const nulls = [];
      for (let i = 0; i < m; i++) if (isNull(i)) nulls.push(i);
      if (!nulls.length) continue;
      // which free axes lie inside the null space?
      const fixedHere = [];
      for (let c = 0; c < m; c++) {
        let inRange = 0;
        for (let i = 0; i < m; i++) if (!isNull(i)) inRange += vectors[c * m + i] ** 2;
        if (inRange < 1e-9) fixedHere.push(c);
      }
      for (const c of fixedHere) {
        mask[6 * n + free[c]] = 2; nSupp++;
        if (example.length < 3) example.push(`${nodeLabel(data, n)}:${DOF_NAMES[free[c]]}`);
      }
      if (fixedHere.length < nulls.length) {
        // skew null directions: fictitious spring kf·P_null
        const kf = 1e-6 * (lmax > 0 ? lmax : refv);
        let K = fict.get(n);
        if (!K) { K = new Float64Array(36); fict.set(n, K); }
        for (const i of nulls) for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) {
          K[free[a] * 6 + free[b]] += kf * vectors[a * m + i] * vectors[b * m + i];
        }
        nFict++;
      }
    }
  }
  const warnings = [];
  if (nSupp) warnings.push(`${nSupp} DOF(s) without stiffness suppressed automatically (e.g. ${example.join(', ')}).`);
  if (nIso) warnings.push(`${nIso} node(s) not connected to any element – ignored.`);
  if (nFict) warnings.push(`${nFict} node block(s) with skew zero-stiffness directions stabilised by small fictitious springs.`);
  return { mask, fict, warnings, blocks };
}

export function nodeLabel(data, n) {
  const id = data.mesh.nodeModelId ? data.mesh.nodeModelId[n] : 0;
  return id ? `node ${id}` : `mesh node #${n}`;
}

/** Equation numbering (RCM node order) and skyline profile for a given DOF mask (≠0 = eliminated). */
export function buildSystem(data, mask) {
  const nn = data.nn;
  if (!data.order) {
    const lists = [];
    for (const b of data.beams) lists.push([b.n1, b.n2]);
    for (const s of data.shells) lists.push(s.nodes);
    data.graph = buildNodeGraph(nn, lists);
    data.order = rcmOrder(nn, data.graph);
  }
  const eq = new Int32Array(6 * nn).fill(-1);
  let neq = 0;
  for (let p = 0; p < nn; p++) {
    const n = data.order[p];
    for (let k = 0; k < 6; k++) if (!mask[6 * n + k]) eq[6 * n + k] = neq++;
  }
  const dofOfEq = new Int32Array(neq);
  for (let d = 0; d < 6 * nn; d++) if (eq[d] >= 0) dofOfEq[eq[d]] = d;
  const first = new Int32Array(neq);
  for (let j = 0; j < neq; j++) first[j] = j;
  const apply = (nodes) => {
    let mn = Infinity;
    for (const n of nodes) for (let k = 0; k < 6; k++) { const e = eq[6 * n + k]; if (e >= 0 && e < mn) mn = e; }
    if (mn === Infinity) return;
    for (const n of nodes) for (let k = 0; k < 6; k++) { const e = eq[6 * n + k]; if (e >= 0 && first[e] > mn) first[e] = mn; }
  };
  for (const b of data.beams) apply([b.n1, b.n2]);
  for (const s of data.shells) apply(s.nodes);
  for (let n = 0; n < nn; n++) apply([n]);
  const template = Skyline.fromFirst(neq, first);
  return { eq, neq, dofOfEq, template, mask };
}

export function elemEqs(sys, nodes, out) {
  for (let a = 0; a < nodes.length; a++) for (let k = 0; k < 6; k++) out[6 * a + k] = sys.eq[6 * nodes[a] + k];
  return out;
}

/** Local geometric stiffness of a beam (condensed for releases) */
export function beamKgLocal(be, N) {
  if (be.kind === 'spring' || !N) return null;
  let kg = beamLocalGeometric(be.L, N, be.props, be.kind === 'truss');
  if (be.Tc) kg = tripleProduct(kg, be.Tc);
  return kg;
}

export function beamKgGlobal(be, N) {
  const kg = beamKgLocal(be, N);
  return kg ? toGlobalMatrix(kg, 12, be.R) : null;
}

export function shellKgGlobal(sh, gauss) {
  if (!gauss) return null;
  return toGlobalMatrix(shellLocalGeometric(sh.op, gauss), 24, sh.R);
}

/**
 * Assemble the global stiffness into a new skyline matrix.
 * opts: { active (Uint8Array per beam, 0 = inactive), springs (Map node→36, overrides data.springs),
 *         kg: { beamN: Float64Array, shellG: Array<Float64Array|null> }, kgOnly: bool }
 */
export function assembleK(data, sys, opts = {}) {
  const S = sys.template.like();
  const e12 = new Int32Array(12), e24 = new Int32Array(24);
  const active = opts.active;
  const kg = opts.kg;
  for (const be of data.beams) {
    if (active && !active[be.idx]) continue;
    elemEqs(sys, [be.n1, be.n2], e12);
    if (!opts.kgOnly) addElement(S, e12, be.kG, 12);
    if (kg && kg.beamN && kg.beamN[be.idx]) {
      const K = beamKgGlobal(be, kg.beamN[be.idx]);
      if (K) addElement(S, e12, K, 12);
    }
  }
  for (const sh of data.shells) {
    elemEqs(sys, sh.nodes, e24);
    if (!opts.kgOnly) addElement(S, e24, sh.kG, 24);
    if (kg && kg.shellG && kg.shellG[sh.idx]) {
      const K = shellKgGlobal(sh, kg.shellG[sh.idx]);
      if (K) addElement(S, e24, K, 24);
    }
  }
  if (!opts.kgOnly) {
    const e6 = new Int32Array(6);
    for (const map of [opts.springs || data.springs, data.fict]) {
      if (!map) continue;
      for (const [n, K] of map) addElement(S, elemEqs(sys, [n], e6), K, 6);
    }
  }
  return S;
}
