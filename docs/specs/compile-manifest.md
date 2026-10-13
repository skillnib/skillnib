# Spec: compile a skill file into a verbatim module manifest

Status: APPROVED by user 2026-10-12. Slice 1 of the open-source release. Framework: `packages/catalog/skills/skilltap-delivery-framework/SKILL.md` (compile invariants, segmentation). Research basis: the H2/H3 segmenter validated in C2 (on branch `v1`, `tools/research/c1/segment.mjs`).
Spec-ID: compile-manifest
Scope: packages/compile/**

## Purpose

Turn one skill markdown file into a manifest of addressable, hashed modules whose text is a verbatim slice of the source, so later slices can rank and deliver modules without ever altering instruction text.

## Non-goals

No retrieval or ranking, no CLI, no import from git or directories, no `useWhen`, descriptions, constraints or dependency links, no storage, no multi-file skill handling beyond compiling each file independently, no hook or harness work.

## Where it lives

A new dependency-free package `@skilltap/compile` (`packages/compile`). Runtime-neutral: pure functions on strings, no `node:` imports, no filesystem, hashing with Web Crypto, UTF-8 sizes via `TextEncoder`. Callers read files and pass text in. Tests use `node:test` as elsewhere. Nothing else imports it in this slice.

## Interface

- `compileSkill({ path, text }) -> Promise<Manifest>`
- `verifyManifest(manifest, text) -> Promise<{ ok: true } | { ok: false, problems: string[] }>`
- `moduleText(manifest, text, moduleId) -> string` (the verbatim slice)

Manifest (JSON-serialisable, no instruction text inside):
- `format` (number, 1), `source: { path, bytes, hash }`, `segmenter: { name, version, limit }`
- `modules[]`: `{ id, kind, title, parent?, start, end, bytes, hash, flags[] }`

`start` and `end` are UTF-16 code-unit offsets into `text`, so `text.slice(start, end)` is the module. `bytes` is the UTF-8 size. `hash` is the full lowercase SHA-256 hex of the module text. `id` is the module's index in file order (`m0`, `m1`, ...). Anything that must survive upstream edits is keyed by `hash`, not `id`.

## Segmentation rule (from the validated research rule, with the lossless gap closed)

1. Text before the first H2 (including front matter) is the `preamble` module. If the file has no H2, the whole file is one `preamble` module.
2. Each H2 section is a module (`h2`) running to the next H2.
3. An H2 section over 6144 UTF-8 bytes is split at its H3 headings: the text before the first H3 stays as an `h2-lead` module, each H3 section is an `h3` module with `parent` set to the H2 title.
4. Headings inside fenced code (``` or ~~~) never start a module. Fence closing follows the research rule (same marker character, at least as long).
5. A module still over the limit with no H3 to split at is kept whole and given the flag `oversize-unsplittable`. Never cut mid-section.
6. Whitespace-only fragments never become their own module and are never dropped: they join the preceding module (or the following one at the start of a file). The research segmenter dropped them, so its losslessness held only modulo whitespace; this spec requires exactness.

## Requirements

- R1 Lossless: for any file with non-whitespace content, the module spans are contiguous, start at 0, end at `text.length`, and concatenating the module texts equals the source exactly, including CRLF, a missing final newline, and non-ASCII text.
- R2 Deterministic: the same `path` and `text` always produce an identical manifest.
- R3 Hashes: each module hash and the source hash are SHA-256 of the exact text. Identical module text in two places gives the same hash.
- R4 Segmentation follows the rule above, including fences and the H3 split limit measured in UTF-8 bytes, not characters.
- R5 No module is empty, and no module is whitespace-only.
- R6 `verifyManifest` detects: a changed source, overlapping or gapped spans, a hash that does not match its slice, and a module over the limit that lacks the `oversize-unsplittable` flag.
- R7 Invalid input (non-string `text`, missing `path`) throws a `TypeError` with a clear message; an empty or whitespace-only file produces an empty `modules` list and a valid manifest (there is nothing to deliver, so R1 and R5 apply only to files with non-whitespace content).
- R8 The package has no dependencies and imports nothing outside the language runtime, and `npm run check` (package-boundary check) passes.

## Examples (single happy path and single failure, not a test plan)

- Happy path: a file with front matter and an intro, three H2 sections (one of them 7 KB with two H3s) compiles to `preamble`, `h2`, `h2-lead`, `h3`, `h3`, `h2`, `h2`; `verifyManifest` returns ok and joining the module texts gives the source.
- Failure: a 9 KB H2 section with no H3 compiles without error, is one module flagged `oversize-unsplittable`, and a hand-edited manifest whose module hash was changed fails `verifyManifest` with a hash mismatch.

## Risks and open questions

- Offsets are UTF-16 code units because the core is JavaScript. A non-JavaScript consumer would need a conversion; none exists yet, so this is a decision to revisit with the hosted service, not a blocker.
- The 6144-byte limit is the research value. Framework thresholds are placeholders until measured savings set them, so the limit is recorded in the manifest, not hard-wired into consumers.
- Setext headings (underlined) and headings inside blockquotes are not treated as headings; the validated catalogs use ATX headings. Flag this if a real catalog needs otherwise.
- Verification beyond fixtures: a non-CI script that compiles every file of the two pinned research catalogs and verifies them is wanted, but needs the catalogs checked out, so it is out of scope for CI.

## Size and safety

Roughly 150 lines of code and 250 of tests, one package, nothing imports it yet, so it is safe to merge on its own.
