// Central application state: model, selection, view settings, results, undo/redo, autosave.
import { createModel, buildIndex } from './model.js';
import { partsHidden, listParts } from './parts.js';

const AUTOSAVE_KEY = 'ts.model';
const MAX_HISTORY = 120;

class Store {
  constructor() {
    this.listeners = new Map();
    this.model = createModel();
    this.idx = buildIndex(this.model);
    this.selection = emptySelection();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.tab = 'geometry';
    this.activeLC = 1;
    this.results = emptyResults();
    this.view = {
      renderMode: 'solid',       // wire | solid | render
      persp: true,
      labelsNodes: false,
      labelsLines: false,
      labelsValues: true,
      showLoads: true,
      showSupports: true,
      showAxes: false,
      showMesh: false,
      showNodes: true,
      showGrid: true,
      hidden: { nodes: new Set(), lines: new Set(), domains: new Set() },       // effective: manual ∪ parts
      manualHidden: { nodes: new Set(), lines: new Set(), domains: new Set() }, // Ausblenden / Isolieren
      parts: { on: new Set(), autoAdd: true },                                   // active part keys (see core/parts.js)
      workplane: { plane: 'XY', offset: 0 },
      grid: { step: 1, snap: true },
      snapNodes: true,
      snapMid: true,
      snapLine: false,
      ortho: false,
      selFilter: { nodes: true, lines: true, domains: true, supports: true, loads: true },
    };
    this.resultView = {
      kind: null,            // 'static' | 'modal' | 'buckling' | 'spectrum' | 'steel' | 'rc' | 'timber'
      caseKey: null,
      component: 'eZ',
      display: 'auto',       // auto | contour | diagram
      deformed: true,
      scale: 1,              // user multiplier on automatic scale
      diagramScale: 1,
      mode: 0,
      animate: false,
      smooth: true,
      levels: 12,
      palette: 'pastel',
      showReactions: false,
    };
  }

  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt).delete(fn);
  }

  emit(evt, data) {
    for (const fn of this.listeners.get(evt) || []) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }

  // Apply a model change as one undoable step. fn(model) mutates the model.
  commit(label, fn, { keepResults = false } = {}) {
    const before = JSON.stringify(this.model);
    const maxId = (arr) => arr.reduce((a, x) => Math.max(a, x.id), 0);
    const prev = { nodes: maxId(this.model.nodes), lines: maxId(this.model.lines), domains: maxId(this.model.domains) };
    let ret;
    try {
      ret = fn(this.model);
      this.addNewToActiveParts(prev);
    } catch (e) {
      this.model = JSON.parse(before);
      this.idx = buildIndex(this.model);
      throw e;
    }
    const after = JSON.stringify(this.model);
    if (after === before) return ret;
    this.undoStack.push({ label, snap: before });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.afterChange(keepResults);
    return ret;
  }

  afterChange(keepResults) {
    this.model.meta.modified = new Date().toISOString();
    this.idx = buildIndex(this.model);
    this.pruneSelection();
    this.applyVisibility();
    if (!this.idx.loadCases.has(this.activeLC)) this.activeLC = this.model.loadCases[0]?.id ?? null;
    this.dirty = true;
    if (!keepResults) this.clearResults(true);
    this.emit('model');
    this.scheduleAutosave();
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push({ label: e.label, snap: JSON.stringify(this.model) });
    this.model = JSON.parse(e.snap);
    this.afterChange(false);
    return e.label;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push({ label: e.label, snap: JSON.stringify(this.model) });
    this.model = JSON.parse(e.snap);
    this.afterChange(false);
    return e.label;
  }

  loadModel(model, { keepHistory = false } = {}) {
    this.model = migrate(model);
    if (!keepHistory) { this.undoStack.length = 0; this.redoStack.length = 0; }
    this.idx = buildIndex(this.model);
    this.selection = emptySelection();
    this.view.manualHidden = { nodes: new Set(), lines: new Set(), domains: new Set() };
    this.view.parts.on = new Set();
    this.applyVisibility();
    this.activeLC = this.model.loadCases[0]?.id ?? null;
    this.dirty = false;
    this.clearResults(true);
    this.emit('model', { loaded: true });
    this.emit('selection');
    this.scheduleAutosave();
  }

  clearResults(silent) {
    const had = Object.values(this.results).some(Boolean);
    this.results = emptyResults();
    this.resultView.kind = null;
    this.resultView.animate = false;
    if (had || !silent) this.emit('results');
  }

  setResults(key, value) {
    this.results[key] = value;
    this.emit('results');
  }

  /* ---------- selection ---------- */
  // effective visibility = manually hidden ∪ hidden by the part filter
  applyVisibility() {
    const v = this.view, known = new Set(listParts(this.model).map((p) => p.key));
    for (const k of [...v.parts.on]) if (!known.has(k)) v.parts.on.delete(k);
    const ph = partsHidden(this.model, v.parts.on);
    v.hidden = {};
    for (const k of ['nodes', 'lines', 'domains']) {
      v.hidden[k] = new Set(v.manualHidden[k]);
      for (const id of [...v.hidden[k]]) if (!this.idx[k]?.has(id)) { v.hidden[k].delete(id); v.manualHidden[k].delete(id); }
      if (ph) ph[k].forEach((id) => v.hidden[k].add(id));
    }
  }

  setParts(on) {
    this.view.parts.on = new Set(on);
    this.applyVisibility();
    this.pruneHiddenSelection();
    this.emit('view');
    this.emit('parts');
  }

  setManualHidden(h) {
    this.view.manualHidden = h;
    this.applyVisibility();
    this.emit('view');
  }

  pruneHiddenSelection() {
    const h = this.view.hidden;
    for (const k of ['nodes', 'lines', 'domains']) for (const id of [...this.selection[k]]) if (h[k].has(id)) this.selection[k].delete(id);
    this.emit('selection');
  }

  // newly drawn elements join the active user parts, so they stay visible while a part filter is on
  addNewToActiveParts(prev) {
    const v = this.view;
    if (!v.parts.on.size || v.parts.autoAdd === false) return;
    const userIds = [...v.parts.on].filter((k) => k.startsWith('u:')).map((k) => +k.slice(2));
    if (!userIds.length) return;
    const fresh = {
      nodes: this.model.nodes.filter((x) => x.id > prev.nodes).map((x) => x.id),
      lines: this.model.lines.filter((x) => x.id > prev.lines).map((x) => x.id),
      domains: this.model.domains.filter((x) => x.id > prev.domains).map((x) => x.id),
    };
    if (!fresh.nodes.length && !fresh.lines.length && !fresh.domains.length) return;
    for (const p of this.model.parts || []) {
      if (!userIds.includes(p.id)) continue;
      for (const k of ['nodes', 'lines', 'domains']) p[k] = [...new Set([...(p[k] || []), ...fresh[k]])];
    }
  }

  pruneSelection() {
    for (const k of SEL_KINDS) {
      for (const id of [...this.selection[k]]) if (!this.idx[k].has(id)) this.selection[k].delete(id);
    }
  }

  select(sel, mode = 'replace') {
    const s = this.selection;
    if (mode === 'replace') for (const k of SEL_KINDS) s[k].clear();
    for (const k of SEL_KINDS) {
      for (const id of sel[k] || []) {
        if (mode === 'toggle') { if (s[k].has(id)) s[k].delete(id); else s[k].add(id); } else if (mode === 'remove') s[k].delete(id);
        else s[k].add(id);
      }
    }
    this.emit('selection');
  }

  clearSelection() {
    if (!this.selCount()) return;
    for (const k of SEL_KINDS) this.selection[k].clear();
    this.emit('selection');
  }

  selCount() { return SEL_KINDS.reduce((n, k) => n + this.selection[k].size, 0); }
  // number of selected geometry objects (nodes, lines, domains) – what transformations act on
  geoCount() { return this.selection.nodes.size + this.selection.lines.size + this.selection.domains.size; }

  /* ---------- view ---------- */
  setView(patch) {
    Object.assign(this.view, patch);
    this.emit('view');
  }

  setResultView(patch) {
    Object.assign(this.resultView, patch);
    this.emit('resultView');
  }

  /* ---------- persistence ---------- */
  scheduleAutosave() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.model)); } catch (e) { /* quota */ }
    }, 600);
  }

  restoreAutosave() {
    try {
      const s = localStorage.getItem(AUTOSAVE_KEY);
      if (!s) return false;
      const m = JSON.parse(s);
      if (!m || m.version !== 1) return false;
      this.loadModel(m);
      return true;
    } catch (e) { return false; }
  }
}

// everything that can be picked in the viewport
export const SEL_KINDS = ['nodes', 'lines', 'domains', 'supports', 'loads'];
function emptySelection() { return Object.fromEntries(SEL_KINDS.map((k) => [k, new Set()])); }

function emptyResults() {
  return { mesh: null, static: null, staticOpts: null, modal: null, buckling: null, spectrum: null, steel: null, rc: null, rcBeams: null, rcCols: null, punching: null, timber: null, designBasis: null };
}

export function migrate(m) {
  const base = { nodes: [], lines: [], domains: [], materials: [], sections: [], supports: [], loadGroups: [], loadCases: [], loads: [], combinations: [], parts: [], storeys: [], sectionLines: [] };
  const model = { ...base, ...m };
  model.version = 1;
  model.meta = { name: 'Modell', author: '', description: '', ...(m.meta || {}) };
  model.settings = { meshSize: 1, beamDivisions: 4, g: 9.81, code: 'EC', ...(m.settings || {}) };
  for (const d of model.domains) d.holes = d.holes || [];
  return model;
}

export const store = new Store();
