---
name: skilltap-delivery-framework
description: Objectives, invariants and slice order for SkillTap work on skill import, compile, retrieval, delivery, measurement and learning. Use before slicing or specifying any feature that touches how skills are ingested, indexed, delivered, evaluated or improved.
---

# SkillTap delivery framework

Status: agreed in the design discussion of 2026-10-11. Items marked Open are undecided. Use this with sdd-slice-wish: it supplies objectives and invariants for a slice. It does not draft specs, acceptance criteria or test cases.

## Product promise

- Deliver only what the agent's ask needs, verbatim, with the same outcome as loading the whole skill file.
- The worst case equals a full load. Low confidence fails open to more content, never to a guess.
- Do not promise that the agent can never miss a deliverable. Promise a bounded, measured delivery-miss rate per skill.
- Delivered instruction text is always a verbatim slice of the source. The learning loop edits metadata and parameters, never instruction text.

## Failure model

- Delivery miss: the needed instruction never reached the agent.
- Use failure: it was delivered and the agent did not follow it.
- Wrong need: the agent asked for the wrong thing or never asked.
- Skill problem: the skill is wrong, stale, ambiguous or contradicts the user.
- No skill covers the task.
- Every failed evaluation trial is attributed to one of these, using whether the gold module was in the delivered set. Delivered-and-failed is not a retrieval problem.

## Pipeline

- Import, then compile (parse, segment, enrich, validate, link, freeze), then index.
- Ask: hook or CLI sends needs, retrieval ranks, fusion merges, assembly adds constraints and dependencies, the agent receives modules plus an outline of what was not loaded.
- Learn: usage signals and an evaluation set produce metrics, failure types and proposed metadata fixes, which recompile into a new version.

## Compile invariants

- Lossless: preamble plus all module spans reproduce the source exactly. Nothing is dropped or duplicated.
- Every dependency resolves and there are no cycles.
- Constraints are source spans selected by a person, not paraphrases.
- One shared segmenter serves built-in and imported skills.
- Each module and the skill have content hashes. Pinned reads of any served version keep working.

## Segmentation and size

- Size signals are advisory: module share of the skill, absolute module size, and topic heterogeneity measured by probes.
- Share depends on the skill's total size. Heterogeneity and absolute size do not.
- Small skills default to Full mode and need no segmentation.
- Never cut mid-section. A large module with no sub-headings is flagged as not splittable without editing the source.
- Thresholds are placeholders until measured savings set them.

## Discovery metadata

- useWhen is a tested hypothesis, not a guarantee. It is phrased as what a person would ask, grounded in the module text, unique across modules of a skill, and capped in number.
- It must prove value per skill by ablation, and is dropped where it does not help.
- Probes are written independently of the drafter. A human-seeded set is the anchor. A held-out split is never used to write or tune anything and its questions are not shown to authors.
- We change our metadata layer only. Suggestions about the author's own wording are optional.

## Delivery modes

- Targeted: modules selected by retrieval.
- Outline: the service returns the module list with descriptions, and the agent picks.
- Full: the whole skill.
- A skill's mode follows its measured probe results. New skills start in Outline. Rising miss rates demote a skill automatically.

## Retrieval

- Retriever is an interface with a recorded identity. Reports are comparable only within the same identity.
- Default is dependency-free keyword ranking plus graph expansion. Embeddings and rerankers are added only if an ablation shows a recall gain at equal bytes.
- Open and hosted releases use the same retriever unless data says otherwise.
- The agent states its needs as several sub-queries. Confidence is the gap between the best and third-best score. The 0.35 threshold is a placeholder until the evaluation sets it.

## Autonomy policy

- Each compile and learning step has a review policy: required, sampled or off, with levels 0 (propose only) to 3 (automatic).
- Constraints stay at level 0 until retention evidence exists: a probe per constraint and compliance not worse than full loading.
- Descriptions and useWhen start at required and move to sampled only after their gates pass on real runs.
- A change becomes a new immutable version, runs in shadow, then on a share of traffic, and is promoted only if gates hold: required-module recall does not drop, quality stays non-inferior, fail-open rate does not rise. Otherwise it rolls back.
- Changes are capped per cycle and every one is logged.
- Documented product rules about reviewing descriptions are to be updated to this policy. Not yet done.

## Measurement

- Layers: retrieval recall on probes, instruction retention over turns, end-to-end task quality, production telemetry.
- Controls: no skill, full skill, SkillTap, and a deliberate omit-the-needed-module control to prove the grader detects loss.
- Always report bytes. Token counts need an exact tokenizer. Cost needs provider usage. Latency includes extra round trips.
- Comparisons lock dataset, tokenizer and retriever identity, and allow the catalog to change as the thing being varied. The current harness refuses to compare across catalog hashes, which blocks this.
- Never present illustrative numbers as measurements. Never call imported test results trusted execution. Keep evaluation tooling private.

## Data and storage

