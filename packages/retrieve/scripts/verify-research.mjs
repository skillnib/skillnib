#!/usr/bin/env node
// Non-CI. Compares this retriever with the research implementation on the FULL pinned catalogs for every C2 ask.
// Usage: node verify-research.mjs <researchRoot>
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createBm25Retriever } from '../src/index.js';

const root = resolve(process.argv[2]);
const { corpus, bm25Index, rank } = await import(pathToFileURL(join(root, 'tools/research/c1/retrieval/common.mjs')));
let asks = 0, mismatches = 0, maxDiff = 0;
for (const id of ['c1a', 'c1b']) {
  const secs = await corpus(id), bm = bm25Index(secs, 0);
  const r = await createBm25Retriever(secs.map(s => ({ id: s.id, title: s.title, text: s.text, hash: s.id })));
  for (const t of JSON.parse(await readFile(join(root, `tools/research/c2/tasks-${id}.json`), 'utf8')).tasks) {
    asks++;
    const sc = bm(t.ask), want = rank(sc).filter(i => sc[i] > 0).slice(0, 10), got = await r.search(t.ask, { k: 10 });
    if (JSON.stringify(want.map(i => secs[i].id)) !== JSON.stringify(got.map(h => h.id))) { mismatches++; continue; }
    got.forEach((h, j) => { maxDiff = Math.max(maxDiff, Math.abs(h.score - sc[want[j]])); });
  }
}
console.log(JSON.stringify({ asks, orderMismatches: mismatches, maxScoreDifference: maxDiff }));
process.exit(mismatches || maxDiff > 1e-9 ? 1 : 0);
