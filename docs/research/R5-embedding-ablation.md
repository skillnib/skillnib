# R5: does a small embedding model earn a place next to BM25?

Status: PROTOCOL, written and committed before any vector is computed. Offline, no model answers, written 2026-10-12. Framework rule (`packages/catalog/skills/skilltap-delivery-framework/SKILL.md`): embeddings and rerankers are added only if an ablation shows a recall gain at equal bytes.

## What exists

- C1 offline retrieval (`v1`, `docs/research/C1-offline-retrieval.md`, 12 tasks per catalog): needle coverage at top 6 for BM25, dense and hybrid was 75.0, 79.2, 79.2 (Cloudflare) and 77.1, 50.0, 68.8 (HyperFrames); dense minus BM25 was +4.2 [0, 12.5] and -27.1 [-52.1, -4.2]; hybrid minus BM25 +4.2 [0, 12.5] and -8.3 [-22.9, 0]. No gain on both catalogs, but only 12 tasks.
- R6b (this repository): BM25 needle coverage at the hook budget falls from 86.7 and 80.8 for the long C2 asks to 68.3 and 53.3 for short rewrites and 45.8 and 30.8 for ultra-short ones. Short asks are the likeliest place for a dense model to help.

## Question

At equal delivered bytes, does dense or hybrid retrieval cover more needles than BM25 on (a) the 89 long C2 asks, and (b) the 60 short and ultra-short rewrites per catalog?

## Arms (parameters fixed now, no tuning)

- BM25: the slice 3 retriever, top 4, then the hook's 9,500-character budget (the delivery the product makes).
- Dense: `Xenova/bge-small-en-v1.5` (ONNX, quantized, MIT licence), the query prefix from its model card ("Represent this sentence for searching relevant passages: "), each module split into windows of at most 1,800 characters at line boundaries with the heading path prefixed, module score the maximum window cosine; top 4, same budget.
- Hybrid: reciprocal rank fusion of the BM25 and dense rankings, k = 60; top 4, same budget.

## Data

The 89 C2 asks per catalog (cloudflare/skills `c430dd9` and hyperframes `e1925d4`, never pooled) with their frozen needles; the 30 short and 30 ultra-short rewrites per catalog of `docs/research/R6b-terse/terse.json`, scored against the needles of their original asks. These asks are already seen. Nothing is tuned here, so no split is needed; any parameter changed after seeing results is post hoc.

## Measures

