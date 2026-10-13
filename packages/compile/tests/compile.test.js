import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { compileSkill, verifyManifest, moduleText, LIMIT } from '../src/index.js';

const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');
const join = (m, text) => m.modules.map(x => moduleText(m, text, x.id)).join('');
const kinds = m => m.modules.map(x => x.kind);
const filler = n => 'x'.repeat(n) + '\n';
const compile = text => compileSkill({ path: 'a/SKILL.md', text });

const HAPPY = `---\nname: demo\n---\nintro\n\n## One\n${filler(100)}\n## Two\nlead\n${'### A\n' + filler(3500)}### B\n${filler(3500)}\n## Three\nlast\n`;

// seeded generator of markdown-ish text for property checks
function gen(seed) {
  let s = seed; const r = n => (s = (s * 1103515245 + 12345) & 0x7fffffff) % n;
  const parts = ['## H\n', '### h\n', '#### deep\n', '```\n', '~~~\n', '````\n', '\n', '   \n', 'text é 😀\n', '## in fence?\n', '\r\n', 'no newline'];
  return Array.from({ length: 5 + r(40) }, () => parts[r(parts.length)]).join('');
}

test('[compile-manifest R1] concatenated module texts equal the source exactly', async () => {
  const cases = [HAPPY, HAPPY.replace(/\n/g, '\r\n'), HAPPY.trimEnd(), '\n\n## A\nx\n', 'no headings at all', '## only', 'é😀 ## not heading\n## real\n😀\n', '\n\n  \n## A\n\n\n## B\n  \n'];
  for (let i = 0; i < 300; i++) cases.push(gen(i + 1));
  for (const text of cases) {
    const m = await compile(text);
    if (text.trim() === '') continue;
    assert.equal(join(m, text), text, JSON.stringify(text.slice(0, 60)));
    assert.equal(m.modules[0].start, 0); assert.equal(m.modules.at(-1).end, text.length);
    assert.deepEqual(await verifyManifest(m, text), { ok: true });
  }
});

