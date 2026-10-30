// Small DOM toolkit: element factory, tooltips, toasts, dialogs, menus and form fields.
import { icon } from './icons.js';
import { t } from '../i18n.js';
import { toDisplay, fromDisplay, unitLabel, fmtNum } from '../core/units.js';

export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'tip') tip(el, ...(Array.isArray(v) ? v : [v]));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function ic(name, cls) {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name, cls);
  return tpl.content.firstChild;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/* ---------------- tooltip ---------------- */
let ttEl = null, ttTimer = 0;
export function tip(el, title, desc, kbd) {
  if (!title) return el;
  el.setAttribute('aria-label', title);
  el.addEventListener('mouseenter', () => {
    clearTimeout(ttTimer);
    ttTimer = setTimeout(() => showTip(el, title, desc, kbd), el.classList.contains('rbtn') ? 180 : 380);
  });
  el.addEventListener('mouseleave', hideTip);
  el.addEventListener('mousedown', hideTip);
  return el;
}
function showTip(el, title, desc, kbd) {
  if (!document.body.contains(el)) return;
  if (!ttEl) { ttEl = h('div.tooltip'); document.body.appendChild(ttEl); }
  clear(ttEl);
  ttEl.appendChild(h('div.tt-title', title, kbd ? h('span.kbd', kbd) : null));
  if (desc) ttEl.appendChild(h('div.tt-desc', desc));
  const r = el.getBoundingClientRect();
  ttEl.style.left = '0px'; ttEl.style.top = '0px';
  ttEl.classList.add('show');
  const tw = ttEl.offsetWidth, th = ttEl.offsetHeight;
  let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 8;
  if (y + th > innerHeight - 8) y = r.top - th - 8;
  if (r.width < 60 && r.left < 80) { x = r.right + 10; y = r.top + r.height / 2 - th / 2; }
  x = Math.max(8, Math.min(innerWidth - tw - 8, x));
  ttEl.style.left = x + 'px'; ttEl.style.top = y + 'px';
}
export function hideTip() { clearTimeout(ttTimer); ttEl?.classList.remove('show'); }

/* ---------------- toast ---------------- */
let toastBox = null;
export function toast(msg, type = 'info', ms = 3200) {
  if (!toastBox) { toastBox = h('div.toasts'); document.body.appendChild(toastBox); }
  const icons = { ok: 'checkCircle', warn: 'alert', err: 'xCircle', info: 'info' };
  const el = h('div.toast.' + type, ic(icons[type] || 'info'), h('div', msg));
  toastBox.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

/* ---------------- dialogs ---------------- */
const dialogStack = [];
export function openDialog({ title, sub, iconName, mod, body, buttons, size, onClose, footLeft }) {
  hideTip();
  const backdrop = h('div.dlg-backdrop');
  const dlg = h('div.dlg' + (size ? '.' + size : ''), { role: 'dialog', 'aria-modal': 'true' });
  if (mod) dlg.style.setProperty('--mod', `var(--p-${mod})`);
  const closeBtn = h('button.icon-btn', { onclick: () => close(), tip: t('Schliessen'), html: '' }, ic('x'));
  const head = h('div.dlg-head',
    iconName ? h('div.chip', ic(iconName)) : null,
    h('div', h('div.dlg-title', title), sub ? h('div.dlg-sub', sub) : null),
    closeBtn);
  const bodyEl = h('div.dlg-body');
  if (typeof body === 'function') body(bodyEl); else if (body) append(bodyEl, [body]);
  dlg.append(head, bodyEl);
  let foot = null;
  if (buttons?.length || footLeft) {
    foot = h('div.dlg-foot', footLeft || null, h('div.grow'));
    for (const b of buttons || []) {
      const btn = h('button.btn' + (b.kind ? '.' + b.kind : ''), {
        onclick: async () => {
          const r = b.onClick ? await b.onClick(api) : undefined;
          if (r !== false) close();
        },
      }, b.icon ? ic(b.icon) : null, b.label);
      if (b.disabled) btn.disabled = true;
      foot.appendChild(btn);
    }
    dlg.appendChild(foot);
  }
  backdrop.appendChild(dlg);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) backdrop.dataset.down = '1'; });
  backdrop.addEventListener('mouseup', (e) => { if (e.target === backdrop && backdrop.dataset.down) close(); backdrop.dataset.down = ''; });
  document.body.appendChild(backdrop);
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    backdrop.remove();
    const i = dialogStack.indexOf(api);
    if (i >= 0) dialogStack.splice(i, 1);
    onClose?.(result);
  }
  const api = { el: dlg, body: bodyEl, foot, close };
  dialogStack.push(api);
  setTimeout(() => {
    const f = bodyEl.querySelector('[autofocus], input:not([type=checkbox]):not([readonly]), select');
    f?.focus?.();
    if (f?.select && f.type !== 'number') f.select?.();
  }, 30);
  return api;
}
export function topDialog() { return dialogStack[dialogStack.length - 1]; }
export function anyDialogOpen() { return dialogStack.length > 0; }

