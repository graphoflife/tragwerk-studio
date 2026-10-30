// Tests for js/design/concrete.js – EN 1992-1-1 and SIA 262. Hand calculations in comments.
import assert from 'node:assert/strict';
import { designRCSurfaces, designRCBeams, woodArmer, designMN, concreteParams, membraneDesignForces, surfaceLayout, providedAreas, rcSurfaceDetail, FLAG_COMPRESSION_REINF, FLAG_SHEAR, FLAG_MIN } from '../../js/design/concrete.js';
import { lineModel, lineMesh, lineCase, near, runner } from './helpers.mjs';

const { test, done } = runner('concrete');
const C = (fckMPa) => ({ id: 1, name: `C${fckMPa}`, type: 'concrete', E: 33e6, nu: 0.2, rho: 2.5, fck: fckMPa * 1000, fctm: 300 * fckMPa ** (2 / 3) });

/** One-element slab (domain 1) with uniform corner forces [nx,ny,nxy,mx,my,mxy,vx,vy]. */
function slab(t, mat, forces, { code, type = 'plate', rc } = {}) {
  const model = {
    settings: code ? { code } : {},
    materials: [mat],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type, material: 1, thickness: t, rc }],
    lines: [], nodes: [], loadCases: [{ id: 1 }], combinations: [],
  };
  const mesh = { beams: [], shells: [{ nodes: [0, 1, 2, 3], domain: 1, type, material: 1, thickness: t }] };
  const sh = new Float64Array(32);
  for (let c = 0; c < 4; c++) for (let k = 0; k < 8; k++) sh[c * 8 + k] = forces[k] || 0;
  return { model, mesh, res: { cases: { 'LC:1': { beams: [], shells: sh } } } };
}

test('Wood–Armer known cases', () => {
  // pure twist m: bottom mx* = my* = |m|, top −|m|
  assert.deepEqual(woodArmer(0, 0, 10), { mxb: 10, myb: 10, mxt: -10, myt: -10 });
  // mx=10, my=5, mxy=3: bottom 13/8; top: mx−3 = 7 > 0 → mxt = 0, myt = 5 − 9/10 = 4.1 > 0 → 0
  assert.deepEqual(woodArmer(10, 5, 3), { mxb: 13, myb: 8, mxt: 0, myt: 0 });
  // mx=10, my=−8, mxy=4: bottom my* = −4 < 0 → myb = 0, mxb = 10 + 16/8 = 12; top mxt → 0, myt = −8 − 16/10 = −9.6
  const r = woodArmer(10, -8, 4);
  assert.ok(near(r.mxb, 12, 1e-12) && r.myb === 0 && r.mxt === 0 && near(r.myt, -9.6, 1e-12));
  // no twist: moments pass through
  assert.deepEqual(woodArmer(-20, 7, 0), { mxb: 0, myb: 7, mxt: -20, myt: 0 });
});

test('membrane transform (Annex F type)', () => {
  assert.deepEqual(membraneDesignForces(100, 50, 20), { Nx: 120, Ny: 70 });
  const r = membraneDesignForces(-1000, 0, 100); // compression strut in x: ny + 100²/1000 = 10
  assert.ok(near(r.Nx, -990, 1e-12) && near(r.Ny, 10, 1e-12));
});

