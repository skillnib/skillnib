import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { UsageError } from './args.js';

// Compares x.y.z versions; a release is newer than a prerelease of the same x.y.z.
export function isNewer(latest, current) {
  const parse = v => { const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v); return m ? [+m[1], +m[2], +m[3], m[4] ?? ''] : null; };
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return !a[3] && !!b[3];
}

async function latestVersion(name, io) {
  let res;
  try { res = await (io.fetch ?? globalThis.fetch)(`https://registry.npmjs.org/${name}/latest`, { headers: { accept: 'application/json' } }); }
  catch (err) { throw new Error(`could not check the latest version (${err.message})`); }
  if (!res.ok) throw new Error(`could not check the latest version (the npm registry answered ${res.status})`);
  const v = (await res.json())?.version;
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+/.test(v)) throw new Error('could not check the latest version (unexpected answer from the npm registry)');
  return v;
}

// `nib upgrade [--check]`: explicit only. It is never run by the hook, ask or the MCP server.
export async function cmdUpgrade(args, io) {
  if (args.positionals.length) throw new UsageError('upgrade takes no arguments');
  const { name, version: current } = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  const latest = await latestVersion(name, io);
  if (!isNewer(latest, current)) { io.stdout.write(`nib ${current} is the latest version.\n`); return 0; }
  if (args.flags['--check']) { io.stdout.write(`nib ${current}; ${latest} is available. Run: nib upgrade\n`); return 0; }
  const cmd = ['npm', 'install', '-g', `${name}@${latest}`];
  io.stdout.write(`Upgrading nib ${current} to ${latest}: ${cmd.join(' ')}\n`);
  const r = (io.run ?? ((c, a) => spawnSync(c, a, { stdio: 'inherit' })))(cmd[0], cmd.slice(1));
  if (r.error || r.status !== 0) throw new Error(`${cmd.join(' ')} failed${r.error ? ` (${r.error.message})` : ` with exit code ${r.status}`}; run it yourself, or reinstall the way you installed nib`);
  io.stdout.write(`Upgraded nib to ${latest}.\n`);
  return 0;
}
