// Interactive viewport tools. Every tool that needs a point uses the shared PointInput
// (snaps, X/Y/Z constraints with projection, reference point, typed coordinates).
import { t } from '../i18n.js';
import { h, toast } from './dom.js';
import { addNode, addLine, addDomain, V, P, defaultLineElement, transformSelection, rotatePoint, centroid, intersectLines } from '../core/model.js';
import { domainFrame } from '../mesh/geom.js';
import { PLANES } from './vp-util.js';
import { fmt, fmtNum } from '../core/units.js';
import { PointInput, POINT_KEYS_HINT } from './pointinput.js';
import { surfaceLoadAtDialog } from './dialogs/loads.js';
import { SelectTool, PickTool } from './selection-tools.js';

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
    // relative origin (follows every placed point, Insert moves it to the cursor) and the coordinate window
    // switches: d = relative, locked fields [[field, value]]
    this.relOrigin = [0, 0, 0];
    this.coord = { dCart: true, dPolar: true, locks: [] };
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
    if (!this.cur.pi) this.renderCoords(); // no typing state left in the coordinate window
  }

  // a tool that enters points (the selection request only selects)
  isDrawing() { return !['select', 'orbit', 'pick'].includes(this.id); }
  updateHint() { this.app.setHint(this.cur?.hint?.() || ''); }

  down(e) { this.cur.down?.(e); }
  move(e, dragging) {
    this.lastMouse = e;
    this.cur.move?.(e, dragging);
    // without a point input the coordinate window shows the cursor on the drawing plane
    if (!this.cur.pi) { this.cursor = this.vp.workplanePoint(e.x, e.y, this.relOrigin) || this.cursor; this.renderCoords(); }
  }
  renderCoords() {
    if (this.cur.pi) { this.cur.pi.refresh(); return; }
    if (this.cursor) this.app.coordWin.render({ p: this.cursor, origin: this.relOrigin, plane: this.vp.drawPlane(this.relOrigin).key, flags: this.coord, locks: this.coord.locks });
  }
  up(e, moved) { this.cur.up?.(e, moved); this.updateHint(); }
  context(e) { this.cur.context?.(e); this.updateHint(); }
  dblclick(e) { this.cur.dblclick?.(e); }
  leave() { this.vp.setHover(null); }

  // Keyboard: tool-specific keys first, then the point input, then Esc/Enter fallbacks
  key(e) {
    if (this.cur.key?.(e)) { this.updateHint(); return true; }
    if (this.cur.pi?.key(e)) { this.updateHint(); return true; }
    // relative origin and "d" switches also without a running point input
    if (!this.cur.pi && (e.key === 'Insert' || (e.key === 'Shift' && e.altKey) || (e.key === 'Alt' && e.shiftKey))) {
      if (this.cursor) { this.relOrigin = this.cursor; this.renderCoords(); }
      return true;
    }
    if (!this.cur.pi && e.shiftKey && !e.ctrlKey && !e.altKey && (e.code === 'KeyD' || e.code === 'KeyE')) {
      const k = e.code === 'KeyD' ? 'dCart' : 'dPolar';
      this.coord[k] = !this.coord[k];
      this.renderCoords();
      return true;
    }
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
  typedPoint(text) {
    if (!text.trim()) return;
    if (this.cur.pi) { this.cur.pi.submit(text); this.updateHint(); return; }
    toast(t('Wähle zuerst ein Werkzeug, das einen Punkt erwartet (z.B. Linie oder Verschieben).'), 'info');
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
  // relative origin for the next point (the last placed one)
  refPoint() { return this.lastPoint(); }
  prompt() { return t('Punkt'); }
  newInput() {
    this.pi?.dispose();
    this.pi = new PointInput(this.T, {
      prompt: this.prompt(),
      ref: this.refPoint() || null,
      onCommit: (p, info) => { this.addPoint(p, info); if (this.T.cur === this) { this.newInput(); this.preview(); } },
      onPreview: () => this.preview(),
      onEnterEmpty: this.enterEmpty ? () => this.enterEmpty() : null,
      surface: !!this.surfaceSnap,
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
      this.T.store.commit(this.opts.element ? t('Stab zeichnen') : t('Linie zeichnen'), (m) => { addLine(m, addNode(m, a), addNode(m, p), el); autoIntersect(this.T, m); });
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

// Arc through 3 points, or (opts.centre, AxisVM: Kreisbogen um Mittelpunkt) centre, start point and end angle
class ArcTool extends DrawBase {
  prompt() {
    return (this.opts.centre ? [t('Mittelpunkt'), t('Startpunkt'), t('Endpunkt')] : [t('Startpunkt'), t('Endpunkt'), t('Punkt auf dem Bogen')])[this.pts.length];
  }
  stepHint() {
    const n = this.opts.segments || 8;
    return (this.opts.centre
      ? [t('Mittelpunkt des Bogens'), t('Startpunkt des Bogens (legt den Radius fest)'), t('Endwinkel des Bogens, gegen den Uhrzeigersinn ({n} Segmente)', { n })]
      : [t('Startpunkt des Bogens'), t('Endpunkt des Bogens'), t('Punkt auf dem Bogen ({n} Segmente)', { n })])[this.pts.length] || '';
  }
  // the end angle is measured around the centre
  refPoint() { return this.opts.centre ? this.pts[0] : super.refPoint(); }
  points(a, b, c) { return this.opts.centre ? this.arcAround(a, b, c) : this.arcPoints(a, b, c); }
  arcAround(ctr, a, b) {
    const n = PLANES[this.T.vp.drawPlane(ctr).key].n;
    const d = V.sub(a, ctr), e1v = V.sub(d, V.mul(n, V.dot(d, n)));
    const r = V.len(e1v);
    if (r < 1e-9) return null;
    const e1 = V.mul(e1v, 1 / r), e2 = V.cross(n, e1), q = V.sub(b, ctr);
    let span = Math.atan2(V.dot(q, e2), V.dot(q, e1));
    if (span <= 1e-9) span += 2 * Math.PI;
    const nSeg = this.opts.segments || 8, base = V.add(ctr, V.mul(n, V.dot(d, n)));
    return Array.from({ length: nSeg + 1 }, (_, i) => V.add(base, V.add(V.mul(e1, r * Math.cos(span * i / nSeg)), V.mul(e2, r * Math.sin(span * i / nSeg)))));
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
      const arc = this.points(pts[0], pts[1], c);
      if (arc) for (let i = 0; i < arc.length - 1; i++) segs.push([...arc[i], ...arc[i + 1]]);
    }
    return { segments: segs };
  }
  addPoint(p) {
    this.pts.push(p);
    if (this.pts.length < 3) return;
    const arc = this.points(...this.pts);
    this.pts = [];
    if (!arc) { toast(this.opts.centre ? t('Der Startpunkt liegt im Mittelpunkt.') : t('Die drei Punkte liegen auf einer Geraden.'), 'warn'); return; }
    const el = this.element();
    this.T.store.commit(t('Bogen'), (m) => {
      const ids = arc.map((q) => addNode(m, q));
      for (let i = 0; i < ids.length - 1; i++) addLine(m, ids[i], ids[i + 1], el);
      autoIntersect(this.T, m);
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

// Section line (Schnittlinie): two points on surfaces → result diagram along the line
class SectionTool extends DrawBase {
  get surfaceSnap() { return true; }
  prompt() { return this.pts.length ? t('Endpunkt') : t('Startpunkt'); }
  stepHint() { return this.pts.length ? t('Endpunkt der Schnittlinie wählen (auf der Fläche)') : t('Startpunkt der Schnittlinie auf einer Fläche wählen'); }
  extra() {
    const a = this.lastPoint(), c = this.cur();
    return { segments: a && c ? [[...a, ...c]] : [] };
  }
  addPoint(p) {
    if (!this.pts.length) { this.pts.push(p); return; }
    const a = this.pts[0];
    this.pts = [];
    if (V.len(V.sub(p, a)) < 1e-6) return;
    const st = this.T.store;
    let name;
    st.commit(t('Schnittlinie'), (m) => {
      m.sectionLines = m.sectionLines || [];
      const id = m.sectionLines.reduce((x, s) => Math.max(x, s.id), 0) + 1;
      name = `S${id}`;
      m.sectionLines.push({ id, name, a: [...a], b: [...p], on: true });
    }, { keepResults: true });
    this.T.app.afterSectionLine?.(name);
  }
}

// structural domain (not a load panel) containing point p, or null
function domainAt(model, idx, p) {
  for (const d of model.domains) {
    if (d.type === 'panel') continue;
    if (domainFrame(idx.nodes, d)?.contains(p, { plane: 0.01 + 0.5 * (d.thickness || 0) })) return d.id;
  }
  return null;
}

// Line / point load at free points on a surface (AxisVM: Linienlast / Einzellast auf Fläche)
class SurfaceLoadTool extends DrawBase {
  get surfaceSnap() { return true; }
  line() { return this.opts.mode === 'line'; }
  prompt() { return this.line() ? (this.pts.length ? t('Endpunkt') : t('Startpunkt')) : t('Lastpunkt'); }
  stepHint() {
    if (!this.line()) return t('Punkt der Einzellast auf einer Fläche wählen');
    return this.pts.length ? t('Endpunkt der Linienlast wählen') : t('Startpunkt der Linienlast auf einer Fläche wählen');
  }
  extra() {
    const a = this.lastPoint(), c = this.cur();
    return { segments: this.line() && a && c ? [[...a, ...c]] : [] };
  }
  addPoint(p) {
    const st = this.T.store;
    if (this.line() && !this.pts.length) { this.pts.push(p); return; }
    const a = this.line() ? this.pts[0] : p;
    this.pts = [];
    const mid = this.line() ? V.lerp(a, p, 0.5) : p;
    const domain = domainAt(st.model, st.idx, mid);
    if (!domain) { toast(t('Der Punkt liegt auf keiner Fläche (Platte, Schale, Scheibe).'), 'warn'); return; }
    if (this.line() && V.len(V.sub(p, a)) < 1e-6) return;
    surfaceLoadAtDialog(this.T.app, this.line() ? { mode: 'line', domain, a, b: p } : { mode: 'point', domain, p });
  }
}

function createPolygon(T, pts, opts, element) {
  T.store.commit(opts.domain ? t('Fläche zeichnen') : t('Polygon zeichnen'), (m) => {
    const ids = pts.map((p) => addNode(m, p));
    if (opts.domain === 'panel') {
      // load panel: no stiffness, distributes its surface loads onto the lines in it
      addDomain(m, ids, { type: 'panel', material: null, thickness: 0, panel: { dist: 'two' } });
    } else if (opts.domain) {
      const d = T.app.ensureDrawDefaults('domain', opts.domain);
      addDomain(m, ids, { type: opts.domain, material: d.material, thickness: d.thickness });
      if (element) for (let i = 0; i < ids.length; i++) addLine(m, ids[i], ids[(i + 1) % ids.length], element);
    } else {
      for (let i = 0; i < ids.length; i++) addLine(m, ids[i], ids[(i + 1) % ids.length], element);
    }
    autoIntersect(T, m);
  });
}

// Auto intersection (AxisVM: AutoSchnitt, Ctrl+I): split lines at crossings and at nodes on them
function autoIntersect(T, m) { if (T.store.view.autoIntersect) intersectLines(m, null); }

/* ---------------- geometric transformations (AxisVM: Verschieben, Drehen, Spiegeln, Skalieren) ---------------- */
// After the options dialog (dialogs/transform.js) the defining points are picked in the model:
//   translate  start and end of the vector              rotate  centre, start point, end point (axis ⟂ view)
//   mirror     two points of the mirror plane (⟂ view)   scale   centre, reference point, its new place
// opts: { kind, method, n, d, angle, h, connect: 'none' | 'double' | 'all', connectElement, copyElements, copyLoads }
// Methods: move / detach / resize change the selection; copy makes one copy; incremental n copies, each one
// step further; distribute n copies spread over the step; spread n copies at distance d / angle α;
// consecutive / multiple ask for further steps until Esc. A drag (opts.drag) moves from the grabbed point
// (opts.base) and drops on release.
const PROMPTS = {
  translate: () => [t('Startpunkt des Vektors'), t('Endpunkt des Vektors')],
  rotate: () => [t('Drehpunkt'), t('Startpunkt des Bogens'), t('Endpunkt des Bogens')],
  mirror: () => [t('Erster Punkt der Spiegelebene'), t('Zweiter Punkt der Spiegelebene')],
  scale: () => [t('Zentrum'), t('Bezugspunkt'), t('Neue Lage des Bezugspunkts')],
};
const OP_LABEL = { translate: 'Verschieben', rotate: 'Drehen', mirror: 'Spiegeln', scale: 'Skalieren' };
const copiesOf = (o) => (['move', 'detach', 'resize'].includes(o.method) ? 0 : ['copy', 'consecutive', 'multiple'].includes(o.method) ? 1 : Math.max(1, Math.round(o.n || 1)));
const repeats = (o) => o.method === 'consecutive' || o.method === 'multiple';

class TransformTool {
  constructor(tools, opts) {
    this.T = tools;
    this.store = tools.store;
    this.o = { kind: 'translate', method: 'move', n: 1, d: 1, angle: 90, h: 0, connect: 'none', copyElements: true, copyLoads: true, ...opts };
    this.collect();
    this.pts = opts.base ? [opts.base] : [];
    this.newInput();
  }
  label() { return t(OP_LABEL[this.o.kind]); }
  needed() { return this.o.kind === 'rotate' && this.o.method === 'spread' ? 1 : PROMPTS[this.o.kind]().length; }
  hint() {
    if (this.o.drag) return `${t('{op}: <b>loslassen</b> setzt ab · Fangpunkte und Achsen wie beim Zeichnen · <b>Esc</b> bricht ab', { op: this.label() })} · ${POINT_KEYS_HINT()}`;
    const i = this.pts.length, k = this.o.kind;
    const extra = i === 0 && k !== 'mirror' ? t('<b>Enter</b> = Schwerpunkt der Auswahl')
      : i === 1 && k === 'rotate' ? t('<b>Enter</b> = Winkel α = {a}° aus dem Dialog', { a: this.o.angle }) : '';
    const angle = this.angleNow != null ? ` · <b>α = ${fmtNum(this.angleNow, 2)}°</b>` : '';
    return `${this.label()}: <b>${PROMPTS[k]()[i]}</b>${angle}${extra ? ' · ' + extra : ''} · ${POINT_KEYS_HINT()}`;
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
  newInput() {
    this.pi?.dispose();
    const i = this.pts.length, k = this.o.kind;
    this.pi = new PointInput(this.T, {
      prompt: PROMPTS[k]()[i],
      // rotation and scaling are measured from the centre, the vector from its start
      ref: i ? (k === 'rotate' || k === 'scale' ? this.pts[0] : this.pts[i - 1]) : null,
      planeThroughRef: i > 0,
      onCommit: (p) => this.addPoint(p),
      onPreview: () => this.preview(),
      onEnterEmpty: i === 0 && k !== 'mirror' ? () => this.addPoint(this.centroid())
        : i === 1 && k === 'rotate' ? () => this.apply(this.pts, this.o.angle) : null,
    });
    this.T.updateHint();
  }
  addPoint(p) {
    this.pts.push(p);
    if (this.pts.length < this.needed()) { this.newInput(); this.preview(); return; }
    this.apply(this.pts);
  }
  axis(c) { return PLANES[this.T.vp.drawPlane(c).key].n; }
  rotAngle(pts) {
    const ax = this.axis(pts[0]);
    const proj = (v) => V.sub(v, V.mul(ax, V.dot(v, ax)));
    const v1 = proj(V.sub(pts[1], pts[0])), v2 = proj(V.sub(pts[2], pts[0]));
    if (V.len(v1) < 1e-9 || V.len(v2) < 1e-9) return null;
    return Math.atan2(V.dot(ax, V.cross(v1, v2)), V.dot(v1, v2)) * 180 / Math.PI;
  }
  // point transform xf(p, k) of copy k (k = 1 when moving); angle: rotation from the dialog
  xf(pts, angle = null) {
    const o = this.o, n = Math.max(1, Math.round(o.n || 1));
    const amount = (k) => (o.method === 'distribute' ? k / n : k);
    if (o.kind === 'translate') {
      let v = V.sub(pts[1], pts[0]);
      if (o.method === 'spread') { const L = V.len(v); if (L < 1e-12) return null; v = V.mul(v, o.d / L); }
      return (p, k) => V.add(p, V.mul(v, amount(k)));
    }
    if (o.kind === 'rotate') {
      const c = pts[0], ax = this.axis(c);
      const deg = angle ?? (o.method === 'spread' ? o.angle : this.rotAngle(pts));
      if (deg == null) return null;
      return (p, k) => V.add(rotatePoint(p, c, ax, deg * Math.PI / 180 * amount(k)), V.mul(ax, (o.h || 0) * amount(k)));
    }
    if (o.kind === 'mirror') {
      const m = V.cross(V.sub(pts[1], pts[0]), this.axis(pts[0]));
      if (V.len(m) < 1e-12) return null;
      const u = V.norm(m);
      return (p) => V.sub(p, V.mul(u, 2 * V.dot(V.sub(p, pts[0]), u)));
    }
    // scale: factors from the coordinate ratios of the reference point and its new place
    const c = pts[0], r = V.sub(pts[1], c), q = V.sub(pts[2], c);
    const F = [0, 1, 2].map((i) => (Math.abs(r[i]) > 1e-9 ? q[i] / r[i] : 1));
    const fac = (i, k) => (o.method === 'distribute' ? 1 + (F[i] - 1) * k / n : Math.pow(F[i], k));
    return (p, k) => p.map((x, i) => c[i] + (x - c[i]) * fac(i, k));
  }
  // ghost: lines with moved endpoints transformed by f
  ghost(f) {
    const { idx } = this.store;
    return this.ghostLines.map((l) => {
      const a = P(idx.nodes.get(l.n1)), b = P(idx.nodes.get(l.n2));
      return [...(this.moving.has(l.n1) ? f(a) : a), ...(this.moving.has(l.n2) ? f(b) : b)];
    });
  }
  preview() {
    const d = this.pi.decor(), q = this.pi.cur?.p;
    const pts = q ? [...this.pts, q] : this.pts;
    const segs = [];
    const from = (i) => (this.o.kind === 'rotate' || this.o.kind === 'scale' ? pts[0] : pts[i - 1]);
    for (let i = 1; i < pts.length; i++) segs.push([...from(i), ...pts[i]]);
    let ghost = [];
    this.angleNow = this.o.kind === 'rotate' && pts.length === 3 ? this.rotAngle(pts) : null;
    const xf = pts.length >= this.needed() ? this.xf(pts) : null;
    if (xf) for (let k = 1; k <= Math.min(Math.max(1, copiesOf(this.o)), 50); k++) ghost.push(...this.ghost((p) => xf(p, k)));
    this.T.vp.setToolPreview({ ghost, segments: segs, axes: d.axes, guides: d.guides, snap: d.snap, points: [...this.pts, ...d.points] });
    this.T.updateHint();
  }
  apply(pts, angle = null) {
    const o = this.o, xf = this.xf(pts, angle);
    if (!xf) { toast(t('Die Punkte legen keine Transformation fest.'), 'warn'); this.pts = []; this.newInput(); return; }
    const copies = copiesOf(o), sel = this.store.selection;
    let el = null;
    if (copies && o.connect !== 'none' && o.connectElement) {
      const dd = this.T.app.ensureDrawDefaults(o.connectElement);
      el = defaultLineElement(o.connectElement, dd.material, dd.section);
    }
    this.store.commit(this.label(), (m) => transformSelection(m, sel, xf, {
      copies, connect: copies > 0 && o.connect !== 'none', connectNodes: o.connect === 'double' ? new Set(sel.dbl) : null, connectElement: el,
      copyElements: o.copyElements, copySupports: o.copyElements, copyLoads: o.copyLoads, detach: o.method === 'detach',
    }));
    if (copies) toast(t('{n} Kopie(n) erstellt', { n: copies }), 'ok', 1800);
    if (repeats(o)) { this.collect(); this.pts = []; this.newInput(); this.preview(); return; }
    this.T.set('select');
  }
  move(e) { this.pi.move(e); }
  up(e, moved) {
    if (this.o.drag && !this.released) {
      // drop on release – unless coordinates are being typed: then Enter or a click drops
      this.released = true;
      if (this.pi.edit || this.pi.typed) return;
      const q = this.pi.cur?.p;
      if (q && V.dist(q, this.pts[0]) > 1e-12) this.addPoint(q); else this.T.set('select');
      return;
    }
    if (!moved) this.pi.click(e);
  }
  context() { if (!this.escape()) this.T.set('select'); }
  // Esc goes back one point (AxisVM: one level up), a drag is cancelled
  escape() {
    if (this.o.drag || !this.pts.length) { if (this.o.drag) this.T.set('select'); return !!this.o.drag; }
    this.pts.pop();
    this.newInput();
    this.preview();
    return true;
  }
  cancel() { this.pi?.dispose(); }
}

const TOOLS = {
  select: SelectTool, pick: PickTool, orbit: OrbitTool, node: NodeTool, line: LineTool, rect: RectTool, polygon: PolygonTool, arc: ArcTool, measure: MeasureTool, section: SectionTool, surfaceLoad: SurfaceLoadTool,
  transform: TransformTool,
};
