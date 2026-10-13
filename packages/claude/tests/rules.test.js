import test from 'node:test';
import assert from 'node:assert/strict';
import { frontMatterField, renderRulesFile, RULES_HEADER, DESCRIPTION_MAX } from '../src/index.js';

const md = d => `---\nname: x\ndescription: ${d}\n---\nbody\n`;

test('[claude-code-pull R2] descriptions come from front matter in plain, quoted and block forms, and are null when absent', () => {
  assert.equal(frontMatterField(md('How Acme writes notes.'), 'description'), 'How Acme writes notes.');
  assert.equal(frontMatterField(md('"Quoted: with colon"'), 'description'), 'Quoted: with colon');
  assert.equal(frontMatterField("---\nname: x\ndescription: >\n  first line\n  second line\nother: 1\n---\n", 'description'), 'first line second line');
  assert.equal(frontMatterField('---\nname: x\n---\n', 'description'), null);
  assert.equal(frontMatterField('no front matter', 'description'), null);
  assert.equal(frontMatterField('---\r\nname: x\r\ndescription: crlf value\r\n---\r\n', 'description'), 'crlf value');
});

test('[claude-code-pull R2] the rules file has the header, the sentence, the instruction, the command and one line per skill; it is deterministic', () => {
  const skills = [{ name: 'acme-a', description: 'Does A.' }, { name: 'acme-b', description: null }];
  const a = renderRulesFile({ command: 'nib', skills }), b = renderRulesFile({ command: 'nib', skills });
  assert.equal(a, b); assert.ok(a.startsWith(RULES_HEADER));
  assert.match(a, /These skills are served by SkillNib and are not loaded by Claude Code on its own\./);
  assert.match(a, /run `nib ask "<what you need to know>"` with the Bash tool/); assert.match(a, /`nib show <ref>`/); assert.match(a, /Do not answer such tasks from memory\./);
  assert.match(a, /\n- acme-a: Does A\.\n- acme-b\n$/);
  assert.match(renderRulesFile({ command: 'node "/a b/nib.js"', skills }), /run `node "\/a b\/nib\.js" ask "<what you need to know>"`/);
});

test('[claude-code-pull R2] long descriptions are cut and a long list stays under 3,000 characters with a visible count', () => {
  const long = renderRulesFile({ command: 'nib', skills: [{ name: 's', description: 'x'.repeat(500) }] });
  const line = long.split('\n').find(l => l.startsWith('- s: '));
  assert.equal(line.length, '- s: '.length + DESCRIPTION_MAX); assert.ok(line.endsWith('...'));
  const skills = Array.from({ length: 400 }, (_, i) => ({ name: `skill-${i}`, description: 'A description of moderate length for the skill list entry.' }));
  const big = renderRulesFile({ command: 'nib', skills });
  assert.ok(big.length <= 3000, `${big.length}`); assert.match(big, /- \.\.\. and \d+ more skills; run `nib list` to see them\.\n$/);
  const shown = (big.match(/^- skill-/gm) ?? []).length, more = Number(/and (\d+) more/.exec(big)[1]);
  assert.equal(shown + more, 400);
  assert.match(renderRulesFile({ command: 'nib', skills: skills.slice(0, 3) }), /skill-2: A description/);
  assert.ok(!/ more skill/.test(renderRulesFile({ command: 'nib', skills: skills.slice(0, 3) })));
  assert.ok(!big.includes('Skill instruction') && !/body/.test(big));
});

test('[claude-code-pull R8] the claude package stays pure: no imports, no I/O', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
    assert.deepEqual([...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]), []);
    assert.ok(!/\bprocess\b|\bBuffer\b|require\(|console\./.test(src));
  }
});
