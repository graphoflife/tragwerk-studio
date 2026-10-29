// Tests for js/design/timber.js – EN 1995-1-1 and SIA 265. Hand calculations in comments.
import assert from 'node:assert/strict';
import { checkTimberMembers, timberHelpers, KMOD } from '../../js/design/timber.js';
import { lineModel, lineMesh, lineCase, near, runner } from './helpers.mjs';

const { test, done } = runner('timber');
// C24 (EN 338:2016) in kN/m²
const C24 = {
  name: 'C24', type: 'timber', E: 11e6, G: 0.69e6, rho: 0.42,
  timber: { fmk: 24000, ft0k: 14500, fc0k: 21000, fvk: 4000, ft90k: 400, fc90k: 2500, E0mean: 11e6, E005: 7.4e6, Gmean: 0.69e6, rhok: 350, kind: 'solid', serviceClass: 1 },
};
const GL24h = {
  name: 'GL24h', type: 'timber', E: 11.5e6,
  timber: { fmk: 24000, ft0k: 19200, fc0k: 24000, fvk: 3500, E0mean: 11.5e6, E005: 9.6e6, Gmean: 0.65e6, rhok: 385, kind: 'glulam', serviceClass: 1 },
};

/** Model with groups G (permanent) and Q (variable) and combination CO:1 = 1.35 G + 1.5 Q. */
function withCombos(model) {
  model.loadGroups = [{ id: 1, name: 'G', type: 'permanent' }, { id: 2, name: 'Q', type: 'variable' }, { id: 3, name: 'A', type: 'accidental' }];
  model.loadCases = [{ id: 1, name: 'G', group: 1 }, { id: 2, name: 'Q', group: 2 }, { id: 3, name: 'Imp', group: 3 }];
  model.combinations = [
    { id: 1, name: 'ULS 1', type: 'ULS', factors: { 1: 1.35, 2: 1.5 } },
    { id: 2, name: 'ULS 2', type: 'ULS', factors: { 1: 1.35 } },
    { id: 3, name: 'ACC 1', type: 'ULS-ACC', factors: { 1: 1, 3: 1 } },
  ];
  return model;
}

const L1 = 4, q1 = 3; // M = qL²/8 = 6 kNm, V = qL/2 = 6 kN
function beam(code, mat = C24, sec = { shape: 'RECT', dims: { h: 0.2, b: 0.1 } }, design = { C1: 1.13 }) {
  const model = withCombos(lineModel({ L: L1, sec, mat, design, code }));
  const mesh = lineMesh(4);
  const c = lineCase(mesh, L1, { My: (x) => q1 * x * (L1 - x) / 2, Vz: (x) => q1 * (L1 / 2 - x) });
  return checkTimberMembers(model, mesh, { cases: { 'CO:1': c, 'CO:2': c, 'CO:3': c } }, ['CO:1']);
}

