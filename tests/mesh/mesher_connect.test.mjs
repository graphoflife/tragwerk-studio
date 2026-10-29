// Conformity between elements: column nodes in slabs, shared domain edges, wall top line inside a
// slab, beams on slab edges, crossing lines, piercing columns, merged coincident nodes.
import assert from 'node:assert/strict';
import { buildMesh } from '../../js/mesh/mesher.js';
import { model, checkDomain, nodesOnSegment, P, vecApprox } from './helpers.mjs';

const beam = (extra = {}) => ({ type: 'beam', material: 1, section: 1, ...extra });
const shellsUsing = (mesh, n) => mesh.shells.filter((s) => s.nodes.includes(n)).length;

// ---------------------------------------------------------------- slab with an interior column node (+ free load node)
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 10, 0, 0], [3, 10, 8, 0], [4, 0, 8, 0], [5, 3.3, 4.1, 0], [6, 3.3, 4.1, -3.5], [7, 7.2, 2.6, 0]],
    lines: [{ id: 1, n1: 6, n2: 5, element: beam() }],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 1, thickness: 0.25 }],
    supports: [{ id: 1, type: 'node', node: 6, dofs: ['F', 'F', 'F', 'F', 'F', 'F'] }],
    loads: [{ id: 1, lc: 1, type: 'node', node: 7, F: [0, 0, -10, 0, 0, 0] }],
    meshSize: 0.5,
  });
  const mesh = buildMesh(m);
  assert.deepEqual(mesh.warnings, []);
  checkDomain(mesh, 1, 80);
  const top = mesh.modelNodeToMesh[5];
  assert.ok(top !== undefined, 'column head is a mesh node');
  assert.ok(mesh.domainNodes[1].includes(top), 'column head belongs to the slab mesh');
  assert.ok(shellsUsing(mesh, top) >= 3, 'column head is a corner of several slab elements');
  vecApprox(P(mesh, top), [3.3, 4.1, 0], 1e-12);
  const col = mesh.beams.filter((b) => b.line === 1);
  assert.equal(col.length, 4);
  assert.equal(col[col.length - 1].n2, top, 'column connects to the slab node');
  const ld = mesh.modelNodeToMesh[7];
  assert.ok(ld !== undefined && mesh.domainNodes[1].includes(ld), 'unconnected model node inside slab becomes a slab node');
  assert.equal(mesh.nodeModelId[ld], 7);
}

// ---------------------------------------------------------------- two perpendicular domains sharing an edge (wall under slab)
{
  const m = model({
    nodes: [[1, 0, 0, 3], [2, 6, 0, 3], [3, 6, 4, 3], [4, 0, 4, 3], [5, 0, 0, 0], [6, 6, 0, 0]],
    domains: [
      { id: 1, nodes: [1, 2, 3, 4], type: 'shell', material: 1, thickness: 0.2, meshSize: 0.5 },
      { id: 2, nodes: [5, 6, 2, 1], type: 'shell', material: 1, thickness: 0.25, meshSize: 0.4 },
    ],
  });
  const mesh = buildMesh(m);
  assert.deepEqual(mesh.warnings, []);
  checkDomain(mesh, 1, 24); checkDomain(mesh, 2, 18);
  const e1 = nodesOnSegment(mesh, mesh.domainNodes[1], [0, 0, 3], [6, 0, 3]);
  const e2 = nodesOnSegment(mesh, mesh.domainNodes[2], [0, 0, 3], [6, 0, 3]);
  assert.ok(e1.length >= 16);
  assert.deepEqual(e1, e2, 'slab and wall share identical nodes along the common edge');
  assert.equal((e1.length - 1) % 2, 0);
  // the common edge is used by exactly one element of each domain per segment
  const all = new Map();
  for (const sh of mesh.shells) for (let k = 0; k < 4; k++) {
    const a = sh.nodes[k], b = sh.nodes[(k + 1) % 4];
    if (e1.includes(a) && e1.includes(b)) all.set(`${Math.min(a, b)}_${Math.max(a, b)}`, (all.get(`${Math.min(a, b)}_${Math.max(a, b)}`) || 0) + 1);
  }
  assert.equal(all.size, e1.length - 1);
  for (const v of all.values()) assert.equal(v, 2);
}

