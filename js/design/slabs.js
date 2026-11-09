// Reinforced-concrete slabs: surface design and punching as one design step. Pure ES module (no DOM).
//
// The order is a design rule, so it lives here and not in the UI:
//   1. punching locations with their design forces (geometry + VEd, independent of the reinforcement),
//   2. surface design – the slab shear check is skipped where other checks govern: inside the punching
//      zones and next to beams/ribs (beam shear, within half the web width + d of the axis),
//   3. punching checks with the top reinforcement from step 2 (ρl).
//
// designRCSlabs(model, mesh, staticResults, caseKeys, opts?) → { rc, punching: { items, zones, warnings, code } }
import { designRCSurfaces } from './concrete.js';
import { punchingSetup, punchingZones, punchingChecks } from './punching.js';

/** Beams and ribs as shear zones for the slab check: axis a–b and half the web width hb. */
export function beamShearZones(model) {
  const nodes = new Map((model.nodes || []).map((n) => [n.id, n]));
  const sections = new Map((model.sections || []).map((s) => [s.id, s]));
  const out = [];
  for (const l of model.lines || []) {
    if (!l.element || !['beam', 'rib'].includes(l.element.type)) continue;
    const a = nodes.get(l.n1), b = nodes.get(l.n2), dims = sections.get(l.element.section)?.dims || {};
    if (a && b) out.push({ a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], hb: (dims.b || dims.d || 0.3) / 2 });
  }
  return out;
}

export function designRCSlabs(model, mesh, staticResults, caseKeys, opts = {}) {
  const pun = punchingSetup(model, mesh, staticResults, caseKeys, opts);
  const zones = punchingZones(pun);
  const rc = designRCSurfaces(model, mesh, staticResults, caseKeys, { ...opts, shearExclude: zones, shearExcludeSegs: beamShearZones(model) });
  return { rc, punching: { items: punchingChecks(pun, rc), zones, warnings: pun.warnings, code: pun.code } };
}
