import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';
import { fakeFetch, SHA } from '../../../packages/import/tests/helpers.js';

const here = dirname(fileURLToPath(import.meta.url)), bin = join(here, '..', 'bin', 'nib.js');
const FIX = join(here, '../../../docs/research/R2b-smoke/skills');
const SHA2 = 'b'.repeat(40), SHA3 = 'c'.repeat(40);
const skill = (name, body = 'text', desc = 'Does ' + name) => `---\nname: ${name}\ndescription: ${desc}\n---\nintro\n\n## Use\n${body}\n\n## Other\nmore ${name}\n`;
const tmp = layout => { const d = mkdtempSync(join(tmpdir(), 'upd-')); for (const [p, c] of Object.entries(layout)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); } return d; };
const world = (files, sha = SHA) => ({ repos: { 'acme/skills': { refs: { HEAD: sha, v1: SHA2, [SHA.slice(0, 7)]: SHA }, files } } });
async function tap(cwd, argv, { fetch, env = { GITHUB_TOKEN: '', HOME: join(cwd, '.nohome'), PATH: '/usr/bin' } } = {}) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env, fetch, nibPath: bin });
  return { code, out, err };
}
const STORE = d => join(d, '.nib', 'catalog.json');
const store = d => JSON.parse(readFileSync(STORE(d), 'utf8'));
const textOf = (d, id) => store(d).skills.find(s => s.id === id).files.map(f => store(d).texts[f.hash]).join('');
const ids = d => store(d).skills.map(s => s.id);
const UP = { 'skills/alpha/SKILL.md': skill('alpha', 'v1'), 'skills/beta/SKILL.md': skill('beta', 'v1'), 'skills/gone/SKILL.md': skill('gone', 'v1'), 'README.md': '# r\n' };

test('[sources-update R1] import adds a source or replaces only its skills; --replace starts over; a failed import leaves the store byte for byte', async () => {
  const d = tmp({ 'a/one/SKILL.md': skill('one'), 'a/two/SKILL.md': skill('two'), 'b/three/SKILL.md': skill('three') });
  await tap(d, ['import', 'a']); const afterA = readFileSync(STORE(d), 'utf8');
  const r = await tap(d, ['import', 'b']); assert.equal(r.code, 0); assert.match(r.out, /Imported 1 skill/); assert.match(r.out, /The store now holds 3 skills from 2 sources\./);
  assert.deepEqual(ids(d), ['one', 'three', 'two']);
  writeFileSync(join(d, 'a/one/SKILL.md'), skill('one', 'edited')); rmSync(join(d, 'a/two'), { recursive: true });
  await tap(d, ['import', 'a']); assert.deepEqual(ids(d), ['one', 'three']); assert.match(textOf(d, 'one'), /edited/);
  const before = readFileSync(STORE(d), 'utf8'), bad = await tap(d, ['import', 'a', 'missing.md']);
  assert.equal(bad.code, 1); assert.equal(readFileSync(STORE(d), 'utf8'), before);
  await tap(d, ['import', 'b', '--replace']); assert.deepEqual(ids(d), ['three']);
  assert.ok(afterA.length > 0);
});

test('[sources-update R1] nib init claude adds to the store instead of replacing it', async () => {
  const d = tmp({ '.claude/skills/mine/SKILL.md': skill('mine'), 'other/theirs/SKILL.md': skill('theirs') });
  await tap(d, ['import', 'other']); const r = await tap(d, ['init', 'claude']); assert.equal(r.code, 0);
  assert.deepEqual(ids(d), ['mine', 'theirs']);
});

test('[sources-update R2] GitHub without a ref imports the latest commit and is floating; a commit hash is pinned; list shows both', async () => {
  const d = tmp({ 'x.txt': 'y' }), w = world(UP, SHA3), fetch = fakeFetch(w);
  await tap(d, ['import', 'acme/skills/skills'], { fetch }); await tap(d, ['import', `acme/skills/skills@${SHA.slice(0, 7)}`], { fetch });
  const l = await tap(d, ['list']);
  assert.match(l.out, new RegExp(`^acme/skills/skills  github  floating \\(default branch\\)  ${SHA3.slice(0, 7)}$`, 'm'));
  assert.match(l.out, new RegExp(`^acme/skills/skills@${SHA.slice(0, 7)}  github  pinned  ${SHA.slice(0, 7)}$`, 'm'));
  const j = JSON.parse((await tap(d, ['list', '--json'])).out); assert.deepEqual(j.sources.map(s => s.status).sort(), ['floating (default branch)', 'pinned']); assert.deepEqual(j.sources.find(s => s.status !== 'pinned').commits, [SHA3]);
  assert.equal((await tap(d, ['import', 'acme/skills/skills@v1'], { fetch })).code, 0); assert.match((await tap(d, ['list'])).out, /acme\/skills\/skills@v1  github  floating  /);
});

