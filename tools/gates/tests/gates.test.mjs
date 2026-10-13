import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, lintSpec, requirementHashes, lockDrift, testTags, parseJunit, verifyLinks, outOfScope } from '../lib.mjs';

const SPEC = `# Spec: x

Status: APPROVED by user
Spec-ID: demo
Scope: packages/demo/**

## Purpose
p
## Non-goals
n
## Requirements
- R1 First thing
  continued line
- R2 Second thing
## Size and safety
s
`;
const spec = parseSpec(SPEC);

test('[spec-gates R1] parses header, sections and multi-line requirements', () => {
  assert.equal(spec.specId, 'demo'); assert.equal(spec.status, 'APPROVED'); assert.deepEqual(spec.scope, ['packages/demo/**']);
  assert.equal(spec.requirements.length, 2); assert.equal(spec.requirements[0].text, 'First thing continued line');
  assert.deepEqual(lintSpec(spec), []);
});
test('[spec-gates R1] lint rejects missing pieces and misnumbered ids', () => {
  const bad = parseSpec('# s\n\nStatus: maybe\n\n## Requirements\n- R2 x\n');
  const m = lintSpec(bad).join('\n');
  for (const frag of ['Spec-ID', 'Status', 'Scope', 'Purpose', 'R1..Rn']) assert.match(m, new RegExp(frag));
});
test('[spec-gates R2] link drift detects changed, new and removed requirements', () => {
  const lock = { specId: 'demo', requirements: requirementHashes(spec) };
  assert.deepEqual(lockDrift(spec, lock), []);
  const edited = parseSpec(SPEC.replace('Second thing', 'Second thing, stricter'));
  assert.match(lockDrift(edited, lock)[0], /R2 text changed/);
  assert.match(lockDrift(parseSpec(SPEC + '- R3 more\n'.replace('- R3', '- R3')), { ...lock, requirements: { R1: lock.requirements.R1 } }).join(), /R2 is new/);
  assert.match(lockDrift(spec, { ...lock, requirements: { ...lock.requirements, R9: 'x' } }).join(), /R9 was removed/);
  assert.match(lockDrift(spec, null)[0], /no link file/);
});
test('[spec-gates R3] test tags parse single and multiple ids, ignoring other specs', () => {
  assert.deepEqual(testTags('[demo R1] does a', 'demo'), ['R1']);
  assert.deepEqual(testTags('[demo R1 R3] does a', 'demo'), ['R1', 'R3']);
  assert.deepEqual(testTags('[other R1] x', 'demo'), []);
});
test('[spec-gates R3] junit parsing marks fail, skip and pass', () => {
  const xml = `<testsuites><testcase name="[demo R1] a &amp; b" time="0"/><testcase name="[demo R2] c"><failure message="x"/></testcase><testcase name="d"><skipped/></testcase></testsuites>`;
  assert.deepEqual(parseJunit(xml).map(r => r.status), ['pass', 'fail', 'skip']);
  assert.equal(parseJunit(xml)[0].name, '[demo R1] a & b');
});
test('[spec-gates R3] a requirement is verified only by at least one tagged passing test and nothing failing or skipped', () => {
  const ok = verifyLinks(spec, [{ name: '[demo R1] a', status: 'pass' }, { name: '[demo R2] b', status: 'pass' }]);
  assert.deepEqual(ok.problems, []);
  const bad = verifyLinks(spec, [{ name: '[demo R1] a', status: 'pass' }, { name: '[demo R1] a2', status: 'fail' }, { name: '[demo R7] z', status: 'pass' }]);
  assert.match(bad.problems.join('\n'), /R1 FAILING/); assert.match(bad.problems.join('\n'), /R2 UNCOVERED/); assert.match(bad.problems.join('\n'), /unknown requirement R7/);
  assert.match(verifyLinks(spec, [{ name: '[demo R1 R2] a', status: 'skip' }]).problems.join(), /R1 SKIPPED/);
});
test('[spec-gates R4] scope gate allows scope globs, the spec and its link file, and flags the rest', () => {
  const stray = outOfScope(['packages/demo/src/a.js', 'packages/demo/tests/a.test.js', 'docs/specs/demo.md', 'docs/specs/demo.speclink.json', 'AGENTS.md', 'packages/other/x.js'], spec, 'docs/specs/demo.md');
  assert.deepEqual(stray, ['AGENTS.md', 'packages/other/x.js']);
});
