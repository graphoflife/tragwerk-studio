// Tests for js/design/column.js – RC columns, EN 1992-1-1 (SIA 262 approximation). Hand calculations in comments.
// Material C30/37 (γc = 1.5 → fcd = 20 MPa, λ = 0.8, η = 1, εcu = 3.5 ‰), B500 (fyd = 434.78 MPa, εyd = 2.174 ‰).
import assert from 'node:assert/strict';
import { designRCColumns, isColumn, interactionCurve, columnResistance, columnSection, axialLimits } from '../../js/design/column.js';
import { concreteParams, designMN } from '../../js/design/concrete.js';
import { BAR_DIAS } from '../../js/design/rebar.js';
import { lineCase, near, runner } from './helpers.mjs';

const { test, done } = runner('column');
const C30 = { id: 1, name: 'C30/37', type: 'concrete', E: 33e6, nu: 0.2, rho: 2.5, fck: 30000 };
const P = concreteParams(C30, 500000, 'EC');
const fyd = 500000 / 1.15, fcd = 20000, Es = 200e6;
const R300 = { shape: 'RECT', dims: { h: 0.3, b: 0.3 } };
const R400 = { shape: 'RECT', dims: { h: 0.4, b: 0.4 } };
const geo300 = { shape: 'RECT', b: 0.3, h: 0.3, cover: 0.03, diaStirrup: 0.01, dia: 0.02 };

/** Vertical member (0,0,0) → (0,0,L), 4 mesh segments, one case 'LC:1' with station functions of x. */
function column({ L, sec = R300, mat = C30, design, code, fns = {}, nSeg = 4 }) {
  const model = {
    version: 1, settings: code ? { code } : {},
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: L }],
    lines: [{ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, beta: 0, design } }],
    materials: [{ ...mat, id: 1 }], sections: [{ id: 1, ...sec }],
    loadGroups: [], loadCases: [{ id: 1, name: 'LC1', group: null }], combinations: [],
  };
  // local axes of a vertical member (SPEC §2.1): ex = Z, ey = (1,0,0) × ex = −Y, ez = ex × ey = +X
  const mesh = {
    beams: Array.from({ length: nSeg }, (_, i) => ({ n1: i, n2: i + 1, line: 1, t0: i / nSeg, t1: (i + 1) / nSeg, ex: [0, 0, 1], ey: [0, -1, 0], ez: [1, 0, 0] })),
    shells: [],
  };
  const res = { cases: { 'LC:1': lineCase(mesh, L, fns) } };
  return { model, mesh, res };
}
const design = (o, keys = ['LC:1'], opts) => { const { model, mesh, res } = column(o); return designRCColumns(model, mesh, res, keys, opts); };
const pointOf = (r, imp) => r.points.find((p) => p.imp === imp);
/** 5.8.8.3 by hand: e2 = Kr·Kφ·εyd/(0.45·d)·l0²/10 with d = h − cover − Øs − Ø/2 (4 corner bars). */
const e2Hand = (h, dia, l0, Kr = 1, Kphi = 1) => Kr * Kphi * (fyd / Es) / (0.45 * (h - 0.04 - dia / 2)) * l0 * l0 / 10;

test('pure compression / tension resistance, RECT 300×300, 4 Ø20', () => {
  // As = 4·π·0.02²/4 = 12.566 cm²; σs(εc2 = 2 ‰) = min(434.8, 200 000·0.002 = 400) = 400 MPa
  // NRd = −(η·fcd·(Ac − As) + As·σs) = −(20 000·(0.09 − 0.0012566) + 0.0012566·400 000) = −(1774.9 + 502.7) = −2277.5 kN
  // NRdt = As·fyd = 0.0012566·434 783 = 546.4 kN
  const s = columnSection(geo300);
  assert.equal(s.n, 4);
  assert.ok(near(s.As, 12.566e-4, 1e-4));
  const lim = axialLimits(s, P);
  assert.ok(near(lim.NRd, -2277.5, 0.01), `NRd=${lim.NRd}`);
  assert.ok(near(lim.NRdt, 546.4, 0.01), `NRdt=${lim.NRdt}`);
  const curve = interactionCurve(s, P, 'y');
  assert.equal(curve.length, 40);
  assert.ok(near(curve[0][0], lim.NRd, 1e-9) && near(curve[39][0], lim.NRdt, 1e-9));
  assert.ok(curve[0][1] < 1e-6 && curve[39][1] < 1e-6);
  assert.ok(curve.every(([N, M], i) => M >= 0 && (i === 0 || N > curve[i - 1][0])));
  // outside the N range → 0
  assert.equal(columnResistance(s, P, -2300, 'y'), 0);
  assert.equal(columnResistance(s, P, 600, 'z'), 0);
});

