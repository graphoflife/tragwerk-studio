// Mesh generation, model check, analysis runs (static, nonlinear, modal, buckling, spectrum) and design runs.
import { t } from '../../i18n.js';
import { h, ic, clear, openDialog, field, numInput, selectInput, segmented, checkInput, toast, hintBox, switchInput } from '../dom.js';
import { validateModel } from '../../core/model.js';
import { buildMesh } from '../../mesh/mesher.js';
import { runFem, cancelFem } from '../../core/analysis.js';
import { fmt } from '../../core/units.js';
import { defaultCaseKey, componentDef } from '../results-data.js';
import { checkSteelMembers } from '../../design/steel.js';
import { designRCSurfaces, designRCBeams } from '../../design/concrete.js';
import { checkPunching } from '../../design/punching.js';
import { checkTimberMembers } from '../../design/timber.js';

/* ---------------- mesh ---------------- */
export function ensureMesh(app) {
  const st = app.store;
  if (st.results.mesh) return st.results.mesh;
  const t0 = performance.now();
  const mesh = buildMesh(st.model, { meshSize: st.model.settings.meshSize, beamDivisions: st.model.settings.beamDivisions });
  mesh.ms = performance.now() - t0;
  st.results.mesh = mesh;
  if (mesh.warnings?.length) toast(t('Netz: {w}', { w: mesh.warnings.slice(0, 2).join(' · ') }), 'warn', 5000);
  return mesh;
}

export function meshGenerate(app, { quiet } = {}) {
  const st = app.store;
  if (!st.model.nodes.length) return toast(t('Das Modell ist leer.'), 'info');
  st.results.mesh = null;
  let mesh;
  try { mesh = ensureMesh(app); } catch (e) {
    console.error(e);
    toast(t('Netzgenerierung fehlgeschlagen: {m}', { m: e.message }), 'err', 6000);
    return;
  }
  st.view.showMesh = true;
  st.emit('results');
  st.emit('view');
  if (!quiet) toast(t('FE-Netz: {n} Knoten, {b} Stabelemente, {s} Flächenelemente ({ms} ms).', { n: mesh.nodes.length / 3, b: mesh.beams.length, s: mesh.shells.length, ms: Math.round(mesh.ms) }), 'ok', 4500);
}

export function meshSettings(app) {
  const st = app.store;
  const s = { meshSize: st.model.settings.meshSize, beamDivisions: st.model.settings.beamDivisions };
  const body = h('div',
    field(t('Elementgrösse Flächen'), numInput({ value: s.meshSize, q: 'len', min: 0.01, onChange: (v) => { s.meshSize = v || 1; } }), { help: t('Ziel-Kantenlänge der Flächenelemente. Kleiner = genauer, aber langsamer.') }),
    field(t('Unterteilung Stäbe'), numInput({ value: s.beamDivisions, min: 1, max: 50, onChange: (v) => { s.beamDivisions = Math.max(1, Math.round(v || 1)); } }), { help: t('Anzahl Elemente je Stab (wichtig für Eigenformen und Knicken, für lineare Statik genügt 1).') }),
    hintBox(t('Einzelne Flächen können in den Eigenschaften eine eigene Netzgrösse erhalten.')));
  openDialog({
    title: t('Netzparameter'), iconName: 'meshRefine', mod: 'mint', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Übernehmen & vernetzen'), kind: 'primary', onClick: () => {
      st.commit(t('Netzparameter'), (m) => { m.settings.meshSize = s.meshSize; m.settings.beamDivisions = s.beamDivisions; });
      meshGenerate(app);
    } }],
  });
}

export function checkModel(app, { onlyErrors = false, proceed } = {}) {
  const st = app.store;
  const issues = validateModel(st.model);
  const errs = issues.filter((i) => i.level === 'err');
  if (onlyErrors && !errs.length) return true;
  const body = h('div');
  if (!issues.length) body.appendChild(hintBox(t('Keine Probleme gefunden – das Modell ist bereit für die Berechnung.'), 'ok'));
  for (const i of issues.slice(0, 60)) {
    body.appendChild(h('div.hint-box' + (i.level === 'err' ? '.err' : '.warn'), ic(i.level === 'err' ? 'xCircle' : 'alert'),
      h('div.grow', i.msg),
      i.ref ? h('button.btn.sm', { onclick: () => { st.select(i.ref, 'replace'); app.zoomSelection(); d.close(); } }, ic('target'), t('Zeigen')) : null));
  }
  const d = openDialog({
    title: t('Modellprüfung'), sub: t('{e} Fehler, {w} Warnungen', { e: errs.length, w: issues.length - errs.length }), iconName: 'shieldCheck', mod: 'mint', size: 'wide', body,
    buttons: [
      proceed && !errs.length ? { label: t('Trotzdem rechnen'), kind: 'primary', onClick: proceed } : null,
      { label: t('Schliessen'), kind: proceed ? 'ghost' : 'primary' },
    ].filter(Boolean),
  });
  return false;
}

