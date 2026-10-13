# Changelog

All notable changes to SkillNib (`skillnib` on npm, command `nib`). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/); while the version is 0.x, a minor release may change behaviour.

Add a line under **Unreleased** for every change a user can see (commands, flags, output, files written, docs that change what to do), then move the lines under a new version heading when you release.

## [Unreleased]

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