test('MRd by strain compatibility: N = 0 and balance point (300×300, 4 Ø20)', () => {
  // a = 0.03 + 0.01 + 0.01 = 0.05 → d = 0.25, d2 = 0.05, As1 = As2 = 6.283 cm², Fs1 = 6.283e-4·434 783 = 273.2 kN
  // N = 0: 0.8x·0.3·20 000 + Fs2(x) = 273.2 with σs2 = 200 000·3.5‰·(x − 0.05)/x (elastic, almost at the
  // neutral axis) → x ≈ 0.0527 m: Fc = 253.0 kN (lever 0.15 − 0.4x = 0.1289), Fs2 ≈ 21 kN (lever 0.10)
  // MRd = 253.0·0.1289 + 21·0.10 + 273.2·0.10 = 32.6 + 2.1 + 27.3 = 62.0 kNm
  const s = columnSection(geo300);
  const M0 = columnResistance(s, P, 0, 'y');
  assert.ok(near(M0, 62.0, 0.015), `MRd(0)=${M0}`);
  assert.ok(near(columnResistance(s, P, 0, 'z'), M0, 1e-9), 'square: same about y and z');
  // cross-check with the beam design of concrete.js: designMN(MRd) needs ≈ the tension bars As1 = 6.28 cm²
  const r = designMN(M0, 0, { b: 0.3, h: 0.3, d: 0.25, d2: 0.05, fcd, fyd });
  assert.ok(near(r.As1, 6.283e-4, 0.015), `As1=${r.As1}`);
  // balance point: εs1 = εyd = 2.174 ‰ → x = 0.25·3.5/(3.5 + 2.174) = 0.15421 m, block 0.12337 m
  // Fc = 0.12337·0.3·20 000 = 740.2 kN, Fs2 = 6.283e-4·(434.8 − 20) MPa = 260.6 kN (yields; displaced concrete)
  // N = 740.2 + 260.6 − 273.2 = 727.7 kN (compression), M = 740.2·(0.15 − 0.06169) + (260.6 + 273.2)·0.10 = 118.75 kNm
  assert.ok(near(columnResistance(s, P, -727.7, 'y'), 118.75, 0.005));
  // tension reduces MRd (sanity check; see the tension-member test for a hand estimate)
  assert.ok(columnResistance(s, P, 200, 'y') > 0 && columnResistance(s, P, 200, 'y') < M0);
});

test('CIRC D = 0.4: 6 bars on the circle, NRd, is = rs/√2', () => {
  // rs = 0.2 − 0.05 = 0.15 m; n = max(6, ⌈2π·0.15/0.30⌉ = 4) = 6
  // NRd = −(20 000·(0.12566 − 0.001885) + 0.001885·400 000) = −(2475.6 + 754.0) = −3229.6 kN
  const s = columnSection({ shape: 'CIRC', D: 0.4, cover: 0.03, diaStirrup: 0.01, dia: 0.02 });
  assert.equal(s.n, 6);
  assert.ok(near(s.is.y, 0.15 / Math.SQRT2, 1e-9) && near(s.is.z, 0.15 / Math.SQRT2, 1e-9));
  assert.ok(near(axialLimits(s, P).NRd, -3229.6, 0.01));
  const My = columnResistance(s, P, -1000, 'y'), Mz = columnResistance(s, P, -1000, 'z');
  assert.ok(My > 100 && Mz > 100 && near(My, Mz, 0.05), `${My} ${Mz}`);
  // larger RECT faces get intermediate bars: 300×800 → 2 per long face (spacing ≤ 0.30 m) → 8 bars
  assert.equal(columnSection({ ...geo300, h: 0.8 }).n, 8);
});

