# C3 amendment 1: a forced-load reference arm for the validity gate

Status: PRE-REGISTERED 2026-10-13, committed before any run of the new arm. Amends `C3-claude-code-end-to-end.md` after `C3-results.md` was seen. That ordering is stated because it matters: the reason for the amendment is a result we already know, so the amended verdict, if it changes, carries the label "amended after seeing the data".

## Why

The C3 validity gate required native loading (N) to beat no skills (Z) by 30 points. On Cloudflare it did not (26.0), because native Claude Code skips skills in about a third of runs, not because the catalog is uninformative. The gate was meant to show that the catalog's content helps a model that has it (C2 used a "full" arm for this). Using N as that reference confuses "the content helps" with "the agent finds the content".

## Change

- New arm **F, forced load**, on the validity subset only (24 Cloudflare tasks, 23 HyperFrames tasks, 47 runs, one per task). No skills directory, no `tap`, no hook. The prompt is a fixed preamble `Reference material (the full text of the relevant skill file or files):`, then the complete text of every skill file that holds one of the task's gold sections, each framed `===== <path> =====`, then the C2 ask and the sentence `Put the finished text in your reply.` Same model, same Claude Code flags, empty `HOME`, same needle grader as every other arm.
- **Validity gate, replaced:** per catalog, on the validity subset, F minus Z at least 30 points and F at least 40 points; F at 95 or above is flagged as no headroom. N is still a measured arm; its gap to Z is reported but is no longer a validity condition.
- Everything else in the protocol is unchanged: quality non-inferiority at -10 on both catalogs, "cheaper" as a lower bound above 0 on both, eligibility, the default-mode rule, the bootstrap (4000 resamples, seed 20261101).
- The 581 runs already made stand as they are. No run is repeated or removed.
- Cost: 47 runs at roughly 0.05 USD; cap 4 USD.

## Outcomes decided now

- F passes on both catalogs: the validity gate is met under the amended rule and the C3 default-mode rule is applied to the existing results. The report marks the verdict "amended after seeing the data".
- F fails on either catalog: that catalog stays INVALID, no default mode is set, no claim is made.
- Either way, any statement derived from C3 must say that the comparison is against Claude Code's native behaviour in this build, which skipped skills in 31.5% (Cloudflare) and 20.2% (HyperFrames) of the N runs, and not against an agent that always loads the right skill.

## Limits

Same as C3, plus: the amendment is not independent of the result that motivated it. C3b is not covered here and has its own cost confirmation.