test('[sources-update R3] list shows every source with its skills; a query searches skill names and namespaces; no match says so and exits 0', async () => {
  const d = tmp({ 'team/sql/SKILL.md': skill('sql'), 'team/kv/SKILL.md': skill('kv') }), fetch = fakeFetch(world(UP));
  await tap(d, ['import', 'acme/skills/skills'], { fetch }); await tap(d, ['import', 'team']);
  const all = (await tap(d, ['list'])).out; for (const id of ['alpha', 'beta', 'sql', 'kv']) assert.match(all, new RegExp(`^  ${id}  `, 'm'));
  const ns = (await tap(d, ['list', 'ACME'])).out; assert.match(ns, /^acme\/skills\/skills/m); assert.match(ns, /  alpha  /); assert.ok(!/  sql  /.test(ns));
  const sk = (await tap(d, ['list', 'sq'])).out; assert.match(sk, /  sql  /); assert.ok(!/alpha/.test(sk)); assert.match(sk, /team/);
  const folder = (await tap(d, ['list', 'team'])).out; assert.match(folder, /  kv  /); assert.match(folder, /  sql  /);
  const none = await tap(d, ['list', 'zzz']); assert.equal(none.code, 0); assert.match(none.out, /No skills match "zzz"\./);
  const js = JSON.parse((await tap(d, ['list', 'kv', '--json'])).out); assert.equal(js.query, 'kv'); assert.deepEqual(js.sources.flatMap(s => s.skills.map(k => k.id)), ['kv']);
});

