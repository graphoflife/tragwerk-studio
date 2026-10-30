// Interactive viewport tools. Every tool that needs a point uses the shared PointInput
// (snaps, X/Y/Z constraints with projection, reference point, typed coordinates).
import { t } from '../i18n.js';
import { h, toast } from './dom.js';
import { addNode, addLine, addDomain, V, P, defaultLineElement, transformSelection, rotatePoint, centroid } from '../core/model.js';
import { PLANES } from './viewport.js';
import { fmt } from '../core/units.js';
import { PointInput, POINT_KEYS_HINT } from './pointinput.js';

export class Tools {
  constructor(app) {
    this.app = app;
    this.vp = app.vp;
    this.store = app.store;
    this.vp.handler = this;
    this.selbox = h('div.selbox');
    this.selbox.style.display = 'none';
    this.vp.el.appendChild(this.selbox);
    this.hud = h('div.pi-hud');
    this.hud.style.display = 'none';
    this.vp.el.appendChild(this.hud);
    this.lastPoint = null;
    this.set('select');
  }

  set(id, opts = {}) {
    this.cur?.cancel?.();
    this.cur?.pi?.dispose?.();
    this.hud.style.display = 'none';
    this.selbox.style.display = 'none';
    this.vp.setToolPreview();
    this.vp.setHover(null);
    const Ctor = TOOLS[id] || TOOLS.select;
    this.id = id;
    this.opts = opts;
    this.cur = new Ctor(this, opts);
    this.vp.leftOrbit = id === 'orbit';
    this.vp.canvas.style.cursor = id === 'select' ? 'default' : id === 'orbit' ? 'grab' : 'crosshair';
    this.store.emit('tool', { id, opts });
    this.updateHint();
  }

  isDrawing() { return this.id !== 'select' && this.id !== 'orbit'; }
  updateHint() { this.app.setHint(this.cur?.hint?.() || ''); }

  down(e) { this.cur.down?.(e); }
  move(e, dragging) {
    const p = this.vp.workplanePoint(e.x, e.y);
    if (p) this.app.setCoords(p);
    this.cur.move?.(e, dragging);
  }
  up(e, moved) { this.cur.up?.(e, moved); this.updateHint(); }
  context(e) { this.cur.context?.(e); this.updateHint(); }
  dblclick(e) { this.cur.dblclick?.(e); }
  leave() { this.vp.setHover(null); }

  // Keyboard: tool-specific keys first, then the point input, then Esc/Enter fallbacks
  key(e) {
    if (this.cur.key?.(e)) { this.updateHint(); return true; }
    if (this.cur.pi?.key(e)) { this.updateHint(); return true; }
    if (e.key === 'Escape') {
      if (this.cur.escape?.()) { this.updateHint(); return true; }
      if (this.id !== 'select') { this.set('select'); return true; }
      if (this.store.selCount()) { this.store.clearSelection(); return true; }
      return false;
    }
    if (e.key === 'Enter' && this.cur.enter) { this.cur.enter(); this.updateHint(); return true; }
    return false;
  }

  // typed coordinates from the status bar input
  coord(text) {
    if (!text.trim()) return;
    if (this.cur.pi) { this.cur.pi.submit(text); this.updateHint(); return; }
    toast(t('Wähle zuerst ein Werkzeug, das einen Punkt erwartet (z.B. Linie oder Verschieben).'), 'info');
  }
}

