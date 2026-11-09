// Result views: one entry per kind of result display (AxisVM: the result shown in the viewport, the
// values at the cursor, the detail on double-click and the section-line diagrams belong together).
//   build(vp, group, mesh, comp) → legend info   draws the result into the viewport group
//   probe(st, hit) → [[label, value], …] | null   values at the cursor (first row = heading)
//   open(app, hit) → true if handled               detail window on double-click
//   section(st, comp) → { f(e, k), q, name, integralQ, down } | null   shell-corner values for section lines
// The current view follows from the result kind and component. Probe and open fall back to the other
// views of the same family, so an RC beam can be probed or opened while the slab reinforcement is shown.
import { componentDef, DESIGN_COMPONENTS } from './results-data.js';
import { meshVisibility } from './vp-res-draw.js';
import { drawSectionLines } from './vp-res-sections.js';
import { STATIC, MODE } from './vp-res-static.js';
import { UTIL, SLAB_LAYER, SLAB_SHEAR, PUNCHING, RC_BEAM, RC_COLUMN } from './vp-res-design.js';

// design component kind (results-data DESIGN_COMPONENTS) → view
const DESIGN_VIEWS = { util: UTIL, rc: SLAB_LAYER, shear: SLAB_SHEAR, punch: PUNCHING, rcbeam: RC_BEAM, rccol: RC_COLUMN };
for (const c of Object.values(DESIGN_COMPONENTS).flat()) if (!DESIGN_VIEWS[c.kind]) throw new Error(`no result view for design component kind '${c.kind}'`);

/** Current result view: { view, comp, family } – family = the views of the result kind, current first. */
function current(rv) {
  if (rv.kind === 'static' || rv.kind === 'spectrum') return { view: STATIC, comp: componentDef(rv.component) || componentDef('deformed'), family: [STATIC] };
  if (rv.kind === 'modal' || rv.kind === 'buckling') return { view: MODE, comp: null, family: [MODE] };
  const comps = DESIGN_COMPONENTS[rv.kind];
  if (!comps) return null;
  // steel/timber: a single check is shown as a component of the utilisation view
  const comp = comps.find((c) => c.key === rv.component) || comps[0];
  const view = DESIGN_VIEWS[comp.kind];
  return { view, comp, family: [...new Set([view, ...comps.map((c) => DESIGN_VIEWS[c.kind])])] };
}

export function buildResults(vp, group) {
  const st = vp.store, mesh = st.results.mesh;
  if (!mesh) return null;
  vp.vis = meshVisibility(st, mesh);
  const cur = current(st.resultView);
  if (!cur) return null;
  const info = cur.view.build(vp, group, mesh, cur.comp);
  if (info && st.model.sectionLines?.length) drawSectionLines(vp, group, mesh, info, sectionSource(st));
  return info;
}

/** Shell-corner values of the current component for section diagrams; null when it has none. */
export function sectionSource(st) {
  const cur = st.results.mesh?.shells?.length ? current(st.resultView) : null;
  return cur?.view.section?.(st, cur.comp) || null;
}

/** Values at the cursor for the info box: rows or null. */
export function probeResult(st, hit) {
  if (!hit || !st.results.mesh) return null;
  for (const v of current(st.resultView)?.family || []) {
    const rows = v.probe?.(st, hit);
    if (rows) return rows;
  }
  return null;
}

/** Double-click on a result: opens the detail window; false when the hit has none. */
export function openResult(app, hit) {
  if (!hit || !app.store.results.mesh) return false;
  return (current(app.store.resultView)?.family || []).some((v) => v.open?.(app, hit));
}
