import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { addHookEntry, removeHookEntry, hideSkill, unhideSkill, hookCommand, portableHookCommand, sha256 } from '../src/index.js';

const CMD = hookCommand('/abs/nib.js');

test('[claude-code-init R3] the hook entry is added once, keeps every other setting and hook, updates a stale path, and rejects non-objects', () => {
  const other = { permissions: { allow: ['Bash(ls)'] }, hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } };
  const a = addHookEntry(other, CMD);
  assert.equal(a.changed, true); assert.deepEqual(a.settings.permissions, other.permissions); assert.deepEqual(a.settings.hooks.Stop, other.hooks.Stop);
  assert.equal(a.settings.hooks.UserPromptSubmit.length, 2); assert.deepEqual(a.settings.hooks.UserPromptSubmit[1].hooks[0], { type: 'command', command: CMD, timeout: 30 });
  assert.deepEqual(other.hooks.UserPromptSubmit.length, 1); // input not mutated
  const again = addHookEntry(a.settings, CMD); assert.equal(again.changed, false); assert.deepEqual(again.settings, a.settings);
  const moved = addHookEntry(a.settings, hookCommand('/new/place/nib.js'));
  assert.equal(moved.changed, true); assert.equal(moved.settings.hooks.UserPromptSubmit.length, 2); assert.equal(moved.settings.hooks.UserPromptSubmit[1].hooks[0].command, 'node "/new/place/nib.js" hook claude');
  assert.deepEqual(addHookEntry(undefined, CMD).settings, { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: CMD, timeout: 30 }] }] } });
  for (const bad of [[], 'x', 5, null]) assert.throws(() => addHookEntry(bad, CMD), TypeError);
  assert.throws(() => addHookEntry({ hooks: [] }, CMD), TypeError); assert.throws(() => addHookEntry({ hooks: { UserPromptSubmit: {} } }, CMD), TypeError);
});

test('[claude-code-init R4] hiding adds or changes exactly one front matter line and leaves everything else byte for byte', () => {
  const body = '# Title\n\nText with --- inside\n';
  const cases = {
    plain: `---\nname: a\ndescription: d\n---\n${body}`,
    crlf: `---\r\nname: a\r\ndescription: d\r\n---\r\n${body.replace(/\n/g, '\r\n')}`,
    false: `---\nname: a\ndisable-model-invocation: false\ndescription: d\n---\n${body}`,
    spaced: `---\nname: a\ndisable-model-invocation:   false  \n---\n${body}`,
  };
  for (const [name, md] of Object.entries(cases)) {
    const { text, change } = hideSkill(md);
    const before = md.split('\n'), after = text.split('\n');
    assert.ok(text.includes('disable-model-invocation: true'), name);
    if (change.kind === 'added') { assert.equal(after.length, before.length + 1, name); assert.deepEqual(after.filter((_, i) => i !== change.index), before, name); }
    else { assert.equal(after.length, before.length, name); assert.deepEqual(after.filter((_, i) => i !== change.index), before.filter((_, i) => i !== change.index), name); }
    assert.equal(unhideSkill(text, change), md, name);
  }
  assert.equal(hideSkill(cases.plain).change.kind, 'added'); assert.equal(hideSkill(cases.false).change.kind, 'changed');
  const already = `---\nname: a\ndisable-model-invocation: true\n---\nx\n`;
  assert.deepEqual(hideSkill(already), { text: already, change: { kind: 'none' } });
  const none = '# no front matter\n'; assert.deepEqual(hideSkill(none), { text: none, change: { kind: 'no-front-matter' } });
  assert.deepEqual(hideSkill('---\nname: a\nbody never closes\n'), { text: '---\nname: a\nbody never closes\n', change: { kind: 'no-front-matter' } });
});

test('[claude-code-init R5] removal drops only the SkillNib entry and the containers it emptied, and unhide refuses a file that no longer matches', () => {
  const other = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } };
  const added = addHookEntry(other, CMD).settings;
  assert.deepEqual(removeHookEntry(added).settings, other);
  const only = addHookEntry(undefined, CMD).settings;
  assert.deepEqual(removeHookEntry(only), { settings: {}, removed: true });
  assert.deepEqual(removeHookEntry({ a: 1 }), { settings: { a: 1 }, removed: false });
  assert.equal(removeHookEntry(removeHookEntry(only).settings).removed, false);
  const hidden = hideSkill('---\nname: a\n---\nx\n');
  assert.equal(unhideSkill(hidden.text.replace('disable-model-invocation: true', 'disable-model-invocation: maybe'), hidden.change), null);
  assert.equal(unhideSkill('no front matter', hidden.change), null);
  assert.equal(unhideSkill('x', { kind: 'none' }), 'x');
});

test('[claude-code-init R8] the claude package has no dependencies and imports nothing, and does no I/O', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.skillnib.runtimeNeutral, true);
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
    assert.deepEqual([...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]), []);
    assert.ok(!/\bprocess\b|\bBuffer\b|require\(|console\./.test(src));
  }
  assert.match(await sha256('a'), /^ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb$/);
});

test('[shared-portable-hook R3] both command forms are SkillNib\'s entry: swapped in place, removed, and lookalikes left alone', () => {
  const abs = hookCommand('/abs/nib.js'), plain = portableHookCommand;
  assert.equal(plain, 'nib hook claude');
  const a = addHookEntry(undefined, abs).settings, toPlain = addHookEntry(a, plain);
  assert.equal(toPlain.changed, true); assert.equal(toPlain.settings.hooks.UserPromptSubmit.length, 1); assert.equal(toPlain.settings.hooks.UserPromptSubmit[0].hooks[0].command, plain);
  const back = addHookEntry(toPlain.settings, abs); assert.equal(back.settings.hooks.UserPromptSubmit.length, 1); assert.equal(back.settings.hooks.UserPromptSubmit[0].hooks[0].command, abs);
  assert.equal(addHookEntry(toPlain.settings, plain).changed, false);
  for (const c of [abs, plain]) { const r = removeHookEntry(addHookEntry(undefined, c).settings); assert.equal(r.removed, true); assert.deepEqual(r.settings, {}); }
  const lookalikes = ['nib hook other', 'echo nib hook claude', 'node nib.js hook claude', 'nib hook claude --x', 'mynib hook claude'];
  const other = { hooks: { UserPromptSubmit: lookalikes.map(command => ({ hooks: [{ type: 'command', command }] })) } };
  const kept = removeHookEntry(other); assert.equal(kept.removed, false); assert.deepEqual(kept.settings, other);
  const added = addHookEntry(other, plain); assert.equal(added.settings.hooks.UserPromptSubmit.length, lookalikes.length + 1);
});
