import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';
import { isNewer } from '../src/upgrade.js';
import { USAGE } from '../src/args.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const CUR = JSON.parse(read('package.json')).version;
const reg = v => async url => { reg.urls.push(url); return { ok: true, status: 200, json: async () => ({ version: v }) }; };
reg.urls = [];
async function nib(argv, io = {}) {
  let out = '', err = '', ran = [];
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd: mkdtempSync(join(tmpdir(), 'up-')), env: {}, fetch: io.fetch, run: io.run ?? ((c, a) => { ran.push([c, ...a]); return { status: 0 }; }) });
  return { code, out, err, ran };
}

test('[nib-upgrade R1] --check reports a newer version or that nib is current, exits 0 and installs nothing', async () => {
  let r = await nib(['upgrade', '--check'], { fetch: reg('9.9.9') });
  assert.equal(r.code, 0); assert.equal(r.out, `nib ${CUR}; 9.9.9 is available. Run: nib upgrade\n`); assert.deepEqual(r.ran, []);
  assert.ok(reg.urls.at(-1).endsWith('/skillnib/latest') && reg.urls.at(-1).startsWith('https://registry.npmjs.org/'));
  for (const v of [CUR]) { r = await nib(['upgrade', '--check'], { fetch: reg(v) }); assert.equal(r.code, 0); assert.equal(r.out, `nib ${CUR} is the latest version.\n`); assert.deepEqual(r.ran, []); }
});

test('[nib-upgrade R2] upgrade runs exactly the pinned npm install when newer, and nothing when current', async () => {
  let r = await nib(['upgrade'], { fetch: reg('9.9.9') });
  assert.equal(r.code, 0); assert.deepEqual(r.ran, [['npm', 'install', '-g', 'skillnib@9.9.9']]);
  assert.equal(r.out, `Upgrading nib ${CUR} to 9.9.9: npm install -g skillnib@9.9.9\nUpgraded nib to 9.9.9.\n`);
  r = await nib(['upgrade'], { fetch: reg(CUR) }); assert.equal(r.code, 0); assert.deepEqual(r.ran, []); assert.equal(r.out, `nib ${CUR} is the latest version.\n`);
});

test('[nib-upgrade R3] registry failures and a failing install exit 1 and say what to do', async () => {
  const bad = [async () => { throw new Error('offline'); }, async () => ({ ok: false, status: 503 }), async () => ({ ok: true, status: 200, json: async () => ({}) })];
  for (const fetch of bad) { const r = await nib(['upgrade'], { fetch }); assert.equal(r.code, 1); assert.match(r.err, /^nib: could not check the latest version \(/); assert.deepEqual(r.ran, []); }
  const r = await nib(['upgrade'], { fetch: reg('9.9.9'), run: () => ({ status: 243 }) });
  assert.equal(r.code, 1); assert.match(r.err, /npm install -g skillnib@9\.9\.9 failed with exit code 243; run it yourself/);
  const e = await nib(['upgrade'], { fetch: reg('9.9.9'), run: () => ({ error: new Error('spawn npm ENOENT') }) }); assert.equal(e.code, 1); assert.match(e.err, /ENOENT/);
});

test('[nib-upgrade R4] versions compare as x.y.z, and a release is newer than its prerelease', () => {
  for (const [a, b] of [['0.1.2', '0.1.1'], ['0.2.0', '0.1.9'], ['1.0.0', '0.9.9'], ['0.1.1', '0.1.1-next.1']]) assert.ok(isNewer(a, b), `${a} > ${b}`);
  for (const [a, b] of [['0.1.1', '0.1.1'], ['0.1.1', '0.1.2'], ['0.1.1-next.1', '0.1.1'], ['x', '0.1.1']]) assert.ok(!isNewer(a, b), `${a} !> ${b}`);
});

test('[nib-upgrade R5] arguments are refused, and the usage and README list the command', async () => {
  const r = await nib(['upgrade', 'now'], { fetch: reg('9.9.9') }); assert.equal(r.code, 2); assert.match(r.err, /upgrade takes no arguments/); assert.deepEqual(r.ran, []);
  assert.equal((await nib(['upgrade', '--bogus'])).code, 2);
  assert.match(USAGE, /nib upgrade \[--check\]/); assert.match(read('README.md'), /^\| `nib upgrade` \|/m);
});

test('[nib-upgrade R6] the hook, ask, list and mcp make no registry request, and the README says only upgrade contacts npm', async () => {
  const d = mkdtempSync(join(tmpdir(), 'up6-')); mkdirSync(join(d, 'skills/a'), { recursive: true }); writeFileSync(join(d, 'skills/a/SKILL.md'), '---\nname: a\n---\n## Kv\nKv notes.\n');
  const boom = async () => { throw new Error('network used'); };
  const io = extra => ({ stdout: { write() {} }, stderr: { write() {} }, cwd: d, env: {}, fetch: boom, run: boom, ...extra });
  assert.equal(await main(['import', 'skills'], io()), 0);
  for (const argv of [['ask', 'kv'], ['list'], ['show', 'a/SKILL.md#kv']]) { let err = ''; const code = await main(argv, io({ stderr: { write: s => { err += s; } } })); assert.ok(code === 0 || code === 1); assert.ok(!err.includes('network used'), argv.join(' ')); }
  let err = ''; await main(['hook', 'claude'], io({ stdin: (async function* () { yield JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'kv', cwd: d }); })(), stderr: { write: s => { err += s; } } })); assert.ok(!err.includes('network used'));
  const src = ['main.js', 'mcp.js', 'init.js'].map(f => read(`apps/cli/src/${f}`)).join(''); assert.ok(!/registry\.npmjs\.org/.test(src));
  assert.match(read('README.md'), /`nib upgrade` asks the npm registry for the latest version and nothing else does/);
});

test('[nib-upgrade R7] the public AGENTS.md tells agents not to run nib upgrade on their own', { skip: !existsSync(join(ROOT, 'tools/release/public-AGENTS.md')) }, () => {
  assert.match(read('tools/release/public-AGENTS.md'), /Do not run `nib upgrade` on your own.*nib upgrade --check/);
});

test('[nib-upgrade R8] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  for (const sub of ['lint', 'link']) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), sub, 'docs/specs/nib-upgrade.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
