import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { main } from '../src/main.js';
import { USAGE } from '../src/args.js';
import { createUiApp } from '../src/ui/server.js';
import { githubCandidates } from '../../../packages/import/src/index.js';
import { fakeFetch, SHA } from '../../../packages/import/tests/helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), NIB = join(ROOT, 'apps', 'cli', 'bin', 'nib.js');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const SKILL = '---\nname: alpha\n---\n## Use\nAlpha kv thing.\n';
const world = () => ({ repos: { 'acme/skills': { refs: { HEAD: SHA, main: SHA, 'feature/x': 'c'.repeat(40), [SHA]: SHA, '5339598': SHA }, files: { 'skills/alpha/SKILL.md': SKILL, 'README.md': '# r\n' } } } });
const dir = () => mkdtempSync(join(tmpdir(), 'gh-url-'));
async function tap(cwd, argv, fetch = fakeFetch(world())) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env: { GITHUB_TOKEN: '' }, fetch, nibPath: NIB });
  return { code, out, err };
}

test('[github-url-import R3] nib import and nib init claude take a pasted URL, the documented pin form and github: text; a local path wins; errors show the forms', async () => {
  for (const src of ['https://github.com/acme/skills/tree/main/skills', 'github.com/acme/skills/tree/main/skills/', 'acme/skills@main/skills', 'acme/skills@5339598/skills', 'github:https://github.com/acme/skills/tree/feature/x/skills', 'https://github.com/acme/skills/commit/5339598']) {
    const d = dir(); const r = await tap(d, ['import', src]);
    assert.equal(r.code, 0, `${src}: ${r.err}`); assert.match(r.out, /Imported (1 skill|1 skill, 1 file)/, src);
  }
  const d = dir(), shown = await tap(d, ['import', 'acme/skills@5339598/skills']);
  assert.match((await tap(d, ['list'])).out, /acme\/skills\/skills@5339598  github  pinned  /, shown.out);
  const p = dir(); const init = await tap(p, ['init', 'claude', 'https://github.com/acme/skills/tree/main/skills', '--project', p]);
  assert.equal(init.code, 0, init.err); assert.match(init.out, /alpha/);
  const l = dir(); mkdirSync(join(l, 'acme/skills/skills/beta'), { recursive: true }); writeFileSync(join(l, 'acme/skills/skills/beta/SKILL.md'), '---\nname: beta\n---\n## B\nlocal\n');
  const local = await tap(l, ['import', 'acme/skills'], () => { throw new Error('network must not be used'); }); assert.equal(local.code, 0, local.err); assert.match(local.out, /beta/);
  const other = await tap(d, ['import', 'https://gitlab.com/x/y']); assert.equal(other.code, 1); assert.match(other.err, /not a GitHub address|only GitHub/);
  const nope = await tap(d, ['import', 'acme/skills@nope/skills']); assert.equal(nope.code, 1); assert.match(nope.err, /ref-not-found: ref "nope" not found in acme\/skills/);
  assert.match(USAGE, /https:\/\/github\.com\/owner\/repo/); assert.match(USAGE, /owner\/repo\[\/subpath\]\[@ref\]/);
});

const project = mkdtempSync(join(tmpdir(), 'gh-url-ui-')), calls = [];
const app = createUiApp({ project, nibPath: NIB, token: 'tok', fetch: (...a) => { calls.push(a[0]); return fakeFetch(world())(...a); } });
let port;
before(async () => { port = await app.listen(0); });
after(() => { app.server.close(); rmSync(project, { recursive: true, force: true }); });
const call = (method, path, body) => new Promise((ok, no) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'x-nib-token': 'tok' } }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => ok({ status: res.statusCode, json: () => JSON.parse(b) })); });
  r.on('error', no); if (data) r.write(data); r.end();
});

test('[github-url-import R4] the dashboard previews a pasted address from the shared parser without the network, Advanced overrides it, and a URL import adds the source', async () => {
  const ok = await call('POST', '/api/preview', { type: 'github', value: 'https://github.com/acme/skills/tree/main/skills' });
  assert.equal(ok.status, 200); assert.deepEqual({ ...ok.json() }, { name: 'acme/skills', ref: 'main', sub: 'skills', ambiguous: true, spec: 'acme/skills@main/skills' });
  const exact = (await call('POST', '/api/preview', { type: 'github', value: 'acme/skills/skills@v1' })).json(); assert.deepEqual([exact.ref, exact.sub, exact.ambiguous, exact.spec], ['v1', 'skills', false, 'acme/skills/skills@v1']);
  const over = (await call('POST', '/api/preview', { type: 'github', value: 'https://github.com/acme/skills', ref: 'abc1234', sub: 'skills' })).json(); assert.equal(over.spec, 'acme/skills/skills@abc1234');
  assert.equal(calls.length, 0, 'previewing never touches the network');
  for (const bad of ['https://gitlab.com/x/y', 'nonsense', '--force']) assert.equal((await call('POST', '/api/preview', { type: 'github', value: bad })).status, 400, bad);
  assert.equal((await call('POST', '/api/import', { type: 'github', value: 'https://gitlab.com/x/y' })).status, 400);
  assert.equal((await call('POST', '/api/import', { type: 'github', value: 'https://github.com/acme/skills/tree/main/skills' })).status, 202);
  await app.settled();
  const st = (await call('GET', '/api/state')).json(); assert.equal(st.sources.length, 1); assert.equal(st.sources[0].location, 'acme/skills/skills@main'.replace('@main', ''));
  assert.deepEqual(githubCandidates('https://github.com/acme/skills/tree/main/skills').map(c => c.ref), ['main', 'main/skills']);
});

test('[github-url-import R5] the docs show pasting an address and both pin forms, every documented example parses to its source, and the changelog says so', () => {
  const docs = ['README.md', 'docs/guide/importing.md', 'docs/guide/claude-code.md'].map(read);
  for (const t of docs) assert.match(t, /https:\/\/github\.com\/[\w-]+\/[\w-]+/);
  assert.match(docs[1], /\/tree\/main\/skills/); assert.match(docs[1], /owner\/repo\/folder@ref/);
  const pins = ['cloudflare/skills@5339598/skills', 'cloudflare/skills/skills@5339598', 'https://github.com/cloudflare/skills/tree/5339598/skills'];
  for (const p of pins) assert.ok(githubCandidates(p).some(c => c.owner === 'cloudflare' && c.repo === 'skills' && c.ref === '5339598' && c.subpath === 'skills'), p);
  assert.match(read('CHANGELOG.md'), /GitHub address/);
});

test('[github-url-import R6] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  for (const sub of ['lint', 'link']) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), sub, 'docs/specs/github-url-import.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