/* ---------------- progress overlay ---------------- */
function progress(app, title) {
  const bar = h('div');
  const msg = h('div.small.muted', t('Vorbereitung …'));
  const el = h('div.progress-overlay', h('div.vp-card.progress-card',
    h('div.row', ic('run'), h('b', title)), h('div.progress-bar', bar), msg,
    h('div.row', { style: { marginTop: '10px' } }, h('span.grow'), h('button.btn.sm', { onclick: () => { cancelFem(); el.remove(); toast(t('Berechnung abgebrochen.'), 'warn'); } }, ic('stop'), t('Abbrechen')))));
  app.vpEl.appendChild(el);
  return {
    set(pct, m) { bar.style.width = Math.round(Math.min(100, Math.max(2, pct))) + '%'; if (m) msg.textContent = m; },
    done() { el.remove(); },
  };
}

const DOF_NAMES = ['uX', 'uY', 'uZ', 'φX', 'φY', 'φZ'];
// Translate solver messages (the FEM core reports in English) for display.
export function femMessage(msg) {
  const s = String(msg || '');
  let m;
  if ((m = s.match(/^(\w+:\d+): (.*)$/))) return `${m[1]}: ${femMessage(m[2])}`;
  if ((m = s.match(/(\d+) DOF\(s\) without stiffness suppressed automatically/))) return t('{n} Freiheitsgrade ohne Steifigkeit wurden automatisch gehalten (z.B. Drillfreiheitsgrade von Platten).', { n: m[1] });
  if ((m = s.match(/(\d+) tension\/compression-only member\(s\) inactive/))) return t('{n} Zug-/Druckstäbe ausgefallen.', { n: m[1] });
  if (/P-Δ: load exceeds the critical load|unstable/i.test(s)) return t('Theorie II. Ordnung: Die Last überschreitet die kritische Last bzw. das System ist instabil.');
  if (/did not converge|not converged/i.test(s)) return t('Nichtlineare Iteration nicht konvergiert – Ergebnis unsicher.');
  return s;
}

function femError(app, err) {
  const st = app.store;
  if (!err) return;
  const modelNode = err.nodeId || (err.node != null ? st.results.mesh?.nodeModelId?.[err.node] : null);
  let text = femMessage(err.message || String(err.code));
  if (err.code === 'MECHANISM') {
    text = modelNode
      ? t('Das System ist kinematisch (Mechanismus): Knoten {n}, Richtung {d} ist nicht gehalten.', { n: modelNode, d: DOF_NAMES[err.dof] ?? err.dofName })
      : t('Das System ist kinematisch (Mechanismus) an einem Netzknoten, Richtung {d}.', { d: DOF_NAMES[err.dof] ?? err.dofName });
  } else if (err.code === 'NO_SUPPORTS') text = t('Das Modell hat keine Lager.');
  else if (err.code === 'NO_MASS') text = t('Keine Massen vorhanden – Eigengewicht oder Lastfall-Massen aktivieren.');
  else if (err.code === 'NO_LOADS') text = t('Keine Lasten vorhanden.');
  const body = h('div', hintBox(text, 'err'));
  if (err.code === 'MECHANISM') body.appendChild(hintBox(t('Typische Ursachen: fehlende Lager, Gelenke an allen Stäben eines Knotens, nicht verbundene Bauteile oder Fachwerkstäbe ohne Querhalterung.')));
  openDialog({
    title: t('Berechnung fehlgeschlagen'), iconName: 'alert', mod: 'rose', body,
    buttons: [
      modelNode ? { label: t('Knoten {n} zeigen', { n: modelNode }), icon: 'target', onClick: () => { st.select({ nodes: [modelNode] }, 'replace'); app.zoomSelection(); } } : null,
      { label: t('Modell prüfen'), onClick: () => checkModel(app) },
      { label: t('Schliessen'), kind: 'primary' },
    ].filter(Boolean),
  });
}

