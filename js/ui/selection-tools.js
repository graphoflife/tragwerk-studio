// Selection in the viewport: the selection tool and the selection request of commands that need objects
// (AxisVM: a command with nothing selected shows the selection toolbar; select, then OK runs it).
import { t } from '../i18n.js';
import { h, ic, toast, openPopover } from './dom.js';
import { SEL_KINDS } from '../core/store.js';
import { openResult } from './vp-results.js';

/** Click and window selection shared by the selection tool and the selection request. */
class Picker {
  constructor(tools) { this.T = tools; this.start = null; }
  down(e) { this.start = e; }
  // rubber band while dragging; returns true while a window is being drawn
  drag(e) {
    if (!this.start) return false;
    const dx = e.x - this.start.x, dy = e.y - this.start.y;
    if (Math.hypot(dx, dy) <= 4) return true;
    const b = this.T.selbox;
    b.style.display = 'block';
    b.style.left = Math.min(e.x, this.start.x) + 'px';
    b.style.top = Math.min(e.y, this.start.y) + 'px';
    b.style.width = Math.abs(dx) + 'px';
    b.style.height = Math.abs(dy) + 'px';
    b.classList.toggle('crossing', dx < 0);
    return true;
  }
  // objects of a click or window (left→right: inside, right→left: crossing); null for an empty click
  finish(e, moved, filter) {
    const T = this.T, start = this.start;
    this.start = null;
    T.selbox.style.display = 'none';
    if (moved && start) return T.vp.boxSelect(start.x, start.y, e.x, e.y, e.x < start.x, filter);
    const hit = T.vp.pick(e.x, e.y, filter);
    return hit ? { [hit.kind + 's']: [hit.id] } : null;
  }
  cancel() { this.start = null; this.T.selbox.style.display = 'none'; }
}

export class SelectTool {
  constructor(tools) { this.T = tools; this.picker = new Picker(tools); }
  hint() {
    const n = this.T.store.selCount();
    if (n && this.T.store.geoCount()) return t('<b>{n}</b> Objekte ausgewählt · Knoten/Linien <b>ziehen</b> verschiebt · <b>Shift+T</b> Verschieben · <b>Shift+R</b> Drehen · <b>Entf</b> löschen · <b>Alt+Klick</b> doppelt markieren · <b>Rechtsklick</b> Menü', { n });
    if (n) return t('<b>{n}</b> Lager/Lasten ausgewählt · Werte rechts bearbeiten · <b>Entf</b> löschen', { n });
    return t('<b>Klicken</b> wählt · <b>Shift</b> hinzufügen · <b>Ctrl</b> entfernen · <b>Ziehen</b> Fenster (→ innen, ← kreuzend) · Knoten/Linie <b>ziehen</b> verschiebt · <b>Mitte</b> schwenken, <b>Alt+Mitte</b> drehen · <b>Mausrad</b> zoomen');
  }
  down(e) {
    const st = this.T.store, f = st.view.selFilter;
    this.picker.down(e);
    // a node or line under the cursor can be dragged to a new place (not in the result display)
    this.grab = e.shift || e.ctrl || e.alt || st.resultView.kind ? null : this.T.vp.pick(e.x, e.y, { nodes: f.nodes, lines: f.lines });
  }
  move(e, dragging) {
    const T = this.T;
    if (dragging && this.grab && Math.hypot(e.x - this.picker.start.x, e.y - this.picker.start.y) > 4) { this.startDrag(e); return; }
    if (dragging && this.picker.drag(e)) return;
    const hit = T.vp.pick(e.x, e.y, T.store.view.selFilter);
    T.vp.setHover(hit);
    T.vp.canvas.style.cursor = hit ? 'pointer' : 'default';
    T.app.showHoverInfo?.(hit, e);
  }
  // drag & drop: the grabbed object moves with the selection it belongs to, otherwise alone
  startDrag(e) {
    const T = this.T, st = T.store, g = this.grab;
    this.grab = null;
    this.picker.cancel();
    if (!movesWithSelection(st, g)) st.select({ [g.kind + 's']: [g.id] }, 'replace');
    T.set('transform', { kind: 'translate', method: 'move', base: g.p, drag: true });
    T.cur.move(e, true);
  }
  up(e, moved) {
    const st = this.T.store;
    this.grab = null;
    if (!this.picker.start) return; // the press belonged to another tool (e.g. an aborted drag)
    const sel = this.picker.finish(e, moved, st.view.selFilter);
    if (e.alt) { if (sel?.nodes?.length) st.toggleDouble(sel.nodes); return; }
    // AxisVM: Shift adds, Ctrl removes
    const mode = e.shift ? 'add' : e.ctrl ? 'remove' : 'replace';
    if (sel) st.select(sel, mode);
    else if (mode === 'replace') st.clearSelection();
  }
  context(e) {
    const T = this.T, st = T.store;
    const hit = T.vp.pick(e.x, e.y, st.view.selFilter);
    if (hit && !st.selection[hit.kind + 's'].has(hit.id)) st.select({ [hit.kind + 's']: [hit.id] }, 'replace');
    T.app.openContextMenu({ x: e.cx, y: e.cy }, hit);
  }
  dblclick(e) {
    const hit = this.T.vp.pick(e.x, e.y, this.T.store.view.selFilter);
    if (openResult(this.T.app, hit)) return;
    if (hit) { this.T.store.select({ [hit.kind + 's']: [hit.id] }, 'replace'); this.T.app.showSide('props'); }
  }
  cancel() { this.picker.cancel(); }
}

