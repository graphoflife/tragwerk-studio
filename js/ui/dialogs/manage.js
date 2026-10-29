// Material, cross-section, load case/group and combination managers.
import { t } from '../../i18n.js';
import { h, ic, clear, openDialog, field, numInput, selectInput, textInput, toast, confirmDialog, hintBox, segmented, checkInput } from '../dom.js';
import { nextId } from '../../core/model.js';
import { fmt, fmtNum } from '../../core/units.js';
import { MATERIAL_LIBRARY } from '../../lib/materials.js';
import { SECTION_FAMILIES, getLibrarySection, makeParametricSection, sectionOutline } from '../../lib/sections.js';
import { generateCombinations } from '../../design/combinations.js';
import { groupColor } from '../panels.js';

const MAT_TYPES = [
  { value: 'steel', label: 'Stahl' }, { value: 'concrete', label: 'Beton' }, { value: 'timber', label: 'Holz' },
  { value: 'aluminium', label: 'Aluminium' }, { value: 'other', label: 'Andere' },
];
const MAT_ICON = { steel: 'steel', concrete: 'concrete', timber: 'timber', aluminium: 'section', other: 'material' };

/* ======================================================================
   Materials
   ====================================================================== */
export function openMaterials(app, selectId) {
  const st = app.store;
  let cur = selectId ?? st.model.materials[0]?.id ?? null;
  const listEl = h('div.list');
  const editEl = h('div');
  const render = () => {
    clear(listEl);
    for (const m of st.model.materials) {
      listEl.appendChild(h('button.list-item' + (m.id === cur ? '.active' : ''), { onclick: () => { cur = m.id; render(); } },
        ic(MAT_ICON[m.type] || 'material'), h('span.t', m.name), h('span.meta', t(MAT_TYPES.find((x) => x.value === m.type)?.label || ''))));
    }
    if (!st.model.materials.length) listEl.appendChild(h('div.empty', ic('material'), h('div', t('Noch keine Materialien'))));
    clear(editEl);
    const m = st.idx.materials.get(cur);
    if (!m) { editEl.appendChild(hintBox(t('Füge ein Material aus der Bibliothek hinzu oder lege ein eigenes an.'))); return; }
    const upd = (fn) => { st.commit(t('Material ändern'), (mm) => fn(mm.materials.find((x) => x.id === m.id))); render(); };
    editEl.appendChild(h('h4', t('Allgemein')));
    editEl.appendChild(field(t('Bezeichnung'), textInput({ value: m.name, onChange: (v) => upd((x) => { x.name = v; }) })));
    editEl.appendChild(field(t('Typ'), selectInput({ value: m.type, options: MAT_TYPES.map((x) => ({ ...x, label: t(x.label) })), onChange: (v) => upd((x) => { x.type = v; }) })));
    editEl.appendChild(h('div.grid2',
      field(t('E-Modul'), numInput({ value: m.E, q: 'modulus', onChange: (v) => upd((x) => { x.E = v; x.G = x.G ?? v / (2 * (1 + (x.nu ?? 0.3))); }) }), { stack: true }),
      field(t('Schubmodul G'), numInput({ value: m.G ?? m.E / (2 * (1 + (m.nu ?? 0.3))), q: 'modulus', onChange: (v) => upd((x) => { x.G = v; }) }), { stack: true }),
      field(t('Querdehnzahl ν'), numInput({ value: m.nu, onChange: (v) => upd((x) => { x.nu = v; }) }), { stack: true }),
      field(t('Dichte ρ'), numInput({ value: m.rho, q: 'density', onChange: (v) => upd((x) => { x.rho = v; }) }), { stack: true }),
      field(t('Wärmeausdehnung α'), numInput({ value: m.alpha, onChange: (v) => upd((x) => { x.alpha = v; }) }), { stack: true })));
    editEl.appendChild(h('h4', t('Festigkeiten')));
    if (m.type === 'steel' || m.type === 'aluminium' || m.type === 'other') {
      editEl.appendChild(h('div.grid2',
        field(t('Streckgrenze fy'), numInput({ value: m.fy, q: 'stress', onChange: (v) => upd((x) => { x.fy = v; }) }), { stack: true }),
        field(t('Zugfestigkeit fu'), numInput({ value: m.fu, q: 'stress', onChange: (v) => upd((x) => { x.fu = v; }) }), { stack: true })));
    }
    if (m.type === 'concrete') {
      editEl.appendChild(h('div.grid2',
        field(t('fck'), numInput({ value: m.fck, q: 'stress', onChange: (v) => upd((x) => { x.fck = v; }) }), { stack: true }),
        field(t('fctm'), numInput({ value: m.fctm, q: 'stress', onChange: (v) => upd((x) => { x.fctm = v; }) }), { stack: true })));
    }
    if (m.type === 'timber') {
      const tb = m.timber || {};
      const tf = (k, label) => field(label, numInput({ value: tb[k], q: 'stress', onChange: (v) => upd((x) => { x.timber = { ...(x.timber || {}), [k]: v }; }) }), { stack: true });
      editEl.appendChild(h('div.grid3', tf('fmk', 'fm,k'), tf('ft0k', 'ft,0,k'), tf('fc0k', 'fc,0,k'), tf('fvk', 'fv,k'), tf('ft90k', 'ft,90,k'), tf('fc90k', 'fc,90,k'), tf('E0mean', 'E0,mean'), tf('E005', 'E0,05'), tf('Gmean', 'Gmean')));
      editEl.appendChild(field(t('Holzart'), segmented([{ value: 'solid', label: t('Vollholz') }, { value: 'glulam', label: t('Brettschichtholz') }], tb.kind || 'solid', (v) => upd((x) => { x.timber = { ...(x.timber || {}), kind: v }; }))));
      editEl.appendChild(field(t('Nutzungsklasse'), selectInput({ value: tb.serviceClass || 1, options: [1, 2, 3].map((n) => ({ value: n, label: String(n) })), onChange: (v) => upd((x) => { x.timber = { ...(x.timber || {}), serviceClass: +v }; }) })));
    }
    const used = st.model.lines.filter((l) => l.element?.material === m.id).length + st.model.domains.filter((d) => d.material === m.id).length;
    editEl.appendChild(h('div.row', { style: { marginTop: '14px' } }, h('span.badge', t('{n}× verwendet', { n: used })), h('span.grow'),
      h('button.btn.sm', { onclick: () => { st.commit(t('Material duplizieren'), (mm) => { const id = nextId(mm.materials); mm.materials.push({ ...structuredClone(m), id, name: m.name + ' (2)' }); cur = id; }); render(); } }, ic('copy'), t('Duplizieren')),
      h('button.btn.sm.danger', { onclick: async () => {
        if (used && !(await confirmDialog(t('Material löschen'), t('Das Material wird von {n} Elementen verwendet. Trotzdem löschen?', { n: used }), { danger: true, okLabel: t('Löschen') }))) return;
        st.commit(t('Material löschen'), (mm) => { mm.materials = mm.materials.filter((x) => x.id !== m.id); });
        cur = st.model.materials[0]?.id ?? null; render();
      } }, ic('trash'), t('Löschen'))));
  };
  const lib = () => libraryPicker(app, (tpl) => {
    let id;
    st.commit(t('Material hinzufügen'), (mm) => { id = nextId(mm.materials); mm.materials.push({ ...structuredClone(tpl), id }); }, { keepResults: true });
    cur = id; render();
  });
  const custom = () => {
    let id;
    st.commit(t('Material hinzufügen'), (mm) => {
      id = nextId(mm.materials);
      mm.materials.push({ id, name: t('Material {n}', { n: id }), type: 'other', E: 2.1e8, G: 8.1e7, nu: 0.3, rho: 7.85, alpha: 1.2e-5, fy: 235000, fu: 360000 });
    }, { keepResults: true });
    cur = id; render();
  };
  render();
  openDialog({
    title: t('Materialien'), sub: t('Materialbibliothek nach Eurocode / SIA'), iconName: 'material', mod: 'sky', size: 'wide',
    body: h('div.dlg-split', { style: { minHeight: '460px' } },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px solid var(--border)', paddingRight: '12px' } },
        h('button.btn.primary.sm', { onclick: lib }, ic('book'), t('Aus Bibliothek')),
        h('button.btn.sm', { onclick: custom }, ic('plus'), t('Eigenes Material')), listEl),
      editEl),
    buttons: [{ label: t('Fertig'), kind: 'primary' }],
  });
}

