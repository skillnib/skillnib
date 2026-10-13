#!/usr/bin/env node
// `npm run release:check`: pack, inspect, install into a temporary directory with a space in its name, and run the installed nib.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, MAX_TARBALL_BYTES, expectedFiles, pack, packedPackageJson, forbiddenFiles, importGraphProblems, install, run, fixtureProject } from './lib.mjs';

const problems = [];
const bad = m => { problems.push(m); console.error('  FAIL ' + m); };
const { tgz, files, size } = pack();
console.log(`packed ${files.length} files, ${size} bytes`);

const want = expectedFiles(), extra = files.filter(f => !want.includes(f)), missing = want.filter(f => !files.includes(f));
// npm adds LICENSE and README.md on its own; treat them as expected when present in the repository
for (const f of extra) if (!['LICENSE', 'README.md'].includes(f)) bad(`unexpected file in the package: ${f}`);
for (const f of missing) bad(`missing from the package: ${f}`);
for (const f of forbiddenFiles(files)) bad(`forbidden file in the package: ${f}`);
if (size > MAX_TARBALL_BYTES) bad(`tarball is ${size} bytes, over ${MAX_TARBALL_BYTES}`);
if (!files.includes('LICENSE')) bad('LICENSE is not in the package');

const pkg = packedPackageJson(tgz);
if (pkg.name !== 'skillnib') bad('name is not skillnib');
if (pkg.license !== 'Apache-2.0') bad('license is not Apache-2.0');
if (pkg.bin?.nib !== 'apps/cli/bin/nib.js') bad('bin.nib is wrong');
if (!(Number((pkg.engines?.node ?? '').match(/\d+/)?.[0]) >= 22)) bad('engines.node is below 22');
if (pkg.dependencies && Object.keys(pkg.dependencies).length) bad('the package declares dependencies');
for (const s of ['preinstall', 'install', 'postinstall']) if (pkg.scripts?.[s]) bad(`install-time script ${s}`);

const text = f => readFileSync(join(REPO, f), 'utf8');
for (const p of importGraphProblems(files, text)) bad(p);

const inst = install(tgz);
const v = run(inst.nib, ['--version']); if (v.status !== 0 || v.stdout.trim() !== pkg.version) bad(`nib --version printed "${v.stdout.trim()}" (exit ${v.status}), expected ${pkg.version}`);
const h = run(inst.nib, ['--help']); if (h.status !== 0 || !/usage:/.test(h.stdout)) bad('nib --help failed');
if (run(inst.nib, []).status !== 2) bad('nib with no command should exit 2');
const proj = fixtureProject();
const init = run(inst.nib, ['init', 'claude'], { cwd: proj }); if (init.status !== 0) bad('nib init claude failed: ' + init.stderr);
else {
  const settings = JSON.parse(readFileSync(join(proj, '.claude', 'settings.local.json'), 'utf8')), cmd = settings.hooks.UserPromptSubmit[0].hooks[0].command;
  if (!cmd.includes(inst.entry)) bad(`the hook command does not point at the installed entry point: ${cmd}`);
  const hook = run('sh', ['-c', cmd], { cwd: proj, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: proj, prompt: 'Write the incident report: the payments API returned 500 errors for 20 minutes because a TLS certificate expired.' }) });
  if (hook.status !== 0 || !/Report structure/.test(hook.stdout)) bad('the installed hook did not deliver the expected section: ' + (hook.stderr || hook.stdout.slice(0, 200)));
}
const ask = run(inst.nib, ['ask', 'incident report structure headings', '--k', '1'], { cwd: proj }); if (ask.status !== 0 || !/Report structure/.test(ask.stdout)) bad('the installed ask did not deliver the expected section');
const imp = run(inst.nib, ['import', join(proj, '.claude', 'skills', 'acme-sql-style', 'SKILL.md'), '--store', join(proj, 'other-store')], { cwd: proj }); if (imp.status !== 0 || !/Imported 1 skill/.test(imp.stdout)) bad('the installed import of a single file failed: ' + imp.stderr);
if (!existsSync(join(inst.prefix, 'node_modules', 'skillnib', 'LICENSE'))) bad('LICENSE is not in the installed package');

if (problems.length) { console.error(`release check failed: ${problems.length} problem${problems.length === 1 ? '' : 's'}`); process.exit(1); }
console.log(`release check ok: ${files.length} files, ${size} bytes, installed under "${inst.prefix}"`);
