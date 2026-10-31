// Section lines: sampling across shell elements, interpolation and integration.
import assert from 'node:assert/strict';
import { sampleSection, sectionValues, sectionStats } from '../../js/core/seclines.js';

// 4 × 2 grid of 1 m quads at z = 3 with a missing element (opening) at x 2…3, y 0…1
const X = [];
for (let j = 0; j <= 2; j++) for (let i = 0; i <= 4; i++) X.push(i, j, 3);
const id = (i, j) => j * 5 + i;
const shells = [];
for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) if (!(i === 2 && j === 0)) shells.push({ nodes: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)], domain: 1, thickness: 0.2, ez: [0, 0, 1] });
const mesh = { nodes: Float64Array.from(X), shells };
// linear field v = x + 2y is reproduced exactly
const cv = (e, k) => { const n = shells[e].nodes[k]; return X[3 * n] + 2 * X[3 * n + 1]; };

// line at y = 1.5 from x = 0 to 4 (no gap): v = x + 3, ∫ = 8 + 12 = 20
const s1 = sampleSection(mesh, [0, 1.5, 3], [4, 1.5, 3], { n: 80 });
const v1 = sectionValues(s1, cv);
assert.ok(v1.every((v, i) => v != null && Math.abs(v - (s1.pts[i].p[0] + 3)) < 1e-9));
const st1 = sectionStats(s1, v1);
assert.ok(Math.abs(st1.integral - 20) < 1e-9, `∫ = ${st1.integral}`);
assert.ok(Math.abs(st1.max - 7) < 1e-9 && Math.abs(st1.min - 3) < 1e-9);
assert.ok(Math.abs(s1.L - 4) < 1e-12);

// line at y = 0.5 crosses the opening at x 2…3 → no values there
const s2 = sampleSection(mesh, [0, 0.5, 3], [4, 0.5, 3], { n: 40 });
const v2 = sectionValues(s2, cv);
const gap = s2.pts.filter((p, i) => v2[i] == null).map((p) => p.p[0]);
assert.ok(gap.length > 0 && gap.every((x) => x > 2 - 1e-9 && x < 3 + 1e-9), `gap ${gap}`);
// a line 1 m above the slab finds nothing
const s3 = sampleSection(mesh, [0, 1, 4], [4, 1, 4], { n: 10 });
assert.ok(s3.pts.every((p) => p.hit === null));
console.log('seclines: sampling, interpolation, gaps and integral ok');
