// Domain meshing: mapped rectangles/trapezoids, free L-shape / holes / triangles, count propagation.
import assert from 'node:assert/strict';
import { buildMesh } from '../../js/mesh/mesher.js';
import { model, checkDomain, nodesOnSegment, P, vecApprox } from './helpers.mjs';

// ---------------------------------------------------------------- rectangle → structured mesh
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 10, 0, 0], [3, 10, 6, 0], [4, 0, 6, 0]],
    lines: [{ id: 7, n1: 1, n2: 2, element: null }],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 3, thickness: 0.22 }],
    meshSize: 1,
  });
  const mesh = buildMesh(m);
  assert.deepEqual(mesh.warnings, []);
  assert.equal(mesh.stats.mapped, 1);
  assert.equal(mesh.shells.length, 60, '10 x 6 quads');
  assert.equal(mesh.stats.nodes, 77, '11 x 7 nodes');
  assert.equal(mesh.nodes.length, 3 * 77);
  assert.ok(mesh.nodes instanceof Float64Array && mesh.nodeModelId instanceof Int32Array);
  const r = checkDomain(mesh, 1, 60);
  assert.ok(Math.abs(r.minArea - 1) < 1e-9, 'all quads 1 m²');
  assert.equal(r.boundaryEdges, 32);
  for (const sh of mesh.shells) {
    assert.equal(sh.domain, 1); assert.equal(sh.type, 'plate'); assert.equal(sh.material, 3); assert.equal(sh.thickness, 0.22);
    vecApprox(sh.ex, [1, 0, 0]); vecApprox(sh.ey, [0, 1, 0]); vecApprox(sh.ez, [0, 0, 1]);
  }
  assert.equal(mesh.domainNodes[1].length, 77);
  assert.deepEqual(mesh.domainElems[1], Array.from({ length: 60 }, (_, i) => i));
  for (const id of [1, 2, 3, 4]) assert.equal(mesh.nodeModelId[mesh.modelNodeToMesh[id]], id);
  // geometry-only line on the domain edge: ordered chain with t 0..1
  const ln = mesh.lineNodes[7];
  assert.equal(ln.length, 11);
  ln.forEach((e, k) => {
    assert.ok(Math.abs(e.t - k / 10) < 1e-12);
    vecApprox(P(mesh, e.node), [k, 0, 0], 1e-12);
  });
  assert.equal(ln[0].node, mesh.modelNodeToMesh[1]);
  assert.equal(ln[10].node, mesh.modelNodeToMesh[2]);
}

// ---------------------------------------------------------------- opts.meshSize / domain.meshSize precedence
{
  const base = { nodes: [[1, 0, 0, 0], [2, 4, 0, 0], [3, 4, 4, 0], [4, 0, 4, 0]], meshSize: 1 };
  let mesh = buildMesh(model({ ...base, domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 1, thickness: 0.2 }] }), { meshSize: 0.5 });
  assert.equal(mesh.shells.length, 64, 'opts.meshSize overrides settings');
  mesh = buildMesh(model({ ...base, domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 1, thickness: 0.2, meshSize: 2 }] }), { meshSize: 0.5 });
  assert.equal(mesh.shells.length, 4, 'domain.meshSize overrides opts');
}

// ---------------------------------------------------------------- trapezoid → mapped with equal opposite counts
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 8, 0, 0], [3, 6, 4, 0], [4, 1, 4, 0]],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 1, thickness: 0.2 }],
    meshSize: 1,
  });
  const mesh = buildMesh(m);
  assert.equal(mesh.stats.mapped, 1);
  checkDomain(mesh, 1, (8 + 5) / 2 * 4);
  const bottom = nodesOnSegment(mesh, mesh.domainNodes[1], [0, 0, 0], [8, 0, 0]);
  const top = nodesOnSegment(mesh, mesh.domainNodes[1], [1, 4, 0], [6, 4, 0]);
  assert.equal(bottom.length, top.length, 'opposite sides have equal division counts');
  assert.equal((bottom.length - 1) % 2, 0, 'even division count');
}

