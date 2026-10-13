import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../src/main.js';
import { REPO, MAX_TARBALL_BYTES, expectedFiles, pack, packedPackageJson, forbiddenFiles, importGraphProblems, install, run, fixtureProject, noNetworkEnv } from '../../../tools/release/lib.mjs';

const packed = pack();
const pkgVersion = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
let installed;
const inst = () => (installed ??= install(packed.tgz));
async function tap(argv) { let out = '', err = ''; const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd: REPO, env: {}, nibPath: join(REPO, 'apps/cli/bin/nib.js') }); return { code, out, err }; }

test('[npm-package R1] the tarball contains exactly the listed files, nothing forbidden, and is small', () => {
  assert.deepEqual(packed.files, expectedFiles());
  assert.deepEqual(forbiddenFiles(packed.files), []);
  assert.ok(packed.size <= MAX_TARBALL_BYTES, `${packed.size}`);
  for (const f of ['LICENSE', 'README.md', 'package.json', 'apps/cli/bin/nib.js', 'packages/import/node/index.js', 'packages/claude/src/index.js']) assert.ok(packed.files.includes(f), f);
  for (const f of ['tools/release/lib.mjs', 'apps/cli/tests/package.test.js', 'docs/roadmap.md', 'packages/compile/scripts/verify-catalogs.mjs', 'packages/retrieve/fixtures/research-equivalence.json']) assert.ok(!packed.files.includes(f), f);
});

test('[npm-package R2] metadata: name, licence, bin, engines, no dependencies, no install-time scripts, LICENSE shipped', () => {
  const pkg = packedPackageJson(packed.tgz);
  assert.equal(pkg.name, 'skillnib'); assert.equal(pkg.license, 'Apache-2.0'); assert.deepEqual(pkg.bin, { nib: 'apps/cli/bin/nib.js' });
  assert.ok(Number(/\d+/.exec(pkg.engines.node)[0]) >= 22); assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0); assert.equal(pkg.private, undefined);
  for (const s of ['preinstall', 'install', 'postinstall']) assert.equal(pkg.scripts?.[s], undefined, s);
  assert.ok(readFileSync(join(REPO, 'LICENSE'), 'utf8').includes('Apache License') && packed.files.includes('LICENSE'));
});

test('[npm-package R3] --version, --help and help exit 0 with the right output; no command still exits 2', async () => {
  const v = await tap(['--version']); assert.equal(v.code, 0); assert.equal(v.out, pkgVersion + '\n');
  assert.equal((await tap(['-v'])).out, pkgVersion + '\n');
  for (const a of [['--help'], ['-h'], ['help']]) { const h = await tap(a); assert.equal(h.code, 0, a.join()); assert.match(h.out, /^usage:/); assert.equal(h.err, ''); }
  const none = await tap([]); assert.equal(none.code, 2); assert.match(none.err, /usage:/);
  assert.equal((await tap(['bogus'])).code, 2);
});

test('[npm-package R4] every relative import of a shipped file resolves to a shipped file, and a stray import is named', () => {
  assert.deepEqual(importGraphProblems(packed.files, f => readFileSync(join(REPO, f), 'utf8')), []);
  const fake = ['apps/cli/src/a.js', 'packages/x/src/b.js'];
  const src = { 'apps/cli/src/a.js': "import { y } from '../../../packages/x/src/b.js';\nimport z from '../../../tools/gates/lib.mjs';", 'packages/x/src/b.js': 'export const y = 1;' };
  const problems = importGraphProblems(fake, f => src[f]);
  assert.equal(problems.length, 1); assert.match(problems[0], /apps\/cli\/src\/a\.js imports \.\.\/\.\.\/\.\.\/tools\/gates\/lib\.mjs.*not in the package/);
});

test('[npm-package R5] the installed package (path with a space) runs version, help, init, the hook, ask and import end to end', () => {
  const i = inst(); assert.ok(i.prefix.includes(' '));
  assert.equal(run(i.nib, ['--version']).stdout.trim(), pkgVersion); assert.match(run(i.nib, ['--help']).stdout, /^usage:/);
  const proj = fixtureProject(), init = run(i.nib, ['init', 'claude'], { cwd: proj });
  assert.equal(init.status, 0, init.stderr);
  const cmd = JSON.parse(readFileSync(join(proj, '.claude', 'settings.local.json'), 'utf8')).hooks.UserPromptSubmit[0].hooks[0].command;
  assert.ok(cmd.includes(i.entry), cmd);
  const prompt = 'Write the incident report: the payments API returned 500 errors for 20 minutes because a TLS certificate expired.';
  const hook = run('sh', ['-c', cmd], { cwd: proj, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: proj, prompt }) });
  assert.equal(hook.status, 0, hook.stderr); assert.match(hook.stdout, /:: Report structure =====/);
  assert.match(run(i.nib, ['ask', 'incident report structure headings', '--k', '1'], { cwd: proj }).stdout, /Report structure/);
  const imp = run(i.nib, ['import', join(proj, '.claude/skills/acme-sql-style/SKILL.md'), '--store', join(proj, 's')], { cwd: proj }); assert.equal(imp.status, 0, imp.stderr); assert.match(imp.stdout, /Imported 1 skill/);
});

test('[npm-package R6] nothing in the smoke test touches the network, and the network block really blocks', () => {
  const probe = spawnSync(process.execPath, ['-e', "try { require('net').connect(80, '127.0.0.1').on('error', () => {}); console.log('connected') } catch (e) { console.log('blocked: ' + e.message) }"], { encoding: 'utf8', env: noNetworkEnv() });
  assert.match(probe.stdout, /^blocked: network access attempted/);
  const i = inst(), proj = fixtureProject();
  const r = run(i.nib, ['init', 'claude'], { cwd: proj }); assert.equal(r.status, 0); assert.ok(!/network access attempted/.test(r.stderr + r.stdout));
  for (const s of ['preinstall', 'install', 'postinstall']) assert.equal(packedPackageJson(packed.tgz).scripts?.[s], undefined);
});

test('[npm-package R7] release:check passes from the repository, and the publish guide exists and says Claude does not publish', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['release:check'], 'node tools/release/check.mjs'); assert.match(pkg.scripts.prepublishOnly, /release:check/);
  const r = spawnSync(process.execPath, [join(REPO, 'tools/release/check.mjs')], { encoding: 'utf8', env: noNetworkEnv().NODE_OPTIONS ? { ...process.env, NODE_TEST_CONTEXT: '' } : process.env, cwd: REPO });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /release check ok/);
  const doc = readFileSync(join(REPO, 'docs/process/release.md'), 'utf8');
  assert.match(doc, /Claude does not publish/); assert.match(doc, /npm login/); assert.match(doc, /two-factor/);
});

test('[npm-package R8] release tooling stays in tools/release, the development scripts stay in package.json, and the shipped CLI imports nothing from tools', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  for (const s of ['check', 'test', 'gate']) assert.ok(pkg.scripts[s], s);
  assert.ok(existsSync(join(REPO, 'tools/release/check.mjs')));
  for (const f of packed.files.filter(x => /\.m?js$/.test(x))) assert.ok(!/tools\/(release|gates)/.test(readFileSync(join(REPO, f), 'utf8')), f);
});
