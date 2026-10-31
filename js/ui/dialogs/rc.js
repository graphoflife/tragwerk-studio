// Reinforced concrete (AxisVM-style RC module): reinforcement parameters, provided reinforcement,
// design protocol, beam design details; detail window for steel/timber members.
import { t } from '../../i18n.js';
import { h, ic, clear, openDialog, field, numInput, selectInput, switchInput, toast, hintBox } from '../dom.js';
import { fmt, fmtNum } from '../../core/units.js';
import { caseLabel } from '../results-data.js';
import { lineForces } from '../../fem/index.js';
import { surfaceLayout, rcSurfaceDetail } from '../../design/concrete.js';
import { BAR_DIAS, meshArea } from '../../design/rebar.js';
import { runDesign } from './analysis.js';
import { chart } from '../chart.js';
import { designMessage, checkName, layerName, slabSuggestion, beamSuggestion, meshText, barsText, stirrupText, POS_NAMES } from '../design-text.js';

const LAYERS = ['axb', 'ayb', 'axt', 'ayt'];
const PROV_KEYS = ['xb', 'yb', 'xt', 'yt'];
const STEELS = [[500000, 'B500B (fsk 500)'], [450000, 'B450C (fsk 450)'], [550000, 'B550 (fsk 550)']];
const mm = (v) => Math.round(v * 1000);
const codeOf = (st) => (st.model.settings.code === 'SIA' ? 'SIA' : 'EC');
const isConcrete = (st, id) => st.idx.materials.get(id)?.type === 'concrete';
// bar diameters of the code family (plus a value already in the model that is not in the list)
const diaOptions = (code, cur) => [...new Set([...BAR_DIAS[code], ...(cur > 0 ? [cur] : [])])].sort((x, y) => x - y).map((d) => ({ value: d, label: `Ø ${mm(d)}` }));

function concreteTargets(st) {
  const sel = st.selection;
  const domOk = (d) => d && isConcrete(st, d.material);
  const beamOk = (l) => l?.element && ['beam', 'rib'].includes(l.element.type) && isConcrete(st, l.element.material);
  let doms = [...sel.domains].map((id) => st.idx.domains.get(id)).filter(domOk);
  let beams = [...sel.lines].map((id) => st.idx.lines.get(id)).filter(beamOk);
  let all = false;
  if (!doms.length && !beams.length) { doms = st.model.domains.filter(domOk); beams = st.model.lines.filter(beamOk); all = true; }
  return { doms, beams, all };
}

// re-run the designs that exist after parameter changes (results stay consistent with the model)
async function refreshDesigns(app) {
  const r = app.store.results;
  const had = { rc: !!r.rc, beams: !!r.rcBeams, cols: !!r.rcCols };
  r.rc = r.rcBeams = r.rcCols = r.punching = null;
  if (!r.static) return;
  if (had.rc) await runDesign(app, 'rc', { quiet: true });
  if (had.beams) await runDesign(app, 'rcBeam', { quiet: true });
  if (had.cols) await runDesign(app, 'rcCol', { quiet: true });
}

/* ---------------- reinforcement parameters ---------------- */
function slabSketch(L) {
  const W = 300, H = 120, th = L.t || 0.2, k = (H - 20) / th;
  const y = (z) => 10 + (th - z) * k; // z from the bottom face
  const zxb = L.coverB + L.diaX / 2, zyb = L.coverB + L.diaX + L.diaY / 2;
  const zxt = th - L.coverT - L.diaX / 2, zyt = th - L.coverT - L.diaX - L.diaY / 2;
  const dots = (z, r) => Array.from({ length: 8 }, (_, i) => `<circle cx="${30 + i * 35}" cy="${y(z)}" r="${Math.max(2, r * k)}" class="sk-bar-y"/>`).join('');
  return `<svg viewBox="0 0 ${W + 150} ${H}" class="rc-sketch">
    <rect x="10" y="${y(th)}" width="${W}" height="${th * k}" class="sk-concrete"/>
    <line x1="14" x2="${W + 6}" y1="${y(zxb)}" y2="${y(zxb)}" class="sk-bar-x" stroke-width="${Math.max(2, L.diaX * k)}"/>
    <line x1="14" x2="${W + 6}" y1="${y(zxt)}" y2="${y(zxt)}" class="sk-bar-x" stroke-width="${Math.max(2, L.diaX * k)}"/>
    ${dots(zyb, L.diaY / 2)}${dots(zyt, L.diaY / 2)}
    <text x="${W + 18}" y="${y(zxt) + 4}" class="sk-t">x ${t('oben')}: d = ${mm(L.d.xt)} mm</text>
    <text x="${W + 18}" y="${y(zyt) + 14}" class="sk-t">y ${t('oben')}: d = ${mm(L.d.yt)} mm</text>
    <text x="${W + 18}" y="${y(zyb) - 6}" class="sk-t">y ${t('unten')}: d = ${mm(L.d.yb)} mm</text>
    <text x="${W + 18}" y="${y(zxb) + 4}" class="sk-t">x ${t('unten')}: d = ${mm(L.d.xb)} mm</text>
  </svg>`;
}

