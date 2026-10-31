// Unified CAD point input: every tool that needs a point (draw, move, copy, rotate, measure) uses this.
//   mouse      object snaps (node, midpoint, on line) and work-plane snaps (grid)
//   X / Y / Z  constrain to a global axis through the reference point; hovering an object snap then
//              projects that point onto the axis. Shift+X/Y/Z constrains to the plane normal to the axis.
//   B          pick a different reference point (for relative input and constraints)
//   typing     coordinates or a distance (see core/pointparse.js), Enter confirms, Tab toggles rel/abs
import { t } from '../i18n.js';
import { toast } from './dom.js';
import { V } from '../core/model.js';
import { parsePointInput } from '../core/pointparse.js';
import { fmt, fromDisplay, unitLabel } from '../core/units.js';
import { PLANES } from './viewport.js';

const AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const AXIS_CLASS = { X: 'x', Y: 'y', Z: 'z' };
const TYPED_CHARS = /^[0-9.,\-+@#<*/()× ]$/;

export class PointInput {
  constructor(tools, { prompt, ref = null, relative, onCommit, onPreview, onEnterEmpty, allowCopies = false, hints = '', surface = false }) {
    this.T = tools;
    this.vp = tools.vp;
    this.prompt = prompt;
    this.ref = ref;
    this.relative = relative ?? !!ref;
    this.onCommit = onCommit;
    this.onPreview = onPreview;
    this.onEnterEmpty = onEnterEmpty;
    this.allowCopies = allowCopies;
    this.hints = hints;
    this.surface = surface; // snap onto surfaces (section lines)
    this.constraint = null;
    this.typed = '';
    this.pickRef = false;
    this.cur = null;
    this.mouse = null;
    this.render();
  }

  setRef(p) { this.ref = p; this.render(); }

  /* ---------------- point from the mouse ---------------- */
  resolve(e) {
    const vp = this.vp, view = this.T.store.view;
    const free = this.pickRef || !this.ref || !this.constraint;
    const snap = vp.snap(e.x, e.y, { from: this.ref, ortho: free && e.shift && !!this.ref, surface: this.surface });
    if (free) return snap ? { ...snap } : null;
    const c = this.constraint, r = this.ref;
    const step = view.grid.snap ? (view.grid.step || 1) : 0;
    if (c.type === 'axis') {
      if (snap?.obj) {
        const p = V.add(r, V.mul(c.dir, V.dot(V.sub(snap.p, r), c.dir)));
        return { p, kind: 'proj', from: snap.p, label: t('Projektion von {l}', { l: snap.label }) };
      }
      let p = vp.closestOnLine(e.x, e.y, r, c.dir);
      if (!p) return null;
      if (step) { const s = Math.round(V.dot(V.sub(p, r), c.dir) / step) * step; p = V.add(r, V.mul(c.dir, s)); }
      return { p, kind: 'axis', label: t('Achse {a}', { a: c.key }) };
    }
    // plane normal to the axis through the reference
    if (snap?.obj) {
      const p = V.sub(snap.p, V.mul(c.dir, V.dot(V.sub(snap.p, r), c.dir)));
      return { p, kind: 'proj', from: snap.p, label: t('Projektion von {l}', { l: snap.label }) };
    }
    let p = vp.rayPlane(e.x, e.y, r, c.dir);
    if (!p) return null;
    if (step) p = p.map((v, i) => (c.dir[i] ? v : r[i] + Math.round((v - r[i]) / step) * step));
    return { p, kind: 'plane', label: t('Ebene ⟂ {a}', { a: c.key }) };
  }

  move(e) {
    this.mouse = e;
    if (this.typed) { this.previewTyped(); return; }
    this.cur = this.resolve(e);
    this.render();
    this.onPreview?.(this.cur, this);
  }

  click(e) {
    const r = this.typed ? this.parse(this.typed) : this.resolve(e);
    if (!r?.p) return;
    if (this.pickRef) {
      this.ref = r.p;
      this.pickRef = false;
      this.typed = '';
      this.render();
      this.onPreview?.(this.cur, this);
      return;
    }
    this.commit(r.p, { kind: r.kind, copies: r.copies });
  }

  commit(p, info = {}) {
    this.typed = '';
    this.onCommit?.(p.map((c) => Math.round(c * 1e9) / 1e9), info);
  }

  /* ---------------- typed input ---------------- */
  context() {
    const wp = this.T.store.view.workplane, pl = PLANES[wp.plane];
    const o = pl.map(0, 0, wp.offset);
    let dirHint = null;
    if (this.ref && this.mouse && !this.constraint) {
      const raw = this.vp.snap(this.mouse.x, this.mouse.y, { surface: this.surface });
      if (raw && V.dist(raw.p, this.ref) > 1e-9) dirHint = V.norm(V.sub(raw.p, this.ref));
    }
    return {
      ref: this.ref, relative: this.relative,
      axis: this.constraint?.type === 'axis' ? this.constraint.dir : null,
      dirHint,
      plane: { U: V.sub(pl.map(1, 0, wp.offset), o), V: V.sub(pl.map(0, 1, wp.offset), o), origin: o },
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
        direction: t('Eine einzelne Zahl braucht eine Richtung: Achse mit X/Y/Z wählen oder Maus in Richtung bewegen.'),
        polar: t('Polar-Eingabe: Länge<Winkel, z.B. @5<30'),
        count: t('Bitte 1, 2 oder 3 Werte eingeben.'),
      }[res.error] || t('Ungültige Eingabe. Beispiele: 3 · 2 0 1 · #5 0 3 · @5<30');
      toast(msg, 'warn');
      return false;
    }
    if (this.pickRef) { this.ref = res.p; this.pickRef = false; this.typed = ''; this.render(); return true; }
    this.commit(res.p, { kind: 'typed', copies: res.copies });
    return true;
  }

  key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    if (/^[xyzXYZ]$/.test(k) && !this.typed) {
      if (!this.ref) { toast(t('Achsen beziehen sich auf den Bezugspunkt – zuerst einen Punkt setzen oder mit B wählen.'), 'info'); return true; }
      const key = k.toUpperCase(), type = e.shiftKey ? 'plane' : 'axis';
      this.constraint = this.constraint?.key === key && this.constraint.type === type ? null : { type, key, dir: AXES[key] };
      this.refresh();
      return true;
    }
    if ((k === 'b' || k === 'B') && !this.typed) { this.pickRef = !this.pickRef; this.refresh(); return true; }
    // while typing, "x" marks the copy count ("0 2 0 x3" = three copies)
    if ((k === 'x' || k === 'X') && this.typed) { this.typed += this.typed.endsWith(' ') ? '*' : ' *'; this.previewTyped(); return true; }
    if (TYPED_CHARS.test(k) && !(k === ' ' && !this.typed)) { this.typed += k; this.previewTyped(); return true; }
    if (k === 'Backspace') { if (!this.typed) return false; this.typed = this.typed.slice(0, -1); this.typed ? this.previewTyped() : this.refresh(); return true; }
    if (k === 'Tab') { this.relative = !this.relative; this.typed ? this.previewTyped() : this.render(); return true; }
    if (k === 'Enter') {
      if (this.typed) this.submit(this.typed);
      else if (this.onEnterEmpty) this.onEnterEmpty();
      else if (this.cur?.p) this.commit(this.cur.p, { kind: this.cur.kind });
      return true;
    }
    if (k === 'Escape') {
      if (this.typed) { this.typed = ''; this.refresh(); return true; }
      if (this.pickRef) { this.pickRef = false; this.refresh(); return true; }
      if (this.constraint) { this.constraint = null; this.refresh(); return true; }
      return false;
    }
    return false;
  }

  refresh() {
    if (this.mouse) this.move(this.mouse); else this.render();
  }

  /* ---------------- visuals ---------------- */
  // helper geometry for vp.setToolPreview: constraint axes, projection guides, reference marker
  decor() {
    const out = { axes: [], guides: [], points: [], snap: this.cur ? { p: this.cur.p, kind: this.cur.kind } : null };
    const C = this.vp.C, L = (this.vp.bounds?.size || 10) * 3;
    const col = { X: C.axisX, Y: C.axisY, Z: C.axisZ };
    if (this.ref && this.constraint) {
      const c = this.constraint;
      const dirs = c.type === 'axis' ? [c.key] : Object.keys(AXES).filter((a) => a !== c.key);
      for (const a of dirs) out.axes.push({ a: V.sub(this.ref, V.mul(AXES[a], L)), b: V.add(this.ref, V.mul(AXES[a], L)), color: col[a] });
    }
    if (this.cur?.from) out.guides.push([...this.cur.from, ...this.cur.p]);
    if (this.ref) out.points.push(this.ref);
    return out;
  }

  render() {
    const hud = this.T.hud;
    if (!hud) return;
    const cur = this.cur;
    const chips = [];
    if (this.constraint) chips.push(`<span class="pi-chip ${AXIS_CLASS[this.constraint.key]}">${this.constraint.type === 'axis' ? t('Achse {a}', { a: this.constraint.key }) : t('Ebene ⟂ {a}', { a: this.constraint.key })}</span>`);
    if (this.pickRef) chips.push(`<span class="pi-chip ref">${t('Bezugspunkt wählen')}</span>`);
    let coords = '';
    if (cur?.p) {
      if (this.ref && !this.pickRef) {
        const d = V.sub(cur.p, this.ref);
        coords = `ΔX ${fmt('len', d[0], { unit: false })} · ΔY ${fmt('len', d[1], { unit: false })} · ΔZ ${fmt('len', d[2], { unit: false })} · <b>L ${fmt('len', V.len(d))}</b>`;
      } else {
        coords = `X ${fmt('len', cur.p[0], { unit: false })} · Y ${fmt('len', cur.p[1], { unit: false })} · Z ${fmt('len', cur.p[2], { unit: false })} ${unitLabel('len')}`;
      }
    }
    const mode = this.ref ? (this.relative ? t('relativ') : t('absolut')) : t('absolut');
    const input = this.typed
      ? `<span class="pi-typed${this.typedOk === false ? ' bad' : ''}">${escapeHtml(this.typed)}</span><span class="pi-caret"></span>${this.cur?.copies > 1 ? `<span class="pi-chip ref">${this.cur.copies}×</span>` : ''}`
      : `<span class="pi-ph">${this.ref ? t('Zahl tippen: Distanz oder dx dy dz') : t('Koordinaten tippen: x y z')}</span>`;
    hud.innerHTML = `
      <div class="pi-row"><b>${escapeHtml(this.pickRef ? t('Bezugspunkt') : this.prompt)}</b>${chips.join('')}</div>
      ${cur?.label ? `<div class="pi-row pi-snap">${escapeHtml(cur.label)}</div>` : ''}
      ${coords ? `<div class="pi-row pi-coords">${coords}</div>` : ''}
      <div class="pi-input"><span class="pi-prompt">›</span>${input}<span class="pi-mode" title="Tab">${mode}</span></div>`;
    hud.style.display = '';
    const m = this.mouse;
    const W = this.vp.width, H = this.vp.height;
    const hw = hud.offsetWidth || 220, hh = hud.offsetHeight || 80;
    let x = m ? m.x + 22 : W / 2 - hw / 2, y = m ? m.y + 22 : H - hh - 70;
    if (x + hw > W - 8) x = (m ? m.x - hw - 16 : W - hw - 8);
    if (y + hh > H - 8) y = (m ? m.y - hh - 16 : H - hh - 8);
    hud.style.left = Math.max(8, x) + 'px';
    hud.style.top = Math.max(8, y) + 'px';
  }

  dispose() { if (this.T.hud) this.T.hud.style.display = 'none'; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export const POINT_KEYS_HINT = () => t('<b>X/Y/Z</b> Achse · <b>Shift+X/Y/Z</b> Ebene · <b>B</b> Bezugspunkt · Zahlen tippen (<b>3</b> Distanz, <b>2 0 1</b> relativ, <b>#</b> absolut, <b>@5&lt;30</b> polar) · <b>Tab</b> rel/abs · <b>Enter</b> ok');

// Keyboard reference of the point input (side panel and help dialog)
export function pointKeys(tool) {
  const keys = [
    ['X / Y / Z', t('Auf globale Achse durch den Bezugspunkt beschränken – dann Fangpunkt anfahren: Projektion auf die Achse')],
    ['Shift+X/Y/Z', t('Auf Ebene senkrecht zur Achse beschränken')],
    ['B', t('Anderen Bezugspunkt wählen (für relative Eingaben)')],
    ['3', t('Distanz entlang Achse bzw. Mausrichtung')],
    ['2 0 1', t('dx dy dz relativ (2. Punkt) bzw. absolut (1. Punkt)')],
    ['#5 0 3 · @…', t('absolut erzwingen · relativ erzwingen')],
    ['4 6', t('Zwei Werte = Koordinaten in der Arbeitsebene')],
    ['@5<30', t('Polar: Länge 5, Winkel 30° in der Arbeitsebene')],
    ['… x3', t('Anzahl Kopien (Kopieren)')],
    ['Tab · Enter · Esc', t('relativ/absolut · bestätigen · Eingabe/Achse löschen, dann abbrechen')],
  ];
  if (tool === 'rotate' || !tool) keys.push(['Alt+X/Y/Z', t('Drehachse wählen')], ['90 · 30 x11', t('Winkel tippen · rotierende Kopien')]);
  if (tool === 'move' || tool === 'copy' || tool === 'rotate' || !tool) keys.unshift(['Enter', t('Basispunkt = Schwerpunkt der Auswahl')]);
  return keys;
}
