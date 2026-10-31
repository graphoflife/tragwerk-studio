// Parts (Teile) and storeys (Geschosse) UI: list with checkboxes, used in the model panel and the popover.
import { t } from '../i18n.js';
import { h, ic, clear, toast, promptDialog } from './dom.js';
import { fmt } from '../core/units.js';
import { listParts, partMembers, detectStoreys } from '../core/parts.js';
import { nextId } from '../core/model.js';

const TYPE_NAMES = { beam: 'Balken', truss: 'Fachwerkstab', rib: 'Rippe', spring: 'Feder', rigid: 'Starrstab', geom: 'Geometrielinien', plate: 'Platte', shell: 'Schale', membrane: 'Scheibe' };

export function storeyLabel(p) {
  return `${p.name || t('Geschoss {n}', { n: p.index })} · z = ${fmt('len', p.z)}`;
}

/** Parts → label for any part entry */
export function partLabel(p) {
  if (p.group === 'storey') return storeyLabel(p);
  if (p.group === 'type') return t(TYPE_NAMES[p.id] || p.id);
  return p.name;
}

export function newPartFromSelection(app) {
  const st = app.store, s = st.selection;
  if (!st.geoCount()) return toast(t('Bitte zuerst Knoten, Linien oder Flächen auswählen.'), 'info');
  promptDialog(t('Neuer Teil'), t('Name'), t('Teil {n}', { n: (st.model.parts?.length || 0) + 1 }), { iconName: 'layers' }).then((name) => {
    if (!name) return;
    let id;
    st.commit(t('Neuer Teil'), (m) => {
      m.parts = m.parts || [];
      id = nextId(m.parts);
      m.parts.push({ id, name, nodes: [...s.nodes], lines: [...s.lines], domains: [...s.domains] });
    }, { keepResults: true });
    toast(t('Teil „{n}“ angelegt – anhaken, um nur diesen Teil zu zeigen.', { n: name }), 'ok', 4000);
  });
}

export function detectStoreysCmd(app) {
  const st = app.store;
  const levels = detectStoreys(st.model);
  if (levels.length < 2) return toast(t('Keine Geschosse gefunden (horizontale Flächen oder Stützen nötig).'), 'info');
  st.commit(t('Geschosse erkennen'), (m) => { m.storeys = levels.map((z, i) => ({ id: i + 1, z })); }, { keepResults: true });
  toast(t('{n} Geschosse erkannt: {list}', { n: levels.length, list: levels.map((z) => fmt('len', z, { unit: false })).join(', ') + ' m' }), 'ok', 5000);
}

