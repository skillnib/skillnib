#!/usr/bin/env node
// Spec gates. Usage:
//   speclink.mjs lint [spec.md ...]          structure of specs (default: all docs/specs/*.md)
//   speclink.mjs link <spec.md> --update      record requirement hashes (only for APPROVED specs)
//   speclink.mjs verify <spec.md> [--base ref] full build gate: approved, link not drifted, every requirement has passing tests, diff in scope
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseSpec, lintSpec, requirementHashes, lockDrift, parseJunit, verifyLinks, report, outOfScope } from './lib.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = n => { const i = rest.indexOf(n); return i < 0 ? null : rest[i + 1] ?? true; };
const files = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--base');
const fail = (title, problems) => { console.error(`GATE FAILED: ${title}`); problems.forEach(p => console.error('  - ' + p)); process.exit(1); };
const lockPath = p => p.replace(/\.md$/, '.speclink.json');
const readLock = async p => { try { return JSON.parse(await readFile(lockPath(p), 'utf8')); } catch { return null; } };

async function lint(paths) {
  const list = paths.length ? paths : (await readdir('docs/specs').catch(() => [])).filter(f => f.endsWith('.md')).map(f => 'docs/specs/' + f);
  const bad = [];
  for (const p of list) lintSpec(parseSpec(await readFile(p, 'utf8'))).forEach(m => bad.push(`${p}: ${m}`));
  if (bad.length) fail('spec structure', bad);
  console.log(`spec lint ok (${list.length} spec${list.length === 1 ? '' : 's'})`);
}

if (cmd === 'lint') await lint(files);
else if (cmd === 'link') {
  const p = files[0], spec = parseSpec(await readFile(p, 'utf8')), probs = lintSpec(spec);
  if (probs.length) fail('spec structure', probs);
  if (flag('--update')) {
    if (spec.status !== 'APPROVED') fail('link', ['spec is not APPROVED; the user approves intent before the link is recorded']);
    await writeFile(lockPath(p), JSON.stringify({ specId: spec.specId, requirements: requirementHashes(spec) }, null, 2) + '\n');
    console.log('wrote ' + lockPath(p));
  } else { const d = lockDrift(spec, await readLock(p)); d.length ? fail('link drift', d) : console.log('link ok'); }
} else if (cmd === 'verify') {
  const p = files[0], spec = parseSpec(await readFile(p, 'utf8')), probs = lintSpec(spec);
  if (probs.length) fail('1 spec structure', probs);
  if (spec.status !== 'APPROVED') fail('2 approval', [`Status is ${spec.status}; build PRs need an APPROVED spec`]);
  const drift = lockDrift(spec, await readLock(p));
  if (drift.length) fail('3 link drift (specification changed after approval; re-review, then run "link --update")', drift);
  const run = spawnSync('node', ['--test', '--test-reporter=junit', 'packages/*/tests/*.test.js', 'apps/*/tests/*.test.js', 'tools/gates/tests/*.test.mjs'], { encoding: 'utf8', maxBuffer: 64 << 20, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
  const results = parseJunit(run.stdout);
  if (!results.length) fail('4 tests', ['no test results were produced', run.stderr.slice(0, 500)]);
  const { rows, problems } = verifyLinks(spec, results);
  const md = report(spec, rows);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  const failing = results.filter(r => r.status === 'fail').map(r => `failing test: ${r.name}`);
  if (problems.length || failing.length) fail('4 requirements verified by passing tests', [...problems, ...failing]);
  const base = flag('--base') || 'origin/main';
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const stray = outOfScope(changed, spec, p);
  if (stray.length) fail(`5 diff within Scope (${spec.scope.join(', ')})`, stray.map(f => 'outside scope: ' + f));
  console.log(`all gates passed for ${spec.specId}: ${rows.length} requirements verified, ${changed.length} files in scope`);
} else { console.error('usage: speclink.mjs lint|link|verify <spec.md> [--update] [--base ref]'); process.exit(2); }
