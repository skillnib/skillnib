// Release checks: pack the repository, inspect the tarball, install it into a temporary directory and run it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MAX_TARBALL_BYTES = 300 * 1024;
const NO_NODE_TEST = env => { const e = { ...process.env, GITHUB_TOKEN: '', ...env }; delete e.NODE_TEST_CONTEXT; delete e.NIB_STORE; return e; };

const walk = (root, dir = '') => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(root, posix.join(dir, e.name)) : [posix.join(dir, e.name)]);

// The files the package is meant to contain, from the `files` list of the repository package.json.
export function expectedFiles(repo = REPO) {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')), out = new Set(['package.json']);
  for (const entry of pkg.files) { const p = join(repo, entry); if (!existsSync(p)) throw new Error(`files entry ${entry} does not exist`); if (statSync(p).isDirectory()) walk(repo, entry).forEach(f => out.add(f)); else out.add(entry); }
  return [...out].sort();
}

export function pack(repo = REPO, outDir = mkdtempSync(join(tmpdir(), 'skillnib-pack-'))) {
  const res = execFileSync('npm', ['pack', '--json', '--pack-destination', outDir], { cwd: repo, encoding: 'utf8', env: NO_NODE_TEST() });
  const [info] = JSON.parse(res.slice(res.indexOf('[')));
  return { tgz: join(outDir, info.filename), files: info.files.map(f => f.path).sort(), size: info.size, outDir };
}

export function packedPackageJson(tgz) {
  return JSON.parse(execFileSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' }));
}

const FORBIDDEN = [/(^|\/)tests?\//, /(^|\/)fixtures?\//, /(^|\/)scripts\//, /^docs\/(?!guide\/)/, /^tools\//, /^\.github\//, /(^|\/)\.nib(\/|$)/, /(^|\/)\.env/, /node_modules\//];
export function forbiddenFiles(files) { return files.filter(f => FORBIDDEN.some(re => re.test(f))); }

// Static check: every relative import in a shipped .js/.mjs file resolves to a shipped file.
export function importGraphProblems(files, read) {
  const shipped = new Set(files), problems = [];
  for (const f of files.filter(x => /\.m?js$/.test(x))) {
    const src = read(f);
    for (const m of src.matchAll(/(?:\bfrom|\bimport\s*\(|\bimport)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = posix.normalize(posix.join(posix.dirname(f), m[1]));
      if (!shipped.has(target)) problems.push(`${f} imports ${m[1]} which resolves to ${target}, not in the package`);
    }
  }
  return problems;
}

// Blocks any network use in the child process: connecting a socket throws.
const PRELOAD = join(dirname(fileURLToPath(import.meta.url)), 'no-network.cjs');
export const noNetworkEnv = () => NO_NODE_TEST({ NODE_OPTIONS: `--require ${PRELOAD}` });

export function install(tgz, prefix = mkdtempSync(join(tmpdir(), 'skillnib x y-'))) {
  mkdirSync(prefix, { recursive: true });
  writeFileSync(join(prefix, 'package.json'), '{"name":"smoke","private":true}');
  const r = spawnSync('npm', ['install', '--offline', '--no-audit', '--no-fund', '--prefix', prefix, tgz], { encoding: 'utf8', env: NO_NODE_TEST(), cwd: prefix });
  if (r.status !== 0) throw new Error(`npm install failed: ${r.stderr}`);
  return { prefix, nib: join(prefix, 'node_modules', '.bin', 'nib'), entry: join(prefix, 'node_modules', 'skillnib', 'apps', 'cli', 'bin', 'nib.js') };
}

export function run(cmd, args, opts = {}) { return spawnSync(cmd, args, { encoding: 'utf8', env: noNetworkEnv(), ...opts }); }

export function fixtureProject(repo = REPO) {
  const dir = mkdtempSync(join(tmpdir(), 'skillnib-proj-'));
  cpSync(join(repo, 'docs', 'research', 'R2b-smoke', 'skills'), join(dir, '.claude', 'skills'), { recursive: true });
  return dir;
}
export { relative };
