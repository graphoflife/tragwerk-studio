// Application shell: layout, module tabs, ribbon, rail, status bar, keyboard shortcuts, file handling.
import { t, setLang, getLang } from '../i18n.js';
import { h, ic, clear, tip, toast, openMenu, openPopover, confirmDialog, download, pickFile, numInput, segmented, selectInput, anyDialogOpen, topDialog, closeMenus, closePopover, openDialog, hideTip } from './dom.js';
import { store } from '../core/store.js';
import { createModel, nextId } from '../core/model.js';
import { Viewport } from './viewport.js';
import { Tools } from './tools.js';
import { createCommands, RIBBON, MODULES } from './commands.js';
import { renderSide } from './panels.js';
import { paletteCss } from './vp-util.js';
import { fmt, fmtNum, toDisplay, unitLabel } from '../core/units.js';
import { getLibraryMaterial } from '../lib/materials.js';
import { getLibrarySection } from '../lib/sections.js';
import { importDXF, exportDXF } from '../io/dxf.js';
import { welcomeDialog } from './dialogs/help.js';
import { runStatic } from './dialogs/analysis.js';
import { DEFAULT_PSI } from './dialogs/manage.js';
import { defaultCaseKey, getCase, caseLabel, componentDef } from './results-data.js';
import { memberDetail, rcBeamDetail, rcPointDialog, nearestCorner, columnDetail } from './dialogs/rc.js';
import { checkName, POS_NAMES } from './design-text.js';
import { renderParts } from './parts-ui.js';
import { lineForces } from '../fem/index.js';

export class App {
  constructor(root) {
    this.root = root;
    this.store = store;
    this.sideTab = 'props';
    this.drawDefaults = { material: null, section: null, domainMaterial: null, thickness: 0.2, beamMaterial: null };
    this.cmds = createCommands(this);
    this.build();
    this.vp = new Viewport(this.vpEl, store);
    this.tools = new Tools(this);
    this.bind();
    this.renderAll();

    const restored = store.restoreAutosave();
    if (restored && store.model.nodes.length) {
      this.vp.zoomExtents(false);
      toast(t('Letztes Modell „{name}“ wiederhergestellt.', { name: store.model.meta.name }), 'ok');
    } else {
      setTimeout(() => welcomeDialog(this), 250);
    }
    this.renderAll();
  }

  /* ---------------- layout ---------------- */
  build() {
    const root = clear(this.root);
    // one top bar: logo · module tabs · file menu (model name) · search · undo/redo · settings
    this.modelNameEl = h('button.file-btn', { dataset: { popanchor: '1' }, onclick: () => this.openFileMenu(), tip: [t('Datei'), t('Neu, Öffnen, Speichern, Beispiele, DXF, Modellinfo')] });
    this.undoBtn = this.iconBtn('undo');
    this.redoBtn = this.iconBtn('redo');
    this.tabsEl = h('nav.tabs');
    const header = h('header.header',
      h('div.brand', { tip: ['Tragwerk Studio', t('3D-FEM für Tragwerke')] }, h('div.brand-logo', ic('logo')), h('div.brand-name', 'Tragwerk Studio')),
      this.tabsEl,
      h('div.header-actions',
        this.modelNameEl,
        this.iconBtn('palette'), h('div.sep-v'),
        this.undoBtn, this.redoBtn, h('div.sep-v'),
        this.themeBtn = this.iconBtn('theme', 'hide-sm'),
        h('button.icon-btn.hide-sm', { onclick: () => this.toggleLang(), tip: [t('Sprache'), 'Deutsch / English'] }, h('span', { style: { fontWeight: 700, fontSize: '11.5px' } }, getLang().toUpperCase())),
        this.iconBtn('settings', 'hide-sm'), this.iconBtn('help', 'hide-sm')));

    // ribbon (module tools)
    this.ribbonEl = h('div.ribbon');
    this.ribbonWrap = h('div.ribbon-wrap', this.ribbonEl);

    // main
    this.railEl = h('nav.rail');
    this.vpEl = h('div.viewport');
    this.legendEl = h('div.vp-card.legend');
    this.legendEl.style.display = 'none';
    this.infoEl = h('div.vp-card');
    this.infoEl.style.display = 'none';
    this.hintEl = h('div.vp-hint');
    this.vpToolbar = h('div.vp-toolbar');
    this.emptyEl = h('div.vp-empty');
    this.vpEl.append(this.vpToolbar, h('div.vp-overlay-tr', this.legendEl, this.infoEl), this.hintEl, this.emptyEl);
    this.sideTabsEl = h('div.side-tabs');
    this.sideBody = h('div.side-body');
    this.sideEl = h('aside.side', this.sideTabsEl, this.sideBody);
    this.mainEl = h('div.main', this.railEl, this.vpEl, this.sideEl);
    new ResizeObserver(() => this.fitTabs()).observe(header);
    // side panel: overlay (hidden by default) on narrow screens, docked on wide ones
    const narrow = matchMedia('(max-width: 820px)');
    if (narrow.matches) this.mainEl.classList.add('panel-hidden');
    narrow.addEventListener('change', (e) => this.mainEl.classList.toggle('panel-hidden', e.matches));

    // status
    this.coordsEl = h('div.coords');
    this.cmdInput = h('input', { placeholder: t('Koordinaten: x y z · @dx dy dz'), spellcheck: false });
    this.statusToggles = h('div.row', { style: { gap: '2px' } });
    this.statusMsg = h('div.msg');
    const status = h('footer.status',
      this.coordsEl,
      h('div.cmd', ic('target'), this.cmdInput),
      this.statusMsg,
      h('div.spacer'),
      this.statusToggles);
    root.append(header, this.ribbonWrap, this.mainEl, status);
    this.buildRail();
    this.buildVpToolbar();
  }

  iconBtn(cmdId, cls) {
    const c = this.cmds[cmdId];
    return h('button.icon-btn', { class: cls, onclick: () => c.run(), tip: [c.label, c.desc, c.kbd] }, ic(c.icon));
  }

  // Button for a command. Toggles (on/off switches) carry an indicator light; modes show a pressed state.
  cmdButton(id, base = 'icon-btn') {
    const c = this.cmds[id];
    const desc = c.kind === 'toggle' ? `${c.desc} · ${t('Schalter: ein/aus')}` : c.desc;
    const b = h(`button.${base}.${c.kind}` + (id.startsWith('run') ? '.primary' : ''), { onclick: () => c.run(), tip: [c.label, desc, c.kbd] }, ic(c.icon),
      c.kind === 'toggle' ? h('span.led') : null);
    b.dataset.cmd = id;
    if (c.kind === 'toggle') b.setAttribute('role', 'switch');
    return b;
  }

