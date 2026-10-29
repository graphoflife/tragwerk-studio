// Line elements: subdivision rules, splitting at nodes, releases, t-parameters, copied fields,
// local axes (SPEC §2.1) and domain axes (SPEC §2.2).
import assert from 'node:assert/strict';
import { buildMesh } from '../../js/mesh/mesher.js';
import { lineAxes, domainAxes } from '../../js/mesh/geom.js';
import { model, checkDomain, P, vecApprox, quadArea } from './helpers.mjs';

const T = [true, false, false, false, true, true];
const F6 = [false, false, false, false, false, false];

// ---------------------------------------------------------------- divisions & splitting at nodes
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 6, 0, 0], [3, 2, 0, 0], [4, 0, 0, 4], [5, 6, 0, 4], [6, 3, 0, 4], [7, 0, 5, 0], [8, 6, 5, 0],
      [9, 0, 9, 0], [10, 0, 9, 3], [11, 6, 9, 0], [12, 6, 9, 3]],
    lines: [
      { id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 2, beta: 0, releases: { i: T, j: [false, false, false, false, false, true] }, design: { Ky: 1 } } },
      { id: 2, n1: 4, n2: 5, element: { type: 'truss', material: 1, section: 2, nl: 'tension' } },       // node 6 lies on it
      { id: 3, n1: 7, n2: 8, element: { type: 'truss', material: 1, section: 2 } },                      // no node on it
      { id: 4, n1: 9, n2: 10, element: { type: 'spring', k: [1, 2, 3, 4, 5, 6] } },
      { id: 5, n1: 11, n2: 12, element: { type: 'rigid' } },
      { id: 6, n1: 7, n2: 1, element: { type: 'rib', material: 1, section: 2, divisions: 5, releases: { i: F6, j: F6 } } },
      { id: 7, n1: 4, n2: 6, element: null },                                                            // geometry, overlaps line 2
      { id: 8, n1: 9, n2: 11, element: { type: 'truss', material: 1, section: 2, releases: { i: T, j: T } } },
    ],
    meshSize: 1, beamDivisions: 4,
  });
  const mesh = buildMesh(m);
  const of = (id) => mesh.beams.filter((b) => b.line === id);
  // beam with node 3 at 1/3: split there, default 4 divisions distributed proportionally (1/3 → 1, 2/3 → 3)
  const b1 = of(1);
  assert.equal(b1.length, 4);
  assert.ok(b1.some((b) => b.n2 === mesh.modelNodeToMesh[3]), 'split at node lying on the line');
  assert.deepEqual(b1[0].relI, T); assert.equal(b1[0].relJ, null);
  assert.deepEqual(b1[3].relJ, [false, false, false, false, false, true]); assert.equal(b1[3].relI, null);
  for (const b of b1.slice(1, 3)) { assert.equal(b.relI, null); assert.equal(b.relJ, null); }
  let L = 0;
  for (const b of b1) {
    assert.equal(b.type, 'beam'); assert.equal(b.material, 1); assert.equal(b.section, 2); assert.equal(b.beta, 0);
    assert.equal(b.nl, null); assert.equal(b.k, null);
    const l = Math.hypot(...[0, 1, 2].map((k) => P(mesh, b.n2)[k] - P(mesh, b.n1)[k]));
    assert.ok(Math.abs(l - 6 * (b.t1 - b.t0)) < 1e-12, 't0/t1 match the segment length');
    L += l;
  }
  assert.ok(Math.abs(L - 6) < 1e-12);
  // truss: 1 part unless nodes lie on it
  assert.equal(of(2).length, 2, 'truss split at node 6');
  assert.equal(of(2)[0].nl, 'tension');
  assert.equal(of(3).length, 1, 'truss without nodes: 1 element');
  assert.equal(of(4).length, 1); assert.deepEqual(of(4)[0].k, [1, 2, 3, 4, 5, 6]); assert.equal(of(4)[0].material, null);
  assert.equal(of(5).length, 1);
  assert.equal(of(6).length, 5, 'element.divisions overrides settings');
  assert.equal(of(6)[0].relI, null, 'all-false releases → null');
  assert.equal(of(6)[0].type, 'rib');
  assert.equal(of(8)[0].relI, null, 'releases only for beam/rib');
  // lineNodes for every line (incl. geometry-only)
  for (const ln of m.lines) assert.ok(Array.isArray(mesh.lineNodes[ln.id]), `lineNodes[${ln.id}]`);
  assert.deepEqual(mesh.lineNodes[7].map((e) => e.node), [mesh.modelNodeToMesh[4], mesh.modelNodeToMesh[6]]);
  assert.deepEqual(mesh.lineNodes[7].map((e) => e.t), [0, 1]);
  const ln1 = mesh.lineNodes[1];
  assert.equal(ln1.length, 5);
  assert.ok(Math.abs(ln1[1].t - 1 / 3) < 1e-12);
  // opts.beamDivisions overrides settings
  const mesh2 = buildMesh(m, { beamDivisions: 8 });
  assert.equal(mesh2.beams.filter((b) => b.line === 1).length, 8);
  assert.equal(mesh2.beams.filter((b) => b.line === 6).length, 5);
}

