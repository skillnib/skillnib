import { importSkills, githubReader, deriveSources, refreshSource, removeSources, matchesQuery, resolveNames, sourceLabel } from '../../../packages/import/src/index.js';
import { dirReader, fileReader } from '../../../packages/import/node/index.js';
import { UsageError } from './args.js';
import { saveStore, loadStore } from './store.js';
import { CONFLICT_NOTE } from './main.js';
import { refreshWiring } from './init.js';

const short = sha => (sha ? sha.slice(0, 7) : '?');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const label = sourceLabel;
const status = s => (s.kind === 'github' ? (s.pinned ? 'pinned' : s.ref ? 'floating' : 'floating (default branch)') : 'local');

function readerFor(src, io) {
  if (src.kind === 'github') return githubReader(`${src.location}${src.ref ? '@' + src.ref : ''}`, { fetch: io.fetch, token: io.env ? (io.env.GITHUB_TOKEN ?? '') : undefined });
  return src.kind === 'dir' ? dirReader(src.location) : fileReader(src.location);
}

export async function cmdList(args, io, storeDir) {
  const store = await loadStore(storeDir), query = args.positionals.join(' ').trim();
  const shown = query ? { ...store, skills: store.skills.filter(s => matchesQuery(s, query)) } : store;
  const sources = deriveSources(shown);
  if (args.flags['--json']) { io.stdout.write(JSON.stringify({ format: 1, query: query || null, sources: sources.map(s => ({ location: s.location, kind: s.kind, ref: s.ref, status: status(s), commits: s.commits, skills: s.skills })) }, null, 2) + '\n'); return 0; }
  if (!sources.length) { io.stdout.write(query ? `No skills match "${query}".\n` : 'The store has no skills.\n'); return 0; }
  const out = [];
  for (const s of sources) {
    out.push(`${label(s)}  ${s.kind}  ${status(s)}${s.commits.length ? '  ' + s.commits.map(short).join(', ') : ''}`);
    for (const k of s.skills) out.push(`  ${k.id}  ${plural(k.files, 'file')}  ${plural(k.modules, 'module')}`);
  }
  if (!query) for (const c of store.conflicts ?? []) out.push(`Conflict: id "${c.id}" is used by ${c.where.map(w => `${w.origin}:${w.root || '.'}`).join(' and ')}.${CONFLICT_NOTE}`);
  io.stdout.write(out.join('\n') + '\n');
  return 0;
}

function resolveOrExit(store, names, from) {
  const r = resolveNames(store, names, { from: from ?? null });
  if (r.ambiguous.length) throw new UsageError(r.ambiguous.map(a => `"${a.name}" is ambiguous; it could be: ${a.candidates.join(', ')}${a.name.startsWith('--from') ? '' : '. Pick one with --from <source>.'}`).join('\n'));
  if (r.unknown.length) throw new Error(`no skill or source matches: ${r.unknown.join(', ')} (see "nib list")`);
  return r.targets;
}

function describe(src, report, { checking }) {
  const out = [], head = `${label(src)} (${status(src)})`;
  const moved = report.from && report.to && report.from !== report.to ? `: ${short(report.from)} -> ${short(report.to)}` : report.to ? `: ${short(report.to)}` : '';
  const none = !report.changed.length && !report.added.length && !report.gone.length && !report.pruned.length;
  if (none) return [report.from && report.to && report.from !== report.to ? `${head}${moved}, content unchanged` : `${head}: up to date`];
  out.push(`${head}${moved}${checking ? '  (would change)' : ''}`);
  for (const c of report.changed) {
    const bits = [c.changed.length && `${plural(c.changed.length, 'module')} changed (${c.changed.join(', ')})`, c.added.length && `${c.added.length} added (${c.added.join(', ')})`, c.removed.length && `${c.removed.length} removed (${c.removed.join(', ')})`].filter(Boolean);
    out.push(`  ${c.id}: ${bits.join('; ')}`);
  }
  for (const id of report.added) out.push(`  new skill: ${id}`);
  for (const id of report.gone) out.push(`  no longer provided upstream: ${id} (kept; --prune removes it)`);
  for (const id of report.pruned) out.push(`  removed (no longer provided upstream): ${id}`);
  return out;
}

export async function cmdUpdate(args, io, storeDir) {
  let store = await loadStore(storeDir);
  const names = args.positionals, checking = !!args.flags['--check'], force = !!args.flags['--force'], prune = !!args.flags['--prune'];
  const sources = deriveSources(store), plan = new Map(); // sourceKey -> Set of skill ids, or null for the whole source
  if (!names.length) for (const s of sources) plan.set(s.key, null);
  else for (const t of resolveOrExit(store, names, args.flags['--from'])) {
    if (t.kind === 'source') plan.set(t.sourceKey, null);
    else if (plan.get(t.sourceKey) !== null) plan.set(t.sourceKey, new Set([...(plan.get(t.sourceKey) ?? []), t.skillId]));
  }
  const out = [], failed = [];
  let changed = false;
  for (const [key, only] of plan) {
    const src = sources.find(s => s.key === key);
    if (src.pinned && !force) { out.push(`${label(src)} (pinned at ${short(src.commits[0])}): skipped; use --force to re-read it`); continue; }
    let fresh;
    try { fresh = await importSkills([readerFor(src, io)]); } catch (err) { failed.push(label(src)); out.push(`${label(src)}: could not be refreshed, kept as it was (${err.message})`); continue; }
    const r = refreshSource({ catalog: store, sourceKey: key, fresh, only, prune });
    const edited = r.report.changed.length || r.report.added.length || r.report.pruned.length || r.report.from !== r.report.to;
    out.push(...describe(src, r.report, { checking }));
    if (edited) { store = r.catalog; changed = true; }
  }
  if (!checking && changed) { await saveStore(storeDir, store); out.push(...await refreshWiring({ storeDir, catalog: store, io })); }
  if (checking) out.push('(check only: nothing was written)');
  io.stdout.write(out.join('\n') + '\n');
  if (failed.length) { io.stderr.write(`nib: could not refresh: ${failed.join(', ')}\n`); return 1; }
  return 0;
}

export async function cmdRemove(args, io, storeDir) {
  if (!args.positionals.length) throw new UsageError('remove needs at least one skill or source name');
  const store = await loadStore(storeDir), targets = resolveOrExit(store, args.positionals, args.flags['--from']);
  const { catalog, removed } = removeSources(store, [...new Set(targets.map(t => t.sourceKey))]);
  await saveStore(storeDir, catalog);
  const notes = await refreshWiring({ storeDir, catalog, removed, io });
  const named = new Set(args.positionals), extra = removed.filter(s => !named.has(s.id)), byName = args.positionals.every(n => removed.some(s => s.id === n));
  if (byName && extra.length) notes.unshift(`Note: nib remove removes the whole source that provides a skill, so ${plural(extra.length, 'skill')} you did not name went with it. Re-import any you want to keep (see "nib import").`);
  io.stdout.write([`Removed ${plural(removed.length, 'skill')}: ${removed.map(s => s.id).join(', ')}`, `${plural(catalog.skills.length, 'skill')} remain in the store.`, ...notes].join('\n') + '\n');
  return 0;
}
