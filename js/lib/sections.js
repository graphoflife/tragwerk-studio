// Tragwerk Studio – cross-section library (SPEC §2.4, §6)
//
// All public values in SI units (m, m², m⁴, m⁶). Tables are stored in mm and converted.
// Local section coordinates: y horizontal, z up (as seen looking at the cross-section),
// `h` along z, `b` along y. Iy = ∫z² dA (strong axis), Iz = ∫y² dA.
//
// A, Iy, Iz, Iyz, centroid, Wpl are integrated numerically from the exact outline polygon
// (root / toe radii and tapered flanges of IPN/UPN modelled; arcs finely discretised), so they
// agree with the manufacturer tables within ~1 %. It, Iw use the usual closed-form/thin-walled
// approximations (rolled I: ArcelorMittal/Kollbrunner fillet formula; RHS: EN 10210-2 formula).
//
// Deviations / extensions of SPEC.md (documented as required):
//  * Extra dims: I/U may carry `r2` (toe radius) and `slope` (flange taper, IPN 0.14, UPN 0.08/0.05);
//    RHS `r` = OUTER corner radius, optional `ri` = inner radius (default max(r - t, 0));
//    L may carry `r` (root) and `r2` (toe). These extra dims are optional for parametric sections.
//  * Extra properties: `Iyz` (product of inertia, non-zero for L), for L also principal values
//    `Iu`, `Iv` and angle `alphaUV` [deg]; `ycg`/`zcg` = centroid position in the raw drawing
//    coordinates (informative); `mass` [kg/m] for steel density 7850 kg/m³.
//  * For L sections Iy/Iz refer to the axes parallel to the legs (not the principal axes).
//  * Library hollow sections are hot-finished EN 10210 (ro = 1.5 t, ri = 1.0 t) → fabrication 'rolled'.
//  * getLibrarySection() returns null for unknown names.

