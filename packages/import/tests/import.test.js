import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSkills, githubReader, parseGithubInput, memoryReader, ImportError, frontMatterName } from '../src/index.js';
import { dirReader, fileReader, filesReaders } from '../node/index.js';
import { verifyManifest } from '../../compile/src/index.js';
import { SHA, fakeFetch } from './helpers.js';

const skill = (name, extra = '') => `---\nname: ${name}\n---\nintro\n\n## Use\nUse ${name}.\n${extra}`;
const tmp = layout => {
  const d = mkdtempSync(join(tmpdir(), 'imp-'));
  for (const [p, c] of Object.entries(layout)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
};
const ids = cat => cat.skills.map(s => s.id);
const WORLD = () => ({ repos: { 'acme/skills': { refs: { HEAD: SHA, main: SHA, v1: SHA }, files: {
  'skills/alpha/SKILL.md': skill('alpha'), 'skills/alpha/ref.md': '# ref\nmore\n', 'skills/beta/SKILL.md': skill('beta'), 'README.md': '# readme\n', 'docs/guide.md': '# g\n', 'skills/alpha/logo.png': 'x',
} } } });

test('[import-skills R1] a single file, several files, a directory and a mix all import and verify', async () => {
  const d = tmp({ 'one.md': '## A\nx\n', 'two.md': '## B\ny\n', 'skills/s1/SKILL.md': skill('s1'), 'skills/s1/more.md': '## M\nz\n' });
  const single = await importSkills([fileReader(join(d, 'one.md'))]);
  assert.deepEqual(ids(single), ['one']); assert.equal(single.skills[0].files[0].path, 'one.md');
  const several = await importSkills(filesReaders([join(d, 'one.md'), join(d, 'two.md')]));
  assert.deepEqual(ids(several), ['one', 'two']);
  const dir = await importSkills([dirReader(join(d, 'skills'))]);
  assert.deepEqual(ids(dir), ['s1']); assert.deepEqual(dir.skills[0].files.map(f => f.path), ['s1/SKILL.md', 's1/more.md']);
  const mix = await importSkills([fileReader(join(d, 'two.md')), dirReader(join(d, 'skills')), fileReader(join(d, 'skills/s1/more.md')), fileReader(join(d, 'two.md'))]);
  assert.deepEqual(ids(mix), ['s1', 'two']); // the file reached twice, and the one inside the skill dir, are imported once
  assert.equal(mix.skills.flatMap(s => s.files).length, 3);
  for (const s of mix.skills) for (const f of s.files) assert.deepEqual(await verifyManifest(f.manifest, f.text), { ok: true });
});

test('[import-skills R2] a skill is a directory with SKILL.md; its markdown follows SKILL.md; other markdown is listed as skipped', async () => {
  const r = memoryReader({ kind: 'dir', origin: 'mem', rootName: 'root', files: {
    'a/SKILL.md': skill('a'), 'a/z.md': 'z\n', 'a/refs/b.md': 'b\n', 'a/refs/aa/SKILL.md': skill('nested'), 'a/refs/aa/c.md': 'c\n', 'README.md': 'r\n', 'notes/n.md': 'n\n', 'a/image.png': 'x',
  } });
  const c = await importSkills([r]);
  assert.deepEqual(c.skills.map(s => [s.id, s.files.map(f => f.path)]), [
    ['a', ['a/SKILL.md', 'a/refs/b.md', 'a/z.md']], ['nested', ['a/refs/aa/SKILL.md', 'a/refs/aa/c.md']],
  ]);
  assert.deepEqual(c.skipped.map(s => s.path).sort(), ['README.md', 'notes/n.md']);
  assert.match(c.skipped[0].reason, /not inside a skill directory/);
  const root = await importSkills([memoryReader({ kind: 'dir', origin: 'm2', rootName: 'myrepo', files: { 'SKILL.md': '## H\nx\n', 'extra.md': 'e\n' } })]);
  assert.deepEqual(root.skills.map(s => [s.id, s.files.length]), [['myrepo', 2]]);
});

test('[import-skills R3] id and name come from front matter, then directory or file name; duplicates are reported and kept', async () => {
  assert.equal(frontMatterName('---\nname: "Quoted Name"\n---\nx'), 'Quoted Name'); assert.equal(frontMatterName('no front matter'), null);
  assert.equal(frontMatterName('---\ndescription: x\n---\n'), null);
  const c = await importSkills([memoryReader({ kind: 'dir', origin: 'one', files: { 'x/SKILL.md': skill('fm-name'), 'plain/SKILL.md': '## P\n' } }),
    memoryReader({ kind: 'dir', origin: 'two', files: { 'y/SKILL.md': skill('fm-name') } })]);
  assert.deepEqual(ids(c), ['fm-name', 'fm-name', 'plain']);
  assert.deepEqual(c.conflicts, [{ id: 'fm-name', where: [{ origin: 'one', root: 'x' }, { origin: 'two', root: 'y' }] }]);
  assert.equal(c.skills.length, 3);
});

test('[import-skills R4] provenance records kind, origin, hash and GitHub coordinates, and repeat imports are identical', async () => {
  const d = tmp({ 'f.md': '## A\nx\n' });
  const local = await importSkills([fileReader(join(d, 'f.md')), dirReader(d)]);
  const f = local.skills.find(s => s.id === 'f').files[0];
  assert.equal(f.provenance.kind, 'file'); assert.equal(f.provenance.origin, join(d, 'f.md')); assert.equal(f.provenance.hash, f.manifest.source.hash);
  const gh = () => githubReader('acme/skills/skills@v1', { fetch: fakeFetch(WORLD()) });
  const a = await importSkills([gh()]), b = await importSkills([gh()]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.skills[0].files[0].provenance.github, { owner: 'acme', repo: 'skills', ref: 'v1', sha: SHA, subpath: 'skills' });
  assert.equal(a.skills[0].files[0].provenance.kind, 'github'); assert.match(a.skills[0].files[0].provenance.origin, new RegExp(`^github:acme/skills@${SHA}/skills$`));
});

test('[import-skills R5] GitHub references parse in all forms and import from the resolved commit only', async () => {
  assert.deepEqual(parseGithubInput('acme/skills'), { owner: 'acme', repo: 'skills', subpath: '', ref: null });
  assert.deepEqual(parseGithubInput('acme/skills@feature/x'), { owner: 'acme', repo: 'skills', subpath: '', ref: 'feature/x' });
  assert.deepEqual(parseGithubInput('github:acme/skills/sub/path@v1'), { owner: 'acme', repo: 'skills', subpath: 'sub/path', ref: 'v1' });
  assert.deepEqual(parseGithubInput('https://github.com/acme/skills.git'), { owner: 'acme', repo: 'skills', subpath: '', ref: null });
  assert.throws(() => parseGithubInput('nonsense'), e => e instanceof ImportError && e.code === 'bad-input');
  const log = [], cat = await importSkills([githubReader('acme/skills', { fetch: fakeFetch(WORLD(), log) })]);
  assert.deepEqual(ids(cat), ['alpha', 'beta']); assert.deepEqual(cat.skills[0].files.map(f => f.path), ['skills/alpha/SKILL.md', 'skills/alpha/ref.md']);
  assert.ok(log.at(-1).url.endsWith(`/tarball/${SHA}`)); // archive requested by SHA, not by ref
  const sub = await importSkills([githubReader('acme/skills/skills/alpha', { fetch: fakeFetch(WORLD()) })]);
  assert.deepEqual(sub.skills.map(s => [s.id, s.files.map(f => f.path)]), [['alpha', ['SKILL.md', 'ref.md']]]);
  const code = async (input, world, opts = {}) => githubReader(input, { fetch: fakeFetch(world), token: '', ...opts }).then(() => null, e => e);
  assert.equal((await code('acme/skills@nope', WORLD())).code, 'ref-not-found');
  assert.equal((await code('ghost/repo', WORLD())).code, 'not-found');
  assert.equal((await code('acme/skills', { ...WORLD(), rateLimited: true })).code, 'rate-limited');
  assert.match((await code('acme/skills', { ...WORLD(), rateLimited: true })).message, /GITHUB_TOKEN/);
  assert.equal((await code('acme/skills', { ...WORLD(), badToken: true }, { token: 't' })).code, 'unauthorized');
  const secret = 'ghp_SECRET123', net = await code('acme/skills', { ...WORLD(), down: `connect failed with ${secret}` }, { token: secret });
  assert.equal(net.code, 'network'); assert.ok(!net.message.includes(secret));
  const log2 = []; await githubReader('acme/skills', { fetch: fakeFetch(WORLD(), log2), token: secret });
  assert.ok(log2.every(l => l.headers.Authorization === `Bearer ${secret}`));
  const log3 = []; await githubReader('acme/skills', { fetch: fakeFetch(WORLD(), log3), token: '' });
  assert.ok(log3.every(l => !('Authorization' in l.headers)));
});

test('[import-skills R6] only markdown is read; symlinks, unsafe paths, big files and huge archives are not followed or truncated silently', async () => {
  const d = tmp({ 'ok/SKILL.md': skill('ok'), 'ok/data.json': '{}', 'ok/big.md': 'x'.repeat(1024 * 1024 + 1), 'outside.md': '## o\n' });
  symlinkSync(join(d, 'outside.md'), join(d, 'ok', 'link.md'));
  const c = await importSkills([dirReader(d)]);
  assert.deepEqual(c.skills[0].files.map(f => f.path), ['ok/SKILL.md']);
  const reasons = Object.fromEntries(c.skipped.map(s => [s.path, s.reason]));
  assert.match(reasons['ok/link.md'], /symbolic link/); assert.match(reasons['ok/big.md'], /larger than/); assert.match(reasons['outside.md'], /not inside a skill directory/);
  const unsafeEntries = ['../evil.md', '/abs.md', 'a/../../b.md', 'a\\b.md'].map(path => ({ path, size: 1, type: 'file' }));
  const u = await importSkills([memoryReader({ files: { 'g/SKILL.md': skill('g') }, entries: [{ path: 'g/SKILL.md', size: 10, type: 'file' }, ...unsafeEntries] })]);
  assert.deepEqual(u.skipped.map(s => s.reason), ['unsafe path', 'unsafe path', 'unsafe path', 'unsafe path']);
  const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`s${i}/SKILL.md`, '## x\n']));
  await assert.rejects(importSkills([memoryReader({ files: many })]), e => e.code === 'too-many-files');
  const gh = await githubReader('acme/skills', { fetch: fakeFetch({ repos: { 'acme/skills': { refs: { HEAD: SHA }, files: { 'a/SKILL.md': skill('a') }, extra: [['a/link.md', '2', 'SKILL.md']] } } }) });
  const g = await importSkills([gh]);
  assert.deepEqual(g.skills[0].files.map(f => f.path), ['a/SKILL.md']); assert.match(g.skipped[0].reason, /symbolic link/);
});

