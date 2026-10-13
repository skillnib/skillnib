# Spec: one script that exports the repository to the public GitHub repo and publishes the npm package

Status: APPROVED by user 2026-10-12, with one snapshot commit per release (history stays private). Slice 11 of the open-source release.
Spec-ID: release-script
Scope: tools/release/**, docs/process/release.md, package.json

## Purpose

Let the user cut a release with one command, `tools/release/release.sh <version>`, run on their own machine: it checks the product, exports a clean snapshot to the public repository https://github.com/skilltapsh/skilltap (creating its `main` on the first release), tags it, creates the GitHub release with the tarball attached, and publishes the package to npm. Claude never runs the publishing part; this script is the user's action (see `docs/process/release.md`).

## Non-goals

No GitHub Actions release workflow, no automatic or scheduled releases, no changelog generation, no pre-release channels or dist-tags other than `latest`, no signing or provenance, no rollback command (npm unpublish and tag deletion are manual), no Windows support, no running of the evaluation (C3 stays private and manual; the script only reads whether the release notes file names a result), no change to the CLI or packages.

## Behaviour

`release.sh <version> [--dry-run] [--yes] [--public-url URL] [--branch NAME]`. The version is `MAJOR.MINOR.PATCH` with an optional `-prerelease` suffix. The default public URL is the one above. With `--dry-run` everything runs except the three outward actions (push, GitHub release, npm publish), which are printed instead. Without `--yes` the script prints the plan (version, commit, files, target URLs) and waits for the word `release`.

1. Preflight: the working tree is clean, the current branch is `main` and equal to `origin/main`, the version is valid, newer than the latest `v*` tag of the public repository, and the tag does not exist; Node 22 or newer, `git` and `npm` are present; `gh` is optional (without it the GitHub release step prints the exact command).
2. Export: `git archive` of the current commit minus the paths in `tools/release/export-ignore` (at least `.github`, `tools/research`, any `*.harness.*` and `.skilltap`), into a temporary directory; in it `package.json` gets the requested version; nothing in the private repository is modified.
3. Private-material guard: the export is scanned and the run stops if it contains any path from `tools/release/private-paths` (the evaluation harness and scratch names), a `.env` file, or a string that looks like a token.
4. Verify in the export: `npm run check`, `npm test`, `npm run release:check`, and the tarball it packs is the one released.
5. Publish, each step skipping itself when already done so a failed run can simply be rerun: commit the snapshot (message `Release vX.Y.Z`, one commit per release on top of the public history, parent from the public repo's `main` if it exists, otherwise a root commit) and push `main` and the tag `vX.Y.Z` to the public repository; create the GitHub release with the tarball and its SHA-256; `npm publish` of that tarball with `--access public` (the prompt for the one-time password is npm's own).

## Requirements

- R1 Arguments: a missing, malformed or non-greater version exits with status 2 and a message naming the problem; `--help` prints usage and exits 0; unknown flags exit 2.
- R2 Preflight: a dirty tree, a branch other than `main`, a `main` that differs from `origin/main`, an existing tag, or a missing `git` or `npm` stops the script before anything is created, each with its own message.
- R3 Export content: the export holds exactly the tracked files of the commit minus the ignore list, with the new version in `package.json` and no other file changed; the private repository's files and history are untouched afterwards.
- R4 Guard: planting a path from the private list, a `.env` file or a token-looking string in the export makes the script fail before verification, naming the file; the check passes on a clean repository.
- R5 Verification: the three npm checks run inside the export and any failure stops the script before the first outward action; the released tarball's SHA-256 equals the one printed in the plan.
- R6 Dry run: `--dry-run` performs steps 1 to 4, makes no push, GitHub call or `npm publish`, and prints each skipped outward action with its exact command; it leaves no commit or tag in either repository.
- R7 First and later releases: against an empty public repository the script creates `main` and the tag; against one that already holds a release it adds one commit whose tree equals the new export and whose parent is the previous public `main`.
- R8 Idempotent rerun: after a simulated failure at the GitHub-release step or at the npm step, rerunning the same command completes the remaining steps without a second commit, tag or publish of an already published version.
- R9 Confirmation and secrets: without `--yes` nothing outward happens unless the user types `release`; the script never reads, prints or stores an npm or GitHub token (it relies on the user's `npm login`, git credentials and `gh auth`).
- R10 Tests and docs: the behaviours above are tested end to end with local bare repositories as the "public" remote and stub `npm` and `gh` commands on the path, with no network access; `docs/process/release.md` is rewritten around the script and still says Claude does not publish; `npm test` runs the new tests and `npm run check` passes.

## Examples (single happy path and single failure, not a test plan)

- Happy path: on a clean `main`, `tools/release/release.sh 0.1.0` prints the plan, the user types `release`, the public repo gets `main` and the tag `v0.1.0`, the GitHub release carries `skilltap-0.1.0.tgz`, and npm publishes `skilltap@0.1.0`.
- Failure: npm rejects the one-time password; the commit, tag and GitHub release already exist, the script says which step failed, and rerunning the same command only repeats the npm publish.

## Size and safety

About 300 lines of shell plus a test of about 250 lines; no runtime code changes. The script changes only a temporary directory until the confirmed publish step, then only the public repository, the GitHub release and the npm registry. Tests never touch the network. The riskiest part is publishing the wrong content, which the export list, the private-material guard, the verification inside the export and the plan with a tarball hash exist to prevent.

## Risks and open questions

- A single squashed snapshot per release hides the private commit history from the public repo; pushing the full `main` history instead is possible but would publish every past commit. Decided by the user: snapshots.
- The version bump exists only in the export, so the private `package.json` stays at its development version; the public repo is the record of released versions.
- The `v0.1.0` release should not be cut before the public documentation (slice 10) and the C3 result are in; the script does not enforce that, the release notes do.
- The package name `skilltap` may be taken on npm, discovered only at publish time (the step before it could run `npm view skilltap` and say so; included as part of preflight if cheap).
