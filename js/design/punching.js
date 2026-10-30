// Punching shear of slabs at columns and point supports – EN 1992-1-1 6.4 and SIA 262 4.3.6.
// Pure ES module (no DOM).
//
// checkPunching(model, mesh, staticResults, caseKeys, opts?) →
//   { zones: [{ p, r }] (slab shear excluded), items: [{ node, domain, source:'column'|'support', type:'interior'|'edge'|'corner',
//               c1, c2, round, d, a, u, uEff, factor, VEd, caseKey, v, vRd, vRdMax, eta, etaMax,
//               needsReinf, fail, rhoL, perimeter:[[x,y,z]…] }], warnings, code }
//
// Punching nodes: corner nodes of horizontal concrete plate/shell domains with a column (beam/rib/truss line
// not lying in the slab plane) or a node support, unless a beam/rib in the slab plane frames in there
// (then the beam carries the slab: only a shear zone is returned). Nodes on line supports are skipped,
// and so are point supports that are part of a row of supports (another one closer than max(4·d, 2 m)). Column size from a RECT (h × b) or CIRC (d)
// section, otherwise / for supports opts.supportSize (default 0.3 m square) or support.size.
// VEd: per case the force transferred into the columns (Σ N at the column ends, along the slab
// normal) plus the support reaction along the slab normal; the maximum over the cases governs.
// Load inside the control perimeter is not deducted (conservative).
// Position (interior / edge / corner) from the share of the control perimeter lying inside the
// slab (≥ 0.95 interior, ≥ 0.4 edge, else corner); uEff = share · u.
// d = mean effective depth of the two top layers; ρl from the top reinforcement (provided if
// defined, else required from the surface design passed in opts.rc, else 0 → vmin).
//
// EC (EN 1992-1-1:2004+A1:2014): basic control perimeter at a = 2d (rounded corners),
//   vEd = β·VEd/(u1·d), β = 1.15 / 1.4 / 1.5 (6.4.3(6), Fig. 6.21N),
//   vRd,c = CRd,c·k·(100·ρl·fck)^(1/3) ≥ vmin, CRd,c = 0.18/γc, k = 1 + √(200/d) ≤ 2, ρl ≤ 0.02 (6.47),
//   column face: vEd,0 = β·VEd/(u0·d) ≤ vRd,max = 0.4·ν·fcd, ν = 0.6(1 − fck/250) (6.4.5(3)),
//   u0 = column perimeter (interior), c2 + 3d ≤ c2 + 2c1 (edge), 3d ≤ c1 + c2 (corner).
//   Punching reinforcement needed when vEd > vRd,c; slab too thin when vEd > 1.5·vRd,c or vEd,0 > vRd,max.
//   zoneR: radius up to the outer perimeter u_out = β·VEd/(vRd,c·d) (+ d) – the slab shear check is
//   skipped inside (punching governs there).
// SIA 262: control perimeter at dv/2 (rounded), uEff = ke·u with ke = 0.9 / 0.7 / 0.65,
//   VRd,c = kr·τcd·dv·uEff, τcd = 0.3·√fck/γc, kr = 1/(0.45 + 0.18·ψ·d·kg) ≤ 2 (d in mm, kg = 1),
//   ψ = 1.5·(rs/d)·(fsd/Es) (approximation level 1), rs = 0.22·L with L = distance to the nearest
//   other column of the slab (opts.span overrides, default 6 m);
//   VRd,max = 2·VRd,c ≤ 3.5·τcd·dv·uEff (with punching reinforcement).
import { designCode, pos, designContext } from './common.js';
import { concreteParams, surfaceLayout, providedAreas } from './concrete.js';

const ES = 200e6;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const P = (n) => [n.x, n.y, n.z];

function insideLoops(loops, p) {
  let c = false;
  for (const poly of loops) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
  }
  return c;
}

