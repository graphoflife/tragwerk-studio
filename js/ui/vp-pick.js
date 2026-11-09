// Picking and snapping in the 3D view: hit tests for nodes, lines, support/load glyphs and surfaces, box
// selection, and the snap rules behind the point input (nodes, midpoints, lines, surfaces, grid, ortho).
// The methods are mixed into Viewport (viewport.js) and use its camera, ray, model and glyph picks.
import * as THREE from 'three';
import { V, P } from '../core/model.js';
import { PLANES } from './vp-util.js';
import { t } from '../i18n.js';

export class Picking {
  pick(x, y, filter = { nodes: true, lines: true, domains: true }) {
    const { model, idx, view } = this.store;
    const hidden = view.hidden;
    let best = null;
    if (filter.nodes) {
      let bd = 9;
      for (const n of model.nodes) {
        if (hidden.nodes.has(n.id)) continue;
        const s = this.project([n.x, n.y, n.z]);
        if (!s.ok) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) { bd = d; best = { kind: 'node', id: n.id, p: [n.x, n.y, n.z], z: s.z }; }
      }
      if (best) return best;
    }
    // lines and support/load glyphs: the closest one within the tolerance wins
    let bd = 7;
    if (filter.lines) {
      const proj = new Map();
      const pj = (id) => { if (!proj.has(id)) { const n = idx.nodes.get(id); proj.set(id, this.project([n.x, n.y, n.z])); } return proj.get(id); };
      for (const l of model.lines) {
        if (hidden.lines.has(l.id)) continue;
        const a = pj(l.n1), b = pj(l.n2);
        if (!a.ok || !b.ok) continue;
        const r = distToSeg(x, y, a, b);
        if (r.d < bd) {
          bd = r.d;
          const pa = P(idx.nodes.get(l.n1)), pb = P(idx.nodes.get(l.n2));
          best = { kind: 'line', id: l.id, t: r.t, p: V.lerp(pa, pb, r.t) };
        }
      }
    }
    for (const g of this.glyphPicks || []) {
      if (!filter[g.kind + 's']) continue;
      for (const [a3, b3] of g.segs) {
        const a = this.project(a3), b = this.project(b3);
        if (!a.ok || !b.ok) continue;
        const r = distToSeg(x, y, a, b);
        if (r.d < bd) { bd = r.d; best = { kind: g.kind, id: g.id, p: V.lerp(a3, b3, r.t) }; }
      }
      for (const p3 of g.pts) {
        const s2 = this.project(p3);
        if (!s2.ok) continue;
        const d = Math.hypot(s2.x - x, s2.y - y);
        if (d < Math.max(bd, 9) && d < bd + 3) { bd = d; best = { kind: g.kind, id: g.id, p: p3 }; }
      }
    }
    if (best) return best;
    if (filter.domains && this.domainMesh) {
      this.ray(x, y);
      const hits = this.raycaster.intersectObject(this.domainMesh, false);
      if (hits.length) {
        const fi = hits[0].faceIndex;
        const p = hits[0].point;
        return { kind: 'domain', id: this.domainFaceIds[fi], p: [p.x, p.y, p.z] };
      }
    }
    return null;
  }

  boxSelect(x0, y0, x1, y1, crossing, filter) {
    const { model, idx, view } = this.store;
    const hidden = view.hidden;
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    const inside = (s) => s.ok && s.x >= minx && s.x <= maxx && s.y >= miny && s.y <= maxy;
    const proj = new Map();
    for (const n of model.nodes) proj.set(n.id, this.project([n.x, n.y, n.z]));
    const out = { nodes: [], lines: [], domains: [], supports: [], loads: [] };
    if (filter.nodes) for (const n of model.nodes) if (!hidden.nodes.has(n.id) && inside(proj.get(n.id))) out.nodes.push(n.id);
    if (filter.lines) {
      for (const l of model.lines) {
        if (hidden.lines.has(l.id)) continue;
        const a = proj.get(l.n1), b = proj.get(l.n2);
        const ia = inside(a), ib = inside(b);
        if ((ia && ib) || (crossing && (ia || ib || segRect(a, b, minx, miny, maxx, maxy)))) out.lines.push(l.id);
      }
    }
    if (filter.domains) {
      for (const d of model.domains) {
        if (hidden.domains.has(d.id)) continue;
        const ins = d.nodes.map((id) => inside(proj.get(id)));
        if (ins.every(Boolean) || (crossing && ins.some(Boolean))) out.domains.push(d.id);
      }
    }
    for (const g of this.glyphPicks || []) {
      if (!filter[g.kind + 's']) continue;
      const pts = [...g.pts, ...g.segs.flat()].map((p) => this.project(p));
      if (!pts.length) continue;
      const ins = pts.map(inside);
      if (ins.every(Boolean) || (crossing && ins.some(Boolean))) out[g.kind + 's'].push(g.id);
    }
    return out;
  }

  /* ---------------- workplane & snapping ---------------- */
  workplanePoint(x, y) {
    const wp = this.store.view.workplane, pl = PLANES[wp.plane];
    const ray = this.ray(x, y);
    const n = new THREE.Vector3(...pl.n);
    const plane = new THREE.Plane(n, -wp.offset);
    const out = new THREE.Vector3();
    if (!ray.intersectPlane(plane, out)) return null;
    return [out.x, out.y, out.z];
  }

  // Object snaps (node, line midpoint, nearest point on line) take priority over workplane snaps
  // (grid, free). Returns { p, kind, obj, label, node?, line? }.
  snap(x, y, { from = null, ortho = false, allowMid = true, surface = false } = {}) {
    const v = this.store.view;
    const { model, idx } = this.store;
    if (v.snapNodes) {
      const hit = this.pick(x, y, { nodes: true });
      if (hit) return { p: hit.p, kind: 'node', node: hit.id, obj: true, label: t('Knoten {id}', { id: hit.id }) };
    }
    if (v.snapMid && allowMid) {
      let bd = 10, best = null;
      for (const l of model.lines) {
        if (v.hidden.lines.has(l.id)) continue;
        const a = idx.nodes.get(l.n1), b = idx.nodes.get(l.n2);
        const m = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
        const s = this.project(m);
        if (!s.ok) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) { bd = d; best = { p: m, kind: 'mid', line: l.id, obj: true, label: t('Mitte Linie {id}', { id: l.id }) }; }
      }
      if (best) return best;
    }
    if (v.snapLine) {
      const hit = this.pick(x, y, { lines: true });
      if (hit) return { p: hit.p.map((c) => Math.round(c * 1e6) / 1e6), kind: 'line', line: hit.id, obj: true, label: t('Auf Linie {id}', { id: hit.id }) };
    }
    // points on surfaces (section lines): hit point on a domain, on horizontal ones rounded to the grid
    if (surface && this.domainMesh) {
      this.ray(x, y);
      const hits = this.raycaster.intersectObject(this.domainMesh, false);
      if (hits.length) {
        const q = hits[0].point, id = this.domainFaceIds[hits[0].faceIndex];
        let p = [q.x, q.y, q.z];
        const d = idx.domains.get(id);
        const zs = d ? d.nodes.map((n) => idx.nodes.get(n)?.z ?? 0) : [];
        if (v.grid.snap && zs.length && Math.max(...zs) - Math.min(...zs) < 1e-6) {
          const stp = v.grid.step || 1;
          p = [Math.round(p[0] / stp) * stp, Math.round(p[1] / stp) * stp, zs[0]];
        }
        if ((ortho || v.ortho) && from) {
          const dd = V.sub(p, from);
          const k = [0, 1, 2].reduce((a, b) => (Math.abs(dd[b]) > Math.abs(dd[a]) ? b : a), 0);
          const pp = [...from]; pp[k] += dd[k]; p = pp;
        }
        return { p: p.map((c) => Math.round(c * 1e6) / 1e6), kind: 'surface', domain: id, obj: true, label: t('Auf Fläche {id}', { id }) };
      }
    }
    let p = this.workplanePoint(x, y);
    if (!p) return null;
    const wp = v.workplane, pl = PLANES[wp.plane];
    let kind = 'free';
    if (v.grid.snap) {
      const st = v.grid.step || 1;
      let [u, w] = pl.unmap(p);
      u = Math.round(u / st) * st; w = Math.round(w / st) * st;
      p = pl.map(u, w, wp.offset);
      kind = 'grid';
    }
    if ((ortho || v.ortho) && from) {
      const d = V.sub(p, from);
      const k = [0, 1, 2].reduce((a, b) => (Math.abs(d[b]) > Math.abs(d[a]) ? b : a), 0);
      p = [...from]; p[k] += d[k];
    }
    return { p: p.map((c) => Math.round(c * 1e6) / 1e6), kind, obj: false, label: kind === 'grid' ? t('Raster') : t('Arbeitsebene {p}', { p: wp.plane }) };
  }

  // Point on the line (p0 + s·u) closest to the mouse ray – used for axis constraints
  closestOnLine(x, y, p0, u) {
    const ray = this.ray(x, y);
    const o = [ray.origin.x, ray.origin.y, ray.origin.z], d = [ray.direction.x, ray.direction.y, ray.direction.z];
    const w0 = V.sub(o, p0);
    const a = V.dot(d, d), b = V.dot(d, u), c = V.dot(u, u), dd = V.dot(d, w0), e = V.dot(u, w0);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-9) return null;
    const s = (a * e - b * dd) / den;
    return V.add(p0, V.mul(u, s));
  }

  // Intersection of the mouse ray with the plane through p0 with normal n
  rayPlane(x, y, p0, n) {
    const ray = this.ray(x, y);
    const out = new THREE.Vector3();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...n), new THREE.Vector3(...p0));
    return ray.intersectPlane(plane, out) ? [out.x, out.y, out.z] : null;
  }

  /* ---------------- camera views ---------------- */
}

function distToSeg(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(a.x + t * dx - x, a.y + t * dy - y), t };
}

function segRect(a, b, x0, y0, x1, y1) {
  const edges = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
  return edges.some(([ax, ay, bx, by]) => segInter(a.x, a.y, b.x, b.y, ax, ay, bx, by));
}
function segInter(p0x, p0y, p1x, p1y, q0x, q0y, q1x, q1y) {
  const d = (p1x - p0x) * (q1y - q0y) - (p1y - p0y) * (q1x - q0x);
  if (Math.abs(d) < 1e-12) return false;
  const s = ((q0x - p0x) * (q1y - q0y) - (q0y - p0y) * (q1x - q0x)) / d;
  const t = ((q0x - p0x) * (p1y - p0y) - (q0y - p0y) * (p1x - p0x)) / d;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}
