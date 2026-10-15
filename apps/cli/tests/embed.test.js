import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { main } from '../src/main.js';
import { windowsOf, rrf } from '../../../packages/embed/src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

// A tiny "semantic" model: synonyms fold to a concept, vectors count concepts.
const SYN = { undo: 'revert', rollback: 'revert', revert: 'revert', shipment: 'deploy', deploy: 'deploy', release: 'deploy', invoices: 'bill', billing: 'bill', invoice: 'bill', monthly: 'time', weekly: 'time' };
const CONCEPTS = ['revert', 'deploy', 'bill', 'time'];
const vec = t => { const v = CONCEPTS.map(() => 0); for (const w of t.toLowerCase().split(/[^a-z]+/)) { const i = CONCEPTS.indexOf(SYN[w]); if (i >= 0) v[i]++; } v.push(0.1); return v; };

async function server(mode = 'ok') {
  const log = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}'); log.push({ url: req.url, auth: req.headers.authorization, ...j });
      const go = () => {
        if (mode === 'limit' && j.input.some(t => t.length > 400)) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: "'input' exceeds the 100-token limit of the model." } })); }
        if (mode === 'err') { res.statusCode = 500; return res.end('no'); }
        if (mode === 'bad') return res.end(JSON.stringify({ nope: 1 }));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: j.input.map((t, i) => ({ index: i, embedding: vec(t) })) }));
      };
      if (mode === 'slow') setTimeout(go, 600); else go();
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); srv.unref();
  return { srv, log, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}

const SKILL = v => `---\nname: ops\ndescription: Operations notes\n---\n\n# Ops\n\n## Rollback\n\nRevert the release to the previous build when checks fail.${v}\n\n## Billing\n\nInvoices are sent monthly to the finance team.\n`;
function project(text = SKILL('')) {
  const d = mkdtempSync(join(tmpdir(), 'embed-'));
  mkdirSync(join(d, 'skills/ops'), { recursive: true }); writeFileSync(join(d, 'skills/ops/SKILL.md'), text);
  return d;
}
async function nib(cwd, argv, { fetch, stdin, env = {} } = {}, deps = {}) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, stdin: stdin === undefined ? null : Readable.from([stdin]), cwd, env, fetch, nibPath: join(ROOT, 'apps/cli/bin/nib.js') }, deps);
  return { code, out, err };
}
const setup = async (srv, d = project()) => { await nib(d, ['import', 'skills']); const on = await nib(d, ['embed', 'on', '--url', srv.url, '--model', 'fake-1']); assert.equal(on.code, 0, on.err); const b = await nib(d, ['embed', 'build']); assert.equal(b.code, 0, b.err); return d; };
const asks = async (d, q) => JSON.parse((await nib(d, ['ask', q, '--json'])).out);
const refs = j => j.sections.map(s => s.ref);
const hookEvent = (p, cwd) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: p, cwd });

