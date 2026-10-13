#!/usr/bin/env node
// Non-CI. Runs the hook's delivery over every C2 ask on the pinned catalogs and reports the output size.
// Usage: node verify-budget.mjs <researchRoot> <cloudflareSkillsDir> <hyperframesSkillsDir>
//   researchRoot: a checkout of branch v1 (tools/research/c2/tasks-*.json).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { importSkills } from '../../../packages/import/src/index.js';
import { dirReader } from '../../../packages/import/node/index.js';
import { createBm25Retriever, corpusFromCatalog } from '../../../packages/retrieve/src/index.js';
import { catalogEntries, deliverWithin, renderText } from '../../../packages/deliver/src/index.js';

const [root, ...dirs] = process.argv.slice(2), ids = ['c1a', 'c1b'];
const FETCH = 'node /home/user/skillnib/apps/cli/bin/nib.js show <ref> --store /home/user/project/.nib';
for (const [i, id] of ids.entries()) {
  const cat = await importSkills([dirReader(dirs[i])]), entries = catalogEntries(cat), r = await createBm25Retriever(corpusFromCatalog(cat));
  const tasks = JSON.parse(await readFile(join(root, `tools/research/c2/tasks-${id}.json`), 'utf8')).tasks;
  const sizes = [], delivered = [], skipped = [];
  for (const t of tasks) {
    const d = deliverWithin({ entries, identity: r.identity, hits: await r.search(t.ask, { k: 4 }), fetchCommand: FETCH });
    sizes.push(renderText(d, { fetchCommand: FETCH }).length); delivered.push(d.sections.length); skipped.push(d.tooLarge.length);
  }
  sizes.sort((a, b) => a - b);
  console.log(JSON.stringify({ catalog: id, asks: tasks.length, maxChars: sizes.at(-1), median: sizes[sizes.length >> 1], over9500: sizes.filter(s => s > 9500).length, asksWithSkippedSections: skipped.filter(Boolean).length, sectionsDelivered: delivered.reduce((a, b) => a + b, 0), sectionsTooLarge: skipped.reduce((a, b) => a + b, 0) }));
}
