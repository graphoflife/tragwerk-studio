// Tests for js/design/steel.js – EN 1993-1-1 and SIA 263. Hand calculations in comments.
import assert from 'node:assert/strict';
import { checkSteelMembers, steelHelpers } from '../../js/design/steel.js';
import { lineModel, lineMesh, lineCase, near, runner, IPE300, HEB200, S235 } from './helpers.mjs';

const { test, done } = runner('steel');
const E = 210e6, G = 81e6, fy = 235000;

// ── IPE 300, S235, simply supported, L = 6 m, uniform load: q chosen so that Mmax = 60 kNm ──
const L1 = 6, q1 = 8 * 60 / 36;
function ipeBeam(code, C1 = 1.13) {
  const model = lineModel({ L: L1, sec: IPE300, mat: S235, design: { C1 }, code });
  const mesh = lineMesh(4);
  const res = { cases: { 'LC:1': lineCase(mesh, L1, { My: (x) => q1 * x * (L1 - x) / 2, Vz: (x) => q1 * (L1 / 2 - x) }) } };
  return checkSteelMembers(model, mesh, res, ['LC:1']);
}
// Hand calc Mcr (k = kw = 1): π²EIz/L² = 9.8696·210e6·603.8e-8/36 = 347.6 kN,
// Iw/Iz = 0.02085 m², L²GIt/(π²EIz) = 36·81e6·20.12e-8/12514.5 = 0.04688 → √0.06773 = 0.2603
// Mcr = 1.13·347.6·0.2603 = 102.2 kNm (textbook value for IPE 300, L = 6 m, uniform load ≈ 102 kNm)
function mcrHand(C1) {
  const pe = Math.PI ** 2 * E * IPE300.Iz / L1 ** 2;
  return C1 * pe * Math.sqrt(IPE300.Iw / IPE300.Iz + L1 ** 2 * G * IPE300.It / (Math.PI ** 2 * E * IPE300.Iz));
}

test('EC: IPE 300 bending – Mpl,Rd = 147.7 kNm, class 1, shear', () => {
  const [r] = ipeBeam();
  assert.equal(r.code, 'EC');
  assert.equal(r.cls, 1);
  // Mpl,Rd = 628.4e-6 · 235000 / 1.0 = 147.67 kNm → η = 60/147.67 = 0.4063
  assert.ok(near(r.checks.My.eta, 60 / 147.674, 1e-3), r.checks.My.detail);
  assert.ok(near(r.checks.My.x, 3, 1e-6));
  assert.match(r.checks.My.detail, /6\.2\.5.*147\.67/);
  // Av = A − 2btf + (tw+2r)tf = 53.81 − 32.10 + 3.97 = 25.68 cm²; Vpl,Rd = 25.68e-4·235000/√3 = 348.4 kN
  assert.ok(near(r.checks.Vz.eta, 40 / 348.4, 2e-3), r.checks.Vz.detail);
  assert.ok(near(r.checks.Vz.x, 0, 1e-9) || near(r.checks.Vz.x, 6, 1e-9));
  assert.equal(r.checks.N.eta, 0);
});

test('EC: IPE 300 LTB with C1 = 1.13 (6.3.2.3)', () => {
  const [r] = ipeBeam();
  const Mcr = mcrHand(1.13);
  assert.ok(near(Mcr, 102.2, 0.005));
  // λ̄LT = √(147.67/102.2) = 1.202; curve b (rolled, h/b = 2): Φ = 0.5[1 + 0.34(1.202−0.4) + 0.75·1.445] = 1.178
  // χLT = 1/(1.178 + √(1.388 − 1.084)) = 0.578; kc = 1/√1.13 = 0.941 → f = 1 − 0.5·0.059·(1 − 2·0.402²) = 0.980
  // χLT,mod = 0.590 → Mb,Rd = 0.590·147.67 = 87.1 kNm (textbook range 85–88 kNm)
  const lam = Math.sqrt(147.674 / Mcr);
  const phi = 0.5 * (1 + 0.34 * (lam - 0.4) + 0.75 * lam * lam);
  const chi = 1 / (phi + Math.sqrt(phi * phi - 0.75 * lam * lam));
  const kc = 1 / Math.sqrt(1.13), f = 1 - 0.5 * (1 - kc) * (1 - 2 * (lam - 0.8) ** 2);
  const MbRd = (chi / f) * 147.674;
  assert.ok(near(MbRd, 87.1, 0.01), `MbRd=${MbRd}`);
  assert.ok(near(r.checks.LTB.eta, 60 / MbRd, 2e-3), r.checks.LTB.detail);
  assert.equal(r.governing.check, 'LTB');
  assert.ok(near(r.eta, r.checks.LTB.eta, 1e-12));
  // interaction without axial force: (6.62) kzy = 1 (Table B.2, n = 0) → η = My/(χLT·My,Rk) = LTB value
  assert.ok(r.checks.Interaction.eta >= r.checks.LTB.eta * 0.999);
});

