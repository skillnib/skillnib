# R6b: can a short-prompt guard tell terse real asks from follow-ups?

Status: PROTOCOL, written and committed before any number is computed. Offline, no model calls. Written 2026-10-12. Follows `docs/research/R6-score-cutoff.md`, which found that a relative score cutoff does not stop the hook injecting on short follow-ups and that a minimum-token rule could not be placed, because every C2 ask has at least 14 usable tokens.

## Question

Is there a guard that skips retrieval for short follow-ups ("yes, go ahead") while still serving terse asks that really need a skill ("queue consumer partial batch ack")? Two guard families are compared:

- T-rule: skip when the prompt has fewer than T usable tokens (the retriever's tokenizer).
- θ-rule: skip when the best section's BM25 score is below θ (per catalog, because absolute scores depend on the corpus).

## Data (all in `R6b-terse/terse.json`, written before measuring)

- Terse asks: for 30 C2 asks per catalog (every third scored ask), a short rewrite (4 to 6 usable tokens) and an ultra-short rewrite (2 or 3). Each keeps the slot of the original, so its needles come from the frozen C2 task. Both catalogs stay separate (cloudflare/skills `c430dd9`, hyperframes `e1925d4`).
- Follow-ups: the 40 prompts of R6 (groups A and B, already seen, used for selection) and 30 fresh prompts (set C: 20 conversational, 10 generic coding), written now and used only for validation.
- Product code of slices 1 to 5; the hook's behaviour is top 4 with the 9,500-character budget.

## Split and selection (fixed now)

- Terse asks: odd-numbered slots tune, even-numbered validate. Follow-ups: groups A and B tune, set C validates.
- Suppression of a terse ask means the hook would inject no section for it under the rule. Pool short and ultra asks of the tune slots per catalog.
- T family: 1 to 5, one value for both catalogs. θ family: 4, 6, 8, 10, 12, 14, 16, 18, 20, chosen per catalog.
- Selection: for each family take the strictest parameter whose tune-set terse suppression is at most 10% (for the T-rule it must hold on both catalogs).

## Measures

- Validation: share of terse asks suppressed (pooled, and short and ultra separately); mean injected characters on set C with the rule against no rule, per catalog and group.
- Descriptive: the same for every parameter in both families; needle coverage at top 4 of the short and ultra rewrites against the original long asks of the same slots (what terseness costs retrieval); usable-token counts of every set.

## Decision rule (fixed now)

Adopt a guard in a later slice only if, on the validation data, terse suppression is at most 10% on each catalog and the set C mean injected characters fall by at least 80% on each catalog. If both families pass, take the T-rule (catalog independent). If neither passes, record that no guard is supported on this data and keep the other mitigations (a loaded ledger, a ranked outline) on the roadmap. Any guard adopted still needs a check on task success and on real prompts, because this data is authored.

## Limits stated in advance

I wrote the rewrites, the follow-ups and the gold-linked vocabulary and saw the answers: real terse asks are probably vaguer than these. Seventy follow-ups written by one author are not a sample of real conversations. Coverage is retrieval coverage, not task success. The θ-rule's parameter is catalog specific and would need calibration per catalog in a multi-catalog service.

## Results (run 2026-10-12, offline)

Usable tokens: short rewrites 4 to 6, ultra rewrites 2 or 3, follow-ups 0 to 4 on both catalogs. Top-1 BM25 score medians: ultra rewrites 8.9 (Cloudflare) and 8.7 (HyperFrames), follow-ups 7.7 and 8.1, short rewrites 16.8 and 14.5; the highest follow-up score is 16.3 and 18.2.

Suppression and injection by rule (all 60 terse asks per catalog; follow-up columns are A and B pooled, then set C):

| Rule | Cloudflare terse / ultra / follow-ups AB / set C | HyperFrames terse / ultra / follow-ups AB / set C |
|---|---|---|
| T = 2 | 0 / 0 / 13 / 30 % | 0 / 0 / 13 / 30 % |
| T = 3 | 42 / 83 / 45 / 93 % | 47 / 93 / 45 / 93 % |
| T = 4 | 50 / 100 / 90 / 100 % | 50 / 100 / 90 / 100 % |
| θ = 6 | 3 / 7 / 23 / 33 % | 2 / 3 / 8 / 30 % |
| θ = 8 | 17 / 33 / 48 / 80 % | 13 / 27 / 25 / 70 % |
| θ = 10 | 35 / 60 / 95 / 97 % | 38 / 70 / 70 / 93 % |
| θ = 12 | 47 / 80 / 98 / 100 % | 57 / 90 / 90 / 97 % |

Selection on the tune set gave T = 2, and θ = 6 (Cloudflare) and θ = 8 (HyperFrames). Validation:

| Rule | Terse suppressed (Cloudflare / HyperFrames) | Set C injected characters cut (Cloudflare / HyperFrames) |
|---|---|---|
| T = 2 | 0% / 0% | 22% / 22% |
| θ (6 / 8) | 7% / 17% | 29% / 67% |

Needle coverage at top 4 on the same slots: the original long asks 86.7 (Cloudflare) and 80.8 (HyperFrames); short rewrites 68.3 and 53.3; ultra rewrites 45.8 and 30.8.

## Verdict against the rule

No guard is supported. T = 2 keeps every terse ask but removes only 22% of set C's injected characters; the θ-rule at the selected values suppresses 7% and 17% of terse asks (HyperFrames exceeds 10%) and cuts 29% and 67%. Every setting that cuts at least 80% of follow-up injection also suppresses about 40 to 100% of the ultra-terse asks (T = 3 or 4, θ = 10 or 12): the two kinds of prompt overlap in token count and in score.

## What this adds

- Terse asks are served poorly anyway: coverage falls from 87 and 81 for the long asks to 46 and 31 for the ultra-terse ones, so suppressing them loses less than the suppression rates suggest, but the guard cannot be justified by that.
- The hook as built injects 4 to 7 KB on every short follow-up. A guard on the prompt alone cannot fix that with the evidence we have.
- The R2b arm B (the agent calls `tap ask` itself) scored 85.0 against 86.7 for the hook and 86.7 for native loading, with no injection on turns that need no skill. That points to pull instead of push as the alternative to test on real skills, at the price of extra turns (3.5 against 1.0 in R2b). A loaded ledger (no repeat injection in a session) is a smaller complement.
