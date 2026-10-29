// Ready-made example models (built programmatically, so they always match the current data format).
import { t } from './i18n.js';
import { createModel, addNode, addLine, nextId, defaultLineElement, SUPPORT_PRESETS } from './core/model.js';
import { GENERATORS, ensureMat, ensureSec, addCombos } from './core/generators.js';

function base(name, desc) {
  const m = createModel(name);
  m.meta.description = desc;
  m.loadCases = []; m.loadGroups = []; m.combinations = [];
  return m;
}
function group(m, name, type, p) {
  const id = nextId(m.loadGroups);
  m.loadGroups.push({ id, name, type, gammaSup: p[0], gammaInf: p[1], psi0: p[2], psi1: p[3], psi2: p[4], exclusive: !!p[5] });
  return id;
}
function lc(m, name, grp, selfWeight = false) {
  const id = nextId(m.loadCases);
  m.loadCases.push({ id, name, group: grp, selfWeight });
  return id;
}
const sup = (m, node, preset, extra = {}) => m.supports.push({ id: nextId(m.supports), type: 'node', node, dofs: [...(Array.isArray(preset) ? preset : SUPPORT_PRESETS[preset])], uplift: false, ...extra });
const ld = (m, o) => m.loads.push({ id: nextId(m.loads), ...o });
const stdGroups = (m) => ({
  G: group(m, t('Ständige Lasten'), 'permanent', [1.35, 1.0, 1, 1, 1]),
  Q: group(m, t('Nutzlasten'), 'variable', [1.5, 0, 0.7, 0.5, 0.3]),
  S: group(m, t('Schnee'), 'snow', [1.5, 0, 0.5, 0.2, 0]),
  W: group(m, t('Wind'), 'wind', [1.5, 0, 0.6, 0.2, 0, true]),
});

function gen(type, name, params, desc) {
  const m = base(name, desc);
  GENERATORS[type].build(m, params);
  addCombos(m);
  return m;
}

