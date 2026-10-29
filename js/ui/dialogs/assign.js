// Element assignment, releases, supports, domains from selection, design parameters.
import { t } from '../../i18n.js';
import { h, ic, clear, openDialog, field, numInput, selectInput, toast, hintBox, segmented, checkInput } from '../dom.js';
import { nextId, defaultLineElement, loopFromLines, addDomain, SUPPORT_PRESETS } from '../../core/model.js';
import { unitLabel } from '../../core/units.js';
import { openSections, openMaterials } from './manage.js';

const ELEMENT_TYPES = [
  { value: 'beam', label: 'Balken', icon: 'beam', d: 'Biegesteifer Stab mit 6 Freiheitsgraden je Knoten' },
  { value: 'truss', label: 'Fachwerkstab', icon: 'truss', d: 'Nur Normalkraft, gelenkig angeschlossen' },
  { value: 'rib', label: 'Rippe', icon: 'rib', d: 'Unterzug/Randbalken einer Platte' },
  { value: 'rigid', label: 'Starrstab', icon: 'rigid', d: 'Starre Kopplung zweier Knoten' },
  { value: 'spring', label: 'Feder', icon: 'spring', d: 'Federelement mit 6 Steifigkeiten' },
];

export function assignLineElement(app) {
  const st = app.store;
  const first = [...st.selection.lines].map((id) => st.idx.lines.get(id)).find((l) => l.element)?.element;
  const s = { type: first?.type || 'beam', material: first?.material, section: first?.section, beta: first?.beta || 0 };
  const d = app.ensureDrawDefaults('beam');
  s.material = s.material ?? d.material; s.section = s.section ?? d.section;
  const body = h('div');
  const render = () => {
    clear(body);
    const cards = h('div.cards');
    for (const e of ELEMENT_TYPES) {
      cards.appendChild(h('button.card-choice' + (s.type === e.value ? '.active' : ''), { onclick: () => { s.type = e.value; render(); } },
        h('div.chip', ic(e.icon)), h('div.t', t(e.label)), h('div.d', t(e.d))));
    }
    body.appendChild(cards);
    if (['beam', 'truss', 'rib'].includes(s.type)) {
      body.appendChild(h('h4', { style: { marginTop: '16px' } }, t('Eigenschaften')));
      body.appendChild(field(t('Material'), h('div.row', selectInput({ value: s.material, options: st.model.materials.map((m) => ({ value: m.id, label: m.name })), onChange: (v) => { s.material = +v; } }),
        h('button.icon-btn.sm', { onclick: () => openMaterials(app) }, ic('dots')))));
      body.appendChild(field(t('Querschnitt'), h('div.row', selectInput({ value: s.section, options: st.model.sections.map((x) => ({ value: x.id, label: x.name })), onChange: (v) => { s.section = +v; } }),
        h('button.icon-btn.sm', { onclick: () => openSections(app, (id) => { s.section = id; render(); }) }, ic('dots')))));
      body.appendChild(field(t('Drehwinkel β'), numInput({ value: s.beta, q: 'angle', onChange: (v) => { s.beta = v || 0; } })));
    }
    body.appendChild(hintBox(t('Wird {n} gewählten Linien zugewiesen.', { n: st.selection.lines.size })));
  };
  render();
  openDialog({
    title: t('Stabelement zuweisen'), iconName: 'beam', mod: 'sky', size: 'wide', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Zuweisen'), kind: 'primary', icon: 'check', onClick: () => {
      st.commit(t('Stabelement zuweisen'), (m) => {
        for (const l of m.lines) {
          if (!st.selection.lines.has(l.id)) continue;
          const el = defaultLineElement(s.type, s.material, s.section);
          if (['beam', 'truss', 'rib'].includes(s.type)) el.beta = s.beta;
          if (l.element?.releases && el.releases && s.type !== 'truss') el.releases = l.element.releases;
          if (l.element?.design) el.design = l.element.design;
          l.element = el;
        }
      });
      toast(t('Element zugewiesen.'), 'ok');
    } }],
  });
}

