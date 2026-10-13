# SkillNib

SkillNib gives a coding agent only the part of a skill that the task needs, instead of loading the whole skill. You import your skills once; when the agent (or you) asks a question, SkillNib returns the matching sections of those skills, verbatim, with a list of what it left out and how to fetch it.

Command-line tool `nib`, Claude Code first. Open source, Apache-2.0.

## What it is

Agent skills are Markdown files full of instructions. A long skill costs context every time the agent loads it, even when the task needs one paragraph of it. SkillNib splits each skill into its sections once (`nib import`), ranks the sections against the ask with plain BM25 word matching (`nib ask`), and returns the best few sections unchanged, framed with their skill and file names. Nothing is summarised or rewritten: what the agent receives is the text you wrote.

```
skills (files, directories, GitHub)
   | nib import      split into sections, hash them, store them in ./.nib
   v
catalog  ---- nib ask "..." ---->  matching sections, verbatim
   ^                                + outline of what was left out
   | nib update                     + the command to fetch any of it
   | (explicit; --check reports first)
```

In Claude Code SkillNib runs in one of two modes, named for who starts the lookup. In **auto** mode SkillNib adds the matching sections to every prompt by itself. In **ask** mode Claude runs `nib ask` itself when a task may need a skill. See [Claude Code](docs/guide/claude-code.md).

## Install

Requirements: Node.js 22 or newer. macOS and Linux are supported; Windows is untested.

```sh
npm install -g skillnib
nib --version
```

`nib --version` prints the installed version. The package has no dependencies and runs no install scripts.

## Quickstart

The package ships five small sample skills. Copy them somewhere to try SkillNib in a scratch directory:

```sh
cp -r "$(npm root -g)/skillnib/docs/guide/sample-skills" ./skills
```

Import them, list what you have, and ask a question:

```sh
nib import ./skills
```

```output
Imported 5 skills, 5 files, 30 modules (0 oversize) into <project>/.nib
  acme-commit-messages  1 file  6 modules
  acme-error-copy  1 file  6 modules
  acme-incident-report  1 file  6 modules
  acme-release-notes  1 file  6 modules
  acme-sql-style  1 file  6 modules
```

```sh
nib list
```

```output
<project>/skills  dir  local
  acme-commit-messages  1 file  6 modules
  acme-error-copy  1 file  6 modules
  acme-incident-report  1 file  6 modules
  acme-release-notes  1 file  6 modules
  acme-sql-style  1 file  6 modules
```

```sh
nib ask "how should I word an error when the upload fails?"
```

```output
SkillNib bm25 v1 (corpus b32f72b4): 4 sections, 843 bytes

===== acme-error-copy/acme-error-copy/SKILL.md :: (preamble) =====
---
name: acme-error-copy
description: Acme's guidelines for user-facing error messages. Use when writing, reviewing or translating error text shown in the product.
---

# Acme error copy



===== acme-error-copy/acme-error-copy/SKILL.md :: Wording rules =====
## Wording rules

Begin every error message with the words "We couldn't" followed by what did not work. Never blame the user: do not use phrases such as "you forgot", "you failed" or "you did not". Write at most two sentences. Do not show internal error codes in the message body.



===== acme-error-copy/acme-error-copy/SKILL.md :: Accessibility =====
## Accessibility

Errors are announced to screen readers when they appear. Put the most important information in the first sentence and never rely on colour alone to mark an error.


===== acme-error-copy/acme-error-copy/SKILL.md :: Overview =====
## Overview

Error messages appear at moments when users are already frustrated, so they must be calm, short and useful. This guide covers wording; visual treatment is in the design system.



--- Not delivered (fetch one with: nib show <ref>) ---
acme-error-copy
  acme-error-copy/SKILL.md
    acme-error-copy/acme-error-copy/SKILL.md#m3  Next steps  220 B
    acme-error-copy/acme-error-copy/SKILL.md#m4  Localisation  168 B
Other skills: acme-commit-messages, acme-incident-report, acme-release-notes, acme-sql-style
```

You get the sections of the error-copy skill that match, in rank order, and below them an outline of the sections that were not included, each with the reference you can pass to `nib show <ref>`. Use your own skills the same way: `nib import ./path/to/skills`, `nib import ./one-file.md` or `nib import owner/repo` (see [Importing](docs/guide/importing.md)).

To wire a Claude Code project to your skills, see the next section. More worked examples: [Examples](docs/guide/examples.md).

## Claude Code

Two modes, named for who starts the lookup. **Auto**: SkillNib adds the best matching sections to every prompt you send, with no action from Claude. **Ask**: a short note tells Claude to run `nib ask` itself when a task may need one of your skills.

| | Auto | Ask |
| --- | --- | --- |
| Who starts the lookup | SkillNib, on every prompt | Claude, when it decides a task needs a skill |
| What is always in context | Nothing until a prompt arrives, then the matching sections | A short note listing your skills |
| Risk | Adds text even for a short follow-up like "ok, do that" | Claude has to follow the note |
| How it is wired | A `UserPromptSubmit` hook in `.claude/settings.local.json` | A note in `.claude/rules/nib.md` |

**Auto is the default**, because it is the one mode the end-to-end test (C3, below) found both no worse on quality and lower in cost on both catalogs. Choose ask if you do not want text added to every prompt.

```sh
nib init claude ./skills --mode ask
```