// ---------------------------------------------------------------- tables (mm)
// I: [name, h, b, tw, tf, r]
const IPE_T = [
  ['IPE 80', 80, 46, 3.8, 5.2, 5], ['IPE 100', 100, 55, 4.1, 5.7, 7], ['IPE 120', 120, 64, 4.4, 6.3, 7],
  ['IPE 140', 140, 73, 4.7, 6.9, 7], ['IPE 160', 160, 82, 5.0, 7.4, 9], ['IPE 180', 180, 91, 5.3, 8.0, 9],
  ['IPE 200', 200, 100, 5.6, 8.5, 12], ['IPE 220', 220, 110, 5.9, 9.2, 12], ['IPE 240', 240, 120, 6.2, 9.8, 15],
  ['IPE 270', 270, 135, 6.6, 10.2, 15], ['IPE 300', 300, 150, 7.1, 10.7, 15], ['IPE 330', 330, 160, 7.5, 11.5, 18],
  ['IPE 360', 360, 170, 8.0, 12.7, 18], ['IPE 400', 400, 180, 8.6, 13.5, 21], ['IPE 450', 450, 190, 9.4, 14.6, 21],
  ['IPE 500', 500, 200, 10.2, 16.0, 21], ['IPE 550', 550, 210, 11.1, 17.2, 24], ['IPE 600', 600, 220, 12.0, 19.0, 24],
];
const HEA_T = [
  ['HEA 100', 96, 100, 5, 8, 12], ['HEA 120', 114, 120, 5, 8, 12], ['HEA 140', 133, 140, 5.5, 8.5, 12],
  ['HEA 160', 152, 160, 6, 9, 15], ['HEA 180', 171, 180, 6, 9.5, 15], ['HEA 200', 190, 200, 6.5, 10, 18],
  ['HEA 220', 210, 220, 7, 11, 18], ['HEA 240', 230, 240, 7.5, 12, 21], ['HEA 260', 250, 260, 7.5, 12.5, 24],
  ['HEA 280', 270, 280, 8, 13, 24], ['HEA 300', 290, 300, 8.5, 14, 27], ['HEA 320', 310, 300, 9, 15.5, 27],
  ['HEA 340', 330, 300, 9.5, 16.5, 27], ['HEA 360', 350, 300, 10, 17.5, 27], ['HEA 400', 390, 300, 11, 19, 27],
  ['HEA 450', 440, 300, 11.5, 21, 27], ['HEA 500', 490, 300, 12, 23, 27], ['HEA 550', 540, 300, 12.5, 24, 27],
  ['HEA 600', 590, 300, 13, 25, 27], ['HEA 650', 640, 300, 13.5, 26, 27], ['HEA 700', 690, 300, 14.5, 27, 27],
  ['HEA 800', 790, 300, 15, 28, 30], ['HEA 900', 890, 300, 16, 30, 30], ['HEA 1000', 990, 300, 16.5, 31, 30],
];
const HEB_T = [
  ['HEB 100', 100, 100, 6, 10, 12], ['HEB 120', 120, 120, 6.5, 11, 12], ['HEB 140', 140, 140, 7, 12, 12],
  ['HEB 160', 160, 160, 8, 13, 15], ['HEB 180', 180, 180, 8.5, 14, 15], ['HEB 200', 200, 200, 9, 15, 18],
  ['HEB 220', 220, 220, 9.5, 16, 18], ['HEB 240', 240, 240, 10, 17, 21], ['HEB 260', 260, 260, 10, 17.5, 24],
  ['HEB 280', 280, 280, 10.5, 18, 24], ['HEB 300', 300, 300, 11, 19, 27], ['HEB 320', 320, 300, 11.5, 20.5, 27],
  ['HEB 340', 340, 300, 12, 21.5, 27], ['HEB 360', 360, 300, 12.5, 22.5, 27], ['HEB 400', 400, 300, 13.5, 24, 27],
  ['HEB 450', 450, 300, 14, 26, 27], ['HEB 500', 500, 300, 14.5, 28, 27], ['HEB 550', 550, 300, 15, 29, 27],
  ['HEB 600', 600, 300, 15.5, 30, 27], ['HEB 650', 650, 300, 16, 31, 27], ['HEB 700', 700, 300, 17, 32, 27],
  ['HEB 800', 800, 300, 17.5, 33, 30], ['HEB 900', 900, 300, 18.5, 35, 30], ['HEB 1000', 1000, 300, 19, 36, 30],
];
const HEM_T = [
  ['HEM 100', 120, 106, 12, 20, 12], ['HEM 120', 140, 126, 12.5, 21, 12], ['HEM 140', 160, 146, 13, 22, 12],
  ['HEM 160', 180, 166, 14, 23, 15], ['HEM 180', 200, 186, 14.5, 24, 15], ['HEM 200', 220, 206, 15, 25, 18],
  ['HEM 220', 240, 226, 15.5, 26, 18], ['HEM 240', 270, 248, 18, 32, 21], ['HEM 260', 290, 268, 18, 32.5, 24],
  ['HEM 280', 310, 288, 18.5, 33, 24], ['HEM 300', 340, 310, 21, 39, 27], ['HEM 320', 359, 309, 21, 40, 27],
  ['HEM 340', 377, 309, 21, 40, 27], ['HEM 360', 395, 308, 21, 40, 27], ['HEM 400', 432, 307, 21, 40, 27],
  ['HEM 450', 478, 307, 21, 40, 27], ['HEM 500', 524, 306, 21, 40, 27], ['HEM 550', 572, 306, 21, 40, 27],
  ['HEM 600', 620, 305, 21, 40, 27], ['HEM 650', 668, 305, 21, 40, 27], ['HEM 700', 716, 304, 21, 40, 27],
  ['HEM 800', 814, 303, 21, 40, 30], ['HEM 900', 910, 302, 21, 40, 30], ['HEM 1000', 1008, 302, 21, 40, 30],
];
// IPN (DIN 1025-1): [name, h, b, tw, tf(mean, at b/4 from tip), r1, r2]; flange slope 14 %
const IPN_T = [
  ['IPN 80', 80, 42, 3.9, 5.9, 3.9, 2.3], ['IPN 100', 100, 50, 4.5, 6.8, 4.5, 2.7],
  ['IPN 120', 120, 58, 5.1, 7.7, 5.1, 3.1], ['IPN 140', 140, 66, 5.7, 8.6, 5.7, 3.4],
  ['IPN 160', 160, 74, 6.3, 9.5, 6.3, 3.8], ['IPN 180', 180, 82, 6.9, 10.4, 6.9, 4.1],
  ['IPN 200', 200, 90, 7.5, 11.3, 7.5, 4.5], ['IPN 220', 220, 98, 8.1, 12.2, 8.1, 4.9],
  ['IPN 240', 240, 106, 8.7, 13.1, 8.7, 5.2], ['IPN 260', 260, 113, 9.4, 14.1, 9.4, 5.6],
  ['IPN 280', 280, 119, 10.1, 15.2, 10.1, 6.1], ['IPN 300', 300, 125, 10.8, 16.2, 10.8, 6.5],
  ['IPN 320', 320, 131, 11.5, 17.3, 11.5, 6.9], ['IPN 340', 340, 137, 12.2, 18.3, 12.2, 7.3],
  ['IPN 360', 360, 143, 13.0, 19.5, 13.0, 7.8], ['IPN 380', 380, 149, 13.7, 20.5, 13.7, 8.2],
  ['IPN 400', 400, 155, 14.4, 21.6, 14.4, 8.6],
];
// UPN (DIN 1026-1): [name, h, b, tw, tf(at b/2), r1, r2, slope]
const UPN_T = [
  ['UPN 80', 80, 45, 6, 8, 8, 4, 0.08], ['UPN 100', 100, 50, 6, 8.5, 8.5, 4.5, 0.08],
  ['UPN 120', 120, 55, 7, 9, 9, 4.5, 0.08], ['UPN 140', 140, 60, 7, 10, 10, 5, 0.08],
  ['UPN 160', 160, 65, 7.5, 10.5, 10.5, 5.5, 0.08], ['UPN 180', 180, 70, 8, 11, 11, 5.5, 0.08],
  ['UPN 200', 200, 75, 8.5, 11.5, 11.5, 6, 0.08], ['UPN 220', 220, 80, 9, 12.5, 12.5, 6.5, 0.08],
  ['UPN 240', 240, 85, 9.5, 13, 13, 6.5, 0.08], ['UPN 260', 260, 90, 10, 14, 14, 7, 0.08],
  ['UPN 280', 280, 95, 10, 15, 15, 7.5, 0.08], ['UPN 300', 300, 100, 10, 16, 16, 8, 0.08],
  ['UPN 320', 320, 100, 14, 17.5, 17.5, 8.75, 0.05], ['UPN 350', 350, 100, 14, 16, 16, 8, 0.05],
  ['UPN 380', 380, 102, 13.5, 16, 16, 8, 0.05], ['UPN 400', 400, 110, 14, 18, 18, 9, 0.05],
];
// SHS hot finished EN 10210: [b, t]
const SHS_T = [
  [40, 4], [50, 4], [50, 5], [60, 4], [60, 5], [70, 5], [80, 4], [80, 5], [80, 6.3], [90, 5], [90, 6.3],
  [100, 4], [100, 5], [100, 6.3], [100, 8], [100, 10], [120, 5], [120, 6.3], [120, 8], [120, 10],
  [140, 5], [140, 6.3], [140, 8], [140, 10], [150, 6.3], [150, 8], [150, 10], [160, 6.3], [160, 8], [160, 10],
  [180, 8], [180, 10], [200, 6.3], [200, 8], [200, 10], [200, 12.5], [220, 10], [250, 8], [250, 10], [250, 12.5],
  [260, 10], [300, 10], [300, 12.5],
];
// RHS hot finished EN 10210: [h, b, t]
const RHS_T = [
  [50, 30, 3], [60, 40, 4], [80, 40, 4], [100, 50, 4], [100, 50, 5], [100, 60, 5], [120, 60, 5],
  [120, 80, 5], [120, 80, 6.3], [140, 80, 6.3], [150, 100, 6.3], [150, 100, 8], [160, 80, 6.3], [160, 80, 8],
  [180, 100, 8], [200, 100, 6.3], [200, 100, 8], [200, 100, 10], [200, 120, 8], [250, 100, 10], [250, 150, 8],
  [250, 150, 10], [260, 180, 10], [300, 100, 10], [300, 150, 10], [300, 200, 10], [300, 200, 12.5],
  [400, 200, 10], [400, 200, 12.5],
];
// CHS EN 10210: [d, t]
const CHS_T = [
  [21.3, 2.6], [26.9, 2.6], [33.7, 3.2], [42.4, 3.2], [48.3, 3.2], [48.3, 4], [60.3, 3.2], [60.3, 4],
  [76.1, 3.2], [76.1, 4], [88.9, 3.2], [88.9, 4], [88.9, 5], [101.6, 4], [101.6, 5], [114.3, 4], [114.3, 5],
  [114.3, 6.3], [139.7, 5], [139.7, 6.3], [139.7, 8], [168.3, 5], [168.3, 6.3], [168.3, 8], [168.3, 10],
  [193.7, 6.3], [193.7, 8], [193.7, 10], [219.1, 6.3], [219.1, 8], [219.1, 10], [219.1, 12.5], [244.5, 8],
  [244.5, 10], [273, 8], [273, 10], [273, 12.5], [323.9, 8], [323.9, 10], [323.9, 12.5], [355.6, 10],
  [355.6, 12.5], [406.4, 10], [406.4, 12.5], [457, 10], [457, 12.5], [508, 10], [508, 12.5], [508, 16],
];
// Equal angles EN 10056-1: [a, t, r1, r2]
const L_T = [
  [30, 3, 5, 2.5], [40, 4, 6, 3], [45, 4.5, 7, 3.5], [50, 5, 7, 3.5], [60, 6, 8, 4], [70, 7, 9, 4.5],
  [80, 8, 10, 5], [90, 9, 11, 5.5], [100, 10, 12, 6], [100, 12, 12, 6], [120, 10, 13, 6.5], [120, 12, 13, 6.5],
  [150, 12, 16, 8], [150, 15, 16, 8], [160, 15, 17, 8.5], [180, 18, 18, 9], [200, 16, 18, 9], [200, 20, 18, 9],
];

