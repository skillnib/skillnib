import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importSkills, memoryReader, githubReader, isPinnedRef, sourceOfSkill, deriveSources, mergeImport, diffSkill, refreshSource, removeSources, matchesQuery, resolveNames, conflictsOf, sourceAtCommit, unchangedSources } from '../src/index.js';
import { fakeFetch, SHA } from './helpers.js';

const SHA2 = 'b'.repeat(40);
const skill = (name, body = 'text') => `---\nname: ${name}\ndescription: d\n---\nintro\n\n## Use\n${body}\n\n## Other\nmore ${name}\n`;
const dir = (origin, files) => importSkills([memoryReader({ kind: 'dir', origin, files })]);
const gh = async (files, opts = {}) => { const world = { repos: { 'acme/skills': { refs: { HEAD: SHA, v1: SHA, [SHA.slice(0, 7)]: SHA }, files } } }; return { world, cat: await importSkills([githubReader(opts.input ?? 'acme/skills/skills', { fetch: fakeFetch(world), token: '' })]) }; };

test('[sources-update R2] a ref is pinned only when it is a commit hash; sources are derived from provenance with namespace, ref and commit', async () => {
  for (const [ref, pinned] of [['c430dd9', true], [SHA, true], ['main', false], ['v1', false], ['deadbee1x', false], [null, false], ['abc12', false]]) assert.equal(isPinnedRef(ref), pinned, String(ref));
  const { cat } = await gh({ 'skills/alpha/SKILL.md': skill('alpha'), 'skills/beta/SKILL.md': skill('beta') });
  const [src] = deriveSources(cat);
  assert.deepEqual({ kind: src.kind, location: src.location, ref: src.ref, pinned: src.pinned, commits: src.commits }, { kind: 'github', location: 'acme/skills/skills', ref: null, pinned: false, commits: [SHA] });
  assert.deepEqual(src.skills.map(s => s.id), ['alpha', 'beta']);
  const local = deriveSources(await dir('/p/team', { 'a/SKILL.md': skill('a') }))[0];
  assert.deepEqual({ kind: local.kind, location: local.location, pinned: local.pinned }, { kind: 'dir', location: '/p/team', pinned: null });
  assert.equal(deriveSources(mergeImport(cat, await dir('/p/team', { 'a/SKILL.md': skill('a') }))).length, 2);
});

test('[sources-update R1] merging replaces only the skills of the sources that were imported again and reports conflicts', async () => {
  const a = await dir('/p/a', { 'one/SKILL.md': skill('one'), 'two/SKILL.md': skill('two') }), b = await dir('/p/b', { 'three/SKILL.md': skill('three') });
  const store = mergeImport(a, b);
  assert.deepEqual(store.skills.map(s => s.id), ['one', 'three', 'two']);
  const a2 = await dir('/p/a', { 'one/SKILL.md': skill('one', 'changed') });
  const next = mergeImport(store, a2);
  assert.deepEqual(next.skills.map(s => s.id), ['one', 'three']); // two is gone from /p/a, three untouched
  assert.equal(JSON.stringify(next.skills.find(s => s.id === 'three')), JSON.stringify(store.skills.find(s => s.id === 'three')));
  assert.match(next.skills.find(s => s.id === 'one').files[0].text, /changed/);
  const clash = mergeImport(store, await dir('/p/c', { 'x/SKILL.md': skill('three') }));
  assert.deepEqual(clash.conflicts.map(c => c.id), ['three']); assert.equal(clash.skills.filter(s => s.id === 'three').length, 2);
  assert.deepEqual(conflictsOf([]), []);
});

test('[sources-update R7] the module diff keys modules by file, title and hash, and the report lists added, removed and changed titles', async () => {
  const v1 = (await dir('/p', { 'a/SKILL.md': skill('a') })).skills[0];
  const same = (await dir('/p', { 'a/SKILL.md': skill('a') })).skills[0];
  assert.equal(diffSkill(v1, same).same, true);
  const v2 = (await dir('/p', { 'a/SKILL.md': skill('a', 'new body').replace('## Other\nmore a', '## Extra\nmore') })).skills[0];
  const d = diffSkill(v1, v2);
  assert.deepEqual({ added: d.added, removed: d.removed, changed: d.changed, same: d.same }, { added: ['## Extra'], removed: ['## Other'], changed: ['## Use'], same: false });
  const dup = (await dir('/p', { 'a/SKILL.md': '## T\nx\n## T\ny\n' })).skills[0], dup2 = (await dir('/p', { 'a/SKILL.md': '## T\nx\n## T\nz\n' })).skills[0];
  assert.deepEqual(diffSkill(dup, dup2).changed, ['## T']);
});

