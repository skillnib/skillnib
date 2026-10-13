// Spec gate library: pure parsing and checks, no side effects. Used by speclink.mjs, check.mjs and the tests.
import { createHash } from 'node:crypto';

export const REQUIRED_SECTIONS = ['Purpose', 'Non-goals', 'Requirements', 'Size and safety'];
export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

// Header lines (before the first "## "): Status, Spec-ID, Scope. Requirements: "- R<n> text" bullets under "## Requirements".
export function parseSpec(text) {
  const lines = text.split(/\r?\n/);
  const firstH2 = lines.findIndex(l => l.startsWith('## '));
  const header = lines.slice(0, firstH2 < 0 ? lines.length : firstH2);
  const field = name => { const l = header.find(x => x.startsWith(name + ':')); return l ? l.slice(name.length + 1).trim() : null; };
  const status = field('Status');
  const sections = lines.filter(l => l.startsWith('## ')).map(l => l.slice(3).trim());
  const requirements = [];
  let inReq = false;
  for (const l of lines) {
    if (l.startsWith('## ')) { inReq = l.slice(3).trim() === 'Requirements'; continue; }
    const m = inReq && /^- (R\d+) (.+)$/.exec(l);
    if (m) requirements.push({ id: m[1], text: m[2] });
    else if (inReq && /^\s+\S/.test(l) && requirements.length) requirements.at(-1).text += ' ' + l.trim();
  }
  return {
    specId: field('Spec-ID'), scope: (field('Scope') || '').split(',').map(s => s.trim()).filter(Boolean),
    status: status && /^(DRAFT|APPROVED)\b/.exec(status)?.[1] || null, statusLine: status, sections, requirements,
  };
}

export function lintSpec(spec) {
  const p = [];
  if (!spec.specId) p.push('missing "Spec-ID:" header line');
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(spec.specId)) p.push(`Spec-ID "${spec.specId}" must be lowercase kebab-case`);
  if (!spec.status) p.push('"Status:" header must start with DRAFT or APPROVED');
  if (!spec.scope.length) p.push('missing "Scope:" header line (comma-separated path globs the PR may touch)');
  for (const s of REQUIRED_SECTIONS) if (!spec.sections.includes(s)) p.push(`missing section "## ${s}"`);
  if (!spec.requirements.length) p.push('no requirements found (bullets of the form "- R1 text" under "## Requirements")');
  spec.requirements.forEach((r, i) => { if (r.id !== 'R' + (i + 1)) p.push(`requirement ids must be R1..Rn in order; found ${r.id} at position ${i + 1}`); });
  return p;
}

export const requirementHashes = spec => Object.fromEntries(spec.requirements.map(r => [r.id, sha256(r.id + ' ' + r.text)]));

// Lock file: written on approval; any later change to a requirement invalidates the link until it is re-reviewed.
export function lockDrift(spec, lock) {
  const p = [], now = requirementHashes(spec);
  if (!lock) return ['no link file; run "link --update" once the spec is APPROVED'];
  if (lock.specId !== spec.specId) p.push(`link file is for "${lock.specId}", spec is "${spec.specId}"`);
  for (const id of Object.keys(now)) if (!(id in lock.requirements)) p.push(`${id} is new since the link was approved`);
  else if (lock.requirements[id] !== now[id]) p.push(`${id} text changed since the link was approved`);
  for (const id of Object.keys(lock.requirements)) if (!(id in now)) p.push(`${id} was removed since the link was approved`);
  return p;
}

// A test is linked to a requirement when its name contains "[<spec-id> R<n>]" (several tags allowed).
export function testTags(name, specId) {
  const re = new RegExp(`\\[${specId} (R\\d+(?:[ ,]+R\\d+)*)\\]`, 'g'), ids = [];
  for (const m of name.matchAll(re)) ids.push(...m[1].split(/[ ,]+/));
  return ids;
}

const unesc = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// node:test junit output -> [{name, status}] where status is pass | fail | skip
export function parseJunit(xml) {
  const out = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const name = /\bname="([^"]*)"/.exec(m[1]); if (!name) continue;
    const body = m[3] || '';
    out.push({ name: unesc(name[1]), status: /<failure\b|<error\b/.test(body) ? 'fail' : /<skipped\b/.test(body) ? 'skip' : 'pass' });
  }
  return out;
}

// Join requirements to test results. A requirement is verified only if it has >=1 tagged test, all tagged tests pass, and none skip.
export function verifyLinks(spec, results) {
  const known = new Set(spec.requirements.map(r => r.id)), rows = spec.requirements.map(r => ({ id: r.id, text: r.text, tests: [] })), problems = [];
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  for (const t of results) for (const id of testTags(t.name, spec.specId)) {
    if (!known.has(id)) problems.push(`test "${t.name}" tags unknown requirement ${id}`);
    else byId[id].tests.push(t);
  }
  for (const r of rows) {
    r.status = !r.tests.length ? 'UNCOVERED' : r.tests.some(t => t.status === 'fail') ? 'FAILING' : r.tests.some(t => t.status === 'skip') ? 'SKIPPED' : 'VERIFIED';
    if (r.status !== 'VERIFIED') problems.push(`${r.id} ${r.status}`);
  }
  return { rows, problems };
}

export function report(spec, rows) {
  const head = `### SpecLink: ${spec.specId}\n\n| Requirement | Status | Tests |\n|---|---|---|\n`;
  return head + rows.map(r => `| ${r.id} ${r.text.slice(0, 70).replace(/\|/g, '/')}${r.text.length > 70 ? '…' : ''} | ${r.status} | ${r.tests.length} |`).join('\n') + '\n';
}

// Scope gate: every changed path must match a Scope glob, the spec itself, its link file, or its tests are covered by Scope.
export function globToRegExp(g) {
  const esc = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, m => m.endsWith('/') ? '\u0001' : '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*');
  return new RegExp('^' + esc + '$');
}
export function outOfScope(changed, spec, specPath) {
  const allow = [...spec.scope, specPath, specPath.replace(/\.md$/, '.speclink.json')].map(globToRegExp);
  return changed.filter(f => !allow.some(re => re.test(f)));
}
