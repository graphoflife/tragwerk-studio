// Small SVG line charts (design details, section line diagrams).
import { h } from './dom.js';
import { fmt } from '../core/units.js';

// Line chart along a member or section. series: [{ ys, cls, dash, fill, label }] (null = gap);
// invert draws positive values downward; hlines: [{ v, label }] reference lines.
export function chart({ xs, series, q, title, invert = false, width = 560, height = 118, hlines = [] }) {
  const L = xs[xs.length - 1] || 1;
  const vals = series.flatMap((s) => s.ys.filter(Number.isFinite)).concat(hlines.map((l) => l.v), [0]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-12) hi = lo + 1;
  const pad = 26, top = 18, H = height - top - 8;
  const X = (x) => pad + (x / L) * (width - 2 * pad);
  const Y = (v) => (invert ? top + ((v - lo) / (hi - lo)) * H : top + ((hi - v) / (hi - lo)) * H);
  let svg = `<svg viewBox="0 0 ${width} ${height}" class="rc-chart"><text x="4" y="12" class="ch-title">${title}</text>`;
  svg += `<line x1="${X(0)}" x2="${X(L)}" y1="${Y(0)}" y2="${Y(0)}" class="ch-axis"/>`;
  for (const l of hlines) svg += `<line x1="${X(0)}" x2="${X(L)}" y1="${Y(l.v)}" y2="${Y(l.v)}" class="ch-prov"/><text x="${X(L) - 2}" y="${Y(l.v) - 3}" text-anchor="end" class="ch-lbl prov">${l.label}</text>`;
  for (const s of series) {
    // contiguous runs of defined values (gaps, e.g. openings under a section line, stay empty)
    const runs = [];
    let run = [];
    xs.forEach((x, i) => {
      if (Number.isFinite(s.ys[i])) run.push(i);
      else if (run.length) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);
    if (!runs.length) continue;
    for (const r of runs) {
      const pts = r.map((i) => `${X(xs[i]).toFixed(1)},${Y(s.ys[i]).toFixed(1)}`);
      if (s.fill) svg += `<polygon points="${X(xs[r[0]])},${Y(0)} ${pts.join(' ')} ${X(xs[r[r.length - 1]])},${Y(0)}" class="ch-fill ${s.cls || ''}"/>`;
      svg += `<polyline points="${pts.join(' ')}" class="ch-line ${s.cls || ''}" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
    }
    // extremes (s.label: 'max' | 'min' | 'both'; values close to zero are not labelled)
    let iMax = -1, iMin = -1;
    s.ys.forEach((v, i) => { if (!Number.isFinite(v)) return; if (iMax < 0 || v > s.ys[iMax]) iMax = i; if (iMin < 0 || v < s.ys[iMin]) iMin = i; });
    const which = s.label || 'both', tol = 0.05 * Math.max(Math.abs(hi), Math.abs(lo));
    const idx = [which !== 'min' && iMax >= 0 && s.ys[iMax] > tol ? iMax : -1, which !== 'max' && iMin >= 0 && s.ys[iMin] < -tol ? iMin : -1];
    if (!s.noLabel) for (const i of new Set(idx)) if (i >= 0) svg += `<text x="${Math.min(width - 60, Math.max(40, X(xs[i])))}" y="${Y(s.ys[i]) + ((invert ? s.ys[i] > 0 : s.ys[i] < 0) ? -5 : 13)}" text-anchor="middle" class="ch-lbl">${fmt(q, s.ys[i])}</text>`; // inside the filled area
  }
  svg += `<text x="${X(0)}" y="${height - 1}" class="ch-x">0</text><text x="${X(L)}" y="${height - 1}" text-anchor="end" class="ch-x">${fmt('len', L)}</text></svg>`;
  return h('div', { html: svg });
}
