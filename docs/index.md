# SkillNib

SkillNib (`nib`) gives a coding agent only the sections of a skill that the task needs, verbatim, instead of the whole skill. It imports Markdown skills once, splits them at headings, and returns the best matching sections for an ask. It runs offline, has no dependencies and works with Claude Code (automatically, through a hook) and with any MCP client.

```sh
npm install -g skillnib
nib --version
```

## Read next

- [Claude Code guide](guide/claude-code.md): auto and ask mode, sharing the hook with a team, undo.
- [MCP guide](guide/mcp.md): use SkillNib from Cursor, Claude Desktop or another MCP client.
- [Importing skills](guide/importing.md): sources, updates, removal, skills that share a name.
- [Examples](guide/examples.md): real output of every command.
- [Results and limits](results.md): what was measured, how, and where it does not hold.
- [Roadmap](plans.md): what is planned, including the optional embedding retriever.
- [Source, README and changelog](https://github.com/skillnib/skillnib)
