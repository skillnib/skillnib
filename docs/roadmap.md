# Roadmap

Open-source release 0.1.0 (CLI, Claude Code first). One spec = one PR. The hosted release (curated and private catalogs with permissions) follows on the same shared core. Updated 2026-10-12.

## Status

| # | Item | Status |
|---|---|---|
| 0 to 4 | Spec gates, compile, import, BM25 retriever, `tap` CLI and delivery | Done, on `main` |
| R2, R2b | Claude Code hook limits; smoke test | Done: hook delivery matched native loading (10 synthetic tasks; wide interval) |
| 5 | `tap hook claude` (budgeted injection, cwd-independent store, fail-open) | Done, on `main` |
| R6, R6b | Score cutoff and terse-ask guard (offline) | Done: no prompt-level guard is supported; push versus pull is the open question |
| 6 | `tap init claude` (hook in settings, hide native skills, undo) | Built, PR #16 |

## Release plan (decisions and dependencies)

Decisions taken so the plan can move (the user can veto any):

- D1. Build both delivery modes, push (the hook) and pull (the agent calls `tap ask`), and let an end-to-end evaluation on real skills (C3) choose the default by a rule written first. Reason: the mode is cheap to build, push has a measured unfixed cost (4 to 7 KB injected on every short follow-up) and pull has parity only on 10 synthetic tasks, so evidence should decide, not opinion.
- D2. Publish one npm package, `skilltap`, containing `apps/cli` and the `packages/*` it uses, with no bundler. The relative imports stay valid inside the package, which keeps the no-dependency rule.
- D3. Licence: needs the user's choice. Recommendation: Apache-2.0 (patent grant, fits a later hosted product).
- D4. CI stays off until the account has credit or the repo is public; gates run locally and no check is marked required.
- D5. The embedding ablation (R5) runs offline in parallel and does not block the release; the default stays BM25 unless it shows a gain at equal bytes.

Order of work. Items on the same line can run in parallel; an item waits for everything it depends on.

| Step | What | Depends on | Who |
|---|---|---|---|
| 1 | Merge PR #16 (slice 6) | nothing | user |
| 2 | Slice 7: `tap init claude --mode pull` (a managed CLAUDE.md block listing the skills and telling the agent to run `tap ask`; undoable) | 1 | spec, user approves, build |
| 2 | Slice 8: npm package and an install smoke test (`npm pack`, install into a temp directory, run `tap init` and `tap ask`) | 1 | spec, user approves, build |
| 2 | R5: embedding ablation protocol, then the offline run, including the R6b terse sets | nothing | protocol, then run |
| 2 | Live GitHub import check: `tap import cloudflare/skills@c430dd9` with a working token | nothing | user, one command |
| 3 | C3 protocol: real Claude Code, both pinned catalogs, the 89 C2 asks each, arms native, hook and pull (plus no-skill on a validity subset), the C2 needle grader, tokens, turns and cost recorded; default-mode rule fixed in advance; 12-run pilot to confirm cost | 2 (slice 7) | protocol, pilot, user confirms cost |
| 4 | C3 run (about 550 to 600 runs; cost estimated from the pilot) and C3b: 10 scripted six-turn conversations comparing cumulative tokens | 3 | run |
| 5 | Slice 9: loaded ledger (never inject the same section twice in a session), only if push is kept or offered | 4 | spec, build |
| 5 | Set the default mode in `tap init` from the C3 rule | 4 | small change |
| 6 | README quickstart, LICENSE, safety notes (third-party skills are untrusted instructions), measured claims and limits only | 2 (slice 8), 4 | docs PR |
| 7 | Release gate: C3 supports the claims, GitHub import verified live, two real projects dogfooded, licence chosen, package installs cleanly; then tag 0.1.0 | 5, 6 | all |

Critical path: 1, slice 7, C3 protocol and pilot, C3 run, default decision, README, release gate. Packaging, R5 and the GitHub check are off the critical path but must finish before the gate (R5 only if it changes the default).

Not in 0.1.0: import include/exclude, ranked outline, usage logging and the learning loop, other harnesses, Windows support, the hosted service.

## R5: embedding ablation (parallel, offline)

Question: does a small dense model fused with BM25 raise recall at equal bytes over BM25 alone, on our task, at a sample size that can decide it?

What already exists (branch `v1`, `docs/research/C1-offline-retrieval.md`, no model calls): dense (`bge-small-en-v1.5`, ONNX quantized, windows of 1,800 characters, query prefix per the model card) and hybrid (reciprocal rank fusion, k 60) were scored against BM25 on the 12 frozen C1 tasks per catalog. Needle coverage at top 6: Cloudflare BM25 75.0, dense 79.2, hybrid 79.2; HyperFrames BM25 77.1, dense 50.0, hybrid 68.8. Dense minus BM25 was +4.2 [0, 12.5] on Cloudflare and -27.1 [-52.1, -4.2] on HyperFrames; fusion minus BM25 was +4.2 [0, 12.5] and -8.3 [-22.9, 0]. So no recall gain was shown on both catalogs, and the sample was small (12 tasks, authors saw the gold text). That run is why BM25 was chosen for C2. It is not the ablation the framework rule asks for, because it was never run on a sample large enough to decide.

R5 therefore reuses that harness on the 89 frozen C2 tasks per catalog, offline, so it needs no model calls beyond running the embedding model locally. Arms: BM25 (slice 3 retriever), dense, hybrid; metric needle coverage at top 4 (the delivery size) with bytes; paired bootstrap over tasks. Report by task type, especially vague asks with little word overlap.

Rule already in the framework skill: embeddings and rerankers are added only if an ablation shows a recall gain at equal bytes. The default stays dependency-free BM25 unless it does.

Before any run (SDD): write the protocol and the decision rule in a research doc, committed first (for example: hybrid must beat BM25 at top 4 on both catalogs with the interval above zero, otherwise BM25 stays); keep catalogs pinned and unpooled; note that the C2 tasks have been seen for the BM25 verdict, so any tuning after seeing R5 results is post hoc. Slice 3's retriever interface is what lets a dense or hybrid arm plug in without changing delivery.
