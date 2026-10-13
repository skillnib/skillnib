import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { verifyManifest } from '../../../packages/compile/src/index.js';

export const FORMAT = 1;
export const MAX_STORE_BYTES = 64 * 1024 * 1024;
const FILE = 'catalog.json';

export class StoreError extends Error {
  constructor(code, message) { super(message); this.name = 'StoreError'; this.code = code; }
}

// Texts are keyed by content hash so identical files are stored once; manifests reference them.
export async function saveStore(dir, catalog, { maxBytes = MAX_STORE_BYTES } = {}) {
  const texts = {};
  const skills = catalog.skills.map(s => ({ ...s, files: s.files.map(f => { texts[f.manifest.source.hash] = f.text; const { text: _text, ...rest } = f; return { ...rest, hash: f.manifest.source.hash }; }) }));
  const json = JSON.stringify({ format: FORMAT, kind: 'skillnib-store', skills, skipped: catalog.skipped ?? [], conflicts: catalog.conflicts ?? [], texts });
  if (Buffer.byteLength(json) > maxBytes) throw new StoreError('too-large', `the catalog is larger than the ${maxBytes} byte store limit; import fewer or smaller sources`);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${FILE}.${process.pid}.${Date.now()}.tmp`);
  try { await writeFile(tmp, json, { flag: 'wx' }); await rename(tmp, join(dir, FILE)); }
  catch (err) { await rm(tmp, { force: true }); throw err; }
}

export async function loadStore(dir, { maxBytes = MAX_STORE_BYTES } = {}) {
  const path = join(dir, FILE);
  let size;
  try { size = (await stat(path)).size; } catch { throw new StoreError('missing', `no store found at ${dir} (run "nib import" first)`); }
  if (size > maxBytes) throw new StoreError('too-large', `the store at ${path} is larger than ${maxBytes} bytes`);
  let data;
  try { data = JSON.parse(await readFile(path, 'utf8')); } catch (err) { throw new StoreError('corrupt', `the store at ${path} is not valid JSON: ${err.message}`); }
  if (data?.kind !== 'skillnib-store') throw new StoreError('corrupt', `${path} is not a SkillNib store`);
  if (data.format !== FORMAT) throw new StoreError('version', `the store at ${path} has format ${data.format}; this nib reads format ${FORMAT} (run "nib import" again)`);
  if (!Array.isArray(data.skills) || typeof data.texts !== 'object' || data.texts === null) throw new StoreError('corrupt', `the store at ${path} is malformed`);
  const skills = [];
  for (const s of data.skills) {
    const files = [];
    for (const f of s.files ?? []) {
      const text = data.texts[f.hash];
      if (typeof text !== 'string') throw new StoreError('corrupt', `the store at ${path} lacks the text for ${s.id}/${f.path}`);
      const v = await verifyManifest(f.manifest, text);
      if (!v.ok) throw new StoreError('corrupt', `the store at ${path} fails verification for ${s.id}/${f.path}: ${v.problems[0]}`);
      const { hash: _hash, ...rest } = f;
      files.push({ ...rest, text });
    }
    skills.push({ ...s, files });
  }
  return { skills, skipped: data.skipped ?? [], conflicts: data.conflicts ?? [] };
}

// Nearest .nib/catalog.json at or above startDir, or null.
export function findStore(startDir) {
  for (let d = resolve(startDir); ; d = dirname(d)) {
    if (existsSync(join(d, '.nib', FILE))) return join(d, '.nib');
    if (dirname(d) === d) return null;
  }
}

// --store, then NIB_STORE, then the nearest .nib above cwd; falls back to cwd/.nib so errors name a place.
export function resolveStore({ flag, env, cwd }) {
  if (flag) return resolve(cwd, flag);
  if (env?.NIB_STORE) return resolve(cwd, env.NIB_STORE);
  return findStore(cwd) ?? join(resolve(cwd), '.nib');
}
