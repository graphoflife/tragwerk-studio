// Shell element verification: Navier plate (MITC4), membrane deep-beam cantilever (QM6),
// load conversion (surface, line loads on domain edges, self weight), temperature, Winkler bedding.
import assert from 'node:assert/strict';
import { runStatic } from '../../js/fem/index.js';
import { baseModel, buildTestMesh, close, absClose, runTests, sumReactions } from './helpers.mjs';

const CONC = { id: 2, name: 'C30', type: 'concrete', E: 30e6, nu: 0.3, rho: 2.5, alpha: 1e-5 };
const tests = [];
const T = (n, f) => tests.push([n, f]);

/** square/rectangular horizontal plate a×b with 4 edge geometry lines 1..4 */
function plateModel({ a = 4, b = 4, t = 0.04, type = 'plate', mat = CONC, edgeSup } = {}) {
  const m = baseModel();
  m.materials.push(mat);
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: a, y: 0, z: 0 }, { id: 3, x: a, y: b, z: 0 }, { id: 4, x: 0, y: b, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: null }, { id: 2, n1: 2, n2: 3, element: null },
    { id: 3, n1: 3, n2: 4, element: null }, { id: 4, n1: 4, n2: 1, element: null });
  m.domains.push({ id: 1, nodes: [1, 2, 3, 4], type, material: mat.id, thickness: t });
  if (edgeSup !== false) {
    // hard simply supported: w = 0 and tangential rotation fixed
    m.supports.push({ id: 1, type: 'line', line: 1, dofs: [0, 0, 'F', 0, 'F', 0] });
    m.supports.push({ id: 2, type: 'line', line: 3, dofs: [0, 0, 'F', 0, 'F', 0] });
    m.supports.push({ id: 3, type: 'line', line: 2, dofs: [0, 0, 'F', 'F', 0, 0] });
    m.supports.push({ id: 4, type: 'line', line: 4, dofs: [0, 0, 'F', 'F', 0, 0] });
  }
  return m;
}

const centerNode = (mesh, a, b) => {
  for (let i = 0; i < mesh.nodes.length / 3; i++) {
    if (Math.abs(mesh.nodes[3 * i] - a / 2) < 1e-9 && Math.abs(mesh.nodes[3 * i + 1] - b / 2) < 1e-9) return i;
  }
  return -1;
};
const nodalShell = (mesh, res, n, k) => {
  for (let e = 0; e < mesh.shells.length; e++) {
    const c = mesh.shells[e].nodes.indexOf(n);
    if (c >= 0) return res.shells[e * 32 + c * 8 + k];
  }
  return NaN;
};

T('Navier SS square plate 16×16 (MITC4): w = 0.00406 qa⁴/D, mx = 0.0479 qa²', () => {
  const a = 4, t = 0.04, q = 10;
  const m = plateModel({ a, b: a, t });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'surface', domain: 1, dir: 'Z', q: -q });
  const mesh = buildTestMesh(m, { grid: { 1: [16, 16] } });
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.ok(r.warnings.some((w) => /suppressed/.test(w)), 'in-plane DOFs of plate suppressed');
  const c = r.cases['LC:1'];
  const D = CONC.E * t ** 3 / (12 * (1 - 0.09));
  const n = centerNode(mesh, a, a);
  close(c.disp[6 * n + 2], -0.00406 * q * a ** 4 / D, 0.01, 'w center');
  close(nodalShell(mesh, c, n, 3), 0.0479 * q * a * a, 0.03, 'mx center');
  close(nodalShell(mesh, c, n, 4), 0.0479 * q * a * a, 0.03, 'my center');
  absClose(nodalShell(mesh, c, n, 5), 0, 1e-6, 'mxy center');
  const s = sumReactions(c, mesh.nodes.length / 3);
  close(s[2], q * a * a, 1e-9, 'sum Rz');
  // σ_bottom > 0 under sagging: mx > 0
  assert.ok(nodalShell(mesh, c, n, 3) > 0);
  // shear force at mid of edge x = 0: vx ≈ +0.338 q a (Kirchhoff Qx; positive like beam Vz(0))
  let ne = -1;
  for (let i = 0; i < mesh.nodes.length / 3; i++) if (Math.abs(mesh.nodes[3 * i]) < 1e-9 && Math.abs(mesh.nodes[3 * i + 1] - a / 2) < 1e-9) ne = i;
  const vx = nodalShell(mesh, c, ne, 6);
  assert.ok(vx > 0.25 * q * a && vx < 0.45 * q * a, `vx edge ${vx}`);
});

T('Membrane deep-beam cantilever (QM6) vs Timoshenko beam theory', () => {
  const L = 10, h = 1, t = 0.2, P = 100;
  const mat = { id: 3, E: 30e6, nu: 0.2, rho: 0 };
  for (const [type, grid, tol] of [['membrane', [20, 4], 0.015], ['membrane', [10, 2], 0.03], ['shell', [20, 4], 0.015]]) {
    const m = baseModel();
    m.materials.push(mat);
    m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }, { id: 3, x: L, y: 0, z: h }, { id: 4, x: 0, y: 0, z: h });
    m.lines.push({ id: 1, n1: 4, n2: 1, element: null }, { id: 2, n1: 2, n2: 3, element: null });
    m.domains.push({ id: 1, nodes: [1, 2, 3, 4], type, material: 3, thickness: t });
    m.supports.push({ id: 1, type: 'line', line: 1, dofs: type === 'shell' ? ['F', 'F', 'F', 'F', 'F', 'F'] : ['F', 0, 'F', 0, 0, 0] });
    m.loadCases.push({ id: 1 });
    m.loads.push({ id: 1, lc: 1, type: 'lineDist', line: 2, dir: 'Z', q1: -P / h, q2: -P / h });
    const mesh = buildTestMesh(m, { grid: { 1: grid } });
    const r = runStatic(m, mesh);
    assert.equal(r.error, null, JSON.stringify(r.error));
    const c = r.cases['LC:1'];
    const G = mat.E / 2.4, I = t * h ** 3 / 12;
    const exact = P * L ** 3 / (3 * mat.E * I) + P * L / (5 / 6 * G * t * h);
    // average tip deflection over the loaded edge
    let s = 0, k = 0;
    for (const { node } of mesh.lineNodes[2]) { s += c.disp[6 * node + 2]; k++; }
    close(-s / k, exact, tol, `${type} ${grid} tip`);
    const R = sumReactions(c, mesh.nodes.length / 3);
    close(R[2], P, 1e-9, 'Rz');
  }
});