export function rcParamsDialog(app) {
  const st = app.store, code = codeOf(st);
  const { doms, beams, all } = concreteTargets(st);
  if (!doms.length && !beams.length) return toast(t('Keine Betonflächen oder Betonbalken im Modell (Material Beton zuweisen).'), 'info');
  const body = h('div');
  const d0 = doms[0]?.rc || {};
  const sp = {
    coverB: d0.coverB ?? d0.cover ?? 0.03, coverT: d0.coverT ?? d0.cover ?? 0.03,
    diaX: d0.diaX ?? d0.dia ?? 0.012, diaY: d0.diaY ?? d0.dia ?? 0.012, fyk: d0.fyk ?? 500000,
  };
  const b0 = beams[0]?.element.design?.rc || {};
  const bp = { cover: b0.cover ?? 0.03, dia: b0.dia ?? 0.02, diaStirrup: b0.diaStirrup ?? 0.01, fyk: b0.fyk ?? 500000, tBeam: b0.tBeam !== false, l0Factor: b0.l0Factor ?? 1, phiEf: b0.phiEf ?? 0 };
  if (all) body.appendChild(hintBox(t('Nichts ausgewählt – die Parameter gelten für alle Betonflächen und -balken des Modells.')));
  if (doms.length) {
    const t0 = doms[0].thickness || 0.2;
    const sketch = h('div');
    const upd = () => { sketch.innerHTML = slabSketch(surfaceLayout(sp, t0)); };
    const sec = h('div.side-section', h('div.side-section-title', ic('domain'), t('Flächen (Platten, Schalen)'), h('span.grow'), h('span.badge', doms.length)));
    sec.appendChild(h('div.small.muted', { style: { marginBottom: '8px' } }, t('Bewehrung in lokaler x- und y-Richtung der Fläche, oben und unten. Die x-Lage liegt aussen, die y-Lage innen.')));
    sec.appendChild(h('div.grid2',
      field(t('Deckung unten'), numInput({ value: sp.coverB, q: 'dim', onChange: (v) => { sp.coverB = v || 0.03; upd(); } }), { stack: true }),
      field(t('Deckung oben'), numInput({ value: sp.coverT, q: 'dim', onChange: (v) => { sp.coverT = v || 0.03; upd(); } }), { stack: true }),
      field(t('Ø x-Richtung (aussen)'), selectInput({ value: sp.diaX, options: diaOptions(code, sp.diaX), onChange: (v) => { sp.diaX = +v; upd(); } }), { stack: true }),
      field(t('Ø y-Richtung (innen)'), selectInput({ value: sp.diaY, options: diaOptions(code, sp.diaY), onChange: (v) => { sp.diaY = +v; upd(); } }), { stack: true })));
    sec.appendChild(field(t('Betonstahl'), selectInput({ value: sp.fyk, options: STEELS.map(([v, l]) => ({ value: v, label: l })), onChange: (v) => { sp.fyk = +v; } })));
    upd();
    sec.appendChild(sketch);
    sec.appendChild(h('div.small.muted', t('Schnitt mit Dicke {t} – d = statische Höhe je Lage.', { t: fmt('thick', t0) })));
    body.appendChild(sec);
  }
  if (beams.length) {
    const sec = h('div.side-section', h('div.side-section-title', ic('beam'), t('Balken und Rippen'), h('span.grow'), h('span.badge', beams.length)));
    sec.appendChild(h('div.grid2',
      field(t('Deckung (bis Bügel)'), numInput({ value: bp.cover, q: 'dim', onChange: (v) => { bp.cover = v || 0.03; } }), { stack: true }),
      field(t('Betonstahl'), selectInput({ value: bp.fyk, options: STEELS.map(([v, l]) => ({ value: v, label: l })), onChange: (v) => { bp.fyk = +v; } }), { stack: true }),
      field(t('Ø Längsbewehrung'), selectInput({ value: bp.dia, options: diaOptions(code, bp.dia), onChange: (v) => { bp.dia = +v; } }), { stack: true }),
      field(t('Ø Bügel'), selectInput({ value: bp.diaStirrup, options: diaOptions(code, bp.diaStirrup).filter((o) => o.value <= 0.016), onChange: (v) => { bp.diaStirrup = +v; } }), { stack: true })));
    sec.appendChild(h('div.side-section-title', { style: { marginTop: '10px' } }, ic('column'), t('Stützen')));
    sec.appendChild(field(t('Kriechzahl φef'), numInput({ value: bp.phiEf, min: 0, max: 5, onChange: (v) => { bp.phiEf = v ?? 0; } }),
      { help: t('Für die Krümmung schlanker Stützen (Kφ = 1 + β·φef, EN 1992-1-1 5.8.4). 0 = Kriechen vernachlässigt; typisch 1 … 2. Knicklängen: Parameter „Knicklängen“ (Ky, Kz).') }));
    sec.appendChild(h('div.side-section-title', { style: { marginTop: '10px' } }, ic('rib'), t('Plattenbalken')));
    sec.appendChild(switchInput(t('Mitwirkende Plattenbreite ansetzen (Rippe + Platte als T-Querschnitt)'), bp.tBeam, (v) => { bp.tBeam = v; }));
    sec.appendChild(field(t('Momentennullpunktabstand l0'), selectInput({ value: bp.l0Factor, options: [[1, 'l0 = 1.0·L (Einfeldträger)'], [0.85, 'l0 = 0.85·L (Endfeld)'], [0.7, 'l0 = 0.7·L (Innenfeld)'], [2, 'l0 = 2.0·L (Kragarm)']].map(([v, l]) => ({ value: v, label: t(l) })), onChange: (v) => { bp.l0Factor = +v; } }),
      { help: t('beff = bw + Σ beff,i mit beff,i = 0.2·bi + 0.1·l0 ≤ 0.2·l0 ≤ bi (EN 1992-1-1 5.3.2.1). bi wird aus dem Abstand zum Plattenrand bzw. zur nächsten Rippe ermittelt.') }));
    sec.appendChild(hintBox(t('Rippen und Balken in der Ebene einer Betonplatte werden als Plattenbalken bemessen: Rippenmoment plus Plattenmoment innerhalb der mitwirkenden Breite. Rechteckquerschnitt = Steg mit Gesamthöhe h.')));
    body.appendChild(sec);
  }
  openDialog({
    title: t('Bewehrungsparameter'), sub: code === 'SIA' ? 'SIA 262' : 'EN 1992-1-1', iconName: 'concrete', mod: 'lilac', size: 'wide', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Übernehmen'), kind: 'primary', onClick: async () => {
      const dIds = new Set(doms.map((d) => d.id)), bIds = new Set(beams.map((l) => l.id));
      st.commit(t('Bewehrungsparameter'), (m) => {
        for (const d of m.domains) if (dIds.has(d.id)) { const { cover, dia, ...rest } = d.rc || {}; d.rc = { ...rest, ...sp }; }
        for (const l of m.lines) if (bIds.has(l.id)) l.element.design = { ...(l.element.design || {}), rc: { ...bp } };
      }, { keepResults: true });
      await refreshDesigns(app);
      toast(t('Bewehrungsparameter übernommen.'), 'ok');
    } }],
  });
}

