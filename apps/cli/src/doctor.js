import { readFile, stat } from 'node:fs/promises';
import { join, resolve, delimiter } from 'node:path';
import { UsageError } from './args.js';
import { loadStore, resolveStore, StoreError } from './store.js';
import { deriveSources, searchableSkills, sourceLabel } from '../../../packages/import/src/index.js';
import { createBm25Retriever, corpusFromCatalog } from '../../../packages/retrieve/src/index.js';
import { catalogEntries } from '../../../packages/deliver/src/index.js';
import { isSkillNibCommand, RULES_PATH } from '../../../packages/claude/src/index.js';

const exists = p => stat(p).then(s => s, () => null);
const EXTS = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
const onPath = async (name, env) => {
  for (const d of (env?.PATH ?? '').split(delimiter).filter(Boolean)) for (const x of EXTS) {
    const f = join(d, name + x);
    if ((await exists(f))?.isFile()) return f;
  }
  return null;
};
// A command SkillNib wrote: `node "<abs path>" ...` needs that file and node; `nib ...` needs nib on the PATH.
async function commandProblem(command, env) {
  const abs = /^node\s+"([^"]*)"/.exec(command)?.[1];
  if (abs) return (await exists(abs)) ? ((await onPath('node', env)) ? null : { level: 'warn', abs, why: 'starts with node, which is not on this PATH' }) : { level: 'fail', abs, why: 'runs a file that no longer exists (a Node or nvm change moved nib)' };
  return (await onPath('nib', env)) ? null : { level: 'fail', why: 'runs nib from the PATH, and no nib is on this PATH' };
}

