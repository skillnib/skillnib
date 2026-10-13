import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { USAGE } from '../src/args.js';
import { expectedFiles } from '../../../tools/release/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url)), BIN = join(here, '..', 'bin', 'nib.js'), ROOT = join(here, '..', '..', '..');
const SAMPLE = join(ROOT, 'docs/guide/sample-skills'), NO_NET = join(ROOT, 'tools/release/no-network.cjs');
const cleanEnv = () => { const e = { ...process.env, GITHUB_TOKEN: '', NODE_OPTIONS: `--require ${NO_NET}` }; delete e.NODE_TEST_CONTEXT; delete e.NIB_STORE; return e; };
const tap = (cwd, ...args) => spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8', env: cleanEnv() });
function project(withStore = true) { const d = mkdtempSync(join(tmpdir(), 'mcp-')); cpSync(SAMPLE, join(d, 'skills'), { recursive: true }); if (withStore) tap(d, 'import', './skills'); return d; }
const snapshot = d => { const o = {}; const walk = (p, rel = '') => { for (const e of readdirSync(p, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(join(p, e.name), r); else o[r] = statSync(join(p, e.name)).mtimeMs + ':' + readFileSync(join(p, e.name), 'utf8').length; } }; walk(d); return o; };
const msg = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params });

// Starts `nib mcp`, writes the given chunks (with a pause between them), ends stdin, and returns the lines, stderr and exit code.
function session(cwd, chunks, extra = []) {
  return new Promise(resolve => {
    const p = spawn('node', [BIN, 'mcp', ...extra], { cwd, env: cleanEnv() }); let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out, err, lines: out.split('\n').filter(Boolean).map(l => JSON.parse(l)) }));
    (async () => { for (const c of chunks) { p.stdin.write(c); await new Promise(r => setTimeout(r, 40)); } p.stdin.end(); })();
  });
}
const ASK = 'how should I word an error when the upload fails?';
const call = (id, name, args) => msg(id, 'tools/call', { name, arguments: args }) + '\n';

test('[tap-mcp R9] end to end: initialize, list, search, then get a reference returned by that search', async () => {
  const d = project();
  const r = await session(d, [msg(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }) + '\n', msg(null, 'notifications/initialized') + '\n', msg(2, 'tools/list') + '\n', call(3, 'search', { query: ASK })]);
  assert.equal(r.code, 0); assert.deepEqual(r.lines.map(l => l.id), [1, 2, 3]);
  assert.equal(r.lines[0].result.serverInfo.name, 'skillnib'); assert.deepEqual(r.lines[1].result.tools.map(t => t.name), ['search', 'get']);
  const text = r.lines[2].result.content[0].text; assert.match(text, /===== acme-error-copy\/acme-error-copy\/SKILL\.md :: Wording rules =====/);
  const ref = /^\s+(acme-error-copy\/acme-error-copy\/SKILL\.md#m\d+)\s/m.exec(text)[1];
  const g = await session(d, [call(1, 'get', { ref })]);
  assert.equal(g.lines[0].result.content[0].text, tap(d, 'show', ref).stdout);
});

test('[tap-mcp R3] search text equals nib ask except that the fetch hint names the get tool; no match is not an error', async () => {
  const d = project(); const ask = tap(d, 'ask', ASK, '--k', '3').stdout;
  const r = await session(d, [call(1, 'search', { query: ASK, k: 3 }), call(2, 'search', { query: 'zebra quantum' }), call(3, 'search', { query: ASK, k: 99 })]);
  const text = r.lines[0].result.content[0].text;
  assert.equal(text.replace('the get tool with ref=<ref>', 'nib show <ref>'), ask); assert.match(text, /fetch one with: the get tool with ref=<ref>/);
  assert.equal(r.lines[1].result.isError, undefined); assert.match(r.lines[1].result.content[0].text, /no sections were selected/);
  assert.equal(r.lines[2].error.code, -32602);
});

