# Spec: ship SkillTap as one npm package that installs the `tap` command

Status: APPROVED by user 2026-10-12. Slice 8 of the open-source release. Licence is Apache-2.0 (the user's choice, 2026-10-12); the `LICENSE` file is added by its own PR.
Spec-ID: npm-package
Scope: package.json, apps/cli/**, tools/release/**, docs/process/release.md

## Purpose

Let a person install SkillTap with one command and run `tap` from anywhere, so that `tap init claude` can write a stable command into their project. The package is the existing repository layout, trimmed to what runs; there is no bundler and no dependency.

## Non-goals

No publishing to the npm registry (that needs the user's account and two-factor login and is the user's action), no bundling or minifying, no provenance or signing, no auto-update, no Windows support, no Node versions below 22, no change to the commands' behaviour apart from `--version` and `--help`.

## Package shape

One package named `skilltap`, version taken from `package.json` (it stays `0.0.0` until the release gate), licence `Apache-2.0`, `bin` entry `tap` pointing at `apps/cli/bin/tap.js`, `engines.node` at least 22, no dependencies, no install-time scripts. The published files are listed in `files`: `LICENSE`, `README.md`, `apps/cli/bin`, `apps/cli/src`, and from each of `packages/compile`, `packages/import`, `packages/retrieve`, `packages/deliver` and `packages/claude` the `package.json`, `src`, and (for `import`) `node`. The relative imports between these directories remain valid inside the package, which is why no bundler is needed. Tests, fixtures, scripts, `docs`, `tools`, research data and `.github` are not shipped.

## Requirements

- R1 Contents: `npm pack` produces a tarball whose file list equals the list above exactly (no tests, fixtures, scripts, docs, research data, `.skilltap` directories or `.env` files), and whose size is at most 300 KB.
- R2 Metadata: the packed `package.json` has the name `skilltap`, the licence `Apache-2.0`, the `tap` bin, `engines.node` of at least 22, no `dependencies`, and no `preinstall`, `install` or `postinstall` script; `LICENSE` is in the tarball.
- R3 Version and help: `tap --version` prints the package version and exits 0; `tap --help` and `tap help` print the usage and exit 0; running `tap` with no command still prints usage and exits 2.
- R4 Import graph: every relative import in the shipped files resolves to a shipped file, checked statically by a script over the tarball's file list.
- R5 Install smoke test: the tarball is installed into a temporary directory (including one whose path contains a space), and the installed `tap` runs `--version`, `import`, `ask`, `hook claude` and `init claude` against the R2b fixture skills, with the hook command written by `init` pointing at the installed entry point and producing a delivery when run.
- R6 Offline and inert: installing and running the smoke test makes no network call and runs no install script.
- R7 Release check: `npm run release:check` runs R1, R2, R4 and R5 locally and fails on any difference; `docs/process/release.md` tells the user the publish steps (log in, check, tag, publish with two-factor) and says Claude does not publish.
- R8 Boundary: release tooling lives in `tools/release` and the one CLI change is `--version` and `--help` in `apps/cli`; the development scripts stay in the repository `package.json`; `npm run check` and `npm test` pass.

## Examples (single happy path and single failure, not a test plan)

- Happy path: `npm run release:check` packs the repository, installs the tarball into `/tmp/x y/`, and from there `tap init claude` in a project writes `node "/tmp/x y/node_modules/skilltap/apps/cli/bin/tap.js" hook claude`, which delivers a section when run.
- Failure: someone adds an import of `../../../tools/gates/lib.mjs` to a shipped file; the import-graph check names the file and the missing target and the release check fails.

## Risks and open questions

- `npm pack` includes the repository `package.json` as is, with its development `scripts`. They are harmless (no install-time scripts) but untidy; stripping them needs a build step and is left out.
- Making `package.json` publishable (no `private: true`) allows an accidental `npm publish`; the `prepublishOnly` script runs the release check, and the version stays `0.0.0` until the gate.
- Claude Code runs the hook command through a shell; a path with a space is quoted by `init`, which R5 exercises, but other exotic paths are untested.
- The package name `skilltap` may be taken on the registry; that is only discovered at publish time and is the user's call.
- Global install puts `tap` on the `PATH`, which slice 7 uses to write a short command; local installs fall back to an absolute path.

## Size and safety

About 200 lines of release tooling plus tests. The release check packs, installs and runs code from the repository in a temporary directory, writes nothing in the repository, makes no network calls and never publishes.
