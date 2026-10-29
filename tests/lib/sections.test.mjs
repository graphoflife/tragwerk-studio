// Cross-section library: table sections vs. published values, parametric shapes vs. closed forms.
import assert from 'node:assert/strict';
import {
  SECTION_FAMILIES, getLibrarySection, makeParametricSection, computeSectionProps, sectionOutline,
} from '../../js/lib/sections.js';

const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b} (tol ${tol * 100}%)`);
const cm2 = 1e-4, cm3 = 1e-6, cm4 = 1e-8, cm6 = 1e-12;

// ---------------------------------------------------------------- families
{
  const keys = SECTION_FAMILIES.map((f) => f.key);
  for (const k of ['IPE', 'HEA', 'HEB', 'HEM', 'IPN', 'UPN', 'SHS', 'RHS', 'CHS', 'L']) assert.ok(keys.includes(k), k);
  const fam = Object.fromEntries(SECTION_FAMILIES.map((f) => [f.key, f]));
  assert.equal(fam.IPE.shape, 'I'); assert.equal(fam.UPN.shape, 'U'); assert.equal(fam.SHS.shape, 'RHS'); assert.equal(fam.CHS.shape, 'CHS');
  for (const n of ['IPE 80', 'IPE 220', 'IPE 240', 'IPE 270', 'IPE 300', 'IPE 330', 'IPE 360', 'IPE 400', 'IPE 450', 'IPE 500', 'IPE 550', 'IPE 600']) assert.ok(fam.IPE.names.includes(n), n);
  assert.ok(fam.HEA.names.includes('HEA 100') && fam.HEA.names.includes('HEA 1000'));
  assert.ok(fam.HEB.names.includes('HEB 100') && fam.HEB.names.includes('HEB 1000'));
  assert.ok(fam.HEM.names.includes('HEM 600'));
  assert.ok(fam.UPN.names.includes('UPN 80') && fam.UPN.names.includes('UPN 400'));
  assert.ok(fam.SHS.names.includes('SHS 40x4') && fam.SHS.names.includes('SHS 300x12.5'));
  assert.ok(fam.RHS.names.includes('RHS 50x30x3') && fam.RHS.names.includes('RHS 400x200x12.5'));
  assert.ok(fam.CHS.names.includes('CHS 21.3x2.6') && fam.CHS.names.includes('CHS 508x16'));
  assert.ok(fam.L.names.includes('L 30x3') && fam.L.names.includes('L 200x20'));
  // every library section can be built and has sane properties
  for (const f of SECTION_FAMILIES) {
    for (const n of f.names) {
      const s = getLibrarySection(n);
      assert.ok(s, n);
      assert.equal(s.name, n); assert.equal(s.family, f.key); assert.equal(s.shape, f.shape);
      assert.equal(s.fabrication, 'rolled');
      for (const k of ['A', 'Iy', 'Iz', 'It', 'Wely', 'Welz', 'Wply', 'Wplz', 'Avy', 'Avz', 'iy', 'iz', 'ymax', 'zmax']) {
        assert.ok(Number.isFinite(s[k]) && s[k] > 0, `${n}.${k}`);
      }
      assert.ok(s.Iw >= 0 && s.id === undefined);
      assert.ok(s.Wply >= s.Wely * 0.999 && s.Wplz >= s.Welz * 0.999, `${n}: Wpl >= Wel`);
      const o = sectionOutline(s);
      assert.ok(o.outer.length >= 3, `${n} outline`);
    }
  }
  assert.equal(getLibrarySection('XYZ 123'), null);
  // lenient lookup
  assert.equal(getLibrarySection('heb200').name, 'HEB 200');
  assert.equal(getLibrarySection('HE 200 B').name, 'HEB 200');
  assert.equal(getLibrarySection('SHS 100×100×5').name, 'SHS 100x5');
  assert.equal(getLibrarySection('CHS 168,3x8').name, 'CHS 168.3x8');
  // returned objects are independent copies
  const a = getLibrarySection('IPE 300'); a.A = 0; a.dims.h = 0;
  assert.ok(getLibrarySection('IPE 300').A > 0 && getLibrarySection('IPE 300').dims.h === 0.3);
}

// ---------------------------------------------------------------- IPE 300 (ArcelorMittal: A 53.8, Iy 8356, Iz 603.8, Wply 628.4, Wplz 125.2, It 20.12, Iw 125.9e3, Avz 25.68)
{
  const s = getLibrarySection('IPE 300');
  assert.deepEqual(s.dims, { h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107, r: 0.015 });
  rel(s.A, 53.8 * cm2, 0.01, 'IPE300 A');
  rel(s.Iy, 8356 * cm4, 0.01, 'IPE300 Iy');
  rel(s.Iz, 603.8 * cm4, 0.01, 'IPE300 Iz');
  rel(s.Wely, 557.1 * cm3, 0.01, 'IPE300 Wely');
  rel(s.Welz, 80.5 * cm3, 0.01, 'IPE300 Welz');
  rel(s.Wply, 628 * cm3, 0.01, 'IPE300 Wply');
  rel(s.Wplz, 125.2 * cm3, 0.01, 'IPE300 Wplz');
  rel(s.It, 20.1 * cm4, 0.02, 'IPE300 It');
  rel(s.Iw, 125.9e3 * cm6, 0.02, 'IPE300 Iw');
  rel(s.Avz, 25.68 * cm2, 0.01, 'IPE300 Avz');
  rel(s.iy, 12.46e-2, 0.01, 'IPE300 iy');
  rel(s.iz, 3.35e-2, 0.01, 'IPE300 iz');
  assert.ok(Math.abs(s.zmax - 0.15) < 1e-12 && Math.abs(s.ymax - 0.075) < 1e-12);
}

// ---------------------------------------------------------------- HEB 200 (A 78.1, Iy 5696, Iz 2003, Wply 642.5, It 59.28, Avz 24.83)
{
  const s = getLibrarySection('HEB 200');
  rel(s.A, 78.1 * cm2, 0.01, 'HEB200 A');
  rel(s.Iy, 5696 * cm4, 0.01, 'HEB200 Iy');
  rel(s.Iz, 2003 * cm4, 0.01, 'HEB200 Iz');
  rel(s.Wply, 642.5 * cm3, 0.01, 'HEB200 Wply');
  rel(s.Wplz, 305.8 * cm3, 0.01, 'HEB200 Wplz');
  rel(s.It, 59.28 * cm4, 0.02, 'HEB200 It');
  rel(s.Iw, 171.1e3 * cm6, 0.02, 'HEB200 Iw');
  rel(s.Avz, 24.83 * cm2, 0.01, 'HEB200 Avz');
}

// ---------------------------------------------------------------- more table checks
{
  const T = [
    // name, A cm², Iy cm⁴, Iz cm⁴, Wply cm³
    ['IPE 80', 7.64, 80.1, 8.49, 23.2],
    ['IPE 600', 156, 92080, 3387, 3512],
    ['HEA 200', 53.8, 3692, 1336, 429.5],
    ['HEA 1000', 347, 553800, 14000, 12820],
    ['HEB 1000', 400, 644700, 16280, 14860],
    ['HEM 300', 303, 59200, 19400, 4078],
    ['IPN 200', 33.4, 2140, 117, 250],
    ['UPN 200', 32.2, 1910, 148, 228],
    ['RHS 200x100x8', 44.8, 2234, 739, 282],
  ];
  for (const [n, A, Iy, Iz, Wply] of T) {
    const s = getLibrarySection(n);
    rel(s.A, A * cm2, 0.015, `${n} A`);
    rel(s.Iy, Iy * cm4, 0.015, `${n} Iy`);
    rel(s.Iz, Iz * cm4, 0.02, `${n} Iz`);
    rel(s.Wply, Wply * cm3, 0.02, `${n} Wply`);
  }
  // UPN centroid distance from back e_y = 2.01 cm
  const u = getLibrarySection('UPN 200');
  rel(u.ycg, 0.0201, 0.02, 'UPN200 centroid');
  // equal angle L 100x10: A 19.2, I 177, Iu 280, Iv 73.0, e 2.82
  const l = getLibrarySection('L 100x10');
  rel(l.A, 19.2 * cm2, 0.01, 'L100 A');
  rel(l.Iy, 177 * cm4, 0.01, 'L100 Iy');
  rel(l.Iu, 280 * cm4, 0.01, 'L100 Iu');
  rel(l.Iv, 73.0 * cm4, 0.015, 'L100 Iv');
  rel(l.ycg, 0.0282, 0.01, 'L100 e');
  assert.ok(Math.abs(l.alphaUV) - 45 < 1e-6);
}

// ---------------------------------------------------------------- SHS 100x5 hot finished (ro = 7.5, ri = 5 mm): analytic incl. corner radii
{
  const s = getLibrarySection('SHS 100x5');
  const b = 100, t = 5, ro = 7.5, ri = 5;
  const k = 1 - Math.PI / 4;                 // spandrel area factor
  // spandrel centroid distance from the corner tangent lines: r·(10 − 3π)/(12 − 3π)
  const e = (r) => r * (10 - 3 * Math.PI) / (12 - 3 * Math.PI);
  const A = b * b - (b - 2 * t) ** 2 - 4 * k * ro * ro + 4 * k * ri * ri;
  // second moment: rectangles minus outer spandrels plus inner spandrels (parallel axis, own inertia neglected → <0.1 %)
  const I = (b ** 4 - (b - 2 * t) ** 4) / 12
    - 4 * k * ro * ro * (b / 2 - e(ro)) ** 2 + 4 * k * ri * ri * (b / 2 - t - e(ri)) ** 2;
  rel(s.A, A * 1e-6, 0.002, 'SHS A analytic');
  rel(s.A, 18.7 * cm2, 0.01, 'SHS A table');
  rel(s.Iy, I * 1e-12, 0.003, 'SHS I analytic');
  rel(s.Iy, 279 * cm4, 0.01, 'SHS I table');
  rel(s.Wely, 55.9 * cm3, 0.01, 'SHS Wel');
  rel(s.Wply, 66.4 * cm3, 0.01, 'SHS Wpl');
  rel(s.It, 441 * cm4, 0.02, 'SHS It');
  rel(s.Avz, s.A / 2, 1e-12, 'SHS Av = A·h/(b+h)');
  assert.equal(s.Iw, 0);
}

// ---------------------------------------------------------------- CHS 168.3x8 analytic
{
  const s = getLibrarySection('CHS 168.3x8');
  const D = 0.1683, d = D - 0.016;
  const A = Math.PI / 4 * (D * D - d * d), I = Math.PI / 64 * (D ** 4 - d ** 4);
  rel(s.A, A, 1e-12, 'CHS A'); rel(s.Iy, I, 1e-12, 'CHS I'); rel(s.Iz, I, 1e-12, 'CHS Iz');
  rel(s.It, 2 * I, 1e-12, 'CHS It'); rel(s.Wely, 2 * I / D, 1e-12, 'CHS Wel');
  rel(s.Wply, (D ** 3 - d ** 3) / 6, 1e-12, 'CHS Wpl');
  rel(s.Avz, 2 * A / Math.PI, 1e-12, 'CHS Av');
  rel(s.A, 40.3 * cm2, 0.005, 'CHS A table'); rel(s.Iy, 1297 * cm4, 0.005, 'CHS I table');
}

// ---------------------------------------------------------------- parametric RECT 300x500 analytic
{
  const s = makeParametricSection('RECT', { h: 0.5, b: 0.3 });
  assert.equal(s.shape, 'RECT'); assert.equal(s.family, 'PARAM'); assert.equal(s.id, undefined);
  assert.deepEqual(s.dims, { h: 0.5, b: 0.3 });
  rel(s.A, 0.15, 1e-12, 'A');
  rel(s.Iy, 0.3 * 0.5 ** 3 / 12, 1e-12, 'Iy');
  rel(s.Iz, 0.5 * 0.3 ** 3 / 12, 1e-12, 'Iz');
  rel(s.Wely, 0.3 * 0.25 / 6, 1e-12, 'Wely');
  rel(s.Welz, 0.5 * 0.09 / 6, 1e-12, 'Welz');
  rel(s.Wply, 0.3 * 0.25 / 4, 1e-12, 'Wply');
  rel(s.Wplz, 0.5 * 0.09 / 4, 1e-12, 'Wplz');
  const c = 0.3, a = 0.5;
  rel(s.It, a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4))), 1e-12, 'It');
  // Saint-Venant table: β(1.5) = 0.196, β(2.0) = 0.229 → β(1.667) ≈ 0.207
  rel(s.It, 0.207 * 0.5 * 0.3 ** 3, 0.02, 'It vs. Saint-Venant table');
  rel(s.Avz, 0.125, 1e-12, 'Avz = 5/6 A'); rel(s.Avy, 0.125, 1e-12, 'Avy');
  rel(s.iy, 0.5 / Math.sqrt(12), 1e-12, 'iy');
  assert.equal(s.zmax, 0.25); assert.equal(s.ymax, 0.15);
  const o = sectionOutline(s);
  assert.equal(o.outer.length, 4); assert.equal(o.holes.length, 0);
}

// ---------------------------------------------------------------- other parametric shapes
{
  // CIRC
  const c = makeParametricSection('CIRC', { d: 0.4 });
  rel(c.A, Math.PI * 0.04, 1e-12, 'CIRC A'); rel(c.It, Math.PI * 0.4 ** 4 / 32, 1e-12, 'CIRC It');
  rel(c.Avz, 0.9 * c.A, 1e-12, 'CIRC Av'); rel(c.Wply, 0.4 ** 3 / 6, 1e-12, 'CIRC Wpl');
  // welded I without radii: exact rectangle composition
  const I = makeParametricSection('I', { h: 0.5, b: 0.2, tw: 0.01, tf: 0.02 });
  assert.equal(I.fabrication, 'welded');
  const hw = 0.46;
  rel(I.A, 2 * 0.2 * 0.02 + hw * 0.01, 1e-9, 'I A');
  rel(I.Iy, (0.2 * 0.5 ** 3 - 0.19 * hw ** 3) / 12, 1e-9, 'I Iy');
  rel(I.Iz, (2 * 0.02 * 0.2 ** 3 + hw * 0.01 ** 3) / 12, 1e-9, 'I Iz');
  rel(I.Wply, 2 * 0.2 * 0.02 * 0.24 + 0.01 * hw * hw / 4, 1e-9, 'I Wply');
  rel(I.Avz, hw * 0.01, 1e-12, 'I Avz welded');
  rel(I.It, (2 * 0.2 * 0.02 ** 3 + hw * 0.01 ** 3) / 3, 1e-12, 'I It');
  // BOX
  const B = makeParametricSection('BOX', { h: 0.4, b: 0.3, tw: 0.01, tf: 0.02 });
  rel(B.A, 0.4 * 0.3 - 0.28 * 0.36, 1e-9, 'BOX A');
  rel(B.Iy, (0.3 * 0.4 ** 3 - 0.28 * 0.36 ** 3) / 12, 1e-9, 'BOX Iy');
  rel(B.It, 4 * (0.29 * 0.38) ** 2 / (2 * 0.29 / 0.02 + 2 * 0.38 / 0.01), 1e-12, 'BOX It (Bredt)');
  // T: centroid & Iy by parallel axis
  const Ts = makeParametricSection('T', { h: 0.3, b: 0.2, tw: 0.01, tf: 0.02 });
  const Af = 0.2 * 0.02, Aw = 0.28 * 0.01, zf = 0.29, zw = 0.14, zc = (Af * zf + Aw * zw) / (Af + Aw);
  const IyT = 0.2 * 0.02 ** 3 / 12 + Af * (zf - zc) ** 2 + 0.01 * 0.28 ** 3 / 12 + Aw * (zw - zc) ** 2;
  rel(Ts.A, Af + Aw, 1e-9, 'T A'); rel(Ts.Iy, IyT, 1e-9, 'T Iy'); rel(Ts.zcg, zc, 1e-9, 'T zc');
  rel(Ts.Wely, IyT / Math.max(zc, 0.3 - zc), 1e-9, 'T Wely (min)');
  // L parametric 100x100x10 sharp: A = 19 cm², e = 2.87 cm
  const L = makeParametricSection('L', { h: 0.1, b: 0.1, t: 0.01 });
  rel(L.A, 19e-4, 1e-9, 'L A'); rel(L.ycg, (0.1 * 0.01 * 0.05 + 0.09 * 0.01 * 0.005) / 19e-4, 1e-9, 'L e');
  assert.ok(L.Iyz < 0, 'L product of inertia (legs along +y/+z)');
  // U parametric
  const U = makeParametricSection('U', { h: 0.3, b: 0.1, tw: 0.01, tf: 0.015 });
  rel(U.A, 2 * 0.1 * 0.015 + 0.27 * 0.01, 1e-9, 'U A');
  // RHS parametric with explicit radii vs. defaults
  const R = makeParametricSection('RHS', { h: 0.2, b: 0.1, t: 0.008 });
  rel(R.A, getLibrarySection('RHS 200x100x8').A, 1e-9, 'parametric RHS = library RHS (hot finished radii)');
  const Rc = makeParametricSection('RHS', { h: 0.2, b: 0.1, t: 0.008 }, { fabrication: 'cold' });
  assert.equal(Rc.fabrication, 'cold'); assert.ok(Rc.A < R.A);
  // GENERIC passes properties through
  const G = makeParametricSection('GENERIC', { A: 0.01, Iy: 2e-4, Iz: 1e-4, It: 5e-5, Avz: 0.008 });
  assert.equal(G.shape, 'GENERIC'); assert.equal(G.A, 0.01); assert.equal(G.Iy, 2e-4); assert.equal(G.Avz, 0.008);
  rel(G.iy, Math.sqrt(0.02), 1e-12, 'GENERIC iy');
  assert.ok(sectionOutline(G).outer.length === 4);
  // computeSectionProps = same numbers without metadata
  const P = computeSectionProps('RECT', { h: 0.5, b: 0.3 });
  assert.equal(P.A, s0A());
  function s0A() { return makeParametricSection('RECT', { h: 0.5, b: 0.3 }).A; }
  // invalid dims throw
  assert.throws(() => makeParametricSection('I', { h: 0.1, b: 0.1, tw: 0.01, tf: 0.06 }));
  assert.throws(() => makeParametricSection('RECT', { h: 0, b: 0.1 }));
  assert.throws(() => makeParametricSection('FOO', {}));
}

// ---------------------------------------------------------------- outlines: centroid at origin, orientation, holes
{
  const ring = (r) => { let A = 0, Sy = 0, Sz = 0; for (let i = 0; i < r.length; i++) { const [y0, z0] = r[i], [y1, z1] = r[(i + 1) % r.length]; const c = y0 * z1 - y1 * z0; A += c / 2; Sy += (y0 + y1) * c / 6; Sz += (z0 + z1) * c / 6; } return { A, Sy, Sz }; };
  for (const n of ['IPE 300', 'UPN 200', 'L 100x10', 'SHS 100x5', 'CHS 168.3x8', 'IPN 300']) {
    const s = getLibrarySection(n);
    const o = sectionOutline(s, { arcSegments: 8, circleSegments: 128 });
    const g = ring(o.outer);
    assert.ok(g.A > 0, `${n} outer CCW`);
    let A = g.A, Sy = g.Sy, Sz = g.Sz;
    for (const h of o.holes) { const q = ring(h); assert.ok(q.A < 0, `${n} hole CW`); A += q.A; Sy += q.Sy; Sz += q.Sz; }
    rel(A, s.A, 0.01, `${n} outline area`);
    assert.ok(Math.abs(Sy / A) < 1e-6 && Math.abs(Sz / A) < 1e-6, `${n} centroid at origin`);
    let zmax = 0; for (const [, z] of o.outer) zmax = Math.max(zmax, Math.abs(z));
    rel(zmax, s.zmax, 0.01, `${n} extent`);
  }
  assert.equal(sectionOutline(getLibrarySection('SHS 100x5')).holes.length, 1);
  assert.equal(sectionOutline(getLibrarySection('IPE 300'), { arcSegments: 0 }).outer.length, 12);
}

console.log('sections: ok');