/* ---------------- releases ---------------- */
const DOFS = ['ux', 'uy', 'uz', 'φx', 'φy', 'φz'];
export function editReleases(app) {
  const st = app.store;
  const lines = [...st.selection.lines].map((id) => st.idx.lines.get(id)).filter((l) => l.element && ['beam', 'rib'].includes(l.element.type));
  if (!lines.length) return toast(t('Gelenke nur für Balken und Rippen.'), 'info');
  const r = structuredClone(lines[0].element.releases || { i: Array(6).fill(false), j: Array(6).fill(false) });
  const body = h('div');
  const presets = [
    [t('Biegesteif'), { i: [0, 0, 0, 0, 0, 0], j: [0, 0, 0, 0, 0, 0] }],
    [t('Gelenk am Anfang'), { i: [0, 0, 0, 0, 1, 1], j: [0, 0, 0, 0, 0, 0] }],
    [t('Gelenk am Ende'), { i: [0, 0, 0, 0, 0, 0], j: [0, 0, 0, 0, 1, 1] }],
    [t('Beidseitig gelenkig'), { i: [0, 0, 0, 0, 1, 1], j: [0, 0, 0, 0, 1, 1] }],
    [t('Pendelstab'), { i: [0, 0, 0, 1, 1, 1], j: [0, 0, 0, 0, 1, 1] }],
  ];
  const render = () => {
    clear(body);
    body.appendChild(h('div.row', { style: { flexWrap: 'wrap', gap: '6px', marginBottom: '14px' } },
      presets.map(([label, p]) => h('button.btn.sm', { onclick: () => { r.i = p.i.map(Boolean); r.j = p.j.map(Boolean); render(); } }, label))));
    for (const end of ['i', 'j']) {
      body.appendChild(h('h4', end === 'i' ? t('Stabanfang (Knoten i)') : t('Stabende (Knoten j)')));
      const g = h('div.dof-grid');
      DOFS.forEach((dn, k) => {
        g.appendChild(h('div.dof' + (r[end][k] ? '.spring' : '.on'), { onclick: () => { r[end][k] = !r[end][k]; render(); } },
          h('span.lab', dn), h('span.small', r[end][k] ? t('frei') : t('fest'))));
      });
      body.appendChild(g);
    }
    body.appendChild(hintBox(t('Freigaben beziehen sich auf die lokalen Stabachsen. Typisch: φy und φz frei = Momentengelenk. Mindestens ein Stab je Knoten muss φx halten (sonst kinematisch).')));
  };
  render();
  openDialog({
    title: t('Stabendgelenke'), sub: t('{n} Stäbe', { n: lines.length }), iconName: 'hinge', mod: 'sky', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Übernehmen'), kind: 'primary', onClick: () => {
      st.commit(t('Gelenke'), (m) => { for (const l of m.lines) if (st.selection.lines.has(l.id) && l.element && ['beam', 'rib'].includes(l.element.type)) l.element.releases = structuredClone(r); });
    } }],
  });
}

/* ---------------- supports ---------------- */
export function quickSupport(app, preset) {
  const st = app.store;
  st.commit(t('Lager'), (m) => {
    for (const nid of st.selection.nodes) {
      m.supports = m.supports.filter((s) => !(s.type === 'node' && s.node === nid));
      m.supports.push({ id: nextId(m.supports), type: 'node', node: nid, dofs: [...SUPPORT_PRESETS[preset]], uplift: false });
    }
  });
  toast(t('{n} Lager gesetzt.', { n: st.selection.nodes.size }), 'ok');
}

