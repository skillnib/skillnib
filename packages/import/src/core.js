import { compileSkill } from '../../compile/src/index.js'; // workspace linking replaces this relative path later
import { ImportError, LIMITS } from './errors.js';

const encoder = new TextEncoder();
const isMd = p => p.toLowerCase().endsWith('.md');
const unsafe = p => p === '' || p.startsWith('/') || p.includes('\\') || p.includes('\0') || p.split('/').some(s => s === '..' || s === '.' || s === '');
const dirname = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const basename = p => p.slice(p.lastIndexOf('/') + 1);

export function frontMatterName(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
    const m = /^name:\s*(.+?)\s*$/.exec(lines[i]);
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2').trim() || null;
  }
  return null;
}

// Group the importable markdown of one source into skills (planned, not yet read).
function plan(reader, entries, skipped) {
  const mds = [];
  for (const e of entries) {
    if (!isMd(e.path)) continue;
    if (unsafe(e.path)) { skipped.push({ origin: reader.origin, path: e.path, reason: 'unsafe path' }); continue; }
    if (e.type === 'symlink') { skipped.push({ origin: reader.origin, path: e.path, reason: 'symbolic link' }); continue; }
    if (e.type !== 'file') continue;
    if (e.size > LIMITS.maxFileBytes) { skipped.push({ origin: reader.origin, path: e.path, reason: `larger than ${LIMITS.maxFileBytes} bytes` }); continue; }
    mds.push(e.path);
  }
  mds.sort();
  if (reader.explicit) return mds.map(p => ({ dir: null, rootName: basename(p).replace(/\.md$/i, ''), files: [p] }));
  const skillDirs = new Set(mds.filter(p => basename(p) === 'SKILL.md').map(dirname));
  const owner = p => { for (let d = dirname(p); ; d = dirname(d)) { if (skillDirs.has(d)) return d; if (d === '') return null; } };
  const groups = new Map();
  for (const p of mds) {
    const d = owner(p);
    if (d === null) { skipped.push({ origin: reader.origin, path: p, reason: 'not inside a skill directory (no SKILL.md above it)' }); continue; }
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(p);
  }
  return [...groups].map(([dir, files]) => ({
    dir, rootName: dir === '' ? reader.rootName : basename(dir),
    files: files.sort((a, b) => (basename(a) === 'SKILL.md' && dirname(a) === dir ? -1 : basename(b) === 'SKILL.md' && dirname(b) === dir ? 1 : a < b ? -1 : a > b ? 1 : 0)),
  }));
}

// Import one or more readers into a catalog. Results are deterministic: no timestamps, stable ordering.
export async function importSkills(inputs) {
  const readers = await Promise.all(inputs);
  if (!readers.length) throw new ImportError('bad-input', 'nothing to import: no inputs given');
  const skipped = [], skills = [], seen = new Set();
  // directories and repositories first, so a file reached both ways belongs to its skill directory
  for (const reader of [...readers].sort((a, b) => Number(!!a.explicit) - Number(!!b.explicit))) {
    const entries = await reader.list();
    if (entries.filter(e => isMd(e.path) && e.type === 'file').length > LIMITS.maxMarkdownFiles)
      throw new ImportError('too-many-files', `${reader.origin} has more than ${LIMITS.maxMarkdownFiles} markdown files; import a narrower directory or subpath`);
    for (const group of plan(reader, entries, skipped)) {
      const files = [];
      for (const path of group.files) {
        const key = reader.identity ? reader.identity(path) : `${reader.origin}\0${path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let text;
        try { text = await reader.read(path); } catch (err) { skipped.push({ origin: reader.origin, path, reason: `unreadable: ${err.message}` }); continue; }
        if (encoder.encode(text).length > LIMITS.maxFileBytes) { skipped.push({ origin: reader.origin, path, reason: `larger than ${LIMITS.maxFileBytes} bytes` }); continue; }
        const manifest = await compileSkill({ path, text });
        files.push({ path, text, manifest, provenance: { kind: reader.kind, origin: reader.origin, hash: manifest.source.hash, ...(reader.github ? { github: reader.github } : {}) } });
      }
      if (!files.length) continue;
      const main = files.find(f => f.path === (group.dir === null ? files[0].path : (group.dir ? group.dir + '/' : '') + 'SKILL.md')) ?? files[0];
      const name = frontMatterName(main.text) ?? group.rootName;
      skills.push({ id: name, name, root: group.dir === null ? main.path : group.dir, origin: reader.origin, files });
    }
  }
  if (!skills.length) throw new ImportError('nothing-imported', 'no skills were imported' + (skipped.length ? `; ${skipped.length} file(s) skipped (first: ${skipped[0].path}: ${skipped[0].reason})` : ''));
  skills.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.origin + a.root < b.origin + b.root ? -1 : 1));
  const byId = new Map();
  for (const s of skills) byId.set(s.id, [...(byId.get(s.id) ?? []), { origin: s.origin, root: s.root }]);
  const conflicts = [...byId].filter(([, v]) => v.length > 1).map(([id, where]) => ({ id, where }));
  return { skills, skipped, conflicts };
}
