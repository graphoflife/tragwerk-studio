// Side panel: properties of selection / tool, model browser and result controls.
import { t } from '../i18n.js';
import { h, ic, field, numInput, selectInput, segmented, switchInput, hintBox, section } from './dom.js';
import { P, lineLength, domainAxes, polygonArea, defaultLineElement, modelStats } from '../core/model.js';
import { fmt, fmtNum } from '../core/units.js';
import { openMaterials, openSections, openLoadCases, openCombinations } from './dialogs/manage.js';
import { editReleases, supportDialog, designParams } from './dialogs/assign.js';
import { nodeLoadDialog, lineLoadDialog, surfaceLoadDialog, describeLoad } from './dialogs/loads.js';
import { runStatic, runModalDialog, runBucklingDialog, runDesign } from './dialogs/analysis.js';
import { COMPONENTS, DESIGN_COMPONENTS, caseOptions, caseSummary, componentDef } from './results-data.js';
import { PALETTE_NAMES } from './vp-util.js';
import { pointKeys } from './pointinput.js';

const TYPE_LABEL = { beam: 'Balken', truss: 'Fachwerkstab', rib: 'Rippe', rigid: 'Starrstab', spring: 'Feder', plate: 'Platte', shell: 'Schale', membrane: 'Scheibe' };
const MAT_COLORS = { steel: 'var(--p-sky)', concrete: 'var(--p-slate)', timber: 'var(--p-peach)', aluminium: 'var(--p-teal)', other: 'var(--p-lilac)' };

export function renderSide(app, el, tab) {
  if (tab === 'props') renderProps(app, el);
  else if (tab === 'model') renderModel(app, el);
  else renderResults(app, el);
}

/* ======================================================================
   Properties
   ====================================================================== */
function matOptions(store, type) {
  const list = store.model.materials.filter((m) => !type || m.type === type || type === 'any');
  return list.length ? list.map((m) => ({ value: m.id, label: m.name })) : [{ value: '', label: t('– kein Material –') }];
}
function secOptions(store) {
  return store.model.sections.length ? store.model.sections.map((s) => ({ value: s.id, label: s.name })) : [{ value: '', label: t('– kein Querschnitt –') }];
}

function renderProps(app, el) {
  const st = app.store;
  const tool = app.tools?.id, opts = app.tools?.opts || {};
  if (tool && tool !== 'select' && tool !== 'orbit') el.appendChild(toolOptions(app, tool, opts));
  const s = st.selection;
  const n = st.selCount();
  if (!n) {
    if (tool && tool !== 'select' && tool !== 'orbit') return;
    el.appendChild(h('div.empty', ic('select'), h('div', t('Nichts ausgewählt'))));
    el.appendChild(section(t('So geht’s'),
      h('div.list',
        tipRow('select', t('Objekt anklicken oder Rechteck aufziehen, um es auszuwählen.')),
        tipRow('sliders', t('Hier erscheinen dann alle Eigenschaften – direkt bearbeitbar.')),
        tipRow('dots', t('Rechtsklick öffnet das Kontextmenü mit passenden Aktionen.')),
        tipRow('search', t('Ctrl+K durchsucht alle Befehle.')))));
    return;
  }
  const parts = [];
  if (s.nodes.size) parts.push(`${s.nodes.size} ${t('Knoten')}`);
  if (s.lines.size) parts.push(`${s.lines.size} ${t('Linien')}`);
  if (s.domains.size) parts.push(`${s.domains.size} ${t('Flächen')}`);
  el.appendChild(h('div.sel-head', h('div.chip', ic(s.domains.size ? 'domain' : s.lines.size ? 'beam' : 'node')),
    h('div', h('div.t1', t('Auswahl')), h('div.t2', parts.join(' · ')))));
  if (s.nodes.size) el.appendChild(nodeProps(app));
  if (s.lines.size) el.appendChild(lineProps(app));
  if (s.domains.size) el.appendChild(domainProps(app));
  el.appendChild(h('div.row', { style: { marginTop: '8px', flexWrap: 'wrap' } },
    h('button.btn.sm', { onclick: () => app.zoomSelection() }, ic('zoomIn'), t('Zoom')),
    h('button.btn.sm', { onclick: () => app.hideSelection() }, ic('eyeOff'), t('Ausblenden')),
    h('button.btn.sm.danger', { onclick: () => app.cmds.delete.run() }, ic('trash'), t('Löschen'))));
}

function tipRow(iconName, text) {
  return h('div.list-item', { style: { cursor: 'default' } }, ic(iconName), h('span.small', { style: { color: 'var(--text-2)' } }, text));
}

