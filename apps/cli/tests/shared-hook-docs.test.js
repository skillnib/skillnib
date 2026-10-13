import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const gate = (...a) => spawnSync('node', [join(ROOT, 'tools/gates/speclink.mjs'), ...a], { cwd: ROOT, encoding: 'utf8' });

test('[shared-portable-hook R6] the guide and the README say what --shared writes, what teammates need, and that .nib stays uncommitted, and no longer call the shared path wrong', () => {
  const guide = read('docs/guide/claude-code.md'), readme = read('README.md');
  for (const [name, text] of [['guide', guide], ['README', readme]]) {
    assert.match(text, /--shared/, name); assert.match(text, /nib hook claude/, name + ' names the command'); assert.match(text, /\.nib\/.*\.gitignore|\.gitignore/, name + ' keeps .nib out of version control');
  }
  assert.match(guide, /npm install -g skillnib/); assert.match(guide, /same sources|imports the same/); assert.match(guide, /fails open/);
  assert.doesNotMatch(guide, /would give teammates a path that is not theirs/);
  assert.doesNotMatch(readme, /because the hook holds a machine-specific path/);
});

test('[shared-portable-hook R7] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  const lint = gate('lint', 'docs/specs/shared-portable-hook.md'); assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  const link = gate('link', 'docs/specs/shared-portable-hook.md'); assert.equal(link.status, 0, link.stdout + link.stderr);
});

test('[init-rejects-store R3] the usage text, the README and the importing guide say init claude rejects --store and none says it ignores the flag', async () => {
  const { USAGE } = await import('../src/args.js');
  for (const [name, text] of [['usage', USAGE], ['README', read('README.md')], ['importing', read('docs/guide/importing.md')]]) {
    assert.match(text, /rejects `?--store`?/, name); assert.match(text, /<project>\/\.nib/, name); assert.doesNotMatch(text, /ignores `?--store/, name);
  }
});

test('[init-rejects-store R4] the spec lints and its recorded link still matches the approved requirements', { skip: !existsSync(join(ROOT, 'tools/gates/speclink.mjs')) }, () => {
  const lint = gate('lint', 'docs/specs/init-rejects-store.md'); assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  const link = gate('link', 'docs/specs/init-rejects-store.md'); assert.equal(link.status, 0, link.stdout + link.stderr);
});
