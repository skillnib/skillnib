# Embeddings (optional, experimental)

BM25 stays the default and the fallback. This is an opt-in extra that blends BM25 with embeddings from a model you run yourself. Turn it on only if you want to try it: the offline test did not show a gain on long asks and showed an unclear one on short asks (see the [results](https://skillnib.github.io/skillnib/results)). Until a newer published test says otherwise this feature is **experimental**.

## What it does

With embeddings on and an index built, `nib ask`, the Claude Code hook and the MCP `search` tool rank sections by fusing two rankings (reciprocal rank fusion, k = 60): BM25, and cosine similarity between your ask and each section's embedding. Sections are still returned unchanged, with the same references. The delivered header names the retriever as `bm25+embed` only when embeddings were used.

The index updates itself: after `nib import`, `nib update` and `nib remove` nib embeds the sections that changed and prints one line about it (add `--no-embed` to skip that step). In `nib ui` it shows as its own task, "Updating the embedding index", with a chip in the header while it runs. If that step fails, the import still succeeds and nib uses BM25 until you run `nib embed build`.

If the server is down, slow, answers badly, or the index is out of date, nib uses BM25 and prints one line on stderr saying why. The hook never blocks a prompt: it waits at most 1.5 seconds for the server (10 seconds for `nib ask` and MCP).

## Setup

You need a server on your machine (or one you trust) that speaks the OpenAI `POST /v1/embeddings` shape: for example a llama.cpp `llama-server --embedding`, Ollama or LM Studio. nib has no default URL, ships no model and recommends none: you choose the embedding model and run it yourself. `--model` is optional; give it if your server needs a model name in the request, leave it out if the server uses the model it has loaded. For a server that needs a key, set `NIB_EMBED_KEY`; it is sent as an `Authorization: Bearer` header.

```sh
nib embed on --url http://127.0.0.1:PORT --model MODEL
nib embed build
nib embed status
nib embed off
```

`nib embed on` makes one test request and prints where text will go. Run `nib embed build` again after `nib import` or `nib update`. `nib embed off` returns to BM25 only (add `--delete` to remove `vectors.bin`). `--url` may be the server root or the full `.../v1/embeddings` address. The files live in the store: `embed.json` (endpoint and model) and `vectors.bin` (the vectors). `nib embed build` re-embeds only sections whose text changed.

## Compare the two side by side

`nib ui` has a **Compare retrievers** page. Type an ask and it runs `nib ask "<ask>" --json --no-embed` (BM25 only) and `nib ask "<ask>" --json` (with embeddings) through the CLI, then shows both answers next to each other, verbatim, with the exact commands and a mark on sections only one side returned. If the embeddings side fell back to BM25, the page says so and shows the reason. The same page sets embeddings up: it starts `nib embed on`, `build` and `off` for you. If your server needs a key, start the page with `NIB_EMBED_KEY` set in the environment.

`nib ask --no-embed` is also the way to get the BM25 answer from the terminal when embeddings are on.

## Privacy

Skill text (at `nib embed build`) and your asks (at every search) go to the URL you configured and nowhere else. If the host is not this machine, `nib embed on` warns that your skill text leaves it. With embeddings off, nothing in nib makes a network request except GitHub sources and `nib upgrade`.

## Cost

You pay it, and you decide. Index build time depends on your model and hardware; in the offline test with a small quantized model it took minutes for a catalog of a few hundred sections, and that model and its runtime were about half a gigabyte. The vector file is `sections x dimensions x 4` bytes, plus a small header. Each search with embeddings on adds one request to your server.

## Known limits

Embeddings can return something for any ask, including one no skill covers, so the hook may add sections where BM25 alone would add none. An index goes stale when the skills change; nib then uses BM25 until you run `nib embed build`. Sections over about 1,800 characters are embedded in windows and ranked by their best window; a model with a short context window may refuse the longest windows, and nib then splits them in halves and embeds both, so no text is left out of the index (the build report says how many were split).
