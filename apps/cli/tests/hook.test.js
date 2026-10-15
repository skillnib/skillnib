import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { main } from '../src/main.js';
import { fakeFetch, SHA } from '../../../packages/import/tests/helpers.js';

const here = dirname(fileURLToPath(import.meta.url)), bin = join(here, '..', 'bin', 'nib.js');
const FIX = join(here, '../../../docs/guide/sample-skills');
const evt = (prompt, cwd, extra = {}) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt, cwd, ...extra });
const cleanEnv = () => { const e = { ...process.env, GITHUB_TOKEN: '' }; delete e.NODE_TEST_CONTEXT; delete e.NIB_STORE; return e; };

async function tap(cwd, argv, { stdin, env = { GITHUB_TOKEN: '' }, fetch, nibPath = bin } = {}, deps = {}) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, stdin: stdin === undefined ? null : Readable.from([stdin]), cwd, env, fetch, nibPath }, deps);
  return { code, out, err };
}
function project(layout) {
  const d = mkdtempSync(join(tmpdir(), 'hook-'));
  for (const [p, c] of Object.entries(layout ?? {})) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
async function acme() { const d = project(); cpSync(FIX, join(d, 'skills'), { recursive: true }); await tap(d, ['import', 'skills']); return d; }
const PROMPT = 'Write the incident report for yesterday: the payments API returned 500 errors for about 20 minutes because a TLS certificate expired.';

test('[claude-code-hook R1] ask, show, list and hook find the same store from a subdirectory, an environment variable or a flag', async () => {
  const d = await acme(), sub = join(d, 'a', 'b'); mkdirSync(sub, { recursive: true });
  const other = project({ 'x.txt': 'y' });
  assert.match((await tap(sub, ['list'])).out, /acme-sql-style/);
  assert.match((await tap(sub, ['ask', 'release notes for version 2.4.0'])).out, /^SkillNib bm25/);
  assert.match((await tap(other, ['list'], { env: { NIB_STORE: join(d, '.nib') } })).out, /acme-sql-style/);
  assert.match((await tap(other, ['list', '--store', join(d, '.nib')], { env: { NIB_STORE: '/nowhere' } })).out, /acme-sql-style/);
  const viaEvent = await tap(other, ['hook', 'claude'], { stdin: evt(PROMPT, sub) });
  assert.match(viaEvent.out, /Report structure/);
  const missing = await tap(other, ['list']); assert.equal(missing.code, 1); assert.match(missing.err, /no store found at/);
  assert.match((await tap(other, ['ask', 'anything'])).out, /no sections were selected/);
});

test('[claude-code-hook R2] the hook output on a catalog with oversize modules stays within the budget', async () => {
  const big = '---\nname: huge\n---\n' + Array.from({ length: 5 }, (_, i) => `## Topic ${i}\n` + 'kv namespace binding wrangler config detail line\n'.repeat(260 + i * 150)).join('\n');
  const d = project({ 'skills/huge/SKILL.md': big }); await tap(d, ['import', 'skills']);
  for (const prompt of ['bind a kv namespace in wrangler config', 'kv', 'namespace binding detail']) {
    const r = await tap(d, ['hook', 'claude'], { stdin: evt(prompt, d) });
    assert.equal(r.code, 0); assert.ok(r.out.length <= 9500 && r.out.length > 0, `${r.out.length}`); assert.match(r.out, /too large to inject/);
  }
});

test('[claude-code-hook R3] the printed fetch command runs from another directory and returns the exact module text', async () => {
  const d = await acme(), other = project({ 'x.txt': 'y' });
  const r = await tap(d, ['hook', 'claude'], { stdin: evt(PROMPT, d) });
  const cmd = /fetch one with: (node .+? show <ref> --store \S+)\) ---/.exec(r.out)[1];
  const ref = /^\s+(acme-[^\s]+#m\d+)\s/m.exec(r.out.slice(r.out.indexOf('--- Not delivered')))[1];
  const run = spawnSync('sh', ['-c', cmd.replace('<ref>', `'${ref}'`)], { cwd: other, encoding: 'utf8', env: cleanEnv() });
  assert.equal(run.status, 0, run.stderr);
  const [, ...rel] = ref.split('#')[0].split('/'), file = readFileSync(join(d, 'skills', ...rel), 'utf8'); // ref is <skill id>/<file path>#<module id>
  assert.ok(file.includes(run.stdout) && run.stdout.length > 0);
  assert.match(cmd, new RegExp(`^node ${bin.replace(/[/.]/g, '\\$&')} show`)); assert.ok(cmd.includes(join(d, '.nib')));
});

test('[claude-code-hook R4] the hook prints a delivery only for a non-empty UserPromptSubmit prompt that is not a slash command, and always exits 0', async () => {
  const d = await acme();
  const ok = await tap(d, ['hook', 'claude'], { stdin: evt(PROMPT, d) });
  assert.equal(ok.code, 0); assert.match(ok.out, /^SkillNib bm25 v1 \(corpus [0-9a-f]{8}\): \d sections?, \d+ bytes\n/);
  for (const stdin of [evt('', d), evt('   ', d), evt('/help', d), evt('  /clear', d), JSON.stringify({ hook_event_name: 'SessionStart', cwd: d }), JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: d }), '', '   \n']) {
    const r = await tap(d, ['hook', 'claude'], { stdin }); assert.equal(r.code, 0); assert.equal(r.out, '', stdin); assert.equal(r.err, '');
  }
  const bad = await tap(d, ['hook', 'claude'], { stdin: '{oops' }); assert.equal(bad.code, 0); assert.match(bad.out, /no sections were selected \(the hook input was not valid JSON\)/);
  const silent = new Readable({ read() {} });
  const t0 = Date.now(), hang = await main(['hook', 'claude'], { stdout: { write() {} }, stderr: { write() {} }, stdin: silent, cwd: d, env: {}, nibPath: bin }, { stdinTimeoutMs: 80 });
  assert.equal(hang, 0); assert.ok(Date.now() - t0 < 2000);
  const proc = spawnSync('node', [bin, 'hook', 'claude'], { cwd: d, input: evt(PROMPT, d), encoding: 'utf8', env: cleanEnv() });
  assert.equal(proc.status, 0); assert.match(proc.stdout, /Report structure/); assert.equal(proc.stderr, '');
  assert.equal((await tap(d, ['hook'])).code, 2); assert.equal((await tap(d, ['hook', 'codex'])).code, 2);
});

