// Node-only readers (the only place in this package that may use node: modules).
import { readdir, lstat, readFile } from 'node:fs/promises';
import { resolve, join, relative, basename, sep } from 'node:path';

const posix = p => p.split(sep).join('/');
const strict = new TextDecoder('utf-8', { fatal: true });
const readText = async abs => strict.decode(await readFile(abs));

// A directory: every entry is listed (symbolic links are reported, never followed).
export function dirReader(dir) {
  const root = resolve(dir);
  const abs = p => join(root, ...p.split('/'));
  return {
    kind: 'dir', origin: root, rootName: basename(root),
    identity: p => abs(p),
    async list() {
      const out = [];
      const walk = async d => {
        for (const e of await readdir(d, { withFileTypes: true })) {
          if (e.name === '.git' || e.name === 'node_modules') continue;
          const p = join(d, e.name);
          if (e.isSymbolicLink()) out.push({ path: posix(relative(root, p)), size: 0, type: 'symlink' });
          else if (e.isDirectory()) await walk(p);
          else if (e.isFile()) out.push({ path: posix(relative(root, p)), size: (await lstat(p)).size, type: 'file' });
        }
      };
      await walk(root);
      return out;
    },
    read: p => readText(abs(p)),
  };
}

// One explicit file, imported as given whatever its name. Several files: filesReaders([...]).
export function fileReader(path) {
  const abs = resolve(path), name = basename(abs);
  return {
    kind: 'file', origin: abs, rootName: name.replace(/\.md$/i, ''), explicit: true,
    identity: () => abs,
    async list() { const s = await lstat(abs); return [{ path: name, size: s.size, type: s.isSymbolicLink() ? 'symlink' : s.isFile() ? 'file' : 'other' }]; },
    read: () => readText(abs),
  };
}
export const filesReaders = paths => paths.map(fileReader);