test('EC slab strip: m = 50 kNm/m, t = 0.25, C30/37, B500 → As = 5.53 cm²/m', () => {
  // dx = 0.25 − 0.03 − 0.006 = 0.214 m; fcd = 30/1.5 = 20 MPa; fyd = 434.8 MPa
  // μ = 50/(1·0.214²·20000) = 0.05459; ω = 1 − √(1 − 2μ) = 0.05617; z = d(1 − ω/2) = 0.20799 m
  // As = 50/(0.20799·434783) = 5.529e-4 m²/m = 5.53 cm²/m  (As,min = 0.26·2.9/500·0.214 = 3.23 cm²/m)
  const { model, mesh, res } = slab(0.25, C(30), [0, 0, 0, 50]);
  const out = designRCSurfaces(model, mesh, res, ['LC:1']);
  assert.equal(out.code, 'EC');
  assert.equal(out.asCorner.length, 16);
  for (let c = 0; c < 4; c++) {
    assert.ok(near(out.asCorner[c * 4], 5.529e-4, 2e-3), `axb=${out.asCorner[c * 4]}`);
    assert.equal(out.asCorner[c * 4 + 1], 0);
    assert.equal(out.asCorner[c * 4 + 2], 0);
    assert.equal(out.asCorner[c * 4 + 3], 0);
  }
  // y direction (inner layer, dy = 0.202): μ = 50/(0.202²·20000) = 0.06127, ω = 0.06325, z = 0.19561
  // As = 50/(0.19561·434783) = 5.879e-4 m²/m; negative my → top layer
  const s2 = slab(0.25, C(30), [0, 0, 0, 0, -50]);
  const o2 = designRCSurfaces(s2.model, s2.mesh, s2.res, ['LC:1']);
  assert.ok(near(o2.asCorner[3], 5.879e-4, 2e-3), `ayt=${o2.asCorner[3]}`);
  assert.equal(o2.asCorner[1], 0);
  // small moment → minimum reinforcement 9.2.1.1: max(0.26·2.896/500, 0.0013)·0.214 = 3.22e-4
  const s3 = slab(0.25, C(30), [0, 0, 0, 5]);
  const o3 = designRCSurfaces(s3.model, s3.mesh, s3.res, ['LC:1']);
  assert.ok(near(o3.asCorner[0], 0.26 * (300 * 30 ** (2 / 3)) / 500000 * 0.214, 1e-6));
  assert.ok(o3.asCorner[0] > 0 && designRCSurfaces(s3.model, s3.mesh, s3.res, ['LC:1'], { minReinf: false }).asCorner[0] < o3.asCorner[0]);
});

test('SIA 262 slab strip: ηfc, fsd, As,min', () => {
  // C30/37: ηfc = 1 → fcd = 20 MPa → identical to EC: As = 5.53 cm²/m
  const a = slab(0.25, C(30), [0, 0, 0, 50], { code: 'SIA' });
  const oa = designRCSurfaces(a.model, a.mesh, a.res, ['LC:1']);
  assert.equal(oa.code, 'SIA');
  assert.ok(near(oa.asCorner[0], 5.529e-4, 2e-3));
  // C40/50: ηfc = (30/40)^(1/3) = 0.9086 → fcd = 0.9086·40/1.5 = 24.23 MPa
  // μ = 50/(0.214²·24228) = 0.04506, ω = 0.04613, z = 0.20906 → As = 50/(0.20906·434783) = 5.501e-4 m²/m
  // (EC with fcd = 26.67 MPa would give 5.489e-4)
  const P = concreteParams(C(40), 500000, 'SIA');
  assert.ok(near(P.fcd, 24228, 1e-3) && near(P.etaFc, 0.9086, 1e-3));
  const b = slab(0.25, C(40), [0, 0, 0, 50], { code: 'SIA' });
  assert.ok(near(designRCSurfaces(b.model, b.mesh, b.res, ['LC:1']).asCorner[0], 5.501e-4, 2e-3));
  assert.ok(near(designRCSurfaces(b.model, b.mesh, b.res, ['LC:1'], { code: 'EC' }).asCorner[0], 5.489e-4, 2e-3));
  // minimum (MRd ≥ Mcr): fctm = 0.3·40^(2/3) = 3.509 MPa, Mcr = 3509·0.25²/6 = 36.55 kNm/m
  // As,min = 36.55/(0.9·0.214·434783) = 4.365e-4 m²/m
  const c = slab(0.25, C(40), [0, 0, 0, 5], { code: 'SIA' });
  assert.ok(near(designRCSurfaces(c.model, c.mesh, c.res, ['LC:1']).asCorner[0], 4.365e-4, 3e-3));
});

test('membrane tension splits into both layers; compression reinforcement flagged', () => {
  // nx = 100 kN/m, symmetric layers (zs1 = zs2 = 0.089 m) → 50/434.8e3 = 1.15e-4 m²/m per face
  const s = slab(0.25, C(30), [100], { type: 'shell' });
  const o = designRCSurfaces(s.model, s.mesh, s.res, ['LC:1'], { minReinf: false });
  assert.ok(near(o.asCorner[0], 1.15e-4, 2e-3) && near(o.asCorner[2], 1.15e-4, 2e-3));
  assert.ok(near(o.asCorner[0] + o.asCorner[2], 100 / 434782.6, 1e-6));
  // thin slab, huge moment → x/d > 0.45 → compression reinforcement in the top layer
  const t = slab(0.15, C(25), [0, 0, 0, 120]);
  const ot = designRCSurfaces(t.model, t.mesh, t.res, ['LC:1']);
  assert.ok(ot.flags[0] & FLAG_COMPRESSION_REINF);
  assert.ok(ot.asCorner[2] > 0, 'top compression reinforcement');
  assert.ok(ot.warnings.some((w) => /compression reinforcement/.test(w)));
  // large shear in a thin plate → warning
  const v = slab(0.2, C(30), [0, 0, 0, 10, 0, 0, 300, 0]);
  const ov = designRCSurfaces(v.model, v.mesh, v.res, ['LC:1']);
  assert.ok(ov.flags[0] & FLAG_SHEAR && ov.warnings.some((w) => /vEd > vRd,c/.test(w)));
});