test('EC: HEB 200 pinned column, L = 4 m, N = −1000 kN (flexural buckling)', () => {
  const L = 4;
  const model = lineModel({ L, sec: HEB200, mat: S235 });
  const mesh = lineMesh(4);
  const res = { cases: { 'LC:1': lineCase(mesh, L, { N: () => -1000 }) } };
  const [r] = checkSteelMembers(model, mesh, res, ['LC:1']);
  // Npl = 78.08e-4·235000 = 1834.9 kN → η_N = 0.545
  assert.ok(near(r.checks.N.eta, 1000 / 1834.88, 1e-3));
  // z: iz = √(2003/78.08) = 5.065 cm, λ̄z = 400/5.065/93.91 = 0.841, curve c (h/b ≤ 1.2):
  // Φ = 0.5[1 + 0.49·0.641 + 0.707] = 1.0106, χz = 1/(1.0106 + √(1.0213 − 0.7072)) = 0.6365
  // Nb,z,Rd = 0.6365·1834.9 = 1167.9 kN (the "1000–1100 kN" estimate in the task is slightly low;
  // the standard EC3 result for HEB 200/S235/4 m is ≈ 1168 kN)
  assert.ok(near(r.checks['FB-z'].eta, 1000 / 1167.9, 2e-3), r.checks['FB-z'].detail);
  assert.match(r.checks['FB-z'].detail, /curve c/);
  // y: iy = 8.541 cm, λ̄y = 0.499, curve b: χy = 0.8848 → Nb,y,Rd = 1623.5 kN
  assert.ok(near(r.checks['FB-y'].eta, 1000 / 1623.5, 2e-3), r.checks['FB-y'].detail);
  assert.equal(r.governing.check, 'FB-z');
  assert.ok(!r.checks.LTB || r.checks.LTB.eta === 0);
});

test('EC: HEB 200 beam-column N = −500 kN, My = 80 kNm constant (Annex B)', () => {
  const L = 4;
  const model = lineModel({ L, sec: HEB200, mat: S235 });
  const mesh = lineMesh(4);
  const res = { cases: { 'LC:1': lineCase(mesh, L, { N: () => -500, My: () => 80 }) } };
  const [r] = checkSteelMembers(model, mesh, res, ['LC:1']);
  // Mpl,y = 642.5e-6·235000 = 150.99 kNm; n = 500/1834.9 = 0.2725, a = (78.08−60)/78.08 = 0.2316
  // MN,y = 150.99·(1−0.2725)/(1−0.1158) = 124.24 kNm → η(M+N) = 80/124.24 = 0.644
  assert.ok(near(r.checks['M+N'].eta, 80 / (150.9875 * (1 - 500 / 1834.88) / (1 - 0.5 * (78.08 - 60) / 78.08)), 2e-3), r.checks['M+N'].detail);
  // Mcr (C1 = 1): π²EIz/L² = 2594.7 kN; √(Iw/Iz + L²GIt/(π²EIz)) = √(0.008542 + 0.018506) = 0.16446
  // Mcr = 426.7 kNm, λ̄LT = √(150.99/426.7) = 0.5949, curve b: Φ = 0.6658, χLT = 0.9194 (f = 1, C1 = 1)
  const Mcr = steelHelpers.mcrLTB(E, G, HEB200.Iz, HEB200.Iw, HEB200.It, L, 1);
  assert.ok(near(Mcr, 426.7, 0.003), `Mcr=${Mcr}`);
  const lam = Math.sqrt(150.9875 / Mcr), phi = 0.5 * (1 + 0.34 * (lam - 0.4) + 0.75 * lam * lam);
  const chiLT = 1 / (phi + Math.sqrt(phi * phi - 0.75 * lam * lam));
  assert.ok(near(chiLT, 0.9194, 0.002));
  // ny = 500/(0.8848·1834.9) = 0.3080, nz = 500/(0.6365·1834.9) = 0.4281; Cmy = CmLT = 1 (ψ = 1)
  // kyy = 1 + (0.4987−0.2)·0.3080 = 1.0920; kzy (B.2) = 1 − 0.1·0.8409·0.4281/0.75 = 0.9520
  // (6.61) = 0.3080 + 1.0920·80/(0.9194·150.99) = 0.937 ; (6.62) = 0.4281 + 0.9520·0.5763 = 0.977
  const ny = 500 / (0.88479 * 1834.88), nz = 500 / (0.63649 * 1834.88);
  const My1 = 80 / (chiLT * 150.9875);
  const lz = 0.84094, ly = 0.49870;
  const e61 = ny + Math.min(1 + (ly - 0.2) * ny, 1 + 0.8 * ny) * My1;
  const e62 = nz + Math.max(1 - 0.1 * lz * nz / 0.75, 1 - 0.1 * nz / 0.75) * My1;
  assert.ok(near(e62, 0.9767, 0.003));
  assert.ok(near(r.checks.Interaction.eta, Math.max(e61, e62), 3e-3), r.checks.Interaction.detail);
  assert.match(r.checks.Interaction.detail, /Table B\.2/);
});

