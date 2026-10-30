// Central application state: model, selection, view settings, results, undo/redo, autosave.
import { createModel, buildIndex } from './model.js';

const AUTOSAVE_KEY = 'ts.model';
const MAX_HISTORY = 120;

class Store {
  constructor() {
    this.listeners = new Map();
    this.model = createModel();
    this.idx = buildIndex(this.model);
    this.selection = { nodes: new Set(), lines: new Set(), domains: new Set() };
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
      hidden: { nodes: new Set(), lines: new Set(), domains: new Set() },
      workplane: { plane: 'XY', offset: 0 },
      grid: { step: 1, snap: true },
      snapNodes: true,
      snapMid: true,
      snapLine: false,
      ortho: false,
      selFilter: { nodes: true, lines: true, domains: true },
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
    let ret;
    try {
      ret = fn(this.model);
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
    this.selection = { nodes: new Set(), lines: new Set(), domains: new Set() };
    this.view.hidden = { nodes: new Set(), lines: new Set(), domains: new Set() };
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
  pruneSelection() {
    for (const k of ['nodes', 'lines', 'domains']) {
      for (const id of [...this.selection[k]]) if (!this.idx[k].has(id)) this.selection[k].delete(id);
    }
  }

  select(sel, mode = 'replace') {
    const s = this.selection;
    if (mode === 'replace') { s.nodes.clear(); s.lines.clear(); s.domains.clear(); }
    for (const k of ['nodes', 'lines', 'domains']) {
      for (const id of sel[k] || []) {
        if (mode === 'toggle') { if (s[k].has(id)) s[k].delete(id); else s[k].add(id); } else if (mode === 'remove') s[k].delete(id);
        else s[k].add(id);
      }
    }
    this.emit('selection');
  }

  clearSelection() {
    if (!this.selCount()) return;
    this.selection.nodes.clear(); this.selection.lines.clear(); this.selection.domains.clear();
    this.emit('selection');
  }

  selCount() { return this.selection.nodes.size + this.selection.lines.size + this.selection.domains.size; }

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

function emptyResults() {
  return { mesh: null, static: null, staticOpts: null, modal: null, buckling: null, spectrum: null, steel: null, rc: null, rcBeams: null, timber: null };
}

export function migrate(m) {
  const base = { nodes: [], lines: [], domains: [], materials: [], sections: [], supports: [], loadGroups: [], loadCases: [], loads: [], combinations: [] };
  const model = { ...base, ...m };
  model.version = 1;
  model.meta = { name: 'Modell', author: '', description: '', ...(m.meta || {}) };
  model.settings = { meshSize: 1, beamDivisions: 4, g: 9.81, code: 'EC', ...(m.settings || {}) };
  for (const d of model.domains) d.holes = d.holes || [];
  return model;
}

export const store = new Store();
