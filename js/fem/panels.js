// Load panels (Lastverteilungsflächen): domains of type 'panel' carry no stiffness; their surface loads are
// distributed onto the structural lines in the panel (beams, ribs, trusses, edges of plates/shells/walls).
// Pure module (no DOM). expandLoadPanels() resolves them once, before meshing and analysis: the mesher and
// the FE core only ever see the resulting line loads, never a panel.
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

import { domainFrame, pointInPolygon2D, projectOnSegment2D, raySegment2D } from '../mesh/geom.js';
import { surfaceQ } from './loads.js';
import { msg } from '../core/messages.js';

const inPoly = (q, poly) => pointInPolygon2D(q[0], q[1], poly);

/**
 * Geometry of a panel: local frame, 2D polygon/holes, supporting lines and area samples with their
 * assignments. Returns { ax, o, area, targets:[{ line, a2, b2, L }], samples:[{ p, dA, to:[{ i, t, w }] }] }.
 */
export function panelLayout(model, dom) {
  const nodes = new Map((model.nodes || []).map((n) => [n.id, n]));
  const F = domainFrame(nodes, dom);
  if (!F) return null;
  const P3 = (id) => { const n = nodes.get(id); return n ? [n.x, n.y, n.z] : null; };
  const { poly, holes, area, to2 } = F;
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
    if (!a || !b || !F.containsSegment(a, b)) continue;
    const a2 = to2(a), b2 = to2(b);
    const L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
    if (L > F.tol) targets.push({ line: l.id, a2, b2, L });
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
    const r = targets.map((tg) => projectOnSegment2D(q, tg.a2, tg.b2));
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
        targets.forEach((tg, i) => { const r = raySegment2D(q, dv, tg.a2, tg.b2); if (r && (!b || r.s < b.s)) b = { i, t: r.t, s: r.s }; });
        return b;
      };
      const f = hit(dir), g = hit([-dir[0], -dir[1]]);
      if (f && g) to = [{ i: f.i, t: f.t, w: g.s / (f.s + g.s) }, { i: g.i, t: g.t, w: f.s / (f.s + g.s) }];
      else if (f || g) to = [{ i: (f || g).i, t: (f || g).t, w: 1 }];
    }
    if (!to) to = nearest(q);
    return { p: F.from2(q), dA, to };
  });
  return { ax: { ex: F.ex, ey: F.ey, ez: F.ez }, o: F.o, area, targets, samples };
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

/**
 * Model for meshing and analysis: load panels removed, their surface loads replaced by line loads
 * (lineDist pieces, global X/Y/Z components) on the supporting lines. The input model is not changed.
 * @returns { model, warnings }
 */
export function expandLoadPanels(model) {
  const panels = new Map((model.domains || []).filter((d) => d.type === 'panel').map((d) => [d.id, d]));
  if (!panels.size) return { model, warnings: [] };
  const layouts = new Map();
  const loads = [], warnings = [];
  for (const ld of model.loads || []) {
    const dom = ld.domain != null ? panels.get(ld.domain) : null;
    if (!dom) { loads.push(ld); continue; }
    if (ld.type !== 'surface') { warnings.push(msg('panel.notSurface', { id: ld.id, panel: dom.id })); continue; }
    if (!layouts.has(dom.id)) layouts.set(dom.id, panelLayout(model, dom));
    const layout = layouts.get(dom.id);
    if (!layout || !layout.targets.length) { warnings.push(msg('panel.noLines', { id: ld.id, panel: dom.id })); continue; }
    // global direction of the load: panel normal / local axes, or a global axis (projected onto the plan)
    const { ex, ey, ez } = layout.ax;
    const dir = ld.dir || 'z';
    const G = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[dir];
    const vec = G ? G.map((c) => c * (ld.projected ? Math.abs(ez[0] * G[0] + ez[1] * G[1] + ez[2] * G[2]) : 1)) : { x: ex, y: ey, z: ez }[dir] || ez;
    for (const pc of panelLineLoads(model, layout, (p) => surfaceQ(ld, p))) {
      ['X', 'Y', 'Z'].forEach((d, k) => {
        if (Math.abs(vec[k]) < 1e-12) return;
        const q = pc.q * vec[k];
        loads.push({ id: ld.id, lc: ld.lc, type: 'lineDist', line: pc.line, dir: d, q1: q, q2: q, a: pc.a, b: pc.b, projected: false, panel: dom.id });
      });
    }
  }
  return { model: { ...model, domains: model.domains.filter((d) => !panels.has(d.id)), loads }, warnings };
}
