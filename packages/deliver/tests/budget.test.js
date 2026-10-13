import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { importSkills, memoryReader } from '../../import/src/index.js';
import { catalogEntries, deliver, deliverWithin, renderText, renderFailOpenWithin, HOOK_MAX_CHARS } from '../src/index.js';

const section = (title, chars, ch = 'x') => `## ${title}\n${(ch.repeat(60) + '\n').repeat(Math.ceil(chars / 61)).slice(0, chars)}\n`;
async function world(sizes, ch) {
  const text = '---\nname: big\n---\n' + sizes.map((n, i) => section(`Part ${i + 1}`, n, ch)).join('\n');
  const cat = await importSkills([memoryReader({ origin: 'm', files: { 'big/SKILL.md': text } })]);
  const entries = catalogEntries(cat);
  const parts = entries.filter(e => e.title.startsWith('Part '));
  return { entries, parts, identity: { name: 'bm25', version: 1, corpusHash: 'a'.repeat(64) }, hitsFor: refs => refs.map((e, i) => ({ id: e.ref, score: 10 - i, rank: i + 1 })) };
}
const CMD = 'node /abs/nib.js show <ref> --store /abs/.nib';

test('[claude-code-hook R2] output stays within the budget, skips what does not fit for the next ranked section, never edits text, and lists skipped sections', async () => {
  const w = await world([7000, 3000, 2500, 12000]);
  // rank order: Part 4 (12000), Part 3 (2500), Part 1 (7000), Part 2 (3000)
  const d = deliverWithin({ entries: w.entries, identity: w.identity, hits: w.hitsFor([w.parts[3], w.parts[2], w.parts[0], w.parts[1]]), fetchCommand: CMD });
  const text = renderText(d, { fetchCommand: CMD });
  assert.ok(text.length <= HOOK_MAX_CHARS, `${text.length}`);
  assert.deepEqual(d.sections.map(s => s.title), ['Part 3', 'Part 2']); // 12000 never fits; 7000 no longer fits after Part 3; 3000 does
  assert.deepEqual(d.sections.map(s => s.rank), [2, 4]);
  for (const s of d.sections) assert.ok(text.includes(s.text), 'section text is whole');
  assert.match(text, /too large to inject: big\/big\/SKILL\.md#m\d+  Part 4  \d+ B/); assert.match(text, /too large to inject: .*Part 1/);
  assert.equal(d.tooLarge.length, 2);
});

test('[claude-code-hook R2] a property check: random section sizes, ASCII and non-ASCII, always fit and keep text whole', async () => {
  let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  for (let i = 0; i < 60; i++) {
    const sizes = Array.from({ length: 4 }, () => 200 + rnd(14000)), w = await world(sizes, i % 2 ? 'é' : 'x');
    const order = [...w.parts].sort(() => rnd(3) - 1);
    const d = deliverWithin({ entries: w.entries, identity: w.identity, hits: w.hitsFor(order), fetchCommand: CMD });
    const text = renderText(d, { fetchCommand: CMD });
    assert.ok(text.length <= HOOK_MAX_CHARS, `case ${i}: ${text.length}`);
    for (const s of d.sections) assert.ok(text.includes(s.text));
    assert.equal(d.sections.length + d.tooLarge.length, 4);
  }
  const w = await world([20000]);
  const only = deliverWithin({ entries: w.entries, identity: w.identity, hits: w.hitsFor(w.parts), fetchCommand: CMD });
  assert.equal(only.sections.length, 0); assert.match(renderText(only, { fetchCommand: CMD }), /No matching section fits the size limit\./);
});

test('[claude-code-hook R3] the outline names one complete fetch command', async () => {
  const w = await world([500, 600]);
  const text = renderText(deliverWithin({ entries: w.entries, identity: w.identity, hits: w.hitsFor([w.parts[0]]), fetchCommand: CMD }), { fetchCommand: CMD });
  assert.ok(text.includes(`--- Not delivered (fetch one with: ${CMD}) ---`));
  assert.equal(text.split('fetch one with:').length, 2);
});

test('[claude-code-hook R5] the fail-open notice lists skill sources within the budget and counts what does not fit', () => {
  const none = renderFailOpenWithin({ reason: 'no store found' });
  assert.equal(none, 'SkillNib: no sections were selected (no store found).\n');
  const few = renderFailOpenWithin({ reason: 'boom', sources: [{ skill: 'a', source: '/x/a/SKILL.md' }, { skill: 'b', source: 'github:o/r@abc (no local file)' }] });
  assert.match(few, /Read the skill files directly/); assert.match(few, /a {2}\/x\/a\/SKILL\.md\nb {2}github:o\/r@abc/);
  const many = renderFailOpenWithin({ reason: 'boom', sources: Array.from({ length: 800 }, (_, i) => ({ skill: `skill-${i}`, source: `/very/long/path/${'d/'.repeat(20)}skill-${i}/SKILL.md` })) });
  assert.ok(many.length <= HOOK_MAX_CHARS); assert.match(many, /\.\.\. and \d+ more skills\n$/);
});

test('[claude-code-hook R7] header and framing equal the slice 4 delivery when every section fits', async () => {
  const w = await world([400, 500, 600, 700]);
  const hits = w.hitsFor(w.parts), a = renderText(deliver({ entries: w.entries, identity: w.identity, hits })), b = renderText(deliverWithin({ entries: w.entries, identity: w.identity, hits, fetchCommand: CMD }), { fetchCommand: CMD });
  const head = t => t.slice(0, t.indexOf('--- Not delivered'));
  assert.equal(head(b), head(a));
});

test('[claude-code-hook R8] the delivery package stays dependency-free, import-free and I/O-free', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.skillnib.runtimeNeutral, true);
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
    assert.deepEqual([...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]), []);
    assert.ok(!/\bprocess\b|\bBuffer\b|require\(|console\./.test(src));
  }
});
