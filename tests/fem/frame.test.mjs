// Frames & trusses: 3D equilibrium with mixed loads, hinges (releases), truss forces,
// temperature, mechanism / no-support detection, combinations and envelopes.
import assert from 'node:assert/strict';
import { runStatic, combineCases, envelope, lineForces } from '../../js/fem/index.js';
import { baseModel, section, buildTestMesh, close, absClose, runTests, lineAxes, FIX, PIN } from './helpers.mjs';

const E = 210e6, A = 5.38e-3, Iy = 8.356e-5, Iz = 6.04e-6, It = 2.0e-7;
const tests = [];
const T = (n, f) => tests.push([n, f]);

function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

T('Random 3D frame: global force and moment equilibrium (mixed loads, self weight)', () => {
  const rand = rng(7);
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It, Avy: 2e-3, Avz: 2.5e-3, h: 0.3, b: 0.15 }));
  // 2 x 2 bays, 2 storeys, slightly perturbed coordinates
  let id = 1;
  const nid = {};
  for (let k = 0; k <= 2; k++) for (let j = 0; j <= 1; j++) for (let i = 0; i <= 2; i++) {
    const p = { id, x: 4 * i + (k ? rand() * 0.3 : 0), y: 5 * j + (k ? rand() * 0.3 : 0), z: 3.2 * k };
    m.nodes.push(p); nid[`${i},${j},${k}`] = id++;
  }
  let lid = 1;
  const addLine = (a, b, beta = 0, extra = {}) => m.lines.push({ id: lid++, n1: a, n2: b, element: { type: 'beam', material: 1, section: 1, beta, divisions: 3, ...extra } });
  for (let k = 0; k < 2; k++) for (let j = 0; j <= 1; j++) for (let i = 0; i <= 2; i++) addLine(nid[`${i},${j},${k}`], nid[`${i},${j},${k + 1}`], 15 * i);
  for (let k = 1; k <= 2; k++) {
    for (let j = 0; j <= 1; j++) for (let i = 0; i < 2; i++) addLine(nid[`${i},${j},${k}`], nid[`${i + 1},${j},${k}`], 0, k === 2 && i === 1 ? { releases: { i: [0, 0, 0, 0, 1, 1], j: [0, 0, 0, 0, 0, 0] } } : {});
    for (let i = 0; i <= 2; i++) addLine(nid[`${i},0,${k}`], nid[`${i},1,${k}`], 10);
  }
  for (let j = 0; j <= 1; j++) for (let i = 0; i <= 2; i++) m.supports.push({ id: m.supports.length + 1, type: 'node', node: nid[`${i},${j},0`], dofs: (i + j) % 2 ? FIX : PIN });
  m.loadCases.push({ id: 1, name: 'mixed', selfWeight: true });
  const loads = [];
  const nl = m.lines.length;
  for (let k = 0; k < 12; k++) {
    const line = 1 + Math.floor(rand() * nl);
    const dirs = ['X', 'Y', 'Z', 'x', 'y', 'z'];
    const dir = dirs[Math.floor(rand() * 6)];
    const a = rand() * 0.5, b = a + 0.1 + rand() * (0.9 - a);
    loads.push({ type: 'lineDist', line, dir, q1: (rand() - 0.5) * 20, q2: (rand() - 0.5) * 20, a, b, projected: rand() > 0.5 && dir === dir.toUpperCase() });
    loads.push({ type: 'linePoint', line: 1 + Math.floor(rand() * nl), dir: dirs[Math.floor(rand() * 6)], F: (rand() - 0.5) * 30, pos: rand(), moment: rand() > 0.7 });
  }
  for (let k = 0; k < 4; k++) {
    const node = 1 + Math.floor(rand() * m.nodes.length);
    loads.push({ type: 'node', node, F: [0, 1, 2, 3, 4, 5].map(() => (rand() - 0.5) * 10) });
  }
  loads.forEach((l, i) => m.loads.push({ id: i + 1, lc: 1, ...l }));
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  // applied resultant
  const pos = new Map(m.nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  const F = [0, 0, 0], M = [0, 0, 0];
  const addF = (p, f, mom = [0, 0, 0]) => {
    for (let k = 0; k < 3; k++) F[k] += f[k];
    M[0] += p[1] * f[2] - p[2] * f[1] + mom[0];
    M[1] += p[2] * f[0] - p[0] * f[2] + mom[1];
    M[2] += p[0] * f[1] - p[1] * f[0] + mom[2];
  };
  const G = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
  for (const ld of m.loads) {
    if (ld.type === 'node') { addF(pos.get(ld.node), ld.F.slice(0, 3), ld.F.slice(3)); continue; }
    const line = m.lines.find((l) => l.id === ld.line);
    const p1 = pos.get(line.n1), p2 = pos.get(line.n2);
    const L = Math.hypot(...p2.map((v, k) => v - p1[k]));
    const ax = lineAxes(p1, p2, line.element.beta);
    const at = (t) => p1.map((v, k) => v + t * (p2[k] - v));
    let d;
    if (G[ld.dir]) {
      d = G[ld.dir];
      if (ld.projected) { const e = ax.ex[0] * d[0] + ax.ex[1] * d[1] + ax.ex[2] * d[2]; d = d.map((v) => v * Math.sqrt(1 - e * e)); }
    } else d = ax[{ x: 'ex', y: 'ey', z: 'ez' }[ld.dir]];
    if (ld.type === 'lineDist') {
      // integrate numerically along the loaded range
      const n = 200;
      for (let s = 0; s < n; s++) {
        const t = ld.a + (ld.b - ld.a) * (s + 0.5) / n;
        const q = ld.q1 + (ld.q2 - ld.q1) * (t - ld.a) / (ld.b - ld.a);
        const w = q * (ld.b - ld.a) * L / n;
        addF(at(t), d.map((v) => v * w));
      }
    } else if (ld.moment) addF(at(ld.pos), [0, 0, 0], d.map((v) => v * ld.F));
    else addF(at(ld.pos), d.map((v) => v * ld.F));
  }
  // self weight
  for (const l of m.lines) {
    const p1 = pos.get(l.n1), p2 = pos.get(l.n2);
    const L = Math.hypot(...p2.map((v, k) => v - p1[k]));
    addF(p1.map((v, k) => (v + p2[k]) / 2), [0, 0, -7.85 * 9.81 * A * L]);
  }
  // reactions
  const R = [0, 0, 0], MR = [0, 0, 0];
  for (let n = 0; n < mesh.nodes.length / 3; n++) {
    const p = [mesh.nodes[3 * n], mesh.nodes[3 * n + 1], mesh.nodes[3 * n + 2]];
    const f = [0, 1, 2].map((k) => c.reac[6 * n + k]);
    for (let k = 0; k < 3; k++) R[k] += f[k];
    MR[0] += p[1] * f[2] - p[2] * f[1] + c.reac[6 * n + 3];
    MR[1] += p[2] * f[0] - p[0] * f[2] + c.reac[6 * n + 4];
    MR[2] += p[0] * f[1] - p[1] * f[0] + c.reac[6 * n + 5];
  }
  const scale = Math.hypot(...F) + 1;
  for (let k = 0; k < 3; k++) absClose(R[k] + F[k], 0, 1e-6 * scale, `force eq ${k}`);
  for (let k = 0; k < 3; k++) absClose(MR[k] + M[k], 0, 1e-5 * scale * 10, `moment eq ${k}`);
});

