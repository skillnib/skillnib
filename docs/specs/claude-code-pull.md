# Spec: `tap init claude --mode pull` lets the agent fetch skill sections itself

Status: APPROVED by user 2026-10-12. Slice 7 of the open-source release; builds on slice 6 (`claude-code-init`). Evidence: `docs/research/R2b-claude-code-smoke.md` (the agent calling `tap` itself scored 85.0 against 86.7 for hook injection and for native loading, 20 of 20 runs called `tap`) and `docs/research/R6b-terse-asks.md` (no prompt-level guard stops hook injection on short follow-ups, so push has a cost pull does not). The default mode is decided later by the end-to-end evaluation (C3), not here.
Spec-ID: claude-code-pull
Scope: packages/claude/**, apps/cli/**

## Purpose

Offer a second way to serve skills to Claude Code: instead of injecting sections on every prompt, give the agent a short, always-loaded note that lists the skills and tells it to run `tap ask` when a task needs one. Nothing is injected on turns that need no skill. Native skills are hidden exactly as in hook mode.

## Non-goals

No change to the hook or its budget, no loaded ledger, no change of the default mode (it stays `hook` until the C3 evaluation sets it), no edit of `CLAUDE.md`, `CLAUDE.local.md` or `AGENTS.md`, no other harnesses, no measurement of turns or cost (C3).

## Where the note lives

Claude Code loads `.claude/rules/*.md` files without a `paths` header at launch, with the priority of the project `CLAUDE.md`, and the docs say such files do not stop Claude from reading `AGENTS.md`. Creating a `CLAUDE.md` or `CLAUDE.local.md` would: in a project that relies on `AGENTS.md`, adding either makes Claude read it instead of `AGENTS.md`. So pull mode writes one file that SkillTap owns entirely, `<project>/.claude/rules/skilltap.md`, and touches no other instruction file.

## Behaviour

`tap init claude [<source>...] [--mode hook|pull] [--project DIR] [--shared] [--dry-run]` and `--undo` as in slice 6. `--mode` defaults to `hook`.

- With `--mode pull` the command imports and hides skills as in slice 6, writes the rules file, and removes SkillTap's own hook entry if an earlier hook-mode init added one. With `--mode hook` it adds the hook entry and deletes the rules file if an earlier pull-mode init wrote one. Running a mode again changes nothing.
- The rules file starts with a comment saying it is generated, then: a factual sentence that these skills are served by SkillTap and not loaded by Claude Code; the instruction, in the wording the R2b arm B used, to run `<command> ask "<what you need to know>"` with the Bash tool before a task one of them may cover, follow the sections returned, fetch any listed section with `<command> show <ref>`, and not answer such tasks from memory; then one line per skill, `- <name>: <description>`.
- `<command>` is `tap` when `tap` on the `PATH` is this installation, and otherwise `node "<absolute path to tap.js>"`. In the second case the summary warns that the file holds a machine path and should not be committed.
- A skill's description is the `description` in its `SKILL.md` front matter, cut at 160 characters; a skill without one is listed by name. The whole file stays under 3,000 characters; skills that do not fit are replaced by a line saying how many more there are and to run `<command> list`.

## Requirements

- R1 Mode: `--mode pull` writes the rules file and removes only SkillTap's hook entry; `--mode hook` adds the hook entry and removes only the rules file SkillTap wrote; each is idempotent; any other value exits 2 with usage; `--dry-run` shows the plan and writes nothing.
- R2 Rules file content: the generated file has the header comment, the sentence, the instruction, the command, and one line per imported skill with its truncated description; it is deterministic, stays under 3,000 characters with a visible count of skills left out, and contains no skill instruction text beyond the descriptions.
- R3 No side effects on other instruction files: `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md` are never created, edited or deleted, shown by comparing their presence and hashes before and after init and undo in a project that has an `AGENTS.md` and in one that has none.
- R4 Command: the command in the file is `tap` only when `tap` on the `PATH` resolves to this installation, otherwise `node "<absolute path>"`; the summary says which and warns when the path is absolute.
- R5 Hiding: native project skills are hidden as in slice 6 in both modes.
- R6 Undo: `--undo` removes the rules file if it is unchanged since init (an edited file is left and reported) together with everything slice 6's undo removes, and records are extended without breaking slice 6 records.
- R7 End to end: in a temporary project with the five R2b fixture skills and an `AGENTS.md`, after `--mode pull` the command found in the rules file, run through a shell from the project directory and from a subdirectory, returns a delivery containing the requested section verbatim.
- R8 Boundary: generating the rules text and extracting descriptions are pure functions in `@skilltap/claude`; only `apps/cli` reads or writes files, reads the `PATH` or resolves paths; `npm run check` passes.

## Examples (single happy path and single failure, not a test plan)

- Happy path: `tap init claude --mode pull` in a project with three skills writes `.claude/rules/skilltap.md` listing them, hides the three native skills, removes nothing else, and leaves `AGENTS.md` alone; in the next session the agent runs `tap ask "release notes tag format"` when asked for release notes and gets the right section.
- Failure: the user edited the rules file after init; `tap init claude --undo` restores the skills and removes the hook, reports the rules file as changed, leaves it in place, and keeps the record.

## Risks and open questions

- Pull relies on the agent choosing to call `tap`. R2b: 20 of 20 runs did so, but with five obvious skills and an explicit instruction; real projects with many skills may differ. C3 measures it.
- The skill list is a fixed per-turn cost, like the native description list it replaces, and the extra turns (3.5 against 1.0 in R2b) cost latency. Neither is measured on real skills yet.
- That a rules file without a `paths` header loads in headless `claude -p` is documented, not yet observed here; the build includes a small live check and the result goes in the PR.
- The file loads at launch, so a new session is needed after init.
- The rules file is shared project configuration by location; with an absolute command it must not be committed. If this proves error-prone, a personal `CLAUDE.local.md` import is a later alternative, at the cost of the `AGENTS.md` side effect above.

## Size and safety

About 250 lines of code plus tests. The command writes only inside the project directory (rules file, settings, skill front matter, store, record) and reads the `PATH` to choose the command. Skill descriptions are third-party text placed in an instruction file: they are cut to 160 characters and written as plain list items, but a hostile description is still a prompt-injection surface, which the README must say.
