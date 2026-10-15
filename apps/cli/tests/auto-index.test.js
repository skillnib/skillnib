import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';
import { createUiApp } from '../src/ui/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NIB = join(ROOT, 'apps/cli/bin/nib.js');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const vec = t => [/revert|undo/i.test(t) ? 1 : 0, /invoice/i.test(t) ? 1 : 0, 0.1];
async function server() {
  const log = [], srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { const j = JSON.parse(b); log.push(j); res.end(JSON.stringify({ data: j.input.map((t, i) => ({ index: i, embedding: vec(t) })) })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); srv.unref();
  return { log, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}
const SKILL = x => `---\nname: ops\ndescription: Ops\n---\n\n# Ops\n\n## Rollback\n\nRevert the release.${x}\n\n## Billing\n\nInvoices go out monthly.\n`;
const OTHER = '---\nname: extra\ndescription: Extra\n---\n\n# Extra\n\n## Notes\n\nSomething else entirely.\n';
function project() { const d = mkdtempSync(join(tmpdir(), 'auto-')); mkdirSync(join(d, 'skills/ops'), { recursive: true }); mkdirSync(join(d, 'more/extra'), { recursive: true }); writeFileSync(join(d, 'skills/ops/SKILL.md'), SKILL('')); writeFileSync(join(d, 'more/extra/SKILL.md'), OTHER); return d; }
const nib = async (cwd, argv) => { let out = '', err = ''; const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env: {}, fetch: globalThis.fetch, nibPath: NIB }); return { code, out, err }; };
const ready = async () => { const s = await server(), d = project(); await nib(d, ['import', 'skills']); await nib(d, ['embed', 'on', '--url', s.url]); await nib(d, ['embed', 'build']); return { s, d }; };
async function ui(d) {
  const app = createUiApp({ project: d, nibPath: NIB, token: 'tok', env: {} }), port = await app.listen(0); app.server.unref();
  const call = (method, path, body) => new Promise((ok, no) => { const data = body === undefined ? null : JSON.stringify(body); const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, 'x-nib-token': 'tok', ...(data ? { 'content-type': 'application/json' } : {}) } }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => ok({ status: res.statusCode, json: () => JSON.parse(b) })); }); r.on('error', no); if (data) r.write(data); r.end(); });
  return { app, call, close: () => app.server.close() };
}

test('[embedding-auto-index R1] import, update and remove keep the index current and embed only what changed', async () => {
  const { s, d } = await ready(); let n = s.log.length;
  writeFileSync(join(d, 'skills/ops/SKILL.md'), SKILL(' Page the on-call.'));
  const imp = await nib(d, ['import', 'skills', '--force']); assert.equal(imp.code, 0); assert.match(imp.out, /Embedding index updated\. Embedded 1 module \(1 windows\), reused 2/);
  assert.match((await nib(d, ['embed', 'status'])).out, /State: current/); assert.equal(s.log.length, n + 1);
  const ask = await nib(d, ['ask', 'undo it', '--json']); assert.equal(JSON.parse(ask.out).retriever.name, 'bm25+embed'); assert.equal(ask.err, '');
  assert.equal((await nib(d, ['import', 'more'])).code, 0); assert.match((await nib(d, ['embed', 'status'])).out, /State: current/);
  writeFileSync(join(d, 'more/extra/SKILL.md'), OTHER + '\nMore.\n'); const up = await nib(d, ['update', '--force']); assert.equal(up.code, 0); assert.match(up.out, /Embedding index updated\./); assert.match((await nib(d, ['embed', 'status'])).out, /State: current/);
  const rm = await nib(d, ['remove', 'extra']); assert.equal(rm.code, 0); assert.match(rm.out, /Embedding index updated\. Embedded 0 modules.*reused 3/); assert.match((await nib(d, ['embed', 'status'])).out, /State: current/);
  await s.close();
});

test('[embedding-auto-index R2] a server failure during the step keeps the command successful and the old index', async () => {
  const { s, d } = await ready(), before = readFileSync(join(d, '.nib/vectors.bin')); await s.close();
  writeFileSync(join(d, 'skills/ops/SKILL.md'), SKILL(' Changed.'));
  const r = await nib(d, ['import', 'skills', '--force']); assert.equal(r.code, 0); assert.match(r.err, /the embedding index was not updated \(.*\); searches use BM25 until you run: nib embed build/); assert.match(r.out, /Imported/);
  assert.deepEqual(readFileSync(join(d, '.nib/vectors.bin')), before); const a = await nib(d, ['ask', 'monthly invoices']); assert.equal(a.code, 0); assert.match(a.err, /out of date/);
});

