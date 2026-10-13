import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'release.sh');
const realNpm = execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim();
const sh = (cwd, ...a) => spawnSync('bash', [SCRIPT, ...a], { cwd, encoding: 'utf8', env: ENV(cwd) });

let state;
const ENV = cwd => ({ ...process.env, ...GIT_ENV, PATH: `${state.bin}:${process.env.PATH}`, STATE: state.dir, REAL_NPM: realNpm, RELEASE_VERIFY_CMD: state.verify ?? 'true', ...state.env });

// A throwaway "private" repo with a bare origin, a bare "public" repo, and stub npm and gh on the path.
function world(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rel-')), bin = join(dir, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), `#!/bin/sh
case "$1" in
  publish) [ -n "$NPM_FAIL" ] && { echo "npm ERR! otp" >&2; exit 1; }; echo "$2" >> "$STATE/published"; exit 0 ;;
  view) case "$2" in *@*) v="\${2#*@}"; grep -q "$v" "$STATE/published" 2>/dev/null && echo "$v"; exit 0 ;; *) [ -n "$NPM_TAKEN" ] && { echo "$2"; exit 0; }; exit 1 ;; esac ;;
  *) exec "$REAL_NPM" "$@" ;;
esac
`);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "release view") grep -q "$3" "$STATE/gh-releases" 2>/dev/null; exit $? ;;
  "release create") [ -n "$GH_FAIL" ] && exit 1; echo "$3" >> "$STATE/gh-releases"; echo "$@" >> "$STATE/gh-log"; exit 0 ;;
esac
exit 0
`);
  chmodSync(join(bin, 'npm'), 0o755); chmodSync(join(bin, 'gh'), 0o755);
  const origin = join(dir, 'origin.git'), pub = join(dir, 'public.git'), work = join(dir, 'work');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin); git(dir, 'init', '-q', '--bare', '-b', 'main', pub);
  git(dir, 'clone', '-q', origin, work);
  git(work, 'checkout', '-q', '-b', 'main');
  const all = { 'package.json': '{\n  "name": "skillnib-fixture",\n  "version": "0.0.0",\n  "files": ["index.js"]\n}\n', 'index.js': 'export const x = 1;\n', '.nib/catalog.json': '{}\n', 'docs/readme.md': 'hello\n', ...files };
  for (const [f, c] of Object.entries(all)) { mkdirSync(dirname(join(work, f)), { recursive: true }); writeFileSync(join(work, f), c); }
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'init'); git(work, 'push', '-q', 'origin', 'main');
  state = { dir, bin, env: {} };
  return { dir, work, pub, origin };
}
const pubTags = w => git(w.dir, '--git-dir', w.pub, 'tag').split('\n').filter(Boolean);
const published = w => existsSync(join(w.dir, 'published')) ? readFileSync(join(w.dir, 'published'), 'utf8') : '';
const URLOF = w => w.pub;

test('[release-script R1] bad arguments exit 2 with a message; --help exits 0', () => {
  const w = world();
  for (const a of [[], ['1.0'], ['v1.0.0'], ['1.0.0', '--wat'], ['1.0.0', '2.0.0']]) { const r = sh(w.work, ...a, '--public-url', URLOF(w)); assert.equal(r.status, 2, a.join(' ') + ' ' + r.stderr); assert.match(r.stderr, /release:|usage/); }
  assert.equal(sh(w.work, '--help').status, 0);
  // a version that is not newer than the latest public tag
  assert.equal(sh(w.work, '1.0.0', '--yes', '--public-url', URLOF(w)).status, 0);
  const r = sh(w.work, '0.9.0', '--yes', '--public-url', URLOF(w)); assert.equal(r.status, 2); assert.match(r.stderr, /not newer/);
});

test('[release-script R2] preflight stops a dirty tree, wrong branch, diverged main and missing tools', () => {
  let w = world(); writeFileSync(join(w.work, 'dirty.txt'), 'x');
  let r = sh(w.work, '1.0.0', '--dry-run', '--public-url', URLOF(w)); assert.equal(r.status, 1); assert.match(r.stderr, /not clean/);
  w = world(); git(w.work, 'checkout', '-q', '-b', 'other');
  r = sh(w.work, '1.0.0', '--dry-run', '--public-url', URLOF(w)); assert.match(r.stderr, /not main/);
  w = world(); writeFileSync(join(w.work, 'index.js'), 'export const x = 2;\n'); git(w.work, 'commit', '-qam', 'local');
  r = sh(w.work, '1.0.0', '--dry-run', '--public-url', URLOF(w)); assert.match(r.stderr, /differs from origin\/main/);
  assert.deepEqual(pubTags(w), []);
});

