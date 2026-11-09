// Coordinate window (AxisVM: Koordinatenfenster): the cursor position in Cartesian (X Y Z L) and cylindrical
// (r a h) fields, absolute or relative to the relative origin – the "d" switches (Shift+D / Shift+E).
// While a point is being entered a click on a field starts typing into it (like the keys X, Y, Z …);
// typed values are shown in the fields, locked fields are framed.
import { t } from '../i18n.js';
import { fieldValues } from '../core/coordfields.js';
import { toDisplay, fmtNum, unitLabel } from '../core/units.js';

const POLAR = new Set(['r', 'a', 'h']);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class CoordWindow {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    el.addEventListener('pointerdown', (e) => this.onPress(e));
  }

  render({ p, origin, plane, flags, edit = null, editOk = true, locks = [] }) {
    const v = fieldValues(p, origin, plane, flags);
    const locked = new Set(locks.map(([f]) => f));
    const cell = (f) => {
      const rel = POLAR.has(f) ? flags.dPolar : flags.dCart;
      const typed = edit?.entries.find(([x]) => x === f)?.[1];
      const active = edit?.field === f;
      const x = Math.abs(v[f]) < 1e-9 ? 0 : v[f];
      const val = typed != null ? esc(typed) : f === 'a' ? `${fmtNum(x, 2)}°` : fmtNum(toDisplay('len', x), 4);
      const cls = ['v', active && 'edit', typed != null && 'typed', locked.has(f) && 'locked', active && !editOk && 'bad'].filter(Boolean).join(' ');
      return `<span class="k" data-f="${f}">${rel ? 'd' : ''}${f}</span><span class="${cls}" data-f="${f}">${val}</span>`;
    };
    const dBtn = (kind, on) => `<button class="d${on ? ' on' : ''}" data-d="${kind}" title="${esc(kind === 'cart' ? t('Kartesisch relativ (Shift+D)') : t('Polar relativ (Shift+E)'))}">d</button>`;
    this.el.innerHTML = `${dBtn('cart', flags.dCart)}${cell('X')}${cell('Y')}${cell('Z')}${cell('L')}`
      + `${dBtn('polar', flags.dPolar)}${cell('r')}${cell('a')}${cell('h')}<span class="u">${unitLabel('len')}</span>`;
  }

  onPress(e) {
    const T = this.app.tools, pi = T.cur?.pi;
    const d = e.target.closest('[data-d]')?.dataset.d;
    if (d) {
      e.preventDefault();
      if (pi) pi.toggleRelative(d);
      else { const k = d === 'cart' ? 'dCart' : 'dPolar'; T.coord[k] = !T.coord[k]; T.renderCoords(); }
      return;
    }
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (f && pi) { e.preventDefault(); pi.startEdit(f); }
  }
}