export function confirmDialog(title, message, { okLabel, danger, iconName } = {}) {
  return new Promise((resolve) => {
    let res = false;
    openDialog({
      title, iconName: iconName || (danger ? 'alert' : 'help'), mod: danger ? 'rose' : 'lavender',
      body: h('p', { style: { margin: 0, color: 'var(--text-2)' } }, message),
      buttons: [
        { label: t('Abbrechen'), kind: 'ghost' },
        { label: okLabel || t('OK'), kind: danger ? 'danger' : 'primary', onClick: () => { res = true; } },
      ],
      onClose: () => resolve(res),
    });
  });
}

export function promptDialog(title, label, value = '', { iconName } = {}) {
  return new Promise((resolve) => {
    let res = null;
    const inp = h('input.input', { value });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { res = inp.value; d.close(); } });
    const d = openDialog({
      title, iconName: iconName || 'tag',
      body: h('div.field.stack', h('label', label), inp),
      buttons: [
        { label: t('Abbrechen'), kind: 'ghost' },
        { label: t('OK'), kind: 'primary', onClick: () => { res = inp.value; } },
      ],
      onClose: () => resolve(res),
    });
  });
}

/* ---------------- menus & popovers ---------------- */
let openMenuEl = null;
export function closeMenus() { openMenuEl?.remove(); openMenuEl = null; }
export function openMenu(at, items) {
  closeMenus(); hideTip();
  const menu = h('div.menu');
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { menu.appendChild(h('div.menu-sep')); continue; }
    if (it.title) { menu.appendChild(h('div.menu-title', it.title)); continue; }
    const b = h('button.menu-item' + (it.danger ? '.danger' : ''), {
      onclick: () => { closeMenus(); it.onClick?.(); },
    }, it.icon ? ic(it.icon) : h('span', { style: { width: '16px' } }), h('span', it.label), it.kbd ? h('span.kbd', it.kbd) : null,
    it.checked != null ? ic(it.checked ? 'check' : 'minus', '') : null);
    if (it.checked === false) b.lastChild.style.opacity = '0';
    if (it.disabled) b.disabled = true;
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  place(menu, at);
  openMenuEl = menu;
  return menu;
}

function place(el, at) {
  let x, y;
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    x = r.left; y = r.bottom + 6;
  } else { x = at.x; y = at.y; }
  const w = el.offsetWidth, hh = el.offsetHeight;
  if (x + w > innerWidth - 8) x = innerWidth - w - 8;
  if (y + hh > innerHeight - 8) y = Math.max(8, (at instanceof Element ? at.getBoundingClientRect().top - hh - 6 : y - hh));
  el.style.left = Math.max(8, x) + 'px';
  el.style.top = y + 'px';
}

let openPop = null;
export function openPopover(anchor, content, { width } = {}) {
  closePopover(); closeMenus(); hideTip();
  const pop = h('div.popover', content);
  if (width) pop.style.width = width + 'px';
  document.body.appendChild(pop);
  place(pop, anchor);
  openPop = pop;
  return { el: pop, close: closePopover };
}
export function closePopover() { openPop?.remove(); openPop = null; }

document.addEventListener('mousedown', (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target)) closeMenus();
  if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-popanchor]')) closePopover();
}, true);

