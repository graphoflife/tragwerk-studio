// Table browser: editable input tables and result tables with sorting, filtering and CSV export.
import { t } from '../../i18n.js';
import { h, ic, clear, openDialog, selectInput, toast, download, checkInput, evalExpr } from '../dom.js';
import { P, lineLength, polygonArea } from '../../core/model.js';
import { fmt, fmtNum, toDisplay, fromDisplay, unitLabel } from '../../core/units.js';
import { caseOptions, getCase, caseLabel } from '../results-data.js';
import { lineForces } from '../../fem/index.js';
import { describeLoad } from './loads.js';

const TYPE = { beam: 'Balken', truss: 'Fachwerk', rib: 'Rippe', rigid: 'Starr', spring: 'Feder', plate: 'Platte', shell: 'Schale', membrane: 'Scheibe' };

function defs(app) {
  const st = app.store, m = st.model, idx = st.idx;
  const R = st.results;
  const mat = (id) => idx.materials.get(id)?.name || '–';
  const sec = (id) => idx.sections.get(id)?.name || '–';
  const editNode = (k) => (row, v) => st.commit(t('Knoten bearbeiten'), (mm) => { mm.nodes.find((n) => n.id === row.id)[k] = v; });
  const out = [];
  out.push({ group: t('Eingabe') });
  out.push({ id: 'nodes', label: t('Knoten'), icon: 'node', count: m.nodes.length,
    cols: [{ k: 'id', l: '#' }, { k: 'x', l: 'X', q: 'len', edit: editNode('x') }, { k: 'y', l: 'Y', q: 'len', edit: editNode('y') }, { k: 'z', l: 'Z', q: 'len', edit: editNode('z') }, { k: 'sup', l: t('Lager'), txt: true }],
    rows: () => m.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z, sup: m.supports.find((s) => s.type === 'node' && s.node === n.id) ? '●' : '', _sel: { nodes: [n.id] } })) });
  out.push({ id: 'lines', label: t('Linien / Stäbe'), icon: 'beam', count: m.lines.length,
    cols: [{ k: 'id', l: '#' }, { k: 'n1', l: t('Knoten i') }, { k: 'n2', l: t('Knoten j') }, { k: 'type', l: t('Typ'), txt: true }, { k: 'mat', l: t('Material'), txt: true }, { k: 'sec', l: t('Querschnitt'), txt: true },
      { k: 'beta', l: 'β', q: 'angle', edit: (row, v) => st.commit(t('Drehwinkel'), (mm) => { const l = mm.lines.find((x) => x.id === row.id); if (l.element) l.element.beta = v; }) }, { k: 'L', l: t('Länge'), q: 'len' }],
    rows: () => m.lines.map((l) => ({ id: l.id, n1: l.n1, n2: l.n2, type: t(TYPE[l.element?.type] || 'Geometrie'), mat: l.element ? mat(l.element.material) : '', sec: l.element ? sec(l.element.section) : '', beta: l.element?.beta ?? 0, L: lineLength(m, idx, l), _sel: { lines: [l.id] } })) });
  out.push({ id: 'domains', label: t('Flächen'), icon: 'domain', count: m.domains.length,
    cols: [{ k: 'id', l: '#' }, { k: 'type', l: t('Typ'), txt: true }, { k: 'mat', l: t('Material'), txt: true },
      { k: 't', l: t('Dicke'), q: 'thick', edit: (row, v) => st.commit(t('Dicke'), (mm) => { mm.domains.find((d) => d.id === row.id).thickness = v; }) },
      { k: 'A', l: t('Fläche'), u: 'm²' }, { k: 'nodes', l: t('Eckknoten'), txt: true }],
    rows: () => m.domains.map((d) => ({ id: d.id, type: t(TYPE[d.type]), mat: mat(d.material), t: d.thickness, A: polygonArea(d.nodes.map((n) => P(idx.nodes.get(n)))), nodes: d.nodes.join(', '), _sel: { domains: [d.id] } })) });
  out.push({ id: 'materials', label: t('Materialien'), icon: 'material', count: m.materials.length,
    cols: [{ k: 'id', l: '#' }, { k: 'name', l: 'Name', txt: true }, { k: 'type', l: t('Typ'), txt: true }, { k: 'E', l: 'E', q: 'modulus' }, { k: 'nu', l: 'ν' }, { k: 'rho', l: 'ρ', q: 'density' }, { k: 'f', l: 'fy / fck / fm,k', q: 'stress' }],
    rows: () => m.materials.map((x) => ({ id: x.id, name: x.name, type: x.type, E: x.E, nu: x.nu, rho: x.rho, f: x.fy ?? x.fck ?? x.timber?.fmk })) });
  out.push({ id: 'sections', label: t('Querschnitte'), icon: 'section', count: m.sections.length,
    cols: [{ k: 'id', l: '#' }, { k: 'name', l: 'Name', txt: true }, { k: 'A', l: 'A', q: 'area' }, { k: 'Iy', l: 'Iy', q: 'inertia' }, { k: 'Iz', l: 'Iz', q: 'inertia' }, { k: 'It', l: 'It', q: 'inertia' }, { k: 'Wply', l: 'Wpl,y', q: 'secMod' }, { k: 'Wplz', l: 'Wpl,z', q: 'secMod' }],
    rows: () => m.sections.map((s) => ({ ...s })) });
  out.push({ id: 'supports', label: t('Lager'), icon: 'supportPin', count: m.supports.length,
    cols: [{ k: 'id', l: '#' }, { k: 'type', l: t('Typ'), txt: true }, { k: 'ref', l: t('Objekt') }, ...['uX', 'uY', 'uZ', 'φX', 'φY', 'φZ'].map((l, i) => ({ k: 'd' + i, l, txt: true }))],
    rows: () => m.supports.map((s) => {
      const r = { id: s.id, type: s.type === 'node' ? t('Knoten') : s.type === 'line' ? t('Linie') : t('Fläche'), ref: s.node ?? s.line ?? s.domain };
      const d = s.dofs || [s.k?.[0] ?? 0, s.k?.[1] ?? 0, s.k?.[2] ?? 0, '', '', ''];
      d.forEach((v, i) => { r['d' + i] = v === 'F' ? t('fest') : v ? fmtNum(v) : '–'; });
      return r;
    }) });
  out.push({ id: 'loadcases', label: t('Lastfälle'), icon: 'loadCase', count: m.loadCases.length,
    cols: [{ k: 'id', l: '#' }, { k: 'name', l: 'Name', txt: true }, { k: 'group', l: t('Gruppe'), txt: true }, { k: 'sw', l: t('Eigengewicht'), txt: true }, { k: 'n', l: t('Lasten') }],
    rows: () => m.loadCases.map((lc) => ({ id: lc.id, name: lc.name, group: idx.loadGroups.get(lc.group)?.name || '–', sw: lc.selfWeight ? '✓' : '', n: m.loads.filter((l) => l.lc === lc.id).length })) });
  out.push({ id: 'loads', label: t('Lasten'), icon: 'loadNode', count: m.loads.length,
    cols: [{ k: 'id', l: '#' }, { k: 'lc', l: t('Lastfall'), txt: true }, { k: 'type', l: t('Typ'), txt: true }, { k: 'desc', l: t('Beschreibung'), txt: true }],
    rows: () => m.loads.map((l) => ({ id: l.id, lc: idx.loadCases.get(l.lc)?.name || l.lc, type: l.type, desc: describeLoad(app, l), _sel: l.node ? { nodes: [l.node] } : l.line ? { lines: [l.line] } : l.domain ? { domains: [l.domain] } : null })) });
  out.push({ id: 'combos', label: t('Kombinationen'), icon: 'combination', count: m.combinations.length,
    cols: [{ k: 'id', l: '#' }, { k: 'type', l: t('Typ'), txt: true }, { k: 'name', l: 'Name', txt: true }],
    rows: () => m.combinations.map((c) => ({ id: c.id, type: c.type, name: c.name })) });

  const mesh = R.mesh;
  if (R.static && mesh) {
    out.push({ group: t('Ergebnisse Statik'), needsCase: true });
    const modelNodes = () => {
      const list = [];
      const nn = mesh.nodes.length / 3;
      for (let i = 0; i < nn; i++) if (mesh.nodeModelId[i] > 0) list.push(i);
      return list;
    };
    out.push({ id: 'disp', label: t('Knotenverschiebungen'), icon: 'deformed', needsCase: true,
      cols: [{ k: 'id', l: t('Knoten') }, { k: 'ex', l: 'eX', q: 'disp' }, { k: 'ey', l: 'eY', q: 'disp' }, { k: 'ez', l: 'eZ', q: 'disp' }, { k: 'er', l: 'eR', q: 'disp' }, { k: 'fx', l: 'φX', q: 'rot' }, { k: 'fy', l: 'φY', q: 'rot' }, { k: 'fz', l: 'φZ', q: 'rot' }],
      rows: (c) => modelNodes().map((i) => {
        const d = (c.res || c.max).disp;
        return { id: mesh.nodeModelId[i], ex: d[6 * i], ey: d[6 * i + 1], ez: d[6 * i + 2], er: Math.hypot(d[6 * i], d[6 * i + 1], d[6 * i + 2]), fx: d[6 * i + 3], fy: d[6 * i + 4], fz: d[6 * i + 5], _sel: { nodes: [mesh.nodeModelId[i]] } };
      }) });
    out.push({ id: 'reac', label: t('Auflagerkräfte'), icon: 'reactions', needsCase: true,
      cols: [{ k: 'id', l: t('Knoten') }, { k: 'rx', l: 'Rx', q: 'force' }, { k: 'ry', l: 'Ry', q: 'force' }, { k: 'rz', l: 'Rz', q: 'force' }, { k: 'mx', l: 'Mx', q: 'moment' }, { k: 'my', l: 'My', q: 'moment' }, { k: 'mz', l: 'Mz', q: 'moment' }],
      rows: (c) => {
        const r = (c.res || c.max).reac, list = [];
        const nn = mesh.nodes.length / 3;
        const sum = [0, 0, 0, 0, 0, 0];
        for (let i = 0; i < nn; i++) {
          const v = r.slice(6 * i, 6 * i + 6);
          if (v.every((x) => Math.abs(x) < 1e-9)) continue;
          v.forEach((x, k) => { sum[k] += x; });
          list.push({ id: mesh.nodeModelId[i] || `FE ${i}`, rx: v[0], ry: v[1], rz: v[2], mx: v[3], my: v[4], mz: v[5], _sel: mesh.nodeModelId[i] ? { nodes: [mesh.nodeModelId[i]] } : null });
        }
        if (c.res) list.push({ id: 'Σ', rx: sum[0], ry: sum[1], rz: sum[2], mx: null, my: null, mz: null, _sum: true });
        return list;
      } });
    out.push({ id: 'beamExt', label: t('Stab-Extremwerte'), icon: 'diagram', needsCase: true,
      cols: [{ k: 'id', l: t('Stab') }, { k: 'sec', l: t('Querschnitt'), txt: true }, { k: 'Nmin', l: 'N min', q: 'force' }, { k: 'Nmax', l: 'N max', q: 'force' }, { k: 'Vz', l: '|Vz| max', q: 'force' }, { k: 'Vy', l: '|Vy| max', q: 'force' }, { k: 'T', l: '|T| max', q: 'moment' }, { k: 'Mymin', l: 'My min', q: 'moment' }, { k: 'Mymax', l: 'My max', q: 'moment' }, { k: 'Mz', l: '|Mz| max', q: 'moment' }],
      rows: (c) => {
        const out2 = [];
        for (const l of m.lines) {
          if (!l.element || !['beam', 'truss', 'rib'].includes(l.element.type)) continue;
          const sets = c.res ? [c.res] : [c.min, c.max];
          const agg = { Nmin: Infinity, Nmax: -Infinity, Vz: 0, Vy: 0, T: 0, Mymin: Infinity, Mymax: -Infinity, Mz: 0 };
          let ok = false;
          for (const r of sets) {
            let f;
            try { f = lineForces(mesh, r, l.id); } catch (e) { f = null; }
            if (!f?.x?.length) continue;
            ok = true;
            for (let k = 0; k < f.x.length; k++) {
              agg.Nmin = Math.min(agg.Nmin, f.N[k]); agg.Nmax = Math.max(agg.Nmax, f.N[k]);
              agg.Vz = Math.max(agg.Vz, Math.abs(f.Vz[k])); agg.Vy = Math.max(agg.Vy, Math.abs(f.Vy[k])); agg.T = Math.max(agg.T, Math.abs(f.T[k]));
              agg.Mymin = Math.min(agg.Mymin, f.My[k]); agg.Mymax = Math.max(agg.Mymax, f.My[k]); agg.Mz = Math.max(agg.Mz, Math.abs(f.Mz[k]));
            }
          }
          if (ok) out2.push({ id: l.id, sec: sec(l.element.section), ...agg, _sel: { lines: [l.id] } });
        }
        return out2;
      } });
    out.push({ id: 'beamForces', label: t('Stabschnittgrössen (Verlauf)'), icon: 'diagram', needsCase: true,
      cols: [{ k: 'id', l: t('Stab') }, { k: 'x', l: 'x', q: 'len' }, { k: 'N', l: 'N', q: 'force' }, { k: 'Vy', l: 'Vy', q: 'force' }, { k: 'Vz', l: 'Vz', q: 'force' }, { k: 'T', l: 'T', q: 'moment' }, { k: 'My', l: 'My', q: 'moment' }, { k: 'Mz', l: 'Mz', q: 'moment' }],
      rows: (c) => {
        const r = c.res || c.max, rows = [];
        const sel = st.selection.lines;
        for (const l of m.lines) {
          if (!l.element || !['beam', 'truss', 'rib'].includes(l.element.type)) continue;
          if (sel.size && !sel.has(l.id)) continue;
          let f;
          try { f = lineForces(mesh, r, l.id); } catch (e) { continue; }
          const step = Math.max(1, Math.floor(f.x.length / 11));
          for (let k = 0; k < f.x.length; k += step) rows.push({ id: l.id, x: f.x[k], N: f.N[k], Vy: f.Vy[k], Vz: f.Vz[k], T: f.T[k], My: f.My[k], Mz: f.Mz[k], _sel: { lines: [l.id] } });
          if (rows.length > 20000) break;
        }
        return rows;
      } });
    if (mesh.shells.length) {
      out.push({ id: 'shell', label: t('Flächenschnittgrössen'), icon: 'contour', needsCase: true,
        cols: [{ k: 'id', l: t('Element') }, { k: 'dom', l: t('Fläche') }, ...['nx', 'ny', 'nxy'].map((k) => ({ k, l: k, q: 'lineForce' })), ...['mx', 'my', 'mxy'].map((k) => ({ k, l: k, q: 'lineMoment' })), ...['vx', 'vy'].map((k) => ({ k, l: k, q: 'lineForce' }))],
        rows: (c) => {
          const A = (c.res || c.max).shells;
          return mesh.shells.map((s, e) => {
            const v = [0, 0, 0, 0, 0, 0, 0, 0];
            for (let k = 0; k < 4; k++) for (let q = 0; q < 8; q++) v[q] += A[(e * 4 + k) * 8 + q] / 4;
            return { id: e + 1, dom: s.domain, nx: v[0], ny: v[1], nxy: v[2], mx: v[3], my: v[4], mxy: v[5], vx: v[6], vy: v[7], _sel: { domains: [s.domain] } };
          });
        } });
    }
  }
  if (R.modal) {
    out.push({ group: t('Dynamik & Stabilität') });
    out.push({ id: 'modes', label: t('Eigenfrequenzen'), icon: 'vibration',
      cols: [{ k: 'id', l: t('Form') }, { k: 'f', l: 'f', u: 'Hz' }, { k: 'T', l: 'T', u: 's' }, { k: 'w', l: 'ω', u: 'rad/s' }, { k: 'mx', l: 'mX', u: '%' }, { k: 'my', l: 'mY', u: '%' }, { k: 'mz', l: 'mZ', u: '%' }],
      rows: () => R.modal.modes.map((md, i) => ({ id: i + 1, f: md.f, T: md.T, w: md.omega, mx: (md.effMass?.[0] ?? 0) * 100, my: (md.effMass?.[1] ?? 0) * 100, mz: (md.effMass?.[2] ?? 0) * 100 })) });
  }
  if (R.buckling) {
    if (!R.modal) out.push({ group: t('Dynamik & Stabilität') });
    out.push({ id: 'buck', label: t('Knicklastfaktoren'), icon: 'buckling',
      cols: [{ k: 'id', l: t('Form') }, { k: 'a', l: 'αcr' }], rows: () => R.buckling.modes.map((md, i) => ({ id: i + 1, a: md.lambda })) });
  }
  const util = (key, label, icon) => {
    out.push({ id: key, label, icon,
      cols: [{ k: 'id', l: t('Stab') }, { k: 'eta', l: 'η', u: '%' }, { k: 'gov', l: t('massgebend'), txt: true }, { k: 'case', l: t('Kombination'), txt: true }, { k: 'cls', l: t('Klasse'), txt: true }],
      rows: () => R[key].map((r) => ({ id: r.line, eta: (r.eta ?? 0) * 100, gov: r.governing?.check || '', case: caseLabel(st, r.governing?.caseKey), cls: r.cls ?? '', _sel: { lines: [r.line] } })) });
  };
  if (R.steel || R.timber || R.rcBeams) out.push({ group: t('Bemessung') });
  if (R.steel) util('steel', t('Stahlnachweise'), 'steel');
  if (R.timber) util('timber', t('Holznachweise'), 'timber');
  if (R.rcBeams) {
    out.push({ id: 'rcb', label: t('Betonbalken'), icon: 'concrete',
      cols: [{ k: 'id', l: t('Stab') }, { k: 'bot', l: 'As unten max', q: 'reinfBeam' }, { k: 'top', l: 'As oben max', q: 'reinfBeam' }, { k: 'sw', l: 'asw max', q: 'reinf' }, { k: 'ok', l: 'OK', txt: true }],
      rows: () => R.rcBeams.map((b) => ({ id: b.line, bot: Math.max(0, ...b.AsBot), top: Math.max(0, ...b.AsTop), sw: Math.max(0, ...b.Asw), ok: b.ok === false ? '✗' : '✓', _sel: { lines: [b.line] } })) });
  }
  return out;
}

