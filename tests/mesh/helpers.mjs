// Shared helpers for mesher tests (not a test file itself).
import assert from 'node:assert/strict';

export function model({ nodes = [], lines = [], domains = [], meshSize = 1, beamDivisions = 4, supports = [], loads = [] } = {}) {
  return {
    version: 1, meta: { name: 'test' },
    settings: { meshSize, beamDivisions, g: 9.81 },
    nodes: nodes.map(([id, x, y, z]) => ({ id, x, y, z })),
    lines, domains, materials: [], sections: [], supports, loadGroups: [], loadCases: [], loads, combinations: [],
  };
}

export const P = (mesh, i) => [mesh.nodes[3 * i], mesh.nodes[3 * i + 1], mesh.nodes[3 * i + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Signed area of a planar quad about its ez (positive = CCW about ez). */
export function quadArea(mesh, sh) {
  const [a, b, c, d] = sh.nodes.map((i) => P(mesh, i));
  return 0.5 * dot(cross(sub(c, a), sub(d, b)), sh.ez);
}

/** All corners strictly convex about ez. */
export function quadConvex(mesh, sh) {
  const p = sh.nodes.map((i) => P(mesh, i));
  for (let k = 0; k < 4; k++) {
    const a = p[(k + 3) % 4], b = p[k], c = p[(k + 1) % 4];
    if (dot(cross(sub(b, a), sub(c, b)), sh.ez) <= 0) return false;
  }
  return true;
}

/** Checks of a domain mesh: positive CCW areas, sum = expected area, edge conformity. Returns stats. */
export function checkDomain(mesh, domainId, expectedArea, { tolRel = 1e-9, allowNonConvex = false } = {}) {
  const elems = mesh.domainElems[domainId];
  assert.ok(elems && elems.length > 0, `domain ${domainId} has elements`);
  let area = 0, minArea = Infinity;
  const edges = new Map();
  for (const ei of elems) {
    const sh = mesh.shells[ei];
    assert.equal(sh.nodes.length, 4, 'quads only');
    assert.equal(new Set(sh.nodes).size, 4, 'distinct corner nodes');
    const A = quadArea(mesh, sh);
    assert.ok(A > 0, `element ${ei} positive CCW area (got ${A})`);
    if (!allowNonConvex) assert.ok(quadConvex(mesh, sh), `element ${ei} convex`);
    area += A; minArea = Math.min(minArea, A);
    for (let k = 0; k < 4; k++) {
      const a = sh.nodes[k], b = sh.nodes[(k + 1) % 4];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const e = edges.get(key) || { n: 0, dir: 0 };
      e.n++; e.dir += a < b ? 1 : -1;
      edges.set(key, e);
    }
  }
  assert.ok(Math.abs(area - expectedArea) <= tolRel * Math.max(1, expectedArea) + 1e-9,
    `domain ${domainId} area ${area} == ${expectedArea}`);
  let boundary = 0;
  for (const [k, e] of edges) {
    assert.ok(e.n <= 2, `edge ${k} used by at most two elements`);
    if (e.n === 2) assert.equal(e.dir, 0, `edge ${k} traversed in opposite directions (no overlap / consistent orientation)`);
    else boundary++;
  }
  return { area, minArea, n: elems.length, boundaryEdges: boundary };
}

/** Mesh node indices lying on segment p-q (3D, tolerance tol). */
export function nodesOnSegment(mesh, nodeList, p, q, tol = 1e-7) {
  const d = sub(q, p), L2 = dot(d, d);
  const out = [];
  for (const i of nodeList) {
    const x = P(mesh, i);
    const t = dot(sub(x, p), d) / L2;
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const e = sub(x, [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]]);
    if (Math.hypot(...e) <= tol) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

export function domainNodeSet(mesh, domainId) {
  return mesh.domainNodes[domainId];
}

export function approx(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);
}

export function vecApprox(a, b, tol = 1e-9, msg = '') {
  for (let k = 0; k < 3; k++) approx(a[k], b[k], tol, `${msg}[${k}]`);
}