test('slenderness: λ = l0/i, λlim (5.8.3.1); short column has no M2', () => {
  // L = 6 m, K = 1: i = 0.3/√12 = 0.0866 m → λ = 69.28
  const [r6] = design({ L: 6, fns: { N: () => -600 } });
  assert.ok(near(r6.lambda.y, 69.28, 1e-3) && near(r6.lambda.z, 69.28, 1e-3));
  assert.ok(near(r6.l0y, 6, 1e-12) && near(r6.iy, 0.3 / Math.sqrt(12), 1e-12));
  // λlim = 20·A·B·C/√n, A = 1 (φef = 0), C = 0.7 (no first-order moments), n = 600/(0.09·20 000) = 0.333,
  // B = √(1 + 2ω) with ω of the suggested bars (4 Ø16: ω = 8.04e-4·434 783/1800 = 0.1943 → λlim = 28.57)
  const om = r6.bars.area * fyd / (0.09 * fcd);
  const lim = 20 * Math.sqrt(1 + 2 * om) * 0.7 / Math.sqrt(1 / 3);
  assert.ok(near(r6.lambdaLim.y, lim, 1e-6), `λlim=${r6.lambdaLim.y} vs ${lim}`);
  assert.equal(r6.slender.y, true);
  assert.ok(r6.notes.some((n) => /λy = 69\.3 > λlim = .*slender.*5\.8\.8/.test(n)));
  // L = 2 m: λ = 23.1 < λlim → no 2nd-order moment; MEd = max(N·ei, N·e0) = max(600·0.005, 600·0.020) = 12 kNm
  const [r2] = design({ L: 2, fns: { N: () => -600 } });
  assert.ok(near(r2.lambda.y, 23.09, 1e-3));
  assert.equal(r2.slender.y, false);
  assert.equal(r2.governing.M2y, 0);
  assert.equal(r2.governing.M2z, 0);
  assert.ok(near(pointOf(r2, 'y').MEdy, 12, 1e-9) && pointOf(r2, 'y').MEdz === 0);
  assert.ok(r2.notes.some((n) => /not slender/.test(n)));
  assert.ok(r2.notes.some((n) => /minimum eccentricity e0 = 20\.0 mm governs/.test(n)));
});

test('nominal curvature (5.8.8): e2 and M2 by hand', () => {
  // L = l0 = 6 m, N = −600 kN, no first-order moments; suggested bars 4 Ø16 → d = 0.3 − 0.03 − 0.01 − 0.008 = 0.252 m
  // n = 0.333 ≤ 0.4 → Kr = 1; φef = 0 → Kφ = 1; 1/r = 2.174e-3/(0.45·0.252) = 0.019170 1/m
  // e2 = 0.019170·6²/10 = 0.06901 m → M2 = 600·0.06901 = 41.41 kNm; MEdy = N·ei + M2 = 600·0.015 + 41.41 = 50.41 kNm
  const [r] = design({ L: 6, fns: { N: () => -600 } });
  assert.equal(r.bars.n, 4);
  const M2 = 600 * e2Hand(0.3, r.bars.dia, 6);
  if (r.bars.dia === 0.016) assert.ok(near(M2, 41.41, 1e-3));
  assert.ok(near(r.governing.M2y, M2, 0.02), `M2y=${r.governing.M2y} vs ${M2}`);
  assert.ok(near(r.governing.eiy, 0.015, 1e-12));
  assert.ok(near(pointOf(r, 'y').MEdy, 9 + M2, 0.02));
  assert.ok(r.eta <= 1 && r.ok);
  // N = −1200 kN, φef = 1: n = 0.667 → Kr = (1 + ω − n)/(1 + ω − 0.4); 4 Ø16: ω = 0.1943 → Kr = 0.6643
  // β = 0.35 + 30/200 − 69.28/150 = 0.03812 → Kφ = 1.0381; e2 = 0.6643·1.0381·0.019170·3.6 = 0.04759 m → M2 = 57.1 kNm
  const [r2] = design({ L: 6, design: { rc: { phiEf: 1 } }, fns: { N: () => -1200 } });
  const om = r2.bars.area * fyd / (0.09 * fcd);
  const Kr = (1 + om - 2 / 3) / (1 + om - 0.4), Kphi = 1 + (0.35 + 0.15 - 6 / (0.3 / Math.sqrt(12)) / 150);
  assert.ok(Kr < 1 && near(Kphi, 1.0381, 1e-3));
  assert.ok(near(r2.governing.Kr.y, Kr, 1e-9) && near(r2.governing.Kphi.y, Kphi, 1e-9));
  const M2b = 1200 * e2Hand(0.3, r2.bars.dia, 6, Kr, Kphi);
  if (r2.bars.dia === 0.016) assert.ok(near(M2b, 57.1, 2e-3));
  assert.ok(near(r2.governing.M2y, M2b, 0.02), `M2y=${r2.governing.M2y} vs ${M2b}`);
  // creep reduces λlim: A = 1/(1 + 0.2) = 0.833
  const om2 = r2.bars.area * fyd / (0.09 * fcd);
  assert.ok(near(r2.lambdaLim.y, 20 / 1.2 * Math.sqrt(1 + 2 * om2) * 0.7 / Math.sqrt(2 / 3), 1e-6));
  assert.ok(r2.notes.some((n) => /φef = 1\.00/.test(n)));
});