test('[release-script R3] the export is the tracked files minus the ignore list, with only the version changed', () => {
  const w = world(); state.verify = 'ls -A > "$STATE/listing"; cat package.json > "$STATE/pkg"';
  const r = sh(w.work, '1.2.3', '--yes', '--public-url', URLOF(w)); assert.equal(r.status, 0, r.stderr);
  const files = git(w.dir, '--git-dir', w.pub, 'ls-tree', '-r', '--name-only', 'main').split('\n').sort();
  assert.deepEqual(files, ['docs/readme.md', 'index.js', 'package.json']);
  assert.equal(git(w.dir, '--git-dir', w.pub, 'show', 'main:package.json'), '{\n  "name": "skillnib-fixture",\n  "version": "1.2.3",\n  "files": ["index.js"]\n}');
  assert.equal(git(w.work, 'status', '--porcelain'), '');
  assert.equal(git(w.work, 'rev-parse', 'HEAD'), git(w.work, 'rev-parse', 'origin/main'));
  assert.equal(git(w.work, 'tag'), '');
});

test('[release-script R4] the guard rejects a private path, a .env file and a token; a clean repo passes', () => {
  const tok = 'ghp_' + 'A1b2'.repeat(10);
  for (const [f, c, re] of [['c3/run.mjs', 'x', /c3\/run\.mjs/], ['app/.env', 'A=1', /\.env/], ['notes.txt', `key ${tok}`, /notes\.txt/], ['tools/research/x.js', 'x', /tools\/research|research/]]) {
    const w = world({ [f]: c }); state.verify = 'echo verify-ran';
    const r = sh(w.work, '1.0.0', '--yes', '--public-url', URLOF(w));
    if (f === 'tools/research/x.js') { assert.equal(r.status, 0, 'ignored by the export list, never exported'); assert.equal(git(w.dir, '--git-dir', w.pub, 'ls-tree', '-r', '--name-only', 'main').includes('research'), false); continue; }
    assert.equal(r.status, 1, f); assert.match(r.stderr, re); assert.doesNotMatch(r.stdout, /verify-ran/); assert.deepEqual(pubTags(w), []);
  }
});

test('[release-script R5] a failing check stops before any outward action; the plan hash equals the released tarball', () => {
  let w = world(); state.verify = 'exit 3';
  let r = sh(w.work, '1.0.0', '--yes', '--public-url', URLOF(w)); assert.equal(r.status, 1); assert.match(r.stderr, /verification failed/); assert.deepEqual(pubTags(w), []); assert.equal(published(w), '');
  w = world(); state.verify = 'true';
  r = sh(w.work, '1.0.0', '--yes', '--public-url', URLOF(w)); assert.equal(r.status, 0, r.stderr);
  const sum = /sha256\s+([0-9a-f]{64})/.exec(r.stdout)[1], tgz = published(w).trim();
  assert.match(readFileSync(join(w.dir, 'gh-log'), 'utf8'), new RegExp(sum));
  assert.ok(tgz.endsWith('.tgz'));
});

test('[release-script R6] a dry run changes nothing outward and prints the commands', () => {
  const w = world(); state.verify = 'true';
  const r = sh(w.work, '1.0.0', '--dry-run', '--public-url', URLOF(w)); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry run/); assert.match(r.stdout, /git push/); assert.match(r.stdout, /gh release create v1\.0\.0/); assert.match(r.stdout, /npm publish/);
  assert.deepEqual(pubTags(w), []); assert.equal(published(w), ''); assert.equal(git(w.dir, '--git-dir', w.pub, 'branch').trim(), '');
  assert.equal(git(w.work, 'tag'), ''); assert.equal(existsSync(join(w.dir, 'gh-releases')), false);
});

