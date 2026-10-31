// Parts (Teile) and storeys (Geschosse): membership and visibility.
import assert from 'node:assert/strict';
import { detectStoreys, storeyIndex, listParts, partMembers, partsHidden } from '../../js/core/parts.js';
import { createModel, addNode, addLine, addDomain, defaultLineElement } from '../../js/core/model.js';

// two-storey frame: columns 0→3→6, slabs at 3 and 6
const m = createModel('t');
m.materials.push({ id: 1, name: 'C30/37', type: 'concrete' }, { id: 2, name: 'S235', type: 'steel' });
m.sections.push({ id: 1, name: 'RECT', shape: 'RECT', dims: { h: 0.3, b: 0.3 } });
const col = (x, z0, z1) => addLine(m, addNode(m, [x, 0, z0]), addNode(m, [x, 0, z1]), defaultLineElement('beam', 1, 1));
const c1 = col(0, 0, 3), c2 = col(0, 3, 6);
const slab = (z) => addDomain(m, [addNode(m, [0, 0, z]), addNode(m, [4, 0, z]), addNode(m, [4, 4, z]), addNode(m, [0, 4, z])], { type: 'plate', material: 1, thickness: 0.2 });
const s1 = slab(3), s2 = slab(6);
const brace = addLine(m, addNode(m, [4, 0, 0]), addNode(m, [4, 4, 3]), defaultLineElement('truss', 2, 1));

const levels = detectStoreys(m);
assert.deepEqual(levels, [0, 3, 6]);
assert.equal(storeyIndex(levels, 3), 1);
assert.equal(storeyIndex(levels, 3.005), 1);
assert.equal(storeyIndex(levels, 4), 2);
assert.equal(storeyIndex(levels, -1), 0);
assert.equal(storeyIndex(levels, 7), -1);

m.storeys = levels.map((z, i) => ({ id: i + 1, z }));
// storey 2 (z = 3): lower column, brace (top at 3) and the slab at 3
const st2 = partMembers(m, 'st:2');
assert.ok(st2.lines.has(c1) && st2.lines.has(brace) && !st2.lines.has(c2));
assert.ok(st2.domains.has(s1) && !st2.domains.has(s2));
// storey 3 (z = 6): upper column and the slab at 6
const st3 = partMembers(m, 'st:3');
assert.ok(st3.lines.has(c2) && st3.domains.has(s2) && !st3.domains.has(s1));

// logical parts
const keys = listParts(m).map((p) => p.key);
for (const k of ['st:1', 'st:2', 'st:3', 'mat:1', 'mat:2', 'sec:1', 'type:beam', 'type:truss', 'type:plate', 'type:geom']) assert.ok(keys.includes(k), k);
assert.ok(partMembers(m, 'mat:2').lines.has(brace) && partMembers(m, 'mat:2').lines.size === 1);
assert.equal(partMembers(m, 'type:plate').domains.size, 2);

// user part and visibility (union of active parts)
m.parts.push({ id: 1, name: 'Stütze unten', nodes: [], lines: [c1], domains: [] });
assert.equal(partsHidden(m, new Set()), null);
const h = partsHidden(m, new Set(['u:1']));
assert.ok(!h.lines.has(c1) && h.lines.has(c2) && h.domains.has(s1) && h.domains.has(s2));
const lc1 = m.lines.find((l) => l.id === c1);
assert.ok(!h.nodes.has(lc1.n1) && !h.nodes.has(lc1.n2));
const h2 = partsHidden(m, new Set(['u:1', 'st:3']));
assert.ok(!h2.lines.has(c1) && !h2.lines.has(c2) && !h2.domains.has(s2) && h2.domains.has(s1));
console.log('parts: storeys, logical parts and visibility ok');
