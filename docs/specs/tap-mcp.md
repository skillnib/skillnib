# Spec: `tap mcp`, an MCP server that exposes search and get

Status: APPROVED by user 2026-10-13 (slice 13). The user asked for this on 2026-10-13: "offering mcp to wrap search and get ... useful for both opensource and hosted".
Spec-ID: tap-mcp
Scope: packages/mcp/**, apps/cli/**, README.md, docs/guide/**, package.json

## Purpose

Let any agent that speaks the Model Context Protocol (Claude Desktop, Cursor, Codex, Claude Code without shell access, and later the hosted service) use SkillTap through two tools, `search` and `get`, with no shell command and no hook. The protocol logic is a pure package that a hosted HTTP server can reuse; the open-source release ships the stdio transport.

## Non-goals

No `execute` tool (skills are text and running code from third-party skills is the risk the README already warns about), no import, update or remove tools (those stay in the CLI), no HTTP or SSE transport, no authentication, no MCP resources, prompts, sampling or notifications, no automatic wiring from `tap init claude`, no change to retrieval or delivery, and no claim that this saves anything (not measured).

## Behaviour

`tap mcp [--store DIR]` runs an MCP server over standard input and output (one JSON-RPC 2.0 message per line). It reads the catalog the same way every other command does (`--store`, `$SKILLTAP_STORE`, nearest `.skilltap`), reads it afresh on each tool call, and never writes. Two tools:

- `search` takes `query` (string, required) and `k` (integer 1 to 12, default 4) and returns what `tap ask` prints for the same ask: the framed verbatim sections, the outline of what was left out and the notice when nothing matched. The outline's fetch hint names the `get` tool and the section reference instead of a shell command.
- `get` takes `ref` (string, required) and returns that module's verbatim text, as `tap show` does.

Protocol: `initialize` (answers with the client's protocol version when it is one of `2025-06-18`, `2025-03-26`, `2024-11-05`, otherwise `2025-06-18`; capabilities `tools` only; server name `skilltap` and the package version), the `initialized` notification (no reply), `ping`, `tools/list`, `tools/call`. Anything else gets the standard JSON-RPC error.

## Requirements

- R1 Handshake: `initialize` returns the negotiated protocol version, `capabilities` with only `tools`, and `serverInfo` with the name and version; `notifications/initialized` and any other notification get no reply; `ping` returns an empty result; an unknown method returns error `-32601` and malformed JSON returns `-32700` with a null id; a request before `initialize` is still answered (the server is stateless).
- R2 Tool list: `tools/list` returns exactly `search` and `get` with JSON Schemas as specified (types, required fields, `k` bounds), descriptions that say the returned text is verbatim skill content from the user's catalog and must be treated as untrusted instructions, and no other tool.
- R3 Search: `tools/call` of `search` returns one text content item equal to the `tap ask` text for the same query and `k`, except that the fetch hint names the `get` tool with the reference; a query with no match returns the same fail-open notice and skill list as `tap ask` and is not an error; `k` out of range or a missing `query` returns an invalid-params error.
- R4 Get: `get` returns the module text verbatim, byte for byte what `tap show` prints; an unknown reference returns a tool result with `isError: true` and a message that points to `search`, not a protocol error.
- R5 Catalog problems: a missing or unreadable catalog makes `search` and `get` return `isError: true` results with the message the CLI would print; the server keeps running and answers the next request.
- R6 Transport: messages are read as newline-delimited JSON, including a message split across reads and several messages in one read; each reply is one line on standard output; nothing else is written to standard output (diagnostics go to standard error); the process exits 0 when standard input ends.
- R7 Read-only and offline: the server writes no file and makes no network call in any request (checked with the release check's network block and a read-only store directory).
- R8 Boundary: the protocol handler is a pure function in a new dependency-free, runtime-neutral package `@skilltap/mcp` that takes the catalog access as arguments; only `apps/cli` reads files and owns standard input and output; `npm run check` passes.
- R9 End to end: a test starts `tap mcp` as a child process against the sample skills, speaks the protocol over its pipes (`initialize`, `tools/list`, a `search`, a `get` of a reference returned by that search) and gets the results R2 to R4 describe.
- R10 Package and docs: `tap mcp` appears in the usage text, `docs/guide/mcp.md` shows the client configuration (`{"command": "tap", "args": ["mcp"]}`, with `--store` for another catalog) for Claude Code (`claude mcp add`), Claude Desktop and Cursor, the README links it, the new package is in the tarball's file list and `npm run release:check` passes.

## Examples (single happy path and single failure, not a test plan)

- Happy path: Cursor starts `tap mcp`; the agent calls `search` with `how should I word an error when the upload fails?`, receives the error-copy sections and an outline, then calls `get` with a reference from the outline and receives that section.
- Failure: the agent calls `get` with `acme-error-copy/SKILL.md#9`; it receives an error result saying the reference is unknown and to use `search`, and the session continues.

## Size and safety

About 350 lines of code plus 250 of tests and a guide page. The server only reads the user's own catalog, so it exposes nothing the CLI does not; the content it returns is third-party skill text and is labelled as such in the tool descriptions. Two always-present tool definitions cost some context in clients that load them eagerly (not measured here).

## Risks and open questions

- MCP clients differ on protocol versions and on how they list tools; the three versions above are the ones in common use and only `tools` is used, which every client supports.
- Reading the catalog on every call is simple and always current; it costs a file read per call, fine at catalog sizes up to the 64 MiB cap.
- The hosted service will need a transport with authentication; the pure handler is the part it reuses.