/** Points of a rounded-rectangle (or circular) control perimeter at distance a around the column. */
function perimeterPoints(c1, c2, round, a, n = 72) {
  const pts = [];
  if (round) {
    const r = c1 / 2 + a;
    for (let k = 0; k < n; k++) { const t = (k / n) * 2 * Math.PI; pts.push([r * Math.cos(t), r * Math.sin(t)]); }
    return pts;
  }
  const hx = c1 / 2, hy = c2 / 2;
  const per = 2 * (c1 + c2) + 2 * Math.PI * a;
  for (let k = 0; k < n; k++) {
    let s = (k / n) * per;
    // walk: right side, top-right arc, top, top-left arc, left, bottom-left arc, bottom, bottom-right arc
    const segs = [
      [c2, (u) => [hx + a, -hy + u]],
      [Math.PI * a / 2, (u) => { const t = u / a; return [hx + a * Math.cos(t), hy + a * Math.sin(t)]; }],
      [c1, (u) => [hx - u, hy + a]],
      [Math.PI * a / 2, (u) => { const t = Math.PI / 2 + u / a; return [-hx + a * Math.cos(t), hy + a * Math.sin(t)]; }],
      [c2, (u) => [-hx - a, hy - u]],
      [Math.PI * a / 2, (u) => { const t = Math.PI + u / a; return [-hx + a * Math.cos(t), -hy + a * Math.sin(t)]; }],
      [c1, (u) => [-hx + u, -hy - a]],
      [Math.PI * a / 2, (u) => { const t = 1.5 * Math.PI + u / a; return [hx + a * Math.cos(t), -hy + a * Math.sin(t)]; }],
    ];
    for (let i = 0; i < segs.length; i++) {
      const [l, f] = segs[i];
      if (s <= l || i === segs.length - 1) { pts.push(f(Math.min(s, l))); break; }
      s -= l;
    }
  }
  return pts;
}