test('SIA 263: IPE 300 – Mpl,Rd = 628.4e-6·235000/1.05, χD (αD = 0.21)', () => {
  const [r] = ipeBeam('SIA');
  assert.equal(r.code, 'SIA');
  // Mpl,Rd = 147.67/1.05 = 140.64 kNm
  assert.ok(near(r.checks.My.eta, 60 / 140.642, 1e-3), r.checks.My.detail);
  // λ̄D = 1.202 (as above), Φ = 0.5[1 + 0.21(1.202 − 0.4) + 1.445] = 1.3066,
  // χD = 1/(1.3066 + √(1.7073 − 1.4449)) = 0.5498 → MD,Rd = 0.5498·147.67/1.05 = 77.3 kNm
  const lam = Math.sqrt(147.674 / mcrHand(1.13));
  const phi = 0.5 * (1 + 0.21 * (lam - 0.4) + lam * lam);
  const chiD = 1 / (phi + Math.sqrt(phi * phi - lam * lam));
  assert.ok(near(chiD, 0.5498, 0.003));
  assert.ok(near(r.checks.LTB.eta, 60 / (chiD * 147.674 / 1.05), 2e-3), r.checks.LTB.detail);
  assert.match(r.checks.LTB.detail, /SIA 263 4\.5\.2/);
  // shear with γM1 = 1.05: Vpl,Rd = 348.4/1.05 = 331.8 kN
  assert.ok(near(r.checks.Vz.eta, 40 / (348.4 / 1.05), 2e-3));
  // SIA interaction with N = 0, ω = 1 (transverse load): η = My/MD,Rd = LTB value
  assert.ok(near(r.checks.Interaction.eta, r.checks.LTB.eta, 2e-3), r.checks.Interaction.detail);
});

test('SIA 263: HEB 200 column – NK,Rd = χ·A·fy/1.05; interaction with ω and 1/(1−N/Ncr)', () => {
  const L = 4;
  const model = lineModel({ L, sec: HEB200, mat: S235, code: 'SIA' });
  const mesh = lineMesh(4);
  // linear moment diagram My(0) = 40, My(L) = 0 → ψ = 0 → ω = 0.6
  const res = { cases: { 'LC:1': lineCase(mesh, L, { N: () => -500, My: (x) => 40 * (1 - x / L), Vz: () => -10 }) } };
  const [r] = checkSteelMembers(model, mesh, res, ['LC:1']);
  assert.ok(near(r.checks['FB-z'].eta, 500 / (0.63649 * 1834.88 / 1.05), 2e-3), r.checks['FB-z'].detail);
  // Ncr,y = π²·210e6·5696e-8/16 = 7378.3 kN → 1 − 500/7378.3 = 0.93223
  // in-plane: 500/(0.88479·1747.5) + 0.6·40/(0.93223·150.99/1.05) = 0.32339 + 0.17904 = 0.5024
  // with LTB: Mcr(C1 = 1) = 426.7 → λ̄D = 0.5948, Φ = 0.5[1 + 0.21·0.1948 + 0.3538] = 0.69737,
  //           χD = 1/(0.69737 + √(0.48633 − 0.35383)) = 0.94217 → MD,Rd = 135.48 kNm
  //           500/(0.63649·1747.5) + 0.6·40/(0.93223·135.48) = 0.44953 + 0.19002 = 0.6396
  const Ncry = Math.PI ** 2 * E * HEB200.Iy / 16;
  const ay = 1 - 500 / Ncry;
  const NRd = 1834.88 / 1.05;
  const lam = Math.sqrt(150.9875 / steelHelpers.mcrLTB(E, G, HEB200.Iz, HEB200.Iw, HEB200.It, L, 1));
  const phi = 0.5 * (1 + 0.21 * (lam - 0.4) + lam * lam);
  const chiD = 1 / (phi + Math.sqrt(phi * phi - lam * lam));
  const e1 = 500 / (0.88479 * NRd) + 0.6 * 40 / (ay * 150.9875 / 1.05);
  const e2 = 500 / (0.63649 * NRd) + 0.6 * 40 / (ay * chiD * 150.9875 / 1.05);
  assert.ok(near(e2, 0.6396, 0.003));
  assert.ok(near(r.checks.Interaction.eta, Math.max(e1, e2), 3e-3), r.checks.Interaction.detail);
  assert.match(r.checks.Interaction.detail, /ωy=0\.60/);
});

