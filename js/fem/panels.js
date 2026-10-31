// Load panels (Lastverteilungsflächen): domains of type 'panel' carry no stiffness; their surface loads are
// distributed onto the structural lines in the panel (beams, ribs, trusses, edges of plates/shells/walls).
// Pure module (no DOM).
//
// domain = { type: 'panel', nodes, holes?, panel: { dist: 'two' | 'x' | 'y' } }
//  'two'  two-way: every part of the panel goes to the nearest supporting line (tributary areas –
//         rectangles give the classic 45° trapezoid/triangle distribution).
//  'x'/'y' one-way in the panel's local x/y direction: each part goes to the nearest supporting lines on
//         both sides along that direction, split by the lever rule; with only one side it goes there;
//         without any line in that direction it falls back to the nearest line.
// The panel area is sampled on a square grid (≈ 10 000 points, 0.02 … 0.5 m); the sampled area is scaled to the exact
// polygon area so the total load is preserved. Each supporting line receives a piecewise constant line load
// (bins along the line).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Local axes of a polygon (SPEC §2.2 orientation rules). */
export function polygonAxes(pts) {
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  n = norm(n);
  const e = 1e-6;
  if (n[2] < -e || (Math.abs(n[2]) <= e && (n[1] < -e || (Math.abs(n[1]) <= e && n[0] < 0)))) n = n.map((v) => -v);
  const proj = (g) => sub(g, n.map((v) => v * dot(g, n)));
  let ex = proj([1, 0, 0]);
  if (Math.hypot(...ex) < 1e-6) ex = proj([0, 1, 0]);
  ex = norm(ex);
  return { ex, ey: cross(n, ex), ez: n };
}

function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function distSeg2(p, a, b) {
  const d = [b[0] - a[0], b[1] - a[1]], w = [p[0] - a[0], p[1] - a[1]];
  const L2 = d[0] * d[0] + d[1] * d[1];
  const t = L2 > 0 ? Math.max(0, Math.min(1, (w[0] * d[0] + w[1] * d[1]) / L2)) : 0;
  return { d: Math.hypot(w[0] - t * d[0], w[1] - t * d[1]), t };
}
function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}
// ray o + s·d (s > 0) against segment a–b (2D): { s, t } or null
function raySeg(o, d, a, b) {
  const e = [b[0] - a[0], b[1] - a[1]];
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const w = [a[0] - o[0], a[1] - o[1]];
  const s = (w[0] * e[1] - w[1] * e[0]) / den, t = (w[0] * d[1] - w[1] * d[0]) / den;
  return s > 1e-9 && t >= -1e-9 && t <= 1 + 1e-9 ? { s, t: Math.min(1, Math.max(0, t)) } : null;
}

/**
 * Geometry of a panel: local frame, 2D polygon/holes, supporting lines and area samples with their
 * assignments. Returns { ax, o, area, targets:[{ line, a2, b2, L }], samples:[{ p, dA, to:[{ i, t, w }] }] }.
 */
