// Detail window of a steel or timber member: all checks with internal force diagrams of the governing case.
import { t } from '../../i18n.js';
import { h, openDialog, toast, hintBox } from '../dom.js';
import { fmt } from '../../core/units.js';
import { caseLabel } from '../results-data.js';
import { lineForces } from '../../fem/index.js';
import { runDesign } from './analysis.js';
import { chart } from '../chart.js';
import { designMessage, checkName } from '../design-text.js';

export function memberDetail(app, kind, lineId) {
  const st = app.store;
  const list = kind === 'timber' ? st.results.design.timber : st.results.design.steel;
  if (!list) return runDesign(app, kind).then((ok) => ok && memberDetail(app, kind, lineId));
  const r = list.find((x) => x.line === lineId);
  if (!r) return toast(t('Für Stab {id} gibt es keine Nachweise (Material/Querschnitt prüfen).', { id: lineId }), 'info');
  const line = st.idx.lines.get(lineId);
  const sec = st.idx.sections.get(line?.element?.section);
  const key = r.governing?.caseKey;
  const left = h('div', { style: { minWidth: 0 } });
  const cr = key && st.results.static?.cases?.[key];
  if (cr && st.results.mesh) {
    try {
      const f = lineForces(st.results.mesh, cr, lineId);
      left.appendChild(h('div.small.muted', { style: { marginBottom: '4px' } }, t('Schnittgrössen der massgebenden Kombination: {c}', { c: caseLabel(st, key) })));
      for (const [c, q, inv] of [['N', 'force'], ['Vz', 'force'], ['My', 'moment', true], ['Mz', 'moment']]) {
        if (f[c].some((v) => Math.abs(v) > 0.5)) left.appendChild(chart({ xs: f.x, title: c, q, invert: !!inv, series: [{ ys: f[c], cls: c === 'N' ? 'n' : c.startsWith('V') ? 'v' : 'm', fill: true }], height: 100 }));
      }
    } catch (e) { console.warn(e); }
  }
  const rows = Object.entries(r.checks || {}).sort((a, b) => (b[1].eta ?? 0) - (a[1].eta ?? 0));
  const tbl = h('div.list');
  for (const [k, c] of rows) {
    const eta = c.eta ?? 0, col = eta > 1 ? 'var(--danger)' : eta > 0.85 ? 'var(--warning)' : 'var(--success)';
    tbl.appendChild(h('div.list-item', { style: { cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: '3px' } },
      h('div.row', { style: { width: '100%' } }, h('b.small', checkName(k)), h('span.grow'), h('span.util-bar', { style: { width: '90px' } }, h('i', { style: { width: Math.min(100, eta * 100) + '%', background: col } })), h('b.small', { style: { color: col, minWidth: '46px', textAlign: 'right' } }, (eta * 100).toFixed(0) + ' %')),
      c.detail ? h('div.small.muted.mono', c.detail) : null,
      h('div.small.muted', `${caseLabel(st, c.caseKey)}${Number.isFinite(c.x) ? ` · x = ${fmt('len', c.x)}` : ''}`)));
  }
  const right = h('div', { style: { minWidth: 0 } },
    h('div.stat-grid', { style: { gridTemplateColumns: '1fr 1fr', marginBottom: '10px' } },
      h('div.stat', h('div.v', { style: { color: r.eta > 1 ? 'var(--danger)' : 'var(--success)' } }, ((r.eta ?? 0) * 100).toFixed(0) + ' %'), h('div.l', t('max. Ausnutzung'))),
      h('div.stat', h('div.v', { style: { fontSize: '15px' } }, r.governing ? checkName(r.governing.check) : '–'), h('div.l', t('massgebend')))),
    h('div.small.muted', { style: { marginBottom: '8px' } }, [sec?.name, r.cls ? t('Querschnittsklasse {c}', { c: r.cls }) : null].filter(Boolean).join(' · ')),
    tbl);
  const notes = (r.notes || []).map((n) => hintBox(designMessage(n)));
  openDialog({
    title: t('{k} – Stab {id}', { k: kind === 'timber' ? t('Holzbemessung') : t('Stahlbemessung'), id: lineId }),
    sub: st.model.settings.code === 'SIA' ? (kind === 'timber' ? 'SIA 265' : 'SIA 263') : (kind === 'timber' ? 'EN 1995-1-1' : 'EN 1993-1-1'),
    iconName: kind === 'timber' ? 'timber' : 'steel', mod: kind === 'timber' ? 'peach' : 'sky', size: 'xwide',
    body: h('div', h('div.rc-detail', left, right), ...notes),
    buttons: [{ label: t('Im Modell zeigen'), icon: 'target', onClick: () => { st.select({ lines: [lineId] }, 'replace'); app.zoomSelection(); } }, { label: t('Schliessen'), kind: 'primary' }],
  }).el.style.height = 'auto';
}
