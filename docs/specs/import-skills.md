# Spec: import skills from files, directories or GitHub into a catalog

Status: APPROVED by user 2026-10-12. Slice 2 of the open-source release; builds on slice 1 (`compile-manifest`). The user deferred an include/exclude option to a later slice.
Spec-ID: import-skills
Scope: packages/import/**

## Purpose

Let a user point SkillTap at their skills in any common form (one markdown file, several files, a local directory, or a GitHub repository) and get back a catalog: every skill file read, identified, compiled to a manifest, and tied to where it came from, so later slices can store, rank and deliver it.

## Non-goals

No storage (the result is returned, not persisted), no retrieval, no CLI wiring (slice 4 calls this), no hook work, no URL import other than GitHub, no GitHub Enterprise, no private-catalog permissions or curation (hosted release), no watching for changes.

## Where it lives

`packages/import`. The import logic is pure and runtime-neutral: it works on a `SourceReader` (`list() -> paths`, `read(path) -> text`) and calls `compileSkill` from slice 1. Three readers ship: a filesystem reader (Node only, kept in a separate entry point), a list-of-files reader, and a GitHub reader that resolves `owner/repo[@ref][/subpath]` to a commit SHA and reads that commit's archive using `fetch` and web-standard gzip decompression, so the same reader can run in the hosted service.

## Inputs and discovery

1. One or more explicit `.md` files: each is imported as given, whatever its name.
2. A directory (or a GitHub repo or subpath): a skill is a directory that contains `SKILL.md`; its files are every `.md` under that directory, `SKILL.md` first. Markdown outside any skill directory is ignored, and the result lists what was skipped.
3. Inputs can be mixed in one call (for example a directory and two extra files). The same file reached twice is imported once.
4. A skill's id and name come from front matter `name` if present, otherwise the directory name (or file name without `.md` for explicit files). Two different skills with the same id in one import are reported as a conflict, not merged.

## Requirements

- R1 Local forms: a single file, several files, a directory and a mix of these all import; each skill file is compiled with its path relative to its source and the manifest verifies against the text read.
- R2 Discovery: in a directory or repository, a skill is a directory containing `SKILL.md`, its files are the `.md` files under it with `SKILL.md` first, and unrelated markdown is listed as skipped, not imported.
- R3 Identity: id and name come from front matter `name`, falling back to the directory or file name; duplicate ids in one import are reported as a conflict and neither is silently dropped.
- R4 Provenance: every imported file records its source kind (`file`, `dir`, `github`), its origin, and its content hash; GitHub sources also record the owner, repository, requested ref, resolved commit SHA and subpath, so the same input at the same commit gives an identical catalog.
- R5 GitHub: `owner/repo`, `owner/repo@ref` and `owner/repo/sub/path@ref` resolve the ref to a commit SHA and import from that commit only; a missing repository or ref, a rate limit and a network failure each give a distinct clear error; `GITHUB_TOKEN` is used when set and never appears in output or errors.
- R6 Limits and safety: only `.md` files are read; symbolic links, paths that escape the source root, files over 1 MiB and archives with more than 2000 markdown files are rejected or skipped with a recorded reason, never followed or truncated silently.
- R7 Failure isolation: an unreadable or non-UTF-8 file is reported and skipped; the other files in the import still succeed; the call fails only when nothing was imported or an input itself cannot be resolved.
- R8 Boundary: the import logic and the GitHub reader have no dependencies and import no Node-only module; only the filesystem reader, in its own entry point, may use `node:` modules; `npm run check` passes.

## Examples (single happy path and single failure, not a test plan)

- Happy path: `import ./my-skills ./notes/extra.md` finds two skill directories plus one standalone file, compiles all of them, and returns three skills with manifests and provenance.
- Failure: `anthropics/nope@v9` where the ref does not exist fails with a "ref not found" error naming the repository and ref, and does not fall back to the default branch.

## Risks and open questions

- Treating every `.md` under a skill directory as a skill file matches how C2 compiled the research catalogs, but it also pulls in non-instruction files such as READMEs. An include/exclude option is deferred by the user to a later slice.
- An explicit file has no sibling references, so a skill split across files must be imported as a directory or as several files (they stay separate skills unless they share a directory with a `SKILL.md`).
- The GitHub archive is downloaded in full to read it. Very large repositories are bounded by the file-count and size limits but still cost bandwidth; sparse fetching is a later optimisation.
- Unauthenticated GitHub requests are rate limited; the error says to set `GITHUB_TOKEN`. Private repositories work only with a token the user supplies; managed permissions are hosted-release scope.
- Front matter parsing is minimal (`name` only) and is not validated beyond that.

## Size and safety

Reads user-chosen files and downloads one archive per GitHub input over HTTPS; writes nothing. Limits in R6 bound memory and time. The token is read from the environment only and never logged. Archive entries are treated as untrusted data: names are normalised and checked against the root, contents are never executed.