  buildRail() {
    const r = clear(this.railEl);
    const btn = (id) => this.cmdButton(id);
    const filterBtn = h('button.icon-btn', { dataset: { popanchor: '1' }, onclick: () => this.openSelFilter(filterBtn), tip: [t('Auswahlfilter'), t('Festlegen, welche Objekttypen ausgewählt werden können')] }, ic('filter'));
    r.append(btn('toolSelect'), btn('toolOrbit'), h('div.sep-h'), filterBtn, btn('selectAll'), btn('invertSel'), h('div.sep-h'),
      btn('hideSel'), btn('isolateSel'), btn('showAll'), this.partsBtn = btn('parts'), h('div.sep-h'), btn('toolMeasure'), btn('delete'), h('div.sep-h'), btn('tables'), btn('panel'));
  }

  buildVpToolbar() {
    const tb = clear(this.vpToolbar);
    const btn = (id) => this.cmdButton(id);
    const disp = h('button.icon-btn', { dataset: { popanchor: '1' }, onclick: () => this.openDisplayOptions(disp), tip: [t('Darstellung'), t('Beschriftungen, Lasten, Lager, Achsen, Netz ein-/ausblenden')] }, ic('sliders'));
    tb.append(btn('zoomFit'), h('div.sep-v'), btn('viewIso'), btn('viewTop'), btn('viewFront'), btn('viewSide'), btn('persp'), h('div.sep-v'),
      btn('renderWire'), btn('renderSolid'), btn('renderFull'), h('div.sep-v'), disp, btn('screenshot'));
  }

  /* ---------------- rendering ---------------- */
  renderAll() {
    this.renderTabs();
    this.renderRibbon();
    this.renderSideNow();
    this.renderStatus();
    this.refreshChrome();
  }

  renderTabs() {
    const el = clear(this.tabsEl);
    MODULES.forEach((m, i) => {
      const done = this.moduleDone(m.id);
      const b = h('button.tab' + (store.tab === m.id ? '.active' : ''), {
        onclick: () => this.setTab(m.id),
        ondblclick: () => this.ribbonWrap.classList.toggle('collapsed'),
        tip: [t(m.label), t('Doppelklick klappt die Werkzeugleiste ein/aus'), i < 10 ? `Alt+${(i + 1) % 10}` : undefined],
      }, h('span.tab-num', String(i + 1)), h('span.tab-label', t(m.label)), done ? h('span.tab-state') : null);
      b.style.setProperty('--mod', `var(--p-${m.mod})`);
      el.appendChild(b);
    });
    this.fitTabs();
  }

  // collapse inactive tab labels only when the full labels do not fit into the top bar
  fitTabs() {
    const el = this.tabsEl;
    el.classList.remove('compact');
    if (el.scrollWidth > el.clientWidth + 1) el.classList.add('compact');
  }

  moduleDone(id) {
    const m = store.model, r = store.results;
    switch (id) {
      case 'geometry': return m.nodes.length > 0;
      case 'elements': return m.lines.some((l) => l.element) || m.domains.length > 0;
      case 'loads': return m.loads.length > 0 || m.loadCases.some((lc) => lc.selfWeight);
      case 'mesh': return !!r.mesh;
      case 'static': return !!r.static;
      case 'vibration': return !!r.modal;
      case 'buckling': return !!r.buckling;
      case 'rc': return !!(r.rc || r.rcBeams || r.rcCols);
      case 'steel': return !!r.steel;
      case 'timber': return !!r.timber;
      default: return false;
    }
  }

  setTab(id) {
    if (id === 'design') id = 'rc'; // old module id
    store.tab = id;
    const autoRes = { static: 'static', vibration: 'modal', buckling: 'buckling', steel: 'steel', timber: 'timber' }[id];
    const r = store.results;
    if (autoRes && r[autoRes] && store.resultView.kind !== autoRes) this.showResults(autoRes);
    else if (id === 'rc' && (r.rc || r.rcBeams || r.rcCols) && store.resultView.kind !== 'rc') this.showResults('rc', r.rc ? undefined : r.rcBeams ? 'AsBot' : 'colEta');
    else if (['rc', 'steel', 'timber'].includes(id) && store.resultView.kind && store.resultView.kind !== (autoRes || 'rc')) this.hideResults();
    if (['geometry', 'elements', 'loads', 'mesh'].includes(id) && store.resultView.kind) this.hideResults();
    this.renderTabs();
    this.renderRibbon();
    if (['static', 'vibration', 'buckling', 'rc', 'steel', 'timber'].includes(id)) this.showSide('results');
    else if (this.sideTab === 'results') this.showSide('props');
  }

  renderRibbon() {
    const el = clear(this.ribbonEl);
    const mod = MODULES.find((m) => m.id === store.tab) || MODULES[0];
    el.style.setProperty('--mod', `var(--p-${mod.mod})`);
    for (const g of RIBBON[mod.id] || []) {
      const items = h('div.rgroup-items');
      for (const it of g.items) {
        if (typeof it === 'string') items.appendChild(this.ribbonButton(it));
        else items.appendChild(this.customControl(it.custom));
      }
      el.appendChild(h('div.rgroup', items, h('div.rgroup-title', t(g.title))));
    }
  }

  ribbonButton(id) {
    if (!this.cmds[id]) return h('span', id);
    return this.cmdButton(id, 'rbtn');
  }

