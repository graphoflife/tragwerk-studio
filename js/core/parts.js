// Parts (Teile) and storeys (Geschosse) – visibility groups as in AxisVM. Pure module (no DOM).
//
// model.parts   = [{ id, name, nodes:[ids], lines:[ids], domains:[ids] }]   user-defined parts
// model.storeys = [{ id, z, name? }]                                       storey levels (sorted by z)
// Logical parts are derived on the fly: storeys, materials, cross-sections and element types.
// Part keys: 'u:<id>' user part, 'st:<id>' storey, 'mat:<id>', 'sec:<id>', 'type:<beam|truss|…|geom|plate|…>'.
//
// Visibility: an element is visible when it belongs to at least one active part (union); with no
// active part everything is visible. Nodes are visible when they belong to a visible line/domain or
// are listed in an active part (user part, or a free node inside an active storey band).
//
// Storey membership (AxisVM style): a storey at level z_i contains everything whose highest point
// lies in (z_{i−1}, z_i] – the slab at z_i plus the columns and walls below it; the lowest level
// collects everything at or below it (foundation).

export const STOREY_TOL = 0.01;

const nodeMap = (model) => new Map((model.nodes || []).map((n) => [n.id, n]));

/** Storey levels found in the model: horizontal domains, column ends and the lowest node level. */
export function detectStoreys(model, tol = 0.05) {
  const nodes = nodeMap(model);
  const zs = [];
  for (const d of model.domains || []) {
    const z = d.nodes.map((id) => nodes.get(id)?.z).filter(Number.isFinite);
    if (z.length && Math.max(...z) - Math.min(...z) < 1e-3) zs.push(z[0]);
  }
  for (const l of model.lines || []) {
    if (!l.element) continue;
    const a = nodes.get(l.n1), b = nodes.get(l.n2);
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (L > 0 && Math.abs(b.z - a.z) > 0.7 * L) zs.push(a.z, b.z); // columns
  }
  const all = (model.nodes || []).map((n) => n.z);
  if (all.length) zs.push(Math.min(...all));
  zs.sort((a, b) => a - b);
  const out = [];
  for (const z of zs) if (!out.length || z - out[out.length - 1] > tol) out.push(Math.round(z * 1e4) / 1e4);
  return out;
}

/** Index of the storey containing an element whose highest point is zTop (−1: above the top level). */
export function storeyIndex(levels, zTop, tol = STOREY_TOL) {
  for (let i = 0; i < levels.length; i++) if (zTop <= levels[i] + tol) return i;
  return -1;
}

const LINE_TYPES = ['beam', 'truss', 'rib', 'spring', 'rigid'];
const DOMAIN_TYPES = ['plate', 'shell', 'membrane'];

/** All parts of a model: user parts and logical parts (storeys, materials, sections, element types). */
export function listParts(model) {
  const out = [];
  for (const p of model.parts || []) out.push({ key: 'u:' + p.id, group: 'user', id: p.id, name: p.name });
  for (const [i, s] of (model.storeys || []).entries()) out.push({ key: 'st:' + s.id, group: 'storey', id: s.id, name: s.name || null, z: s.z, index: i });
  const usedMat = new Set(), usedSec = new Set(), types = new Set();
  for (const l of model.lines || []) {
    if (l.element) { usedMat.add(l.element.material); if (l.element.section != null) usedSec.add(l.element.section); types.add(l.element.type); } else types.add('geom');
  }
  for (const d of model.domains || []) { usedMat.add(d.material); types.add(d.type); }
  for (const m of model.materials || []) if (usedMat.has(m.id)) out.push({ key: 'mat:' + m.id, group: 'material', id: m.id, name: m.name });
  for (const s of model.sections || []) if (usedSec.has(s.id)) out.push({ key: 'sec:' + s.id, group: 'section', id: s.id, name: s.name });
  for (const tp of [...LINE_TYPES, 'geom', ...DOMAIN_TYPES]) if (types.has(tp)) out.push({ key: 'type:' + tp, group: 'type', id: tp, name: tp });
  return out;
}

/** Members of one part: { nodes:Set, lines:Set, domains:Set } (nodes incl. those of its lines/domains). */
export function partMembers(model, key) {
  const res = { nodes: new Set(), lines: new Set(), domains: new Set() };
  const [kind, raw] = String(key).split(':');
  const id = Number(raw);
  const nodes = nodeMap(model);
  const addLine = (l) => { res.lines.add(l.id); res.nodes.add(l.n1); res.nodes.add(l.n2); };
  const addDomain = (d) => { res.domains.add(d.id); d.nodes.forEach((n) => res.nodes.add(n)); (d.holes || []).forEach((h) => h.forEach((n) => res.nodes.add(n))); };
  if (kind === 'u') {
    const p = (model.parts || []).find((x) => x.id === id);
    if (!p) return res;
    const ls = new Set(p.lines || []), ds = new Set(p.domains || []);
    for (const n of p.nodes || []) res.nodes.add(n);
    for (const l of model.lines || []) if (ls.has(l.id)) addLine(l);
    for (const d of model.domains || []) if (ds.has(d.id)) addDomain(d);
  } else if (kind === 'st') {
    const levels = (model.storeys || []).map((s) => s.z);
    const i = (model.storeys || []).findIndex((s) => s.id === id);
    if (i < 0) return res;
    const zOf = (ids) => Math.max(...ids.map((n) => nodes.get(n)?.z ?? -Infinity));
    for (const l of model.lines || []) if (storeyIndex(levels, zOf([l.n1, l.n2])) === i) addLine(l);
    for (const d of model.domains || []) if (storeyIndex(levels, zOf(d.nodes)) === i) addDomain(d);
    for (const n of model.nodes || []) if (storeyIndex(levels, n.z) === i) res.nodes.add(n.id);
  } else if (kind === 'mat') {
    for (const l of model.lines || []) if (l.element?.material === id) addLine(l);
    for (const d of model.domains || []) if (d.material === id) addDomain(d);
  } else if (kind === 'sec') {
    for (const l of model.lines || []) if (l.element?.section === id) addLine(l);
  } else if (kind === 'type') {
    for (const l of model.lines || []) if ((l.element?.type || 'geom') === raw) addLine(l);
    for (const d of model.domains || []) if (d.type === raw) addDomain(d);
  }
  return res;
}

/** Hidden sets for the active part keys, or null when no part is active (everything visible). */
export function partsHidden(model, activeKeys) {
  const keys = [...(activeKeys || [])];
  if (!keys.length) return null;
  const vis = { nodes: new Set(), lines: new Set(), domains: new Set() };
  for (const k of keys) {
    const m = partMembers(model, k);
    for (const kind of ['nodes', 'lines', 'domains']) m[kind].forEach((x) => vis[kind].add(x));
  }
  return {
    nodes: new Set((model.nodes || []).filter((n) => !vis.nodes.has(n.id)).map((n) => n.id)),
    lines: new Set((model.lines || []).filter((l) => !vis.lines.has(l.id)).map((l) => l.id)),
    domains: new Set((model.domains || []).filter((d) => !vis.domains.has(d.id)).map((d) => d.id)),
  };
}

/** Counts of a part for the UI: { nodes, lines, domains } */
export function partCounts(model, key) {
  const m = partMembers(model, key);
  return { nodes: m.nodes.size, lines: m.lines.size, domains: m.domains.size };
}