export function openTables(app, initial) {
  const st = app.store;
  let tables = defs(app);
  let cur = initial || 'nodes';
  let sort = { k: null, dir: 1 };
  let onlySel = false;
  let caseKey = st.resultView.caseKey || caseOptions(st)[0]?.options[0]?.value;
  const nav = h('div.tables-nav');
  const main = h('div.tables-main');
  let lastRows = [], lastDef = null;

  const render = () => {
    tables = defs(app);
    clear(nav);
    for (const d of tables) {
      if (d.group) { nav.appendChild(h('div.menu-title', d.group)); continue; }
      nav.appendChild(h('button.list-item' + (d.id === cur ? '.active' : ''), { onclick: () => { cur = d.id; sort = { k: null, dir: 1 }; render(); } }, ic(d.icon), h('span.t', d.label), d.count != null ? h('span.meta', String(d.count)) : null));
    }
    const def = tables.find((d) => d.id === cur) || tables.find((d) => d.cols);
    lastDef = def;
    clear(main);
    const bar = h('div.row', { style: { flexWrap: 'wrap' } }, h('h3', { style: { margin: 0, fontSize: '16px' } }, def.label));
    if (def.needsCase) {
      const sel = selectInput({ value: caseKey, options: caseOptions(st), small: true, onChange: (v) => { caseKey = v; render(); } });
      sel.style.width = '260px';
      bar.appendChild(sel);
    }
    bar.append(h('span.grow'), checkInput(t('Nur Auswahl'), onlySel, (v) => { onlySel = v; render(); }),
      h('button.btn.sm', { onclick: () => copyTable() }, ic('clipboard'), t('Kopieren')),
      h('button.btn.sm', { onclick: () => exportCsv() }, ic('download'), 'CSV'));
    main.appendChild(bar);
    let rows;
    try {
      if (def.needsCase) {
        const c = getCase(st, caseKey);
        rows = c ? def.rows(c) : [];
        if (c?.env) main.appendChild(h('div.small.muted', t('Umhüllende: es werden die Maximalwerte gezeigt.')));
      } else rows = def.rows();
    } catch (e) { console.error(e); rows = []; main.appendChild(h('div.hint-box.err', ic('alert'), e.message)); }
    if (onlySel) {
      rows = rows.filter((r) => r._sel && Object.entries(r._sel).some(([k, ids]) => ids.some((id) => st.selection[k].has(id))));
    }
    if (sort.k) rows = [...rows].sort((a, b) => { const x = a[sort.k], y = b[sort.k]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir; });
    lastRows = rows;
    const tbl = h('table.tbl');
    const head = h('tr');
    for (const c of def.cols) {
      head.appendChild(h('th' + (c.txt ? '.txt' : ''), { onclick: () => { sort = { k: c.k, dir: sort.k === c.k ? -sort.dir : 1 }; render(); } },
        c.l + (sort.k === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''), (c.q || c.u) ? h('span.u', c.q ? unitLabel(c.q) : c.u) : null));
    }
    tbl.appendChild(head);
    // maxima per numeric column
    const maxAbs = {};
    for (const c of def.cols) if (!c.txt && c.k !== 'id') maxAbs[c.k] = Math.max(0, ...rows.filter((r) => !r._sum).map((r) => (typeof r[c.k] === 'number' && Number.isFinite(r[c.k]) ? Math.abs(r[c.k]) : 0)));
    const LIMIT = 3000;
    for (const r of rows.slice(0, LIMIT)) {
      const tr = h('tr' + (r._sel && Object.entries(r._sel).some(([k, ids]) => ids.some((id) => st.selection[k].has(id))) ? '.sel' : ''));
      if (r._sel) tr.addEventListener('click', (e) => { if (e.target.tagName === 'INPUT') return; st.select(r._sel, e.shiftKey || e.ctrlKey ? 'toggle' : 'replace'); tr.parentNode.querySelectorAll('tr.sel').forEach((x) => x.classList.remove('sel')); tr.classList.add('sel'); });
      for (const c of def.cols) {
        const v = r[c.k];
        const s = v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '–' : typeof v === 'number' ? (c.q ? fmtNum(toDisplay(c.q, v)) : fmtNum(v)) : String(v);
        const td = h('td' + (c.txt ? '.txt' : '') + (c.edit ? '.edit' : '') + (typeof v === 'number' && v < 0 ? '.neg' : '') + (maxAbs[c.k] && typeof v === 'number' && Math.abs(v) === maxAbs[c.k] && !r._sum ? '.max' : ''), s);
        if (r._sum) td.style.fontWeight = '700';
        if (c.edit) {
          td.addEventListener('dblclick', () => {
            const inp = h('input', { value: s === '–' ? '' : s });
            clear(td).appendChild(inp);
            inp.focus(); inp.select();
            const done = (save) => {
              if (save) {
                const x = evalExpr(inp.value.replace(',', '.'));
                if (x != null) { c.edit(r, c.q ? fromDisplay(c.q, x) : x); tables = defs(app); }
              }
              render();
            };
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
            inp.addEventListener('blur', () => done(true));
          });
        }
        tr.appendChild(td);
      }
      tbl.appendChild(tr);
    }
    const wrap = h('div.tbl-wrap', tbl);
    main.appendChild(wrap);
    main.appendChild(h('div.small.muted', rows.length > LIMIT ? t('{n} Zeilen – die ersten {l} werden angezeigt (CSV enthält alle).', { n: rows.length, l: LIMIT }) : t('{n} Zeilen', { n: rows.length }) + (def.cols.some((c) => c.edit) ? ' · ' + t('Doppelklick auf blaue Zellen zum Bearbeiten') : '')));
  };

  const asText = (sep) => {
    const def = lastDef;
    const head = def.cols.map((c) => c.l + ((c.q || c.u) ? ` [${c.q ? unitLabel(c.q) : c.u}]` : '')).join(sep);
    const lines = lastRows.map((r) => def.cols.map((c) => {
      const v = r[c.k];
      if (v == null) return '';
      if (typeof v === 'number') return String(c.q ? +toDisplay(c.q, v).toPrecision(8) : +v.toPrecision(8));
      return sep === ';' && String(v).includes(';') ? `"${v}"` : String(v);
    }).join(sep));
    return [head, ...lines].join('\n');
  };
  const exportCsv = () => download(`${lastDef.id}.csv`, '﻿' + asText(';'), 'text/csv');
  const copyTable = async () => {
    try { await navigator.clipboard.writeText(asText('\t')); toast(t('Tabelle in die Zwischenablage kopiert (für Excel).'), 'ok'); } catch (e) { toast(t('Kopieren nicht möglich.'), 'warn'); }
  };
  render();
  openDialog({
    title: t('Tabellen'), sub: st.model.meta.name, iconName: 'table', mod: 'slate', size: 'xwide',
    body: h('div.tables-layout', nav, main),
    buttons: [{ label: t('Schliessen'), kind: 'primary' }],
  });
  void fmt; void caseLabel;
}