/* ---------------- static ---------------- */
export async function runStatic(app, nonlinear, opts) {
  if (nonlinear && !opts) return nonlinearDialog(app);
  const st = app.store;
  if (!checkModel(app, { onlyErrors: true })) return false;
  let mesh;
  try { mesh = ensureMesh(app); } catch (e) { console.error(e); toast(t('Netzgenerierung fehlgeschlagen: {m}', { m: e.message }), 'err'); return false; }
  const pr = progress(app, nonlinear ? t('Nichtlineare Berechnung') : t('Lineare Statik'));
  const t0 = performance.now();
  try {
    const res = await runFem('static', st.model, mesh, { nonlinear: !!nonlinear, ...(opts || {}) }, (p, m) => pr.set(p, m));
    pr.done();
    if (res.error) { femError(app, res.error); return false; }
    res.ms = performance.now() - t0;
    res.nonlinear = !!nonlinear;
    st.results.static = res;
    st.results.staticOpts = { nonlinear: !!nonlinear, ...(opts || {}) };
    st.results.steel = st.results.rc = st.results.rcBeams = st.results.punching = st.results.timber = null;
    const keep = st.resultView.caseKey && res.cases[st.resultView.caseKey];
    st.resultView.caseKey = keep ? st.resultView.caseKey : defaultCaseKey(st);
    st.resultView.kind = 'static';
    if (!st.resultView.component || ['eta', 'axb', 'ayb', 'axt', 'ayt', 'vRatio', 'punch', 'AsBot', 'AsTop', 'Asw'].includes(st.resultView.component) || !componentDef(st.resultView.component)) st.resultView.component = 'deformed';
    st.emit('results');
    st.emit('resultView');
    app.setStatus(t('Statik: {n} Fälle in {ms} ms · {d} Freiheitsgrade', { n: Object.keys(res.cases).length, ms: Math.round(res.ms), d: res.stats?.dofs ?? '–' }));
    toast(t('Berechnung abgeschlossen ({ms} ms).', { ms: Math.round(res.ms) }), 'ok');
    res.warnings = (res.warnings || []).map(femMessage);
    const important = res.warnings.filter((w) => !/automatisch gehalten/.test(w));
    if (important.length) toast(important[0], 'warn', 5000);
    if (!['static', 'buckling', 'rc', 'steel', 'timber'].includes(st.tab)) app.setTab('static');
    else app.showSide('results');
    return true;
  } catch (e) {
    pr.done();
    if (e.message !== 'cancelled') { console.error(e); femError(app, { message: e.message }); }
    return false;
  }
}

function nonlinearDialog(app) {
  const s = { pDelta: true, maxIter: 50, tol: 1e-4 };
  const st = app.store;
  const body = h('div',
    hintBox(st.model.combinations.length
      ? t('Jede Kombination wird separat nichtlinear berechnet (keine Superposition).')
      : t('Ohne Kombinationen werden die Lastfälle einzeln nichtlinear berechnet. Tipp: zuerst Kombinationen erzeugen.'), st.model.combinations.length ? '' : 'warn'),
    switchInput(t('Theorie II. Ordnung (P-Δ, geometrische Steifigkeit)'), s.pDelta, (v) => { s.pDelta = v; }),
    h('div.small.muted', { style: { margin: '-2px 0 10px 44px' } }, t('Zug-/Druckstäbe und abhebende Lager werden immer iterativ berücksichtigt.')),
    h('div.grid2', field(t('Max. Iterationen'), numInput({ value: s.maxIter, min: 1, max: 500, onChange: (v) => { s.maxIter = Math.round(v || 50); } }), { stack: true }),
      field(t('Toleranz'), numInput({ value: s.tol, min: 1e-9, onChange: (v) => { s.tol = v || 1e-4; } }), { stack: true })));
  openDialog({
    title: t('Nichtlineare Berechnung'), iconName: 'nonlinear', mod: 'lemon', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Berechnen'), kind: 'primary', icon: 'run', onClick: () => { runStatic(app, true, s); } }],
  });
}