// ---------------------------------------------------------------- name helpers
const fmt = (v) => String(+(+v).toFixed(2));

const LIB = new Map(); // normalized key → { name, family, shape, fabrication, dimsMM }
function normKey(name) {
  return String(name ?? '').toUpperCase().replace(/×|\*/g, 'X').replace(/,/g, '.').replace(/\s+/g, '');
}
function reg(family, shape, name, dimsMM, aliases = []) {
  const e = { name, family, shape, fabrication: 'rolled', dimsMM };
  LIB.set(normKey(name), e);
  for (const a of aliases) LIB.set(normKey(a), e);
  return name;
}

const fam = (key, label, shape, names) => ({ key, label, shape, names });

const heAlias = (n, s) => { const v = n.split(' ')[1]; return [`HE ${v} ${s}`, `HE${v}${s}`]; };

export const SECTION_FAMILIES = [
  fam('IPE', 'IPE', 'I', IPE_T.map(([n, h, b, tw, tf, r]) => reg('IPE', 'I', n, { h, b, tw, tf, r }))),
  fam('HEA', 'HEA (HE-A)', 'I', HEA_T.map(([n, h, b, tw, tf, r]) => reg('HEA', 'I', n, { h, b, tw, tf, r }, heAlias(n, 'A')))),
  fam('HEB', 'HEB (HE-B)', 'I', HEB_T.map(([n, h, b, tw, tf, r]) => reg('HEB', 'I', n, { h, b, tw, tf, r }, heAlias(n, 'B')))),
  fam('HEM', 'HEM (HE-M)', 'I', HEM_T.map(([n, h, b, tw, tf, r]) => reg('HEM', 'I', n, { h, b, tw, tf, r }, heAlias(n, 'M')))),
  fam('IPN', 'IPN', 'I', IPN_T.map(([n, h, b, tw, tf, r, r2]) => reg('IPN', 'I', n, { h, b, tw, tf, r, r2, slope: 0.14 }))),
  fam('UPN', 'UPN', 'U', UPN_T.map(([n, h, b, tw, tf, r, r2, slope]) => reg('UPN', 'U', n, { h, b, tw, tf, r, r2, slope }))),
  fam('SHS', 'SHS (EN 10210)', 'RHS', SHS_T.map(([b, t]) =>
    reg('SHS', 'RHS', `SHS ${fmt(b)}x${fmt(t)}`, { h: b, b, t, r: 1.5 * t, ri: t }, [`SHS ${fmt(b)}x${fmt(b)}x${fmt(t)}`]))),
  fam('RHS', 'RHS (EN 10210)', 'RHS', RHS_T.map(([h, b, t]) =>
    reg('RHS', 'RHS', `RHS ${fmt(h)}x${fmt(b)}x${fmt(t)}`, { h, b, t, r: 1.5 * t, ri: t }))),
  fam('CHS', 'CHS (EN 10210)', 'CHS', CHS_T.map(([d, t]) => reg('CHS', 'CHS', `CHS ${fmt(d)}x${fmt(t)}`, { d, t }))),
  fam('L', 'L (EN 10056-1)', 'L', L_T.map(([a, t, r1, r2]) =>
    reg('L', 'L', `L ${fmt(a)}x${fmt(t)}`, { h: a, b: a, t, r: r1, r2 }, [`L ${fmt(a)}x${fmt(a)}x${fmt(t)}`]))),
];

