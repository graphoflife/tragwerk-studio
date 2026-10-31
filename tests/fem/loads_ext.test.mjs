// Loads on surfaces (line/point/variable), load panels and eccentric members – equilibrium checks.
import assert from 'node:assert/strict';
import { runStatic } from '../../js/fem/index.js';
import { buildMesh } from '../../js/mesh/mesher.js';
import { panelLayout, panelLineLoads } from '../../js/fem/panels.js';
import { createModel, addNode, addLine, addDomain, defaultLineElement } from '../../js/core/model.js';
import { EXAMPLES } from '../../js/examples.js';

const C30 = { id: 1, name: 'C30/37', type: 'concrete', E: 33e6, nu: 0.2, rho: 2.5, alpha: 1e-5, fck: 30000 };
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const tests = [];
const T = (n, f) => tests.push([n, f]);

// 4 × 4 m plate, line-supported on all edges
function plate(loads) {
  const m = createModel('p');
  m.materials = [C30]; m.loadCases = [{ id: 1, name: 'q', selfWeight: false }]; m.loadGroups = [];
  const c = [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, y]) => addNode(m, [x, y, 0]));
  const d = addDomain(m, c, { type: 'plate', material: 1, thickness: 0.2 });
  for (const l of m.lines) m.supports.push({ id: m.supports.length + 1, type: 'line', line: l.id, dofs: [0, 0, 'F', 0, 0, 0] });
  m.supports.push({ id: 99, type: 'node', node: c[0], dofs: ['F', 'F', 'F', 0, 0, 'F'] });
  loads.forEach((ld, i) => m.loads.push({ id: i + 1, lc: 1, domain: d, ...ld }));
  m.settings.meshSize = 0.5;
  return m;
}
function sums(m) {
  const mesh = buildMesh(m, {});
  const r = runStatic(m, mesh, {});
  assert.equal(r.error, null, JSON.stringify(r.error));
  const c = r.cases['LC:1'];
  let Rz = 0, Mx = 0, My = 0;
  for (let i = 0; i < mesh.nodes.length / 3; i++) { const z = c.reac[6 * i + 2]; Rz += z; Mx += z * mesh.nodes[3 * i]; My += z * mesh.nodes[3 * i + 1]; }
  return { Rz, xc: Mx / Rz, yc: My / Rz, r, mesh };
}

T('line load on a surface (not on a model line)', () => {
  const s = sums(plate([{ type: 'surfaceLine', a: [0.5, 2.3, 0], b: [3.5, 2.3, 0], dir: 'Z', q1: -10, q2: -10 }]));
  close(s.Rz, 30, 1e-6, 'ΣRz'); close(s.xc, 2, 1e-3, 'x of resultant'); close(s.yc, 2.3, 1e-3, 'y of resultant');
});

T('trapezoidal line load on a surface: resultant position', () => {
  // q 0 → 12 kN/m over 3 m: R = 18 kN at 2/3 of the length
  const s = sums(plate([{ type: 'surfaceLine', a: [0.5, 1.7, 0], b: [3.5, 1.7, 0], dir: 'Z', q1: 0, q2: -12 }]));
  close(s.Rz, 18, 1e-3, 'ΣRz'); close(s.xc, 2.5, 2e-3, 'x of resultant');
});

T('point load on a surface between nodes', () => {
  const s = sums(plate([{ type: 'surfacePoint', p: [1.3, 2.7, 0], dir: 'Z', F: -50 }]));
  close(s.Rz, 50, 1e-6, 'ΣRz'); close(s.xc, 1.3, 1e-6, 'x'); close(s.yc, 2.7, 1e-6, 'y');
});

T('linearly varying and hydrostatic surface loads', () => {
  // 0 at x = 0 → −10 kN/m² at x = 4: R = 80 kN at x = 8/3 (nodal lumping – mesh 0.5 m)
  const s = sums(plate([{ type: 'surface', dir: 'Z', q: 0, dist: 'linear', p1: [0, 0, 0], p2: [4, 0, 0], q2: -10 }]));
  close(s.Rz, 80, 2e-3, 'ΣRz linear'); close(s.xc, 8 / 3, 1e-2, 'x linear');
  // hydrostatic: level z0 = 2 m above the plate, 10 kN/m² per m → 20 kN/m² × 16 m² (sign = direction)
  const h = sums(plate([{ type: 'surface', dir: 'Z', q: -10, dist: 'hydro', z0: 2 }]));
  close(h.Rz, 320, 1e-6, 'ΣRz hydro');
});

