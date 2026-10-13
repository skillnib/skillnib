import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url)), cli = join(here, '..', 'speclink.mjs'), checkCli = join(here, '..', 'check.mjs');
const SPEC = status => `# Spec: demo\n\nStatus: ${status}\nSpec-ID: demo\nScope: packages/demo/**\n\n## Purpose\np\n## Non-goals\nn\n## Requirements\n- R1 adds\n- R2 subtracts\n## Size and safety\ns\n`;
const cleanEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; };
const sh = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: cleanEnv() });
const git = (cwd, ...a) => sh(cwd, 'git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a]);
const put = (dir, f, text) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); };
const TESTS = (r2 = 'assert.equal(1 - 1, 0)') => `import test from 'node:test'; import assert from 'node:assert/strict';\ntest('[demo R1] adds', () => assert.equal(1 + 2, 3));\ntest('[demo R2] subtracts', () => { ${r2}; });\n`;

function fixture(status = 'APPROVED') {
  const d = mkdtempSync(join(tmpdir(), 'gates-'));
  git(d, 'init', '-q', '-b', 'main'); put(d, 'docs/specs/demo.md', SPEC(status)); put(d, 'README.md', 'x');
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base'); git(d, 'checkout', '-qb', 'feat');
  put(d, 'packages/demo/tests/d.test.js', TESTS());
  return d;
}
const verify = d => sh(d, 'node', [cli, 'verify', 'docs/specs/demo.md', '--base', 'main']);
const commit = d => { git(d, 'add', '-A'); git(d, 'commit', '-qm', 'work'); };

test('[spec-gates R5] verify passes only after approval, link, covering passing tests, and an in-scope diff', () => {
  const d = fixture();
  assert.equal(sh(d, 'node', [cli, 'link', 'docs/specs/demo.md', '--update']).status, 0);
  commit(d);
  const r = verify(d); assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /R1 adds \| VERIFIED/);
});
test('[spec-gates R5] verify refuses a DRAFT spec, a missing link, a drifted requirement', () => {
  const draft = fixture('DRAFT'); commit(draft);
  assert.match(verify(draft).stderr, /not APPROVED|Status is DRAFT/);
  const nolink = fixture(); commit(nolink); assert.match(verify(nolink).stderr, /no link file/);
  const drift = fixture(); sh(drift, 'node', [cli, 'link', 'docs/specs/demo.md', '--update']);
  put(drift, 'docs/specs/demo.md', SPEC('APPROVED').replace('adds', 'adds numbers')); commit(drift);
  assert.match(verify(drift).stderr, /R1 text changed/);
});
test('[spec-gates R5] verify refuses an uncovered requirement, a failing test, and a file outside Scope', () => {
  const unc = fixture(); sh(unc, 'node', [cli, 'link', 'docs/specs/demo.md', '--update']);
  put(unc, 'packages/demo/tests/d.test.js', TESTS().split('\n').slice(0, 2).join('\n') + '\n'); commit(unc);
  assert.match(verify(unc).stderr, /R2 UNCOVERED/);
  const bad = fixture(); sh(bad, 'node', [cli, 'link', 'docs/specs/demo.md', '--update']);
  put(bad, 'packages/demo/tests/d.test.js', TESTS('assert.equal(1, 2)')); commit(bad);
  assert.match(verify(bad).stderr, /R2 FAILING/);
  const stray = fixture(); sh(stray, 'node', [cli, 'link', 'docs/specs/demo.md', '--update']); put(stray, 'AGENTS.md', 'changed'); commit(stray);
  assert.match(verify(stray).stderr, /outside scope: AGENTS\.md/);
});
test('[spec-gates R5] link --update refuses a DRAFT spec', () => {
  const d = fixture('DRAFT'); const r = sh(d, 'node', [cli, 'link', 'docs/specs/demo.md', '--update']);
  assert.equal(r.status, 1); assert.match(r.stderr, /not APPROVED/);
});
test('[spec-gates R6] check rejects a runtime-neutral package that has dependencies or imports node: modules', () => {
  const d = mkdtempSync(join(tmpdir(), 'gates-'));
  put(d, 'packages/p/package.json', JSON.stringify({ name: 'p', skillnib: { runtimeNeutral: true }, dependencies: { x: '1' } }));
  put(d, 'packages/p/src/a.js', "import { readFile } from 'node:fs/promises';\n");
  const r = sh(d, 'node', [checkCli]); assert.equal(r.status, 1);
  assert.match(r.stderr, /declares dependencies/); assert.match(r.stderr, /Node-only module/);
  put(d, 'packages/p/package.json', JSON.stringify({ name: 'p', skillnib: { runtimeNeutral: true } })); put(d, 'packages/p/src/a.js', 'export const a = 1;\n');
  assert.equal(sh(d, 'node', [checkCli]).status, 0);
});
test('[spec-gates R7] the CI workflow runs check, test, and verify, and the PR template asks for the spec link', () => {
  const wf = readFileSync(join(here, '../../../.github/workflows/gates.yml'), 'utf8');
  for (const s of ['npm run check', 'npm test', 'speclink.mjs verify', 'fetch-depth: 0']) assert.ok(wf.includes(s), 'workflow lacks: ' + s);
  assert.ok(readFileSync(join(here, '../../../.github/pull_request_template.md'), 'utf8').includes('Spec: docs/specs/'));
});
