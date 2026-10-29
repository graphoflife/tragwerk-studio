// Nonlinear static: tension-only bracing, uplift supports, P-Δ amplification.
import assert from 'node:assert/strict';
import { runStatic, runBuckling } from '../../js/fem/index.js';
import { baseModel, section, buildTestMesh, close, absClose, runTests, sumReactions, FIX, PIN } from './helpers.mjs';

const E = 210e6, A = 5.38e-3, Iy = 8.356e-5, Iz = 6.04e-6, It = 2.0e-7;
const tests = [];
const T = (n, f) => tests.push([n, f]);

function bracedFrame() {
  // pin-jointed rectangle 4 × 3 in the XZ plane with two tension-only diagonals
  const m = baseModel();
  m.sections.push(section(1, { A: 2e-3, Iy: 1e-6 }), section(2, { A: 5e-4, Iy: 1e-8 }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 3 }, { id: 4, x: 0, y: 0, z: 3 });
  const tr = (sec, nl) => ({ type: 'truss', material: 1, section: sec, nl });
  m.lines.push({ id: 1, n1: 1, n2: 4, element: tr(1) }, { id: 2, n1: 2, n2: 3, element: tr(1) }, { id: 3, n1: 4, n2: 3, element: tr(1) },
    { id: 4, n1: 1, n2: 3, element: tr(2, 'tension') }, { id: 5, n1: 2, n2: 4, element: tr(2, 'tension') });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: PIN }, { id: 2, type: 'node', node: 2, dofs: PIN },
    { id: 3, type: 'node', node: 3, dofs: [0, 'F', 0, 0, 0, 0] }, { id: 4, type: 'node', node: 4, dofs: [0, 'F', 0, 0, 0, 0] });
  m.loadCases.push({ id: 1, name: 'H' }, { id: 2, name: 'H-' });
  m.loads.push({ id: 1, lc: 1, type: 'node', node: 4, F: [10, 0, 0, 0, 0, 0] });
  m.loads.push({ id: 2, lc: 2, type: 'node', node: 4, F: [-10, 0, 0, 0, 0, 0] });
  return m;
}

T('Tension-only X bracing: compression diagonal drops out (nonlinear), both act (linear)', () => {
  const H = 10;
  const m = bracedFrame();
  const mesh = buildTestMesh(m);
  const lin = runStatic(m, mesh);
  assert.equal(lin.error, null);
  const nlin = runStatic(m, mesh, { nonlinear: true });
  assert.equal(nlin.error, null, JSON.stringify(nlin.error));
  const bi = (line) => mesh.beams.findIndex((b) => b.line === line);
  const c = nlin.cases['LC:1'];
  close(c.beams[bi(4)].N[5], H * 5 / 4, 1e-9, 'tension diagonal');
  absClose(c.beams[bi(5)].N[5], 0, 1e-12, 'compression diagonal inactive');
  close(c.beams[bi(2)].N[5], -H * 3 / 4, 1e-9, 'right column');
  const l = lin.cases['LC:1'];
  assert.ok(l.beams[bi(5)].N[5] < -1, 'linear: compression in diagonal 5');
  // reversed load: the other diagonal carries it
  const c2 = nlin.cases['LC:2'];
  close(c2.beams[bi(5)].N[5], H * 5 / 4, 1e-9, 'reversed: diagonal 5 in tension');
  absClose(c2.beams[bi(4)].N[5], 0, 1e-12, 'reversed: diagonal 4 inactive');
  assert.ok(nlin.warnings.some((w) => /inactive/.test(w)));
  // with combinations: each combination solved directly
  m.combinations.push({ id: 1, factors: { 1: 1.5 } }, { id: 2, factors: { 1: 1, 2: 2 } });
  const nc = runStatic(m, mesh, { nonlinear: true });
  close(nc.cases['CO:1'].beams[bi(4)].N[5], 1.5 * H * 5 / 4, 1e-9, 'CO1');
  close(nc.cases['CO:2'].beams[bi(5)].N[5], H * 5 / 4, 1e-9, 'CO2 (net load −H)');
  assert.equal(nc.cases['LC:1'], undefined, 'load cases not solved when combinations exist');
});