/* ---------------- modal ---------------- */
export function runModalDialog(app) {
  const st = app.store;
  const s = { nModes: 6, massCase: '', massFactor: 1, selfWeightMass: true };
  const body = h('div',
    field(t('Anzahl Eigenformen'), numInput({ value: s.nModes, min: 1, max: 100, onChange: (v) => { s.nModes = Math.max(1, Math.round(v || 6)); } })),
    switchInput(t('Masse aus Eigengewicht der Elemente'), s.selfWeightMass, (v) => { s.selfWeightMass = v; }),
    field(t('Zusätzliche Masse aus Lastfall'), selectInput({ value: '', options: [{ value: '', label: t('– keine –') }, ...st.model.loadCases.map((lc) => ({ value: lc.id, label: lc.name }))], onChange: (v) => { s.massCase = v; } }), { help: t('Abwärts gerichtete Lasten dieses Lastfalls werden in Massen umgerechnet (m = F/g), z.B. Ausbau oder ψ2·Nutzlast.') }),
    field(t('Faktor'), numInput({ value: s.massFactor, min: 0, onChange: (v) => { s.massFactor = v ?? 1; } }), { help: t('Faktor auf die Lastfallmasse, z.B. ψ2 = 0.3') }),
    hintBox(t('Für genaue Eigenformen sollten Stäbe in mindestens 4 Elemente unterteilt sein (Netzparameter).')));
  openDialog({
    title: t('Eigenschwingungsanalyse'), iconName: 'vibration', mod: 'teal', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Berechnen'), kind: 'primary', icon: 'run', onClick: () => runModal(app, s) }],
  });
}

export async function runModal(app, s) {
  const st = app.store;
  if (!checkModel(app, { onlyErrors: true })) return false;
  let mesh;
  try { mesh = ensureMesh(app); } catch (e) { toast(t('Netzgenerierung fehlgeschlagen: {m}', { m: e.message }), 'err'); return false; }
  const pr = progress(app, t('Eigenschwingungsanalyse'));
  try {
    const res = await runFem('modal', st.model, mesh, { nModes: s.nModes, massCase: s.massCase ? +s.massCase : null, massFactor: s.massFactor, selfWeightMass: s.selfWeightMass }, (p, m) => pr.set(p, m));
    pr.done();
    if (res.error) { femError(app, res.error); return false; }
    res.warnings = (res.warnings || []).map(femMessage);
    st.results.modal = res;
    st.results.spectrum = null;
    st.resultView.kind = 'modal'; st.resultView.mode = 0; st.resultView.animate = true; st.resultView.scale = 1;
    st.emit('results'); st.emit('resultView');
    if (st.tab !== 'vibration') app.setTab('vibration'); else app.showSide('results');
    toast(t('{n} Eigenformen berechnet · f1 = {f}', { n: res.modes.length, f: fmt('freq', res.modes[0]?.f) }), 'ok');
    return true;
  } catch (e) {
    pr.done();
    if (e.message !== 'cancelled') { console.error(e); femError(app, { message: e.message }); }
    return false;
  }
}

/* ---------------- buckling ---------------- */
export function runBucklingDialog(app) {
  const st = app.store;
  const m = st.model;
  const options = [
    ...(m.combinations.length ? [{ group: t('Kombinationen'), options: m.combinations.map((c) => ({ value: 'CO:' + c.id, label: c.name })) }] : []),
    { group: t('Lastfälle'), options: m.loadCases.map((lc) => ({ value: 'LC:' + lc.id, label: lc.name })) },
  ];
  const s = { key: (m.combinations.find((c) => c.type === 'ULS') ? 'CO:' + m.combinations.find((c) => c.type === 'ULS').id : 'LC:' + (m.loadCases[0]?.id ?? '')), nModes: 4 };
  const body = h('div',
    field(t('Lastsituation'), selectInput({ value: s.key, options, onChange: (v) => { s.key = v; } }), { stack: true }),
    field(t('Anzahl Knickformen'), numInput({ value: s.nModes, min: 1, max: 30, onChange: (v) => { s.nModes = Math.max(1, Math.round(v || 4)); } })),
    hintBox(t('Ermittelt die kritischen Lastfaktoren αcr: die gewählte Last × αcr führt zum Stabilitätsversagen.')));
  openDialog({
    title: t('Knickanalyse'), iconName: 'buckling', mod: 'peach', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Berechnen'), kind: 'primary', icon: 'run', onClick: () => runBuckling(app, s) }],
  });
}

