// Spring / rigid elements, spring supports, line springs, inclined plates (skew zero-stiffness
// directions), projected loads, case selection.
import assert from 'node:assert/strict';
import { runStatic } from '../../js/fem/index.js';
import { baseModel, section, buildTestMesh, close, absClose, runTests, sumReactions, FIX } from './helpers.mjs';

const E = 210e6, G = 80.77e6, A = 5.38e-3, Iy = 8.356e-5, Iz = 6.04e-6, It = 2.0e-7;
const tests = [];
const T = (n, f) => tests.push([n, f]);

T('2-node spring element (global k) and nodal spring support', () => {
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 0.5 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'spring', k: [100, 200, 300, 0, 0, 0] } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: FIX });
  m.supports.push({ id: 2, type: 'node', node: 2, dofs: [0, 0, 50, 'F', 'F', 'F'] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'node', node: 2, F: [10, -20, -35, 0, 0, 0] });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  const n2 = mesh.modelNodeToMesh[2];
  close(c.disp[6 * n2], 0.1, 1e-12, 'ux');
  close(c.disp[6 * n2 + 1], -0.1, 1e-12, 'uy');
  close(c.disp[6 * n2 + 2], -35 / 350, 1e-12, 'uz (spring element + support spring)');
  close(c.reac[6 * n2 + 2], 50 * 0.1, 1e-12, 'spring support reaction (pushes up)');
  close(c.reac[2], 300 * 0.1, 1e-12, 'fixed node reaction');
  // spring element force: elongation along local x (vertical member, ex = Z): N = kz·Δuz
  close(c.beams[0].N[0], 300 * -0.1, 1e-12, 'spring N (compression)');
});

T('Rigid link: cantilever with rigid arm, eccentric load → bending + torsion', () => {
  const L = 3, e = 0.5, P = 10;
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It: 1e-5 }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }, { id: 3, x: L, y: e, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 3 } });
  m.lines.push({ id: 2, n1: 2, n2: 3, element: { type: 'rigid' } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: FIX });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'node', node: 3, F: [0, 0, -P, 0, 0, 0] });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  const n3 = mesh.modelNodeToMesh[3];
  const exact = -(P * L ** 3 / (3 * E * Iy) + P * e * e * L / (G * 1e-5));
  close(c.disp[6 * n3 + 2], exact, 1e-4, 'arm tip deflection');
  close(c.reac[3], P * e, 1e-9, 'torsion reaction Mx');
  const b0 = c.beams[0];
  close(b0.T[0], -P * e, 1e-9, 'torsion in beam');   // T = Mx_c: left part carries −Pe
});

T('Line spring support: beam on elastic foundation with uniform load settles q/k', () => {
  const L = 8, q = 12, k = 3000;
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 16 } });
  m.supports.push({ id: 1, type: 'line', line: 1, dofs: [0, 'F', k, 0, 0, 0] });
  m.supports.push({ id: 2, type: 'node', node: 1, dofs: ['F', 0, 0, 'F', 0, 0] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'lineDist', line: 1, dir: 'Z', q1: -q, q2: -q });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  // continuous solution is a uniform settlement q/k; lumped springs + consistent end moments
  // (free ends) give a small discretisation error
  for (const { node } of mesh.lineNodes[1]) close(c.disp[6 * node + 2], -q / k, 0.02, 'settlement');
  const mid = mesh.lineNodes[1][8].node;
  close(c.disp[6 * mid + 2], -q / k, 0.005, 'settlement mid');
  close(sumReactions(c, mesh.nodes.length / 3)[2], q * L, 1e-9, 'total reaction');
});

function inclinedPlate(angleDeg, type, loadDir) {
  const a = 3, b = 2, t = 0.05;
  const c = Math.cos(angleDeg * Math.PI / 180), s = Math.sin(angleDeg * Math.PI / 180);
  const m = baseModel();
  m.materials.push({ id: 2, E: 30e6, nu: 0.2, rho: 2.5 });
  const P = [[0, 0], [a, 0], [a, b], [0, b]].map(([x, y]) => ({ x, y: y * c, z: y * s }));
  P.forEach((p, i) => m.nodes.push({ id: i + 1, ...p }));
  m.lines.push({ id: 1, n1: 1, n2: 2, element: null }, { id: 2, n1: 2, n2: 3, element: null },
    { id: 3, n1: 3, n2: 4, element: null }, { id: 4, n1: 4, n2: 1, element: null });
  m.domains.push({ id: 1, nodes: [1, 2, 3, 4], type, material: 2, thickness: t });
  for (let i = 1; i <= 4; i++) m.supports.push({ id: i, type: 'line', line: i, dofs: ['F', 'F', 'F', 0, 0, 0] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'surface', domain: 1, dir: loadDir, q: -4, projected: loadDir === 'Z' });
  return m;
}

T('Inclined plate (skew null directions) = horizontal plate for normal load; projected load', () => {
  for (const type of ['plate', 'shell']) {
    const res = [0, 35].map((ang) => {
      const m = inclinedPlate(ang, type, 'z');
      const mesh = buildTestMesh(m, { grid: { 1: [6, 4] } });
      const r = runStatic(m, mesh);
      assert.equal(r.error, null, JSON.stringify(r.error));
      return { c: r.cases['LC:1'], mesh, ang };
    });
    const [h, i] = res;
    const ez = [0, -Math.sin(35 * Math.PI / 180), Math.cos(35 * Math.PI / 180)];
    for (let n = 0; n < h.mesh.nodes.length / 3; n++) {
      const wn = ez[0] * i.c.disp[6 * n] + ez[1] * i.c.disp[6 * n + 1] + ez[2] * i.c.disp[6 * n + 2];
      absClose(wn, h.c.disp[6 * n + 2], 1e-9, `${type} normal deflection node ${n}`);
    }
    for (let k = 0; k < h.c.shells.length; k++) absClose(i.c.shells[k], h.c.shells[k], 1e-6, `${type} resultants`);
  }
  // projected vertical load: total = q × horizontal projection
  const m = inclinedPlate(35, 'shell', 'Z');
  const mesh = buildTestMesh(m, { grid: { 1: [6, 4] } });
  const r = runStatic(m, mesh);
  const S = sumReactions(r.cases['LC:1'], mesh.nodes.length / 3);
  close(S[2], 4 * 3 * 2 * Math.cos(35 * Math.PI / 180), 1e-9, 'projected: q per horizontal projection');
});

T('Case selection and combos:false', () => {
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: FIX });
  m.loadCases.push({ id: 1 }, { id: 2 });
  m.loads.push({ id: 1, lc: 2, type: 'node', node: 2, F: [0, 0, -1, 0, 0, 0] });
  m.combinations.push({ id: 5, factors: { 2: 2 } });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh, { cases: [2], combos: false });
  assert.deepEqual(Object.keys(r.cases), ['LC:2']);
  const r2 = runStatic(m, mesh, { cases: [1], combos: [5] });
  assert.ok(r2.cases['CO:5'] && r2.cases['LC:2'] && r2.cases['LC:1']);
  close(r2.cases['CO:5'].reac[2], 2, 1e-12, 'combo');
  assert.ok(r2.stats.dofs === 6 && r2.stats.ms >= 0);
});

runTests(tests);