function toolOptions(app, tool, opts) {
  const st = app.store, d = app.drawDefaults;
  const wrap = h('div');
  const titles = { move: t('Verschieben'), copy: t('Kopieren'), rotate: t('Drehen'), node: t('Knoten setzen'), line: opts.element ? t('{t} zeichnen', { t: t(TYPE_LABEL[opts.element]) }) : t('Linien zeichnen'), rect: opts.domain ? t('{t} zeichnen', { t: t(TYPE_LABEL[opts.domain]) }) : t('Rechteck zeichnen'), polygon: opts.domain ? t('Fläche zeichnen') : t('Polygon zeichnen'), arc: t('Bogen zeichnen'), measure: t('Messen') };
  const sec = h('div.side-section', h('div.side-section-title', ic('sliders'), titles[tool] || tool));
  if (opts.element && ['beam', 'rib', 'truss'].includes(opts.element)) {
    app.ensureDrawDefaults(opts.element);
    sec.appendChild(field(t('Material'), h('div.row', selectInput({ value: d.material, options: matOptions(st), onChange: (v) => { d.material = +v; } }),
      h('button.icon-btn.sm', { onclick: () => openMaterials(app), tip: [t('Materialien')] }, ic('dots')))));
    sec.appendChild(field(t('Querschnitt'), h('div.row', selectInput({ value: d.section, options: secOptions(st), onChange: (v) => { d.section = +v; } }),
      h('button.icon-btn.sm', { onclick: () => openSections(app, (id) => { d.section = id; app.renderSide(); }), tip: [t('Querschnitte')] }, ic('dots')))));
  }
  if (opts.domain) {
    app.ensureDrawDefaults('domain');
    sec.appendChild(field(t('Typ'), segmented([{ value: 'plate', label: t('Platte') }, { value: 'shell', label: t('Schale') }, { value: 'membrane', label: t('Scheibe') }], opts.domain,
      (v) => { app.tools.set(tool, { ...opts, domain: v }); }, { full: true }), { stack: true }));
    sec.appendChild(field(t('Material'), selectInput({ value: d.domainMaterial, options: matOptions(st), onChange: (v) => { d.domainMaterial = +v; } })));
    sec.appendChild(field(t('Dicke'), numInput({ value: d.thickness, q: 'thick', min: 0.001, onChange: (v) => { d.thickness = v || 0.2; } })));
  }
  if (tool === 'arc') {
    sec.appendChild(field(t('Segmente'), numInput({ value: opts.segments || 8, min: 2, max: 128, onChange: (v) => { app.tools.opts.segments = Math.round(v || 8); } })));
  }
  sec.appendChild(hintBox(t('Arbeitsebene {p} auf {o}. Knoten, Mitten und (optional) Linien werden gefangen.', { p: st.view.workplane.plane, o: fmt('len', st.view.workplane.offset) })));
  wrap.appendChild(sec);
  // keyboard cheat sheet of the shared point input
  const keys = pointKeys(tool);
  wrap.appendChild(section(t('Punkteingabe'), h('div.list', keys.map(([k, d]) => h('div.list-item', { style: { cursor: 'default', alignItems: 'flex-start' } },
    h('span.kbd', { style: { flex: 'none', minWidth: '62px', justifyContent: 'center' } }, k), h('span.small', { style: { color: 'var(--text-2)' } }, d))))));
  return wrap;
}

/* ---------------- nodes ---------------- */
function nodeProps(app) {
  const st = app.store, s = st.selection;
  const ids = [...s.nodes];
  const sec = h('div.side-section', h('div.side-section-title', ic('node'), t('Knoten'), h('span.grow'), h('span.badge', ids.length)));
  if (ids.length === 1) {
    const n = st.idx.nodes.get(ids[0]);
    sec.appendChild(h('div.small.muted', { style: { marginBottom: '8px' } }, t('Knoten {id}', { id: n.id })));
    for (const k of ['x', 'y', 'z']) {
      sec.appendChild(field(k.toUpperCase(), numInput({ value: n[k], q: 'len', onChange: (v) => st.commit(t('Knoten verschieben'), (m) => { m.nodes.find((x) => x.id === n.id)[k] = v ?? 0; }) })));
    }
  } else {
    sec.appendChild(h('div.small.muted', { style: { marginBottom: '8px' } }, t('Gemeinsame Koordinate setzen (leer = unverändert):')));
    for (const k of ['x', 'y', 'z']) {
      const vals = ids.map((id) => st.idx.nodes.get(id)[k]);
      const same = vals.every((v) => Math.abs(v - vals[0]) < 1e-9);
      sec.appendChild(field(k.toUpperCase(), numInput({ value: same ? vals[0] : null, q: 'len', placeholder: t('verschieden'), onChange: (v) => {
        if (v == null) return;
        st.commit(t('Koordinate setzen'), (m) => { for (const nd of m.nodes) if (s.nodes.has(nd.id)) nd[k] = v; });
      } })));
    }
  }
  // supports
  const sups = st.model.supports.filter((x) => x.type === 'node' && s.nodes.has(x.node));
  const supSec = h('div', { style: { marginTop: '10px' } }, h('div.side-section-title', ic('supportPin'), t('Lager'), h('span.grow'),
    h('button.icon-btn', { onclick: () => supportDialog(app, 'node'), tip: [t('Lager definieren')] }, ic('plus'))));
  if (!sups.length) supSec.appendChild(h('div.small.muted', t('Kein Lager an diesen Knoten.')));
  for (const sp of sups.slice(0, 20)) {
    supSec.appendChild(h('div.list-item', ic('supportPin'), h('span.t', t('Knoten {id}', { id: sp.node })),
      h('span.meta.hide-hover', dofText(sp.dofs)),
      h('span.acts', h('button.icon-btn.sm', { onclick: () => st.commit(t('Lager löschen'), (m) => { m.supports = m.supports.filter((x) => x.id !== sp.id); }), tip: [t('Löschen')] }, ic('trash')))));
  }
  sec.appendChild(supSec);
  sec.appendChild(loadList(app, (l) => l.node && s.nodes.has(l.node), () => nodeLoadDialog(app)));
  return sec;
}

function dofText(d) {
  return ['X', 'Y', 'Z', 'φX', 'φY', 'φZ'].map((a, i) => (d[i] === 'F' ? a : (typeof d[i] === 'number' && d[i] > 0 ? a + '~' : null))).filter(Boolean).join(' ') || t('frei');
}

