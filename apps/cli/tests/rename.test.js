import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from '../src/main.js';
import { USAGE } from '../src/args.js';
import { resolveStore } from '../src/store.js';
import { createHandler } from '../../../packages/mcp/src/index.js';
import { RULES_PATH, RULES_HEADER } from '../../../packages/claude/src/index.js';
import { pack } from '../../../tools/release/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const run = async (argv, cwd = ROOT) => { let out = '', err = ''; const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env: {}, nibPath: join(ROOT, 'apps/cli/bin/nib.js') }); return { code, out, err }; };

test('[rename-skillnib R1] the package is skillnib with the single bin nib, and the tarball is named for it', () => {
  assert.equal(pkg.name, 'skillnib'); assert.deepEqual(pkg.bin, { nib: 'apps/cli/bin/nib.js' }); assert.ok(existsSync(join(ROOT, 'apps/cli/bin/nib.js'))); assert.ok(!existsSync(join(ROOT, 'apps/cli/bin/tap.js')));
  const p = pack(); assert.match(p.tgz, /skillnib-[\d.]+\.tgz$/); assert.ok(p.files.includes('apps/cli/bin/nib.js'));
  assert.equal(JSON.parse(spawnSync('tar', ['-xzOf', p.tgz, 'package/package.json'], { encoding: 'utf8' }).stdout).bin.tap, undefined);
});

test('[rename-skillnib R2] usage, errors and hints say nib, never tap', async () => {
  assert.match(USAGE, /^usage:\n {2}nib import /); assert.doesNotMatch(USAGE, /\btap\b/);
  const bad = await run(['bogus']); assert.equal(bad.code, 2); assert.doesNotMatch(bad.err, /\btap\b/); assert.match(bad.err, /^nib: /);
  const help = await run(['--help']); assert.doesNotMatch(help.out, /\btap\b/);
  assert.match(RULES_HEADER, /`nib init claude --mode ask`/);
});

test('[rename-skillnib R3] the store is .nib, the override is NIB_STORE, the rules file is nib.md, and the old names are not read', () => {
  assert.equal(resolveStore({ env: {}, cwd: '/nowhere/x' }), '/nowhere/x/.nib');
  assert.equal(resolveStore({ env: { NIB_STORE: '/s' }, cwd: '/x' }), '/s');
  assert.equal(resolveStore({ env: { SKILLTAP_STORE: '/old' }, cwd: '/nowhere/x' }), '/nowhere/x/.nib');
  assert.deepEqual(RULES_PATH, ['.claude', 'rules', 'nib.md']);
});

test('[rename-skillnib R4] the MCP server reports the name skillnib', async () => {
  const r = await createHandler({ version: '1', search: async () => '', get: async () => null })({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(r.result.serverInfo.name, 'skillnib'); assert.match(read('docs/guide/mcp.md'), /"command": "nib"/);
});

test('[rename-skillnib R5] every internal package is @skillnib/* and keeps the runtime-neutral marker where it had it', () => {
  for (const d of readdirSync(join(ROOT, 'packages'))) {
    const f = join(ROOT, 'packages', d, 'package.json'); if (!existsSync(f)) continue;
    const p = JSON.parse(readFileSync(f, 'utf8')); assert.match(p.name, /^@skillnib\//, d);
  }
  for (const d of ['claude', 'compile', 'deliver', 'import', 'mcp', 'retrieve']) assert.equal(JSON.parse(read(`packages/${d}/package.json`)).skillnib.runtimeNeutral, true, d);
});

test('[rename-skillnib R6] the docs name the product and the command, tied to package.json', () => {
  const readme = read('README.md');
  assert.match(readme, /^# SkillNib$/m); assert.ok(readme.includes(`npm install -g ${pkg.name}`)); assert.ok(readme.includes('nib --version'));
});

// Live product files: no old name and no `tap` command anywhere. Historical records are not scanned.
const LIVE = ['package.json', 'README.md', 'apps', 'packages', 'tools', 'docs/guide', 'docs/process', '.gitignore'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.nib', 'catalog']);
const files = p => { const abs = join(ROOT, p); if (!existsSync(abs)) return []; if (!statSync(abs).isDirectory()) return [p]; return readdirSync(abs, { withFileTypes: true }).flatMap(e => SKIP_DIRS.has(e.name) && p.startsWith('packages') && e.name === 'catalog' ? [] : SKIP_DIRS.has(e.name) ? [] : e.isDirectory() ? files(join(p, e.name)) : [join(p, e.name)]); };
const STALE = [/skilltap/i, /\btap (import|ask|show|list|update|remove|init|hook|mcp|--version|--help)\b/, /`tap`|'tap'|"tap"/, /\btap:/, /\btap\.js\b/, /\.bin\/tap\b/, /\btap globally\b/];

test('[rename-skillnib R7] no old product name and no tap command anywhere in the live product files', () => {
  const hits = [];
  for (const f of LIVE.flatMap(files)) {
    if (/\.(png|jpg|gz|tgz)$/.test(f) || f === 'apps/cli/tests/rename.test.js') continue;
    read(f).split('\n').forEach((line, i) => { for (const re of STALE) if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(hits, []);
});

const HAS_SPECS = existsSync(join(ROOT, 'docs/specs')) && existsSync(join(ROOT, 'tools/gates/speclink.mjs'));

test('[rename-skillnib R8] the approved specs still verify against their recorded links', { skip: !HAS_SPECS }, () => {
  const specs = readdirSync(join(ROOT, 'docs/specs')).filter(f => f.endsWith('.md'));
  for (const s of specs) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), 'link', join('docs/specs', s)], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, s + ': ' + r.stdout + r.stderr); }
  assert.ok(existsSync(join(ROOT, 'docs/specs/rename-skillnib.speclink.json')));
});

test('[rename-skillnib R9] no test was lost: the count did not go down and every earlier spec still has tagged tests', { skip: !HAS_SPECS }, () => {
  const all = ['packages', 'apps', 'tools'].flatMap(files).filter(f => /tests\/[^/]+\.test\.m?js$/.test(f));
  const titles = all.flatMap(f => [...read(f).matchAll(/^test\('([^']*)'/gm)].map(m => m[1]));
  assert.ok(titles.length >= 163, `${titles.length} tests`);
  const specs = readdirSync(join(ROOT, 'docs/specs')).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
  for (const s of specs) assert.ok(titles.some(t => t.startsWith(`[${s} R`)), `no tagged test for ${s}`);
});
