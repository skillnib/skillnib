import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync, symlinkSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve, posix } from 'node:path';
import { main } from '../src/main.js';
import { parseArgs, USAGE } from '../src/args.js';

// UPDATE_DOCS=1 npm test rewrites the example output blocks from the real CLI; otherwise they are only compared.
const UPDATE = process.env.UPDATE_DOCS === '1';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LIB = join(REPO, 'tools/release/lib.mjs'), HAS_LIB = existsSync(LIB), lib = HAS_LIB ? await import(LIB) : null, pack = () => lib.pack();
const TAP = join(REPO, 'apps/cli/bin/nib.js');
const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const GUIDE = join(REPO, 'docs/guide');
const docs = ['README.md', ...readdirSync(GUIDE).filter(f => f.endsWith('.md')).map(f => 'docs/guide/' + f)];
const read = f => readFileSync(join(REPO, f), 'utf8');

// Fenced blocks with their position, so output blocks can be rewritten in place.
function blocks(md) {
  const out = [], re = /^```([a-z]*)\n([\s\S]*?)^```$/gm; let m;
  while ((m = re.exec(md))) out.push({ lang: m[1], text: m[2], start: m.index, end: m.index + m[0].length, bodyStart: m.index + 4 + m[1].length });
  return out;
}
const words = line => (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^(["'])(.*)\1$/, '$2'));
const nibLines = text => text.split('\n').map(l => l.trim()).filter(l => /^nib(\s|$)/.test(l));

// A throwaway project: the sample skills, one note file, and `nib` on a PATH directory (a symlink to the real entry point).
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'docs-')), bin = join(dir, 'bin');
  cpSync(join(GUIDE, 'sample-skills'), join(dir, 'skills'), { recursive: true });
  writeFileSync(join(dir, 'notes.md'), '# Notes\n\n## Deploy\n\nRun make deploy.\n');
  mkdirSync(bin); symlinkSync(TAP, join(bin, 'nib'));
  return { dir, bin, run: async argv => { let out = ''; await main(argv, { stdout: { write: s => { out += s; } }, stderr: { write: s => { out += s; } }, cwd: dir, env: { PATH: bin }, nibPath: TAP }); return out.split(dir).join('<project>'); } };
}

test('[public-docs R1] README has the required headings in order, links every guide page, and every relative link is in the package',{ skip: !HAS_LIB }, () => {
  const readme = read('README.md'), heads = [...readme.matchAll(/^## (.+)$/gm)].map(m => m[1]);
  const want = ['What it is', 'Install', 'Quickstart', 'Claude Code', 'Commands', 'Safety', 'Status and limits', 'Licence'];
  let at = -1; for (const h of want) { const i = heads.indexOf(h); assert.ok(i > at, `heading ${h} missing or out of order`); at = i; }
  const packed = new Set(pack().files);
  for (const g of readdirSync(GUIDE).filter(f => f.endsWith('.md'))) assert.match(readme, new RegExp(`\\]\\(docs/guide/${g.replace('.', '\\.')}\\)`), `README does not link ${g}`);
  for (const f of docs) for (const m of read(f).matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].split('#')[0]; if (!target || /^[a-z]+:/.test(target)) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(f), target));
    assert.ok(packed.has(resolved), `${f} links ${m[1]} which is not in the package (${resolved})`);
  }
});

test('[public-docs R2] every nib command line in a sh block parses with the CLI parser and uses only listed flags', () => {
  const commands = new Set(['import', 'update', 'remove', 'ask', 'show', 'list', 'init', 'hook']); let seen = 0;
  for (const f of docs) for (const b of blocks(read(f)).filter(b => b.lang === 'sh')) for (const line of nibLines(b.text)) {
    const w = words(line).slice(1); seen++;
    if (w.length === 1 && (w[0] === '--version' || w[0] === '--help')) continue;
    assert.ok(commands.has(w[0]), `${f}: unknown command in "${line}"`);
    assert.doesNotThrow(() => parseArgs(w.slice(1)), `${f}: "${line}" does not parse`);
    for (const flag of w.filter(x => x.startsWith('--'))) assert.ok(USAGE.includes(flag.split('=')[0]), `${f}: "${line}" uses ${flag}, which the usage text does not list`);
  }
  assert.ok(seen >= 15, `only ${seen} command lines found`);
});

