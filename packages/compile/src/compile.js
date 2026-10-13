import { SEGMENTER, LIMIT, segment, byteLength } from './segment.js';

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async text => hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
export const OVERSIZE = 'oversize-unsplittable';

function assertInput(input) {
  if (input === null || typeof input !== 'object') throw new TypeError('compileSkill expects an object { path, text }');
  if (typeof input.path !== 'string' || input.path === '') throw new TypeError('compileSkill: "path" must be a non-empty string');
  if (typeof input.text !== 'string') throw new TypeError('compileSkill: "text" must be a string');
}

export async function compileSkill(input) {
  assertInput(input);
  const { path, text } = input;
  const modules = [];
  let start = 0;
  for (const [i, s] of segment(text).entries()) {
    const end = start + s.text.length, bytes = byteLength(s.text);
    const m = { id: `m${i}`, kind: s.kind, title: s.title };
    if (s.parent !== undefined) m.parent = s.parent;
    modules.push({ ...m, start, end, bytes, hash: await sha256(s.text), flags: bytes > LIMIT ? [OVERSIZE] : [] });
    start = end;
  }
  return { format: 1, source: { path, bytes: byteLength(text), hash: await sha256(text) }, segmenter: { ...SEGMENTER, limit: LIMIT }, modules };
}

export async function verifyManifest(manifest, text) {
  const problems = [];
  if (typeof text !== 'string') throw new TypeError('verifyManifest: "text" must be a string');
  if (manifest?.format !== 1 || !Array.isArray(manifest.modules) || !manifest.source || !manifest.segmenter) return { ok: false, problems: ['not a format 1 manifest'] };
  if (manifest.source.hash !== await sha256(text) || manifest.source.bytes !== byteLength(text)) problems.push('source text changed: hash or size does not match the manifest');
  const limit = manifest.segmenter.limit;
  let cursor = 0;
  for (const [i, m] of manifest.modules.entries()) {
    if (m.id !== `m${i}`) problems.push(`module ${i}: id "${m.id}" should be "m${i}"`);
    if (m.start < cursor) problems.push(`${m.id}: overlaps the previous module (starts at ${m.start}, previous ended at ${cursor})`);
    else if (m.start > cursor) problems.push(`${m.id}: gap before module (previous ended at ${cursor}, starts at ${m.start})`);
    if (!(m.end > m.start) || m.end > text.length) { problems.push(`${m.id}: invalid span ${m.start}-${m.end}`); cursor = Math.max(cursor, m.end || 0); continue; }
    const slice = text.slice(m.start, m.end);
    if (slice.trim() === '') problems.push(`${m.id}: module is whitespace-only`);
    if (m.hash !== await sha256(slice)) problems.push(`${m.id}: hash does not match its slice`);
    if (m.bytes !== byteLength(slice)) problems.push(`${m.id}: bytes does not match its slice`);
    if (m.bytes > limit && !m.flags?.includes(OVERSIZE)) problems.push(`${m.id}: ${m.bytes} bytes exceeds the ${limit} limit without the ${OVERSIZE} flag`);
    cursor = m.end;
  }
  if (manifest.modules.length ? cursor !== text.length : text.trim() !== '') problems.push(`modules do not cover the text (end ${cursor}, text length ${text.length})`);
  return problems.length ? { ok: false, problems } : { ok: true };
}

export function moduleText(manifest, text, moduleId) {
  const m = manifest.modules.find(x => x.id === moduleId);
  if (!m) throw new RangeError(`no module "${moduleId}" in manifest for ${manifest.source?.path}`);
  return text.slice(m.start, m.end);
}