/* ---------------- provided reinforcement ---------------- */
export function rcProvidedDialog(app) {
  const st = app.store, code = codeOf(st);
  const { doms, all } = concreteTargets(st);
  if (!doms.length) return toast(t('Keine Betonflächen ausgewählt bzw. im Modell.'), 'info');
  const rc = st.results.rc;
  const sums = rc?.domains?.filter((s) => doms.some((d) => d.id === s.id)) || [];
  const req = LAYERS.map((_, j) => Math.max(0, ...sums.map((s) => s.max[j])));
  const minA = LAYERS.map((_, j) => Math.max(0, ...sums.map((s) => s.asMin[j])));
  const p0 = doms[0].rcProv || {};
  const L0 = surfaceLayout(doms[0].rc, doms[0].thickness || 0.2);
  const prov = Object.fromEntries(PROV_KEYS.map((k, j) => [k, p0[k] ? { ...p0[k] } : { dia: j % 2 ? L0.diaY : L0.diaX, s: 0 }]));
  const body = h('div');
  const render = () => {
    clear(body);
    body.appendChild(hintBox(t('Vorgegebene Grundbewehrung je Lage. Die Ergebnisanzeige „Fehlend“ zeigt dann, wo Zulagen nötig sind. Ohne Vorgabe (Abstand leer) gilt die Lage als nicht bewehrt.')));
    if (all) body.appendChild(hintBox(t('Nichts ausgewählt – gilt für alle Betonflächen.'), 'warn'));
    const grid = h('div.rc-prov-grid', h('b.small', t('Lage')), h('b.small', 'Ø'), h('b.small', t('Abstand')), h('b.small', t('vorhanden')), h('b.small', rc ? t('erf. max') : ''));
    PROV_KEYS.forEach((k, j) => {
      const a = meshArea(prov[k].dia, prov[k].s);
      const ok = !rc || a >= req[j] - 1e-9;
      grid.append(h('span.small', `${LAYERS[j]} · ${layerName(LAYERS[j])}`),
        selectInput({ value: prov[k].dia, options: diaOptions(code, prov[k].dia), onChange: (v) => { prov[k].dia = +v; render(); } }),
        numInput({ value: prov[k].s || null, q: 'dim', placeholder: '–', onChange: (v) => { prov[k].s = v || 0; render(); } }),
        h('span.small.mono', a ? fmt('reinf', a) : '–'),
        h('span.small.mono', { style: { color: ok ? 'var(--text-2)' : 'var(--danger)' } }, rc ? fmt('reinf', req[j]) + (ok ? ' ✓' : ' ✗') : ''));
    });
    body.appendChild(grid);
    body.appendChild(h('div.row', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '12px' } },
      rc ? h('button.btn.sm', { onclick: () => { PROV_KEYS.forEach((k, j) => { const m = slabSuggestion(minA[j], LAYERS[j], L0, code); prov[k] = m ? { dia: m.dia, s: m.s } : { dia: prov[k].dia, s: 0 }; }); render(); } }, ic('grid'), t('Vorschlag: Mindestbewehrung')) : null,
      rc ? h('button.btn.sm', { onclick: () => { PROV_KEYS.forEach((k, j) => { const m = slabSuggestion(req[j], LAYERS[j], L0, code); prov[k] = m ? { dia: m.dia, s: m.s } : { dia: prov[k].dia, s: 0 }; }); render(); } }, ic('sparkles'), t('Vorschlag: deckt Maximum')) : null,
      h('button.btn.sm', { onclick: () => { PROV_KEYS.forEach((k) => { prov[k].s = 0; }); render(); } }, ic('x'), t('Leeren'))));
    if (!rc) body.appendChild(hintBox(t('Tipp: Erst „Flächen bemessen“, dann zeigt dieser Dialog die erforderlichen Maxima und Vorschläge.')));
  };
  render();
  openDialog({
    title: t('Vorhandene Bewehrung'), sub: t('{n} Flächen', { n: doms.length }), iconName: 'grid', mod: 'lilac', size: 'wide', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Übernehmen'), kind: 'primary', onClick: async () => {
      const ids = new Set(doms.map((d) => d.id));
      const any = PROV_KEYS.some((k) => prov[k].s > 0);
      st.commit(t('Vorhandene Bewehrung'), (m) => {
        for (const d of m.domains) if (ids.has(d.id)) { if (any) d.rcProv = JSON.parse(JSON.stringify(prov)); else delete d.rcProv; }
      }, { keepResults: true });
      await refreshDesigns(app);
      if (st.results.rc && any) st.setResultView({ kind: 'rc', rcMode: 'miss', component: /^a[xy][bt]$/.test(st.resultView.component) ? st.resultView.component : 'axb' });
      toast(any ? t('Vorhandene Bewehrung gespeichert – Anzeige „Fehlend“ zeigt nötige Zulagen.') : t('Vorhandene Bewehrung entfernt.'), 'ok', 4500);
    } }],
  });
}

/* ---------------- cross-section sketch ---------------- */
function sectionSketch(r, sug) {
  const s = r.section;
  if (!s) return h('div');
  const bfDraw = s.bf > 0 ? Math.min(s.bf, 3.5 * s.bw) : s.bw;
  const W = 260, Hh = 230, k = Math.min((W - 40) / bfDraw, (Hh - 44) / s.h);
  const cx = W / 2, y0 = 16, bw = s.bw * k, hh = s.h * k;
  let svg = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" class="rc-sketch fixed">`;
  if (s.bf > 0) {
    const bf = bfDraw * k, hf = s.hf * k;
    svg += `<path d="M${cx - bf / 2},${y0} h${bf} v${hf} h${-(bf - bw) / 2} v${hh - hf} h${-bw} v${-(hh - hf)} h${-(bf - bw) / 2} z" class="sk-concrete"/>`;
    if (s.bf > bfDraw) svg += `<text x="${cx}" y="${y0 - 3}" text-anchor="middle" class="sk-t">beff = ${fmt('len', s.bf)} (${t('gekürzt gezeichnet')})</text>`;
    else svg += `<text x="${cx}" y="${y0 - 3}" text-anchor="middle" class="sk-t">${s.shape === 'T' && r.tBeam ? 'beff' : 'b'} = ${fmt('dim', s.bf)}</text>`;
  } else svg += `<rect x="${cx - bw / 2}" y="${y0}" width="${bw}" height="${hh}" class="sk-concrete"/>`;
  // stirrup
  const c = s.cover * k, ds = s.diaStirrup * k;
  svg += `<rect x="${cx - bw / 2 + c}" y="${y0 + c}" width="${bw - 2 * c}" height="${hh - 2 * c}" rx="${2 + ds}" class="sk-stirrup" stroke-width="${Math.max(1.5, ds)}"/>`;
  // bars in layers (dir = −1: rows grow upwards from the bottom, +1: downwards from the top)
  const bars = (b, y, dir) => {
    if (!b) return '';
    const r0 = Math.max(2.5, b.dia * k / 2), span = bw - 2 * (c + ds) - 2 * r0;
    const per = Math.ceil(b.n / (b.layers || 1));
    let out = '';
    for (let i = 0; i < b.n; i++) {
      const row = Math.floor(i / per), m = Math.min(per, b.n - row * per), j = i - row * per;
      out += `<circle cx="${cx - span / 2 + (m > 1 ? (span * j) / (m - 1) : span / 2)}" cy="${y + dir * row * (2 * r0 + Math.max(2 * r0, 0.02 * k))}" r="${r0}" class="sk-bar-y"/>`;
    }
    return out;
  };
  const rb = (sug.bot?.dia || s.dia) * k / 2, rt = (sug.top?.dia || s.dia) * k / 2;
  svg += bars(sug.bot, y0 + hh - c - ds - Math.max(2.5, rb), -1);
  svg += bars(sug.top, y0 + c + ds + Math.max(2.5, rt), 1);
  svg += `<text x="${cx + bw / 2 + 6}" y="${y0 + hh / 2}" class="sk-t">h = ${fmt('dim', s.h)}</text>`;
  svg += `<text x="${cx}" y="${y0 + hh + 14}" text-anchor="middle" class="sk-t">bw = ${fmt('dim', s.bw)}</text>`;
  svg += '</svg>';
  return h('div', { html: svg });
}

const maxOf = (a) => Math.max(0, ...(a || []).filter(Number.isFinite));