T('Released end: fixed beam with ry released at j = propped cantilever = pinned support', () => {
  const L = 6, q = 10;
  const make = (hinge) => {
    const m = baseModel();
    m.sections.push(section(1, { A, Iy, Iz, It }));
    m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 });
    m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 2, releases: hinge ? { i: [0, 0, 0, 0, 0, 0], j: [0, 0, 0, 0, 1, 0] } : undefined } });
    m.supports.push({ id: 1, type: 'node', node: 1, dofs: FIX });
    m.supports.push({ id: 2, type: 'node', node: 2, dofs: hinge ? FIX : ['F', 'F', 'F', 'F', 0, 'F'] });
    m.loadCases.push({ id: 1 });
    m.loads.push({ id: 1, lc: 1, type: 'lineDist', line: 1, dir: 'Z', q1: -q, q2: -q });
    return m;
  };
  const res = [true, false].map((h) => {
    const m = make(h); const mesh = buildTestMesh(m);
    const r = runStatic(m, mesh);
    assert.equal(r.error, null);
    return { c: r.cases['LC:1'], mesh };
  });
  for (const { c, mesh } of res) {
    const lf = lineForces(mesh, c, 1);
    close(lf.My[0], -q * L * L / 8, 1e-9, 'My fixed end');
    absClose(lf.My[lf.My.length - 1], 0, 1e-8, 'My hinge');
    close(c.reac[6 * mesh.modelNodeToMesh[2] + 2], 3 * q * L / 8, 1e-9, 'R_j');
    close(c.reac[2], 5 * q * L / 8, 1e-9, 'R_i');
    const mid = mesh.lineNodes[1][1].node;
    // w(L/2) of propped cantilever: q L^4 / (192 EI)
    close(c.disp[6 * mid + 2], -q * L ** 4 / (192 * E * Iy), 1e-9, 'w mid');
  }
});

