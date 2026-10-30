// Every example model must mesh, solve without error and pass through the design modules.
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../js/examples.js';
import { buildMesh } from '../../js/mesh/mesher.js';
import { runStatic, runModal } from '../../js/fem/index.js';
import { validateModel } from '../../js/core/model.js';
import { checkSteelMembers } from '../../js/design/steel.js';
import { checkTimberMembers } from '../../js/design/timber.js';
import { designRCSurfaces, designRCBeams } from '../../js/design/concrete.js';
import { checkPunching } from '../../js/design/punching.js';

const verbose = process.argv.includes('-v');
for (const ex of EXAMPLES) {
  const m = ex.build();
  const errs = validateModel(m).filter((i) => i.level === 'err');
  assert.equal(errs.length, 0, `${ex.id}: validation errors ${JSON.stringify(errs)}`);
  const mesh = buildMesh(m, {});
  const res = runStatic(m, mesh, {});
  assert.equal(res.error, null, `${ex.id}: ${res.error?.message}`);
  assert.ok(Object.keys(res.cases).length > 0, `${ex.id}: no cases`);
  // global equilibrium of the first combination: sum of vertical reactions > 0 for gravity models
  const keys = m.combinations.filter((c) => c.type === 'ULS').map((c) => 'CO:' + c.id);
  const info = { id: ex.id, dofs: res.stats.dofs, combos: keys.length };
  if (m.materials.some((x) => x.type === 'steel')) {
    const s = checkSteelMembers(m, mesh, res, keys);
    info.steel = Math.max(...s.map((r) => r.eta)).toFixed(2);
    info.steelGov = s.sort((a, b) => b.eta - a.eta)[0]?.governing?.check;
  }
  if (m.materials.some((x) => x.type === 'timber')) {
    const s = checkTimberMembers(m, mesh, res, keys);
    info.timber = Math.max(...s.map((r) => r.eta)).toFixed(2);
  }
  if (m.domains.length && m.materials.some((x) => x.type === 'concrete')) {
    const rc = designRCSurfaces(m, mesh, res, keys);
    let mx = 0;
    for (const v of rc.asCorner) mx = Math.max(mx, v);
    info.rc_cm2m = (mx * 1e4).toFixed(1);
    assert.ok(mx < 0.01, `${ex.id}: unrealistic reinforcement ${mx * 1e4} cm²/m`);
    const p = checkPunching(m, mesh, res, keys, { rc });
    info.punching = p.items.length;
    if (ex.id === 'slab') {
      // 12 point supports: 4 corner, 6 edge, 2 interior columns; interior VEd ≈ 1.15·ULS area load·36 m²
      assert.equal(p.items.length, 12);
      assert.equal(p.items.filter((i) => i.type === 'interior').length, 2);
      assert.equal(p.items.filter((i) => i.type === 'corner').length, 4);
      const it = p.items.find((i) => i.type === 'interior');
      assert.ok(it.VEd > 500 && it.VEd < 900, `interior VEd ${it.VEd}`);
      // EC: v = β·VEd/(u1·d) with u1 = 2(c1 + c2) + 4πd
      assert.ok(Math.abs(it.u - (4 * it.c1 + 2 * Math.PI * 2 * it.d)) < 1e-9);
      assert.ok(Math.abs(it.v - 1.15 * it.VEd / (it.u * it.d)) < 1e-6);
    }
    if (ex.id === 'tbeam') {
      assert.equal(p.items.length, 0, 'columns under ribs are not punching locations');
      const rb = designRCBeams(m, mesh, res, keys);
      assert.equal(rb.filter((b) => b.tBeam).length, 3);
      const mid = rb.find((b) => b.tBeam.sides.length === 2);
      // bi = (6 − 0.3)/2 = 2.85 m, l0 = 10 m → beff,i = min(0.2·2.85 + 1, 2, 2.85) = 1.57 → beff = 3.44 m
      assert.ok(Math.abs(mid.tBeam.beff - 3.44) < 1e-9, `beff ${mid.tBeam.beff}`);
      // slab share: T-beam moment exceeds the rib moment alone
      assert.ok(Math.max(...mid.env.MyMax) > 1.3 * Math.max(...mid.env.MyRibMax));
      info.tbeam = Math.max(...mid.env.MyMax).toFixed(0);
    }
  }
  if (['bridge', 'building', 'frame3d'].includes(ex.id)) {
    const md = runModal(m, mesh, { nModes: 3 });
    assert.equal(md.error, null, `${ex.id} modal: ${md.error?.message}`);
    info.f1 = md.modes[0].f.toFixed(2);
  }
  if (verbose) console.log(JSON.stringify(info));
}
console.log(`examples: ${EXAMPLES.length} models solved`);
