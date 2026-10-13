// In-memory SourceReader: used for explicit file lists, tests, and as the result of reading a GitHub archive.
// Reader contract: { kind: 'file'|'dir'|'github', origin, rootName, explicit?, github?, list() -> [{path,size,type}], read(path) -> text, identity?(path) }
export function memoryReader({ kind = 'dir', origin = 'memory', rootName = 'root', explicit = false, github, files, entries }) {
  const list = entries ?? Object.entries(files).map(([path, text]) => ({ path, size: new TextEncoder().encode(text).length, type: 'file' }));
  return {
    kind, origin, rootName, explicit, ...(github ? { github } : {}),
    async list() { return list; },
    async read(path) {
      if (files && path in files) return files[path];
      throw new Error(`no such file in source: ${path}`);
    },
  };
}
