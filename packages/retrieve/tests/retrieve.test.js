import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createBm25Retriever, corpusFromCatalog, tokenize, STOPWORDS } from '../src/index.js';
import { importSkills, memoryReader } from '../../import/src/index.js';

const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');
const item = (id, title, text) => ({ id, title, text, hash: sha(text) });
const small = () => [item('d1', 'Alpha', 'beta beta gamma'), item('d2', 'Beta', 'delta'), item('d3', 'Gamma', 'alpha')];
const fixture = JSON.parse(readFileSync(new URL('../fixtures/research-equivalence.json', import.meta.url), 'utf8'));

test('[bm25-retriever R1] rankings and scores equal the research implementation on real C2 asks over excerpts of both catalogs', async () => {
  let asks = 0;
  for (const [id, cat] of Object.entries(fixture.catalogs)) {
    const r = await createBm25Retriever(cat.modules.map(m => ({ ...m, hash: sha(m.text) })));
    for (const a of cat.asks) {
      const hits = await r.search(a.ask, { k: 10 });
      assert.deepEqual(hits.map(h => h.id), a.top.map(t => t.id), `${id}: ${a.ask.slice(0, 60)}`);
      hits.forEach((h, i) => assert.ok(Math.abs(h.score - a.top[i].score) < 5e-10, `${id} rank ${i + 1} score`));
      asks++;
    }
  }
  assert.ok(asks >= 30, `only ${asks} asks`);
});

test('[bm25-retriever R2] tokenization: lowercase, separators outside a-z0-9, minimum length 2, fixed stopwords, no stemming', () => {
  assert.deepEqual(tokenize('The Quick-brown fox_9, x é Wrangler.toml KVs'), ['quick', 'brown', 'fox', 'wrangler', 'toml', 'kvs']);
  assert.deepEqual(tokenize('running runs run'), ['running', 'runs', 'run']);
  assert.equal(STOPWORDS.length, 47); assert.equal(sha([...STOPWORDS].sort().join('\n')), '1f6cf118943ee004deb34dfa7cf4bf761f0fda1c055dbc476a0cc943a805e2cb'); // the research list, pinned
  assert.deepEqual(tokenize('to be or not to be'), ['not']);
});

test('[bm25-retriever R2] scores follow the formula with k1 1.2 and b 0.75 on a hand-computed corpus; duplicate query tokens count once', async () => {
  const r = await createBm25Retriever(small());
  // docs (title + text tokens): d1 alpha beta beta gamma (4), d2 beta delta (2), d3 gamma alpha (2); N 3, avg 8/3
  const avg = 8 / 3, idf = n => Math.log(1 + (3 - n + 0.5) / (n + 0.5));
  const term = (n, f, len) => idf(n) * f * 2.2 / (f + 1.2 * (1 - 0.75 + 0.75 * len / avg));
  const hits = await r.search('beta beta');
  assert.deepEqual(hits.map(h => h.id), ['d1', 'd2']);
  assert.ok(Math.abs(hits[0].score - term(2, 2, 4)) < 1e-12); assert.ok(Math.abs(hits[1].score - term(2, 1, 2)) < 1e-12);
  const two = await r.search('alpha gamma');
  assert.ok(Math.abs(two.find(h => h.id === 'd1').score - (term(2, 1, 4) + term(2, 1, 4))) < 1e-12);
  assert.deepEqual(await r.search('beta'), await r.search('beta beta beta'));
});

test('[bm25-retriever R3] results sort by score then corpus order, are limited by k, exclude zero scores and respect minScore', async () => {
  const r = await createBm25Retriever([item('a', 'T', 'same words'), item('b', 'T', 'same words'), item('c', 'T', 'same words'), item('z', 'T', 'unrelated')]);
  const all = await r.search('words', { k: 10 });
  assert.deepEqual(all.map(h => [h.id, h.rank]), [['a', 1], ['b', 2], ['c', 3]]); // tie broken by corpus order; zero-score z excluded
  assert.deepEqual((await r.search('words', { k: 2 })).map(h => h.id), ['a', 'b']);
  assert.equal((await r.search('words')).length, 3); // default k is 4
  assert.deepEqual(await r.search('words', { k: 10, minScore: 1e9 }), []);
  assert.deepEqual(await r.search('words', { k: 2 }), await r.search('words', { k: 2 }));
  const ranked = await (await createBm25Retriever(small())).search('alpha beta gamma delta', { k: 10 });
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score);
});