test('[tap-mcp R4] get is byte for byte what nib show prints; an unknown reference is an isError result', async () => {
  const d = project(); const ref = 'acme-error-copy/acme-error-copy/SKILL.md#m3';
  const r = await session(d, [call(1, 'get', { ref }), call(2, 'get', { ref: 'acme-error-copy/SKILL.md#m99' })]);
  assert.equal(r.lines[0].result.content[0].text, tap(d, 'show', ref).stdout);
  assert.equal(r.lines[1].result.isError, true); assert.match(r.lines[1].result.content[0].text, /search tool/);
});

test('[tap-mcp R5] a missing catalog gives isError results with the CLI message and the server keeps answering', async () => {
  const d = project(false);
  const r = await session(d, [call(1, 'search', { query: 'x' }), call(2, 'get', { ref: 'a#m1' }), msg(3, 'ping') + '\n']);
  assert.equal(r.code, 0); for (const l of r.lines.slice(0, 2)) { assert.equal(l.result.isError, true); assert.match(l.result.content[0].text, /no store found .*run "nib import" first/); }
  assert.deepEqual(r.lines[2].result, {});
});

test('[tap-mcp R6] newline-delimited transport: split messages, several per chunk, only JSON lines on stdout, exit 0 at end of input', async () => {
  const d = project(); const a = msg(1, 'ping'), b = msg(2, 'tools/list'), c = msg(3, 'ping');
  const r = await session(d, [a.slice(0, 7), a.slice(7) + '\n' + b + '\n' + c.slice(0, 5), c.slice(5) + '\n', '\n', '{bad json\n', msg(4, 'ping')]);
  assert.equal(r.code, 0); assert.deepEqual(r.lines.map(l => l.id ?? null), [1, 2, 3, null, 4]); assert.equal(r.lines[3].error.code, -32700);
  assert.ok(r.out.endsWith('\n') && r.out.split('\n').filter(Boolean).every(l => l.startsWith('{')));
  const none = await session(d, []); assert.equal(none.code, 0); assert.equal(none.out, '');
});

test('[tap-mcp R7] read-only and offline: the catalog directory is unchanged after a session and the network is blocked', async () => {
  const d = project(); const before = snapshot(join(d, '.nib'));
  const r = await session(d, [call(1, 'search', { query: ASK }), call(2, 'get', { ref: 'acme-error-copy/acme-error-copy/SKILL.md#m1' }), call(3, 'get', { ref: 'nope' })]);
  assert.equal(r.code, 0); assert.deepEqual(snapshot(join(d, '.nib')), before); assert.equal(r.err, '');
  assert.ok(!existsSync(join(d, '.claude')));
});

test('[tap-mcp R8] the protocol package is runtime-neutral and the CLI owns the I/O', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/mcp/package.json'), 'utf8'));
  assert.equal(pkg.skillnib.runtimeNeutral, true); assert.equal(pkg.dependencies, undefined);
  assert.doesNotMatch(readFileSync(join(ROOT, 'packages/mcp/src/index.js'), 'utf8'), /node:|process\.|require\(/);
  const r = spawnSync('node', [join(ROOT, 'tools/gates/check.mjs')], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() }); assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('[tap-mcp R10] usage lists nib mcp, the guide shows client configuration, the README links it, and the package ships the new files', () => {
  assert.match(USAGE, /nib mcp \[--store DIR\]/);
  const guide = readFileSync(join(ROOT, 'docs/guide/mcp.md'), 'utf8');
  for (const s of ['claude mcp add', 'Claude Desktop', 'Cursor', '"command": "nib"', '"args": ["mcp"]', '--store', 'untrusted']) assert.ok(guide.includes(s), s);
  assert.match(readFileSync(join(ROOT, 'README.md'), 'utf8'), /\]\(docs\/guide\/mcp\.md\)/);
  const files = expectedFiles(); for (const f of ['packages/mcp/package.json', 'packages/mcp/src/index.js', 'apps/cli/src/mcp.js', 'docs/guide/mcp.md']) assert.ok(files.includes(f), f);
});
