import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from '../src/main.js';
import { fakeFetch, SHA } from '../../../packages/import/tests/helpers.js';

const here = dirname(fileURLToPath(import.meta.url)), bin = join(here, '..', 'bin', 'nib.js');
const FIX = join(here, '../../../docs/research/R2b-smoke/skills');
const cleanEnv = () => { const e = { ...process.env, GITHUB_TOKEN: '' }; delete e.NODE_TEST_CONTEXT; delete e.NIB_STORE; return e; };
async function tap(cwd, argv, { fetch, nibPath = bin, env = { GITHUB_TOKEN: '', HOME: join(cwd, '.nohome') } } = {}) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env, fetch, nibPath });
  return { code, out, err };
}
const read = (...p) => readFileSync(join(...p), 'utf8');
const skillFiles = d => readdirSync(join(d, '.claude/skills')).map(n => join(d, '.claude/skills', n, 'SKILL.md'));
function project({ withSkills = true, extra = {} } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'init-'));
  if (withSkills) cpSync(FIX, join(d, '.claude', 'skills'), { recursive: true });
  for (const [p, c] of Object.entries(extra)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const snapshot = d => Object.fromEntries(skillFiles(d).map(f => [f, read(f)]));
const SETTINGS = d => join(d, '.claude', 'settings.local.json');

test('[claude-code-init R1] dry run prints the plan and writes nothing; invalid settings or sources stop before any write', async () => {
  const d = project(), before = snapshot(d);
  const r = await tap(d, ['init', 'claude', '--dry-run']);
  assert.equal(r.code, 0); assert.match(r.out, /import 5 skills into .*\.nib/); assert.match(r.out, /write the hook in .*settings\.local\.json: node ".*nib\.js" hook claude/); assert.match(r.out, /hide .*acme-sql-style\/SKILL\.md/); assert.match(r.out, /nothing was written/);
  assert.ok(!existsSync(join(d, '.nib')) && !existsSync(SETTINGS(d))); assert.deepEqual(snapshot(d), before);
  mkdirSync(join(d, '.claude'), { recursive: true }); writeFileSync(SETTINGS(d), '{ "hooks": ');
  r.bad = await tap(d, ['init', 'claude']); assert.equal(r.bad.code, 1); assert.match(r.bad.err, /settings\.local\.json is not valid JSON/);
  writeFileSync(SETTINGS(d), '[1]'); assert.match((await tap(d, ['init', 'claude'])).err, /must contain a JSON object/);
  writeFileSync(SETTINGS(d), '{}'); const miss = await tap(d, ['init', 'claude', 'missing.md']); assert.equal(miss.code, 1);
  assert.ok(!existsSync(join(d, '.nib'))); assert.deepEqual(snapshot(d), before); assert.equal(read(SETTINGS(d)), '{}');
});

test('[claude-code-init R2] sources and .claude/skills are imported into the project store; nothing to import is a usage error; a failed import changes nothing', async () => {
  const d = project({ extra: { 'notes/extra.md': '## Extra\nlone note\n' } });
  const r = await tap(d, ['init', 'claude', 'notes/extra.md']);
  assert.equal(r.code, 0); assert.match(r.out, /Imported 6 skills, 6 files/); assert.ok(existsSync(join(d, '.nib', 'catalog.json')));
  const empty = project({ withSkills: false });
  assert.equal((await tap(empty, ['init', 'claude'])).code, 2);
  const f = project(), before = snapshot(f);
  const bad = await tap(f, ['init', 'claude', 'ghost/repo'], { fetch: fakeFetch({ repos: {} }) });
  assert.equal(bad.code, 1); assert.ok(!existsSync(join(f, '.nib')) && !existsSync(SETTINGS(f))); assert.deepEqual(snapshot(f), before);
});

test('[claude-code-init R3] the hook entry keeps other settings, is idempotent, follows a moved tap, and honours --shared', async () => {
  const d = project({ extra: { '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }) } });
  await tap(d, ['init', 'claude']);
  const raw = read(SETTINGS(d)), s = JSON.parse(raw);
  assert.ok(raw.endsWith('}\n') && raw.includes('\n  "permissions"')); assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] }); assert.equal(s.hooks.Stop[0].hooks[0].command, 'echo bye');
  assert.deepEqual(s.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: `node "${bin}" hook claude`, timeout: 30 }] }]);
  const mtime = statSync(SETTINGS(d)).mtimeMs; await tap(d, ['init', 'claude']); assert.equal(read(SETTINGS(d)), raw); assert.equal(statSync(SETTINGS(d)).mtimeMs, mtime);
  await tap(d, ['init', 'claude'], { nibPath: '/elsewhere/nib.js' });
  const moved = JSON.parse(read(SETTINGS(d))).hooks.UserPromptSubmit; assert.equal(moved.length, 1); assert.equal(moved[0].hooks[0].command, 'node "/elsewhere/nib.js" hook claude');
  const sh = project(); await tap(sh, ['init', 'claude', '--shared'], onPath(sh)); assert.ok(existsSync(join(sh, '.claude', 'settings.json')) && !existsSync(SETTINGS(sh)));
});