test('end moments: rm, C, equivalent moment M0e (braced) and sway members', () => {
  // single curvature M(0) = 20, M(L) = 40 kNm (same sign): rm = 0.5 → C = 1.2
  // imperfection in y: M02i = 40 + 9 = 49, M01i = 20 + 9 = 29, M0e = max(0.6·49 + 0.4·29, 0.4·49) = 41
  // λlim = 20·B·1.2/√0.333 ≈ 49–58 < 69.3 → slender: MEdy = max(49, 41 + M2, 29 + M2/2) = 41 + M2
  const [r] = design({ L: 6, fns: { N: () => -600, My: (x) => 20 + 20 * x / 6 } });
  assert.ok(near(r.governing.rm.y, 0.5, 1e-9) && near(r.governing.C.y, 1.2, 1e-9));
  const om = r.bars.area * fyd / (0.09 * fcd);
  assert.ok(near(r.lambdaLim.y, 20 * Math.sqrt(1 + 2 * om) * 1.2 / Math.sqrt(1 / 3), 1e-6));
  const M2 = 600 * e2Hand(0.3, r.bars.dia, 6);
  assert.ok(near(pointOf(r, 'y').MEdy, 41 + M2, 0.01), `MEdy=${pointOf(r, 'y').MEdy} vs ${41 + M2}`);
  // without imperfection in y (check "imperfection in z"): M0e = 0.6·40 + 0.4·20 = 32 → MEdy = 32 + M2
  assert.ok(near(pointOf(r, 'z').MEdy, 32 + M2, 0.01));
  assert.ok(r.eta <= 1 && r.ok);
  // double curvature −40 / +40: rm = −1 → C = 2.7 → λlim ≥ 20·2.7/√0.333 = 93.5 > 69.3 → not slender in y
  // MEdy = max|M| + N·ei = 40 + 9 = 49 kNm
  const [d] = design({ L: 6, fns: { N: () => -600, My: (x) => -40 + 80 * x / 6 } });
  assert.ok(near(d.governing.C.y, 2.7, 1e-9) && d.slender.y === false && d.slender.z === true);
  assert.ok(near(pointOf(d, 'y').MEdy, 49, 1e-9));
  // sway (Ky = Kz = 2), cantilever L = 3 m with base moment 30 kNm: l0 = 6 m, C = 0.7,
  // MEdy = max|M| + N·ei + M2 = 30 + 600·6/400 + 600·e2 (Kr = 1)
  const [s] = design({ L: 3, design: { Ky: 2, Kz: 2 }, fns: { N: () => -600, My: (x) => 30 * (1 - x / 3) } });
  assert.ok(near(s.l0y, 6, 1e-12) && near(s.lambda.y, 69.28, 1e-3) && s.governing.C.y === 0.7);
  assert.ok(near(pointOf(s, 'y').MEdy, 30 + 9 + 600 * e2Hand(0.3, s.bars.dia, 6), 0.01));
  assert.ok(s.notes.some((n) => /sway member/.test(n)));
});