/* ---------------- selection ---------------- */
class SelectTool {
  constructor(tools) { this.T = tools; this.start = null; }
  hint() {
    const n = this.T.store.selCount();
    if (n && this.T.store.geoCount()) return t('<b>{n}</b> Objekte ausgewählt · <b>V</b> verschieben · <b>K</b> kopieren · <b>D</b> drehen · <b>Entf</b> löschen · <b>Rechtsklick</b> Menü', { n });
    if (n) return t('<b>{n}</b> Lager/Lasten ausgewählt · Werte rechts bearbeiten · <b>Entf</b> löschen', { n });
    return t('<b>Klicken</b> zum Auswählen · <b>Ziehen</b> für Rechteckauswahl (→ Fenster, ← Kreuzen) · <b>Rechts ziehen</b> drehen · <b>Mitte ziehen</b> verschieben · <b>Mausrad</b> zoomen');
  }
  down(e) { this.start = e; }
  move(e, dragging) {
    const T = this.T;
    if (dragging && this.start) {
      const dx = e.x - this.start.x, dy = e.y - this.start.y;
      if (Math.hypot(dx, dy) > 4) {
        const b = T.selbox;
        b.style.display = 'block';
        b.style.left = Math.min(e.x, this.start.x) + 'px';
        b.style.top = Math.min(e.y, this.start.y) + 'px';
        b.style.width = Math.abs(dx) + 'px';
        b.style.height = Math.abs(dy) + 'px';
        b.classList.toggle('crossing', dx < 0);
      }
      return;
    }
    const hit = T.vp.pick(e.x, e.y, T.store.view.selFilter);
    T.vp.setHover(hit);
    T.vp.canvas.style.cursor = hit ? 'pointer' : (T.id === 'select' ? 'default' : 'crosshair');
    T.app.showHoverInfo?.(hit, e);
  }
  up(e, moved) {
    const T = this.T, st = T.store;
    const mode = e.shift ? 'add' : e.ctrl ? 'toggle' : 'replace';
    if (moved && this.start) {
      T.selbox.style.display = 'none';
      const crossing = e.x < this.start.x;
      const sel = T.vp.boxSelect(this.start.x, this.start.y, e.x, e.y, crossing, st.view.selFilter);
      st.select(sel, e.ctrl ? 'remove' : mode === 'replace' ? 'replace' : 'add');
    } else {
      const hit = T.vp.pick(e.x, e.y, st.view.selFilter);
      if (hit) st.select({ [hit.kind + 's']: [hit.id] }, mode);
      else if (mode === 'replace') st.clearSelection();
    }
    this.start = null;
  }
  context(e) {
    const T = this.T, st = T.store;
    const hit = T.vp.pick(e.x, e.y, st.view.selFilter);
    if (hit && !st.selection[hit.kind + 's'].has(hit.id)) st.select({ [hit.kind + 's']: [hit.id] }, 'replace');
    T.app.openContextMenu({ x: e.cx, y: e.cy }, hit);
  }
  dblclick(e) {
    const hit = this.T.vp.pick(e.x, e.y, this.T.store.view.selFilter);
    if (this.T.app.openResultDetail?.(hit)) return;
    if (hit) { this.T.store.select({ [hit.kind + 's']: [hit.id] }, 'replace'); this.T.app.showSide('props'); }
  }
}

class OrbitTool {
  constructor(tools) { this.T = tools; }
  hint() { return t('<b>Ziehen</b> dreht die Ansicht · <b>Shift+Ziehen</b> verschiebt · <b>Mausrad</b> zoomt · <b>Esc</b> zurück zur Auswahl'); }
}

/* ---------------- drawing tools ---------------- */
class DrawBase {
  constructor(tools, opts) {
    this.T = tools;
    this.opts = opts;
    this.pts = [];
    this.newInput();
  }
  lastPoint() { return this.pts[this.pts.length - 1]; }
  prompt() { return t('Punkt'); }
  newInput() {
    this.pi?.dispose();
    this.pi = new PointInput(this.T, {
      prompt: this.prompt(),
      ref: this.lastPoint() || this.T.lastPoint || null,
      relative: this.pts.length > 0,
      onCommit: (p, info) => { this.addPoint(p, info); this.T.lastPoint = p; if (this.T.cur === this) { this.newInput(); this.preview(); } },
      onPreview: () => this.preview(),
      onEnterEmpty: this.enterEmpty ? () => this.enterEmpty() : null,
    });
  }
  hint() { return `${this.stepHint()} · ${POINT_KEYS_HINT()}`; }
  stepHint() { return ''; }
  move(e) { this.pi.move(e); }
  up(e, moved) { if (!moved) this.pi.click(e); }
  cur() { return this.pi.cur?.p || null; }
  extra() { return {}; }
  preview() {
    const d = this.pi.decor();
    const x = this.extra();
    this.T.vp.setToolPreview({ ...x, axes: d.axes, guides: d.guides, snap: d.snap, points: [...this.pts, ...(x.points || []), ...d.points] });
    this.T.updateHint();
  }
  escape() {
    if (!this.pts.length) return false;
    this.pts = [];
    this.newInput();
    this.preview();
    return true;
  }
  context() { if (!this.escape()) this.T.set('select'); }
  element() {
    const o = this.opts;
    if (!o.element) return null;
    const d = this.T.app.ensureDrawDefaults(o.element);
    return defaultLineElement(o.element, d.material, d.section);
  }
  cancel() { this.pi?.dispose(); }
}

