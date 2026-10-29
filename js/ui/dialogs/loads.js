// Load input dialogs (always into the active load case).
import { t } from '../../i18n.js';
import { h, ic, clear, openDialog, field, numInput, selectInput, toast, hintBox, segmented, checkInput } from '../dom.js';
import { nextId, P, domainAxes, V } from '../../core/model.js';
import { fmt } from '../../core/units.js';

function ensureLC(app) {
  const st = app.store;
  if (!st.idx.loadCases.has(st.activeLC)) {
    if (!st.model.loadCases.length) app.addLoadCase();
    else app.setActiveLC(st.model.loadCases[0].id);
  }
  return st.activeLC;
}
const lcName = (app) => app.store.idx.loadCases.get(app.store.activeLC)?.name || '';

function lcSelector(app) {
  const st = app.store;
  return field(t('Lastfall'), h('div.row', selectInput({ value: st.activeLC, options: st.model.loadCases.map((lc) => ({ value: lc.id, label: lc.name })), onChange: (v) => app.setActiveLC(+v) }),
    h('button.icon-btn.sm', { onclick: () => app.addLoadCase(), tip: [t('Neuer Lastfall')] }, ic('plus'))));
}

export function describeLoad(app, l) {
  const dir = l.dir ? ` ${l.dir}` : '';
  switch (l.type) {
    case 'node': {
      const parts = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'].map((k, i) => (l.F[i] ? `${k}=${fmt(i < 3 ? 'force' : 'moment', l.F[i])}` : null)).filter(Boolean);
      return `${t('Knoten')} ${l.node}: ${parts.join(', ') || '0'}`;
    }
    case 'lineDist': return `${t('Linie')} ${l.line}:${dir} ${fmt('lineLoad', l.q1)}${l.q2 !== l.q1 ? ' … ' + fmt('lineLoad', l.q2) : ''}${(l.a || 0) > 0 || (l.b ?? 1) < 1 ? ` [${(l.a ?? 0).toFixed(2)}–${(l.b ?? 1).toFixed(2)}]` : ''}`;
    case 'linePoint': return `${t('Linie')} ${l.line}:${dir} ${l.moment ? fmt('moment', l.F) : fmt('force', l.F)} @ ${(l.pos ?? 0.5).toFixed(2)}`;
    case 'surface': return `${t('Fläche')} ${l.domain}:${dir} ${fmt('areaLoad', l.q)}${l.projected ? ' (proj.)' : ''}`;
    case 'tempLine': return `${t('Linie')} ${l.line}: ΔT ${fmt('temp', l.dT || 0)}${l.dTz ? ', ΔTz ' + fmt('temp', l.dTz) : ''}`;
    case 'tempDomain': return `${t('Fläche')} ${l.domain}: ΔT ${fmt('temp', l.dT || 0)}${l.dTz ? ', ΔTz ' + fmt('temp', l.dTz) : ''}`;
    case 'nodeDisp': return `${t('Knoten')} ${l.node}: ${t('Verschiebung')} ${l.d.slice(0, 3).map((x) => fmt('disp', x, { unit: false })).join(' / ')} ${'mm'}`;
    default: return l.type;
  }
}

const replaceSwitch = (s) => h('div', { style: { marginTop: '10px' } }, checkInput(t('Vorhandene Lasten gleichen Typs in diesem Lastfall ersetzen'), s.replace, (v) => { s.replace = v; }));

/* ---------------- node loads ---------------- */
export function nodeLoadDialog(app) {
  const st = app.store;
  ensureLC(app);
  const F = [0, 0, -10, 0, 0, 0];
  const s = { replace: false };
  const labs = [['Fx', 'force'], ['Fy', 'force'], ['Fz', 'force'], ['Mx', 'moment'], ['My', 'moment'], ['Mz', 'moment']];
  const body = h('div', lcSelector(app),
    h('div.grid3', labs.map(([k, q], i) => field(k, numInput({ value: F[i], q, onChange: (v) => { F[i] = v || 0; } }), { stack: true }))),
    hintBox(t('Globale Richtungen. Negatives Fz wirkt nach unten (Schwerkraft).')), replaceSwitch(s));
  openDialog({
    title: t('Knotenlast'), sub: t('{n} Knoten · {lc}', { n: st.selection.nodes.size, lc: lcName(app) }), iconName: 'loadNode', mod: 'rose', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Hinzufügen'), kind: 'primary', icon: 'plus', onClick: () => {
      if (F.every((x) => !x)) { toast(t('Alle Komponenten sind null.'), 'warn'); return false; }
      st.commit(t('Knotenlast'), (m) => {
        if (s.replace) m.loads = m.loads.filter((l) => !(l.lc === st.activeLC && l.type === 'node' && st.selection.nodes.has(l.node)));
        for (const nid of st.selection.nodes) m.loads.push({ id: nextId(m.loads), lc: st.activeLC, type: 'node', node: nid, F: [...F] });
      });
    } }],
  });
}