test('[public-docs R3] example output blocks are exactly what the real CLI prints', async () => {
  for (const f of docs) {
    let md = read(f); const bs = blocks(md); if (!bs.some(b => b.lang === 'output')) continue;
    const p = project(), edits = [];
    for (let i = 0; i < bs.length - 1; i++) {
      const b = bs[i], next = bs[i + 1];
      if (b.lang !== 'sh' || next.lang !== 'output' || md.slice(b.end, next.start).trim() !== '') continue;
      let got = ''; for (const line of nibLines(b.text)) got += await p.run(words(line).slice(1));
      got = got.trimEnd() + '\n';
      if (UPDATE) edits.push({ at: next.bodyStart, len: next.text.length, got }); else assert.equal(next.text, got, `${f}: output after "${nibLines(b.text)[0]}" differs from the real output (run UPDATE_DOCS=1 npm test)`);
    }
    if (UPDATE) { for (const e of edits.reverse()) md = md.slice(0, e.at) + e.got + md.slice(e.at + e.len); writeFileSync(join(REPO, f), md); }
  }
});

test('[public-docs R4] the ask-mode prompt in the guide is the text the product writes', async () => {
  const p = project(); await p.run(['init', 'claude', './skills', '--mode', 'ask']);
  const note = readFileSync(join(p.dir, '.claude/rules/nib.md'), 'utf8');
  const bs = blocks(read('docs/guide/agent-prompt.md')).filter(b => b.lang === 'text');
  if (UPDATE) { const md = read('docs/guide/agent-prompt.md'); writeFileSync(join(GUIDE, 'agent-prompt.md'), md.slice(0, bs[0].bodyStart) + note + md.slice(bs[0].bodyStart + bs[0].text.length)); return; }
  assert.equal(bs[0].text, note);
  const tail = s => s.slice(s.indexOf('Before a task that one of them may cover'));
  assert.equal(tail(bs[1].text.trim()), tail(note.split('\n').find(l => l.startsWith('These skills are served'))));
  assert.ok(note.includes('`nib ask "<what you need to know>"`'));
});

test('[public-docs R5] install steps name the Node version, the package name and nib --version, tied to package.json', () => {
  const readme = read('README.md'), major = /\d+/.exec(pkg.engines.node)[0];
  const install = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Quickstart'));
  assert.ok(install.includes(`Node.js ${major} or newer`), 'Node version');
  assert.ok(install.includes(`npm install -g ${pkg.name}`), 'package name');
  assert.ok(install.includes('nib --version'), 'verification step');
  assert.ok(Object.keys(pkg.bin).includes('nib'));
});

test('[public-docs R6] no unmeasured claims: no figures or comparatives outside the quoted C2 result, and C3 is said to be pending', () => {
  const readme = read('README.md'), region = /<!-- measured:c2 -->([\s\S]*?)<!-- \/measured:c2 -->/.exec(readme), c3 = /<!-- measured:c3 -->([\s\S]*?)<!-- \/measured:c3 -->/.exec(readme);
  assert.ok(region && region[1].includes('Limits:') && region[1].includes('not published here'), 'C2 statement with limits and link');
  assert.ok(c3 && c3[1].includes('Limits:') && c3[1].includes('amended after the first result was seen') && c3[1].includes('C3b') && c3[1].includes('not shown to cost less'), 'C3 statement with its limits');
  for (const f of docs) {
    const text = read(f).replace(/<!-- measured:(c2|c3|c3b) -->[\s\S]*?<!-- \/measured:(c2|c3|c3b) -->/g, '').replace(/```[\s\S]*?```/g, '');
    for (const re of [/\d+(\.\d+)?\s?%/, /\$\s?\d/, /\btokens?\b/i, /\bfaster\b/i, /\bcheap(er)?\b/i, /\bsaves?\b/i, /\bsavings\b/i]) assert.doesNotMatch(text, re, `${f} contains ${re}`);
  }
  assert.doesNotMatch(readme, /pending/);
});

test('[public-docs R7] the safety text covers untrusted skills, explicit updates checked first, init scope and undo, and the hook', () => {
  const readme = read('README.md'), safety = readme.slice(readme.indexOf('## Safety'), readme.indexOf('## Status and limits'));
  for (const s of ['third-party skills are untrusted', 'Updates are explicit', 'nib update --check', 'nib init claude --undo', 'never blocks a prompt', 'exits 0']) assert.ok(safety.includes(s), `Safety lacks "${s}"`);
  const guide = read('docs/guide/claude-code.md');
  for (const s of ['.claude/settings.local.json', '.claude/rules/nib.md', 'disable-model-invocation: true', '.nib/', '--undo']) assert.ok(guide.includes(s), `guide lacks "${s}"`);
});

