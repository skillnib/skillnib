---
name: sdd-slice-wish
description: Slice a high-level feature wish into a reviewable, verifiable, safe 1Spec = 1PR change. Use before sdd-init; do not draft specs, acceptance criteria, or test cases here.
---

# sdd-slice-wish (Slicing into 1Spec = 1PR)

## Core responsibilities

Break down the user's wish into a 1Spec = 1PR boundary and recommend the initial slice. Concrete specification writing, detailing acceptance criteria, Given/When/Then scenarios, comprehensive test viewpoints, and authoring docs/specs/* belong to sdd-init / sdd-test-cases and are strictly omitted here.

Output is limited to Slice Proposals (S/M/L), Recommended Slice, Prerequisites / Constraints / Risks / Open Questions, and Input for the Next Phase (key points for sdd-init).

## Definition of 1Spec = 1PR

A Spec/PR is a minimum contractual unit: a single-purpose, self-contained change of reviewable size. Re-slice when any mandatory criterion fails:

1. **Single purpose:** State the purpose in one sentence. A PR title containing "and" is fundamentally disqualified.
2. **Self-contained:** The PR alone reveals intent, blast radius, and verification methods. Avoid unused APIs or changes with no concrete usage; if necessary, give them a dedicated slice with an explicit justification.
3. **Reviewable:** Keep diffs small and focused. Never mix functional changes with large formatting, moves, or renames. Consider further slicing above 200–400 lines and explicitly justify exceeding that guideline. Aim to stay strictly under 1,500 lines.
4. **Verifiable:** Success must be expressible as tests or test procedures; detail these in the next phase.
5. **Safe to merge:** Merging must not break the system. Divide gradual migrations into small batches, using feature flags where appropriate.

## Inputs

Gather from conversation: purpose, background, pain points, expected outcome, deadlines, compatibility, performance, security, operations, existing interfaces, known uncertainties, and clues about affected modules, screens, APIs, or logs.

## Operating procedure

1. Summarize intent in 1–3 lines. Call out vague terms such as "appropriately", "nicely", or "cleanly" when they require clarification.
2. Gather enough project context to understand the current state.
3. Choose a slicing axis. Prioritize vertical slices that validate user value through the shortest path; avoid DB-only / HTTP-only / UI-only layering.
4. Propose Small, Medium, and Large slices. Every proposal includes a one-sentence goal, explicit non-goals, rough scope metrics (modules/interfaces), primary risks and verification hurdles, and intentionally open questions.
5. Select one default slice. Justify reviewability, safety, verifiability, and learning value from resolving uncertainty.
6. Pass only the selected goal, non-goals, constraints, risks, open questions, scope boundaries, one minimal happy-path example, and one primary failure example to sdd-init. Do not expand the examples into coverage or test designs.

## Stop conditions

Halt and ask for information if the purpose cannot be expressed in one sentence, success is too ambiguous for vertical slicing, critical compatibility/security/operational constraints are unknown, or too many open questions directly affect the recommended slice's viability.

## Typical slicing patterns

- **Preparation:** Test scaffolding, minimal refactoring, instrumentation, or dependency setup with minimal behavioral changes.
- **Feature:** A focused end-to-end delivery of minimal viable user value.
- **Hardening:** Edge cases, error handling, compatibility, or performance enhancements.

## Anti-patterns

Avoid all-in-one proposals, mixing features with large refactors, "while we're at it" additions, or drafting detailed specs and test cases during slicing.

## Required output format

### 1) Summary of Intent

1–3 lines.

### 2) Constraints & Assumptions (Knowns)

- **Constraints:**
- **Assumptions:**

### 3) Slice Proposals (Small / Medium / Large)

#### Small:

- **Goal:**
- **Non-Goals:**
- **Estimated Scope of Change:**
- **Risks:**
- **Open Questions:**

#### Medium:

Same fields as Small.

#### Large:

Same fields as Small.

### 4) Recommended Slice (Default)

- **Recommendation:** Small / Medium / Large
- **Rationale:** Reviewability / Safety / Verifiability / Uncertainty Resolution

### 5) Input for the Next Phase (sdd-init)

- **Goal:**
- **Non-Goals:**
- **Prerequisites / Constraints:**
- **Risks:**
- **Open Questions:**
- **Minimal representative examples:** One happy path and one primary failure; no detailed scenarios.
- **Scope boundaries:** Areas to touch and areas not to touch.