function libraryPicker(app, onPick) {
  const groups = {};
  for (const m of MATERIAL_LIBRARY) (groups[m.type] = groups[m.type] || []).push(m);
  const body = h('div');
  for (const [type, list] of Object.entries(groups)) {
    body.appendChild(h('h4', t(MAT_TYPES.find((x) => x.value === type)?.label || type)));
    const cards = h('div.cards');
    for (const m of list) {
      const sub = m.type === 'concrete' ? `fck ${fmt('stress', m.fck)}` : m.type === 'timber' ? `fm,k ${fmt('stress', m.timber?.fmk)}` : m.fy ? `fy ${fmt('stress', m.fy)}` : fmt('modulus', m.E);
      cards.appendChild(h('button.card-choice', { onclick: () => { onPick(m); d.close(); toast(t('{n} hinzugefügt.', { n: m.name }), 'ok'); } },
        h('div.chip', ic(MAT_ICON[m.type] || 'material')), h('div.t', m.name), h('div.d', sub + (m.norm ? ' · ' + m.norm : ''))));
    }
    body.appendChild(cards);
  }
  const d = openDialog({ title: t('Materialbibliothek'), iconName: 'book', mod: 'sky', size: 'wide', body, buttons: [{ label: t('Schliessen'), kind: 'ghost' }] });
}