  customControl(kind) {
    if (kind === 'workplane') {
      const v = store.view;
      const seg = segmented([{ value: 'XY', label: 'XY' }, { value: 'XZ', label: 'XZ' }, { value: 'YZ', label: 'YZ' }], v.workplane.plane,
        (p) => store.setView({ workplane: { ...v.workplane, plane: p } }));
      const off = numInput({ value: v.workplane.offset, q: 'len', onChange: (x) => store.setView({ workplane: { ...store.view.workplane, offset: x ?? 0 } }) });
      off.style.width = '96px';
      const step = numInput({ value: v.grid.step, q: 'len', min: 0.001, onChange: (x) => store.setView({ grid: { ...store.view.grid, step: x || 1 } }) });
      step.style.width = '96px';
      tip(off, t('Lage der Arbeitsebene'), t('Abstand der Arbeitsebene vom Ursprung (z.B. Geschosshöhe für XY)'));
      tip(step, t('Rasterweite'), t('Abstand der Fangpunkte auf der Arbeitsebene'));
      off.style.width = '84px'; step.style.width = '84px';
      tip(seg, t('Arbeitsebene'), t('Ebene, auf der gezeichnet und gefangen wird'));
      return h('div.rstack', seg, ic('plane'), off, ic('grid'), step);
    }
    if (kind === 'lcSelect') {
      const opts = store.model.loadCases.map((lc) => ({ value: lc.id, label: lc.name }));
      const sel = selectInput({ value: store.activeLC, options: opts.length ? opts : [{ value: '', label: t('– keine –') }], onChange: (v) => this.setActiveLC(+v) });
      sel.style.width = '190px';
      tip(sel, t('Aktiver Lastfall'), t('Neue Lasten werden diesem Lastfall zugeordnet; angezeigt werden nur seine Lasten.'));
      const add = h('button.icon-btn.sm', { onclick: () => this.addLoadCase(), tip: [t('Neuer Lastfall'), t('Lastfall anlegen und aktivieren')] }, ic('plus'));
      return h('div.rstack', sel, add);
    }
    return h('span');
  }

  setActiveLC(id) {
    store.activeLC = id;
    store.selection.loads.clear();
    store.emit('lc');
    store.emit('selection');
    if (store.tab === 'loads') this.renderRibbon();
    this.refreshChrome();
    this.renderSideNow();
  }

  addLoadCase() {
    let id;
    store.commit(t('Neuer Lastfall'), (m) => {
      id = nextId(m.loadCases);
      const grp = m.loadGroups.find((g) => g.type !== 'permanent') || m.loadGroups[0];
      m.loadCases.push({ id, name: t('Lastfall {n}', { n: id }), group: grp?.id ?? null, selfWeight: false });
    }, { keepResults: false });
    this.setActiveLC(id);
    this.renderRibbon();
    toast(t('Lastfall {n} angelegt und aktiviert.', { n: id }), 'ok');
  }

  refreshChrome() {
    const act = (root) => root.querySelectorAll('[data-cmd]').forEach((b) => {
      const c = this.cmds[b.dataset.cmd];
      const on = !!c?.active?.();
      b.classList.toggle('active', on);
      if (c?.kind === 'toggle') b.setAttribute('aria-checked', String(on));
    });
    act(this.ribbonEl); act(this.railEl); act(this.vpToolbar);
    this.undoBtn.disabled = !store.undoStack.length;
    this.redoBtn.disabled = !store.redoStack.length;
    tip(this.undoBtn, t('Rückgängig'), store.undoStack.length ? store.undoStack[store.undoStack.length - 1].label : '', 'Ctrl+Z');
    clear(this.modelNameEl).append(ic('fileText'), h('span.fname', store.model.meta.name || t('Unbenannt')), ...(store.dirty ? [h('span.dirty-dot', { tip: [t('Ungespeicherte Änderungen')] })] : []), ic('chevronDown', 'chev'));
    clear(this.themeBtn).appendChild(ic(this.isDark() ? 'sun' : 'moon'));
    // empty state
    clear(this.emptyEl);
    if (!store.model.nodes.length) {
      this.emptyEl.appendChild(h('div.vp-card.vp-empty-card',
        h('div.brand-logo', { style: { margin: '0 auto', width: '46px', height: '46px', borderRadius: '14px' } }, ic('logo')),
        h('h2', t('Leeres Modell')),
        h('p', t('Zeichne Geometrie im Modul Geometrie, nutze einen Generator für ein komplettes Tragwerk oder öffne ein Beispiel.')),
        h('div.vp-empty-actions',
          h('button.btn.primary', { onclick: () => this.cmds.generator.run() }, ic('sparkles'), t('Generator')),
          h('button.btn', { onclick: () => this.cmds.examples.run() }, ic('book'), t('Beispiele')),
          h('button.btn', { onclick: () => { this.setTab('geometry'); this.cmds.toolLine.run(); } }, ic('line'), t('Zeichnen')))));
    }
    this.renderStatus();
  }

  renderStatus() {
    const v = store.view;
    const el = clear(this.statusToggles);
    const tg = (label, iconName, on, onClick, desc, isToggle = true) => {
      const b = h('button.status-btn' + (isToggle ? '.toggle' : '') + (on ? '.on' : ''), { onclick: onClick, tip: [label, isToggle ? `${desc} · ${t('Schalter: ein/aus')}` : desc] },
        isToggle ? h('span.led') : ic(iconName), label);
      el.appendChild(b);
    };
    tg(t('Raster'), 'grid', v.grid.snap, () => store.setView({ grid: { ...v.grid, snap: !v.grid.snap } }), t('Am Raster fangen'));
    tg(t('Knoten'), 'node', v.snapNodes, () => store.setView({ snapNodes: !v.snapNodes }), t('An Knoten fangen'));
    tg(t('Mitte'), 'split', v.snapMid, () => store.setView({ snapMid: !v.snapMid }), t('An Linienmitten fangen'));
    tg(t('Linie'), 'line', v.snapLine, () => store.setView({ snapLine: !v.snapLine }), t('Am nächstgelegenen Punkt auf Linien fangen'));
    tg(t('Ortho'), 'ortho', v.ortho, () => store.setView({ ortho: !v.ortho }), t('Nur achsparallel zeichnen (auch mit gedrückter Shift-Taste)'));
    if (v.parts.on.size) {
      el.appendChild(h('button.status-btn.parts-on', { onclick: () => this.openParts(this.partsBtn), tip: [t('Teilefilter aktiv'), t('Nur die angehakten Teile sind sichtbar – auch in den Ergebnissen. Klick: Teile bearbeiten')] },
        ic('layers'), t('Teile: {n}', { n: v.parts.on.size }), h('span', { style: { marginLeft: '4px', opacity: 0.7 }, onclick: (e) => { e.stopPropagation(); store.setParts([]); } }, '✕')));
    }
    tg(`${v.workplane.plane} ${fmtNum(toDisplay('len', v.workplane.offset))} ${unitLabel('len')}`, 'plane', false, () => this.setTab('geometry'), t('Aktive Arbeitsebene'), false);
    tg(store.model.settings.code === 'SIA' ? 'SIA' : 'Eurocode', store.model.settings.code === 'SIA' ? 'swiss' : 'eu', false, () => this.setTab(['rc', 'steel', 'timber'].includes(store.tab) ? store.tab : 'rc'), t('Aktive Normenfamilie'), false);
  }