test('[public-docs R8] the package ships README.md and docs/guide, and no other docs',{ skip: !HAS_LIB }, () => {
  const files = pack().files;
  assert.ok(pkg.files.includes('docs/guide'));
  for (const f of ['README.md', ...docs.slice(1), 'docs/guide/sample-skills/acme-error-copy/SKILL.md']) assert.ok(files.includes(f), f);
  assert.deepEqual(files.filter(f => f.startsWith('docs/') && !f.startsWith('docs/guide/')), []);
});

test('[readme-c3b R1] the README states the pooled and per-catalog conversation cost and the ask-turn score in one measured:c3b region', () => {
  const m = /<!-- measured:c3b -->([\s\S]*?)<!-- \/measured:c3b -->/.exec(read('README.md')); assert.ok(m, 'region');
  assert.equal((read('README.md').match(/measured:c3b -->/g) ?? []).length, 2);
  assert.ok(read('README.md').indexOf('<!-- measured:c3b -->') > read('README.md').indexOf('## Status and limits'));
  assert.match(m[1], /8-turn/); assert.match(m[1], /95% interval/); assert.match(m[1], /Cloudflare/); assert.match(m[1], /HyperFrames/); assert.match(m[1], /score on the three questions/);
});

test('[readme-c3b R2] every figure in the region equals the value in C3b-results.json', { skip: !existsSync(join(REPO, 'docs/research/C3b-results.json')) }, () => {
  const t = /<!-- measured:c3b -->([\s\S]*?)<!-- \/measured:c3b -->/.exec(read('README.md'))[1], g = JSON.parse(read('docs/research/C3b-results.json')).summary.groups;
  const f = n => n.toFixed(1), sgn = n => (n >= 0 ? '+' : '') + f(n);
  const pooled = g.pooled.contrasts['H-vs-N'], a = g.c1a.contrasts['H-vs-N'], b = g.c1b.contrasts['H-vs-N'], ask = g.pooled.contrasts['P-vs-N'];
  for (const s of [`${f(pooled.cost.reductionPct)}% less per conversation (95% interval ${f(pooled.cost.loPct)} to ${f(pooled.cost.hiPct)}`, `Cloudflare ${f(a.cost.reductionPct)}%, ${f(a.cost.loPct)} to ${f(a.cost.hiPct)}`, `HyperFrames ${f(b.cost.reductionPct)}%, ${f(b.cost.loPct)} to ${f(b.cost.hiPct)}`, `${sgn(pooled.askScore.diff)} points (${sgn(pooled.askScore.lo)} to ${sgn(pooled.askScore.hi)})`, `Ask mode cost ${f(ask.cost.reductionPct)}% less (${f(ask.cost.loPct)} to ${f(ask.cost.hiPct)})`]) assert.ok(t.includes(s), `README lacks "${s}"`);
});

test('[readme-c3b R3] ask mode and the comparison: no difference between auto and ask is claimed, and neither is called cheaper or better than the other', { skip: !existsSync(join(REPO, 'docs/research/C3b-results.json')) }, () => {
  const t = /<!-- measured:c3b -->([\s\S]*?)<!-- \/measured:c3b -->/.exec(read('README.md'))[1], g = JSON.parse(read('docs/research/C3b-results.json')).summary.groups.pooled.contrasts['H-vs-P'];
  assert.ok(g.cost.loPct < 0 && g.cost.hiPct > 0 && g.askScore.lo < 0 && g.askScore.hi > 0, 'the results file shows no difference');
  assert.match(t, /not shown to differ in cost or in score/); assert.doesNotMatch(t, /\b(cheaper|better|faster)\b/i);
});

test('[readme-c3b R4] the region states the limits and links the results record', () => {
  const t = /<!-- measured:c3b -->([\s\S]*?)<!-- \/measured:c3b -->/.exec(read('README.md'))[1];
  for (const s of ['Limits:', 'scripted', 'generic follow-ups', 'eight turns', 'two catalogs', 'one model', 'one Claude Code build', 'skipped skills in a fifth to a third', 'a few tenths of a dollar', 'not published here']) assert.ok(t.includes(s), s);
});

test('[readme-c3b R5] the C3 region no longer calls conversation cost unmeasured, and figures stay banned outside the measured regions', () => {
  const readme = read('README.md'); assert.doesNotMatch(readme, /has not been measured/);
  const outside = readme.replace(/<!-- measured:(c2|c3|c3b) -->[\s\S]*?<!-- \/measured:(c2|c3|c3b) -->/g, '').replace(/```[\s\S]*?```/g, '');
  for (const re of [/\d+(\.\d+)?\s?%/, /\btokens?\b/i, /\bfaster\b/i, /\bcheap(er)?\b/i]) assert.doesNotMatch(outside, re);
});