// ---------------------------------------------------------------- polygon tools (units: whatever the caller uses)
// ring = [[y,z],...] (implicitly closed)

/** Replace corners by tangent circular arcs. radii[i] = radius at vertex i (0 = sharp). */
function roundCorners(pts, radii, segPer90) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const r = radii[i] || 0;
    const P = pts[i];
    if (r <= 0) { out.push([P[0], P[1]]); continue; }
    const A = pts[(i + n - 1) % n], B = pts[(i + 1) % n];
    let d1y = A[0] - P[0], d1z = A[1] - P[1], d2y = B[0] - P[0], d2z = B[1] - P[1];
    const l1 = Math.hypot(d1y, d1z), l2 = Math.hypot(d2y, d2z);
    d1y /= l1; d1z /= l1; d2y /= l2; d2z /= l2;
    const cosT = Math.max(-1, Math.min(1, d1y * d2y + d1z * d2z));
    const theta = Math.acos(cosT); // angle between the edges at P
    if (theta < 1e-6 || Math.PI - theta < 1e-6) { out.push([P[0], P[1]]); continue; }
    const t = Math.min(r / Math.tan(theta / 2), 0.999 * l1, 0.999 * l2);
    const rr = t * Math.tan(theta / 2);
    const T1 = [P[0] + d1y * t, P[1] + d1z * t], T2 = [P[0] + d2y * t, P[1] + d2z * t];
    let by = d1y + d2y, bz = d1z + d2z; const bl = Math.hypot(by, bz); by /= bl; bz /= bl;
    const dc = rr / Math.sin(theta / 2);
    const C = [P[0] + by * dc, P[1] + bz * dc];
    const p1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    const p2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    let dp = p2 - p1;
    while (dp > Math.PI) dp -= 2 * Math.PI;
    while (dp <= -Math.PI) dp += 2 * Math.PI;
    const ns = Math.max(1, Math.ceil(Math.abs(dp) / (Math.PI / 2) * segPer90));
    for (let k = 0; k <= ns; k++) {
      const ph = p1 + dp * k / ns;
      out.push([C[0] + rr * Math.cos(ph), C[1] + rr * Math.sin(ph)]);
    }
  }
  return out;
}

function circleRing(cy, cz, rad, n, cw = false) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const ph = (cw ? -1 : 1) * 2 * Math.PI * k / n;
    out.push([cy + rad * Math.cos(ph), cz + rad * Math.sin(ph)]);
  }
  return out;
}

function rectRing(y0, z0, y1, z1) { return [[y0, z0], [y1, z0], [y1, z1], [y0, z1]]; }

/** Integrals of one ring (signed by orientation). */
function ringIntegrals(r) {
  let A = 0, Sy = 0, Sz = 0, Iyy = 0, Izz = 0, Iyz = 0;
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const [y0, z0] = r[i], [y1, z1] = r[(i + 1) % n];
    const c = y0 * z1 - y1 * z0;
    A += c;
    Sy += (z0 + z1) * c;            // ∫ z dA
    Sz += (y0 + y1) * c;            // ∫ y dA
    Iyy += (z0 * z0 + z0 * z1 + z1 * z1) * c;   // ∫ z² dA
    Izz += (y0 * y0 + y0 * y1 + y1 * y1) * c;   // ∫ y² dA
    Iyz += (y0 * z1 + 2 * y0 * z0 + 2 * y1 * z1 + y1 * z0) * c;
  }
  return { A: A / 2, Sy: Sy / 6, Sz: Sz / 6, Iyy: Iyy / 12, Izz: Izz / 12, Iyz: Iyz / 24 };
}

/** Region integrals: outer counted positive, holes negative regardless of their orientation. */
function regionIntegrals(outline) {
  const acc = { A: 0, Sy: 0, Sz: 0, Iyy: 0, Izz: 0, Iyz: 0 };
  const addRing = (ring, sign) => {
    if (ring.length < 3) return;
    const g = ringIntegrals(ring);
    const s = sign * Math.sign(g.A || 1);
    for (const k in acc) acc[k] += s * g[k];
  };
  addRing(outline.outer, 1);
  for (const h of outline.holes) addRing(h, -1);
  return acc;
}

/** Clip ring to half plane coord[axis] >= c (Sutherland–Hodgman; integrals stay exact). */
function clipRing(ring, axis, c, keepAbove) {
  const out = [];
  const n = ring.length;
  const inside = (p) => (keepAbove ? p[axis] >= c : p[axis] <= c);
  for (let i = 0; i < n; i++) {
    const P = ring[i], Q = ring[(i + 1) % n];
    const pin = inside(P), qin = inside(Q);
    if (pin) out.push(P);
    if (pin !== qin) {
      const t = (c - P[axis]) / (Q[axis] - P[axis]);
      out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
    }
  }
  return out;
}