  setHint(html) { this.hintEl.innerHTML = html ? `<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg><span>${html}</span>` : ''; }

  setCoords(p) {
    this.coordsEl.innerHTML = ['X', 'Y', 'Z'].map((a, i) => `<b>${a}</b>${fmtNum(toDisplay('len', p[i]), 5).padStart(1)}`).join('&nbsp;&nbsp;') + ` <span style="color:var(--text-3)">${unitLabel('len')}</span>`;
  }

  setStatus(msg) { this.statusMsg.textContent = msg || ''; }

  showSide(tab) {
    this.sideTab = tab;
    this.mainEl.classList.remove('panel-hidden');
    this.renderSideNow();
  }

  renderSide() {
    if (this._sideQ) return;
    this._sideQ = true;
    requestAnimationFrame(() => { this._sideQ = false; this.renderSideNow(); });
  }

  renderSideNow() {
    const tabs = clear(this.sideTabsEl);
    const items = [['props', 'sliders', t('Eigenschaften')], ['model', 'layers', t('Modell')], ['results', 'diagram', t('Ergebnisse')]];
    for (const [id, iconName, label] of items) {
      tabs.appendChild(h('button.side-tab' + (this.sideTab === id ? '.active' : ''), { onclick: () => this.showSide(id) }, ic(iconName), label));
    }
    const scroll = this.sideBody.scrollTop;
    clear(this.sideBody);
    renderSide(this, this.sideBody, this.sideTab);
    this.sideBody.scrollTop = scroll;
  }

  togglePanel() { this.mainEl.classList.toggle('panel-hidden'); }

  renderLegend(info) {
    const el = clear(this.legendEl);
    if (!info || !store.resultView.kind) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.appendChild(h('div.legend-title', ic('contour'), info.title || ''));
    if (info.sub) el.appendChild(h('div.legend-sub', info.sub));
    if (info.empty) { el.appendChild(h('div.small.muted', info.msg || t('Keine Daten'))); return; }
    if (info.min != null && info.max != null && info.palette) {
      const n = 7, ticks = h('div.legend-ticks');
      for (let i = n - 1; i >= 0; i--) {
        let v = info.min + (info.max - info.min) * i / (n - 1);
        if (Math.abs(v) < Math.abs(info.max - info.min) * 1e-6) v = 0;
        ticks.appendChild(h('span', info.q === 'percent' ? (v * 100).toFixed(0) + ' %' : fmt(info.q || 'none', v)));
      }
      const bar = h('div.legend-bar');
      bar.style.background = paletteCss(info.palette, info.levels);
      el.appendChild(h('div.legend-scale', bar, ticks));
    }
    if (info.extremes?.length) {
      el.appendChild(h('div.legend-extreme', info.extremes.map(([k, v]) => h('div.row', h('span.muted', k), h('span.grow'), h('b', v)))));
    }
  }

  /* ---------------- results ---------------- */
  isResult(kind, comp) { return store.resultView.kind === kind && (!comp || store.resultView.component === comp); }

  async showResults(kind, component) {
    const r = store.results;
    const have = { static: r.static, modal: r.modal, buckling: r.buckling, steel: r.steel, rc: r.rc || r.rcBeams || r.rcCols, timber: r.timber, spectrum: r.spectrum };
    if (!have[kind]) {
      if (kind === 'static') {
        const ok = await runStatic(this, false);
        if (!ok) return;
      } else {
        toast(t('Noch keine Ergebnisse – bitte zuerst berechnen.'), 'info');
        return;
      }
    }
    const patch = { kind };
    if (component) patch.component = component;
    if (kind === 'static' && !store.resultView.caseKey) patch.caseKey = defaultCaseKey(store);
    if ((kind === 'modal' || kind === 'buckling') && store.resultView.kind !== kind) { patch.mode = 0; patch.animate = false; }
    store.setResultView(patch);
    if (kind === 'static' && store.tab !== 'static') { store.tab = 'static'; this.renderTabs(); this.renderRibbon(); }
    this.showSide('results');
  }

  hideResults() {
    if (!store.resultView.kind) return;
    store.setResultView({ kind: null, animate: false });
  }

