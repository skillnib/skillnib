# Project guidance

When interacting with Cloudflare, use the cf CLI unless the project has a Wrangler configuration file.

For new feature slicing, read `packages/catalog/skills/sdd-slice-wish/SKILL.md`. Scope one single-purpose, reviewable, verifiable, safe 1Spec = 1PR change. Slicing must not draft detailed specs or test cases.

For dashboard UI, navigation, themes, forms, and grids, read and follow `packages/catalog/skills/dashboard-design/SKILL.md`. Preserve its attribution and use real catalog, agent and evaluation APIs.

SDD flow: Slice → Spec → Prototype (UI work) → SpecLink → Build → Review → Evaluate → Compare. The assigned spec agent authors the draft; the user reviews intent. UI prototype direction is approved before build. SpecLink pairs requirements with tests and invalidates imported results when the specification changes.

Do not label launch profiles as connected agents, imported test results as trusted execution, or illustrative token metrics as measurements. Runtime work must use the shared catalog and delivery packages for both open-source and hosted releases. Keep evaluation tooling private; generated summaries require measured instruction-retention evidence.

Run `npm run check` and `npm test` for changes to the mockup or shared packages.

For work on skill import, compile, retrieval, delivery, measurement or learning, read `packages/catalog/skills/skilltap-delivery-framework/SKILL.md` first, and `docs/research/STATUS.md` for live research state.