- Sources are immutable and keyed by content hash. Compiled versions are immutable manifests. Mutable state is only small pointers and policy.
- Metadata edits live in an overlay keyed by module hash, so they survive upstream edits.
- Indexes are derived, rebuildable and never the source of truth.
- Probe sets, evaluation reports and trial records are versioned and immutable. Usage signals and the change ledger are append-only.
- Immutable, bounded, reviewable assets (manifests, overlays, probe sets) are JSON files with a size cap. Logs, signals, trials and the change ledger are never JSON files: they need grouping and joins, so they live in SQLite.
- Open release: SQLite through the built-in node:sqlite, which is still marked experimental in Node 22, so confirm the minimum patch version and isolate it behind the storage interface. Fallback is append-only JSONL with rotation and rollups.
- Hosted release: Cloudflare. D1 is SQLite-based, so events, trials and the ledger keep one SQL dialect in both releases. Large blobs go in R2 and the service runs on Workers. Postgres is not planned.
- The core stays runtime-neutral so it runs on both Node and Workers: pure functions, no filesystem or Node-only imports in shared code, Web Crypto for hashing, and a storage interface with a node:sqlite adapter and a D1 adapter running the same tests.
- Retrieval scoring is our own code over an in-memory index built from the manifest, never the database's own ranking, so both releases score identically.
- When working with Cloudflare use the cf CLI unless the project has a Wrangler configuration file. None exists yet. Check current D1 limits and pricing before recording the hosted decision.
- Usage text is opt-in, redacted, retention-limited and local by default. Learning across tenants uses aggregates only.

## Research phase

- The product core is small and unproven, so treat it as greenfield. Keep the development tooling (Slicer, pipeline, agent runner) and the CLI contract, pinned-identity semantics, atomic-write pattern, no-dependency rule and package-boundary check.
- R4 first: does an agent do as well with modules as with the whole file? Protocol and results in docs/research/R4-pilot.md. First pilot (72 runs, one skill, one-turn tasks, right sections supplied) was non-inferior under the pre-registered rule. It says nothing about retrieval, multi-turn retention, other models or tokens, so a harder second pilot is still needed. Second pilot R4b (90 runs, six tasks, three multi-turn, BM25 retrieval arm, docs/research/R4b-pilot.md): valid; with the right sections supplied modules matched the 33 KB bundle (97% vs 93% of needle facts, non-inferior); with naive BM25 retrieval they fell to 68% (inconclusive against the -15 margin, mean -25), almost entirely because the right section was not delivered (18 of 19 misses). Retrieval, not module use, is the weak point. R4c (39 runs, R3 retrievers): modules chosen by BM25 plus descriptions plus an agent-stated need matched the bundle (90% vs 93%, non-inferior, 14% of the bytes); without a stated need they reached 72% (probably inferior). The stated needs were written by the experimenter, so this is an upper bound; the agent-stated need is the part still to be proven (R3 round 2). R3 round 2 (independent queries, needs and descriptions): keyword retrieval reached 82 to 88% section recall at 2 to 3 KB (B2g 86%, B3g 88%), below the 90% target, and fail-open added 1.4 points; agent-stated needs were worth about 4 points, not the 10 that oracle needs suggested. R3 round 3 (fresh test set, 114 queries): an agent choosing from an outline reached 92% with titles only (2.5 KB total) and 96% with generated descriptions (7.1 KB), and it declined near-domain negatives far better than retrieval (20 to 40% false delivery against 100%); retrieval with fail-open scored 95% there but 88% on the earlier set, so test-set wording moves recall by 4 to 11 points. R4d (108 runs, six tasks, answers written from delivered text): an outline with titles only matched the full 35 KB bundle (93% vs 88% of needle facts, non-inferior, 12% of the bytes), generated descriptions scored the same at twice the bytes, and retrieval with fail-open matched it (88%) but missed the second section of a two-section ask. Outline is the working default for small skills; large catalogs need a skill-level stage first.
- R1: survey a corpus of public skills for size spread, heading structure, numbered lists, code fences and extra files. It decides the segmentation rules. The corpus can also seed the catalog, but only skills with a verified permissive licence, recorded provenance and a pinned commit may be redistributed. Others are analysed for metrics only. Third-party skills are untrusted instructions and need review before they are served.
- R2: what each target agent harness lets a hook inject, and its limits.
- R3: retrieval baseline and ablation on the surveyed corpus.
- R5: expected volumes of events, skills and trials, which sets storage sizing.
- Each question ends in a short decision record under docs/research. Slices are re-cut after the answers.

## Slice order

- Provisional until the research phase reports. Re-cut after R4, R1 and R3.
- S0 fix the truncated slice-procedure module.
- S1 measure required-module recall of the current ranker.
- S2 compile a skill file into a verbatim module manifest.
- S3 add skilltap lint.
- S4 introduce the Retriever interface.
- S5 add keyword ranking with graph expansion.
- S6 add useWhen to manifest and import sheet.
- S7 multi-need tap, unloaded outline and fail-open.
- S8 assign delivery modes from probe results.
- S9 let evaluation reports compare across catalog changes.
- S10 exact token counting through a tokenizer provider.
- S11 model-trial runner with failure attribution.
- S12 delta delivery with a loaded ledger.
- S13 prompt hook client.
- S14 local usage signal log.
- S15 improvement loop with per-step review policy.

## Open decisions

- Whether embeddings or a reranker earn a place, decided by ablation.
- Who writes seed probes. Proposal: an agent drafts and a person approves each.
- Threshold values for confidence, size signals and mode assignment.
- Storage defaults for usage signals: what is stored, redaction, retention.
- Cloudflare limits and pricing for D1 and R2, and whether hosted uses a database per tenant.
- Which licences allow seeding the shared catalog from the surveyed corpus.
- Which compiled assets are versioned in git for project-local use.
- Ownership and versioning of the scoring standard.

## Using this framework when slicing

- State which promise or invariant the slice advances and which metric it moves.
- One purpose per slice. No slice claims quality, token or cost results without real instrumentation.
- Reuse the shared catalog, core and delivery packages for both releases. Run the repository check and test commands for shared package changes.