/* ---------------- RC beam detail ---------------- */
export function rcBeamDetail(app, lineId) {
  const st = app.store, code = codeOf(st);
  const r = (st.results.rcBeams || []).find((b) => b.line === lineId);
  if (!r) {
    if (!st.results.rcBeams) return runDesign(app, 'rcBeam').then((ok) => ok && rcBeamDetail(app, lineId));
    return toast(t('Stab {id} ist kein bemessener Betonbalken (Material Beton, Querschnitt Rechteck oder T).', { id: lineId }), 'info');
  }
  const sug = beamSuggestion(r, code);
  const s = r.section || {};
  const left = h('div', { style: { minWidth: 0 } });
  if (r.env) {
    left.appendChild(chart({ xs: r.x, title: r.tBeam ? t('My Plattenbalken (Umhüllende) · gestrichelt: nur Rippe') : t('My (Umhüllende)'), q: 'moment', invert: true,
      series: [{ ys: r.env.MyMax, cls: 'm', fill: true }, { ys: r.env.MyMin, cls: 'm2', fill: true, label: 'min' }, ...(r.tBeam ? [{ ys: r.env.MyRibMax, cls: 'rib', dash: true, noLabel: true }, { ys: r.env.MyRibMin, cls: 'rib', dash: true, noLabel: true }] : [])] }));
    left.appendChild(chart({ xs: r.x, title: t('|VEd| (Umhüllende)'), q: 'force', height: 100, series: [{ ys: r.env.V, cls: 'v', fill: true, label: 'max' }] }));
  }
  left.appendChild(chart({ xs: r.x, title: t('Erforderliche Bewehrung unten As,unten · grün: Vorschlag'), q: 'reinfBeam', height: 100,
    series: [{ ys: r.AsBot, cls: 'bot', fill: true, label: 'max' }], hlines: sug.bot ? [{ v: sug.bot.area, label: barsText(sug.bot) }] : [] }));
  left.appendChild(chart({ xs: r.x, title: t('Erforderliche Bewehrung oben As,oben · grün: Vorschlag'), q: 'reinfBeam', height: 100,
    series: [{ ys: r.AsTop, cls: 'top', fill: true, label: 'max' }], hlines: sug.top ? [{ v: sug.top.area, label: barsText(sug.top) }] : [] }));
  left.appendChild(chart({ xs: r.x, title: t('Bügelbewehrung asw'), q: 'reinf', height: 100, series: [{ ys: r.Asw, cls: 'v', fill: true, label: 'max' }],
    hlines: sug.stirrups ? [{ v: sug.stirrups.area, label: stirrupText(sug.stirrups) }] : [] }));
  const kv = (rows) => h('div.res-max', rows.map(([a, b]) => h('div.r', h('span', a), h('b', b))));
  const right = h('div', { style: { minWidth: 0 } },
    sectionSketch(r, sug),
    kv([
      [t('Querschnitt'), r.tBeam ? t('Plattenbalken') : s.shape === 'T' ? t('T-Querschnitt') : t('Rechteck')],
      ...(r.tBeam ? [['beff', `${fmt('len', r.tBeam.beff)} (${r.tBeam.sides.map((sd) => fmt('len', sd.beffI, { unit: false })).join(' + ')} + bw)`], ['hf', fmt('dim', r.tBeam.hf)], ['l0', fmt('len', r.tBeam.l0)]] : []),
      ['d', fmt('dim', r.d)], ['z = 0.9·d', fmt('dim', r.z || 0.9 * r.d)],
      [t('Betondeckung'), fmt('dim', s.cover)],
      ['fcd / fsd', `${fmt('stress', r.P?.fcd)} / ${fmt('stress', r.P?.fyd)}`],
    ]),
    h('h4', t('Bewehrungsvorschlag')),
    kv([
      [t('unten'), `${fmt('reinfBeam', maxOf(r.AsBot))} → ${barsText(sug.bot)}`],
      [t('oben'), `${fmt('reinfBeam', maxOf(r.AsTop))} → ${barsText(sug.top)}`],
      [t('Bügel'), `${fmt('reinf', maxOf(r.Asw))} → ${stirrupText(sug.stirrups)}`],
      ...(r.asMin ? [[t('As,min unten / oben'), `${fmt('reinfBeam', r.asMin.bot)} / ${fmt('reinfBeam', r.asMin.top)}`]] : []),
    ]));
  const notes = h('div', { style: { marginTop: '10px' } }, ...(r.notes || []).map((n) => hintBox(designMessage(n), /exceeded|not possible|too small|Druckbewehrung|As > /i.test(n) ? 'warn' : '')));
  const body = h('div', h('div.rc-detail', left, right), notes,
    h('div.small.muted', { style: { marginTop: '6px' } }, t('Bemessung über alle Kombinationen der Bemessungsbasis: {b}. Bewehrungsvorschlag gilt für das Maximum über die ganze Stablänge (ohne Abstufung).', { b: st.results.designBasis?.basis || '' })));
  openDialog({
    title: t('Stahlbetonbalken {id}', { id: r.line }), sub: (r.ok === false ? t('nicht erfüllt') : t('erfüllt')) + ' · ' + (code === 'SIA' ? 'SIA 262' : 'EN 1992-1-1'),
    iconName: 'beam', mod: 'lilac', size: 'xwide', body,
    buttons: [{ label: t('Im Modell zeigen'), icon: 'target', onClick: () => { st.select({ lines: [r.line] }, 'replace'); app.zoomSelection(); } }, { label: t('Schliessen'), kind: 'primary' }],
  }).el.style.height = 'auto';
}