test('designMN: ductility limit and small eccentricity', () => {
  const s = { b: 1, h: 0.25, d: 0.214, d2: 0.036, fcd: 20000, fyd: 434783, lam: 0.8, eta: 1, xiLim: 0.45 };
  const r = designMN(50, 0, s);
  assert.ok(near(r.As1, 5.529e-4, 2e-3) && r.As2 === 0 && !r.comp);
  const r2 = designMN(0, 200, s);
  assert.equal(r2.mode, 'tension');
  assert.ok(near(r2.As1 + r2.As2, 200 / 434783, 1e-9));
  const r3 = designMN(50, -300, s); // compression reduces As
  assert.ok(r3.As1 < r.As1);
});

const B300x600 = { name: '300x600', shape: 'RECT', dims: { h: 0.6, b: 0.3 } };

test('EC beam 300×600 C25/30, M = 250 kNm → As = 11.5 cm²', () => {
  const L = 6;
  const model = lineModel({ L, sec: B300x600, mat: C(25) });
  const mesh = lineMesh(4);
  // constant moment, no shear: d = 0.6 − 0.03 − 0.01 − 0.01 = 0.55 m, fcd = 16.67 MPa
  // μ = 250/(0.3·0.55²·16667) = 0.1653, ω = 1 − √(1 − 0.3306) = 0.1818, z = 0.55(1 − 0.0909) = 0.500 m
  // As = 250/(0.500·434783) = 1.150e-3 m² = 11.50 cm²
  const res = { cases: { 'LC:1': lineCase(mesh, L, { My: () => 250 }) } };
  const [r] = designRCBeams(model, mesh, res, ['LC:1']);
  assert.equal(r.code, 'EC');
  assert.equal(r.x.length, 44);
  assert.ok(r.AsBot.every((a) => near(a, 1.150e-3, 2e-3)), `AsBot=${r.AsBot[0]}`);
  assert.ok(r.AsTop.every((a) => a === 0));
  // minimum stirrups ρw,min = 0.08·√25/500 = 0.0008 → 0.0008·0.3 = 2.4e-4 m²/m
  assert.ok(r.Asw.every((a) => near(a, 2.4e-4, 1e-6)));
  assert.equal(r.ok, true);
});

test('EC beam shear: simply supported, q = 55.56 kN/m, L = 6 m (variable strut)', () => {
  const L = 6, q = 250 * 8 / 36;
  const model = lineModel({ L, sec: B300x600, mat: C(25) });
  const mesh = lineMesh(4);
  const res = { cases: { 'LC:1': lineCase(mesh, L, { My: (x) => q * x * (L - x) / 2, Vz: (x) => q * (L / 2 - x) }) } };
  const [r] = designRCBeams(model, mesh, res, ['LC:1']);
  // support: VEd = 166.7 kN > VRd,c,min = 0.355 MPa·0.3·0.55 = 58.6 kN → stirrups
  // VRd,max(cot 2.5) = 0.3·0.495·0.54·16667/(2.5 + 0.4) = 460.9 kN ≥ VEd → cot θ = 2.5
  // Asw/s = 166.7/(0.495·434783·2.5) = 3.098e-4 m²/m
  assert.ok(near(r.Asw[0], 3.098e-4, 3e-3), `Asw=${r.Asw[0]}`);
  // midspan bending as above: 11.5 cm² (shift rule capped by the maximum)
  const mid = r.x.findIndex((x) => Math.abs(x - 3) < 1e-9);
  assert.ok(near(r.AsBot[mid], 1.150e-3, 2e-3));
  // near the support the shift rule adds ΔFtd/fyd = 0.5·166.7·2.5/434783 = 4.79e-4 m²
  assert.ok(r.AsBot[0] > 4.5e-4, `AsBot(0)=${r.AsBot[0]}`);
  assert.equal(r.ok, true);
});

