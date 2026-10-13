import { ImportError, LIMITS } from './errors.js';
import { readTar } from './tar.js';
import { memoryReader } from './memory.js';

const API = 'https://api.github.com';

// owner/repo[/sub/path][@ref], also github:owner/repo... and https://github.com/owner/repo...
export function parseGithubInput(input) {
  const s = String(input).trim().replace(/^github:/, '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git(?=$|@)/, '').replace(/\/+$/, '');
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/([^@]+?))?(?:@(.+))?$/.exec(s);
  if (!m) throw new ImportError('bad-input', `"${input}" is not a GitHub reference; use owner/repo, owner/repo@ref or owner/repo/sub/path@ref`);
  return { owner: m[1], repo: m[2], subpath: m[3] ? m[3].replace(/^\/+|\/+$/g, '') : '', ref: m[4] || null };
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
export async function resolveGithub(input, options = {}) {
  const ref = typeof input === 'string' ? parseGithubInput(input) : input;
  const token = options.token ?? globalThis.process?.env?.GITHUB_TOKEN ?? undefined;
  const get = client({ fetch: options.fetch ?? globalThis.fetch, token });
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