function clipOutline(outline, axis, c, keepAbove) {
  return {
    outer: clipRing(outline.outer, axis, c, keepAbove),
    holes: outline.holes.map((h) => clipRing(h, axis, c, keepAbove)),
  };
}

/** Plastic section modulus for bending about the axis perpendicular to `axis` (axis 1 = z → Wply). */
function plasticModulus(outline, axis, Atot) {
  let lo = Infinity, hi = -Infinity;
  for (const p of outline.outer) { lo = Math.min(lo, p[axis]); hi = Math.max(hi, p[axis]); }
  const areaAbove = (c) => regionIntegrals(clipOutline(outline, axis, c, true)).A;
  let a = lo, b = hi;
  for (let it = 0; it < 80; it++) {
    const m = 0.5 * (a + b);
    if (areaAbove(m) > Atot / 2) a = m; else b = m;
  }
  const c = 0.5 * (a + b);
  const up = regionIntegrals(clipOutline(outline, axis, c, true));
  const dn = regionIntegrals(clipOutline(outline, axis, c, false));
  const S = axis === 1 ? 'Sy' : 'Sz';
  return (up[S] - c * up.A) + (c * dn.A - dn[S]);
}

function shiftOutline(outline, dy, dz) {
  const f = (r) => r.map(([y, z]) => [y + dy, z + dz]);
  return { outer: f(outline.outer), holes: outline.holes.map(f) };
}

function ringSignedArea(r) { return ringIntegrals(r).A; }
function orientRing(r, ccw) {
  const a = ringSignedArea(r);
  return (a > 0) === ccw ? r : r.slice().reverse();
}

// ---------------------------------------------------------------- raw outlines (dims in any length unit)
/**
 * Raw (un-centred) outline for a shape. `seg` = arc segments per 90°, `circN` = segments of full circles.
 */
function rawOutline(shape, d, seg, circN) {
  switch (shape) {
    case 'I': {
      const { h, b, tw, tf } = d;
      const r = d.r || 0, r2 = d.r2 || 0, s = d.slope || 0;
      const tTip = s ? tf - s * b / 4 : tf;
      const tWeb = s ? tTip + s * (b / 2 - tw / 2) : tf;
      const P = [
        [-b / 2, -h / 2, 0], [b / 2, -h / 2, 0], [b / 2, -h / 2 + tTip, r2], [tw / 2, -h / 2 + tWeb, r],
        [tw / 2, h / 2 - tWeb, r], [b / 2, h / 2 - tTip, r2], [b / 2, h / 2, 0], [-b / 2, h / 2, 0],
        [-b / 2, h / 2 - tTip, r2], [-tw / 2, h / 2 - tWeb, r], [-tw / 2, -h / 2 + tWeb, r], [-b / 2, -h / 2 + tTip, r2],
      ];
      return { outer: roundCorners(P.map((p) => [p[0], p[1]]), P.map((p) => p[2]), seg), holes: [] };
    }
    case 'U': {
      const { h, b, tw, tf } = d;
      const r = d.r || 0, r2 = d.r2 || 0, s = d.slope || 0;
      const tTip = s ? tf - s * b / 2 : tf;
      const tWeb = s ? tTip + s * (b - tw) : tf;
      const P = [
        [0, -h / 2, 0], [b, -h / 2, 0], [b, -h / 2 + tTip, r2], [tw, -h / 2 + tWeb, r],
        [tw, h / 2 - tWeb, r], [b, h / 2 - tTip, r2], [b, h / 2, 0], [0, h / 2, 0],
      ];
      return { outer: roundCorners(P.map((p) => [p[0], p[1]]), P.map((p) => p[2]), seg), holes: [] };
    }
    case 'T': {
      const { h, b, tw, tf } = d;
      const r = d.r || 0;
      const P = [
        [-tw / 2, 0, 0], [tw / 2, 0, 0], [tw / 2, h - tf, r], [b / 2, h - tf, 0],
        [b / 2, h, 0], [-b / 2, h, 0], [-b / 2, h - tf, 0], [-tw / 2, h - tf, r],
      ];
      return { outer: roundCorners(P.map((p) => [p[0], p[1]]), P.map((p) => p[2]), seg), holes: [] };
    }
    case 'L': {
      const { h, b, t } = d;
      const r = d.r || 0, r2 = d.r2 || 0;
      const P = [[0, 0, 0], [b, 0, 0], [b, t, r2], [t, t, r], [t, h, r2], [0, h, 0]];
      return { outer: roundCorners(P.map((p) => [p[0], p[1]]), P.map((p) => p[2]), seg), holes: [] };
    }
    case 'RHS': {
      const { h, b, t } = d;
      const ro = d.r ?? 0;
      const ri = d.ri ?? Math.max(ro - t, 0);
      const outer = roundCorners(rectRing(-b / 2, -h / 2, b / 2, h / 2), [ro, ro, ro, ro], seg);
      const inner = roundCorners(rectRing(-b / 2 + t, -h / 2 + t, b / 2 - t, h / 2 - t), [ri, ri, ri, ri], seg);
      return { outer, holes: [inner.reverse()] };
    }
    case 'BOX': {
      const { h, b, tw, tf } = d;
      return {
        outer: rectRing(-b / 2, -h / 2, b / 2, h / 2),
        holes: [rectRing(-b / 2 + tw, -h / 2 + tf, b / 2 - tw, h / 2 - tf).reverse()],
      };
    }
    case 'RECT': return { outer: rectRing(-d.b / 2, -d.h / 2, d.b / 2, d.h / 2), holes: [] };
    case 'CIRC': return { outer: circleRing(0, 0, d.d / 2, circN), holes: [] };
    case 'CHS': return { outer: circleRing(0, 0, d.d / 2, circN), holes: [circleRing(0, 0, d.d / 2 - d.t, circN, true)] };
    default: return null;
  }
}

