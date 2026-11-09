// Coordinate window fields (AxisVM: Koordinatenfenster) – pure functions, no DOM.
//
//   X Y Z   Cartesian coordinates; with the Cartesian "d" switch on: dX dY dZ from the relative origin
//   L       distance from the origin (relative origin with "d", else the global origin)
//   r a h   cylindrical coordinates in the drawing plane: radius, angle (°, 0 = first plane axis,
//           counter-clockwise), height along the plane normal; with the polar "d" switch around the
//           relative origin, else around the global origin
// A point follows from the cursor point with field values put in (locked fields, typed fields). The
// values are applied in the order they were entered – the last one wins where they contradict.

export const FIELDS = ['X', 'Y', 'Z', 'L', 'r', 'a', 'h'];
export const CART = ['X', 'Y', 'Z', 'L'];
const AXIS = { X: 0, Y: 1, Z: 2 };
// in-plane axes u, v and the normal n of the drawing planes
const PLANE_AXES = { XY: [0, 1, 2], XZ: [0, 2, 1], YZ: [1, 2, 0] };
const DEG = Math.PI / 180;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

function centre(field, origin, { dCart, dPolar }) {
  const rel = CART.includes(field) ? dCart : dPolar;
  return rel && origin ? origin : [0, 0, 0];
}

/** Values of all fields for point p: { X, Y, Z, L, r, a, h } (lengths in m, a in degrees). */
export function fieldValues(p, origin, plane = 'XY', flags = { dCart: true, dPolar: true }) {
  const c = centre('X', origin, flags), d = sub(p, c);
  const [iu, iv, inn] = PLANE_AXES[plane] || PLANE_AXES.XY;
  const q = sub(p, centre('r', origin, flags));
  const r = Math.hypot(q[iu], q[iv]);
  return { X: d[0], Y: d[1], Z: d[2], L: len(d), r, a: r > 1e-12 ? Math.atan2(q[iv], q[iu]) / DEG : 0, h: q[inn] };
}

/**
 * Point from the base point with field values put in.
 * @param {number[]} base   cursor point
 * @param {Array<[string, number]>} entries   [field, value] in the order they were entered
 * @param {number[]|null} origin   relative origin
 * @param {string} plane   drawing plane 'XY' | 'XZ' | 'YZ' (for r, a, h)
 */
export function applyFields(base, entries, origin, plane = 'XY', flags = { dCart: true, dPolar: true }) {
  let p = [...base];
  const [iu, iv, inn] = PLANE_AXES[plane] || PLANE_AXES.XY;
  for (const [f, v] of entries) {
    if (!Number.isFinite(v)) continue;
    const c = centre(f, origin, flags);
    if (f in AXIS) { p[AXIS[f]] = c[AXIS[f]] + v; continue; }
    if (f === 'L') {
      const d = sub(p, c), l = len(d);
      const dir = l > 1e-12 ? d.map((x) => x / l) : [1, 0, 0];
      p = c.map((x, i) => x + dir[i] * v);
      continue;
    }
    // cylindrical r, a, h around c in the drawing plane
    const q = sub(p, c);
    let r = Math.hypot(q[iu], q[iv]), a = r > 1e-12 ? Math.atan2(q[iv], q[iu]) : 0, hh = q[inn];
    if (f === 'r') r = v;
    if (f === 'a') { a = v * DEG; if (r < 1e-12) r = 0; }
    if (f === 'h') hh = v;
    const out = [0, 0, 0];
    out[iu] = r * Math.cos(a); out[iv] = r * Math.sin(a); out[inn] = hh;
    p = c.map((x, i) => x + out[i]);
  }
  return p;
}

/**
 * Shift constraint without an object under the cursor: direction from the origin rounded to multiples of
 * step degrees in the drawing plane (AxisVM: Δα = 15°), distance kept.
 */
export function angleStep(p, origin, plane = 'XY', step = 15) {
  const [iu, iv] = PLANE_AXES[plane] || PLANE_AXES.XY;
  const q = sub(p, origin);
  const r = Math.hypot(q[iu], q[iv]);
  if (r < 1e-12) return [...p];
  const a = Math.round(Math.atan2(q[iv], q[iu]) / DEG / step) * step * DEG;
  const out = [...p];
  out[iu] = origin[iu] + r * Math.cos(a); out[iv] = origin[iv] + r * Math.sin(a);
  return out;
}