test('[claude-code-hook R5] every failure prints a notice with the cause on stderr, lists skill sources when known, stays within the budget and exits 0', async () => {
  const d = await acme(), none = project({ 'x.txt': 'y' });
  let r = await tap(none, ['hook', 'claude'], { stdin: evt(PROMPT, none) });
  assert.equal(r.code, 0); assert.match(r.out, /^SkillNib: no sections were selected \(no store found at /); assert.ok(!r.out.includes('SKILL.md')); assert.match(r.err, /no store found/);
  writeFileSync(join(none, '.nib-x'), ''); mkdirSync(join(none, '.nib')); writeFileSync(join(none, '.nib', 'catalog.json'), '{broken');
  r = await tap(none, ['hook', 'claude'], { stdin: evt(PROMPT, none) }); assert.equal(r.code, 0); assert.match(r.out, /not valid JSON/); assert.match(r.err, /not valid JSON/);
  r = await tap(d, ['hook', 'claude'], { stdin: evt('zzzz qqqq', d) });
  assert.match(r.out, /no sections were selected \(no module matched the prompt\)\. Read the skill files directly/); assert.match(r.out, new RegExp(`acme-sql-style  ${join(d, 'skills', 'acme-sql-style', 'SKILL.md').replace(/[/.]/g, '\\$&')}`));
  r = await tap(d, ['hook', 'claude'], { stdin: evt(PROMPT, d) }, { createRetriever: async () => { throw new Error('boom'); } });
  assert.equal(r.code, 0); assert.match(r.out, /SkillNib could not select sections/); assert.match(r.out, /acme-release-notes/); assert.match(r.err, /boom/);
  const g = project(); await tap(g, ['import', 'acme/skills'], { fetch: fakeFetch({ repos: { 'acme/skills': { refs: { HEAD: SHA }, files: { 'skills/alpha/SKILL.md': '---\nname: alpha\n---\n## Use\nkv thing\n' } } } }) });
  r = await tap(g, ['hook', 'claude'], { stdin: evt('zzzz qqqq', g) }); assert.match(r.out, new RegExp(`alpha  github:acme/skills@${SHA}.*no local file`));
  const many = project(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`skills/s${i}/SKILL.md`, `---\nname: skill-${i}\n---\n## A\nbody ${i}\n`])));
  await tap(many, ['import', 'skills']); r = await tap(many, ['hook', 'claude'], { stdin: evt('zzzz qqqq', many) });
  assert.ok(r.out.length <= 9500); assert.match(r.out, /\.\.\. and \d+ more skills\n$/);
});

test('[claude-code-hook R6] the hook writes nothing and makes no network call', async () => {
  const d = await acme(), store = join(d, '.nib'), list = () => ({ store: readdirSync(store), project: readdirSync(d).sort(), tmp: readdirSync(tmpdir()).filter(x => x.startsWith('hook-')).length });
  chmodSync(join(store, 'catalog.json'), 0o444); chmodSync(store, 0o555);
  const before = list(), calls = [];
  const r = await tap(d, ['hook', 'claude'], { stdin: evt(PROMPT, d), fetch: (...a) => { calls.push(a); throw new Error('network is off'); } });
  assert.equal(r.code, 0); assert.match(r.out, /Report structure/); assert.deepEqual(calls, []);
  const bad = await tap(d, ['hook', 'claude'], { stdin: evt('zzzz qqqq', d), fetch: () => { throw new Error('network is off'); } });
  assert.equal(bad.code, 0); assert.deepEqual(list(), before);
  chmodSync(store, 0o755); chmodSync(join(store, 'catalog.json'), 0o644);
});

test('[claude-code-hook R7] the hook delivers the same header and framing as ask, with the R2b target section verbatim', async () => {
  const d = await acme();
  const hook = (await tap(d, ['hook', 'claude'], { stdin: evt(PROMPT, d) })).out, ask = (await tap(d, ['ask', PROMPT])).out;
  const head = t => t.slice(0, t.indexOf('--- Not delivered'));
  assert.equal(head(hook), head(ask));
  const src = readFileSync(join(FIX, 'acme-incident-report', 'SKILL.md'), 'utf8'), want = src.slice(src.indexOf('## Report structure'), src.indexOf('## Blameless language'));
  assert.ok(hook.includes(`===== acme-incident-report/acme-incident-report/SKILL.md :: Report structure =====\n${want}`));
});

test('[claude-code-hook R8] only apps/cli touches stdin, the environment and the filesystem', () => {
  const src = readdirSync(join(here, '..', 'src')).filter(f => f.endsWith('.js')).map(f => readFileSync(join(here, '..', 'src', f), 'utf8')).join('\n');
  assert.match(src, /for await \(const c of stream\)/); assert.match(src, /from 'node:/);
  assert.ok(!/stdin|process\./.test(readFileSync(join(here, '../../../packages/deliver/src/index.js'), 'utf8')));
});