class NodeTool extends DrawBase {
  prompt() { return t('Knoten setzen'); }
  stepHint() { return t('<b>Klicken</b> oder Koordinaten tippen setzt einen Knoten'); }
  addPoint(p) { this.T.store.commit(t('Knoten'), (m) => addNode(m, p)); }
}

class LineTool extends DrawBase {
  prompt() { return this.pts.length ? t('Endpunkt') : t('Startpunkt'); }
  stepHint() {
    const what = this.opts.element ? t('Stab') : t('Linie');
    return this.pts.length ? t('Endpunkt ({what}) · <b>Rechtsklick/Esc</b> Kette beenden', { what }) : t('Startpunkt ({what})', { what });
  }
  extra() {
    const a = this.lastPoint(), c = this.cur();
    return { segments: a && c ? [[...a, ...c]] : [] };
  }
  addPoint(p) {
    const a = this.lastPoint();
    if (a) {
      if (V.dist(a, p) < 1e-9) return;
      const el = this.element();
      this.T.store.commit(this.opts.element ? t('Stab zeichnen') : t('Linie zeichnen'), (m) => addLine(m, addNode(m, a), addNode(m, p), el));
      this.pts = [p];
    } else this.pts.push(p);
  }
}

class RectTool extends DrawBase {
  prompt() { return this.pts.length ? t('Gegenüberliegende Ecke') : t('Erste Ecke'); }
  stepHint() {
    const d = this.opts.domain ? t('Fläche') : t('Rechteck');
    return this.pts.length ? t('Gegenüberliegende Ecke ({d}) · z.B. <b>6 4</b> tippen für 6 × 4', { d }) : t('Erste Ecke ({d}) auf der Arbeitsebene', { d });
  }
  corners(a, b) {
    const wp = this.T.store.view.workplane, pl = PLANES[wp.plane];
    const [u0, v0] = pl.unmap(a), [u1, v1] = pl.unmap(b);
    const off = V.dot(a, pl.n);
    return [pl.map(u0, v0, off), pl.map(u1, v0, off), pl.map(u1, v1, off), pl.map(u0, v1, off)];
  }
  extra() {
    const a = this.lastPoint(), c = this.cur();
    if (!a || !c) return {};
    const cs = this.corners(a, c);
    return { segments: cs.map((p, i) => [...p, ...cs[(i + 1) % 4]]), polys: this.opts.domain ? [cs] : [] };
  }
  addPoint(p) {
    const a = this.lastPoint();
    if (!a) { this.pts.push(p); return; }
    const c = this.corners(a, p);
    if (V.dist(c[0], c[1]) < 1e-9 || V.dist(c[1], c[2]) < 1e-9) { toast(t('Rechteck hat keine Fläche.'), 'warn'); return; }
    createPolygon(this.T, c, this.opts, this.element());
    this.pts = [];
  }
}

class PolygonTool extends DrawBase {
  prompt() { return t('Eckpunkt {n}', { n: this.pts.length + 1 }); }
  stepHint() {
    return this.pts.length < 3 ? t('Eckpunkt {n} setzen', { n: this.pts.length + 1 }) : t('Weitere Ecke · <b>Enter</b>, <b>Rechtsklick</b> oder Klick auf den ersten Punkt schliesst');
  }
  extra() {
    const pts = this.pts, c = this.cur();
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push([...pts[i], ...pts[i + 1]]);
    if (c && pts.length) segs.push([...pts[pts.length - 1], ...c]);
    if (c && pts.length > 1) segs.push([...c, ...pts[0]]);
    return { segments: segs, polys: this.opts.domain && c ? [[...pts, c]] : [] };
  }
  addPoint(p) {
    if (this.pts.length >= 3 && V.dist(p, this.pts[0]) < 1e-9) { this.close(); return; }
    if (this.pts.some((x) => V.dist(x, p) < 1e-9)) return;
    this.pts.push(p);
  }
  enterEmpty() { this.close(); this.newInput(); this.preview(); }
  close() {
    if (this.pts.length < 3) return;
    createPolygon(this.T, this.pts, this.opts, this.element());
    this.pts = [];
  }
  context() { if (this.pts.length >= 3) { this.close(); this.newInput(); this.preview(); } else if (!this.escape()) this.T.set('select'); }
}

