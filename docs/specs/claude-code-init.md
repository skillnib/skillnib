# Spec: `tap init claude` wires a Claude Code project to SkillTap and hides its native skills

Status: APPROVED by user 2026-10-12. Slice 6 of the open-source release; builds on slice 5 (`claude-code-hook`). Carries the user's decision of 2026-10-12 to hide native skills in hook mode (`docs/research/R2b-claude-code-smoke.md`).
Spec-ID: claude-code-init
Scope: packages/claude/**, apps/cli/**

## Purpose

One command turns a Claude Code project's skills into SkillTap-served skills and can turn it back: it imports them, registers the prompt hook, and hides the native copies so the agent receives skill text only through SkillTap and never loads a whole skill on its own.

## Non-goals

No hook logic (slice 5), no change outside the project directory (user-level skills, plugin skills and enterprise skills are reported, never edited), no Claude Code plugin packaging, no other harnesses, no score cutoff, no deleting the store on undo, no hosted service.

## Behaviour

`tap init claude [<source>...] [--project DIR] [--shared] [--dry-run]` and `tap init claude --undo [--project DIR] [--shared]`. The project directory is the working directory unless `--project` is given.

1. Plan. All inputs are read and every edit is computed before anything is written: the sources, the settings file (must be absent or a JSON object), and the front matter of each skill to hide. If any input is invalid the command stops and writes nothing. `--dry-run` prints the plan and stops.
2. Import. The given sources, plus the project's `.claude/skills` directory when it exists, are imported into `<project>/.skilltap` exactly as `tap import` does. With no source and no `.claude/skills` the command fails with usage.
3. Hook. One `UserPromptSubmit` command hook, `node "<absolute path to tap.js>" hook claude` with a 30-second timeout, is added to `<project>/.claude/settings.local.json` (personal, normally not committed, because the command holds a machine-specific path), or to `.claude/settings.json` with `--shared`. Every other setting and hook is kept.
4. Hide. For each imported skill that lives in `<project>/.claude/skills/<name>/SKILL.md`, the line `disable-model-invocation: true` is added to its front matter, which removes the skill's description from Claude's context. Nothing else in the file changes. What was changed is recorded in `<project>/.skilltap/init-claude.json` so it can be undone.
5. Report. The summary lists what was imported, written and hidden, any skills that could not be hidden (no front matter), and native skills that stay visible: same-named skills in the user's `~/.claude/skills`, and the fact that plugin and enterprise skills cannot be listed from here.
6. Undo. `--undo` removes the hook entry and reverts exactly the recorded front matter changes; a file edited since init is reported and left alone. The store stays.

## Requirements

- R1 Plan and dry run: `--dry-run` prints the sources to import, the settings file and entry to write, and the skill files to edit, and writes or changes nothing; invalid settings JSON, a settings value that is not an object, or an unreadable source stops the command before any write, with a clear message and exit 1.
- R2 Import: the given sources and `.claude/skills` are imported into `<project>/.skilltap` with the same summary as `tap import`; with nothing to import the command exits 2 with usage; an import failure leaves settings and skill files untouched.
- R3 Hook entry: the entry is added to `.claude/settings.local.json` (or `settings.json` with `--shared`), creating the file and directory when absent, keeping every other key and hook, writing 2-space JSON with a trailing newline; running it again changes nothing; an existing SkillTap entry with a different tap path is updated in place, not duplicated.
- R4 Hide: for each imported project skill, `disable-model-invocation: true` is added to its front matter (or changed from `false`), so that the file differs from the original by exactly that one line; skills already hidden are untouched; a skill without front matter is not edited and is reported; files outside `<project>/.claude/skills` are never written.
- R5 Undo: `--undo` removes the SkillTap hook entry (and any object or array it created that is now empty), restores the front matter lines recorded by init, skips and reports any file whose content no longer matches what init wrote, is safe to run twice, and removes the record file when everything is reverted.
- R6 Visibility report: the summary names native skills that stay visible, namely same-named skills in the user skills directory, without editing them, and states that plugin and enterprise skills cannot be checked.
- R7 End to end: in a temporary project holding the five R2b fixture skills in `.claude/skills`, after `tap init claude` the command string found in the written settings, run through a shell with the working directory set to the project and an event on standard input, prints a delivery that contains the requested section verbatim, and every fixture skill's front matter carries the hide line.
- R8 Boundary: the settings merge, removal and front-matter edit are pure functions in a new dependency-free, runtime-neutral package `@skilltap/claude`; only `apps/cli` reads or writes files, reads the environment or resolves paths; `npm run check` passes.

## Examples (single happy path and single failure, not a test plan)

- Happy path: in a project with three skills under `.claude/skills`, `tap init claude` imports them, adds the hook to `.claude/settings.local.json`, adds the hide line to the three `SKILL.md` files, and reports that two same-named skills in `~/.claude/skills` are still visible.
- Failure: `.claude/settings.local.json` holds `{ "hooks": ` (truncated); the command prints that the file is not valid JSON, names it, and exits 1 without importing anything or touching any skill.

## Risks and open questions

- Hiding edits the user's skill files in their repository. The change is one line and undoable, but it appears in `git diff`; whether to commit it is the user's call. The hook command holds a machine path, which is why it goes to the local settings file by default.
- Hidden skills can still be read from disk by the agent through file tools, and a person can still run them by typing `/<name>` (`disable-model-invocation` blocks only automatic loading). Both are acceptable and match the intent.
- If the hook does not take effect after init, the Claude Code session may need restarting; the docs read for R2 did not say when hook changes are picked up, so the summary tells the person to start a new session and this should be checked on a real session before release.
- Plugin and enterprise skills cannot be hidden from here; where they duplicate imported skills the agent may still load them whole and the savings shrink. A packaging path through a Claude Code plugin is a possible later slice.
- Slice 5's open risk applies: the hook still injects on every prompt, including short follow-ups, until a cutoff is measured and added (R6, R6b).

## Size and safety

About 350 lines of code plus tests. The command writes only inside the project directory (settings file, skill front matter, store, record file) and reads the user skills directory for the report. It edits JSON and one front-matter line, never executes skill content, and keeps a record so every change can be undone. Paths with spaces are quoted in the hook command.