// ---------------------------------------------------------------- property computation (mm internally)
const REQ = {
  I: ['h', 'b', 'tw', 'tf'], U: ['h', 'b', 'tw', 'tf'], T: ['h', 'b', 'tw', 'tf'], BOX: ['h', 'b', 'tw', 'tf'],
  L: ['h', 'b', 't'], RHS: ['h', 'b', 't'], CHS: ['d', 't'], RECT: ['h', 'b'], CIRC: ['d'],
};

function checkDims(shape, d) {
  const req = REQ[shape];
  if (!req) throw new Error(`Unknown section shape '${shape}'`);
  for (const k of req) {
    if (!(Number.isFinite(d[k]) && d[k] > 0)) throw new Error(`Section ${shape}: dimension '${k}' must be > 0`);
  }
  const { h, b } = d;
  if ((shape === 'I' || shape === 'U' || shape === 'BOX') && 2 * d.tf >= h) throw new Error(`Section ${shape}: 2·tf must be < h`);
  if (shape === 'T' && d.tf >= h) throw new Error('Section T: tf must be < h');
  if (shape === 'I' && d.tw >= b) throw new Error('Section I: tw must be < b');
  if (shape === 'T' && d.tw > b) throw new Error('Section T: tw must be <= b');
  if (shape === 'U' && d.tw >= b) throw new Error('Section U: tw must be < b');
  if (shape === 'BOX' && 2 * d.tw >= b) throw new Error('Section BOX: 2·tw must be < b');
  if (shape === 'RHS' && 2 * d.t >= Math.min(h, b)) throw new Error('Section RHS: 2·t must be < min(h, b)');
  if (shape === 'L' && (d.t >= h || d.t >= b)) throw new Error('Section L: t must be < h and < b');
  if (shape === 'CHS' && 2 * d.t > d.d) throw new Error('Section CHS: 2·t must be <= d');
}

/** It of a rectangle a×c (Saint-Venant, Roark approximation). */
function rectTorsion(s1, s2) {
  const a = Math.max(s1, s2), c = Math.min(s1, s2);
  return a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4)));
}

/** Core: properties with dims in mm, results in mm units. `fab` = fabrication. */
function propsMM(shape, d, fab) {
  const P = {};
  if (shape === 'CHS' || shape === 'CIRC') {
    const D = d.d, Di = shape === 'CHS' ? Math.max(D - 2 * d.t, 0) : 0;
    const A = Math.PI / 4 * (D * D - Di * Di);
    const I = Math.PI / 64 * (D ** 4 - Di ** 4);
    Object.assign(P, {
      A, Iy: I, Iz: I, Iyz: 0, It: 2 * I, Iw: 0,
      Wely: 2 * I / D, Welz: 2 * I / D, Wply: (D ** 3 - Di ** 3) / 6, Wplz: (D ** 3 - Di ** 3) / 6,
      Avy: shape === 'CHS' ? 2 * A / Math.PI : 0.9 * A, Avz: shape === 'CHS' ? 2 * A / Math.PI : 0.9 * A,
      ymax: D / 2, zmax: D / 2, ycg: 0, zcg: 0,
    });
  } else if (shape === 'RECT') {
    const { h, b } = d, A = b * h;
    Object.assign(P, {
      A, Iy: b * h ** 3 / 12, Iz: h * b ** 3 / 12, Iyz: 0, It: rectTorsion(b, h), Iw: 0,
      Wely: b * h * h / 6, Welz: h * b * b / 6, Wply: b * h * h / 4, Wplz: h * b * b / 4,
      Avy: 5 / 6 * A, Avz: 5 / 6 * A, ymax: b / 2, zmax: h / 2, ycg: 0, zcg: 0,
    });
  } else {
    // numerical integration on the exact outline
    const raw = rawOutline(shape, d, 24, 256);
    const g = regionIntegrals(raw);
    const A = g.A, yc = g.Sz / A, zc = g.Sy / A;
    const out = shiftOutline(raw, -yc, -zc);
    const c = regionIntegrals(out);
    let ymax = 0, zmax = 0;
    for (const [y, z] of out.outer) { ymax = Math.max(ymax, Math.abs(y)); zmax = Math.max(zmax, Math.abs(z)); }
    const Iy = c.Iyy, Iz = c.Izz, Iyz = c.Iyz;
    Object.assign(P, {
      A, Iy, Iz, Iyz: Math.abs(Iyz) < 1e-9 * (Iy + Iz) ? 0 : Iyz,
      Wely: Iy / zmax, Welz: Iz / ymax,
      Wply: plasticModulus(out, 1, A), Wplz: plasticModulus(out, 0, A),
      ymax, zmax, ycg: yc, zcg: zc,
    });
    const { h, b } = d;
    switch (shape) {
      case 'I': {
        const { tw, tf } = d, r = d.r || 0, hw = h - 2 * tf;
        if (r > 0) {
          const D = ((r + tw / 2) ** 2 + (r + tf) ** 2 - r * r) / (2 * r + tf);
          P.It = 2 / 3 * (b - 0.63 * tf) * tf ** 3 + 1 / 3 * (h - 2 * tf) * tw ** 3
            + 2 * (tw / tf) * (0.145 + 0.1 * r / tf) * D ** 4;
        } else {
          P.It = (2 * b * tf ** 3 + (h - 2 * tf) * tw ** 3) / 3;
        }
        P.Iw = Iz * (h - tf) ** 2 / 4;
        if (fab === 'rolled') P.Avz = Math.max(A - 2 * b * tf + (tw + 2 * r) * tf, hw * tw);
        else P.Avz = hw * tw;
        P.Avy = A - hw * tw;
        break;
      }
      case 'U': {
        const { tw, tf } = d, r = d.r || 0, hw = h - 2 * tf;
        P.It = (2 * b * tf ** 3 + (h - 2 * tf) * tw ** 3) / 3;
        const bs = b - tw / 2, hs = h - tf;
        P.Iw = tf * bs ** 3 * hs ** 2 / 12 * (3 * bs * tf + 2 * hs * tw) / (6 * bs * tf + hs * tw);
        if (fab === 'rolled') P.Avz = Math.max(A - 2 * b * tf + (tw + r) * tf, hw * tw);
        else P.Avz = hw * tw;
        P.Avy = A - hw * tw;
        break;
      }
      case 'T': {
        const { tw, tf } = d, r = d.r || 0;
        P.It = (b * tf ** 3 + (h - tf) * tw ** 3) / 3;
        P.Iw = tf ** 3 * b ** 3 / 144 + tw ** 3 * (h - tf / 2) ** 3 / 36;
        P.Avz = fab === 'rolled' ? A - b * tf + (tw + 2 * r) * tf / 2 : tw * (h - tf / 2);
        P.Avy = b * tf;
        break;
      }
      case 'L': {
        const { t } = d;
        P.It = (b + h - t) * t ** 3 / 3;
        P.Iw = t ** 3 * ((b - t / 2) ** 3 + (h - t / 2) ** 3) / 36;
        P.Avz = h * t; P.Avy = b * t;
        // principal axes
        const m = (Iy + Iz) / 2, q = Math.hypot((Iy - Iz) / 2, Iyz);
        P.Iu = m + q; P.Iv = m - q;
        P.alphaUV = 0.5 * Math.atan2(-2 * Iyz, Iy - Iz) * 180 / Math.PI;
        break;
      }
      case 'RHS': {
        const { t } = d, ro = d.r ?? 0, ri = d.ri ?? Math.max(ro - t, 0);
        const Rc = (ro + ri) / 2;
        const p = 2 * ((b - t) + (h - t)) - 2 * Rc * (4 - Math.PI);
        const Ah = (b - t) * (h - t) - Rc * Rc * (4 - Math.PI);
        P.It = t ** 3 * p / 3 + 4 * Ah * Ah * t / p;
        P.Iw = 0;
        P.Avz = A * h / (b + h); P.Avy = A * b / (b + h);
        break;
      }
      case 'BOX': {
        const { tw, tf } = d, hw = h - 2 * tf;
        const Am = (b - tw) * (h - tf);
        P.It = 4 * Am * Am / (2 * (b - tw) / tf + 2 * (h - tf) / tw);
        P.Iw = 0;
        P.Avz = 2 * hw * tw; P.Avy = A - 2 * hw * tw;
        break;
      }
      default: break;
    }
  }
  P.iy = Math.sqrt(P.Iy / P.A);
  P.iz = Math.sqrt(P.Iz / P.A);
  return P;
}

