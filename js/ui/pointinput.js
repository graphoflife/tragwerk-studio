// Point input of every tool that needs a point (draw, move, rotate, measure, drag & drop), as in AxisVM:
//   mouse          object snaps (node, midpoint, on line, surface) and the drawing plane (grid)
//   X / Y / Z      jump into that field of the coordinate window and type the value (expressions such as
//                  2*3.5 or cos(45) allowed); the next letter moves on, Enter / Space / click place the point.
//                  Shift+Ctrl+L / R / A / H: fields L, r, a, h
//   Shift+D / E    Cartesian / polar fields relative to the relative origin ("d") or absolute
//   Ctrl+Alt+X …   lock a field at its value (again: unlock) – e.g. dY and dZ locked: along X only
//   Insert         relative origin to the cursor (also Alt+Shift); it follows every placed point
//   Shift (held)   direction from the relative origin in 15° steps; after passing a line: along the line,
//                  after passing a node: towards the node
//   Alt+P / Alt+V  parallel / perpendicular to a line, Alt+B bisector of two lines (click them)
//   Alt+I          intersection point of two lines (click them)
//   digits         free input: "dx dy dz", "#x y z", "@5<30", "… *n" copies (see core/pointparse.js)
import { t } from '../i18n.js';
import { toast } from './dom.js';
import { V, P } from '../core/model.js';
import { parsePointInput, evalNumber } from '../core/pointparse.js';
import { applyFields, fieldValues, angleStep } from '../core/coordfields.js';
import { fromDisplay, toDisplay, fmtNum } from '../core/units.js';
import { PLANES } from './vp-util.js';

