# C3: does SkillTap hold up in real Claude Code against real skill loading?

Status: PROTOCOL, written and committed before any data run. Written 2026-10-12. Nothing in this document has been run except the 12-run pilot described under "Cost and pilot", which is a harness check and not data. The user confirms the cost before any non-pilot run.

## Why this test

C2 (`docs/research/C2-bm25-vs-native-large.md` on branch `v1`) showed that BM25 top-4 delivery matched a simulated native loading on needle score at about 70% fewer skill bytes. Since then the product has been built (slices 1 to 9), the hook and pull modes exist, and R2b showed on 10 synthetic tasks that hook delivery was not worse than a native skill. What is still missing before a release can claim anything is the real comparison: the actual product, in actual Claude Code, against Claude Code's own skill loading, on the real catalogs and the 89 C2 asks each. The result also decides which mode `tap init claude` uses by default (hook, pull), and whether the release may say "fewer tokens, same success".

## Questions

1. Quality: does task success with the hook (H) or with pull (P) stay within 10 points of Claude Code's native loading (N)?
2. Cost: how many fewer tokens, dollars and turns do H and P need than N?
3. Cost over a conversation (C3b): once follow-up turns are included, what do H and P cost against N?
4. Default: which mode, if any, should `tap init claude` use?

## Fixed inputs

- Product under test: the `main` commit recorded in the results, installed from the tarball that `npm pack` makes (the same package a user would install), so the pull note says plain `tap` and the hook command names the installed entry point.
- Claude Code build: the installed one (2.1.296 at the time of writing; recorded in the results). Model: `claude-sonnet-5-5` for every run, the family used in C1 and C2.
- Catalogs, never pooled: cloudflare/skills `c430dd9` (17 skills, 256 files) and heygen-com/hyperframes `e1925d4` (21 skills, 330 files), skills directory only.
- Tasks: the 89 frozen C2 asks per catalog (30 single, 29 ref, 15 cross, 15 vague), unchanged. Their sha256: `tasks-c1a.json` `a8686d7b471ffc47e7f13a2e4a1d371e569b99f5dcd2d447824a1d4a8487e34b`, `tasks-c1b.json` `f76cfffc2e32c57d99493e56d6ff695e133f88a65ba0ddb2025bb809b9918af0` (branch `v1`, `tools/research/c2/`, commit `2b55cfd`). The validity subsets are the 24 and 23 tasks C2 marked. The asks are authored and already seen; nothing here is tuned.
- Grader: the C2 grader, unchanged: the mean over an ask's needles of whether the needle's regex matches the final reply (needles are the facts a correct answer must contain).
- Each prompt is the C2 ask followed by one sentence, "Put the finished text in your reply.", identical in every arm (R2b showed agents otherwise write answers to files).

## Arms (one fresh temporary project per run, empty `HOME`, no session persistence)

All arms: `claude -p` with `--model claude-sonnet-5-5 --output-format stream-json --verbose --include-hook-events --no-session-persistence --setting-sources project,local --max-turns 12 --permission-mode dontAsk --tools Skill,Read,Bash --allowedTools Skill Read Bash`. Claude Code's built-in skills are present in every arm, as in R2b.

- **N, native**: the catalog's skill directories copied into `.claude/skills` unchanged. Claude Code's own progressive loading decides what to read. This is the real baseline, not a simulation.
- **H, hook**: the same copy, then `tap init claude --mode hook` (native skills hidden with `disable-model-invocation: true`, the `UserPromptSubmit` hook installed, 9,500-character budget).
- **P, pull**: the same copy, then `tap init claude --mode pull` (native skills hidden, the skill note in `.claude/rules/skilltap.md`, the agent runs `tap ask` itself).
- **Z, none**: an empty project, validity subset only.

One run per task per arm: 89 x 3 x 2 = 534 runs, plus Z on the 47 validity tasks: 581 runs. The agent may read skill files directly in H and P (hidden skills still sit on disk); that is allowed and counted.

## Measures

