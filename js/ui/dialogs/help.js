// Welcome screen, keyboard/mouse help and example models.
import { t } from '../../i18n.js';
import { h, ic, openDialog, toast, checkInput } from '../dom.js';
import { MODULES } from '../commands.js';
import { EXAMPLES } from '../../examples.js';
import { pointKeys } from '../pointinput.js';

const MODULE_TEXT = {
  geometry: 'Knoten, Linien, Polygone zeichnen oder generieren',
  elements: 'Material, Querschnitte, Stäbe, Platten, Schalen, Lager',
  loads: 'Lastfälle, Gruppen, Lasten und Kombinationen',
  mesh: 'FE-Netz erzeugen und Modell prüfen',
  static: 'Lineare & nichtlineare Statik, Schnittgrössen',
  vibration: 'Eigenformen und Erdbeben (Antwortspektrum)',
  buckling: 'Stabilität: kritische Lastfaktoren',
  rc: 'Bewehrung von Platten, Schalen und Plattenbalken, Durchstanzen',
  steel: 'Querschnitts- und Stabilitätsnachweise (EN 1993 / SIA 263)',
  timber: 'Holznachweise (EN 1995 / SIA 265)',
  report: 'Bericht, Tabellen, Export',
};

export function welcomeDialog(app) {
  const steps = h('div.steps');
  MODULES.forEach((m, i) => {
    const s = h('div.step', { style: { cursor: 'pointer' }, onclick: () => { d.close(); app.setTab(m.id); } }, h('b', h('span.n', String(i + 1)), t(m.label)), h('span.muted', t(MODULE_TEXT[m.id])));
    s.style.setProperty('--mod', `var(--p-${m.mod})`);
    steps.appendChild(s);
  });
  const cards = h('div.welcome-grid');
  for (const ex of EXAMPLES.slice(0, 6)) cards.appendChild(exampleCard(app, ex, () => d.close()));
  let dontShow = false;
  try { dontShow = localStorage.getItem('ts.noWelcome') === '1'; } catch (e) { /* ignore */ }
  const body = h('div',
    h('div.row', { style: { gap: '16px', marginBottom: '14px', alignItems: 'flex-start' } },
      h('div.brand-logo', { style: { width: '52px', height: '52px', borderRadius: '16px' } }, ic('logo')),
      h('div', h('h2', { style: { margin: '2px 0 4px', fontSize: '22px', letterSpacing: '-0.02em' } }, t('Willkommen bei Tragwerk Studio')),
        h('div.muted', t('Modulare 3D-FEM-Software für Stäbe, Platten und Schalen – direkt im Browser, ohne Installation. Arbeite die Module von links nach rechts ab:')))),
    steps,
    h('div.row', { style: { margin: '4px 0 10px' } }, h('h4', { style: { margin: 0 } }, t('Mit einem Beispiel starten')), h('span.grow'),
      h('button.btn.sm', { onclick: () => { d.close(); examplesDialog(app); } }, t('Alle Beispiele'), ic('chevronRight'))),
    cards);
  const d = openDialog({
    title: t('Start'), iconName: 'rocket', mod: 'lavender', size: 'xwide', body,
    footLeft: checkInput(t('Beim Start nicht mehr anzeigen'), dontShow, (v) => { try { localStorage.setItem('ts.noWelcome', v ? '1' : '0'); } catch (e) { /* ignore */ } }),
    buttons: [
      { label: t('Leeres Modell'), icon: 'filePlus', onClick: () => app.setTab('geometry') },
      { label: t('Generator'), icon: 'sparkles', onClick: () => app.cmds.generator.run() },
      { label: t('Kurzanleitung'), icon: 'keyboard', onClick: () => shortcutsDialog(app) },
    ],
  });
  d.el.style.height = 'auto';
}

function exampleCard(app, ex, after) {
  const c = h('button.card-choice.example-card', { onclick: () => { loadExample(app, ex); after?.(); } },
    h('div.thumb', ic(ex.icon)), h('div.body', h('div.t', t(ex.name)), h('div.d', t(ex.desc)), h('div.row', { style: { gap: '4px', flexWrap: 'wrap', marginTop: '4px' } }, ex.tags.map((x) => h('span.badge', t(x))))));
  c.style.setProperty('--mod', `var(--p-${ex.mod || 'sky'})`);
  return c;
}