test('[claude-code-init R4] every imported project skill gets exactly one added line; hidden and front-matter-less skills are left alone; files outside .claude/skills are never written', async () => {
  const hiddenAlready = '---\nname: acme-hidden\ndescription: d\ndisable-model-invocation: true\n---\n## A\nx\n', bare = '# no front matter\n## B\ny\n';
  const outside = '---\nname: elsewhere\ndescription: d\n---\n## C\nz\n';
  const d = project({ extra: { '.claude/skills/acme-hidden/SKILL.md': hiddenAlready, '.claude/skills/acme-bare/SKILL.md': bare, 'other/elsewhere/SKILL.md': outside } });
  const before = snapshot(d);
  const r = await tap(d, ['init', 'claude', 'other']);
  assert.equal(r.code, 0); assert.match(r.out, /Not hidden \(no front matter\): .*acme-bare/);
  for (const [f, was] of Object.entries(before)) {
    const now = read(f);
    if (f.includes('acme-hidden') || f.includes('acme-bare')) { assert.equal(now, was, f); continue; }
    const a = now.split('\n'), b = was.split('\n'); assert.equal(a.length, b.length + 1, f); assert.equal(a[1], 'disable-model-invocation: true'); assert.deepEqual([a[0], ...a.slice(2)], b, f);
  }
  assert.equal(read(d, 'other/elsewhere/SKILL.md'), outside);
  assert.match(r.out, /Hidden from Claude Code/);
});