/* ---------------- form fields ---------------- */
// q = physical quantity key (see units.js) – values are passed/returned in internal SI units.
export function numInput({ value, q, onChange, step, min, max, width, placeholder, digits }) {
  const wrap = h('div.input-wrap' + (q && unitLabel(q) ? '.has-unit' : ''));
  const inp = h('input.input', { type: 'text', inputMode: 'decimal', placeholder: placeholder || '' });
  const show = (v) => { inp.value = v == null || v === '' || Number.isNaN(v) ? '' : fmtNum(q ? toDisplay(q, v) : v, digits ?? 7); };
  show(value);
  if (width) wrap.style.width = width;
  const commit = () => {
    const raw = inp.value.trim().replace(',', '.');
    if (raw === '') { inp.classList.remove('invalid'); onChange?.(null); return; }
    let v = evalExpr(raw);
    if (v == null) { inp.classList.add('invalid'); return; }
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    inp.classList.remove('invalid');
    const internal = q ? fromDisplay(q, v) : v;
    show(internal);
    onChange?.(internal);
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); inp.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = evalExpr(inp.value.replace(',', '.')) ?? 0;
      const s = step || 1;
      inp.value = fmtNum(cur + (e.key === 'ArrowUp' ? s : -s) * (e.shiftKey ? 10 : 1), digits);
      commit();
    }
  });
  wrap.appendChild(inp);
  if (q && unitLabel(q)) wrap.appendChild(h('span.unit', unitLabel(q)));
  wrap.input = inp;
  wrap.setValue = show;
  return wrap;
}

// safe arithmetic evaluation for numeric inputs ("2*3.5", "6/4", "1e-3")
export function evalExpr(s) {
  if (!/^[\d\s.+\-*/()eE^]+$/.test(s)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${s.replace(/\^/g, '**')});`)();
    return Number.isFinite(v) ? v : null;
  } catch (e) { return null; }
}

export function field(label, control, { help, stack } = {}) {
  return h('div.field' + (stack ? '.stack' : ''),
    h('label', label, help ? h('span.help', { tip: [label, help] }, ic('info')) : null),
    control);
}

export function numField(label, opts) { return field(label, numInput(opts), opts); }

export function selectInput({ value, options, onChange, small }) {
  const sel = h('select.select' + (small ? '.sm' : ''));
  for (const o of options) {
    if (o.group) {
      const g = h('optgroup', { label: o.group });
      for (const oo of o.options) g.appendChild(h('option', { value: String(oo.value) }, oo.label));
      sel.appendChild(g);
    } else sel.appendChild(h('option', { value: String(o.value) }, o.label));
  }
  sel.value = String(value ?? '');
  sel.addEventListener('change', () => {
    const o = flatOpts(options).find((x) => String(x.value) === sel.value);
    onChange?.(o ? o.value : sel.value);
  });
  return sel;
}
function flatOpts(opts) { return opts.flatMap((o) => (o.group ? o.options : [o])); }
export function selectField(label, opts) { return field(label, selectInput(opts), opts); }

export function textInput({ value, onChange, placeholder }) {
  const inp = h('input.input', { value: value ?? '', placeholder: placeholder || '' });
  inp.addEventListener('change', () => onChange?.(inp.value));
  return inp;
}
export function textField(label, opts) { return field(label, textInput(opts), opts); }

export function switchInput(label, checked, onChange) {
  const cb = h('input', { type: 'checkbox', checked: !!checked });
  cb.addEventListener('change', () => onChange?.(cb.checked));
  return h('label.switch', cb, h('span.track'), h('span.grow', label));
}

export function checkInput(label, checked, onChange) {
  const cb = h('input', { type: 'checkbox', checked: !!checked });
  cb.addEventListener('change', () => onChange?.(cb.checked));
  return h('label.check', cb, label);
}

export function segmented(options, value, onChange, { full } = {}) {
  const el = h('div.seg' + (full ? '.full' : ''));
  for (const o of options) {
    const b = h('button', {
      class: o.value === value ? 'active' : '',
      onclick: () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        onChange?.(o.value);
      },
      tip: o.tip ? [o.tip] : null,
    }, o.icon ? ic(o.icon) : null, o.label || null);
    el.appendChild(b);
  }
  return el;
}

export function hintBox(text, kind = '', iconName) {
  const icons = { warn: 'alert', err: 'xCircle', ok: 'checkCircle', '': 'info' };
  return h('div.hint-box' + (kind ? '.' + kind : ''), ic(iconName || icons[kind] || 'info'), h('div', text));
}

export function section(title, ...children) {
  return h('div.side-section', h('div.side-section-title', title), ...children);
}

export function download(filename, content, mime = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept });
    inp.addEventListener('change', () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, text: r.result });
      r.readAsText(f);
    });
    inp.click();
  });
}