export function loadExample(app, ex) {
  try {
    const m = ex.build();
    app.store.loadModel(m);
    app.store.dirty = true;
    app.vp.setView(ex.view || 'iso');
    app.setTab('geometry');
    app.renderAll();
    toast(t('Beispiel „{n}“ geladen. Tipp: Modul 5 „Statik“ → Linear rechnen.', { n: t(ex.name) }), 'ok', 5000);
  } catch (e) {
    console.error(e);
    toast(t('Beispiel konnte nicht erzeugt werden: {m}', { m: e.message }), 'err');
  }
}

export function examplesDialog(app) {
  const grid = h('div.welcome-grid');
  for (const ex of EXAMPLES) grid.appendChild(exampleCard(app, ex, () => d.close()));
  const d = openDialog({ title: t('Beispielmodelle'), sub: t('Fertig modellierte Tragwerke mit Lasten und Kombinationen'), iconName: 'book', mod: 'lavender', size: 'xwide', body: grid, buttons: [{ label: t('Schliessen'), kind: 'ghost' }] });
  d.el.style.height = 'auto';
}

export function shortcutsDialog(app) {
  const groups = {};
  for (const c of Object.values(app.cmds)) if (c.kbd) (groups.k = groups.k || []).push(c);
  const mouse = [
    [t('Linke Maustaste'), t('Auswählen, Zeichnen; Ziehen = Rechteckauswahl (→ Fenster, ← Kreuzen)')],
    [t('Rechte Maustaste ziehen'), t('Ansicht drehen (Orbit)')],
    [t('Mittlere Maustaste ziehen'), t('Ansicht verschieben (Pan)')],
    [t('Mausrad'), t('Zoom zum Mauszeiger')],
    [t('Alt + linke Maustaste'), t('Ansicht drehen')],
    [t('Shift / Ctrl + Klick'), t('Zur Auswahl hinzufügen / umschalten')],
    [t('Rechtsklick'), t('Kontextmenü bzw. Zeichenkette beenden')],
    [t('Doppelklick'), t('Objekt auswählen und Eigenschaften zeigen')],
  ];
  const body = h('div.grid2', { style: { alignItems: 'start', gap: '20px' } },
    h('div', h('h4', t('Maus')), h('div.list', mouse.map(([k, v]) => h('div.list-item', { style: { cursor: 'default', alignItems: 'flex-start' } }, h('b.small', { style: { minWidth: '150px' } }, k), h('span.small.muted', v)))),
      h('h4', t('Punkteingabe (Zeichnen, Verschieben, Kopieren, Drehen)')),
      h('div.list', pointKeys().map(([k, v]) => h('div.list-item', { style: { cursor: 'default', alignItems: 'flex-start' } }, h('span.kbd', { style: { flex: 'none', minWidth: '96px', justifyContent: 'center' } }, k), h('span.small.muted', v))))),
    h('div', h('h4', t('Tastenkürzel')), h('div.list', (groups.k || []).map((c) => h('div.list-item', { style: { cursor: 'default' } }, ic(c.icon), h('span.small', c.label), h('span.kbd', { style: { marginLeft: 'auto' } }, c.kbd))))));
  const intro = h('div',
    h('h4', t('Arbeitsablauf')),
    h('ol.small', { style: { color: 'var(--text-2)', lineHeight: 1.7, marginTop: 0 } },
      h('li', t('Geometrie zeichnen (Linie, Rechteck, Polygon) oder mit dem Generator erzeugen.')),
      h('li', t('Elemente: Material und Querschnitt zuweisen, Flächen definieren, Lager setzen.')),
      h('li', t('Lasten: Lastfälle anlegen, Lasten auf ausgewählte Objekte aufbringen, Kombinationen erzeugen.')),
      h('li', t('Statik: Linear rechnen – das FE-Netz wird automatisch erzeugt.')),
      h('li', t('Ergebnisse in der rechten Leiste wählen: Verformung, Schnittgrössen, Spannungen.')),
      h('li', t('Bemessung nach Eurocode oder SIA in den Modulen Stahlbeton, Stahl und Holz – Doppelklick auf ein Ergebnis zeigt die Berechnung im Detail.')),
      h('li', t('Bericht erstellen.'))));
  openDialog({ title: t('Hilfe & Tastenkürzel'), iconName: 'keyboard', mod: 'slate', size: 'xwide', body: h('div', intro, body), buttons: [{ label: t('Schliessen'), kind: 'primary' }] }).el.style.height = 'auto';
}
