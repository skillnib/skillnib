# Results and limits

This page states what was measured about SkillNib, how, and what the measurements do not show. The figures below are the same ones the README quotes, copied word for word; a test fails if the two drift apart. Every result comes with its limits, and the limits matter as much as the result.

SkillNib is a retrieval tool, so everything here is about whether the sections it returns are enough for the agent to answer, and what that costs. None of it says that your skills, your model or your questions will behave the same way. Try it on your own skills before you rely on it.

## What was tested

Three tests, all on two public skill catalogs (Cloudflare skills and HyperFrames), all with fixed protocols written before the runs:

1. **C2, offline.** Does returning the top four BM25 sections keep the facts a question needs, compared with a simulated native loading?
2. **C3, end to end in Claude Code.** 89 questions on each catalog, run in real Claude Code with each way of delivering skills.
3. **C3b, conversations.** Eight-turn scripted conversations, to see whether the saving survives follow-up turns.

## Offline comparison (C2)

In a pre-registered offline comparison, returning the top four BM25 sections scored within noise of a simulated native loading on a fact-matching score, while sending about 70% fewer bytes. Limits: native loading was simulated rather than run in Claude Code, one model family, success scored by pattern matching on facts in the answer, bytes rather than tokens, and questions written by authors who had seen the answers. The records are kept privately and are not published here.

## End-to-end test (C3)

The end-to-end test in real Claude Code (C3: 89 questions on each of two public catalogs, Cloudflare skills and HyperFrames, one model, one Claude Code build) compared both modes with Claude Code's own skill loading. Auto mode scored higher than native loading (+8.5 points on Cloudflare, 95% interval +2.8 to +14.6; +16.1 on HyperFrames, +9.6 to +22.7) and cost less per run (33% less, 27 to 39; 48% less, 42 to 53). Ask mode also scored higher (+11.9 and +20.9) but was not shown to cost less on Cloudflare (6.7% less, interval -1.5 to 14.2; on HyperFrames 32% less, 25 to 39), so it is not the default. Limits: native loading skipped the skills altogether in a fifth to a third of its runs, so the comparison is against Claude Code's actual behaviour in this build and not against an agent that always loads the right skill; success is pattern matching on facts in the answer; the verdict was decided under a validity rule amended after the first result was seen; cost over a conversation is reported in the next paragraph (C3b). Records: kept privately, not published here.

## Conversations (C3b)

Over an 8-turn scripted conversation (three of the questions and five short follow-ups, 20 scripts, each run in every arm), auto mode also cost less than Claude Code's native loading: 25.8% less per conversation (95% interval 16.0 to 35.2; Cloudflare 23.0%, 6.7 to 36.4; HyperFrames 28.7%, 15.3 to 39.8), with the score on the three questions +13.3 points (+5.4 to +21.7). Ask mode cost 22.9% less (10.9 to 33.1). Auto and ask were not shown to differ in cost or in score. Limits: the conversations were scripted with generic follow-ups that do not react to the answers, eight turns, two catalogs, one model and one Claude Code build; the comparison is against Claude Code's actual native behaviour, which skipped skills in a fifth to a third of its runs; and a conversation cost about 1.2 to 1.6 dollars in every arm, so the saving is a few tenths of a dollar per conversation. Records: kept privately, not published here.

## How to read these

- A point is a percentage point of the fact-matching score. An interval is a 95% bootstrap interval over questions or conversations; one that includes zero means the difference was not shown.
- "Native loading" means what Claude Code did in the tested build when given the same skills. It skipped the skills altogether in a fifth to a third of its runs, so the comparison is with the actual behaviour, not with an agent that always loads the right skill.
- Scores are pattern matching on facts in the answer. They do not measure whether the code an agent wrote works.

## Where it does not help or is weak

- **Short and vague asks.** Retrieval is lexical (BM25). When an ask shares few words with the skill it needs, the right section may not come back; in an earlier offline test of the hook's delivery (R6b), coverage of the needed facts fell from 87 and 81 for the long asks to 46 and 31 for the shortest rewrites (Cloudflare, HyperFrames).
- **Few slots, one skill.** Four sections are returned. They can all come from one skill and none from a second skill the task also needs. `--k` raises the number.
- **Short skills.** A skill that is already small can cost more through `nib ask` than loading it whole, if some of the four slots go to sections of other skills.
- **Other models, agents and platforms.** Everything was measured with one model family and one Claude Code build. Auto mode exists only for Claude Code. Windows is untested.
- **Only two catalogs.** Both are public skill sets written in a similar style.

## Embeddings (R5)

Before this release we tested whether a small embedding model (`bge-small-en-v1.5`, quantized) earns a place next to BM25, with the decision rule fixed in advance. Offline, no model answers; needle coverage of the delivered sections, by set of asks. Dense is the embedding model alone; hybrid fuses BM25 and the embedding ranking. The bracket is the 95% bootstrap interval of the difference from BM25.

| Set | Catalog | BM25 | Dense | Hybrid | Hybrid minus BM25 | Dense minus BM25 |
|---|---|---|---|---|---|---|
| Long (89) | Cloudflare | 83.7 | 73.0 | 83.4 | -0.3 [-9.0, +7.9] | -10.7 [-20.5, -0.8] |
| Long (89) | HyperFrames | 77.2 | 62.7 | 76.0 | -1.1 [-7.3, +5.3] | -14.4 [-24.1, -5.2] |
| Short (30) | Cloudflare | 68.3 | 67.5 | 76.7 | +8.3 [-5.8, +22.5] | -0.8 [-15.8, +15.0] |
| Short (30) | HyperFrames | 53.3 | 25.8 | 46.7 | -6.7 [-24.2, +9.2] | -27.5 [-48.3, -5.0] |
| Ultra (30) | Cloudflare | 45.8 | 51.7 | 59.2 | +13.3 [-4.2, +30.8] | +5.8 [-17.5, +28.3] |
| Ultra (30) | HyperFrames | 30.8 | 25.8 | 30.0 | -0.8 [-12.5, +10.0] | -5.0 [-19.2, +10.0] |

Result against the rule: hybrid did not beat BM25 on the long asks (difference -0.3 and -1.1 points, intervals include zero), and the gains on short and ultra-short asks on Cloudflare (+8.3 and +13.3) have intervals that include zero and reverse on HyperFrames. Dense alone was clearly worse on the long asks. So BM25 stayed the default. The model needs hundreds of megabytes of runtime and a model download, and building the index took 101 s and 232 s on one laptop CPU for the two catalogs; a query took about 7 ms. See the [roadmap](plans.md) for the optional retriever this result points to.

Limits of this test: the asks are authored and lexically close to their answers, which favours BM25; the short rewrites were written by someone who knew the answers; the score is retrieval coverage, not task success; two catalogs.

## About the records

The protocols, per-question results and run logs are not published yet. This page states what was measured, how it was scored and the limits. If you need to check a number, ask in an issue at https://github.com/skillnib/skillnib/issues.
