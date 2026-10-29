// Tests for js/design/combinations.js (EN 1990 and SIA 260). Plain Node script.
import assert from 'node:assert/strict';
import { generateCombinations, DEFAULT_GROUP_PARAMS, SIA_GROUP_PARAMS, groupParams } from '../../js/design/combinations.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok -', name); }
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const has = (list, type, factors) => list.find((c) => c.type === type
  && Object.keys(c.factors).length === Object.keys(factors).length
  && Object.entries(factors).every(([k, v]) => near(c.factors[k] ?? NaN, v)));

// G (permanent), Q (imposed cat. A), S (snow), W (wind, exclusive: WX | WY)
function baseModel(explicit = true) {
  const g = (id, name, type, extra) => ({ id, name, type, ...(explicit ? extra : {}), exclusive: type === 'wind' });
  return {
    version: 1, settings: {},
    loadGroups: [
      g(1, 'G', 'permanent', { gammaSup: 1.35, gammaInf: 1.0 }),
      g(2, 'Q', 'variable', { gammaSup: 1.5, psi0: 0.7, psi1: 0.5, psi2: 0.3 }),
      g(3, 'S', 'snow', { gammaSup: 1.5, psi0: 0.5, psi1: 0.2, psi2: 0 }),
      g(4, 'W', 'wind', { gammaSup: 1.5, psi0: 0.6, psi1: 0.2, psi2: 0 }),
    ],
    loadCases: [
      { id: 1, name: 'SW', group: 1 }, { id: 2, name: 'Q', group: 2 }, { id: 3, name: 'S', group: 3 },
      { id: 4, name: 'WX', group: 4 }, { id: 5, name: 'WY', group: 4 },
    ],
  };
}

test('defaults exported', () => {
  assert.equal(DEFAULT_GROUP_PARAMS.variable.psi0, 0.7);
  assert.equal(DEFAULT_GROUP_PARAMS.snow.psi1, 0.2);
  assert.equal(DEFAULT_GROUP_PARAMS.wind.psi0, 0.6);
  assert.equal(SIA_GROUP_PARAMS.permanent.gammaInf, 0.8);
  assert.equal(groupParams({ type: 'snow', psi0: 0.9 }).psi0, 0.9);
});

test('EC 6.10: counts, names, exclusivity', () => {
  const c = generateCombinations(baseModel(), { uls: '6.10' });
  const uls = c.filter((x) => x.type === 'ULS');
  // perm states: G sup/inf = 2; variable states: none 1 + lead Q 2·3 + lead S 2·3 + lead WX 2·2 + lead WY 2·2 = 21
  assert.equal(uls.length, 42);
  const x = has(c, 'ULS', { 1: 1.35, 2: 1.5, 3: 0.75, 4: 0.9 });
  assert.ok(x, 'leading Q, accompanying S and WX');
  assert.match(x.name, /^ULS \d+: 1\.35·G \+ 1\.5·Q \+ 0\.75·S \+ 0\.9·WX$/);
  assert.ok(has(c, 'ULS', { 1: 1.0, 4: 1.5 }), 'favourable G with leading wind');
  assert.ok(has(c, 'ULS', { 1: 1.35 }), 'permanent only');
  assert.ok(!c.some((k) => k.factors[4] && k.factors[5]), 'exclusive wind cases never together');
  assert.equal(c.filter((k) => k.type === 'SLS-CHAR').length, 21);
  // frequent: ψ2(S)=ψ2(W)=0 → duplicates removed: {G},{G,0.5Q},{G,0.2S}(±0.3Q),{G,0.2WX}(±0.3Q),{G,0.2WY}(±0.3Q) = 8
  assert.equal(c.filter((k) => k.type === 'SLS-FREQ').length, 8);
  assert.equal(c.filter((k) => k.type === 'SLS-QP').length, 2);
  assert.ok(has(c, 'SLS-QP', { 1: 1, 2: 0.3 }));
  const names = new Set(c.map((k) => k.name));
  assert.equal(names.size, c.length, 'unique names');
  assert.ok(c.every((k) => k.code === 'EC'));
});

test('EC 6.10a/b with ξ = 0.85', () => {
  const c = generateCombinations(baseModel(), { uls: '6.10ab' });
  const uls = c.filter((x) => x.type === 'ULS');
  assert.equal(uls.length, 2 * 12 + 2 * 20); // 6.10a: 2 perm × 2·2·3 ; 6.10b: 2 perm × 20 leading states
  assert.ok(has(c, 'ULS', { 1: 1.35, 2: 1.05 }), '6.10a');
  assert.ok(has(c, 'ULS', { 1: 0.85 * 1.35, 2: 1.5 }), '6.10b');
  assert.ok(has(c, 'ULS', { 1: 1.0, 2: 1.5, 3: 0.75 }), '6.10b, γG,inf without ξ');
});

