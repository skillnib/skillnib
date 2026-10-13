// Delivery logic: pure functions over an import catalog and a ranking. No I/O, no dependencies.
// Catalog shape (slice 2): { skills: [{ id, files: [{ path, text, manifest: { modules } }] }] }.
export const FORMAT = 1;
export const DEFAULT_OUTLINE_LINES = 40;
const OTHER_SKILLS_MAX = 400;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const bare = title => String(title).replace(/^#+\s*/, '').trim(); // C2 framing strips the leading #s

// One entry per module, in catalog order. `ref` equals the id slice 3's corpusFromCatalog gives the module.
export function catalogEntries(catalog) {
  if (!Array.isArray(catalog?.skills)) throw new TypeError('catalog must have a skills array');
  const out = [];
  for (const skill of catalog.skills) for (const file of skill.files) for (const m of file.manifest.modules)
    out.push({ ref: `${skill.id}/${file.path}#${m.id}`, skill: skill.id, file: file.path, moduleId: m.id, title: bare(m.title), bytes: m.bytes, hash: m.hash, flags: m.flags, text: file.text.slice(m.start, m.end) });
  return out;
}

const skillNames = entries => [...new Set(entries.map(e => e.skill))];

function capLines(all, cap) {
  const cut = all.length > cap;
  return { lines: cut ? all.slice(0, cap) : all, cut, omitted: cut ? all.length - cap : 0 };
}

function otherSkillsLine(names) {
  if (!names.length) return null;
  const joined = names.join(', ');
  return 'Other skills: ' + (joined.length > OTHER_SKILLS_MAX ? joined.slice(0, OTHER_SKILLS_MAX) + ', ...' : joined);
}

// Undelivered modules of the skills that had a delivered section, grouped by skill and file; never contains module text.
function outlineAfterDelivery(entries, delivered, cap) {
  const refs = new Set(delivered.map(e => e.ref)), all = [];
  const deliveredSkills = skillNames(delivered);
  for (const skill of deliveredSkills) {
    const rest = entries.filter(e => e.skill === skill && !refs.has(e.ref));
    all.push(skill + (rest.length ? '' : '  (every module delivered)'));
    let file = null;
    for (const e of rest) {
      if (e.file !== file) { file = e.file; all.push(`  ${file}`); }
      all.push(`    ${e.ref}  ${e.title}  ${e.bytes} B`);
    }
  }
  return { ...capLines(all, cap), otherSkills: otherSkillsLine(skillNames(entries).filter(n => !deliveredSkills.includes(n))) };
}

// Fail-open outline: every skill with its files and module counts.
function outlineAll(entries, cap) {
  const all = [];
  for (const skill of skillNames(entries)) {
    const mine = entries.filter(e => e.skill === skill), files = [...new Set(mine.map(e => e.file))];
    all.push(`${skill}  ${plural(files.length, 'file')}  ${plural(mine.length, 'module')}`);
    for (const f of files) all.push(`  ${f}  ${plural(mine.filter(e => e.file === f).length, 'module')}`);
  }
  return { ...capLines(all, cap), otherSkills: null };
}

const empty = { lines: [], cut: false, omitted: 0, otherSkills: null };

// entries may be null when the catalog could not be read.
export function failOpen({ reason, entries = null, identity = null, outlineLines = DEFAULT_OUTLINE_LINES }) {
  return { format: FORMAT, retriever: identity, failOpen: { reason }, hits: [], sections: [], outline: entries ? outlineAll(entries, outlineLines) : empty, bytes: { sections: 0 } };
}

const toSection = (e, h) => ({ ref: e.ref, skill: e.skill, file: e.file, title: e.title, bytes: e.bytes, score: h.score, rank: h.rank, text: e.text });

function resolveHits(entries, hits) {
  const byRef = new Map(entries.map(e => [e.ref, e]));
  return hits.map(h => {
    const e = byRef.get(h.id);
    if (!e) throw new Error(`retriever returned ${h.id}, which is not in the catalog`);
    return { h, e };
  });
}

export function deliver({ entries, identity, hits, outlineLines = DEFAULT_OUTLINE_LINES }) {
  if (!hits.length) return failOpen({ reason: 'no module matched the ask', entries, identity, outlineLines });
  const picked = resolveHits(entries, hits);
  const sections = picked.map(({ e, h }) => toSection(e, h));
  return {
    format: FORMAT, retriever: identity, failOpen: null, hits, sections,
    outline: outlineAfterDelivery(entries, picked.map(p => p.e), outlineLines),
    bytes: { sections: sections.reduce((n, s) => n + s.bytes, 0) },
  };
}

export const HOOK_MAX_CHARS = 9500;
export const HOOK_OUTLINE_LINES = 12;
const LINE_MAX = 200;
const clip = line => (line.length > LINE_MAX ? line.slice(0, LINE_MAX - 3) + '...' : line);
const sectionCost = e => frame(e).length + e.text.length + 3;

// Delivery whose rendered text is at most maxChars. Sections are taken in rank order; one that does not fit is skipped
// and the next is tried; sections are never cut. Skipped sections head the outline as "too large to inject".
export function deliverWithin({ entries, identity, hits, maxChars = HOOK_MAX_CHARS, outlineLines = HOOK_OUTLINE_LINES, fetchCommand }) {
  if (!hits.length) return failOpen({ reason: 'no module matched the ask', entries, identity, outlineLines });
  const cands = resolveHits(entries, hits);
  const reserve = 1200 + (fetchCommand ? fetchCommand.length : 0);
  let used = 0;
  const chosen = new Set();
  for (const { e } of cands) { const c = sectionCost(e); if (used + c <= maxChars - reserve) { chosen.add(e.ref); used += c; } }
  const build = () => {
    const picked = cands.filter(({ e }) => chosen.has(e.ref));
    const skipped = cands.filter(({ e }) => !chosen.has(e.ref));
    const base = outlineAfterDelivery(entries, picked.map(p => p.e), outlineLines);
    const tooLarge = skipped.map(({ e }) => clip(`too large to inject: ${e.ref}  ${e.title}  ${e.bytes} B`));
    const lines = [...tooLarge, ...base.lines.map(clip)];
    const sections = picked.map(({ e, h }) => toSection(e, h));
    return { format: FORMAT, retriever: identity, failOpen: null, hits: picked.map(p => p.h), sections, tooLarge: skipped.map(({ e }) => e.ref), fetchCommand,
      outline: { lines, cut: base.cut, omitted: base.omitted, otherSkills: base.otherSkills }, bytes: { sections: sections.reduce((n, s) => n + s.bytes, 0) } };
  };
  let d = build();
  while (renderText(d, { fetchCommand }).length > maxChars && chosen.size) { chosen.delete(d.sections.at(-1).ref); d = build(); }
  while (renderText(d, { fetchCommand }).length > maxChars && d.outline.lines.length) { d.outline.lines.pop(); d.outline.cut = true; d.outline.omitted += 1; }
  if (renderText(d, { fetchCommand }).length > maxChars) throw new RangeError(`cannot render within ${maxChars} characters`);
  return d;
}

// Notice for a hook that selected nothing; lists where each skill's source lives so the agent can read it.
export function renderFailOpenWithin({ reason, sources = [], maxChars = HOOK_MAX_CHARS }) {
  const why = String(reason).slice(0, 300);
  if (!sources.length) return `SkillNib: no sections were selected (${why}).\n`;
  const head = `SkillNib: no sections were selected (${why}). Read the skill files directly if the task needs them:`;
  const lines = [];
  let used = head.length + 1;
  for (const [i, s] of sources.entries()) {
    const line = clip(`${s.skill}  ${s.source}`), more = `... and ${sources.length - i} more skills`;
    if (used + line.length + 1 + more.length + 1 > maxChars && i < sources.length) { lines.push(`... and ${sources.length - i} more skill${sources.length - i === 1 ? '' : 's'}`); break; }
    lines.push(line); used += line.length + 1;
  }
  return [head, ...lines].join('\n') + '\n';
}

export const frame = s => `===== ${s.skill}/${s.file} :: ${s.title} =====`;

export function renderText(d, { fetchCommand } = {}) {
  const out = [];
  if (d.failOpen) {
    out.push(`SkillNib: no sections were selected (${d.failOpen.reason}). Load the skills normally.`);
    if (d.outline.lines.length) out.push('', '--- Skills in the catalog ---', ...d.outline.lines);
  } else {
    const r = d.retriever;
    out.push(`SkillNib ${r ? `${r.name} v${r.version} (corpus ${r.corpusHash.slice(0, 8)}): ` : ''}${d.sections.length} section${d.sections.length === 1 ? '' : 's'}, ${d.bytes.sections} bytes`, '');
    if (d.sections.length) out.push(d.sections.map(s => `${frame(s)}\n${s.text}`).join('\n\n'));
    else out.push('No matching section fits the size limit.');
    out.push('', `--- Not delivered (fetch one with: ${fetchCommand ?? 'nib show <ref>'}) ---`, ...d.outline.lines);
    if (d.outline.otherSkills) out.push(d.outline.otherSkills);
  }
  if (d.outline.cut) out.push(`... ${d.outline.omitted} more line${d.outline.omitted === 1 ? '' : 's'} not shown (nib list shows every skill)`);
  return out.join('\n') + '\n';
}

export function renderList(entries) {
  const o = outlineAll(entries, Infinity);
  return o.lines.join('\n') + (o.lines.length ? '\n' : '');
}

export const findEntry = (entries, ref) => entries.find(e => e.ref === ref) ?? null;
