import test from 'node:test';
import assert from 'node:assert/strict';
import { githubCandidates, parseGithubInput, isGithubReference, resolveGithub, githubReader, ImportError } from '../src/index.js';
import { fakeFetch, SHA } from './helpers.js';

const one = (input, want) => { const c = githubCandidates(input); assert.equal(c.length, 1, input); assert.deepEqual(c[0], want, input); };
const SKILLS = { owner: 'cloudflare', repo: 'skills', subpath: 'skills', ref: null };

test('[github-url-import R1] every accepted form reads as the same owner, repository, folder and ref', () => {
  const repo = { owner: 'cloudflare', repo: 'skills', subpath: '', ref: null };
  for (const v of ['cloudflare/skills', 'github:cloudflare/skills', 'https://github.com/cloudflare/skills', 'http://www.github.com/cloudflare/skills/', 'github.com/cloudflare/skills.git', 'git@github.com:cloudflare/skills.git', 'ssh://git@github.com/cloudflare/skills.git', 'git+https://github.com/cloudflare/skills.git', 'https://github.com/cloudflare/skills?tab=readme#install', 'https://github.com/cloudflare/skills/issues', '  <https://github.com/cloudflare/skills>  ', 'github:https://github.com/cloudflare/skills']) one(v, repo);
  one('cloudflare/skills/skills', SKILLS);
  const pinned = { ...SKILLS, ref: '5339598' };
  for (const v of ['cloudflare/skills/skills@5339598', 'https://github.com/cloudflare/skills/tree/5339598/skills']) assert.deepEqual(githubCandidates(v).find(c => c.ref === '5339598'), pinned, v);
  assert.deepEqual(githubCandidates('cloudflare/skills@5339598/skills')[0], pinned, 'the documented form: the ref comes right after the repository');
  one('https://github.com/o/r/commit/5339598', { owner: 'o', repo: 'r', subpath: '', ref: '5339598' });
  one('https://github.com/o/r/releases/tag/v1.2', { owner: 'o', repo: 'r', subpath: '', ref: 'v1.2' });
  one('o/r@v1', { owner: 'o', repo: 'r', subpath: '', ref: 'v1' });
  assert.deepEqual(githubCandidates('https://github.com/o/r/blob/main/skills/a/SKILL.md').map(c => `${c.ref}|${c.subpath}`), ['main|skills/a', 'main/skills|a', 'main/skills/a|']);
  assert.deepEqual(githubCandidates('o/r@feature/x').map(c => `${c.ref}|${c.subpath}`), ['feature|x', 'feature/x|']);
  assert.deepEqual(parseGithubInput('o/r@feature/x'), { owner: 'o', repo: 'r', subpath: '', ref: 'feature/x' }, 'parseGithubInput is the literal reading');
  for (const bad of ['https://gitlab.com/x/y', 'https://example.com/o/r', '--force', '-x/y', 'not a repo', 'nonsense', '', 'o/r/../etc', 'o/r@a b']) assert.throws(() => githubCandidates(bad), e => e instanceof ImportError && e.code === 'bad-input', bad);
  assert.equal(isGithubReference('https://github.com/o/r'), true); assert.equal(isGithubReference('github.com/o/r'), true); assert.equal(isGithubReference('o/r'), true);
  for (const no of ['./o/r', '~/skills', '/abs/path', 'missing.md', 'C:\\skills', 'https://gitlab.com/x/y']) assert.equal(isGithubReference(no), false, no);
});

test('[github-url-import R2] the ref is settled against GitHub: a commit, a plain branch, a branch with a slash; unknown refs and repositories fail clearly', async () => {
  const files = { 'skills/a/SKILL.md': '---\nname: a\n---\n## Use\nkv\n' };
  const world = { repos: { 'o/r': { refs: { HEAD: SHA, main: SHA, 'feature/x': 'b'.repeat(40), [SHA]: SHA }, files } } };
  const log = [], opts = { fetch: fakeFetch(world, log), token: '' };
  for (const input of ['o/r@main/skills', 'https://github.com/o/r/tree/main/skills', 'o/r/skills@main']) assert.deepEqual(await resolveGithub(input, opts), { owner: 'o', repo: 'r', subpath: 'skills', ref: 'main', sha: SHA }, input);
  assert.deepEqual(await resolveGithub('https://github.com/o/r/tree/feature/x/skills', opts), { owner: 'o', repo: 'r', subpath: 'skills', ref: 'feature/x', sha: 'b'.repeat(40) });
  assert.deepEqual(await resolveGithub(`o/r@${SHA}/skills`, opts), { owner: 'o', repo: 'r', subpath: 'skills', ref: SHA, sha: SHA });
  const r = await githubReader('o/r@main/skills', opts); assert.deepEqual((await r.list()).map(e => e.path ?? e), ['a/SKILL.md']);
  log.length = 0;
  await assert.rejects(resolveGithub('o/r@nope/skills', opts), e => e.code === 'ref-not-found' && /ref "nope" not found in o\/r/.test(e.message));
  log.length = 0;
  await assert.rejects(resolveGithub('ghost/repo@a/b/c', opts), e => e.code === 'not-found' && /ghost\/repo/.test(e.message));
  assert.equal(log.filter(l => /\/commits\//.test(l.url)).length, 1, 'a missing repository is not retried with other readings');
});
