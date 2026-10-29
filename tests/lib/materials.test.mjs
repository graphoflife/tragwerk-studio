// Material library: EN values in internal units (kN/m², t/m³).
import assert from 'node:assert/strict';
import { MATERIAL_LIBRARY, getLibraryMaterial } from '../../js/lib/materials.js';

const MPA = 1000;
const names = MATERIAL_LIBRARY.map((m) => m.name);
for (const n of ['S235', 'S275', 'S355', 'S420', 'S460',
  'C12/15', 'C16/20', 'C20/25', 'C25/30', 'C30/37', 'C35/45', 'C40/50', 'C45/55', 'C50/60',
  'C16', 'C24', 'C30', 'GL24h', 'GL28h', 'GL32h', 'EN AW-6061 T6', 'EN AW-6082 T6', 'Rebar B500B']) {
  assert.ok(names.includes(n), `library contains ${n}`);
}
assert.equal(new Set(names).size, names.length, 'unique names');

for (const m of MATERIAL_LIBRARY) {
  assert.equal(m.id, undefined, 'templates have no id');
  assert.ok(['steel', 'concrete', 'timber', 'aluminium', 'other'].includes(m.type));
  for (const k of ['E', 'G', 'nu', 'rho', 'alpha']) assert.ok(Number.isFinite(m[k]) && m[k] > 0, `${m.name}.${k}`);
  assert.equal(typeof m.norm, 'string');
  assert.ok(m.norm.startsWith('EN'));
  if (m.type === 'steel' || m.type === 'aluminium') assert.ok(m.fy > 0 && m.fu > m.fy * 0.99);
  if (m.type === 'concrete') assert.ok(m.fck > 0 && m.fctm > 0);
  if (m.type === 'timber') {
    for (const k of ['fmk', 'ft0k', 'fc0k', 'fvk', 'ft90k', 'fc90k', 'E0mean', 'E005', 'Gmean', 'rhok']) assert.ok(m.timber[k] > 0, `${m.name}.timber.${k}`);
    assert.ok(['solid', 'glulam'].includes(m.timber.kind));
    assert.equal(m.timber.serviceClass, 1);
    assert.equal(m.E, m.timber.E0mean); assert.equal(m.G, m.timber.Gmean);
  }
}

// steel
{
  const s = getLibraryMaterial('S355');
  assert.equal(s.type, 'steel');
  assert.equal(s.E, 210000 * MPA); assert.equal(s.nu, 0.3); assert.equal(s.rho, 7.85); assert.equal(s.alpha, 1.2e-5);
  assert.ok(Math.abs(s.G - 210000 * MPA / 2.6) < 1e-6);
  assert.equal(s.fy, 355 * MPA); assert.equal(s.fu, 510 * MPA);
  assert.equal(getLibraryMaterial('S235').fy, 235 * MPA); assert.equal(getLibraryMaterial('S235').fu, 360 * MPA);
  assert.equal(getLibraryMaterial('S275').fu, 430 * MPA);
  assert.equal(getLibraryMaterial('S460').fy, 460 * MPA);
  assert.ok(s.norm.includes('EN 1993-1-1'));
}
// concrete (EN 1992-1-1 Tab. 3.1)
{
  const tab = { 'C12/15': [12, 1.6, 27], 'C20/25': [20, 2.2, 30], 'C25/30': [25, 2.6, 31], 'C30/37': [30, 2.9, 33], 'C35/45': [35, 3.2, 34], 'C50/60': [50, 4.1, 37] };
  for (const [n, [fck, fctm, Ecm]] of Object.entries(tab)) {
    const c = getLibraryMaterial(n);
    assert.equal(c.type, 'concrete');
    assert.equal(c.fck, fck * MPA); assert.equal(c.fctm, fctm * MPA); assert.equal(c.E, Ecm * 1e6);
    assert.equal(c.nu, 0.2); assert.equal(c.rho, 2.5); assert.equal(c.alpha, 1e-5);
    assert.ok(Math.abs(c.G - c.E / 2.4) < 1e-6);
    assert.equal(c.norm, 'EN 1992-1-1');
  }
}
// timber
{
  const c24 = getLibraryMaterial('C24');
  assert.equal(c24.timber.fmk, 24 * MPA); assert.equal(c24.timber.fc0k, 21 * MPA); assert.equal(c24.timber.fvk, 4 * MPA);
  assert.equal(c24.timber.E0mean, 11000 * MPA); assert.equal(c24.timber.E005, 7400 * MPA); assert.equal(c24.timber.Gmean, 690 * MPA);
  assert.equal(c24.timber.rhok, 0.35); assert.equal(c24.rho, 0.42); assert.equal(c24.timber.kind, 'solid');
  const gl = getLibraryMaterial('GL24h');
  assert.equal(gl.timber.kind, 'glulam'); assert.equal(gl.timber.fmk, 24 * MPA); assert.equal(gl.timber.ft0k, 19.2 * MPA);
  assert.equal(gl.timber.E0mean, 11500 * MPA); assert.equal(gl.timber.rhok, 0.385);
  assert.equal(getLibraryMaterial('GL32h').timber.E0mean, 14200 * MPA);
}
// aluminium & rebar
{
  const a = getLibraryMaterial('EN AW-6082 T6');
  assert.equal(a.type, 'aluminium'); assert.equal(a.E, 70000 * MPA); assert.equal(a.rho, 2.7); assert.equal(a.alpha, 2.3e-5);
  assert.equal(a.fy, 260 * MPA); assert.equal(a.fu, 310 * MPA);
  assert.equal(getLibraryMaterial('EN AW-6061 T6').fy, 240 * MPA);
  const r = getLibraryMaterial('Rebar B500B');
  assert.equal(r.type, 'other'); assert.equal(r.fy, 500 * MPA); assert.equal(r.E, 200000 * MPA);
}
// lookup & copies
{
  assert.equal(getLibraryMaterial('s355').name, 'S355');
  assert.equal(getLibraryMaterial('gl 24h').name, 'GL24h');
  assert.equal(getLibraryMaterial('B500B').name, 'Rebar B500B');
  assert.equal(getLibraryMaterial('unknown'), null);
  const x = getLibraryMaterial('C24'); x.timber.fmk = 0; x.E = 0;
  assert.equal(getLibraryMaterial('C24').timber.fmk, 24 * MPA);
  assert.equal(MATERIAL_LIBRARY.find((m) => m.name === 'C24').E, 11000 * MPA);
}

console.log('materials: ok');
