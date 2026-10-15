import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const region = (t, k) => new RegExp(`<!-- measured:${k} -->\\n([\\s\\S]*?)\\n<!-- /measured:${k} -->`).exec(t)?.[1];
const R5 = 'docs/research/R5-embedding-ablation.md';

test('[public-pages R1] the site config enables the plugins, the three pages exist, the index links the guides and every relative link resolves', () => {
  const cfg = read('docs/_config.yml'); assert.match(cfg, /^theme: /m); assert.match(cfg, /jekyll-optional-front-matter/); assert.match(cfg, /jekyll-relative-links/);
  const index = read('docs/index.md');
  for (const g of ['claude-code', 'mcp', 'importing', 'examples']) assert.ok(index.includes(`(guide/${g}.md)`), g);
  assert.ok(index.includes('(results.md)') && index.includes('(plans.md)'));
  for (const f of ['docs/index.md', 'docs/results.md', 'docs/plans.md']) for (const m of read(f).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) { if (/^https?:/.test(m[1])) continue; assert.ok(existsSync(resolve(ROOT, 'docs', m[1])), `${f}: ${m[1]}`); }
});

test('[public-pages R2] the three measured regions are copied word for word from the README', () => {
  const readme = read('README.md'), page = read('docs/results.md');
  for (const k of ['c2', 'c3', 'c3b']) { const r = region(readme, k); assert.ok(r && r.length > 200, k); assert.ok(page.includes(r), `region ${k} differs`); }
});

test('[public-pages R3] the embedding table equals the R5 results table', { skip: !existsSync(join(ROOT, R5)) }, () => {
  const doc = read(R5), table = doc.slice(doc.indexOf('| Set | Catalog'), doc.indexOf('\n\nMean delivered characters'));
  assert.ok(table.startsWith('| Set | Catalog') && table.split('\n').length === 8); assert.ok(read('docs/results.md').includes(table));
});

test('[public-pages R4] the results page adds no figures beyond the copied ones and the allowed set, has the limits section and says the records are not published', () => {
  let t = read('docs/results.md');
  for (const k of ['c2', 'c3', 'c3b']) t = t.replace(region(read('README.md'), k), '');
  t = t.replace(/\| Set \| Catalog[\s\S]*?\n\n/, '').replace(/\(\w[^)]*\)/g, m => /^\(\d/.test(m) ? m : '').replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '').replace(/\b(?:BM25|R5|R6b|C2|C3b?)\b/g, '').replace(/[a-z0-9-]*\d[a-z0-9-]*\.md/g, '');
  const nums = [...new Set((t.match(/[-+]?\d+(?:\.\d+)?%?/g) ?? []))].sort();
  const allowed = ['-0.3', '-1.1', '+8.3', '+13.3', '1', '2', '3', '4', '8', '89', '87', '81', '46', '31', '101', '232', '7', '95%', '5', '1.', '2.', '3.'].sort();
  assert.deepEqual(nums.filter(n => !allowed.includes(n)), []);
  assert.match(read('docs/results.md'), /^## Where it does not help/m); assert.match(read('docs/results.md'), /raw records are not published|records[^.]*are not published yet/i);
});

test('[public-pages R5] the roadmap states the embedding retriever as optional, opt-in, local, BM25 default and fallback, shipped only after a published test; no dates or comparatives', () => {
  const t = read('docs/plans.md');
  for (const need of ['optional', 'opt-in', 'BM25 stays the default', 'local OpenAI-compatible embedding server', 'falls back to BM25', 'pre-registered', 'including where it does not help']) assert.ok(t.includes(need), need);
  assert.doesNotMatch(t, /\b20\d\d\b/); assert.doesNotMatch(t, /\b(better|faster|cheaper|Q[1-4])\b/i);
});

test('[public-pages R6] the README links the results page and the roadmap', () => {
  const r = read('README.md'); assert.ok(r.includes('https://skillnib.github.io/skillnib/results')); assert.ok(r.includes('https://skillnib.github.io/skillnib/plans'));
});

test('[public-pages R7] the pages are exported but not part of the npm package', () => {
  const pkg = JSON.parse(read('package.json')); assert.ok(pkg.files.includes('docs/guide')); assert.ok(!pkg.files.some(f => /^docs\/(index|results|plans|_config)/.test(f)) && !pkg.files.includes('docs'));
  if (existsSync(join(ROOT, 'tools/release/export-ignore'))) assert.ok(!read('tools/release/export-ignore').split('\n').some(l => /^docs\/(index|results|plans|_config)/.test(l) || l === 'docs'));
});

test('[public-pages R8] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  for (const sub of ['lint', 'link']) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), sub, 'docs/specs/public-pages.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