test('biaxial check (5.8.9(4)) with imperfection in one direction at a time', () => {
  // 400×400, L = 2 m (λ = 17.3, not slender), N = −1500, My = 60, Mz = 40 (constant)
  // imperfection in y: MEdy = 60 + 1500·0.005 = 67.5, MEdz = 40; in z: MEdy = 60, MEdz = 47.5
  const [r] = design({ L: 2, sec: R400, fns: { N: () => -1500, My: () => 60, Mz: () => 40 } });
  assert.equal(r.slender.y || r.slender.z, false);
  assert.deepEqual([pointOf(r, 'y').MEdy, pointOf(r, 'y').MEdz], [67.5, 40]);
  assert.deepEqual([pointOf(r, 'z').MEdy, pointOf(r, 'z').MEdz], [60, 47.5]);
  // a: NRd = Ac·fcd + As·fyd; with 4 Ø20: 3200 + 546.4 = 3746.4 → 1500/3746.4 = 0.400 → a = 1 + 0.5·0.300/0.6 = 1.250
  const NRd = 0.16 * fcd + r.bars.area * fyd, ratio = 1500 / NRd;
  const a = 1 + 0.5 * (ratio - 0.1) / 0.6;
  assert.ok(near(r.governing.a, a, 1e-9));
  if (r.bars.dia === 0.02) assert.ok(near(a, 1.250, 1e-3));
  // η = max(((MEdy/MRdy)^a + (MEdz/MRdz)^a)^(1/a), |NEd|/|NRd|) with MRd / NRd of the suggested bars
  // (4 Ø20: NRd = −(20 000·(0.16 − 0.00126) + 0.00126·400 000) = −3677.5 kN → 1500/3677.5 = 0.408 – here
  // the axial ratio is slightly above the moment ratio 0.406)
  const MR = columnResistance(r.section, P, -1500, 'y');
  assert.ok(near(columnResistance(r.section, P, -1500, 'z'), MR, 1e-9));
  const etaM = ((67.5 / MR) ** a + (40 / MR) ** a) ** (1 / a);
  const eta = Math.max(etaM, 1500 / -axialLimits(r.section, P).NRd);
  assert.ok(near(r.eta, eta, 1e-6), `eta=${r.eta} vs ${eta}`);
  assert.ok(near(r.eta, etaM, 0.05));
  assert.ok(near(r.governing.MRdy, MR, 1e-9));
  // CIRC: resultant √(MEdy² + MEdz²) vs MRd = min(MRd,y, MRd,z) of the bar layout
  const [c] = design({ L: 2, sec: { shape: 'CIRC', dims: { d: 0.4 } }, fns: { N: () => -1000, My: () => 40, Mz: () => 30 } });
  assert.equal(c.shape, 'CIRC');
  assert.ok(c.bars.n >= 6 && c.bars.n % 2 === 0);
  const MRc = Math.min(columnResistance(c.section, P, -1000, 'y'), columnResistance(c.section, P, -1000, 'z'));
  // imperfection in y: MEdy = 40 + 1000·0.005 = 45, MEdz = 30 → resultant 54.08 kNm
  assert.ok(near(c.eta, Math.max(Math.hypot(45, 30), Math.hypot(40, 35)) / MRc, 1e-6));
  assert.equal(c.curve.y.length, 40);
});

test('required As grows with NEd / MEd; As ≥ As,min; η ≤ 1 with the suggested bars', () => {
  const run = (N, My) => design({ L: 3, sec: R400, fns: { N: () => N, My: () => My } })[0];
  const a = run(-1000, 50), b = run(-1000, 150), c = run(-2500, 150);
  // As,min (9.5.2(2)) = max(0.10·NEd/fyd, 0.002·Ac): 1000 kN → max(2.30, 3.20) = 3.20 cm²; 2500 kN → max(5.75, 3.20) = 5.75 cm²
  assert.ok(near(a.AsMin, 3.2e-4, 1e-9) && near(c.AsMin, 0.1 * 2500 / fyd, 1e-9));
  assert.ok(near(a.As, a.AsMin, 1e-9) && a.notes.some((n) => /As,min = .* governs/.test(n)));
  assert.ok(b.As > a.As * 1.05 && c.As > b.As * 1.5, `${a.As} ${b.As} ${c.As}`);
  for (const r of [a, b, c]) {
    assert.ok(r.As >= r.AsMin && r.As <= r.AsMax);
    assert.ok(r.bars.area >= r.As * (1 - 1e-9));
    assert.ok(r.bars.dia >= 0.016 - 1e-12, 'Ø ≥ one step below the preferred Ø20');
    assert.ok(r.eta <= 1 && r.eta > 0 && r.ok);
    assert.ok(near(r.rho, r.As / 0.16, 1e-12) && near(r.AsMax, 0.04 * 0.16, 1e-12));
    assert.equal(r.points.length, 2);
    assert.ok(r.points.every((p) => p.eta <= r.eta + 1e-12));
  }
  // overloaded section: As,req > As,max → ok = false with a note
  const big = design({ L: 6, fns: { N: () => -1500, My: () => 120 } })[0];
  assert.equal(big.ok, false);
  assert.ok(big.notes.some((n) => /As,max/.test(n) || /section too small/.test(n)));
  // beyond the axial resistance: η > 1
  const crush = design({ L: 2, fns: { N: () => -5000 } })[0];
  assert.equal(crush.ok, false);
  assert.ok(crush.eta > 1);
});