T('Truss: two-bar truss forces analytically, rotations suppressed', () => {
  const P = 100;
  const m = baseModel();
  m.sections.push(section(1, { A: 1e-3, Iy: 1e-6 }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 2, y: 0, z: 3 });
  m.lines.push({ id: 1, n1: 1, n2: 3, element: { type: 'truss', material: 1, section: 1 } });
  m.lines.push({ id: 2, n1: 3, n2: 2, element: { type: 'truss', material: 1, section: 1 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: PIN });
  m.supports.push({ id: 2, type: 'node', node: 2, dofs: PIN });
  m.supports.push({ id: 3, type: 'node', node: 3, dofs: [0, 'F', 0, 0, 0, 0] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'node', node: 3, F: [0, 0, -P, 0, 0, 0] });
  m.loads.push({ id: 2, lc: 1, type: 'node', node: 3, F: [30, 0, 0, 0, 0, 0] });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.ok(r.warnings.some((w) => /suppressed/.test(w)), 'rotation suppression warning');
  const c = r.cases['LC:1'];
  const s = 3 / Math.sqrt(13), co = 2 / Math.sqrt(13);
  // joint 3 equilibrium: bar1 (1→3) and bar2 (3→2) forces N1, N2 (tension +)
  // x: -N1*co + N2*co + 30 = 0 ; z: -N1*s - N2*s - P = 0
  const N2 = (-P / s - 30 / co) / 2, N1 = N2 + 30 / co;
  for (const v of c.beams[0].N) close(v, N1, 1e-9, 'N1');
  for (const v of c.beams[1].N) close(v, N2, 1e-9, 'N2');
  for (const v of c.beams[0].My) assert.equal(v, 0);
  // elongation check: delta = N L / EA
  const L = Math.sqrt(13);
  const u3 = [0, 1, 2].map((k) => c.disp[6 * mesh.modelNodeToMesh[3] + k]);
  close(u3[0] * co + u3[2] * s, N1 * L / (E * 1e-3), 1e-9, 'elongation bar 1');
});

T('Temperature: fixed–fixed bar ΔT → N = −EAαΔT; gradient → My = EIαΔT/h; SS beam bows up', () => {
  const L = 5, dT = 30, dTz = 20, h = 0.3, alpha = 1.2e-5;
  const mk = (sup2) => {
    const m = baseModel();
    m.sections.push(section(1, { A, Iy, Iz, It, h, b: 0.15 }));
    m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 });
    m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 2 } });
    m.supports.push({ id: 1, type: 'node', node: 1, dofs: sup2 === 'fixed' ? FIX : ['F', 'F', 'F', 'F', 0, 0] });
    m.supports.push({ id: 2, type: 'node', node: 2, dofs: sup2 === 'fixed' ? FIX : [0, 'F', 'F', 0, 0, 0] });
    m.loadCases.push({ id: 1 });
    m.loads.push({ id: 1, lc: 1, type: 'tempLine', line: 1, dT, dTz });
    return m;
  };
  {
    const m = mk('fixed'); const mesh = buildTestMesh(m);
    const c = runStatic(m, mesh).cases['LC:1'];
    for (const b of c.beams) {
      for (const v of b.N) close(v, -E * A * alpha * dT, 1e-9, 'N');
      for (const v of b.My) close(v, E * Iy * alpha * dTz / h, 1e-9, 'My');
      for (const v of b.uz) absClose(v, 0, 1e-14, 'uz');
    }
    close(c.reac[0], E * A * alpha * dT, 1e-9, 'Rx node 1 pushes');
  }
  {
    const m = mk('ss'); const mesh = buildTestMesh(m);
    const c = runStatic(m, mesh).cases['LC:1'];
    const mid = mesh.lineNodes[1][1].node;
    close(c.disp[6 * mid + 2], alpha * dTz * L * L / (8 * h), 1e-9, 'SS mid deflection');
    close(c.disp[6 * mesh.modelNodeToMesh[2]], alpha * dT * L, 1e-9, 'free elongation');
    for (const b of c.beams) for (const v of b.My) absClose(v, 0, 1e-8, 'no moment');
    // station deflection at quarter span inside element 1 (x = L/4, station 5 of first element)
    const x = L / 4;
    close(c.beams[0].uz[5], alpha * dTz / h * x * (L - x) / 2, 1e-9, 'uz(L/4)');
  }
});

