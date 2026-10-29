// Runs every *.test.mjs below tests/ in its own Node process and reports a summary.
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.test.mjs')) files.push(p);
  }
})(root);

let failed = 0;
for (const f of files.sort()) {
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${relative(root, f)}`);
  if (!ok) console.log((r.stdout || '') + (r.stderr || ''));
}
console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