// ---------------------------------------------------------------- two coplanar mapped slabs, different h, shared edge
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 5, 0, 0], [3, 5, 4, 0], [4, 0, 4, 0], [5, 9, 0, 0], [6, 9, 4, 0]],
    domains: [
      { id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 1, thickness: 0.2, meshSize: 1 },
      { id: 2, nodes: [2, 5, 6, 3], type: 'plate', material: 1, thickness: 0.2, meshSize: 0.5 },
    ],
  });
  const mesh = buildMesh(m);
  assert.equal(mesh.stats.mapped, 2);
  checkDomain(mesh, 1, 20); checkDomain(mesh, 2, 16);
  const s1 = nodesOnSegment(mesh, mesh.domainNodes[1], [5, 0, 0], [5, 4, 0]);
  const s2 = nodesOnSegment(mesh, mesh.domainNodes[2], [5, 0, 0], [5, 4, 0]);
  assert.deepEqual(s1, s2, 'shared edge nodes identical');
  assert.equal(s1.length, 9, 'shared edge uses the finer size (8 divisions)');
  const left = nodesOnSegment(mesh, mesh.domainNodes[1], [0, 0, 0], [0, 4, 0]);
  assert.equal(left.length, s1.length, 'count propagated to the opposite edge of the coarser slab');
  // the union of both slabs is a conforming mesh: no edge used more than twice
  const edges = new Map();
  for (const sh of mesh.shells) for (let k = 0; k < 4; k++) {
    const a = sh.nodes[k], b = sh.nodes[(k + 1) % 4], key = a < b ? `${a}_${b}` : `${b}_${a}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  for (const v of edges.values()) assert.ok(v <= 2);
}

// ---------------------------------------------------------------- L-shaped domain → free mesh
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 10, 0, 0], [3, 10, 4, 0], [4, 4, 4, 0], [5, 4, 10, 0], [6, 0, 10, 0]],
    domains: [{ id: 1, nodes: [1, 2, 3, 4, 5, 6], type: 'plate', material: 1, thickness: 0.2 }],
    meshSize: 0.5,
  });
  const mesh = buildMesh(m);
  assert.equal(mesh.stats.free, 1);
  assert.deepEqual(mesh.warnings, []);
  const r = checkDomain(mesh, 1, 64);
  // boundary of the quad mesh = full even discretisation of the outline (perimeter 40 m, h = 0.5)
  assert.equal(r.boundaryEdges, 80);
  for (const sh of mesh.shells) {
    const c = [0, 1, 2].map((k) => sh.nodes.reduce((s, i) => s + P(mesh, i)[k], 0) / 4);
    assert.ok(!(c[0] > 4 + 1e-9 && c[1] > 4 + 1e-9), 'no element in the notch');
  }
}

// ---------------------------------------------------------------- domain with two holes
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 12, 0, 0], [3, 12, 8, 0], [4, 0, 8, 0],
      [5, 2, 2, 0], [6, 5, 2, 0], [7, 5, 5, 0], [8, 2, 5, 0],
      [9, 7, 3, 0], [10, 10, 3, 0], [11, 8.5, 6, 0]],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], holes: [[5, 6, 7, 8], [9, 10, 11]], type: 'shell', material: 1, thickness: 0.2 }],
    meshSize: 0.5,
  });
  const mesh = buildMesh(m);
  assert.equal(mesh.stats.free, 1);
  const r = checkDomain(mesh, 1, 96 - 9 - 4.5);
  // every boundary loop with k nodes contributes k free element edges → boundary matches the edge discretisation
  const loops = [[[0, 0], [12, 0], [12, 8], [0, 8]], [[2, 2], [5, 2], [5, 5], [2, 5]], [[7, 3], [10, 3], [8.5, 6]]];
  const onB = new Set();
  for (const L of loops) for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    for (const n of nodesOnSegment(mesh, mesh.domainNodes[1], [a[0], a[1], 0], [b[0], b[1], 0])) onB.add(n);
  }
  assert.equal(r.boundaryEdges, onB.size);
  assert.ok(onB.size >= 80 + 24 + 20);
  for (const sh of mesh.shells) {
    const c = [0, 1].map((k) => sh.nodes.reduce((s, i) => s + P(mesh, i)[k], 0) / 4);
    assert.ok(!(c[0] > 2 && c[0] < 5 && c[1] > 2 && c[1] < 5), 'no element inside hole 1');
  }
  for (const id of [5, 6, 7, 8, 9, 10, 11]) assert.ok(mesh.domainNodes[1].includes(mesh.modelNodeToMesh[id]), 'hole corners are mesh nodes');
}

// ---------------------------------------------------------------- triangle and pentagon domains
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 6, 0, 0], [3, 2, 5, 0], [4, 10, 0, 0], [5, 14, 2, 0], [6, 13, 6, 0], [7, 9, 7, 0], [8, 8, 3, 0]],
    domains: [
      { id: 1, nodes: [1, 2, 3], type: 'plate', material: 1, thickness: 0.2 },
      { id: 2, nodes: [4, 5, 6, 7, 8], type: 'plate', material: 1, thickness: 0.2 },
    ],
    meshSize: 0.6,
  });
  const mesh = buildMesh(m);
  checkDomain(mesh, 1, 15);
  const pent = [[10, 0], [14, 2], [13, 6], [9, 7], [8, 3]];
  let A = 0;
  for (let i = 0; i < 5; i++) { const p = pent[i], q = pent[(i + 1) % 5]; A += p[0] * q[1] - q[0] * p[1]; }
  checkDomain(mesh, 2, A / 2);
}

// ---------------------------------------------------------------- invalid domains are reported, not fatal
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 1, 0, 0]],
    domains: [{ id: 1, nodes: [1, 2], type: 'plate', material: 1, thickness: 0.2 }, { id: 2, nodes: [1, 2, 99], type: 'plate' }],
  });
  const mesh = buildMesh(m);
  assert.equal(mesh.shells.length, 0);
  assert.equal(mesh.warnings.length, 2);
  const empty = buildMesh({ nodes: [], lines: [], domains: [] });
  assert.equal(empty.stats.nodes, 0);
  assert.equal(empty.nodes.length, 0);
}

console.log('mesher_domains: ok');
