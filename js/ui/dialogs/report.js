// Report builder: choose chapters, capture views, preview, print/PDF or download as HTML.
import { t } from '../../i18n.js';
import { h, ic, clear, openDialog, checkInput, toast, download } from '../dom.js';
import { P, lineLength, polygonArea, modelStats } from '../../core/model.js';
import { fmt, fmtNum, toDisplay, unitLabel } from '../../core/units.js';
import { caseLabel, getCase, caseSummary } from '../results-data.js';
import { lineForces } from '../../fem/index.js';
import { describeLoad } from './loads.js';
import { designCaseKeys } from './analysis.js';
import { checkName, layerName, meshText, slabSuggestion, beamSuggestion, barsText, stirrupText, POS_NAMES } from '../design-text.js';

const CHAPTERS = [
  ['cover', 'Projektangaben'], ['views', 'Ansichten'], ['materials', 'Materialien'], ['sections', 'Querschnitte'],
  ['nodes', 'Knoten'], ['elements', 'Stäbe und Flächen'], ['supports', 'Lager'], ['loads', 'Lastfälle und Lasten'],
  ['combos', 'Kombinationen'], ['static', 'Ergebnisse Statik'], ['modal', 'Eigenschwingung'], ['buckling', 'Stabilität'],
  ['design', 'Bemessung'],
];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const table = (head, rows) => `<table><tr>${head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`;
const num = (q, v) => (v == null || !Number.isFinite(v) ? '–' : fmtNum(toDisplay(q, v)));
const u = (q) => unitLabel(q);

