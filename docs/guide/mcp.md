# SkillNib as an MCP server

Prerequisite: `npm install -g skillnib`, so that `nib` is on the `PATH` of the client that starts the server.

`nib mcp` runs SkillNib as a [Model Context Protocol](https://modelcontextprotocol.io) server on standard input and output, so any MCP client can search your skills and fetch a section without a shell command or a hook. It has two tools and it never writes anything.

| Tool | Input | Returns |
| --- | --- | --- |
| `search` | `query` (what you need to know, in the words of the task), optional `k` (1 to 12, default 4) | What `nib ask` prints: the best matching sections verbatim, an outline of the sections left out with their references, and a notice when nothing matched. |
| `get` | `ref`, a reference from a search outline | That one section, verbatim, as `nib show` prints it. |

The tool descriptions tell the agent that the returned text is third-party content from your catalog and untrusted. There is no tool that runs anything, imports a skill or changes your catalog: import and update stay in the CLI (`nib import`, `nib update`).

## Catalog

`nib mcp` finds the catalog the way every command does: `--store DIR`, then `$NIB_STORE`, then the nearest `.nib` above the directory the client starts it in. It reads the catalog on every call, so an import you make while it runs is visible at once. Import your skills first:

```sh
nib import ./skills
```

## Client configuration

The server command is `nib mcp`. Use `nib mcp --store /path/to/.nib` when the client does not start it inside your project.

**Claude Code**

```sh
claude mcp add skillnib -- nib mcp
```

Run it in the project, so the server starts in the project and finds `.nib`. With `--scope user` or `--scope project` the server may start elsewhere, so add `--store /absolute/path/to/project/.nib` (or set `NIB_STORE`). Check it with `claude mcp list` and by asking Claude to call the `search` tool; remove it with `claude mcp remove skillnib`.

**Claude Desktop** and **Cursor** take the same entry in their MCP settings file (`claude_desktop_config.json`, `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "skillnib": {
      "command": "nib",
      "args": ["mcp"]
    }
  }
}
```

Claude Desktop starts servers in a directory you do not control, so always give it an absolute store: `"args": ["mcp", "--store", "/absolute/path/to/project/.nib"]`. A relative path resolves against that unknown directory.

## What has been tested

The server's protocol handling, `search`, `get`, a missing catalog, read-only behaviour and offline use are covered by the repository's tests. It was also run once in a real Claude Code session (2026-10-13, `claude -p` with this server as the only MCP server, over the imported Cloudflare skills): Claude listed the tools, called `search` once and answered from the returned sections. `get` has only the repository's tests behind it, no other client (Cursor, Claude Desktop) has been tried, and no one has measured whether MCP costs less than auto or ask mode, so the guidance below is about fit, not cost.

## Duplicates

The MCP server does not hide any skill that your client already loads natively. If the same skills are installed in the client (for example in `.claude/skills`), they can load whole as well as through `search`; hide the native copies in the client yourself, or use `nib init claude`, which hides the project's copies.

## When to use it

- Your agent has no shell access, or you use a client other than Claude Code.
- You want the agent to ask for skill sections itself, as in ask mode, without a rules file.

Auto mode (the hook that adds sections to every prompt) is Claude Code only. The MCP tools are always available to the agent, which costs a small tool definition in clients that load tools eagerly; this has not been measured.