/* ======================================================================
   Sections
   ====================================================================== */
const PARAM_SHAPES = [
  { value: 'RECT', label: 'Rechteck', dims: [['h', 0.5], ['b', 0.3]] },
  { value: 'CIRC', label: 'Kreis', dims: [['d', 0.3]] },
  { value: 'I', label: 'I-Profil', dims: [['h', 0.4], ['b', 0.2], ['tw', 0.01], ['tf', 0.016]] },
  { value: 'RHS', label: 'Rechteckrohr', dims: [['h', 0.2], ['b', 0.1], ['t', 0.008]] },
  { value: 'CHS', label: 'Rundrohr', dims: [['d', 0.1683], ['t', 0.008]] },
  { value: 'T', label: 'T-Profil', dims: [['h', 0.3], ['b', 0.2], ['tw', 0.01], ['tf', 0.015]] },
  { value: 'L', label: 'Winkel', dims: [['h', 0.1], ['b', 0.1], ['t', 0.01]] },
  { value: 'U', label: 'U-Profil', dims: [['h', 0.2], ['b', 0.075], ['tw', 0.0085], ['tf', 0.0115]] },
  { value: 'BOX', label: 'Kastenprofil', dims: [['h', 0.4], ['b', 0.3], ['tw', 0.012], ['tf', 0.015]] },
];

