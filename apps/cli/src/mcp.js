import { createHandler, handleLine } from '../../../packages/mcp/src/index.js';
import { makeRetriever } from './embed.js';
import { catalogEntries, deliver, renderText, findEntry, DEFAULT_OUTLINE_LINES } from '../../../packages/deliver/src/index.js';
import { loadStore } from './store.js';
import { searchableSkills } from '../../../packages/import/src/index.js';
import { UsageError } from './args.js';

const FETCH_HINT = 'the get tool with ref=<ref>';

// `nib mcp`: an MCP server on standard input and output. Reads the catalog afresh on every call and never writes.
export async function cmdMcp(args, io, storeDir, deps = {}) {
  if (args.positionals.length) throw new UsageError('mcp takes no arguments (use --store DIR for another catalog)');
  if (!io.stdin) throw new UsageError('mcp reads JSON-RPC messages from standard input; run it from an MCP client');
  const { version } = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  const handle = createHandler({
    version,
    async search(query, k) {
      const catalog = searchableSkills(await loadStore(storeDir)), entries = catalogEntries(catalog);
      const retriever = await makeRetriever(catalog, storeDir, io, deps), hits = await retriever.search(query, { k });
      if (retriever.notice) io.stderr.write(`nib: ${retriever.notice}\n`);
      return renderText(deliver({ entries, identity: retriever.identity, hits, outlineLines: DEFAULT_OUTLINE_LINES }), { fetchCommand: FETCH_HINT });
    },
    async get(ref) { return findEntry(catalogEntries(searchableSkills(await loadStore(storeDir))), ref)?.text ?? null; },
  });

  // Newline-delimited JSON; replies are written in the order the messages arrived.
  let buf = '', chain = Promise.resolve();
  const reply = async line => { try { const r = await handleLine(handle, line); if (r) io.stdout.write(JSON.stringify(r) + '\n'); } catch (err) { io.stderr.write(`nib: ${err.message}\n`); } };
  for await (const chunk of io.stdin) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); chain = chain.then(() => reply(line)); }
  }
  if (buf.trim()) chain = chain.then(() => reply(buf));
  await chain;
  return 0;
}
