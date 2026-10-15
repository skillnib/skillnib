import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from '../src/main.js';
import { saveStore, loadStore, StoreError, MAX_STORE_BYTES } from '../src/store.js';
import { importSkills, memoryReader } from '../../../packages/import/src/index.js';
import { fakeFetch, SHA } from '../../../packages/import/tests/helpers.js';

const here = dirname(fileURLToPath(import.meta.url)), bin = join(here, '..', 'bin', 'nib.js');
const KV = '---\nname: storage\n---\nintro\n\n## KV namespaces\r\nBind a KV namespace in wrangler config.\r\n\r\n## Queues\nQueues deliver messages.\n';
const EMAIL = '---\nname: email\n---\n## Sending\nSend email with a binding.\n';

function project(layout = { 'skills/storage/SKILL.md': KV, 'skills/storage/refs/d1.md': '## D1\nSQL database binding.\n', 'skills/email/SKILL.md': EMAIL, 'solo.md': '## Solo\nLone note about caching.\n', 'skills/README.md': '# readme\n' }) {
  const d = mkdtempSync(join(tmpdir(), 'tap-'));
  for (const [p, c] of Object.entries(layout)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
async function tap(cwd, argv, extra = {}, deps = {}) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env: { GITHUB_TOKEN: '' }, fetch: extra.fetch }, deps);
  return { code, out, err };
}
const WORLD = () => ({ repos: { 'acme/skills': { refs: { HEAD: SHA, v1: SHA }, files: { 'skills/alpha/SKILL.md': '---\nname: alpha\n---\n## Use\nAlpha kv thing.\n', 'README.md': '# r\n' } } } });