/* ---------------- lines ---------------- */
function lineProps(app) {
  const st = app.store, s = st.selection;
  const lines = [...s.lines].map((id) => st.idx.lines.get(id)).filter(Boolean);
  const totalL = lines.reduce((a, l) => a + lineLength(st.model, st.idx, l), 0);
  const sec = h('div.side-section', h('div.side-section-title', ic('beam'), t('Linien / Stäbe'), h('span.grow'), h('span.badge', lines.length)));
  sec.appendChild(h('div.kv', { style: { marginBottom: '10px' } },
    h('span', lines.length === 1 ? t('Länge') : t('Gesamtlänge')), h('span', fmt('len', totalL)),
    lines.length === 1 ? h('span', t('Knoten')) : null, lines.length === 1 ? h('span', `${lines[0].n1} → ${lines[0].n2}`) : null));
  const types = [...new Set(lines.map((l) => l.element?.type || 'none'))];
  const curType = types.length === 1 ? types[0] : '';
  const typeOpts = [{ value: 'none', label: t('Nur Geometrie') }, ...['beam', 'truss', 'rib', 'rigid', 'spring'].map((k) => ({ value: k, label: t(TYPE_LABEL[k]) }))];
  if (!curType) typeOpts.unshift({ value: '', label: t('– verschieden –') });
  sec.appendChild(field(t('Elementtyp'), selectInput({ value: curType, options: typeOpts, onChange: (v) => {
    if (!v) return;
    let d = {};
    if (v !== 'none') d = app.ensureDrawDefaults(v);
    st.commit(t('Elementtyp ändern'), (m) => {
      for (const l of m.lines) {
        if (!s.lines.has(l.id)) continue;
        if (v === 'none') { l.element = null; continue; }
        const prev = l.element;
        l.element = defaultLineElement(v, prev?.material ?? d.material, prev?.section ?? d.section);
        if (prev?.beta) l.element.beta = prev.beta;
      }
    });
  } })));
  const els = lines.map((l) => l.element).filter(Boolean);
  if (els.length && curType && curType !== 'none') {
    const common = (k) => { const v = els.map((e) => e[k]); return v.every((x) => x === v[0]) ? v[0] : ''; };
    const setAll = (label, fn) => st.commit(label, (m) => { for (const l of m.lines) if (s.lines.has(l.id) && l.element) fn(l.element); });
    if (['beam', 'truss', 'rib'].includes(curType)) {
      const mo = matOptions(st); if (common('material') === '') mo.unshift({ value: '', label: t('– verschieden –') });
      sec.appendChild(field(t('Material'), h('div.row', selectInput({ value: common('material'), options: mo, onChange: (v) => v && setAll(t('Material zuweisen'), (e) => { e.material = +v; }) }),
        h('button.icon-btn.sm', { onclick: () => openMaterials(app), tip: [t('Materialien')] }, ic('dots')))));
      const so = secOptions(st); if (common('section') === '') so.unshift({ value: '', label: t('– verschieden –') });
      sec.appendChild(field(t('Querschnitt'), h('div.row', selectInput({ value: common('section'), options: so, onChange: (v) => v && setAll(t('Querschnitt zuweisen'), (e) => { e.section = +v; }) }),
        h('button.icon-btn.sm', { onclick: () => openSections(app, (id) => setAll(t('Querschnitt zuweisen'), (e) => { e.section = id; })), tip: [t('Querschnitte')] }, ic('dots')))));
      sec.appendChild(field(t('Drehwinkel β'), numInput({ value: common('beta') === '' ? null : common('beta') || 0, q: 'angle', placeholder: t('verschieden'), onChange: (v) => v != null && setAll(t('Drehwinkel'), (e) => { e.beta = v; }) }),
        { help: t('Drehung der lokalen Querschnittsachsen y/z um die Stabachse x.') }));
      if (curType === 'truss') {
        sec.appendChild(field(t('Nichtlinear'), selectInput({ value: common('nl') || '', options: [{ value: '', label: t('Zug und Druck') }, { value: 'tension', label: t('Nur Zug (Seil/Verband)') }, { value: 'compression', label: t('Nur Druck') }],
          onChange: (v) => setAll(t('Nichtlinearität'), (e) => { e.nl = v || null; }) }), { help: t('Wirkt nur in der nichtlinearen Berechnung.') }));
      }
      if (curType !== 'truss') {
        const div = common('divisions');
        sec.appendChild(field(t('FE-Unterteilung'), numInput({ value: div === '' ? null : div, placeholder: t('Standard ({n})', { n: st.model.settings.beamDivisions }), min: 1, max: 100,
          onChange: (v) => setAll(t('Unterteilung'), (e) => { if (v == null) delete e.divisions; else e.divisions = Math.round(v); }) })));
        const rel = els.filter((e) => e.releases && (e.releases.i.some(Boolean) || e.releases.j.some(Boolean))).length;
        sec.appendChild(h('div.row', { style: { marginBottom: '8px' } },
          h('button.btn.sm', { onclick: () => editReleases(app) }, ic('hinge'), t('Gelenke')), rel ? h('span.badge.acc', t('{n} mit Gelenken', { n: rel })) : null,
          h('button.btn.sm', { onclick: () => designParams(app) }, ic('buckling'), t('Knicklängen'))));
      }
    }
    if (curType === 'spring') {
      const k = els[0].k || [0, 0, 0, 0, 0, 0];
      const labs = ['kX', 'kY', 'kZ', 'kφX', 'kφY', 'kφZ'];
      labs.forEach((lab, i) => sec.appendChild(field(lab, numInput({ value: k[i], q: i < 3 ? 'springK' : 'springR', min: 0, onChange: (v) => setAll(t('Federsteifigkeit'), (e) => { e.k = e.k || [0, 0, 0, 0, 0, 0]; e.k[i] = v || 0; }) }))));
    }
  }
  // line supports
  const sups = st.model.supports.filter((x) => x.type === 'line' && s.lines.has(x.line));
  if (sups.length) {
    sec.appendChild(h('div.side-section-title', { style: { marginTop: '10px' } }, ic('supportLine'), t('Linienlager'), h('span.grow')));
    for (const sp of sups.slice(0, 20)) {
      sec.appendChild(h('div.list-item', ic('supportLine'), h('span.t', t('Linie {id}', { id: sp.line })), h('span.meta.hide-hover', dofText(sp.dofs)),
        h('span.acts', h('button.icon-btn.sm', { onclick: () => st.commit(t('Lager löschen'), (m) => { m.supports = m.supports.filter((x) => x.id !== sp.id); }) }, ic('trash')))));
    }
  }
  sec.appendChild(loadList(app, (l) => l.line && s.lines.has(l.line), () => lineLoadDialog(app, false)));
  return sec;
}