export const EXAMPLES = [
  {
    id: 'beam', name: 'Einfeldträger', icon: 'beam', mod: 'sky', view: 'front', tags: ['Stab', 'Einstieg'],
    desc: 'IPE 300 aus S235, 6 m, Gleichlast – ideal zum Kennenlernen.',
    build() {
      const m = base(t('Einfeldträger IPE 300'), t('Einfeldträger mit Gleichlast. Erwartet: My = qL²/8, w = 5qL⁴/384EI.'));
      const g = stdGroups(m);
      const G = lc(m, t('Eigengewicht + Ausbau'), g.G, true), Q = lc(m, t('Nutzlast'), g.Q);
      const mat = ensureMat(m, 'S235'), sec = ensureSec(m, 'IPE 300');
      const a = addNode(m, [0, 0, 0]), b = addNode(m, [6, 0, 0]);
      const l = addLine(m, a, b, defaultLineElement('beam', mat, sec));
      m.lines[0].element.design = { Ky: 1, Kz: 1, KLT: 1, C1: 1.13, steelCheck: true };
      sup(m, a, 'pinned'); sup(m, b, [0, 'F', 'F', 'F', 0, 0]);
      ld(m, { lc: G, type: 'lineDist', line: l, dir: 'Z', q1: -5, q2: -5, a: 0, b: 1, projected: false });
      ld(m, { lc: Q, type: 'lineDist', line: l, dir: 'Z', q1: -6, q2: -6, a: 0, b: 1, projected: false });
      m.settings.beamDivisions = 8;
      addCombos(m);
      return m;
    },
  },
  {
    id: 'continuous', name: 'Durchlaufträger', icon: 'loadTrap', mod: 'sky', view: 'front', tags: ['Stab', 'Kombinationen'],
    desc: 'Dreifeldträger HEA 300 mit Gleichlast, Einzellasten und feldweiser Nutzlast.',
    build() {
      const m = base(t('Dreifeldträger HEA 300'), t('Durchlaufträger mit feldweise angeordneter Nutzlast – zeigt Umhüllende.'));
      const g = stdGroups(m);
      const G = lc(m, t('Eigengewicht'), g.G, true);
      const Qs = [1, 2, 3].map((i) => lc(m, t('Nutzlast Feld {n}', { n: i }), g.Q));
      const mat = ensureMat(m, 'S355'), sec = ensureSec(m, 'HEA 300');
      const xs = [0, 7, 15, 22];
      const n = xs.map((x) => addNode(m, [x, 0, 0]));
      const lines = [];
      // lateral restraint of the compression flange at third points (KLT = 1/3)
      for (let i = 0; i < 3; i++) lines.push(addLine(m, n[i], n[i + 1], { ...defaultLineElement('beam', mat, sec), design: { Ky: 1, Kz: 1 / 3, KLT: 1 / 3, C1: 1.13, steelCheck: true } }));
      sup(m, n[0], 'pinned');
      for (let i = 1; i < 4; i++) sup(m, n[i], [0, 'F', 'F', 'F', 0, 0]);
      lines.forEach((l, i) => {
        ld(m, { lc: G, type: 'lineDist', line: l, dir: 'Z', q1: -8, q2: -8, a: 0, b: 1, projected: false });
        ld(m, { lc: Qs[i], type: 'lineDist', line: l, dir: 'Z', q1: -15, q2: -15, a: 0, b: 1, projected: false });
      });
      ld(m, { lc: Qs[1], type: 'linePoint', line: lines[1], dir: 'Z', F: -60, pos: 0.5, moment: false });
      m.settings.beamDivisions = 8;
      addCombos(m);
      return m;
    },
  },
  {
    id: 'portal', name: 'Portalrahmen', icon: 'frame3d', mod: 'sky', view: 'front', tags: ['Rahmen', 'Wind', 'Knicken'],
    desc: 'Eingespannter Stahlrahmen mit Schnee und Wind von links/rechts (exklusiv).',
    build() {
      const m = base(t('Portalrahmen'), t('Zweistieliger Rahmen, HEB 300 / IPE 400, S355.'));
      const g = stdGroups(m);
      const G = lc(m, t('Eigengewicht + Dach'), g.G, true), S = lc(m, t('Schnee'), g.S), W1 = lc(m, t('Wind von links'), g.W), W2 = lc(m, t('Wind von rechts'), g.W);
      const mat = ensureMat(m, 'S355'), col = ensureSec(m, 'HEB 300'), raf = ensureSec(m, 'IPE 400');
      const a = addNode(m, [0, 0, 0]), b = addNode(m, [0, 0, 6]), c = addNode(m, [9, 0, 7.5]), d = addNode(m, [18, 0, 6]), e = addNode(m, [18, 0, 0]);
      const c1 = addLine(m, a, b, defaultLineElement('beam', mat, col)), r1 = addLine(m, b, c, defaultLineElement('beam', mat, raf));
      const r2 = addLine(m, c, d, defaultLineElement('beam', mat, raf)), c2 = addLine(m, e, d, defaultLineElement('beam', mat, col));
      // purlins every ~2.3 m restrain the rafters laterally; side rails restrain the columns
      for (const l of m.lines) l.element.design = l.id === c1 || l.id === c2 ? { Ky: 1, Kz: 0.5, KLT: 0.5, C1: 1.77, steelCheck: true } : { Ky: 1, Kz: 0.25, KLT: 0.25, C1: 1.13, steelCheck: true };
      sup(m, a, 'fixed'); sup(m, e, 'fixed');
      for (const n of [b, c, d]) sup(m, n, [0, 'F', 0, 'F', 0, 'F']);
      for (const r of [r1, r2]) {
        ld(m, { lc: G, type: 'lineDist', line: r, dir: 'Z', q1: -3, q2: -3, a: 0, b: 1, projected: false });
        ld(m, { lc: S, type: 'lineDist', line: r, dir: 'Z', q1: -6, q2: -6, a: 0, b: 1, projected: true });
      }
      ld(m, { lc: W1, type: 'lineDist', line: c1, dir: 'X', q1: 4.8, q2: 4.8, a: 0, b: 1, projected: false });
      ld(m, { lc: W1, type: 'lineDist', line: c2, dir: 'X', q1: 2.4, q2: 2.4, a: 0, b: 1, projected: false });
      ld(m, { lc: W2, type: 'lineDist', line: c1, dir: 'X', q1: -2.4, q2: -2.4, a: 0, b: 1, projected: false });
      ld(m, { lc: W2, type: 'lineDist', line: c2, dir: 'X', q1: -4.8, q2: -4.8, a: 0, b: 1, projected: false });
      m.settings.beamDivisions = 6;
      addCombos(m);
      return m;
    },
  },
  {
    id: 'hall', name: 'Stahlhalle', icon: 'hall', mod: 'lavender', tags: ['3D', 'Verbände', 'Nichtlinear'],
    desc: '6 Rahmen mit Pfetten und Zugdiagonalen – zeigt Stahlbemessung und Zugstäbe.',
    build: () => gen('hall', t('Stahlhalle 20 × 30 m'), { span: 20, nf: 6, e: 6, he: 6, hr: 8, base: 'pinned', g: -0.5, s: -1.0 }, t('Stahlhalle mit Zweigelenkrahmen, Pfetten und Zugverbänden.')),
  },
  {
    id: 'bridge', name: 'Fachwerkbrücke', icon: 'bridge', mod: 'lavender', tags: ['Fachwerk', '3D', 'Eigenformen'],
    desc: 'Räumliches Pratt-Fachwerk 30 m mit Querverband.',
    build: () => gen('truss', t('Fachwerkbrücke 30 m'), { L: 30, Ht: 3.5, n: 10, type: 'pratt', spatial: true, B: 4, F: -25 }, t('Zwei Pratt-Fachwerkträger mit Ober- und Untergurtverband.')),
  },
  {
    id: 'slab', name: 'Flachdecke auf Stützen', icon: 'slab', mod: 'mint', view: 'iso', tags: ['Platte', 'Stahlbeton'],
    desc: 'Punktgestützte Stahlbetondecke 18 × 12 m – Momente mx/my und Bewehrung.',
    build: () => gen('slab', t('Flachdecke 18 × 12 m'), { Lx: 18, Ly: 12, t: 0.26, sup: 'columns', cx: 3, cy: 2, q: -3, g: -1.5 }, t('Flachdecke C30/37 auf 12 Stützen.')),
  },
  {
    id: 'plate', name: 'Allseitig gelagerte Platte', icon: 'plate', mod: 'mint', tags: ['Platte', 'Validierung'],
    desc: 'Quadratplatte 6 × 6 m – Vergleich mit der Navier-Lösung.',
    build: () => gen('slab', t('Platte 6 × 6 m'), { Lx: 6, Ly: 6, t: 0.2, sup: 'edges', cx: 1, cy: 1, q: -5, g: 0 }, t('Gelenkig gelagerte Quadratplatte. Navier: w = 0.00406·q·a⁴/D, mx = 0.0479·q·a².')),
  },
  {
    id: 'building', name: 'Bürogebäude', icon: 'building', mod: 'peach', tags: ['3D', 'Schalen', 'Erdbeben'],
    desc: '4 Geschosse, Flachdecken, Stützen und Wandscheiben – für Eigenformen und Antwortspektrum.',
    build: () => gen('building', t('Bürogebäude 4 Geschosse'), { nx: 3, Lx: 6, ny: 2, Ly: 6, ns: 4, H: 3.2, t: 0.25, tw: 0.25, q: -3 }, t('Massivbau mit aussteifenden Wänden.')),
  },
  {
    id: 'frame3d', name: 'Stahlbetonskelett', icon: 'frame3d', mod: 'peach', tags: ['3D', 'Rahmen', 'Beton'],
    desc: 'Räumlicher Betonrahmen mit Unterzügen – Balkenbemessung nach EC2/SIA 262.',
    build: () => gen('frame', t('Stahlbetonskelett'), { nx: 3, Lx: 6, ny: 2, Ly: 5, ns: 3, H: 3.5, mat: 'concrete', base: 'fixed', slabs: false, q: -3 }, t('Betonrahmen mit Stützen 35×35 und Riegeln 30×55.')),
  },
  {
    id: 'barrel', name: 'Tonnenschale', icon: 'shell', mod: 'teal', tags: ['Schale', '3D'],
    desc: 'Zylinderschale 20 m, Dicke 12 cm, mit Schneelast.',
    build: () => gen('shell', t('Tonnenschale'), { form: 'barrel', R: 10, L: 20, ang: 80, n1: 12, n2: 8, t: 0.12, q: -1 }, t('Zylindrische Betonschale auf Endscheiben gelagert.')),
  },
  {
    id: 'dome', name: 'Kuppel', icon: 'dome', mod: 'teal', tags: ['Schale', 'Knicken'],
    desc: 'Kugelkuppel aus Schalenelementen – Schalenbeulen mit der Knickanalyse.',
    build: () => gen('shell', t('Kuppel R = 12 m'), { form: 'dome', R: 12, L: 10, ang: 60, n1: 16, n2: 6, t: 0.1, q: -1.5 }, t('Kugelkuppel, gelenkig am Rand gelagert.')),
  },
  {
    id: 'timber', name: 'Holzbalkendecke', icon: 'timber', mod: 'peach', view: 'iso', tags: ['Holz', 'EC5/SIA 265'],
    desc: 'Brettschichtholz-Träger GL24h mit Nutzlast – Holzbemessung.',
    build() {
      const m = base(t('Holzbalkendecke GL24h'), t('Fünf Einfeldträger GL24h 140×320 mm, Achsabstand 0.8 m, Spannweite 5.5 m.'));
      const g = stdGroups(m);
      const G = lc(m, t('Eigengewicht + Boden'), g.G, true), Q = lc(m, t('Nutzlast Wohnen'), g.Q);
      const mat = ensureMat(m, 'GL24h'), sec = ensureSec(m, 'RECT 140×320', { shape: 'RECT', dims: { h: 0.32, b: 0.14 } });
      for (let i = 0; i < 5; i++) {
        const a = addNode(m, [0, i * 0.8, 0]), b = addNode(m, [5.5, i * 0.8, 0]);
        const l = addLine(m, a, b, defaultLineElement('beam', mat, sec));
        sup(m, a, ['F', 'F', 'F', 'F', 0, 0]); sup(m, b, [0, 'F', 'F', 'F', 0, 0]);
        ld(m, { lc: G, type: 'lineDist', line: l, dir: 'Z', q1: -1.5 * 0.8, q2: -1.5 * 0.8, a: 0, b: 1, projected: false });
        ld(m, { lc: Q, type: 'lineDist', line: l, dir: 'Z', q1: -2.0 * 0.8, q2: -2.0 * 0.8, a: 0, b: 1, projected: false });
      }
      m.settings.beamDivisions = 8;
      addCombos(m);
      return m;
    },
  },
];