class ArcTool extends DrawBase {
  prompt() { return [t('Startpunkt'), t('Endpunkt'), t('Punkt auf dem Bogen')][this.pts.length]; }
  stepHint() {
    return [t('Startpunkt des Bogens'), t('Endpunkt des Bogens'), t('Punkt auf dem Bogen ({n} Segmente)', { n: this.opts.segments || 8 })][this.pts.length] || '';
  }
  arcPoints(a, b, c) {
    const ab = V.sub(b, a), ac = V.sub(c, a);
    const n = V.cross(ab, ac);
    const nn = V.dot(n, n);
    if (nn < 1e-14) return null;
    const ctr = V.add(a, V.mul(V.add(V.mul(V.cross(n, ab), V.dot(ac, ac)), V.mul(V.cross(ac, n), V.dot(ab, ab))), 1 / (2 * nn)));
    const r = V.dist(ctr, a);
    const e1 = V.norm(V.sub(a, ctr)), nz = V.norm(n), e2 = V.cross(nz, e1);
    const ang = (p) => { const d = V.sub(p, ctr); let x = Math.atan2(V.dot(d, e2), V.dot(d, e1)); if (x < 0) x += 2 * Math.PI; return x; };
    const ab2 = ang(b), ac2 = ang(c);
    const span = ac2 > ab2 ? ab2 - 2 * Math.PI : ab2;
    const nSeg = this.opts.segments || 8;
    const out = [];
    for (let i = 0; i <= nSeg; i++) {
      const th = span * i / nSeg;
      out.push(V.add(ctr, V.add(V.mul(e1, r * Math.cos(th)), V.mul(e2, r * Math.sin(th)))));
    }
    return out;
  }
  extra() {
    const pts = this.pts, c = this.cur();
    const segs = [];
    if (pts.length === 1 && c) segs.push([...pts[0], ...c]);
    if (pts.length === 2 && c) {
      const arc = this.arcPoints(pts[0], pts[1], c);
      if (arc) for (let i = 0; i < arc.length - 1; i++) segs.push([...arc[i], ...arc[i + 1]]);
    }
    return { segments: segs };
  }
  addPoint(p) {
    this.pts.push(p);
    if (this.pts.length < 3) return;
    const arc = this.arcPoints(...this.pts);
    this.pts = [];
    if (!arc) { toast(t('Die drei Punkte liegen auf einer Geraden.'), 'warn'); return; }
    const el = this.element();
    this.T.store.commit(t('Bogen'), (m) => {
      const ids = arc.map((q) => addNode(m, q));
      for (let i = 0; i < ids.length - 1; i++) addLine(m, ids[i], ids[i + 1], el);
    });
  }
}

class MeasureTool extends DrawBase {
  prompt() { return this.pts.length ? t('Zweiter Punkt') : t('Erster Punkt'); }
  stepHint() { return this.result || (this.pts.length ? t('Zweiten Messpunkt wählen') : t('Ersten Messpunkt wählen')); }
  extra() {
    const a = this.lastPoint(), c = this.cur();
    return { segments: a && c ? [[...a, ...c]] : [] };
  }
  addPoint(p) {
    if (!this.pts.length) { this.pts.push(p); this.result = null; return; }
    const a = this.pts[0], d = V.sub(p, a);
    this.result = t('Gemessen: <b>{d}</b> · ΔX {x} · ΔY {y} · ΔZ {z}', { d: fmt('len', V.len(d)), x: fmt('len', d[0]), y: fmt('len', d[1]), z: fmt('len', d[2]) });
    toast(t('Abstand {d}', { d: fmt('len', V.len(d)) }), 'info');
    this.pts = [];
  }
}

function createPolygon(T, pts, opts, element) {
  T.store.commit(opts.domain ? t('Fläche zeichnen') : t('Polygon zeichnen'), (m) => {
    const ids = pts.map((p) => addNode(m, p));
    if (opts.domain) {
      const d = T.app.ensureDrawDefaults('domain', opts.domain);
      addDomain(m, ids, { type: opts.domain, material: d.material, thickness: d.thickness });
      if (element) for (let i = 0; i < ids.length; i++) addLine(m, ids[i], ids[(i + 1) % ids.length], element);
    } else {
      for (let i = 0; i < ids.length; i++) addLine(m, ids[i], ids[(i + 1) % ids.length], element);
    }
  });
}

