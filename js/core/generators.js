// Parametric structure generators (pure – used by the generator dialog, the examples and tests).
import { t } from '../i18n.js';
import { createModel, addNode, addLine, addDomain, nextId, defaultLineElement, SUPPORT_PRESETS } from './model.js';
import { getLibraryMaterial } from '../lib/materials.js';
import { getLibrarySection, makeParametricSection } from '../lib/sections.js';
import { generateCombinations } from '../design/combinations.js';

/* ---------------- helpers working directly on a model ---------------- */
export function ensureMat(m, name) {
  const ex = m.materials.find((x) => x.name === name);
  if (ex) return ex.id;
  const tpl = getLibraryMaterial(name);
  const id = nextId(m.materials);
  m.materials.push(tpl ? { ...structuredClone(tpl), id } : { id, name, type: 'steel', E: 2.1e8, G: 8.1e7, nu: 0.3, rho: 7.85, alpha: 1.2e-5, fy: 235000, fu: 360000 });
  return id;
}
export function ensureSec(m, name, param) {
  const ex = m.sections.find((x) => x.name === name);
  if (ex) return ex.id;
  let tpl = param ? makeParametricSection(param.shape, param.dims) : getLibrarySection(name);
  if (!tpl) tpl = makeParametricSection('RECT', { h: 0.3, b: 0.3 });
  const id = nextId(m.sections);
  m.sections.push({ ...structuredClone(tpl), id, name });
  return id;
}
const rectName = (b, hh) => `RECT ${Math.round(b * 1000)}×${Math.round(hh * 1000)}`;
function rectSec(m, b, hh) { return ensureSec(m, rectName(b, hh), { shape: 'RECT', dims: { h: hh, b } }); }

function support(m, node, preset) {
  m.supports = m.supports.filter((s) => !(s.type === 'node' && s.node === node));
  m.supports.push({ id: nextId(m.supports), type: 'node', node, dofs: [...SUPPORT_PRESETS[preset]], uplift: false });
}
function ensureLC(m, name, groupType) {
  const ex = m.loadCases.find((x) => x.name === name);
  if (ex) return ex.id;
  let g = m.loadGroups.find((x) => x.type === groupType);
  if (!g) {
    const sia = m.settings.code === 'SIA';
    const p = { permanent: [1.35, sia ? 0.8 : 1, 1, 1, 1], variable: [1.5, 0, 0.7, 0.5, 0.3], snow: [1.5, 0, sia ? 0.6 : 0.5, sia ? 0.5 : 0.2, 0], wind: [1.5, 0, 0.6, sia ? 0.5 : 0.2, 0] }[groupType] || [1.5, 0, 0.7, 0.5, 0.3];
    g = { id: nextId(m.loadGroups), name: { permanent: t('Ständige Lasten'), variable: t('Nutzlasten'), snow: t('Schnee'), wind: t('Wind') }[groupType] || groupType, type: groupType, gammaSup: p[0], gammaInf: p[1], psi0: p[2], psi1: p[3], psi2: p[4], exclusive: groupType === 'wind' };
    m.loadGroups.push(g);
  }
  const id = nextId(m.loadCases);
  m.loadCases.push({ id, name, group: g.id, selfWeight: false });
  return id;
}
const selfWeightLC = (m) => {
  let lc = m.loadCases.find((x) => x.selfWeight);
  if (!lc) { const id = ensureLC(m, t('Eigengewicht'), 'permanent'); lc = m.loadCases.find((x) => x.id === id); lc.selfWeight = true; }
  return lc.id;
};
const lineLoad = (m, lc, line, q, dir = 'Z', projected = false) => m.loads.push({ id: nextId(m.loads), lc, type: 'lineDist', line, dir, q1: q, q2: q, a: 0, b: 1, projected });
const surfLoad = (m, lc, domain, q) => m.loads.push({ id: nextId(m.loads), lc, type: 'surface', domain, dir: 'Z', q, projected: false });
const nodeLoad = (m, lc, node, F) => m.loads.push({ id: nextId(m.loads), lc, type: 'node', node, F });

