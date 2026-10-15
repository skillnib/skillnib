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
const SYN = { undo: 'revert', revert: 'revert', shipment: 'deploy', release: 'deploy', invoices: 'bill', monthly: 'time' };
const CONCEPTS = ['revert', 'deploy', 'bill', 'time'];
const vec = t => { const v = CONCEPTS.map(() => 0); for (const w of t.toLowerCase().split(/[^a-z]+/)) { const i = CONCEPTS.indexOf(SYN[w]); if (i >= 0) v[i]++; } v.push(0.1); return v; };
async function server() {
  const log = [], srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { const j = JSON.parse(b); log.push(j); res.end(JSON.stringify({ data: j.input.map((t, i) => ({ index: i, embedding: vec(t) })) })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); srv.unref();
  return { log, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}
const SKILL = '---\nname: ops\ndescription: Operations notes\n---\n\n# Ops\n\n## Rollback\n\nRevert the release to the previous build when checks fail.\n\n## Billing\n\nInvoices are sent monthly to the finance team.\n';
const project = () => { const d = mkdtempSync(join(tmpdir(), 'cmp-')); mkdirSync(join(d, 'skills/ops'), { recursive: true }); writeFileSync(join(d, 'skills/ops/SKILL.md'), SKILL); return d; };
const nib = async (cwd, argv) => { let out = '', err = ''; const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env: {}, fetch: globalThis.fetch, nibPath: NIB }); return { code, out, err }; };
async function ui(d) {
  const app = createUiApp({ project: d, nibPath: NIB, token: 'tok', env: {} }), port = await app.listen(0); app.server.unref();
  const call = (method, path, body, token = 'tok') => new Promise((ok, no) => { const data = body === undefined ? null : JSON.stringify(body); const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-nib-token': token } : {}) } }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: b, json: () => JSON.parse(b) })); }); r.on('error', no); if (data) r.write(data); r.end(); });
  return { app, call, close: () => app.server.close() };
}
const ready = async () => { const s = await server(), d = project(); await nib(d, ['import', 'skills']); await nib(d, ['embed', 'on', '--url', s.url, '--model', 'fake']); await nib(d, ['embed', 'build']); return { s, d }; };
const q = encodeURIComponent('undo the shipment');

test('[embedding-compare-ui R1] nib ask --no-embed returns BM25 and makes no request even when embeddings are on', async () => {
  const { s, d } = await ready(); const n = s.log.length;
  const off = JSON.parse((await nib(d, ['ask', 'undo the shipment', '--json', '--no-embed'])).out), on = JSON.parse((await nib(d, ['ask', 'undo the shipment', '--json'])).out);
  assert.equal(off.retriever.name, 'bm25'); assert.equal(on.retriever.name, 'bm25+embed'); assert.equal(s.log.length, n + 1, 'only the call without the flag asked the server');
  assert.match(read('apps/cli/src/args.js'), /--no-embed/); await s.close();
});

test('[embedding-compare-ui R2] compare returns the two CLI deliveries and the sections only one side found', async () => {
  const { s, d } = await ready(), u = await ui(d);
  const r = (await u.call('GET', `/api/compare?q=${q}&k=4`)).json();
  const cli = async extra => JSON.parse((await nib(d, ['ask', 'undo the shipment', '--k', '4', '--json', ...extra])).out);
  assert.deepEqual(r.bm25.delivery.sections.map(x => x.ref), (await cli(['--no-embed'])).sections.map(x => x.ref)); assert.deepEqual(r.embed.delivery.sections.map(x => x.ref), (await cli([])).sections.map(x => x.ref));
  assert.equal(r.usedEmbeddings, true); assert.equal(r.bm25.delivery.sections.length, 0); assert.ok(r.onlyEmbed.length >= 1 && r.onlyBm25.length === 0);
  assert.ok(r.embed.delivery.sections.some(x => x.title === 'Rollback' && r.onlyEmbed.includes(x.ref)));
  u.close(); await s.close();
});

test('[embedding-compare-ui R3] off means no embeddings side; unusable means it says embeddings were not used', async () => {
  const d = project(); await nib(d, ['import', 'skills']); let u = await ui(d);
  const off = (await u.call('GET', `/api/compare?q=${q}`)).json(); assert.equal(off.embedOn, false); assert.equal(off.embed, null); u.close();
  const { s, d: d2 } = await ready(); await s.close(); u = await ui(d2);
  const down = (await u.call('GET', `/api/compare?q=${q}`)).json(); assert.equal(down.embedOn, true); assert.equal(down.usedEmbeddings, false); assert.match(down.embed.notice, /embeddings unavailable/); assert.equal(down.embed.delivery.retriever.name, 'bm25');
  assert.match(read('apps/cli/src/ui/app.js'), /did not use embeddings/); u.close();
});

test('[embedding-compare-ui R4] setup runs the matching nib embed command as a token-protected job', async () => {
  const s = await server(), d = project(); await nib(d, ['import', 'skills']); const u = await ui(d);
  assert.equal((await u.call('POST', '/api/embed', { action: 'off' }, null)).status, 403);
  assert.equal((await u.call('POST', '/api/embed', { action: 'on', model: 'm' })).status, 400); assert.equal((await u.call('POST', '/api/embed', { action: 'on', url: '--x', model: 'm' })).status, 400); assert.equal((await u.call('POST', '/api/embed', { action: 'nope' })).status, 400);
  assert.equal((await u.call('POST', '/api/embed', { action: 'on', url: s.url, model: 'fake' })).status, 202); await u.app.settled();
  assert.equal((await u.call('GET', '/api/embed')).json().on, true); assert.match((await u.call('GET', '/api/embed')).json().output, /Embeddings on: fake/); assert.deepEqual([(await u.call('GET', '/api/embed')).json().url, (await u.call('GET', '/api/embed')).json().model], [s.url, 'fake']);
  await u.call('POST', '/api/embed', { action: 'build' }); await u.app.settled(); assert.ok(existsSync(join(d, '.nib/vectors.bin'))); assert.equal(u.app.jobs[0].ok, true);
  await u.call('POST', '/api/embed', { action: 'off' }); await u.app.settled(); assert.equal((await u.call('GET', '/api/embed')).json().on, false);
  u.close(); await s.close();
});

test('[embedding-compare-ui R5] the page has the compare view with two panes, commands and text-only insertion', async () => {
  const d = project(), u = await ui(d), js = read('apps/cli/src/ui/app.js');
  assert.match(js, /\['compare', 'Compare retrievers'/); assert.match(js, /BM25 \(default\)/); assert.match(js, /BM25 \+ embeddings/); assert.match(js, /--no-embed/);
  assert.match(js, /e\.on \? 'Turn off' : 'Turn on'/); assert.match(js, /if \(e\.on\) return await startJob\('embed', \{ action: 'off' \}\)/);
  const view = js.slice(js.indexOf('function compareView'), js.indexOf('function quickView')); assert.ok(!/innerHTML|insertAdjacentHTML/.test(view));
  const page = await u.call('GET', '/'); assert.match(page.headers['content-security-policy'], /default-src 'self'/); assert.ok(!/script-src/.test(page.headers['content-security-policy']));
  u.close();
});

test('[embedding-compare-ui R6] with embeddings off a comparison makes no embeddings request', async () => {
  const { s, d } = await ready(); await nib(d, ['embed', 'off']); const n = s.log.length, u = await ui(d);
  const r = (await u.call('GET', `/api/compare?q=${q}`)).json(); assert.equal(r.embed, null); assert.equal(s.log.length, n); u.close(); await s.close();
});

test('[embedding-compare-ui R7] the guide and README describe the page and --no-embed, and the CHANGELOG has a line', () => {
  const g = read('docs/guide/embeddings.md'); assert.match(g, /Compare retrievers/); assert.match(g, /nib ask .* --no-embed/); assert.match(read('README.md'), /--no-embed/); assert.match(read('CHANGELOG.md'), /Compare retrievers/);
});

test('[embedding-compare-ui R8] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  for (const sub of ['lint', 'link']) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), sub, 'docs/specs/embedding-compare-ui.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