async function runBuckling(app, s) {
  const st = app.store;
  const [p, id] = String(s.key).split(':');
  const factors = p === 'CO' ? { ...(st.idx.combinations.get(+id)?.factors || {}) } : { [id]: 1 };
  if (!Object.keys(factors).length) return toast(t('Keine Lasten gewählt.'), 'warn');
  if (!checkModel(app, { onlyErrors: true })) return false;
  let mesh;
  try { mesh = ensureMesh(app); } catch (e) { toast(t('Netzgenerierung fehlgeschlagen: {m}', { m: e.message }), 'err'); return false; }
  const pr = progress(app, t('Knickanalyse'));
  try {
    const res = await runFem('buckling', st.model, mesh, { factors, nModes: s.nModes }, (pp, m) => pr.set(pp, m));
    pr.done();
    if (res.error) { femError(app, res.error); return false; }
    res.basis = s.key;
    res.warnings = (res.warnings || []).map(femMessage);
    st.results.buckling = res;
    st.resultView.kind = 'buckling'; st.resultView.mode = 0; st.resultView.animate = false; st.resultView.scale = 1;
    st.emit('results'); st.emit('resultView');
    if (st.tab !== 'buckling') app.setTab('buckling'); else app.showSide('results');
    if (res.modes?.length) toast(t('Kritischer Lastfaktor αcr = {a}', { a: res.modes[0].lambda.toFixed(3) }), res.modes[0].lambda < 1 ? 'warn' : 'ok');
    else toast(t('Keine Knickform gefunden (keine Druckkräfte?).'), 'warn');
    return true;
  } catch (e) {
    pr.done();
    if (e.message !== 'cancelled') { console.error(e); femError(app, { message: e.message }); }
    return false;
  }
}

/* ---------------- response spectrum ---------------- */
export function runSpectrumDialog(app) {
  const st = app.store;
  const sia = st.model.settings.code === 'SIA';
  const s = { dirs: { X: true, Y: true, Z: false }, ag: sia ? 1.0 : 1.0, zone: sia ? 'Z2' : '', soil: 'B', q: sia ? 2.0 : 1.5, importance: 1.0, rule: 'CQC', damping: 0.05, nModes: 12 };
  const body = h('div');
  const render = () => {
    clear(body);
    body.appendChild(hintBox(sia ? t('Bemessungsspektrum nach SIA 261, Ziff. 16.2. Modales Antwortspektrenverfahren mit {r}-Überlagerung.', { r: s.rule }) : t('Bemessungsspektrum Typ 1 nach EN 1998-1, 3.2.2.5. Modales Antwortspektrenverfahren mit {r}-Überlagerung.', { r: s.rule })));
    body.appendChild(field(t('Richtungen'), h('div.row', { style: { gap: '16px' } }, ['X', 'Y', 'Z'].map((d) => checkInput(d, s.dirs[d], (v) => { s.dirs[d] = v; })))));
    if (sia) {
      body.appendChild(field(t('Erdbebenzone'), selectInput({ value: s.zone, options: [['Z1a', 'Z1a (agd 0.4)'], ['Z1b', 'Z1b (agd 0.6)'], ['Z2', 'Z2 (agd 1.0)'], ['Z3a', 'Z3a (agd 1.3)'], ['Z3b', 'Z3b (agd 1.6)']].map(([v, l]) => ({ value: v, label: l + ' m/s²' })), onChange: (v) => { s.zone = v; } })));
      body.appendChild(field(t('Baugrundklasse'), segmented('ABCDEF'.split('').map((x) => ({ value: x, label: x })), s.soil, (v) => { s.soil = v; }, { full: true })));
      body.appendChild(field(t('Bauwerksklasse γf'), selectInput({ value: s.importance, options: [[1.0, 'BWK I (1.0)'], [1.2, 'BWK II (1.2)'], [1.4, 'BWK III (1.4)']].map(([v, l]) => ({ value: v, label: l })), onChange: (v) => { s.importance = +v; } })));
    } else {
      body.appendChild(field(t('Bodenbeschleunigung ag'), numInput({ value: s.ag, q: 'accel', min: 0, onChange: (v) => { s.ag = v || 0; } })));
      body.appendChild(field(t('Baugrundklasse'), segmented('ABCDE'.split('').map((x) => ({ value: x, label: x })), s.soil, (v) => { s.soil = v; }, { full: true })));
      body.appendChild(field(t('Bedeutungsbeiwert γI'), numInput({ value: s.importance, min: 0.5, onChange: (v) => { s.importance = v || 1; } })));
    }
    body.appendChild(field(t('Verhaltensbeiwert q'), numInput({ value: s.q, min: 1, onChange: (v) => { s.q = v || 1.5; } })));
    body.appendChild(field(t('Überlagerung'), segmented([{ value: 'SRSS', label: 'SRSS' }, { value: 'CQC', label: 'CQC' }], s.rule, (v) => { s.rule = v; render(); }, { full: true })));
    if (!st.results.modal) body.appendChild(field(t('Eigenformen'), numInput({ value: s.nModes, min: 1, max: 100, onChange: (v) => { s.nModes = Math.round(v || 12); } }), { help: t('Es werden zuerst die Eigenformen berechnet.') }));
  };
  render();
  openDialog({
    title: t('Antwortspektrenverfahren'), sub: sia ? 'SIA 261' : 'EN 1998-1', iconName: 'seismic', mod: 'teal', body,
    buttons: [{ label: t('Abbrechen'), kind: 'ghost' }, { label: t('Berechnen'), kind: 'primary', icon: 'run', onClick: () => runSpectrum(app, s) }],
  });
}