export function openReport(app) {
  const st = app.store;
  app.reportImages = app.reportImages || [];
  const on = Object.fromEntries(CHAPTERS.map(([k]) => [k, !['nodes'].includes(k)]));
  const preview = h('div.report-preview');
  const left = h('div', { style: { overflow: 'auto' } });
  const imgs = h('div');
  const renderPreview = () => { clear(preview); const page = h('div.report-page'); page.innerHTML = buildHtml(app, on); preview.appendChild(page); };
  const renderImgs = () => {
    clear(imgs);
    app.reportImages.forEach((im, i) => imgs.appendChild(h('div.list-item', { style: { cursor: 'default' } }, h('img', { src: im.url, style: { width: '64px', height: '40px', objectFit: 'cover', borderRadius: '6px' } }), h('span.small.t', im.title),
      h('button.icon-btn.sm', { onclick: () => { app.reportImages.splice(i, 1); renderImgs(); renderPreview(); } }, ic('trash')))));
  };
  left.append(h('h4', t('Kapitel')));
  for (const [k, label] of CHAPTERS) left.appendChild(h('div', { style: { margin: '4px 0' } }, checkInput(t(label), on[k], (v) => { on[k] = v; renderPreview(); })));
  left.append(h('h4', t('Bilder')),
    h('button.btn.sm.block', { onclick: () => {
      const title = st.resultView.kind ? `${app.vp.resultInfo?.title || ''} – ${app.vp.resultInfo?.sub || ''}` : t('Modell');
      app.reportImages.push({ url: app.vp.snapshot(1400, 860), title });
      renderImgs(); renderPreview();
      toast(t('Aktuelle Ansicht zum Bericht hinzugefügt.'), 'ok');
    } }, ic('camera'), t('Aktuelle Ansicht aufnehmen')), imgs,
    h('div.small.muted', { style: { marginTop: '8px' } }, t('Tipp: Dialog schliessen, Ansicht/Ergebnis einstellen, Bericht wieder öffnen und Ansicht aufnehmen.')));
  renderImgs();
  renderPreview();
  const fullHtml = () => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(st.model.meta.name)} – ${t('Statische Berechnung')}</title><style>${REPORT_CSS}</style></head><body><div class="report-page">${buildHtml(app, on)}</div></body></html>`;
  openDialog({
    title: t('Bericht'), sub: t('Statische Berechnung als Druck/PDF oder HTML'), iconName: 'report', mod: 'slate', size: 'xwide',
    body: h('div.report-layout', left, preview),
    buttons: [
      { label: t('HTML speichern'), icon: 'download', onClick: () => { download(`${st.model.meta.name || 'bericht'}.html`, fullHtml(), 'text/html'); return false; } },
      { label: t('Drucken / PDF'), kind: 'primary', icon: 'printer', onClick: () => {
        const w = window.open('', '_blank');
        if (!w) { toast(t('Pop-up blockiert – bitte erlauben oder HTML speichern.'), 'warn'); return false; }
        w.document.write(fullHtml());
        w.document.close();
        setTimeout(() => w.print(), 400);
        return false;
      } },
    ],
  });
}

function buildHtml(app, on) {
  const st = app.store, m = st.model, idx = st.idx, R = st.results;
  const code = m.settings.code === 'SIA' ? 'SIA 260–265' : 'Eurocode EN 1990–1998';
  const parts = [];
  let ch = 0;
  const H2 = (s) => `<h2>${++ch}. ${esc(s)}</h2>`;
  if (on.cover) {
    const s = modelStats(m);
    parts.push(`<h1>${esc(m.meta.name)}</h1><div class="meta">${t('Statische Berechnung')} · ${esc(m.meta.author || '')} · ${new Date().toLocaleDateString()} · ${t('Norm')}: ${code}</div>`);
    if (m.meta.description) parts.push(`<p>${esc(m.meta.description)}</p>`);
    parts.push(table([t('Knoten'), t('Linien'), t('Stäbe'), t('Flächen'), t('Lager'), t('Lastfälle'), t('Kombinationen')], [[s.nodes, s.lines, s.beams + s.trusses, s.domains, s.supports, s.loadCases, s.combinations]]));
  }
  if (on.views && app.reportImages?.length) {
    parts.push(H2(t('Ansichten')));
    for (const im of app.reportImages) parts.push(`<figure style="margin:0 0 14px"><img src="${im.url}"><figcaption class="meta">${esc(im.title)}</figcaption></figure>`);
  }
  if (on.materials && m.materials.length) {
    parts.push(H2(t('Materialien')));
    parts.push(table(['#', 'Name', t('Typ'), `E [${u('modulus')}]`, 'ν', `ρ [${u('density')}]`, `fy/fck/fm,k [${u('stress')}]`],
      m.materials.map((x) => [x.id, x.name, x.type, num('modulus', x.E), x.nu, num('density', x.rho), num('stress', x.fy ?? x.fck ?? x.timber?.fmk)])));
  }
  if (on.sections && m.sections.length) {
    parts.push(H2(t('Querschnitte')));
    parts.push(table(['#', 'Name', `A [${u('area')}]`, `Iy [${u('inertia')}]`, `Iz [${u('inertia')}]`, `It [${u('inertia')}]`, `Wpl,y [${u('secMod')}]`],
      m.sections.map((s) => [s.id, s.name, num('area', s.A), num('inertia', s.Iy), num('inertia', s.Iz), num('inertia', s.It), num('secMod', s.Wply)])));
  }
  if (on.nodes) {
    parts.push(H2(t('Knoten')));
    parts.push(table(['#', `X [${u('len')}]`, `Y [${u('len')}]`, `Z [${u('len')}]`], m.nodes.slice(0, 2000).map((n) => [n.id, num('len', n.x), num('len', n.y), num('len', n.z)])));
  }
  if (on.elements) {
    const lines = m.lines.filter((l) => l.element);
    if (lines.length) {
      parts.push(H2(t('Stäbe')));
      parts.push(table(['#', 'i', 'j', t('Typ'), t('Material'), t('Querschnitt'), 'β [°]', `L [${u('len')}]`],
        lines.slice(0, 2000).map((l) => [l.id, l.n1, l.n2, l.element.type, idx.materials.get(l.element.material)?.name || '–', idx.sections.get(l.element.section)?.name || '–', l.element.beta || 0, num('len', lineLength(m, idx, l))])));
    }
    if (m.domains.length) {
      parts.push(H2(t('Flächen')));
      parts.push(table(['#', t('Typ'), t('Material'), `t [${u('thick')}]`, 'A [m²]', t('Eckknoten')],
        m.domains.map((d) => [d.id, d.type, idx.materials.get(d.material)?.name || '–', num('thick', d.thickness), fmtNum(polygonArea(d.nodes.map((n) => P(idx.nodes.get(n))))), d.nodes.join(', ')])));
    }
  }
  if (on.supports && m.supports.length) {
    parts.push(H2(t('Lager')));
    const dd = (v) => (v === 'F' ? t('fest') : v ? fmtNum(v) : '–');
    parts.push(table(['#', t('Typ'), t('Objekt'), 'uX', 'uY', 'uZ', 'φX', 'φY', 'φZ'],
      m.supports.map((s) => [s.id, s.type, s.node ?? s.line ?? s.domain, ...(s.dofs ? s.dofs.map(dd) : [dd(s.k[0]), dd(s.k[1]), dd(s.k[2]), '', '', ''])])));
  }
  if (on.loads) {
    parts.push(H2(t('Lastfälle und Lasten')));
    if (m.loadGroups.length) parts.push(table([t('Lastgruppe'), t('Typ'), 'γsup', 'γinf', 'ψ0', 'ψ1', 'ψ2'], m.loadGroups.map((g) => [g.name, g.type, g.gammaSup, g.gammaInf, g.psi0, g.psi1, g.psi2])));
    for (const lc of m.loadCases) {
      const ls = m.loads.filter((l) => l.lc === lc.id);
      parts.push(`<p><b>${esc(lc.name)}</b> (${esc(idx.loadGroups.get(lc.group)?.name || '–')})${lc.selfWeight ? ' · ' + t('inkl. Eigengewicht') : ''}</p>`);
      if (ls.length) parts.push(table(['#', t('Last')], ls.slice(0, 500).map((l) => [l.id, describeLoad(app, l)])));
    }
  }
  if (on.combos && m.combinations.length) {
    parts.push(H2(t('Kombinationen')));
    parts.push(table(['#', t('Typ'), 'Name'], m.combinations.map((c) => [c.id, c.type, c.name])));
  }
  if (on.static && R.static && R.mesh) {
    parts.push(H2(t('Ergebnisse Statik')));
    parts.push(`<p class="meta">${R.static.nonlinear ? t('Nichtlineare Berechnung') : t('Lineare Berechnung')} · ${R.mesh.nodes.length / 3} ${t('FE-Knoten')} · ${R.mesh.beams.length} ${t('Stabelemente')} · ${R.mesh.shells.length} ${t('Flächenelemente')}</p>`);
    const keys = Object.keys(R.static.cases);
    parts.push(table([t('Lastfall / Kombination'), `max. u [${u('disp')}]`, `max. |My| [${u('moment')}]`, `max. |N| [${u('force')}]`, `Σ Rz [${u('force')}]`],
      keys.map((k) => { const s = caseSummary(st, k); return [caseLabel(st, k), num('disp', s?.maxU), num('moment', Math.abs(s?.My ?? 0)), num('force', Math.abs(s?.N ?? 0)), num('force', s?.sumR?.[2])]; })));
    // beam extremes for the governing envelope / first combination
    const key = m.combinations.length ? 'ENV:ALL' : keys[0];
    const c = getCase(st, key);
    const lines = m.lines.filter((l) => l.element && ['beam', 'truss', 'rib'].includes(l.element.type));
    if (c && lines.length) {
      parts.push(`<p><b>${t('Stab-Extremwerte')}</b> – ${esc(caseLabel(st, key))}</p>`);
      const rows = [];
      for (const l of lines.slice(0, 400)) {
        const sets = c.res ? [c.res] : [c.min, c.max];
        let N0 = Infinity, N1 = -Infinity, V = 0, M0 = Infinity, M1 = -Infinity;
        for (const r of sets) {
          let f; try { f = lineForces(R.mesh, r, l.id); } catch (e) { continue; }
          for (let k = 0; k < f.x.length; k++) { N0 = Math.min(N0, f.N[k]); N1 = Math.max(N1, f.N[k]); V = Math.max(V, Math.abs(f.Vz[k])); M0 = Math.min(M0, f.My[k]); M1 = Math.max(M1, f.My[k]); }
        }
        rows.push([l.id, idx.sections.get(l.element.section)?.name || '', num('force', N0), num('force', N1), num('force', V), num('moment', M0), num('moment', M1)]);
      }
      parts.push(table([t('Stab'), t('Querschnitt'), `N min [${u('force')}]`, `N max`, `|Vz| max`, `My min [${u('moment')}]`, 'My max'], rows));
    }
  }
  if (on.modal && R.modal) {
    parts.push(H2(t('Eigenschwingung')));
    parts.push(table([t('Form'), 'f [Hz]', 'T [s]', 'mX [%]', 'mY [%]', 'mZ [%]'], R.modal.modes.map((md, i) => [i + 1, fmtNum(md.f), fmtNum(md.T), ((md.effMass?.[0] ?? 0) * 100).toFixed(1), ((md.effMass?.[1] ?? 0) * 100).toFixed(1), ((md.effMass?.[2] ?? 0) * 100).toFixed(1)])));
  }
  if (on.buckling && R.buckling) {
    parts.push(H2(t('Stabilität')));
    parts.push(`<p class="meta">${t('Lastsituation')}: ${esc(caseLabel(st, R.buckling.basis))}</p>`);
    parts.push(table([t('Form'), 'αcr'], R.buckling.modes.map((md, i) => [i + 1, md.lambda.toFixed(3)])));
  }
  if (on.design && (R.steel || R.timber || R.rc || R.rcBeams || R.rcCols)) {
    parts.push(H2(t('Bemessung')));
    parts.push(`<p class="meta">${t('Norm')}: ${code} · ${t('Basis')}: ${esc(designCaseKeys(st).basis)}</p>`);
    const util = (list, title) => {
      parts.push(`<p><b>${title}</b></p>`);
      parts.push(table([t('Stab'), 'η [%]', t('massgebend'), t('Kombination'), t('Details')],
        [...list].sort((a, b) => b.eta - a.eta).slice(0, 300).map((r) => [r.line, ((r.eta ?? 0) * 100).toFixed(1), r.governing ? checkName(r.governing.check) : '', caseLabel(st, r.governing?.caseKey), r.checks?.[r.governing?.check]?.detail || ''])));
    };
    const cd = m.settings.code === 'SIA' ? 'SIA' : 'EC';
    if (R.steel) util(R.steel, t('Stahlnachweise'));
    if (R.timber) util(R.timber, t('Holznachweise'));
    if (R.rc?.domains?.length) {
      parts.push(`<p><b>${t('Stahlbeton Flächen – maximale erforderliche Bewehrung (inkl. Mindestbewehrung, Wood-Armer)')}</b></p>`);
      parts.push(table([t('Fläche'), t('Lage'), 'd [mm]', `as,min [${u('reinf')}]`, `${t('erf. max')} [${u('reinf')}]`, t('Vorschlag'), t('massgebend')],
        R.rc.domains.flatMap((d) => ['axb', 'ayb', 'axt', 'ayt'].map((lay, j) => [d.id, `${lay} (${layerName(lay)})`, Math.round(d.layout.d[lay.slice(1)] * 1000), num('reinf', d.asMin[j]), num('reinf', d.max[j]),
          d.max[j] > 0 ? meshText(slabSuggestion(d.max[j], lay, d.layout, cd)) : '–', d.maxCase[j] >= 0 ? caseLabel(st, R.rc.keys[d.maxCase[j]]) : '']))));
      const sh = R.rc.domains.map((d) => [d.id, (d.vMax * 100).toFixed(0), d.vMax > 1 ? t('Schubbewehrung erforderlich') : t('ohne Schubbewehrung ok')]);
      parts.push(table([t('Fläche'), 'max. vEd/vRd,c [%]', t('Ergebnis')], sh));
    }
    if (R.punching?.items?.length) {
      parts.push(`<p><b>${t('Durchstanzen')}</b></p>`);
      parts.push(table([t('Knoten'), t('Lage'), 'd [mm]', `VEd [${u('force')}]`, 'η [%]', t('Ergebnis')],
        R.punching.items.map((it) => [it.node, t(POS_NAMES[it.type]), Math.round(it.d * 1000), num('force', it.VEd), (it.eta * 100).toFixed(0),
          it.fail ? t('Platte verstärken / Stütze vergrössern') : it.needsReinf ? t('Durchstanzbewehrung erforderlich') : t('ohne Bewehrung erfüllt')])));
    }
    if (R.rcCols?.length) {
      parts.push(`<p><b>${t('Stahlbetonstützen')}</b></p>`);
      parts.push(table([t('Stab'), t('Querschnitt'), 'λy / λz', `NEd [${u('force')}]`, `MEd,y / MEd,z [${u('moment')}]`, `As [${u('reinfBeam')}]`, t('Vorschlag'), 'η [%]'],
        R.rcCols.map((c) => [c.line, c.shape === 'CIRC' ? `Ø${Math.round(c.D * 1000)}` : `${Math.round(c.b * 1000)}×${Math.round(c.h * 1000)}`, `${Math.round(c.lambda?.y || 0)} / ${Math.round(c.lambda?.z || 0)}`,
          num('force', c.governing?.NEd ?? 0), `${num('moment', c.governing?.MEdy ?? 0)} / ${num('moment', c.governing?.MEdz ?? 0)}`, num('reinfBeam', c.As), c.bars ? `${c.bars.n} Ø${Math.round(c.bars.dia * 1000)}` : '–', ((c.eta || 0) * 100).toFixed(0)])));
    }
    if (R.rcBeams?.length) {
      parts.push(`<p><b>${t('Stahlbeton Balken')}</b></p>`);
      parts.push(table([t('Stab'), t('Querschnitt'), `As unten [${u('reinfBeam')}]`, `As oben [${u('reinfBeam')}]`, `asw [${u('reinf')}]`, t('Vorschlag'), 'OK'],
        R.rcBeams.map((b) => {
          const sg = beamSuggestion(b, cd);
          return [b.line, b.tBeam ? `${t('Plattenbalken')} beff = ${fmtNum(b.tBeam.beff, 3)} m` : `${Math.round(b.b * 1000)}×${Math.round(b.h * 1000)}`, num('reinfBeam', Math.max(0, ...b.AsBot)), num('reinfBeam', Math.max(0, ...b.AsTop)), num('reinf', Math.max(0, ...b.Asw)),
            `${barsText(sg.bot)} / ${barsText(sg.top)} · ${stirrupText(sg.stirrups)}`, b.ok === false ? '✗' : '✓'];
        })));
    }
  }
  parts.push(`<p class="meta" style="margin-top:28px">${t('Erstellt mit Tragwerk Studio')} · ${new Date().toLocaleString()}</p>`);
  void fmt;
  return parts.join('\n');
}

const REPORT_CSS = `
body { font-family: Inter, system-ui, sans-serif; color: #1e2331; margin: 0; background: #fff; }
.report-page { max-width: 820px; margin: 0 auto; padding: 36px 42px; font-size: 12px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #c9cff5; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; font-size: 10.5px; margin: 6px 0 10px; font-variant-numeric: tabular-nums; }
th, td { border: 1px solid #dfe2ec; padding: 3px 6px; text-align: right; } th { background: #f1f3fa; } td:first-child, th:first-child { text-align: left; }
img { max-width: 100%; border-radius: 6px; border: 1px solid #e3e6ef; } .meta { color: #6b7286; }
tr { page-break-inside: avoid; }
@media print { .report-page { padding: 0; } }`;