/* ---------------- interactive transformations ---------------- */
// Shared flow: (select objects) → base point → target point, with a live ghost of the result.
class TransformBase {
  constructor(tools, opts) {
    this.T = tools;
    this.store = tools.store;
    this.opts = opts;
    if (this.store.geoCount()) this.startBase();
    else { this.phase = 'select'; this.sel = new SelectTool(tools); }
  }
  label() { return ''; }
  hint() {
    if (this.phase === 'select') return t('{op}: Objekte wählen, dann <b>Enter</b> oder <b>Rechtsklick</b>', { op: this.label() });
    return `${this.stepHint()} · ${POINT_KEYS_HINT()}`;
  }
  stepHint() {
    return this.phase === 'base'
      ? t('{op}: <b>Basispunkt</b> wählen · <b>Enter</b> = Schwerpunkt der Auswahl', { op: this.label() })
      : t('{op}: <b>Zielpunkt</b> wählen oder Verschiebung tippen', { op: this.label() });
  }
  // nodes moved by the operation and the line segments to draw as ghost
  collect() {
    const { selection: s, idx, model } = this.store;
    const ids = new Set(s.nodes);
    for (const id of s.lines) { const l = idx.lines.get(id); ids.add(l.n1); ids.add(l.n2); }
    for (const id of s.domains) { const d = idx.domains.get(id); d.nodes.forEach((n) => ids.add(n)); (d.holes || []).forEach((hh) => hh.forEach((n) => ids.add(n))); }
    this.moving = ids;
    this.ghostLines = model.lines.filter((l) => ids.has(l.n1) || ids.has(l.n2));
    this.pts0 = [...ids].map((id) => P(idx.nodes.get(id)));
  }
  centroid() { return centroid(this.pts0).map((c) => Math.round(c * 1e6) / 1e6); }
  startBase() {
    this.collect();
    this.phase = 'base';
    this.base = null;
    this.pi?.dispose();
    this.pi = new PointInput(this.T, {
      prompt: t('Basispunkt'), ref: null, relative: false,
      onCommit: (p) => this.setBase(p), onPreview: () => this.preview(), onEnterEmpty: () => this.setBase(this.centroid()),
    });
    this.T.updateHint();
  }
  setBase(p) {
    this.base = p;
    this.phase = 'target';
    this.pi?.dispose();
    this.pi = new PointInput(this.T, {
      prompt: this.targetPrompt(), ref: p, relative: true, allowCopies: true,
      onCommit: (q, info) => this.apply(q, info), onPreview: () => this.preview(),
    });
    this.T.updateHint();
    this.preview();
  }
  targetPrompt() { return t('Zielpunkt'); }
  // ghost: lines with moved endpoints transformed by xf
  ghost(xf) {
    if (!xf) return [];
    const { idx } = this.store;
    return this.ghostLines.map((l) => {
      const a = P(idx.nodes.get(l.n1)), b = P(idx.nodes.get(l.n2));
      return [...(this.moving.has(l.n1) ? xf(a) : a), ...(this.moving.has(l.n2) ? xf(b) : b)];
    });
  }
  currentXf() {
    const q = this.pi?.cur?.p;
    if (this.phase !== 'target' || !q) return null;
    const d = V.sub(q, this.base);
    return (p) => V.add(p, d);
  }
  preview() {
    const d = this.pi.decor();
    const q = this.pi.cur?.p;
    const segs = this.phase === 'target' && q ? [[...this.base, ...q]] : [];
    // typed "*n" previews every copy
    let ghost = this.ghost(this.currentXf());
    const n = this.phase === 'target' && q ? (this.pi.cur?.copies || 1) : 1;
    if (n > 1) {
      const dv = V.sub(q, this.base);
      ghost = [];
      for (let k = 1; k <= Math.min(n, 50); k++) ghost.push(...this.ghost((p) => V.add(p, V.mul(dv, k))));
    }
    this.T.vp.setToolPreview({ ghost, segments: segs, axes: d.axes, guides: d.guides, snap: d.snap, points: d.points });
    this.T.updateHint();
  }
  // selection phase delegates to the select tool
  down(e) { if (this.phase === 'select') this.sel.down(e); }
  move(e, dragging) { if (this.phase === 'select') this.sel.move(e, dragging); else this.pi.move(e); }
  up(e, moved) { if (this.phase === 'select') this.sel.up(e, moved); else if (!moved) this.pi.click(e); }
  enter() { if (this.phase === 'select' && this.store.geoCount()) this.startBase(); }
  context(e) {
    if (this.phase === 'select') { if (this.store.geoCount()) this.startBase(); else this.T.set('select'); return; }
    if (!this.escape()) this.T.set('select');
    void e;
  }
  escape() {
    if (this.phase === 'target') { this.startBase(); this.preview(); return true; }
    return false;
  }
  translate(m, d, copies) {
    return transformSelection(m, this.store.selection, (p, k) => V.add(p, V.mul(d, k)), { copies });
  }
  cancel() { this.pi?.dispose(); }
}

