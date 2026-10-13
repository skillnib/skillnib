import { STOPWORDS, TOKENIZER, tokenize } from './tokens.js';

export const K1 = 1.2, B = 0.75, VERSION = 1;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async text => hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

function checkCorpus(corpus) {
  if (!Array.isArray(corpus)) throw new TypeError('corpus must be an array of { id, title, text, hash }');
  const seen = new Set();
  corpus.forEach((m, i) => {
    if (m === null || typeof m !== 'object') throw new TypeError(`corpus item ${i} must be an object`);
    for (const f of ['id', 'title', 'text', 'hash']) if (typeof m[f] !== 'string') throw new TypeError(`corpus item ${i} (${m.id ?? '?'}): "${f}" must be a string`);
    if (seen.has(m.id)) throw new TypeError(`duplicate module id in corpus: ${m.id}`);
    seen.add(m.id);
  });
}

export async function createBm25Retriever(corpus) {
  checkCorpus(corpus);
  const N = corpus.length;
  const docs = corpus.map(m => {
    const tf = new Map(), tokens = tokenize(m.title + ' ' + m.text);
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    return { tf, len: tokens.length };
  });
  const avg = docs.reduce((a, d) => a + d.len, 0) / N;
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const identity = {
    name: 'bm25', version: VERSION,
    params: { k1: K1, b: B, tokenizer: TOKENIZER, stopwordsHash: await sha256([...STOPWORDS].sort().join('\n')) },
    corpusHash: await sha256(corpus.map(m => `${m.id}\t${m.hash}`).join('\n')),
  };
  return {
    identity,
    async search(ask, { k = 4, minScore } = {}) {
      if (typeof ask !== 'string') throw new TypeError('ask must be a string');
      if (!Number.isInteger(k) || k < 1) throw new TypeError('k must be a positive integer');
      if (minScore !== undefined && !(typeof minScore === 'number' && Number.isFinite(minScore))) throw new TypeError('minScore must be a finite number');
      const scores = new Float64Array(N);
      for (const t of new Set(tokenize(ask))) {
        const n = df.get(t); if (!n) continue;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        for (let i = 0; i < N; i++) { const f = docs[i].tf.get(t); if (f) scores[i] += idf * f * (K1 + 1) / (f + K1 * (1 - B + B * docs[i].len / avg)); }
      }
      return Array.from(scores, (s, i) => [s, i]).filter(([s]) => s > 0 && (minScore === undefined || s >= minScore))
        .sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, k).map(([score, i], r) => ({ id: corpus[i].id, score, rank: r + 1 }));
    },
  };
}
