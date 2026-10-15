# Roadmap

What is planned for SkillNib. There are no dates, and an item moves to "Done" only when it ships.

## Done (0.1.x)

- Import skills from files, directories and GitHub; update and remove them.
- Three ways in: automatic (Claude Code hook), ask (rules file) and MCP.
- `nib upgrade` to move to the latest version.
- Skills that share a name stay searchable.

## Next: an optional embedding retriever

BM25 stays the default, with no model and no extra download. An embedding retriever would be an opt-in extra that you turn on yourself:

- **What it is.** A hybrid of BM25 and embeddings. nib does not choose or ship a model: you run the embedding model you prefer behind a local OpenAI-compatible embedding server and point `nib` at it. Nothing is sent to a hosted service unless you configure one.
- **Why only optional.** The [offline test](results.md#embeddings-r5) did not show a gain on long asks and showed a possible gain on short, vague asks that was not statistically clear and was not present on both catalogs. Its cost is real: hundreds of megabytes of runtime and a model, and several minutes to build the index. Whether that is worth it depends on your skills and your questions, so you decide.
- **How it would ship.** Only with a new, pre-registered test on more catalogs and real questions, and with the results published on the [results page](results.md), including where it does not help. If the new test does not show a gain, it does not ship as a recommended option.
- **Fallback.** If the model or server is unavailable, search falls back to BM25 and says so.

## Later

- Automatic mode for agents other than Claude Code, where the agent supports a prompt hook.
- Windows support.
- More catalogs in the published results.
