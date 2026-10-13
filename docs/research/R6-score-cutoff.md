# R6: can a score cutoff stop weak injections without losing needed sections?

Status: PROTOCOL, written and committed before any number is computed. Offline, no model calls. Written 2026-10-12. Context: the slice 5 hook injects the top 4 sections for every prompt, so a short follow-up such as "yes, go ahead" can inject up to 9,500 characters of weakly related text each turn (`docs/specs/claude-code-hook.md`, risks).

## Questions

1. A relative cutoff drops any section whose BM25 score is below a fraction ρ of the top score. How much of the injected volume on follow-up prompts does it remove, and how much needle coverage on real asks does it cost?
2. A minimum-token rule skips retrieval when the prompt has fewer than T usable tokens (the retriever's own tokenizer: lowercase, stopwords removed, at least 2 characters). Same two measures.

## Data

- Positive asks: the 89 frozen C2 asks per catalog (cloudflare/skills `c430dd9`, hyperframes `e1925d4`; catalogs never pooled), scored as in the C1 offline run: needle coverage is the share of an ask's needles whose gold section is among the delivered sections, averaged over asks. These asks are already seen (they decided the BM25 verdict), so the split below stops us tuning and reporting on the same asks.
- Follow-up prompts: `R6-cutoff/followups.json`, 20 conversational (A) and 20 generic coding (B) prompts, written before measuring and not changed afterwards.
- Product code as built in slices 1 to 5 (retriever, budgeted delivery with the 9,500-character cap, top 4).

## Split and selection (fixed now)

- Tune set: the odd-numbered C2 asks of each type by slot order; validation set: the even-numbered ones. Selection uses the tune set only; the validation set is read once, after selection.
- ρ family: 0 (no cutoff), 0.25, 0.4, 0.5, 0.6, 0.7, 0.8. T family: 0, 2, 3, 4, 5, 6.
- ρ* for a catalog is the largest ρ in the family whose tune-set coverage is within 1.0 point of ρ = 0; the chosen ρ is the smaller of the two catalogs' ρ*. T* for a catalog is the largest T that suppresses no tune-set ask; the chosen T is the smaller of the two.
- Coverage is measured on the hook's delivery: cutoff applied to the top 4, then the 9,500-character budget.

## Measures

- Coverage on the validation set at ρ = 0 and at the chosen ρ, with the paired bootstrap interval over asks (4000 resamples, seed 20261101) for the difference.
- On the 40 follow-up prompts, per group: the share of prompts that inject at least one section, the mean number of sections, and the mean output characters, at ρ = 0 and the chosen ρ, and with the chosen T; also for ρ and T together.
- On the validation positives: the share suppressed by T, and mean output characters at the chosen ρ against ρ = 0.
- Descriptive: the same table for every ρ and T in the family, by task type.

## Decision rule (fixed now)

Adopt the chosen ρ (and T) in a later slice only if, on the validation set, both catalogs lose at most 1.0 point of coverage and the chosen setting cuts the follow-up prompts' mean injected characters by at least 50% on group A. Otherwise record that no cutoff is supported and keep the hook as built. Any cutoff adopted from this analysis still needs a model-based check (it was not measured on task success), and anything tried after seeing the validation numbers is post hoc.

## Limits stated in advance

The positive asks are authored, lexically close to their answers (about 42 to 44% word overlap), so real vague asks may score lower and lose more to a cutoff than this measure shows. The follow-up prompts are 40 sentences written by one author for two catalogs and are not a sample of real conversations. Coverage is retrieval coverage, not task success. BM25 scores are relative to the corpus, which is why the rule is relative, but a catalog very unlike these two may behave differently.

## Results (run 2026-10-12, offline; per-catalog numbers below)

Selection on the tune set gave ρ* = 0.5 (Cloudflare) and 0.8 (HyperFrames), so the chosen ρ is 0.5; T* = 6 on both (the largest value in the family, because every positive ask has at least 14 usable tokens; the median is 26).

Needle coverage (validation set, delivered under the 9,500-character budget), Cloudflare 44 asks, HyperFrames 43 asks:

| ρ | Cloudflare tune / validation | HyperFrames tune / validation |
|---|---|---|
| 0 | 83.3 / 84.1 | 81.9 / 72.1 |
| 0.25 | 83.3 / 84.1 | 81.9 / 72.1 |
| 0.4 | 83.3 / 84.1 | 81.9 / 72.1 |
| 0.5 | 83.3 / 84.1 | 81.9 / 72.1 |
| 0.6 | 82.2 / 83.0 | 81.9 / 72.1 |
| 0.7 | 82.2 / 83.0 | 81.9 / 72.1 |
| 0.8 | 80.6 / 80.1 | 81.9 / 69.2 |

At the chosen ρ = 0.5, validation coverage change is 0.0 points on both catalogs (interval 0 to 0).

Follow-up prompts, no cutoff (what the hook as built injects per turn): Cloudflare group A 18 of 20 prompts inject sections, 3.55 sections and 4,199 characters on average (the other 2 get only the fail-open notice); group B 20 of 20, 4.0 sections, 4,889 characters. HyperFrames group A 20 of 20, 3.55 sections, 7,141 characters; group B 20 of 20, 3.65 sections, 6,928 characters.

| Setting | Cloudflare A chars | HyperFrames A chars | Cloudflare B chars | HyperFrames B chars |
|---|---|---|---|---|
| none | 4,199 | 7,141 | 4,889 | 6,928 |
| ρ = 0.5 | 4,199 | 6,971 | 4,787 | 6,876 |
| T = 6 | 0 | 0 | 0 | 0 |
| ρ = 0.5 and T = 6 | 0 | 0 | 0 | 0 |
| T = 4 (descriptive) | 294 | 380 | 754 | 976 |
| T = 3 (descriptive) | 2,089 | 3,267 | 3,503 | 4,684 |

Follow-up prompts have 1 to 4 usable tokens. T = 6 suppressed 0 of the 44 and 0 of the 43 validation positives.

## Verdict against the rule

- ρ alone does not meet the volume criterion: it cuts group A injected characters by 0% (Cloudflare) and 2.4% (HyperFrames). Weak queries score almost flat, so the second to fourth hits are within 50% of the first.
- ρ = 0.5 together with T = 6 formally meets the rule (coverage change 0.0 on both catalogs; group A injection cut 100%).
- My judgement, stated against my own result: do not adopt T = 6. It was selected only because it is the top of the family; no positive ask had fewer than 14 usable tokens, so the data cannot say where a real terse ask ("write release notes", 3 tokens) would fall, and T = 6 would suppress it. The rule's evidence for T is not informative. T = 4 or 5 would still pass the volume criterion but is a post hoc choice.

## Post hoc (labelled; not findings)

- Top-1 BM25 score: positives min 14.9 (Cloudflare) and 21.0 (HyperFrames), median 32.9 and 34.4; follow-up group A max 10.3 and 10.8; group B max 16.3 and 18.2. The scores separate on this data, but the C2 asks are long, so part of the gap is query length rather than relevance; this is the same confound as for T.
- For prompts that match nothing, the hook injects the fail-open notice with the skills list (about 1 KB) on every such turn.

## What this means

No cutoff is supported as it stands. The hook as built injects roughly 4 to 7 KB of weakly related text on every short follow-up, and injected context persists; this is a real cost of slice 5 and should be addressed before the hook becomes a default. The missing evidence is terse, legitimate asks: a small set of 2 to 6 token asks that really need a skill, to place T (or a score floor) between them and the follow-ups. That set has to be written before measuring and is the next offline step (R6b). A loaded ledger (do not inject a section already injected in this session) is a separate, complementary fix for repeated topical prompts.
