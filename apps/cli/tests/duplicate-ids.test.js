import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';
import { importSkills, memoryReader } from '../../../packages/import/src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const skill = (dir, body, name = 'foo') => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\n---\n## Kv\n${body}\n`); };
const world = () => { const d = mkdtempSync(join(tmpdir(), 'dup-')); for (const x of ['a', 'b', 'c']) mkdirSync(join(d, x)); return d; };
async function nib(cwd, argv, extra = {}) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env: { GITHUB_TOKEN: '', HOME: join(cwd, '.nohome') }, ...extra });
  return { code, out, err };
}

test('[duplicate-skill-ids R1] two skills with one id are both searchable, the second as id~2, in ask, show, the hook and MCP', async () => {
  const d = world(); skill(join(d, 'a'), 'Kv from alpha.'); skill(join(d, 'b'), 'Kv from beta.');
  assert.equal((await nib(d, ['import', 'a', 'b'])).code, 0);
  const r = await nib(d, ['ask', 'kv']); assert.equal(r.code, 0); assert.equal(r.err, '');
  assert.match(r.out, /===== foo\/foo\/SKILL\.md :: Kv =====\n## Kv\nKv from alpha\./); assert.match(r.out, /===== foo~2\/foo\/SKILL\.md :: Kv =====\n## Kv\nKv from beta\./);
  assert.match((await nib(d, ['show', 'foo~2/foo/SKILL.md#m1'])).out, /Kv from beta/); assert.match((await nib(d, ['show', 'foo/foo/SKILL.md#m1'])).out, /Kv from alpha/);
  const h = await nib(d, ['hook', 'claude'], { stdin: (async function* () { yield JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'kv', cwd: d }); })() });
  assert.equal(h.code, 0); assert.match(h.out, /foo~2\/foo\/SKILL\.md/); assert.doesNotMatch(h.out + h.err, /duplicate module id|could not select/);
  const rpc = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search', arguments: { query: 'kv' } } }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get', arguments: { ref: 'foo~2/foo/SKILL.md#m1' } } }].map(m => JSON.stringify(m)).join('\n') + '\n';
  const m = await nib(d, ['mcp'], { stdin: (async function* () { yield rpc; })() });
  const lines = m.out.trim().split('\n').map(l => JSON.parse(l)); assert.match(lines[1].result.content[0].text, /foo~2\/foo\/SKILL\.md/); assert.match(lines[2].result.content[0].text, /Kv from beta/);
});

test('[duplicate-skill-ids R2] an identical later copy is searched once; a third, different copy is id~2', async () => {
  const d = world(); skill(join(d, 'a'), 'Kv from alpha.'); skill(join(d, 'b'), 'Kv from alpha.'); skill(join(d, 'c'), 'Kv from gamma.');
  await nib(d, ['import', 'a', 'b']); let r = await nib(d, ['ask', 'kv']);
  assert.equal(r.out.match(/===== foo/g).length, 1); assert.doesNotMatch(r.out, /foo~2/);
  await nib(d, ['import', 'c']); r = await nib(d, ['ask', 'kv']);
  assert.equal(r.out.match(/===== foo/g).length, 2); assert.match(r.out, /foo~2\/foo\/SKILL\.md :: Kv =====\n## Kv\nKv from gamma\./);
});

test('[duplicate-skill-ids R3] init with a source whose skill the project already has natively keeps ask working', async () => {
  const d = mkdtempSync(join(tmpdir(), 'dupi-')); skill(join(d, '.claude/skills'), 'Native kv.'); skill(join(d, 'src'), 'Source kv.');
  const i = await nib(d, ['init', 'claude', 'src']); assert.equal(i.code, 0, i.err);
  const r = await nib(d, ['ask', 'kv']); assert.equal(r.err, ''); assert.match(r.out, /Native kv\./); assert.match(r.out, /Source kv\./); assert.doesNotMatch(r.out, /no sections were selected/);
});

test('[duplicate-skill-ids R4] import, init and list print the conflict with what happens to it', async () => {
  const d = world(); skill(join(d, 'a'), 'A.'); skill(join(d, 'b'), 'B.');
  const NOTE = /Both stay searchable, the later one as <id>~2; a copy with identical files is searched once\./;
  const i = await nib(d, ['import', 'a', 'b']); assert.match(i.out, /Conflict: id "foo" is used by .*:foo and .*:foo\./); assert.match(i.out, NOTE);
  const l = await nib(d, ['list']); assert.match(l.out, /Conflict: id "foo"/); assert.match(l.out, NOTE);
  assert.doesNotMatch((await nib(d, ['list', 'nomatch'])).out, /Conflict/);
  const p = mkdtempSync(join(tmpdir(), 'dupi-')); skill(join(p, '.claude/skills'), 'N.'); skill(join(p, 'src'), 'S.');
  assert.match((await nib(p, ['init', 'claude', 'src'])).out, NOTE);
});

test('[duplicate-skill-ids R5] remove by skill name notes the unnamed skills that went with its source; by source or exact set it does not', async () => {
  const d = world(); skill(join(d, 'a'), 'A.', 'one'); skill(join(d, 'a'), 'A2.', 'two'); skill(join(d, 'b'), 'B.', 'three');
  await nib(d, ['import', 'a', 'b']);
  let r = await nib(d, ['remove', 'one']); assert.equal(r.code, 0); assert.match(r.out, /Removed 2 skills: one, two/); assert.match(r.out, /Note: nib remove removes the whole source that provides a skill, so 1 skill you did not name went with it\./);
  r = await nib(d, ['remove', 'three']); assert.doesNotMatch(r.out, /Note:/);
  await nib(d, ['import', 'a']); r = await nib(d, ['remove', join(d, 'a')]); assert.doesNotMatch(r.out, /Note:/);
});

test('[duplicate-skill-ids R6] the usage text states the exit codes for ask and the hook, and an empty ask exits 2', async () => {
  const d = world(); const u = await nib(d, ['--help']);
  assert.match(u.out, /exit codes: 0 ok \(ask and the hook also exit 0 when nothing matches or the store is unusable\), 1 error, 2 usage \(including an empty ask\)/);
  assert.equal((await nib(d, ['ask', ''])).code, 2);
});

test('[duplicate-skill-ids R7] offsets are string indexes and bytes is the UTF-8 length for non-ASCII text, and the guide says so', async () => {
  const text = '---\nname: u\n---\n## Café ☕ 😀\nnaïve résumé 日本語 😀 text.\n\n## Two\nplain.\n';
  const cat = await importSkills([memoryReader({ origin: 'm', files: { 'u/SKILL.md': text } })]);
  const f = cat.skills[0].files[0]; let multibyte = 0;
  for (const m of f.manifest.modules) { const t = f.text.slice(m.start, m.end); assert.equal(m.bytes, Buffer.byteLength(t)); if (m.bytes !== t.length) multibyte++; }
  assert.ok(multibyte >= 1); assert.equal(f.manifest.modules.at(-1).end, f.text.length);
  assert.match(read('docs/guide/importing.md'), /`start` and `end`[^.]*string indexes \(UTF-16 code units\)[^.]*`bytes`[^.]*UTF-8/);
});

test('[duplicate-skill-ids R8] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  for (const sub of ['lint', 'link']) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), sub, 'docs/specs/duplicate-skill-ids.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
