# SkillNib as an MCP server

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

For a catalog elsewhere, use `"args": ["mcp", "--store", "/path/to/.nib"]`.

## When to use it

- Your agent has no shell access, or you use a client other than Claude Code.
- You want the agent to ask for skill sections itself, as in ask mode, without a rules file.

Auto mode (the hook that adds sections to every prompt) is Claude Code only. The MCP tools are always available to the agent, which costs a small tool definition in clients that load tools eagerly; this has not been measured.