/* ---------------- domains ---------------- */
function domainProps(app) {
  const st = app.store, s = st.selection;
  const doms = [...s.domains].map((id) => st.idx.domains.get(id)).filter(Boolean);
  const sec = h('div.side-section', h('div.side-section-title', ic('domain'), t('Flächen'), h('span.grow'), h('span.badge', doms.length)));
  const area = doms.reduce((a, d) => a + polygonArea(d.nodes.map((id) => P(st.idx.nodes.get(id)))), 0);
  sec.appendChild(h('div.kv', { style: { marginBottom: '10px' } }, h('span', t('Fläche')), h('span', fmtNum(area) + ' m²')));
  const common = (k) => { const v = doms.map((d) => d[k]); return v.every((x) => x === v[0]) ? v[0] : ''; };
  const setAll = (label, fn) => st.commit(label, (m) => { for (const d of m.domains) if (s.domains.has(d.id)) fn(d); });
  sec.appendChild(field(t('Typ'), segmented([{ value: 'plate', label: t('Platte') }, { value: 'shell', label: t('Schale') }, { value: 'membrane', label: t('Scheibe') }], common('type'),
    (v) => setAll(t('Flächentyp'), (d) => { d.type = v; }), { full: true }), { stack: true }));
  const mo = matOptions(st); if (common('material') === '') mo.unshift({ value: '', label: t('– verschieden –') });
  sec.appendChild(field(t('Material'), h('div.row', selectInput({ value: common('material'), options: mo, onChange: (v) => v && setAll(t('Material zuweisen'), (d) => { d.material = +v; }) }),
    h('button.icon-btn.sm', { onclick: () => openMaterials(app) }, ic('dots')))));
  sec.appendChild(field(t('Dicke'), numInput({ value: common('thickness') === '' ? null : common('thickness'), q: 'thick', min: 0.001, placeholder: t('verschieden'), onChange: (v) => v && setAll(t('Dicke'), (d) => { d.thickness = v; }) })));
  sec.appendChild(field(t('Netzgrösse'), numInput({ value: common('meshSize') || null, q: 'len', min: 0.01, placeholder: t('Standard ({v})', { v: fmt('len', st.model.settings.meshSize) }),
    onChange: (v) => setAll(t('Netzgrösse'), (d) => { if (v) d.meshSize = v; else delete d.meshSize; }) })));
  const mat = st.idx.materials.get(common('material'));
  if (mat?.type === 'concrete') {
    const rc = doms[0].rc || {};
    sec.appendChild(h('div.side-section-title', { style: { marginTop: '10px' } }, ic('concrete'), t('Bewehrung')));
    sec.appendChild(field(t('Betondeckung'), numInput({ value: rc.cover ?? 0.03, q: 'dim', min: 0, onChange: (v) => setAll(t('Betondeckung'), (d) => { d.rc = { ...(d.rc || {}), cover: v }; }) })));
    sec.appendChild(field(t('Stab-Ø'), numInput({ value: rc.dia ?? 0.012, q: 'dim', min: 0.004, onChange: (v) => setAll(t('Stabdurchmesser'), (d) => { d.rc = { ...(d.rc || {}), dia: v }; }) })));
  }
  if (doms.length === 1) {
    const ax = domainAxes(doms[0].nodes.map((id) => P(st.idx.nodes.get(id))));
    sec.appendChild(h('div.small.muted', { style: { margin: '6px 0' } }, t('Lokale z-Achse: ({x}; {y}; {z})', { x: ax.ez[0].toFixed(2), y: ax.ez[1].toFixed(2), z: ax.ez[2].toFixed(2) })));
  }
  const bed = st.model.supports.filter((x) => x.type === 'surface' && s.domains.has(x.domain));
  if (bed.length) {
    sec.appendChild(h('div.list-item', ic('supportSurface'), h('span.t', t('Bettung kz = {k}', { k: fmt('bedding', bed[0].k[2]) })),
      h('span.acts', h('button.icon-btn.sm', { onclick: () => st.commit(t('Bettung löschen'), (m) => { m.supports = m.supports.filter((x) => !(x.type === 'surface' && s.domains.has(x.domain))); }) }, ic('trash')))));
  } else sec.appendChild(h('button.btn.sm', { style: { marginBottom: '6px' }, onclick: () => supportDialog(app, 'surface') }, ic('supportSurface'), t('Bettung hinzufügen')));
  sec.appendChild(loadList(app, (l) => l.domain && s.domains.has(l.domain), () => surfaceLoadDialog(app)));
  return sec;
}

function loadList(app, filter, onAdd) {
  const st = app.store;
  const lc = st.idx.loadCases.get(st.activeLC);
  const loads = st.model.loads.filter((l) => l.lc === st.activeLC && filter(l));
  const box = h('div', { style: { marginTop: '10px' } }, h('div.side-section-title', ic('loadNode'), t('Lasten in {lc}', { lc: lc?.name || '–' }), h('span.grow'),
    h('button.icon-btn', { onclick: onAdd, tip: [t('Last hinzufügen')] }, ic('plus'))));
  if (!loads.length) box.appendChild(h('div.small.muted', t('Keine Lasten im aktiven Lastfall.')));
  for (const l of loads.slice(0, 30)) {
    box.appendChild(h('div.list-item', h('span.dot', { style: { background: 'var(--p-rose)' } }), h('span.t.small', describeLoad(app, l)),
      h('span.acts', h('button.icon-btn.sm', { onclick: () => st.commit(t('Last löschen'), (m) => { m.loads = m.loads.filter((x) => x.id !== l.id); }), tip: [t('Löschen')] }, ic('trash')))));
  }
  return box;
}