test('ungrouped cases are permanent; empty model', () => {
  const m = { loadGroups: [], loadCases: [{ id: 7, name: 'Dead', group: null }] };
  const c = generateCombinations(m, { sls: false });
  assert.equal(c.length, 2); // 1.35·Dead and 1.0·Dead
  assert.ok(has(c, 'ULS', { 7: 1.35 }));
  assert.equal(c[0].name, 'ULS 1: 1.35·Dead');
  assert.deepEqual(generateCombinations({}), []);
  assert.deepEqual(generateCombinations(null), []);
});

test('accidental 6.11b and seismic 6.12b (100/30)', () => {
  const m = baseModel();
  m.loadGroups.push({ id: 5, name: 'A', type: 'accidental' }, { id: 6, name: 'E', type: 'seismic', exclusive: false });
  m.loadCases.push({ id: 6, name: 'Impact', group: 5 }, { id: 7, name: 'Ex', group: 6 }, { id: 8, name: 'Ey', group: 6 });
  const c = generateCombinations(m, { sls: false });
  const acc = c.filter((k) => k.type === 'ULS-ACC' && k.name.startsWith('ACC'));
  assert.equal(acc.length, 8);
  assert.ok(acc.every((k) => k.factors[1] === 1 && k.factors[6] === 1));
  assert.ok(has(c, 'ULS-ACC', { 1: 1, 6: 1, 2: 0.5 }), 'ψ1 for main accompanying Q');
  assert.ok(has(c, 'ULS-ACC', { 1: 1, 6: 1, 3: 0.2, 2: 0.3 }), 'ψ1 snow, ψ2 Q');
  const seis = c.filter((k) => k.name.startsWith('SEIS'));
  // 8 directional variants (2 leading × ±1 × ±0.3) × Q {absent, ψ2=0.3} = 16
  assert.equal(seis.length, 16);
  assert.ok(has(c, 'ULS-ACC', { 1: 1, 7: -1, 8: 0.3, 2: 0.3 }));
  assert.ok(!c.some((k) => k.factors[6] && k.factors[7]), 'accidental and seismic never together');
  assert.equal(generateCombinations(m, { accidental: false, sls: false }).filter((k) => k.type === 'ULS-ACC').length, 0);
});

test('SIA 260: γG 1.35/0.80, accompanying ψ0 without γQ, accidental ψ2', () => {
  const m = baseModel(false);
  m.settings.code = 'SIA';
  m.loadGroups.push({ id: 5, name: 'A', type: 'accidental' });
  m.loadCases.push({ id: 6, name: 'Impact', group: 5 });
  const c = generateCombinations(m);
  const uls = c.filter((k) => k.type === 'ULS');
  // SIA 260 4.4.3.4: Ed = 1.35·G + 1.5·Q + 0.6·S + 0.6·WX (ψ0 snow/wind = 0.6, no γQ on accompanying)
  const x = has(c, 'ULS', { 1: 1.35, 2: 1.5, 3: 0.6, 4: 0.6 });
  assert.ok(x);
  assert.match(x.name, /^ULS \d+: 1\.35·G \+ 1\.5·Q \+ 0\.6·S \+ 0\.6·WX$/);
  assert.ok(has(c, 'ULS', { 1: 0.8, 3: 1.5, 2: 0.7 }), 'γG,inf = 0.80, leading snow, Q with ψ0 = 0.7');
  assert.equal(uls.length, 42);
  // SIA 260 4.4.3.5: Gk + Ad + Σψ2·Qk → {G,A} and {G,A,0.3Q} only
  const acc = c.filter((k) => k.type === 'ULS-ACC');
  assert.equal(acc.length, 2);
  assert.ok(has(c, 'ULS-ACC', { 1: 1, 6: 1, 2: 0.3 }));
  // SLS frequent with SIA ψ1(wind) = 0.5
  assert.ok(has(c, 'SLS-FREQ', { 1: 1, 4: 0.5, 2: 0.3 }));
  assert.ok(c.every((k) => k.code === 'SIA'));
  // explicit opts.code overrides model settings
  assert.ok(generateCombinations(m, { code: 'EC' }).every((k) => k.code === 'EC'));
});

test('SIA with EC presets in the groups: useGroupFactors = false → SIA 260 table values', () => {
  const m = baseModel(true); // groups carry EC presets (γG,inf = 1.0, ψ snow 0.5/0.2/0)
  const withGroup = generateCombinations(m, { code: 'SIA', sls: false });
  assert.ok(has(withGroup, 'ULS', { 1: 1.0, 2: 1.5 }), 'explicit group γinf = 1.0 used');
  const table = generateCombinations(m, { code: 'SIA', sls: false, useGroupFactors: false });
  assert.ok(has(table, 'ULS', { 1: 0.8, 2: 1.5, 3: 0.6, 4: 0.6 }));
  assert.ok(!has(table, 'ULS', { 1: 1.0, 2: 1.5 }));
});

console.log(`combinations: ${n} tests passed`);