test('[sources-update R4] refreshing a source replaces changed skills, adds new ones, flags vanished ones and removes them only with prune', async () => {
  const old = await dir('/p/a', { 'one/SKILL.md': skill('one'), 'two/SKILL.md': skill('two'), 'old/SKILL.md': skill('old') }), key = deriveSources(old)[0].key;
  const fresh = await dir('/p/a', { 'one/SKILL.md': skill('one', 'changed'), 'two/SKILL.md': skill('two'), 'new/SKILL.md': skill('new') });
  const r = refreshSource({ catalog: old, sourceKey: key, fresh });
  assert.deepEqual(r.report.changed.map(c => c.id), ['one']); assert.deepEqual(r.report.unchanged, ['two']); assert.deepEqual(r.report.added, ['new']); assert.deepEqual(r.report.gone, ['old']);
  assert.deepEqual(r.catalog.skills.map(s => s.id), ['new', 'old', 'one', 'two']);
  const p = refreshSource({ catalog: old, sourceKey: key, fresh, prune: true });
  assert.deepEqual(p.report.pruned, ['old']); assert.deepEqual(p.catalog.skills.map(s => s.id), ['new', 'one', 'two']);
});

test('[sources-update R5] a skill-limited refresh touches only the named skills and does not add or prune', async () => {
  const old = await dir('/p/a', { 'one/SKILL.md': skill('one'), 'two/SKILL.md': skill('two') }), key = deriveSources(old)[0].key;
  const fresh = await dir('/p/a', { 'one/SKILL.md': skill('one', 'changed'), 'two/SKILL.md': skill('two', 'changed too'), 'new/SKILL.md': skill('new') });
  const r = refreshSource({ catalog: old, sourceKey: key, fresh, only: new Set(['one']) }), by = id => r.catalog.skills.find(s => s.id === id);
  assert.match(by('one').files[0].text, /changed/); assert.ok(!/changed too/.test(by('two').files[0].text)); assert.equal(by('new'), undefined);
  assert.equal(JSON.stringify(by('two')), JSON.stringify(old.skills.find(s => s.id === 'two')));
  assert.deepEqual(r.report.changed.map(c => c.id), ['one']);
});

test('[sources-update R5] names resolve to skills by exact id and to sources by location; ambiguous and unknown names are reported', async () => {
  const a = await dir('/work/cloudflare-skills', { 'wrangler/SKILL.md': skill('wrangler'), 'kv/SKILL.md': skill('kv') }), b = await dir('/work/team-skills', { 'kv/SKILL.md': skill('kv'), 'sql/SKILL.md': skill('sql') });
  const store = { skills: [...a.skills, ...b.skills], skipped: [], conflicts: [] };
  const r = resolveNames(store, ['wrangler', 'sql', 'cloudflare', 'kv', 'nothing', 'skills']);
  assert.deepEqual(r.targets.map(t => [t.name, t.kind]), [['wrangler', 'skill'], ['sql', 'skill'], ['cloudflare', 'source']]);
  assert.deepEqual(r.unknown, ['nothing']); assert.deepEqual(r.ambiguous.map(x => x.name), ['kv', 'skills']);
  assert.match(r.ambiguous[0].candidates.join(), /kv \(\/work\/cloudflare-skills\).*kv \(\/work\/team-skills\)/);
  assert.equal(resolveNames(store, ['/work/team-skills']).targets[0].kind, 'source');
});

test('[sources-update R6] removing a source removes all of its skills and leaves the others untouched', async () => {
  const a = await dir('/p/a', { 'one/SKILL.md': skill('one') }), b = await dir('/p/b', { 'two/SKILL.md': skill('two') });
  const store = mergeImport(a, b), { catalog, removed } = removeSources(store, [deriveSources(store).find(s => s.location === '/p/a').key]);
  assert.deepEqual(removed.map(s => s.id), ['one']); assert.deepEqual(catalog.skills.map(s => s.id), ['two']);
});