T('Uplift support releases under tension, linear analysis keeps it bilateral', () => {
  const q = 10, L = 4;
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }, { id: 3, x: 2 * L, y: 0, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 2 } });
  m.lines.push({ id: 2, n1: 2, n2: 3, element: { type: 'beam', material: 1, section: 1, divisions: 2 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: [0, 'F', 'F', 'F', 0, 0], uplift: true });
  m.supports.push({ id: 2, type: 'node', node: 2, dofs: ['F', 'F', 'F', 0, 0, 0] });
  m.supports.push({ id: 3, type: 'node', node: 3, dofs: [0, 'F', 'F', 0, 0, 0] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'lineDist', line: 2, dir: 'Z', q1: -q, q2: -q });
  const mesh = buildTestMesh(m);
  const lin = runStatic(m, mesh).cases['LC:1'];
  close(lin.reac[2], -q * L / 16, 1e-9, 'linear two-span: R_A = −qL/16');
  const r = runStatic(m, mesh, { nonlinear: true });
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  absClose(c.reac[2], 0, 1e-9, 'R_A after lift-off');
  close(c.reac[6 * mesh.modelNodeToMesh[2] + 2], q * L / 2, 1e-9, 'R_B');
  close(c.reac[6 * mesh.modelNodeToMesh[3] + 2], q * L / 2, 1e-9, 'R_C');
  assert.ok(c.disp[2] > 0, 'node A lifts');
  // downward load on span 1 as well → support in contact again
  m.loads.push({ id: 2, lc: 1, type: 'lineDist', line: 1, dir: 'Z', q1: -q, q2: -q });
  const r2 = runStatic(m, buildTestMesh(m), { nonlinear: true }).cases['LC:1'];
  close(r2.reac[2], 3 * q * L / 8, 1e-9, 'contact: R_A = 3qL/8');
  // uplift spring: same behaviour
  m.loads.pop();
  m.supports[0].dofs = [0, 'F', 1e9, 'F', 0, 0];
  const r3 = runStatic(m, buildTestMesh(m), { nonlinear: true }).cases['LC:1'];
  absClose(r3.reac[2], 0, 1e-9, 'uplift spring released');
  close(sumReactions(r3, mesh.nodes.length / 3)[2], q * L, 1e-9, 'equilibrium');
});

T('P-Δ: sway amplification ≈ 1/(1 − 1/α_cr) for a cantilever column', () => {
  const L = 4, H = 1;
  const PcrTheory = Math.PI ** 2 * E * Iz / (4 * L * L);
  const P = 0.3 * PcrTheory;
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It: 1e-4 }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: L });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 8 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: FIX });
  m.loadCases.push({ id: 1, name: 'P' }, { id: 2, name: 'H' });
  m.loads.push({ id: 1, lc: 1, type: 'node', node: 2, F: [0, 0, -P, 0, 0, 0] });
  // weak-axis sway: local y of a vertical member is −Y → push in Y
  m.loads.push({ id: 2, lc: 2, type: 'node', node: 2, F: [0, H, 0, 0, 0, 0] });
  m.combinations.push({ id: 1, factors: { 1: 1, 2: 1 } });
  const mesh = buildTestMesh(m);
  const top = 6 * mesh.modelNodeToMesh[2] + 1;
  const lin = runStatic(m, mesh).cases['CO:1'].disp[top];
  const pd = runStatic(m, mesh, { pDelta: true });
  assert.equal(pd.error, null);
  const d2 = pd.cases['CO:1'].disp[top];
  const bk = runBuckling(m, mesh, { factors: { 1: 1 }, nModes: 1 });
  const acr = bk.modes[0].lambda;
  close(acr, 1 / 0.3, 0.005, 'alpha_cr');
  close(d2 / lin, 1 / (1 - 1 / acr), 0.01, 'amplification');
  // exact second-order solution of the cantilever: δ = H/(P k)·(tan kL − kL)
  const k = Math.sqrt(P / (E * Iz));
  close(d2, H / (P * k) * (Math.tan(k * L) - k * L), 0.005, 'exact second order');
  assert.ok(pd.cases['CO:1'].iterations > 1);
  // base moment includes P·δ
  const b0 = pd.cases['CO:1'].beams[mesh.beams.findIndex((b) => b.t0 === 0)];
  close(Math.abs(b0.Mz[0]), H * L + P * d2, 0.01, 'second-order base moment');
});

runTests(tests);
