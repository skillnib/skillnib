# C3b results: cost over an 8-turn conversation

Design: `C3b-design.md`, committed before any data run. All 60 conversation runs completed: 10 scripts per catalog in each of native loading (N), auto mode (hook) and ask mode (pull), 480 turns, no turn errored or was relaunched. The first pass stopped at its 70 USD cap with 16 of 20 scripts complete (`C3b-interim.md`); the user then approved finishing the other 4 scripts (cap 20 USD for the new spend, 11.8 USD used). Total spend 80.9 USD in the saved runs, against the 63 USD estimate, because HyperFrames conversations cost more than the pilot suggested. Product commit and Claude Code build as in C3 (`C3-results.json`). Per-conversation records: `C3b-results.json`. The harness is private.

## Measured

Mean summed cost per conversation (USD), mean needle score of the three ask turns:

| | Native | Auto | Ask |
| --- | --- | --- | --- |
| Cloudflare (10): cost / ask score | 1.635 / 66.7 | 1.259 / 70.8 | 1.392 / 75.0 |
| HyperFrames (10): cost / ask score | 1.584 / 40.0 | 1.130 / 62.5 | 1.088 / 62.5 |
| Pooled (20): cost / ask score | 1.610 / 53.3 | 1.194 / 66.7 | 1.240 / 68.8 |

Against native, paired bootstrap over scripts (4000 resamples, seed 20261101), 95% intervals:

| | Auto: cost reduction | Auto: ask score | Ask: cost reduction | Ask: ask score |
| --- | --- | --- | --- | --- |
| Cloudflare | 23.0% (6.7 to 36.4) | +4.2 (-5.0 to +14.2) | 14.8% (-1.0 to 28.4) | +8.3 (-1.7 to +19.2) |
| HyperFrames | 28.7% (15.3 to 39.8) | +22.5 (+11.7 to +32.5) | 31.3% (14.3 to 42.0) | +22.5 (+12.5 to +32.5) |
| Pooled | 25.8% (16.0 to 35.2) | +13.3 (+5.4 to +21.7) | 22.9% (10.9 to 33.1) | +15.4 (+7.5 to +23.3) |

Auto against ask, pooled: cost 3.7% lower for auto (-11.5 to +17.6) and ask-turn score -2.1 (-6.7 to +2.1): no difference shown. The cost of the five follow-up turns alone fell by about the same fraction as the whole conversation (auto 24.0%, 14.1 to 33.4). The context size at the last turn was not shown to differ from native in either mode (intervals include 0).

## Decision rule (from the design)

Auto mode's cost reduction has a lower bound above 0 on both catalogs (6.7% and 15.3%) and the ask-turn score difference has a lower bound of at least -10 on both (-5.0 and +11.7). **The rule is met: the README may state that auto mode also cost less over an 8-turn conversation, with these numbers and the limits below.** It does not make ask mode the default and does not change the C3 default-mode verdict (auto).

## Limits

Scripted conversations with generic follow-ups that do not react to the answers; 8 turns; two catalogs; one model and one Claude Code build; native loading skipped skills in a fifth to a third of its runs (C3), so the comparison is against Claude Code's actual behaviour, not an always-correct loader; dollar cost depends on prompt-cache behaviour and timing; the ask-turn score is pattern matching on facts; the C3 verdict that sets the default was amended after its data was seen. Cost per conversation was about 1.2 to 1.6 USD in every arm, so the absolute saving is a few tenths of a dollar per 8-turn conversation.