/* ======================================================================
   Model browser
   ====================================================================== */
function renderModel(app, el) {
  const st = app.store, m = st.model;
  const s = modelStats(m);
  el.appendChild(h('div.sel-head', h('div.chip', { style: { background: 'color-mix(in srgb, var(--p-lavender) 45%, transparent)' } }, ic('fileText')),
    h('div', { style: { minWidth: 0 } }, h('div.t1', m.meta.name), h('div.t2', (m.settings.code === 'SIA' ? 'SIA 260–265' : 'Eurocode') + (m.meta.author ? ' · ' + m.meta.author : ''))),
    h('button.icon-btn.sm', { style: { marginLeft: 'auto' }, onclick: () => app.cmds.modelInfo.run(), tip: [t('Modellinfo')] }, ic('settings'))));
  const stat = (v, l, iconName, onClick) => h('div.stat', { onclick: onClick, style: { cursor: onClick ? 'pointer' : 'default' } }, h('div.v', String(v)), h('div.l', ic(iconName), l));
  el.appendChild(h('div.stat-grid', { style: { marginBottom: '18px' } },
    stat(s.nodes, t('Knoten'), 'node', () => st.select({ nodes: m.nodes.map((n) => n.id) })),
    stat(s.beams + s.trusses, t('Stäbe'), 'beam', () => st.select({ lines: m.lines.filter((l) => l.element).map((l) => l.id) })),
    stat(s.domains, t('Flächen'), 'domain', () => st.select({ domains: m.domains.map((d) => d.id) })),
    stat(s.supports, t('Lager'), 'supportPin'),
    stat(s.loads, t('Lasten'), 'loadNode'),
    stat(s.combinations, t('Kombin.'), 'combination')));

  // load cases
  const lcSec = h('div.side-section', h('div.side-section-title', ic('loadCase'), t('Lastfälle'), h('span.grow'),
    h('button.icon-btn', { onclick: () => app.addLoadCase(), tip: [t('Neuer Lastfall')] }, ic('plus')),
    h('button.icon-btn', { onclick: () => openLoadCases(app), tip: [t('Lastfälle verwalten')] }, ic('settings'))));
  const list = h('div.list');
  for (const lc of m.loadCases) {
    const grp = st.idx.loadGroups.get(lc.group);
    const cnt = m.loads.filter((l) => l.lc === lc.id).length;
    list.appendChild(h('button.list-item' + (lc.id === st.activeLC ? '.active' : ''), { onclick: () => app.setActiveLC(lc.id) },
      h('span.dot', { style: { background: groupColor(grp?.type) } }), h('span.t', lc.name),
      lc.selfWeight ? h('span.badge', { tip: [t('Eigengewicht aktiv')] }, 'G') : null,
      h('span.meta', `${cnt} · ${t(groupLabel(grp?.type))}`)));
  }
  lcSec.appendChild(list);
  el.appendChild(lcSec);

  // combinations
  const coSec = h('div.side-section', h('div.side-section-title', ic('combination'), t('Kombinationen'), h('span.grow'),
    h('button.icon-btn', { onclick: () => app.cmds.autoCombos.run(), tip: [t('Auto-Kombi')] }, ic('sparkles')),
    h('button.icon-btn', { onclick: () => openCombinations(app), tip: [t('Kombinationen verwalten')] }, ic('settings'))));
  if (!m.combinations.length) coSec.appendChild(h('div.small.muted', t('Keine Kombinationen – „Auto-Kombi“ erzeugt sie nach Norm.')));
  for (const c of m.combinations.slice(0, 12)) coSec.appendChild(h('div.list-item', h('span.badge', c.type), h('span.t.small', c.name)));
  if (m.combinations.length > 12) coSec.appendChild(h('div.small.muted', t('… und {n} weitere', { n: m.combinations.length - 12 })));
  el.appendChild(coSec);

  // materials & sections
  const matSec = h('div.side-section', h('div.side-section-title', ic('material'), t('Materialien'), h('span.grow'), h('button.icon-btn', { onclick: () => openMaterials(app) }, ic('settings'))));
  if (!m.materials.length) matSec.appendChild(h('div.small.muted', t('Noch keine Materialien.')));
  for (const mt of m.materials) matSec.appendChild(h('div.list-item', { onclick: () => openMaterials(app, mt.id) }, h('span.dot', { style: { background: MAT_COLORS[mt.type] || MAT_COLORS.other } }), h('span.t', mt.name), h('span.meta', fmt('modulus', mt.E))));
  el.appendChild(matSec);
  const secSec = h('div.side-section', h('div.side-section-title', ic('section'), t('Querschnitte'), h('span.grow'), h('button.icon-btn', { onclick: () => openSections(app) }, ic('settings'))));
  if (!m.sections.length) secSec.appendChild(h('div.small.muted', t('Noch keine Querschnitte.')));
  for (const sc of m.sections) {
    const used = m.lines.filter((l) => l.element?.section === sc.id).length;
    secSec.appendChild(h('div.list-item', { onclick: () => openSections(app, null, sc.id) }, ic('section'), h('span.t', sc.name), h('span.meta', t('{n}× verwendet', { n: used }))));
  }
  el.appendChild(secSec);

  const mesh = st.results.mesh;
  if (mesh) {
    el.appendChild(section(t('FE-Netz'), h('div.kv', h('span', t('FE-Knoten')), h('span', mesh.stats?.nodes ?? mesh.nodes.length / 3),
      h('span', t('Stabelemente')), h('span', mesh.beams.length), h('span', t('Flächenelemente')), h('span', mesh.shells.length),
      h('span', t('Freiheitsgrade')), h('span', (mesh.nodes.length / 3) * 6))));
  }
}