/** Builds the parts list into container `el`; re-renders itself after each change. */
export function renderParts(app, el, { compact = false } = {}) {
  const st = app.store, m = st.model;
  const render = () => renderParts(app, el, { compact });
  clear(el);
  const on = st.view.parts.on;
  const parts = listParts(m);
  const set = (keys) => { st.setParts(keys); render(); };
  const toggle = (key, v) => { const n = new Set(on); if (v) n.add(key); else n.delete(key); set(n); };
  const count = (key) => { const mm = partMembers(m, key); return mm.lines.size + mm.domains.size; };
  const row = (p, extra = []) => {
    const cb = h('input', { type: 'checkbox', checked: on.has(p.key) });
    cb.addEventListener('change', () => toggle(p.key, cb.checked));
    return h('div.part-row' + (on.has(p.key) ? '.on' : ''),
      h('label.part-check', cb, h('span.t', partLabel(p)), h('span.meta', String(count(p.key)))),
      h('span.acts',
        h('button.icon-btn.sm', { onclick: () => set([p.key]), tip: [t('Nur diesen Teil zeigen')] }, ic('isolate')),
        h('button.icon-btn.sm', { onclick: () => { const mm = partMembers(m, p.key); st.select(mm.lines.size || mm.domains.size ? { lines: [...mm.lines], domains: [...mm.domains] } : { nodes: [...mm.nodes] }, 'replace'); }, tip: [t('Elemente des Teils auswählen')] }, ic('select')),
        ...extra));
  };
  // header
  el.appendChild(h('div.row', { style: { gap: '6px', marginBottom: '6px' } },
    h('span.small.muted.grow', on.size ? t('{n} Teile aktiv – nur sie sind sichtbar (auch in den Ergebnissen).', { n: on.size }) : t('Angehakte Teile werden angezeigt. Nichts angehakt = alles sichtbar.')),
    on.size ? h('button.btn.sm', { onclick: () => set([]) }, ic('eye'), t('Alle zeigen')) : null));
  // user parts
  const user = parts.filter((p) => p.group === 'user');
  const uBox = h('div.part-group', h('div.part-head', ic('layers'), h('b', t('Eigene Teile')), h('span.grow'),
    h('button.btn.sm', { onclick: () => newPartFromSelection(app), tip: [t('Neuer Teil'), t('Teil aus der aktuellen Auswahl erzeugen')] }, ic('plus'), t('Aus Auswahl'))));
  if (!user.length) uBox.appendChild(h('div.small.muted', { style: { padding: '2px 4px 6px' } }, t('Noch keine Teile – Elemente auswählen und „Aus Auswahl“ klicken.')));
  for (const p of user) {
    const sel = st.selection;
    uBox.appendChild(row(p, [
      h('button.icon-btn.sm', { onclick: () => st.commit(t('Teil ändern'), (mm) => { const q = mm.parts.find((x) => x.id === p.id); q.nodes = [...new Set([...q.nodes, ...sel.nodes])]; q.lines = [...new Set([...q.lines, ...sel.lines])]; q.domains = [...new Set([...q.domains, ...sel.domains])]; }, { keepResults: true }), tip: [t('Auswahl hinzufügen')] }, ic('plus')),
      h('button.icon-btn.sm', { onclick: () => st.commit(t('Teil ändern'), (mm) => { const q = mm.parts.find((x) => x.id === p.id); q.nodes = q.nodes.filter((x) => !sel.nodes.has(x)); q.lines = q.lines.filter((x) => !sel.lines.has(x)); q.domains = q.domains.filter((x) => !sel.domains.has(x)); }, { keepResults: true }), tip: [t('Auswahl entfernen')] }, ic('minus')),
      h('button.icon-btn.sm', { onclick: () => promptDialog(t('Teil umbenennen'), t('Name'), p.name, { iconName: 'layers' }).then((nm) => nm && st.commit(t('Teil umbenennen'), (mm) => { mm.parts.find((x) => x.id === p.id).name = nm; }, { keepResults: true })), tip: [t('Umbenennen')] }, ic('tag')),
      h('button.icon-btn.sm', { onclick: () => st.commit(t('Teil löschen'), (mm) => { mm.parts = mm.parts.filter((x) => x.id !== p.id); }, { keepResults: true }), tip: [t('Teil löschen (Elemente bleiben)')] }, ic('trash')),
    ]));
  }
  el.appendChild(uBox);
  // storeys
  const storeys = parts.filter((p) => p.group === 'storey');
  const sBox = h('div.part-group', h('div.part-head', ic('building'), h('b', t('Geschosse')), h('span.grow'),
    h('button.btn.sm', { onclick: () => detectStoreysCmd(app), tip: [t('Geschosse erkennen'), t('Höhenlagen aus horizontalen Flächen und Stützen ermitteln')] }, ic('sparkles'), storeys.length ? t('Neu erkennen') : t('Erkennen')),
    storeys.length ? h('button.icon-btn.sm', { onclick: () => st.commit(t('Geschosse löschen'), (mm) => { mm.storeys = []; }, { keepResults: true }), tip: [t('Geschosse löschen')] }, ic('trash')) : null));
  if (!storeys.length) sBox.appendChild(h('div.small.muted', { style: { padding: '2px 4px 6px' } }, t('Ein Geschoss umfasst die Decke auf seiner Höhe und die Stützen und Wände darunter.')));
  for (const p of [...storeys].reverse()) {
    const wpOn = st.view.workplane.plane === 'XY' && Math.abs(st.view.workplane.offset - p.z) < 1e-6;
    sBox.appendChild(row(p, [
      h('button.icon-btn.sm' + (wpOn ? '.active' : ''), { onclick: () => { st.setView({ workplane: { plane: 'XY', offset: p.z } }); render(); toast(t('Arbeitsebene XY auf z = {z}', { z: fmt('len', p.z) }), 'info'); }, tip: [t('Arbeitsebene auf dieses Geschoss setzen')] }, ic('plane')),
      h('button.icon-btn.sm', { onclick: () => promptDialog(t('Geschoss umbenennen'), t('Name'), p.name || '', { iconName: 'building' }).then((nm) => nm != null && st.commit(t('Geschoss umbenennen'), (mm) => { mm.storeys.find((x) => x.id === p.id).name = nm || undefined; }, { keepResults: true })), tip: [t('Umbenennen')] }, ic('tag')),
    ]));
  }
  el.appendChild(sBox);
  // logical parts
  for (const [group, title, iconName] of [['material', t('Materialien'), 'material'], ['section', t('Querschnitte'), 'section'], ['type', t('Elementtypen'), 'beam']]) {
    const list = parts.filter((p) => p.group === group);
    if (!list.length) continue;
    const det = h('details.part-group', h('summary.part-head', ic(iconName), h('b', title), h('span.badge', String(list.length))));
    det.open = list.some((p) => on.has(p.key));
    for (const p of list) det.appendChild(row(p));
    el.appendChild(det);
  }
}
