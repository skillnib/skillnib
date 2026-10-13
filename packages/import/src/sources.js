// Pure functions over an import catalog: derive its sources, merge imports, compute refresh reports, match queries.
// A catalog is { skills: [{ id, name, root, origin, files: [{ path, manifest, provenance }] }], skipped, conflicts }.

export const isPinnedRef = ref => typeof ref === 'string' && /^[0-9a-f]{7,40}$/i.test(ref);

export function sourceOfFile(p) {
  if (p.github) {
    const g = p.github, location = `${g.owner}/${g.repo}${g.subpath ? '/' + g.subpath : ''}`, ref = g.ref ?? null;
    return { key: `github:${location}@${ref ?? ''}`, kind: 'github', location, ref, pinned: isPinnedRef(ref), commit: g.sha ?? null };
  }
  return { key: `${p.kind}:${p.origin}`, kind: p.kind, location: p.origin, ref: null, pinned: null, commit: null };
}
export const sourceOfSkill = skill => sourceOfFile(skill.files[0].provenance);

const bySkill = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.origin + a.root < b.origin + b.root ? -1 : 1);

export function conflictsOf(skills) {
  const byId = new Map();
  for (const s of skills) byId.set(s.id, [...(byId.get(s.id) ?? []), { origin: s.origin, root: s.root }]);
  return [...byId].filter(([, v]) => v.length > 1).map(([id, where]) => ({ id, where }));
}

// Sources in first-seen order, each with the skills it provides and the commits those skills were read at.
export function deriveSources(catalog) {
  const out = new Map();
  for (const skill of catalog.skills) {
    const s = sourceOfSkill(skill);
    if (!out.has(s.key)) out.set(s.key, { ...s, commits: [], skills: [] });
    const entry = out.get(s.key), commit = skill.files[0].provenance.github?.sha ?? null;
    if (commit && !entry.commits.includes(commit)) entry.commits.push(commit);
    entry.skills.push({ id: skill.id, name: skill.name, files: skill.files.length, modules: skill.files.reduce((n, f) => n + f.manifest.modules.length, 0), commit });
  }
  return [...out.values()];
}

// Add the incoming skills, replacing every skill that came from a source the incoming import also came from.
export function mergeImport(catalog, incoming) {
  const keys = new Set(incoming.skills.map(s => sourceOfSkill(s).key));
  const skills = [...catalog.skills.filter(s => !keys.has(sourceOfSkill(s).key)), ...incoming.skills].sort(bySkill);
  return { skills, skipped: incoming.skipped ?? [], conflicts: conflictsOf(skills) };
}

const moduleMap = skill => {
  const out = new Map();
  for (const f of skill.files) {
    const seen = new Map();
    for (const m of f.manifest.modules) { const base = `${f.path}\0${m.title}`, n = seen.get(base) ?? 0; seen.set(base, n + 1); out.set(`${base}\0${n}`, { title: m.title, hash: m.hash }); }
  }
  return out;
};

// Module-level difference between two versions of a skill, keyed by file, title and content hash.
export function diffSkill(oldSkill, newSkill) {
  const a = moduleMap(oldSkill), b = moduleMap(newSkill), added = [], removed = [], changed = [];
  for (const [k, m] of b) { if (!a.has(k)) added.push(m.title); else if (a.get(k).hash !== m.hash) changed.push(m.title); }
  for (const [k, m] of a) if (!b.has(k)) removed.push(m.title);
  return { added, removed, changed, same: !added.length && !removed.length && !changed.length };
}

// Apply a freshly read copy of one source to the catalog. `only` (a Set of skill ids) limits the refresh to those skills.
export function refreshSource({ catalog, sourceKey, fresh, only = null, prune = false }) {
  const current = catalog.skills.filter(s => sourceOfSkill(s).key === sourceKey), freshById = new Map(fresh.skills.map(s => [s.id, s]));
  const report = { changed: [], unchanged: [], added: [], gone: [], pruned: [], from: current[0]?.files[0].provenance.github?.sha ?? null, to: fresh.skills[0]?.files[0].provenance.github?.sha ?? null };
  let skills = catalog.skills.slice();
  for (const cur of current) {
    if (only && !only.has(cur.id)) continue;
    const nf = freshById.get(cur.id);
    if (!nf) { if (prune) { skills = skills.filter(s => s !== cur); report.pruned.push(cur.id); } else report.gone.push(cur.id); continue; }
    const d = diffSkill(cur, nf);
    skills = skills.map(s => (s === cur ? nf : s));
    if (d.same) report.unchanged.push(cur.id); else report.changed.push({ id: cur.id, added: d.added, removed: d.removed, changed: d.changed });
  }
  if (!only) for (const nf of fresh.skills) if (!current.some(c => c.id === nf.id)) { skills.push(nf); report.added.push(nf.id); }
  skills.sort(bySkill);
  return { catalog: { skills, skipped: catalog.skipped ?? [], conflicts: conflictsOf(skills) }, report };
}

