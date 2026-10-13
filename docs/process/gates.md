# Gates: how a PR is checked against its spec

One spec = one PR. Each stage of the flow has a check that fails loudly.

| Stage | Gate | Enforced by |
|---|---|---|
| Slice | one single-purpose change; Scope declared in the spec | `lint` (Scope required), `verify` scope check |
| Spec | required sections, numbered requirements, Status | `npm run check` (`lint`) |
| Spec approval | the user flips `Status: APPROVED`, then `link --update` records requirement hashes | `link --update` refuses a DRAFT spec |
| SpecLink | each requirement has a test named `[<spec-id> Rn] ...`; spec edits after approval invalidate the link | `verify` (link drift, coverage) |
| Build | `npm run check`, `npm test`, requirement table all VERIFIED, diff inside Scope | CI workflow `Gates`, `verify` |
| Review | reviewer reads the SpecLink table against the spec, ticks the PR checklist | PR template, workflow rejects unticked boxes |
| Evaluate / Compare | evidence linked in the PR, or "none needed" with a reason | PR checklist (human) |

Commands (from the repo root):

    node tools/gates/speclink.mjs lint [spec.md ...]
    node tools/gates/speclink.mjs link docs/specs/<id>.md --update     # after the user approves intent
    node tools/gates/speclink.mjs verify docs/specs/<id>.md [--base origin/main]

Spec header lines: `Status: DRAFT|APPROVED`, `Spec-ID: <kebab-case>`, `Scope: <comma-separated globs>`.
Requirements: bullets `- R1 text` under `## Requirements`. Tests: `test('[<spec-id> R1] what it checks', ...)`, several ids as `[<spec-id> R1 R2]`.
Runtime-neutral packages set `"skillnib": {"runtimeNeutral": true}` in package.json.

Limits: the gates prove an approved, unchanged requirement has a passing, tagged test and that the diff stays in scope. They do not prove the test is good; that is the review stage. Required status checks are a repository setting.
