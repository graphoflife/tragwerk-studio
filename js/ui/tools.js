// Interactive viewport tools: selection, drawing (node/line/rect/polygon/arc), measuring.
import { t } from '../i18n.js';
import { h, toast } from './dom.js';
import { addNode, addLine, addDomain, V, defaultLineElement } from '../core/model.js';
import { PLANES } from './viewport.js';
import { fmt } from '../core/units.js';

export class Tools {
  constructor(app) {
    this.app = app;
    this.vp = app.vp;
    this.store = app.store;
    this.vp.handler = this;
    this.selbox = h('div.selbox');
    this.selbox.style.display = 'none';
    this.vp.el.appendChild(this.selbox);
    this.lastPoint = null;
    this.set('select');
  }

  set(id, opts = {}) {
    this.cur?.cancel?.();
    this.vp.setToolPreview();
    this.vp.setHover(null);
    const Ctor = TOOLS[id] || TOOLS.select;
    this.cur = new Ctor(this, opts);
    this.id = id;
    this.opts = opts;
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
  context(e) {
    if (this.cur.context) { this.cur.context(e); this.updateHint(); return; }
  }
  dblclick(e) { this.cur.dblclick?.(e); }
  leave() { this.vp.setHover(null); }

  key(e) {
    if (e.key === 'Escape') {
      if (this.cur.escape && this.cur.escape()) { this.updateHint(); return true; }
      if (this.id !== 'select') { this.set('select'); return true; }
      if (this.store.selCount()) { this.store.clearSelection(); return true; }
      return false;
    }
    if (e.key === 'Enter' && this.cur.enter) { this.cur.enter(); this.updateHint(); return true; }
    return false;
  }

  // typed coordinates from the status bar: "x y z", "@dx dy dz", "u v" (workplane)
  coord(text) {
    const s = text.trim();
    if (!s) return;
    const rel = s.startsWith('@');
    const nums = s.replace('@', '').split(/[\s,;]+/).filter(Boolean).map((x) => Number(x.replace(',', '.')));
    if (nums.some((x) => !Number.isFinite(x)) || nums.length < 2) { toast(t('Ungültige Koordinaten. Beispiel: 5 0 3 oder @2 0 0'), 'warn'); return; }
    let p;
    const wp = this.store.view.workplane;
    if (nums.length === 2) p = rel ? null : PLANES[wp.plane].map(nums[0], nums[1], wp.offset);
    else p = nums.slice(0, 3);
    if (rel) {
      const base = this.cur.lastPoint?.() || this.lastPoint || [0, 0, 0];
      const d = nums.length === 2 ? PLANES[wp.plane].map(nums[0], nums[1], 0) : nums;
      p = V.add(base, d);
    }
    if (this.cur.coord) { this.cur.coord(p); this.updateHint(); } else toast(t('Wähle zuerst ein Zeichenwerkzeug (z.B. Linie).'), 'info');
  }

  snapAt(e, from) { return this.vp.snap(e.x, e.y, { from, ortho: e.shift }); }
}

/* ---------------- selection ---------------- */
class SelectTool {
  constructor(tools) { this.T = tools; this.start = null; }
  hint() {
    const n = this.T.store.selCount();
    if (n) return t('<b>{n}</b> Objekte ausgewählt · <b>Entf</b> löschen · <b>Rechtsklick</b> Kontextmenü · <b>Esc</b> aufheben', { n });
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
    T.vp.canvas.style.cursor = hit ? 'pointer' : 'default';
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
    if (hit) { this.T.store.select({ [hit.kind + 's']: [hit.id] }, 'replace'); this.T.app.showSide('props'); }
  }
  escape() { return false; }
}

class OrbitTool {
  constructor(tools) { this.T = tools; }
  hint() { return t('<b>Ziehen</b> dreht die Ansicht · <b>Shift+Ziehen</b> verschiebt · <b>Mausrad</b> zoomt · <b>Esc</b> zurück zur Auswahl'); }
}

/* ---------------- drawing tools ---------------- */
class DrawBase {
  constructor(tools, opts) { this.T = tools; this.opts = opts; this.pts = []; this.snapPt = null; }
  lastPoint() { return this.pts[this.pts.length - 1]?.p; }
  move(e) {
    this.snapPt = this.T.snapAt(e, this.lastPoint());
    this.preview();
  }
  up(e, moved) { if (moved) return; const s = this.T.snapAt(e, this.lastPoint()); if (s) this.click(s); }
  coord(p) { this.click({ p, kind: 'typed' }); }
  preview() {}
  escape() { if (this.pts.length) { this.pts = []; this.T.vp.setToolPreview({ snap: this.snapPt }); return true; } return false; }
  context() { if (!this.escape()) this.T.set('select'); }
  element() {
    const o = this.opts;
    if (!o.element) return null;
    const d = this.T.app.ensureDrawDefaults(o.element);
    return defaultLineElement(o.element, d.material, d.section);
  }
}

class NodeTool extends DrawBase {
  hint() { return t('<b>Klicken</b> setzt einen Knoten auf der Arbeitsebene oder Fangpunkt · Koordinaten unten eintippen (z.B. <b>3 0 4</b>)'); }
  preview() { this.T.vp.setToolPreview({ snap: this.snapPt }); }
  click(s) {
    this.T.store.commit(t('Knoten'), (m) => addNode(m, s.p));
    this.T.lastPoint = s.p;
  }
}

class LineTool extends DrawBase {
  hint() {
    const what = this.opts.element ? t('Stab') : t('Linie');
    return this.pts.length
      ? t('<b>Klicken</b> für Endpunkt ({what}) · <b>Shift</b> orthogonal · <b>Rechtsklick/Esc</b> Kette beenden · Länge: <b>@dx dy dz</b>', { what })
      : t('<b>Klicken</b> für Startpunkt ({what}) · fängt Knoten, Mittelpunkte und Raster', { what });
  }
  preview() {
    const a = this.lastPoint(), s = this.snapPt;
    const segs = a && s ? [[...a, ...s.p]] : [];
    this.T.vp.setToolPreview({ segments: segs, snap: s, points: this.pts.map((x) => x.p) });
    if (a && s) this.T.app.setHint(this.hint() + ` · <b>L = ${fmt('len', V.dist(a, s.p))}</b>`);
  }
  click(s) {
    const a = this.lastPoint();
    if (a) {
      if (V.dist(a, s.p) < 1e-9) return;
      const el = this.element();
      this.T.store.commit(this.opts.element ? t('Stab zeichnen') : t('Linie zeichnen'), (m) => {
        const n1 = addNode(m, a), n2 = addNode(m, s.p);
        addLine(m, n1, n2, el);
      });
      this.pts = [s];
    } else this.pts.push(s);
    this.T.lastPoint = s.p;
    this.preview();
  }
}

class RectTool extends DrawBase {
  hint() {
    const d = this.opts.domain ? t('Fläche') : t('Rechteck');
    return this.pts.length ? t('<b>Klicken</b> für gegenüberliegende Ecke ({d})', { d }) : t('<b>Klicken</b> für erste Ecke ({d}) auf der Arbeitsebene', { d });
  }
  corners(a, b) {
    const wp = this.T.store.view.workplane, pl = PLANES[wp.plane];
    const [u0, v0] = pl.unmap(a), [u1, v1] = pl.unmap(b);
    const off = V.dot(a, pl.n);
    return [pl.map(u0, v0, off), pl.map(u1, v0, off), pl.map(u1, v1, off), pl.map(u0, v1, off)];
  }
  preview() {
    const a = this.lastPoint(), s = this.snapPt;
    if (!a || !s) { this.T.vp.setToolPreview({ snap: s }); return; }
    const c = this.corners(a, s.p);
    const segs = c.map((p, i) => [...p, ...c[(i + 1) % 4]]);
    this.T.vp.setToolPreview({ segments: segs, snap: s, polys: this.opts.domain ? [c] : [] });
  }
  click(s) {
    const a = this.lastPoint();
    if (!a) { this.pts.push(s); this.preview(); return; }
    const c = this.corners(a, s.p);
    if (V.dist(c[0], c[2]) < 1e-9 || V.dist(c[0], c[1]) < 1e-9 || V.dist(c[1], c[2]) < 1e-9) { toast(t('Rechteck hat keine Fläche.'), 'warn'); return; }
    createPolygon(this.T, c, this.opts, this.element());
    this.pts = [];
    this.T.vp.setToolPreview({ snap: s });
  }
}

class PolygonTool extends DrawBase {
  hint() {
    return this.pts.length < 3
      ? t('<b>Klicken</b> für Eckpunkt {n} · <b>Esc</b> abbrechen', { n: this.pts.length + 1 })
      : t('<b>Klicken</b> auf den ersten Punkt oder <b>Enter</b>/<b>Rechtsklick</b> zum Schliessen');
  }
  preview() {
    const s = this.snapPt;
    const pts = this.pts.map((x) => x.p);
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push([...pts[i], ...pts[i + 1]]);
    if (s && pts.length) segs.push([...pts[pts.length - 1], ...s.p]);
    if (s && pts.length > 1) segs.push([...s.p, ...pts[0]]);
    this.T.vp.setToolPreview({ segments: segs, snap: s, points: pts, polys: this.opts.domain && s ? [[...pts, s.p]] : [] });
  }
  click(s) {
    if (this.pts.length >= 3 && V.dist(s.p, this.pts[0].p) < 1e-9) { this.enter(); return; }
    if (this.pts.some((x) => V.dist(x.p, s.p) < 1e-9)) return;
    this.pts.push(s);
    this.preview();
  }
  enter() {
    if (this.pts.length < 3) return;
    createPolygon(this.T, this.pts.map((x) => x.p), this.opts, this.element());
    this.pts = [];
    this.T.vp.setToolPreview({ snap: this.snapPt });
  }
  context() { if (this.pts.length >= 3) this.enter(); else if (!this.escape()) this.T.set('select'); }
}

class ArcTool extends DrawBase {
  hint() {
    return [t('<b>Klicken</b> für Startpunkt des Bogens'), t('<b>Klicken</b> für Endpunkt des Bogens'), t('<b>Klicken</b> für einen Punkt auf dem Bogen ({n} Segmente)', { n: this.opts.segments || 8 })][this.pts.length] || '';
  }
  arcPoints(a, b, c) {
    // circle through 3 points in 3D
    const ab = V.sub(b, a), ac = V.sub(c, a);
    const n = V.cross(ab, ac);
    const nn = V.dot(n, n);
    if (nn < 1e-14) return null;
    const ctr = V.add(a, V.mul(V.add(V.mul(V.cross(n, ab), V.dot(ac, ac)), V.mul(V.cross(ac, n), V.dot(ab, ab))), 1 / (2 * nn)));
    const r = V.dist(ctr, a);
    const e1 = V.norm(V.sub(a, ctr)), nz = V.norm(n), e2 = V.cross(nz, e1);
    const ang = (p) => { const d = V.sub(p, ctr); let x = Math.atan2(V.dot(d, e2), V.dot(d, e1)); if (x < 0) x += 2 * Math.PI; return x; };
    const ab2 = ang(b), ac2 = ang(c);
    let span = ab2;
    if (ac2 > ab2) span = ab2 - 2 * Math.PI; // c is not between a and b going ccw → go cw
    const nSeg = this.opts.segments || 8;
    const out = [];
    for (let i = 0; i <= nSeg; i++) {
      const th = span * i / nSeg;
      out.push(V.add(ctr, V.add(V.mul(e1, r * Math.cos(th)), V.mul(e2, r * Math.sin(th)))));
    }
    return out;
  }
  preview() {
    const s = this.snapPt, pts = this.pts.map((x) => x.p);
    let segs = [];
    if (pts.length === 1 && s) segs = [[...pts[0], ...s.p]];
    if (pts.length === 2 && s) {
      const arc = this.arcPoints(pts[0], pts[1], s.p);
      if (arc) for (let i = 0; i < arc.length - 1; i++) segs.push([...arc[i], ...arc[i + 1]]);
    }
    this.T.vp.setToolPreview({ segments: segs, snap: s, points: pts });
  }
  click(s) {
    this.pts.push(s);
    if (this.pts.length === 3) {
      const arc = this.arcPoints(this.pts[0].p, this.pts[1].p, this.pts[2].p);
      this.pts = [];
      if (!arc) { toast(t('Die drei Punkte liegen auf einer Geraden.'), 'warn'); return; }
      const el = this.element();
      this.T.store.commit(t('Bogen'), (m) => {
        const ids = arc.map((p) => addNode(m, p));
        for (let i = 0; i < ids.length - 1; i++) addLine(m, ids[i], ids[i + 1], el);
      });
    }
    this.preview();
  }
}

class MeasureTool extends DrawBase {
  hint() {
    if (this.result) return this.result;
    return this.pts.length ? t('<b>Klicken</b> für zweiten Punkt') : t('<b>Klicken</b> für ersten Messpunkt');
  }
  preview() {
    const a = this.lastPoint(), s = this.snapPt;
    this.T.vp.setToolPreview({ segments: a && s ? [[...a, ...s.p]] : [], snap: s, points: this.pts.map((x) => x.p) });
    if (a && s) {
      const d = V.sub(s.p, a);
      this.T.app.setHint(t('Abstand <b>{d}</b> · ΔX {x} · ΔY {y} · ΔZ {z}', { d: fmt('len', V.len(d)), x: fmt('len', d[0]), y: fmt('len', d[1]), z: fmt('len', d[2]) }));
    }
  }
  click(s) {
    if (!this.pts.length) { this.pts.push(s); this.result = null; return; }
    const a = this.pts[0].p, d = V.sub(s.p, a);
    this.result = t('Gemessen: <b>{d}</b> · ΔX {x} · ΔY {y} · ΔZ {z} · Klicken für neue Messung', { d: fmt('len', V.len(d)), x: fmt('len', d[0]), y: fmt('len', d[1]), z: fmt('len', d[2]) });
    this.pts = [];
  }
}

function createPolygon(T, pts, opts, element) {
  const st = T.store;
  st.commit(opts.domain ? t('Fläche zeichnen') : t('Polygon zeichnen'), (m) => {
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

const TOOLS = { select: SelectTool, orbit: OrbitTool, node: NodeTool, line: LineTool, rect: RectTool, polygon: PolygonTool, arc: ArcTool, measure: MeasureTool };
