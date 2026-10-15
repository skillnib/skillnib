import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from '../src/main.js';
import { USAGE } from '../src/args.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), BIN = join(ROOT, 'apps', 'cli', 'bin', 'nib.js');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const SKILL = '---\nname: alpha\n---\n## Alarms\nSchedule work with an alarm.\n';
const PATHDIR = mkdtempSync(join(tmpdir(), 'doc-path-')); symlinkSync(BIN, join(PATHDIR, 'nib'));
const NODEDIR = dirname(process.execPath);
function project() { const d = mkdtempSync(join(tmpdir(), 'doc-')); mkdirSync(join(d, 'sk/alpha'), { recursive: true }); writeFileSync(join(d, 'sk/alpha/SKILL.md'), SKILL); return d; }
async function nib(cwd, argv, { path = `${NODEDIR}`, fetch } = {}) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env: { PATH: path, HOME: join(cwd, '.nohome'), GITHUB_TOKEN: '' }, fetch, nibPath: BIN });
  return { code, out, err };
}
const tree = d => { const o = []; const walk = p => { for (const n of readdirSync(p).sort()) { const f = join(p, n), s = statSync(f); o.push(f + ':' + (s.isDirectory() ? 'd' : readFileSync(f, 'utf8'))); if (s.isDirectory()) walk(f); } }; walk(d); return o.join('\n'); };
const wired = async (extra = [], opts) => { const d = project(); const r = await nib(d, ['init', 'claude', 'sk', '--project', d, ...extra], opts); assert.equal(r.code, 0, r.err); return d; };

test('[nib-doctor R1] a wired project passes: ok lines, exit 0, and --json says the same', async () => {
  const d = await wired();
  const r = await nib(d, ['doctor']);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /^ok {4}Node /m); assert.match(r.out, /^ok {4}Catalog: 1 skill from 1 source/m); assert.match(r.out, /^ok {4}Search works/m); assert.match(r.out, /^ok {4}Hook in .*settings\.local\.json points at .*nib\.js, which exists/m); assert.match(r.out, /All checks passed\./);
  const j = JSON.parse((await nib(d, ['doctor', '--json'])).out); assert.equal(j.ok, true); assert.deepEqual(j.checks.map(c => c.id), ['node', 'catalog', 'search', 'hook']); assert.ok(j.checks.every(c => c.level === 'ok'));
  const other = mkdtempSync(join(tmpdir(), 'doc-other-')); assert.equal((await nib(other, ['doctor', '--project', d])).code, 0, '--project points at the project from anywhere');
});

test('[nib-doctor R2] a hook that silently stopped working is a failure with a fix', async () => {
  // absolute form: the file it points at is gone
  const d = await wired(); const f = join(d, '.claude/settings.local.json');
  writeFileSync(f, readFileSync(f, 'utf8').replace(BIN, '/old/nvm/node/22/lib/nib.js'));
  let r = await nib(d, ['doctor']); assert.equal(r.code, 1); assert.match(r.out, /^FAIL {2}The hook in .*settings\.local\.json runs \/old\/nvm\/node\/22\/lib\/nib\.js, which no longer exists/m); assert.match(r.out, /fix: Run again: nib init claude <source>/); assert.match(r.out, /1 problem\./);
  // portable form: ok while nib is on the PATH, failure when it is not
  const s = await wired(['--shared'], { path: `${PATHDIR}:${NODEDIR}` });
  assert.equal((await nib(s, ['doctor'], { path: `${PATHDIR}:${NODEDIR}` })).code, 0);
  r = await nib(s, ['doctor'], { path: NODEDIR }); assert.equal(r.code, 1); assert.match(r.out, /FAIL {2}The hook in .*settings\.json runs nib from the PATH, and no nib is on this PATH/); assert.match(r.out, /fix: Install nib/);
  // init recorded a hook that the settings no longer hold
  const g = await wired(); writeFileSync(join(g, '.claude/settings.local.json'), '{}\n');
  r = await nib(g, ['doctor']); assert.equal(r.code, 1); assert.match(r.out, /FAIL {2}nib init recorded a hook, but neither/);
  // ask mode: the rules file is gone
  const a = await wired(['--mode', 'ask']); rmSync(join(a, '.claude/rules/nib.md'));
  r = await nib(a, ['doctor']); assert.equal(r.code, 1); assert.match(r.out, /FAIL {2}Ask mode was set up but .*nib\.md is gone/); assert.match(r.out, /--mode ask/);
});

