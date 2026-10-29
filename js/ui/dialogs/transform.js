// Geometric transformations of the selection (move/copy, rotate, mirror, scale) and line splitting.
import { t } from '../../i18n.js';
import { h, clear, openDialog, field, numInput, segmented, toast, hintBox, checkInput, selectInput } from '../dom.js';
import { transformSelection, rotatePoint, splitLine, V, centroid, P, defaultLineElement } from '../../core/model.js';

export function transformDialog(app, kind) {
  const st = app.store;
  const sel = st.selection;
  // centre of selection as default pivot
  const pts = [];
  sel.nodes.forEach((id) => pts.push(P(st.idx.nodes.get(id))));
  sel.lines.forEach((id) => { const l = st.idx.lines.get(id); pts.push(P(st.idx.nodes.get(l.n1)), P(st.idx.nodes.get(l.n2))); });
  sel.domains.forEach((id) => st.idx.domains.get(id).nodes.forEach((n) => pts.push(P(st.idx.nodes.get(n)))));
  const c = centroid(pts).map((x) => Math.round(x * 1000) / 1000);
  const s = { mode: 'move', copies: 1, d: [0, 0, 3], axis: 'Z', center: c, angle: 90, plane: 'YZ', planePos: c[0], factor: [2, 2, 2], connect: false, connectType: 'none' };
  const body = h('div');
  const titles = { translate: t('Verschieben / Kopieren'), rotate: t('Drehen'), mirror: t('Spiegeln'), scale: t('Skalieren') };
  const vec = (arr, q) => h('div.grid3', ['X', 'Y', 'Z'].map((a, i) => field(a, numInput({ value: arr[i], q, onChange: (v) => { arr[i] = v ?? 0; } }), { stack: true })));
  const render = () => {
    clear(body);
    if (kind !== 'mirror') {
      body.appendChild(field(t('Modus'), segmented([{ value: 'move', label: t('Verschieben'), icon: 'move' }, { value: 'copy', label: t('Kopieren'), icon: 'copy' }], s.mode, (v) => { s.mode = v; render(); }, { full: true }), { stack: true }));
    } else {
      body.appendChild(field(t('Modus'), segmented([{ value: 'move', label: t('Spiegeln') }, { value: 'copy', label: t('Gespiegelte Kopie') }], s.mode, (v) => { s.mode = v; render(); }, { full: true }), { stack: true }));
    }
    if (kind === 'translate') { body.appendChild(h('h4', t('Verschiebungsvektor'))); body.appendChild(vec(s.d, 'len')); }
    if (kind === 'rotate') {
      body.appendChild(field(t('Drehachse'), segmented([{ value: 'X', label: 'X' }, { value: 'Y', label: 'Y' }, { value: 'Z', label: 'Z' }], s.axis, (v) => { s.axis = v; }, { full: true }), { stack: true }));
      body.appendChild(field(t('Winkel'), numInput({ value: s.angle, q: 'angle', onChange: (v) => { s.angle = v || 0; } })));
      body.appendChild(h('h4', t('Drehpunkt')));
      body.appendChild(vec(s.center, 'len'));
    }
    if (kind === 'mirror') {
      body.appendChild(field(t('Spiegelebene'), segmented([{ value: 'YZ', label: t('YZ (x = konst.)') }, { value: 'XZ', label: t('XZ (y = konst.)') }, { value: 'XY', label: t('XY (z = konst.)') }], s.plane, (v) => { s.plane = v; s.planePos = { YZ: c[0], XZ: c[1], XY: c[2] }[v]; render(); }, { full: true }), { stack: true }));
      body.appendChild(field(t('Lage der Ebene'), numInput({ value: s.planePos, q: 'len', onChange: (v) => { s.planePos = v ?? 0; } })));
    }
    if (kind === 'scale') {
      body.appendChild(h('h4', t('Faktoren')));
      body.appendChild(h('div.grid3', ['X', 'Y', 'Z'].map((a, i) => field(a, numInput({ value: s.factor[i], onChange: (v) => { s.factor[i] = v ?? 1; } }), { stack: true }))));
      body.appendChild(h('h4', t('Bezugspunkt')));
      body.appendChild(vec(s.center, 'len'));
    }
    if (s.mode === 'copy' && kind !== 'mirror') {
      body.appendChild(h('h4', t('Kopien')));
      body.appendChild(field(t('Anzahl'), numInput({ value: s.copies, min: 1, max: 500, onChange: (v) => { s.copies = Math.max(1, Math.round(v || 1)); } })));
      body.appendChild(checkInput(t('Kopierte Knoten mit Original verbinden'), s.connect, (v) => { s.connect = v; render(); }));
      if (s.connect) {
        body.appendChild(field(t('Verbindungselement'), selectInput({ value: s.connectType, options: [{ value: 'none', label: t('Geometrielinie') }, { value: 'beam', label: t('Balken') }, { value: 'truss', label: t('Fachwerkstab') }], onChange: (v) => { s.connectType = v; } })));
        body.appendChild(hintBox(t('Ideal für Stützen zwischen Geschossen: Decke auswählen, 3 m nach oben kopieren, Knoten mit Balken verbinden.')));
      }
    }
  };
  render();
  openDialog({
    title: titles[kind], sub: t('{n} Objekte', { n: st.selCount() }), iconName: { translate: 'move', rotate: 'rotate', mirror: 'mirror', scale: 'scale' }[kind], mod: 'lavender', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Ausführen'), kind: 'primary', onClick: () => {
      let xf;
      if (kind === 'translate') xf = (p, k) => V.add(p, V.mul(s.d, k));
      if (kind === 'rotate') {
        const u = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[s.axis];
        xf = (p, k) => rotatePoint(p, s.center, u, s.angle * Math.PI / 180 * k);
      }
      if (kind === 'mirror') {
        const ax = { YZ: 0, XZ: 1, XY: 2 }[s.plane];
        xf = (p) => { const q = [...p]; q[ax] = 2 * s.planePos - p[ax]; return q; };
      }
      if (kind === 'scale') xf = (p, k) => p.map((x, i) => s.center[i] + (x - s.center[i]) * Math.pow(s.factor[i], k));
      const copies = s.mode === 'copy' ? (kind === 'mirror' ? 1 : s.copies) : 0;
      let el = null;
      if (s.connect && s.connectType !== 'none') {
        const d = app.ensureDrawDefaults(s.connectType);
        el = defaultLineElement(s.connectType, d.material, d.section);
      }
      let newSel;
      st.commit(titles[kind], (m) => { newSel = transformSelection(m, sel, xf, { copies, connect: s.connect && copies > 0, connectElement: el }); });
      if (newSel && copies) st.select({ nodes: [...newSel.nodes], lines: [...newSel.lines], domains: [...newSel.domains] }, 'replace');
      app.vp.zoomExtents();
      toast(t('Transformation ausgeführt.'), 'ok');
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