async function runSpectrum(app, s) {
  const st = app.store;
  if (!st.results.modal) {
    const ok = await runModal(app, { nModes: s.nModes, massCase: '', massFactor: 1, selfWeightMass: true });
    if (!ok) return;
  }
  const mesh = st.results.mesh;
  const pr = progress(app, t('Antwortspektrum'));
  try {
    const cases = {};
    const dirs = Object.entries(s.dirs).filter(([, v]) => v).map(([d]) => d);
    for (const [i, dir] of dirs.entries()) {
      pr.set((i / dirs.length) * 100, t('Richtung {d}', { d: dir }));
      const opt = { code: st.model.settings.code, dir, ag: s.ag, zone: st.model.settings.code === 'SIA' ? s.zone : undefined, soil: s.soil, q: s.q, importance: s.importance, rule: s.rule, damping: s.damping, modal: st.results.modal };
      cases['SP:' + dir] = await runFem('spectrum', st.model, mesh, opt);
    }
    pr.done();
    st.results.spectrum = { cases, opts: s };
    st.resultView.kind = 'spectrum';
    st.resultView.caseKey = 'SP:' + dirs[0];
    st.resultView.component = 'eR';
    st.emit('results'); st.emit('resultView');
    app.showSide('results');
    toast(t('Antwortspektrum berechnet.'), 'ok');
  } catch (e) {
    pr.done();
    if (e.message !== 'cancelled') { console.error(e); femError(app, { message: e.message }); }
  }
}

/* ---------------- design ---------------- */
export function designCaseKeys(st) {
  const s = st.results.static;
  if (!s) return { keys: [], basis: '' };
  const uls = st.model.combinations.filter((c) => (c.type === 'ULS' || c.type === 'ULS-ACC') && s.cases['CO:' + c.id]).map((c) => 'CO:' + c.id);
  if (uls.length) return { keys: uls, basis: t('{n} GZT-Kombinationen', { n: uls.length }) };
  const all = st.model.combinations.filter((c) => s.cases['CO:' + c.id]).map((c) => 'CO:' + c.id);
  if (all.length) return { keys: all, basis: t('{n} Kombinationen', { n: all.length }) };
  return { keys: Object.keys(s.cases).filter((k) => k.startsWith('LC:')), basis: t('Lastfälle (ohne Teilsicherheitsbeiwerte!)'), warn: true };
}

// beams/ribs (axis + half width): the slab shear check is skipped next to them (beam shear governs)
function beamSegments(st) {
  const out = [];
  for (const l of st.model.lines) {
    if (!l.element || !['beam', 'rib'].includes(l.element.type)) continue;
    const sec = st.idx.sections.get(l.element.section);
    const a = st.idx.nodes.get(l.n1), b = st.idx.nodes.get(l.n2);
    out.push({ a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], hb: (sec?.dims?.b || sec?.dims?.d || 0.3) / 2 });
  }
  return out;
}

