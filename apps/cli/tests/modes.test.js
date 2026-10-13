import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';
import { USAGE } from '../src/args.js';

const here = dirname(fileURLToPath(import.meta.url)), bin = join(here, '..', 'bin', 'nib.js');
const FIX = join(here, '../../../docs/research/R2b-smoke/skills');
async function tap(cwd, argv) {
  let out = '', err = '';
  const code = await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, cwd, env: { GITHUB_TOKEN: '', HOME: join(cwd, '.nohome'), PATH: '/usr/bin' }, nibPath: bin });
  return { code, out: out.split(cwd).join('<p>'), err };
}
const project = () => { const d = mkdtempSync(join(tmpdir(), 'modes-')); cpSync(FIX, join(d, '.claude', 'skills'), { recursive: true }); return d; };
const tree = d => { const o = {}; const walk = (p, rel = '') => { for (const e of readdirSync(p, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(join(p, e.name), r); else if (!r.startsWith('.nib/')) o[r] = readFileSync(join(p, e.name), 'utf8').split(d).join('<p>'); } }; walk(d); return o; };
const RULES = d => join(d, '.claude', 'rules', 'nib.md');

test('[mode-names R1] auto and ask equal hook and pull; other values exit 2 and list the names', async () => {
  for (const [a, b] of [['auto', 'hook'], ['ask', 'pull']]) {
    const x = project(), y = project();
    const rx = await tap(x, ['init', 'claude', '--mode', a]), ry = await tap(y, ['init', 'claude', '--mode', b]);
    assert.equal(rx.code, 0, rx.err); assert.equal(ry.code, 0); assert.deepEqual(tree(x), tree(y)); assert.equal(rx.out.replace(/x/g, ''), ry.out.replace(/x/g, ''));
  }
  const bad = await tap(project(), ['init', 'claude', '--mode', 'hook-ish']);
  assert.equal(bad.code, 2); assert.match(bad.err, /--mode must be auto or ask \(hook and pull are accepted as aliases\)/);
});

test('[mode-names R2] without --mode the mode is auto, and the plan and summary say so by name', async () => {
  const d = project();
  const plan = await tap(d, ['init', 'claude', '--dry-run']); assert.match(plan.out, /\(mode auto\)/);
  const r = await tap(d, ['init', 'claude']); assert.match(r.out, /^Mode: auto /m); assert.ok(existsSync(join(d, '.claude/settings.local.json'))); assert.ok(!existsSync(RULES(d)));
});

test('[mode-names R3] usage, plan, summary and the rules header name the modes auto and ask, never hook mode or pull mode', async () => {
  assert.match(USAGE, /--mode auto\|ask/); assert.doesNotMatch(USAGE, /hook\|pull/);
  const d = project(); const dry = await tap(d, ['init', 'claude', '--mode', 'ask', '--dry-run']); assert.match(dry.out, /\(mode ask\)/);
  const r = await tap(d, ['init', 'claude', '--mode', 'ask']); assert.match(r.out, /^Mode: ask /m);
  const note = readFileSync(RULES(d), 'utf8'); assert.match(note.split('\n')[0], /`nib init claude --mode ask`/);
  assert.match(note, /Before a task that one of them may cover, run `[^`]*ask "<what you need to know>"` with the Bash tool/);
  for (const text of [dry.out, r.out, note, USAGE]) assert.doesNotMatch(text, /\b(hook|pull)[- ]mode\b/i);
});

test('[mode-names R4] projects initialised with the old names switch, re-run and undo with the new names, and the reverse', async () => {
  const d = project(); const before = tree(d);
  await tap(d, ['init', 'claude', '--mode', 'pull']);
  assert.equal(JSON.parse(readFileSync(join(d, '.nib/init-claude.json'), 'utf8')).mode, 'pull');
  await tap(d, ['init', 'claude', '--mode', 'auto']); assert.ok(!existsSync(RULES(d)));
  await tap(d, ['init', 'claude', '--mode', 'ask']); assert.ok(existsSync(RULES(d)));
  const again = await tap(d, ['init', 'claude', '--mode', 'ask']); assert.equal(again.code, 0);
  const undo = await tap(d, ['init', 'claude', '--undo']); assert.equal(undo.code, 0);
  assert.deepEqual(tree(d), { ...before, ...{} });
  const e = project(); await tap(e, ['init', 'claude', '--mode', 'auto']); await tap(e, ['init', 'claude', '--mode', 'pull']); assert.ok(existsSync(RULES(e)));
  await tap(e, ['init', 'claude', '--mode', 'hook']); assert.ok(!existsSync(RULES(e)));
});
