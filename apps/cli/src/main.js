import { readFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { importSkills, mergeImport, deriveSources, resolveGithub, sourceAtCommit, unchangedSources, sourceLabel, searchableSkills, ImportError } from '../../../packages/import/src/index.js';
import { createBm25Retriever, corpusFromCatalog } from '../../../packages/retrieve/src/index.js';
import { catalogEntries, deliver, deliverWithin, failOpen, renderText, renderFailOpenWithin, findEntry, DEFAULT_OUTLINE_LINES, FORMAT, HOOK_MAX_CHARS } from '../../../packages/deliver/src/index.js';
import { parseArgs, intFlag, UsageError, USAGE } from './args.js';
import { toReader } from './sources.js';
import { sourceOfSkill } from '../../../packages/import/src/index.js';
const sourceOfSkillKey = sk => sourceOfSkill(sk).key;
import { cmdInit } from './init.js';
import { cmdList, cmdUpdate, cmdRemove } from './update.js';
import { cmdMcp } from './mcp.js';
import { cmdUpgrade } from './upgrade.js';
import { saveStore, loadStore, resolveStore, StoreError } from './store.js';

export const CONFLICT_NOTE = ' Both stay searchable, the later one as <id>~2; a copy with identical files is searched once.';

export function importSummary(catalog, storeDir) {
  const files = catalog.skills.flatMap(s => s.files), modules = files.flatMap(f => f.manifest.modules);
  const out = [`Imported ${catalog.skills.length} skill${catalog.skills.length === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'}, ${modules.length} modules (${modules.filter(m => m.flags.length).length} oversize) into ${storeDir}`];
  for (const s of catalog.skills) out.push(`  ${s.id}  ${s.files.length} file${s.files.length === 1 ? '' : 's'}  ${s.files.reduce((n, f) => n + f.manifest.modules.length, 0)} modules`);
  if (catalog.skipped.length) {
    out.push(`Skipped ${catalog.skipped.length} file${catalog.skipped.length === 1 ? '' : 's'}:`);
    for (const k of catalog.skipped.slice(0, 10)) out.push(`  ${k.path} (${k.reason})`);
    if (catalog.skipped.length > 10) out.push(`  ... and ${catalog.skipped.length - 10} more`);
  }
  for (const c of catalog.conflicts) out.push(`Conflict: id "${c.id}" is used by ${c.where.map(w => `${w.origin}:${w.root || '.'}`).join(' and ')}.${CONFLICT_NOTE}`);
  return out.join('\n') + '\n';
}

async function cmdImport(args, io, storeDir) {
  if (!args.positionals.length) throw new UsageError('import needs at least one source');
  const replace = !!args.flags['--replace'], force = !!args.flags['--force'];
  let existing = null;
  if (!replace) { try { existing = await loadStore(storeDir); } catch (err) { if (!(err instanceof StoreError && err.code === 'missing')) throw new Error(`${err.message}; fix it or import with --replace to start a new store`); } }
  const readers = [], notes = [];
  for (const s of args.positionals) {
    const r = await toReader(s, io, { existing, force, notes });
    if (r) readers.push(r);
  }
  if (!readers.length) { io.stdout.write(notes.join('\n') + '\nNothing new to import.\n'); return 0; }
  const incoming = await importSkills(readers);
  const same = existing && !force ? unchangedSources(existing, incoming) : new Set();
  const fresh = same.size ? { ...incoming, skills: incoming.skills.filter(sk => !same.has(sourceOfSkillKey(sk))) } : incoming;
  for (const key of same) notes.push(`Already imported and unchanged: ${key.replace(/^[a-z]+:/, '')}`);
  if (!fresh.skills.length) { io.stdout.write(notes.join('\n') + '\nNothing new to import.\n'); return 0; }
  const catalog = existing ? mergeImport(existing, fresh) : fresh;
  await saveStore(storeDir, catalog);
  io.stdout.write(importSummary(fresh, storeDir));
  if (notes.length) io.stdout.write(notes.join('\n') + '\n');
  if (existing) io.stdout.write(`The store now holds ${catalog.skills.length} skill${catalog.skills.length === 1 ? '' : 's'} from ${deriveSources(catalog).length} source${deriveSources(catalog).length === 1 ? '' : 's'}.\n`);
  for (const c of catalog.conflicts) io.stdout.write(`Conflict: the id "${c.id}" is provided by ${c.where.map(w => `${w.origin}${w.root ? ':' + w.root : ''}`).join(' and ')}.\n`);
  return 0;
}

async function cmdAsk(args, io, storeDir, deps) {
  const ask = args.positionals.join(' ').trim();
  if (!ask) throw new UsageError('ask needs the text of the ask');
  const k = intFlag(args.flags, '--k', 4, 1, 50), outlineLines = intFlag(args.flags, '--outline-lines', DEFAULT_OUTLINE_LINES, 0, 1000);
  let entries = null, identity = null, delivery;
  try {
    const catalog = searchableSkills(await loadStore(storeDir));
    entries = catalogEntries(catalog);
    const retriever = await (deps.createRetriever ?? createBm25Retriever)(corpusFromCatalog(catalog));
    identity = retriever.identity;
    delivery = deliver({ entries, identity, hits: await retriever.search(ask, { k }), outlineLines });
    if (delivery.failOpen) io.stderr.write(`nib: ${delivery.failOpen.reason}\n`);
  } catch (err) {
    io.stderr.write(`nib: ${err.message}\n`);
    delivery = failOpen({ reason: err instanceof StoreError ? err.message.replace(/ \(run "nib import" first\)$/, '') : 'SkillNib could not select sections', entries, identity, outlineLines });
  }
  io.stdout.write(args.flags['--json'] ? JSON.stringify({ ...delivery, format: FORMAT }, null, 2) + '\n' : renderText(delivery));
  return 0;
}

async function cmdShow(args, io, storeDir) {
  if (args.positionals.length !== 1) throw new UsageError('show needs exactly one <ref>');
  const e = findEntry(catalogEntries(searchableSkills(await loadStore(storeDir))), args.positionals[0]);
  if (!e) throw new Error(`no module "${args.positionals[0]}" in the store (see "nib list" or an outline for refs)`);
  io.stdout.write(e.text);
  return 0;
}



const quote = p => (/\s/.test(p) ? `"${p}"` : p);

// Where each skill's main file lives, for the fail-open notice. GitHub imports have no local file.
function skillSources(catalog) {
  return catalog.skills.map(s => {
    const f = s.files.find(x => basename(x.path) === 'SKILL.md') ?? s.files[0], p = f.provenance;
    const source = p.kind === 'dir' ? join(p.origin, ...f.path.split('/')) : p.kind === 'file' ? p.origin : `${p.origin} (no local file; import it locally to read it)`;
    return { skill: s.id, source };
  });
}

async function readStdin(stream, ms) {
  if (!stream) return '';
  let timer;
  const read = (async () => { let out = ''; for await (const c of stream) out += c; return out; })();
  const timeout = new Promise(res => { timer = setTimeout(() => res(null), ms); });
  const got = await Promise.race([read, timeout]);
  clearTimeout(timer);
  return got ?? '';
}

// Never exits non-zero and never blocks the prompt: every failure becomes a notice on stdout plus the cause on stderr.
async function cmdHook(args, io, _storeDir, deps) {
  if (args.positionals[0] !== 'claude' || args.positionals.length !== 1) throw new UsageError('hook needs a target: nib hook claude');
  let catalog = null;
  try {
    const raw = (await readStdin(io.stdin, deps.stdinTimeoutMs ?? 5000)).trim();
    if (!raw) return 0;
    const event = JSON.parse(raw);
    const prompt = typeof event?.prompt === 'string' ? event.prompt.trim() : '';
    if (event?.hook_event_name !== 'UserPromptSubmit' || !prompt || prompt.startsWith('/')) return 0;
    const storeDir = resolveStore({ flag: args.flags['--store'], env: io.env, cwd: typeof event.cwd === 'string' ? event.cwd : io.cwd });
    catalog = searchableSkills(await loadStore(storeDir));
    const entries = catalogEntries(catalog), retriever = await (deps.createRetriever ?? createBm25Retriever)(corpusFromCatalog(catalog));
    const hits = await retriever.search(prompt, { k: 4 });
    if (!hits.length) throw new NoMatch('no module matched the prompt');
    const fetchCommand = `node ${quote(resolve(io.nibPath ?? 'nib'))} show <ref> --store ${quote(storeDir)}`;
    io.stdout.write(renderText(deliverWithin({ entries, identity: retriever.identity, hits, fetchCommand }), { fetchCommand }));
  } catch (err) {
    io.stderr.write(`nib: ${err.message}\n`);
    try { io.stdout.write(renderFailOpenWithin({ reason: err instanceof NoMatch ? err.message : err instanceof StoreError ? err.message.replace(/ \(run "nib import" first\)$/, '') : err instanceof SyntaxError ? 'the hook input was not valid JSON' : 'SkillNib could not select sections', sources: catalog ? skillSources(catalog) : [], maxChars: HOOK_MAX_CHARS })); } catch { /* nothing more can be done */ }
  }
  return 0;
}
class NoMatch extends Error {}

const COMMANDS = { import: cmdImport, ask: cmdAsk, show: cmdShow, list: cmdList, hook: cmdHook, init: cmdInit, update: cmdUpdate, remove: cmdRemove, mcp: cmdMcp, upgrade: cmdUpgrade };

// Returns the exit code. `deps` lets tests replace the retriever factory.
export async function main(argv, io, deps = {}) {
  try {
    const [command, ...rest] = argv;
    if (command === '--version' || command === '-v') { io.stdout.write(JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version + '\n'); return 0; }
    if (command === '--help' || command === '-h' || command === 'help') { io.stdout.write(USAGE + '\n'); return 0; }
    if (!command || !(command in COMMANDS)) throw new UsageError(command ? `unknown command "${command}"` : 'no command given');
    const args = parseArgs(rest);
    const storeDir = command === 'import' ? resolve(io.cwd, args.flags['--store'] ?? '.nib') : resolveStore({ flag: args.flags['--store'], env: io.env, cwd: io.cwd });
    return await COMMANDS[command](args, io, storeDir, deps);
  } catch (err) {
    if (err instanceof UsageError) { io.stderr.write(`nib: ${err.message}\n${USAGE}\n`); return 2; }
    io.stderr.write(`nib: ${err instanceof ImportError ? `${err.code}: ` : ''}${err.message}\n`);
    return 1;
  }
}