// `nib doctor`: read-only checks of the things that fail without a sound. It never writes, never uses the network and never
// runs a command found in a settings file; it only checks that the files such a command needs are still there.
export async function cmdDoctor(args, io) {
  if (args.positionals.length) throw new UsageError('doctor takes no arguments');
  const project = resolve(io.cwd, args.flags['--project'] ?? '.'), storeDir = args.flags['--store'] || io.env?.NIB_STORE ? resolveStore({ flag: args.flags['--store'], env: io.env, cwd: io.cwd }) : resolveStore({ cwd: project });
  const checks = [], add = (level, id, title, fix) => checks.push({ level, id, title, ...(fix ? { fix } : {}) });

  const major = Number(process.versions.node.split('.')[0]);
  major >= 22 ? add('ok', 'node', `Node ${process.versions.node} (the one running nib)`) : add('fail', 'node', `Node ${process.versions.node} is too old; nib needs Node 22 or newer`, 'Install Node 22+ and reinstall nib (npm install -g skillnib).');

  let store = null;
  try { store = await loadStore(storeDir); }
  catch (e) {
    if (!(e instanceof StoreError)) throw e;
    add('fail', 'catalog', e.code === 'missing' ? `No catalog at ${storeDir}` : e.message, e.code === 'missing' ? 'Import skills: nib import <source>, or nib init claude <source>.' : 'Import again with --replace: nib import <source> --replace.');
  }
  if (store) {
    const sources = deriveSources(store), n = store.skills.length;
    n ? add('ok', 'catalog', `Catalog: ${n} skill${n === 1 ? '' : 's'} from ${sources.length} source${sources.length === 1 ? '' : 's'} in ${storeDir}`) : add('warn', 'catalog', `The catalog at ${storeDir} has no skills`, 'Import skills: nib import <source>.');
    for (const k of searchableSkills(store).skills.filter(k => /~\d+$/.test(k.id))) add('warn', 'conflict', `Two sources provide different skills called "${k.id.replace(/~\d+$/, '')}"; both stay searchable, the later one as ${k.id}`, 'Remove one source if you only want one: nib remove <source>.');
    for (const s of sources) if (s.kind !== 'github' && !(await exists(resolve(project, s.location)))) add('warn', 'source', `${sourceLabel(s)} is gone from disk; its stored copy is still searched but nib update cannot refresh it`, `Restore the ${s.kind === 'dir' ? 'folder' : 'file'}, or remove it: nib remove ${sourceLabel(s)}.`);
    const entries = n ? catalogEntries(searchableSkills(store)) : [];
    if (entries.length) {
      const ask = `${entries[0].skill} ${entries[0].title}`;
      try {
        const hits = await (await createBm25Retriever(corpusFromCatalog(searchableSkills(store)))).search(ask, { k: 4 });
        hits.length ? add('ok', 'search', `Search works: "${ask}" returns ${hits.length} section${hits.length === 1 ? '' : 's'}`) : add('warn', 'search', `Search returned nothing for "${ask}", a title from your own catalog`, 'Run nib ask with words from a skill and check nib list.');
      } catch (e) { add('fail', 'search', `Search failed: ${e.message}`, 'Import again with --replace.'); }
    }
  }

  // Claude Code wiring: the hook entries in the project's settings and the files they need.
  const hooks = [];
  for (const name of ['settings.json', 'settings.local.json']) {
    const file = join(project, '.claude', name), raw = await readFile(file, 'utf8').catch(() => null);
    if (raw === null) continue;
    let settings; try { settings = JSON.parse(raw); } catch (e) { add('fail', 'settings', `${file} is not valid JSON (${e.message}); Claude Code ignores its hooks`, 'Fix the JSON, then run nib doctor again.'); continue; }
    for (const g of Array.isArray(settings?.hooks?.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : []) for (const h of Array.isArray(g?.hooks) ? g.hooks : []) if (h?.type === 'command' && isSkillNibCommand(h.command)) hooks.push({ file, command: h.command });
  }
  let record = null;
  const recordFile = join(project, '.nib', 'init-claude.json'), rawRecord = await readFile(recordFile, 'utf8').catch(() => null);
  if (rawRecord !== null) { try { record = JSON.parse(rawRecord); if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('not an object'); } catch (e) { record = null; add('fail', 'record', `${recordFile} is not valid (${e.message}); nib init --undo and doctor cannot tell what was set up`, 'Run again: nib init claude <source>.'); } }
  const redo = 'Run again: nib init claude <source> (add --shared if the hook is committed).';
  for (const { file, command } of hooks) {
    const p = await commandProblem(command, io.env);
    if (!p) add('ok', 'hook', `Hook in ${file} ${/^node/.test(command) ? `points at ${/"([^"]*)"/.exec(command)[1]}, which exists` : 'uses nib from the PATH'}`);
    else if (p.level === 'warn') add('warn', 'hook', `The hook in ${file} ${p.why}; check that Claude Code can find node`, 'Start Claude Code from a shell where node works.');
    else add('fail', 'hook', `The hook in ${file} ${p.abs ? `runs ${p.abs}, which no longer exists (a Node or nvm change moved nib); Claude Code now adds no skill text and says nothing` : `${p.why}; the prompt goes through unchanged`}`, p.abs ? redo : 'Install nib (npm install -g skillnib) on every machine that uses this project.');
  }
  if (record?.mode === 'pull') {
    const rules = join(project, ...RULES_PATH);
    const cp = record.command ? await commandProblem(record.command, io.env) : null;
    if (cp && await exists(rules)) add(cp.level, 'rules', `Ask mode: the command in ${rules} ${cp.abs ? `runs ${cp.abs}, which no longer exists` : cp.why}; the agent's nib ask fails`, redo.replace('<source>', '<source> --mode ask'));
    if (hooks.length) add('warn', 'hook', 'Ask mode is set up, but a SkillNib hook is still in the settings, so text can arrive twice', 'Run again: nib init claude <source> --mode ask.');
    (await exists(rules)) ? (cp ? 0 : add('ok', 'rules', `Ask mode: ${rules} exists`)) : add('fail', 'rules', `Ask mode was set up but ${rules} is gone, so Claude is not told to run nib ask`, redo.replace('<source>', '<source> --mode ask'));
  } else if (!hooks.length) {
    record ? add('fail', 'hook', 'nib init recorded a hook, but neither .claude/settings.json nor .claude/settings.local.json has it now', redo)
      : add('warn', 'hook', 'This project is not wired to Claude Code (no nib hook in .claude/settings.json or settings.local.json)', 'Wire it: nib init claude <source>.');
  }
  for (const h of Array.isArray(record?.hidden) ? record.hidden : []) if (!(await exists(h.path))) add('warn', 'hidden', `A project skill that init hid is gone: ${h.path}`, 'Run nib init claude --undo, then init again.');

  const fails = checks.filter(c => c.level === 'fail').length, warns = checks.filter(c => c.level === 'warn').length;
  if (args.flags['--json']) io.stdout.write(JSON.stringify({ format: 1, project, store: storeDir, ok: !fails, checks }, null, 2) + '\n');
  else {
    const out = [`nib doctor  ${project}`];
    for (const c of checks) { out.push(`${c.level === 'ok' ? 'ok  ' : c.level === 'warn' ? 'warn' : 'FAIL'}  ${c.title}`); if (c.fix) out.push(`      fix: ${c.fix}`); }
    out.push(fails ? `${fails} problem${fails === 1 ? '' : 's'}${warns ? `, ${warns} warning${warns === 1 ? '' : 's'}` : ''}.` : warns ? `No problems, ${warns} warning${warns === 1 ? '' : 's'}.` : 'All checks passed.');
    io.stdout.write(out.join('\n') + '\n');
  }
  return fails ? 1 : 0;
}
