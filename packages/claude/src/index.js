// Pure transforms for wiring a Claude Code project: the hook entry in a settings object and the hide line in skill front matter.
export const HOOK_TIMEOUT_SECONDS = 30;
export const HIDE_KEY = 'disable-model-invocation';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const hookCommand = nibPath => `node "${nibPath}" hook claude`;
// The form for a committed settings file: no machine path, resolved through the PATH of whoever runs it.
export const portableHookCommand = 'nib hook claude';
// SkillNib's own entry is recognised by the end of its command, in either form, whatever the path to nib.js is.
const isSkillNibCommand = c => typeof c === 'string' && /^(?:node\s+"[^"]*"|nib)\s+hook claude\s*$/.test(c);

export function addHookEntry(settings, command) {
  const base = settings === undefined ? {} : settings;
  if (!isObject(base)) throw new TypeError('settings must be a JSON object');
  const next = structuredClone(base);
  if (next.hooks !== undefined && !isObject(next.hooks)) throw new TypeError('settings.hooks must be an object');
  next.hooks ??= {};
  if (next.hooks.UserPromptSubmit !== undefined && !Array.isArray(next.hooks.UserPromptSubmit)) throw new TypeError('settings.hooks.UserPromptSubmit must be an array');
  const groups = (next.hooks.UserPromptSubmit ??= []);
  let found = false, changed = false;
  for (const g of groups) for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
    if (h?.type === 'command' && isSkillNibCommand(h.command)) {
      if (found) continue;
      found = true;
      if (h.command !== command || h.timeout !== HOOK_TIMEOUT_SECONDS) { h.command = command; h.timeout = HOOK_TIMEOUT_SECONDS; changed = true; }
    }
  }
  if (!found) { groups.push({ hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] }); changed = true; }
  return { settings: next, changed };
}

export function removeHookEntry(settings) {
  if (!isObject(settings)) throw new TypeError('settings must be a JSON object');
  const next = structuredClone(settings);
  const groups = next.hooks?.UserPromptSubmit;
  if (!Array.isArray(groups)) return { settings: next, removed: false };
  let removed = false;
  for (const g of groups) if (Array.isArray(g?.hooks)) { const kept = g.hooks.filter(h => !(h?.type === 'command' && isSkillNibCommand(h.command))); if (kept.length !== g.hooks.length) { removed = true; g.hooks = kept; } }
  if (removed) {
    next.hooks.UserPromptSubmit = groups.filter(g => !(Array.isArray(g?.hooks) && g.hooks.length === 0));
    if (next.hooks.UserPromptSubmit.length === 0) delete next.hooks.UserPromptSubmit;
    if (Object.keys(next.hooks).length === 0) delete next.hooks;
  }
  return { settings: next, removed };
}

const frontMatterEnd = lines => { if (lines[0]?.replace(/\r$/, '') !== '---') return -1; for (let i = 1; i < lines.length; i++) if (lines[i].replace(/\r$/, '') === '---') return i; return -1; };

// Returns { text, change } where change is { kind: 'added' | 'changed' | 'none' | 'no-front-matter', originalLine? }.
export function hideSkill(markdown) {
  const lines = markdown.split('\n'), end = frontMatterEnd(lines);
  if (end < 0) return { text: markdown, change: { kind: 'no-front-matter' } };
  const eol = lines[0].endsWith('\r') ? '\r' : '';
  for (let i = 1; i < end; i++) {
    const m = new RegExp(`^${HIDE_KEY}:\\s*(.*?)\\s*$`).exec(lines[i].replace(/\r$/, ''));
    if (!m) continue;
    if (m[1] === 'true') return { text: markdown, change: { kind: 'none' } };
    const original = lines[i];
    lines[i] = `${HIDE_KEY}: true${eol}`;
    return { text: lines.join('\n'), change: { kind: 'changed', originalLine: original, index: i } };
  }
  lines.splice(1, 0, `${HIDE_KEY}: true${eol}`);
  return { text: lines.join('\n'), change: { kind: 'added', index: 1 } };
}

// Reverses hideSkill; null when the file no longer looks like what hideSkill produced.
export function unhideSkill(markdown, change) {
  if (change.kind !== 'added' && change.kind !== 'changed') return markdown;
  const lines = markdown.split('\n'), end = frontMatterEnd(lines);
  if (end < 0 || lines[change.index]?.replace(/\r$/, '') !== `${HIDE_KEY}: true` || change.index >= end) return null;
  if (change.kind === 'added') lines.splice(change.index, 1); else lines[change.index] = change.originalLine;
  return lines.join('\n');
}

export const sha256 = async text => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');

// Value of a single front matter key (plain, quoted, or a folded/literal block), or null.
export function frontMatterField(markdown, key) {
  const lines = markdown.split('\n'), end = frontMatterEnd(lines);
  if (end < 0) return null;
  const re = new RegExp(`^${key}:\\s*(.*)$`);
  for (let i = 1; i < end; i++) {
    const m = re.exec(lines[i].replace(/\r$/, ''));
    if (!m) continue;
    let v = m[1].trim();
    if (/^[>|][+-]?$/.test(v)) { const parts = []; for (let j = i + 1; j < end && /^\s+\S/.test(lines[j]); j++) parts.push(lines[j].trim()); v = parts.join(' '); }
    else if (/^(['"])(.*)\1$/.test(v)) v = v.slice(1, -1);
    return v.replace(/\s+/g, ' ').trim() || null;
  }
  return null;
}

export const RULES_PATH = ['.claude', 'rules', 'nib.md'];
export const RULES_MAX_CHARS = 3000;
export const DESCRIPTION_MAX = 160;
export const RULES_HEADER = '<!-- Generated by `nib init claude --mode ask`. Remove with: nib init claude --undo -->';

// The always-loaded note for pull mode. `skills` is [{ name, description? }]; the result is at most maxChars long.
export function renderRulesFile({ command, skills, maxChars = RULES_MAX_CHARS }) {
  const head = [
    RULES_HEADER, '# Skills served by SkillNib', '',
    `These skills are served by SkillNib and are not loaded by Claude Code on its own. Before a task that one of them may cover, run \`${command} ask "<what you need to know>"\` with the Bash tool and follow the sections it returns. Fetch any listed section with \`${command} show <ref>\`. Do not answer such tasks from memory.`,
    '', 'Skills:', '',
  ].join('\n');
  const clip = d => (d.length > DESCRIPTION_MAX ? d.slice(0, DESCRIPTION_MAX - 3) + '...' : d);
  const lines = skills.map(s => `- ${s.name}${s.description ? ': ' + clip(s.description) : ''}`);
  const more = n => `- ... and ${n} more skill${n === 1 ? '' : 's'}; run \`${command} list\` to see them.`;
  const all = head + lines.join('\n') + '\n';
  if (all.length <= maxChars) return all;
  let kept = 0, body = '';
  while (kept < lines.length && (head + body + lines[kept] + '\n' + more(lines.length - kept - 1) + '\n').length <= maxChars) { body += lines[kept] + '\n'; kept++; }
  return head + body + more(lines.length - kept) + '\n';
}
