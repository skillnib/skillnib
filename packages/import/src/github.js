import { ImportError, LIMITS } from './errors.js';
import { readTar } from './tar.js';
import { memoryReader } from './memory.js';

const API = 'https://api.github.com';

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const MAX_REF_SEGMENTS = 6;
const BAD_INPUT = input => new ImportError('bad-input', `"${input}" is not a GitHub reference; paste a GitHub address such as https://github.com/owner/repo or https://github.com/owner/repo/tree/main/skills, or write owner/repo, owner/repo/sub/path@ref or owner/repo@ref/sub/path`);
const decode = seg => { try { return decodeURIComponent(seg); } catch { return seg; } };

// Everything a person might paste for a GitHub source, as one or more readings { owner, repo, subpath, ref }.
//   https://github.com/o/r | www.github.com/o/r.git | git@github.com:o/r.git | ssh://git@github.com/o/r | git+https://...
//   .../tree/<ref>/<folder> | .../blob/<ref>/<folder>/<file> | .../commit/<sha> | .../releases/tag/<tag> (query and #fragment ignored)
//   github:<any of the above> | o/r | o/r/sub/path@ref | o/r@ref/sub/path
// A ref can contain slashes, so "@feature/x/skills" is "ref feature, folder x/skills" or "ref feature/x, folder skills" or ...;
// the readings come shortest ref first and resolveGithub takes the first one GitHub knows. A reading is exact when there is one.
export function githubCandidates(input) {
  let s = String(input ?? '').trim().replace(/^[<"'`(]+|[>"'`),;]+$/g, '').replace(/^github:/i, '').replace(/^git\+/i, '').replace(/[?#].*$/, '');
  if (!s || s.startsWith('-')) throw BAD_INPUT(input);
  const host = /^(?:(?:https?|git|ssh):\/\/(?:git@)?|git@)?(?:www\.)?github\.com[/:]/i;
  const url = host.test(s);
  if (!url && /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) throw new ImportError('bad-input', `"${input}" is not on github.com; only GitHub repositories can be imported by address`);
  if (url) s = s.replace(host, '');
  s = s.replace(/^\/+|\/+$/g, '');
  let owner, repo, tail = null, shorthand = '';
  if (url) {
    const [o, r, ...rest] = s.split('/');
    owner = o; repo = r; tail = rest.map(decode);
  } else {
    const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(.*)$/.exec(s);
    if (!m) throw BAD_INPUT(input);
    owner = m[1]; repo = m[2]; shorthand = m[3];
  }
  repo = (repo ?? '').replace(/\.git$/i, '');
  if (!NAME.test(owner ?? '') || !NAME.test(repo) || repo === '.' || repo === '..') throw BAD_INPUT(input);
  const make = (ref, parts) => {
    if (parts.some(p => p === '..' || p === '.' || /[\\\0]/.test(p)) || /[\s"'`$\\]/.test(ref ?? '') || (ref ?? '').startsWith('-')) throw BAD_INPUT(input);
    return { owner, repo, subpath: parts.join('/'), ref: ref || null };
  };
  // Splits "ref/segments..." into readings, shortest ref first.
  const readings = (segs, dropLast = 0) => {
    const parts = segs.filter(Boolean), out = [];
    const keep = dropLast ? parts.slice(0, Math.max(1, parts.length - dropLast)) : parts; // a blob URL ends in the file; import its folder
    for (let k = 1; k <= Math.min(keep.length, MAX_REF_SEGMENTS); k++) out.push(make(keep.slice(0, k).join('/'), keep.slice(k)));
    return out;
  };
  if (tail) {
    if (!tail.length) return [make('', [])];
    const [kind, ...rest] = tail;
    if (/^(?:tree|blob|blame|raw|edit)$/i.test(kind)) {
      if (!rest.length) return [make('', [])];
      return readings(rest, kind.toLowerCase() === 'tree' ? 0 : 1);
    }
    if (/^commit$/i.test(kind) && rest[0]) return [make(rest[0], [])];
    if (/^releases$/i.test(kind) && rest[0]?.toLowerCase() === 'tag' && rest.length > 1) return [make(rest.slice(1).join('/'), [])];
    return [make('', [])]; // issues, pulls, actions, wiki, ...: the repository itself
  }
  if (!shorthand) return [make('', [])];
  if (shorthand[0] === '@') return readings(shorthand.slice(1).split('/').map(decode)); // o/r@ref[/sub/path]
  if (shorthand[0] !== '/') throw BAD_INPUT(input);
  const at = shorthand.indexOf('@', 1);                                               // o/r/sub/path[@ref]
  const pathPart = (at < 0 ? shorthand.slice(1) : shorthand.slice(1, at)).split('/').filter(Boolean).map(decode);
  return [make(at < 0 ? '' : decode(shorthand.slice(at + 1)), pathPart)];
}

// The literal reading of an address: the longest ref ("o/r@feature/x" is ref feature/x). Use githubCandidates to resolve.
export function parseGithubInput(input) {
  const c = githubCandidates(input);
  return c[c.length - 1];
}

// Would nib treat this text as a GitHub address (when it is not an existing local path)?
export function isGithubReference(input) {
  const s = String(input ?? '').trim();
  if (/^github:/i.test(s)) return true;
  if (/^(?:(?:https?|git|ssh):\/\/(?:git@)?|git@|git\+https?:\/\/)?(?:www\.)?github\.com[/:]/i.test(s)) return true;
  if (/^[./~]/.test(s) || /^[A-Za-z]:[\\/]/.test(s)) return false;
  try { githubCandidates(s); return true; } catch { return false; }
}

function client({ fetch, token }) {
  const redact = text => (token ? String(text).split(token).join('***') : String(text));
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'skillnib-import', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return async function get(url, what) {
    let res;
    try { res = await fetch(url, { headers, redirect: 'follow' }); }
    catch (err) { throw new ImportError('network', `could not reach GitHub while ${what}: ${redact(err.message)}`); }
    if ((res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(await res.clone().text().catch(() => ''))))
      throw new ImportError('rate-limited', `GitHub rate limit reached while ${what}; ${token ? 'wait for the limit to reset' : 'set GITHUB_TOKEN to raise the limit'}`);
    if (res.status === 401) throw new ImportError('unauthorized', `GitHub rejected the token while ${what}; check GITHUB_TOKEN`);
    return res;
  };
}

async function readBounded(stream) {
  const reader = stream.getReader(), chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length;
    if (total > LIMITS.maxArchiveBytes) { await reader.cancel(); throw new ImportError('too-large', `archive is larger than ${LIMITS.maxArchiveBytes} bytes; import a narrower subpath`); }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Resolve a reference to a commit without downloading anything: { owner, repo, subpath, ref (as typed), sha }.
// An address whose ref may swallow part of the folder ("@feature/x/skills") is tried reading by reading; the first ref GitHub knows wins.
export async function resolveGithub(input, options = {}) {
  const candidates = typeof input === 'string' ? githubCandidates(input) : [input];
  const token = options.token ?? globalThis.process?.env?.GITHUB_TOKEN ?? undefined;
  const get = client({ fetch: options.fetch ?? globalThis.fetch, token });
  let first;
  for (const c of candidates) {
    try { return await resolveOne(c, get, token); }
    catch (e) { if (!(e instanceof ImportError) || e.code !== 'ref-not-found') throw e; first ??= e; }
  }
  throw first;
}

async function resolveOne(ref, get, token) {
  const { owner, repo, subpath } = ref, where = `${owner}/${repo}`;
  const commitUrl = `${API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref.ref ?? 'HEAD')}`;
  const c = await get(commitUrl, `resolving ${where}${ref.ref ? '@' + ref.ref : ''}`);
  if (c.status === 404 || c.status === 422) {
    const r = await get(`${API}/repos/${owner}/${repo}`, `checking ${where}`);
    if (r.status === 200 && ref.ref) throw new ImportError('ref-not-found', `ref "${ref.ref}" not found in ${where}`);
    throw new ImportError('not-found', `repository ${where} not found${token ? '' : ' (private repositories need GITHUB_TOKEN)'}`);
  }
  if (!c.ok) throw new ImportError('network', `GitHub returned ${c.status} while resolving ${where}`);
  const sha = (await c.json()).sha;
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new ImportError('network', `GitHub returned no commit SHA for ${where}`);
  return { owner, repo, subpath, ref: ref.ref ?? null, sha };
}

// Resolve (unless `options.resolved` is given), download that commit's archive, and expose its markdown as a SourceReader.
export async function githubReader(input, options = {}) {
  const resolved = options.resolved ?? await resolveGithub(input, options);
  const { owner, repo, subpath, sha } = resolved, ref = { ref: resolved.ref };
  const token = options.token ?? globalThis.process?.env?.GITHUB_TOKEN ?? undefined;
  const get = client({ fetch: options.fetch ?? globalThis.fetch, token });
  const where = `${owner}/${repo}`;
  const a = await get(`${API}/repos/${owner}/${repo}/tarball/${sha}`, `downloading ${where}@${sha.slice(0, 7)}`);
  if (!a.ok || !a.body) throw new ImportError(a.status === 404 ? 'not-found' : 'network', `could not download ${where}@${sha.slice(0, 7)} (status ${a.status})`);
  const bytes = await readBounded(a.body.pipeThrough(new DecompressionStream('gzip')));
  const prefix = subpath ? subpath + '/' : '';
  const strip = p => p.slice(p.indexOf('/') + 1); // drop the "<owner>-<repo>-<sha>/" top directory
  const wanted = p => { const r = strip(p); return r.startsWith(prefix) && r.toLowerCase().endsWith('.md'); };
  const found = readTar(bytes, wanted);
  const files = {}, entries = [], unreadable = new Map(), dec = new TextDecoder('utf-8', { fatal: true });
  for (const e of found) {
    if (!wanted(e.path)) continue;
    const rel = strip(e.path).slice(prefix.length);
    entries.push({ path: rel, size: e.size, type: e.type });
    if (e.type !== 'file') continue;
    try { files[rel] = dec.decode(e.data); } catch { unreadable.set(rel, 'not valid UTF-8'); }
  }
  const base = memoryReader({
    kind: 'github', origin: `github:${where}@${sha}${subpath ? '/' + subpath : ''}`, rootName: (subpath ? subpath.split('/').pop() : repo),
    github: { owner, repo, ref: ref.ref, sha, subpath }, files, entries,
  });
  const origRead = base.read;
  base.read = async p => { if (unreadable.has(p)) throw new Error(unreadable.get(p)); return origRead(p); };
  return base;
}