test('EC: C24 100×200 beam, bending/shear, kmod medium = 0.8', () => {
  const [r] = beam();
  assert.equal(r.code, 'EC');
  // σm = 6/(0.1·0.2²/6) = 9.0 N/mm²; fm,d = 0.8·24/1.3 = 14.77 N/mm² (kh = 1, h = 200 mm) → η = 0.609
  assert.ok(near(r.checks.My.eta, 9.0 / (0.8 * 24 / 1.3), 1e-3), r.checks.My.detail);
  assert.match(r.checks.My.detail, /kmod=0\.80 \(medium/);
  // τ = 1.5·6/(0.67·0.02) = 0.672 N/mm²; fv,d = 0.8·4/1.3 = 2.462 → η = 0.273
  assert.ok(near(r.checks.Vz.eta, (1.5 * 6 / (0.67 * 0.02)) / 1000 / (0.8 * 4 / 1.3), 1e-3), r.checks.Vz.detail);
  // LTB: Iz = 1.667e-5, It = 4.578e-5 m⁴, G0,05 = 690·7400/11000 = 464.2 N/mm², lef = 4/1.13 = 3.54 m
  // σm,crit = π·√(7400·1.667e-5·464.2·4.578e-5)/(3.54·6.667e-4) = 68.1 N/mm² → λrel,m = √(24/68.1) = 0.593 → kcrit = 1
  assert.ok(near(r.checks.LTB.eta, r.checks.My.eta, 1e-9));
  assert.match(r.checks.LTB.detail, /σm,crit=68\.1/);
  assert.equal(r.governing.check, 'My');
});

test('EC: kmod by load duration and accidental γM = 1.0', () => {
  const model = withCombos(lineModel({ L: L1, sec: { shape: 'RECT', dims: { h: 0.2, b: 0.1 } }, mat: C24 }));
  const mesh = lineMesh(2);
  const c = lineCase(mesh, L1, { My: () => 6 });
  const res = { cases: { 'CO:1': c, 'CO:2': c, 'CO:3': c, 'LC:2': c, 'XX': c } };
  const eta = (key) => checkTimberMembers(model, mesh, res, [key])[0].checks.My.eta;
  // permanent only → kmod 0.6; G+Q → 0.8; accidental → kmod 1.1 (instantaneous), γM = 1.0
  assert.ok(near(eta('CO:2') / eta('CO:1'), 0.8 / 0.6, 1e-9));
  assert.ok(near(eta('CO:3'), 9.0 / (1.1 * 24 / 1.0), 1e-3));
  assert.ok(near(eta('LC:2'), eta('CO:1'), 1e-9));
  const [rx] = checkTimberMembers(model, mesh, res, ['XX']);
  assert.ok(near(rx.checks.My.eta, eta('CO:1'), 1e-9), 'unknown key → medium');
  assert.ok(rx.notes.some((n) => /medium-term assumed/.test(n)));
  assert.equal(KMOD[3].medium, 0.65);
  // service class 3 via opts
  const [r3] = checkTimberMembers(model, mesh, res, ['CO:1'], { serviceClass: 3 });
  assert.ok(near(r3.checks.My.eta, 9.0 / (0.65 * 24 / 1.3), 1e-3));
});

test('EC: C24 column 160×160, L = 3 m, N = −100 kN (6.3.2)', () => {
  const L = 3;
  const model = withCombos(lineModel({ L, sec: { shape: 'RECT', dims: { h: 0.16, b: 0.16 } }, mat: C24 }));
  const mesh = lineMesh(4);
  const res = { cases: { 'CO:1': lineCase(mesh, L, { N: () => -100 }) } };
  const [r] = checkTimberMembers(model, mesh, res, ['CO:1']);
  // i = 0.16/√12 = 0.04619 m, λ = 64.95, λrel = 64.95/π·√(21/7400) = 1.1014
  // k = 0.5[1 + 0.2·0.8014 + 1.2131] = 1.1867, kc = 1/(1.1867 + √(1.4082 − 1.2131)) = 0.6141
  // σc = 100/0.0256 = 3.906 N/mm², fc,0,d = 0.8·21/1.3 = 12.92 → η = 3.906/(0.6141·12.92) = 0.492
  assert.ok(near(timberHelpers.kcBuckling(1.1014, 0.2), 0.6141, 1e-3));
  assert.ok(near(r.checks['FB-z'].eta, 3.906 / (0.6141 * 12.923), 3e-3), r.checks['FB-z'].detail);
  assert.ok(near(r.checks['FB-y'].eta, r.checks['FB-z'].eta, 1e-9));
  assert.ok(near(r.checks.N.eta, 3.906 / 12.923, 2e-3));
  assert.equal(r.governing.check, 'FB-y');
});

test('EC: glulam GL24h – γM 1.25, kh = (600/h)^0.1, βc = 0.1', () => {
  const [r] = beam('EC', GL24h, { shape: 'RECT', dims: { h: 0.4, b: 0.14 } });
  // Wy = 0.14·0.4²/6 = 3.733e-3 → σm = 6/3.733e-3 = 1.607 N/mm²; kh = 1.5^0.1 = 1.0414
  // fm,d = 1.0414·0.8·24/1.25 = 16.00 N/mm² → η = 0.1004
  assert.ok(near(r.checks.My.eta, (6 / 3.7333e-3 / 1000) / (1.5 ** 0.1 * 0.8 * 24 / 1.25), 1e-3), r.checks.My.detail);
  // SIA 265 table (Lignum HBT1) check of the kc formulation: λrel = 1.0 → kc = 0.689 (solid), 0.768 (glulam)
  assert.ok(near(timberHelpers.kcBuckling(1.0, 0.2), 0.689, 1e-3));
  assert.ok(near(timberHelpers.kcBuckling(1.0, 0.1), 0.768, 1e-3));
  assert.ok(near(timberHelpers.kcrit(1.0), 0.81, 1e-9));
});

test('SIA 265: fd = ηM·ηt·ηw·fk/γM (γM 1.7 solid / 1.5 glulam)', () => {
  const [r] = beam('SIA');
  assert.equal(r.code, 'SIA');
  // fm,d = 24/1.7 = 14.12 N/mm² (Lignum HBT1: 14.1) → η = 9.0/14.12 = 0.6375
  assert.ok(near(r.checks.My.eta, 9.0 / (24 / 1.7), 1e-3), r.checks.My.detail);
  assert.match(r.checks.My.detail, /ηw=1\.00, γM=1\.70/);
  // fv,d = 0.67-reduced: τ = 0.672 N/mm², fv,d = 4/1.7 = 2.353 → η = 0.2855 (≙ fv,d,eff = 1.58 ≈ 1.5 HBT1)
  assert.ok(near(r.checks.Vz.eta, 0.67164 / (4 / 1.7), 2e-3), r.checks.Vz.detail);
  const [g] = beam('SIA', GL24h, { shape: 'RECT', dims: { h: 0.4, b: 0.14 } });
  // GL24h: fm,d = 24/1.5 = 16.0 N/mm² (no kh in SIA path)
  assert.ok(near(g.checks.My.eta, (6 / 3.7333e-3 / 1000) / 16.0, 1e-3));
  // column: fc,0,d = 21/1.7 = 12.35 (HBT1 12.4), kc = 0.6141 → η = 3.906/(0.6141·12.353) = 0.515
  const L = 3;
  const model = withCombos(lineModel({ L, sec: { shape: 'RECT', dims: { h: 0.16, b: 0.16 } }, mat: C24, code: 'SIA' }));
  const mesh = lineMesh(2);
  const [cc] = checkTimberMembers(model, mesh, { cases: { 'CO:1': lineCase(mesh, L, { N: () => -100 }) } }, ['CO:1']);
  assert.ok(near(cc.checks['FB-z'].eta, 3.906 / (0.6141 * 21 / 1.7), 3e-3), cc.checks['FB-z'].detail);
  assert.match(cc.checks['FB-z'].detail, /SIA 265 4\.2\.8/);
  // moisture class 2 → ηw = 0.9
  const [r2] = checkTimberMembers(model, mesh, { cases: { 'CO:1': lineCase(mesh, L, { N: () => -100 }) } }, ['CO:1'], { serviceClass: 2 });
  assert.ok(near(r2.checks.N.eta / cc.checks.N.eta, 1 / 0.9, 1e-9));
  // load duration does not change SIA design strengths (ηt = 1.0 for static actions)
  const [p2] = checkTimberMembers(model, mesh, { cases: { 'CO:2': lineCase(mesh, L, { N: () => -100 }) } }, ['CO:2']);
  assert.ok(near(p2.checks.N.eta, cc.checks.N.eta, 1e-12));
});

test('EC: slender beam with kcrit < 1 and compression (6.35)', () => {
  const L = 6;
  const sec = { shape: 'RECT', dims: { h: 0.3, b: 0.06 } };
  const model = withCombos(lineModel({ L, sec, mat: C24 }));
  const mesh = lineMesh(4);
  const res = { cases: { 'CO:1': lineCase(mesh, L, { My: () => 5, N: () => -10 }) } };
  const [r] = checkTimberMembers(model, mesh, res, ['CO:1']);
  // Iz = 0.3·0.06³/12 = 5.4e-6, It = 0.3·0.06³·(1/3 − 0.21·0.2·(1 − 0.2⁴/12)) = 1.8879e-5·... (see code)
  const a = 0.3, c = 0.06;
  const It = a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4)));
  const Iz = a * c ** 3 / 12, Wy = c * a * a / 6;
  const sCrit = Math.PI * Math.sqrt(7.4e6 * Iz * (0.69e6 * 7.4 / 11) * It) / (L * Wy);
  const lrm = Math.sqrt(24000 / sCrit);
  const kc = timberHelpers.kcrit(lrm);
  assert.ok(kc < 1 && lrm > 0.75);
  const fmd = 0.8 * 24000 / 1.3;
  const e33 = (5 / Wy) / (kc * fmd);
  assert.ok(r.checks.LTB.eta >= e33 * 0.999, r.checks.LTB.detail);
  assert.ok(near(r.checks.My.eta, (5 / Wy) / fmd, 1e-6));
});

