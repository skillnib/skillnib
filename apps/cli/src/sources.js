import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { githubReader, resolveGithub, isGithubReference, sourceAtCommit, sourceLabel } from '../../../packages/import/src/index.js';
import { dirReader, fileReader } from '../../../packages/import/node/index.js';

export async function toReader(source, io, { existing = null, force = false, notes = [] } = {}) {
  const abs = resolve(io.cwd, source);
  const st = await stat(abs).catch(() => null);
  if (st?.isDirectory()) return dirReader(abs);
  if (st?.isFile()) return fileReader(abs);
  if (isGithubReference(source)) {
    const options = { fetch: io.fetch, token: io.env ? (io.env.GITHUB_TOKEN ?? '') : undefined };
    const resolved = await resolveGithub(source, options);
    const have = existing && !force ? sourceAtCommit(existing, resolved) : null;
    if (have) { notes.push(`Already imported: ${source} is at commit ${resolved.sha.slice(0, 7)}, which the store already has as ${sourceLabel(have)}; nothing downloaded (use --force to import it again).`); return null; }
    return githubReader(source, { ...options, resolved });
  }
  throw new Error(`${source}: no such file or directory, and not a GitHub address (paste https://github.com/owner/repo or write owner/repo[/subpath][@ref])`);
}