test('cross-section classification (Tab. 5.2)', () => {
  const { classInternal, classOutstand, classCHS } = steelHelpers;
  // IPE 600 web S235: c = 600 − 2·19 − 2·24 = 514 mm, tw = 12 → c/t = 42.8
  assert.equal(classInternal(42.8, 1, 1, -1), 1);       // pure bending: ≤ 72ε
  assert.equal(classInternal(42.8, 1, 1, 1), 4);        // pure compression: > 42ε
  // S355 (ε = 0.814): c/t = 30 in compression → 33ε = 26.9, 38ε = 30.9 → class 2
  assert.equal(classInternal(30, Math.sqrt(235 / 355), 1, 1), 2);
  assert.equal(classInternal(30, 1, -1, -2), 1);        // fully in tension
  assert.equal(classOutstand(9.5, 1), 2);
  assert.equal(classOutstand(15, 1), 4);
  assert.equal(classCHS(60, 1), 2);
});

test('Cm (Annex B Table B.3) and SIA ω', () => {
  const { cmAnnexB, omegaSIA } = steelHelpers;
  assert.ok(near(cmAnnexB({ linear: true, psi: -1, Mh: 1, Ms: 0 }), 0.4, 1e-9));
  assert.ok(near(cmAnnexB({ linear: true, psi: 0.5, Mh: 1, Ms: 0 }), 0.8, 1e-9));
  assert.ok(near(cmAnnexB({ linear: false, psi: 1, Mh: 0, Ms: 10 }), 0.95, 1e-9)); // simply supported, UDL
  assert.ok(near(cmAnnexB({ linear: false, psi: 1, Mh: -12, Ms: 6 }), 0.5, 1e-9)); // fixed ends, UDL
  assert.equal(cmAnnexB({ linear: true, psi: 1 }, true), 0.9);
  assert.ok(near(omegaSIA({ linear: true, psi: 0 }), 0.6, 1e-9));
  assert.equal(omegaSIA({ linear: false, psi: 1 }), 1);
});

test('RHS, CHS, RECT, truss and aluminium paths run and give plausible results', () => {
  const L = 3;
  const secs = [
    { shape: 'RHS', fabrication: 'rolled', dims: { h: 0.2, b: 0.1, t: 0.008 } },
    { shape: 'CHS', fabrication: 'rolled', dims: { d: 0.1683, t: 0.005 } },
    { shape: 'RECT', dims: { h: 0.1, b: 0.05 } },
    { shape: 'BOX', fabrication: 'welded', dims: { h: 0.4, b: 0.3, tw: 0.01, tf: 0.015 } },
  ];
  for (const sec of secs) {
    const model = lineModel({ L, sec, mat: S235 });
    const mesh = lineMesh(2);
    const res = { cases: { 'LC:1': lineCase(mesh, L, { N: () => -50, My: (x) => 5 * x, Mz: () => 1, Vz: () => 5, T: () => 0.2 }) } };
    const [r] = checkSteelMembers(model, mesh, res, ['LC:1']);
    assert.ok(r && Number.isFinite(r.eta) && r.eta > 0 && r.eta < 5, `${sec.shape}: ${JSON.stringify(r && r.checks)}`);
    for (const c of Object.values(r.checks)) assert.ok(Number.isFinite(c.eta) && typeof c.detail === 'string');
  }
  // hollow sections are not susceptible to LTB
  const model = lineModel({ L, sec: secs[0], mat: S235 });
  const mesh = lineMesh(2);
  const [r] = checkSteelMembers(model, mesh, { cases: { 'LC:1': lineCase(mesh, L, { My: () => 20 }) } }, ['LC:1']);
  assert.ok(!r.checks.LTB);
  // truss: only N and flexural buckling
  const tm = lineModel({ L, sec: secs[1], mat: { ...S235, type: 'aluminium', E: 70e6, fy: 200000 }, type: 'truss' });
  const [t] = checkSteelMembers(tm, mesh, { cases: { 'LC:1': lineCase(mesh, L, { N: () => 100 }) } }, ['LC:1']);
  assert.deepEqual(Object.keys(t.checks).sort(), ['FB-y', 'FB-z', 'N']);
  assert.ok(t.notes.some((s) => /aluminium/.test(s)));
});

