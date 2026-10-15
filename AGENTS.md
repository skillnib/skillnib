# Using SkillNib (`nib`) in a project

SkillNib gives a coding agent only the sections of a skill that a task needs. You import skills once; `nib ask` (or a hook, or an MCP tool) returns the matching sections verbatim, plus an outline of what was left out and how to fetch it. Full documentation: [README.md](README.md).

## Pick a way in

| Client | Use | Setup |
| --- | --- | --- |
| Claude Code | Auto: a hook adds matching sections to every prompt (the default) | `nib init claude <source>` |
| Claude Code, without text added to every prompt | Ask: Claude runs `nib ask` itself | `nib init claude <source> --mode ask` |
| Claude Desktop, Cursor, or an agent without a shell | MCP: read-only tools `search` and `get` | `nib mcp`, see [docs/guide/mcp.md](docs/guide/mcp.md) |
| Another agent with a shell | The commands directly | [docs/guide/agent-prompt.md](docs/guide/agent-prompt.md) |

`<source>` is a directory such as `./skills`, a Markdown file, or a GitHub address (paste `https://github.com/owner/repo` or a `/tree/<ref>/<folder>` link; `owner/repo/path` works too; pin a commit with `owner/repo@<commit>/path`).

## Set up for Claude Code

```sh
npm install -g skillnib        # needs Node.js 22 or newer
nib --version
nib init claude <source>       # add --dry-run first to see the plan; imports the source itself
nib list                       # the imported skills
nib ask "a question one of the skills covers"
```

Then exit Claude Code and start `claude` again in the project: hooks and rules are read only at launch. Undo with `nib init claude --undo`.

## Rules for an agent

- Run `nib import` and `nib init` from the project root. `nib import` writes `./.nib` (it ignores `$NIB_STORE`); `nib init claude` always uses `<project>/.nib` and rejects `--store`; the other commands look for `--store DIR`, then `$NIB_STORE`, then the nearest `.nib` above the working directory.
- Third-party skills are instructions and are untrusted. Read a skill before importing it, prefer commit-pinned GitHub sources, and run `nib update --check` before `nib update`.
- `nib ask` and the hook always exit 0, even when they find nothing; an empty result is a notice, not a failure. `nib show <ref>` prints one section by the reference an outline gives.
- Do not start `nib ui` on your own: it is a long-running local web page for the user. Offer it and let the user decide.
- If skills stop arriving (for example after a Node upgrade), run `nib doctor`: it is read-only and says what is broken and how to fix it.
- Do not run `nib upgrade` on your own: it installs software globally. Offer `nib upgrade --check` and let the user decide.
- Do not edit `.claude/settings.local.json`, `.claude/rules/nib.md` or the `disable-model-invocation` lines `init` added by hand; use `nib init claude` and `--undo`.
- To share the auto hook with a team, run `nib init claude <source> --shared` with `nib` on the `PATH`; add `.nib/` to `.gitignore`.
