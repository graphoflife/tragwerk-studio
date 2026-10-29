// Test helpers: build models and small meshes in the SPEC §3 format by hand.
// (Not a general mesher: lines are subdivided uniformly, 4-corner domains get a structured grid.)
import assert from 'node:assert/strict';

export const STEEL = { id: 1, name: 'S235', type: 'steel', E: 210e6, G: 80.77e6, nu: 0.3, rho: 7.85, alpha: 1.2e-5, fy: 235e3 };

export function baseModel(extra = {}) {
  return {
    version: 1, meta: { name: 'test' }, settings: { meshSize: 1, beamDivisions: 1, g: 9.81 },
    nodes: [], lines: [], domains: [], materials: [STEEL], sections: [], supports: [],
    loadGroups: [], loadCases: [], loads: [], combinations: [], ...extra,
  };
}

/** generic section from numbers (m², m⁴) */
export function section(id, { A, Iy, Iz, It, Avy = 0, Avz = 0, h, b } = {}) {
  return { id, name: 'S' + id, shape: 'GENERIC', family: 'GENERIC', dims: { h, b }, A, Iy, Iz: Iz ?? Iy, It: It ?? (Iy + (Iz ?? Iy)), Avy, Avz };
}

const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotp = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** local axes of a line per SPEC §2.1 */
export function lineAxes(p1, p2, beta = 0) {
  const ex = norm([p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]);
  const r = Math.abs(ex[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  let ey = norm(cross(r, ex));
  let ez = cross(ex, ey);
  if (beta) {
    const b = beta * Math.PI / 180, c = Math.cos(b), s = Math.sin(b);
    const ny = ey.map((v, i) => c * v + s * ez[i]);
    const nz = ez.map((v, i) => -s * ey[i] + c * v);
    ey = ny; ez = nz;
  }
  return { ex, ey, ez };
}

/** domain axes per SPEC §2.2 */
export function domainAxes(pts) {
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  n = norm(n);
  if (Math.abs(n[2]) > 1e-6) { if (n[2] < 0) n = n.map((v) => -v); }
  else if (Math.abs(n[1]) > 1e-6) { if (n[1] < 0) n = n.map((v) => -v); }
  else if (n[0] < 0) n = n.map((v) => -v);
  let ex = [1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]];
  if (Math.hypot(...ex) < 1e-6) ex = [-n[1] * n[0], 1 - n[1] * n[1], -n[1] * n[2]];
  ex = norm(ex);
  const ey = cross(n, ex);
  return { ex, ey, ez: n };
}

/**
 * Build a mesh. opts.div: default beam divisions; domains must have 4 corner nodes and get
 * opts.grid[domainId] = [nx, ny] (default [4,4]) structured elements.
 */
export function buildTestMesh(model, opts = {}) {
  const coords = [];
  const nodeModelId = [];
  const keyMap = new Map();
  const key = (p) => p.map((v) => Math.round(v * 1e7)).join(',');
  const getNode = (p, modelId = 0) => {
    const k = key(p);
    if (keyMap.has(k)) {
      const i = keyMap.get(k);
      if (modelId && !nodeModelId[i]) nodeModelId[i] = modelId;
      return i;
    }
    const i = coords.length / 3;
    coords.push(p[0], p[1], p[2]);
    nodeModelId.push(modelId);
    keyMap.set(k, i);
    return i;
  };
  const pos = new Map(model.nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  const modelNodeToMesh = {};
  for (const n of model.nodes) modelNodeToMesh[n.id] = getNode([n.x, n.y, n.z], n.id);

  // domains
  const shells = [];
  const domainElems = {}, domainNodes = {};
  for (const d of model.domains || []) {
    const P = d.nodes.map((id) => pos.get(id));
    assert.equal(P.length, 4, 'test mesher supports 4-corner domains only');
    const ax = domainAxes(P);
    const [nx, ny] = (opts.grid && opts.grid[d.id]) || [4, 4];
    const grid = [];
    for (let j = 0; j <= ny; j++) {
      grid.push([]);
      for (let i = 0; i <= nx; i++) {
        const u = i / nx, v = j / ny;
        const p = [0, 1, 2].map((k) => (1 - u) * (1 - v) * P[0][k] + u * (1 - v) * P[1][k] + u * v * P[2][k] + (1 - u) * v * P[3][k]);
        grid[j].push(getNode(p));
      }
    }
    const nat = cross(P[1].map((v, k) => v - P[0][k]), P[3].map((v, k) => v - P[0][k]));
    const flip = dotp(nat, ax.ez) < 0;
    domainElems[d.id] = [];
    const dn = new Set();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
      if (flip) q = [q[0], q[3], q[2], q[1]];
      q.forEach((n) => dn.add(n));
      domainElems[d.id].push(shells.length);
      shells.push({ nodes: q, domain: d.id, type: d.type || 'shell', material: d.material, thickness: d.thickness, ...ax });
    }
    domainNodes[d.id] = [...dn];
  }

  // lines
  const beams = [];
  const lineNodes = {};
  const divDefault = opts.div ?? model.settings?.beamDivisions ?? 1;
  for (const l of model.lines || []) {
    const p1 = pos.get(l.n1), p2 = pos.get(l.n2);
    const el = l.element;
    const chain = new Map();
    const add = (t) => {
      const p = [0, 1, 2].map((k) => p1[k] + t * (p2[k] - p1[k]));
      const n = t === 0 ? modelNodeToMesh[l.n1] : t === 1 ? modelNodeToMesh[l.n2] : getNode(p);
      chain.set(n, t);
    };
    add(0); add(1);
    const nd = el ? (el.divisions ?? divDefault) : 0;
    for (let k = 1; k < nd; k++) add(k / nd);
    // existing mesh nodes on the segment
    const dvec = p2.map((v, k) => v - p1[k]);
    const L2 = dotp(dvec, dvec);
    for (let i = 0; i < coords.length / 3; i++) {
      if (chain.has(i)) continue;
      const q = [coords[3 * i] - p1[0], coords[3 * i + 1] - p1[1], coords[3 * i + 2] - p1[2]];
      const t = dotp(q, dvec) / L2;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const dist = Math.hypot(...q.map((v, k) => v - t * dvec[k]));
      if (dist < 1e-7) chain.set(i, t);
    }
    const arr = [...chain.entries()].map(([node, t]) => ({ node, t })).sort((a, b) => a.t - b.t);
    lineNodes[l.id] = arr;
    if (!el) continue;
    const ax = lineAxes(p1, p2, el.beta || 0);
    for (let s = 0; s + 1 < arr.length; s++) {
      beams.push({
        n1: arr[s].node, n2: arr[s + 1].node, line: l.id, type: el.type || 'beam',
        material: el.material, section: el.section, beta: el.beta || 0, ...ax,
        relI: s === 0 && el.releases?.i ? el.releases.i : null,
        relJ: s === arr.length - 2 && el.releases?.j ? el.releases.j : null,
        t0: arr[s].t, t1: arr[s + 1].t, nl: el.nl || null, k: el.k,
      });
    }
  }
  return {
    nodes: Float64Array.from(coords), nodeModelId: Int32Array.from(nodeModelId), beams, shells, lineNodes,
    domainElems, domainNodes, modelNodeToMesh, warnings: [],
    stats: { nodes: coords.length / 3, beams: beams.length, shells: shells.length },
  };
}

export function close(actual, expected, relTol, msg = '') {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-30);
  assert.ok(err <= relTol, `${msg} expected ${expected}, got ${actual} (rel.err ${err.toExponential(2)} > ${relTol})`);
}

export function absClose(actual, expected, absTol, msg = '') {
  assert.ok(Math.abs(actual - expected) <= absTol, `${msg} expected ${expected}, got ${actual} (abs tol ${absTol})`);
}

/** Simple test runner: collects named tests, prints, exits with code 1 on failure */
export function runTests(tests) {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e}`); }
  }
  if (failed) { console.log(`${failed} test(s) failed`); process.exit(1); }
}

export function sumReactions(res, nn) {
  const s = [0, 0, 0, 0, 0, 0];
  for (let n = 0; n < nn; n++) for (let k = 0; k < 6; k++) s[k] += res.reac[6 * n + k];
  return s;
}

export const FIX = ['F', 'F', 'F', 'F', 'F', 'F'];
export const PIN = ['F', 'F', 'F', 0, 0, 0];