`nib init claude` imports the sources you name (and the project's `.claude/skills`), hides the project's native copies of those skills so Claude Code does not load them whole, and wires the mode you chose (`--mode auto` or `--mode ask`; `hook` and `pull` also work as aliases). It writes only inside the project and records what it changed so that `nib init claude --undo` can reverse it. Start a new Claude Code session afterwards, because Claude Code reads hooks and rules at launch.

Ask mode never touches `CLAUDE.md` or `AGENTS.md`. The note it writes is shown in the [agent prompt](docs/guide/agent-prompt.md) guide, together with advice on phrasing asks and on adapting the prompt for another agent. Details, files touched and undo: [Claude Code guide](docs/guide/claude-code.md).

## Commands

| Command | What it does |
| --- | --- |
| `nib import <source...>` | Add skills from a file, a directory or `owner/repo[@ref][/subpath]` on GitHub. |
| `nib list [<query>]` | Show sources and skills; the query matches skill names and source locations. |
| `nib ask "<ask>"` | Return the matching sections, an outline of the rest and how to fetch it. |
| `nib show <ref>` | Print one section by reference. |
| `nib update [<name>...]` | Refresh skills or whole sources; `--check` only reports what changed. |
| `nib remove <name>...` | Remove the source that provides a skill or location. |
| `nib init claude [<source>...]` | Wire a Claude Code project (`--mode auto` or `ask`); `--undo` reverses it. |
| `nib mcp` | Run SkillNib as an MCP server with two tools, `search` and `get`; see [MCP](docs/guide/mcp.md). |
| `nib hook claude` | The hook Claude Code runs; it reads the event on standard input. |

Flags: `--store DIR` (where the catalog lives; otherwise `$NIB_STORE`, otherwise the nearest `.nib` above the working directory), `--k N` and `--outline-lines N` for `ask`, `--json` for `ask` and `list`, `--replace`, `--force`, `--check`, `--prune`, `--from SOURCE`, `--mode`, `--project DIR`, `--shared`, `--dry-run` and `--undo` as described in `nib --help`. Exit codes: 0 success (`ask` also exits 0 when it finds nothing, so an agent is never blocked), 1 error, 2 usage.

## Safety

- **Skills are instructions, and third-party skills are untrusted.** A skill you import from someone else can tell your agent to do things. SkillNib delivers skill text verbatim; it does not check what it says. Read a skill before you import it, and prefer commit-pinned GitHub sources.
- **Updates are explicit.** Nothing is refreshed on its own. `nib update --check` reports which sections of each skill changed, were added or were removed, and writes nothing; run it before `nib update`, which reports the same and then refreshes.
- **`nib init claude` edits only the files the [guide](docs/guide/claude-code.md) lists**, all inside the project, and `nib init claude --undo` restores them. It never edits user-level, plugin or enterprise skills.
- **The hook never blocks a prompt.** It always exits 0, and on any error it adds nothing and your prompt goes through unchanged.
- **No network use except GitHub imports.** `nib ask`, `show`, `list` and the hook read local files only.

## Status and limits

Version 0.x. Retrieval is lexical BM25 (embeddings were tested and rejected for this release). The one measurement behind the idea, from an offline test on two public skill catalogs, is below; its limits matter as much as its result.

<!-- measured:c2 -->
In a pre-registered offline comparison, returning the top four BM25 sections scored within noise of a simulated native loading on a fact-matching score, while sending about 70% fewer bytes. Limits: native loading was simulated rather than run in Claude Code, one model family, success scored by pattern matching on facts in the answer, bytes rather than tokens, and questions written by authors who had seen the answers. The record is in [docs/research/STATUS.md](https://github.com/skillnib/skillnib/blob/main/docs/research/STATUS.md).
<!-- /measured:c2 -->

<!-- measured:c3 -->
The end-to-end test in real Claude Code (C3: 89 questions on each of two public catalogs, Cloudflare skills and HyperFrames, one model, one Claude Code build) compared both modes with Claude Code's own skill loading. Auto mode scored higher than native loading (+8.5 points on Cloudflare, 95% interval +2.8 to +14.6; +16.1 on HyperFrames, +9.6 to +22.7) and cost less per run (33% less, 27 to 39; 48% less, 42 to 53). Ask mode also scored higher (+11.9 and +20.9) but was not shown to cost less on Cloudflare (6.7% less, interval -1.5 to 14.2; on HyperFrames 32% less, 25 to 39), so it is not the default. Limits: native loading skipped the skills altogether in a fifth to a third of its runs, so the comparison is against Claude Code's actual behaviour in this build and not against an agent that always loads the right skill; success is pattern matching on facts in the answer; the verdict was decided under a validity rule amended after the first result was seen; cost over a conversation is reported in the next paragraph (C3b). Record: [C3 results](https://github.com/skillnib/skillnib/blob/main/docs/research/C3-results.md).
<!-- /measured:c3 -->

<!-- measured:c3b -->
Over an 8-turn scripted conversation (three of the questions and five short follow-ups, 20 scripts, each run in every arm), auto mode also cost less than Claude Code's native loading: 25.8% less per conversation (95% interval 16.0 to 35.2; Cloudflare 23.0%, 6.7 to 36.4; HyperFrames 28.7%, 15.3 to 39.8), with the score on the three questions +13.3 points (+5.4 to +21.7). Ask mode cost 22.9% less (10.9 to 33.1). Auto and ask were not shown to differ in cost or in score. Limits: the conversations were scripted with generic follow-ups that do not react to the answers, eight turns, two catalogs, one model and one Claude Code build; the comparison is against Claude Code's actual native behaviour, which skipped skills in a fifth to a third of its runs; and a conversation cost about 1.2 to 1.6 dollars in every arm, so the saving is a few tenths of a dollar per conversation. Record: [C3b results](https://github.com/skillnib/skillnib/blob/main/docs/research/C3b-results.md).
<!-- /measured:c3b -->

Not covered: agents other than Claude Code, Windows, skill sources other than files, directories and GitHub, and any hosted or private catalog service.

## Licence

Apache License 2.0. See [LICENSE](LICENSE).
