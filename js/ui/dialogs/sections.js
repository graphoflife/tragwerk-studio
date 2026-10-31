// Section lines (Schnittlinien): list in the result panels and the 2D diagram window.
import { t } from '../../i18n.js';
import { h, ic, openDialog, toast, download, promptDialog, section } from '../dom.js';
import { fmt, fmtNum, toDisplay, unitLabel } from '../../core/units.js';
import { sectionValues, sectionStats } from '../../core/seclines.js';
import { sectionSource, sectionSample } from '../vp-results.js';
import { caseLabel } from '../results-data.js';
import { chart } from '../chart.js';

function valuesOf(app, sl) {
  const st = app.store, mesh = st.results.mesh;
  const src = sectionSource(st);
  if (!src || !mesh) return null;
  const smp = sectionSample(mesh, sl);
  const hidden = st.view.hidden.domains;
  const vals = sectionValues(smp, (e, k) => (hidden.has(mesh.shells[e].domain) ? null : src.f(e, k)));
  return { src, smp, vals, stats: sectionStats(smp, vals) };
}

/** Side panel block: section lines with on/off, diagram, rename, delete. */
export function sectionLinesBlock(app) {
  const st = app.store;
  const sls = st.model.sectionLines || [];
  const src = sectionSource(st);
  const list = h('div.list');
  const upd = (id, fn, label = t('Schnittlinie ändern')) => st.commit(label, (m) => fn(m.sectionLines.find((x) => x.id === id)), { keepResults: true });
  for (const sl of sls) {
    const cb = h('input', { type: 'checkbox', checked: sl.on !== false });
    cb.addEventListener('change', () => upd(sl.id, (x) => { x.on = cb.checked; }));
    let meta = fmt('len', Math.hypot(sl.b[0] - sl.a[0], sl.b[1] - sl.a[1], sl.b[2] - sl.a[2]));
    if (src && sl.on !== false) {
      const r = valuesOf(app, sl);
      if (r && Number.isFinite(r.stats.max)) meta = `${fmt(src.q, r.stats.max, { unit: false })} / ${fmt(src.q, r.stats.min)}`;
    }
    list.appendChild(h('div.part-row' + (sl.on !== false ? '.on' : ''),
      h('label.part-check', cb, h('span.t', h('b', sl.name)), h('span.meta', meta)),
      h('span.acts',
        h('button.icon-btn.sm', { onclick: () => sectionDialog(app, sl.id), tip: [t('Diagramm'), t('Verlauf, Extremwerte und Integral (z.B. Moment über eine Streifenbreite)')] }, ic('diagram')),
        h('button.icon-btn.sm', { onclick: () => promptDialog(t('Schnittlinie umbenennen'), t('Name'), sl.name, { iconName: 'line' }).then((nm) => nm && upd(sl.id, (x) => { x.name = nm; }, t('Schnittlinie umbenennen'))), tip: [t('Umbenennen')] }, ic('tag')),
        h('button.icon-btn.sm', { onclick: () => st.commit(t('Schnittlinie löschen'), (m) => { m.sectionLines = m.sectionLines.filter((x) => x.id !== sl.id); }, { keepResults: true }), tip: [t('Löschen')] }, ic('trash')))));
  }
  const head = h('div.row', { style: { gap: '6px', marginBottom: '6px' } },
    h('button.btn.sm', { onclick: () => app.cmds.toolSection.run() }, ic('plus'), t('Neue Schnittlinie')),
    h('span.grow'),
    sls.length ? h('span.small.muted', src ? src.name : t('Komponente ohne Flächenwerte')) : null);
  const body = [head];
  if (!sls.length) body.push(h('div.small.muted', t('Zwei Punkte auf einer Fläche klicken – das Diagramm zeigt die aktuelle Komponente entlang der Linie (z.B. mx über einen Plattenstreifen).')));
  else body.push(list);
  if (sls.length && !src) body.push(h('div.small.muted', { style: { marginTop: '4px' } }, t('Für Diagramme eine Flächenkomponente wählen (z.B. mx, nx, eZ oder axb).')));
  return section(t('Schnittlinien'), ...body);
}

