# Releasing SkillNib

Claude does not publish. Publishing needs your npm account with two-factor login and your GitHub credentials, so you run the release script yourself, on your machine.

## One command

```
tools/release/release.sh <version>            # e.g. 0.1.0
tools/release/release.sh <version> --dry-run  # everything except the three outward steps
```

Run it from a clean checkout of `main` that equals `origin/main`. Requirements: Node 22 or newer, `git`, `npm` (logged in: `npm login`), and optionally `gh` (logged in: `gh auth login`; without it the script prints the exact release command). The script never reads or stores a token; it uses your existing logins.

What it does, in order:

1. **Preflight.** Clean tree, on `main`, equal to `origin/main`, version newer than the latest public tag, the npm name not taken (first release only).
2. **Export.** A snapshot of the commit, minus the paths in `tools/release/export-ignore` (`.github` is kept: the gates workflow and PR template belong in the public repo and the gates tests read them), with the version set in `package.json` of the snapshot only. Your repository is not modified.
3. **Private-material guard.** Stops if the snapshot holds a path from `tools/release/private-paths` (the evaluation harness stays private), a `.env` file or a token-looking string.
4. **Verify.** `npm run check`, `npm test` and `npm run release:check` run inside the snapshot, and the tarball it packs is the one released. Its SHA-256 is printed in the plan.
5. **Plan and confirm.** The script prints the plan and waits for you to type `release` (`--yes` skips this).
6. **Publish.** One snapshot commit `Release vX.Y.Z` on top of the public repository's `main` (the first release creates `main`), the tag `vX.Y.Z`, the GitHub release with the tarball, and `npm publish --access public` (prereleases go to the npm tag `next`). npm asks for the one-time password itself.

Each outward step skips itself if it is already done, so after a failure (for example a wrong one-time password) rerun the same command. A tag that already exists with different content is refused.

The public repository is https://github.com/skillnib/skillnib. It receives one snapshot commit per release; the private history stays private. The version bump lives in the snapshot, so the private `package.json` keeps its development version.

## Before the first release

- The public documentation (slice 10) is merged.
- The C3 result is in `docs/research/` and the README states only what it measured.
- `npm view skillnib` says the name is free, or `package.json` has another name (the script checks this too).
- Dry run: `tools/release/release.sh 0.1.0 --dry-run`.

## After

Verify from a clean directory: `npm install -g skillnib && nib --version`, then `nib init claude` in a scratch project.