/* ---------------- line loads ---------------- */
const DIRS = [
  { value: 'X', label: 'X' }, { value: 'Y', label: 'Y' }, { value: 'Z', label: 'Z' },
  { value: 'x', label: 'x lok.' }, { value: 'y', label: 'y lok.' }, { value: 'z', label: 'z lok.' },
];
export function lineLoadDialog(app, point) {
  const st = app.store;
  ensureLC(app);
  const s = { dir: 'Z', q1: -5, q2: -5, trap: false, a: 0, b: 1, projected: false, F: -10, pos: 0.5, moment: false, replace: false };
  const body = h('div');
  const render = () => {
    clear(body);
    body.appendChild(lcSelector(app));
    body.appendChild(field(t('Richtung'), segmented(DIRS, s.dir, (v) => { s.dir = v; render(); }, { full: true }), { stack: true }));
    if (point) {
      body.appendChild(field(t('Art'), segmented([{ value: false, label: t('Kraft') }, { value: true, label: t('Moment') }], s.moment, (v) => { s.moment = v; render(); }, { full: true }), { stack: true }));
      body.appendChild(h('div.grid2',
        field(s.moment ? t('Moment M') : t('Kraft F'), numInput({ value: s.F, q: s.moment ? 'moment' : 'force', onChange: (v) => { s.F = v || 0; } }), { stack: true }),
        field(t('Position (0…1)'), numInput({ value: s.pos, min: 0, max: 1, onChange: (v) => { s.pos = v ?? 0.5; } }), { stack: true, help: t('Relative Lage entlang der Linie vom Anfangsknoten (0) zum Endknoten (1).') })));
    } else {
      body.appendChild(field(t('Verlauf'), segmented([{ value: false, label: t('Gleichlast'), icon: 'loadLine' }, { value: true, label: t('Trapezlast'), icon: 'loadTrap' }], s.trap, (v) => { s.trap = v; render(); }, { full: true }), { stack: true }));
      body.appendChild(h('div.grid2',
        field(s.trap ? t('q Anfang') : 'q', numInput({ value: s.q1, q: 'lineLoad', onChange: (v) => { s.q1 = v || 0; if (!s.trap) s.q2 = s.q1; } }), { stack: true }),
        s.trap ? field(t('q Ende'), numInput({ value: s.q2, q: 'lineLoad', onChange: (v) => { s.q2 = v || 0; } }), { stack: true }) : h('div')));
      body.appendChild(h('div.grid2',
        field(t('von (0…1)'), numInput({ value: s.a, min: 0, max: 1, onChange: (v) => { s.a = v ?? 0; } }), { stack: true }),
        field(t('bis (0…1)'), numInput({ value: s.b, min: 0, max: 1, onChange: (v) => { s.b = v ?? 1; } }), { stack: true })));
      if ('XYZ'.includes(s.dir)) body.appendChild(h('div', { style: { margin: '8px 0' } }, checkInput(t('Auf Grundrissprojektion bezogen (z.B. Schnee auf geneigtem Stab)'), s.projected, (v) => { s.projected = v; })));
    }
    body.appendChild(hintBox(t('Grossbuchstaben = globale Achsen, Kleinbuchstaben = lokale Stabachsen. Negative Werte wirken entgegen der Achse (−Z = nach unten).')));
    body.appendChild(replaceSwitch(s));
  };
  render();
  openDialog({
    title: point ? t('Einzellast auf Stab') : t('Linienlast'), sub: t('{n} Linien · {lc}', { n: st.selection.lines.size, lc: lcName(app) }), iconName: point ? 'loadPoint' : 'loadTrap', mod: 'rose', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Hinzufügen'), kind: 'primary', icon: 'plus', onClick: () => {
      const type = point ? 'linePoint' : 'lineDist';
      st.commit(point ? t('Einzellast') : t('Linienlast'), (m) => {
        if (s.replace) m.loads = m.loads.filter((l) => !(l.lc === st.activeLC && l.type === type && st.selection.lines.has(l.line)));
        for (const lid of st.selection.lines) {
          const base = { id: nextId(m.loads), lc: st.activeLC, type, line: lid, dir: s.dir };
          if (point) m.loads.push({ ...base, F: s.F, pos: s.pos, moment: s.moment });
          else m.loads.push({ ...base, q1: s.q1, q2: s.trap ? s.q2 : s.q1, a: Math.min(s.a, s.b), b: Math.max(s.a, s.b), projected: s.projected && 'XYZ'.includes(s.dir) });
        }
      });
    } }],
  });
}

