import { readFile, writeFile, rename, rm, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createBm25Retriever, corpusFromCatalog } from '../../../packages/retrieve/src/index.js';
import { buildIndex, encodeIndex, decodeIndex, staleness, createHybridRetriever } from '../../../packages/embed/src/index.js';
import { searchableSkills } from '../../../packages/import/src/index.js';
import { loadStore } from './store.js';
import { UsageError } from './args.js';

const CONFIG = 'embed.json', VECTORS = 'vectors.bin';
const LOOPBACK = /^(localhost|127(\.\d+){3}|\[?::1\]?)$/;

// POST <url>/v1/embeddings in the OpenAI shape. `url` may be the server root or the full embeddings URL.
// The model is optional: when none is given the request names none and the server uses the one it has loaded.
export function httpEmbedder({ url, model, fetch = globalThis.fetch, env = {}, timeoutMs = 60000 }) {
  const root = url.replace(/\/+$/, ''), endpoint = /\/embeddings$/.test(root) ? root : /\/v1$/.test(root) ? root + '/embeddings' : root + '/v1/embeddings';
  return async texts => {
    const headers = { 'content-type': 'application/json' };
    if (env.NIB_EMBED_KEY) headers.authorization = `Bearer ${env.NIB_EMBED_KEY}`;
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(model ? { model, input: texts } : { input: texts }), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) { const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300); throw Object.assign(new Error(`the embedding server answered ${res.status}${body ? `: ${body}` : ''}`), { status: res.status }); }
    let body; try { body = await res.json(); } catch { throw new Error('the embedding server did not answer with JSON'); }
    const data = body?.data;
    if (!Array.isArray(data) || data.length !== texts.length || data.some(d => !Array.isArray(d?.embedding) || !d.embedding.length || d.embedding.some(x => typeof x !== 'number'))) throw new Error('the embedding server answered in an unexpected shape (expected data[].embedding)');
    return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
  };
}

export const modelOf = cfg => cfg.model || 'server-default';

// Models refuse input longer than their window (often 512 tokens, fewer characters for code). When the server answers 400 or 413,
// split the batch to find the text, then split that text in two at a line break (the first line, the module title, is repeated on
// the second half) and embed both halves, recursively. No text is dropped: the window gets several vectors, and the index already
// scores a module by its best vector. A window that was split yields an array of vectors. `stats.split` counts the windows split.
export function fitting(embed, stats) {
  const refused = e => e?.status === 400 || e?.status === 413;
  const halves = text => {
    const nl = text.indexOf('\n'), head = nl > 0 ? text.slice(0, nl + 1) : '', body = text.slice(head.length), mid = body.length >> 1;
    const cut = Math.max(body.lastIndexOf('\n', mid), 0) || mid;
    return [head + body.slice(0, cut).trimEnd(), head + body.slice(cut).trim()].filter(h => h.length > head.length);
  };
  const piece = async (text, e) => {
    if (text.length < 160) throw e;
    const out = [];
    for (const h of halves(text)) { try { const [v] = await embed([h]); out.push(v); } catch (err) { if (!refused(err)) throw err; out.push(...await piece(h, err)); } }
    return out;
  };
  const one = async (text, e) => { const vs = await piece(text, e); stats.split++; return vs; };
  const many = async texts => {
    try { return await embed(texts); } catch (e) {
      if (!refused(e)) throw e;
      if (texts.length === 1) return [await one(texts[0], e)];
      const mid = texts.length >> 1; return [...await many(texts.slice(0, mid)), ...await many(texts.slice(mid))];
    }
  };
  return many;
}

export async function readConfig(storeDir) {
  try { const c = JSON.parse(await readFile(join(storeDir, CONFIG), 'utf8')); return c && typeof c.url === 'string' && (c.model === undefined || typeof c.model === 'string') ? c : null; } catch { return null; }
}

async function readIndex(storeDir) { try { return await decodeIndex(await readFile(join(storeDir, VECTORS))); } catch (err) { if (err.code === 'ENOENT') return null; throw err; } }

const atomic = async (path, data) => { const tmp = `${path}.${process.pid}.tmp`; try { await writeFile(tmp, data); await rename(tmp, path); } catch (e) { await rm(tmp, { force: true }); throw e; } };

// The retriever every command uses. BM25 unless embeddings are configured and the index is current.
export async function makeRetriever(catalog, storeDir, io, deps = {}, { timeoutMs = 10000, embeddings = true } = {}) {
  const corpus = corpusFromCatalog(catalog);
  if (deps.createRetriever) return deps.createRetriever(corpus);
  const bm25 = await createBm25Retriever(corpus), cfg = embeddings ? await readConfig(storeDir) : null;
  if (!cfg) return bm25;
  const fallback = notice => ({ identity: bm25.identity, notice, search: bm25.search });
  let index;
  try { index = await readIndex(storeDir); } catch (err) { return fallback(`embeddings unavailable (${err.message}); used BM25`); }
  if (!index) return fallback('embeddings are on but not built; run: nib embed build (used BM25)');
  const why = staleness(index, corpus, modelOf(cfg));
  if (why) return fallback(`${why}; run: nib embed build (used BM25)`);
  return createHybridRetriever({ bm25, corpus, index, embed: httpEmbedder({ url: cfg.url, model: cfg.model, fetch: io.fetch, env: io.env, timeoutMs: timeoutMs + 1000 }), timeoutMs });
}

