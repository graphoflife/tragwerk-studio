// Beam element verification: simply supported beam, cantilever (incl. skew 3D), local −y load,
// Timoshenko shear deflection, partial / trapezoidal / point loads against closed-form results.
import assert from 'node:assert/strict';
import { runStatic, lineForces } from '../../js/fem/index.js';
import { baseModel, section, buildTestMesh, close, absClose, runTests, sumReactions, lineAxes } from './helpers.mjs';

const E = 210e6, Iy = 8.356e-5, Iz = 6.04e-6, A = 5.38e-3;   // IPE 300-like

function ssBeam({ L = 6, div = 1, q = 10, dir = 'Z', extraLoads = [], sec = {} } = {}) {
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It: 2.0e-7, ...sec }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, beta: 0, divisions: div } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: ['F', 'F', 'F', 'F', 0, 0] });
  m.supports.push({ id: 2, type: 'node', node: 2, dofs: [0, 'F', 'F', 0, 0, 0] });
  m.loadCases.push({ id: 1, name: 'q' });
  if (q) m.loads.push({ id: 1, lc: 1, type: 'lineDist', line: 1, dir, q1: -q, q2: -q });
  extraLoads.forEach((ld, i) => m.loads.push({ id: 10 + i, lc: 1, ...ld }));
  return m;
}

const tests = [];
const T = (n, f) => tests.push([n, f]);

T('SS beam single element, udl: deflection, My, Vz, reactions', () => {
  const L = 6, q = 10;
  const m = ssBeam({ L, q });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  const b = c.beams[0];
  close(b.uz[5], -5 * q * L ** 4 / (384 * E * Iy), 1e-9, 'uz(L/2)');
  close(b.My[5], q * L * L / 8, 1e-9, 'My(L/2)');
  close(b.Vz[0], q * L / 2, 1e-9, 'Vz(0)');
  close(b.Vz[10], -q * L / 2, 1e-9, 'Vz(L)');
  absClose(b.My[0], 0, 1e-9, 'My(0)');
  const n2 = mesh.modelNodeToMesh[2];
  close(c.reac[2], q * L / 2, 1e-9, 'Rz1');
  close(c.reac[6 * n2 + 2], q * L / 2, 1e-9, 'Rz2');
});

T('SS beam 4 elements, udl: midspan node deflection and moments', () => {
  const L = 6, q = 10;
  const m = ssBeam({ L, q, div: 4 });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null);
  const c = r.cases['LC:1'];
  const mid = mesh.lineNodes[1].find((e) => Math.abs(e.t - 0.5) < 1e-9).node;
  close(c.disp[6 * mid + 2], -5 * q * L ** 4 / (384 * E * Iy), 1e-9, 'uz mid');
  const lf = lineForces(mesh, c, 1);
  const k = lf.x.findIndex((x) => Math.abs(x - L / 2) < 1e-9);
  close(lf.My[k], q * L * L / 8, 1e-9, 'My(L/2)');
  close(lf.Vz[0], q * L / 2, 1e-9, 'Vz(0)');
  close(lf.x[lf.x.length - 1], L, 1e-12, 'x end');
  // quarter point moment 3qL²/32 and deflection along span
  const kq = lf.x.findIndex((x) => Math.abs(x - L / 4) < 1e-9);
  close(lf.My[kq], 3 * q * L * L / 32, 1e-9, 'My(L/4)');
  const x = 0.3 * L / 4; // inside first element, station 3
  const exact = -q * x * (L ** 3 - 2 * L * x * x + x ** 3) / (24 * E * Iy);
  close(lf.uz[3], exact, 1e-9, 'uz(x) inside element');
  const s = sumReactions(c, mesh.nodes.length / 3);
  close(s[2], q * L, 1e-9, 'sum Rz');
});

T('Load in −y local on SS beam → Mz(L/2) > 0, Vy = dMz/dx', () => {
  const L = 5, q = 4;
  const m = ssBeam({ L, q, dir: 'y' });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  const b = r.cases['LC:1'].beams[0];
  close(b.Mz[5], q * L * L / 8, 1e-9, 'Mz(L/2)');
  close(b.Vy[0], q * L / 2, 1e-9, 'Vy(0)');
  close(b.uy[5], -5 * q * L ** 4 / (384 * E * Iz), 1e-9, 'uy(L/2)');
  assert.ok(b.Mz[5] > 0);
});

T('Cantilever tip load −Z: tip deflection, My(0) = −PL, Vz = +P', () => {
  const L = 4, P = 12;
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It: 2e-7 }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 3 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: ['F', 'F', 'F', 'F', 'F', 'F'] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'node', node: 2, F: [0, 0, -P, 0, 0, 0] });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null);
  const c = r.cases['LC:1'];
  const n2 = mesh.modelNodeToMesh[2];
  close(c.disp[6 * n2 + 2], -P * L ** 3 / (3 * E * Iy), 1e-9, 'tip');
  const lf = lineForces(mesh, c, 1);
  close(lf.My[0], -P * L, 1e-9, 'My(0)');
  for (const v of lf.Vz) close(v, P, 1e-9, 'Vz');
  close(c.reac[2], P, 1e-9, 'Rz');
  close(c.reac[4], -P * L, 1e-9, 'Ry (moment reaction)');
});