/* ---------------- surface loads ---------------- */
export function surfaceLoadDialog(app) {
  const st = app.store;
  ensureLC(app);
  const s = { dir: 'Z', q: -3, projected: false, replace: false };
  const body = h('div');
  const render = () => {
    clear(body);
    body.appendChild(lcSelector(app));
    body.appendChild(field(t('Richtung'), segmented([{ value: 'X', label: 'X' }, { value: 'Y', label: 'Y' }, { value: 'Z', label: 'Z' }, { value: 'z', label: t('z lok. (normal)') }], s.dir, (v) => { s.dir = v; render(); }, { full: true }), { stack: true }));
    body.appendChild(field('q', numInput({ value: s.q, q: 'areaLoad', onChange: (v) => { s.q = v || 0; } })));
    if (s.dir !== 'z') body.appendChild(checkInput(t('Auf Grundrissprojektion bezogen'), s.projected, (v) => { s.projected = v; }));
    body.appendChild(hintBox(t('Typische Werte: Nutzlast Wohnen 2.0 kN/m², Büro 3.0 kN/m², Belag 1.5 kN/m². −Z = nach unten.')));
    body.appendChild(replaceSwitch(s));
  };
  render();
  openDialog({
    title: t('Flächenlast'), sub: t('{n} Flächen · {lc}', { n: st.selection.domains.size, lc: lcName(app) }), iconName: 'loadSurface', mod: 'rose', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Hinzufügen'), kind: 'primary', icon: 'plus', onClick: () => {
      st.commit(t('Flächenlast'), (m) => {
        if (s.replace) m.loads = m.loads.filter((l) => !(l.lc === st.activeLC && l.type === 'surface' && st.selection.domains.has(l.domain)));
        for (const did of st.selection.domains) m.loads.push({ id: nextId(m.loads), lc: st.activeLC, type: 'surface', domain: did, dir: s.dir, q: s.q, projected: s.projected && s.dir !== 'z' });
      });
    } }],
  });
}

/* ---------------- temperature ---------------- */
export function temperatureDialog(app) {
  const st = app.store;
  ensureLC(app);
  const s = { dT: 20, dTz: 0, dTy: 0 };
  const body = h('div', lcSelector(app),
    field(t('Gleichmässig ΔT'), numInput({ value: s.dT, q: 'temp', onChange: (v) => { s.dT = v || 0; } })),
    field(t('Gradient ΔTz'), numInput({ value: s.dTz, q: 'temp', onChange: (v) => { s.dTz = v || 0; } }), { help: t('Temperaturdifferenz zwischen +z- und −z-Seite (oben − unten).') }),
    st.selection.lines.size ? field(t('Gradient ΔTy'), numInput({ value: s.dTy, q: 'temp', onChange: (v) => { s.dTy = v || 0; } })) : null,
    hintBox(t('Wirkt auf {l} Stäbe und {d} Flächen.', { l: st.selection.lines.size, d: st.selection.domains.size })));
  openDialog({
    title: t('Temperaturlast'), sub: lcName(app), iconName: 'temperature', mod: 'rose', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Hinzufügen'), kind: 'primary', icon: 'plus', onClick: () => {
      st.commit(t('Temperaturlast'), (m) => {
        for (const lid of st.selection.lines) m.loads.push({ id: nextId(m.loads), lc: st.activeLC, type: 'tempLine', line: lid, dT: s.dT, dTz: s.dTz, dTy: s.dTy });
        for (const did of st.selection.domains) m.loads.push({ id: nextId(m.loads), lc: st.activeLC, type: 'tempDomain', domain: did, dT: s.dT, dTz: s.dTz });
      });
    } }],
  });
}

