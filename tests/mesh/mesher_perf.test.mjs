// Performance: a 20 × 20 m slab with h = 0.25 m must mesh well under 1 s (mapped and free).
import assert from 'node:assert/strict';
import { buildMesh } from '../../js/mesh/mesher.js';
import { model, checkDomain } from './helpers.mjs';

function timed(m) {
  buildMesh(m); // warm-up (JIT)
  const t0 = performance.now();
  const mesh = buildMesh(m);
  return { mesh, ms: performance.now() - t0 };
}

{
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 20, 0, 0], [3, 20, 20, 0], [4, 0, 20, 0]],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 1, thickness: 0.2 }],
    meshSize: 0.25,
  });
  const { mesh, ms } = timed(m);
  assert.equal(mesh.shells.length, 6400);
  checkDomain(mesh, 1, 400);
  console.log(`20x20 m slab, h=0.25, mapped: ${mesh.stats.shells} quads, ${mesh.stats.nodes} nodes, ${ms.toFixed(1)} ms`);
  assert.ok(ms < 1000, `mapped mesh too slow: ${ms} ms`);
}

{
  // free mesh: opening, two columns and a downstand beam inside the slab
  const m = model({
    nodes: [[1, 0, 0, 0], [2, 20, 0, 0], [3, 20, 20, 0], [4, 0, 20, 0], [5, 8, 8, 0], [6, 12, 8, 0], [7, 12, 11, 0], [8, 8, 11, 0],
      [9, 5, 5, 0], [10, 5, 5, -3], [11, 15, 15, 0], [12, 15, 15, -3], [13, 2, 15, 0], [14, 10, 15, 0]],
    lines: [
      { id: 1, n1: 10, n2: 9, element: { type: 'beam', material: 1, section: 1 } },
      { id: 2, n1: 12, n2: 11, element: { type: 'beam', material: 1, section: 1 } },
      { id: 3, n1: 13, n2: 14, element: { type: 'rib', material: 1, section: 1 } },
    ],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], holes: [[5, 6, 7, 8]], type: 'plate', material: 1, thickness: 0.2 }],
    meshSize: 0.25,
  });
  const { mesh, ms } = timed(m);
  assert.deepEqual(mesh.warnings, []);
  checkDomain(mesh, 1, 400 - 12);
  console.log(`20x20 m slab, h=0.25, free (hole, columns, rib): ${mesh.stats.shells} quads, ${mesh.stats.nodes} nodes, ${ms.toFixed(1)} ms`);
  assert.ok(ms < 1000, `free mesh too slow: ${ms} ms`);
}

console.log('mesher_perf: ok');