test('[sources-update R4] update all refreshes floating and local sources, adds new skills, flags vanished ones, prunes on request, skips pinned unless forced', async () => {
  const d = tmp({ 'team/sql/SKILL.md': skill('sql', 'v1') }), w = world(UP, SHA3), fetch = fakeFetch(w);
  await tap(d, ['import', 'acme/skills/skills'], { fetch }); await tap(d, ['import', 'team']); await tap(d, ['import', `acme/skills/skills@${SHA.slice(0, 7)}`], { fetch });
  w.repos['acme/skills'].refs.HEAD = SHA2;
  w.repos['acme/skills'].files = { 'skills/alpha/SKILL.md': skill('alpha', 'v2'), 'skills/beta/SKILL.md': skill('beta', 'v1'), 'skills/fresh/SKILL.md': skill('fresh') };
  writeFileSync(join(d, 'team/sql/SKILL.md'), skill('sql', 'v2'));
  const r = await tap(d, ['update'], { fetch });
  assert.equal(r.code, 0); assert.match(textOf(d, 'sql'), /v2/);
  assert.match(r.out, /acme\/skills\/skills \(floating \(default branch\)\): ccccccc -> bbbbbbb/); assert.match(r.out, /alpha: 1 module changed \(## Use\)/); assert.match(r.out, /new skill: fresh/);
  assert.match(r.out, /no longer provided upstream: gone \(kept; --prune removes it\)/); assert.match(r.out, /skipped; use --force/);
  assert.ok(ids(d).includes('gone') && ids(d).includes('fresh'));
  const p = await tap(d, ['update', '--prune'], { fetch }); assert.match(p.out, /removed \(no longer provided upstream\): gone/);
  assert.ok(store(d).skills.every(s => s.id !== 'gone' || s.files[0].provenance.github?.ref));
  const f = await tap(d, ['update', '--force'], { fetch }); assert.ok(!/skipped; use --force/.test(f.out));
});

test('[sources-update R5] update one or many: a skill name refreshes only that skill, a source name the whole source, several names at once; bad names change nothing', async () => {
  const d = tmp({ 'x.txt': 'y' }), w = world(UP), fetch = fakeFetch(w);
  await tap(d, ['import', 'acme/skills/skills'], { fetch });
  w.repos['acme/skills'].refs.HEAD = SHA2;
  w.repos['acme/skills'].files = { 'skills/alpha/SKILL.md': skill('alpha', 'v2'), 'skills/beta/SKILL.md': skill('beta', 'v2'), 'skills/gone/SKILL.md': skill('gone', 'v2'), 'skills/extra/SKILL.md': skill('extra') };
  const one = await tap(d, ['update', 'alpha'], { fetch });
  assert.equal(one.code, 0); assert.match(textOf(d, 'alpha'), /v2/); assert.match(textOf(d, 'beta'), /v1/); assert.ok(!ids(d).includes('extra'));
  const commit = id => store(d).skills.find(s => s.id === id).files[0].provenance.github.sha;
  assert.equal(commit('alpha'), SHA2); assert.equal(commit('beta'), SHA);
  const many = await tap(d, ['update', 'beta', 'gone'], { fetch }); assert.equal(many.code, 0);
  assert.match(textOf(d, 'beta'), /v2/); assert.match(textOf(d, 'gone'), /v2/); assert.ok(!ids(d).includes('extra'));
  const whole = await tap(d, ['update', 'acme/skills'], { fetch }); assert.equal(whole.code, 0); assert.ok(ids(d).includes('extra'));
  const before = readFileSync(STORE(d), 'utf8');
  const unknown = await tap(d, ['update', 'alpha', 'nope'], { fetch }); assert.equal(unknown.code, 1); assert.match(unknown.err, /no skill or source matches: nope/); assert.equal(readFileSync(STORE(d), 'utf8'), before);
  const e = tmp({ 'a/kv/SKILL.md': skill('kv'), 'b/kv/SKILL.md': skill('kv') }); await tap(e, ['import', 'a', 'b']);
  const amb = await tap(e, ['update', 'kv']); assert.equal(amb.code, 2); assert.match(amb.err, /"kv" is ambiguous; it could be: kv \(.*\/a\), kv \(.*\/b\)/);
});

test('[sources-update R6] remove drops the whole source that provides a skill or location and nothing else', async () => {
  const d = tmp({ 'a/one/SKILL.md': skill('one'), 'a/two/SKILL.md': skill('two'), 'b/three/SKILL.md': skill('three') });
  await tap(d, ['import', 'a', 'b']);
  const r = await tap(d, ['remove', 'one']); assert.equal(r.code, 0); assert.match(r.out, /Removed 2 skills: one, two/); assert.deepEqual(ids(d), ['three']);
  assert.equal((await tap(d, ['remove', 'zzz'])).code, 1); assert.equal((await tap(d, ['remove'])).code, 2);
  await tap(d, ['remove', 'three']); assert.deepEqual(ids(d), []);
});

test('[sources-update R7] --check reads and reports but writes nothing; an unchanged source is up to date; commits and module titles are named', async () => {
  const d = tmp({ 'team/sql/SKILL.md': skill('sql', 'v1') }), w = world(UP), fetch = fakeFetch(w);
  await tap(d, ['import', 'acme/skills/skills'], { fetch }); await tap(d, ['import', 'team']);
  const before = readFileSync(STORE(d), 'utf8');
  const same = await tap(d, ['update', '--check'], { fetch }); assert.equal(same.code, 0); assert.match(same.out, /acme\/skills\/skills \(floating \(default branch\)\): up to date/); assert.match(same.out, /team\): up to date|team \(local\): up to date/);
  w.repos['acme/skills'].refs.HEAD = SHA2; w.repos['acme/skills'].files = { ...UP, 'skills/alpha/SKILL.md': skill('alpha', 'v2').replace('## Other\nmore alpha', '## Added\nmore') };
  const chk = await tap(d, ['update', '--check'], { fetch });
  assert.equal(chk.code, 0); assert.match(chk.out, /aaaaaaa -> bbbbbbb  \(would change\)/); assert.match(chk.out, /alpha: 1 module changed \(## Use\); 1 added \(## Added\); 1 removed \(## Other\)/); assert.match(chk.out, /check only: nothing was written/);
  assert.equal(readFileSync(STORE(d), 'utf8'), before);
  const content = await tap(d, ['update', '--check', 'beta'], { fetch }); assert.match(content.out, /aaaaaaa -> bbbbbbb, content unchanged|up to date/);
});

test('[sources-update R8] with an init record, update hides new project skills and rewrites the pull-mode note, remove restores hidden skills, and undo restores everything', async () => {
  const d = tmp({}); cpSync(FIX, join(d, '.claude', 'skills'), { recursive: true });
  const fetch = fakeFetch(world(UP));
  await tap(d, ['init', 'claude', '--mode', 'pull']); await tap(d, ['import', 'acme/skills/skills'], { fetch });
  const note = () => readFileSync(join(d, '.claude/rules/nib.md'), 'utf8'), hidden = n => /disable-model-invocation: true/.test(readFileSync(join(d, '.claude/skills', n, 'SKILL.md'), 'utf8'));
  mkdirSync(join(d, '.claude/skills/acme-new')); writeFileSync(join(d, '.claude/skills/acme-new/SKILL.md'), skill('acme-new', 'x', 'A brand new skill'));
  assert.ok(!hidden('acme-new'));
  const r = await tap(d, ['update', '.claude/skills'], { fetch });
  assert.equal(r.code, 0); assert.ok(hidden('acme-new')); assert.match(r.out, /Hid .*acme-new\/SKILL\.md/); assert.match(note(), /- acme-new: A brand new skill/); assert.match(r.out, /Rewrote the skill note/);
  const rm = await tap(d, ['remove', 'acme-sql-style']);
  assert.equal(rm.code, 0); assert.ok(!hidden('acme-sql-style'), 'restored to Claude Code'); assert.match(rm.out, /Restored .*acme-sql-style\/SKILL\.md/); assert.ok(!/acme-sql-style:/.test(note()));
  const rec = JSON.parse(readFileSync(join(d, '.nib/init-claude.json'), 'utf8')); assert.equal(rec.hidden.length, 0);
  await tap(d, ['import', '.claude/skills']); const u = await tap(d, ['init', 'claude', '--undo']); assert.equal(u.code, 0);
  for (const n of ['acme-new']) assert.ok(!hidden(n), n);
  const plain = tmp({ 'a/one/SKILL.md': skill('one') }); await tap(plain, ['import', 'a']); const noWiring = await tap(plain, ['remove', 'one']); assert.ok(!/Restored|Hid |Rewrote/.test(noWiring.out)); assert.ok(!existsSync(join(plain, '.claude')));
});

test('[sources-update R9] a source that cannot be refreshed keeps its skills and is reported; the others still refresh; exit 1; the store stays valid', async () => {
  const d = tmp({ 'team/sql/SKILL.md': skill('sql', 'v1'), 'gone/old/SKILL.md': skill('old') }), w = world(UP);
  await tap(d, ['import', 'acme/skills/skills'], { fetch: fakeFetch(w) }); await tap(d, ['import', 'team', 'gone']);
  writeFileSync(join(d, 'team/sql/SKILL.md'), skill('sql', 'v2')); rmSync(join(d, 'gone'), { recursive: true });
  const down = () => { throw new Error('network is down'); };
  const r = await tap(d, ['update'], { fetch: down });
  assert.equal(r.code, 1); assert.match(textOf(d, 'sql'), /v2/); assert.ok(ids(d).includes('old') && ids(d).includes('alpha'));
  assert.match(r.out, /acme\/skills\/skills: could not be refreshed, kept as it was \(.*network is down/); assert.match(r.out, /gone.*could not be refreshed/); assert.match(r.err, /could not refresh/);
  assert.equal((await tap(d, ['list'])).code, 0);
});

test('[sources-update R10] the CLI does the I/O and the import package does the logic', () => {
  const upd = readFileSync(join(here, '..', 'src', 'update.js'), 'utf8');
  assert.match(upd, /refreshSource/); assert.match(upd, /resolveNames/); assert.match(upd, /removeSources/); assert.match(upd, /matchesQuery/);
  assert.ok(!/function diffSkill|function refreshSource|function resolveNames/.test(upd));
});

test('[sources-update R5] one repository imported at two refs: a skill name is ambiguous with distinguishable candidates, and --from picks the source for update and remove', async () => {
  const d = tmp({ 'x.txt': 'y' }), w = world(UP, SHA3), fetch = fakeFetch(w), pin = `acme/skills/skills@${SHA.slice(0, 7)}`;
  await tap(d, ['import', 'acme/skills/skills'], { fetch }); await tap(d, ['import', pin], { fetch });
  const amb = await tap(d, ['update', 'alpha'], { fetch });
  assert.equal(amb.code, 2); assert.match(amb.err, /alpha \(acme\/skills\/skills, default branch\)/); assert.match(amb.err, /alpha \(acme\/skills\/skills@aaaaaaa\)/); assert.match(amb.err, /Pick one with --from <source>\./);
  const ok = await tap(d, ['update', 'alpha', '--from', 'acme/skills/skills'], { fetch }); assert.equal(ok.code, 0); assert.match(ok.out, /up to date|content unchanged|changed/);
  const pinned = await tap(d, ['update', 'alpha', '--from', pin], { fetch }); assert.equal(pinned.code, 0); assert.match(pinned.out, /pinned at aaaaaaa|skipped/);
  assert.equal((await tap(d, ['update', 'alpha', '--from', 'nowhere'], { fetch })).code, 1);
  const rm = await tap(d, ['remove', 'acme/skills/skills'], { fetch }); assert.equal(rm.code, 0);
  assert.deepEqual(store(d).skills.map(s => s.files[0].provenance.github.ref), ['aaaaaaa', 'aaaaaaa', 'aaaaaaa']); // only the default-branch source went, the pinned one stays
});

test('[sources-update R11] importing what the store already has changes nothing and says so: same repository, subpath and commit under any ref, or identical local content; --force imports anyway', async () => {
  const d = tmp({ 'team/sql/SKILL.md': skill('sql', 'v1'), 'one.md': '## One\nlone note\n' }), w = world(UP), log = [], fetch = fakeFetch(w, log);
  await tap(d, ['import', 'acme/skills/skills'], { fetch }); const before = readFileSync(STORE(d), 'utf8'), tarballs = () => log.filter(l => /tarball/.test(l.url)).length;
  assert.equal(tarballs(), 1);
  const again = await tap(d, ['import', 'acme/skills/skills'], { fetch });
  assert.equal(again.code, 0); assert.match(again.out, /Already imported: acme\/skills\/skills is at commit aaaaaaa, which the store already has as acme\/skills\/skills; nothing downloaded/); assert.match(again.out, /Nothing new to import\./);
  assert.equal(tarballs(), 1, 'no archive was downloaded'); assert.equal(readFileSync(STORE(d), 'utf8'), before);
  const viaRef = await tap(d, ['import', `acme/skills/skills@${SHA.slice(0, 7)}`], { fetch }); assert.match(viaRef.out, /Already imported/); assert.equal(tarballs(), 1); assert.equal(readFileSync(STORE(d), 'utf8'), before);
  const forced = await tap(d, ['import', `acme/skills/skills@${SHA.slice(0, 7)}`, '--force'], { fetch }); assert.match(forced.out, /Imported 3 skills/); assert.equal(tarballs(), 2); assert.match((await tap(d, ['list'])).out, /@aaaaaaa  github  pinned/);
  await tap(d, ['import', 'team', 'one.md']); const stored = readFileSync(STORE(d), 'utf8');
  const local = await tap(d, ['import', 'team', 'one.md']); assert.equal(local.code, 0); assert.match(local.out, /Already imported and unchanged: .*team/); assert.match(local.out, /Already imported and unchanged: .*one\.md/); assert.match(local.out, /Nothing new to import\./); assert.equal(readFileSync(STORE(d), 'utf8'), stored);
  writeFileSync(join(d, 'team/sql/SKILL.md'), skill('sql', 'v2'));
  const mixed = await tap(d, ['import', 'team', 'one.md']); assert.match(mixed.out, /Imported 1 skill/); assert.match(mixed.out, /Already imported and unchanged: .*one\.md/); assert.match(textOf(d, 'sql'), /v2/);
  w.repos['acme/skills'].refs.HEAD = SHA2; const moved = await tap(d, ['import', 'acme/skills/skills'], { fetch }); assert.match(moved.out, /Imported 3 skills/); assert.equal(tarballs(), 3);
});
