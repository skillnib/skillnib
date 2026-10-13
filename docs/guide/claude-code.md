# SkillNib in Claude Code

Two modes, one command. Both import your skills into a local catalog, hide Claude Code's own copies of them (so the agent does not also load them whole), and make the matching sections reach the agent. They differ in who starts the lookup: in **auto** mode SkillNib does, on every prompt; in **ask** mode Claude does, by running `nib ask`. (`hook` and `pull` are accepted as aliases for `auto` and `ask`; they are also the values the init record in `.nib/init-claude.json` stores, which is why you may see them there.)

| | Auto | Ask |
| --- | --- | --- |
| Who starts the lookup | SkillNib, through a `UserPromptSubmit` hook, on every prompt | The agent, with `nib ask`, when it decides a task needs a skill |
| What is always in context | Nothing, until a prompt arrives; then the best sections for that prompt (at most about 9,500 characters) | A short note (at most 3,000 characters) listing your skills |
| Needs the agent to cooperate | No | Yes: it has to follow the note |
| Files written | `.claude/settings.local.json` (or `settings.json` with `--shared`) | `.claude/rules/nib.md` |

Auto is the default: `nib init claude <source>` with no `--mode` sets up auto. In the end-to-end test it was the one mode that scored at least as well as native loading and cost less on both catalogs (see the README for the numbers and their limits). Ask mode scored well too but was not shown to cost less on one catalog. Try both on your own work: switching is one command (`nib init claude --mode auto` or `--mode ask`), and each switch removes the other mode's file.

## Set up

From the project directory:

```sh
nib init claude ./skills --mode ask
```

This example uses ask mode. For auto, leave `--mode` out or write `--mode auto`.

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

Preview first with `--dry-run`, which prints the plan and writes nothing. Afterwards exit Claude Code and start `claude` again in the project: Claude Code reads hooks and rules only at launch.

`nib init claude` with no source uses the project's `.claude/skills` directory; if that does not exist either, it exits 2 with a usage message and writes nothing. Sources can also be GitHub repositories, with an optional ref and path (see [Importing](importing.md)), for example `nib init claude cloudflare/skills/skills --mode auto`. `init` imports its sources itself, so you do not run `nib import` first; if you have, importing the same commit again is skipped. Sources and the project's `.claude/skills` can be given together.

## Check that it works

```sh
nib list
nib ask "your question here"
```

`nib list` shows the imported sources and skills, and `nib ask` prints sections for a question. In auto mode, `.claude/settings.local.json` should contain a `UserPromptSubmit` entry that runs `nib hook claude`. To see what the hook adds for a prompt, send it the event by hand:

```sh
echo '{"hook_event_name":"UserPromptSubmit","prompt":"your question here"}' | nib hook claude
```

Then start a new Claude Code session and send a prompt that one of your skills covers.

## Files it touches

All inside the project directory:

- `.nib/` holds the catalog (`catalog.json`) and the record of what `init` changed (`init-claude.json`). It contains your skills' text; decide whether to commit it.
- Auto mode: one `UserPromptSubmit` entry in `.claude/settings.local.json` (personal, because the command holds a machine-specific path) or in `.claude/settings.json` with `--shared` (the one you commit; its command is the portable `nib hook claude`, so `--shared` needs `nib` on the `PATH`). Other settings and hooks are kept.
- Ask mode: `.claude/rules/nib.md`. Claude Code loads rules files at launch and still reads `AGENTS.md`; SkillNib never creates `CLAUDE.md` or `CLAUDE.local.md`, because creating them would stop Claude Code reading `AGENTS.md`.
- Hiding: for each imported skill under `.claude/skills/<name>/SKILL.md`, the line `disable-model-invocation: true` is added to its front matter. Nothing else in the file changes. Skills without front matter are reported and left alone. This front matter line is the only edit `init` makes to a file that already existed (settings files get one added entry, and new files are created).

Skills in your user directory (`~/.claude/skills`), plugin skills and enterprise skills are never edited. If one of them has the same name as an imported skill, `init` says so; hide it yourself in Claude Code.

## On a team

To share the hook, run `nib init claude <sources> --shared` with `nib` installed globally (`npm install -g skillnib`). That writes `.claude/settings.json` with the command `nib hook claude` (you commit the file yourself; `init` never runs git, and `--shared` only applies to auto mode, in ask mode it changes nothing), which has no machine path, so it works for every teammate who has `nib` installed. If `nib` is not on your `PATH`, `--shared` stops and tells you to install it, because a committed hook with your own path would be wrong for everyone else.

Each teammate then installs `nib` and imports the same sources (`nib init claude <sources> --shared` again leaves the committed file unchanged). The catalog itself is not shared: `.nib/init-claude.json` records machine paths, so add `.nib/` to `.gitignore` rather than committing it. A teammate without `nib`, or without the catalog, gets no skill text and an unchanged prompt, because the hook fails open. To make everyone get the same text, pin GitHub sources to a commit you reviewed: `cloudflare/skills@<commit>/skills`. Without `--shared` the hook goes to `.claude/settings.local.json` and keeps the absolute path of this machine's `nib`, which is robust but personal. Ask mode writes `.claude/rules/nib.md` with a plain `nib` command when `nib` is on the `PATH`.

## Duplicates that init cannot hide

`init` hides only the copies in the project's `.claude/skills`. A skill with the same name in `~/.claude/skills`, in a plugin or from your organisation stays visible to Claude Code, so it can load whole next to SkillNib's sections. `init` warns about user-level copies it finds and cannot check plugin or enterprise ones; disable or hide those copies in Claude Code yourself, or the saving is lost for that skill.

## Undo

```sh
nib init claude --undo
```

This removes the hook entry or the rules file and restores exactly the front matter lines `init` recorded. A file you edited since is reported and left alone; the output then lists what was skipped and keeps the record `.nib/init-claude.json`, so fix those files by hand and run `nib init claude --undo` again to finish. The `.nib` directory (the catalog) stays; delete it if you want it gone.

## What auto mode does and does not do

On each prompt Claude Code runs `nib hook claude` with the event on standard input. The hook searches the catalog with the prompt text and prints the matching sections as context, followed by an outline of what it left out and the command to fetch it. Claude Code caps hook output at 10,000 characters; SkillNib keeps its output under 9,500.

The hook always exits 0. If the catalog is missing, nothing matches, or anything goes wrong, it adds a short notice or nothing at all and your prompt goes through unchanged. A prompt that matches no section gets no skill text.

## Limits

A hook adds sections on every prompt, including short follow-ups like "ok, do that". With a very short prompt the best matches can be loosely related. If that bothers you, use ask mode. Claude Code first only; other agents can use the commands directly (see the [agent prompt](agent-prompt.md)).
