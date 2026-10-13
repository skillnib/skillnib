#!/usr/bin/env node
// Non-CI check: compile and verify every .md file under the given directories (for example the pinned research catalogs).
// Usage: node verify-catalogs.mjs <dir> [<dir> ...]
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileSkill, verifyManifest, moduleText } from '../src/index.js';

const walk = async d => (await Promise.all((await readdir(d, { withFileTypes: true })).map(e => e.isDirectory() ? (e.name === '.git' ? [] : walk(join(d, e.name))) : e.name.endsWith('.md') ? [join(d, e.name)] : []))).flat();
let files = 0, modules = 0, oversize = 0, bad = 0;
for (const dir of process.argv.slice(2)) for (const p of (await walk(dir)).sort()) {
  const text = await readFile(p, 'utf8'), m = await compileSkill({ path: p, text }), v = await verifyManifest(m, text);
  files++; modules += m.modules.length; oversize += m.modules.filter(x => x.flags.length).length;
  const joined = m.modules.map(x => moduleText(m, text, x.id)).join('');
  if (!v.ok || (text.trim() !== '' && joined !== text)) { bad++; console.error('FAIL', p, v.problems ?? 'not lossless'); }
}
console.log(JSON.stringify({ files, modules, oversizeUnsplittable: oversize, failures: bad }));
process.exit(bad ? 1 : 0);