test('[claude-code-init R5] undo removes the hook and restores the skills, skips files edited since, and is safe to repeat', async () => {
  const d = project(), before = snapshot(d);
  await tap(d, ['init', 'claude']);
  const u = await tap(d, ['init', 'claude', '--undo']);
  assert.equal(u.code, 0); assert.match(u.out, /Removed the SkillNib hook/); assert.deepEqual(snapshot(d), before);
  assert.ok(!existsSync(SETTINGS(d)), 'the settings file init created is removed'); assert.ok(!existsSync(join(d, '.nib', 'init-claude.json')));
  assert.match((await tap(d, ['init', 'claude', '--undo'])).out, /Nothing to undo/);
  const e = project({ extra: { '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['x'] } }) } });
  await tap(e, ['init', 'claude']); const edited = join(e, '.claude/skills/acme-sql-style/SKILL.md'); writeFileSync(edited, read(edited) + '\nmy own note\n');
  const u2 = await tap(e, ['init', 'claude', '--undo']);
  assert.match(u2.out, /acme-sql-style.*changed since init; left alone/); assert.match(u2.out, /record .* was kept/); assert.ok(existsSync(join(e, '.nib', 'init-claude.json')));
  assert.deepEqual(JSON.parse(read(SETTINGS(e))), { permissions: { allow: ['x'] } });
  assert.ok(read(edited).includes('disable-model-invocation: true') && read(edited).includes('my own note'));
  assert.ok(!read(join(e, '.claude/skills/acme-release-notes/SKILL.md')).includes('disable-model-invocation'));
});

test('[claude-code-init R6] the summary names same-named user skills that stay visible, leaves them alone, and says plugin skills cannot be checked', async () => {
  const d = project(), home = mkdtempSync(join(tmpdir(), 'home-'));
  mkdirSync(join(home, 'acme-sql-style'), { recursive: true }); writeFileSync(join(home, 'acme-sql-style', 'SKILL.md'), '---\nname: acme-sql-style\n---\nuser copy\n'); mkdirSync(join(home, 'unrelated'));
  const r = await tap(d, ['init', 'claude', '--user-skills-dir', home]);
  assert.match(r.out, /Still visible to Claude Code natively \(user skills, not edited\): acme-sql-style\n/); assert.ok(!r.out.includes('unrelated'));
  assert.match(r.out, /Plugin and enterprise skills cannot be checked/); assert.equal(read(home, 'acme-sql-style', 'SKILL.md'), '---\nname: acme-sql-style\n---\nuser copy\n');
});

test('[claude-code-init R7] the command written to settings runs as Claude Code runs it and delivers the requested section verbatim from hidden skills', async () => {
  const d = project(); await tap(d, ['init', 'claude']);
  const cmd = JSON.parse(read(SETTINGS(d))).hooks.UserPromptSubmit[0].hooks[0].command;
  const prompt = 'Write the incident report for yesterday: the payments API returned 500 errors for about 20 minutes because a TLS certificate expired.';
  const run = spawnSync('sh', ['-c', cmd], { cwd: d, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd: d, session_id: 's' }), encoding: 'utf8', env: cleanEnv() });
  assert.equal(run.status, 0, run.stderr);
  const src = read(FIX, 'acme-incident-report', 'SKILL.md'), want = src.slice(src.indexOf('## Report structure'), src.indexOf('## Blameless language'));
  assert.ok(run.stdout.includes(`:: Report structure =====\n${want}`));
  for (const f of skillFiles(d)) assert.match(read(f), /^---\n(?:.*\n)*?disable-model-invocation: true\n/, f);
});

test('[claude-code-init R8] the CLI keeps all file access and uses the pure claude package', () => {
  const init = read(here, '..', 'src', 'init.js');
  assert.match(init, /from 'node:fs\/promises'/); assert.match(init, /packages\/claude\/src\/index\.js/);
  assert.ok(!/settings|disable-model-invocation/.test(read(here, '../../../packages/deliver/src/index.js')));
});

// A PATH directory holding a `nib` that is this installation, so init can write the portable command.
const onPath = d => { const b = join(d, '.pathbin'); mkdirSync(b, { recursive: true }); symlinkSync(bin, join(b, 'nib')); return { env: { GITHUB_TOKEN: '', HOME: join(d, '.nohome'), PATH: b } }; };
const SHARED = d => join(d, '.claude', 'settings.json');
const cmds = file => JSON.parse(read(file)).hooks.UserPromptSubmit.flatMap(g => g.hooks.map(h => h.command));

test('[shared-portable-hook R1] --shared writes "nib hook claude" with the usual timeout and keeps other settings; without --shared the command is still absolute', async () => {
  const d = project({ extra: { '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }) } });
  const r = await tap(d, ['init', 'claude', '--shared'], onPath(d)); assert.equal(r.code, 0, r.err);
  const s = JSON.parse(read(SHARED(d)));
  assert.deepEqual(s.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: 'nib hook claude', timeout: 30 }] }]); assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] });
  assert.ok(!existsSync(SETTINGS(d)));
  const local = project(); await tap(local, ['init', 'claude'], onPath(local));
  assert.deepEqual(cmds(SETTINGS(local)), [`node "${bin}" hook claude`]);
});

test('[shared-portable-hook R2] --shared without nib on the PATH exits 1 naming npm install -g skillnib and writes nothing, dry run included', async () => {
  const d = project(), before = snapshot(d);
  for (const extra of [[], ['--dry-run']]) {
    const r = await tap(d, ['init', 'claude', '--shared', ...extra]);
    assert.equal(r.code, 1); assert.match(r.err, /npm install -g skillnib/);
    assert.ok(!existsSync(join(d, '.nib')) && !existsSync(SHARED(d)) && !existsSync(SETTINGS(d))); assert.deepEqual(snapshot(d), before);
  }
});