const DIM_KEYS = ['h', 'b', 'tw', 'tf', 't', 'd', 'r', 'r2', 'ri'];

function defaultFabrication(shape) {
  return (shape === 'I' || shape === 'BOX' || shape === 'T' || shape === 'U') ? 'welded' : 'rolled';
}

/** Convert mm-props to SI section property object. */
function toSI(P) {
  const L = 1e-3;
  const o = {
    A: P.A * L ** 2, Iy: P.Iy * L ** 4, Iz: P.Iz * L ** 4, It: P.It * L ** 4, Iw: P.Iw * L ** 6,
    Wely: P.Wely * L ** 3, Welz: P.Welz * L ** 3, Wply: P.Wply * L ** 3, Wplz: P.Wplz * L ** 3,
    Avy: P.Avy * L ** 2, Avz: P.Avz * L ** 2, iy: P.iy * L, iz: P.iz * L, ymax: P.ymax * L, zmax: P.zmax * L,
    Iyz: P.Iyz * L ** 4, ycg: P.ycg * L, zcg: P.zcg * L, mass: P.A * 1e-6 * 7850,
  };
  if (P.Iu !== undefined) { o.Iu = P.Iu * L ** 4; o.Iv = P.Iv * L ** 4; o.alphaUV = P.alphaUV; }
  return o;
}

function dimsToMM(dims) {
  const d = {};
  for (const [k, v] of Object.entries(dims || {})) {
    if (typeof v !== 'number') continue;
    d[k] = (k === 'slope') ? v : v * 1000;
  }
  return d;
}

/**
 * Compute section properties (SI) from shape + dims (m).
 * opts.fabrication influences shear areas of I/U/T (rolled vs welded formulas).
 */
export function computeSectionProps(shape, dims, opts = {}) {
  if (shape === 'GENERIC') {
    const g = { ...dims };
    const A = g.A || 0;
    const out = {
      A, Iy: g.Iy || 0, Iz: g.Iz || 0, It: g.It || 0, Iw: g.Iw || 0,
      Wely: g.Wely || 0, Welz: g.Welz || 0, Wply: g.Wply || g.Wely || 0, Wplz: g.Wplz || g.Welz || 0,
      Avy: g.Avy || 0, Avz: g.Avz || 0,
      iy: g.iy || (A > 0 ? Math.sqrt((g.Iy || 0) / A) : 0), iz: g.iz || (A > 0 ? Math.sqrt((g.Iz || 0) / A) : 0),
    };
    if (g.ymax) out.ymax = g.ymax;
    if (g.zmax) out.zmax = g.zmax;
    return out;
  }
  const d = dimsToMM(dims);
  checkDims(shape, d);
  return toSI(propsMM(shape, d, opts.fabrication || defaultFabrication(shape)));
}

