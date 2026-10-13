# Spec: gates that check each PR against its approved spec

Status: APPROVED by user 2026-10-12. Process tooling that every later slice depends on.
Spec-ID: spec-gates
Scope: package.json, tools/gates/**, .github/**, docs/process/**

## Purpose

Make "the PR delivers what the spec says" a mechanical check at every stage of the SDD flow, so a slice cannot merge on a green build alone: its spec must be approved, each requirement must be paired with a passing test, the specification must not have changed since approval, and the diff must stay inside the spec's scope.

## Non-goals

Judging whether a requirement is a good one or a test is a good test (that stays human review). Evaluate/Compare evidence for model behaviour (private evaluation tooling). Changing AGENTS.md. Setting GitHub branch protection (a repository setting the owner makes; see Risks).

## Requirements

- R1 Spec structure: a spec declares `Spec-ID`, `Status` (DRAFT or APPROVED), `Scope` globs, the sections Purpose, Non-goals, Requirements and Size and safety, and requirements numbered `R1..Rn` in order; `lint` and `npm run check` fail on any spec that does not.
- R2 Approval link: `link --update` records a hash of every requirement only for an APPROVED spec; afterwards any changed, added or removed requirement fails the gate until the link is re-recorded.
- R3 Requirement coverage: a test is paired with a requirement by `[<spec-id> Rn]` in its name; a requirement is VERIFIED only with at least one tagged test, all tagged tests passing and none skipped; a tag for an unknown requirement fails.
- R4 Scope: every file changed against the base must match the spec's Scope, the spec file, or its link file; anything else fails.
- R5 `verify` runs the gates in order and stops at the first failure: structure, APPROVED status, link drift, requirement coverage with passing tests, scope; it prints a requirement-to-test table and appends it to the CI job summary.
- R6 Package boundary: a package that sets `skilltap.runtimeNeutral` in its package.json fails `npm run check` if it declares dependencies or its `src/` imports a Node-only module.
- R7 CI: a pull request workflow runs `npm run check`, `npm test`, and, for any PR that changes more than `docs/`, requires a `Spec:` line in the PR body, no unticked checklist items, and a passing `verify`; a PR template carries the Spec line and the checklist.

## Examples (single happy path and single failure, not a test plan)

- Happy path: an approved spec with two requirements, a link file, two tagged passing tests and a diff inside Scope prints two VERIFIED rows and exits 0.
- Failure: the same PR after someone rewords R1 without re-approval fails with "R1 text changed since the link was approved" before any test runs.

## Risks and open questions

- Tag-by-name proves a test exists and passes, not that it tests the requirement; the review stage must read the table against the spec.
- The workflow only blocks merges if the owner marks the `Gates` check as required in branch protection; until then it is advisory.
- A docs-only PR skips the build gate, so a spec draft can merge without a Spec line; the spec lint still runs.
- The link hash covers requirement text only, not Purpose or Non-goals; changing those after approval is not detected.
- AGENTS.md is deliberately unchanged; a line pointing at `docs/process/gates.md` is proposed separately.

## Size and safety

About 300 lines of dependency-free Node scripts plus one workflow and one template. No secrets, no network, no repository writes; the workflow has read-only permissions.
