# SkillNib in Claude Code

Two modes, one command. Both import your skills into a local catalog, hide Claude Code's own copies of them (so the agent does not also load them whole), and make the matching sections reach the agent. They differ in who starts the lookup: in **auto** mode SkillNib does, on every prompt; in **ask** mode Claude does, by running `nib ask`. (`hook` and `pull` are accepted as aliases for `auto` and `ask`.)

| | Auto | Ask |
| --- | --- | --- |
| Who starts the lookup | SkillNib, through a `UserPromptSubmit` hook, on every prompt | The agent, with `nib ask`, when it decides a task needs a skill |
| What is always in context | Nothing, until a prompt arrives; then the best sections for that prompt (at most about 9,500 characters) | A short note (at most 3,000 characters) listing your skills |
| Needs the agent to cooperate | No | Yes: it has to follow the note |
| Files written | `.claude/settings.local.json` (or `settings.json` with `--shared`) | `.claude/rules/nib.md` |

Auto is the default. In the end-to-end test it was the one mode that scored at least as well as native loading and cost less on both catalogs (see the README for the numbers and their limits). Ask mode scored well too but was not shown to cost less on one catalog. Try both on your own work: switching is one command (`nib init claude --mode auto` or `--mode ask`), and each switch removes the other mode's file.

## Set up

From the project directory:

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

Preview first with `--dry-run`, which prints the plan and writes nothing. Start a new Claude Code session afterwards: Claude Code reads hooks and rules at launch.

`nib init claude` with no source uses the project's `.claude/skills` directory. Sources can also be GitHub repositories, for example `nib init claude acme/skills --mode auto`.

## Files it touches

All inside the project directory:

- `.nib/` holds the catalog (`catalog.json`) and the record of what `init` changed (`init-claude.json`). It contains your skills' text; decide whether to commit it.
- Auto mode: one `UserPromptSubmit` entry in `.claude/settings.local.json` (personal, because the command holds a machine-specific path) or in `.claude/settings.json` with `--shared`. Other settings and hooks are kept.
- Ask mode: `.claude/rules/nib.md`. Claude Code loads rules files at launch and still reads `AGENTS.md`; SkillNib never creates `CLAUDE.md` or `CLAUDE.local.md`, because creating them would stop Claude Code reading `AGENTS.md`.
- Hiding: for each imported skill under `.claude/skills/<name>/SKILL.md`, the line `disable-model-invocation: true` is added to its front matter. Nothing else in the file changes. Skills without front matter are reported and left alone.

Skills in your user directory (`~/.claude/skills`), plugin skills and enterprise skills are never edited. If one of them has the same name as an imported skill, `init` says so; hide it yourself in Claude Code.

## Undo

```sh
nib init claude --undo
```

This removes the hook entry or the rules file and restores exactly the front matter lines `init` recorded. A file you edited since is reported and left alone. The catalog stays; delete `.nib` if you want it gone.

## What auto mode does and does not do

On each prompt Claude Code runs `nib hook claude` with the event on standard input. The hook searches the catalog with the prompt text and prints the matching sections as context, followed by an outline of what it left out and the command to fetch it. Claude Code caps hook output at 10,000 characters; SkillNib keeps its output under 9,500.

The hook always exits 0. If the catalog is missing, nothing matches, or anything goes wrong, it adds a short notice or nothing at all and your prompt goes through unchanged. A prompt that matches no section gets no skill text.

## Limits

A hook adds sections on every prompt, including short follow-ups like "ok, do that". With a very short prompt the best matches can be loosely related. If that bothers you, use ask mode. Claude Code first only; other agents can use the commands directly (see the [agent prompt](agent-prompt.md)).