export function groupColor(type) {
  return { permanent: 'var(--p-slate)', variable: 'var(--p-sky)', snow: 'var(--p-teal)', wind: 'var(--p-mint)', accidental: 'var(--p-rose)', seismic: 'var(--p-peach)' }[type] || 'var(--p-lavender)';
}
export function groupLabel(type) {
  return { permanent: 'ständig', variable: 'veränderlich', snow: 'Schnee', wind: 'Wind', accidental: 'aussergewöhnlich', seismic: 'Erdbeben' }[type] || 'ständig';
}

/* ======================================================================
   Results
   ====================================================================== */
function renderResults(app, el) {
  const st = app.store, R = st.results, rv = st.resultView;
  const fams = [];
  if (R.static || R.spectrum) fams.push({ value: 'static', label: t('Statik'), icon: 'diagram' });
  if (R.modal) fams.push({ value: 'modal', label: t('Eigenf.'), icon: 'vibration' });
  if (R.buckling) fams.push({ value: 'buckling', label: t('Knicken'), icon: 'buckling' });
  if (R.steel) fams.push({ value: 'steel', label: t('Stahl'), icon: 'steel' });
  if (R.rc || R.rcBeams) fams.push({ value: 'rc', label: t('Beton'), icon: 'concrete' });
  if (R.timber) fams.push({ value: 'timber', label: t('Holz'), icon: 'timber' });
  if (!fams.length) {
    el.appendChild(h('div.empty', ic('diagram'), h('div', t('Noch keine Ergebnisse'))));
    el.appendChild(h('div.list', { style: { gap: '8px' } },
      h('button.btn.primary.block', { onclick: () => runStatic(app, false) }, ic('run'), t('Linear rechnen')),
      h('button.btn.block', { onclick: () => runModalDialog(app) }, ic('vibration'), t('Eigenformen')),
      h('button.btn.block', { onclick: () => runBucklingDialog(app) }, ic('buckling'), t('Knickanalyse'))));
    el.appendChild(hintBox(t('Vor der Berechnung wird das FE-Netz automatisch erzeugt. Kombinationen werden mitgerechnet.')));
    return;
  }
  const curFam = rv.kind === 'spectrum' ? 'static' : rv.kind;
  el.appendChild(h('div', { style: { marginBottom: '14px' } }, segmented([{ value: null, label: t('Modell'), icon: 'viewIso' }, ...fams].map((f) => ({ ...f, label: f.label })), curFam ?? null,
    (v) => (v ? app.showResults(v) : app.hideResults()), { full: true })));
  if (!rv.kind) { el.appendChild(hintBox(t('Wähle oben eine Ergebnisart, um sie im 3D-Fenster darzustellen.'))); return; }
  if (rv.kind === 'static' || rv.kind === 'spectrum') staticPanel(app, el);
  else if (rv.kind === 'modal' || rv.kind === 'buckling') modePanel(app, el);
  else if (rv.kind === 'steel' || rv.kind === 'timber') utilPanel(app, el);
  else if (rv.kind === 'rc') rcPanel(app, el);
}

function staticPanel(app, el) {
  const st = app.store, rv = st.resultView;
  const opts = caseOptions(st);
  if (!opts.length) { el.appendChild(hintBox(t('Keine statischen Ergebnisse.'), 'warn')); return; }
  const set = (p) => st.setResultView(p);
  el.appendChild(field(t('Lastfall / Kombi'), selectInput({ value: rv.caseKey, options: opts, onChange: (v) => set({ caseKey: v, kind: String(v).startsWith('SP:') ? 'spectrum' : 'static' }) }), { stack: true }));
  if (String(rv.caseKey).startsWith('ENV:')) {
    el.appendChild(field(t('Umhüllende'), segmented([{ value: 'max', label: 'Max' }, { value: 'min', label: 'Min' }], rv.envSide || 'max', (v) => set({ envSide: v }), { full: true }), { stack: true }));
  }
  // components
  const hasShell = st.results.mesh?.shells.length > 0, hasBeam = st.results.mesh?.beams.length > 0;
  const groups = {};
  for (const c of COMPONENTS) {
    if (c.kind === 'shell' && !hasShell) continue;
    if (c.kind === 'beam' && !hasBeam) continue;
    (groups[c.group] = groups[c.group] || []).push(c);
  }
  const compSec = h('div.side-section', h('div.side-section-title', ic('layers'), t('Komponente')));
  for (const [g, list] of Object.entries(groups)) {
    compSec.appendChild(h('div.small.muted', { style: { margin: '8px 0 5px' } }, t(g)));
    const wrap = h('div.row', { style: { flexWrap: 'wrap', gap: '4px' } });
    for (const c of list) {
      wrap.appendChild(h('button.btn.sm' + (rv.component === c.key ? '.primary' : ''), { onclick: () => set({ component: c.key }), tip: [t(c.label)] }, c.short || c.label.split(' ')[0]));
    }
    compSec.appendChild(wrap);
  }
  el.appendChild(compSec);

  const comp = componentDef(rv.component);
  const disp = h('div.side-section', h('div.side-section-title', ic('sliders'), t('Darstellung')));
  disp.appendChild(switchInput(t('Verformte Figur'), rv.deformed, (v) => set({ deformed: v })));
  disp.appendChild(slider(t('Verformungsmassstab'), rv.scale, 0.1, 10, (v) => set({ scale: v })));
  if (comp?.kind === 'beam') disp.appendChild(slider(t('Diagrammgrösse'), rv.diagramScale, 0.2, 5, (v) => set({ diagramScale: v })));
  if (comp?.kind === 'shell') disp.appendChild(switchInput(t('Geglättete Werte'), rv.smooth, (v) => set({ smooth: v })));
  if (comp?.kind === 'shell' || comp?.kind === 'nodal') {
    disp.appendChild(field(t('Farbstufen'), selectInput({ value: rv.levels, options: [0, 6, 8, 10, 12, 16, 20].map((n) => ({ value: n, label: n ? String(n) : t('stufenlos') })), onChange: (v) => set({ levels: +v }) })));
    disp.appendChild(field(t('Farbskala'), selectInput({ value: rv.palette, options: PALETTE_NAMES.filter((p) => p !== 'utilization').map((p) => ({ value: p, label: p })), onChange: (v) => set({ palette: v }) })));
  }
  disp.appendChild(switchInput(t('Auflagerkräfte zeigen'), rv.showReactions, (v) => set({ showReactions: v })));
  disp.appendChild(switchInput(t('Werte beschriften'), st.view.labelsValues, (v) => st.setView({ labelsValues: v })));
  el.appendChild(disp);

  const sum = caseSummary(st, rv.caseKey);
  if (sum) {
    const rows = [
      [t('max. Verschiebung'), fmt('disp', sum.maxU)],
      [t('max. |eZ|'), fmt('disp', sum.maxZ)],
    ];
    if (st.results.mesh.beams.length) rows.push([t('max. |N|'), fmt('force', sum.N)], [t('max. |Vz|'), fmt('force', sum.Vz)], [t('max. |My|'), fmt('moment', sum.My)], [t('max. |Mz|'), fmt('moment', sum.Mz)]);
    if (sum.sumR) rows.push([t('Σ Auflager Z'), fmt('force', sum.sumR[2])], [t('Σ Auflager X / Y'), `${fmt('force', sum.sumR[0], { unit: false })} / ${fmt('force', sum.sumR[1])}`]);
    el.appendChild(section(t('Übersicht'), h('div.res-max', rows.map(([k, v]) => h('div.r', h('span', k), h('b', v))))));
  }
  const s = st.results.static;
  if (s?.warnings?.length) el.appendChild(section(t('Hinweise der Berechnung'), ...s.warnings.slice(0, 8).map((w) => hintBox(w, 'warn'))));
  el.appendChild(h('button.btn.block', { onclick: () => app.cmds.tables.run() }, ic('table'), t('Ergebnistabellen')));
}