test('[compile-manifest R2] the same path and text give an identical manifest', async () => {
  const a = await compile(HAPPY), b = await compile(HAPPY);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('[compile-manifest R3] module and source hashes are SHA-256 of the exact text, and equal text gives equal hashes', async () => {
  const text = `## A\nsame\n## B\nsame\n## A\nsame\n`;
  const m = await compile(text);
  assert.equal(m.source.hash, sha(text)); assert.equal(m.source.bytes, Buffer.byteLength(text));
  for (const x of m.modules) assert.equal(x.hash, sha(text.slice(x.start, x.end)));
  const h = await compile('## A\nsame\n## A\nsame\n');
  assert.equal(h.modules[0].hash, h.modules[1].hash);
  assert.match(m.modules[0].hash, /^[0-9a-f]{64}$/);
});

test('[compile-manifest R4] the example file compiles to preamble, h2, h2-lead, h3, h3, h2', async () => {
  const m = await compile(HAPPY);
  assert.deepEqual(kinds(m), ['preamble', 'h2', 'h2-lead', 'h3', 'h3', 'h2']);
  assert.deepEqual(m.modules.map(x => x.title), ['(preamble)', '## One', '## Two', '### A', '### B', '## Three']);
  assert.equal(m.modules[3].parent, '## Two'); assert.equal(m.modules[2].parent, undefined);
  assert.deepEqual(m.segmenter, { name: 'h2-h3', version: 1, limit: 6144 });
  assert.deepEqual(m.modules.map(x => x.id), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
});

test('[compile-manifest R4] headings inside fenced code never start a module, including longer and tilde fences', async () => {
  const text = '## A\n```md\n## not a heading\n### nor this\n```\n~~~\n## still not\n~~~\n````\n```\n## inner\n```\n````\n## B\nz\n';
  const m = await compile(text);
  assert.deepEqual(m.modules.map(x => x.title), ['## A', '## B']);
});

test('[compile-manifest R4] the H3 split limit is measured in UTF-8 bytes, not characters', async () => {
  const wide = 'é'.repeat(2000) + '\n'; // 2000 chars, 4000 bytes
  const text = `## Big\n### A\n${wide}### B\n${wide}`; // ~4000 chars but ~8000 bytes
  assert.ok(text.length < LIMIT && Buffer.byteLength(text) > LIMIT);
  assert.deepEqual(kinds(await compile(text)), ['h2-lead', 'h3', 'h3']);
  const atLimit = '## S\n### H\n' + 'a'.repeat(LIMIT - '## S\n### H\n'.length);
  assert.equal(Buffer.byteLength(atLimit), LIMIT);
  assert.deepEqual(kinds(await compile(atLimit)), ['h2']);
  assert.deepEqual(kinds(await compile(atLimit + 'a')), ['h2-lead', 'h3']);
});

test('[compile-manifest R4] a text without any H2 is one preamble module', async () => {
  assert.deepEqual(kinds(await compile('# Title\nbody\n### h3 only\n')), ['preamble']);
});

test('[compile-manifest R5] no module is empty or whitespace-only; leading whitespace joins the next module', async () => {
  const m = await compile('\n\n  \n## A\nx\n\n\n## B\ny\n');
  assert.deepEqual(kinds(m), ['h2', 'h2']);
  assert.equal(m.modules[0].start, 0);
  for (const x of m.modules) assert.ok(moduleText(m, '\n\n  \n## A\nx\n\n\n## B\ny\n', x.id).trim() !== '');
  for (let i = 0; i < 200; i++) { const t = gen(i + 1000); const c = await compile(t); for (const x of c.modules) assert.ok(t.slice(x.start, x.end).trim() !== ''); }
});

test('[compile-manifest R4 R6] an over-limit section with no H3 stays whole and is flagged; verify requires the flag', async () => {
  const text = '## Big\n' + filler(9000);
  const m = await compile(text);
  assert.equal(m.modules.length, 1); assert.deepEqual(m.modules[0].flags, ['oversize-unsplittable']);
  assert.deepEqual(await verifyManifest(m, text), { ok: true });
  const stripped = structuredClone(m); stripped.modules[0].flags = [];
  const r = await verifyManifest(stripped, text);
  assert.equal(r.ok, false); assert.match(r.problems.join(), /without the oversize-unsplittable flag/);
  assert.deepEqual((await compile('## Small\nx\n')).modules[0].flags, []);
});

test('[compile-manifest R6] verifyManifest detects a changed source, gaps, overlaps and hash mismatches', async () => {
  const m = await compile(HAPPY), ok = await verifyManifest(m, HAPPY);
  assert.deepEqual(ok, { ok: true });
  assert.match((await verifyManifest(m, HAPPY + 'x')).problems.join(), /source text changed/);
  const gap = structuredClone(m); gap.modules[2].start += 1;
  assert.match((await verifyManifest(gap, HAPPY)).problems.join(), /gap before module/);
  const overlap = structuredClone(m); overlap.modules[2].start -= 1;
  assert.match((await verifyManifest(overlap, HAPPY)).problems.join(), /overlaps the previous module/);
  const bad = structuredClone(m); bad.modules[1].hash = '0'.repeat(64);
  assert.match((await verifyManifest(bad, HAPPY)).problems.join(), /m1: hash does not match its slice/);
  const short = structuredClone(m); short.modules.pop();
  assert.match((await verifyManifest(short, HAPPY)).problems.join(), /do not cover the text/);
});

test('[compile-manifest R7] invalid input throws TypeError; empty or whitespace-only files give an empty valid manifest', async () => {
  await assert.rejects(compileSkill({ path: 'a.md', text: 5 }), TypeError);
  await assert.rejects(compileSkill({ text: 'x' }), TypeError);
  await assert.rejects(compileSkill({ path: '', text: 'x' }), TypeError);
  await assert.rejects(compileSkill(null), TypeError);
  await assert.rejects(compileSkill({ path: 'a.md', text: 'x' }).then(() => verifyManifest({}, 5)), TypeError);
  assert.throws(() => moduleText({ modules: [], source: { path: 'a.md' } }, '', 'm9'), RangeError);
  for (const text of ['', '\n\n  \n']) {
    const m = await compile(text);
    assert.deepEqual(m.modules, []); assert.deepEqual(await verifyManifest(m, text), { ok: true });
  }
});

test('[compile-manifest R8] the package has no dependencies and its src imports nothing outside the language runtime', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.skillnib.runtimeNeutral, true);
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
    const specs = [...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    for (const s of specs) assert.ok(s.startsWith('./'), `${f} imports "${s}"`);
  }
});