/** 2D diagram window of one section line. */
export function sectionDialog(app, id) {
  const st = app.store;
  const sl = (st.model.sectionLines || []).find((x) => x.id === id);
  if (!sl) return;
  const r = valuesOf(app, sl);
  if (!r) return toast(t('Für Diagramme eine Flächenkomponente wählen (z.B. mx, nx, eZ oder axb).'), 'info');
  const { src, smp, vals, stats } = r;
  const xs = smp.pts.map((p) => p.s);
  const rv = st.resultView;
  const what = rv.kind === 'rc' ? t('Stahlbetonbemessung') : caseLabel(st, rv.caseKey) + (String(rv.caseKey).startsWith('ENV:') ? ` (${rv.envSide === 'min' ? 'Min' : 'Max'})` : '');
  const kv = (rows) => h('div.res-max', rows.map(([a, b]) => h('div.r', h('span', a), h('b', b))));
  const at = (i) => (i >= 0 ? ` · s = ${fmt('len', xs[i])}` : '');
  const rows = [
    [t('Länge'), fmt('len', smp.L)],
    ['Max', Number.isFinite(stats.max) ? fmt(src.q, stats.max) + at(stats.iMax) : '–'],
    ['Min', Number.isFinite(stats.min) ? fmt(src.q, stats.min) + at(stats.iMin) : '–'],
  ];
  if (src.integralQ) {
    rows.push([t('Integral ∫ v ds'), fmt(src.integralQ, stats.integral)]);
    if (stats.mean != null) rows.push([t('Mittelwert'), fmt(src.q, stats.mean)]);
  }
  if (stats.length < smp.L - 1e-6) rows.push([t('davon auf Flächen'), fmt('len', stats.length)]);
  const gapNote = vals.some((v) => v == null) ? h('div.small.muted', { style: { marginTop: '6px' } }, t('Lücken: Abschnitte ausserhalb von Flächen (z.B. Öffnungen) oder ausgeblendete Teile.')) : null;
  const csv = () => {
    const uq = unitLabel(src.q), ul = unitLabel('len');
    const lines = [`s [${ul}];x [${ul}];y [${ul}];z [${ul}];${src.name} [${uq}]`];
    smp.pts.forEach((p, i) => lines.push([toDisplay('len', p.s), ...p.p.map((c) => toDisplay('len', c)), vals[i] == null ? '' : toDisplay(src.q, vals[i])].map((v) => (typeof v === 'number' ? fmtNum(v, 6) : v)).join(';')));
    download(`${sl.name}.csv`, lines.join('\n'), 'text/csv');
  };
  const body = h('div',
    h('div.small.muted', { style: { marginBottom: '6px' } }, `${src.name} · ${what} · A (${sl.a.map((c) => fmtNum(c, 4)).join('; ')}) → B (${sl.b.map((c) => fmtNum(c, 4)).join('; ')})`),
    chart({ xs, title: `${src.name} – ${sl.name}`, q: src.q, invert: !!src.down, height: 220, width: 640, series: [{ ys: vals, cls: src.down ? 'm' : 'v', fill: true }] }),
    h('div.grid2', { style: { alignItems: 'start', gap: '18px', marginTop: '8px' } }, kv(rows),
      h('div.small.muted', src.integralQ
        ? t('Das Integral über die Linie ergibt z.B. aus mx das Gesamtmoment eines Plattenstreifens – praktisch für Bemessungsstreifen und Kontrollen von Hand.')
        : t('Werte linear aus den Eckwerten der Flächenelemente interpoliert.'))),
    gapNote);
  openDialog({
    title: t('Schnittlinie {n}', { n: sl.name }), sub: src.name, iconName: 'diagram', mod: 'lemon', size: 'wide', body,
    buttons: [{ label: t('CSV exportieren'), icon: 'download', onClick: () => { csv(); return false; } }, { label: t('Schliessen'), kind: 'primary' }],
  }).el.style.height = 'auto';
}
