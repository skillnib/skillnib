export class UsageError extends Error {}

export const USAGE = `usage:
  nib import <source...> [--replace] [--force] [--store DIR]   source: file, directory or owner/repo[@ref][/subpath]; adds to the store (--replace replaces it)
  nib update [<name>...] [--from SOURCE] [--check] [--force] [--prune] [--store DIR]   refresh skills or sources (a skill id or a source location)
  nib remove <name>... [--from SOURCE] [--store DIR]       remove the source that provides a skill or location
  nib ask "<ask>" [--k N] [--json] [--outline-lines N] [--store DIR]
  nib show <ref> [--store DIR]
  nib list [<query>] [--json] [--store DIR]  sources and skills; a query matches skill names and source locations
  nib init claude [<source>...] [--mode auto|ask] [--project DIR] [--shared] [--dry-run] [--undo]   wire a Claude Code project (auto: hook adds sections to every prompt; ask: the agent runs nib ask; hides native skills)
  nib mcp [--store DIR]                    MCP server on stdin/stdout with two tools, search and get (for MCP clients)
  nib hook claude                          Claude Code UserPromptSubmit hook: reads the event JSON on stdin
store: --store DIR, else $NIB_STORE, else the nearest .nib above the working directory (import writes ./.nib)
exit codes: 0 ok (ask also fails open with 0), 1 error, 2 usage`;

const VALUE_FLAGS = new Set(['--store', '--k', '--outline-lines', '--project', '--user-skills-dir', '--mode', '--from']);
const BOOL_FLAGS = new Set(['--json', '--shared', '--dry-run', '--undo', '--replace', '--check', '--force', '--prune']);

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