export function removeSources(catalog, sourceKeys) {
  const keys = new Set(sourceKeys), removed = catalog.skills.filter(s => keys.has(sourceOfSkill(s).key));
  const skills = catalog.skills.filter(s => !keys.has(sourceOfSkill(s).key));
  return { catalog: { skills, skipped: catalog.skipped ?? [], conflicts: conflictsOf(skills) }, removed };
}

// A query matches a skill when its name, id or source location contains it, ignoring case.
export function matchesQuery(skill, query) {
  const q = query.toLowerCase(), s = sourceOfSkill(skill);
  return [skill.id, skill.name, s.location, s.ref ? `${s.location}@${s.ref}` : s.location].some(x => String(x).toLowerCase().includes(q));
}

export const sourceLabel = s => s.location + (s.ref ? `@${s.ref}` : '');
const describeSource = s => sourceLabel(s) + (s.kind === 'github' && !s.ref ? ', default branch' : '');

// Sources a name can mean: an exact label (location plus ref) wins, then an exact location, then a part of a label.
function findSources(sources, name) {
  const q = name.toLowerCase(), byLabel = sources.filter(s => sourceLabel(s).toLowerCase() === q);
  if (byLabel.length) return byLabel;
  const byLocation = sources.filter(s => s.location.toLowerCase() === q);
  return byLocation.length ? byLocation : sources.filter(s => sourceLabel(s).toLowerCase().includes(q));
}

// Resolve user-given names to skills (exact id) or sources. With `from`, names are looked up only inside that one source.
export function resolveNames(catalog, names, { from = null } = {}) {
  let sources = deriveSources(catalog), scope = catalog.skills;
  const targets = [], unknown = [], ambiguous = [];
  if (from !== null) {
    const hits = findSources(sources, from);
    if (hits.length === 0) return { targets, unknown: [`--from ${from}`], ambiguous };
    if (hits.length > 1) return { targets, unknown, ambiguous: [{ name: `--from ${from}`, candidates: hits.map(describeSource) }] };
    sources = hits; scope = catalog.skills.filter(s => sourceOfSkill(s).key === hits[0].key);
  }
  for (const name of names) {
    const skills = scope.filter(s => s.id === name);
    if (skills.length === 1) { targets.push({ name, kind: 'skill', skillId: skills[0].id, sourceKey: sourceOfSkill(skills[0]).key }); continue; }
    if (skills.length > 1) { ambiguous.push({ name, candidates: skills.map(s => `${s.id} (${describeSource(sourceOfSkill(s))})`) }); continue; }
    const hits = findSources(sources, name);
    if (hits.length === 1) targets.push({ name, kind: 'source', sourceKey: hits[0].key });
    else if (hits.length > 1) ambiguous.push({ name, candidates: hits.map(describeSource) });
    else unknown.push(name);
  }
  return { targets, unknown, ambiguous };
}

// The source already in the catalog that holds this repository, subpath and commit (under any ref), or null.
export function sourceAtCommit(catalog, { owner, repo, subpath = '', sha }) {
  const location = `${owner}/${repo}${subpath ? '/' + subpath : ''}`.toLowerCase();
  return deriveSources(catalog).find(s => s.kind === 'github' && s.location.toLowerCase() === location && s.commits.length === 1 && s.commits[0] === sha) ?? null;
}

// Keys of the incoming sources whose skills are already in the catalog with identical content (and the same commit, for GitHub).
export function unchangedSources(catalog, incoming) {
  const keys = new Set(incoming.skills.map(s => sourceOfSkill(s).key)), out = new Set();
  for (const key of keys) {
    const old = catalog.skills.filter(s => sourceOfSkill(s).key === key), fresh = incoming.skills.filter(s => sourceOfSkill(s).key === key);
    if (old.length !== fresh.length) continue;
    const same = fresh.every(f => { const o = old.find(x => x.id === f.id); return o && diffSkill(o, f).same && (o.files[0].provenance.github?.sha ?? null) === (f.files[0].provenance.github?.sha ?? null); });
    if (same) out.add(key);
  }
  return out;
}

// The skills a search can use. When several skills share an id, the first keeps it and a later one whose files are byte for byte the same is not
// searched again; any other later one is searched under "<id>~2", "<id>~3", ... so every section keeps a unique ref and nothing is dropped.
export function searchableSkills(catalog) {
  const seen = new Map(), skills = [];
  const fingerprint = s => s.files.map(f => `${f.path}\0${f.manifest.source.hash}`).sort().join('\n');
  for (const s of catalog.skills) {
    const prior = seen.get(s.id);
    if (!prior) { seen.set(s.id, [{ fp: fingerprint(s), n: 1 }]); skills.push(s); continue; }
    const fp = fingerprint(s);
    if (prior.some(p => p.fp === fp)) continue;
    const n = prior.length + 1; prior.push({ fp, n });
    skills.push({ ...s, id: `${s.id}~${n}` });
  }
  return { ...catalog, skills };
}
