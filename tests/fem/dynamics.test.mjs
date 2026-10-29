// Modal and linear buckling verification.
import assert from 'node:assert/strict';
import { runModal, runBuckling, runStatic } from '../../js/fem/index.js';
import { baseModel, section, buildTestMesh, close, runTests, FIX } from './helpers.mjs';

const E = 210e6, A = 5.38e-3, Iy = 8.356e-5, Iz = 6.04e-6, It = 2.0e-7, RHO = 7.85;
const tests = [];
const T = (n, f) => tests.push([n, f]);

function cantilever({ L = 5, div = 10, sec = { A, Iy, Iz, It }, mat } = {}) {
  const m = baseModel();
  if (mat) m.materials = [mat];
  m.sections.push(section(1, sec));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: div } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: FIX });
  return m;
}

T('Cantilever natural frequencies (10 elements, lumped mass) within 1 %', () => {
  const L = 5;
  const m = cantilever({ L });
  const mesh = buildTestMesh(m);
  const r = runModal(m, mesh, { nModes: 4 });
  assert.equal(r.error, null, JSON.stringify(r.error));
  const mbar = RHO * A;
  const fy = 3.516 / (L * L) * Math.sqrt(E * Iz / mbar) / (2 * Math.PI);
  const fz = 3.516 / (L * L) * Math.sqrt(E * Iy / mbar) / (2 * Math.PI);
  close(r.modes[0].f, fy, 0.01, 'f1 weak axis');
  assert.ok(r.modes[0].effMass[1] > 0.5, 'mode 1 is Y bending');
  const mz = r.modes.find((md) => md.effMass[2] > 0.5);
  assert.ok(mz, 'Z bending mode found');
  close(mz.f, fz, 0.01, 'f1 strong axis');
  close(r.modes[0].T, 1 / r.modes[0].f, 1e-12, 'T');
  // mass normalisation φᵀMφ = 1 (lumped translational masses)
  const half = 0.5 * RHO * A * L / 10;
  let s = 0;
  const nn = mesh.nodes.length / 3;
  for (let n = 0; n < nn; n++) {
    const mn = mesh.modelNodeToMesh[1] === n ? 0 : (mesh.modelNodeToMesh[2] === n ? half : 2 * half);
    for (let k = 0; k < 3; k++) s += mn * r.modes[0].shape[6 * n + k] ** 2;
  }
  close(s, 1, 1e-8, 'mass normalisation');
  close(r.totalMass[2], RHO * A * L * (1 - 0.05), 1e-9, 'free mass');
  // effective mass of the first bending mode ≈ 0.613·m̄L; ratio refers to the free mass (0.95·m̄L)
  close(r.modes[0].effMass[1], 0.613 / 0.95, 0.02, 'eff mass mode 1');
});

T('Effective modal masses sum to 1 with all modes; repeated frequencies resolved', () => {
  const sq = { A: 0.01, Iy: 2e-5, Iz: 2e-5, It: 3e-5 };
  const m = cantilever({ L: 4, div: 6, sec: sq });
  const mesh = buildTestMesh(m);
  const r = runModal(m, mesh, { nModes: 18 });
  assert.equal(r.error, null);
  assert.equal(r.modes.length, 18);
  const sum = [0, 0, 0];
  for (const md of r.modes) for (let k = 0; k < 3; k++) sum[k] += md.effMass[k];
  for (let k = 0; k < 3; k++) close(sum[k], 1, 1e-6, `sum effMass ${k}`);
  // symmetric section: modes 1 and 2 have the same frequency (Y and Z bending)
  close(r.modes[1].f, r.modes[0].f, 1e-7, 'double eigenvalue');
  assert.ok(r.modes[0].effMass[1] + r.modes[1].effMass[1] > 0.5 && r.modes[0].effMass[2] + r.modes[1].effMass[2] > 0.5);
});

T('Mass from load case: massless cantilever with tip mass (exact SDOF frequencies)', () => {
  const L = 3, M = 2;    // t
  const m = cantilever({ L, div: 4, mat: { id: 1, E, nu: 0.3, rho: 0 } });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'node', node: 2, F: [0, 0, -M * 9.81, 0, 0, 0] });
  m.loads.push({ id: 2, lc: 1, type: 'node', node: 2, F: [0, 0, +5, 0, 0, 0] });   // upward part is not mass
  const mesh = buildTestMesh(m);
  const r = runModal(m, mesh, { nModes: 3, massCase: 1, massFactor: 1, selfWeightMass: true });
  assert.equal(r.error, null, JSON.stringify(r.error));
  const Meff = (M * 9.81 - 5) / 9.81;
  close(r.totalMass[0], Meff, 1e-12, 'mass');
  const om = [Math.sqrt(3 * E * Iz / L ** 3 / Meff), Math.sqrt(3 * E * Iy / L ** 3 / Meff), Math.sqrt(E * A / L / Meff)].sort((a, b) => a - b);
  for (let i = 0; i < 3; i++) close(r.modes[i].omega, om[i], 1e-8, `omega ${i}`);
  for (const md of r.modes) close(md.effMass[0] + md.effMass[1] + md.effMass[2], 1, 1e-8, 'SDOF eff mass');
});