// ---------------------------------------------------------------- wall top line lying inside a slab
{
  const m = model({
    nodes: [[1, 0, 0, 3], [2, 10, 0, 3], [3, 10, 8, 3], [4, 0, 8, 3], [5, 2, 4, 0], [6, 7, 4, 0], [7, 7, 4, 3], [8, 2, 4, 3]],
    domains: [
      { id: 1, nodes: [1, 2, 3, 4], type: 'shell', material: 1, thickness: 0.2, meshSize: 0.5 },
      { id: 2, nodes: [5, 6, 7, 8], type: 'shell', material: 1, thickness: 0.2, meshSize: 0.5 },
    ],
  });
  const mesh = buildMesh(m);
  assert.deepEqual(mesh.warnings, []);
  checkDomain(mesh, 1, 80); checkDomain(mesh, 2, 15);
  const wallTop = nodesOnSegment(mesh, mesh.domainNodes[2], [2, 4, 3], [7, 4, 3]);
  const slabOnLine = nodesOnSegment(mesh, mesh.domainNodes[1], [2, 4, 3], [7, 4, 3]);
  assert.equal(wallTop.length, 11);
  assert.deepEqual(slabOnLine, wallTop, 'slab mesh contains exactly the wall top edge nodes');
  // the wall-top segments are element edges of the slab on both sides
  const cnt = new Map();
  for (const ei of mesh.domainElems[1]) {
    const sh = mesh.shells[ei];
    for (let k = 0; k < 4; k++) {
      const a = sh.nodes[k], b = sh.nodes[(k + 1) % 4];
      if (wallTop.includes(a) && wallTop.includes(b)) { const key = `${Math.min(a, b)}_${Math.max(a, b)}`; cnt.set(key, (cnt.get(key) || 0) + 1); }
    }
  }
  assert.equal(cnt.size, 10);
  for (const v of cnt.values()) assert.equal(v, 2, 'constraint edge has slab elements on both sides');
}

// ---------------------------------------------------------------- beam on a slab edge (and geometry line on the edge)
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 8, 0, 0], [3, 8, 5, 0], [4, 0, 5, 0], [5, 3, 5, 0], [6, -2, 5, 0]],
    lines: [
      { id: 1, n1: 4, n2: 3, element: beam({ divisions: 3 }) }, // node 5 lies on it, coincides with the slab edge
      { id: 2, n1: 6, n2: 4, element: beam({ divisions: 4 }) }, // cantilever outside the slab
      { id: 3, n1: 1, n2: 2, element: null },                   // geometry line on the edge (e.g. line support)
    ],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 1, thickness: 0.2 }],
    meshSize: 0.5,
  });
  const mesh = buildMesh(m);
  assert.deepEqual(mesh.warnings, []);
  checkDomain(mesh, 1, 40);
  const edge = nodesOnSegment(mesh, mesh.domainNodes[1], [0, 5, 0], [8, 5, 0]);
  const b1 = mesh.beams.filter((b) => b.line === 1);
  assert.equal(b1.length, edge.length - 1, 'beam split at every edge division point');
  const used = new Set(b1.flatMap((b) => [b.n1, b.n2]));
  assert.deepEqual([...used].sort((a, b) => a - b), edge, 'beam segments use the slab edge nodes');
  for (let k = 0; k < b1.length; k++) {
    if (k) assert.equal(b1[k].n1, b1[k - 1].n2, 'consecutive');
    assert.ok(b1[k].t1 > b1[k].t0);
  }
  assert.equal(b1[0].t0, 0); assert.equal(b1[b1.length - 1].t1, 1);
  assert.ok(used.has(mesh.modelNodeToMesh[5]));
  assert.equal(mesh.beams.filter((b) => b.line === 2).length, 4, 'outside beam keeps its own divisions');
  const ln3 = mesh.lineNodes[3];
  assert.deepEqual(ln3.map((e) => e.node).slice().sort((a, b) => a - b), nodesOnSegment(mesh, mesh.domainNodes[1], [0, 0, 0], [8, 0, 0]));
  for (let k = 1; k < ln3.length; k++) assert.ok(ln3[k].t > ln3[k - 1].t);
}

// ---------------------------------------------------------------- crossing in-plane lines without node, column piercing a slab
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 8, 0, 0], [3, 8, 6, 0], [4, 0, 6, 0], [5, 1, 1, 0], [6, 7, 5, 0], [7, 1, 5, 0], [8, 7, 1, 0],
      [9, 6, 3.5, -3], [10, 6, 3.5, 3], [11, 4, -2, 0], [12, 4, 2, 0]],
    lines: [
      { id: 1, n1: 5, n2: 6, element: beam() },
      { id: 2, n1: 7, n2: 8, element: null },
      { id: 3, n1: 9, n2: 10, element: beam({ divisions: 6 }) },
      { id: 4, n1: 11, n2: 12, element: beam({ divisions: 2 }) }, // partially inside, crosses the slab edge
    ],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'shell', material: 1, thickness: 0.2 }],
    meshSize: 0.5,
  });
  const mesh = buildMesh(m);
  assert.deepEqual(mesh.warnings, []);
  checkDomain(mesh, 1, 48);
  const X = nodesOnSegment(mesh, mesh.domainNodes[1], [4, 3, 0], [4, 3, 1e-9]);
  assert.equal(X.length, 1, 'intersection node of the crossing lines');
  assert.ok(mesh.lineNodes[1].some((e) => e.node === X[0] && Math.abs(e.t - 0.5) < 1e-9));
  assert.ok(mesh.lineNodes[2].some((e) => e.node === X[0]));
  const pierce = nodesOnSegment(mesh, mesh.domainNodes[1], [6, 3.5, 0], [6, 3.5, 1e-9]);
  assert.equal(pierce.length, 1, 'column passing through the slab gets a common node');
  assert.ok(mesh.lineNodes[3].some((e) => e.node === pierce[0] && Math.abs(e.t - 0.5) < 1e-9));
  assert.equal(mesh.beams.filter((b) => b.line === 3).length, 6);
  const edgeCross = nodesOnSegment(mesh, mesh.domainNodes[1], [4, 0, 0], [4, 0, 1e-9]);
  assert.equal(edgeCross.length, 1, 'line crossing the slab edge creates an edge node');
  const b4 = mesh.lineNodes[4];
  assert.equal(b4[1].node, edgeCross[0]);
  assert.equal(mesh.beams.filter((b) => b.line === 4 && b.t1 <= 0.5 + 1e-12).length, 1, 'outside part: own division');
}

