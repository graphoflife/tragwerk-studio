// Geometric transformations of the selection (translate, rotate, mirror, scale) and line splitting.
import { t } from '../../i18n.js';
import { h, clear, openDialog, field, numInput, segmented, toast, hintBox, checkInput, selectInput } from '../dom.js';
import { splitLine } from '../../core/model.js';

// AxisVM transformations: options first, then the defining points are picked in the model (tools.js).
const METHODS = {
  translate: [['incremental', 'Schrittweise'], ['distribute', 'Aufteilen'], ['spread', 'Abstand'], ['consecutive', 'Mehrfach'], ['move', 'Verschieben'], ['detach', 'Abtrennen']],
  rotate: [['incremental', 'Schrittweise'], ['distribute', 'Aufteilen'], ['spread', 'Mit Winkel'], ['consecutive', 'Mehrfach'], ['move', 'Verschieben'], ['detach', 'Abtrennen']],
  mirror: [['copy', 'Kopieren'], ['multiple', 'Mehrfach'], ['move', 'Verschieben'], ['detach', 'Abtrennen']],
  scale: [['incremental', 'Schrittweise'], ['distribute', 'Aufteilen'], ['consecutive', 'Mehrfach'], ['resize', 'Grösse ändern']],
};
const METHOD_HELP = {
  incremental: 'N Kopien, jede um den Schritt weiter', distribute: 'N Kopien gleichmässig über den Schritt verteilt', spread: 'N Kopien im Abstand d bzw. Winkel α',
  consecutive: 'Je eine Kopie pro Schritt, weitere Schritte bis Esc', multiple: 'Je eine Kopie pro Spiegelebene, weitere bis Esc', copy: 'Eine gespiegelte Kopie',
  move: 'Auswahl verschieben – angeschlossene Linien bleiben verbunden', detach: 'Auswahl verschieben und von den übrigen Linien trennen', resize: 'Auswahl selbst skalieren',
};
const TITLES = { translate: 'Verschieben / Kopieren', rotate: 'Drehen', mirror: 'Spiegeln', scale: 'Skalieren' };
const ICONS = { translate: 'move', rotate: 'rotate', mirror: 'mirror', scale: 'scale' };
const STEPS = {
  translate: 'Nach OK Start- und Endpunkt des Vektors anklicken (oder Koordinaten tippen).',
  rotate: 'Nach OK Drehpunkt, Startpunkt und Endpunkt des Bogens anklicken – die Drehachse steht senkrecht zur Ansicht (in der Perspektive: Z).',
  mirror: 'Nach OK zwei Punkte der Spiegelebene anklicken – die Ebene steht senkrecht zur Ansicht.',
  scale: 'Nach OK Zentrum, Bezugspunkt und dessen neue Lage anklicken – die Faktoren folgen aus den Koordinatenverhältnissen.',
};
// last settings per command
const LAST = {};

