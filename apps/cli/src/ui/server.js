// The server behind `nib ui`. Reads and writes go through the CLI's own main(); search, sections, previews and the
// folder browser use the same shared packages the CLI uses. Nothing here retrieves, compiles or rewrites skill text.
import { createServer } from 'node:http';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { homedir } from 'node:os';
import { resolve, join, dirname, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../main.js';
import { loadStore, StoreError } from '../store.js';
import { importSkills, deriveSources, sourceOfSkill, sourceLabel, searchableSkills, githubCandidates, ImportError, LIMITS } from '../../../../packages/import/src/index.js';
import { dirReader, fileReader } from '../../../../packages/import/node/index.js';
import { createBm25Retriever, corpusFromCatalog } from '../../../../packages/retrieve/src/index.js';
import { catalogEntries, deliver, FORMAT } from '../../../../packages/deliver/src/index.js';
import { frontMatterField } from '../../../../packages/claude/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const fail = (status, message) => Object.assign(new Error(message), { status });
const STATIC = new Set(['index.html', 'app.js', 'app.css', 'theme.js']);
const exists = p => stat(p).then(() => true, () => false);
const status = s => (s.kind === 'github' ? (s.pinned ? 'pinned' : 'floating') : 'local');

// What people paste for a repository: any GitHub address (repository, /tree/<ref>/<folder>, /blob/, /commit/, .git, ssh) or
// owner/repo[/folder][@ref]. The parsing lives in the shared import package; `ref` and `sub` (the Advanced fields) override
// what the address says. `spec` is what `nib import github:<spec>` receives: owner/repo[/folder][@ref] when the address is exact,
// owner/repo@<ref/folder> when the ref may contain slashes (settled against GitHub during the import).
export function githubSpec(raw, ref = '', sub = '') {
  const text = String(raw ?? '').trim(), c = githubCandidates(text), first = c[0];
  const r = String(ref ?? '').trim(), s = String(sub ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!r && !s) return { name: `${first.owner}/${first.repo}`, ref: first.ref ?? '', sub: first.subpath, ambiguous: c.length > 1, spec: c.length > 1 ? `${first.owner}/${first.repo}@${c[c.length - 1].ref}` : `${first.owner}/${first.repo}${first.subpath ? '/' + first.subpath : ''}${first.ref ? '@' + first.ref : ''}` };
  const base = c.length === 1 ? first : { ...first, ref: null, subpath: '' };
  const spec = `${first.owner}/${first.repo}${(s || base.subpath) ? '/' + (s || base.subpath) : ''}${(r || base.ref) ? '@' + (r || base.ref) : ''}`;
  githubCandidates(spec); // the combined reading must be valid too
  return { name: `${first.owner}/${first.repo}`, ref: r || base.ref || '', sub: s || base.subpath, ambiguous: false, spec };
}

export function createUiApp({ project, env = process.env, fetch = globalThis.fetch, nibPath, token = randomBytes(16).toString('hex') }) {
  const storeDir = join(project, '.nib'), home = homedir(), jobs = [];
  let tail = Promise.resolve(), seq = 0;
  const cliEnv = { ...env }; delete cliEnv.NIB_STORE;

  async function nib(argv, { stdin = null } = {}) {
    let out = '', err = '';
    const io = { stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }, stdin: stdin === null ? null : Readable.from([stdin]), cwd: project, env: cliEnv, fetch, nibPath };
    return { code: await main(argv, io), stdout: out, stderr: err };
  }
  // One job at a time: imports, updates and removals rewrite the same store.
  const addJob = (title, kind) => { const job = { id: ++seq, title, kind, status: 'running', ok: null, output: '' }; jobs.unshift(job); jobs.length = Math.min(jobs.length, 50); return job; };
  const finish = async (job, argv) => {
    try { const r = await nib(argv); job.output = (r.stdout + r.stderr).trim(); job.ok = r.code === 0; } catch (e) { job.output = e.message; job.ok = false; }
    job.status = job.ok ? 'done' : 'failed';
  };
  // `reindex`: when embeddings are on, a visible "Updating the embedding index" job follows this one (the CLI's own automatic step is skipped so the two show separately).
  const enqueue = async (title, argv, { reindex = false } = {}) => {
    const withIndex = reindex === 'force' || (reindex && await embedOn()), job = addJob(title, 'cli'), next = withIndex ? addJob('Updating the embedding index', 'embed-index') : null;
    if (next) next.status = 'waiting';
    tail = tail.then(async () => {
      await finish(job, withIndex && reindex !== 'force' ? [...argv, '--no-embed'] : argv);
      if (!next) return;
      if (!job.ok) { next.status = 'skipped'; next.ok = false; next.output = 'Skipped: the step before it failed.'; return; }
      next.status = 'running'; await finish(next, ['embed', 'build']);
    });
    return job;
  };

  async function readStore() {
    try { return await loadStore(storeDir); } catch (e) { if (e instanceof StoreError && e.code === 'missing') return null; throw e; }
  }
  async function state() {
    let store = null, problem = null;
    try { store = await readStore(); } catch (e) { problem = e.message; }
    const sources = !store ? [] : deriveSources(store).map(s => {
      const desc = new Map(store.skills.filter(k => sourceOfSkill(k).key === s.key).map(k => [k.id, frontMatterField((k.files.find(f => basename(f.path) === 'SKILL.md') ?? k.files[0]).text, 'description') ?? '']));
      return { key: s.key, location: s.location, label: sourceLabel(s), kind: s.kind, ref: s.ref, status: status(s), commit: s.commits[0] ?? null, skills: s.skills.map(k => ({ id: k.id, name: k.name, description: desc.get(k.id) ?? '', files: k.files, modules: k.modules })) };
    });
    const settings = (await readFile(join(project, '.claude', 'settings.json'), 'utf8').catch(() => '')) + (await readFile(join(project, '.claude', 'settings.local.json'), 'utf8').catch(() => ''));
    return { project, home, hasStore: !!store, problem, sources, claudeWired: /hook claude/.test(settings) };
  }

  // Same steps as `nib ask`, optionally within one source.
  async function search(q, { key = null, k = 4 } = {}) {
    const store = await readStore();
    if (!store) throw fail(409, 'the project has no catalog yet; import a skill first');
    let catalog = searchableSkills(store);
    if (key) catalog = { ...catalog, skills: catalog.skills.filter(s => sourceOfSkill(s).key === key) };
    if (!catalog.skills.length) return { sections: [], failOpen: { reason: 'no skills in this namespace' }, outline: { lines: [] }, format: FORMAT };
    const entries = catalogEntries(catalog), retriever = await createBm25Retriever(corpusFromCatalog(catalog));
    return { ...deliver({ entries, identity: retriever.identity, hits: await retriever.search(q, { k }), outlineLines: 1000 }), format: FORMAT };
  }
  // The comparison runs the CLI twice, `nib ask --json --no-embed` and `nib ask --json`; nothing is retrieved here.
  const embedOn = () => readFile(join(storeDir, 'embed.json'), 'utf8').then(() => true, () => false);
  async function embedState() { const r = await nib(['embed', 'status']), cfg = await readFile(join(storeDir, 'embed.json'), 'utf8').then(t => JSON.parse(t), () => null); return { on: !!cfg, url: cfg?.url ?? null, model: cfg?.model ?? '', output: (r.stdout + r.stderr).trim() }; }
  async function compare(q, k) {
    const base = ['ask', q, '--k', String(k), '--json'];
    const run = async extra => { const r = await nib([...base, ...extra]); let delivery = null; try { delivery = JSON.parse(r.stdout); } catch { /* not JSON: shown through the notice */ } return { code: r.code, delivery, notice: r.stderr.trim() }; };
    const st = await embedState(), bm25 = await run(['--no-embed']);
    const embed = st.on ? await run([]) : null, refs = d => (d?.delivery?.sections ?? []).map(x => x.ref);
    const usedEmbeddings = embed?.delivery?.retriever?.name === 'bm25+embed', a = refs(bm25), b = refs(embed);
    return { query: q, k, embedOn: st.on, status: st.output, bm25, embed, usedEmbeddings, shared: a.filter(r => b.includes(r)), onlyBm25: a.filter(r => !b.includes(r)), onlyEmbed: b.filter(r => !a.includes(r)) };
  }
  const outlineBytes = lines => lines.reduce((n, l) => n + Number(/\s(\d+) B$/.exec(l)?.[1] ?? 0), 0);

  async function sections(key, id) {
    const store = await readStore(), skill = store?.skills.find(s => s.id === id && sourceOfSkill(s).key === key);
    if (!skill) throw fail(404, 'no such skill');
    return { sections: catalogEntries({ skills: [skill] }).map(({ ref, title, bytes }) => ({ ref, title, bytes })) };
  }

  // Only the home directory and the project are browsable or importable from the page.
  async function allowed(p) {
    const abs = resolve(String(p ?? '').replace(/^~(?=$|\/)/, home));
    if (!String(p ?? '').trim()) throw fail(400, 'a path is required');
    const real = await realpath(abs).catch(() => null);
    if (!real) throw fail(404, `nothing at ${abs}`);
    const roots = await Promise.all([home, project].map(r => realpath(r).catch(() => r)));
    if (!roots.some(r => real === r || real.startsWith(r + sep))) throw fail(403, 'only folders under your home directory or the project can be used here');
    return real;
  }
  async function browse(p) {
    const dir = await allowed(p ?? home), st = await stat(dir);
    if (!st.isDirectory()) throw fail(400, 'not a folder');
    const entries = [];
    for (const e of (await readdir(dir, { withFileTypes: true })).filter(x => !x.name.startsWith('.') && x.name !== 'node_modules').sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500)) {
      if (e.isDirectory()) entries.push({ name: e.name, type: 'dir', skill: await exists(join(dir, e.name, 'SKILL.md')) });
      else if (e.isFile() && /\.md$/i.test(e.name)) entries.push({ name: e.name, type: 'file', size: (await stat(join(dir, e.name))).size, tooBig: (await stat(join(dir, e.name))).size > LIMITS.maxFileBytes });
    }
    return { path: dir, home, entries };
  }
  async function preview(b) {
    if (b.type === 'github') return githubSpec(text(b.value), b.ref ?? '', b.sub ?? ''); // parsing only: nothing is fetched while typing
    const store = await readStore().catch(() => null), have = new Set(store ? deriveSources(store).map(s => s.key) : []);
    const readers = b.type === 'folder' ? [dirReader(await allowed(b.path))] : (Array.isArray(b.paths) && b.paths.length && b.paths.length <= 100 ? await Promise.all(b.paths.map(async p => fileReader(await allowed(p)))) : (() => { throw fail(400, 'choose at least one Markdown file'); })());
    if (b.type === 'files') for (const r of readers) if (!/\.md$/i.test(r.origin)) throw fail(400, 'only Markdown (.md) files can be imported');
    try {
      const c = await importSkills(readers);
      return { skills: c.skills.map(s => ({ id: s.id, name: s.name, files: s.files.length })), skipped: c.skipped.map(x => ({ path: x.path, reason: x.reason })), already: readers.map(r => ({ origin: r.origin, imported: have.has(`${r.kind}:${r.origin}`) })) };
    } catch (e) { if (e instanceof ImportError) return { skills: [], skipped: [], error: e.message, already: [] }; throw e; }
  }

  async function sourceLabelFor(key) {
    const s = (await state()).sources.find(x => x.key === key);
    if (!s) throw fail(404, 'no such source');
    return s.label;
  }
  async function quickstart(prompt) {
    const st = await state(), steps = [];
    const count = st.sources.reduce((n, s) => n + s.skills.length, 0);
    steps.push({ id: 'catalog', label: 'Catalog has skills', ok: count > 0, detail: `${count} skill${count === 1 ? '' : 's'} from ${st.sources.length} source${st.sources.length === 1 ? '' : 's'} in ${storeDir}` });
    if (!count) return { steps, summary: 'Import a skill first.' };
    const d = await search(prompt).catch(e => ({ error: e.message, sections: [] }));
    const delivered = d.sections.reduce((n, s) => n + s.bytes, 0), ok = !d.error && !d.failOpen && d.sections.length > 0;
    steps.push({ id: 'delivery', label: 'nib ask returns sections for the prompt', ok, detail: d.error ?? (d.failOpen ? `fail-open: ${d.failOpen.reason}` : `${d.sections.length} sections, ${delivered} B delivered, ${outlineBytes(d.outline.lines)} B left in the outline (this run's bytes, not tokens)`), sections: d.sections.map(s => ({ ref: s.ref, bytes: s.bytes })) });
    const h = await nib(['hook', 'claude'], { stdin: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd: project }) });
    steps.push({ id: 'hook', label: 'nib hook claude answers a UserPromptSubmit event', ok: h.code === 0 && h.stdout.length > 0 && !h.stderr, detail: `${h.stdout.length} characters on stdout, exit ${h.code}${h.stderr ? '; ' + h.stderr.trim() : ''}`, output: h.stdout.slice(0, 4000) });
    steps.push({ id: 'wiring', label: 'Claude Code project is wired to the hook', ok: st.claudeWired, detail: st.claudeWired ? '.claude settings call nib hook claude' : 'not wired yet; use Install' });
    return { steps, summary: 'These checks run nib on this computer. They do not show that an agent followed the delivered text.' };
  }

  const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const readBody = req => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 64e3) { no(fail(413, 'body too large')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { no(fail(400, 'invalid JSON')); } }); req.on('error', no); });
  const text = (v, max = 500) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw fail(400, 'a text value is required'); return v.trim(); };

  async function handle(req, res, port) {
    const url = new URL(req.url, 'http://x'), host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: 'host not allowed' });
    try {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1), ext = name.slice(name.lastIndexOf('.'));
        if (!STATIC.has(name)) throw fail(404, 'not found');
        const body = await readFile(join(HERE, name), 'utf8').catch(() => { throw fail(404, 'not found'); });
        return send(res, 200, name === 'index.html' ? body.replace('__TOKEN__', token) : body, TYPES[ext]);
      }
      if (req.method === 'POST') {
        const sent = Buffer.from(String(req.headers['x-nib-token'] ?? '')), want = Buffer.from(token);
        if (sent.length !== want.length || !timingSafeEqual(sent, want)) throw fail(403, 'missing or wrong token');
      }
      const route = `${req.method} ${url.pathname}`, qs = k => url.searchParams.get(k);
      if (route === 'GET /api/state') return send(res, 200, await state());
      if (route === 'GET /api/search') { const d = await search(text(qs('q')), { key: qs('ns') || null, k: Math.min(12, Math.max(1, Number(qs('k')) || 4)) }); return send(res, 200, { ...d, deliveredBytes: d.sections.reduce((n, s) => n + s.bytes, 0), notLoadedBytes: outlineBytes(d.outline.lines) }); }
      if (route === 'GET /api/compare') return send(res, 200, await compare(text(qs('q')), Math.min(12, Math.max(1, Number(qs('k')) || 4))));
      if (route === 'GET /api/embed') return send(res, 200, await embedState());
      if (route === 'GET /api/sections') return send(res, 200, await sections(text(qs('source')), text(qs('skill'))));
      if (route === 'GET /api/browse') return send(res, 200, await browse(qs('path')));
      if (route === 'GET /api/jobs') return send(res, 200, { jobs });
      if (route === 'POST /api/preview') return send(res, 200, await preview(await readBody(req)));
      if (route === 'POST /api/import') {
        const b = await readBody(req);
        if (b.type === 'github') { const g = githubSpec(text(b.value), b.ref ?? '', b.sub ?? ''); return send(res, 202, await enqueue(`Import ${g.name}${g.sub ? '/' + g.sub : ''}`, ['import', `github:${g.spec}`], { reindex: true })); }
        if (b.type === 'folder') { const p = await allowed(b.path); return send(res, 202, await enqueue(`Import ${p}`, ['import', p], { reindex: true })); }
        if (b.type === 'files') { const ps = await Promise.all((Array.isArray(b.paths) ? b.paths : []).slice(0, 100).map(allowed)); if (!ps.length) throw fail(400, 'choose at least one Markdown file'); return send(res, 202, await enqueue(`Import ${ps.length} Markdown file${ps.length === 1 ? '' : 's'}`, ['import', ...ps], { reindex: true })); }
        throw fail(400, 'unknown import type');
      }
      if (route === 'POST /api/update') { const b = await readBody(req), label = await sourceLabelFor(text(b.key)); return send(res, 202, await enqueue(`Update ${label}`, ['update', label, ...(b.force ? ['--force'] : []), ...(b.prune ? ['--prune'] : [])], { reindex: true })); }
      if (route === 'POST /api/remove') { const b = await readBody(req), label = await sourceLabelFor(text(b.key)); return send(res, 202, await enqueue(`Remove ${label}`, ['remove', label], { reindex: true })); }
      if (route === 'POST /api/install') {
        const b = await readBody(req), mode = b.mode === 'ask' ? 'ask' : 'auto', labels = b.undo ? [] : (await state()).sources.map(s => s.label);
        return send(res, 202, await enqueue(`${b.undo ? 'Undo' : b.dryRun ? 'Preview' : 'Install'} Claude Code wiring (${mode})`, ['init', 'claude', ...labels, '--project', project, '--mode', mode, ...(b.undo ? ['--undo'] : b.dryRun ? ['--dry-run'] : [])]));
      }
      if (route === 'POST /api/embed') {
        const b = await readBody(req), arg = v => { const t = text(v, 300); if (t.startsWith('-')) throw fail(400, 'a value cannot start with a dash'); return t; };
        if (b.action === 'on') return send(res, 202, await enqueue('Turn on embeddings', ['embed', 'on', '--url', arg(b.url), ...(typeof b.model === 'string' && b.model.trim() ? ['--model', arg(b.model)] : [])], { reindex: 'force' }));
        if (b.action === 'build') return send(res, 202, await enqueue('Build the embedding index', ['embed', 'build']));
        if (b.action === 'off') return send(res, 202, await enqueue('Turn off embeddings', ['embed', 'off']));
        throw fail(400, 'unknown embeddings action');
      }
      if (route === 'POST /api/quickstart') return send(res, 200, await quickstart(text((await readBody(req)).prompt)));
      throw fail(404, 'not found');
    } catch (e) { send(res, e.status ?? (e instanceof ImportError ? 400 : 500), { error: e.message }); }
  }

  const server = createServer((req, res) => { handle(req, res, server.address().port); });
  return { server, token, jobs, settled: () => tail, listen: (port = 0) => new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server.address().port))) };
}
