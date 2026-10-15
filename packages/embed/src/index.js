// Optional dense retrieval. Runtime-neutral: the caller supplies `embed(texts) -> Promise<number[][]>`.
export const MAX_WINDOW = 1800, RRF_K = 60, DENSE_TOP = 20, VERSION = 1;
const MAGIC = 'NIBV';
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async bytes => hex(await globalThis.crypto.subtle.digest('SHA-256', bytes));

// Windows of at most MAX_WINDOW characters at line boundaries, each prefixed with the module title.
export function windowsOf({ title, text }, max = MAX_WINDOW) {
  const head = `${title}\n`, room = Math.max(1, max - head.length), out = [];
  let cur = '';
  const flush = () => { if (cur.trim()) out.push(head + cur.trimEnd()); cur = ''; };
  for (let line of text.split('\n')) {
    while (line.length > room) { flush(); out.push(head + line.slice(0, room)); line = line.slice(room); }
    if (cur.length + line.length + 1 > room) flush();
    cur += line + '\n';
  }
  flush();
  return out.length ? out : [head.trimEnd()];
}

const unit = v => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, x => x / n); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Reciprocal rank fusion of ranked id lists.
export function rrf(lists, k = RRF_K) {
  const score = new Map();
  for (const list of lists) list.forEach((id, r) => score.set(id, (score.get(id) ?? 0) + 1 / (k + r + 1)));
  return [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

// index: { model, dims, items: [{ id, hash, vectors: Float32Array[] }] }
export async function buildIndex({ corpus, embed, model, previous = null, batch = 16, onProgress }) {
  const prev = new Map(previous && previous.model === model ? previous.items.map(i => [i.id, i]) : []);
  const items = [], todo = [];
  let reused = 0, dims = previous && previous.model === model ? previous.dims : 0;
  for (const m of corpus) {
    const old = prev.get(m.id);
    if (old && old.hash === m.hash) { items.push(old); reused++; } else { const it = { id: m.id, hash: m.hash, vectors: [] }; items.push(it); todo.push({ it, ws: windowsOf(m) }); }
  }
  const flat = todo.flatMap(t => t.ws.map(w => ({ t, w })));
  for (let i = 0; i < flat.length; i += batch) {
    const part = flat.slice(i, i + batch), vs = await embed(part.map(p => p.w));
    if (!Array.isArray(vs) || vs.length !== part.length) throw new Error('the embedding server returned the wrong number of vectors');
    vs.forEach((got, j) => { for (const v of Array.isArray(got[0]) ? got : [got]) { if (!dims) dims = v.length; if (v.length !== dims) throw new Error(`the embedding server changed dimensions (${v.length}, expected ${dims})`); part[j].t.it.vectors.push(unit(v)); } });
    onProgress?.(Math.min(i + batch, flat.length), flat.length);
  }
  return { index: { model, dims, items }, reused, embedded: todo.length, windows: flat.length };
}

export function encodeIndex({ model, dims, items }) {
  const header = Buffer.from(JSON.stringify({ format: VERSION, model, dims, items: items.map(i => ({ id: i.id, hash: i.hash, w: i.vectors.length })) }));
  const n = items.reduce((a, i) => a + i.vectors.length, 0), out = Buffer.alloc(8 + header.length + n * dims * 4);
  out.write(MAGIC, 0, 'ascii'); out.writeUInt32LE(header.length, 4); header.copy(out, 8);
  let o = 8 + header.length;
  for (const i of items) for (const v of i.vectors) for (const x of v) { out.writeFloatLE(x, o); o += 4; }
  return out;
}

export async function decodeIndex(buf) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== MAGIC) throw new Error('not a SkillNib vector file');
  const hl = buf.readUInt32LE(4);
  let h; try { h = JSON.parse(buf.toString('utf8', 8, 8 + hl)); } catch { throw new Error('the vector file header is damaged'); }
  if (h.format !== VERSION || !Array.isArray(h.items) || !Number.isInteger(h.dims) || h.dims < 1) throw new Error('the vector file has an unknown format');
  const n = h.items.reduce((a, i) => a + i.w, 0);
  if (buf.length !== 8 + hl + n * h.dims * 4) throw new Error('the vector file is truncated or damaged');
  let o = 8 + hl;
  const items = h.items.map(i => ({ id: i.id, hash: i.hash, vectors: Array.from({ length: i.w }, () => { const v = new Float32Array(h.dims); for (let d = 0; d < h.dims; d++, o += 4) v[d] = buf.readFloatLE(o); return v; }) }));
  return { model: h.model, dims: h.dims, items, hash: await sha256(buf) };
}

// null when the index covers exactly this corpus; otherwise why not.
export function staleness(index, corpus, model) {
  if (index.model !== model) return `the index was built with ${index.model}, not ${model}`;
  const have = new Map(index.items.map(i => [i.id, i.hash]));
  if (have.size !== corpus.length || corpus.some(m => have.get(m.id) !== m.hash)) return 'the embedding index is out of date';
  return null;
}

const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`no answer within ${ms} ms`)), ms); })]).finally(() => clearTimeout(t)); };

// Wraps a BM25 retriever. After each search, `identity` says what produced the hits and `notice` is a one-line reason when it fell back.
export function createHybridRetriever({ bm25, corpus, index, embed, timeoutMs = 1500 }) {
  const state = { used: false, notice: null };
  const identity = () => state.used ? { name: 'bm25+embed', version: VERSION, params: { ...bm25.identity.params, rrfK: RRF_K, denseTop: DENSE_TOP, window: MAX_WINDOW, model: index.model, dims: index.dims }, corpusHash: bm25.identity.corpusHash, indexHash: index.hash } : bm25.identity;
  return {
    get identity() { return identity(); },
    get notice() { return state.notice; },
    async search(ask, { k = 4 } = {}) {
      state.used = false; state.notice = null;
      let dense;
      try {
        const [q] = await withTimeout(embed([ask]), timeoutMs);
        if (!q || q.length !== index.dims) throw new Error('the embedding server answered with the wrong dimensions');
        const qv = unit(q);
        dense = index.items.map(i => [Math.max(...i.vectors.map(v => dot(qv, v))), i.id]).sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1)).slice(0, DENSE_TOP).map(x => x[1]);
      } catch (err) {
        state.notice = `embeddings unavailable (${err.message}); used BM25`;
        return bm25.search(ask, { k });
      }
      state.used = true;
      const lexical = (await bm25.search(ask, { k: corpus.length })).map(h => h.id);
      return rrf([lexical, dense]).slice(0, k).map(([id, score], r) => ({ id, score, rank: r + 1 }));
    },
  };
}
