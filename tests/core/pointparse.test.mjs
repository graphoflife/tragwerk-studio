// Typed CAD point input: relative/absolute, axis distance, direct distance, polar, work plane, copies.
import assert from 'node:assert/strict';
import { parsePointInput, evalNumber } from '../../js/core/pointparse.js';

const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
const XY = { U: [1, 0, 0], V: [0, 1, 0], origin: [0, 0, 0] };
const XZ = { U: [1, 0, 0], V: [0, 0, 1], origin: [0, 2, 0] };
const ref = [1, 2, 3];
const P = (s, ctx) => parsePointInput(s, { plane: XY, ...ctx });

// absolute vs relative defaults and prefixes
assert.ok(near(P('5 0 2').p, [5, 0, 2]));
assert.ok(near(P('5 0 2', { ref }).p, [6, 2, 5]), 'second point defaults to relative');
assert.ok(near(P('#5 0 2', { ref }).p, [5, 0, 2]), '# forces absolute');
assert.ok(near(P('@1 1 1', { ref, relative: false }).p, [2, 3, 4]), '@ forces relative');
assert.ok(near(P('@1 1 1').p, [1, 1, 1]), '@ without reference = relative to origin');

// one number: along the axis constraint, else along the mouse direction
assert.ok(near(P('3', { ref, axis: [1, 0, 0] }).p, [4, 2, 3]));
assert.ok(near(P('-2', { ref, axis: [0, 0, 1] }).p, [1, 2, 1]));
assert.ok(near(P('4', { ref, dirHint: [0, 1, 0] }).p, [1, 6, 3]));
assert.equal(P('4').ok, false, 'no direction without reference');

// two numbers: work plane coordinates
assert.ok(near(P('4 6').p, [4, 6, 0]));
assert.ok(near(parsePointInput('4 6', { plane: XZ }).p, [4, 2, 6]), 'absolute in XZ plane at y = 2');
assert.ok(near(P('4 6', { ref }).p, [5, 8, 3]), 'relative in plane');

// polar
const pol = P('@2<90', { ref });
assert.ok(near(pol.p, [1, 4, 3]));
assert.ok(near(P('10<0').p, [10, 0, 0]));

// decimals with comma, expressions, unit conversion (display mm → internal m)
assert.ok(near(P('2,5 0 0').p, [2.5, 0, 0]));
assert.ok(near(P('6/4 2*3 0').p, [1.5, 6, 0]));
assert.ok(near(P('1000 0 0', { len: (v) => v / 1000 }).p, [1, 0, 0]));
assert.equal(evalNumber('6*2'), 12);

// copies suffix
const c = P('0 0 3 *4', { ref });
assert.equal(c.copies, 4);
assert.ok(near(c.p, [1, 2, 6]));
assert.equal(P('6*2', { ref, axis: [1, 0, 0] }).copies, 1, 'no space → arithmetic');
assert.ok(near(P('6*2', { ref, axis: [1, 0, 0] }).p, [13, 2, 3]));

// errors
assert.equal(P('').ok, false);
assert.equal(P('a b c').ok, false);
assert.equal(P('1 2 3 4').ok, false);
console.log('pointparse: all assertions passed');