// is the grabbed node/line moved by a transformation of the current selection?
function movesWithSelection(st, hit) {
  const s = st.selection, idx = st.idx;
  if (hit.kind === 'line') return s.lines.has(hit.id);
  if (s.nodes.has(hit.id)) return true;
  for (const id of s.lines) { const l = idx.lines.get(id); if (l && (l.n1 === hit.id || l.n2 === hit.id)) return true; }
  for (const id of s.domains) if (idx.domains.get(id)?.nodes.includes(hit.id)) return true;
  return false;
}

const KIND_LABEL = { nodes: 'Knoten', lines: 'Linien', domains: 'Flächen', supports: 'Lager', loads: 'Lasten' };
const snapshot = (sel) => Object.fromEntries(SEL_KINDS.map((k) => [k, [...sel[k]]]));

/**
 * Selection request of a command that needs objects of some kinds (AxisVM selection toolbar).
 * Clicks and windows add to the selection (− removes, ± inverts; Shift adds and Ctrl removes for one
 * pick); OK, Enter or a right-click runs the command, Esc cancels. opts: { kinds, title, run }.
 */
export class PickTool {
  constructor(tools, { kinds, title, run }) {
    this.T = tools;
    this.kinds = kinds;
    this.title = title;
    this.run = run;
    this.mode = 'add';
    this.picker = new Picker(tools);
    this.filter = Object.fromEntries(SEL_KINDS.map((k) => [k, kinds.includes(k)]));
    const st = tools.store;
    // keep what fits the command, drop the rest
    st.select(Object.fromEntries(kinds.map((k) => [k, [...st.selection[k]]])), 'replace');
    this.bar = this.buildBar();
    tools.vp.el.appendChild(this.bar);
    this.off = st.on('selection', () => this.refreshBar());
    this.refreshBar();
  }
  count() { return this.kinds.reduce((n, k) => n + this.T.store.selection[k].size, 0); }
  hint() {
    return t('{title}: <b>{what}</b> wählen – Klicken oder Fenster ziehen · <b>Shift</b> hinzufügen · <b>Ctrl</b> entfernen · <b>Enter</b>/<b>Rechtsklick</b> OK · <b>Esc</b> Abbruch',
      { title: this.title, what: this.kinds.map((k) => t(KIND_LABEL[k])).join(', ') });
  }
  // AxisVM selection toolbar: ✕ · + − ± · All · Previous · Parts · Filter · OK · Cancel
  buildBar() {
    const T = this.T;
    const modeBtn = (m, iconName, label, desc) => h('button.icon-btn.mode', { dataset: { mode: m }, onclick: () => { this.mode = m; this.refreshBar(); }, tip: [label, desc] }, ic(iconName));
    const act = (iconName, label, desc, fn) => h('button.icon-btn', { onclick: fn, tip: [label, desc] }, ic(iconName));
    this.countEl = h('span.sel-count');
    const filterBtn = this.kinds.length > 1 ? act('filter', t('Filter'), t('Objektarten, die gewählt werden können'), () => this.openFilter(filterBtn)) : null;
    const partsBtn = act('layers', t('Teile'), t('Teile und Geschosse ein-/ausblenden – gewählt werden nur sichtbare Objekte'), () => T.app.openParts(partsBtn));
    return h('div.sel-bar',
      act('x', t('Schliessen'), t('Auswahl abbrechen'), () => T.set('select')),
      h('div.sel-title', h('b', this.title)),
      h('div.sel-group',
        modeBtn('add', 'plus', t('Hinzufügen'), t('Angeklickte Objekte zur Auswahl hinzufügen')),
        modeBtn('remove', 'minus', t('Entfernen'), t('Angeklickte Objekte aus der Auswahl entfernen')),
        modeBtn('toggle', 'plusMinus', t('Umschalten'), t('Angeklickte Objekte umschalten: gewählte abwählen, andere wählen'))),
      h('div.sel-group',
        act('boxsel', t('Alles'), t('Den aktuellen Modus (+ − ±) auf alle sichtbaren Objekte der geforderten Art anwenden'), () => T.store.select(this.visibleAll(), { add: 'add', remove: 'remove', toggle: 'toggle' }[this.mode])),
        act('undo', t('Vorherige Auswahl'), t('Auswahl des letzten Befehls wiederherstellen'), () => this.previous()),
        partsBtn, filterBtn),
      this.countEl,
      h('div.sel-group',
        h('button.btn.sm.ghost', { onclick: () => T.set('select') }, t('Abbrechen')),
        this.okBtn = h('button.btn.sm.primary', { onclick: () => this.ok() }, ic('check'), 'OK')));
  }
  openFilter(anchor) {
    const wrap = h('div', { style: { minWidth: '180px' } }, h('div.side-section-title', t('Wählbar')));
    for (const k of this.kinds) {
      const cb = h('input', { type: 'checkbox', checked: this.filter[k] });
      cb.addEventListener('change', () => { this.filter[k] = cb.checked; });
      wrap.appendChild(h('label.switch', cb, h('span.track'), h('span.grow', t(KIND_LABEL[k]))));
    }
    const r = anchor.getBoundingClientRect();
    openPopover({ x: r.left, y: r.bottom + 6 }, wrap);
  }
  refreshBar() {
    for (const b of this.bar.querySelectorAll('[data-mode]')) b.classList.toggle('active', b.dataset.mode === this.mode);
    const n = this.count();
    this.countEl.textContent = t('{n} gewählt', { n });
    this.okBtn.disabled = !n;
    this.T.updateHint();
  }
  visibleAll() {
    const { model, view } = this.T.store, out = {};
    for (const k of this.kinds.filter((x) => this.filter[x])) {
      if (k === 'nodes' || k === 'lines' || k === 'domains') out[k] = model[k].filter((o) => !view.hidden[k].has(o.id)).map((o) => o.id);
      else out[k] = this.T.app.visibleGlyphs(k.slice(0, -1));
    }
    return out;
  }
  previous() {
    const prev = this.T.store.prevSelection;
    if (!prev) return toast(t('Keine vorherige Auswahl.'), 'info');
    this.T.store.select(Object.fromEntries(this.kinds.map((k) => [k, prev[k] || []])), 'replace');
  }
  ok() {
    if (!this.count()) { toast(t('Bitte zuerst {what} auswählen.', { what: this.kinds.map((k) => t(KIND_LABEL[k])).join(', ') }), 'info'); return; }
    const run = this.run;
    this.T.set('select');
    run();
  }
  down(e) { this.picker.down(e); }
  move(e, dragging) {
    if (dragging && this.picker.drag(e)) return;
    const hit = this.T.vp.pick(e.x, e.y, this.filter);
    this.T.vp.setHover(hit);
    this.T.vp.canvas.style.cursor = hit ? 'pointer' : 'crosshair';
  }
  up(e, moved) {
    const sel = this.picker.finish(e, moved, this.filter);
    if (!sel) return;
    if (e.alt) { if (sel.nodes?.length) this.T.store.toggleDouble(sel.nodes); return; }
    const mode = e.shift ? 'add' : e.ctrl ? 'remove' : this.mode;
    this.T.store.select(sel, mode);
  }
  context() { this.ok(); }
  enter() { this.ok(); }
  cancel() {
    this.picker.cancel();
    this.off?.();
    this.bar.remove();
  }
}

/** Runs a command on the selected objects of the given kinds, or asks for them first (selection request). */
export function withSelection(app, kinds, title, run) {
  const st = app.store;
  if (kinds.some((k) => st.selection[k].size)) { st.prevSelection = snapshot(st.selection); return run(); }
  app.tools.set('pick', { kinds, title, run: () => { st.prevSelection = snapshot(st.selection); run(); } });
}
