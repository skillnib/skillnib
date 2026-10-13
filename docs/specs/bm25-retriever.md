# Spec: rank skill modules for an ask with BM25 behind a retriever interface

Status: APPROVED by user 2026-10-12. Slice 3 of the open-source release; consumes slice 1 (modules) and slice 2 (catalog). Research basis (branch `v1`): `tools/research/c1/retrieval/common.mjs` (`tokens`, `bm25Index`, `rank`) and C2 arm B (`docs/research/C2-bm25-vs-native-large.md`). The user approved dropping zero-score modules and deferring any further cutoff to a measured slice-4 item.
Spec-ID: bm25-retriever
Scope: packages/retrieve/**

## Purpose

Given a corpus of modules and an ask, return the best-matching modules in rank order, using exactly the retrieval that passed C2, and record which retriever produced the ranking, so delivery can show the agent verbatim sections and later retrievers (dense, hybrid) can replace this one without changing delivery.

## Non-goals

No delivery or formatting of sections, no outline, no CLI, no fail-open behaviour (those are slice 4), no stage-1 skill list, no embeddings or reranking (a later ablation, R5 in `docs/roadmap.md`), no stemming, synonyms or query rewriting, no persistence of the index, no multi-source or permission filtering.

## Where it lives

A new dependency-free, runtime-neutral package `@skilltap/retrieve` (`packages/retrieve`): pure functions on plain objects, no `node:` imports, hashing with Web Crypto. It does not import the compile or import packages; it takes plain corpus items, plus a small adapter function that reads the catalog shape from slice 2 structurally.

## Interface

- `createBm25Retriever(corpus) -> Promise<Retriever>` (asynchronous because the corpus hash uses Web Crypto), where `corpus` is an array of `{ id, title, text, hash }` (module id unique in the corpus, `hash` the module's content hash from the manifest).
- `Retriever`: `{ identity, search(ask, { k = 4, minScore? }) -> Promise<Hit[]> }`. `search` is asynchronous so a dense retriever can implement the same interface. `Hit` is `{ id, score, rank }` with rank starting at 1.
- `identity`: `{ name: 'bm25', version, params: { k1, b, tokenizer, stopwordsHash }, corpusHash }`, where `corpusHash` is the SHA-256 of the ordered list of `id` and `hash` pairs. It is JSON-serialisable and identical for identical inputs.
- `corpusFromCatalog(catalog) -> corpus`: one item per module of every file of every skill in a slice-2 catalog, in catalog order, with id `<skill id>/<file path>#<module id>` and the module's title and verbatim text.

## Ranking rule (the C2 arm B configuration)

1. Tokens: lowercase, split on runs of characters outside `a-z0-9`, keep tokens of at least 2 characters that are not in the fixed C2 stopword list (the list is pinned by `stopwordsHash`). No stemming. Non-ASCII letters are separators, as in the research code.
2. A module's document is its title and its text. Term frequency, document length (token count) and the average length are computed over the corpus given.
3. Score: for each distinct query token present in the corpus, `idf * f * (k1 + 1) / (f + k1 * (1 - b + b * len / avgLen))` with `idf = ln(1 + (N - n + 0.5) / (n + 0.5))`, `k1 = 1.2`, `b = 0.75`, summed over query tokens.
4. Ranking is by score descending, ties broken by corpus order. Only modules with a score above zero are returned (a module sharing no query token with the ask is never a match), up to the top `k`. A caller may pass a higher `minScore`. This equals the C2 configuration on every C2 ask: all 178 asks matched at least 267 modules, so no zero-score module was ever among the delivered top 4.

## Requirements

- R1 Reference equivalence: on the C2 inputs, ranking is identical to the research implementation. A checked-in fixture holds excerpts of modules from both pinned catalogs and at least 30 real C2 asks, with the research implementation's top-10 order and scores computed over those excerpts; a non-CI script repeats the comparison on the full catalogs. The retriever reproduces every fixture order exactly, with scores matching to 9 decimal places (all fixture asks have at least 10 positive-score modules).
- R2 Tokenization and scoring follow the ranking rule: lowercasing, the separator rule, minimum length, the stopword list, duplicate query tokens counted once, and the formula with `k1 = 1.2`, `b = 0.75`, on hand-computed small corpora.
- R3 Ordering and limits: results are sorted by score descending with ties in corpus order, return at most `k` hits with ranks 1..n, exclude modules with a score of zero (and any below a given `minScore`), and are deterministic across calls.
- R4 Identity: `identity` records name, version, parameters, stopword hash and corpus hash; the corpus hash changes when any module id or hash changes, and is unchanged otherwise.
- R5 Edge inputs: an empty corpus gives no hits, an ask with no usable tokens gives no hits, and invalid input (non-array corpus, duplicate module ids, non-string ask, `k` that is not a positive integer) throws a `TypeError` with a clear message.
- R6 Catalog adapter: `corpusFromCatalog` produces one item per module with the verbatim module text (joining a skill file's items' texts reproduces the file), unique ids, and the manifest hash; retrieving over a real catalog returns ids that resolve back to the module text.
- R7 Interface seam: a second, trivial retriever implementing the same `Retriever` shape can be used wherever `createBm25Retriever` is used, shown by a test that swaps one for the other behind a function that accepts any `Retriever`.
- R8 Boundary: the package has no dependencies and imports nothing outside the language runtime, and `npm run check` passes.

## Examples (single happy path and single failure, not a test plan)

- Happy path: over the 17-skill cloudflare/skills catalog (about 1,000 modules), `search('how do I bind a KV namespace in wrangler config', { k: 4 })` returns four hits whose ids resolve to module text, with `identity.corpusHash` stable across runs.
- Failure: a corpus with two modules of the same id throws a `TypeError` naming the duplicated id rather than silently ranking one of them.

## Risks and open questions

- Zero-score modules are dropped because they cannot match lexically; this changes nothing on the C2 asks. The remaining noise is weak positive matches on common words. On the C2 asks, the gold sections that reached the top 4 scored 0.48 to 1.0 (Cloudflare) and 0.40 to 1.0 (HyperFrames) of the top score, so a relative cutoff looks possible, but that is read off data already seen. No relative or absolute cutoff is specified here; slice 4 may add one only after it is measured (the offline harness needs no model calls). Off-topic asks cannot be separated by an absolute score: in C1 their top-1 scores overlapped the positives (Cloudflare positives 16 to 50, negatives 12 to 23), so the outline and fail-open behaviour in slice 4 carry that case.
- The index is rebuilt for each retriever; the cost is small (about 1,000 to 2,000 modules) but a persisted index is deferred to the storage work.
- The research code used one catalog at a time as the corpus; scores depend on corpus size and mean length, so combining catalogs changes rankings. This spec does not claim anything about pooled corpora.
- The stopword list is English only and fixed; non-English skills would be poorly served.
- R1 depends on fixtures generated from the research code on branch `v1`; the generating script is kept under the package's non-CI scripts, and the catalogs must be checked out to regenerate them.

## Size and safety

About 150 lines of pure code plus fixtures. No network, filesystem or secrets. Asks and module text are treated as data and are never executed.