export function supportDialog(app, kind) {
  const st = app.store;
  if (kind === 'surface') return surfaceSupportDialog(app);
  const existing = kind === 'node'
    ? st.model.supports.find((s) => s.type === 'node' && st.selection.nodes.has(s.node))
    : st.model.supports.find((s) => s.type === 'line' && st.selection.lines.has(s.line));
  const dofs = existing ? [...existing.dofs] : [...SUPPORT_PRESETS.pinned];
  let uplift = !!existing?.uplift;
  const body = h('div');
  const render = () => {
    clear(body);
    const presets = [['fixed', t('Eingespannt'), 'supportFixed'], ['pinned', t('Gelenkig'), 'supportPin'], ['rollerX', t('Gleitlager X'), 'supportPin'], ['rollerY', t('Gleitlager Y'), 'supportPin'], ['vertical', t('Nur vertikal'), 'supportPin']];
    body.appendChild(h('div.row', { style: { flexWrap: 'wrap', gap: '6px', marginBottom: '14px' } },
      presets.map(([k, label, iconName]) => h('button.btn.sm', { onclick: () => { SUPPORT_PRESETS[k].forEach((v, i) => { dofs[i] = v; }); render(); } }, ic(iconName), label))));
    const g = h('div.dof-grid');
    const labs = ['uX', 'uY', 'uZ', 'φX', 'φY', 'φZ'];
    labs.forEach((dn, k) => {
      const v = dofs[k];
      const state = v === 'F' ? 'on' : (typeof v === 'number' && v > 0 ? 'spring' : '');
      const cell = h('div.dof' + (state ? '.' + state : ''), h('span.lab', dn), h('span.small', v === 'F' ? t('fest') : state ? t('Feder') : t('frei')));
      cell.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        dofs[k] = v === 'F' ? 0 : (state ? 'F' : (k < 3 ? 1e4 : 1e3));
        render();
      });
      if (state === 'spring') {
        const inp = h('input', { value: String(v) });
        inp.addEventListener('change', () => { const x = Number(inp.value.replace(',', '.')); if (x > 0) dofs[k] = x; });
        cell.appendChild(inp);
        cell.appendChild(h('span.small.muted', k < 3 ? (kind === 'line' ? 'kN/m²' : unitLabel('springK')) : (kind === 'line' ? 'kNm/m' : unitLabel('springR'))));
      }
      g.appendChild(cell);
    });
    body.appendChild(g);
    body.appendChild(h('div.small.muted', { style: { margin: '8px 0' } }, t('Klick wechselt: fest → frei → Feder. Richtungen global.')));
    if (kind === 'node') body.appendChild(checkInput(t('Abheben möglich (uZ wirkt nur auf Druck, nichtlinear)'), uplift, (v) => { uplift = v; }));
    if (kind === 'line') body.appendChild(hintBox(t('Linienlager wirken kontinuierlich entlang der Linie (Federwerte je Meter Länge).')));
  };
  render();
  const n = kind === 'node' ? st.selection.nodes.size : st.selection.lines.size;
  openDialog({
    title: kind === 'node' ? t('Knotenlager') : t('Linienlager'), sub: t('{n} gewählt', { n }), iconName: kind === 'node' ? 'supportPin' : 'supportLine', mod: 'sky', body,
    buttons: [
      existing ? { label: t('Lager entfernen'), kind: 'danger', icon: 'trash', onClick: () => {
        st.commit(t('Lager entfernen'), (m) => { m.supports = m.supports.filter((s) => !(kind === 'node' ? s.type === 'node' && st.selection.nodes.has(s.node) : s.type === 'line' && st.selection.lines.has(s.line))); });
      } } : null,
      { label: t('Abbrechen'), kind: 'ghost' },
      { label: t('Übernehmen'), kind: 'primary', onClick: () => {
        st.commit(kind === 'node' ? t('Knotenlager') : t('Linienlager'), (m) => {
          if (kind === 'node') {
            for (const nid of st.selection.nodes) {
              m.supports = m.supports.filter((s) => !(s.type === 'node' && s.node === nid));
              if (dofs.some((x) => x === 'F' || x > 0)) m.supports.push({ id: nextId(m.supports), type: 'node', node: nid, dofs: [...dofs], uplift });
            }
          } else {
            for (const lid of st.selection.lines) {
              m.supports = m.supports.filter((s) => !(s.type === 'line' && s.line === lid));
              if (dofs.some((x) => x === 'F' || x > 0)) m.supports.push({ id: nextId(m.supports), type: 'line', line: lid, dofs: [...dofs] });
            }
          }
        });
      } },
    ].filter(Boolean),
  });
}

const SOILS = [
  ['Weicher Ton', 5000], ['Steifer Ton', 20000], ['Sand, locker', 15000], ['Sand, dicht', 60000], ['Kies', 100000], ['Fels', 300000],
];
function surfaceSupportDialog(app) {
  const st = app.store;
  const k = [0, 0, 30000];
  const kzIn = numInput({ value: k[2], q: 'bedding', min: 0, onChange: (v) => { k[2] = v || 0; } });
  const body = h('div',
    h('h4', t('Bettungsmodul (Winkler)')),
    h('div.row', { style: { flexWrap: 'wrap', gap: '6px', marginBottom: '12px' } }, SOILS.map(([n, v]) => h('button.btn.sm', { onclick: () => { k[2] = v; kzIn.setValue(v); } }, t(n)))),
    field('kz', kzIn, { help: t('Senkrecht zur Fläche (lokales z).') }),
    field('kx', numInput({ value: 0, q: 'bedding', min: 0, onChange: (v) => { k[0] = v || 0; } })),
    field('ky', numInput({ value: 0, q: 'bedding', min: 0, onChange: (v) => { k[1] = v || 0; } })),
    hintBox(t('Typisch für Bodenplatten: kz = 10 000 – 100 000 kN/m³ je nach Baugrund.')));
  openDialog({
    title: t('Flächenbettung'), sub: t('{n} Flächen', { n: st.selection.domains.size }), iconName: 'supportSurface', mod: 'sky', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Übernehmen'), kind: 'primary', onClick: () => {
      st.commit(t('Flächenbettung'), (m) => {
        for (const did of st.selection.domains) {
          m.supports = m.supports.filter((s) => !(s.type === 'surface' && s.domain === did));
          m.supports.push({ id: nextId(m.supports), type: 'surface', domain: did, k: [...k] });
        }
      });
    } }],
  });
}

