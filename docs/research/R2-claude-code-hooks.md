# R2: what a Claude Code hook can inject, and its limits

Status: DECISION RECORD from documentation plus two offline measurements. No model was run, so nothing here says the agent follows injected sections as well as native skills. Written 2026-10-12. Question from `docs/roadmap.md` and the framework skill: how can `tap` deliver sections to Claude Code, and what limits shape slice 5?

## Sources

- https://code.claude.com/docs/en/hooks (read 2026-10-12; about 200,000 of 268,000 characters read; the SessionStart input/output section and the last 68,000 characters were not read).
- https://code.claude.com/docs/en/skills (read; the last 7,000 characters were not read).
- Docs change; re-read before building on any detail below.

## What the docs say (hooks)

- `UserPromptSubmit` runs before Claude processes a prompt. A command hook gets JSON on stdin with `prompt` (the user's text), `session_id`, `transcript_path` (written asynchronously, may lag), `cwd`, `permission_mode`. It also fires for scheduled tasks and `/loop` iterations, a background subagent reporting back, and messages from another session, so not every firing is a person typing.
- It cannot rewrite the prompt. It can add context: plain stdout (exit 0) or `hookSpecificOutput.additionalContext`, wrapped as a system reminder that Claude sees but the chat does not show. The docs advise writing it as factual statements, not imperative system-style instructions, because those can trigger prompt-injection defences.
- Cap: `additionalContext` and plain stdout are each limited to 10,000 characters. Above that, Claude Code saves the output to a file and gives Claude the path plus a 2,000-character preview; Claude is not asked to read the file.
- Timeout: 30 seconds default for `UserPromptSubmit`. A timed-out hook has its output discarded and the prompt proceeds. Exit 2 blocks the prompt (never use it for `tap`); any other non-zero exit is non-blocking and the prompt proceeds. So a crash or timeout already fails open.
- Configuration: `settings.json` at user, project or local level, or a plugin `hooks/hooks.json`; command hooks may use `${CLAUDE_PROJECT_DIR}`. Injected context stays in the conversation on later turns, so repeated injection accumulates.
- Other events (`PreToolUse`, `PostToolUse`, `SessionStart`) can also add context under the same 10,000-character cap; they do not see the user's ask the way `UserPromptSubmit` does.

## What the docs say (skills)

- At session start only each skill's name and description are in context (combined `description` and `when_to_use` cut at 1,536 characters in the listing). The body loads when the skill is invoked and stays for the rest of the conversation.
- `disable-model-invocation: true` removes the skill's description from context entirely. A skill body can run shell commands before it is sent (`` !`command` ``), so a skill can embed `tap` output when it is invoked, but it still has to be invoked by the model or the user.

## Measurement 1: does top-4 fit under the cap? (offline, no model)

Method: the product's own retriever and delivery code (slices 1 to 4) on the two pinned catalogs, the 89 C2 asks each, top 4 sections, character counts (JavaScript string length). Descriptive; not a decision rule.

| | Cloudflare (89 asks) | HyperFrames (89 asks) |
|---|---|---|
| Median / p90 / max characters of the 4 sections | 5,677 / 10,644 / 22,365 | 9,883 / 19,977 / 59,125 |
| Asks where the 4 sections alone exceed 10,000 | 10 | 40 |
| Asks where the full rendered output (header, framing, outline) exceeds 10,000 | 33 | 82 |

So, as slice 4 renders, a hook would exceed the cap on 37% (Cloudflare) and 92% (HyperFrames) of asks and Claude would see only a 2,000-character preview. The outline is the main extra cost.

## Measurement 2: what a budget costs in coverage (offline, no model)

Needle coverage is the share of an ask's needles whose gold section is among the delivered sections (the metric of the C1 offline retrieval run), averaged over asks. Budget: 9,000 characters for sections plus framing (10,000 minus about 1,000 for header and outline). "Stop" keeps sections in rank order until one does not fit; "skip" skips a section that does not fit and tries the next. The policies were fixed before looking at the numbers and not tuned; this is still a descriptive look at already-seen asks, so it is post hoc.

| Needle coverage | top 4, no budget | top 2 | budget, stop | budget, skip |
|---|---|---|---|---|
| Cloudflare | 83.7 | 77.5 | 83.7 | 83.7 |
| HyperFrames | 78.8 | 71.5 | 75.7 | 76.9 |

The budget drops 22 and 91 of 356 sections (stop) and costs 0 and 1.9 to 3.1 points of coverage. It says nothing about task success, which C2 measured only for unconstrained top 4.

## What this means for slice 5

1. The hook mode needs a delivery budget under 10,000 characters, including header, framing and outline. Dropped sections must still be reachable (`tap show <ref>` through the Bash tool) and named in the outline. The outline has to be much shorter than slice 4's 40 lines.
2. The notice that `ask` prints on failure says "load the skills normally". That only makes sense if the native skills are still installed. If they stay installed, the agent will also load them whole and the savings disappear; if they are hidden (`disable-model-invocation: true`), "normally" means nothing. Fail-open in hook mode must therefore give the agent the source file paths so it can read the skill itself, which the store already knows (the import provenance). This is a design decision for the user (see below).
3. The hook sees the user's prompt, which is what C2 used as the ask, but it also fires on automatic turns; the hook should skip prompts that are not a person's request, using whatever the input offers, which needs checking against the unread part of the docs.
4. Context injected each turn persists. C2 measured one turn. Multi-turn cost (the framework's delta delivery and loaded ledger) is unmeasured.
5. Skills' own text is imperative ("always", "never"). Delivered through `additionalContext` it arrives as a system reminder, which the docs warn can trigger injection defences. Whether Claude follows verbatim skill instructions as well when delivered this way as when it loads the skill itself is the central unknown, and only a model run can answer it.

## Proposed next step (needs the user's approval and cost confirmation)

A small, pre-registered smoke test on Claude Code itself: for a few skills with instructions that are easy to check (a required output format, a forbidden action), compare compliance when the section arrives (a) through the native skill, (b) through a `UserPromptSubmit` hook within the cap, (c) through a Bash `tap ask` call. The protocol and its decision rule would be written and committed first. Until then slice 5 cannot claim the hook delivers the same outcome as native loading.

## Not covered

Other harnesses (Cursor, Codex, Gemini CLI, and so on) are not surveyed; this record is Claude Code only. Subagent turns, slash-command prompts and plugin-delivered hooks were not confirmed from the docs read.
