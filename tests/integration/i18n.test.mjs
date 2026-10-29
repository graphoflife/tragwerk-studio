// Every literal t('…') key in the UI must have an English translation (unless it is language-neutral).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN } from '../../js/i18n-en.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../js');
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['fem', 'mesh', 'design', 'lib'].includes(f)) walk(p); } else if (p.endsWith('.js')) files.push(p);
  }
})(root);

const neutral = (s) => !/[a-zäöüß]{3,}/i.test(s.replace(/\{\w+\}/g, '')) || /^(Tragwerk Studio|Eurocode|Deutsch|English)$/.test(s);
const missing = new Set();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
    const key = m[1].replace(/\\'/g, "'");
    if (!(key in EN) && !neutral(key)) missing.add(key);
  }
}
if (missing.size) console.log([...missing].map((k) => `  '${k.replace(/'/g, "\\'")}': '',`).join('\n'));
assert.equal(missing.size, 0, `${missing.size} untranslated UI strings`);
console.log(`i18n: ${Object.keys(EN).length} translations, all keys covered`);
