# R2b: does Claude Code follow instructions delivered by a hook as well as by a native skill?

Status: DONE, verdict NO GROSS LOSS (see Results). Protocol written and committed before any data run; user approved the test and the cost on 2026-10-12. Follows `docs/research/R2-claude-code-hooks.md` (on its own PR until merged).

## Decisions recorded with this protocol

- Native skills are hidden in the product's hook mode (`disable-model-invocation: true`), so the agent gets skill text only through SkillTap. User decision, 2026-10-12. Fail-open in hook mode therefore gives the agent the source file paths so it can read a skill itself; that is slice 5 work, not tested here.
- This is a smoke test: 10 tasks. It can catch a gross loss of obedience. It cannot show equivalence.

## Question

When the text of a skill section reaches Claude Code as hook-injected context (a system reminder) instead of through the native Skill tool, does the agent follow its instructions about as well?

## Fixtures (committed before running, `docs/research/R2b-smoke/`)

Five small synthetic skills (`acme-release-notes`, `acme-incident-report`, `acme-sql-style`, `acme-commit-messages`, `acme-error-copy`; 30 sections, 6.9 KB in all), each with one section holding the checkable instruction that a model would not follow by default (a required tag, heading set, keyword case, subject format, opening words). Ten tasks, two per skill, in `tasks.json`, each with three regex or structural checks over the final reply. The authors wrote the instructions, the tasks and the checks and saw all of them; that is acceptable here because the question is obedience, not retrieval.