/* ---------------- settlement ---------------- */
export function settlementDialog(app) {
  const st = app.store;
  ensureLC(app);
  const supported = [...st.selection.nodes].filter((n) => st.model.supports.some((s) => s.type === 'node' && s.node === n));
  if (!supported.length) return toast(t('Keiner der gewählten Knoten ist gelagert.'), 'warn');
  const d = [0, 0, -0.01, 0, 0, 0];
  const labs = [['uX', 'disp'], ['uY', 'disp'], ['uZ', 'disp'], ['φX', 'rot'], ['φY', 'rot'], ['φZ', 'rot']];
  const body = h('div', lcSelector(app),
    h('div.grid3', labs.map(([k, q], i) => field(k, numInput({ value: d[i], q, onChange: (v) => { d[i] = v || 0; } }), { stack: true }))),
    hintBox(t('Wirkt nur in festgehaltenen Lagerrichtungen.')));
  openDialog({
    title: t('Stützensenkung'), sub: t('{n} gelagerte Knoten', { n: supported.length }), iconName: 'settlement', mod: 'rose', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Hinzufügen'), kind: 'primary', icon: 'plus', onClick: () => {
      st.commit(t('Stützensenkung'), (m) => { for (const nid of supported) m.loads.push({ id: nextId(m.loads), lc: st.activeLC, type: 'nodeDisp', node: nid, d: [...d] }); });
    } }],
  });
}

export function toggleSelfWeight(app) {
  const st = app.store;
  const id = ensureLC(app);
  const lc = st.idx.loadCases.get(id);
  st.commit(t('Eigengewicht'), (m) => { const x = m.loadCases.find((c) => c.id === id); x.selfWeight = !x.selfWeight; });
  toast(!lc.selfWeight ? t('Eigengewicht in „{lc}“ aktiviert.', { lc: lc.name }) : t('Eigengewicht in „{lc}“ deaktiviert.', { lc: lc.name }), 'ok');
}