test('[bm25-retriever R4] identity records name, version, parameters, stopword hash and a corpus hash that tracks ids and hashes', async () => {
  const a = await createBm25Retriever(small()), b = await createBm25Retriever(small());
  assert.deepEqual(a.identity, b.identity);
  assert.deepEqual({ name: a.identity.name, version: a.identity.version, k1: a.identity.params.k1, b: a.identity.params.b }, { name: 'bm25', version: 1, k1: 1.2, b: 0.75 });
  assert.match(a.identity.params.stopwordsHash, /^[0-9a-f]{64}$/); assert.match(a.identity.corpusHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(a.identity), JSON.stringify(JSON.parse(JSON.stringify(a.identity))));
  const changedText = small(); changedText[1] = item('d2', 'Beta', 'delta changed');
  const renamed = small(); renamed[1] = { ...renamed[1], id: 'd2x' };
  assert.notEqual((await createBm25Retriever(changedText)).identity.corpusHash, a.identity.corpusHash);
  assert.notEqual((await createBm25Retriever(renamed)).identity.corpusHash, a.identity.corpusHash);
  const titleOnly = small(); titleOnly[0] = { ...titleOnly[0], title: 'Other' }; // title is not part of the content hash
  assert.equal((await createBm25Retriever(titleOnly)).identity.corpusHash, a.identity.corpusHash);
});

test('[bm25-retriever R5] empty corpus, ask without usable tokens, and invalid input', async () => {
  const empty = await createBm25Retriever([]);
  assert.deepEqual(await empty.search('anything'), []);
  const r = await createBm25Retriever(small());
  assert.deepEqual(await r.search('the and of'), []); assert.deepEqual(await r.search(''), []);
  await assert.rejects(createBm25Retriever('nope'), TypeError);
  await assert.rejects(createBm25Retriever([{ id: 'x', title: 't', text: 5, hash: 'h' }]), TypeError);
  await assert.rejects(createBm25Retriever([item('dup', 't', 'a'), item('dup', 't', 'b')]), /duplicate module id in corpus: dup/);
  await assert.rejects(r.search(7), TypeError);
  for (const k of [0, -1, 1.5, '4', NaN]) await assert.rejects(r.search('beta', { k }), TypeError);
  await assert.rejects(r.search('beta', { minScore: 'x' }), TypeError);
});

test('[bm25-retriever R6] the catalog adapter yields one verbatim item per module, unique ids and manifest hashes, and hits resolve to module text', async () => {
  const skillA = '---\nname: wrangler\n---\nintro\n\n## KV namespaces\nBind a KV namespace in wrangler config.\n\n## Queues\nQueues deliver messages.\n';
  const catalog = await importSkills([memoryReader({ origin: 'm', files: { 'wrangler/SKILL.md': skillA, 'wrangler/refs/d1.md': '## D1\nSQL database binding.\n' } })]);
  const corpus = corpusFromCatalog(catalog);
  const files = catalog.skills.flatMap(s => s.files);
  assert.equal(corpus.length, files.reduce((n, f) => n + f.manifest.modules.length, 0));
  assert.equal(new Set(corpus.map(c => c.id)).size, corpus.length);
  for (const f of files) {
    const mine = corpus.filter(c => c.id.startsWith(`wrangler/${f.path}#`));
    assert.equal(mine.map(c => c.text).join(''), f.text);
    mine.forEach((c, i) => assert.equal(c.hash, f.manifest.modules[i].hash));
  }
  const hits = await (await createBm25Retriever(corpus)).search('bind a KV namespace in wrangler config', { k: 2 });
  assert.match(corpus.find(c => c.id === hits[0].id).text, /^## KV namespaces/);
  assert.throws(() => corpusFromCatalog({}), TypeError);
});

test('[bm25-retriever R7] any object with the Retriever shape can replace the BM25 retriever', async () => {
  const firstK = { identity: { name: 'first-k', version: 1 }, async search(_ask, { k = 4 } = {}) { return ['x', 'y', 'z'].slice(0, k).map((id, i) => ({ id, score: 1, rank: i + 1 })); } };
  const run = async (retriever, ask) => ({ by: retriever.identity.name, ids: (await retriever.search(ask, { k: 2 })).map(h => h.id) });
  assert.deepEqual(await run(firstK, 'q'), { by: 'first-k', ids: ['x', 'y'] });
  assert.deepEqual(await run(await createBm25Retriever(small()), 'beta'), { by: 'bm25', ids: ['d1', 'd2'] });
});

test('[bm25-retriever R8] the package has no dependencies and its src imports nothing outside the language runtime', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.skillnib.runtimeNeutral, true);
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
    for (const m of src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) assert.ok(m[1].startsWith('./'), `${f} imports "${m[1]}"`);
  }
});
