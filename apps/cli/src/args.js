export class UsageError extends Error {}

export const USAGE = `usage:
  nib import <source...> [--replace] [--force] [--no-embed] [--store DIR]   source: file, directory, a GitHub address (https://github.com/owner/repo[/tree/main/folder]) or owner/repo[/subpath][@ref]; adds to the store (--replace replaces it)
  nib update [<name>...] [--from SOURCE] [--check] [--force] [--prune] [--store DIR]   refresh skills or sources (a skill id or a source location)
  nib remove <name>... [--from SOURCE] [--store DIR]       remove the source that provides a skill or location
  nib ask "<ask>" [--k N] [--json] [--outline-lines N] [--no-embed] [--store DIR]   (--no-embed: BM25 only, ignoring embeddings)
  nib show <ref> [--store DIR]
  nib list [<query>] [--json] [--store DIR]  sources and skills; a query matches skill names and source locations
  nib init claude [<source>...] [--mode auto|ask] [--project DIR] [--shared] [--dry-run] [--undo]   wire a Claude Code project (auto: hook adds sections to every prompt; ask: the agent runs nib ask; hides native skills)
  nib ui [--port N] [--project DIR]        local web dashboard on 127.0.0.1 for the catalog, search, install and a start-up test (Ctrl+C stops it)
  nib doctor [--project DIR] [--json] [--store DIR]   check the catalog, search and the Claude Code hook (read-only; exit 1 when something is broken)
  nib upgrade [--check]                    install the latest nib from npm (--check only reports); the only command that updates nib itself
  nib embed on --url URL [--model NAME] | build | status | off [--delete]   optional, experimental: hybrid BM25 + embeddings from a server you run (OpenAI /v1/embeddings shape); off by default
  nib mcp [--store DIR]                    MCP server on stdin/stdout with two tools, search and get (for MCP clients)
  nib hook claude                          Claude Code UserPromptSubmit hook: reads the event JSON on stdin
store: --store DIR, else $NIB_STORE, else the nearest .nib above the working directory; import writes --store DIR or ./.nib (it ignores $NIB_STORE) and init claude always uses <project>/.nib and rejects --store
exit codes: 0 ok (ask and the hook also exit 0 when nothing matches or the store is unusable), 1 error, 2 usage (including an empty ask)`;

const VALUE_FLAGS = new Set(['--store', '--k', '--outline-lines', '--project', '--user-skills-dir', '--mode', '--from', '--port', '--url', '--model']);
const BOOL_FLAGS = new Set(['--json', '--shared', '--dry-run', '--undo', '--replace', '--check', '--force', '--prune', '--delete', '--no-embed']);

export function parseArgs(argv) {
  const out = { positionals: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.positionals.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { out.positionals.push(a); continue; }
    const [name, inline] = a.split(/=(.*)/s, 2);
    if (BOOL_FLAGS.has(name)) { if (inline !== undefined) throw new UsageError(`${name} takes no value`); out.flags[name] = true; }
    else if (VALUE_FLAGS.has(name)) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`${name} needs a value`);
      out.flags[name] = v;
    } else throw new UsageError(`unknown flag ${name}`);
  }
  return out;
}

export function intFlag(flags, name, def, min, max) {
  if (!(name in flags)) return def;
  const v = flags[name];
  if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) throw new UsageError(`${name} must be an integer from ${min} to ${max}`);
  return Number(v);
}