  // design result probe (AxisVM: values at the cursor; double-click opens the detailed design)
  showDesignInfo(hit) {
    const el = this.infoEl, rv = store.resultView, R = store.results, mesh = R.mesh;
    const rows = [];
    const pct = (v) => `${((v ?? 0) * 100).toFixed(0)} %`;
    if ((rv.kind === 'steel' || rv.kind === 'timber') && hit.kind === 'line') {
      const r = (rv.kind === 'steel' ? R.steel : R.timber)?.find((x) => x.line === hit.id);
      if (!r) { el.style.display = 'none'; return; }
      rows.push([t('Stab {id}', { id: hit.id }), pct(r.eta)]);
      for (const [k, c] of Object.entries(r.checks || {}).sort((a, b) => (b[1].eta ?? 0) - (a[1].eta ?? 0)).slice(0, 5)) rows.push([checkName(k), pct(c.eta)]);
      rows.push([t('Doppelklick: Details'), '']);
    } else if (rv.kind === 'rc' && hit.kind === 'line' && ['colEta', 'colAs'].includes(rv.component) && R.rcCols) {
      const c = R.rcCols.find((x) => x.line === hit.id);
      if (!c) { el.style.display = 'none'; return; }
      rows.push([t('Stütze {id}', { id: hit.id }), pct(c.eta)], ['NEd', fmt('force', c.governing?.NEd ?? 0)], ['MEd,y / MEd,z', `${fmt('moment', c.governing?.MEdy ?? 0, { unit: false })} / ${fmt('moment', c.governing?.MEdz ?? 0)}`],
        [t('As erforderlich'), fmt('reinfBeam', c.As)], [t('Vorschlag'), c.bars ? `${c.bars.n} Ø${Math.round(c.bars.dia * 1000)}` : '–'], [t('Doppelklick: Details'), '']);
    } else if (rv.kind === 'rc' && hit.kind === 'line' && R.rcBeams) {
      const r = R.rcBeams.find((b) => b.line === hit.id);
      if (!r?.x?.length) { el.style.display = 'none'; return; }
      const L = r.x[r.x.length - 1] || 1, x = (hit.t ?? 0.5) * L;
      let k = 0;
      for (let j = 1; j < r.x.length; j++) if (Math.abs(r.x[j] - x) < Math.abs(r.x[k] - x)) k = j;
      rows.push([t('Balken {id}', { id: hit.id }), `x = ${fmt('len', r.x[k])}`]);
      if (r.env) rows.push(['My max / min', `${fmt('moment', r.env.MyMax[k], { unit: false })} / ${fmt('moment', r.env.MyMin[k])}`]);
      rows.push([t('As unten'), fmt('reinfBeam', r.AsBot[k])], [t('As oben'), fmt('reinfBeam', r.AsTop[k])], ['asw', fmt('reinf', r.Asw[k])], [t('Doppelklick: Details'), '']);
    } else if (rv.kind === 'rc' && rv.component === 'punch' && hit.kind === 'node') {
      const it = R.punching?.items.find((i) => i.node === hit.id);
      if (!it) { el.style.display = 'none'; return; }
      rows.push([t('Knoten {id}', { id: hit.id }), t(POS_NAMES[it.type])], ['VEd', fmt('force', it.VEd)], ['d', fmt('dim', it.d)], ['η', pct(it.eta)],
        [it.fail ? t('verstärken') : it.needsReinf ? t('Durchstanzbewehrung erforderlich') : t('ohne Bewehrung erfüllt'), '']);
    } else if (rv.kind === 'rc' && R.rc && (hit.kind === 'domain' || hit.kind === 'node') && hit.p) {
      const dom = hit.kind === 'domain' ? hit.id : mesh.shells.find((s) => s.nodes.includes(mesh.modelNodeToMesh?.[hit.id]))?.domain;
      const cn = dom != null ? nearestCorner(mesh, dom, hit.p) : null;
      if (!cn) { el.style.display = 'none'; return; }
      const k = cn.e * 4 + cn.c, A = R.rc.asCorner;
      rows.push([t('Fläche {id}', { id: dom }), '']);
      ['axb', 'ayb', 'axt', 'ayt'].forEach((n, j) => rows.push([n, fmt('reinf', A[k * 4 + j])]));
      const vr = R.rc.vRatio[k];
      rows.push(['vEd/vRd,c', vr < 0 ? t('Durchstanzbereich') : pct(vr)]);
      const gi = R.rc.gov[k * 4 + (/^a[xy][bt]$/.test(rv.component) ? ['axb', 'ayb', 'axt', 'ayt'].indexOf(rv.component) : 0)];
      if (gi >= 0) rows.push([t('massgebend'), caseLabel(store, R.rc.keys[gi])]);
      rows.push([t('Doppelklick: Berechnung'), '']);
    } else { el.style.display = 'none'; return; }
    clear(el).appendChild(h('div.kv', { style: { minWidth: '180px' } }, rows.flatMap(([a, b], i) => (i === 0 ? [h('b', a), h('span.muted', b)] : [h('span', a), h('span', b)]))));
    el.style.display = '';
  }

  // double-click on a design result: member details or the design trace at a slab point
  openResultDetail(hit) {
    const rv = store.resultView, R = store.results;
    if (!hit || !R.mesh) return false;
    if ((rv.kind === 'steel' || rv.kind === 'timber') && hit.kind === 'line') { memberDetail(this, rv.kind, hit.id); return true; }
    if (rv.kind === 'rc' && hit.kind === 'line' && R.rcCols?.some((c) => c.line === hit.id) && (['colEta', 'colAs'].includes(rv.component) || !R.rcBeams?.some((b) => b.line === hit.id))) { columnDetail(this, hit.id); return true; }
    if (rv.kind === 'rc' && hit.kind === 'line' && R.rcBeams?.some((b) => b.line === hit.id)) { rcBeamDetail(this, hit.id); return true; }
    if (rv.kind === 'rc' && R.rc && hit.kind === 'domain' && hit.p) {
      const cn = nearestCorner(R.mesh, hit.id, hit.p);
      if (cn) { rcPointDialog(this, cn.e, cn.c); return true; }
    }
    return false;
  }

  /* ---------------- selection helpers ---------------- */
  // everything visible: geometry plus the shown supports and the loads of the active load case
  visibleGlyphs(kind) { return (this.vp.glyphPicks || []).filter((g) => g.kind === kind).map((g) => g.id); }

  selectAll() {
    const v = store.view, f = v.selFilter, m = store.model;
    store.select({
      nodes: f.nodes ? m.nodes.filter((n) => !v.hidden.nodes.has(n.id)).map((n) => n.id) : [],
      lines: f.lines ? m.lines.filter((l) => !v.hidden.lines.has(l.id)).map((l) => l.id) : [],
      domains: f.domains ? m.domains.filter((d) => !v.hidden.domains.has(d.id)).map((d) => d.id) : [],
      supports: f.supports ? this.visibleGlyphs('support') : [],
      loads: f.loads ? this.visibleGlyphs('load') : [],
    }, 'replace');
  }

  invertSelection() {
    const s = store.selection, m = store.model, f = store.view.selFilter;
    store.select({
      nodes: f.nodes ? m.nodes.filter((n) => !s.nodes.has(n.id)).map((n) => n.id) : [],
      lines: f.lines ? m.lines.filter((l) => !s.lines.has(l.id)).map((l) => l.id) : [],
      domains: f.domains ? m.domains.filter((d) => !s.domains.has(d.id)).map((d) => d.id) : [],
      supports: f.supports ? this.visibleGlyphs('support').filter((id) => !s.supports.has(id)) : [],
      loads: f.loads ? this.visibleGlyphs('load').filter((id) => !s.loads.has(id)) : [],
    }, 'replace');
  }

  hideSelection() {
    const s = store.selection, hd = store.view.manualHidden;
    if (!store.selCount()) return toast(t('Nichts ausgewählt.'), 'info');
    s.nodes.forEach((id) => hd.nodes.add(id)); s.lines.forEach((id) => hd.lines.add(id)); s.domains.forEach((id) => hd.domains.add(id));
    store.clearSelection();
    store.setManualHidden(hd);
  }

  isolateSelection() {
    const s = store.selection, m = store.model;
    if (!store.selCount()) return toast(t('Nichts ausgewählt.'), 'info');
    const keepNodes = new Set(s.nodes);
    for (const id of s.lines) { const l = store.idx.lines.get(id); keepNodes.add(l.n1); keepNodes.add(l.n2); }
    for (const id of s.domains) store.idx.domains.get(id).nodes.forEach((n) => keepNodes.add(n));
    store.setManualHidden({
      nodes: new Set(m.nodes.filter((n) => !keepNodes.has(n.id)).map((n) => n.id)),
      lines: new Set(m.lines.filter((l) => !s.lines.has(l.id)).map((l) => l.id)),
      domains: new Set(m.domains.filter((d) => !s.domains.has(d.id)).map((d) => d.id)),
    });
  }