test('[nib-doctor R3] missing or corrupt catalog fails; a moved source, a duplicate id and an unwired project are warnings; bad settings JSON fails', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'doc-empty-'));
  let r = await nib(empty, ['doctor']); assert.equal(r.code, 1); assert.match(r.out, /FAIL {2}No catalog at .*\.nib/); assert.match(r.out, /fix: Import skills: nib import <source>/);
  const bad = project(); await nib(bad, ['import', 'sk']); writeFileSync(join(bad, '.nib/catalog.json'), '{nope');
  r = await nib(bad, ['doctor']); assert.equal(r.code, 1); assert.match(r.out, /FAIL {2}the store at .* is not valid JSON/); assert.match(r.out, /--replace/);
  const unwired = project(); await nib(unwired, ['import', 'sk']);
  r = await nib(unwired, ['doctor']); assert.equal(r.code, 0); assert.match(r.out, /^warn {2}This project is not wired to Claude Code/m); assert.match(r.out, /No problems, 1 warning\./);
  const moved = project(); await nib(moved, ['import', 'sk']); rmSync(join(moved, 'sk'), { recursive: true });
  r = await nib(moved, ['doctor']); assert.equal(r.code, 0); assert.match(r.out, /^warn {2}.*is gone from disk; its stored copy is still searched/m);
  const dup = project(); mkdirSync(join(dup, 'sk2/alpha'), { recursive: true }); writeFileSync(join(dup, 'sk2/alpha/SKILL.md'), SKILL.replace('alarm', 'timer')); await nib(dup, ['import', 'sk', 'sk2']);
  r = await nib(dup, ['doctor']); assert.equal(r.code, 0); assert.match(r.out, /^warn {2}Two sources provide different skills called "alpha"/m); assert.match(r.out, /alpha~2/);
  const badJson = await wired(); writeFileSync(join(badJson, '.claude/settings.json'), '{ not json');
  r = await nib(badJson, ['doctor']); assert.equal(r.code, 1); assert.match(r.out, /FAIL {2}.*settings\.json is not valid JSON/);
});

test('[nib-doctor R2 R3] review cases: a corrupt init record, identical copies, a moved ask-mode command and a relative --store do not crash or mislead', async () => {
  const rec = await wired(); writeFileSync(join(rec, '.nib/init-claude.json'), '{bad');
  let r = await nib(rec, ['doctor']); assert.equal(r.code, 1); assert.match(r.out, /^FAIL {2}.*init-claude\.json is not valid/m);
  const odd = await wired(['--mode', 'ask']); writeFileSync(join(odd, '.nib/init-claude.json'), JSON.stringify({ mode: 'pull', hidden: { a: 1 } }));
  r = await nib(odd, ['doctor']); assert.doesNotMatch(r.err, /not iterable/);
  const same = project(); mkdirSync(join(same, 'sk2'), { recursive: true }); writeFileSync(join(same, 'sk2/SKILL.md'), SKILL); mkdirSync(join(same, 'sk2b/alpha'), { recursive: true }); writeFileSync(join(same, 'sk2b/alpha/SKILL.md'), SKILL);
  await nib(same, ['import', 'sk', 'sk2b']); r = await nib(same, ['doctor']); assert.doesNotMatch(r.out, /Two sources provide/, 'identical copies are searched once, so nothing is shadowed');
  const ask = await wired(['--mode', 'ask']); const rf = join(ask, '.nib/init-claude.json'), j = JSON.parse(readFileSync(rf, 'utf8'));
  writeFileSync(rf, JSON.stringify({ ...j, command: 'node "/old/nvm/nib.js"' }));
  r = await nib(ask, ['doctor']); assert.equal(r.code, 1); assert.match(r.out, /FAIL {2}Ask mode: the command in .*nib\.md runs \/old\/nvm\/nib\.js, which no longer exists/);
  const elsewhere = mkdtempSync(join(tmpdir(), 'doc-cwd-')), good = await wired();
  r = await nib(elsewhere, ['doctor', '--project', good, '--store', join(good, '.nib')]); assert.equal(r.code, 0, r.out);
});

test('[nib-doctor R4] doctor writes nothing, uses no network, does not run the hook command, and takes no arguments', async () => {
  const d = await wired(); const f = join(d, '.claude/settings.local.json'), marker = join(d, 'ran.txt');
  writeFileSync(f, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "${join(d, 'evil.js')}" hook claude` }] }] } }));
  writeFileSync(join(d, 'evil.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`);
  const before = tree(d);
  const r = await nib(d, ['doctor'], { fetch: () => { throw new Error('network must not be used'); } });
  assert.equal(r.code, 0, r.out); assert.equal(tree(d), before, 'nothing changed'); assert.equal(existsSync(marker), false, 'the settings command was not executed');
  const bad = await nib(d, ['doctor', 'extra']); assert.equal(bad.code, 2); assert.match(bad.err, /doctor takes no arguments/);
});

test('[nib-doctor R5] the usage text, README, Claude Code guide and changelog describe nib doctor', () => {
  assert.match(USAGE, /nib doctor \[--project DIR\] \[--json\] \[--store DIR\]/);
  assert.match(read('README.md'), /\| `nib doctor \[--project DIR\] \[--json\]` \|/);
  assert.match(read('docs/guide/claude-code.md'), /nib doctor/);
  assert.match(read('CHANGELOG.md'), /nib doctor/);
});

test('[nib-doctor R6] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  for (const sub of ['lint', 'link']) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), sub, 'docs/specs/nib-doctor.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