test('[release-script R7] the first release creates main and the tag; a later one adds one commit on top', () => {
  const w = world(); state.verify = 'true';
  assert.equal(sh(w.work, '1.0.0', '--yes', '--public-url', URLOF(w)).status, 0);
  const first = git(w.dir, '--git-dir', w.pub, 'rev-parse', 'main');
  assert.equal(git(w.dir, '--git-dir', w.pub, 'rev-list', '--count', 'main'), '1');
  writeFileSync(join(w.work, 'index.js'), 'export const x = 2;\n'); git(w.work, 'commit', '-qam', 'change'); git(w.work, 'push', '-q', 'origin', 'main');
  assert.equal(sh(w.work, '1.1.0', '--yes', '--public-url', URLOF(w)).status, 0);
  assert.equal(git(w.dir, '--git-dir', w.pub, 'rev-list', '--count', 'main'), '2');
  assert.equal(git(w.dir, '--git-dir', w.pub, 'rev-parse', 'main~1'), first);
  assert.equal(git(w.dir, '--git-dir', w.pub, 'show', 'main:index.js'), 'export const x = 2;');
  assert.deepEqual(pubTags(w).sort(), ['v1.0.0', 'v1.1.0']);
  assert.equal(git(w.dir, '--git-dir', w.pub, 'log', '-1', '--format=%s', 'main'), 'Release v1.1.0');
});

test('[release-script R8] rerunning after a GitHub or npm failure completes the rest without repeating done steps', () => {
  const w = world(); state.verify = 'true';
  state.env = { GH_FAIL: '1' };
  let r = sh(w.work, '2.0.0', '--yes', '--public-url', URLOF(w)); assert.notEqual(r.status, 0); assert.match(r.stderr, /GitHub release failed/);
  assert.deepEqual(pubTags(w), ['v2.0.0']);
  state.env = { NPM_FAIL: '1' };
  r = sh(w.work, '2.0.0', '--yes', '--public-url', URLOF(w)); assert.notEqual(r.status, 0); assert.match(r.stderr, /npm publish failed/); assert.match(r.stdout, /already in the public repository/);
  state.env = {};
  r = sh(w.work, '2.0.0', '--yes', '--public-url', URLOF(w)); assert.equal(r.status, 0, r.stderr);
  assert.equal(git(w.dir, '--git-dir', w.pub, 'rev-list', '--count', 'main'), '1');
  assert.equal(published(w).trim().split('\n').length, 1);
  assert.equal(readFileSync(join(w.dir, 'gh-releases'), 'utf8').trim().split('\n').length, 1);
  r = sh(w.work, '2.0.0', '--yes', '--public-url', URLOF(w)); assert.equal(r.status, 0); assert.match(r.stdout, /already on npm/);
  assert.equal(published(w).trim().split('\n').length, 1);
  // a tag that exists with different content is refused
  writeFileSync(join(w.work, 'index.js'), 'export const x = 3;\n'); git(w.work, 'commit', '-qam', 'later'); git(w.work, 'push', '-q', 'origin', 'main');
  r = sh(w.work, '2.0.0', '--yes', '--public-url', URLOF(w)); assert.notEqual(r.status, 0); assert.match(r.stderr, /different content/);
});

test('[release-script R9] nothing outward happens without typing release; no token is read or printed', () => {
  const w = world(); state.verify = 'true';
  state.env = { NPM_TOKEN: 'npm_' + 'Z9y8'.repeat(10), GITHUB_TOKEN: 'ghp_' + 'Q1w2'.repeat(10) };
  let r = spawnSync('bash', [SCRIPT, '1.0.0', '--public-url', URLOF(w)], { cwd: w.work, encoding: 'utf8', env: ENV(w.work), input: 'no\n' });
  assert.equal(r.status, 1); assert.match(r.stderr, /cancelled/); assert.deepEqual(pubTags(w), []); assert.equal(published(w), '');
  r = spawnSync('bash', [SCRIPT, '1.0.0', '--public-url', URLOF(w)], { cwd: w.work, encoding: 'utf8', env: ENV(w.work), input: 'release\n' });
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(pubTags(w), ['v1.0.0']);
  assert.doesNotMatch(r.stdout + r.stderr, /npm_Z9y8|ghp_Q1w2/);
  assert.doesNotMatch(readFileSync(SCRIPT, 'utf8'), /NPM_TOKEN|GITHUB_TOKEN|GH_TOKEN|_authToken/);
});

test('[release-script R10] a taken npm name stops the first release; prereleases publish to the next tag', () => {
  let w = world(); state.verify = 'true'; state.env = { NPM_TAKEN: '1' };
  let r = sh(w.work, '1.0.0', '--yes', '--public-url', URLOF(w)); assert.equal(r.status, 1); assert.match(r.stderr, /already taken/); assert.deepEqual(pubTags(w), []);
  w = world(); state.verify = 'true';
  r = sh(w.work, '1.0.0-rc.1', '--dry-run', '--public-url', URLOF(w)); assert.match(r.stdout, /--tag next/);
});