test('SIA 262 beam: fixed cot α = 1, kc = 0.55, ρw,min', () => {
  const L = 6, q = 250 * 8 / 36;
  const model = lineModel({ L, sec: B300x600, mat: C(25), code: 'SIA' });
  const mesh = lineMesh(4);
  const res = { cases: { 'LC:1': lineCase(mesh, L, { My: (x) => q * x * (L - x) / 2, Vz: (x) => q * (L / 2 - x) }) } };
  const [r] = designRCBeams(model, mesh, res, ['LC:1']);
  assert.equal(r.code, 'SIA');
  // ηfc = min(1, (30/25)^(1/3)) = 1 → fcd = 16.67 MPa; same bending result 11.5 cm²
  const mid = r.x.findIndex((x) => Math.abs(x - 3) < 1e-9);
  assert.ok(near(r.AsBot[mid], 1.150e-3, 2e-3));
  // Asw/s = VEd/(z·fsd·cot α) = 166.7/(0.495·434783·1.0) = 7.745e-4 m²/m
  assert.ok(near(r.Asw[0], 7.745e-4, 3e-3), `Asw=${r.Asw[0]}`);
  // midspan: V = 0 → ρw,min = 0.001·√(25/30)·500/500 = 9.13e-4 → 2.74e-4 m²/m
  assert.ok(near(r.Asw[mid], 0.001 * Math.sqrt(25 / 30) * 0.3, 1e-6));
  assert.ok(r.notes.some((n) => /SIA 262 4\.3\.3/.test(n)));
  assert.equal(r.ok, true);
  // VRd,c (α = 45°) = 0.3·0.495·0.55·16667·0.5 = 680.6 kN → V = 800 kN fails
  const res2 = { cases: { 'LC:1': lineCase(mesh, L, { Vz: () => 800 }) } };
  const [r2] = designRCBeams(model, mesh, res2, ['LC:1']);
  assert.equal(r2.ok, false);
});

test('T beam, hogging, robustness', () => {
  const L = 5;
  const T = { shape: 'T', dims: { h: 0.6, b: 1.2, tw: 0.3, tf: 0.2 } };
  const model = lineModel({ L, sec: T, mat: C(30) });
  const mesh = lineMesh(2);
  const res = { cases: { 'LC:1': lineCase(mesh, L, { My: (x) => 300 - 120 * x }) } };
  const [r] = designRCBeams(model, mesh, res, ['LC:1']);
  // sagging at x=0: flange width 1.2 m → As ≈ 300/(0.54·434.8e3) ≈ 12.8 cm²; hogging at x=5: top
  assert.ok(r.AsBot[0] > 1.2e-3 && r.AsBot[0] < 1.35e-3, `AsBot=${r.AsBot[0]}`);
  assert.ok(r.AsTop[r.x.length - 1] > 0 && r.AsBot[r.x.length - 1] === 0);
  // unsupported section / no fck / unknown keys: no throw
  const m2 = lineModel({ L, sec: { shape: 'I', dims: {} }, mat: C(30) });
  const o2 = designRCBeams(m2, mesh, res, ['LC:1', 'CO:9']);
  assert.equal(o2.length, 0);
  assert.ok(o2.warnings.length >= 2);
  const m3 = lineModel({ L, sec: B300x600, mat: { type: 'concrete' } });
  assert.equal(designRCBeams(m3, mesh, res, ['LC:1']).length, 0);
  assert.deepEqual(designRCBeams(null, null, null).length, 0);
  const s = designRCSurfaces(null, null, null);
  assert.equal(s.asCorner.length, 0);
  const s2 = slab(0.25, { id: 1, type: 'steel', fy: 235000 }, [0, 0, 0, 50]);
  assert.equal(designRCSurfaces(s2.model, s2.mesh, s2.res, ['LC:1']).asCorner[0], 0);
});