// beam grid 6 × 4 m on 4 corner columns with a load panel on top
function grid(dist) {
  const m = createModel('g');
  m.materials = [{ ...C30 }]; m.loadCases = [{ id: 1, name: 'q', selfWeight: false }]; m.loadGroups = [];
  m.sections = [{ id: 1, name: 'R', shape: 'RECT', dims: { h: 0.5, b: 0.3 }, A: 0.15, Iy: 0.003125, Iz: 0.001125, It: 0.0029 }];
  const c = [[0, 0], [6, 0], [6, 4], [0, 4]].map(([x, y]) => addNode(m, [x, y, 0]));
  for (let i = 0; i < 4; i++) addLine(m, c[i], c[(i + 1) % 4], defaultLineElement('beam', 1, 1));
  const d = addDomain(m, c, { type: 'panel', material: null, thickness: 0, panel: { dist } });
  c.forEach((n, i) => m.supports.push({ id: i + 1, type: 'node', node: n, dofs: ['F', 'F', 'F', i === 0 ? 'F' : 0, 0, i === 0 ? 'F' : 0] }));
  m.loads.push({ id: 1, lc: 1, type: 'surface', domain: d, dir: 'Z', q: -5 });
  return { m, d };
}
const perLine = (m, d) => {
  const lay = panelLayout(m, m.domains.find((x) => x.id === d));
  const pcs = panelLineLoads(m, lay, () => -5);
  const out = new Map();
  for (const p of pcs) {
    const l = m.lines.find((x) => x.id === p.line), a = m.nodes.find((n) => n.id === l.n1), b = m.nodes.find((n) => n.id === l.n2);
    out.set(p.line, (out.get(p.line) || 0) + p.q * (p.b - p.a) * Math.hypot(b.x - a.x, b.y - a.y));
  }
  return [...out.values()].map((v) => Math.round(-v * 10) / 10).sort((x, y) => x - y);
};

T('load panel, two-way: 45° distribution (triangles 20 kN, trapezoids 40 kN) and equilibrium', () => {
  const { m, d } = grid('two');
  const v = perLine(m, d);
  assert.equal(v.length, 4);
  close(v[0], 20, 0.03, 'short beam'); close(v[1], 20, 0.03, 'short beam'); close(v[2], 40, 0.02, 'long beam'); close(v[3], 40, 0.02, 'long beam');
  const s = sums(m);
  close(s.Rz, 120, 1e-6, 'ΣRz');
});

T('load panel, one-way in x: everything to the two short beams', () => {
  const { m, d } = grid('x');
  const v = perLine(m, d);
  assert.equal(v.length, 2);
  close(v[0], 60, 1e-6, 'short beam'); close(v[1], 60, 1e-6, 'short beam');
  close(sums(m).Rz, 120, 1e-6, 'ΣRz');
});

T('eccentric ribs: rigid links in the mesh, stiffer T-beam action with shells, equilibrium', () => {
  const run = (ecc) => {
    const m = EXAMPLES.find((e) => e.id === 'tbeam').build();
    for (const d of m.domains) d.type = 'shell';
    for (const l of m.lines) if (l.element?.type === 'rib') l.element.ecc = ecc;
    const mesh = buildMesh(m, {});
    const r = runStatic(m, mesh, {});
    assert.equal(r.error, null, JSON.stringify(r.error));
    const c = r.cases['LC:3'];
    let Rz = 0;
    for (let i = 0; i < mesh.nodes.length / 3; i++) Rz += c.reac[6 * i + 2];
    // deflection of the slab node above the middle of the middle rib (6, 5, 0)
    let best = -1, bd = Infinity;
    for (let i = 0; i < mesh.nodes.length / 3; i++) { const dd = Math.hypot(mesh.nodes[3 * i] - 6, mesh.nodes[3 * i + 1] - 5, mesh.nodes[3 * i + 2]); if (dd < bd) { bd = dd; best = i; } }
    return { mesh, Rz, w: c.disp[6 * best + 2], links: mesh.beams.filter((b) => b.type === 'rigid').length, ecc: mesh.beams.find((b) => b.type === 'rib')?.ecc };
  };
  const a = run(undefined), b = run('auto');
  assert.equal(a.links, 0);
  assert.ok(b.links > 0, 'rigid links created');
  close(b.ecc, -(0.6 - 0.22) / 2, 1e-9, 'offset of the rib axis (local z, below the slab)');
  close(a.Rz, 3 * 120, 1e-6, 'ΣRz concentric (Nutzlast 3 kN/m² × 120 m²)');
  close(b.Rz, 3 * 120, 1e-6, 'ΣRz eccentric');
  assert.ok(Math.abs(b.w) < 0.8 * Math.abs(a.w), `eccentric T-beam is stiffer: ${b.w} vs ${a.w}`);
});

for (const [n, f] of tests) { f(); console.log('ok -', n); }
console.log(`loads_ext: ${tests.length} tests passed`);
