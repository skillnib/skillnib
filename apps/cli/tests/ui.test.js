import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync, writeFileSync, symlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { main } from '../src/main.js';
import { USAGE } from '../src/args.js';
import { createUiApp, githubSpec } from '../src/ui/server.js';

const HAS_SPECS = (r => existsSync(join(r, 'docs/specs')) && existsSync(join(r, 'tools/gates/speclink.mjs')))(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NIB = join(ROOT, 'apps', 'cli', 'bin', 'nib.js');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const project = mkdtempSync(join(tmpdir(), 'nib-ui-'));
cpSync(join(ROOT, 'docs', 'guide', 'sample-skills'), join(project, 'skills'), { recursive: true });
mkdirSync(join(project, 'notes')); writeFileSync(join(project, 'notes', 'conventions.md'), '# Conventions\n\nUse tabs.\n'); writeFileSync(join(project, 'notes', 'big.md'), 'x'.repeat(1024 * 1024 + 10));
symlinkSync('/usr', join(project, 'escape'));
const app = createUiApp({ project, nibPath: NIB, token: 'tok', fetch: async () => { throw new Error('offline in tests'); } });
let port;
before(async () => { port = await app.listen(0); });
after(() => { app.server.close(); rmSync(project, { recursive: true, force: true }); });

const call = (method, path, { body, token = 'tok', host } = {}) => new Promise((ok, no) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: host ?? `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-nib-token': token } : {}) } }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: b, json: () => JSON.parse(b) })); });
  r.on('error', no); if (data) r.write(data); r.end();
});
const settle = () => app.settled();
const cli = (...a) => spawnSync('node', [NIB, ...a], { cwd: project, encoding: 'utf8', env: { ...process.env, NIB_STORE: '' } });
const skillsDir = join(project, 'skills');

test('[nib-ui R1] the command is in the usage text and the README, refuses arguments and --store, and prints its address', async () => {
  assert.match(USAGE, /nib ui \[--port N\] \[--project DIR\]/); assert.match(read('README.md'), /\| `nib ui \[--port N\] \[--project DIR\]` \|/);
  for (const argv of [['ui', 'extra'], ['ui', '--store', 'x']]) { let err = ''; assert.equal(await main(argv, { stdout: { write() {} }, stderr: { write: s => { err += s; } }, cwd: project, env: {} }), 2); assert.match(err, /^nib: /); }
  let out = '', seen; const code = await main(['ui', '--port', '0'], { stdout: { write: s => { out += s; } }, stderr: { write() {} }, cwd: project, env: {} }, { onListening: a => { seen = a; a.server.close(); } });
  assert.equal(code, 0); assert.match(out, /^SkillNib dashboard for .+\nhttp:\/\/127\.0\.0\.1:\d+\/ /); assert.ok(seen);
});

test('[nib-ui R2] localhost only: Host check, per-run token on every POST, and a restrictive Content-Security-Policy', async () => {
  assert.equal(app.server.address().address, '127.0.0.1');
  assert.equal((await call('GET', '/api/state', { host: 'evil.example' })).status, 403); assert.equal((await call('GET', '/api/state', { host: '127.0.0.1:1' })).status, 403);
  assert.equal((await call('POST', '/api/import', { body: { type: 'folder', path: skillsDir }, token: null })).status, 403); assert.equal((await call('POST', '/api/remove', { body: {}, token: 'nope' })).status, 403); assert.equal(app.jobs.length, 0);
  const page = await call('GET', '/'); assert.match(page.text, /name="nib-token" content="tok"/);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/); assert.ok(!/unsafe-inline'[^;]*script|script-src/.test(page.headers['content-security-policy']));
  assert.equal((await call('GET', '/../package.json')).status, 404); assert.equal((await call('GET', '/server.js')).status, 404);
});

test('[nib-ui R3] the state is nib list --json with namespaces, status and descriptions', async () => {
  assert.deepEqual((await call('GET', '/api/state')).json().sources, []);
  await call('POST', '/api/import', { body: { type: 'folder', path: skillsDir } }); await settle();
  const st = (await call('GET', '/api/state')).json(), list = JSON.parse(cli('list', '--json').stdout).sources;
  assert.equal(st.hasStore, true); assert.deepEqual(st.sources.map(s => [s.location, s.kind, s.status]), list.map(s => [s.location, s.kind, s.status]));
  assert.deepEqual(st.sources[0].skills.map(k => k.id), list[0].skills.map(k => k.id)); assert.match(st.sources[0].skills.find(k => k.id === 'acme-commit-messages').description, /git commit messages/);
});

test('[nib-ui R4] jobs run one at a time through the CLI, name sources by key, and report failures', async () => {
  if (!(await call('GET', '/api/state')).json().sources.length) { await call('POST', '/api/import', { body: { type: 'folder', path: skillsDir } }); await settle(); }
  const st = (await call('GET', '/api/state')).json(), key = st.sources[0].key;
  assert.equal((await call('POST', '/api/update', { body: { key: 'dir:/nope' } })).status, 404); assert.equal((await call('POST', '/api/remove', { body: { key: '--force' } })).status, 404);
  await call('POST', '/api/update', { body: { key } }); await call('POST', '/api/import', { body: { type: 'github', value: 'https://github.com/cloudflare/skills' } }); await settle();
  assert.deepEqual(app.jobs.slice(0, 2).map(j => j.status), ['failed', 'done']); assert.match(app.jobs[0].output, /could not reach GitHub|offline in tests/); assert.match(app.jobs[0].title, /^Import cloudflare\/skills$/);
  await call('POST', '/api/remove', { body: { key } }); await settle(); assert.equal(app.jobs[0].status, 'done'); assert.deepEqual((await call('GET', '/api/state')).json().sources, []);
  await call('POST', '/api/import', { body: { type: 'folder', path: skillsDir } }); await settle(); assert.equal((await call('GET', '/api/state')).json().sources.length, 1);
});

test('[nib-ui R5] import sources: pasted GitHub forms, home-or-project paths, Markdown only', async () => {
  const want = 'cloudflare/skills';
  for (const v of ['https://github.com/cloudflare/skills', 'https://github.com/cloudflare/skills.git', 'github.com/cloudflare/skills/', 'git@github.com:cloudflare/skills.git', 'cloudflare/skills', 'github:cloudflare/skills']) assert.equal(githubSpec(v).spec, want, v);
  assert.equal(githubSpec('https://github.com/anthropics/skills/tree/main/document-skills').spec, 'anthropics/skills@main/document-skills');
  assert.equal(githubSpec('owner/repo/some/dir@v1').spec, 'owner/repo/some/dir@v1'); assert.equal(githubSpec('https://github.com/o/r', 'abc1234', 'sub').spec, 'o/r/sub@abc1234');
  for (const bad of ['https://gitlab.com/x/y', 'not a repo', '--force', '']) assert.throws(() => githubSpec(bad), bad);
  assert.throws(() => githubSpec('o/r', '--x'));
  assert.equal((await call('POST', '/api/import', { body: { type: 'github', value: 'https://gitlab.com/x/y' } })).status, 400);
  assert.equal((await call('POST', '/api/import', { body: { type: 'folder', path: '/etc' } })).status, 403);
  assert.equal((await call('POST', '/api/import', { body: { type: 'folder', path: join(project, 'missing') } })).status, 404);
  const before = app.jobs.length; assert.equal((await call('POST', '/api/preview', { body: { type: 'files', paths: [join(skillsDir, 'acme-sql-style', 'SKILL.md').replace('.md', '.txt')] } })).status, 404);
  writeFileSync(join(project, 'notes', 'a.txt'), 'x'); assert.equal((await call('POST', '/api/preview', { body: { type: 'files', paths: [join(project, 'notes', 'a.txt')] } })).status, 400); assert.equal(app.jobs.length, before);
});

test('[nib-ui R6] preview lists skills and skipped files, and writes nothing', async () => {
  const dir = join(project, 'mixed'); mkdirSync(join(dir, 'one'), { recursive: true }); writeFileSync(join(dir, 'one', 'SKILL.md'), '---\nname: one\n---\n# One\n\ntext\n'); writeFileSync(join(dir, 'README.md'), '# readme\n');
  const have = (await call('GET', '/api/state')).json().sources.length, jobs = app.jobs.length;
  const d = (await call('POST', '/api/preview', { body: { type: 'folder', path: dir } })).json();
  assert.deepEqual(d.skills.map(s => s.name), ['one']); assert.deepEqual(d.skipped, [{ path: 'README.md', reason: 'not inside a skill directory (no SKILL.md above it)' }]);
  const f = (await call('POST', '/api/preview', { body: { type: 'files', paths: [join(project, 'notes', 'conventions.md'), join(project, 'notes', 'big.md')] } })).json();
  assert.deepEqual(f.skills.map(s => s.name), ['conventions']); assert.match(f.skipped[0].reason, /larger than/);
  const none = (await call('POST', '/api/preview', { body: { type: 'folder', path: join(project, 'notes') } })).json(); assert.deepEqual(none.skills, []); assert.ok(none.error);
  assert.equal((await call('GET', '/api/state')).json().sources.length, have); assert.equal(app.jobs.length, jobs); assert.ok(!existsSync(join(dir, '.nib')));
});

test('[nib-ui R7] browse: folders and Markdown under home or the project, nothing else', async () => {
  const b = (await call('GET', '/api/browse?path=' + encodeURIComponent(project))).json();
  assert.ok(b.entries.find(e => e.name === 'skills' && e.type === 'dir')); assert.ok(b.entries.find(e => e.name === 'notes' && e.type === 'dir')); assert.ok(!b.entries.some(e => e.name.startsWith('.')));
  const s = (await call('GET', '/api/browse?path=' + encodeURIComponent(skillsDir))).json(); assert.ok(s.entries.every(e => e.type === 'dir' && e.skill === true));
  const n = (await call('GET', '/api/browse?path=' + encodeURIComponent(join(project, 'notes')))).json();
  assert.ok(n.entries.find(e => e.name === 'conventions.md' && e.type === 'file' && !e.tooBig)); assert.ok(n.entries.find(e => e.name === 'big.md' && e.tooBig)); assert.ok(!n.entries.some(e => e.name === 'a.txt'));
  for (const p of ['/etc', '/', join(project, 'escape')]) assert.equal((await call('GET', '/api/browse?path=' + encodeURIComponent(p))).status, 403, p);
});

test('[nib-ui R8] search equals nib ask, can be limited to a namespace, and fails open on an unknown one', async () => {
  const q = 'write a commit message', web = (await call('GET', '/api/search?q=' + encodeURIComponent(q))).json(), ask = JSON.parse(cli('ask', q, '--json', '--outline-lines', '1000').stdout);
  assert.deepEqual(web.sections.map(s => [s.ref, s.text]), ask.sections.map(s => [s.ref, s.text])); assert.ok(web.sections.length > 0);
  const key = (await call('GET', '/api/state')).json().sources[0].key;
  const scoped = (await call('GET', `/api/search?q=${encodeURIComponent(q)}&ns=${encodeURIComponent(key)}`)).json(); assert.ok(scoped.sections.length > 0);
  const other = (await call('GET', `/api/search?q=${encodeURIComponent(q)}&ns=${encodeURIComponent('github:nobody/nothing@')}`)).json(); assert.equal(other.sections.length, 0); assert.ok(other.failOpen);
  const sec = (await call('GET', `/api/sections?source=${encodeURIComponent(key)}&skill=acme-sql-style`)).json(); assert.ok(sec.sections.length >= 5);
});

test('[nib-ui R9] install: preview writes nothing, install wires the project, undo reverses it', async () => {
  const settings = join(project, '.claude', 'settings.local.json');
  await call('POST', '/api/install', { body: { mode: 'auto', dryRun: true } }); await settle(); assert.ok(app.jobs[0].ok && /dry run/.test(app.jobs[0].output)); assert.ok(!existsSync(settings));
  await call('POST', '/api/install', { body: { mode: 'auto' } }); await settle(); assert.ok(app.jobs[0].ok, app.jobs[0].output); assert.ok(existsSync(settings)); assert.equal((await call('GET', '/api/state')).json().claudeWired, true);
  await call('POST', '/api/install', { body: { mode: 'auto', undo: true } }); await settle(); assert.equal((await call('GET', '/api/state')).json().claudeWired, false);
});

test('[nib-ui R10] quick start runs four checks, fails on an empty catalog and does not claim agent behaviour', async () => {
  const ok = (await call('POST', '/api/quickstart', { body: { prompt: 'write a commit message' } })).json();
  assert.deepEqual(ok.steps.map(s => s.id), ['catalog', 'delivery', 'hook', 'wiring']); assert.ok(ok.steps.slice(0, 3).every(s => s.ok), JSON.stringify(ok.steps)); assert.match(ok.summary, /do not show that an agent followed/);
  const dir = mkdtempSync(join(tmpdir(), 'nib-ui-e-')), other = createUiApp({ project: dir, token: 't' }), p = await other.listen(0);
  try { const r = await fetch(`http://127.0.0.1:${p}/api/quickstart`, { method: 'POST', headers: { 'x-nib-token': 't', 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'x y' }) }).then(x => x.json()); assert.equal(r.steps[0].ok, false); } finally { other.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

const ui = f => readFileSync(join(ROOT, 'apps', 'cli', 'src', 'ui', f), 'utf8');

test('[nib-ui R11] honest labels: launch profiles, bytes, pasted MCP entry, no connected-agent claims', () => {
  const text = ui('index.html') + ui('app.js'), clean = text.replace(/A profile is not a connected agent[^']*/, '').replace(/not a connected agent/g, '');
  for (const bad of [/connected agent/i, /tokens? saved/i, /\btrusted\b/i, /agent online/i]) assert.ok(!bad.test(clean), String(bad));
  for (const need of ['Launch profiles', 'You paste this into your MCP client', 'not model tokens']) assert.ok(text.includes(need), need);
});

test('[nib-ui R12] the page follows the dashboard rules and inserts skill text only as text', () => {
  const js = ui('app.js'), css = ui('app.css'), html = ui('index.html');
  assert.ok(html.indexOf('theme.js') > 0 && html.indexOf('theme.js') < html.indexOf('app.css')); for (const t of ['--bg:', '--accent:', '--danger:']) assert.ok(css.includes(t));
  for (const need of ["e.key === 'b'", '[25, 50, 100]', 'Help & concepts', '@kalahroudi', 'role: \'combobox\'', 'Search namespaces', 'Collapse all', 'Groups are collapsed by default', 'skel(']) assert.ok(js.includes(need), need);
  assert.match(js, /disabled: true, 'aria-disabled': 'true'/); assert.match(js, /const m = inp\.value === name/); assert.match(js, /!!\(grid\.q \|\| nsKey !== 'all'\)/);
  assert.ok(!/innerHTML/.test(js) && !/insertAdjacentHTML/.test(js) && !/document\.write/.test(js), 'no HTML string insertion');
});

test('[nib-ui R13] the page files ship in the package and only nib ui listens on a port', () => {
  const pkg = JSON.parse(read('package.json')); assert.ok(pkg.files.includes('apps/cli/src'));
  const files = readdirSync(join(ROOT, 'apps', 'cli', 'src', 'ui')); for (const f of ['server.js', 'index.html', 'app.js', 'app.css', 'theme.js']) assert.ok(files.includes(f), f);
  const hits = []; const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name) && /createServer|\.listen\(/.test(readFileSync(p, 'utf8'))) hits.push(p.replace(ROOT + '/', '')); } };
  walk(join(ROOT, 'packages')); walk(join(ROOT, 'apps', 'cli', 'src')); assert.deepEqual(hits.sort(), ['apps/cli/src/ui.js', 'apps/cli/src/ui/server.js']);
  assert.match(read('README.md'), /`nib ui` listens on 127\.0\.0\.1 only/); if (existsSync(join(ROOT, 'tools/release/public-AGENTS.md'))) assert.match(read('tools/release/public-AGENTS.md'), /Do not start `nib ui` on your own/);
  assert.match(read('CHANGELOG.md'), /## \[Unreleased\][\s\S]*?`nib ui`[\s\S]*?## \[0\./);
});

test('[nib-ui R14] the spec lints and its recorded link matches the approved requirements', { skip: !HAS_SPECS }, () => {
  for (const sub of ['lint', 'link']) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), sub, 'docs/specs/nib-ui.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
