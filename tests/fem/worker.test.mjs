// Worker message protocol (SPEC §4), exercised in Node with a minimal `self` shim.
import assert from 'node:assert/strict';
import { baseModel, section, buildTestMesh, close, FIX } from './helpers.mjs';

const posted = [];
let handler = null;
globalThis.self = {
  postMessage: (m, transfer) => posted.push({ m, transfer }),
  addEventListener: (type, fn) => { if (type === 'message') handler = fn; },
};
await import('../../js/fem/worker.js');
assert.ok(handler, 'worker registered a message listener');

const m = baseModel();
m.sections.push(section(1, { A: 5.38e-3, Iy: 8.356e-5, Iz: 6.04e-6, It: 2e-7 }));
m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 });
m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 4 } });
m.supports.push({ id: 1, type: 'node', node: 1, dofs: FIX });
m.loadCases.push({ id: 1 });
m.loads.push({ id: 1, lc: 1, type: 'node', node: 2, F: [0, 0, -10, 0, 0, 0] });
const mesh = buildTestMesh(m);

handler({ data: { id: 7, cmd: 'static', model: m, mesh, options: {} } });
const prog = posted.filter((p) => p.m.type === 'progress');
const res = posted.find((p) => p.m.type === 'result');
assert.ok(prog.length >= 2 && prog.every((p) => p.m.id === 7 && typeof p.m.pct === 'number'));
assert.ok(res && res.m.id === 7);
close(res.m.data.cases['LC:1'].reac[2], 10, 1e-9, 'reaction via worker');
assert.ok(res.transfer.length > 0 && res.transfer.every((b) => b instanceof ArrayBuffer), 'typed arrays transferred');

posted.length = 0;
handler({ data: { id: 8, cmd: 'spectrum', model: m, mesh, options: { dir: 'Y', ag: 1, soil: 'A', q: 1.5, modalOptions: { nModes: 4 } } } });
const r2 = posted.find((p) => p.m.type === 'result');
assert.ok(r2 && r2.m.data.reac && r2.m.data.spectrum, 'spectrum via worker (modal run internally)');

posted.length = 0;
handler({ data: { id: 9, cmd: 'nonsense' } });
assert.equal(posted[0].m.type, 'error');
assert.equal(posted[0].m.id, 9);
console.log('  ok   worker protocol (static, spectrum, error)');