function slider(label, value, min, max, onChange) {
  const toPos = (v) => Math.log(v / min) / Math.log(max / min) * 100;
  const fromPos = (p) => min * Math.pow(max / min, p / 100);
  const out = h('span.small.mono', `×${(value || 1).toFixed(2)}`);
  const inp = h('input', { type: 'range', min: 0, max: 100, step: 0.5, value: toPos(value || 1), style: { width: '100%', accentColor: 'var(--accent)' } });
  inp.addEventListener('input', () => { out.textContent = `×${fromPos(+inp.value).toFixed(2)}`; });
  inp.addEventListener('change', () => onChange(fromPos(+inp.value)));
  return h('div', { style: { margin: '6px 0 10px' } }, h('div.row', h('span.small', { style: { color: 'var(--text-2)' } }, label), h('span.grow'), out), inp);
}

function modePanel(app, el) {
  const st = app.store, rv = st.resultView;
  const isModal = rv.kind === 'modal';
  const data = isModal ? st.results.modal : st.results.buckling;
  const set = (p) => st.setResultView(p);
  el.appendChild(h('div.row', { style: { marginBottom: '12px' } },
    h('button.btn' + (rv.animate ? '.primary' : ''), { onclick: () => set({ animate: !rv.animate }) }, ic(rv.animate ? 'pause' : 'play'), rv.animate ? t('Stopp') : t('Animieren')),
    h('button.btn', { onclick: () => (isModal ? runModalDialog(app) : runBucklingDialog(app)) }, ic('settings'), t('Neu berechnen'))));
  el.appendChild(slider(t('Amplitude'), rv.scale, 0.1, 10, (v) => set({ scale: v })));
  const list = h('div.list.mode-list');
  data.modes.forEach((m, i) => {
    const meta = isModal
      ? `${fmtNum(m.f, 4)} Hz · ${fmtNum(m.T, 4)} s`
      : `αcr = ${fmtNum(m.lambda, 4)}`;
    const sub = isModal && m.effMass ? `mX ${(m.effMass[0] * 100).toFixed(1)}% · mY ${(m.effMass[1] * 100).toFixed(1)}% · mZ ${(m.effMass[2] * 100).toFixed(1)}%` : '';
    list.appendChild(h('button.list-item' + (rv.mode === i ? '.active' : ''), { onclick: () => set({ mode: i }) },
      h('span.badge.acc', String(i + 1)), h('div', { style: { minWidth: 0 } }, h('div.small', meta), sub ? h('div.small.muted', sub) : null)));
  });
  el.appendChild(section(isModal ? t('Eigenformen') : t('Knickformen'), list));
  if (isModal && data.modes.length) {
    const sumM = [0, 1, 2].map((k) => data.modes.reduce((a, m) => a + (m.effMass?.[k] || 0), 0));
    el.appendChild(section(t('Massenbeteiligung Σ'), h('div.res-max',
      ['X', 'Y', 'Z'].map((a, k) => h('div.r', h('span', a), h('b', (sumM[k] * 100).toFixed(1) + ' %')))),
      data.totalMass ? h('div.small.muted', { style: { marginTop: '6px' } }, t('Gesamtmasse: {m}', { m: fmt('mass', data.totalMass[0]) })) : null,
      sumM.some((x) => x < 0.9) ? hintBox(t('Für Erdbebennachweise sollten ≥ 90 % der Masse aktiviert sein – mehr Eigenformen berechnen.'), 'warn') : null));
  }
  if (!isModal && data.modes.length) {
    const a = data.modes[0].lambda;
    el.appendChild(hintBox(a < 1 ? t('αcr < 1: Das System ist unter dieser Last instabil!') : a < 10 ? t('αcr < 10: Effekte nach Theorie II. Ordnung müssen berücksichtigt werden (nichtlineare Berechnung).') : t('αcr ≥ 10: Theorie I. Ordnung ist ausreichend.'), a < 1 ? 'err' : a < 10 ? 'warn' : 'ok'));
  }
  if (data.warnings?.length) el.appendChild(section(t('Hinweise'), ...data.warnings.slice(0, 5).map((w) => hintBox(w, 'warn'))));
}