export function transformDialog(app, kind) {
  const st = app.store;
  const s = LAST[kind] || (LAST[kind] = {
    method: kind === 'mirror' ? 'copy' : kind === 'scale' ? 'resize' : 'move', n: 1, d: 1, angle: 90, h: 0,
    connect: 'none', connectElement: null, copyElements: true, copyLoads: true,
  });
  const body = h('div');
  const render = () => {
    clear(body);
    const grid = h('div.method-grid');
    for (const [m, label] of METHODS[kind]) {
      grid.appendChild(h('button.btn.sm' + (s.method === m ? '.primary' : ''), { onclick: () => { s.method = m; render(); }, tip: [t(label), t(METHOD_HELP[m])] }, t(label)));
    }
    body.appendChild(field(t('Methode'), grid, { stack: true, help: t(METHOD_HELP[s.method]) }));
    const copies = !['move', 'detach', 'resize', 'copy', 'consecutive', 'multiple'].includes(s.method);
    const row = [];
    if (copies) row.push(field('N', numInput({ value: s.n, min: 1, max: 500, onChange: (v) => { s.n = Math.max(1, Math.round(v || 1)); } }), { stack: true }));
    if (kind === 'translate' && s.method === 'spread') row.push(field('d', numInput({ value: s.d, q: 'len', onChange: (v) => { s.d = v || 0; } }), { stack: true }));
    if (kind === 'rotate') {
      row.push(field('α', numInput({ value: s.angle, q: 'angle', onChange: (v) => { s.angle = v || 0; } }), { stack: true, help: s.method === 'spread' ? null : t('Wird verwendet, wenn beim Startpunkt Enter gedrückt wird.') }));
      row.push(field('h', numInput({ value: s.h, q: 'len', onChange: (v) => { s.h = v || 0; } }), { stack: true, help: t('Versatz entlang der Drehachse je Schritt') }));
    }
    if (row.length) body.appendChild(h('div.grid3', row));
    const makesCopies = !['move', 'detach', 'resize'].includes(s.method);
    if (makesCopies) {
      body.appendChild(field(t('Knoten zum Verbinden'), segmented([{ value: 'none', label: t('Keine') }, { value: 'double', label: t('Doppelmarkierte') }, { value: 'all', label: t('Alle') }], s.connect,
        (v) => { s.connect = v; render(); }, { full: true }), { stack: true, help: s.connect === 'double' ? t('{n} doppelmarkierte Knoten (Alt+Klick)', { n: st.selection.dbl.size }) : null }));
      if (s.connect !== 'none') {
        body.appendChild(field(t('Verbindung als'), selectInput({ value: s.connectElement || '', options: [{ value: '', label: t('Geometrielinie') }, { value: 'beam', label: t('Balken') }, { value: 'truss', label: t('Fachwerkstab') }], onChange: (v) => { s.connectElement = v || null; } })));
      }
      body.appendChild(checkInput(t('Elemente kopieren'), s.copyElements, (v) => { s.copyElements = v; }));
      body.appendChild(checkInput(t('Lasten kopieren'), s.copyLoads, (v) => { s.copyLoads = v; }));
    }
    body.appendChild(hintBox(t(STEPS[kind])));
  };
  render();
  openDialog({
    title: t(TITLES[kind]), sub: t('{n} Objekte', { n: st.geoCount() }), iconName: ICONS[kind], mod: 'lavender', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: 'OK', kind: 'primary', onClick: () => {
      if (s.connect === 'double' && !st.selection.dbl.size && !['move', 'detach', 'resize'].includes(s.method)) toast(t('Keine doppelmarkierten Knoten – Alt+Klick markiert Knoten doppelt.'), 'info');
      app.tools.set('transform', { kind, ...s });
    } }],
  });
}

export function splitDialog(app) {
  const st = app.store;
  const s = { mode: 'n', n: 2, pos: 0.5 };
  const body = h('div');
  const render = () => {
    clear(body);
    body.appendChild(field(t('Methode'), segmented([{ value: 'n', label: t('In n gleiche Teile') }, { value: 'pos', label: t('An Position') }], s.mode, (v) => { s.mode = v; render(); }, { full: true }), { stack: true }));
    if (s.mode === 'n') body.appendChild(field(t('Anzahl Teile'), numInput({ value: s.n, min: 2, max: 200, onChange: (v) => { s.n = Math.max(2, Math.round(v || 2)); } })));
    else body.appendChild(field(t('Relative Position'), numInput({ value: s.pos, min: 0.001, max: 0.999, onChange: (v) => { s.pos = v || 0.5; } })));
    body.appendChild(hintBox(t('Elemente, Lager und Lasten werden auf die Teilstücke übertragen.')));
  };
  render();
  openDialog({
    title: t('Linien teilen'), sub: t('{n} Linien', { n: st.selection.lines.size }), iconName: 'split', mod: 'lavender', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Teilen'), kind: 'primary', onClick: () => {
      const ids = [...st.selection.lines];
      const out = [];
      st.commit(t('Linien teilen'), (m) => { for (const id of ids) out.push(...(s.mode === 'n' ? splitLine(m, id, s.n) : splitLine(m, id, 0, [s.pos]))); });
      st.select({ lines: out }, 'replace');
    } }],
  });
}