test('tension member: no imperfection / 2nd order, strain compatibility in tension', () => {
  // N = +200 kN, My = 10 kNm: the compression zone above the top bars still helps → As < 2-layer estimate
  // 2·(N·zs + M)/((zs1 + zs2)·fyd) = 2·(200·0.1 + 10)/(0.2·434 783) = 6.90 cm² (designMN 'tension' mode)
  const [r] = design({ L: 3, fns: { N: () => 200, My: () => 10 } });
  assert.ok(r.governing.NEd === 200 && r.governing.M2y === 0 && r.governing.eiy === 0);
  assert.ok(near(r.governing.MEdy, 10, 1e-12));
  assert.ok(r.As < 6.9e-4 && r.As > 5e-4, `As=${r.As}`);
  assert.ok(!Number.isFinite(r.lambdaLim.y) && r.slender.y === false);
  assert.ok(r.notes.some((n) => /tension/.test(n)));
  assert.ok(r.eta <= 1 && r.ok);
});

test('SIA: As,min = 0.6 %, approximation note, SIA material values', () => {
  const [r] = design({ L: 3, code: 'SIA', fns: { N: () => -1000, My: () => 50 } });
  assert.equal(r.code, 'SIA');
  assert.ok(near(r.AsMin, 0.006 * 0.09, 1e-12));
  assert.ok(r.notes.some((n) => /SIA 262 4\.3\.7.*approximated.*5\.8\.8.*verify/.test(n)));
  assert.ok(BAR_DIAS.SIA.includes(r.bars.dia) && r.bars.dia >= 0.018 - 1e-12, `Ø${r.bars.dia}`);
  // C30/37: ηfc = 1 → fcd = 20 MPa; NRd with εc2 = 2 ‰: −(20 000·(Ac − As) + As·400 000)
  assert.ok(near(r.NRd, -(fcd * (0.09 - r.bars.area) + r.bars.area * 400000), 1e-9));
  // opts.code overrides model.settings.code
  const out = design({ L: 3, fns: { N: () => -1000 } }, ['LC:1'], { code: 'SIA' });
  assert.ok(out.code === 'SIA' && out[0].code === 'SIA' && near(out[0].AsMin, 0.006 * 0.09, 1e-12));
});

test('isColumn rules', () => {
  const s20 = Math.sin(Math.PI / 9), c20 = Math.cos(Math.PI / 9), s40 = Math.sin(2 * Math.PI / 9), c40 = Math.cos(2 * Math.PI / 9);
  const model = {
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 3 }, { id: 3, x: 5, y: 0, z: 3 }, { id: 4, x: 3 * s20, y: 0, z: 3 * c20 }, { id: 5, x: 3 * s40, y: 0, z: 3 * c40 }],
    materials: [C30, { id: 2, type: 'steel', fy: 235000 }],
    sections: [{ id: 1, ...R300 }, { id: 2, shape: 'CIRC', dims: { d: 0.4 } }, { id: 3, shape: 'T', dims: { h: 0.5, b: 0.6, tw: 0.2, tf: 0.15 } }],
    lines: [
      { id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1 } },                                   // vertical
      { id: 2, n1: 2, n2: 3, element: { type: 'beam', material: 1, section: 1 } },                                   // horizontal
      { id: 3, n1: 2, n2: 3, element: { type: 'beam', material: 1, section: 1, design: { rc: { member: 'column' } } } },
      { id: 4, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, design: { rc: { member: 'beam' } } } },
      { id: 5, n1: 1, n2: 4, element: { type: 'beam', material: 1, section: 1 } },                                   // 20° from Z
      { id: 6, n1: 1, n2: 5, element: { type: 'beam', material: 1, section: 1 } },                                   // 40° from Z
      { id: 7, n1: 1, n2: 2, element: { type: 'rib', material: 1, section: 1 } },
      { id: 8, n1: 1, n2: 2, element: { type: 'beam', material: 2, section: 1 } },                                   // steel
      { id: 9, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 3 } },                                   // T section
      { id: 10, n1: 2, n2: 1, element: { type: 'beam', material: 1, section: 2 } },                                  // CIRC, downwards
      { id: 11, n1: 1, n2: 2, element: null },
    ],
  };
  const exp = { 1: true, 2: false, 3: true, 4: false, 5: true, 6: false, 7: false, 8: false, 9: false, 10: true, 11: false };
  for (const ln of model.lines) assert.equal(isColumn(model, ln), exp[ln.id], `line ${ln.id}`);
  assert.equal(isColumn(model, 10), true, 'by id');
  assert.equal(isColumn(null, null), false);
  assert.equal(isColumn(model, 99), false);
});