class MoveTool extends TransformBase {
  label() { return t('Verschieben'); }
  apply(q) {
    const d = V.sub(q, this.base);
    if (V.len(d) < 1e-12) return;
    this.store.commit(t('Verschieben'), (m) => this.translate(m, d, 0));
    toast(t('Verschoben um {d}', { d: fmt('len', V.len(d)) }), 'ok', 1800);
    this.T.set('select');
  }
}

class CopyTool extends TransformBase {
  label() { return t('Kopieren'); }
  targetPrompt() { return t('Zielpunkt der Kopie'); }
  stepHint() {
    return this.phase === 'target'
      ? t('Kopieren: <b>Zielpunkt</b> · mehrfach klicken für weitere Kopien · <b>dx dy dz *n</b> für n Kopien · <b>Esc</b> beendet')
      : super.stepHint();
  }
  apply(q, info) {
    const d = V.sub(q, this.base);
    if (V.len(d) < 1e-12) return;
    const n = info.copies || 1;
    let newSel;
    this.store.commit(t('Kopieren'), (m) => { newSel = this.translate(m, d, n); });
    this.count = (this.count || 0) + n;
    toast(t('{n} Kopie(n) erstellt · weiter klicken oder Esc', { n: this.count }), 'ok', 1800);
    void newSel;
    // stay in target phase for further copies (from the same base point)
    this.collect();
    this.setBase(this.base);
  }
  escape() { if (this.phase === 'target' && this.count) { this.T.set('select'); return true; } return super.escape(); }
}