// ---------------------------------------------------------------- local axes of lines (SPEC §2.1)
{
  let a = lineAxes([0, 0, 0], [5, 0, 0]);
  vecApprox(a.ex, [1, 0, 0]); vecApprox(a.ey, [0, 1, 0]); vecApprox(a.ez, [0, 0, 1]);
  a = lineAxes([0, 0, 0], [0, 5, 0]);
  vecApprox(a.ex, [0, 1, 0]); vecApprox(a.ey, [-1, 0, 0]); vecApprox(a.ez, [0, 0, 1]);
  a = lineAxes([0, 0, 0], [0, 0, 3]); // vertical column: reference X
  vecApprox(a.ex, [0, 0, 1]); vecApprox(a.ey, [0, -1, 0]); vecApprox(a.ez, [1, 0, 0]);
  a = lineAxes([0, 0, 0], [0, 0, 3], 90); // beta = 90° about ex
  vecApprox(a.ey, [1, 0, 0], 1e-12); vecApprox(a.ez, [0, 1, 0], 1e-12);
  a = lineAxes([0, 0, 0], [5, 0, 0], 30);
  vecApprox(a.ey, [0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)], 1e-12);
  vecApprox(a.ez, [0, -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)], 1e-12);
  a = lineAxes([0, 0, 0], [3, 0, 4]); // inclined rafter in XZ plane
  vecApprox(a.ex, [0.6, 0, 0.8]); vecApprox(a.ey, [0, 1, 0]); vecApprox(a.ez, [-0.8, 0, 0.6]);
  assert.equal(lineAxes([1, 1, 1], [1, 1, 1]), null);

  // the mesh copies these axes to every segment
  const m = model({
    nodes: [[1, 2, 3, 0], [2, 2, 3, 4]],
    lines: [{ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, beta: 90 } }],
  });
  const mesh = buildMesh(m);
  assert.equal(mesh.beams.length, 4);
  for (const b of mesh.beams) {
    vecApprox(b.ex, [0, 0, 1]); vecApprox(b.ey, [1, 0, 0], 1e-12); vecApprox(b.ez, [0, 1, 0], 1e-12);
    assert.equal(b.beta, 90);
  }
}

// ---------------------------------------------------------------- local axes of domains (SPEC §2.2)
{
  // horizontal slab, defined clockwise → ez still +Z, elements CCW about +Z
  let ax = domainAxes([[0, 0, 0], [0, 4, 0], [5, 4, 0], [5, 0, 0]]);
  vecApprox(ax.ex, [1, 0, 0]); vecApprox(ax.ey, [0, 1, 0]); vecApprox(ax.ez, [0, 0, 1]);
  // wall in XZ plane: |n·Z| = 0 → n·Y > 0 → ez = +Y, ex = X, ey = ez × ex = -Z
  ax = domainAxes([[0, 0, 0], [5, 0, 0], [5, 0, 3], [0, 0, 3]]);
  vecApprox(ax.ez, [0, 1, 0]); vecApprox(ax.ex, [1, 0, 0]); vecApprox(ax.ey, [0, 0, -1]);
  // wall in YZ plane: ez = +X, ex = projection of Y, ey = Z
  ax = domainAxes([[2, 0, 0], [2, 0, 3], [2, 5, 3], [2, 5, 0]]);
  vecApprox(ax.ez, [1, 0, 0]); vecApprox(ax.ex, [0, 1, 0]); vecApprox(ax.ey, [0, 0, 1]);

  // inclined roof rising in +X with slope 3:4
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 4, 0, 3], [3, 4, 5, 3], [4, 0, 5, 0], [5, 10, 0, 0], [6, 10, 0, 5], [7, 14, 0, 5]],
    domains: [
      { id: 1, nodes: [1, 2, 3, 4], type: 'shell', material: 1, thickness: 0.2 },
      { id: 2, nodes: [4, 3, 2, 1].map((x) => x), type: 'shell', material: 1, thickness: 0.2 }, // same plane, reversed order
    ],
    meshSize: 1,
  });
  // domain 2 overlaps domain 1 geometrically; we only check axes/orientation here
  const mesh = buildMesh({ ...m, domains: [m.domains[0]] });
  const mesh2 = buildMesh({ ...m, domains: [m.domains[1]] });
  for (const ms of [mesh, mesh2]) {
    for (const sh of ms.shells) {
      vecApprox(sh.ez, [-0.6, 0, 0.8], 1e-12);
      vecApprox(sh.ex, [0.8, 0, 0.6], 1e-12);
      vecApprox(sh.ey, [0, 1, 0], 1e-12);
      assert.ok(quadArea(ms, sh) > 0, 'CCW about ez');
    }
    checkDomain(ms, ms.shells[0].domain, 25);
  }
}

// ---------------------------------------------------------------- vertical wall mesh orientation
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 6, 0, 0], [3, 6, 0, 3], [4, 0, 0, 3]],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'shell', material: 1, thickness: 0.25 }],
    meshSize: 0.5,
  });
  const mesh = buildMesh(m);
  checkDomain(mesh, 1, 18);
  vecApprox(mesh.shells[0].ez, [0, 1, 0]);
}

console.log('mesher_lines: ok');