test('[tap-cli R1] import accepts a directory, files and GitHub references, singly or mixed, and prints a summary', async () => {
  const d = project();
  let r = await tap(d, ['import', 'skills']);
  assert.equal(r.code, 0); assert.match(r.out, /Imported 2 skills, 3 files, \d+ modules \(0 oversize\)/); assert.match(r.out, /Skipped 1 file:\n  README\.md \(not inside a skill directory/);
  r = await tap(d, ['import', 'solo.md']); assert.equal(r.code, 0); assert.match(r.out, /Imported 1 skill, 1 file/);
  r = await tap(d, ['import', 'skills', 'solo.md', '--store', 'out']); assert.equal(r.code, 0); assert.match(r.out, /Imported 3 skills/);
  assert.ok(statSync(join(d, 'out', 'catalog.json')).size > 0);
  r = await tap(d, ['import', 'acme/skills@v1'], { fetch: fakeFetch(WORLD()) }); assert.equal(r.code, 0); assert.match(r.out, /alpha  1 file/);
  r = await tap(d, ['import', 'skills', 'acme/skills'], { fetch: fakeFetch(WORLD()) }); assert.match(r.out, /Already imported: acme\/skills is at commit aaaaaaa/); assert.match(r.out, /Already imported and unchanged: .*skills/); assert.match(r.out, /Nothing new to import\./);
  r = await tap(d, ['import', 'acme/skills', '--force'], { fetch: fakeFetch(WORLD()) }); assert.match(r.out, /Imported 1 skill/);
});

test('[tap-cli R1] import exits 1 when nothing imports or an input cannot be resolved, and 2 without a source', async () => {
  const d = project({ 'only/README.md': '# nothing\n' });
  let r = await tap(d, ['import', 'only']); assert.equal(r.code, 1); assert.match(r.err, /nothing-imported/);
  r = await tap(d, ['import', 'missing.md']); assert.equal(r.code, 1); assert.match(r.err, /no such file or directory/);
  r = await tap(d, ['import', 'ghost/repo'], { fetch: fakeFetch(WORLD()) }); assert.equal(r.code, 1); assert.match(r.err, /not-found/);
  r = await tap(d, ['import']); assert.equal(r.code, 2);
});

test('[tap-cli R2] the store is replaced atomically, survives a failed import, and is refused when too large, missing, unreadable or the wrong version', async () => {
  const d = project(); await tap(d, ['import', 'skills']);
  const file = join(d, '.nib', 'catalog.json'), before = readFileSync(file, 'utf8');
  assert.equal((await tap(d, ['import', 'skills', 'missing.md'])).code, 1);
  assert.equal(readFileSync(file, 'utf8'), before); assert.deepEqual(readdirSync(join(d, '.nib')), ['catalog.json']);
  await tap(d, ['import', 'solo.md']); assert.notEqual(readFileSync(file, 'utf8'), before);
  const cat = await importSkills([memoryReader({ files: { 'a/SKILL.md': '## A\nx\n' } })]);
  await assert.rejects(saveStore(join(d, 'tiny'), cat, { maxBytes: 100 }), e => e instanceof StoreError && e.code === 'too-large');
  await assert.rejects(loadStore(join(d, 'nowhere')), e => e.code === 'missing');
  assert.equal(MAX_STORE_BYTES, 64 * 1024 * 1024);
  const bad = JSON.parse(before); bad.format = 99; writeFileSync(file, JSON.stringify(bad));
  await assert.rejects(loadStore(join(d, '.nib')), e => e.code === 'version');
  writeFileSync(file, '{not json'); await assert.rejects(loadStore(join(d, '.nib')), e => e.code === 'corrupt');
  const tampered = JSON.parse(before); const h = Object.keys(tampered.texts)[0]; tampered.texts[h] += 'tampered'; writeFileSync(file, JSON.stringify(tampered));
  await assert.rejects(loadStore(join(d, '.nib')), e => e.code === 'corrupt' && /fails verification/.test(e.message));
  for (const cmd of [['show', 'x#m0'], ['list']]) { const r = await tap(d, cmd); assert.equal(r.code, 1); assert.match(r.err, /store/); }
});

test('[tap-cli R3] ask delivers at most k sections in rank order with the identity and byte count in the header', async () => {
  const d = project(); await tap(d, ['import', 'skills']);
  const r = await tap(d, ['ask', 'bind', 'a', 'KV', 'namespace', 'and', 'queues', 'messages', '--k', '2']);
  assert.equal(r.code, 0); assert.match(r.out, /^SkillNib bm25 v1 \(corpus [0-9a-f]{8}\): 2 sections, \d+ bytes\n/);
  assert.ok(r.out.indexOf('KV namespaces =====') < r.out.indexOf('Queues ====='));
  const one = await tap(d, ['ask', 'bind a KV namespace queues messages', '--k=1']); assert.match(one.out, /: 1 section, /);
});

test('[tap-cli R4] delivered and shown text equals the source bytes, including CRLF', async () => {
  const d = project(); await tap(d, ['import', 'skills']);
  const src = readFileSync(join(d, 'skills/storage/SKILL.md'), 'utf8'), want = src.slice(src.indexOf('## KV namespaces'), src.indexOf('## Queues'));
  const r = await tap(d, ['ask', 'bind a KV namespace in wrangler config', '--k', '1', '--json']);
  const j = JSON.parse(r.out); assert.equal(j.sections[0].text, want); assert.ok(want.includes('\r\n'));
  const shown = await tap(d, ['show', j.sections[0].ref]); assert.equal(shown.out, want);
  assert.ok((await tap(d, ['ask', 'bind a KV namespace in wrangler config', '--k', '1'])).out.includes(want));
  const missing = await tap(d, ['show', 'nope#m0']); assert.equal(missing.code, 1); assert.match(missing.err, /no module "nope#m0"/);
});

test('[tap-cli R5] the CLI outline lists undelivered modules of delivered skills, names other skills, honours --outline-lines, and carries no text', async () => {
  const d = project(); await tap(d, ['import', 'skills']);
  const r = await tap(d, ['ask', 'bind a KV namespace in wrangler config', '--k', '1']);
  const outline = r.out.slice(r.out.indexOf('--- Not delivered'));
  assert.match(outline, /storage\/storage\/SKILL\.md#m\d+  Queues  \d+ B/); assert.match(outline, /Other skills: email/);
  assert.ok(!outline.includes('Queues deliver messages'));
  const cut = await tap(d, ['ask', 'bind a KV namespace in wrangler config', '--k', '1', '--outline-lines', '1']);
  assert.match(cut.out, /\.\.\. \d+ more lines? not shown/);
});

test('[tap-cli R6] ask fails open with exit 0 for no match, no store, a corrupt store and a thrown error; other commands fail loudly', async () => {
  const d = project(); await tap(d, ['import', 'skills']);
  let r = await tap(d, ['ask', 'zzzz qqqq']);
  assert.equal(r.code, 0); assert.match(r.out, /^SkillNib: no sections were selected \(no module matched the ask\)\. Rephrase the ask with words from one of your skills, or check what is imported with nib list\./); assert.match(r.out, /Skills in the catalog/); assert.match(r.err, /no module matched/);
  const empty = project({ 'x.txt': 'y' });
  r = await tap(empty, ['ask', 'anything']); assert.equal(r.code, 0); assert.match(r.out, /no sections were selected \(no store found/); assert.ok(!r.out.includes('Skills in the catalog')); assert.match(r.err, /no store found/);
  writeFileSync(join(d, '.nib', 'catalog.json'), '{broken'); r = await tap(d, ['ask', 'kv']); assert.equal(r.code, 0); assert.match(r.out, /no sections were selected/); assert.match(r.err, /not valid JSON/);
  const d2 = project(); await tap(d2, ['import', 'skills']);
  r = await tap(d2, ['ask', 'kv namespace'], {}, { createRetriever: async () => { throw new Error('boom'); } });
  assert.equal(r.code, 0); assert.match(r.out, /no sections were selected \(SkillNib could not select sections\)/); assert.match(r.out, /Skills in the catalog/); assert.match(r.err, /boom/);
  assert.equal((await tap(empty, ['list'])).code, 1); assert.equal((await tap(empty, ['show', 'a#m0'])).code, 1);
});

test('[tap-cli R7] stdout carries only the delivery, --json is one object, and exit codes are 0, 1 and 2', async () => {
  const d = project(); await tap(d, ['import', 'skills']);
  const r = await tap(d, ['ask', 'bind a KV namespace in wrangler config', '--json']);
  assert.equal(r.err, ''); const j = JSON.parse(r.out);
  assert.deepEqual(Object.keys(j).sort(), ['bytes', 'failOpen', 'format', 'hits', 'outline', 'retriever', 'sections']); assert.equal(j.format, 1);
  const fo = JSON.parse((await tap(d, ['ask', 'zzzz qqqq', '--json'])).out); assert.equal(fo.failOpen.reason, 'no module matched the ask'); assert.deepEqual(fo.sections, []);
  for (const argv of [['bogus'], [], ['ask'], ['ask', 'x', '--k', 'abc'], ['ask', 'x', '--k', '0'], ['ask', 'x', '--nope'], ['show'], ['ask', 'x', '--json=1']]) {
    const u = await tap(d, argv); assert.equal(u.code, 2, argv.join(' ')); assert.equal(u.out, ''); assert.match(u.err, /usage:/);
  }
  const proc = spawnSync('node', [bin, 'ask', 'bind a KV namespace in wrangler config', '--k', '1'], { cwd: d, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
  assert.equal(proc.status, 0); assert.match(proc.stdout, /^SkillNib bm25 v1/); assert.equal(proc.stderr, '');
  assert.equal(spawnSync('node', [bin, 'nonsense'], { encoding: 'utf8' }).status, 2);
});

test('[tap-cli R8] only apps/cli uses node: modules; the delivery package imports nothing', () => {
  const srcs = readdirSync(join(here, '..', 'src')).filter(f => f.endsWith('.js')).map(f => readFileSync(join(here, '..', 'src', f), 'utf8'));
  assert.ok(srcs.some(s => /from 'node:/.test(s)));
  const deliver = readFileSync(join(here, '../../../packages/deliver/src/index.js'), 'utf8');
  assert.ok(!/node:/.test(deliver));
  assert.equal(JSON.parse(readFileSync(join(here, '../../../packages/deliver/package.json'), 'utf8')).skillnib.runtimeNeutral, true);
});
