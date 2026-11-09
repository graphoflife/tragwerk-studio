// Geometric transformations of the selection (AxisVM: Verschieben / Kopieren): move, detach, copies with
// connecting lines at all or only the double-selected nodes, copying elements and loads or not.
import assert from 'node:assert/strict';
import { createModel, addNode, addLine, transformSelection, defaultLineElement, V } from '../../js/core/model.js';

const sel = (o = {}) => ({ nodes: new Set(o.nodes || []), lines: new Set(o.lines || []), domains: new Set(o.domains || []) });
const at = (m, id) => { const n = m.nodes.find((x) => x.id === id); return [n.x, n.y, n.z]; };
const up = (d) => (p, k) => V.add(p, V.mul(d, k));

// chain a–b–c; moving line b–c keeps it attached at b (the other line stretches) …
let m = createModel('t');
let a = addNode(m, [0, 0, 0]), b = addNode(m, [4, 0, 0]), c = addNode(m, [8, 0, 0]);
let l1 = addLine(m, a, b), l2 = addLine(m, b, c);
transformSelection(m, sel({ lines: [l2] }), up([0, 2, 0]));
assert.deepEqual(at(m, b), [4, 2, 0], 'move: shared node moves');
assert.equal(m.nodes.length, 3);

// … detaching leaves the unselected line where it was
m = createModel('t');
a = addNode(m, [0, 0, 0]); b = addNode(m, [4, 0, 0]); c = addNode(m, [8, 0, 0]);
l1 = addLine(m, a, b); l2 = addLine(m, b, c);
transformSelection(m, sel({ lines: [l2] }), up([0, 2, 0]), { detach: true });
const L1 = m.lines.find((l) => l.id === l1), L2 = m.lines.find((l) => l.id === l2);
assert.deepEqual([at(m, L1.n1), at(m, L1.n2)], [[0, 0, 0], [4, 0, 0]], 'detach: other line stays');
assert.deepEqual([at(m, L2.n1), at(m, L2.n2)], [[4, 2, 0], [8, 2, 0]], 'detach: selection moved');
assert.equal(m.nodes.length, 4);

// copies connected only at the given (double-selected) nodes
m = createModel('t');
m.materials.push({ id: 1, name: 'S235', type: 'steel' }); m.sections.push({ id: 1, name: 'IPE 200' });
const ids = [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]].map((p) => addNode(m, p));
const ring = ids.map((n, i) => addLine(m, n, ids[(i + 1) % 4], defaultLineElement('beam', 1, 1)));
m.loads.push({ id: 1, lc: 1, line: ring[0], type: 'lineDist', q: [0, 0, -5] });
transformSelection(m, sel({ lines: ring }), up([0, 0, 3]), { copies: 2, connect: true, connectNodes: new Set([ids[0], ids[2]]), copyLoads: false });
const vertical = m.lines.filter((l) => { const p = at(m, l.n1), q = at(m, l.n2); return p[0] === q[0] && p[1] === q[1]; });
assert.equal(vertical.length, 4, '2 connected nodes × 2 copies');
assert.equal(m.lines.length, 4 * 3 + 4);
assert.equal(m.loads.length, 1, 'loads not copied');
assert.ok(m.lines.filter((l) => !vertical.includes(l)).every((l) => l.element?.type === 'beam'), 'elements copied');

console.log('transform: ok');