export async function runDesign(app, kind, { quiet = false } = {}) {
  const st = app.store;
  if (!st.results.static) {
    const ok = await runStatic(app, false);
    if (!ok) return false;
  }
  const { keys, basis, warn } = designCaseKeys(st);
  const opts = { code: st.model.settings.code };
  const mesh = st.results.mesh;
  st.results.designBasis = { keys, basis, warn };
  const say = (msg, type, ms) => { if (!quiet) toast(msg, type, ms); };
  try {
    if (kind === 'steel') {
      st.results.steel = checkSteelMembers(st.model, mesh, st.results.static, keys, opts);
      st.setResultView({ kind: 'steel', component: 'eta' });
      const n = st.results.steel.length, f = st.results.steel.filter((r) => r.eta > 1).length;
      say(n ? t('Stahlbemessung: {n} Stäbe, {f} nicht erfüllt · Basis: {b}', { n, f, b: basis }) : t('Keine Stahlstäbe gefunden.'), n ? (f ? 'warn' : 'ok') : 'info', 5000);
    } else if (kind === 'timber') {
      st.results.timber = checkTimberMembers(st.model, mesh, st.results.static, keys, opts);
      st.setResultView({ kind: 'timber', component: 'eta' });
      const n = st.results.timber.length, f = st.results.timber.filter((r) => r.eta > 1).length;
      say(n ? t('Holzbemessung: {n} Stäbe, {f} nicht erfüllt · Basis: {b}', { n, f, b: basis }) : t('Keine Holzstäbe gefunden.'), n ? (f ? 'warn' : 'ok') : 'info', 5000);
    } else if (kind === 'rc') {
      // punching zones (geometry only) → surfaces (slab shear outside these zones) → punching with ρl
      const pre = checkPunching(st.model, mesh, st.results.static, keys, opts);
      st.results.rc = designRCSurfaces(st.model, mesh, st.results.static, keys, { ...opts, shearExclude: pre.zones, shearExcludeSegs: beamSegments(st) });
      st.results.punching = checkPunching(st.model, mesh, st.results.static, keys, { ...opts, rc: st.results.rc });
      const doms = st.results.rc.domains;
      if (!doms.length) say(t('Keine Stahlbetonflächen gefunden (Material Beton erforderlich).'), 'info');
      else {
        const rv = st.resultView;
        st.setResultView({ kind: 'rc', component: /^a[xy][bt]$|vRatio|punch/.test(rv.component) && rv.kind === 'rc' ? rv.component : 'axb', rcMode: rv.rcMode || 'req' });
        const pf = st.results.punching.items.filter((i) => i.eta > 1).length;
        say(t('{n} Flächen bemessen · Basis: {b}', { n: doms.length, b: basis }) + (st.results.punching.items.length ? ' · ' + t('Durchstanzen: {n} Stellen, {f} mit η > 1', { n: st.results.punching.items.length, f: pf }) : ''), pf ? 'warn' : 'ok', 5000);
      }
    } else if (kind === 'rcBeam') {
      st.results.rcBeams = designRCBeams(st.model, mesh, st.results.static, keys, opts);
      st.setResultView({ kind: 'rc', component: ['AsBot', 'AsTop', 'Asw'].includes(st.resultView.component) ? st.resultView.component : 'AsBot' });
      const n = st.results.rcBeams.length, tb = st.results.rcBeams.filter((b) => b.tBeam).length;
      say(n ? t('{n} Betonbalken bemessen ({t} als Plattenbalken) · Basis: {b}', { n, t: tb, b: basis }) : t('Keine Betonbalken gefunden (Material Beton, Querschnitt Rechteck oder T).'), n ? 'ok' : 'info', 5000);
    }
    if (warn) say(t('Achtung: keine Kombinationen vorhanden – bemessen wird mit charakteristischen Lastfällen.'), 'warn', 6000);
    st.emit('results');
    const tab = kind === 'steel' ? 'steel' : kind === 'timber' ? 'timber' : 'rc';
    if (st.tab !== tab) app.setTab(tab); else app.showSide('results');
    return true;
  } catch (e) {
    console.error(e);
    toast(t('Bemessung fehlgeschlagen: {m}', { m: e.message }), 'err', 6000);
    return false;
  }
}