/* ---------------- domains from selection ---------------- */
export function domainFromSelection(app) {
  const st = app.store;
  const loop = loopFromLines(st.model, st.selection.lines);
  if (!loop) return toast(t('Die gewählten Linien bilden keinen geschlossenen Umriss.'), 'warn');
  const d = app.ensureDrawDefaults('domain');
  const s = { type: 'shell', material: d.material, thickness: d.thickness };
  const body = h('div',
    field(t('Typ'), segmented([{ value: 'plate', label: t('Platte') }, { value: 'shell', label: t('Schale') }, { value: 'membrane', label: t('Scheibe') }], s.type, (v) => { s.type = v; }, { full: true }), { stack: true }),
    field(t('Material'), selectInput({ value: s.material, options: st.model.materials.map((m) => ({ value: m.id, label: m.name })), onChange: (v) => { s.material = +v; } })),
    field(t('Dicke'), numInput({ value: s.thickness, q: 'thick', min: 0.001, onChange: (v) => { s.thickness = v; } })),
    hintBox(t('Umriss mit {n} Ecken erkannt.', { n: loop.length }), 'ok'));
  openDialog({
    title: t('Fläche aus Auswahl'), iconName: 'domain', mod: 'sky', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Erzeugen'), kind: 'primary', onClick: () => {
      let id;
      st.commit(t('Fläche erzeugen'), (m) => { id = addDomain(m, loop, s); });
      st.select({ domains: [id] }, 'replace');
    } }],
  });
}

export function addHoleFromSelection(app) {
  const st = app.store;
  if (st.selection.domains.size !== 1) return toast(t('Bitte genau eine Fläche und die Öffnungslinien auswählen.'), 'warn');
  const loop = loopFromLines(st.model, st.selection.lines);
  if (!loop) return toast(t('Die gewählten Linien bilden keinen geschlossenen Umriss.'), 'warn');
  const did = [...st.selection.domains][0];
  st.commit(t('Öffnung'), (m) => { m.domains.find((x) => x.id === did).holes.push(loop); });
  toast(t('Öffnung eingefügt.'), 'ok');
}

/* ---------------- design parameters ---------------- */
export function designParams(app) {
  const st = app.store;
  const lines = [...st.selection.lines].map((id) => st.idx.lines.get(id)).filter((l) => l.element && ['beam', 'truss', 'rib'].includes(l.element.type));
  if (!lines.length) return toast(t('Bitte Stäbe auswählen.'), 'info');
  const d = { Ky: 1, Kz: 1, KLT: 1, C1: 1, steelCheck: true, ...(lines[0].element.design || {}) };
  const presets = [[t('Gelenkig–gelenkig'), 1], [t('Eingespannt–gelenkig'), 0.7], [t('Beidseitig eingespannt'), 0.5], [t('Kragstütze'), 2]];
  const kyIn = numInput({ value: d.Ky, min: 0.1, onChange: (v) => { d.Ky = v || 1; } });
  const kzIn = numInput({ value: d.Kz, min: 0.1, onChange: (v) => { d.Kz = v || 1; } });
  const body = h('div',
    h('h4', t('Knicklängenbeiwerte  Lcr = K · L')),
    h('div.row', { style: { flexWrap: 'wrap', gap: '6px', marginBottom: '12px' } }, presets.map(([n, v]) => h('button.btn.sm', { onclick: () => { d.Ky = v; d.Kz = v; kyIn.setValue(v); kzIn.setValue(v); } }, `${n} (${v})`))),
    h('div.grid2', field('Ky', kyIn, { stack: true, help: t('Knicken um die starke Achse y') }), field('Kz', kzIn, { stack: true, help: t('Knicken um die schwache Achse z') })),
    h('h4', t('Biegedrillknicken')),
    h('div.grid2',
      field('KLT', numInput({ value: d.KLT, min: 0.1, onChange: (v) => { d.KLT = v || 1; } }), { stack: true, help: t('Beiwert für die Kipplänge') }),
      field('C1', numInput({ value: d.C1, min: 0.5, onChange: (v) => { d.C1 = v || 1; } }), { stack: true, help: t('Momentenbeiwert: 1.0 konstant, 1.13 Gleichlast, 1.35 Einzellast Mitte, 1.77 dreieckig') })),
    h('div', { style: { marginTop: '10px' } }, checkInput(t('In Stahl-/Holzbemessung einbeziehen'), d.steelCheck !== false, (v) => { d.steelCheck = v; })));
  openDialog({
    title: t('Bemessungsparameter'), sub: t('{n} Stäbe', { n: lines.length }), iconName: 'buckling', mod: 'lilac', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Übernehmen'), kind: 'primary', onClick: () => {
      st.commit(t('Bemessungsparameter'), (m) => { for (const l of m.lines) if (st.selection.lines.has(l.id) && l.element) l.element.design = { ...d }; }, { keepResults: true });
    } }],
  });
}