T('Cantilever along skew 3D direction gives identical local results', () => {
  const L = 4, P = 12;
  const dir = [1, 2, 0.7];
  const l = Math.hypot(...dir);
  const p2 = dir.map((v) => v / l * L);
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It: 2e-7 }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: p2[0], y: p2[1], z: p2[2] });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, beta: 30, divisions: 2 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: ['F', 'F', 'F', 'F', 'F', 'F'] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'linePoint', line: 1, dir: 'z', F: -P, pos: 1 });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null);
  const c = r.cases['LC:1'];
  const lf = lineForces(mesh, c, 1);
  close(lf.My[0], -P * L, 1e-9, 'My(0)');
  for (const v of lf.Vz) close(v, P, 1e-9, 'Vz');
  for (const v of lf.Mz) absClose(v, 0, 1e-8, 'Mz');
  close(lf.uz[lf.uz.length - 1], -P * L ** 3 / (3 * E * Iy), 1e-9, 'local tip uz');
  // global tip displacement along ez
  const ax = lineAxes([0, 0, 0], p2, 30);
  const n2 = mesh.modelNodeToMesh[2];
  const u = [0, 1, 2].map((k) => c.disp[6 * n2 + k]);
  close(u[0] * ax.ez[0] + u[1] * ax.ez[1] + u[2] * ax.ez[2], -P * L ** 3 / (3 * E * Iy), 1e-9, 'global tip along ez');
  const s = sumReactions(c, mesh.nodes.length / 3);
  for (let k = 0; k < 3; k++) close(s[k], -(-P * ax.ez[k]), 1e-9, 'reaction force');
});

T('Timoshenko: cantilever with shear area adds PL/(G·Avz)', () => {
  const L = 2, P = 50, Avz = 2.5e-3;
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It: 2e-7, Avz, Avy: 3e-3 }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 1 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: ['F', 'F', 'F', 'F', 'F', 'F'] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'lineDist', line: 1, dir: 'Z', q1: -P, q2: -P });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  const c = r.cases['LC:1'];
  const G = 80.77e6;
  const exact = -(P * L ** 4 / (8 * E * Iy) + P * L * L / (2 * G * Avz));
  close(c.disp[6 * mesh.modelNodeToMesh[2] + 2], exact, 1e-9, 'tip with shear');
  const b = c.beams[0];
  const x = L / 2;
  const ex = -(P * x * x * (6 * L * L - 4 * L * x + x * x) / (24 * E * Iy) + P * (L * x - x * x / 2) / (G * Avz));
  close(b.uz[5], ex, 1e-9, 'uz(L/2) with shear');
});

T('Partial trapezoidal + point load on 1 element equals fine mesh (exact recovery)', () => {
  const L = 8;
  const loads = [
    { type: 'lineDist', line: 1, dir: 'Z', q1: -3, q2: -9, a: 0.2, b: 0.7 },
    { type: 'linePoint', line: 1, dir: 'Z', F: -20, pos: 0.35 },
    { type: 'linePoint', line: 1, dir: 'Y', F: 5, pos: 0.6, moment: true },
    { type: 'lineDist', line: 1, dir: 'x', q1: 2, q2: 1 },
  ];
  const sec = { Avz: 2e-3, Avy: 2.5e-3 };
  const m1 = ssBeam({ L, q: 0, div: 1, extraLoads: loads, sec });
  const m2 = ssBeam({ L, q: 0, div: 20, extraLoads: loads, sec });
  const r1 = runStatic(m1, buildTestMesh(m1)).cases['LC:1'];
  const mesh2 = buildTestMesh(m2);
  const r2 = runStatic(m2, mesh2).cases['LC:1'];
  const lf = lineForces(mesh2, r2, 1);
  const b = r1.beams[0];
  for (let k = 0; k <= 10; k++) {
    const x = b.x[k];
    const j = lf.x.findIndex((v) => Math.abs(v - x) < 1e-9);
    assert.ok(j >= 0);
    // compare (station at a point-load location may pick other side of the jump; skip x = 0.35L none here)
    absClose(b.My[k], lf.My[j], 1e-8 * 100, `My at ${x}`);
    absClose(b.uz[k], lf.uz[j], 1e-12, `uz at ${x}`);
    absClose(b.N[k], lf.N[j], 1e-8, `N at ${x}`);
  }
  // equilibrium: sum of reactions
  const total = -(3 + 9) / 2 * 0.5 * L - 20;
  const s = sumReactions(r1, 2);
  close(s[2], -total, 1e-9, 'sum Rz');
});

runTests(tests);
