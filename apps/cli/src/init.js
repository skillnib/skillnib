import { readFile, writeFile, mkdir, readdir, rm, stat, realpath } from 'node:fs/promises';
import { resolve, join, dirname, basename, sep, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { importSkills, mergeImport } from '../../../packages/import/src/index.js';
import { addHookEntry, removeHookEntry, hideSkill, unhideSkill, hookCommand, sha256, frontMatterField, renderRulesFile, RULES_PATH } from '../../../packages/claude/src/index.js';
import { UsageError } from './args.js';
import { saveStore, loadStore, StoreError } from './store.js';
import { toReader } from './sources.js';
import { importSummary } from './main.js';

const RECORD = 'init-claude.json';
const exists = async p => stat(p).then(() => true, () => false);
const readJsonObject = async file => {
  if (!(await exists(file))) return undefined;
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch (err) { throw new Error(`${file} is not valid JSON: ${err.message}`); }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file} must contain a JSON object`);
  return data;
};
const writeJson = async (file, data) => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data, null, 2) + '\n'); };
const readRecord = async file => (await exists(file)) ? JSON.parse(await readFile(file, 'utf8')) : null;

async function userVisible(catalog, io, args) {
  const dir = args.flags['--user-skills-dir'] ? resolve(io.cwd, args.flags['--user-skills-dir']) : join(io.env?.HOME ?? homedir(), '.claude', 'skills');
  const names = await readdir(dir).catch(() => []);
  const ids = new Set(catalog.skills.flatMap(s => [s.id, s.root.split('/').pop()]));
  return names.filter(n => ids.has(n)).sort();
}

// "nib" when the nib on the PATH is this installation, otherwise an absolute node command.
async function chooseCommand(io) {
  const nibPath = resolve(io.nibPath ?? 'nib'), real = await realpath(nibPath).catch(() => nibPath);
  for (const dir of (io.env?.PATH ?? '').split(delimiter).filter(Boolean)) if ((await realpath(join(dir, 'nib')).catch(() => null)) === real) return { command: 'nib', absolute: false };
  return { command: `node "${nibPath}"`, absolute: true };
}

async function removeHookFrom(file, createdByInit) {
  const settings = await readJsonObject(file);
  if (settings === undefined) return { file, removed: false };
  const { settings: next, removed } = removeHookEntry(settings);
  if (removed) { if (createdByInit && Object.keys(next).length === 0) await rm(file); else await writeJson(file, next); }
  return { file, removed };
}

// Which imported project skills (under .claude/skills) need the hide line, and which cannot take it.
async function planHide(catalog, skillsDir) {
  const hide = [], unhidable = [];
  for (const skill of catalog.skills) for (const f of skill.files) {
    const abs = f.provenance.kind === 'dir' ? join(f.provenance.origin, ...f.path.split('/')) : null;
    if (!abs || basename(abs) !== 'SKILL.md' || !abs.startsWith(skillsDir + sep)) continue;
    const before = await readFile(abs, 'utf8'), { text, change } = hideSkill(before);
    if (change.kind === 'no-front-matter') unhidable.push(abs); else if (change.kind !== 'none') hide.push({ path: abs, before, text, change });
  }
  return { hide, unhidable };
}

const noteSkills = catalog => catalog.skills.map(s => { const main = s.files.find(f => basename(f.path) === 'SKILL.md') ?? s.files[0]; return { name: s.name, description: frontMatterField(main.text, 'description') }; });

// After the store changed (update or remove): keep Claude Code wiring consistent with what init recorded.
export async function refreshWiring({ storeDir, catalog, removed = [], io }) {
  const recordFile = join(storeDir, RECORD), record = await readRecord(recordFile), notes = [];
  if (!record) return notes;
  const skillsDir = join(dirname(storeDir), '.claude', 'skills');
  const gonePaths = new Set(removed.flatMap(s => s.files.filter(f => f.provenance.kind === 'dir').map(f => join(f.provenance.origin, ...f.path.split('/')))));
  const hidden = [];
  for (const h of record.hidden ?? []) {
    if (!gonePaths.has(h.path)) { hidden.push(h); continue; }
    const cur = await readFile(h.path, 'utf8').catch(() => null);
    const restored = cur !== null && (await sha256(cur)) === h.after ? unhideSkill(cur, h.change) : null;
    if (restored !== null) { await writeFile(h.path, restored); notes.push(`Restored ${h.path} to Claude Code (its source was removed from SkillNib).`); } else { hidden.push(h); notes.push(`Could not restore ${h.path} (changed or gone); left as it is.`); }
  }
  const { hide } = await planHide(catalog, skillsDir);
  for (const h of hide) { await writeFile(h.path, h.text); hidden.push({ path: h.path, change: h.change, after: await sha256(h.text) }); notes.push(`Hid ${h.path} from Claude Code.`); }
  let rulesFile = record.rulesFile ?? null;
  if (record.mode === 'pull' && rulesFile) {
    const text = renderRulesFile({ command: record.command, skills: noteSkills(catalog) });
    if (await exists(rulesFile.path)) {
      const cur = await readFile(rulesFile.path, 'utf8');
      if ((await sha256(cur)) !== rulesFile.after) notes.push(`Left ${rulesFile.path} alone: it changed since init.`);
      else if (cur !== text) { await writeFile(rulesFile.path, text); rulesFile = { path: rulesFile.path, after: await sha256(text) }; notes.push(`Rewrote the skill note ${rulesFile.path}.`); }
    }
  }
  await writeFile(recordFile, JSON.stringify({ ...record, hidden, rulesFile }, null, 2) + '\n');
  return notes;
}

export async function cmdInit(args, io) {
  if (args.positionals[0] !== 'claude') throw new UsageError('init needs a target: nib init claude');
  // `auto`/`ask` are the names users see; `hook`/`pull` are aliases and the values the init record has always stored.
  const mode = { auto: 'hook', hook: 'hook', ask: 'pull', pull: 'pull' }[args.flags['--mode'] ?? 'auto'];
  if (!mode) throw new UsageError('--mode must be auto or ask (hook and pull are accepted as aliases)');
  const modeName = mode === 'hook' ? 'auto' : 'ask';
  const project = resolve(io.cwd, args.flags['--project'] ?? '.'), storeDir = join(project, '.nib'), recordFile = join(storeDir, RECORD);
  const shared = !!args.flags['--shared'], settingsFile = join(project, '.claude', shared ? 'settings.json' : 'settings.local.json'), rulesFile = join(project, ...RULES_PATH);
  if (args.flags['--undo']) return undo({ project, recordFile, settingsFile, io });

  const skillsDir = join(project, '.claude', 'skills');
  const sources = args.positionals.slice(1);
  if (!sources.length && !(await exists(skillsDir))) throw new UsageError('init claude needs a source, or a .claude/skills directory in the project');
  const readers = [];
  for (const s of sources) readers.push(await toReader(s, io));
  if (await exists(skillsDir) && !readers.some(r => r.origin === skillsDir)) readers.push(await toReader(skillsDir, io));

  // plan: read and validate everything before any write
  const incoming = await importSkills(readers);
  let existingStore = null;
  try { existingStore = await loadStore(storeDir); } catch (err) { if (!(err instanceof StoreError && err.code === 'missing')) throw err; }
  const catalog = existingStore ? mergeImport(existingStore, incoming) : incoming;
  const prev = await readRecord(recordFile), prevSettings = prev?.settingsFile ?? null, prevMode = prev?.mode ?? 'hook';
  const existing = await readJsonObject(settingsFile);
  const tap = mode === 'pull' ? await chooseCommand(io) : null;
  const command = mode === 'hook' ? hookCommand(resolve(io.nibPath ?? 'nib')) : null;
  let nextSettings = existing, settingsChanged = false;
  if (mode === 'hook') { const r = addHookEntry(existing, command); nextSettings = r.settings; settingsChanged = r.changed; }
  else if (existing !== undefined) { const r = removeHookEntry(existing); nextSettings = r.settings; settingsChanged = r.removed; }
  const migrateFrom = prevSettings && prevSettings !== settingsFile && prevMode === 'hook' && await exists(prevSettings) ? prevSettings : null;

  let rulesText = null;
  if (mode === 'pull') {
    rulesText = renderRulesFile({ command: tap.command, skills: noteSkills(catalog) });
    if (await exists(rulesFile)) { const cur = await readFile(rulesFile, 'utf8'); if (cur !== rulesText && (!prev?.rulesFile || (await sha256(cur)) !== prev.rulesFile.after)) throw new Error(`${rulesFile} exists and was not written by SkillNib; move it away or edit it by hand`); }
  }
  const dropRules = mode === 'hook' && prev?.rulesFile && await exists(prev.rulesFile.path);

  const { hide, unhidable } = await planHide(catalog, skillsDir);
  const plan = [`Plan for ${project} (mode ${modeName}):`, `  import ${catalog.skills.length} skill${catalog.skills.length === 1 ? '' : 's'} into ${storeDir}`,
    mode === 'hook' ? `  ${settingsChanged ? 'write' : 'keep'} the hook in ${settingsFile}: ${command}` : `  write the skill note ${rulesFile} (command: ${tap.command})${settingsChanged ? `, and remove the SkillNib hook from ${settingsFile}` : ''}`,
    ...(dropRules ? [`  remove the skill note ${prev.rulesFile.path} written by an earlier ask-mode init`] : []),
    ...(migrateFrom ? [`  remove the SkillNib hook from ${migrateFrom}`] : []),
    ...hide.map(h => `  hide ${h.path} (${h.change.kind === 'added' ? 'add' : 'change'} disable-model-invocation: true)`), ...unhidable.map(p => `  cannot hide ${p} (no front matter)`)];
  if (args.flags['--dry-run']) { io.stdout.write(plan.join('\n') + '\n(dry run: nothing was written)\n'); return 0; }

  await saveStore(storeDir, catalog);
  const notes = [];
  if (migrateFrom) await removeHookFrom(migrateFrom, prev.createdSettings);
  if (settingsChanged) {
    if (mode === 'hook') await writeJson(settingsFile, nextSettings);
    else if (existing !== undefined) { if (prev?.settingsFile === settingsFile && prev.createdSettings && Object.keys(nextSettings).length === 0) await rm(settingsFile); else await writeJson(settingsFile, nextSettings); }
  }
  let rulesRecord = null;
  if (mode === 'pull') { await mkdir(dirname(rulesFile), { recursive: true }); await writeFile(rulesFile, rulesText); rulesRecord = { path: rulesFile, after: await sha256(rulesText) }; }
  if (dropRules) {
    const cur = await readFile(prev.rulesFile.path, 'utf8');
    if ((await sha256(cur)) === prev.rulesFile.after) await rm(prev.rulesFile.path); else notes.push(`Left ${prev.rulesFile.path} in place: it changed since init.`);
  }
  const hidden = [];
  for (const h of hide) { await writeFile(h.path, h.text); hidden.push({ path: h.path, change: h.change, after: await sha256(h.text) }); }
  const kept = (prev?.hidden ?? []).filter(o => !hidden.some(n => n.path === o.path));
  const createdSettings = mode === 'hook' && existing === undefined && settingsChanged ? true : (prev?.settingsFile === settingsFile ? !!prev.createdSettings : false);
  await writeFile(recordFile, JSON.stringify({ format: 1, mode, settingsFile, createdSettings, command: command ?? tap.command, hidden: [...kept, ...hidden], rulesFile: rulesRecord }, null, 2) + '\n');

  const visible = await userVisible(catalog, io, args), out = [importSummary(incoming, storeDir).trimEnd(), `Mode: ${modeName}${mode === 'hook' ? ' (a hook adds the matching sections to every prompt)' : ' (the agent runs nib ask itself)'}`];
  if (mode === 'hook') out.push(`Hook: ${settingsChanged ? 'written to' : 'already in'} ${settingsFile}`);
  else {
    out.push(`Skill note: written to ${rulesFile} (the agent runs ${tap.command} ask when a task needs a skill)`);
    if (tap.absolute) out.push('The note holds a machine-specific path to nib.js; do not commit it. Install nib globally (npm package) for a portable note.');
    if (settingsChanged) out.push(`Removed the SkillNib hook from ${settingsFile}`);
  }
  out.push(hidden.length ? `Hidden from Claude Code (disable-model-invocation: true): ${hidden.map(h => h.path).join(', ')}` : 'No project skill needed hiding.');
  if (unhidable.length) out.push(`Not hidden (no front matter): ${unhidable.join(', ')}`);
  if (visible.length) out.push(`Still visible to Claude Code natively (user skills, not edited): ${visible.join(', ')}`);
  out.push(...notes, 'Plugin and enterprise skills cannot be checked from here; if they duplicate imported skills, hide them in Claude Code.', 'Start a new Claude Code session so the change is loaded. Undo with: nib init claude --undo');
  io.stdout.write(out.join('\n') + '\n');
  return 0;
}

async function undo({ project, recordFile, settingsFile, io }) {
  if (!(await exists(recordFile))) { io.stdout.write('Nothing to undo: no init record found in ' + project + '\n'); return 0; }
  const record = JSON.parse(await readFile(recordFile, 'utf8')), file = record.settingsFile ?? settingsFile, out = [], skipped = [];
  if (record.mode !== 'pull' || await exists(file)) {
    const r = await removeHookFrom(file, record.createdSettings);
    out.push(r.removed ? `Removed the SkillNib hook from ${file}` : `No SkillNib hook found in ${file}`);
  }
  if (record.rulesFile && await exists(record.rulesFile.path)) {
    const cur = await readFile(record.rulesFile.path, 'utf8');
    if ((await sha256(cur)) === record.rulesFile.after) { await rm(record.rulesFile.path); out.push(`Removed ${record.rulesFile.path}`); } else skipped.push(`${record.rulesFile.path} (changed since init; left alone)`);
  }
  for (const h of record.hidden ?? []) {
    const current = await readFile(h.path, 'utf8').catch(() => null);
    if (current === null) { skipped.push(`${h.path} (file is gone)`); continue; }
    if ((await sha256(current)) !== h.after) { skipped.push(`${h.path} (changed since init; left alone)`); continue; }
    const restored = unhideSkill(current, h.change);
    if (restored === null) { skipped.push(`${h.path} (does not look like what init wrote; left alone)`); continue; }
    await writeFile(h.path, restored); out.push(`Restored ${h.path}`);
  }
  if (skipped.length) out.push('Skipped:', ...skipped.map(s => '  ' + s), `The record ${recordFile} was kept so you can finish by hand.`);
  else await rm(recordFile);
  io.stdout.write(out.join('\n') + '\n');
  return 0;
}
