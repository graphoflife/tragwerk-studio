// Coordinate window fields: Cartesian/polar values, relative ("d") vs absolute, typed and locked fields.
import assert from 'node:assert/strict';
import { fieldValues, applyFields, angleStep } from '../../js/core/coordfields.js';

const near = (a, b, tol = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < tol);
const REL = { dCart: true, dPolar: true }, ABS = { dCart: false, dPolar: false };
const o = [1, 2, 0];

// values: relative to the origin with "d", absolute without
let v = fieldValues([4, 6, 0], o, 'XY', REL);
assert.ok(near([v.X, v.Y, v.Z, v.L, v.r, v.a], [3, 4, 0, 5, 5, Math.atan2(4, 3) * 180 / Math.PI]));
v = fieldValues([4, 6, 0], o, 'XY', ABS);
assert.ok(near([v.X, v.Y, v.L], [4, 6, Math.hypot(4, 6)]));
// polar angle in the XZ plane: first axis X, second Z
v = fieldValues([1, 2, 3], o, 'XZ', REL);
assert.ok(near([v.r, v.a, v.h], [3, 90, 0]));

// typed Cartesian fields replace those coordinates of the cursor point
assert.ok(near(applyFields([9, 9, 9], [['X', 5]], o, 'XY', REL), [6, 9, 9]), 'dX from the origin');
assert.ok(near(applyFields([9, 9, 9], [['X', 5]], o, 'XY', ABS), [5, 9, 9]), 'absolute X');
assert.ok(near(applyFields([9, 9, 9], [['X', 12], ['Y', 0], ['Z', 0]], null, 'XY', ABS), [12, 0, 0]), 'tutorial: x 12 y 0 z 0');

// L: distance along the direction origin → cursor
assert.ok(near(applyFields([4, 6, 0], [['L', 10]], o, 'XY', REL), [7, 10, 0]));

// polar: r and a around the relative origin in the drawing plane, h along its normal
assert.ok(near(applyFields([5, 2, 0], [['a', 90], ['r', 2]], o, 'XY', REL), [1, 4, 0]));
assert.ok(near(applyFields([5, 2, 7], [['a', 90]], o, 'XY', REL), [1, 6, 7]), 'angle keeps the radius and height');
assert.ok(near(applyFields([1, 2, 0], [['r', 3], ['a', 30]], o, 'XZ', REL), [1 + 3 * Math.cos(Math.PI / 6), 2, 3 * Math.sin(Math.PI / 6)]));
assert.ok(near(applyFields([1, 2, 5], [['h', 1]], o, 'XY', REL), [1, 2, 1]));

// the last entry wins: X after L overrides the X part
assert.ok(near(applyFields([4, 6, 0], [['L', 10], ['X', 0]], o, 'XY', REL), [1, 10, 0]));

// Shift constraint: 15° steps around the origin, distance kept
const s = angleStep([1 + Math.cos(0.3), 2 + Math.sin(0.3), 4], o, 'XY', 15);
assert.ok(near(s, [1 + Math.cos(Math.PI / 12), 2 + Math.sin(Math.PI / 12), 4]));
assert.ok(near(angleStep([3, 2.2, 0], o, 'XY', 15), [1 + Math.hypot(2, 0.2), 2, 0]));

console.log('coordfields: ok');
