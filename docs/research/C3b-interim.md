# C3b interim: cost over an 8-turn conversation (stopped at the cost cap, not complete)

Design: `C3b-design.md` (committed before any data). Run 2026-10-13 and 2026-10-14. The run was stopped by its cost cap (70 USD) with 50 of the 60 conversation runs saved: all 10 Cloudflare scripts in all three arms, and 6 of 10 HyperFrames scripts in all three arms (a seventh has native and auto only). The design pairs the three arms on the same script, so this report uses only the **16 scripts** complete in all arms (10 Cloudflare, 6 HyperFrames). **It is interim and is not the pre-registered result**; the README is unchanged. Spend: 70.56 USD against the 63 USD estimate, because HyperFrames conversations cost more than the pilot (native 1.63 USD per conversation on average over the run, auto 1.26, ask 1.25). No turn errored or was relaunched. Per-conversation records: `C3b-interim.json`.

## Measured (16 complete scripts)

Mean summed cost per 8-turn conversation, in USD, and mean needle score of the three ask turns:

| | Native | Auto (hook) | Ask (pull) |
| --- | --- | --- | --- |
| Cloudflare (10): cost / ask score | 1.635 / 66.7 | 1.259 / 70.8 | 1.392 / 75.0 |
| HyperFrames (6): cost / ask score | 1.649 / 36.1 | 1.316 / 56.9 | 1.016 / 56.9 |
| Pooled (16): cost / ask score | 1.640 / 55.2 | 1.280 / 65.6 | 1.251 / 68.2 |

Against native, paired bootstrap over scripts (4000 resamples, seed 20261101), 95%:

| | Auto: cost reduction | Auto: ask score | Ask: cost reduction | Ask: ask score |
| --- | --- | --- | --- | --- |
| Cloudflare | 23.0% (6.7 to 36.4) | +4.2 (-5.0 to +14.2) | 14.8% (-1.0 to 28.4) | +8.3 (-1.7 to +19.2) |
| HyperFrames | 20.2% (3.2 to 35.4) | +20.8 (+6.9 to +31.9) | 38.4% (30.8 to 45.2) | +20.8 (+9.7 to +30.6) |
| Pooled | 21.9% (10.0 to 32.8) | +10.4 (+2.1 to +19.3) | 23.7% (11.2 to 33.7) | +13.0 (+5.2 to +20.8) |

Auto against ask, pooled: cost -2.3% (-18.5 to +10.1), ask score -2.6 (-7.8 to +1.6): no difference shown. On HyperFrames ask was cheaper than auto (auto 29.6% dearer, interval 8.0 to 52.3), on Cloudflare the two did not differ. The size of the context at the last turn did not differ from native in either mode (intervals include 0).

## What the design's decision rule gives on this subset

The rule (auto lower bound of cost reduction above 0 on both catalogs, ask-turn score lower bound at least -10) is met on these 16 scripts: Cloudflare lower bounds 6.7% and -5.0, HyperFrames 3.2% and +6.9. **Because the run is incomplete, the rule is not applied**; the README makes no conversation-level claim yet.

## Open

Finishing the run needs 10 more conversation runs (HyperFrames script 7 in ask mode, and scripts 8 to 10 in three arms), about 17 USD at the observed cost, so about 87 USD in total against the 63 USD estimate. The alternative is to accept 16 of 20 scripts as the final C3b with this deviation recorded. Either is the user's decision.