class RotateTool extends TransformBase {
  label() { return t('Drehen'); }
  constructor(tools, opts) {
    const wp = tools.store.view.workplane.plane;
    super(tools, opts);
    this.axisKey = { XY: 'Z', XZ: 'Y', YZ: 'X' }[wp];
  }
  get axis() { return { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[this.axisKey || 'Z']; }
  stepHint() {
    const ax = t('Drehachse <b>{a}</b> (Alt+X/Y/Z)', { a: this.axisKey || 'Z' });
    if (this.phase === 'base') return t('Drehen: <b>Drehpunkt</b> wählen · {ax}', { ax });
    if (this.phase === 'target' && !this.refDir) return t('Drehen: <b>Winkel tippen</b> (z.B. 90) oder Referenzrichtung klicken · {ax}', { ax });
    return t('Drehen: <b>Zielrichtung</b> klicken oder Winkel tippen · <b>Shift</b> 15°-Schritte · {ax}', { ax });
  }
  key(e) {
    // Alt+X/Y/Z selects the rotation axis (plain X/Y/Z stay point constraints)
    if (e.altKey && /^Key[XYZ]$/.test(e.code)) { this.axisKey = e.code.slice(3); this.preview(); return true; }
    if (this.phase === 'target' && this.pi && !this.pi.constraint && /^[0-9.\-]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      this.angleText = (this.angleText || '') + e.key;
      this.preview();
      return true;
    }
    if (this.angleText) {
      if (e.key === 'Backspace') { this.angleText = this.angleText.slice(0, -1); this.preview(); return true; }
      if (e.key === ' ' || e.key === '*') { this.angleText += e.key; this.preview(); return true; }
      if (e.key === 'Enter') { this.applyAngle(); return true; }
      if (e.key === 'Escape') { this.angleText = ''; this.preview(); return true; }
    }
    return false;
  }
  parseAngle() {
    const m = String(this.angleText || '').trim().match(/^(-?[\d.,]+)\s*(?:\*\s*(\d+))?$/);
    if (!m) return null;
    return { deg: parseFloat(m[1].replace(',', '.')), copies: m[2] ? parseInt(m[2], 10) : 0 };
  }
  angleFromPoint(q, snapStep) {
    if (!q || !this.refDir) return null;
    const a = this.axis;
    const proj = (v) => V.sub(v, V.mul(a, V.dot(v, a)));
    const v1 = proj(this.refDir), v2 = proj(V.sub(q, this.base));
    if (V.len(v1) < 1e-9 || V.len(v2) < 1e-9) return null;
    let deg = Math.atan2(V.dot(a, V.cross(v1, v2)), V.dot(v1, v2)) * 180 / Math.PI;
    if (snapStep) deg = Math.round(deg / snapStep) * snapStep;
    return deg;
  }
  currentAngle() {
    const pa = this.parseAngle();
    if (pa) return pa.deg;
    return this.angleFromPoint(this.pi?.cur?.p, this.pi?.mouse?.shift ? 15 : 0);
  }
  currentXf() {
    if (this.phase !== 'target') return null;
    const deg = this.currentAngle();
    if (deg == null) return null;
    return (p) => rotatePoint(p, this.base, this.axis, deg * Math.PI / 180);
  }
  preview() {
    super.preview();
    if (this.phase !== 'target') return;
    const deg = this.currentAngle();
    const L = (this.T.vp.bounds?.size || 10) * 3;
    const axes = [{ a: V.sub(this.base, V.mul(this.axis, L)), b: V.add(this.base, V.mul(this.axis, L)), color: this.T.vp.C[`axis${this.axisKey || 'Z'}`] }];
    const d = this.pi.decor();
    const segs = [];
    if (this.refDir) segs.push([...this.base, ...V.add(this.base, this.refDir)]);
    if (this.pi.cur?.p && !this.angleText) segs.push([...this.base, ...this.pi.cur.p]);
    this.T.vp.setToolPreview({ ghost: this.ghost(this.currentXf()), segments: segs, axes: [...axes, ...d.axes], guides: d.guides, snap: d.snap, points: d.points });
    if (deg != null) this.T.app.setHint(`${this.stepHint()} · <b>${t('Winkel')} ${(Math.round(deg * 100) / 100)}°</b>${this.angleText ? ` · ${t('Enter bestätigt')}` : ''}`);
  }
  apply(q, info) {
    if (!this.refDir) {
      // first click in the target phase defines the reference direction
      const d = V.sub(q, this.base);
      if (V.len(d) < 1e-9) return;
      this.refDir = d;
      this.pi.cur = null;
      this.preview();
      return;
    }
    const deg = this.angleFromPoint(q, this.pi.mouse?.shift ? 15 : 0);
    if (deg == null) return;
    this.rotate(deg, info.copies > 1 ? info.copies : 0);
  }
  applyAngle() {
    const pa = this.parseAngle();
    if (!pa) { toast(t('Winkel in Grad eingeben, z.B. 90 oder 30 *11 für 11 Kopien'), 'warn'); return; }
    this.rotate(pa.deg, pa.copies);
  }
  rotate(deg, copies) {
    const ang = deg * Math.PI / 180;
    this.store.commit(t('Drehen'), (m) => transformSelection(m, this.store.selection, (p, k) => rotatePoint(p, this.base, this.axis, ang * k), { copies }));
    toast(copies ? t('{n} gedrehte Kopien erstellt ({d}°)', { n: copies, d: deg }) : t('Gedreht um {d}°', { d: deg }), 'ok', 1800);
    this.T.set('select');
  }
  escape() {
    if (this.angleText) { this.angleText = ''; this.preview(); return true; }
    if (this.refDir) { this.refDir = null; this.preview(); return true; }
    return super.escape();
  }
}

const TOOLS = {
  select: SelectTool, orbit: OrbitTool, node: NodeTool, line: LineTool, rect: RectTool, polygon: PolygonTool, arc: ArcTool, measure: MeasureTool,
  move: MoveTool, copy: CopyTool, rotate: RotateTool,
};
