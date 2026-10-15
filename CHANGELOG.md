# Changelog

All notable changes to SkillNib (`skillnib` on npm, command `nib`). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/); while the version is 0.x, a minor release may change behaviour.

Add a line under **Unreleased** for every change a user can see (commands, flags, output, files written, docs that change what to do), then move the lines under a new version heading when you release.

## [Unreleased]

## [0.2.0] - 2026-10-15

### Fixed
- Pinning a commit with the documented `owner/repo@<commit>/folder` form works; it was read as a ref named `<commit>/folder` and failed with `ref-not-found`. A ref with slashes (`feature/x`) now also works in `owner/repo@ref/folder` and `/tree/<ref>/<folder>` addresses: `nib` asks GitHub which part is the ref.

### Added
- `nib doctor [--project DIR] [--json]` checks the catalog, search and the Claude Code hook without changing anything, and says what is broken and the command that fixes it: a hook whose `nib` path no longer exists (after a Node or nvm upgrade), a portable hook with no `nib` on the PATH, a hook that `init` recorded but the settings lost, a missing ask-mode rules file, a missing or corrupt catalog, deleted local sources and duplicate skill ids. Exit 1 when something failed.
- Import from a pasted GitHub address: `nib import https://github.com/owner/repo`, `.../tree/<ref>/<folder>`, `.../commit/<sha>`, `.../blob/...` (its folder), `git@github.com:owner/repo.git` and the short forms all work in `nib import`, `nib init claude` and the dashboard. Other hosts are refused with a message. The dashboard's import box previews what it understood without contacting GitHub.
- `nib ui` starts a local web dashboard on `127.0.0.1` for the project's catalog (`--port N`, `--project DIR`; Ctrl+C stops it). Skills are listed under the source they came from, collapsed by default, with a searchable namespace filter. Import takes a pasted GitHub address, a local folder or Markdown files; there is also quick search (optionally within one namespace), Claude Code setup (preview, install, undo) or an MCP entry to copy, and a start-up test that checks the catalog, `nib ask`, the hook and the wiring. Every action runs the existing commands.
- `nib embed on|build|status|off`: an optional, experimental hybrid of BM25 and embeddings from a local server that speaks the OpenAI `/v1/embeddings` shape. Off by default; with it off nothing changes. A down server or a stale index falls back to BM25 with a notice. See [Embeddings](docs/guide/embeddings.md).
- `nib ui` shows a progress bar at the top while a background task (import, embedding index) runs, and stops asking the server for task status once nothing is running.
- `nib ui` keeps working in a tab that was open when the dashboard was restarted: it picks up the new token by itself instead of failing with "missing or wrong token".
- `nib ui` menu: Catalog shows how many sources it holds; the other menu items no longer show a number (it looked like a count but was an unused shortcut digit).
- `nib ask --no-embed` (BM25 only, ignoring embeddings for that call) and a **Compare retrievers** page in `nib ui` that runs your text through `nib ask` with and without embeddings and shows both answers side by side; the page also turns embeddings on, builds the index and turns them off.
- With embeddings on, the embedding index updates itself after `nib import`, `nib update` and `nib remove` (`--no-embed` skips it); `nib ui` shows it as an "Updating the embedding index" task with a chip in the header.
- Public pages (GitHub Pages source: the `docs/` folder): an overview, a results-and-limits page (the README's measured statements, the embedding test and where SkillNib does not help) and a roadmap that lists the optional embedding retriever. The README links them.

## [0.1.3] - 2026-10-13

### Fixed
- Skills that share a name no longer break search. When two sources provide a skill with the same id (for example a project's own `.claude/skills` copy and the repository you import), every `nib ask`, hook call and MCP `search` failed with `duplicate module id in corpus`. Now both stay searchable, the later one as `<id>~2`, and a copy with identical files is searched once. `nib import`, `nib init claude` and `nib list` say so.
- `nib remove <skill>` notes when skills you did not name were removed with their source.
- The usage text now says that `ask` and the hook exit 0 when nothing matches and that an empty ask is a usage error (exit 2).
- The importing guide documents that `catalog.json` offsets are string indexes and `bytes` is the UTF-8 length.

### Added
- `nib upgrade` installs the latest `nib` from npm (`npm install -g skillnib@<latest>`); `nib upgrade --check` only reports whether a newer version exists. It is explicit: the hook, `nib ask` and the MCP server never check for updates or use the network.

## [0.1.2] - 2026-10-13

No change to the command line; the public repository and the README changed.

### Changed
- The README no longer links the research records; it says they are kept privately and not published here. The measured figures and limits are unchanged.
- The public repository no longer contains `docs/research/` or `tools/`, and its `package.json` has only the `test` script. CI runs `npm test`.

## [0.1.1] - 2026-10-13

### Changed
- `nib init claude --store DIR` is now rejected with exit code 2 instead of being silently ignored; `init claude` always uses `<project>/.nib` (use `--project DIR` to pick the project).
- `nib init claude --shared` now writes the portable hook command `nib hook claude` into the committed `.claude/settings.json`, so it works on every teammate's machine. It needs `nib` on the PATH and refuses otherwise. Hook entries written earlier with an absolute path are still recognised by `--undo` and re-runs.
- The notice printed when no sections are selected (`nib ask`, MCP `search`) now says to rephrase the ask with words from one of your skills or check `nib list`, instead of suggesting to load the skills normally.
- Documentation: the README and guides now explain the three ways in (auto, ask, MCP) with a pick table and a copy-paste setup block, and align the store rules, flags, exit codes and MCP guidance with the CLI.

### Added
- The repository ships an `AGENTS.md` written for agents that use `nib`, and a CI workflow (`npm test`).

### Removed
- Maintainer material (specs, process docs, roadmap, research records, internal skills, release and check tooling) is no longer part of the public repository.

## [0.1.0] - 2026-10-13

First release. The commands are `import`, `update`, `remove`, `ask`, `show`, `list`, `init claude`, `mcp` and `hook claude`.

### Added
- Import skills from files, directories or GitHub (`owner/repo[@ref][/subpath]`) into a local `.nib/` catalog, split into sections, with `update`, `remove` and `list`.
- BM25 retrieval of the matching sections, returned verbatim, with an outline of what was left out (`nib ask`, `nib show`).
- Claude Code integration with `nib init claude`: auto mode (a `UserPromptSubmit` hook adds the matching sections to every prompt, the default) and ask mode (a rules file tells the agent to run `nib ask`); `--shared`, `--dry-run` and `--undo`.
- An MCP server (`nib mcp`) with two read-only tools, `search` and `get`.