/* ---------------- generator definitions ---------------- */
export const GENERATORS = {
  frame: {
    label: '3D-Rahmen', icon: 'frame3d', desc: 'Räumlicher Stahl- oder Betonrahmen mit Stützen, Riegeln und optional Decken.',
    params: [
      ['nx', 'Felder in X', 3, null], ['Lx', 'Feldweite X', 6, 'len'], ['ny', 'Felder in Y', 2, null], ['Ly', 'Feldweite Y', 5, 'len'],
      ['ns', 'Geschosse', 3, null], ['H', 'Geschosshöhe', 3.5, 'len'],
      ['mat', 'Material', 'steel', 'choice', [['steel', 'Stahl S355'], ['concrete', 'Beton C30/37']]],
      ['base', 'Fusspunkte', 'fixed', 'choice', [['fixed', 'eingespannt'], ['pinned', 'gelenkig']]],
      ['slabs', 'Decken (Platten) erzeugen', false, 'bool'], ['q', 'Nutzlast', -3, 'areaLoad'],
    ],
    build(m, p) {
      const steel = p.mat === 'steel';
      const mat = ensureMat(m, steel ? 'S355' : 'C30/37');
      const col = steel ? ensureSec(m, 'HEB 240') : rectSec(m, 0.35, 0.35);
      const bm = steel ? ensureSec(m, 'IPE 360') : rectSec(m, 0.3, 0.55);
      const G = selfWeightLC(m), Q = ensureLC(m, t('Nutzlast'), 'variable');
      const N = (i, j, k) => addNode(m, [i * p.Lx, j * p.Ly, k * p.H]);
      for (let k = 0; k <= p.ns; k++) for (let i = 0; i <= p.nx; i++) for (let j = 0; j <= p.ny; j++) {
        const n = N(i, j, k);
        if (k === 0) { support(m, n, p.base); continue; }
        addLine(m, N(i, j, k - 1), n, defaultLineElement('beam', mat, col));
        if (i > 0) { const id = addLine(m, N(i - 1, j, k), n, defaultLineElement('beam', mat, bm)); if (!p.slabs) lineLoad(m, Q, id, p.q * p.Ly / 2 * (j > 0 && j < p.ny ? 2 : 1)); }
        if (j > 0) { const id = addLine(m, N(i, j - 1, k), n, defaultLineElement('beam', mat, bm)); if (!p.slabs) lineLoad(m, Q, id, p.q * p.Lx / 2 * (i > 0 && i < p.nx ? 2 : 1) * 0.5); }
      }
      if (p.slabs) {
        const cm = ensureMat(m, 'C30/37');
        for (let k = 1; k <= p.ns; k++) {
          const d = addDomain(m, [N(0, 0, k), N(p.nx, 0, k), N(p.nx, p.ny, k), N(0, p.ny, k)], { type: 'plate', material: cm, thickness: 0.22 });
          surfLoad(m, Q, d, p.q);
        }
        // grid lines inside the slab so beams are embedded in the plate mesh
      }
      m.settings.meshSize = Math.min(p.Lx, p.Ly) / 6;
    },
  },
  truss: {
    label: 'Fachwerk', icon: 'truss', desc: 'Ebener oder räumlicher Fachwerkträger (Pratt, Howe, Warren).',
    params: [
      ['L', 'Spannweite', 24, 'len'], ['Ht', 'Höhe', 3, 'len'], ['n', 'Felder (gerade)', 8, null],
      ['type', 'Typ', 'pratt', 'choice', [['pratt', 'Pratt'], ['howe', 'Howe'], ['warren', 'Warren']]],
      ['spatial', 'Räumlich (2 Träger + Verband)', false, 'bool'], ['B', 'Trägerabstand', 4, 'len'], ['F', 'Knotenlast Obergurt', -20, 'force'],
    ],
    build(m, p) {
      const mat = ensureMat(m, 'S355');
      const chord = ensureSec(m, 'HEA 200'), diag = ensureSec(m, 'CHS 114.3x5');
      const n = Math.max(2, Math.round(p.n / 2) * 2), dx = p.L / n;
      const G = selfWeightLC(m), Q = ensureLC(m, t('Nutzlast'), 'variable');
      const planes = p.spatial ? [0, p.B] : [0];
      const top = [], bot = [];
      planes.forEach((y, pi) => {
        bot[pi] = []; top[pi] = [];
        for (let i = 0; i <= n; i++) {
          bot[pi].push(addNode(m, [i * dx, y, 0]));
          top[pi].push(p.type === 'warren' ? (i < n ? addNode(m, [(i + 0.5) * dx, y, p.Ht]) : null) : addNode(m, [i * dx, y, p.Ht]));
        }
        const B = bot[pi], T = top[pi];
        for (let i = 0; i < n; i++) addLine(m, B[i], B[i + 1], defaultLineElement('beam', mat, chord));
        if (p.type === 'warren') {
          for (let i = 0; i < n - 1; i++) addLine(m, T[i], T[i + 1], defaultLineElement('beam', mat, chord));
          for (let i = 0; i < n; i++) { addLine(m, B[i], T[i], defaultLineElement('truss', mat, diag)); addLine(m, T[i], B[i + 1], defaultLineElement('truss', mat, diag)); }
          T.filter(Boolean).forEach((nd) => nodeLoad(m, Q, nd, [0, 0, p.F, 0, 0, 0]));
        } else {
          for (let i = 0; i < n; i++) addLine(m, T[i], T[i + 1], defaultLineElement('beam', mat, chord));
          // verticals: in the spatial variant they form stiff U-frames with the cross beams
          for (let i = 0; i <= n; i++) addLine(m, B[i], T[i], defaultLineElement(p.spatial ? 'beam' : 'truss', mat, p.spatial ? chord : diag));
          for (let i = 0; i < n; i++) {
            const left = i < n / 2;
            const pratt = p.type === 'pratt';
            if (left === pratt) addLine(m, T[i], B[i + 1], defaultLineElement('truss', mat, diag));
            else addLine(m, B[i], T[i + 1], defaultLineElement('truss', mat, diag));
          }
          for (let i = 1; i < n; i++) nodeLoad(m, Q, T[i], [0, 0, p.F, 0, 0, 0]);
        }
        support(m, B[0], 'pinned');
        support(m, B[n], p.spatial ? 'vertical' : 'rollerX');
        if (!p.spatial) {
          // stabilise out-of-plane
          for (const nd of [...B, ...T].filter(Boolean)) {
            if (!m.supports.some((s) => s.node === nd)) m.supports.push({ id: nextId(m.supports), type: 'node', node: nd, dofs: [0, 'F', 0, 'F', 0, 'F'], uplift: false });
          }
        }
      });
      if (p.spatial) {
        const brace = ensureSec(m, 'CHS 60.3x4');
        const T0 = top[0], T1 = top[1], B0 = bot[0], B1 = bot[1];
        for (let i = 0; i < T0.length; i++) if (T0[i]) addLine(m, T0[i], T1[i], defaultLineElement('beam', mat, diag));
        for (let i = 0; i <= n; i++) addLine(m, B0[i], B1[i], defaultLineElement('beam', mat, diag));
        for (let i = 0; i < n; i += 2) {
          if (T0[i] && T1[i + 1]) { addLine(m, T0[i], T1[i + 1], defaultLineElement('truss', mat, brace)); addLine(m, T1[i], T0[i + 1], defaultLineElement('truss', mat, brace)); }
        }
        m.supports = m.supports.filter((s) => s.node !== B0[n] && s.node !== B1[0] && s.node !== B1[n]);
        support(m, B0[n], 'rollerX'); support(m, B1[0], 'rollerY'); support(m, B1[n], 'vertical');
      }
    },
  },
  hall: {
    label: 'Halle', icon: 'hall', desc: 'Stahlhalle mit Zweigelenk-/eingespannten Rahmen, Pfetten, Wand- und Dachverbänden.',
    params: [
      ['span', 'Spannweite', 20, 'len'], ['nf', 'Anzahl Rahmen', 6, null], ['e', 'Rahmenabstand', 6, 'len'],
      ['he', 'Traufhöhe', 6, 'len'], ['hr', 'Firsthöhe', 8, 'len'],
      ['base', 'Fusspunkte', 'pinned', 'choice', [['fixed', 'eingespannt'], ['pinned', 'gelenkig']]],
      ['g', 'Dachaufbau', -0.5, 'areaLoad'], ['s', 'Schnee', -1.0, 'areaLoad'],
    ],
    build(m, p) {
      const mat = ensureMat(m, 'S355');
      const col = ensureSec(m, 'HEA 400'), raf = ensureSec(m, 'IPE 450'), pur = ensureSec(m, 'IPE 160'), strut = ensureSec(m, 'HEA 160'), brace = ensureSec(m, 'CHS 76.1x4');
      selfWeightLC(m);
      const Gr = ensureLC(m, t('Dachaufbau'), 'permanent'), S = ensureLC(m, t('Schnee'), 'snow');
      const ridge = [], eaveL = [], eaveR = [];
      // rafters are divided at the purlins (spacing ≈ 2.5 m) so each segment is laterally restrained
      const halfLen = Math.hypot(p.span / 2, p.hr - p.he);
      const np = Math.max(2, Math.round(halfLen / 2.5));
      const purlinRows = [];
      for (let f = 0; f < p.nf; f++) {
        const x = f * p.e;
        const b0 = addNode(m, [x, 0, 0]), b1 = addNode(m, [x, p.span, 0]);
        const e0 = addNode(m, [x, 0, p.he]), e1 = addNode(m, [x, p.span, p.he]), r = addNode(m, [x, p.span / 2, p.hr]);
        support(m, b0, p.base); support(m, b1, p.base);
        // columns turned by 90° so that the web lies in the frame plane (strong-axis bending)
        const colEl = () => ({ ...defaultLineElement('beam', mat, col), beta: 90, design: { Ky: 1, Kz: 1, KLT: 1, C1: 1.77, steelCheck: true } });
        addLine(m, b0, e0, colEl());
        addLine(m, b1, e1, colEl());
        const trib = f === 0 || f === p.nf - 1 ? p.e / 2 : p.e;
        const row = [];
        for (const [ya, za, yb, zb] of [[0, p.he, p.span / 2, p.hr], [p.span, p.he, p.span / 2, p.hr]]) {
          let prev = ya === 0 ? e0 : e1;
          for (let k = 1; k <= np; k++) {
            const s2 = k / np;
            const nd = k === np ? r : addNode(m, [x, ya + (yb - ya) * s2, za + (zb - za) * s2]);
            const id = addLine(m, prev, nd, defaultLineElement('beam', mat, raf));
            lineLoad(m, Gr, id, p.g * trib);
            lineLoad(m, S, id, p.s * trib, 'Z', true);
            if (k < np) row.push(nd);
            prev = nd;
          }
        }
        purlinRows.push([e0, e1, r, ...row]);
        ridge.push(r); eaveL.push(e0); eaveR.push(e1);
      }
      for (let f = 0; f < p.nf - 1; f++) {
        for (let k = 0; k < purlinRows[f].length; k++) {
          // eave and ridge rows act as struts of the bracing system → HEA 160, others IPE 160
          const el = defaultLineElement('beam', mat, k < 3 ? strut : pur);
          el.releases = { i: [false, false, false, false, true, true], j: [false, false, false, false, true, true] };
          addLine(m, purlinRows[f][k], purlinRows[f + 1][k], el);
        }
      }
      // bracing in end bays (tension-only X braces)
      for (const f of [0, p.nf - 2]) {
        if (f < 0) continue;
        const x0 = f * p.e, x1 = (f + 1) * p.e;
        const xb = (a, b) => { const el = defaultLineElement('truss', mat, brace); el.nl = 'tension'; addLine(m, a, b, el); };
        for (const y of [0, p.span]) {
          xb(addNode(m, [x0, y, 0]), addNode(m, [x1, y, p.he]));
          xb(addNode(m, [x1, y, 0]), addNode(m, [x0, y, p.he]));
        }
        xb(eaveL[f], ridge[f + 1]); xb(ridge[f], eaveL[f + 1]);
        xb(eaveR[f], ridge[f + 1]); xb(ridge[f], eaveR[f + 1]);
      }
    },
  },
  slab: {
    label: 'Decke', icon: 'slab', desc: 'Stahlbetonplatte auf Wänden (Linienlager) oder Stützen.',
    params: [
      ['Lx', 'Länge X', 12, 'len'], ['Ly', 'Breite Y', 8, 'len'], ['t', 'Dicke', 0.24, 'thick'],
      ['sup', 'Lagerung', 'edges', 'choice', [['edges', 'allseitig gelenkig'], ['two', 'zweiseitig'], ['columns', 'Stützenraster'], ['bedding', 'Bodenplatte (Bettung)']]],
      ['cx', 'Stützen in X', 3, null], ['cy', 'Stützen in Y', 2, null], ['q', 'Nutzlast', -3, 'areaLoad'], ['g', 'Belag', -1.5, 'areaLoad'],
    ],
    build(m, p) {
      const mat = ensureMat(m, 'C30/37');
      selfWeightLC(m);
      const G = ensureLC(m, t('Belag'), 'permanent'), Q = ensureLC(m, t('Nutzlast'), 'variable');
      const c = [addNode(m, [0, 0, 0]), addNode(m, [p.Lx, 0, 0]), addNode(m, [p.Lx, p.Ly, 0]), addNode(m, [0, p.Ly, 0])];
      const d = addDomain(m, c, { type: 'plate', material: mat, thickness: p.t, rc: { cover: 0.03, dia: 0.012, fyk: 500000 } });
      surfLoad(m, G, d, p.g); surfLoad(m, Q, d, p.q);
      const edge = (a, b) => m.lines.find((l) => (l.n1 === a && l.n2 === b) || (l.n1 === b && l.n2 === a)).id;
      const lineSup = (lid) => m.supports.push({ id: nextId(m.supports), type: 'line', line: lid, dofs: [0, 0, 'F', 0, 0, 0] });
      if (p.sup === 'edges') { for (let i = 0; i < 4; i++) lineSup(edge(c[i], c[(i + 1) % 4])); support(m, c[0], 'pinned'); m.supports.find((s) => s.node === c[0]).dofs = ['F', 'F', 'F', 0, 0, 0]; }
      if (p.sup === 'two') { lineSup(edge(c[0], c[3])); lineSup(edge(c[1], c[2])); }
      if (p.sup === 'columns') {
        const nx = Math.max(1, Math.round(p.cx)), ny = Math.max(1, Math.round(p.cy));
        for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
          const n = addNode(m, [i * p.Lx / nx, j * p.Ly / ny, 0]);
          m.supports.push({ id: nextId(m.supports), type: 'node', node: n, dofs: [i === 0 && j === 0 ? 'F' : 0, i === 0 && j === 0 ? 'F' : (i === nx && j === 0 ? 'F' : 0), 'F', 0, 0, 0], uplift: false, size: 0.45 });
        }
      }
      if (p.sup === 'bedding') {
        m.supports.push({ id: nextId(m.supports), type: 'surface', domain: d, k: [0, 0, 40000] });
        support(m, c[0], 'pinned'); m.supports.find((s) => s.node === c[0]).dofs = ['F', 'F', 0, 0, 0, 0];
        m.supports.push({ id: nextId(m.supports), type: 'node', node: c[1], dofs: [0, 'F', 0, 0, 0, 0], uplift: false });
      }
      m.settings.meshSize = Math.max(0.25, Math.min(p.Lx, p.Ly) / 16);
    },
  },
  building: {
    label: 'Gebäude', icon: 'building', desc: 'Mehrgeschossiger Massivbau: Flachdecken, Stützen und aussteifende Wände.',
    params: [
      ['nx', 'Felder in X', 3, null], ['Lx', 'Feldweite X', 6, 'len'], ['ny', 'Felder in Y', 2, null], ['Ly', 'Feldweite Y', 6, 'len'],
      ['ns', 'Geschosse', 4, null], ['H', 'Geschosshöhe', 3.2, 'len'], ['t', 'Deckenstärke', 0.25, 'thick'], ['tw', 'Wandstärke', 0.25, 'thick'],
      ['q', 'Nutzlast', -3, 'areaLoad'],
    ],
    build(m, p) {
      const mat = ensureMat(m, 'C30/37');
      const col = rectSec(m, 0.4, 0.4);
      selfWeightLC(m);
      const G = ensureLC(m, t('Ausbau'), 'permanent'), Q = ensureLC(m, t('Nutzlast'), 'variable');
      const N = (i, j, k) => addNode(m, [i * p.Lx, j * p.Ly, k * p.H]);
      const X = p.nx * p.Lx, Y = p.ny * p.Ly;
      for (let k = 0; k <= p.ns; k++) {
        for (let i = 0; i <= p.nx; i++) for (let j = 0; j <= p.ny; j++) {
          const n = N(i, j, k);
          if (k === 0) { support(m, n, 'fixed'); continue; }
          const wall = (i === 0 && j <= 1) || (i === p.nx && j >= p.ny - 1);
          if (!wall) addLine(m, N(i, j, k - 1), n, defaultLineElement('beam', mat, col));
        }
        if (k === 0) continue;
        // slab with column points inside (mesher inserts interior nodes)
        const d = addDomain(m, [addNode(m, [0, 0, k * p.H]), addNode(m, [X, 0, k * p.H]), addNode(m, [X, Y, k * p.H]), addNode(m, [0, Y, k * p.H])], { type: 'shell', material: mat, thickness: p.t, rc: { cover: 0.03, dia: 0.014, fyk: 500000 } });
        surfLoad(m, G, d, -1.5); surfLoad(m, Q, d, p.q);
        // walls (shear walls along Y at x = 0 and x = X)
        const w1 = addDomain(m, [N(0, 0, k - 1), N(0, 1, k - 1), N(0, 1, k), N(0, 0, k)], { type: 'shell', material: mat, thickness: p.tw });
        const w2 = addDomain(m, [N(p.nx, p.ny - 1, k - 1), N(p.nx, p.ny, k - 1), N(p.nx, p.ny, k), N(p.nx, p.ny - 1, k)], { type: 'shell', material: mat, thickness: p.tw });
        void w1; void w2;
      }
      // line supports under ground floor walls
      for (const [a, b] of [[N(0, 0, 0), N(0, 1, 0)], [N(p.nx, p.ny - 1, 0), N(p.nx, p.ny, 0)]]) {
        const l = m.lines.find((x) => (x.n1 === a && x.n2 === b) || (x.n1 === b && x.n2 === a));
        if (l) m.supports.push({ id: nextId(m.supports), type: 'line', line: l.id, dofs: ['F', 'F', 'F', 0, 0, 0] });
      }
      m.settings.meshSize = Math.min(p.Lx, p.Ly) / 6;
    },
  },
  shell: {
    label: 'Kuppel / Schale', icon: 'dome', desc: 'Zylinderschale (Tonnendach), Kugelkuppel oder Silo aus Schalenelementen.',
    params: [
      ['form', 'Form', 'barrel', 'choice', [['barrel', 'Zylinderschale'], ['dome', 'Kuppel'], ['silo', 'Silo']]],
      ['R', 'Radius', 10, 'len'], ['L', 'Länge / Höhe', 20, 'len'], ['ang', 'Öffnungswinkel', 80, 'angle'],
      ['n1', 'Teilung Umfang', 12, null], ['n2', 'Teilung Länge', 8, null], ['t', 'Dicke', 0.12, 'thick'], ['q', 'Last (Schnee)', -1, 'areaLoad'],
    ],
    build(m, p) {
      const mat = ensureMat(m, 'C30/37');
      selfWeightLC(m);
      const S = ensureLC(m, t('Schnee'), 'snow');
      const n1 = Math.max(3, Math.round(p.n1)), n2 = Math.max(1, Math.round(p.n2));
      const quad = (a, b, c, d) => { const id = addDomain(m, [a, b, c, d], { type: 'shell', material: mat, thickness: p.t }); m.loads.push({ id: nextId(m.loads), lc: S, type: 'surface', domain: id, dir: 'Z', q: p.q, projected: true }); return id; };
      if (p.form === 'barrel') {
        const phi = p.ang * Math.PI / 180;
        const P = (i, j) => { const a = -phi / 2 + phi * i / n1; return addNode(m, [p.L * j / n2, p.R * Math.sin(a), p.R * Math.cos(a) - p.R * Math.cos(phi / 2)]); };
        for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
        // edge beams along the free longitudinal edges (they carry the shell like a beam)
        const edge = rectSec(m, 0.3, 0.9);
        for (const i of [0, n1]) for (let j = 0; j < n2; j++) addLine(m, P(i, j), P(i, j + 1), { ...defaultLineElement('rib', mat, edge), divisions: 2 });
        for (let i = 0; i <= n1; i++) { support(m, P(i, 0), 'pinned'); support(m, P(i, n2), 'pinned'); m.supports.at(-1).dofs = [0, 'F', 'F', 0, 0, 0]; }
      } else if (p.form === 'dome') {
        const phiMax = Math.min(90, p.ang) * Math.PI / 180;
        const P = (i, j) => {
          const th = 2 * Math.PI * (i % n1) / n1, ph = phiMax * j / n2;
          return addNode(m, [p.R * Math.sin(ph) * Math.cos(th), p.R * Math.sin(ph) * Math.sin(th), p.R * Math.cos(ph) - p.R * Math.cos(phiMax)]);
        };
        const top = P(0, 0);
        for (let i = 0; i < n1; i++) {
          const a = P(i, 1), b = P(i + 1, 1);
          const id = addDomain(m, [top, a, b], { type: 'shell', material: mat, thickness: p.t });
          m.loads.push({ id: nextId(m.loads), lc: S, type: 'surface', domain: id, dir: 'Z', q: p.q, projected: true });
          for (let j = 1; j < n2; j++) quad(P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j));
          support(m, P(i, n2), 'pinned');
        }
      } else {
        const P = (i, j) => { const th = 2 * Math.PI * (i % n1) / n1; return addNode(m, [p.R * Math.cos(th), p.R * Math.sin(th), p.L * j / n2]); };
        for (let i = 0; i < n1; i++) { for (let j = 0; j < n2; j++) quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)); support(m, P(i, 0), 'fixed'); }
        m.loads = m.loads.filter((l) => l.lc !== S);
      }
      m.settings.meshSize = Math.max(0.3, p.R * 0.15);
    },
  },
};

export function buildGenerated(type, params, model) {
  const m = model || createModel();
  GENERATORS[type].build(m, params);
  return m;
}

export function addCombos(m) {
  try {
    const list = generateCombinations(m, { code: m.settings.code, uls: '6.10', sls: true });
    m.combinations = [];
    for (const c of list || []) m.combinations.push({ ...c, id: nextId(m.combinations) });
  } catch (e) { console.warn('combinations', e); }
}
