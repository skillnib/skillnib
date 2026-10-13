# Spec: state the C3b conversation-cost result in the README

Status: APPROVED by user 2026-10-14 ("go ahead with the README"). Small docs slice after C3b finished and the rename merged.
Spec-ID: readme-c3b
Scope: README.md, apps/cli/tests/docs.test.js

## Purpose

The C3b design allows the README to say that auto mode also cost less over an 8-turn conversation when its pre-registered rule is met, and it is met (`docs/research/C3b-results.md`). Say it once, with the numbers and the limits, and keep every number in the README tied to the results file so it cannot drift.

## Non-goals

No change to the default mode, to any other claim, to the guide pages or to code. No new measurement. No claim about ask mode being cheaper or better than auto beyond what the results file reports.

## Requirements

- R1 Region: the README's Status and limits section contains one `<!-- measured:c3b -->` region that states, for auto mode against Claude Code's native loading over an 8-turn scripted conversation, the pooled cost reduction with its 95% interval, the per-catalog cost reductions with their intervals, and the pooled change in the ask-turn needle score with its interval.
- R2 Tied to data: every figure in that region equals the value in `docs/research/C3b-results.json` (pooled and per-catalog, auto against native, rounded to one decimal as the results report shows them), checked by a test that reads both files.
- R3 Ask mode and comparison: the region states ask mode's pooled cost reduction with its interval and that auto and ask were not shown to differ in cost or score; it does not call either mode cheaper or better than the other.
- R4 Limits: the region states that the conversations were scripted with generic follow-ups, eight turns, two catalogs, one model and one Claude Code build, that the comparison is against Claude Code's actual native behaviour (which skipped skills in a fifth to a third of its runs), that the absolute saving per conversation is a few tenths of a dollar, and links `docs/research/C3b-results.md`.
- R5 No contradiction: the C3 region no longer says conversation cost is unmeasured; the docs test still bans figures, comparatives and the words `tokens`, `faster`, `cheap` and `saves` outside the measured regions and now allows the third region; `npm run check`, `npm test` and `npm run release:check` pass.

## Examples (single happy path and single failure, not a test plan)

- Happy path: a reader finds under Status and limits that auto mode cost 25.8% less per 8-turn conversation (interval 16.0 to 35.2), with the limits next to the number.
- Failure: someone edits a figure in the region; the test names the figure that differs from `C3b-results.json`.

## Size and safety

About 15 lines of README and 25 lines of test. No code changes. Worst case is a stale number, which the test prevents.
