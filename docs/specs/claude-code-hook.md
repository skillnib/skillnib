# Spec: `tap hook claude` injects budgeted skill sections into Claude Code prompts

Status: APPROVED by user 2026-10-12. Slice 5 of the open-source release; consumes slices 1 to 4. Evidence: `docs/research/R2-claude-code-hooks.md` (hook limits, offline budget measurement) and `docs/research/R2b-claude-code-smoke.md` (hook delivery matched native skill loading in a 10-task smoke test, no gross loss, interval wide).
Spec-ID: claude-code-hook
Scope: packages/deliver/**, apps/cli/**

## Purpose

Let a Claude Code project use SkillTap with no extra step from the person or the agent: a `UserPromptSubmit` hook runs `tap hook claude`, which finds the skill sections the prompt needs and hands them to Claude as verbatim, framed context that fits the hook's size cap, and which fails open without ever blocking the prompt. Native skills are hidden by the integration, so the sections and the outline are the agent's only route to skill text; the hiding itself is slice 6.

## Non-goals

No `tap init claude`, no writing of `settings.json` and no hiding of native skills (slice 6, which carries the user's decision to hide them). No loaded ledger or de-duplication across turns, no score cutoff or confidence rule, no handling of automatic prompts beyond slash commands, no other harnesses, no skill metadata, no hosted service. The hook adds no new retrieval: it uses the slice 3 retriever as it is.

## Behaviour

`tap hook claude` reads one JSON object from standard input, as Claude Code passes it to command hooks (`prompt`, `cwd`, `hook_event_name`, `session_id`, and more). For a `UserPromptSubmit` event whose `prompt` is non-empty and does not start with `/`, it ranks the store's modules against the prompt text, delivers the best sections that fit a character budget, and prints the result as plain text on standard output, which Claude Code adds to the model's context. For anything else it prints nothing. It exits 0 in every case and never exits 2, because exit 2 blocks the prompt.

Budget and format. The whole output, header and outline included, is at most 9,500 characters (JavaScript string length), a margin under the documented 10,000-character cap above which Claude Code replaces the output with a file path and a 2,000-character preview. Sections are taken in rank order from the top 4; a section that would not fit is skipped and the next one is tried. A section is never cut or altered. Skipped sections are listed first in the outline with their ref, title and size, marked as too large to inject. The framing of delivered sections is the one the R2b smoke test used.

Store location. All commands that read a store find it from, in order: `--store`, the environment variable `SKILLTAP_STORE`, then the nearest `.skilltap/catalog.json` found by walking up from the working directory (the hook uses the `cwd` it is given). `import` still writes to `./.skilltap` unless told otherwise.

Fetch command. The outline carries one complete command with absolute paths, for example `node /abs/path/tap.js show <ref> --store /abs/project/.skilltap`, so the agent can run it from any directory.

## Requirements

- R1 Store location: `ask`, `show`, `list` and `hook` resolve the store from `--store`, then `SKILLTAP_STORE`, then the nearest `.skilltap/catalog.json` above the working directory, and fail with a clear message (or fail open, for `ask` and `hook`) when none is found; a command run from a subdirectory or a different directory finds the same store.
- R2 Budget: for any ask over the pinned research catalogs and the test fixtures, the delivered output is at most 9,500 characters, sections are never truncated or edited, a section that does not fit is skipped in favour of the next ranked one that fits, and skipped sections appear in the outline marked too large with ref, title and size.
- R3 Complete command: the outline contains one command template with absolute paths to the `tap` entry point and the store; running it from a different working directory returns the requested module's exact text.
- R4 Hook input and output: `tap hook claude` reads the event JSON from standard input (waiting at most 5 seconds), prints the delivery for a non-empty `UserPromptSubmit` prompt that does not start with `/`, prints nothing for other events, empty or slash prompts and empty input, and exits 0 in every case, including malformed input.
- R5 Fail-open: when the store is missing or corrupt, the retriever or delivery throws, the input is not valid JSON, or no module matches, the hook prints a notice that no sections were selected and why, lists the source file path of each skill when the store knows one (local imports; GitHub imports are named by origin), stays within the budget (listing a count when the paths do not fit), writes the cause to standard error, and exits 0.
- R6 Read-only and offline: the hook writes no file and makes no network call; shown by running it against a read-only store with the network function replaced by one that throws.
- R7 Format equivalence: for sections that fit, the header and framing of the hook output are identical to the slice 4 `ask` output for the same sections, so the format R2b tested is the format the hook delivers; and a test over the R2b fixtures confirms the target sections are delivered verbatim.
- R8 Boundary: the budgeted delivery logic lives in `@skilltap/deliver`, which stays dependency-free and runtime-neutral with no I/O; only `apps/cli` reads standard input, files, the environment or the working directory; `npm run check` passes.

## Examples (single happy path and single failure, not a test plan)

- Happy path: the user types "write the release notes for 2.4.0" in a project with the five Acme skills imported; the hook prints a header, the release-notes sections that fit, and a short outline with the fetch command; Claude writes notes with the required tag and closing line.
- Failure: the store file was deleted; the hook prints "SkillTap could not select sections (no store found...)", lists nothing it cannot find, and the prompt goes through unchanged with exit 0.

## Risks and open questions

- Every prompt triggers retrieval, including short follow-ups such as "yes, go ahead". With no score cutoff, such a prompt can inject up to 9,500 characters of weakly related text on every turn, and injected context persists in the conversation. This is not measured. A cutoff or minimum-token rule is a follow-up that needs its own offline measurement; this slice deliberately adds none.
- Claude Code also fires the hook for scheduled tasks, background-subagent reports and messages from other sessions. The input offers no documented field to tell them apart, so they get injection too.
- R2b showed no gross loss on 10 synthetic tasks with the target section forced in; it did not test retrieval, long skills or multi-turn persistence. The hook channel is chosen with that caveat, and the same comparison on real skills with real retrieval is still owed.
- The 9,500 margin assumes the cap counts characters like JavaScript string length. If the cap counts bytes, text with many non-ASCII characters could still exceed it; the tests include a non-ASCII case, and the margin may need to widen.
- Skills are also readable on disk. Hidden native skills can still be read by the agent through file tools; the notice lists their paths on purpose.
- Docs change. The hook field names (`prompt`, plain stdout as context) were confirmed by the R2b runs on Claude Code 2.1.296; re-check on a major version change.

## Size and safety

About 300 lines of code plus tests. The hook reads the store and standard input only, writes nothing and uses no network; prompt text is data and is never interpolated into a shell command. Output is plain text with no escape sequences.
