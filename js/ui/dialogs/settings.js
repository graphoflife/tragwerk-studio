// Application settings (units, precision) and model information.
import { t, getLang } from '../../i18n.js';
import { h, openDialog, field, selectInput, textField, segmented, numInput, hintBox } from '../dom.js';
import { UNIT_OPTIONS, getUnitPrefs, setUnitPrefs } from '../../core/units.js';

const QUANTITIES = [
  ['len', 'Koordinaten / Längen'], ['dim', 'Querschnittsabmessungen'], ['thick', 'Dicken'], ['disp', 'Verschiebungen'], ['rot', 'Verdrehungen'],
  ['force', 'Kräfte'], ['moment', 'Momente'], ['stress', 'Spannungen'], ['modulus', 'E-Modul'], ['density', 'Dichte'],
  ['area', 'Flächen (Querschnitt)'], ['inertia', 'Trägheitsmomente'], ['secMod', 'Widerstandsmomente'], ['reinf', 'Bewehrung Flächen'], ['reinfBeam', 'Bewehrung Balken'],
];

export function settingsDialog(app) {
  const p = getUnitPrefs();
  const units = { ...p.units };
  let dec = p.decimals;
  const grid = h('div.grid2');
  for (const [q, label] of QUANTITIES) {
    grid.appendChild(field(t(label), selectInput({ value: units[q] || UNIT_OPTIONS[q][0][0], options: UNIT_OPTIONS[q].map(([u]) => ({ value: u, label: u })), onChange: (v) => { units[q] = v; } }), { stack: true }));
  }
  const body = h('div',
    h('h4', t('Darstellung')),
    h('div.grid2',
      field(t('Farbschema'), segmented([{ value: 'light', label: t('Hell'), icon: 'sun' }, { value: 'dark', label: t('Dunkel'), icon: 'moon' }], app.isDark() ? 'dark' : 'light', (v) => { if ((v === 'dark') !== app.isDark()) app.toggleTheme(); }, { full: true }), { stack: true }),
      field(t('Sprache'), segmented([{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }], getLang(), (v) => { if (v !== getLang()) app.toggleLang(); }, { full: true }), { stack: true })),
    field(t('Signifikante Stellen'), numInput({ value: dec, min: 2, max: 8, onChange: (v) => { dec = Math.round(v || 4); } })),
    h('h4', t('Einheiten')), grid,
    hintBox(t('Intern rechnet das Programm konsistent in m, kN, t und s. Einheiten betreffen nur Anzeige und Eingabe.')));
  openDialog({
    title: t('Einstellungen'), iconName: 'settings', mod: 'slate', size: 'wide', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Übernehmen'), kind: 'primary', onClick: () => {
      setUnitPrefs(units, dec);
      app.buildRail();
      app.renderAll();
      app.store.emit('view');
      app.store.emit('resultView');
    } }],
  });
}

export function modelInfoDialog(app) {
  const st = app.store;
  const s = { ...st.model.meta, code: st.model.settings.code };
  const desc = h('textarea.input', { rows: 4, value: s.description || '' });
  desc.addEventListener('change', () => { s.description = desc.value; });
  const body = h('div',
    textField(t('Projektname'), { value: s.name, onChange: (v) => { s.name = v; } }),
    textField(t('Bearbeiter/in'), { value: s.author, onChange: (v) => { s.author = v; } }),
    field(t('Beschreibung'), desc, { stack: true }),
    field(t('Normenfamilie'), segmented([{ value: 'EC', label: 'Eurocode', icon: 'eu' }, { value: 'SIA', label: 'SIA (CH)', icon: 'swiss' }], s.code, (v) => { s.code = v; }, { full: true }), { stack: true }),
    h('div.small.muted', t('Erstellt: {c} · Geändert: {m}', { c: new Date(s.created).toLocaleString(), m: new Date(s.modified).toLocaleString() })));
  openDialog({
    title: t('Modellinfo'), iconName: 'info', mod: 'lavender', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Übernehmen'), kind: 'primary', onClick: () => {
      st.commit(t('Modellinfo'), (m) => { m.meta.name = s.name; m.meta.author = s.author; m.meta.description = s.description; }, { keepResults: true });
      if (s.code !== st.model.settings.code) app.setCode(s.code);
      app.refreshChrome();
    } }],
  });
}
