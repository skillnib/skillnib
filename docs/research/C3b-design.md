# C3b design: cost over a conversation (fixes the details the C3 protocol left open)

Status: PRE-REGISTERED 2026-10-13, committed before any C3b data run. C3b is the stage defined in `C3-claude-code-end-to-end.md` ("C3b: cost over a conversation"); this note fixes the details that protocol left to the harness. The user approved the stage on 2026-10-13; the budget is confirmed separately after the pilot (a 3-conversation harness check, results discarded, cost 3.18 USD, which showed about 1.06 USD per 8-turn conversation, so about 63 USD for the 60 conversations). The cost cap will be recorded in the results.

## Scripts

- 10 conversations per catalog (20 in all), 8 turns each, identical across the three arms N, H and P, so 60 conversation runs and 480 turns.
- Turns 1, 4 and 7 are C2 asks. Turns 2, 3, 5, 6 and 8 are follow-ups.
- Asks: three distinct tasks per conversation drawn without replacement from the C2 tasks outside the validity subset (65 Cloudflare, 66 HyperFrames), with a seeded shuffle; conversation `k` (1 to 10) of catalog `c1a` uses seed `20261101 + k`, of `c1b` seed `20261101 + 1000 + k`. The three drawn asks are used as is, each followed by the C2 suffix `Put the finished text in your reply.` only on the ask turns.
- Follow-ups: five distinct prompts per conversation drawn with the same seed from `followupsC` in `docs/research/R6b-terse/terse.json` (30 prompts written before any measurement and never used for selection), in drawn order.

## Run mechanics

Each conversation runs in one fresh temporary project (the same setups as C3's N, H and P: native skills copied; auto mode via `tap init claude --mode auto`; ask mode via `--mode ask`; product installed from the packed tarball at the commit recorded in `C3-results.json`), empty `HOME`, same Claude Code flags as C3 except that sessions are persisted: turn 1 uses `--session-id <uuid>` and turns 2 to 8 use `--resume <uuid>`, one process per turn. A turn that errors or times out is relaunched once (resumed from the same session); a second failure scores 0 for an ask turn and is counted.

## Measures and analysis

Per turn: cost, input tokens (fresh, cache creation, cache read) and output tokens, turns, tool calls, and for ask turns the C2 needle score. Per conversation: summed cost, and the input tokens of the last turn as the size of the context at the end.

Primary: mean summed cost per conversation. Contrasts H minus N, P minus N and H minus P, each as a relative difference of mean cost, with a paired bootstrap over conversations (a conversation is the same script in each arm; 4000 resamples, seed 20261101), per catalog and with both catalogs pooled at the conversation level for the headline. Secondary: mean needle score of the 3 ask turns per conversation (same bootstrap), last-turn context size, and cost of the follow-up turns alone.

## Decision

C3b does not change the default-mode rule already applied (hook, now auto, is the default because it was the only eligible mode). It decides what the README may say about a conversation:

- If the lower bound of auto's cost reduction against N over the conversation is above 0 on both catalogs and the ask-turn score difference has a lower bound of at least -10, the README may add that auto mode also cost less over an 8-turn conversation, with the numbers.
- If auto cost more than N over a conversation on either catalog (interval above 0), the README states that, and the guide recommends ask mode for long sessions.
- Otherwise the README says the cost over a conversation was not shown to differ.

## Limits

Scripted conversations with generic follow-ups, 8 turns, two catalogs, one model, one Claude Code build; prompt caching makes dollar cost depend on timing between turns (turns run back to back); follow-ups do not react to the previous answer.
