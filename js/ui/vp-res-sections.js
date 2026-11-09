// Section lines (Schnittlinien) in the result display: sampling along the line and diagram drawing.
import { label } from './vp-util.js';
import { getCase } from './results-data.js';
import { fmt } from '../core/units.js';
import { sampleSection, sectionValues } from '../core/seclines.js';
import { visShell, diagramFill } from './vp-res-draw.js';

const sampleCache = new WeakMap();
export function sectionSample(mesh, sl) {
  let m = sampleCache.get(mesh);
  if (!m) { m = new Map(); sampleCache.set(mesh, m); }
  const key = `${sl.a.join(',')}|${sl.b.join(',')}`;
  if (!m.has(key)) m.set(key, sampleSection(mesh, sl.a, sl.b));
  return m.get(key);
}

/** Section lines in the result display: dashed base line, name and – for components with surface
 *  values (src from the result view, null otherwise) – the filled diagram along the line. */
export function drawSectionLines(vp, group, mesh, info, src) {
  const st = vp.store, rv = st.resultView;
  // follow the deformed surface when the deformed shape is shown
  const cs = info?.scaleUsed > 0 ? getCase(st, rv.caseKey) : null;
  const disp = cs?.res?.disp, dsc = info?.scaleUsed || 0;
  const onSurface = (pt) => {
    if (!disp || !pt.hit) return pt.p;
    const sh = mesh.shells[pt.hit.e];
    return pt.p.map((x, j) => x + dsc * pt.hit.k.reduce((a, k, i) => a + pt.hit.w[i] * disp[6 * sh.nodes[k] + j], 0));
  };
  const lines = st.model.sectionLines.filter((sl) => sl.on !== false);
  const base = [];
  const data = lines.map((sl) => {
    base.push(...sl.a, ...sl.b);
    if (!src) return null;
    const smp = sectionSample(mesh, sl);
    // hidden elements (parts) give no values
    const vals = sectionValues(smp, (e, k) => (visShell(vp, e) ? src.f(e, k) : null));
    return { sl, smp, vals };
  }).filter(Boolean);
  const bl = vp.lines.make(base, vp.C.sel, 2.2, { dashed: true, dashSize: vp.sz * 0.8, gapSize: vp.sz * 0.5, depthTest: false });
  if (bl) { bl.renderOrder = 6; group.add(bl); }
  for (const sl of lines) group.add(label(sl.name, sl.a, 'big'));
  if (!src || !data.length) return;
  let maxAbs = 0;
  for (const d of data) for (const v of d.vals) if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v));
  if (maxAbs < 1e-12) return;
  const sc = vp.sz * 5 * (rv.diagramScale || 1) / maxAbs * (src.down ? -1 : 1);
  const posTri = [], negTri = [], outline = [];
  for (const { smp, vals } of data) {
    let iMax = -1, iMin = -1;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v == null) continue;
      if (iMax < 0 || v > vals[iMax]) iMax = i;
      if (iMin < 0 || v < vals[iMin]) iMin = i;
      const u = vals[i + 1];
      if (u == null || i + 1 >= vals.length) continue;
      const pa = smp.pts[i], pb = smp.pts[i + 1];
      const ba = onSurface(pa), bb = onSurface(pb);
      const ta = ba.map((x, j) => x + pa.hit.ez[j] * v * sc), tb = bb.map((x, j) => x + pb.hit.ez[j] * u * sc);
      const tri = (v + u) / 2 >= 0 ? posTri : negTri;
      tri.push(...ba, ...ta, ...tb, ...ba, ...tb, ...bb);
      outline.push(...ta, ...tb);
      if (i % 8 === 0) outline.push(...ba, ...ta);
    }
    const tipOf = (i) => onSurface(smp.pts[i]).map((x, j) => x + smp.pts[i].hit.ez[j] * vals[i] * sc);
    if (iMax >= 0) group.add(label(fmt(src.q, vals[iMax]), tipOf(iMax), 'big ' + (vals[iMax] >= 0 ? 'pos' : 'neg')));
    if (iMin >= 0 && iMin !== iMax && Math.abs(vals[iMin] - vals[iMax]) > maxAbs * 0.05) group.add(label(fmt(src.q, vals[iMin]), tipOf(iMin), 'big ' + (vals[iMin] >= 0 ? 'pos' : 'neg')));
  }
  diagramFill(vp, group, posTri, negTri, { opacity: 0.55, renderOrder: 4 });
  const ol = vp.lines.make(outline, vp.C.text === '#e9ebf3' ? 0xd5dae8 : 0x3d4354, 1.4, { opacity: 0.95 });
  if (ol) group.add(ol);
}
