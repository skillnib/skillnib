# Spec: the `tap` CLI imports skills and delivers the sections an ask needs

Status: APPROVED by user 2026-10-12. Slice 4 of the open-source release; consumes slices 1 to 3. Framework: `packages/catalog/skills/skilltap-delivery-framework/SKILL.md` (delivery modes, fail-open, outline). Delivery format follows C2 arm B (`docs/research/C2-bm25-vs-native-large.md`).
Spec-ID: tap-cli
Scope: packages/deliver/**, apps/cli/**

## Purpose

Give a person or an agent one command-line tool that imports skills once and then answers "here is my ask" with only the matching verbatim sections of those skills, plus an outline of what was left out, and that never gets in the agent's way when something fails.

## Non-goals

No hook or Claude Code configuration (slice 5, after the R2 research on what a hook can inject), no multi-need asks or fusion of several rankings (unmeasured), no confidence threshold or score cutoff (a measured follow-up), no loaded ledger or delta delivery, no usage logging, no SQLite or other database, no embeddings, no hosted service, no include/exclude on import, no `lint`.

## Where it lives

- `packages/deliver` (`@skilltap/deliver`): the delivery logic as pure, dependency-free, runtime-neutral functions, so the hosted release reuses it. It takes a catalog and a retriever and returns a delivery: framed verbatim sections, an outline, and a fail-open notice when needed. It does no I/O.
- `apps/cli` (`@skilltap/cli`, command `tap`, run as `node apps/cli/bin/tap.js` until the repo links workspaces): the only place that touches the filesystem, process arguments, environment and standard streams. It wires slice 2 (import), the store below, slice 3 (retriever) and `@skilltap/deliver`.
- The store is a project-local directory, `.skilltap/` by default (`--store <dir>` overrides), holding the imported catalog as JSON: manifests, and the source texts keyed by content hash. It is a bounded, immutable-by-replacement asset, not a database.

## Commands

- `tap import <source...>`: each source is a file, a directory or a GitHub reference exactly as slice 2 accepts them. Prints a summary (skills, files, modules, oversize modules, skipped files, conflicts) and writes the store.
- `tap ask "<ask>" [--k N] [--json]`: delivers the top `N` (default 4) sections for the ask.
- `tap show <ref>`: prints one module's verbatim text, where `<ref>` is the id shown in an outline.
- `tap list`: prints the skills in the store with their files and module counts.

## Delivery format

For `ask`, standard output is, in order: a one-line header naming the retriever (name, version, short corpus hash) and the bytes delivered; each delivered section in rank order, framed as `===== <skill>/<file> :: <heading title> =====` followed by the exact module text (the C2 framing); then an outline of what was not delivered. The outline lists, for each skill that had a delivered section, its other modules as `<ref>  <title>  <bytes>`, followed by one line naming the other skills; `tap show <ref>` fetches any of them. The outline is capped at 40 lines (`--outline-lines` changes it) and says when it was cut. These caps are placeholders until measured.

## Requirements

- R1 Import: `tap import` accepts files, directories and GitHub references, singly or mixed, and writes the store; it prints a summary, reports skipped files and conflicts, exits 1 with a clear message when nothing was imported or an input cannot be resolved, and exits 0 otherwise.
- R2 Store: the store holds, per skill file, its manifest and source text keyed by content hash plus a format version; writes are atomic (a failed import leaves the previous store intact); a re-import replaces the store; a store over 64 MiB is refused; a missing, unreadable or wrong-version store gives a clear error from `import`, `show` and `list`.
- R3 Ask: `tap ask` loads the store, builds the BM25 retriever over its modules, and delivers at most `k` sections in rank order using the framing above, with the retriever identity and delivered bytes in the header.
- R4 Verbatim: the text of every delivered section equals the corresponding slice of the source file exactly (byte for byte, including line endings), and `tap show <ref>` prints the same text.
- R5 Outline: the outline lists the undelivered modules of the skills that had a delivered section, with ids, titles and byte sizes, names the other skills, is capped as above with a visible notice when cut, and never contains module text.
- R6 Fail-open: when `ask` finds no matching module, or the store is missing, unreadable or corrupt, or anything unexpected throws, it prints a marked notice saying no sections were selected and the skills should be loaded normally, adds the outline of all skills when the store is readable, writes the cause to standard error, and exits 0, so a caller never blocks the agent. `import`, `show` and `list` report real errors with a non-zero exit.
- R7 Output contract: standard output carries only the delivery (or notice); diagnostics go to standard error; `--json` prints one JSON object with `format`, the retriever identity, the hits (id, score, rank), the sections (with text), the outline and byte counts; exit codes are 0 (success or fail-open), 1 (error), 2 (usage); unknown commands and bad flags print usage and exit 2.
- R8 Boundary: `@skilltap/deliver` has no dependencies, imports nothing outside the language runtime and does no I/O; only `apps/cli` uses `node:` modules; `npm run check` passes.

## Examples (single happy path and single failure, not a test plan)

- Happy path: `tap import ./skills` then `tap ask "how do I bind a KV namespace in wrangler config"` prints four framed sections, then an outline such as `m3  ## Bindings  1204 B`, and `tap show cloudflare/refs/kv.md#m3` prints that module.
- Failure: `tap ask "..."` in a directory with no store prints the fail-open notice, explains on standard error that no store was found, and exits 0.

## Risks and open questions

- Outline and fail-open are design choices; C2 measured only top-4 delivery. Their effect on task success is unmeasured, so this slice makes no quality claim for them. A later measurement should compare delivery with and without the outline, and the fail-open default.
- The CLI only helps if the agent calls it. How a Claude Code session is made to do so (a hook, a skill that tells the agent to run `tap ask`, or both) is slice 5 and depends on the unresearched R2 question. Until then a person or an agent instruction has to call `tap`.
- The store keeps full source texts, so a store of a large catalog is multiple megabytes. The 64 MiB cap and JSON format are placeholders; the SQLite and hosted storage work will replace this behind the same shape.
- Whether `.skilltap/` is committed to git or ignored is the framework's open "versioned in git for project-local use" decision; the store is deterministic so either works.
- Asks are a single query string. The framework's several sub-queries per need (and how to fuse them) is deferred because fusion has not been measured.
- Returning four sections regardless of confidence matches C2. A relative-score cutoff is a measured follow-up.

## Size and safety

The CLI reads and writes only the store directory and the sources the user names; GitHub import uses the network as slice 2 specifies, with `GITHUB_TOKEN` never printed. Ask text and module text are data and are never executed or interpolated into shell commands. About 400 lines of code plus tests.
