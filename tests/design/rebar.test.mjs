// Tests for js/design/rebar.js – reinforcement layout suggestions.
import assert from 'node:assert/strict';
import { suggestMesh, suggestBars, suggestStirrups, meshArea, barArea } from '../../js/design/rebar.js';
import { near, runner } from './helpers.mjs';

const { test, done } = runner('rebar');

test('slab mesh: largest spacing with the preferred diameter', () => {
  // 5.53 cm²/m with Ø12: s ≤ 1.131/5.53 = 0.2045 → 200 mm (5.65 cm²/m)
  const r = suggestMesh(5.53e-4, { dia: 0.012 });
  assert.equal(r.dia, 0.012);
  assert.ok(near(r.s, 0.2, 1e-9) && r.area >= 5.53e-4);
  // small area → maximum spacing 250 mm
  assert.ok(near(suggestMesh(1e-4, { dia: 0.010 }).s, 0.25, 1e-9));
  // 20 cm²/m does not fit Ø12 at ≥ 100 mm → larger bar
  const big = suggestMesh(20e-4, { dia: 0.012 });
  assert.ok(big.dia > 0.012 && big.area >= 20e-4 && big.s >= 0.1);
  assert.equal(suggestMesh(0), null);
  assert.ok(near(meshArea(0.012, 0.15), 7.54e-4, 1e-3));
});

test('beam bars and stirrups', () => {
  // 11.5 cm² in a 300 mm web with Ø20: 4 Ø20 = 12.57 cm², fits in one layer (4·20 + 3·20 = 140 ≤ 220 mm)
  const b = suggestBars(11.5e-4, { b: 0.3, dia: 0.020 });
  assert.equal(b.n, 4); assert.equal(b.dia, 0.020); assert.equal(b.layers, 1);
  assert.ok(b.area >= 11.5e-4);
  // at least two bars
  assert.equal(suggestBars(1e-5, { dia: 0.016 }).n, 2);
  // asw = 5 cm²/m, Ø8 two legs: s ≤ 1.005/5 = 0.201 → 200 mm, limited by 0.75·d = 0.4 → 300 mm cap
  const s = suggestStirrups(5e-4, { dia: 0.008, d: 0.55 });
  assert.ok(near(s.s, 0.2, 1e-9) && s.area >= 5e-4);
  // spacing limit 0.75·d
  assert.ok(suggestStirrups(1e-5, { d: 0.3 }).s <= 0.225 + 1e-9);
  assert.ok(near(barArea(0.02), 3.1416e-4, 1e-4));
});

done();
