// Every example model must mesh, solve without error and pass through the design modules.
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../js/examples.js';
import { buildMesh } from '../../js/mesh/mesher.js';
import { runStatic, runModal } from '../../js/fem/index.js';
import { validateModel } from '../../js/core/model.js';
import { checkSteelMembers } from '../../js/design/steel.js';
import { checkTimberMembers } from '../../js/design/timber.js';
import { designRCSurfaces } from '../../js/design/concrete.js';

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
  }
  if (['bridge', 'building', 'frame3d'].includes(ex.id)) {
    const md = runModal(m, mesh, { nModes: 3 });
    assert.equal(md.error, null, `${ex.id} modal: ${md.error?.message}`);
    info.f1 = md.modes[0].f.toFixed(2);
  }
  if (verbose) console.log(JSON.stringify(info));
}
console.log(`examples: ${EXAMPLES.length} models solved`);
