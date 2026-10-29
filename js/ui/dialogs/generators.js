// Generator dialog (parametric structures).
import { t } from '../../i18n.js';
import { h, ic, clear, openDialog, field, numInput, selectInput, checkInput, toast, hintBox } from '../dom.js';
import { createModel } from '../../core/model.js';
import { GENERATORS, addCombos } from '../../core/generators.js';

export function generatorDialog(app, initial) {
  const st = app.store;
  let type = initial || 'frame';
  const values = {};
  const opts = { replace: st.model.nodes.length > 0, combos: true };
  const body = h('div');
  const render = () => {
    clear(body);
    const cards = h('div.cards', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' } });
    for (const [k, g] of Object.entries(GENERATORS)) {
      cards.appendChild(h('button.card-choice' + (k === type ? '.active' : ''), { onclick: () => { type = k; render(); } }, h('div.chip', ic(g.icon)), h('div.t', t(g.label))));
    }
    body.appendChild(cards);
    const g = GENERATORS[type];
    values[type] = values[type] || Object.fromEntries(g.params.map((x) => [x[0], x[2]]));
    const v = values[type];
    body.appendChild(h('p.small.muted', { style: { margin: '14px 0 10px' } }, t(g.desc)));
    const grid = h('div.grid2');
    for (const [key, label, , q, choices] of g.params) {
      if (q === 'choice') grid.appendChild(field(t(label), selectInput({ value: v[key], options: choices.map(([a, b]) => ({ value: a, label: t(b) })), onChange: (x) => { v[key] = x; } }), { stack: true }));
      else if (q === 'bool') grid.appendChild(h('div', { style: { alignSelf: 'end', paddingBottom: '10px' } }, checkInput(t(label), v[key], (x) => { v[key] = x; })));
      else grid.appendChild(field(t(label), numInput({ value: v[key], q: q || undefined, onChange: (x) => { v[key] = x ?? v[key]; } }), { stack: true }));
    }
    body.appendChild(grid);
    body.appendChild(h('div.row', { style: { marginTop: '12px', gap: '18px', flexWrap: 'wrap' } },
      st.model.nodes.length ? checkInput(t('Bestehendes Modell ersetzen'), opts.replace, (x) => { opts.replace = x; }) : null,
      checkInput(t('Lastkombinationen nach Norm erzeugen'), opts.combos, (x) => { opts.combos = x; })));
    body.appendChild(hintBox(t('Alle Werte sind danach frei editierbar. Materialien und Querschnitte werden aus der Bibliothek übernommen.')));
  };
  render();
  openDialog({
    title: t('Tragwerksgenerator'), sub: t('Parametrische Modelle in Sekunden'), iconName: 'sparkles', mod: 'lavender', size: 'wide', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Erzeugen'), kind: 'primary', icon: 'sparkles', onClick: () => {
      const p = values[type];
      try {
        if (opts.replace || !st.model.nodes.length) {
          const m = createModel(t(GENERATORS[type].label));
          m.settings.code = st.model.settings.code;
          m.loadCases = []; m.loadGroups = [];
          GENERATORS[type].build(m, p);
          if (opts.combos) addCombos(m);
          st.loadModel(m);
          st.dirty = true;
        } else {
          st.commit(t('Generator'), (m) => { GENERATORS[type].build(m, p); if (opts.combos) addCombos(m); });
        }
      } catch (e) {
        console.error(e);
        toast(t('Generator fehlgeschlagen: {m}', { m: e.message }), 'err');
        return false;
      }
      app.vp.setView('iso');
      app.renderAll();
      toast(t('{g} erzeugt: {n} Knoten, {l} Linien, {d} Flächen.', { g: t(GENERATORS[type].label), n: st.model.nodes.length, l: st.model.lines.length, d: st.model.domains.length }), 'ok');
    } }],
  });
}