T('Membrane patch: uniform tension gives exact nx on a distorted mesh', () => {
  const m = baseModel();
  m.materials.push({ id: 3, E: 30e6, nu: 0.25, alpha: 1e-5 });
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 }, { id: 3, x: 2.6, y: 1.5, z: 0 }, { id: 4, x: -0.3, y: 1.2, z: 0 });
  m.lines.push({ id: 1, n1: 4, n2: 1, element: null });
  m.domains.push({ id: 1, nodes: [1, 2, 3, 4], type: 'membrane', material: 3, thickness: 0.1 });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: ['F', 'F', 'F', 0, 0, 0] });
  m.supports.push({ id: 2, type: 'node', node: 2, dofs: [0, 'F', 0, 0, 0, 0] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'tempDomain', domain: 1, dT: 10 });
  const mesh = buildTestMesh(m, { grid: { 1: [3, 2] } });
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  // free thermal expansion: no stresses, displacement = α ΔT x
  for (const v of c.shellsRaw) absClose(v, 0, 1e-6, 'stress-free');
  const n3 = mesh.modelNodeToMesh[3];
  close(c.disp[6 * n3], 2.6 * 1e-5 * 10, 1e-9, 'ux free expansion');
});

T('Line load on domain edge (no element), self weight & projected surface load: equilibrium', () => {
  const a = 4, t = 0.2;
  const m = plateModel({ a, b: 3, t, type: 'shell', edgeSup: false });
  m.supports.push({ id: 1, type: 'line', line: 4, dofs: ['F', 'F', 'F', 'F', 'F', 'F'] });
  m.loadCases.push({ id: 1, selfWeight: true });
  m.loads.push({ id: 1, lc: 1, type: 'lineDist', line: 2, dir: 'Z', q1: -2, q2: -6, a: 0.25, b: 1 });
  m.loads.push({ id: 2, lc: 1, type: 'surface', domain: 1, dir: 'z', q: -3 });
  m.loads.push({ id: 3, lc: 1, type: 'linePoint', line: 1, dir: 'Y', F: 7, pos: 0.4 });
  const mesh = buildTestMesh(m, { grid: { 1: [8, 6] } });
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  const S = sumReactions(c, mesh.nodes.length / 3);
  const W = 2.5 * 9.81 * t * a * 3;
  close(S[2], W + (2 + 6) / 2 * 0.75 * 3 + 3 * a * 3, 1e-9, 'Rz');
  close(S[1], -7, 1e-9, 'Ry');
  absClose(S[0], 0, 1e-8, 'Rx');
  // moment about the support line (x = 0) of the edge line load: centroid of trapezoid on x = a
  const My = S[4];
  assert.ok(Number.isFinite(My));
});

T('Winkler bedding: uniformly loaded free plate on elastic foundation settles q/k', () => {
  const a = 3, q = 20, k = 5000;
  const m = plateModel({ a, b: a, t: 0.3, type: 'plate', edgeSup: false });
  m.supports.push({ id: 1, type: 'surface', domain: 1, k: [0, 0, k] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'surface', domain: 1, dir: 'Z', q: -q });
  const mesh = buildTestMesh(m, { grid: { 1: [6, 6] } });
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  for (let n = 0; n < mesh.nodes.length / 3; n++) close(c.disp[6 * n + 2], -q / k, 1e-6, 'settlement');
  const S = sumReactions(c, mesh.nodes.length / 3);
  close(S[2], q * a * a, 1e-9, 'bedding reaction');
  for (const v of c.shells) absClose(v, 0, 1e-6, 'no bending');
});

T('Plate temperature gradient on clamped plate → m = D(1+ν)αΔT/t (restrained curvature)', () => {
  const a = 2, t = 0.2, dTz = 10;
  const m = plateModel({ a, b: a, t, type: 'plate', edgeSup: false });
  for (let i = 1; i <= 4; i++) m.supports.push({ id: i, type: 'line', line: i, dofs: [0, 0, 'F', 'F', 'F', 0] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'tempDomain', domain: 1, dTz });
  const mesh = buildTestMesh(m, { grid: { 1: [4, 4] } });
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  // fully restrained: κ = 0 → m = −D_b(1+ν)·κ0, κ0 = −α dTz/t → m = D(1+ν)α dTz/t (sagging-positive)
  const D = CONC.E * t ** 3 / (12 * (1 - 0.09));
  const mExp = D * 1.3 * 1e-5 * dTz / t;
  for (let e = 0; e < mesh.shells.length; e++) for (let k = 0; k < 4; k++) {
    close(c.shellsRaw[e * 32 + k * 8 + 3], mExp, 1e-6, 'mx');
    close(c.shellsRaw[e * 32 + k * 8 + 4], mExp, 1e-6, 'my');
  }
});

runTests(tests);