Per run, from the transcript and the CLI result: the C2 needle score; input tokens, cache-creation tokens, cache-read tokens and output tokens summed over turns, and the cost in dollars as the CLI reports it; turns; wall time; tool calls by kind (Skill, Read, Bash); for H whether the hook produced output and whether it contained a gold section; for P whether `tap ask` was called and returned a gold section; the characters of skill-derived text that entered the context (the Skill tool result, Read results under the skills directories, hook output, `tap` output); and whether the run read skill files directly.

Primary quality outcome: needle score. Primary cost outcome: mean dollar cost per run, which includes everything (fixed prompt, skill text, extra turns). Total input tokens, turns and skill characters are secondary and reported.

## Rules fixed now

- **Validity** (per catalog, as C2): on the validity subset N minus Z is at least 30 points, N is at least 40 points. Otherwise the catalog is INVALID and the harness is fixed before more runs. N at 95 or above is flagged as no headroom.
- **Quality**: the paired bootstrap over tasks (4000 resamples, seed 20261101) of the mean needle score of H minus N, and P minus N, per catalog. A mode is quality non-inferior when the lower bound of its interval is at least -10 points on both catalogs.
- **Cost**: a mode is cheaper when the bootstrap interval of its relative reduction in mean cost per run against N has a lower bound above 0 on both catalogs. The release may say "N% cheaper" only with a number whose lower bound it can state.
- **Eligible** means quality non-inferior and cheaper on both catalogs. Strata by ask type and by style, attribution (retrieval miss, read-direct, no tool call) and per-task tables are reported without a rule.
- **Default mode**: if exactly one of H and P is eligible, it is the default. If both are, the default is the one with the lower mean cost per conversation in C3b (below); if C3b is not run, the lower mean cost per run; within 5% of each other, P (it injects nothing on turns that need no skill). If neither is eligible, there is no default: `tap init claude` requires `--mode`, the README makes no cost or quality claim for SkillTap, and the result is reported as it is.
- **Exclusions**: a run that errors, times out or hits the turn limit without a reply is relaunched once; a second failure is scored 0 and counted, not dropped. Runs are never removed for a low score.
- **Cost cap**: the run stops if the cumulative cost passes the confirmed budget.

## C3b: cost over a conversation (separate stage, separate cost confirmation)

Ten scripted conversations per catalog, eight turns each: turns 1, 4 and 7 are C2 asks (from tasks outside the validity subset, drawn with the fixed seed, three different asks each), the other five are follow-ups drawn from `docs/research/R6-cutoff/followups.json` and `R6b-terse/terse.json` (the fresh set C) in a fixed order. Each conversation runs in arms N, H and P as successive `claude -p --resume` turns in one session. Measures: input tokens and cost summed over the conversation, the context size at the last turn, and the needle score of the three ask turns. Primary: mean cumulative cost per conversation, bootstrap over conversations (4000 resamples, same seed), H minus N and P minus N relative, and H against P. 60 conversations, 480 turns.

## Cost and pilot

The pilot is 12 runs (two tasks per catalog in each of N, H and P), not data and discarded, to check that the harness works (skills hidden, hook fires, `tap` called, tokens read from the transcript) and to estimate the per-run cost of each arm. From it I will state the cost of the 581 runs and of C3b, and wait for the user's confirmation. R2b's small-skill runs cost 0.01 to 0.03 USD; native loading of a 60 KB skill will cost several times more, so the estimate is not known in advance.

## Outcomes and what each allows the release to say

- A mode eligible: the README states the measured quality difference and the measured cost reduction with intervals, for these two catalogs and this model.
- Quality non-inferior but not cheaper: SkillTap is offered as a control (what loads is explicit and auditable), without a savings claim.
- Not non-inferior: no claim; both modes are marked experimental and the failure types (retrieval miss, agent never asked, instruction not followed) decide the next slice.

## Limits stated in advance

One model and one Claude Code version; two catalogs of 17 and 21 skills; authored asks with regex needles that measure whether facts appear, not whether code runs; the asks overlap the answers lexically (about 42 to 44%), which flatters retrieval; one run per task per arm, so run-to-run variance enters the intervals only through the task resampling; the native arm uses the real Claude Code behaviour of this build, which can change; dollar cost depends on the pricing and caching of the day; no Windows, no other harness, no real user conversations. The harness (scripts, scoring) is evaluation tooling and stays private; this protocol, the task hashes and the per-run results file are committed.