Primary: needle coverage of the delivered sections (share of an ask's needles whose gold section is delivered, averaged over asks) for each arm and ask set, with the paired bootstrap interval over asks for hybrid minus BM25 and dense minus BM25 (4000 resamples, seed 20261101). Also reported: mean delivered characters per arm (the equal-bytes check), results by task type and by ask length, and the cost side (model size, the extra install weight, seconds to embed a catalog and to answer one query on this machine).

## Decision rule (fixed now)

- Hybrid becomes a default candidate only if, on the long asks, hybrid minus BM25 has a 95% lower bound above 0 and a point gain of at least 5 points on both catalogs, and hybrid's mean delivered characters are within 5% of BM25's. The 5-point floor pays for a runtime dependency and a model download.
- If that fails but hybrid or dense beats BM25 with a lower bound above 0 on the pooled short and ultra-short asks on both catalogs, record it as an optional retriever for terse asks, not a default.
- Otherwise record that BM25 stays. In every case BM25 remains the dependency-free default of the open release unless the first rule is met.

## Limits stated in advance

The asks are authored and lexically close to their answers, which flatters BM25; the rewrites were written by the author who knew the answers. Coverage is retrieval coverage, not task success; a gain here still needs an end-to-end check. Two catalogs of 17 and 21 skills. The embedding library and model add a dependency the project avoids, so a gain has to be large to matter. The harness stays private.

## Results (run 2026-10-12, offline)

Needle coverage of the delivered sections (top 4, then the 9,500-character hook budget), by ask set. Paired bootstrap 95% interval over asks in brackets (4000 resamples, seed 20261101).

| Set | Catalog | BM25 | Dense | Hybrid | Hybrid minus BM25 | Dense minus BM25 |
|---|---|---|---|---|---|---|
| Long (89) | Cloudflare | 83.7 | 73.0 | 83.4 | -0.3 [-9.0, +7.9] | -10.7 [-20.5, -0.8] |
| Long (89) | HyperFrames | 77.2 | 62.7 | 76.0 | -1.1 [-7.3, +5.3] | -14.4 [-24.1, -5.2] |
| Short (30) | Cloudflare | 68.3 | 67.5 | 76.7 | +8.3 [-5.8, +22.5] | -0.8 [-15.8, +15.0] |
| Short (30) | HyperFrames | 53.3 | 25.8 | 46.7 | -6.7 [-24.2, +9.2] | -27.5 [-48.3, -5.0] |
| Ultra (30) | Cloudflare | 45.8 | 51.7 | 59.2 | +13.3 [-4.2, +30.8] | +5.8 [-17.5, +28.3] |
| Ultra (30) | HyperFrames | 30.8 | 25.8 | 30.0 | -0.8 [-12.5, +10.0] | -5.0 [-19.2, +10.0] |

Mean delivered characters (BM25 / dense / hybrid), long asks: Cloudflare 5,407 / 4,938 / 5,382; HyperFrames 6,035 / 5,898 / 5,975. For the short and ultra sets hybrid delivered 2 to 14% more characters than BM25 (Cloudflare short 4,790 / 4,875, ultra 3,732 / 4,254; HyperFrames short 5,084 / 5,562, ultra 4,942 / 5,557).

Long asks by type, BM25 / dense / hybrid coverage (Cloudflare): single 87.5 / 67.5 / 75.0, ref 84.5 / 90.5 / 93.1, cross 76.7 / 50.0 / 78.3, vague 81.7 / 73.3 / 86.7. HyperFrames: single 80.8 / 70.8 / 86.7, ref 81.0 / 75.9 / 82.8, cross 52.8 / 23.9 / 47.8, vague 86.7 / 60.0 / 70.0.

Cost side: model file 34 MB (quantized). The JavaScript runtime and its dependencies (`@huggingface/transformers` with `onnxruntime-node` and `onnxruntime-web`) came to 484 MB in `node_modules` here, 46 packages; one install step wanted to download binaries from a host the network blocks and had to be skipped. Embedding all windows on this machine's CPU took 101 s for Cloudflare (1,067 modules, 1,223 windows) and 232 s for HyperFrames (2,137 modules, 3,046 windows); one query took about 7 ms.

## Verdict against the rule

- Default candidate: not met. On the long asks hybrid minus BM25 is -0.3 and -1.1 points with intervals that include 0 and nothing near the required +5 on either catalog.
- Optional retriever for terse asks: not met. Hybrid is better on Cloudflare's short and ultra sets (+8.3 and +13.3) but the intervals include 0, and on HyperFrames it is -6.7 and -0.8; the pooled short and ultra point estimate on HyperFrames is negative (about -3.8), so the requirement of a positive lower bound on both catalogs fails without computing the pooled interval.
- BM25 stays the default retriever. Dense alone is clearly worse on the long asks on both catalogs.

## Post hoc (labelled; not findings)

- Hybrid does better than BM25 on Cloudflare's reference and vague long asks (+8.6 and +5.0 points) and worse on its single-skill asks (-12.5), and the pattern on HyperFrames differs (single +5.9, vague -16.7). With 15 to 30 asks per type these are not stable differences.
- The embedding runtime is by far the heaviest thing the project would depend on (hundreds of MB, binaries, a model download). A gain would have had to be large to pay for it; none appeared.

## What this means

The embedding question is closed for the open-source release: no dependency is added and the retriever interface stays as built. Terse asks remain the weak spot (BM25 coverage 46 and 31 on ultra-short asks); the answers there are the pull mode (the agent asks again in its own words) and better asks, not embeddings, on this evidence. It would be worth re-opening only with a materially different catalog or real user queries.
