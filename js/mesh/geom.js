// Tragwerk Studio – geometry helpers for the mesher (pure functions, no DOM).

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export function normalize(a) {
  const l = norm(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/**
 * Local axes of a line element (SPEC §2.1).
 * @returns {{ex:number[], ey:number[], ez:number[], length:number}|null} null for zero length
 */
export function lineAxes(p1, p2, betaDeg = 0) {
  const d = sub(p2, p1);
  const L = norm(d);
  if (!(L > 0)) return null;
  const ex = scale(d, 1 / L);
  let r = [0, 0, 1];
  if (Math.abs(dot(ex, r)) > 0.999) r = [1, 0, 0];
  let ey = normalize(cross(r, ex));
  let ez = cross(ex, ey);
  const beta = (betaDeg || 0) * Math.PI / 180;
  if (beta !== 0) {
    const c = Math.cos(beta), s = Math.sin(beta);
    const ey2 = add(scale(ey, c), scale(ez, s));
    const ez2 = add(scale(ey, -s), scale(ez, c));
    ey = ey2; ez = ez2;
  }
  return { ex, ey, ez, length: L };
}

/** Newell normal (not normalized) of a 3D polygon given as array of [x,y,z]. */
export function newellNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

/**
 * Local axes of a domain (SPEC §2.2) from its outer polygon.
 * @returns {{ex,ey,ez,origin}|null} null for degenerate polygons
 */
export function domainAxes(pts) {
  let n = newellNormal(pts);
  const l = norm(n);
  if (!(l > 0)) return null;
  n = scale(n, 1 / l);
  if (Math.abs(n[2]) > 1e-6) { if (n[2] < 0) n = scale(n, -1); }
  else if (Math.abs(n[1]) > 1e-6) { if (n[1] < 0) n = scale(n, -1); }
  else if (n[0] < 0) n = scale(n, -1);
  const ez = n;
  let ex = sub([1, 0, 0], scale(ez, ez[0]));
  if (norm(ex) < 1e-6) ex = sub([0, 1, 0], scale(ez, ez[1]));
  ex = normalize(ex);
  const ey = cross(ez, ex);
  return { ex, ey, ez, origin: pts[0].slice() };
}

/** Signed area of a 2D polygon given as flat arrays or [[x,y]] list. */
export function polygonArea2D(poly) {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Crossing-number point-in-polygon test (2D, poly = [[x,y],...]). */
export function pointInPolygon2D(x, y, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y)) {
      const xc = xi + (y - yi) * (xj - xi) / (yj - yi);
      if (x < xc) inside = !inside;
    }
  }
  return inside;
}

/** Distance from (px,py) to segment a-b in 2D. */
export function distPointSeg2D(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/** 2D orientation (twice the signed triangle area). */
export function orient2D(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Proper intersection of segments p1-p2 and p3-p4 (2D). Returns { t, u } parameters on both segments
 * or null (parallel / no intersection). Endpoint touching counts when within [eps, 1-eps].
 */
export function segSegIntersect2D(p1, p2, p3, p4, eps = 1e-9) {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
  if (Math.abs(den) <= 1e-12 * l1 * l2) return null;
  const wx = p3[0] - p1[0], wy = p3[1] - p1[1];
  const t = (wx * d2y - wy * d2x) / den;
  const u = (wx * d1y - wy * d1x) / den;
  if (t < eps || t > 1 - eps || u < eps || u > 1 - eps) return null;
  return { t, u };
}