T('MECHANISM detection and NO_SUPPORTS', () => {
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 2 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: [0, 'F', 'F', 'F', 0, 0] });
  m.supports.push({ id: 2, type: 'node', node: 2, dofs: [0, 'F', 'F', 0, 0, 0] });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'lineDist', line: 1, dir: 'Z', q1: -1, q2: -1 });
  const r = runStatic(m, buildTestMesh(m));
  assert.ok(r.error, 'error expected');
  assert.equal(r.error.code, 'MECHANISM');
  assert.equal(r.error.dofName, 'ux');
  assert.ok(typeof r.error.node === 'number' && r.error.dof === 0);
  // hinge chain: two beams with full moment releases at a common inner node, pinned ends
  const m2 = baseModel();
  m2.sections.push(section(1, { A, Iy, Iz, It }));
  m2.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 3, y: 0, z: 0 }, { id: 3, x: 6, y: 0, z: 0 });
  m2.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, releases: { i: [0, 0, 0, 0, 0, 0], j: [0, 0, 0, 0, 1, 0] } } });
  m2.lines.push({ id: 2, n1: 2, n2: 3, element: { type: 'beam', material: 1, section: 1, releases: { i: [0, 0, 0, 0, 1, 0], j: [0, 0, 0, 0, 0, 0] } } });
  m2.supports.push({ id: 1, type: 'node', node: 1, dofs: ['F', 'F', 'F', 'F', 0, 'F'] });
  m2.supports.push({ id: 2, type: 'node', node: 3, dofs: [0, 'F', 'F', 0, 0, 'F'] });
  m2.loadCases.push({ id: 1 });
  const r2 = runStatic(m2, buildTestMesh(m2));
  assert.equal(r2.error?.code, 'MECHANISM', 'three-hinge chain');
  const m3 = baseModel();
  m3.sections.push(section(1, { A, Iy, Iz, It }));
  m3.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 });
  m3.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1 } });
  m3.loadCases.push({ id: 1 });
  assert.equal(runStatic(m3, buildTestMesh(m3)).error?.code, 'NO_SUPPORTS');
});

T('combineCases / envelope / combinations by superposition', () => {
  const L = 6;
  const m = baseModel();
  m.sections.push(section(1, { A, Iy, Iz, It }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 2 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: FIX });
  m.supports.push({ id: 2, type: 'node', node: 2, dofs: PIN });
  m.loadCases.push({ id: 1, selfWeight: true }, { id: 2 }, { id: 3 });
  m.loads.push({ id: 1, lc: 2, type: 'lineDist', line: 1, dir: 'Z', q1: -5, q2: -5 });
  m.loads.push({ id: 2, lc: 3, type: 'linePoint', line: 1, dir: 'Z', F: 20, pos: 0.3 });
  m.loads.push({ id: 3, lc: 3, type: 'nodeDisp', node: 2, d: [0, 0, -0.01, 0, 0, 0] });
  // reference case with all loads factored, solved directly
  m.loadCases.push({ id: 4, selfWeight: true });
  m.loads.push({ id: 4, lc: 4, type: 'lineDist', line: 1, dir: 'Z', q1: -5 * 1.5, q2: -5 * 1.5 });
  m.loads.push({ id: 5, lc: 4, type: 'linePoint', line: 1, dir: 'Z', F: -0.5 * 20, pos: 0.3 });
  m.loads.push({ id: 6, lc: 4, type: 'nodeDisp', node: 2, d: [0, 0, 0.005, 0, 0, 0] });
  m.loadCases[0].selfWeight = true;
  m.combinations.push({ id: 1, name: 'C1', type: 'ULS', factors: { 1: 1.0, 2: 1.5, 3: -0.5 } });
  const mesh = buildTestMesh(m);
  const r = runStatic(m, mesh);
  assert.equal(r.error, null);
  const co = r.cases['CO:1'], ref = r.cases['LC:4'];
  for (let i = 0; i < co.disp.length; i++) absClose(co.disp[i], ref.disp[i], 1e-12, 'disp');
  for (let i = 0; i < co.reac.length; i++) absClose(co.reac[i], ref.reac[i], 1e-8, 'reac');
  for (let b = 0; b < co.beams.length; b++) for (const f of ['N', 'Vz', 'My', 'uz']) {
    for (let k = 0; k < 11; k++) absClose(co.beams[b][f][k], ref.beams[b][f][k], 1e-8, f);
  }
  const manual = combineCases([r.cases['LC:1'], r.cases['LC:2'], r.cases['LC:3']], [1, 1.5, -0.5]);
  for (let i = 0; i < co.disp.length; i++) absClose(manual.disp[i], co.disp[i], 1e-15);
  // prescribed settlement shows up as displacement
  close(r.cases['LC:3'].disp[6 * mesh.modelNodeToMesh[2] + 2], -0.01, 1e-12, 'settlement');
  const env = envelope([r.cases['LC:1'], r.cases['LC:2'], r.cases['LC:3']]);
  for (let b = 0; b < co.beams.length; b++) for (let k = 0; k < 11; k++) {
    const vals = [1, 2, 3].map((i) => r.cases['LC:' + i].beams[b].My[k]);
    assert.equal(env.max.beams[b].My[k], Math.max(...vals));
    assert.equal(env.min.beams[b].My[k], Math.min(...vals));
  }
  for (let i = 0; i < co.reac.length; i++) {
    const vals = [1, 2, 3].map((j) => r.cases['LC:' + j].reac[i]);
    assert.equal(env.max.reac[i], Math.max(...vals));
  }
});

runTests(tests);