test('[shared-portable-hook R4] shared re-runs are idempotent, an old absolute shared entry is updated in place, local to shared moves the entry, and undo removes either form', async () => {
  const d = project(), p = onPath(d);
  await tap(d, ['init', 'claude', '--shared'], p); const raw = read(SHARED(d)), mtime = statSync(SHARED(d)).mtimeMs;
  await tap(d, ['init', 'claude', '--shared'], p); assert.equal(read(SHARED(d)), raw); assert.equal(statSync(SHARED(d)).mtimeMs, mtime);
  const old = project({ extra: { '.claude/settings.json': JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "/old/place/nib.js" hook claude', timeout: 30 }] }] } }) } });
  await tap(old, ['init', 'claude', '--shared'], onPath(old)); assert.deepEqual(cmds(SHARED(old)), ['nib hook claude']);
  const sw = project(), q = onPath(sw);
  await tap(sw, ['init', 'claude'], q); assert.deepEqual(cmds(SETTINGS(sw)), [`node "${bin}" hook claude`]);
  await tap(sw, ['init', 'claude', '--shared'], q); assert.deepEqual(cmds(SHARED(sw)), ['nib hook claude']); assert.ok(!existsSync(SETTINGS(sw)));
  const u = await tap(sw, ['init', 'claude', '--undo', '--shared'], q); assert.equal(u.code, 0); assert.ok(!existsSync(SHARED(sw)));
  const ul = project(); await tap(ul, ['init', 'claude'], onPath(ul)); assert.equal((await tap(ul, ['init', 'claude', '--undo'])).code, 0); assert.ok(!existsSync(SETTINGS(ul)));
});

test('[shared-portable-hook R5] the plan and the summary show the command that is written', async () => {
  const d = project(), p = onPath(d);
  const dry = await tap(d, ['init', 'claude', '--shared', '--dry-run'], p); assert.equal(dry.code, 0); assert.match(dry.out, /write the hook in .*settings\.json: nib hook claude\n/);
  const r = await tap(d, ['init', 'claude', '--shared'], p); assert.match(r.out, /Hook: written to .*settings\.json/);
  const again = await tap(d, ['init', 'claude', '--shared', '--dry-run'], p); assert.match(again.out, /keep the hook in .*settings\.json: nib hook claude/);
});

test('[init-rejects-store R1] --store on init claude exits 2 naming the project .nib and --project, writes nothing, also with --dry-run, --undo or the own .nib', async () => {
  const d = project(), before = snapshot(d), p = onPath(d);
  for (const [extra, store] of [[[], join(d, 'elsewhere')], [['--dry-run'], join(d, 'elsewhere')], [['--undo'], join(d, 'elsewhere')], [[], join(d, '.nib')]]) {
    const r = await tap(d, ['init', 'claude', '--store', store, ...extra], p);
    assert.equal(r.code, 2, extra.join(' ')); assert.match(r.err, /<project>\/\.nib/); assert.match(r.err, /--project/);
    assert.ok(!existsSync(join(d, '.nib')) && !existsSync(join(d, 'elsewhere')) && !existsSync(SETTINGS(d))); assert.deepEqual(snapshot(d), before);
  }
});

test('[init-rejects-store R2] --store still works for the other commands and init without it is unchanged', async () => {
  const d = project(), store = join(d, 'cat');
  assert.equal((await tap(d, ['import', join(d, '.claude/skills'), '--store', store])).code, 0);
  for (const argv of [['list'], ['ask', 'sql style'], ['show', 'acme-sql-style/SKILL.md#m1']]) assert.notEqual((await tap(d, [...argv, '--store', store])).code, 2, argv.join(' '));
  assert.equal((await tap(d, ['init', 'claude'], onPath(d))).code, 0); assert.ok(existsSync(join(d, '.nib', 'catalog.json')));
});
