# Examples

All output below is produced by the real `nib` command against the five sample skills in `sample-skills/` and is checked against it by the test suite. Paths are shown as `<project>`.

## Import, then ask

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

The first line says which retriever and catalog answered and how much it sent. Each section is framed `===== skill/file :: title =====`. Below the sections is the outline of what was left out, with references for `nib show`.

## Fetch a section that was left out

```sh
nib show acme-error-copy/acme-error-copy/SKILL.md#m3
```

```output
## Next steps

After saying what went wrong, give one next step in a sentence that starts with "Try", for example "Try uploading the file again." If no user action can help, say that the team has been notified instead.
```

## Nothing matches

```sh
nib ask "zebra quantum"
```

```output
nib: no module matched the ask
SkillNib: no sections were selected (no module matched the ask). Rephrase the ask with words from one of your skills, or check what is imported with nib list.

--- Skills in the catalog ---
acme-commit-messages  1 file  6 modules
  acme-commit-messages/SKILL.md  6 modules
acme-error-copy  1 file  6 modules
  acme-error-copy/SKILL.md  6 modules
acme-incident-report  1 file  6 modules
  acme-incident-report/SKILL.md  6 modules
acme-release-notes  1 file  6 modules
  acme-release-notes/SKILL.md  6 modules
acme-sql-style  1 file  6 modules
  acme-sql-style/SKILL.md  6 modules
```

`ask` exits 0 even here, so an agent is never blocked by it.

## Machine-readable output

`nib ask "..." --json` prints the retriever identity, every hit with its score and rank, the section texts and the outline as JSON, for scripts and for checking what was sent.

## Wire a project, then undo

```sh
nib init claude ./skills --mode ask
```

```output
Imported 5 skills, 5 files, 30 modules (0 oversize) into <project>/.nib
  acme-commit-messages  1 file  6 modules
  acme-error-copy  1 file  6 modules
  acme-incident-report  1 file  6 modules
  acme-release-notes  1 file  6 modules
  acme-sql-style  1 file  6 modules
Mode: ask (the agent runs nib ask itself)
Skill note: written to <project>/.claude/rules/nib.md (the agent runs nib ask when a task needs a skill)
No project skill needed hiding.
Plugin and enterprise skills cannot be checked from here; if they duplicate imported skills, hide them in Claude Code.
Start a new Claude Code session so the change is loaded. Undo with: nib init claude --undo
```

```sh
nib init claude --undo
```

```output
Removed <project>/.claude/rules/nib.md
```

## Import a single file

```sh
nib import notes.md
```

```output
Imported 1 skill, 1 file, 2 modules (0 oversize) into <project>/.nib
  notes  1 file  2 modules
The store now holds 6 skills from 2 sources.
```