test('[import-skills R7] an unreadable file is skipped while the rest import; the call fails only when nothing imports or an input is unresolvable', async () => {
  const d = tmp({ 'ok/SKILL.md': skill('ok') }); writeFileSync(join(d, 'ok', 'bad.md'), Buffer.from([0xff, 0xfe, 0x41, 0x80]));
  const c = await importSkills([dirReader(d)]);
  assert.deepEqual(c.skills[0].files.map(f => f.path), ['ok/SKILL.md']); assert.match(c.skipped.find(s => s.path === 'ok/bad.md').reason, /^unreadable/);
  await assert.rejects(importSkills([memoryReader({ files: { 'README.md': 'x' } })]), e => e instanceof ImportError && e.code === 'nothing-imported' && /README\.md/.test(e.message));
  await assert.rejects(importSkills([]), e => e.code === 'bad-input');
  await assert.rejects(importSkills([githubReader('ghost/repo', { fetch: fakeFetch(WORLD()) })]), e => e.code === 'not-found');
  await assert.rejects(importSkills([fileReader(join(d, 'missing.md'))]), e => e.code === 'ENOENT');
});

test('[import-skills R8] the logic and GitHub reader have no dependencies and no Node-only imports; only node/ uses node: modules', () => {
  const root = new URL('../', import.meta.url), pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.skillnib.runtimeNeutral, true);
  for (const f of readdirSync(new URL('src/', root))) {
    const src = readFileSync(new URL('src/' + f, root), 'utf8');
    for (const m of src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) assert.ok(m[1].startsWith('./') || m[1] === '../../compile/src/index.js', `${f} imports "${m[1]}"`);
    assert.ok(!/\bprocess\.|require\(/.test(src.replace(/globalThis\.process/g, '')), `${f} uses Node globals`);
  }
  assert.match(readFileSync(new URL('node/index.js', root), 'utf8'), /from 'node:fs\/promises'/);
});