  // shows everything again: manually hidden objects and the part filter
  showAll() {
    store.view.manualHidden = { nodes: new Set(), lines: new Set(), domains: new Set() };
    store.setParts([]);
  }

  zoomSelection() {
    const s = store.selection, idx = store.idx, pts = [];
    s.nodes.forEach((id) => { const n = idx.nodes.get(id); pts.push([n.x, n.y, n.z]); });
    s.lines.forEach((id) => { const l = idx.lines.get(id); for (const n of [l.n1, l.n2]) { const nn = idx.nodes.get(n); pts.push([nn.x, nn.y, nn.z]); } });
    s.domains.forEach((id) => idx.domains.get(id).nodes.forEach((n) => { const nn = idx.nodes.get(n); pts.push([nn.x, nn.y, nn.z]); }));
    for (const g of this.vp.glyphPicks || []) if ((g.kind === 'support' ? s.supports : s.loads).has(g.id)) pts.push(...g.pts, ...g.segs.flat());
    this.vp.zoomTo(pts);
  }

  openFileMenu() {
    const C = this.cmds;
    const it = (id) => ({ label: C[id].label, icon: C[id].icon, kbd: C[id].kbd, onClick: () => C[id].run() });
    openMenu(this.modelNameEl, [
      { title: store.model.meta.name || t('Unbenannt') },
      it('new'), it('open'), it('save'), it('examples'), 'sep',
      it('importDxf'), it('exportDxf'), it('screenshot'), 'sep',
      it('modelInfo'), it('report'),
    ]);
  }

  openSelFilter(anchor) {
    const f = store.view.selFilter;
    const row = (k, label, iconName) => {
      const cb = h('input', { type: 'checkbox', checked: f[k] });
      cb.addEventListener('change', () => { f[k] = cb.checked; store.emit('view'); });
      return h('label.switch', cb, h('span.track'), h('span.grow', h('span.row', ic(iconName), label)));
    };
    const r = anchor.getBoundingClientRect();
    openPopover({ x: r.right + 8, y: r.top }, h('div', { style: { minWidth: '200px' } },
      h('div.side-section-title', t('Auswählbar')), row('nodes', t('Knoten'), 'node'), row('lines', t('Linien / Stäbe'), 'line'), row('domains', t('Flächen'), 'domain'),
      row('supports', t('Lager'), 'supportPin'), row('loads', t('Lasten'), 'loadNode')));
  }

  // after drawing a section line: show a surface result so the diagram appears right away
  afterSectionLine(name) {
    const R = store.results, rv = store.resultView;
    if (!R.static || !R.mesh?.shells.length) { toast(t('Schnittlinie {n} erstellt – nach der Berechnung zeigt sie den Ergebnisverlauf.', { n: name }), 'ok', 4000); return; }
    if (rv.kind === 'rc' && R.rc) { if (!/^a[xy][bt]$|vRatio/.test(rv.component)) store.setResultView({ component: 'axb' }); }
    else {
      const surf = ['shell', 'nodal'].includes(componentDef(rv.component)?.kind);
      this.showResults('static', rv.kind === 'static' && surf ? undefined : 'mx');
    }
    this.showSide('results');
    toast(t('Schnittlinie {n} erstellt – Diagramm und Integral in der Seitenleiste.', { n: name }), 'ok', 4000);
  }

  // Teile / Geschosse popover (left icon bar); stays in sync with model changes while open
  openParts(anchor) {
    if (this.sideTab === 'model' && !this.mainEl.classList.contains('panel-hidden') && !anchor) { this.sideBody.querySelector('.parts-section')?.scrollIntoView({ block: 'start' }); return; }
    const box = h('div.parts-pop');
    renderParts(this, box, { compact: true });
    openPopover(anchor || this.partsBtn, h('div', h('div.side-section-title', ic('layers'), t('Teile & Geschosse')), box), { width: 360 });
    const off = store.on('model', () => { if (!box.isConnected) off(); else renderParts(this, box, { compact: true }); });
  }

  openDisplayOptions(anchor) {
    const ids = ['showNodes', 'labelsNodes', 'labelsLines', 'labelsValues', 'showLoads', 'showSupports', 'showAxes', 'showMesh', 'showGrid'];
    const wrap = h('div', { style: { minWidth: '230px' } }, h('div.side-section-title', t('Darstellung')));
    for (const id of ids) {
      const c = this.cmds[id];
      const cb = h('input', { type: 'checkbox', checked: !!c.active() });
      cb.addEventListener('change', () => c.run());
      wrap.appendChild(h('label.switch', cb, h('span.track'), h('span.grow', h('span.row', ic(c.icon), c.label))));
    }
    openPopover(anchor, wrap);
  }

  openContextMenu(at, hit) {
    const s = store.selection, C = this.cmds;
    const n = store.selCount();
    const it = (id) => ({ label: C[id].label, icon: C[id].icon, kbd: C[id].kbd, onClick: () => C[id].run() });
    const items = [];
    if (n) {
      items.push({ title: t('{n} ausgewählt', { n }) });
      items.push({ label: t('Eigenschaften'), icon: 'sliders', onClick: () => this.showSide('props') });
      items.push({ label: t('Zoom auf Auswahl'), icon: 'zoomIn', onClick: () => this.zoomSelection() });
      items.push('sep');
      if (store.geoCount()) items.push(it('toolMove'), it('toolCopy'), it('toolRotate'), it('move'), it('mirror'), 'sep');
      if (s.nodes.size) items.push(it('supNode'), it('loadNode'));
      if (s.lines.size) items.push(it('assignLine'), it('releases'), it('split'), it('loadLine'), it('supLine'));
      if (s.domains.size) items.push(it('loadSurface'), it('supSurface'));
      items.push('sep', it('hideSel'), it('isolateSel'), 'sep', { ...it('delete'), danger: true });
    } else {
      items.push(it('zoomFit'), it('viewIso'), it('showAll'), it('selectAll'), 'sep', it('generator'), it('palette'));
    }
    void hit;
    openMenu(at, items);
  }