function paramName(shape, dims) {
  const m = (v) => fmt(v * 1000);
  switch (shape) {
    case 'RECT': return `RECT ${m(dims.b)}x${m(dims.h)}`;
    case 'CIRC': return `CIRC D${m(dims.d)}`;
    case 'CHS': return `CHS ${m(dims.d)}x${m(dims.t)}`;
    case 'RHS': return `RHS ${m(dims.h)}x${m(dims.b)}x${m(dims.t)}`;
    case 'L': return `L ${m(dims.h)}x${m(dims.b)}x${m(dims.t)}`;
    case 'GENERIC': return 'GENERIC';
    default: return `${shape} ${m(dims.h)}x${m(dims.b)}x${m(dims.tw)}x${m(dims.tf)}`;
  }
}

const GENERIC_PROP_KEYS = ['A', 'Iy', 'Iz', 'It', 'Iw', 'Wely', 'Welz', 'Wply', 'Wplz', 'Avy', 'Avz', 'iy', 'iz', 'ymax', 'zmax'];

/**
 * Parametric section (without id). dims in m (SPEC §2.4). For 'GENERIC' the dims object holds the
 * properties themselves (A, Iy, Iz, It, ...) and optionally h/b for drawing.
 * opts: { name, fabrication }
 */
export function makeParametricSection(shape, dims = {}, opts = {}) {
  if (shape === 'GENERIC') {
    const props = computeSectionProps('GENERIC', dims);
    const keepDims = {};
    for (const k of ['h', 'b', 'd']) if (typeof dims[k] === 'number') keepDims[k] = dims[k];
    return {
      name: opts.name || dims.name || 'GENERIC', shape: 'GENERIC', family: 'GENERIC',
      fabrication: opts.fabrication || dims.fabrication || 'rolled', dims: keepDims, ...props,
    };
  }
  const fabrication = opts.fabrication || defaultFabrication(shape);
  const clean = {};
  for (const k of [...DIM_KEYS, 'slope']) if (typeof dims[k] === 'number') clean[k] = dims[k];
  if (shape === 'RHS' && clean.r === undefined) {
    // default corner radii: hot finished (EN 10210) ro = 1.5 t, ri = t; cold formed (EN 10219) ro = 2 t
    if (fabrication === 'cold') {
      const t = clean.t;
      clean.r = (t <= 0.006 ? 2 : t <= 0.010 ? 2.5 : 3) * t; clean.ri = clean.r - t;
    } else { clean.r = 1.5 * clean.t; clean.ri = clean.t; }
  }
  const props = computeSectionProps(shape, clean, { fabrication });
  return {
    name: opts.name || paramName(shape, clean), shape, family: 'PARAM', fabrication,
    dims: clean, ...props,
  };
}

const CACHE = new Map();

/** Library section by name (e.g. 'HEB 200', 'SHS 100x5', 'CHS 168.3x8', 'L 50x5'); null if unknown. */
export function getLibrarySection(name) {
  const e = LIB.get(normKey(name));
  if (!e) return null;
  let s = CACHE.get(e.name);
  if (!s) {
    const dimsSI = {};
    for (const [k, v] of Object.entries(e.dimsMM)) dimsSI[k] = k === 'slope' ? v : Math.round(v * 1e4) / 1e7;
    const props = toSI(propsMM(e.shape, e.dimsMM, e.fabrication));
    s = { name: e.name, shape: e.shape, family: e.family, fabrication: e.fabrication, dims: dimsSI, ...props };
    CACHE.set(e.name, s);
  }
  return JSON.parse(JSON.stringify(s));
}

/**
 * Outline polygon of a section for drawing / 3D extrusion.
 * Returns { outer:[[y,z],...] (CCW), holes:[[[y,z],...]] (CW) } in m, centroid at the origin.
 * opts.arcSegments (per 90°, default 3; 0 = sharp corners), opts.circleSegments (default 32).
 */
export function sectionOutline(section, opts = {}) {
  const seg = opts.arcSegments ?? 3;
  const circN = opts.circleSegments ?? 32;
  let shape = section.shape;
  let d = { ...(section.dims || {}) };
  if (shape === 'GENERIC' || !REQ[shape]) {
    // equivalent rectangle (or given h/b / d)
    if (d.d > 0 && !(d.h > 0)) { shape = 'CIRC'; } else {
      let h = d.h, b = d.b;
      if (!(h > 0 && b > 0)) {
        const A = section.A || 0.01, Iy = section.Iy || A * A / 12;
        h = Math.sqrt(12 * Iy / A); b = A / h;
        if (!(h > 0 && b > 0)) { h = 0.1; b = 0.1; }
      }
      shape = 'RECT'; d = { h, b };
    }
  }
  const dm = dimsToMM(d);
  try { checkDims(shape, dm); } catch (e) { return { outer: [], holes: [] }; }
  if (seg <= 0) { dm.r = 0; dm.r2 = 0; dm.ri = 0; }
  const raw = rawOutline(shape, dm, Math.max(seg, 1), circN);
  const g = regionIntegrals(raw);
  const yc = g.Sz / g.A, zc = g.Sy / g.A;
  const s = shiftOutline(raw, -yc, -zc);
  const toM = (r) => r.map(([y, z]) => [y / 1000, z / 1000]);
  return {
    outer: toM(orientRing(s.outer, true)),
    holes: s.holes.map((h) => toM(orientRing(h, false))),
  };
}

/** List of all library section names. */
export function librarySectionNames() {
  return SECTION_FAMILIES.flatMap((f) => f.names);
}
