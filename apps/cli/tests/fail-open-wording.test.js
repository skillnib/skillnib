import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { failOpen, renderText } from '../../../packages/deliver/src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), BIN = join(ROOT, 'apps/cli/bin/nib.js');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const env = () => { const e = { ...process.env, GITHUB_TOKEN: '' }; delete e.NODE_TEST_CONTEXT; delete e.NIB_STORE; return e; };
const nib = (cwd, args, input) => spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8', env: env(), input });
const ADVICE = 'Rephrase the ask with words from one of your skills, or check what is imported with nib list.';
function project() { const d = mkdtempSync(join(tmpdir(), 'fow-')); cpSync(join(ROOT, 'docs/guide/sample-skills'), join(d, 'skills'), { recursive: true }); nib(d, ['import', './skills']); return d; }

test('[fail-open-wording R1] the notice is the one sentence for every reason and never says to load the skills normally', () => {
  for (const reason of ['no module matched the ask', 'no store found at /x/.nib', 'SkillNib could not select sections']) {
    const first = renderText(failOpen({ reason })).split('\n')[0];
    assert.equal(first, `SkillNib: no sections were selected (${reason}). ${ADVICE}`);
    assert.doesNotMatch(first, /Load the skills|normally/);
  }
});

test('[fail-open-wording R2] ask with no match, ask with no store and MCP search with no match print the notice and keep their exit codes; the hook notice is unchanged', () => {
  const d = project();
  const none = nib(d, ['ask', 'kubernetes ingress controller zzqx']);
  assert.equal(none.status, 0); assert.ok(none.stdout.startsWith(`SkillNib: no sections were selected (no module matched the ask). ${ADVICE}`), none.stdout);
  const empty = mkdtempSync(join(tmpdir(), 'fow-empty-')), noStore = nib(empty, ['ask', 'anything']);
  assert.equal(noStore.status, 0); assert.match(noStore.stdout, /^SkillNib: no sections were selected \(no store found at .*\)\. Rephrase the ask/);
  const rpc = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search', arguments: { query: 'kubernetes ingress controller zzqx' } } }].map(m => JSON.stringify(m)).join('\n') + '\n';
  const mcp = nib(d, ['mcp'], rpc), res = mcp.stdout.trim().split('\n').map(l => JSON.parse(l)).find(m => m.id === 2).result;
  assert.equal(mcp.status, 0); assert.equal(res.isError, undefined); assert.ok(res.content[0].text.startsWith(`SkillNib: no sections were selected (no module matched the ask). ${ADVICE}`), res.content[0].text);
  const hook = nib(d, ['hook', 'claude'], JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'kubernetes ingress controller zzqx', cwd: d }));
  assert.equal(hook.status, 0); assert.match(hook.stdout, /no sections were selected \(no module matched the prompt\)\. Read the skill files directly/);
});

test('[fail-open-wording R3] no guide or README text has the old phrase, and the examples output is what the CLI prints', () => {
  for (const f of ['README.md', ...readdirSync(join(ROOT, 'docs/guide')).filter(x => x.endsWith('.md')).map(x => 'docs/guide/' + x)]) assert.doesNotMatch(read(f), /Load the skills normally/, f);
  assert.ok(read('docs/guide/examples.md').includes(`(no module matched the ask). ${ADVICE}`));
});

test('[fail-open-wording R4] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  for (const sub of [['lint'], ['link']]) { const r = spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), ...sub, 'docs/specs/fail-open-wording.md'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); }
});
