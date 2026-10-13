Spec: docs/specs/<spec-id>.md

<!-- One spec = one PR. The Gates workflow reads the Spec line above; docs-only PRs (spec drafts) may omit it. -->

## What this delivers
<!-- Requirements covered, in the spec's own words. The workflow adds the requirement-to-test table to the job summary. -->

## Gate checklist
- [ ] The user approved the spec intent (Status: APPROVED) before this build
- [ ] `docs/specs/<spec-id>.speclink.json` was recorded at approval and is unchanged by this PR
- [ ] Every requirement shows VERIFIED in the SpecLink summary
- [ ] Nothing outside the spec's Scope changed, and AGENTS.md is untouched unless the user asked
- [ ] Review done against the spec, not only the diff
- [ ] Evaluate/compare evidence is linked or "none needed" is justified