const TYPED_START = /^[0-9.,\-+@#(]$/;
const TYPED_CHARS = /^[0-9.,\-+@#<*/()× ]$/;
const CODE_FIELD = { KeyX: 'X', KeyY: 'Y', KeyZ: 'Z', KeyL: 'L', KeyR: 'r', KeyA: 'a', KeyH: 'h' };
const GEO_TOOLS = { KeyP: 'parallel', KeyV: 'perp', KeyB: 'bisector', KeyI: 'intersect' };
const GEO_LABEL = { parallel: 'Parallel', perp: 'Senkrecht', bisector: 'Winkelhalbierende', intersect: 'Schnittpunkt' };
const toInternal = (f, v) => (v == null ? null : f === 'a' ? v : fromDisplay('len', v));

// closest points of two lines a + s·u and b + t·w; null when parallel
function lineLine(a, u, b, w) {
  const r = V.sub(a, b), uu = V.dot(u, u), uw = V.dot(u, w), ww = V.dot(w, w), ur = V.dot(u, r), wr = V.dot(w, r);
  const den = uu * ww - uw * uw;
  if (Math.abs(den) < 1e-12) return null;
  const s = (uw * wr - ww * ur) / den, tt = (uu * wr - uw * ur) / den;
  return [V.add(a, V.mul(u, s)), V.add(b, V.mul(w, tt))];
}
const onLine = (p, a, dir) => V.add(a, V.mul(dir, V.dot(V.sub(p, a), dir)));

export class PointInput {
  constructor(tools, { prompt, ref = null, onCommit, onPreview, onEnterEmpty, surface = false, planeThroughRef = false }) {
    this.T = tools;
    this.vp = tools.vp;
    this.prompt = prompt;
    if (ref) tools.relOrigin = ref;
    this.onCommit = onCommit;
    this.onPreview = onPreview;
    this.onEnterEmpty = onEnterEmpty;
    this.surface = surface; // snap onto surfaces (section lines, loads on surfaces)
    this.planeThroughRef = planeThroughRef; // free points in the plane through the relative origin (moving)
    this.typed = '';        // free input
    this.edit = null;       // coordinate fields being typed: { field, entries: [[field, text]], base }
    this.dirc = null;       // direction constraint of a geometry tool: { a, dir, label }
    this.geo = null;        // geometry tool waiting for lines: { op, lines: [] }
    this.shiftLine = null;  // direction caught while Shift is held
    // start from the last cursor position: untyped fields take their values from it
    this.mouse = tools.lastMouse || null;
    this.cur = this.mouse ? this.resolve(this.mouse) : null;
    this.render();
  }

  get ref() { return this.T.relOrigin; }
  get flags() { return this.T.coord; }
  plane() { return this.vp.drawPlane(this.ref, this.planeThroughRef).key; }

  /* ---------------- point from the mouse ---------------- */
  resolve(e) {
    const vp = this.vp, ref = this.ref;
    if (this.geo) {
      const hit = vp.pick(e.x, e.y, { lines: true });
      return hit ? { p: hit.p, kind: 'line', line: hit.id, label: t('Linie {id}', { id: hit.id }) } : null;
    }
    const s = vp.snap(e.x, e.y, { surface: this.surface, through: ref, always: this.planeThroughRef });
    if (!s) return null;
    let r = { ...s };
    if (!e.shift) this.shiftLine = null;
    const line = this.dirc || (e.shift ? this.shiftCatch(s) : null);
    if (line) {
      const p = s.obj && s.kind !== 'line' ? onLine(s.p, line.a, line.dir) : vp.closestOnLine(e.x, e.y, line.a, line.dir);
      if (!p) return null;
      r = { p, kind: s.obj ? 'proj' : 'dir', from: s.obj ? s.p : null, label: line.label };
    } else if (e.shift) {
      r = { p: angleStep(s.p, ref, this.plane(), 15), kind: 'angle', label: t('Winkelschritte 15°') };
    }
    const locks = this.flags.locks;
    if (locks.length) r = { ...r, p: applyFields(r.p, locks, ref, this.plane(), this.flags), label: `${r.label || ''} · ${t('gesperrt')}` };
    return r;
  }

  // Shift held: the first node or line passed fixes the direction until Shift is released
  shiftCatch(s) {
    if (this.shiftLine) return this.shiftLine;
    const ref = this.ref, { idx } = this.T.store;
    if (s.kind === 'node' && V.dist(s.p, ref) > 1e-9) this.shiftLine = { a: ref, dir: V.norm(V.sub(s.p, ref)), label: t('Richtung Knoten {id}', { id: s.node }) };
    else if ((s.kind === 'line' || s.kind === 'mid') && idx.lines.get(s.line)) {
      const l = idx.lines.get(s.line), a = P(idx.nodes.get(l.n1)), b = P(idx.nodes.get(l.n2));
      this.shiftLine = { a, dir: V.norm(V.sub(b, a)), label: t('Entlang Linie {id}', { id: l.id }) };
    }
    return this.shiftLine;
  }

  move(e) {
    this.mouse = e;
    if (this.typed) { this.previewTyped(); return; }
    if (this.edit) { this.previewEdit(); return; }
    this.cur = this.resolve(e);
    this.render();
    this.onPreview?.(this.cur, this);
  }

  click(e) {
    if (this.geo) { this.geoClick(e); return; }
    const r = this.typed ? this.parse(this.typed) : this.edit ? this.editPoint() : this.resolve(e);
    if (!r?.p) return;
    this.commit(r.p, { kind: r.kind, copies: r.copies });
  }

  commit(p, info = {}) {
    this.typed = '';
    this.edit = null;
    const q = p.map((c) => Math.round(c * 1e9) / 1e9);
    this.T.relOrigin = q; // the relative origin follows the placed point
    this.onCommit?.(q, info);
  }

  /* ---------------- coordinate fields ---------------- */
  startEdit(field) {
    if (!this.edit) this.edit = { field, entries: [], base: this.cur?.p || this.ref };
    this.edit.field = field;
    this.previewEdit();
  }
  editText(field) { return this.edit?.entries.find(([f]) => f === field)?.[1] ?? null; }
  setEditText(text) {
    const { field } = this.edit;
    this.edit.entries = this.edit.entries.filter(([f]) => f !== field);
    if (text) this.edit.entries.push([field, text]);
  }
  editPoint() {
    const vals = this.edit.entries.map(([f, txt]) => [f, toInternal(f, evalNumber(txt))]);
    if (vals.some(([, v]) => v == null)) return null;
    const p = applyFields(this.edit.base, [...this.flags.locks, ...vals], this.ref, this.plane(), this.flags);
    return { p, kind: 'typed', label: t('Eingabe') };
  }
  previewEdit() {
    const r = this.editPoint();
    this.editOk = !!r;
    if (r) this.cur = r;
    this.render();
    this.onPreview?.(this.cur, this);
  }
  // lock / unlock a field at its current value (the typed one while typing)
  toggleLock(field) {
    const locks = this.flags.locks;
    const i = locks.findIndex(([f]) => f === field);
    if (i >= 0) locks.splice(i, 1);
    else {
      const typed = this.editText(field);
      const v = typed != null ? toInternal(field, evalNumber(typed)) : fieldValues(this.cur?.p || this.ref, this.ref, this.plane(), this.flags)[field];
      if (v != null) locks.push([field, v]);
    }
    this.refresh();
  }
  toggleRelative(kind) {
    const f = this.flags;
    if (kind === 'cart') f.dCart = !f.dCart; else f.dPolar = !f.dPolar;
    this.refresh();
  }

  /* ---------------- geometry tools (parallel, perpendicular, bisector, intersection) ---------------- */
  startGeo(op) { this.geo = { op, lines: [] }; this.dirc = null; this.refresh(); }
  geoClick(e) {
    const hit = this.vp.pick(e.x, e.y, { lines: true });
    if (!hit) { toast(t('Bitte eine Linie anklicken.'), 'info'); return; }
    const { idx } = this.T.store, l = idx.lines.get(hit.id);
    const a = P(idx.nodes.get(l.n1)), b = P(idx.nodes.get(l.n2));
    const g = this.geo;
    g.lines.push({ id: l.id, a, b, dir: V.norm(V.sub(b, a)) });
    const need = g.op === 'bisector' || g.op === 'intersect' ? 2 : 1;
    if (g.lines.length < need) { this.render(); return; }
    this.geo = null;
    const ref = this.ref, [L1, L2] = g.lines;
    if (g.op === 'parallel') this.dirc = { a: ref, dir: L1.dir, label: t('Parallel zu Linie {id}', { id: L1.id }) };
    if (g.op === 'perp') {
      const foot = onLine(ref, L1.a, L1.dir);
      let dir = V.sub(ref, foot);
      if (V.len(dir) < 1e-9) dir = V.cross(PLANES[this.plane()].n, L1.dir);
      if (V.len(dir) < 1e-9) dir = V.cross([1, 0, 0], L1.dir);
      this.dirc = { a: ref, dir: V.norm(dir), label: t('Senkrecht zu Linie {id}', { id: L1.id }) };
    }
    if (g.op === 'bisector' || g.op === 'intersect') {
      const cp = lineLine(L1.a, L1.dir, L2.a, L2.dir);
      if (!cp || V.dist(cp[0], cp[1]) > 1e-6 * Math.max(1, V.len(cp[0]))) { toast(t('Die Linien schneiden sich nicht.'), 'warn'); this.refresh(); return; }
      const x = cp[0];
      if (g.op === 'intersect') { this.commit(x, { kind: 'intersect' }); return; }
      // legs from the vertex towards their far ends
      const leg = (L) => V.norm(V.sub(V.dist(L.a, x) > V.dist(L.b, x) ? L.a : L.b, x));
      const dir = V.add(leg(L1), leg(L2));
      if (V.len(dir) < 1e-9) { toast(t('Die Linien liegen auf einer Geraden.'), 'warn'); this.refresh(); return; }
      this.dirc = { a: ref, dir: V.norm(dir), label: t('Winkelhalbierende Linien {a} / {b}', { a: L1.id, b: L2.id }) };
    }
    this.refresh();
  }

  /* ---------------- free typed input ---------------- */
  context() {
    const plane = PLANES[this.plane()], off = V.dot(plane.n, this.ref);
    const o = plane.map(0, 0, off);
    let dirHint = null;
    if (this.mouse) {
      const raw = this.vp.snap(this.mouse.x, this.mouse.y, { surface: this.surface, through: this.ref, always: this.planeThroughRef });
      if (raw && V.dist(raw.p, this.ref) > 1e-9) dirHint = V.norm(V.sub(raw.p, this.ref));
    }
    return {
      ref: this.ref, relative: this.flags.dCart, axis: this.dirc?.dir || null, dirHint,
      plane: { U: V.sub(plane.map(1, 0, off), o), V: V.sub(plane.map(0, 1, off), o), origin: o },
      len: (v) => fromDisplay('len', v),
    };
  }

  parse(text) {
    const res = parsePointInput(text, this.context());
    if (!res.ok) return null;
    return { p: res.p, kind: 'typed', copies: res.copies, mode: res.mode, label: t('Eingabe') };
  }

  previewTyped() {
    const r = this.parse(this.typed);
    this.typedOk = !!r;
    if (r) this.cur = r;
    this.render();
    this.onPreview?.(this.cur, this);
  }

  submit(text) {
    const res = parsePointInput(text, this.context());
    if (!res.ok) {
      const msg = {
        direction: t('Eine einzelne Zahl braucht eine Richtung: Maus in Richtung bewegen oder Parallel/Senkrecht (Alt+P/Alt+V) wählen.'),
        polar: t('Polar-Eingabe: Länge<Winkel, z.B. @5<30'),
        count: t('Bitte 1, 2 oder 3 Werte eingeben.'),
      }[res.error] || t('Ungültige Eingabe. Beispiele: 3 · 2 0 1 · #5 0 3 · @5<30');
      toast(msg, 'warn');
      return false;
    }
    this.commit(res.p, { kind: 'typed', copies: res.copies });
    return true;
  }

  /* ---------------- keyboard ---------------- */
  key(e) {
    const k = e.key;
    if (e.ctrlKey && e.altKey && CODE_FIELD[e.code]) { this.toggleLock(CODE_FIELD[e.code]); return true; }
    if (e.ctrlKey && e.shiftKey && !e.altKey && ['KeyL', 'KeyR', 'KeyA', 'KeyH'].includes(e.code)) { this.startEdit(CODE_FIELD[e.code]); return true; }
    if (e.altKey && !e.ctrlKey && !e.shiftKey && GEO_TOOLS[e.code]) { this.startGeo(GEO_TOOLS[e.code]); return true; }
    if (k === 'Insert' || (k === 'Shift' && e.altKey) || (k === 'Alt' && e.shiftKey)) {
      if (this.cur?.p) { this.T.relOrigin = this.cur.p; this.refresh(); }
      return true;
    }
    if (e.shiftKey && !e.ctrlKey && !e.altKey && (e.code === 'KeyD' || e.code === 'KeyE')) { this.toggleRelative(e.code === 'KeyD' ? 'cart' : 'polar'); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (/^[xyz]$/i.test(k) && !this.typed) { this.startEdit(k.toUpperCase()); return true; }
    if (this.edit) {
      if (k === 'Enter' || k === ' ') { const r = this.editPoint(); if (r) this.commit(r.p, { kind: 'typed' }); else toast(t('Ungültiger Wert.'), 'warn'); return true; }
      if (k === 'Escape') { this.edit = null; this.refresh(); return true; }
      if (k === 'Backspace') { const s = this.editText(this.edit.field) || ''; this.setEditText(s.slice(0, -1)); this.previewEdit(); return true; }
      if (k.length === 1) { this.setEditText((this.editText(this.edit.field) || '') + k); this.previewEdit(); return true; }
      return false;
    }
    if (this.typed ? TYPED_CHARS.test(k) : TYPED_START.test(k)) { this.typed += k; this.previewTyped(); return true; }
    if (k === 'Backspace' && this.typed) { this.typed = this.typed.slice(0, -1); this.typed ? this.previewTyped() : this.refresh(); return true; }
    if (k === 'Enter' || (k === ' ' && !this.typed)) {
      if (this.typed) this.submit(this.typed);
      else if (this.onEnterEmpty && k === 'Enter') this.onEnterEmpty();
      else if (this.cur?.p) this.commit(this.cur.p, { kind: this.cur.kind });
      return true;
    }
    if (k === 'Escape') {
      if (this.typed) { this.typed = ''; this.refresh(); return true; }
      if (this.geo || this.dirc) { this.geo = null; this.dirc = null; this.refresh(); return true; }
      return false;
    }
    return false;
  }

  refresh() {
    if (this.edit) this.previewEdit();
    else if (this.mouse) this.move(this.mouse); else this.render();
  }

  /* ---------------- visuals ---------------- */
  // helper geometry for vp.setToolPreview: constraint line, projection guide, relative origin
  decor() {
    const out = { axes: [], guides: [], points: [], snap: this.cur ? { p: this.cur.p, kind: this.cur.kind } : null };
    const L = (this.vp.bounds?.size || 10) * 3;
    const line = this.dirc || this.shiftLine;
    if (line) out.axes.push({ a: V.sub(line.a, V.mul(line.dir, L)), b: V.add(line.a, V.mul(line.dir, L)), color: this.vp.C.sel });
    if (this.cur?.from) out.guides.push([...this.cur.from, ...this.cur.p]);
    out.points.push(this.ref);
    return out;
  }

  // prompt, snap and constraints at the cursor; the values go to the coordinate window
  render() {
    const hud = this.T.hud;
    if (!hud) return;
    const cur = this.cur, chips = [];
    if (this.geo) chips.push(`<span class="pi-chip ref">${t(GEO_LABEL[this.geo.op])}: ${t('Linie {n} anklicken', { n: this.geo.lines.length + 1 })}</span>`);
    if (this.dirc) chips.push(`<span class="pi-chip acc">${escapeHtml(this.dirc.label)}</span>`);
    for (const [f, v] of this.flags.locks) chips.push(`<span class="pi-chip lock">${this.fieldName(f)} = ${fmtNum(f === 'a' ? v : toDisplay('len', v), 4)}</span>`);
    const typed = this.typed
      ? `<div class="pi-input"><span class="pi-prompt">›</span><span class="pi-typed${this.typedOk === false ? ' bad' : ''}">${escapeHtml(this.typed)}</span><span class="pi-caret"></span>${this.cur?.copies > 1 ? `<span class="pi-chip ref">${this.cur.copies}×</span>` : ''}</div>`
      : '';
    hud.innerHTML = `
      <div class="pi-row"><b>${escapeHtml(this.prompt)}</b>${chips.join('')}</div>
      ${cur?.label ? `<div class="pi-row pi-snap">${escapeHtml(cur.label)}</div>` : ''}${typed}`;
    hud.style.display = '';
    const m = this.mouse;
    const W = this.vp.width, H = this.vp.height;
    const hw = hud.offsetWidth || 220, hh = hud.offsetHeight || 60;
    let x = m ? m.x + 22 : W / 2 - hw / 2, y = m ? m.y + 22 : H - hh - 70;
    if (x + hw > W - 8) x = (m ? m.x - hw - 16 : W - hw - 8);
    if (y + hh > H - 8) y = (m ? m.y - hh - 16 : H - hh - 8);
    hud.style.left = Math.max(8, x) + 'px';
    hud.style.top = Math.max(8, y) + 'px';
    if (cur?.p) this.T.app.coordWin.render({ p: cur.p, origin: this.ref, plane: this.plane(), flags: this.flags, edit: this.edit, editOk: this.editOk, locks: this.flags.locks });
  }
  fieldName(f) { return (f === 'a' || f === 'r' || f === 'h' ? this.flags.dPolar : this.flags.dCart) ? `d${f}` : f; }

  dispose() { if (this.T.hud) this.T.hud.style.display = 'none'; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export const POINT_KEYS_HINT = () => t('<b>X/Y/Z</b> Koordinate tippen · <b>Enter</b>/<b>Leertaste</b> setzt · <b>Shift</b> Winkelschritte · <b>Alt+P</b>/<b>Alt+V</b> parallel/senkrecht · <b>Einfg</b> relativer Ursprung · <b>Shift+D</b> relativ/absolut');

// Keyboard reference of the point input (side panel and help dialog)
export function pointKeys(tool) {
  const keys = [
    ['X · Y · Z', t('In das Feld des Koordinatenfensters springen und Wert tippen – nächster Buchstabe wechselt das Feld')],
    ['Shift+Ctrl+L/R/A/H', t('Felder L (Abstand), r, a (Winkel), h')],
    [t('Enter · Leertaste · Klick'), t('Punkt setzen')],
    ['Shift+D · Shift+E', t('Kartesische / polare Werte relativ (d) oder absolut')],
    ['Ctrl+Alt+X/Y/Z/L/R/A/H', t('Feld sperren / entsperren (z.B. dY und dZ gesperrt: nur entlang X)')],
    [t('Einfg · Alt+Shift'), t('Relativen Ursprung auf den Cursor setzen')],
    ['Shift', t('Richtung in 15°-Schritten; über eine Linie: entlang der Linie; über einen Knoten: zum Knoten hin')],
    ['Alt+P · Alt+V', t('Parallel / senkrecht zu einer Linie (Linie anklicken)')],
    ['Alt+B · Alt+I', t('Winkelhalbierende / Schnittpunkt zweier Linien')],
    ['2 0 1 · @5<30', t('Freie Eingabe: dx dy dz, polar Länge<Winkel, # absolut')],
    ['Esc', t('Eingabe löschen, dann Werkzeug beenden')],
  ];
  if (tool === 'transform' || !tool) keys.unshift(['Enter', t('Basispunkt = Schwerpunkt der Auswahl')]);
  return keys;
}