test('surface layout, governing case, minimum flag, detail trace', () => {
  // unsymmetric covers / diameters: d = t − c − Øx/2 (x outer), y inner one bar deeper
  const L = surfaceLayout({ coverB: 0.03, coverT: 0.04, diaX: 0.012, diaY: 0.010 }, 0.25);
  assert.ok(near(L.d.xb, 0.214, 1e-9) && near(L.d.yb, 0.203, 1e-9) && near(L.d.xt, 0.204, 1e-9) && near(L.d.yt, 0.193, 1e-9));
  // legacy fields still work
  assert.ok(near(surfaceLayout({ cover: 0.03, dia: 0.012 }, 0.25).d.yb, 0.202, 1e-9));
  // Ø12 @ 150 mm = 7.54 cm²/m
  assert.ok(near(providedAreas({ xb: { dia: 0.012, s: 0.15 } })[0], 7.54e-4, 1e-3));
  const s = slab(0.25, C(30), [0, 0, 0, 50]);
  s.res.cases['LC:2'] = { beams: [], shells: Float64Array.from(s.res.cases['LC:1'].shells, (v) => v * 2) };
  const r = designRCSurfaces(s.model, s.mesh, s.res, ['LC:1', 'LC:2']);
  assert.equal(r.gov[0], 1, 'LC:2 governs axb');
  assert.deepEqual(r.keys, ['LC:1', 'LC:2']);
  assert.equal(r.domains.length, 1);
  assert.ok(near(r.domains[0].max[0], r.asCorner[0], 1e-12) && r.domains[0].maxCase[0] === 1);
  // small moment → minimum reinforcement governs and is flagged
  const sm = slab(0.25, C(30), [0, 0, 0, 2]);
  const rm = designRCSurfaces(sm.model, sm.mesh, sm.res, ['LC:1']);
  assert.ok(rm.flags[0] & FLAG_MIN);
  assert.ok(rm.domains[0].minGoverns[0]);
  const det = rcSurfaceDetail(s.model, s.mesh, s.res, ['LC:1', 'LC:2'], 0, 0);
  assert.equal(det.cases.length, 2);
  assert.equal(det.gov[0], 'LC:2');
  assert.ok(near(det.as[0], r.asCorner[0], 1e-9));
});

test('Plattenbalken: rib in a slab gets the effective flange and the slab moment', () => {
  // slab 6 × 4 m (1 m quads), rib along y = 2 from x = 0 to 6, RECT 0.3 × 0.6, C30/37
  const nodes = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 }, { id: 5, x: 0, y: 2, z: 0 }, { id: 6, x: 6, y: 2, z: 0 }];
  const model = {
    settings: {}, nodes, materials: [C(30)], sections: [{ id: 1, shape: 'RECT', dims: { h: 0.6, b: 0.3 } }],
    domains: [{ id: 1, nodes: [1, 2, 3, 4], type: 'plate', material: 1, thickness: 0.2 }],
    lines: [{ id: 1, n1: 5, n2: 6, element: { type: 'rib', material: 1, section: 1, beta: 0 } }],
    loadCases: [{ id: 1 }], combinations: [], loadGroups: [],
  };
  const X = [];
  for (let j = 0; j <= 4; j++) for (let i = 0; i <= 6; i++) X.push(i, j, 0);
  const id = (i, j) => j * 7 + i;
  const ax = { ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1] };
  const shells = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) shells.push({ nodes: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)], domain: 1, type: 'plate', material: 1, thickness: 0.2, ...ax });
  const beams = Array.from({ length: 6 }, (_, i) => ({ n1: id(i, 2), n2: id(i + 1, 2), line: 1, t0: i / 6, t1: (i + 1) / 6, ...ax, ey: [0, 1, 0] }));
  const mesh = { nodes: Float64Array.from(X), beams, shells };
  const res = lineCase(mesh, 6, { My: () => 100 });
  const sh = new Float64Array(shells.length * 32);
  for (let k = 0; k < shells.length * 4; k++) sh[k * 8 + 3] = 10; // mx = 10 kNm/m along the rib
  res.shells = sh;
  const [r] = designRCBeams(model, mesh, { cases: { 'LC:1': res } }, ['LC:1']);
  // bi = 2 − 0.15 = 1.85 m, l0 = 6 m: beff,i = min(0.2·1.85 + 0.6, 1.2, 1.85) = 0.97 → beff = 2.24 m
  assert.ok(near(r.tBeam.beff, 2.24, 1e-6), `beff=${r.tBeam.beff}`);
  assert.equal(r.section.shape, 'T');
  assert.ok(near(r.section.hf, 0.2, 1e-9));
  // M_T = 100 + 10 kNm/m · 2.24 m = 122.4 kNm
  assert.ok(near(r.env.MyMax[3], 122.4, 1e-6), `M=${r.env.MyMax[3]}`);
  assert.ok(near(r.env.MyRibMax[3], 100, 1e-9));
  // opt-out: plain rectangle, rib moment only
  model.lines[0].element.design = { rc: { tBeam: false } };
  const [r2] = designRCBeams(model, mesh, { cases: { 'LC:1': res } }, ['LC:1']);
  assert.equal(r2.tBeam, null);
  assert.ok(near(r2.env.MyMax[3], 100, 1e-9) && r2.AsBot[3] > r.AsBot[3] * 0.7);
});

done();