export function checkPunching(model, mesh, staticResults, caseKeys, opts = {}) {
  opts = opts || {};
  const code = designCode(model, opts);
  const warnings = [];
  const out = { items: [], zones: [], warnings, code };
  try {
    const ctx = designContext(model, mesh, staticResults, caseKeys, warnings, 'shells');
    const shells = mesh?.shells || [];
    if (!shells.length || !ctx.keys.length) return out;
    const X = mesh.nodes;
    const meshPos = (i) => [X[3 * i], X[3 * i + 1], X[3 * i + 2]];
    const modelToMesh = new Map();
    if (mesh.modelNodeToMesh) for (const [id, i] of Object.entries(mesh.modelNodeToMesh)) modelToMesh.set(Number(id), i);
    else if (mesh.nodeModelId) Array.from(mesh.nodeModelId).forEach((id, i) => { if (id > 0) modelToMesh.set(Number(id), i); });
    // slab domains: concrete plate/shell with their mesh corner nodes
    const slabs = [];
    const byDom = new Map();
    shells.forEach((s, e) => { if (s) { const id = Number(s.domain); if (!byDom.has(id)) byDom.set(id, []); byDom.get(id).push(e); } });
    for (const dom of model.domains || []) {
      const elems = byDom.get(Number(dom.id));
      if (!elems?.length) continue;
      const sh = shells[elems[0]];
      const mat = ctx.materials.get(Number(sh.material ?? dom.material));
      if (!mat || mat.type !== 'concrete' || sh.type === 'membrane' || !sh.ez) continue;
      const t = pos(sh.thickness, pos(dom.thickness, 0));
      const L = surfaceLayout(dom.rc, t);
      const Pc = concreteParams(mat, L.fyk, code, opts);
      if (!Pc) continue;
      const o = P(ctx.nodes.get(dom.nodes[0]));
      const to2 = (p) => { const v = sub(p, o); return [dot(v, sh.ex), dot(v, sh.ey)]; };
      const loops = [dom.nodes, ...(dom.holes || [])].map((lp) => lp.map((id) => to2(P(ctx.nodes.get(id)))));
      const corners = new Map(); // mesh node → [corner index e*4+c]
      for (const e of elems) shells[e].nodes.forEach((nd, c) => { if (!corners.has(nd)) corners.set(nd, []); corners.get(nd).push(e * 4 + c); });
      slabs.push({ dom, sh, t, L, P: Pc, o, to2, loops, corners, prov: dom.rcProv ? providedAreas(dom.rcProv) : null });
    }
    if (!slabs.length) return out;
    // column lines per model node
    const segs = ctx.segs;
    const cols = new Map();
    for (const l of model.lines || []) {
      if (!l.element || !['beam', 'rib', 'truss'].includes(l.element.type)) continue;
      for (const end of ['n1', 'n2']) {
        if (!cols.has(l[end])) cols.set(l[end], []);
        cols.get(l[end]).push({ line: l, end });
      }
    }
    const supports = new Map();
    for (const s of model.supports || []) if (s.type === 'node') supports.set(Number(s.node), s);
    const supPos = [...supports.keys()].map((id) => [id, ctx.nodes.get(id)]).filter(([, nd]) => nd).map(([id, nd]) => [id, P(nd)]);
    // nodes on line supports (walls, edge supports) are not punching locations
    const onLineSup = new Set();
    for (const s of model.supports || []) {
      if (s.type !== 'line') continue;
      const l = (model.lines || []).find((x) => x.id === s.line);
      if (l) { onLineSup.add(l.n1); onLineSup.add(l.n2); }
    }
    // candidate nodes
    const cands = [];
    for (const n of model.nodes || []) {
      const mi = modelToMesh.get(Number(n.id));
      if (mi == null) continue;
      // horizontal slabs only (flat slabs on columns); curved/inclined shells are not checked
      const slab = slabs.find((s) => s.corners.has(mi) && Math.abs(s.sh.ez[2]) >= 0.98);
      if (!slab || onLineSup.has(n.id)) continue;
      const ez = slab.sh.ez;
      const colLines = (cols.get(n.id) || []).filter(({ line }) => {
        const a = ctx.nodes.get(line.n1), b = ctx.nodes.get(line.n2);
        const v = sub(P(b), P(a)), l = len(v);
        return l > 0 && Math.abs(dot(v, ez)) / l > 0.7;
      });
      const sup = supports.get(Number(n.id));
      if (!colLines.length && !sup) continue;
      // a beam/rib in the slab plane carries the slab into the column → no punching, only a shear zone
      const beamInPlane = (cols.get(n.id) || []).some(({ line }) => {
        if (!['beam', 'rib'].includes(line.element.type)) return false;
        const a = ctx.nodes.get(line.n1), b = ctx.nodes.get(line.n2);
        const v = sub(P(b), P(a)), l = len(v);
        return l > 0 && Math.abs(dot(v, ez)) / l < 0.3;
      });
      // column size
      let c1 = 0, c2 = 0, round = false;
      for (const { line } of colLines) {
        const sec = ctx.sections.get(Number(line.element.section));
        const dm = sec?.dims || {};
        if (sec?.shape === 'CIRC' && dm.d > 0) { c1 = c2 = Math.max(c1, dm.d); round = true; }
        else if (dm.h > 0 && dm.b > 0) { c1 = Math.max(c1, dm.h); c2 = Math.max(c2, dm.b); }
      }
      if (!(c1 > 0)) { const sz = pos(sup?.size, pos(opts.supportSize, 0.3)); c1 = c2 = sz; }
      if (beamInPlane) {
        const d0 = (slab.L.d.xt + slab.L.d.yt) / 2;
        out.zones.push({ p: meshPos(mi), r: Math.max(c1, c2) / Math.SQRT2 + 2 * d0 });
        continue;
      }
      cands.push({ n, mi, slab, colLines, sup, c1, c2, round });
    }
    for (const cd of cands) {
      const { n, mi, slab, colLines, sup, c1, c2, round } = cd;
      const dRow = Math.max(2, 4 * (slab.L.d.xt + slab.L.d.yt) / 2);
      if (!colLines.length && supPos.some(([id, p]) => id !== n.id && len(sub(p, P(n))) < Math.max(dRow, c1 + 0.05))) continue;
      const ez = slab.sh.ez, P0 = slab.P, Lay = slab.L;
      const d = (Lay.d.xt + Lay.d.yt) / 2;
      if (!(d > 0)) continue;
      // design force over the cases
      let VEd = 0, caseKey = null;
      for (const key of ctx.keys) {
        const res = ctx.cases[key];
        let F = 0;
        for (const { line, end } of colLines) {
          for (const sg of segs.get(Number(line.id)) || []) {
            const b = mesh.beams[sg.i], r = res.beams?.[sg.i];
            if (!b || !r?.N) continue;
            if (end === 'n1' && b.n1 === mi) F -= r.N[0] * dot(b.ex, ez);
            if (end === 'n2' && b.n2 === mi) F += r.N[r.N.length - 1] * dot(b.ex, ez);
          }
        }
        if (sup && res.reac) F -= dot([res.reac[6 * mi], res.reac[6 * mi + 1], res.reac[6 * mi + 2]], ez);
        if (Math.abs(F) > VEd) { VEd = Math.abs(F); caseKey = key; }
      }
      if (!(VEd > 1e-6)) continue;
      // control perimeter and the share inside the slab (all coplanar concrete slabs)
      const a = code === 'SIA' ? d / 2 : 2 * d;
      const pos3 = meshPos(mi);
      const ex = slab.sh.ex, ey = slab.sh.ey;
      const pts2 = perimeterPoints(c1, c2, round, a);
      const coplanar = slabs.filter((s) => Math.abs(dot(sub(pos3, s.o), s.sh.ez)) < 1e-3 + 0.01 * s.t && Math.abs(dot(s.sh.ez, ez)) > 0.99);
      const pts3 = pts2.map(([u, v]) => [pos3[0] + ex[0] * u + ey[0] * v, pos3[1] + ex[1] * u + ey[1] * v, pos3[2] + ex[2] * u + ey[2] * v]);
      const inFlags = pts3.map((p) => coplanar.some((s) => insideLoops(s.loops, s.to2(p))));
      const share = inFlags.filter(Boolean).length / pts3.length;
      if (share < 0.05) continue;
      const type = share >= 0.95 ? 'interior' : share >= 0.4 ? 'edge' : 'corner';
      const u = round ? Math.PI * (c1 + 2 * a) : 2 * (c1 + c2) + 2 * Math.PI * a;
      // reinforcement ratio of the top layers at the node
      let ax = 0, ay = 0;
      if (opts.rc?.asCorner) for (const k of slab.corners.get(mi) || []) { ax = Math.max(ax, opts.rc.asCorner[k * 4 + 2]); ay = Math.max(ay, opts.rc.asCorner[k * 4 + 3]); }
      if (slab.prov) { ax = Math.max(ax, slab.prov[2]); ay = Math.max(ay, slab.prov[3]); }
      const rhoL = Math.min(0.02, Math.sqrt((ax / Lay.d.xt) * (ay / Lay.d.yt)) || 0);
      const it = {
        node: n.id, domain: slab.dom.id, source: colLines.length ? 'column' : 'support', type,
        c1, c2, round, d, a, u, VEd, caseKey, rhoL, share,
        perimeter: pts3.filter((_, k) => inFlags[k] || share >= 0.95),
      };
      if (code === 'SIA') {
        const ke = { interior: 0.9, edge: 0.7, corner: 0.65 }[type];
        const tcd = 0.3 * Math.sqrt(P0.fckM) / P0.gc * 1000; // kN/m²
        let span = pos(opts.span, 0);
        if (!span) {
          let best = Infinity;
          for (const o of cands) if (o !== cd && o.slab === slab) best = Math.min(best, len(sub(meshPos(o.mi), pos3)));
          span = Number.isFinite(best) ? best : 6;
        }
        const rs = 0.22 * span;
        const psi = 1.5 * (rs / d) * (P0.fyd / ES);
        const kr = Math.min(2, 1 / (0.45 + 0.18 * psi * d * 1000));
        const uEff = ke * u;
        const VRd = kr * tcd * d * uEff;
        const VRdMax = Math.min(2 * VRd, 3.5 * tcd * d * uEff);
        Object.assign(it, { factor: ke, uEff, kr, psi, rs, v: VEd, vRd: VRd, vRdMax: VRdMax, eta: VEd / VRd, etaMax: VEd / VRdMax, ref: 'SIA 262 4.3.6' });
      } else {
        const beta = { interior: 1.15, edge: 1.4, corner: 1.5 }[type];
        const uEff = type === 'interior' ? u : share * u;
        const dmm = d * 1000;
        const k = Math.min(2, 1 + Math.sqrt(200 / dmm));
        const vmin = 0.035 * k ** 1.5 * Math.sqrt(P0.fckM);
        const vRdc = Math.max(0.18 / P0.gc * k * Math.cbrt(100 * rhoL * P0.fckM), vmin) * 1000; // kN/m²
        const v = beta * VEd / (uEff * d);
        const nu = 0.6 * (1 - P0.fckM / 250);
        const u0 = round ? Math.PI * c1 : type === 'interior' ? 2 * (c1 + c2) : type === 'edge' ? Math.min(c2 + 3 * d, c2 + 2 * c1) : Math.min(3 * d, c1 + c2);
        const v0 = beta * VEd / (u0 * d);
        const vRdMax = 0.4 * nu * P0.fcd;
        Object.assign(it, { factor: beta, uEff, u0, v, v0, vRd: vRdc, vRdMax, eta: v / vRdc, etaMax: Math.max(v0 / vRdMax, v / (1.5 * vRdc)), ref: 'EN 1992-1-1 6.4' });
      }
      // zone governed by punching: up to the outer perimeter u_out where vEd = vRd,c (EC 6.4.5(4))
      const uCol = round ? Math.PI * c1 : 2 * (c1 + c2);
      const uOut = code === 'SIA' ? VEd / (it.kr * 0.3 * Math.sqrt(P0.fckM) / P0.gc * 1000 * d * it.factor) : it.factor * VEd / (it.vRd * d) / (type === 'interior' ? 1 : share);
      it.rOut = Math.max(0, (uOut - uCol) / (2 * Math.PI));
      it.center = pos3;
      it.zoneR = Math.min(Math.max(Math.max(c1, c2) / Math.SQRT2 + 2 * d, it.rOut + d), 4);
      it.needsReinf = it.eta > 1;
      it.fail = it.etaMax > 1;
      out.items.push(it);
      out.zones.push({ p: it.center, r: it.zoneR });
    }
  } catch (e) {
    warnings.push(`Punching check aborted: ${e && e.message}`);
  }
  return out;
}
