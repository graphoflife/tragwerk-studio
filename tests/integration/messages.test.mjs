// Messages of the calculation modules: code ↔ table in sync, no prose pushed past the table, every
// message of the example designs renders in both languages.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGES, Msg } from '../../js/core/messages.js';
import { EXAMPLES } from '../../js/examples.js';
import { buildMesh } from '../../js/mesh/mesher.js';
import { runStatic } from '../../js/fem/index.js';
import { expandLoadPanels } from '../../js/fem/panels.js';
import { checkSteelMembers } from '../../js/design/steel.js';
import { checkTimberMembers } from '../../js/design/timber.js';
import { designRCSurfaces, designRCBeams } from '../../js/design/concrete.js';
import { designRCColumns } from '../../js/design/column.js';
import { checkPunching } from '../../js/design/punching.js';

const js = join(dirname(fileURLToPath(import.meta.url)), '../../js');
const sources = [...readdirSync(join(js, 'design')).map((f) => join(js, 'design', f)), join(js, 'fem/panels.js')].filter((f) => f.endsWith('.js'));

// 1. table: both languages, same placeholders
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const [code, m] of Object.entries(MESSAGES)) {
  assert.ok(m.en && m.de, `${code}: en and de`);
  assert.equal(holes(m.en), holes(m.de), `${code}: placeholders differ between en and de`);
}

// 2. every msg('…') code in the sources exists; no prose pushed directly
const used = new Set();
for (const f of sources) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bmsg\(([^,)]*)/g)) for (const c of m[1].matchAll(/'([\w.]+)'/g)) used.add(c[1]);
  const prose = [...src.matchAll(/(?:notes|warnings)\.push\(\s*[`'"]|\bW\(\s*[`'"]|skip:\s*[`'"]/g)];
  assert.equal(prose.length, 0, `${f}: message pushed as prose instead of msg(code, …)`);
}
for (const c of used) assert.ok(MESSAGES[c], `unknown message code '${c}'`);

// 3. runtime: all notes and warnings of the example designs are messages that render in both languages
let n = 0;
const check = (list) => {
  for (const m of list || []) {
    assert.ok(m instanceof Msg, `not a message: ${m}`);
    for (const lang of ['en', 'de']) assert.ok(!/\{\w+\}/.test(m.format(lang)), `${m.code}: unfilled placeholder in ${lang}`);
    n++;
  }
};
for (const ex of EXAMPLES) {
  const { model: m, warnings } = expandLoadPanels(ex.build());
  check(warnings);
  const mesh = buildMesh(m, {});
  const res = runStatic(m, mesh, {});
  const keys = [...m.combinations.filter((c) => c.type === 'ULS').map((c) => 'CO:' + c.id), 'CO:999'];
  for (const code of ['EC', 'SIA']) {
    const o = { code };
    for (const out of [checkSteelMembers(m, mesh, res, keys, o), checkTimberMembers(m, mesh, res, keys, o), designRCBeams(m, mesh, res, keys, o), designRCColumns(m, mesh, res, keys, o)]) {
      check(out.warnings);
      for (const r of out) check(r.notes);
    }
    check(designRCSurfaces(m, mesh, res, keys, o).warnings);
    check(checkPunching(m, mesh, res, keys, o).warnings);
  }
}
assert.ok(n > 200, `only ${n} messages checked`);
console.log(`messages: ${Object.keys(MESSAGES).length} codes in sync, ${n} example messages render in en/de`);