  // Result probe: values at the hovered node / member while results are shown
  showHoverInfo(hit) {
    const el = this.infoEl, rv = store.resultView, mesh = store.results.mesh;
    const hide = () => { el.style.display = 'none'; };
    if (hit && mesh && ['rc', 'steel', 'timber'].includes(rv.kind)) return this.showDesignInfo(hit);
    if (!hit || !mesh || !(rv.kind === 'static' || rv.kind === 'spectrum')) return hide();
    const cs = getCase(store, rv.caseKey);
    if (!cs) return hide();
    const r = cs.res || (rv.envSide === 'min' ? cs.min : cs.max);
    const rows = [];
    if (hit.kind === 'node') {
      const i = mesh.modelNodeToMesh?.[hit.id];
      if (i == null) return hide();
      const d = r.disp, R = r.reac;
      rows.push([t('Knoten {id}', { id: hit.id }), '']);
      ['eX', 'eY', 'eZ'].forEach((k, j) => rows.push([k, fmt('disp', d[6 * i + j])]));
      if ([0, 1, 2].some((j) => Math.abs(R[6 * i + j]) > 1e-9)) ['Rx', 'Ry', 'Rz'].forEach((k, j) => rows.push([k, fmt('force', R[6 * i + j])]));
    } else if (hit.kind === 'line') {
      const l = store.idx.lines.get(hit.id);
      if (!l?.element) return hide();
      let f;
      try { f = lineForces(mesh, r, hit.id); } catch (e) { return hide(); }
      if (!f?.x?.length) return hide();
      const L = f.x[f.x.length - 1] || 1, x = (hit.t ?? 0.5) * L;
      let k = 0;
      for (let j = 1; j < f.x.length; j++) if (Math.abs(f.x[j] - x) < Math.abs(f.x[k] - x)) k = j;
      rows.push([t('Stab {id}', { id: hit.id }), `x = ${fmt('len', f.x[k])}`]);
      [['N', 'force', 'Nx'], ['Vy', 'force'], ['Vz', 'force'], ['T', 'moment', 'Tx'], ['My', 'moment'], ['Mz', 'moment']].forEach(([c, q, lab]) => rows.push([lab || c, fmt(q, f[c][k])]));
    } else return hide();
    clear(el).appendChild(h('div.kv', { style: { minWidth: '170px' } }, rows.flatMap(([a, b], i) => (i === 0 ? [h('b', a), h('span.muted', b)] : [h('span', a), h('span', b)]))));
    el.style.display = '';
  }

  /* ---------------- defaults for drawing ---------------- */
  ensureDrawDefaults(kind) {
    const m = store.model, d = this.drawDefaults;
    if (kind === 'domain') {
      if (!store.idx.materials.has(d.domainMaterial)) {
        const ex = m.materials.find((x) => x.type === 'concrete');
        d.domainMaterial = ex ? ex.id : this.addLibraryMaterial('C30/37');
      }
      return { material: d.domainMaterial, thickness: d.thickness };
    }
    if (kind === 'spring' || kind === 'rigid') return {};
    if (!store.idx.materials.has(d.material)) {
      const ex = m.materials.find((x) => x.type === 'steel') || m.materials[0];
      d.material = ex ? ex.id : this.addLibraryMaterial('S235');
    }
    if (!store.idx.sections.has(d.section)) {
      const ex = m.sections[0];
      d.section = ex ? ex.id : this.addLibrarySection(kind === 'truss' ? 'CHS 88.9x4' : 'IPE 300');
    }
    return { material: d.material, section: d.section };
  }

  addLibraryMaterial(name) {
    let id = null;
    const tpl = getLibraryMaterial(name);
    if (!tpl) return null;
    store.commit(t('Material hinzufügen'), (m) => {
      const ex = m.materials.find((x) => x.name === tpl.name);
      if (ex) { id = ex.id; return; }
      id = nextId(m.materials);
      m.materials.push({ ...structuredClone(tpl), id });
    }, { keepResults: true });
    return id;
  }

  addLibrarySection(name) {
    let id = null;
    let tpl = getLibrarySection(name);
    if (!tpl) tpl = getLibrarySection(name.replace('x', '×')) || getLibrarySection('IPE 300');
    if (!tpl) return null;
    store.commit(t('Querschnitt hinzufügen'), (m) => {
      const ex = m.sections.find((x) => x.name === tpl.name);
      if (ex) { id = ex.id; return; }
      id = nextId(m.sections);
      m.sections.push({ ...structuredClone(tpl), id });
    }, { keepResults: true });
    return id;
  }

  setCode(code) {
    if (store.model.settings.code === code) return;
    // load groups take the partial and combination factors of the new code family
    store.commit(t('Norm ändern'), (m) => {
      m.settings.code = code;
      for (const g of m.loadGroups) {
        const p = DEFAULT_PSI[code]?.[g.type];
        if (p) [g.gammaSup, g.gammaInf, g.psi0, g.psi1, g.psi2] = p;
      }
    }, { keepResults: true });
    for (const k of ['steel', 'rc', 'rcBeams', 'rcCols', 'punching', 'timber']) store.results[k] = null;
    if (['steel', 'rc', 'timber'].includes(store.resultView.kind)) store.setResultView({ kind: null });
    toast((code === 'SIA' ? t('Normenfamilie: SIA 260–265 (Schweiz)') : t('Normenfamilie: Eurocode EN 1990–1998')) + ' · ' + t('γ/ψ-Beiwerte der Lastgruppen angepasst. Kombinationen ggf. neu erzeugen.'), 'ok', 5000);
    this.renderAll();
  }

  /* ---------------- files ---------------- */
  async newModel() {
    if (store.dirty && store.model.nodes.length && !(await confirmDialog(t('Neues Modell'), t('Das aktuelle Modell wird verworfen (es bleibt bis zum nächsten Speichern im Browser erhalten). Fortfahren?'), { okLabel: t('Neues Modell') }))) return;
    store.loadModel(createModel());
    this.vp.zoomExtents(false);
    this.renderAll();
  }

