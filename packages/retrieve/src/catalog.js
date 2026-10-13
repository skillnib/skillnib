// Structural adapter for a slice-2 import catalog: { skills: [{ id, files: [{ path, text, manifest: { modules } }] }] }.
export function corpusFromCatalog(catalog) {
  if (!Array.isArray(catalog?.skills)) throw new TypeError('catalog must have a skills array');
  const out = [];
  for (const skill of catalog.skills) for (const file of skill.files) for (const m of file.manifest.modules)
    out.push({ id: `${skill.id}/${file.path}#${m.id}`, title: m.title, text: file.text.slice(m.start, m.end), hash: m.hash });
  return out;
}
