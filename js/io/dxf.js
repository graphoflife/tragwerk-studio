// Minimal DXF import (LINE, LWPOLYLINE, POLYLINE/VERTEX, 3DFACE, POINT) and export (R12 LINE/3DFACE).
import { addNode, addLine, addDomain } from '../core/model.js';

function pairs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  return out;
}

const UNIT_SCALE = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 };

export function importDXF(model, text) {
  const p = pairs(text);
  let scale = 1;
  // header units
  for (let i = 0; i < p.length - 2; i++) {
    if (p[i][0] === 9 && p[i][1] === '$INSUNITS') { scale = UNIT_SCALE[+p[i + 1][1]] ?? 1; break; }
  }
  let start = p.findIndex((x) => x[0] === 2 && x[1] === 'ENTITIES');
  if (start < 0) start = 0;
  const ents = [];
  let cur = null;
  for (let i = start; i < p.length; i++) {
    const [c, v] = p[i];
    if (c === 0) {
      if (cur) ents.push(cur);
      if (v === 'ENDSEC') { cur = null; break; }
      cur = { type: v, g: [] };
    } else if (cur) cur.g.push([c, v]);
  }
  if (cur) ents.push(cur);
  const count = { lines: 0, domains: 0 };
  const P = (x, y, z) => [x * scale, y * scale, (z || 0) * scale];
  const get = (e, code, def = 0) => { const f = e.g.find((x) => x[0] === code); return f ? parseFloat(f[1]) : def; };
  let poly = null;
  for (const e of ents) {
    if (e.type === 'LINE') {
      const a = addNode(model, P(get(e, 10), get(e, 20), get(e, 30)), 1e-6);
      const b = addNode(model, P(get(e, 11), get(e, 21), get(e, 31)), 1e-6);
      if (addLine(model, a, b, null)) count.lines++;
    } else if (e.type === 'POINT') {
      addNode(model, P(get(e, 10), get(e, 20), get(e, 30)), 1e-6);
    } else if (e.type === 'LWPOLYLINE') {
      const elev = get(e, 38, 0);
      const closed = (get(e, 70, 0) & 1) === 1;
      const xs = e.g.filter((x) => x[0] === 10).map((x) => parseFloat(x[1]));
      const ys = e.g.filter((x) => x[0] === 20).map((x) => parseFloat(x[1]));
      const ids = xs.map((x, k) => addNode(model, P(x, ys[k], elev), 1e-6));
      for (let k = 0; k < ids.length - 1; k++) if (addLine(model, ids[k], ids[k + 1], null)) count.lines++;
      if (closed && ids.length > 2 && addLine(model, ids[ids.length - 1], ids[0], null)) count.lines++;
    } else if (e.type === 'POLYLINE') {
      poly = { closed: (get(e, 70, 0) & 1) === 1, ids: [] };
    } else if (e.type === 'VERTEX' && poly) {
      poly.ids.push(addNode(model, P(get(e, 10), get(e, 20), get(e, 30)), 1e-6));
    } else if (e.type === 'SEQEND' && poly) {
      const ids = poly.ids;
      for (let k = 0; k < ids.length - 1; k++) if (addLine(model, ids[k], ids[k + 1], null)) count.lines++;
      if (poly.closed && ids.length > 2 && addLine(model, ids[ids.length - 1], ids[0], null)) count.lines++;
      poly = null;
    } else if (e.type === '3DFACE') {
      const pts = [[10, 20, 30], [11, 21, 31], [12, 22, 32], [13, 23, 33]].map(([a, b, c]) => P(get(e, a), get(e, b), get(e, c)));
      const ids = [];
      for (const q of pts) { const id = addNode(model, q, 1e-6); if (!ids.includes(id)) ids.push(id); }
      if (ids.length >= 3) { addDomain(model, ids, { type: 'shell', material: model.materials.find((m) => m.type === 'concrete')?.id ?? null, thickness: 0.2 }); count.domains++; }
    }
  }
  return count;
}

export function exportDXF(model) {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const f = (v) => (Math.round(v * 1e6) / 1e6).toString();
  for (const l of model.lines) {
    const a = nodes.get(l.n1), b = nodes.get(l.n2);
    if (!a || !b) continue;
    const layer = (l.element?.type || 'GEOMETRY').toUpperCase();
    out.push('0', 'LINE', '8', layer, '10', f(a.x), '20', f(a.y), '30', f(a.z), '11', f(b.x), '21', f(b.y), '31', f(b.z));
  }
  for (const d of model.domains) {
    const pts = d.nodes.map((id) => nodes.get(id));
    if (pts.length === 3 || pts.length === 4) {
      const q = pts.length === 3 ? [...pts, pts[2]] : pts;
      out.push('0', '3DFACE', '8', 'DOMAIN_' + d.type.toUpperCase());
      q.forEach((p, i) => out.push(String(10 + i), f(p.x), String(20 + i), f(p.y), String(30 + i), f(p.z)));
    } else {
      out.push('0', 'POLYLINE', '8', 'DOMAIN_' + d.type.toUpperCase(), '66', '1', '70', '9');
      for (const p of pts) out.push('0', 'VERTEX', '8', 'DOMAIN_' + d.type.toUpperCase(), '10', f(p.x), '20', f(p.y), '30', f(p.z), '70', '32');
      out.push('0', 'SEQEND');
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}
