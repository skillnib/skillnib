# Spec: add, update and remove imported skill sources one at a time or all together

Status: APPROVED by user 2026-10-12, with the scenarios below added at the user's request. Slice 9 of the open-source release; builds on slices 2 and 4 (import and the store). Not part of the first plan; added after the user asked what happens when an imported skill changes.
Spec-ID: sources-update
Scope: packages/import/**, apps/cli/**

## Purpose

Let a person keep an imported catalog current without redoing it: import a new source without losing the others, refresh one source or all of them, see exactly what changed before accepting it, and remove a source, while GitHub pins stay honest and the Claude Code wiring stays consistent.

## What happens today (the gap)

`tap import <source...>` replaces the whole store with the sources it is given, so importing one source drops every other. The store keeps no list of sources, though every imported file records where it came from. A GitHub source is read at the commit its ref resolved to on that day, and that commit is recorded; re-running the same import later re-resolves a branch or tag to whatever it points to then, while a commit hash stays fixed. `tap init claude` also re-imports and replaces. There is no way to update one skill, to see what changed, or to remove one.

## Non-goals

No automatic or background updates (updating third-party instructions is always an explicit act), no text-level diff of a module (module-level only), no per-skill include or exclude inside one source (use a subpath: `owner/repo/skills/foo` is the way to import one skill from a repository), no signature or provenance checks, no change to compile, retrieval or delivery, no store format change (the sources are derived from the provenance already stored, so older stores keep working).

## The unit and the vocabulary

- A source is what the user gave to `import`: a directory, a file, or a GitHub reference with its subpath and ref. Its namespace for searching is its location: `owner/repo` (and subpath) for GitHub, the path for local sources. A skill belongs to exactly one source.
- Updates can name skills or sources. Naming a skill refreshes only that skill and leaves the other skills of its source at the version already imported (each imported file records its own commit, so a source may hold skills from different commits). Naming a source refreshes all of its skills, adds skills that have appeared upstream, and reports skills that have disappeared. Removal is by source only; to take a single skill from a repository, import its subpath (`owner/repo/skills/foo`).
- A GitHub reference with no ref resolves to the latest commit of the repository's default branch at the moment of the import, and records that commit. A source is pinned when its ref as typed is a commit hash (7 to 40 hexadecimal characters) and floating otherwise (a branch, a tag, or no ref at all). Local sources are re-read from disk on every update.
- Updating never touches a pinned source unless `--force` is given.

## Behaviour

- `tap import <source...>`: adds the given sources, or replaces the skills of a source that is already in the store; skills of other sources are untouched. What the store already has is not imported again: a GitHub reference that resolves to a repository, subpath and commit already in the store (under any ref) is skipped before anything is downloaded, and a local source whose skills are identical to those stored is reported as unchanged; either says so and exits 0, and `--force` imports anyway. `--replace` restores the old behaviour of replacing the whole store.
- `tap list [<query>] [--json]`: lists the sources, each with its kind, location, ref as typed, resolved commit (GitHub), pinned or floating, and its skills. With a query it keeps the skills whose name or id contains the query, or whose source location (the namespace, for example `cloudflare` or `cloudflare/skills`) contains it, ignoring case, and the sources that provide them; a query that matches nothing says so and exits 0.
- `tap update [<name>...] [--check] [--force] [--prune]`: with no name, refreshes every source; each name is a skill id (exact) or a source location (exact, or a part that matches exactly one source). A skill name refreshes that skill only, a source name refreshes the whole source; several names are allowed. An ambiguous name exits 2 with the candidates, each shown with its source and ref (the same repository can be in the store at two refs, for example the latest and a pinned commit); `--from <source>` limits the lookup to one source, given by its location with or without `@ref`. An unknown name exits 1. A skill that has disappeared from its source is kept and flagged unless `--prune` removes it. `--check` reads the sources and prints what would change without writing.
- `tap remove <name>... [--from <source>]`: removes the whole source that provides each named skill or location, with its skills.
- After a refresh the command prints, per source, whether it is up to date or what changed: skills added or removed, modules added, removed or changed (by content hash, with titles), and for GitHub the old and new commit.
- If the project was set up with `tap init claude`, a refresh or removal keeps the wiring consistent: newly imported project skills are hidden, skills of a removed source are restored to Claude Code and dropped from the record, the pull-mode note is rewritten, hook mode needs nothing, and the init record is updated so `--undo` still restores everything.

## Requirements

- R1 Additive import: importing a source adds it or replaces only that source's skills, leaves every other source's skills byte for byte unchanged, reports id conflicts across sources as import does today, and leaves the store unchanged when the import fails; `--replace` replaces the whole store; `tap init claude` adds to the store in the same way instead of replacing it.
- R2 GitHub with and without a ref: a GitHub reference without a ref imports the latest commit of the default branch and records the resolved commit; one with a branch or tag is floating and one with a commit hash is pinned; the pinned or floating status and the commit are shown by `tap list`, also for stores written before this slice, without any migration.
- R3 List and search: `tap list` shows every source with its location, kind, ref, commit, status and skills; `tap list <query>` keeps only skills whose name, id or source location contains the query (case-insensitive), so that searching a namespace such as `cloudflare` or `cloudflare/skills` returns that source's skills and searching a skill name returns that skill; no match prints a message and exits 0; `--json` prints the same data as JSON.
- R4 Update all: `tap update` refreshes every floating GitHub source and every local source, replaces the skills that changed, adds skills that appeared upstream, flags skills that disappeared (removing them only with `--prune`), skips pinned sources and says so, and `--force` also re-reads pinned sources at their commit.
- R5 Update one or many: `tap update <name>...` accepts any number of skill ids and source locations; a skill name refreshes only that skill and leaves its source's other skills untouched, a source name refreshes that source's skills; an ambiguous name exits 2 and lists the candidates with their refs, `--from <source>` resolves it by limiting the lookup to one source (an exact location with or without `@ref` wins over a part of one); an unknown name exits 1 and changes nothing.
- R6 Remove: `tap remove <name>...` removes the whole source that provides each named skill or location and leaves other sources untouched; unknown or ambiguous names behave as in R5.
- R7 Check and report: `tap update --check` performs the reads, prints the report and writes nothing (the store file is byte-identical); the report names, per source, skills added and removed, modules added, removed and changed by content hash with their titles, and for GitHub the old and new commit; an unchanged source is reported as up to date.
- R8 Claude Code wiring: when an init record exists, a refresh hides newly imported project skills and rewrites the pull-mode note, a removal restores the removed source's hidden skills and drops them from the record, the hook entry is left alone, and a later `tap init claude --undo` restores every skill it hid; without a record nothing outside the store is touched.
- R9 Failure isolation and atomicity: a source that cannot be refreshed (network error, missing directory, unknown ref) keeps its previous skills and is reported, the other sources still refresh, the store is written once and atomically, and the exit code is 1 when any source failed.
- R10 Boundary: merging catalogs, deriving sources, classifying pinned or floating, matching queries and names, and computing the change report are pure functions in `@skilltap/import`; only `apps/cli` reads files, fetches, writes the store and touches Claude Code files; `npm run check` passes.
- R11 No duplicate imports: importing a GitHub reference that resolves to a repository, subpath and commit already in the store, under any ref, downloads nothing, changes nothing and names the existing source; importing a local file or directory whose skills are identical to those stored reports it as unchanged and writes nothing; when only some of the given sources are duplicates the others are imported and the duplicates are named; `--force` imports anyway; exit 0 in all these cases.

## Examples (single happy path and single failure, not a test plan)

- Happy path: a project imported `cloudflare/skills@main` and `./team-skills`; `tap update --check` reports that the Cloudflare source moved from `c430dd9` to a newer commit with two modules changed in `wrangler`, and `team-skills` is up to date; `tap update` applies it, the pull-mode note is rewritten, and nothing else changes.
- Failure: the network is down; `tap update` refreshes `./team-skills`, reports that `cloudflare/skills@main` could not be refreshed and kept as it was, and exits 1.

## Risks and open questions

- Updating a floating source changes instructions the agent will follow, from a third party, silently if done carelessly. Updates are explicit, `--check` shows the module-level diff first, and a pinned commit is the way to freeze a source. The README must say this.
- Module ids such as `m3` are positions in a file and shift when a file changes; a ref printed before an update may point at different text afterwards. Refs are for the current turn only; anything that must survive an edit should key on the module hash (the loaded ledger, a later slice, does).
- A local source that moved or was deleted fails its refresh, keeps the old copy, and is reported; there is no way here to re-point a source (remove it and import the new location).
- Rate limits: updating many GitHub sources without a token can hit them; the error already says to set `GITHUB_TOKEN`.
- Sources are derived from provenance; two imports of the same location with different refs are two sources, because the ref is part of the key.

## Size and safety

About 400 lines of code plus tests. It reads the sources the user named earlier and the project's Claude Code files only when an init record exists; it writes only the store and, in that case, the files `tap init claude` already manages. It never runs automatically.