test('[sources-update R3] a query matches skill names, ids and source locations (the namespace) ignoring case', async () => {
  const { cat } = await gh({ 'skills/wrangler/SKILL.md': skill('wrangler'), 'skills/kv-store/SKILL.md': skill('kv-store') });
  const [k, w] = cat.skills; // sorted by id
  for (const [q, yes] of [['wrang', [true, false]], ['KV', [false, true]], ['acme', [true, true]], ['acme/skills', [true, true]], ['skills/skills', [true, true]], ['nomatch', [false, false]]]) assert.deepEqual([matchesQuery(w, q), matchesQuery(k, q)], yes, q);
  assert.equal(sourceOfSkill(w).location, 'acme/skills/skills');
});

test('[sources-update R10] the source logic is pure: no imports from node, no I/O, no process', () => {
  const src = readFileSync(new URL('../src/sources.js', import.meta.url), 'utf8');
  assert.deepEqual([...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]), []);
  assert.ok(!/\bprocess\b|\bBuffer\b|require\(|console\.|node:/.test(src));
  void SHA2;
});

test('[sources-update R5] the same repository at two refs gives distinguishable candidates, and --from picks one source', async () => {
  const files = { 'skills/wrangler/SKILL.md': skill('wrangler'), 'skills/kv/SKILL.md': skill('kv') };
  const { cat: latest } = await gh(files), { cat: pinned } = await gh(files, { input: `acme/skills/skills@${SHA.slice(0, 7)}` });
  const store = mergeImport(latest, pinned);
  assert.equal(deriveSources(store).length, 2);
  const amb = resolveNames(store, ['wrangler']);
  assert.deepEqual(amb.ambiguous[0].candidates, ['wrangler (acme/skills/skills, default branch)', `wrangler (acme/skills/skills@${SHA.slice(0, 7)})`]);
  const a = resolveNames(store, ['wrangler', 'kv'], { from: `acme/skills/skills@${SHA.slice(0, 7)}` }), b = resolveNames(store, ['wrangler'], { from: 'acme/skills/skills' });
  assert.deepEqual(a.targets.map(t => [t.skillId, t.sourceKey.endsWith(SHA.slice(0, 7))]), [['wrangler', true], ['kv', true]]);
  assert.equal(b.targets[0].sourceKey.endsWith('@'), true); assert.deepEqual([a.unknown, a.ambiguous], [[], []]);
  assert.deepEqual(resolveNames(store, ['acme/skills/skills']).targets.map(t => [t.kind, t.sourceKey.endsWith('@')]), [['source', true]]); // the exact label wins over the pinned one
  assert.deepEqual(resolveNames(store, ['wrangler'], { from: 'nowhere' }).unknown, ['--from nowhere']);
  assert.equal(resolveNames(store, ['wrangler'], { from: 'acme/skills/skills@' + SHA.slice(0, 7) }).targets.length, 1);
  assert.deepEqual(resolveNames(store, ['kv'], { from: 'acme' }).ambiguous[0].candidates.length, 2); // a part of the location matches both sources
});

test('[sources-update R11] a repository, subpath and commit already in the catalog is found under any ref; identical content is recognised as unchanged', async () => {
  const files = { 'skills/a/SKILL.md': skill('a'), 'skills/b/SKILL.md': skill('b') };
  const { cat } = await gh(files);
  assert.equal(sourceAtCommit(cat, { owner: 'acme', repo: 'skills', subpath: 'skills', sha: SHA }).location, 'acme/skills/skills');
  assert.equal(sourceAtCommit(cat, { owner: 'ACME', repo: 'Skills', subpath: 'skills', sha: SHA })?.kind, 'github');
  assert.equal(sourceAtCommit(cat, { owner: 'acme', repo: 'skills', subpath: 'skills', sha: SHA2 }), null);
  assert.equal(sourceAtCommit(cat, { owner: 'acme', repo: 'skills', subpath: '', sha: SHA }), null);
  const again = (await gh(files)).cat, key = deriveSources(cat)[0].key;
  assert.deepEqual([...unchangedSources(cat, again)], [key]);
  const edited = (await gh({ ...files, 'skills/b/SKILL.md': skill('b', 'changed') })).cat;
  assert.deepEqual([...unchangedSources(cat, edited)], []);
  const fewer = (await gh({ 'skills/a/SKILL.md': skill('a') })).cat; assert.deepEqual([...unchangedSources(cat, fewer)], []);
  const local = await dir('/p/x', { 'a/SKILL.md': skill('a') }); assert.equal(unchangedSources(local, await dir('/p/x', { 'a/SKILL.md': skill('a') })).size, 1);
});