test('V > 0.5 Vpl reduces My,Rd (6.2.8)', () => {
  const L = 1;
  const model = lineModel({ L, sec: IPE300, mat: S235, design: { KLT: 0 } });
  const mesh = lineMesh(1);
  // Vz = 300 kN > 0.5·348.4: ρ = (2·300/348.4 − 1)² = 0.5216; Aw = hw·tw = 0.2786·0.0071 = 19.78 cm²
  // My,V,Rd = (628.4 − 0.5216·19.78²/(4·0.71))·235e-3 = (628.4 − 71.9)·0.235 = 130.8 kNm
  const res = { cases: { 'LC:1': lineCase(mesh, L, { Vz: () => 300, My: () => 100 }) } };
  const [r] = checkSteelMembers(model, mesh, res, ['LC:1']);
  const Vpl = 25.68e-4 * 235000 / Math.sqrt(3);
  const Avz = IPE300.A - 2 * 0.15 * 0.0107 + (0.0071 + 0.03) * 0.0107;
  const VplX = Avz * 235000 / Math.sqrt(3);
  const rho = (2 * 300 / VplX - 1) ** 2;
  const Aw = 0.2786 * 0.0071;
  const MyV = (IPE300.Wply - rho * Aw * Aw / (4 * 0.0071)) * 235000;
  assert.ok(near(Vpl, VplX, 2e-3));
  assert.ok(near(r.checks.My.eta, 100 / MyV, 1e-3), r.checks.My.detail);
  assert.ok(near(MyV, 130.8, 0.005));
  assert.ok(!r.checks.LTB, 'KLT = 0 → no LTB check');
});

test('robustness: missing data never throws', () => {
  const mesh = lineMesh(2);
  const res = { cases: { 'LC:1': lineCase(mesh, 3, { My: () => 10 }) } };
  const m1 = lineModel({ L: 3, sec: IPE300, mat: S235 });
  m1.lines[0].element.section = 99;
  let out = checkSteelMembers(m1, mesh, res, ['LC:1']);
  assert.equal(out.length, 0);
  assert.ok(out.warnings.some((w) => /no section/.test(w)));
  const m2 = lineModel({ L: 3, sec: { shape: 'GENERIC', A: 1e-3, Iy: 1e-5, Iz: 1e-6 }, mat: S235 });
  out = checkSteelMembers(m2, mesh, res, ['LC:1', 'CO:7']);
  assert.equal(out.length, 1);
  assert.ok(out[0].notes.length > 0 && Number.isFinite(out[0].eta));
  assert.ok(out.warnings.some((w) => /CO:7/.test(w)));
  assert.deepEqual(checkSteelMembers(null, null, null, null).length, 0);
  assert.deepEqual(checkSteelMembers({}, {}, {}, []).length, 0);
  const m3 = lineModel({ L: 3, sec: IPE300, mat: S235, design: { steelCheck: false } });
  assert.equal(checkSteelMembers(m3, mesh, res, ['LC:1']).length, 0);
  // default case keys: all ULS combinations of the model
  const m4 = lineModel({ L: 3, sec: IPE300, mat: S235 });
  m4.combinations = [{ id: 1, name: 'ULS 1', type: 'ULS', factors: { 1: 1.35 } }, { id: 2, name: 'SLS', type: 'SLS-CHAR', factors: { 1: 1 } }];
  const res4 = { cases: { 'LC:1': res.cases['LC:1'], 'CO:1': res.cases['LC:1'], 'CO:2': res.cases['LC:1'] } };
  const [r4] = checkSteelMembers(m4, mesh, res4);
  assert.equal(r4.governing.caseKey, 'CO:1');
});

done();