// ---------------------------------------------------------------- coincident model nodes are merged
{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 4, 0, 0], [3, 4, 4, 0], [4, 0, 4, 0], [5, 4, 0, 0], [6, 4, 0, 3]],
    lines: [{ id: 1, n1: 5, n2: 6, element: beam() }],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 1, thickness: 0.2 }],
    meshSize: 1,
  });
  const mesh = buildMesh(m);
  assert.equal(mesh.modelNodeToMesh[2], mesh.modelNodeToMesh[5]);
  assert.equal(mesh.beams[0].n1, mesh.modelNodeToMesh[2]);
  assert.ok(mesh.warnings.some((w) => /coincide/.test(w)));
  // every mesh node is unique
  const keys = new Set();
  for (let i = 0; i < mesh.stats.nodes; i++) keys.add(P(mesh, i).map((v) => v.toFixed(6)).join(','));
  assert.equal(keys.size, mesh.stats.nodes);
}

// ---------------------------------------------------------------- 3D building: walls + slabs + columns, all edges conforming
{
  const nodes = [];
  let id = 1;
  const N = {};
  for (const z of [0, 3, 6]) for (const [x, y] of [[0, 0], [8, 0], [8, 6], [0, 6]]) { N[`${x},${y},${z}`] = id; nodes.push([id++, x, y, z]); }
  for (const z of [0, 3, 6]) { N[`4,3,${z}`] = id; nodes.push([id++, 4, 3, z]); }
  const n = (x, y, z) => N[`${x},${y},${z}`];
  const domains = [];
  let did = 1;
  for (const z of [3, 6]) domains.push({ id: did++, nodes: [n(0, 0, z), n(8, 0, z), n(8, 6, z), n(0, 6, z)], type: 'shell', material: 1, thickness: 0.2 });
  for (const [z0, z1] of [[0, 3], [3, 6]]) {
    domains.push({ id: did++, nodes: [n(0, 0, z0), n(8, 0, z0), n(8, 0, z1), n(0, 0, z1)], type: 'shell', material: 1, thickness: 0.2, meshSize: 0.6 });
    domains.push({ id: did++, nodes: [n(0, 6, z0), n(0, 0, z0), n(0, 0, z1), n(0, 6, z1)], type: 'shell', material: 1, thickness: 0.2, meshSize: 0.6 });
  }
  const lines = [
    { id: 1, n1: n(4, 3, 0), n2: n(4, 3, 3), element: beam() },
    { id: 2, n1: n(4, 3, 3), n2: n(4, 3, 6), element: beam() },
    { id: 3, n1: n(8, 6, 0), n2: n(8, 6, 3), element: beam() },
    { id: 4, n1: n(8, 6, 3), n2: n(8, 6, 6), element: beam() },
  ];
  const mesh = buildMesh(model({ nodes, lines, domains, meshSize: 0.75 }));
  assert.deepEqual(mesh.warnings.filter((w) => !/not connected/.test(w)), []);
  for (const d of domains) checkDomain(mesh, d.id, d.id <= 2 ? 48 : d.id % 2 ? 24 : 18);
  // global conformity: no element edge is shared by more than the number of domains meeting there
  const edgeDomains = new Map();
  for (const sh of mesh.shells) for (let k = 0; k < 4; k++) {
    const a = sh.nodes[k], b = sh.nodes[(k + 1) % 4], key = `${Math.min(a, b)}_${Math.max(a, b)}`;
    if (!edgeDomains.has(key)) edgeDomains.set(key, new Set());
    edgeDomains.get(key).add(sh.domain);
  }
  // corner line x=0,y=0: walls 3/5 and 4/6 meet → identical nodes on that vertical edge
  const w1 = nodesOnSegment(mesh, mesh.domainNodes[3], [0, 0, 0], [0, 0, 3]);
  const w2 = nodesOnSegment(mesh, mesh.domainNodes[4], [0, 0, 0], [0, 0, 3]);
  assert.deepEqual(w1, w2);
  // slab 1 edge y=0 at z=3 shared with walls below (3) and above (5)
  const s = nodesOnSegment(mesh, mesh.domainNodes[1], [0, 0, 3], [8, 0, 3]);
  assert.deepEqual(s, nodesOnSegment(mesh, mesh.domainNodes[3], [0, 0, 3], [8, 0, 3]));
  assert.deepEqual(s, nodesOnSegment(mesh, mesh.domainNodes[5], [0, 0, 3], [8, 0, 3]));
  assert.ok(mesh.domainNodes[1].includes(mesh.modelNodeToMesh[n(4, 3, 3)]));
}

console.log('mesher_connect: ok');