/* ---------------- steel / timber member detail ---------------- */
export function memberDetail(app, kind, lineId) {
  const st = app.store;
  const list = kind === 'timber' ? st.results.timber : st.results.steel;
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

/* ---------------- design protocol ---------------- */
function meshPoint(st, k) {
  const mesh = st.results.mesh;
  if (!mesh || k < 0) return '';
  const nd = mesh.shells[Math.floor(k / 4)].nodes[k % 4];
  const id = mesh.nodeModelId?.[nd];
  const p = [0, 1, 2].map((i) => fmtNum(mesh.nodes[3 * nd + i], 3));
  return id > 0 ? t('Knoten {id}', { id }) : `(${p.join('; ')})`;
}

export function rcProtocolDialog(app) {
  const st = app.store, R = st.results, code = codeOf(st);
  if (!R.rc && !R.rcBeams && !R.rcCols) {
    return runDesign(app, 'rc').then((ok) => ok && rcProtocolDialog(app));
  }
  const norm = code === 'SIA' ? 'SIA 262' : 'EN 1992-1-1';
  const keys = R.rc?.keys || R.designBasis?.keys || [];
  const show = (patch) => { d.close(); st.setResultView({ kind: 'rc', ...patch }); app.showSide('results'); };
  const body = h('div.rc-protocol');
  body.appendChild(h('div.hint-box', ic('info'), h('div.grow',
    h('b', t('Was wurde berechnet?')),
    h('ol.small', { style: { margin: '6px 0 0', paddingLeft: '18px', lineHeight: 1.6 } },
      h('li', t('Schnittgrössen nx, ny, nxy, mx, my, mxy, vx, vy aus der linearen Statik für jede Bemessungskombination ({n}: {list}).', { n: keys.length, list: keys.slice(0, 6).map((k) => caseLabel(st, k)).join(', ') + (keys.length > 6 ? ' …' : '') })),
      h('li', t('Bemessungsmomente nach Wood-Armer je Richtung und Seite (mxD, myD unten/oben); bei Schalen zusätzlich Normalkräfte.')),
      h('li', t('Biegebemessung je Lage (axb, ayb, axt, ayt) mit Spannungsblock, Druckbewehrung falls x/d zu gross.')),
      h('li', t('Mindestbewehrung in Lagen mit Zugbeanspruchung; Maximum über alle Kombinationen.')),
      h('li', t('Querkraft ohne Schubbewehrung: vEd ≤ vRd,c (ausser im Durchstanzbereich um Stützen).')),
      h('li', t('Durchstanzen an Stützen und Punktlagern; Plattenbalken: Rippe + mitwirkende Plattenbreite.')),
      h('li', t('Nicht nachgewiesen: Rissbreiten, Verformungen im gerissenen Zustand, Bemessung der Durchstanz- und Schubbewehrung, Verankerung.')))),
  ));
  // surfaces
  for (const s of R.rc?.domains || []) {
    const mat = st.idx.materials.get(s.material);
    const L = s.layout;
    const card = h('div.side-section', h('div.side-section-title', ic('domain'), t('Fläche {id}', { id: s.id }), h('span.muted.small', ` · ${t({ plate: 'Platte', shell: 'Schale', membrane: 'Scheibe' }[s.type] || s.type)} · ${fmt('thick', s.t)} · ${mat?.name || ''}`), h('span.grow'),
      h('button.btn.sm', { onclick: () => { d.close(); st.select({ domains: [s.id] }, 'replace'); app.zoomSelection(); } }, ic('target'), t('Zeigen'))));
    card.appendChild(h('div.small.muted', { style: { marginBottom: '6px' } },
      `fcd = ${fmt('stress', s.fcd)} · fsd = ${fmt('stress', s.fyd)} · ${t('Deckung')} ${t('unten')}/${t('oben')} ${fmt('dim', L.coverB)}/${fmt('dim', L.coverT)} · Ø x/y ${mm(L.diaX)}/${mm(L.diaY)} mm`));
    const tbl = h('table.tbl', h('thead', h('tr', ...[t('Lage'), 'd', 'as,min', t('erf. max'), t('Ort'), t('massgebend'), t('Vorschlag'), t('vorhanden'), ''].map((x) => h('th', x)))));
    const tb = h('tbody');
    LAYERS.forEach((lay, j) => {
      const sug = slabSuggestion(s.max[j], lay, L, code);
      const pv = s.prov ? s.prov[j] : 0;
      const miss = s.prov && pv < s.max[j] - 1e-9;
      tb.appendChild(h('tr',
        h('td', h('b', lay), ' ', h('span.muted', layerName(lay))),
        h('td.mono', fmt('dim', L.d[lay.slice(1)])),
        h('td.mono', fmt('reinf', s.asMin[j])),
        h('td.mono', h('b', fmt('reinf', s.max[j])), s.minGoverns[j] && s.max[j] <= s.asMin[j] * 1.0001 ? h('span.badge', { style: { marginLeft: '4px' } }, 'min') : null),
        h('td.small', meshPoint(st, s.maxAt[j])),
        h('td.small', s.maxCase[j] >= 0 ? caseLabel(st, keys[s.maxCase[j]]) : '–'),
        h('td.mono', s.max[j] > 0 ? `${meshText(sug)} (${fmt('reinf', sug?.area, { unit: false })})` : '–'),
        h('td.mono', { style: { color: miss ? 'var(--danger)' : '' } }, s.prov ? fmt('reinf', pv) + (miss ? ' ✗' : ' ✓') : '–'),
        h('td', h('button.icon-btn.sm', { onclick: () => show({ component: lay, rcMode: 'req' }), tip: [t('Im 3D-Fenster zeigen')] }, ic('eye')))));
    });
    tbl.appendChild(tb);
    card.appendChild(h('div.tbl-wrap', tbl));
    const flags = [];
    flags.push(hintBox(s.vMax > 1
      ? t('Querkraft: max. vEd/vRd,c = {r} → Schubbewehrung erforderlich an {n} Punkten ({norm}).', { r: fmtNum(s.vMax, 3), n: s.nShear, norm })
      : t('Querkraft: max. vEd/vRd,c = {r} – ohne Schubbewehrung erfüllt ({norm}).', { r: fmtNum(s.vMax, 3), norm }), s.vMax > 1 ? 'warn' : 'ok'));
    if (s.nComp) flags.push(hintBox(t('Druckbewehrung an {n} Punkten erforderlich – Dicke prüfen.', { n: s.nComp }), 'warn'));
    if (s.nMax) flags.push(hintBox(t('As > As,max an {n} Punkten – Platte zu dünn.', { n: s.nMax }), 'err'));
    card.append(...flags);
    body.appendChild(card);
  }
  // punching
  const P = R.punching?.items || [];
  if (P.length) {
    const card = h('div.side-section', h('div.side-section-title', ic('target'), t('Durchstanzen'), h('span.muted.small', ` · ${code === 'SIA' ? 'SIA 262 4.3.6' : 'EN 1992-1-1 6.4'}`), h('span.grow'),
      h('button.btn.sm', { onclick: () => show({ component: 'punch' }) }, ic('eye'), t('Anzeigen'))));
    const tbl = h('table.tbl', h('thead', h('tr', ...[t('Knoten'), t('Lage'), t('Stütze'), 'd', 'VEd', code === 'SIA' ? 'ke' : 'β', code === 'SIA' ? 'VRd,c' : 'vEd / vRd,c', 'η', t('Ergebnis')].map((x) => h('th', x)))));
    const tb = h('tbody');
    for (const it of [...P].sort((a, b) => b.eta - a.eta)) {
      tb.appendChild(h('tr',
        h('td', it.node), h('td.small', t(POS_NAMES[it.type])),
        h('td.small', it.round ? `Ø ${fmt('dim', it.c1)}` : `${mm(it.c1)}×${mm(it.c2)}`),
        h('td.mono', fmt('dim', it.d)), h('td.mono', fmt('force', it.VEd)), h('td.mono', fmtNum(it.factor, 3)),
        h('td.mono', code === 'SIA' ? fmt('force', it.vRd) : `${fmtNum(it.v / 1000, 3)} / ${fmtNum(it.vRd / 1000, 3)} N/mm²`),
        h('td.mono', { style: { color: it.eta > 1 ? 'var(--danger)' : 'var(--success)' } }, (it.eta * 100).toFixed(0) + ' %'),
        h('td.small', it.fail ? t('Platte verstärken / Stütze vergrössern') : it.needsReinf ? t('Durchstanzbewehrung erforderlich') : t('ohne Bewehrung erfüllt'))));
    }
    tbl.appendChild(tb);
    card.appendChild(h('div.tbl-wrap', tbl));
    card.appendChild(h('div.small.muted', code === 'SIA'
      ? t('Nachweisschnitt im Abstand dv/2, u reduziert mit ke; kr aus ψ nach Näherungsstufe 1 (rs = 0.22·L). Lasten innerhalb des Nachweisschnitts nicht abgezogen.')
      : t('Kritischer Rundschnitt im Abstand 2d, β nach Bild 6.21N; ρl aus der oberen Bewehrung an der Stütze. Lasten innerhalb des Rundschnitts nicht abgezogen.')));
    body.appendChild(card);
  }
  // beams
  const B = R.rcBeams || [];
  if (B.length) {
    const card = h('div.side-section', h('div.side-section-title', ic('beam'), t('Balken und Rippen')));
    const tbl = h('table.tbl', h('thead', h('tr', ...[t('Stab'), t('Querschnitt'), t('As unten'), t('As oben'), t('Bügel'), t('Ergebnis'), ''].map((x) => h('th', x)))));
    const tb = h('tbody');
    for (const r of B) {
      const sug = beamSuggestion(r, code);
      tb.appendChild(h('tr',
        h('td', r.line),
        h('td.small', r.tBeam ? `${t('Plattenbalken')} beff ${fmt('len', r.tBeam.beff)}` : `${mm(r.b)}×${mm(r.h)}`),
        h('td.mono', `${fmt('reinfBeam', maxOf(r.AsBot))} → ${barsText(sug.bot)}`),
        h('td.mono', `${fmt('reinfBeam', maxOf(r.AsTop))} → ${barsText(sug.top)}`),
        h('td.mono', stirrupText(sug.stirrups)),
        h('td', { style: { color: r.ok === false ? 'var(--danger)' : 'var(--success)' } }, r.ok === false ? '✗' : '✓'),
        h('td', h('button.btn.sm', { onclick: () => { d.close(); rcBeamDetail(app, r.line); } }, t('Details')))));
    }
    tbl.appendChild(tb);
    card.appendChild(h('div.tbl-wrap', tbl));
    body.appendChild(card);
  }
  // columns
  const Cs = R.rcCols || [];
  if (Cs.length) {
    const card = h('div.side-section', h('div.side-section-title', ic('column'), t('Stützen'), h('span.muted.small', ` · ${code === 'SIA' ? t('Modellstütze, Nennkrümmung (Näherung zu SIA 262 4.3.7)') : 'EN 1992-1-1 5.8.8 / 5.8.9'}`)));
    const tbl = h('table.tbl', h('thead', h('tr', ...[t('Stab'), t('Querschnitt'), 'λy / λz', 'NEd', 'MEd,y / MEd,z', t('As erf.'), t('Vorschlag'), 'η', ''].map((x) => h('th', x)))));
    const tb = h('tbody');
    for (const c of Cs) {
      const g = c.governing || {};
      tb.appendChild(h('tr',
        h('td', c.line), h('td.small', c.shape === 'CIRC' ? `Ø${Math.round(c.D * 1000)}` : `${Math.round(c.b * 1000)}×${Math.round(c.h * 1000)}`),
        h('td.mono', `${Math.round(c.lambda?.y || 0)}${c.slender?.y ? '*' : ''} / ${Math.round(c.lambda?.z || 0)}${c.slender?.z ? '*' : ''}`),
        h('td.mono', fmt('force', g.NEd ?? 0)), h('td.mono', `${fmt('moment', g.MEdy ?? 0, { unit: false })} / ${fmt('moment', g.MEdz ?? 0)}`),
        h('td.mono', fmt('reinfBeam', c.As)), h('td.mono', c.bars ? `${c.bars.n} Ø${Math.round(c.bars.dia * 1000)}` : '–'),
        h('td.mono', { style: { color: c.ok === false || c.eta > 1 ? 'var(--danger)' : 'var(--success)' } }, ((c.eta || 0) * 100).toFixed(0) + ' %'),
        h('td', h('button.btn.sm', { onclick: () => { d.close(); columnDetail(app, c.line); } }, t('Details')))));
    }
    tbl.appendChild(tb);
    card.appendChild(h('div.tbl-wrap', tbl));
    card.appendChild(h('div.small.muted', t('* schlank: Momente nach Theorie II. Ordnung (Nennkrümmung) berücksichtigt. Imperfektion ei = l0/400 je Richtung einzeln.')));
    body.appendChild(card);
  }
  const warns = [...(R.rc?.warnings || []), ...(R.rcBeams?.warnings || []), ...(R.rcCols?.warnings || []), ...(R.punching?.warnings || [])].filter((w) => !/vEd > vRd,c/.test(w));
  if (warns.length) body.appendChild(h('div.side-section', h('div.side-section-title', ic('alert'), t('Hinweise')), ...warns.slice(0, 12).map((w) => hintBox(designMessage(w), 'warn'))));
  const d = openDialog({
    title: t('Bemessungsprotokoll Stahlbeton'), sub: `${norm} · ${R.designBasis?.basis || ''}`, iconName: 'fileText', mod: 'lilac', size: 'xwide', body,
    buttons: [{ label: t('Bewehrungsparameter'), icon: 'concrete', onClick: () => rcParamsDialog(app) }, { label: t('Schliessen'), kind: 'primary' }],
  });
}


/* ---------------- design trace at a surface point ---------------- */
// Nearest designed shell corner of a domain to a 3D point → { e, c } or null
export function nearestCorner(mesh, domainId, p) {
  let best = null, bd = Infinity;
  mesh.shells.forEach((s, e) => {
    if (s.domain !== domainId) return;
    s.nodes.forEach((nd, c) => {
      const d = (mesh.nodes[3 * nd] - p[0]) ** 2 + (mesh.nodes[3 * nd + 1] - p[1]) ** 2 + (mesh.nodes[3 * nd + 2] - p[2]) ** 2;
      if (d < bd) { bd = d; best = { e, c, nd }; }
    });
  });
  return best;
}

export function rcPointDialog(app, e, c) {
  const st = app.store, R = st.results;
  const det = rcSurfaceDetail(st.model, R.mesh, R.static, R.rc?.keys || R.designBasis?.keys, e, c, { code: st.model.settings.code });
  if (!det) return toast(t('An dieser Stelle wurde nicht bemessen (kein Beton).'), 'info');
  const code = codeOf(st), L = det.layout;
  const where = meshPoint(st, e * 4 + c);
  const tbl = h('table.tbl', h('thead', h('tr', ...[t('Kombination'), 'mx', 'my', 'mxy', 'nx', 'ny', 'mxD ↓', 'myD ↓', 'mxD ↑', 'myD ↑', 'axb', 'ayb', 'axt', 'ayt'].map((x) => h('th', x)))));
  const tb = h('tbody');
  for (const cs of det.cases) {
    const gov = (j) => det.gov[j] === cs.key;
    tb.appendChild(h('tr',
      h('td.txt', caseLabel(st, cs.key)),
      ...[3, 4, 5].map((k) => h('td', fmt('lineMoment', cs.f[k], { unit: false }))),
      ...[0, 1].map((k) => h('td', fmt('lineForce', cs.f[k], { unit: false }))),
      ...[cs.wa.mxb, cs.wa.myb, cs.wa.mxt, cs.wa.myt].map((v) => h('td', fmt('lineMoment', v, { unit: false }))),
      ...cs.as.map((v, j) => h('td', { style: gov(j) ? { fontWeight: 700, color: 'var(--accent)' } : {} }, fmt('reinf', v, { unit: false })))));
  }
  tbl.appendChild(tb);
  const kv = (rows) => h('div.res-max', rows.map(([a, b]) => h('div.r', h('span', a), h('b', b))));
  const res = LAYERS.map((lay, j) => {
    const sug = slabSuggestion(det.as[j], lay, L, code);
    return [`${lay} · ${layerName(lay)}`, `${fmt('reinf', det.as[j])}${det.minGoverns[j] ? ' (' + t('Mindestbewehrung') + ')' : ''}${sug ? ' → ' + meshText(sug) : ''}`];
  });
  const body = h('div',
    h('div.small.muted', { style: { marginBottom: '8px' } }, `${t('Fläche {id}', { id: det.domain })} · ${where} · ${t('Einheiten')}: kNm/m, kN/m, cm²/m · ↓ ${t('unten')}, ↑ ${t('oben')}`),
    h('div.grid2', { style: { alignItems: 'start', gap: '18px' } },
      h('div', h('h4', t('Ergebnis an diesem Punkt')), kv(res),
        det.shear ? hintBox(t('Querkraft: vEd = {v} ≤ vRd,c = {r}? → {res} (d = {d}, ρl = {p} %)', { v: fmt('lineForce', det.shear.vEd), r: fmt('lineForce', det.shear.vRd), res: det.shear.ratio <= 1 ? t('erfüllt') : t('Schubbewehrung erforderlich'), d: fmt('dim', det.shear.d), p: fmtNum(det.shear.rhoL * 100, 3) }), det.shear.ratio <= 1 ? 'ok' : 'warn') : null),
      h('div', h('h4', t('Bemessungsgrundlagen')), kv([
        ['fcd / fsd', `${fmt('stress', det.P.fcd)} / ${fmt('stress', det.P.fyd)}`],
        [t('Dicke'), fmt('thick', L.t)],
        ['d xb / yb / xt / yt', `${mm(L.d.xb)} / ${mm(L.d.yb)} / ${mm(L.d.xt)} / ${mm(L.d.yt)} mm`],
        ['as,min x / y', `${fmt('reinf', det.min[0])} / ${fmt('reinf', det.min[1])}`],
      ]))),
    h('h4', t('Je Kombination (Wood-Armer-Bemessungsmomente und erforderliche Bewehrung)')),
    h('div.tbl-wrap', tbl),
    h('div.small.muted', { style: { marginTop: '6px' } }, t('Fett: massgebende Kombination je Lage. Wood-Armer: mxD = mx ± |mxy| (bzw. Korrektur bei negativem Gegenmoment).')));
  openDialog({ title: t('Bemessung an einem Punkt'), sub: code === 'SIA' ? 'SIA 262' : 'EN 1992-1-1', iconName: 'concrete', mod: 'lilac', size: 'xwide', body, buttons: [{ label: t('Schliessen'), kind: 'primary' }] }).el.style.height = 'auto';
}

/* ---------------- RC columns ---------------- */
// N-M interaction diagram: x = M (≥ 0), y = N (compression downwards), design points as dots
function interactionSvg(curve, pts, axis, title) {
  const W = 300, H = 260, pad = 34;
  if (!curve?.length) return h('div');
  const Ms = curve.map((p) => p[1]).concat(pts.map((p) => p.M)), Ns = curve.map((p) => p[0]).concat(pts.map((p) => p.N), [0]);
  const mMax = Math.max(1e-9, ...Ms) * 1.08, nMin = Math.min(...Ns), nMax = Math.max(...Ns);
  const X = (m) => pad + (m / mMax) * (W - pad - 10);
  const Y = (n) => 14 + ((n - nMax) / (nMin - nMax || 1)) * (H - 40);
  const poly = curve.map(([n, m]) => `${X(m).toFixed(1)},${Y(n).toFixed(1)}`).join(' ');
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="rc-sketch fixed"><text x="4" y="11" class="ch-title">${title}</text>`;
  svg += `<line x1="${X(0)}" x2="${X(mMax)}" y1="${Y(0)}" y2="${Y(0)}" class="ch-axis"/><line x1="${X(0)}" x2="${X(0)}" y1="${Y(nMax)}" y2="${Y(nMin)}" class="ch-axis"/>`;
  svg += `<polygon points="${X(0)},${Y(curve[0][0])} ${poly} ${X(0)},${Y(curve[curve.length - 1][0])}" class="ch-fill v"/><polyline points="${poly}" class="ch-line v"/>`;
  for (const p of pts) svg += `<circle cx="${X(p.M)}" cy="${Y(p.N)}" r="3.5" class="${p.gov ? 'nm-gov' : 'nm-pt'}"/>`;
  svg += `<text x="${X(mMax)}" y="${Y(0) - 4}" text-anchor="end" class="ch-x">M [kNm]</text><text x="${X(0) + 4}" y="${Y(nMin) - 2}" class="ch-x">N ${fmt('force', nMin, { unit: false })}</text>`;
  svg += `<text x="${X(0) + 4}" y="${Y(nMax) + 10}" class="ch-x">${fmt('force', nMax, { unit: false })}</text></svg>`;
  return h('div', { html: svg });
}

function columnSketch(r) {
  const W = 220, H = 220, size = r.shape === 'CIRC' ? r.D : Math.max(r.b, r.h), k = (W - 50) / size;
  const cx = W / 2, cy = H / 2;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="rc-sketch fixed">`;
  const c = (r.cover + r.diaStirrup) * k;
  const db = (r.bars?.dia || r.dia || 0.02) * k / 2;
  const pos = [];
  if (r.shape === 'CIRC') {
    const R = r.D * k / 2;
    svg += `<circle cx="${cx}" cy="${cy}" r="${R}" class="sk-concrete"/><circle cx="${cx}" cy="${cy}" r="${R - r.cover * k}" class="sk-stirrup" stroke-width="${Math.max(1.5, r.diaStirrup * k)}"/>`;
    const n = r.bars?.n || 6, rr = R - c - db;
    for (let i = 0; i < n; i++) pos.push([cx + rr * Math.cos((2 * Math.PI * i) / n), cy + rr * Math.sin((2 * Math.PI * i) / n)]);
    svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="sk-t">D = ${fmt('dim', r.D)}</text>`;
  } else {
    // drawing: horizontal = local y (b), vertical = local z (h)
    const bw = r.b * k, hh = r.h * k, x0 = cx - bw / 2, y0 = cy - hh / 2;
    svg += `<rect x="${x0}" y="${y0}" width="${bw}" height="${hh}" class="sk-concrete"/>`;
    svg += `<rect x="${x0 + r.cover * k}" y="${y0 + r.cover * k}" width="${bw - 2 * r.cover * k}" height="${hh - 2 * r.cover * k}" rx="3" class="sk-stirrup" stroke-width="${Math.max(1.5, r.diaStirrup * k)}"/>`;
    // bars: corners + evenly on the faces (perimeter walk)
    const n = r.bars?.n || 4, xa = x0 + c + db, xb = x0 + bw - c - db, ya = y0 + c + db, yb = y0 + hh - c - db;
    const per = 2 * ((xb - xa) + (yb - ya));
    const nb = Math.max(4, n);
    const nx = Math.max(2, Math.round(((xb - xa) / per) * nb / 2) + 1), ny = Math.max(2, nb / 2 - nx + 2);
    for (let i = 0; i < nx; i++) { const x = xa + ((xb - xa) * i) / (nx - 1); pos.push([x, ya], [x, yb]); }
    for (let j = 1; j < ny - 1; j++) { const y = ya + ((yb - ya) * j) / (ny - 1); pos.push([xa, y], [xb, y]); }
    svg += `<text x="${cx}" y="${y0 + hh + 14}" text-anchor="middle" class="sk-t">b = ${fmt('dim', r.b)} (y)</text>`;
    svg += `<text x="${x0 + bw + 4}" y="${cy}" class="sk-t">h = ${fmt('dim', r.h)} (z)</text>`;
  }
  // actual layout of the design (bar coordinates y/z about the centroid; drawing: y right, z up)
  const bars = r.section?.bars;
  const list = bars?.length ? bars.map((bb) => [cx + bb.y * k, cy - bb.z * k]) : pos;
  for (const [x, y] of list) svg += `<circle cx="${x}" cy="${y}" r="${Math.max(2.5, db)}" class="sk-bar-y"/>`;
  return h('div', { html: svg + '</svg>' });
}

export function columnDetail(app, lineId) {
  const st = app.store, code = codeOf(st);
  const r = (st.results.rcCols || []).find((c) => c.line === lineId);
  if (!r) {
    if (!st.results.rcCols) return runDesign(app, 'rcCol').then((ok) => ok && columnDetail(app, lineId));
    return toast(t('Stab {id} ist keine bemessene Stahlbetonstütze.', { id: lineId }), 'info');
  }
  const g = r.governing || {};
  const pts = (axis) => (r.points || []).map((p) => ({ N: p.NEd, M: Math.abs(axis === 'y' ? p.MEdy : p.MEdz), gov: p.caseKey === g.caseKey && (!g.imp || p.imp === g.imp) }));
  const lim = (v) => (Number.isFinite(v) ? fmtNum(v, 3) : '–');
  const kv = (rows) => h('div.res-max', rows.map(([a, b]) => h('div.r', h('span', a), h('b', b))));
  const ax = (k) => [
    [`l0,${k}`, fmt('len', k === 'y' ? r.l0y : r.l0z)],
    [`λ${k} / λlim`, `${fmtNum(r.lambda?.[k] ?? 0, 3)} / ${lim(r.lambdaLim?.[k])} → ${r.slender?.[k] ? t('schlank') : t('gedrungen')}`],
    [`M0${k} + N·ei`, fmt('moment', (k === 'y' ? g.M0y : g.M0z) ?? 0)],
    [`M2${k} (${t('Theorie II. Ordnung')})`, fmt('moment', (k === 'y' ? g.M2y : g.M2z) ?? 0)],
    [`MEd,${k}`, fmt('moment', (k === 'y' ? g.MEdy : g.MEdz) ?? 0)],
  ];
  const left = h('div', { style: { minWidth: 0 } },
    h('div.row', { style: { gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start' } },
      interactionSvg(r.curve?.y, pts('y'), 'y', t('N-My-Interaktion (Biegung um y)')),
      interactionSvg(r.curve?.z, pts('z'), 'z', t('N-Mz-Interaktion (Biegung um z)'))),
    h('div.small.muted', { style: { margin: '4px 0 10px' } }, t('Kurve: Widerstand mit der vorgeschlagenen Bewehrung; Punkte: Bemessungsschnittgrössen je Kombination (inkl. Imperfektion und Theorie II. Ordnung), gross: massgebend. Zweiachsig: (MEdz/MRdz)^a + (MEdy/MRdy)^a ≤ 1.')),
    h('div.grid2', { style: { alignItems: 'start', gap: '14px' } }, kv(ax('y')), kv(ax('z'))));
  const right = h('div', { style: { minWidth: 0 } }, columnSketch(r),
    kv([
      [t('Querschnitt'), r.shape === 'CIRC' ? `Ø ${fmt('dim', r.D)}` : `${Math.round(r.b * 1000)} × ${Math.round(r.h * 1000)} mm`],
      ['NEd', fmt('force', g.NEd ?? 0)],
      [t('massgebend'), caseLabel(st, g.caseKey)],
      [t('As erforderlich'), fmt('reinfBeam', r.As)],
      ['As,min / As,max', `${fmt('reinfBeam', r.AsMin, { unit: false })} / ${fmt('reinfBeam', r.AsMax)}`],
      [t('Vorschlag'), r.bars ? `${r.bars.n} Ø${Math.round(r.bars.dia * 1000)} (${fmt('reinfBeam', r.bars.area)})` : '–'],
      [t('Ausnutzung η'), `${((r.eta || 0) * 100).toFixed(0)} %`],
    ]));
  const named = (txt) => txt.replace(/\b(CO|LC|ENV):\w+/g, (k) => caseLabel(st, k)); // case keys → names
  const notes = h('div', { style: { marginTop: '10px' } }, ...(r.notes || []).map((n) => hintBox(named(designMessage(n)), /exceed|not possible|too small|As,max/i.test(n) ? 'warn' : '')));
  openDialog({
    title: t('Stahlbetonstütze {id}', { id: r.line }), sub: (r.ok === false || r.eta > 1 ? t('nicht erfüllt') : t('erfüllt')) + ' · ' + (code === 'SIA' ? 'SIA 262' : 'EN 1992-1-1'),
    iconName: 'column', mod: 'lilac', size: 'xwide', body: h('div', h('div.rc-detail', left, right), notes),
    buttons: [{ label: t('Im Modell zeigen'), icon: 'target', onClick: () => { st.select({ lines: [r.line] }, 'replace'); app.zoomSelection(); } }, { label: t('Schliessen'), kind: 'primary' }],
  }).el.style.height = 'auto';
}