  async openFile() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const m = JSON.parse(f.text);
      if (!m.nodes || !m.lines) throw new Error('format');
      store.loadModel(m);
      this.vp.zoomExtents(false);
      this.renderAll();
      toast(t('Modell „{name}“ geladen.', { name: store.model.meta.name }), 'ok');
    } catch (e) {
      toast(t('Die Datei ist kein gültiges Tragwerk-Studio-Modell.'), 'err');
    }
  }

  saveFile() {
    const name = (store.model.meta.name || 'modell').replace(/[^\w\-äöüÄÖÜ ]+/g, '_');
    download(`${name}.ts.json`, JSON.stringify(store.model, null, 1));
    store.dirty = false;
    this.refreshChrome();
    toast(t('Modell gespeichert (Download).'), 'ok');
  }

  async importDxf() {
    const f = await pickFile('.dxf');
    if (!f) return;
    try {
      let count;
      store.commit(t('DXF importieren'), (m) => { count = importDXF(m, f.text); });
      this.vp.zoomExtents(false);
      toast(t('DXF importiert: {l} Linien, {d} Flächen.', { l: count.lines, d: count.domains }), 'ok');
    } catch (e) {
      console.error(e);
      toast(t('DXF konnte nicht gelesen werden.'), 'err');
    }
  }

  exportDxf() {
    download(`${store.model.meta.name || 'modell'}.dxf`, exportDXF(store.model), 'application/dxf');
  }

  saveScreenshot() {
    const url = this.vp.screenshot();
    const a = h('a', { href: url, download: `${store.model.meta.name || 'ansicht'}.png` });
    document.body.appendChild(a); a.click(); a.remove();
  }

  undo() { const l = store.undo(); if (l) toast(t('Rückgängig: {l}', { l }), 'info', 1600); }
  redo() { const l = store.redo(); if (l) toast(t('Wiederholt: {l}', { l }), 'info', 1600); }

  /* ---------------- theme & language ---------------- */
  isDark() {
    const th = document.documentElement.dataset.theme;
    return th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }

  toggleTheme() {
    const next = this.isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('ts.theme', next); } catch (e) { /* ignore */ }
    this.vp.refreshTheme();
    this.refreshChrome();
    store.emit('resultView');
  }

  toggleLang() {
    try { localStorage.setItem('ts.model', JSON.stringify(store.model)); } catch (e) { /* ignore */ }
    setLang(getLang() === 'de' ? 'en' : 'de');
    location.reload();
  }

  /* ---------------- command palette ---------------- */
  openPalette() {
    const all = Object.values(this.cmds);
    const input = h('input', { placeholder: t('Befehl oder Funktion suchen …') });
    const list = h('div.palette-list');
    let hl = 0, items = [];
    const render = () => {
      const q = input.value.trim().toLowerCase();
      items = all.filter((c) => !q || (c.label + ' ' + c.desc + ' ' + c.id).toLowerCase().includes(q)).slice(0, 60);
      hl = Math.min(hl, Math.max(0, items.length - 1));
      clear(list);
      items.forEach((c, i) => {
        const el = h('div.palette-item' + (i === hl ? '.hl' : ''), { onclick: () => { d.close(); c.run(); }, onmousemove: () => { if (hl !== i) { hl = i; render(); } } },
          h('div.chip', ic(c.icon)), h('div', h('div.pt', c.label), h('div.pd', c.desc)), c.kbd ? h('span.kbd', c.kbd) : null);
        list.appendChild(el);
      });
      if (!items.length) list.appendChild(h('div.empty', t('Keine Treffer')));
      list.children[hl]?.scrollIntoView?.({ block: 'nearest' });
    };
    input.addEventListener('input', () => { hl = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { hl = Math.min(items.length - 1, hl + 1); render(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); render(); e.preventDefault(); }
      if (e.key === 'Enter' && items[hl]) { d.close(); items[hl].run(); }
    });
    const d = openDialog({ title: t('Befehlssuche'), iconName: 'search', body: h('div', h('div.palette-input', ic('search'), input), list), size: '' });
    d.el.classList.add('palette');
    d.el.querySelector('.dlg-head').remove();
    d.body.style.padding = '0';
    render();
    setTimeout(() => input.focus(), 20);
  }

  /* ---------------- events & keyboard ---------------- */
  bind() {
    store.on('model', () => { this.renderTabs(); this.refreshChrome(); this.renderSide(); if (store.tab === 'loads') this.renderRibbon(); });
    store.on('selection', () => { this.renderSide(); this.tools?.updateHint(); });
    store.on('view', () => { this.refreshChrome(); this.renderSide(); });
    store.on('results', () => { this.renderTabs(); this.renderSide(); this.refreshChrome(); });
    store.on('resultView', () => { this.refreshChrome(); this.renderSide(); if (!store.resultView.kind) this.infoEl.style.display = 'none'; });
    store.on('tool', () => { this.refreshChrome(); this.renderSide(); });
    store.on('legend', (info) => this.renderLegend(info));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!document.documentElement.dataset.theme) { this.vp.refreshTheme(); this.refreshChrome(); } });

    this.cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.tools.coord(this.cmdInput.value); this.cmdInput.value = ''; }
      if (e.key === 'Escape') { this.cmdInput.value = ''; this.cmdInput.blur(); }
      e.stopPropagation();
    });

    const keymap = new Map();
    for (const c of Object.values(this.cmds)) if (c.kbd) keymap.set(c.kbd.toUpperCase(), c);
    keymap.set('CTRL+SHIFT+Z', this.cmds.redo);
    keymap.set('Z', this.cmds.zoomFit); // X/Y/Z are axis constraints only while a point is being entered
    keymap.set('DELETE', this.cmds.delete);
    keymap.set('BACKSPACE', this.cmds.delete);
    keymap.set('?', this.cmds.help);
    keymap.set('SHIFT+?', this.cmds.help);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.querySelector('.menu, .popover')) { closeMenus(); closePopover(); return; }
        if (anyDialogOpen()) { topDialog().close(); return; }
        hideTip();
        this.tools.key(e);
        return;
      }
      if (anyDialogOpen()) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      // active tools get the keys first (point input: X/Y/Z, B, typed coordinates, Enter, Tab …)
      if (this.tools.key(e)) { e.preventDefault(); return; }
      const name = e.key.length === 1 ? e.key.toUpperCase() : ({ Delete: 'Del' }[e.key] || e.key);
      let combo = (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + name;
      if (e.altKey && /^Digit[0-9]$/.test(e.code)) {
        const m = MODULES[(+e.code.slice(5) || 10) - 1];
        if (m) { e.preventDefault(); this.setTab(m.id); }
        return;
      }
      let c = keymap.get(combo.toUpperCase());
      if (!c && e.key === 'Delete') c = this.cmds.delete;
      if (c) { e.preventDefault(); c.run(); }
    });
    window.addEventListener('beforeunload', () => {
      try { localStorage.setItem('ts.model', JSON.stringify(store.model)); } catch (e) { /* ignore */ }
    });
  }
}