/* ---------------- snow & wind (simplified) ---------------- */
export function snowWindDialog(app) {
  const st = app.store;
  const sia = st.model.settings.code === 'SIA';
  const s = { kind: 'snow', h0: 500, sk: 0.85, Ce: 1, Ct: 1, qp: 1.0, cpe: 0.7, newLC: true };
  const body = h('div');
  const doms = [...st.selection.domains].map((id) => st.idx.domains.get(id));
  const slope = (d) => {
    const ax = domainAxes(d.nodes.map((n) => P(st.idx.nodes.get(n))));
    return Math.acos(Math.min(1, Math.abs(ax.ez[2]))) * 180 / Math.PI;
  };
  const mu = (a) => (a <= 30 ? 0.8 : a < 60 ? 0.8 * (60 - a) / 30 : 0);
  const skSia = () => Math.max(0.9, (1 + (s.h0 / 350) ** 2) * 0.4);
  const render = () => {
    clear(body);
    body.appendChild(field(t('Einwirkung'), segmented([{ value: 'snow', label: t('Schnee'), icon: 'snow' }, { value: 'wind', label: t('Wind'), icon: 'wind' }], s.kind, (v) => { s.kind = v; render(); }, { full: true }), { stack: true }));
    if (s.kind === 'snow') {
      if (sia) {
        body.appendChild(field(t('Bezugshöhe h0'), numInput({ value: s.h0, q: 'len', onChange: (v) => { s.h0 = v || 0; render(); } }), { help: 'SIA 261 5.2.2: sk = [1 + (h0/350)²]·0.4 kN/m² ≥ 0.9' }));
        body.appendChild(h('div.kv', h('span', 'sk'), h('span', fmt('areaLoad', skSia()))));
      } else {
        body.appendChild(field(t('Schneelast sk'), numInput({ value: s.sk, q: 'areaLoad', onChange: (v) => { s.sk = v || 0; } }), { help: t('Charakteristischer Wert am Boden gemäss Nationalem Anhang (Zone/Höhe).') }));
      }
      body.appendChild(h('div.grid2', field('Ce', numInput({ value: s.Ce, onChange: (v) => { s.Ce = v || 1; } }), { stack: true }), field('Ct', numInput({ value: s.Ct, onChange: (v) => { s.Ct = v || 1; } }), { stack: true })));
      const tb = h('table.tbl', h('tr', h('th.txt', t('Fläche')), h('th', t('Neigung')), h('th', 'μ1'), h('th', 's')));
      const sk = sia ? skSia() : s.sk;
      for (const d of doms) { const a = slope(d); tb.appendChild(h('tr', h('td.txt', 'D' + d.id), h('td', a.toFixed(1) + '°'), h('td', mu(a).toFixed(2)), h('td', fmt('areaLoad', mu(a) * s.Ce * s.Ct * sk)))); }
      body.appendChild(h('div.tbl-wrap', { style: { margin: '10px 0' } }, tb));
      body.appendChild(hintBox(t('Formbeiwert μ1 für Pultdächer (keine Verwehung). Last wirkt in −Z auf die Grundrissprojektion.')));
    } else {
      body.appendChild(field(t('Staudruck qp'), numInput({ value: s.qp, q: 'areaLoad', onChange: (v) => { s.qp = v || 0; } }), { help: sia ? 'SIA 261 6.2.1: qp = ch·qp0' : 'EN 1991-1-4 4.5: qp(z)' }));
      body.appendChild(field(t('Druckbeiwert cpe'), numInput({ value: s.cpe, onChange: (v) => { s.cpe = v ?? 0; } }), { help: t('Positiv = Druck auf die Fläche, negativ = Sog.') }));
      body.appendChild(hintBox(t('Last senkrecht zur Fläche: w = cpe · qp. Druck wirkt entgegen der lokalen z-Achse.')));
    }
    body.appendChild(h('div', { style: { marginTop: '8px' } }, checkInput(t('In neuem Lastfall (mit passender Lastgruppe) anlegen'), s.newLC, (v) => { s.newLC = v; })));
  };
  render();
  openDialog({
    title: t('Schnee & Wind'), sub: sia ? 'SIA 261' : 'EN 1991-1-3 / -1-4', iconName: 'snow', mod: 'rose', size: 'wide', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Lasten erzeugen'), kind: 'primary', icon: 'plus', onClick: () => {
      const sk = sia ? skSia() : s.sk;
      let lcId = st.activeLC;
      st.commit(s.kind === 'snow' ? t('Schneelast') : t('Windlast'), (m) => {
        if (s.newLC || !m.loadCases.length) {
          let g = m.loadGroups.find((x) => x.type === s.kind);
          if (!g) {
            const p = s.kind === 'snow' ? (sia ? [1.5, 0, 0.6, 0.5, 0] : [1.5, 0, 0.5, 0.2, 0]) : (sia ? [1.5, 0, 0.6, 0.5, 0] : [1.5, 0, 0.6, 0.2, 0]);
            g = { id: nextId(m.loadGroups), name: s.kind === 'snow' ? t('Schnee') : t('Wind'), type: s.kind, gammaSup: p[0], gammaInf: p[1], psi0: p[2], psi1: p[3], psi2: p[4], exclusive: s.kind === 'wind' };
            m.loadGroups.push(g);
          }
          lcId = nextId(m.loadCases);
          m.loadCases.push({ id: lcId, name: s.kind === 'snow' ? t('Schnee') : t('Wind'), group: g.id, selfWeight: false });
        }
        for (const d of doms) {
          if (s.kind === 'snow') {
            const q = mu(slope(d)) * s.Ce * s.Ct * sk;
            if (q > 0) m.loads.push({ id: nextId(m.loads), lc: lcId, type: 'surface', domain: d.id, dir: 'Z', q: -q, projected: true });
          } else {
            m.loads.push({ id: nextId(m.loads), lc: lcId, type: 'surface', domain: d.id, dir: 'z', q: -s.cpe * s.qp, projected: false });
          }
        }
      });
      app.setActiveLC(lcId);
      app.renderRibbon();
      toast(t('Lasten erzeugt.'), 'ok');
    } }],
  });
  void V;
}