// Embeds what changed and writes the index. Returns the summary line, or null when embeddings are off or there is no store.
export async function reindex(storeDir, io) {
  const cfg = await readConfig(storeDir);
  if (!cfg) return null;
  let catalog; try { catalog = await loadStore(storeDir); } catch (e) { if (e.code === 'missing') return null; throw e; }
  const corpus = corpusFromCatalog(searchableSkills(catalog));
  let previous = null; try { previous = await readIndex(storeDir); } catch { /* rebuild from scratch */ }
  const stats = { split: 0 }, t0 = Date.now(), r = await buildIndex({ corpus, model: modelOf(cfg), previous, embed: fitting(httpEmbedder({ url: cfg.url, model: cfg.model, fetch: io.fetch, env: io.env }), stats) });
  const bytes = encodeIndex(r.index);
  await atomic(join(storeDir, VECTORS), bytes);
  return `Embedded ${r.embedded} module${r.embedded === 1 ? '' : 's'} (${r.windows} windows), reused ${r.reused}; ${r.index.dims} dimensions, ${bytes.length} bytes, ${((Date.now() - t0) / 1000).toFixed(1)} s.${stats.split ? ` ${stats.split} window${stats.split === 1 ? ' was' : 's were'} too long for the model and ${stats.split === 1 ? 'was' : 'were'} split in halves; all the text is indexed.` : ''}`;
}

// After import, update and remove: keep an existing index current. A failure never fails the command; the old index stays and searches use BM25 until the next build.
export async function autoIndex(storeDir, io) {
  try { const line = await reindex(storeDir, io); if (line) io.stdout.write(`Embedding index updated. ${line}\n`); }
  catch (err) { io.stderr.write(`nib: the embedding index was not updated (${err.message}); searches use BM25 until you run: nib embed build\n`); }
}

export async function cmdEmbed(args, io, storeDir) {
  const [sub, ...extra] = args.positionals;
  if (!['on', 'build', 'status', 'off'].includes(sub) || extra.length) throw new UsageError('embed needs one of: on, build, status, off');
  const f = args.flags, cfg = await readConfig(storeDir);
  if (sub === 'on') {
    if (!f['--url']) throw new UsageError('embed on needs --url URL (and optionally --model NAME)');
    let u; try { u = new URL(f['--url']); } catch { throw new UsageError(`--url is not a URL: ${f['--url']}`); }
    if (!/^https?:$/.test(u.protocol)) throw new UsageError('--url must be http or https');
    await loadStore(storeDir);
    const [v] = await httpEmbedder({ url: f['--url'], model: f['--model'], fetch: io.fetch, env: io.env, timeoutMs: 15000 })(['nib']);
    await mkdir(storeDir, { recursive: true });
    await atomic(join(storeDir, CONFIG), JSON.stringify({ format: 1, url: f['--url'], ...(f['--model'] ? { model: f['--model'] } : {}) }, null, 2) + '\n');
    io.stdout.write(`Embeddings on: ${f['--model'] ?? 'the server\'s own model'} at ${f['--url']} (${v.length} dimensions).\nSkill text and your asks will be sent to ${u.origin}${LOOPBACK.test(u.hostname) ? ' (this machine)' : ''}.\n`);
    if (!LOOPBACK.test(u.hostname)) io.stdout.write(`Warning: ${u.hostname} is not this machine; the text of your skills leaves it when you run "nib embed build".\n`);
    io.stdout.write('Next: nib embed build. Until then nib uses BM25. Experimental: see docs/guide/embeddings.md for the evidence.\n');
    return 0;
  }
  if (sub === 'off') {
    await rm(join(storeDir, CONFIG), { force: true });
    if (f['--delete']) await rm(join(storeDir, VECTORS), { force: true });
    io.stdout.write(`Embeddings off${cfg ? '' : ' (they were not on)'}. nib uses BM25 only.${f['--delete'] ? ' Vectors deleted.' : ''}\n`);
    return 0;
  }
  if (sub === 'status') {
    if (!cfg) { io.stdout.write('Embeddings are off. nib uses BM25 only.\n'); return 0; }
    const catalog = searchableSkills(await loadStore(storeDir)), corpus = corpusFromCatalog(catalog);
    io.stdout.write(`Embeddings on: ${cfg.model ?? 'the server\'s own model'} at ${cfg.url}\n`);
    let index = null, problem = null;
    try { index = await readIndex(storeDir); } catch (e) { problem = e.message; }
    if (problem) io.stdout.write(`Index: unusable (${problem}); run: nib embed build\n`);
    else if (!index) io.stdout.write('Index: not built; run: nib embed build\n');
    else {
      const age = Math.round((Date.now() - (await stat(join(storeDir, VECTORS))).mtimeMs) / 60000), why = staleness(index, corpus, modelOf(cfg));
      io.stdout.write(`Index: ${index.items.length} modules, ${index.items.reduce((n, i) => n + i.vectors.length, 0)} windows, ${index.dims} dimensions, built ${age} min ago\nState: ${why ? `${why}; run: nib embed build (searches use BM25 until then)` : 'current'}\n`);
    }
    return 0;
  }
  if (!cfg) throw new Error('embeddings are off; run: nib embed on --url URL');
  io.stdout.write((await reindex(storeDir, io)) + '\n');
  return 0;
}
