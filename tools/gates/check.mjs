#!/usr/bin/env node
// `npm run check`: spec structure plus package boundaries. A package whose package.json sets
// "skillnib": {"runtimeNeutral": true} must have no dependencies and no node: imports in src/.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const problems = [];
try { execFileSync('node', [fileURLToPath(new URL('./speclink.mjs', import.meta.url)), 'lint'], { stdio: 'inherit' }); } catch { problems.push('spec lint failed'); }

const walk = async d => (await readdir(d, { withFileTypes: true })).flatMap(e => e.isDirectory() ? [] : [join(d, e.name)]).concat(
  ...(await Promise.all((await readdir(d, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => walk(join(d, e.name))))));
for (const pkg of await readdir('packages').catch(() => [])) {
  const raw = await readFile(join('packages', pkg, 'package.json'), 'utf8').catch(() => null);
  if (!raw) continue;
  const j = JSON.parse(raw);
  if (!j.skillnib?.runtimeNeutral) continue;
  for (const k of ['dependencies', 'peerDependencies', 'optionalDependencies']) if (j[k] && Object.keys(j[k]).length) problems.push(`packages/${pkg}: runtime-neutral package declares ${k}`);
  for (const f of (await walk(join('packages', pkg, 'src')).catch(() => [])).filter(f => /\.(m?js|ts)$/.test(f))) {
    const src = await readFile(f, 'utf8');
    if (/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:|fs|path|crypto|os|child_process)\b/.test(src)) problems.push(`${f}: imports a Node-only module`);
  }
}
if (problems.length) { console.error('check failed:\n  - ' + problems.join('\n  - ')); process.exit(1); }
console.log('check ok');