export function sectionSvg(sec) {
  let ol;
  try { ol = sectionOutline(sec); } catch (e) { ol = null; }
  if (!ol?.outer?.length) return h('div.muted.small', t('Keine Vorschau'));
  const all = [...ol.outer, ...(ol.holes || []).flat()];
  const ys = all.map((p) => p[0]), zs = all.map((p) => p[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const w = maxY - minY || 1, hh = maxZ - minZ || 1, pad = Math.max(w, hh) * 0.12;
  const path = (ring) => ring.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - minY + pad).toFixed(5)} ${(maxZ - p[1] + pad).toFixed(5)}`).join(' ') + 'Z';
  const d = [ol.outer, ...(ol.holes || [])].map(path).join(' ');
  const el = document.createElement('div');
  el.className = 'sec-preview';
  el.innerHTML = `<svg viewBox="0 0 ${w + 2 * pad} ${hh + 2 * pad}" preserveAspectRatio="xMidYMid meet">
    <path d="${d}" fill-rule="evenodd" fill="color-mix(in srgb, var(--p-sky) 55%, transparent)" stroke="var(--accent)" stroke-width="${Math.max(w, hh) * 0.008}"/>
    <path d="M${pad + (0 - minY)} ${pad / 3} V${hh + pad * 1.66} M${pad / 3} ${pad + maxZ} H${w + pad * 1.66}" stroke="var(--text-3)" stroke-width="${Math.max(w, hh) * 0.004}" stroke-dasharray="${Math.max(w, hh) * 0.02}"/>
  </svg>`;
  return el;
}

function propsTable(sec) {
  const rows = [
    ['A', sec.A, 'area'], ['Iy', sec.Iy, 'inertia'], ['Iz', sec.Iz, 'inertia'], ['It', sec.It, 'inertia'], ['Iw', sec.Iw, 'warping'],
    ['Wel,y', sec.Wely, 'secMod'], ['Wel,z', sec.Welz, 'secMod'], ['Wpl,y', sec.Wply, 'secMod'], ['Wpl,z', sec.Wplz, 'secMod'],
    ['Avy', sec.Avy, 'area'], ['Avz', sec.Avz, 'area'], ['iy', sec.iy, 'dim'], ['iz', sec.iz, 'dim'],
  ];
  return h('div.sec-props', rows.filter((r) => r[1] != null).map(([k, v, q]) => h('div', h('span', k), h('span.num', fmt(q, v)))));
}

export function openSections(app, onPick, selectId) {
  const st = app.store;
  let cur = selectId ?? st.model.sections[0]?.id ?? null;
  let mode = 'model';
  const left = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px solid var(--border)', paddingRight: '12px', minHeight: 0, overflow: 'auto' } });
  const right = h('div', { style: { minWidth: 0 } });
  const addSection = (tpl) => {
    let id;
    st.commit(t('Querschnitt hinzufügen'), (m) => {
      const ex = m.sections.find((x) => x.name === tpl.name);
      if (ex) { id = ex.id; return; }
      id = nextId(m.sections);
      m.sections.push({ ...structuredClone(tpl), id });
    }, { keepResults: true });
    cur = id; mode = 'model';
    render();
    return id;
  };

  const render = () => {
    clear(left); clear(right);
    left.appendChild(segmented([{ value: 'model', label: t('Modell') }, { value: 'library', label: t('Bibliothek') }, { value: 'param', label: t('Parametrisch') }], mode, (v) => { mode = v; render(); }, { full: true }));
    if (mode === 'model') {
      const list = h('div.list');
      for (const s of st.model.sections) {
        list.appendChild(h('button.list-item' + (s.id === cur ? '.active' : ''), { onclick: () => { cur = s.id; render(); } }, ic('section'), h('span.t', s.name),
          h('span.meta', t('{n}×', { n: st.model.lines.filter((l) => l.element?.section === s.id).length }))));
      }
      if (!st.model.sections.length) list.appendChild(h('div.empty', ic('section'), h('div', t('Noch keine Querschnitte – Bibliothek öffnen.'))));
      left.appendChild(list);
      const s = st.idx.sections.get(cur);
      if (!s) { right.appendChild(hintBox(t('Wähle links „Bibliothek“ oder „Parametrisch“, um Querschnitte hinzuzufügen.'))); return; }
      right.append(h('div.row', h('h3', { style: { margin: '0 0 10px', fontSize: '17px' } }, s.name), h('span.grow'), h('span.badge', s.family || s.shape)));
      right.append(h('div.grid2', { style: { gridTemplateColumns: '1fr 1.2fr', alignItems: 'start' } }, sectionSvg(s), propsTable(s)));
      const used = st.model.lines.filter((l) => l.element?.section === s.id).length;
      right.appendChild(h('div.row', { style: { marginTop: '14px' } },
        field(t('Bezeichnung'), textInput({ value: s.name, onChange: (v) => st.commit(t('Querschnitt umbenennen'), (m) => { m.sections.find((x) => x.id === s.id).name = v; }, { keepResults: true }) })),
        h('span.grow'),
        st.selCount() && st.selection.lines.size ? h('button.btn.sm', { onclick: () => {
          st.commit(t('Querschnitt zuweisen'), (m) => { for (const l of m.lines) if (st.selection.lines.has(l.id) && l.element) l.element.section = s.id; });
          toast(t('Querschnitt den gewählten Stäben zugewiesen.'), 'ok');
        } }, ic('check'), t('Auswahl zuweisen')) : null,
        h('button.btn.sm.danger', { onclick: async () => {
          if (used && !(await confirmDialog(t('Querschnitt löschen'), t('Der Querschnitt wird von {n} Stäben verwendet. Trotzdem löschen?', { n: used }), { danger: true, okLabel: t('Löschen') }))) return;
          st.commit(t('Querschnitt löschen'), (m) => { m.sections = m.sections.filter((x) => x.id !== s.id); });
          cur = st.model.sections[0]?.id ?? null; render();
        } }, ic('trash'), t('Löschen'))));
    } else if (mode === 'library') {
      let fam = libState.fam || SECTION_FAMILIES[0]?.key;
      const famSel = selectInput({ value: fam, options: SECTION_FAMILIES.map((f) => ({ value: f.key, label: f.label })), onChange: (v) => { libState.fam = v; libState.name = null; render(); } });
      const search = h('input.input.sm', { placeholder: t('Filter …'), value: libState.q || '' });
      search.addEventListener('input', () => { libState.q = search.value; renderNames(); });
      const names = h('div.list', { style: { overflow: 'auto' } });
      const renderNames = () => {
        clear(names);
        const f = SECTION_FAMILIES.find((x) => x.key === fam);
        for (const n of (f?.names || []).filter((x) => !libState.q || x.toLowerCase().includes(libState.q.toLowerCase()))) {
          names.appendChild(h('button.list-item' + (libState.name === n ? '.active' : ''), { onclick: () => { libState.name = n; render(); }, ondblclick: () => { const id = addSection(getLibrarySection(n)); if (onPick) { onPick(id); } } }, h('span.t', n)));
        }
      };
      renderNames();
      left.append(famSel, search, names);
      const tpl = libState.name ? getLibrarySection(libState.name) : null;
      if (!tpl) { right.appendChild(hintBox(t('Profilreihe wählen und Profil anklicken. Doppelklick übernimmt es direkt.'))); return; }
      right.append(h('h3', { style: { margin: '0 0 10px', fontSize: '17px' } }, tpl.name), h('div.grid2', { style: { gridTemplateColumns: '1fr 1.2fr', alignItems: 'start' } }, sectionSvg(tpl), propsTable(tpl)));
      right.appendChild(h('div.row', { style: { marginTop: '14px' } }, h('span.grow'), h('button.btn.primary', { onclick: () => { const id = addSection(tpl); onPick?.(id); } }, ic('plus'), t('Ins Modell übernehmen'))));
    } else {
      const shape = PARAM_SHAPES.find((x) => x.value === (libState.shape || 'RECT'));
      libState.dims = libState.dims && libState.dimsShape === shape.value ? libState.dims : Object.fromEntries(shape.dims);
      libState.dimsShape = shape.value;
      const cards = h('div.list');
      for (const s of PARAM_SHAPES) cards.appendChild(h('button.list-item' + (s.value === shape.value ? '.active' : ''), { onclick: () => { libState.shape = s.value; render(); } }, ic('section'), h('span.t', t(s.label))));
      left.appendChild(cards);
      let tpl = null;
      try { tpl = makeParametricSection(shape.value, libState.dims); } catch (e) { tpl = null; }
      const dimsBox = h('div.grid2');
      for (const [k] of shape.dims) dimsBox.appendChild(field(k, numInput({ value: libState.dims[k], q: 'dim', min: 0.0001, onChange: (v) => { libState.dims[k] = v; render(); } }), { stack: true }));
      right.append(h('h4', t('Abmessungen')), dimsBox);
      if (tpl) {
        const name = `${shape.value} ${shape.dims.map(([k]) => fmtNum(libState.dims[k] * 1000)).join('×')}`;
        tpl.name = name;
        right.append(h('h4', t('Werte')), h('div.grid2', { style: { gridTemplateColumns: '1fr 1.2fr', alignItems: 'start' } }, sectionSvg(tpl), propsTable(tpl)));
        right.appendChild(h('div.row', { style: { marginTop: '14px' } }, h('span.grow'), h('button.btn.primary', { onclick: () => { const id = addSection(tpl); onPick?.(id); } }, ic('plus'), t('Ins Modell übernehmen'))));
      }
    }
  };
  const libState = {};
  render();
  openDialog({
    title: t('Querschnitte'), sub: t('Walzprofile, Hohlprofile, parametrische Querschnitte'), iconName: 'section', mod: 'sky', size: 'xwide',
    body: h('div.dlg-split', { style: { gridTemplateColumns: '280px 1fr', height: '100%' } }, left, right),
    buttons: onPick ? [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Gewählten verwenden'), kind: 'primary', onClick: () => { if (cur) onPick(cur); } }] : [{ label: t('Fertig'), kind: 'primary' }],
  });
}

/* ======================================================================
   Load cases & groups
   ====================================================================== */
const GROUP_TYPES = [
  { value: 'permanent', label: 'Ständig (G)' }, { value: 'variable', label: 'Veränderlich (Q)' }, { value: 'snow', label: 'Schnee (S)' },
  { value: 'wind', label: 'Wind (W)' }, { value: 'accidental', label: 'Aussergewöhnlich (A)' }, { value: 'seismic', label: 'Erdbeben (E)' },
];
export const DEFAULT_PSI = {
  EC: { permanent: [1.35, 1.0, 1, 1, 1], variable: [1.5, 0, 0.7, 0.5, 0.3], snow: [1.5, 0, 0.5, 0.2, 0], wind: [1.5, 0, 0.6, 0.2, 0], accidental: [1, 0, 1, 1, 1], seismic: [1, 0, 1, 1, 1] },
  SIA: { permanent: [1.35, 0.8, 1, 1, 1], variable: [1.5, 0, 0.7, 0.5, 0.3], snow: [1.5, 0, 0.6, 0.5, 0], wind: [1.5, 0, 0.6, 0.5, 0], accidental: [1, 0, 1, 1, 1], seismic: [1, 0, 1, 1, 1] },
};

export function openLoadCases(app) {
  const st = app.store;
  const body = h('div');
  const render = () => {
    clear(body);
    const m = st.model;
    body.appendChild(h('div.row', h('h4', { style: { margin: 0 } }, t('Lastgruppen')), h('span.grow'),
      h('button.btn.sm', { onclick: () => { st.commit(t('Lastgruppe hinzufügen'), (mm) => { const id = nextId(mm.loadGroups); const p = DEFAULT_PSI[mm.settings.code === 'SIA' ? 'SIA' : 'EC'].variable; mm.loadGroups.push({ id, name: t('Gruppe {n}', { n: id }), type: 'variable', gammaSup: p[0], gammaInf: p[1], psi0: p[2], psi1: p[3], psi2: p[4], exclusive: false }); }); render(); } }, ic('plus'), t('Gruppe'))));
    const gt = h('table.tbl');
    gt.appendChild(h('tr', ['Name', t('Typ'), 'γsup', 'γinf', 'ψ0', 'ψ1', 'ψ2', t('Exklusiv'), ''].map((x, i) => h('th' + (i < 2 ? '.txt' : ''), x))));
    for (const g of m.loadGroups) {
      const upd = (fn) => st.commit(t('Lastgruppe ändern'), (mm) => fn(mm.loadGroups.find((x) => x.id === g.id)), { keepResults: true });
      const num = (k) => { const i = numInput({ value: g[k], onChange: (v) => upd((x) => { x[k] = v ?? 0; }) }); i.style.width = '70px'; return h('td', i); };
      gt.appendChild(h('tr',
        h('td.txt', textInput({ value: g.name, onChange: (v) => upd((x) => { x.name = v; }) })),
        h('td.txt', selectInput({ value: g.type, small: true, options: GROUP_TYPES.map((x) => ({ ...x, label: t(x.label) })), onChange: (v) => {
          const p = DEFAULT_PSI[m.settings.code === 'SIA' ? 'SIA' : 'EC'][v];
          upd((x) => { x.type = v; [x.gammaSup, x.gammaInf, x.psi0, x.psi1, x.psi2] = p; });
          render();
        } })),
        num('gammaSup'), num('gammaInf'), num('psi0'), num('psi1'), num('psi2'),
        h('td', checkInput('', g.exclusive, (v) => upd((x) => { x.exclusive = v; }))),
        h('td', h('button.icon-btn.sm', { onclick: () => { st.commit(t('Lastgruppe löschen'), (mm) => { mm.loadGroups = mm.loadGroups.filter((x) => x.id !== g.id); mm.loadCases.forEach((lc) => { if (lc.group === g.id) lc.group = null; }); }); render(); } }, ic('trash')))));
    }
    body.appendChild(h('div.tbl-wrap', { style: { margin: '8px 0 18px' } }, gt));

    body.appendChild(h('div.row', h('h4', { style: { margin: 0 } }, t('Lastfälle')), h('span.grow'),
      h('button.btn.sm', { onclick: () => { app.addLoadCase(); render(); } }, ic('plus'), t('Lastfall'))));
    const lt = h('table.tbl');
    lt.appendChild(h('tr', ['#', 'Name', t('Lastgruppe'), t('Eigengewicht'), t('Lasten'), ''].map((x, i) => h('th' + (i < 3 ? '.txt' : ''), x))));
    for (const lc of m.loadCases) {
      const upd = (fn) => st.commit(t('Lastfall ändern'), (mm) => fn(mm.loadCases.find((x) => x.id === lc.id)));
      const grp = st.idx.loadGroups.get(lc.group);
      lt.appendChild(h('tr' + (lc.id === st.activeLC ? '.sel' : ''),
        h('td.txt', h('span.row', h('span.color-swatch', { style: { background: groupColor(grp?.type) } }), String(lc.id))),
        h('td.txt', textInput({ value: lc.name, onChange: (v) => upd((x) => { x.name = v; }) })),
        h('td.txt', selectInput({ value: lc.group ?? '', small: true, options: [{ value: '', label: t('– ständig –') }, ...m.loadGroups.map((g) => ({ value: g.id, label: g.name }))], onChange: (v) => upd((x) => { x.group = v === '' ? null : +v; }) })),
        h('td', checkInput('', lc.selfWeight, (v) => upd((x) => { x.selfWeight = v; }))),
        h('td', String(m.loads.filter((l) => l.lc === lc.id).length)),
        h('td', h('div.row', { style: { justifyContent: 'flex-end', gap: '2px' } },
          h('button.icon-btn.sm', { onclick: () => { app.setActiveLC(lc.id); render(); }, tip: [t('Aktivieren')] }, ic('check')),
          h('button.icon-btn.sm', { onclick: () => {
            st.commit(t('Lastfall kopieren'), (mm) => {
              const id = nextId(mm.loadCases);
              mm.loadCases.push({ ...structuredClone(lc), id, name: lc.name + ' (2)' });
              for (const l of mm.loads.filter((x) => x.lc === lc.id)) mm.loads.push({ ...structuredClone(l), id: nextId(mm.loads), lc: id });
            });
            render();
          }, tip: [t('Duplizieren')] }, ic('copy')),
          h('button.icon-btn.sm', { onclick: async () => {
            const n = m.loads.filter((l) => l.lc === lc.id).length;
            if (n && !(await confirmDialog(t('Lastfall löschen'), t('Der Lastfall enthält {n} Lasten. Löschen?', { n }), { danger: true, okLabel: t('Löschen') }))) return;
            st.commit(t('Lastfall löschen'), (mm) => {
              mm.loadCases = mm.loadCases.filter((x) => x.id !== lc.id);
              mm.loads = mm.loads.filter((l) => l.lc !== lc.id);
              for (const c of mm.combinations) delete c.factors[lc.id];
            });
            render();
          }, tip: [t('Löschen')] }, ic('trash'))))));
    }
    body.appendChild(h('div.tbl-wrap', { style: { marginTop: '8px' } }, lt));
    body.appendChild(hintBox(t('Lastfälle gehören zu Lastgruppen. Die Gruppe bestimmt Teilsicherheits- und Kombinationsbeiwerte für die automatische Kombination ({c}). Exklusive Gruppen: nur ein Lastfall gleichzeitig (z.B. Wind aus verschiedenen Richtungen).', { c: m.settings.code === 'SIA' ? 'SIA 260' : 'EN 1990' })));
  };
  render();
  openDialog({ title: t('Lastfälle & Lastgruppen'), iconName: 'loadCase', mod: 'rose', size: 'wide', body, buttons: [{ label: t('Fertig'), kind: 'primary' }], onClose: () => app.renderRibbon() });
}

/* ======================================================================
   Combinations
   ====================================================================== */
const COMBO_TYPES = ['ULS', 'ULS-ACC', 'SLS-CHAR', 'SLS-FREQ', 'SLS-QP', 'CUSTOM'];

export function openCombinations(app) {
  const st = app.store;
  const body = h('div');
  const render = () => {
    clear(body);
    const m = st.model;
    body.appendChild(h('div.row', { style: { marginBottom: '10px' } },
      h('button.btn.sm', { onclick: () => { st.commit(t('Kombination hinzufügen'), (mm) => { const id = nextId(mm.combinations); mm.combinations.push({ id, name: t('Kombination {n}', { n: id }), type: 'CUSTOM', factors: Object.fromEntries(mm.loadCases.map((lc) => [lc.id, 1])) }); }); render(); } }, ic('plus'), t('Neue Kombination')),
      h('button.btn.sm', { onclick: () => { autoCombinations(app, render); } }, ic('sparkles'), t('Automatisch erzeugen')),
      h('span.grow'),
      m.combinations.length ? h('button.btn.sm.danger', { onclick: async () => { if (await confirmDialog(t('Alle Kombinationen löschen'), t('Wirklich alle {n} Kombinationen löschen?', { n: m.combinations.length }), { danger: true })) { st.commit(t('Kombinationen löschen'), (mm) => { mm.combinations = []; }); render(); } } }, ic('trash'), t('Alle löschen')) : null));
    if (!m.combinations.length) { body.appendChild(h('div.empty', ic('combination'), h('div', t('Noch keine Kombinationen.')))); return; }
    const tb = h('table.tbl');
    tb.appendChild(h('tr', h('th.txt', 'Name'), h('th.txt', t('Typ')), ...m.loadCases.map((lc) => h('th', { title: lc.name }, lc.name.length > 12 ? lc.name.slice(0, 11) + '…' : lc.name)), h('th', '')));
    for (const c of m.combinations) {
      const upd = (fn) => st.commit(t('Kombination ändern'), (mm) => fn(mm.combinations.find((x) => x.id === c.id)));
      const nameIn = textInput({ value: c.name, onChange: (v) => upd((x) => { x.name = v; }) });
      nameIn.style.minWidth = '220px';
      tb.appendChild(h('tr',
        h('td.txt', nameIn),
        h('td.txt', selectInput({ value: c.type, small: true, options: COMBO_TYPES.map((x) => ({ value: x, label: x })), onChange: (v) => upd((x) => { x.type = v; }) })),
        ...m.loadCases.map((lc) => {
          const i = numInput({ value: c.factors[lc.id] ?? 0, onChange: (v) => upd((x) => { if (v) x.factors[lc.id] = v; else delete x.factors[lc.id]; }) });
          i.style.width = '64px';
          return h('td', i);
        }),
        h('td', h('button.icon-btn.sm', { onclick: () => { st.commit(t('Kombination löschen'), (mm) => { mm.combinations = mm.combinations.filter((x) => x.id !== c.id); }); render(); } }, ic('trash')))));
    }
    body.appendChild(h('div.tbl-wrap', { style: { maxHeight: '56vh' } }, tb));
  };
  render();
  openDialog({ title: t('Lastfallkombinationen'), sub: t('Faktoren je Lastfall'), iconName: 'combination', mod: 'rose', size: 'xwide', body, buttons: [{ label: t('Fertig'), kind: 'primary' }] });
}

export function autoCombinations(app, after) {
  const st = app.store;
  const code = st.model.settings.code === 'SIA' ? 'SIA' : 'EC';
  const opts = { code, uls: '6.10', sls: true, accidental: true, replace: true };
  const body = h('div',
    hintBox(code === 'SIA'
      ? t('Erzeugt Kombinationen nach SIA 260: Tragsicherheit Typ 2 (γG = 1.35/0.80, γQ = 1.5, Leiteinwirkung je Gruppe), aussergewöhnliche Bemessungssituationen und Gebrauchstauglichkeit (selten, häufig, quasi-ständig).')
      : t('Erzeugt Kombinationen nach EN 1990: Grenzzustand der Tragfähigkeit (6.10 bzw. 6.10a/b), aussergewöhnlich (6.11), Erdbeben (6.12) und Gebrauchstauglichkeit (charakteristisch, häufig, quasi-ständig).')),
    code === 'EC' ? field(t('GZT-Gleichung'), segmented([{ value: '6.10', label: '6.10' }, { value: '6.10ab', label: '6.10a/b' }], '6.10', (v) => { opts.uls = v; })) : null,
    h('div', { style: { marginTop: '8px' } }, checkInput(t('Gebrauchstauglichkeit (GZG) erzeugen'), true, (v) => { opts.sls = v; })),
    h('div', { style: { marginTop: '8px' } }, checkInput(t('Bestehende Kombinationen ersetzen'), true, (v) => { opts.replace = v; })));
  openDialog({
    title: t('Automatische Kombinationen'), sub: code === 'SIA' ? 'SIA 260' : 'EN 1990', iconName: 'sparkles', mod: 'rose', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Erzeugen'), kind: 'primary', icon: 'sparkles', onClick: () => {
      let list;
      try { list = generateCombinations(st.model, opts); } catch (e) { console.error(e); toast(t('Fehler beim Erzeugen: {m}', { m: e.message }), 'err'); return; }
      if (!list?.length) { toast(t('Keine Kombinationen erzeugt – sind Lastfälle mit Lastgruppen vorhanden?'), 'warn'); return; }
      st.commit(t('Automatische Kombinationen'), (m) => {
        if (opts.replace) m.combinations = [];
        for (const c of list) m.combinations.push({ ...c, id: nextId(m.combinations) });
      });
      toast(t('{n} Kombinationen erzeugt.', { n: list.length }), 'ok');
      after?.();
    } }],
  });
}
