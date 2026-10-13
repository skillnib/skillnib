import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { importSkills, memoryReader } from '../../import/src/index.js';
import { createBm25Retriever, corpusFromCatalog } from '../../retrieve/src/index.js';
import { catalogEntries, deliver, failOpen, renderText, renderList, findEntry } from '../src/index.js';

const kv = '---\nname: storage\n---\nintro\n\n## KV namespaces\nBind a KV namespace in wrangler config.\r\nSecond line.\n\n## Queues\nQueues deliver messages.\n\n## Durable objects\nStateful coordination.\n';
const other = '---\nname: email\n---\nintro\n\n## Sending\nSend email with a binding.\n';
const catalog = () => importSkills([memoryReader({ origin: 'm', files: { 'storage/SKILL.md': kv, 'storage/refs/d1.md': '## D1\nSQL database binding.\n', 'email/SKILL.md': other } })]);
const run = async (ask, opts = {}) => {
  const cat = await catalog(), entries = catalogEntries(cat), r = await createBm25Retriever(corpusFromCatalog(cat));
  return { cat, entries, r, d: deliver({ entries, identity: r.identity, hits: await r.search(ask, { k: opts.k ?? 2 }), outlineLines: opts.outlineLines }) };
};

test('[tap-cli R3] sections are delivered in rank order with the framing and a header naming the retriever and bytes', async () => {
  const { d, r } = await run('bind a KV namespace and queues messages');
  assert.deepEqual(d.sections.map(s => [s.title, s.rank]), [['KV namespaces', 1], ['Queues', 2]]);
  const text = renderText(d);
  assert.match(text, new RegExp(`^SkillNib bm25 v1 \\(corpus ${r.identity.corpusHash.slice(0, 8)}\\): 2 sections, ${d.bytes.sections} bytes\n`));
  assert.ok(text.includes('===== storage/storage/SKILL.md :: KV namespaces ====='));
  assert.ok(text.indexOf('KV namespaces =====') < text.indexOf('Queues ====='));
  assert.equal((await run('bind a KV namespace and queues messages', { k: 1 })).d.sections.length, 1);
  assert.match(renderText((await run('bind a KV namespace', { k: 1 })).d), /^SkillNib bm25 v1 \(corpus \w{8}\): 1 section, /);
});

test('[tap-cli R4] delivered text equals the source slice byte for byte, including CRLF', async () => {
  const { d, cat } = await run('bind a KV namespace in wrangler config');
  const file = cat.skills[1].files.find(f => f.path === 'storage/SKILL.md') ?? cat.skills.flatMap(s => s.files).find(f => f.path === 'storage/SKILL.md');
  const sec = d.sections.find(s => s.title === 'KV namespaces');
  assert.ok(sec.text.includes('\r\n'));
  assert.ok(file.text.includes(sec.text));
  assert.equal(sec.text, file.text.slice(file.text.indexOf('## KV namespaces'), file.text.indexOf('## Queues')));
  assert.ok(renderText(d).includes(sec.text));
});

test('[tap-cli R5] the outline lists undelivered modules of delivered skills with ids and sizes, names other skills, is capped, and has no module text', async () => {
  const { d, entries } = await run('bind a KV namespace in wrangler config', { k: 1 });
  const text = renderText(d), outline = text.slice(text.indexOf('--- Not delivered'));
  assert.match(outline, /storage\n/); assert.match(outline, /storage\/storage\/SKILL\.md#m\d+  Queues  \d+ B/); assert.match(outline, /storage\/storage\/refs\/d1\.md#m0  D1  \d+ B/);
  assert.match(outline, /Other skills: email/);
  assert.ok(!outline.includes('Queues deliver messages') && !outline.includes('SQL database binding'));
  assert.ok(!outline.includes(`${d.sections[0].ref}  `)); // the delivered module is not listed as undelivered
  const capped = await run('bind a KV namespace in wrangler config', { k: 1, outlineLines: 3 });
  assert.equal(capped.d.outline.lines.length, 3); assert.equal(capped.d.outline.cut, true);
  assert.match(renderText(capped.d), /\.\.\. \d+ more lines? not shown/);
  assert.ok(entries.length >= 6);
});

test('[tap-cli R6] no hits, a missing catalog, or a failure produce a marked notice and an outline of all skills when readable', async () => {
  const { entries, r } = await run('anything');
  const none = deliver({ entries, identity: r.identity, hits: [] });
  assert.equal(none.failOpen.reason, 'no module matched the ask');
  const text = renderText(none);
  assert.match(text, /^SkillNib: no sections were selected \(no module matched the ask\)\. Load the skills normally\./);
  assert.match(text, /--- Skills in the catalog ---\nemail  1 file  2 modules|storage  2 files/);
  assert.equal(none.sections.length, 0);
  const unreadable = failOpen({ reason: 'no store found' });
  assert.deepEqual(unreadable.outline.lines, []); assert.ok(!renderText(unreadable).includes('--- Skills in the catalog ---'));
  assert.throws(() => deliver({ entries, identity: r.identity, hits: [{ id: 'nope', score: 1, rank: 1 }] }), /not in the catalog/);
});

test('[tap-cli R7] the JSON form carries format, identity, hits, sections with text and the outline', async () => {
  const { d } = await run('bind a KV namespace in wrangler config');
  const j = JSON.parse(JSON.stringify(d));
  assert.equal(j.format, 1); assert.equal(j.retriever.name, 'bm25'); assert.ok(j.hits.length && j.sections[0].text && Array.isArray(j.outline.lines)); assert.equal(j.failOpen, null);
});

test('[tap-cli R4] findEntry resolves an outline ref to the same verbatim text, and list renders every skill', async () => {
  const { d, entries } = await run('bind a KV namespace in wrangler config');
  assert.equal(findEntry(entries, d.sections[0].ref).text, d.sections[0].text);
  assert.equal(findEntry(entries, 'nope#m9'), null);
  assert.match(renderList(entries), /^email  1 file  2 modules\n/m);
});

test('[tap-cli R8] @skillnib/deliver has no dependencies, imports nothing, and does no I/O', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.skillnib.runtimeNeutral, true);
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
    assert.deepEqual([...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]), [], `${f} must not import`);
    assert.ok(!/\bprocess\b|\bBuffer\b|require\(|console\./.test(src), `${f} uses runtime globals`);
  }
});