test('robustness', () => {
  const mesh = lineMesh(2);
  const c = lineCase(mesh, 3, { My: () => 1 });
  const m1 = lineModel({ L: 3, sec: { shape: 'RECT', dims: { h: 0.2, b: 0.1 } }, mat: { type: 'timber' } });
  const o1 = checkTimberMembers(m1, mesh, { cases: { 'LC:1': c } }, ['LC:1']);
  assert.equal(o1.length, 0);
  assert.ok(o1.warnings[0].includes('timber properties'));
  const m2 = lineModel({ L: 3, sec: { shape: 'CIRC', dims: { d: 0.2 } }, mat: C24 });
  const [r2] = checkTimberMembers(m2, mesh, { cases: { 'LC:1': lineCase(mesh, 3, { My: () => 2, N: () => -20, T: () => 0.5 }) } }, ['LC:1']);
  assert.ok(Number.isFinite(r2.eta) && r2.eta > 0 && !r2.checks.LTB);
  // load case of a permanent... LC:1 has no group → permanent → kmod 0.6
  assert.match(r2.checks.My.detail, /kmod=0\.60/);
  assert.equal(checkTimberMembers(null, null, null).length, 0);
  const tr = lineModel({ L: 3, sec: { shape: 'RECT', dims: { h: 0.1, b: 0.1 } }, mat: C24, type: 'truss' });
  const [t] = checkTimberMembers(tr, mesh, { cases: { 'LC:1': lineCase(mesh, 3, { N: () => 30 }) } }, ['LC:1']);
  assert.deepEqual(Object.keys(t.checks).sort(), ['FB-y', 'FB-z', 'N']);
  // tension: kh for h = 100 mm: (150/100)^0.2 = 1.0845 → ft,0,d = 1.0845·0.6·14.5/1.3
  assert.ok(near(t.checks.N.eta, (30 / 0.01) / (1.5 ** 0.2 * 0.6 * 14500 / 1.3), 1e-3), t.checks.N.detail);
});

done();