export function panelLayout(model, dom) {
  const nodes = new Map((model.nodes || []).map((n) => [n.id, n]));
  const P3 = (id) => { const n = nodes.get(id); return n ? [n.x, n.y, n.z] : null; };
  const pts = dom.nodes.map(P3);
  if (pts.length < 3 || pts.some((p) => !p)) return null;
  const ax = polygonAxes(pts), o = pts[0];
  const to2 = (p) => { const v = sub(p, o); return [dot(v, ax.ex), dot(v, ax.ey)]; };
  const poly = pts.map(to2);
  const holes = (dom.holes || []).map((h) => h.map(P3).filter(Boolean).map(to2));
  const area = polyArea(poly) - holes.reduce((s, h) => s + polyArea(h), 0);
  let size = 0;
  for (const p of poly) size = Math.max(size, Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]));
  const tol = 1e-3 + 1e-4 * size;
  const insideOrOn = (q) => {
    if (inPoly(q, poly) && !holes.some((h) => inPoly(q, h))) return true;
    for (const ring of [poly, ...holes]) for (let i = 0; i < ring.length; i++) if (distSeg2(q, ring[i], ring[(i + 1) % ring.length]).d <= tol) return true;
    return false;
  };
  // supporting lines: structural (element) or edges of plates/shells/walls, lying in the panel
  const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const domEdges = new Set();
  for (const d of model.domains || []) {
    if (d.type === 'panel') continue;
    for (const ring of [d.nodes, ...(d.holes || [])]) for (let i = 0; i < ring.length; i++) domEdges.add(edgeKey(ring[i], ring[(i + 1) % ring.length]));
  }
  const targets = [];
  for (const l of model.lines || []) {
    const structural = (l.element && !['spring', 'rigid'].includes(l.element.type)) || domEdges.has(edgeKey(l.n1, l.n2));
    if (!structural) continue;
    const a = P3(l.n1), b = P3(l.n2);
    if (!a || !b) continue;
    if (Math.abs(dot(sub(a, o), ax.ez)) > tol * 10 || Math.abs(dot(sub(b, o), ax.ez)) > tol * 10) continue;
    const a2 = to2(a), b2 = to2(b), m2 = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2];
    if (!insideOrOn(a2) || !insideOrOn(b2) || !insideOrOn(m2)) continue;
    const L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
    if (L > tol) targets.push({ line: l.id, a2, b2, L });
  }
  // area samples
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of poly) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  // square grid (≈ 10 000 samples) centred on the bounding box
  const hs = Math.min(0.5, Math.max(0.02, Math.sqrt(Math.max(area, 1e-9) / 10000)));
  const nx = Math.max(1, Math.ceil((maxx - minx) / hs)), ny = Math.max(1, Math.ceil((maxy - miny) / hs));
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const raw = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = cx + (i - (nx - 1) / 2) * hs, y = cy + (j - (ny - 1) / 2) * hs;
      if (!inPoly([x, y], poly) || holes.some((h) => inPoly([x, y], h))) continue;
      raw.push([x, y]);
    }
  }
  const dA = raw.length ? area / raw.length : 0; // scaled so that Σ dA = exact area
  const mode = dom.panel?.dist || 'two';
  const dir = mode === 'x' ? [1, 0] : mode === 'y' ? [0, 1] : null;
  // nearest supporting line; points on a bisector (equal distance) are shared evenly
  const nearest = (q) => {
    const r = targets.map((tg) => distSeg2(q, tg.a2, tg.b2));
    const dmin = Math.min(...r.map((x) => x.d));
    if (!Number.isFinite(dmin)) return [];
    const tie = r.map((x, i) => ({ i, t: x.t, d: x.d })).filter((x) => x.d <= dmin + 1e-9 * (1 + dmin));
    return tie.map((x) => ({ i: x.i, t: x.t, w: 1 / tie.length }));
  };
  const samples = raw.map((q) => {
    let to = null;
    if (dir) {
      const hit = (dv) => {
        let b = null;
        targets.forEach((tg, i) => { const r = raySeg(q, dv, tg.a2, tg.b2); if (r && (!b || r.s < b.s)) b = { i, t: r.t, s: r.s }; });
        return b;
      };
      const f = hit(dir), g = hit([-dir[0], -dir[1]]);
      if (f && g) to = [{ i: f.i, t: f.t, w: g.s / (f.s + g.s) }, { i: g.i, t: g.t, w: f.s / (f.s + g.s) }];
      else if (f || g) to = [{ i: (f || g).i, t: (f || g).t, w: 1 }];
    }
    if (!to) to = nearest(q);
    const p = [o[0] + ax.ex[0] * q[0] + ax.ey[0] * q[1], o[1] + ax.ex[1] * q[0] + ax.ey[1] * q[1], o[2] + ax.ex[2] * q[0] + ax.ey[2] * q[1]];
    return { p, dA, to };
  });
  return { ax, o, area, targets, samples };
}

/**
 * Line loads of one panel load: qAt(p) = surface load intensity (kN/m², signed) at a 3D point.
 * Returns [{ line, a, b, q }] – constant pieces q (kN/m) on the line parameter range a…b (0…1, from n1).
 */
export function panelLineLoads(model, layout, qAt) {
  if (!layout || !layout.targets.length) return [];
  const bins = layout.targets.map((tg) => new Float64Array(Math.max(4, Math.min(40, Math.ceil(tg.L / 0.25)))));
  for (const s of layout.samples) {
    const F = qAt(s.p) * s.dA;
    if (!F) continue;
    for (const a of s.to) {
      const b = bins[a.i];
      b[Math.min(b.length - 1, Math.floor(a.t * b.length))] += F * a.w;
    }
  }
  // the line parameter t was measured from a2 (line.n1) – the same orientation as the model line
  const out = [];
  layout.targets.forEach((tg, i) => {
    const b = bins[i], n = b.length, ds = tg.L / n;
    for (let k = 0; k < n; k++) if (Math.abs(b[k]) > 1e-12) out.push({ line: tg.line, a: k / n, b: (k + 1) / n, q: b[k] / ds });
  });
  return out;
}
