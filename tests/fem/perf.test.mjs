// Performance: 40×40 shell plate static solve (≈10k DOFs) and a ≈20k DOF variant.
// Prints timings; asserts only generous upper bounds so slow CI machines do not fail.
import assert from 'node:assert/strict';
import { runStatic, runModal } from '../../js/fem/index.js';
import { baseModel, buildTestMesh, runTests } from './helpers.mjs';

function plate(n) {
  const m = baseModel();
  m.materials.push({ id: 2, E: 30e6, nu: 0.2, rho: 2.5 });
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }, { id: 3, x: 10, y: 10, z: 0 }, { id: 4, x: 0, y: 10, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: null }, { id: 2, n1: 2, n2: 3, element: null },
    { id: 3, n1: 3, n2: 4, element: null }, { id: 4, n1: 4, n2: 1, element: null });
  m.domains.push({ id: 1, nodes: [1, 2, 3, 4], type: 'shell', material: 2, thickness: 0.25 });
  m.supports.push({ id: 1, type: 'line', line: 1, dofs: ['F', 'F', 'F', 0, 0, 0] });
  for (let i = 2; i <= 4; i++) m.supports.push({ id: i, type: 'line', line: i, dofs: [0, 0, 'F', 0, 0, 0] });
  m.supports.push({ id: 5, type: 'node', node: 3, dofs: ['F', 0, 0, 0, 0, 0] });
  m.loadCases.push({ id: 1, selfWeight: true }, { id: 2 });
  m.loads.push({ id: 1, lc: 2, type: 'surface', domain: 1, dir: 'Z', q: -5 });
  m.combinations.push({ id: 1, factors: { 1: 1.35, 2: 1.5 } });
  const mesh = buildTestMesh(m, { grid: { 1: [n, n] } });
  return { m, mesh };
}

const tests = [];
for (const n of [40, 58]) {
  tests.push([`shell plate ${n}×${n} static`, () => {
    const { m, mesh } = plate(n);
    const t0 = performance.now();
    const r = runStatic(m, mesh);
    const t = performance.now() - t0;
    assert.equal(r.error, null, JSON.stringify(r.error));
    console.log(`       ${n}×${n}: ${r.stats.dofs} DOFs, runStatic ${t.toFixed(0)} ms (2 load cases + 1 combination)`);
    assert.ok(t < 60000);
  }]);
}
tests.push(['shell plate 40×40 modal (6 modes)', () => {
  const { m, mesh } = plate(40);
  const t0 = performance.now();
  const r = runModal(m, mesh, { nModes: 6 });
  const t = performance.now() - t0;
  assert.equal(r.error, null);
  console.log(`       modal 40×40: ${t.toFixed(0)} ms, f1 = ${r.modes[0].f.toFixed(3)} Hz`);
  assert.ok(t < 60000);
}]);
runTests(tests);