test('[embedding-auto-index R3] off, or --no-embed, makes no request and prints nothing about the index', async () => {
  const d = project(), r = await nib(d, ['import', 'skills']); assert.doesNotMatch(r.out + r.err, /[Ee]mbedding/);
  const { s, d: d2 } = await ready(), n = s.log.length; writeFileSync(join(d2, 'skills/ops/SKILL.md'), SKILL(' X.'));
  const q = await nib(d2, ['import', 'skills', '--force', '--no-embed']); assert.equal(q.code, 0); assert.doesNotMatch(q.out + q.err, /[Ee]mbedding index/); assert.equal(s.log.length, n);
  await nib(d2, ['embed', 'off']); writeFileSync(join(d2, 'skills/ops/SKILL.md'), SKILL(' Y.')); const o = await nib(d2, ['import', 'skills', '--force']); assert.doesNotMatch(o.out + o.err, /[Ee]mbedding index/); assert.equal(s.log.length, n); await s.close();
});

test('[embedding-auto-index R4] the UI follows an import, update, remove or turn-on with an Updating the embedding index task', async () => {
  const { s, d } = await ready(), u = await ui(d); writeFileSync(join(d, 'more/extra/SKILL.md'), OTHER);
  assert.equal((await u.call('POST', '/api/import', { type: 'folder', path: join(d, 'more') })).status, 202); await u.app.settled();
  assert.deepEqual(u.app.jobs.slice(0, 2).map(j => [j.kind, j.status, j.ok]), [['embed-index', 'done', true], ['cli', 'done', true]]); assert.equal(u.app.jobs[0].title, 'Updating the embedding index'); assert.match(u.app.jobs[0].output, /Embedded/);
  assert.match((await u.call('GET', '/api/embed')).json().output, /State: current/);
  await u.call('POST', '/api/import', { type: 'folder', path: join(d, 'nope') }).catch(() => {}); 
  const st = (await u.call('GET', '/api/state')).json(); await u.call('POST', '/api/update', { key: 'dir:/nope' });
  await u.call('POST', '/api/remove', { key: st.sources[0].key }); await u.app.settled(); assert.equal(u.app.jobs[0].kind, 'embed-index'); assert.equal(u.app.jobs[1].kind, 'cli');
  u.close(); await s.close();
  const d2 = project(); await nib(d2, ['import', 'skills']); const u2 = await ui(d2);
  await u2.call('POST', '/api/import', { type: 'folder', path: join(d2, 'more') }); await u2.app.settled(); assert.equal(u2.app.jobs.length, 1, 'no follow-up task when embeddings are off');
  const s2 = await server(); await u2.call('POST', '/api/embed', { action: 'on', url: s2.url }); await u2.app.settled(); assert.deepEqual(u2.app.jobs.slice(0, 2).map(j => [j.title, j.ok]), [['Updating the embedding index', true], ['Turn on embeddings', true]]);
  assert.match((await u2.call('GET', '/api/embed')).json().output, /State: current/); u2.close(); await s2.close();
});

test('[embedding-auto-index R5] the header chip, the task states and the update-now button exist in the page', () => {
  assert.match(read('apps/cli/src/ui/index.html'), /id="idx"[^>]*hidden/); const js = read('apps/cli/src/ui/app.js');
  assert.match(js, /\$\('#idx'\)\.hidden = !running\.some\(j => j\.kind === 'embed-index'\)/); assert.match(js, /j\.status === 'waiting'/); assert.match(js, /update it now/);
});

test('[embedding-auto-index R6] the guide and README say the index updates itself, and the CHANGELOG has a line', () => {
  assert.match(read('docs/guide/embeddings.md'), /updates itself/); assert.match(read('docs/guide/embeddings.md'), /--no-embed/); assert.match(read('README.md'), /updates itself/); assert.match(read('CHANGELOG.md'), /embedding index updates itself/);
});

test('[embedding-auto-index R7] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  for (const sub of ['lint', 'link']) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), sub, 'docs/specs/embedding-auto-index.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