function utilPanel(app, el) {
  const st = app.store, rv = st.resultView;
  const list = (rv.kind === 'steel' ? st.results.steel : st.results.timber) || [];
  const sorted = [...list].sort((a, b) => (b.eta ?? 0) - (a.eta ?? 0));
  const fail = list.filter((r) => r.eta > 1).length;
  const maxEta = sorted[0]?.eta ?? 0;
  el.appendChild(h('div.stat-grid', { style: { gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '14px' } },
    h('div.stat', h('div.v', String(list.length)), h('div.l', t('Stäbe'))),
    h('div.stat', h('div.v', { style: { color: maxEta > 1 ? 'var(--danger)' : 'var(--success)' } }, (maxEta * 100).toFixed(0) + '%'), h('div.l', t('max. η'))),
    h('div.stat', h('div.v', { style: { color: fail ? 'var(--danger)' : 'var(--success)' } }, String(fail)), h('div.l', t('η > 100%')))));
  el.appendChild(hintBox(t('Norm: {c}. Klick auf einen Stab zeigt alle Nachweise.', { c: st.model.settings.code === 'SIA' ? (rv.kind === 'steel' ? 'SIA 263' : 'SIA 265') : (rv.kind === 'steel' ? 'EN 1993-1-1' : 'EN 1995-1-1') })));
  const box = h('div.list');
  for (const r of sorted.slice(0, 60)) {
    const eta = r.eta ?? 0;
    const col = eta > 1 ? 'var(--danger)' : eta > 0.85 ? 'var(--warning)' : 'var(--success)';
    const item = h('button.list-item', { onclick: () => { st.select({ lines: [r.line] }, 'replace'); detail.style.display = detail.style.display === 'none' ? '' : 'none'; } },
      h('span.small', { style: { width: '42px' } }, '#' + r.line),
      h('span.util-bar', h('i', { style: { width: Math.min(100, eta * 100) + '%', background: col } })),
      h('b.small', { style: { color: col } }, (eta * 100).toFixed(0) + '%'),
      h('span.meta', r.governing?.check || ''));
    const detail = h('div', { style: { display: 'none', padding: '4px 10px 10px 52px' } },
      r.cls ? h('div.small.muted', t('Querschnittsklasse {c}', { c: r.cls })) : null,
      ...Object.entries(r.checks || {}).map(([k, c]) => h('div.small', { style: { margin: '3px 0' } }, h('b', `${k}: ${((c.eta ?? 0) * 100).toFixed(0)}%`), c.detail ? h('div.muted', c.detail) : null)),
      r.notes?.length ? h('div.small.muted', r.notes.join(' · ')) : null);
    box.append(item, detail);
  }
  if (!list.length) box.appendChild(h('div.empty', t('Keine passenden Stäbe gefunden (Material Stahl bzw. Holz erforderlich).')));
  el.appendChild(section(t('Stäbe nach Ausnutzung'), box));
  el.appendChild(h('button.btn.block', { onclick: () => runDesign(app, rv.kind) }, ic('run'), t('Neu bemessen')));
}

function rcPanel(app, el) {
  const st = app.store, rv = st.resultView;
  const comps = DESIGN_COMPONENTS.rc.filter((c) => (c.kind === 'rc' ? st.results.rc : st.results.rcBeams));
  const wrap = h('div.row', { style: { flexWrap: 'wrap', gap: '4px', marginBottom: '14px' } });
  for (const c of comps) wrap.appendChild(h('button.btn.sm' + (rv.component === c.key ? '.primary' : ''), { onclick: () => st.setResultView({ component: c.key }), tip: [t(c.label)] }, c.key));
  el.appendChild(section(t('Bewehrung'), wrap));
  el.appendChild(hintBox(t('axb/ayb: untere Lage in lokaler x/y-Richtung, axt/ayt: obere Lage. Wood-Armer-Momente, Norm {c}.', { c: st.model.settings.code === 'SIA' ? 'SIA 262' : 'EN 1992-1-1' })));
  const w = st.results.rc?.warnings || [];
  if (w.length) el.appendChild(section(t('Hinweise'), ...w.slice(0, 8).map((x) => hintBox(x, 'warn'))));
  const beams = st.results.rcBeams || [];
  if (beams.length) {
    const box = h('div.list');
    for (const b of beams.slice(0, 40)) {
      const mx = (a) => Math.max(0, ...(a || [0]));
      box.appendChild(h('button.list-item', { onclick: () => st.select({ lines: [b.line] }, 'replace') },
        h('span.small', '#' + b.line), h('span.meta', `${fmt('reinfBeam', mx(b.AsBot))} / ${fmt('reinfBeam', mx(b.AsTop))} · ${fmt('reinf', mx(b.Asw))}`),
        b.ok === false ? h('span.badge.err', '!') : null));
    }
    el.appendChild(section(t('Balken: As unten / oben · Bügel'), box));
  }
  el.appendChild(h('div.row', h('button.btn.grow', { onclick: () => runDesign(app, 'rc') }, ic('run'), t('Flächen')), h('button.btn.grow', { onclick: () => runDesign(app, 'rcBeam') }, ic('run'), t('Balken'))));
}

