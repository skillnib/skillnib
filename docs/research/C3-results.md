# C3 results: SkillTap in real Claude Code against native loading

Run 2026-10-12 and 2026-10-13 under `docs/research/C3-claude-code-end-to-end.md` (protocol committed before any data run). 581 runs, all of them: 89 asks x arms N, H, P on each of two catalogs, plus Z on the 47 validity tasks. Product: `main` at `f8e2415` installed from the packed tarball; Claude Code 2.1.296; model `claude-sonnet-5-5`. Per-run records (no reply text): `C3-results.json`. Total spend: about 30 USD. The evaluation harness is private.

## Verdict under the pre-registered rules: INVALID on one catalog, so no default mode and no claim

The validity gate (on the validity subset, N minus Z at least 30 points and N at least 40) **failed on the Cloudflare catalog**: N 52.1, Z 26.0, difference 26.0 (needed 30). It passed on HyperFrames: N 43.5, Z 5.4, difference 38.0. The protocol says an invalid catalog stops the evaluation and the harness is fixed before more runs, and that the default-mode rule applies only to valid results. So the following are reported as measured, but **the protocol grants no eligibility, no default mode and no savings claim from this run.** The README stays as it is.

## What was measured (reported without a rule)

Mean over 89 asks per catalog. Score is the C2 needle score in points. Cost is the dollar cost per run as the CLI reports it. Intervals are paired bootstrap over tasks (4000 resamples, seed 20261101), 95%.

| | Cloudflare N | H | P | HyperFrames N | H | P |
| --- | --- | --- | --- | --- | --- | --- |
| Score | 54.7 | 63.2 | 66.6 | 40.3 | 56.4 | 61.1 |
| Cost per run (USD) | 0.062 | 0.042 | 0.058 | 0.087 | 0.045 | 0.059 |
| Turns | 3.4 | 1.3 | 2.5 | 4.2 | 1.9 | 2.5 |
| Skill text entering context (chars) | 7,926 | 7,720 | 11,331 | 16,953 | 9,037 | 16,303 |

| Against N | Score difference (95%) | Cost reduction (95%) |
| --- | --- | --- |
| Cloudflare, H | +8.5 (+2.8 to +14.6) | 33.3% (27.0 to 39.1) |
| Cloudflare, P | +11.9 (+6.7 to +17.2) | 6.7% (-1.5 to 14.2) |
| HyperFrames, H | +16.1 (+9.6 to +22.7) | 48.1% (41.9 to 53.4) |
| HyperFrames, P | +20.9 (+14.4 to +27.8) | 32.4% (25.3 to 38.7) |

Had the gate passed, the rule would have found H eligible (non-inferior and cheaper on both catalogs) and P not eligible (not cheaper on Cloudflare: lower bound -1.5). That is stated only to show the pattern; it is not a result.

Errors: none; one run relaunched once (HyperFrames N, `ref11`).

## Why the Cloudflare gate failed, and what it says about the baseline (post hoc)

Everything in this section was looked at after the data and is labelled post hoc.

- Native loading is a weak baseline here because the agent often does not load a skill at all. Runs of N with no tool call: 31.5% on Cloudflare and 20.2% on HyperFrames. When N loaded something, its score was 66.7 (Cloudflare) and 49.8 (HyperFrames); when it did not, 28.6 and 2.8.
- Z (no skills) scored 26.0 on Cloudflare because the model already knows much of that public documentation. With a weak N this leaves N minus Z at 26.0.
- H and P do better than N mostly because they put the section in front of the agent without relying on its decision to look: hook runs made no tool call in 92.1% (Cloudflare) and 74.2% (HyperFrames) of runs and still carried the text.
- Pull mode called `tap ask` in 100% of runs in both catalogs (the pull note is effective). Hook mode's own `tap` use was 5.6% and 21.3%.
- Consequence for claims: the cost and score differences above are against *Claude Code's native behaviour in this build*, which skips skills often, not against an agent that always loads the right skill. They do not show that SkillTap beats an always-correct loader.

## Per ask type (no rule)

Score by type (N / H / P): Cloudflare single 57.5 / 61.7 / 66.7, ref 55.7 / 69.8 / 65.5, cross 45.0 / 53.3 / 63.3, vague 56.7 / 63.3 / 71.7. HyperFrames single 40.0 / 60.8 / 58.3, ref 36.2 / 55.2 / 56.0, cross 48.9 / 55.6 / 72.2, vague 40.0 / 50.6 / 65.6.

## What is open

1. The gate failed on a rule fixed in advance. Options (a user decision, not made here): (A) accept the result as INVALID, make no claim, and fix the harness or baseline before another run; (B) amend the protocol *before* any new run with a dated note, adding a forced-load reference arm F (the right skill's full text given to the agent, as in C2's "full" arm) on the 47 validity tasks, and define validity on F minus Z and F, keeping N as a real arm; roughly 47 runs, about 2 USD; the amendment is a new pre-registration, and the existing 581 runs would stand as an exploratory run.
2. C3b (cost over a conversation) has not been run and should wait for the validity decision.
3. Limits stand as in the protocol: one model, one Claude Code build, two catalogs, regex needles, one run per task per arm.

## Amendment 1 outcome (run 2026-10-13, pre-registered in `C3-amendment-1.md` before the runs)

The forced-load arm F (47 runs, 2.24 USD) passed the amended validity gate on both catalogs, on the validity subset:

| | F | Z | F minus Z | Gate (30 points, F at least 40) |
| --- | --- | --- | --- | --- |
| Cloudflare (24 tasks) | 71.9 | 26.0 | 45.8 | pass |
| HyperFrames (23 tasks) | 64.5 | 5.4 | 59.1 | pass |

Under the amended gate the rules in the C3 protocol apply to the 581 runs above, unchanged. **This verdict is labelled "amended after seeing the data"**: the amendment was made after the original gate failed, so it is not independent of that result.

- **Hook (H): eligible.** Non-inferior on both catalogs (lower bounds +2.8 and +9.6, against -10) and cheaper on both (lower bounds 27.0% and 41.9%).
- **Pull (P): not eligible.** Non-inferior on both (lower bounds +6.7 and +14.4) but not cheaper on Cloudflare (cost reduction 6.7%, lower bound -1.5%).
- **Default mode:** exactly one mode is eligible, so the protocol's rule makes **hook the default**. `tap init claude` already uses hook when `--mode` is not given, so the code does not change.
- **What may be said:** against Claude Code's native behaviour in this build (which skipped skills in 31.5% of Cloudflare and 20.2% of HyperFrames native runs), on these two catalogs and this model, hook delivery scored higher and cost less per run, with the intervals in the table above. Not that SkillTap beats an agent that always loads the right skill, and not for other models, catalogs or longer conversations (C3b is not run).
- Pull mode remains available and scored higher than native on both catalogs; the rule only says it is not shown to be cheaper.