test('[embedding-retriever R1] with no embed.json nothing makes a network request and the output is the BM25 output', async () => {
  const d = project(); await nib(d, ['import', 'skills']);
  const boom = () => { throw new Error('network used'); };
  const a = await nib(d, ['ask', 'monthly invoices'], { fetch: boom }); assert.equal(a.code, 0); assert.equal(a.err, ''); assert.match(a.out, /#billing|Billing/i);
  const j = await asks(d, 'monthly invoices'); assert.equal(j.retriever.name, 'bm25');
  const h = await nib(d, ['hook', 'claude'], { fetch: boom, stdin: hookEvent('monthly invoices to finance', d) }); assert.equal(h.code, 0); assert.equal(h.err, '');
  assert.equal((await nib(d, ['embed', 'status'], { fetch: boom })).out, 'Embeddings are off. nib uses BM25 only.\n');
  assert.ok(!existsSync(join(d, '.nib/embed.json')) && !existsSync(join(d, '.nib/vectors.bin')));
});

test('[embedding-retriever R2] embed on checks the server, records it and says where text goes; off removes it', async () => {
  const s = await server(), d = project(); await nib(d, ['import', 'skills']);
  const on = await nib(d, ['embed', 'on', '--url', s.url, '--model', 'fake-1'], { env: { NIB_EMBED_KEY: 'k' } });
  assert.equal(on.code, 0, on.err); assert.match(on.out, new RegExp(`will be sent to ${s.url.replace(/[.]/g, '\\.')} \\(this machine\\)`)); assert.doesNotMatch(on.out, /Warning/);
  assert.equal(s.log.length, 1); assert.equal(s.log[0].url, '/v1/embeddings'); assert.equal(s.log[0].model, 'fake-1'); assert.ok(Array.isArray(s.log[0].input)); assert.equal(s.log[0].auth, 'Bearer k');
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.nib/embed.json'), 'utf8')), { format: 1, url: s.url, model: 'fake-1' });
  await nib(d, ['embed', 'build']);
  const off = await nib(d, ['embed', 'off']); assert.equal(off.code, 0); assert.ok(!existsSync(join(d, '.nib/embed.json'))); assert.ok(existsSync(join(d, '.nib/vectors.bin')));
  await nib(d, ['embed', 'off', '--delete']); assert.ok(!existsSync(join(d, '.nib/vectors.bin')));
  for (const url of ['ftp://x/y', 'not a url']) assert.equal((await nib(d, ['embed', 'on', '--url', url, '--model', 'm'])).code, 2);
  assert.equal((await nib(d, ['embed', 'on', '--model', 'm'])).code, 2);
  const bad = await server('bad'), d2 = project(); await nib(d2, ['import', 'skills']);
  const r = await nib(d2, ['embed', 'on', '--url', bad.url, '--model', 'm']); assert.equal(r.code, 1); assert.match(r.err, /unexpected shape/); assert.ok(!existsSync(join(d2, '.nib/embed.json')));
  const seen = []; const far = await nib(d2, ['embed', 'on', '--url', 'http://embed.example.test:8080/v1', '--model', 'm'], { fetch: async (u) => { seen.push(u); return { ok: true, json: async () => ({ data: [{ index: 0, embedding: [1, 2] }] }) }; } });
  assert.equal(seen[0], 'http://embed.example.test:8080/v1/embeddings'); assert.match(far.out, /Warning: embed\.example\.test is not this machine/);
  const s2 = await server(), d3 = project(); await nib(d3, ['import', 'skills']);
  const noModel = await nib(d3, ['embed', 'on', '--url', s2.url]); assert.equal(noModel.code, 0, noModel.err); assert.equal('model' in s2.log[0], false, 'no model name is sent when none is given');
  assert.deepEqual(JSON.parse(readFileSync(join(d3, '.nib/embed.json'), 'utf8')), { format: 1, url: s2.url }); assert.equal((await nib(d3, ['embed', 'build'])).code, 0); assert.equal('model' in s2.log.at(-1), false);
  assert.equal((await asks(d3, 'undo the shipment')).retriever.params.model, 'server-default'); await s2.close();
  await Promise.all([s.close(), bad.close()]);
});

test('[embedding-retriever R3] build embeds the windows, reuses unchanged modules and keeps the old index when the server fails', async () => {
  const s = await server(), d = await setup(s);
  const n1 = s.log.length, first = readFileSync(join(d, '.nib/vectors.bin'));
  assert.ok(n1 >= 2); const st = await nib(d, ['embed', 'status']); assert.match(st.out, /Index: 3 modules, 3 windows, 5 dimensions/); assert.match(st.out, /State: current/);
  const again = await nib(d, ['embed', 'build']); assert.match(again.out, /Embedded 0 modules \(0 windows\), reused 3/); assert.equal(s.log.length, n1);
  writeFileSync(join(d, 'skills/ops/SKILL.md'), SKILL(' Page the on-call engineer.')); await nib(d, ['import', 'skills', '--replace', '--no-embed']);
  const part = await nib(d, ['embed', 'build']); assert.match(part.out, /Embedded 1 module \(1 windows\), reused 2/);
  const before = readFileSync(join(d, '.nib/vectors.bin')); assert.notDeepEqual(before, first);
  writeFileSync(join(d, 'skills/ops/SKILL.md'), SKILL(' Page everyone.')); await nib(d, ['import', 'skills', '--replace', '--no-embed']);
  await s.close(); const bad = await server('err'); writeFileSync(join(d, '.nib/embed.json'), JSON.stringify({ format: 1, url: bad.url, model: 'fake-1' }));
  const fail = await nib(d, ['embed', 'build']); assert.equal(fail.code, 1); assert.match(fail.err, /answered 500/); assert.deepEqual(readFileSync(join(d, '.nib/vectors.bin')), before);
  await bad.close();
});

test('[embedding-retriever R3] a window the model refuses as too long is split in halves so no text is lost, counted, and other failures still stop the build', async () => {
  const s = await server('limit'), d = project(`---\nname: ops\ndescription: Ops\n---\n\n# Ops\n\n## Rollback\n\n${'Revert the release now. '.repeat(40)}\n\n## Billing\n\nInvoices are sent monthly.\n`);
  await nib(d, ['import', 'skills']); await nib(d, ['embed', 'on', '--url', s.url]);
  const b = await nib(d, ['embed', 'build']); assert.equal(b.code, 0, b.err); assert.match(b.out, /1 window was too long for the model and was split in halves/); assert.ok(s.log.some(r => r.input.length === 1 && r.input[0].length <= 400)); const idx = (await nib(d, ['embed', 'status'])).out; assert.match(idx, /[4-9] windows/); const tail = s.log.flatMap(r => r.input).filter(t => t.length <= 400 && t.includes('Rollback')); assert.ok(tail.join('').length > 700, 'the whole section was embedded');
  assert.match((await nib(d, ['embed', 'status'])).out, /State: current/); await s.close();
  const e = await server('err'); writeFileSync(join(d, '.nib/embed.json'), JSON.stringify({ format: 1, url: e.url })); writeFileSync(join(d, 'skills/ops/SKILL.md'), SKILL(' Changed.')); await nib(d, ['import', 'skills', '--replace', '--no-embed']);
  const f = await nib(d, ['embed', 'build']); assert.equal(f.code, 1); assert.match(f.err, /answered 500/); await e.close();
});

test('[embedding-retriever R4] with a current index, ask, the hook and MCP search return a section only the embeddings can find', async () => {
  const s = await server(), d = await setup(s);
  const q = 'undo the shipment';
  assert.deepEqual(refs(await asks(await (async () => { const o = project(); await nib(o, ['import', 'skills']); return o; })(), q)), [], 'BM25 alone finds nothing');
  const j = await asks(d, q); assert.ok(j.sections.some(x => x.title === 'Rollback'), refs(j).join()); assert.equal(j.retriever.name, 'bm25+embed'); assert.equal(j.retriever.params.model, 'fake-1'); assert.equal(j.retriever.params.rrfK, 60);
  const h = await nib(d, ['hook', 'claude'], { stdin: hookEvent(q, d) }); assert.equal(h.code, 0); assert.match(h.out, /Revert the release/);
  const rpc = m => JSON.stringify({ jsonrpc: '2.0', id: 1, ...m }) + '\n';
  const m = await nib(d, ['mcp'], { stdin: rpc({ method: 'tools/call', params: { name: 'search', arguments: { query: q } } }) }); assert.match(m.out, /Revert the release/);
  assert.deepEqual(rrf([['a', 'b'], ['b', 'c']]).map(x => x[0]), ['b', 'a', 'c']);
  await s.close();
});

test('[embedding-retriever R5] a down server, a timeout, a bad answer or a stale index falls back to BM25 with a notice and never blocks the hook', async () => {
  const lexical = 'invoices sent monthly';
  const check = async (d, run, re, { hook = false } = {}) => {
    const r = hook ? await nib(d, ['hook', 'claude'], { stdin: hookEvent(lexical, d) }, { hookEmbedTimeoutMs: 100 }) : await nib(d, ['ask', lexical]);
    assert.equal(r.code, 0); assert.match(r.err, re); assert.match(r.out, /Invoices are sent monthly/); if (!hook) assert.equal((await asks(d, lexical)).retriever.name, 'bm25');
  };
  let s = await server(), d = await setup(s); await s.close(); await check(d, 0, /embeddings unavailable \(.*\); used BM25/); await check(d, 0, /used BM25/, { hook: true });
  s = await server('slow'); d = await setup(await server()); writeFileSync(join(d, '.nib/embed.json'), JSON.stringify({ format: 1, url: s.url, model: 'fake-1' }));
  const t0 = Date.now(); await check(d, 0, /no answer within 100 ms/, { hook: true }); assert.ok(Date.now() - t0 < 550); await s.close();
  s = await server('bad'); writeFileSync(join(d, '.nib/embed.json'), JSON.stringify({ format: 1, url: s.url, model: 'fake-1' })); await check(d, 0, /unexpected shape/); await s.close();
  s = await server(); d = await setup(s); writeFileSync(join(d, 'skills/ops/SKILL.md'), SKILL(' Changed.')); await nib(d, ['import', 'skills', '--replace', '--no-embed']);
  await check(d, 0, /out of date; run: nib embed build/); await check(d, 0, /out of date/, { hook: true });
  const n = s.log.length; await nib(d, ['ask', lexical]); assert.equal(s.log.length, n, 'a stale index makes no request'); await s.close();
  const e = project(); await nib(e, ['import', 'skills']); s = await server(); await nib(e, ['embed', 'on', '--url', s.url, '--model', 'fake-1']);
  assert.match((await nib(e, ['ask', lexical])).err, /not built; run: nib embed build/); await s.close();
});

test('[embedding-retriever R6] refs are unchanged and the output names the retriever only when embeddings were used', async () => {
  const s = await server(), d = await setup(s), off = project(); await nib(off, ['import', 'skills']);
  const a = await asks(d, 'monthly invoices'), b = await asks(off, 'monthly invoices');
  assert.equal(a.retriever.name, 'bm25+embed'); assert.equal(b.retriever.name, 'bm25');
  assert.ok(refs(b).every(r => refs(a).includes(r))); assert.ok(refs(a).every(r => /^ops\/ops\/SKILL\.md#m\d+$/.test(r)));
  assert.match((await nib(d, ['ask', 'monthly invoices'])).out, /bm25\+embed/); assert.doesNotMatch((await nib(off, ['ask', 'monthly invoices'])).out, /bm25\+embed/);
  await s.close(); assert.equal((await asks(d, 'monthly invoices')).retriever.name, 'bm25');
});

test('[embedding-retriever R7] the usage and guide state where text is sent, the setup, the cost, the privacy note and the experimental status', () => {
  assert.match(read('apps/cli/src/args.js'), /nib embed on --url URL \[--model NAME\] \| build \| status \| off/);
  const g = read('docs/guide/embeddings.md');
  for (const re of [/experimental/i, /nib embed on --url/, /\/v1\/embeddings/, /not this machine|leaves (the|your) machine/i, /index build|build time/i, /vectors\.bin/, /BM25 stays the default/, /\.\.\/results\.md|results/, /NIB_EMBED_KEY/]) assert.match(g, re);
  assert.match(read('README.md'), /nib embed/); assert.match(read('README.md'), /guide\/embeddings\.md/);
});

test('[embedding-retriever R8] no dependency, no bundled model, and the embed package takes its embedder as a function', () => {
  const pkg = JSON.parse(read('package.json')); assert.equal(pkg.dependencies, undefined); assert.equal(JSON.parse(read('packages/embed/package.json')).skillnib.runtimeNeutral, true);
  assert.ok(!/\bfrom ['"](?!\.)/.test(read('packages/embed/src/index.js')), 'embed imports nothing from outside');
  assert.ok(!/node:/.test(read('packages/embed/src/index.js')));
  const w = windowsOf({ title: 'T', text: ('x'.repeat(100) + '\n').repeat(40) }); assert.ok(w.length > 1 && w.every(x => x.length <= 1800 && x.startsWith('T\n')));
  assert.equal(windowsOf({ title: 'T', text: 'y'.repeat(5000) }).every(x => x.length <= 1800), true);
});

test('[embedding-retriever R9] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  for (const sub of ['lint', 'link']) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), sub, 'docs/specs/embedding-retriever.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