function column({ L = 5, div = 8, top = 'pinned', P = 1 } = {}) {
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: L });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: div } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: top === 'pinned' ? ['F', 'F', 'F', 0, 0, 'F'] : FIX });   // vertical member: torsion = rz
  if (top === 'pinned') m.supports.push({ id: 2, type: 'node', node: 2, dofs: ['F', 'F', 0, 0, 0, 0] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'node', node: 2, F: [0, 0, -P, 0, 0, 0] });
  return m;
}

T('Euler buckling: pinned column (8 elements) and fixed–free column within 1 %', () => {
  const L = 5;
  {
    const m = column({ L, top: 'pinned' });
    const r = runBuckling(m, buildTestMesh(m), { factors: { 1: 1 }, nModes: 2 });
    assert.equal(r.error, null, JSON.stringify(r.error));
    close(r.modes[0].lambda, Math.PI ** 2 * E * Iz / L ** 2, 0.01, 'pinned λ1');
    // 2nd mode: pure torsional buckling (no warping stiffness) P_T = G·It·A/Ip < 4π²EIz/L²
    close(r.modes[1].lambda, 80.77e6 * It * A / (Iy + Iz), 0.01, 'pinned λ2 (torsional)');
    // torsional modes are all degenerate (K_T ∝ K_G,T); the 2nd flexural mode follows them
    const r6 = runBuckling(m, buildTestMesh(m), { factors: { 1: 1 }, nModes: 6 });
    const l2 = 4 * Math.PI ** 2 * E * Iz / L ** 2;
    assert.ok(r6.modes.some((md) => Math.abs(md.lambda / l2 - 1) < 0.01), '2nd flexural mode ' + r6.modes.map((md) => md.lambda.toFixed(1)));
    close(r.modes[0].lambda, Math.PI ** 2 * E * Iz / L ** 2, 1e-3, 'pinned λ1 tight');
  }
  {
    const m = column({ L, top: 'free', P: 10 });
    const r = runBuckling(m, buildTestMesh(m), { factors: { 1: 2 }, nModes: 12 });
    assert.equal(r.error, null);
    close(r.modes[0].lambda, Math.PI ** 2 * E * Iz / (4 * L * L) / 20, 0.01, 'cantilever λ1');
    const ls = Math.PI ** 2 * E * Iy / (4 * L * L) / 20;
    assert.ok(r.modes.some((md) => Math.abs(md.lambda / ls - 1) < 0.01), 'cantilever strong axis mode');
    let mx = 0;
    for (const v of r.modes[0].shape) mx = Math.max(mx, Math.abs(v));
    assert.ok(mx >= 1 - 1e-12);
  }
});

T('Plate buckling: SS square plate under uniaxial compression (k = 4)', () => {
  const a = 1, t = 0.01, Ec = 70e6, nu = 0.3;
  const m = baseModel();
  m.materials.push({ id: 5, E: Ec, nu, rho: 0 });
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: a, y: 0, z: 0 }, { id: 3, x: a, y: a, z: 0 }, { id: 4, x: 0, y: a, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: null }, { id: 2, n1: 2, n2: 3, element: null },
    { id: 3, n1: 3, n2: 4, element: null }, { id: 4, n1: 4, n2: 1, element: null });
  m.domains.push({ id: 1, nodes: [1, 2, 3, 4], type: 'shell', material: 5, thickness: t });
  // SS edges (w = 0); in-plane: x = 0 edge ux fixed, y = 0 edge uy fixed, drilling at one node
  m.supports.push({ id: 1, type: 'line', line: 4, dofs: ['F', 0, 'F', 0, 0, 0] });
  m.supports.push({ id: 2, type: 'line', line: 2, dofs: [0, 0, 'F', 0, 0, 0] });
  m.supports.push({ id: 3, type: 'line', line: 1, dofs: [0, 'F', 'F', 0, 0, 0] });
  m.supports.push({ id: 4, type: 'line', line: 3, dofs: [0, 0, 'F', 0, 0, 0] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'lineDist', line: 2, dir: 'X', q1: -1, q2: -1 });   // nx = −1 kN/m
  const mesh = buildTestMesh(m, { grid: { 1: [12, 12] } });
  const r = runBuckling(m, mesh, { factors: { 1: 1 }, nModes: 2 });
  assert.equal(r.error, null, JSON.stringify(r.error));
  const D = Ec * t ** 3 / (12 * (1 - nu * nu));
  close(r.modes[0].lambda, 4 * Math.PI ** 2 * D / (a * a), 0.03, 'plate buckling');
});

runTests(tests);
