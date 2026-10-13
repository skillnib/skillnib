#!/usr/bin/env node
// Non-CI. Regenerates fixtures/research-equivalence.json from the research implementation on branch v1.
// Usage: node gen-fixture.mjs <researchRoot> [out]
//   researchRoot: a checkout of branch v1 (contains tools/research), with the pinned catalogs checked out where the research code expects them.
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const out = process.argv[3] ?? new URL('../fixtures/research-equivalence.json', import.meta.url).pathname;
const { corpus, bm25Index, rank } = await import(pathToFileURL(join(root, 'tools/research/c1/retrieval/common.mjs')));
const { readFile } = await import('node:fs/promises');
const PER_CATALOG = 45, MIN_POSITIVE = 10;
const fixture = { source: 'tools/research/c1/retrieval/common.mjs (branch v1): bm25Index(sections, 0) and rank()', catalogs: {} };
for (const id of ['c1a', 'c1b']) {
  const all = await corpus(id), pick = all.filter(s => s.bytes >= 400 && s.bytes <= 3000);
  const step = Math.floor(pick.length / PER_CATALOG), secs = Array.from({ length: PER_CATALOG }, (_, i) => pick[i * step]);
  const bm = bm25Index(secs, 0), tasks = JSON.parse(await readFile(join(root, `tools/research/c2/tasks-${id}.json`), 'utf8')).tasks;
  const asks = [];
  for (const t of tasks) {
    const sc = bm(t.ask);
    if (sc.filter(x => x > 0).length < MIN_POSITIVE) continue;
    asks.push({ ask: t.ask, top: rank(sc).slice(0, 10).map(i => ({ id: secs[i].id, score: sc[i] })) });
  }
  fixture.catalogs[id] = { modules: secs.map(({ id, title, text }) => ({ id, title, text })), asks: asks.slice(0, 25) };
}
await writeFile(out, JSON.stringify(fixture, null, 1));
console.log(Object.fromEntries(Object.entries(fixture.catalogs).map(([k, v]) => [k, { modules: v.modules.length, asks: v.asks.length }])), out);