test('robustness: missing data, unknown keys → warnings, no throw', () => {
  // vertical concrete beam without section
  const a = column({ L: 3, fns: { N: () => -500 } });
  a.model.lines[0].element.section = 99;
  const ra = designRCColumns(a.model, a.mesh, a.res, ['LC:1', 'CO:9']);
  assert.equal(ra.length, 0);
  assert.ok(ra.warnings.some((w) => w === 'Line 1: no section – RC column design skipped'), ra.warnings.join('|'));
  assert.ok(ra.warnings.some((w) => /CO:9/.test(w)));
  // unsupported shape, no fck, cover too large, no mesh beams
  const b = column({ L: 3, sec: { shape: 'T', dims: { h: 0.5, b: 0.6, tw: 0.2, tf: 0.15 } }, fns: { N: () => -500 } });
  const rb = designRCColumns(b.model, b.mesh, b.res, ['LC:1']);
  assert.ok(rb.length === 0 && rb.warnings.some((w) => /Line 1: section shape T not supported.*RC column design skipped/.test(w)));
  const c = column({ L: 3, mat: { type: 'concrete' }, fns: { N: () => -500 } });
  assert.ok(designRCColumns(c.model, c.mesh, c.res, ['LC:1']).warnings.some((w) => /without fck/.test(w)));
  const d = column({ L: 3, sec: { shape: 'RECT', dims: { h: 0.1, b: 0.1 } }, design: { rc: { cover: 0.05 } }, fns: { N: () => -500 } });
  assert.ok(designRCColumns(d.model, d.mesh, d.res, ['LC:1']).warnings.some((w) => /cover\/bar diameters too large/.test(w)));
  const e = column({ L: 3, fns: { N: () => -500 } });
  assert.ok(designRCColumns(e.model, { beams: [], shells: [] }, e.res, ['LC:1']).warnings.some((w) => /no mesh beams/.test(w)));
  // non-concrete: silently skipped, unless member === 'column'
  const f = column({ L: 3, mat: { type: 'steel', fy: 235000, E: 210e6 }, fns: { N: () => -500 } });
  const rf = designRCColumns(f.model, f.mesh, f.res, ['LC:1']);
  assert.ok(rf.length === 0 && rf.warnings.length === 0);
  f.model.lines[0].element.design = { rc: { member: 'column' } };
  assert.ok(designRCColumns(f.model, f.mesh, f.res, ['LC:1']).warnings.some((w) => /Line 1: material type 'steel' is not concrete – RC column design skipped/.test(w)));
  // only unknown keys → minimum reinforcement, note
  const g = column({ L: 3, fns: { N: () => -500 } });
  const rg = designRCColumns(g.model, g.mesh, g.res, ['CO:1']);
  assert.equal(rg.length, 1);
  assert.ok(near(rg[0].As, rg[0].AsMin, 1e-12) && rg[0].eta === 0 && rg[0].notes.some((n) => /no result cases/.test(n)));
  // null inputs
  const z = designRCColumns(null, null, null);
  assert.ok(Array.isArray(z) && z.length === 0 && Array.isArray(z.warnings) && z.code === 'EC');
  assert.ok(Number.isNaN(columnResistance(null, P, 0, 'y')));
  assert.deepEqual(interactionCurve(null, P, 'y'), []);
  // default case keys (no ULS combinations → all result keys) and result fields
  const [r] = designRCColumns(g.model, g.mesh, g.res, []);
  for (const k of ['line', 'shape', 'b', 'h', 'D', 'cover', 'dia', 'diaStirrup', 'fyk', 'L', 'l0y', 'l0z', 'iy', 'iz', 'lambda', 'lambdaLim', 'slender', 'As', 'AsMin', 'AsMax', 'rho', 'bars', 'eta', 'governing', 'points', 'curve', 'ok', 'notes', 'code']) assert.ok(k in r, k);
  assert.equal(r.governing.caseKey, 'LC:1');
  assert.equal(r.D, null);
});

done();