Design check, run before any model call (offline, with the product's retriever): the plain retriever delivered the target section for only 2 of 10 task prompts. Retrieval quality is what C2 measured, so this test does not depend on it: the hook arm forces the target section(s) into the delivered set and fills the remaining slots, up to four, with the retriever's next hits. The tasks were not changed after this check.

## Arms

All arms: model `claude-sonnet-5-5`, the same Claude Code build, `claude -p` with `--output-format stream-json --verbose --no-session-persistence --setting-sources project`, an empty `HOME`, a fresh temporary project directory per run, one task prompt as the only user turn with the sentence "Put the finished text in your reply." appended (a harness check showed an agent writing its result to a file instead of replying), maximum 8 turns. Claude Code's built-in skills stay available in every arm (they are unrelated to the Acme tasks and constant across arms).

- **none**: no Acme skill, no hook. Validity floor: shows the checks fail without the instruction.
- **N** (native): the five skills in `.claude/skills/` unmodified; the Skill tool allowed. The agent decides whether to load a skill.
- **H** (hook, native hidden): the five skills installed with `disable-model-invocation: true`; a `UserPromptSubmit` command hook prints the SkillTap delivery for the prompt (framed verbatim sections with the target section(s) forced in, a short outline) as plain stdout, under the 10,000-character cap. No Skill tool, no Bash.
- **B** (agent calls the CLI, native hidden): same hidden skills; a project `CLAUDE.md` tells the agent to run `node <tap> ask "<what it needs>"` with Bash before writing for any task one of these skills may cover and to follow what returns. Bash allowed without restriction (a harness check showed the agent chaining `cd`, loops and `tap show` calls, which a `node`-only allowlist blocked). No forcing: retrieval is the agent's query against the real retriever.

Replications: 2 per task per arm, 80 runs. The harness (scripts, scoring) is evaluation tooling and stays private; this document, the fixtures and the results file are committed.

## Measures

Primary: per run, the share of its three checks that pass on the final reply; per arm, the mean over tasks of the per-task mean of the two replications. Recorded for attribution only: whether the Skill tool was called (N), whether the hook output reached the model (H), whether `tap ask` ran and its output contained the target section (B), tokens and cost from the CLI output.

## Rules fixed now

- **Validity**: the test is valid only if none is at most 30 points and N is at least 80 points. Otherwise the result is INVALID (the checks do not discriminate, or native loading did not work in this harness) and the harness is fixed before any further run.
- **Hook verdict (smoke)**: H at least N minus 15 points and H at least 70 points: NO GROSS LOSS. H below N minus 15: HOOK LOSES OBEDIENCE (slice 5 must not assume hook injection alone; consider B or a skill-based channel). Anything else: INCONCLUSIVE.
- B is descriptive: report its score, the share of runs that called `tap`, and its score among runs where the target section was returned.
- Uncertainty: paired bootstrap over tasks, 4000 resamples, seed 20261101, for H minus N, B minus N, N minus none. Reported, but the verdicts above use point estimates because 10 tasks cannot support an interval rule.
- Exclusions: a run that errors, times out, or hits the turn limit without a final reply is relaunched once; a second failure is reported as a failure, not dropped. A run where H or B called the Skill tool or read a skill file directly is flagged and reported separately (leak); it stays in the score.
- Cost: abort if cumulative cost passes 15 USD. Two small harness checks (5 runs, 0.24 USD in all, not data, results discarded) preceded the full run; they set the changes above and the estimate of about 4 to 6 USD for the 80 runs, which the user confirms before launch.

## Limits stated in advance

One model, one Claude Code version, synthetic skills with short sections, single-turn tasks, regex checks, forced delivery in H, authors who wrote both skills and checks. It says nothing about retrieval quality, long skills, multi-turn persistence of injected text, other harnesses, or real skills with subtler instructions.


## Results (run 2026-10-12, 80 runs, per-run data in `docs/research/R2b-results.json`)

All 80 runs completed: 0 errors, 0 relaunches, 1.38 USD in total. Mean share of checks passed, averaged over the 10 tasks:

| Arm | Score |
|---|---|
| none | 23.3 |
| N (native skill) | 86.7 |
| H (hook, native hidden) | 86.7 |
| B (agent calls `tap`) | 85.0 |

- Validity: none at most 30 and N at least 80 both hold, so the test is valid.
- Pre-registered verdict: H is not below N minus 15 and is above 70, so NO GROSS LOSS.
- Paired bootstrap over tasks (4000 resamples, seed 20261101): H minus N 0.0 [-16.7, +13.3]; B minus N -1.7 [-10.0, +8.3]; N minus none +63.3 [+50.0, +76.7]. The interval for H minus N does not exclude a loss of more than 15 points; the verdict rests on the point estimate, as the protocol said it would.

Attribution (descriptive): N loaded an Acme skill in 19 of 20 runs; the hook produced output in 20 of 20 H runs and H runs used no tools; B ran `tap` in 20 of 20 runs and none read a skill file directly. No leaks were flagged. Mean turns per run: none 1.0, N 2.9, H 1.0, B 3.5.

## Reported without a rule

- By check, the hook arm and native arm matched on the format checks (release-note tags, incident headings and timestamps, error-copy wording): 4 of 4 runs each, except `ec try` where B was 3 of 4. H beat N on the commit subject (4 of 4 against 2 of 4); B failed it 0 of 4.
- The SQL tasks were the weak spot for every arm: H passed keyword case and aliases in 2 of 4 runs, N in 3 of 4, B in 4 of 4. In two H runs the agent wrote uppercase SQL despite the injected rule.
- Cost per run (CLI-reported USD, mean): none 0.009, N 0.024, H 0.013, B 0.023. This is not a measure of bytes or tokens and is affected by caching.

## Post hoc (labelled; not findings)

- The check `sq checked` (the final `-- checked` comment) is defective: its regex required the text to end with the comment, and it failed in all 20 SQL runs including native, because replies continue after the code block. This was found after the data. With the check loosened to "the reply contains `-- checked`", scores are none 23.3, N 91.7, H 90.0, B 91.7. The pre-registered numbers above stand as the result; the loosened ones are shown only because the defect affected every arm alike.
- B's commit-subject failures (0 of 4) look like the agent's own query not returning the subject-line section; I did not verify this.

## What this does and does not show

It shows that, on 10 short tasks with synthetic skills, Claude Code followed instructions delivered as hook-injected context about as often as when it loaded the skill natively, and that an agent calling `tap` did about as well. The injection-defence worry in the hook docs did not show up as a gross loss here.

It does not show equivalence (the interval is wide), anything about retrieval (H forced the target section; B used the real retriever with one query), long or subtle skills, multi-turn persistence of injected text, other models or other harnesses. The next test that would matter is the same comparison on real skills with real retrieval (arm B style) at C2 scale. Slice 5 can use the hook channel, with that caveat recorded.

## Product findings from the harness checks

- `tap show` finds its store from the current directory. An agent that changed directory first got a store-not-found error. Slice 5 needs a store location that does not depend on the working directory, and outline lines should print a complete command.
