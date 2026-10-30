// Delete the selection. With a mixed selection a dialog lets the user choose which kinds to delete.
import { t } from '../../i18n.js';
import { h, ic, clear, openDialog, toast, segmented } from '../dom.js';
import { removeEntities } from '../../core/model.js';

// categories the user switched off last time (kept for the session)
const lastOff = new Set();
let lastMemberMode = 'line';

export function deleteSelection(app) {
  const st = app.store, s = st.selection, idx = st.idx;
  if (!st.selCount()) { toast(t('Nichts ausgewählt.'), 'info'); return; }
  const lines = [...s.lines].map((id) => idx.lines.get(id)).filter(Boolean);
  const cats = [
    { key: 'nodes', label: t('Knoten'), icon: 'node', ids: [...s.nodes], note: t('angeschlossene Linien, Flächen, Lager und Lasten werden mitgelöscht') },
    { key: 'geomLines', label: t('Linien (Geometrie)'), icon: 'line', ids: lines.filter((l) => !l.element).map((l) => l.id), note: t('inkl. Lasten und Lager auf diesen Linien') },
    { key: 'members', label: t('Stäbe'), icon: 'beam', ids: lines.filter((l) => l.element).map((l) => l.id) },
    { key: 'domains', label: t('Flächen'), icon: 'domain', ids: [...s.domains], note: t('Randlinien bleiben erhalten; Flächenlasten und Bettung werden mitgelöscht') },
    { key: 'supports', label: t('Lager'), icon: 'supportPin', ids: [...s.supports] },
    { key: 'loads', label: t('Lasten'), icon: 'loadNode', ids: [...s.loads] },
  ].filter((c) => c.ids.length);

  // only one kind selected → delete right away (undo is available)
  if (cats.length === 1) { apply(app, cats, new Set([cats[0].key]), 'line'); return; }

  const on = new Set(cats.map((c) => c.key).filter((k) => !lastOff.has(k)));
  let memberMode = lastMemberMode;
  const body = h('div');
  let delBtn = null;
  const total = () => cats.filter((c) => on.has(c.key)).reduce((n, c) => n + c.ids.length, 0);
  const render = () => {
    clear(body);
    body.appendChild(h('p', { style: { margin: '0 0 12px', color: 'var(--text-2)' } }, t('Die Auswahl enthält verschiedene Objektarten. Was soll gelöscht werden?')));
    const list = h('div.list', { style: { gap: '6px' } });
    for (const c of cats) {
      const cb = h('input', { type: 'checkbox', checked: on.has(c.key) });
      cb.addEventListener('change', () => { if (cb.checked) on.add(c.key); else on.delete(c.key); render(); });
      const row = h('label.list-item' + (on.has(c.key) ? '.active' : ''), { style: { cursor: 'pointer', alignItems: 'flex-start', padding: '9px 10px' } },
        cb, ic(c.icon),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div.row', h('b', c.label), h('span.badge', String(c.ids.length))),
          c.note ? h('div.small.muted', c.note) : null,
          c.key === 'members' && on.has(c.key) ? h('div', { style: { marginTop: '6px' }, onclick: (e) => e.preventDefault() },
            segmented([{ value: 'line', label: t('Ganze Linie löschen') }, { value: 'element', label: t('Nur Stabeigenschaft entfernen') }], memberMode, (v) => { memberMode = v; })) : null));
      row.querySelector('input').style.marginTop = '3px';
      list.appendChild(row);
    }
    body.appendChild(list);
    body.appendChild(h('div.row', { style: { marginTop: '10px', gap: '6px' } },
      h('button.btn.sm', { onclick: () => { cats.forEach((c) => on.add(c.key)); render(); } }, t('Alle')),
      h('button.btn.sm', { onclick: () => { on.clear(); render(); } }, t('Keine')),
      h('span.grow'), h('span.small.muted', t('Rückgängig mit Ctrl+Z'))));
    if (delBtn) { delBtn.disabled = !total(); delBtn.lastChild.textContent = t('{n} löschen', { n: total() }); }
  };
  render();
  const d = openDialog({
    title: t('Auswahl löschen'), sub: t('{n} Objekte ausgewählt', { n: st.selCount() }), iconName: 'trash', mod: 'rose', body,
    buttons: [
      { label: t('Abbrechen'), kind: 'ghost' },
      { label: t('{n} löschen', { n: total() }), kind: 'danger', icon: 'trash', onClick: () => {
        if (!total()) return false;
        for (const c of cats) { if (on.has(c.key)) lastOff.delete(c.key); else lastOff.add(c.key); }
        lastMemberMode = memberMode;
        apply(app, cats, on, memberMode);
      } },
    ],
  });
  delBtn = d.foot.querySelector('.btn.danger');
  delBtn.focus();
}

function apply(app, cats, on, memberMode) {
  const st = app.store;
  const ids = (k) => (on.has(k) ? cats.find((c) => c.key === k)?.ids || [] : []);
  const members = ids('members');
  const stripOnly = memberMode === 'element';
  st.commit(t('Löschen'), (m) => {
    if (stripOnly) {
      const set = new Set(members);
      for (const l of m.lines) if (set.has(l.id)) l.element = null;
    }
    removeEntities(m, {
      nodes: ids('nodes'),
      lines: [...ids('geomLines'), ...(stripOnly ? [] : members)],
      domains: ids('domains'),
      supports: ids('supports'),
      loads: ids('loads'),
    });
  });
  const parts = cats.filter((c) => on.has(c.key)).map((c) => `${c.ids.length} ${c.key === 'members' && stripOnly ? t('Stabeigenschaften') : c.label}`);
  toast(t('Gelöscht: {list} · Ctrl+Z macht rückgängig', { list: parts.join(', ') }), 'ok', 3500);
}
