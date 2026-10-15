// Dashboard for the nib CLI. Layout and interaction rules: packages/catalog/skills/dashboard-design (@kalahroudi, Apache-2.0).
// Text that comes from skills or files is untrusted and is only ever inserted as text.
let TOKEN = document.querySelector('meta[name=nib-token]').content;
const $ = s => document.querySelector(s);
const h = (t, a = {}, ...k) => { const e = document.createElement(t); for (const [n, v] of Object.entries(a)) { if (n.startsWith('on')) e.addEventListener(n.slice(2), v); else if (v === true) e.setAttribute(n, ''); else if (v !== false && v != null) e.setAttribute(n, v); } for (const c of k.flat()) if (c != null && c !== false) e.append(c); return e; };
const put = (el, ...k) => el.replaceChildren(...k.flat().filter(x => x != null && x !== false));
const P = { menu: 'M4 6h16M4 12h16M4 18h16', sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4', moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  catalog: 'M4 5h16v4H4zM4 11h16v4H4zM4 17h16v3H4z', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3', install: 'M12 3v12M7 10l5 5 5-5M4 20h16', play: 'M6 4l14 8-14 8z', copy: 'M9 9h11v11H9zM5 15V6a2 2 0 012-2h9', check: 'M5 12l5 5 9-10', chev: 'M6 9l6 6 6-6' };
const icon = n => { const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path'); s.setAttribute('class', 'i'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', P[n]); s.append(p); return s; };
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } } };
const fmtB = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';

// The token changes each time `nib ui` starts. After a restart an open tab re-reads it from the page (same origin only) and retries once.
async function freshToken() { try { const t = new DOMParser().parseFromString(await (await fetch('/', { cache: 'no-store' })).text(), 'text/html').querySelector('meta[name=nib-token]')?.content; if (t && t !== TOKEN) { TOKEN = t; return true; } } catch { /* server is down */ } return false; }
async function api(path, body, retried) {
  const r = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-nib-token': TOKEN }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({ error: r.statusText }));
  if (r.status === 403 && !retried && await freshToken()) return api(path, body, true);
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
function toast(m, bad) { const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, m); $('#toasts').append(t); setTimeout(() => t.remove(), 4000); }
function copyBtn(text) {
  const b = h('button', { class: 'copy', type: 'button', 'aria-label': 'Copy', title: 'Copy', onclick: async e => { e.stopPropagation(); try { await navigator.clipboard.writeText(text); } catch { return toast('Copy is blocked in this browser', true); } b.classList.add('ok'); b.replaceChildren(icon('check')); setTimeout(() => { b.classList.remove('ok'); b.replaceChildren(icon('copy')); }, 1200); } }, icon('copy'));
  return b;
}
const skel = n => h('div', { 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: n }, () => h('div', { class: 'sk-b', style: 'height:42px;margin-bottom:8px' })));
const card = (...k) => h('div', { class: 'card' }, ...k);
const warn = (t, bad) => h('p', { class: 'banner', style: bad ? 'border-color:var(--danger)' : null }, t);
const runs = cmd => [h('div', { class: 'muted', style: 'margin-top:8px' }, 'Runs'), h('pre', { class: 'mono', style: 'margin:4px 0 0' }, cmd, copyBtn(cmd))];
const sh = p => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);
const q = p => (/\s/.test(p) ? `"${p}"` : p);

/* ---------- state ---------- */
let state = null, home = '';
const tilde = p => (home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p);
const label = s => tilde(s.location) + (s.ref ? '@' + s.ref : '');
const allSkills = () => state.sources.flatMap(s => s.skills.map(k => ({ ...k, src: s })));
async function refresh() { state = await api('state'); home = state.home; $('#project').textContent = tilde(state.project); $('#project').title = state.project; }

/* ---------- theme, nav ---------- */
const sysDark = matchMedia('(prefers-color-scheme: dark)');
const showTheme = t => $('#themeT').replaceChildren(icon(t === 'dark' ? 'sun' : 'moon'));
const effective = () => document.documentElement.dataset.theme || (sysDark.matches ? 'dark' : 'light');
showTheme(effective());
$('#themeT').onclick = () => { const t = effective() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; ls.set('nib-theme', t); showTheme(t); };
$('#navT').replaceChildren(icon('menu'));
const nav = $('#nav'); const togNav = () => { nav.classList.toggle('rail'); ls.set('nib-nav', nav.classList.contains('rail') ? '1' : '0'); };
if (ls.get('nib-nav') === '1') nav.classList.add('rail');
$('#navT').onclick = togNav;
addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); togNav(); } if (e.key === 'Escape') { closeSheet(); $('#pop').hidden = true; } });
const PAGES = [['catalog', 'Catalog', 'catalog'], ['search', 'Quick search', 'search'], ['install', 'Install', 'install'], ['compare', 'Compare retrievers', 'search'], ['quickstart', 'Quick start test', 'play']];
let page = PAGES.some(p => p[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'catalog', tabs = { catalog: 'skills', install: 'claude' };
const go = p => { page = p; location.hash = p; render(true); };
addEventListener('hashchange', () => { const p = location.hash.slice(1); if (PAGES.some(x => x[0] === p) && p !== page) { page = p; render(true); } });
const drawNav = () => put(nav, PAGES.map(([id, l, ic]) => h('button', { title: l, 'aria-current': id === page ? 'page' : null, onclick: () => go(id) }, icon(ic), h('span', {}, l), id === 'catalog' && state?.sources.length ? h('kbd', { title: `${state.sources.length} source${state.sources.length === 1 ? '' : 's'}, ${allSkills().length} skills` }, String(state.sources.length)) : null)));

/* ---------- background jobs ---------- */
const seen = new Set(); let pollTimer = null;
async function pollJobs(first) {
  let jobs; try { jobs = (await api('jobs')).jobs; } catch { clearTimeout(pollTimer); pollTimer = setTimeout(() => pollJobs(false), 5000); return; }
  const running = jobs.filter(j => j.status === 'running' || j.status === 'waiting'); $('#tray').textContent = `Tasks: ${running.length} running`; $('#idx').hidden = !running.some(j => j.kind === 'embed-index'); $('#taskbar').hidden = !running.length;
  let changed = false;
  for (const j of jobs) if (j.status !== 'running' && j.status !== 'waiting' && !seen.has(j.id)) { seen.add(j.id); if (!first) { changed = true; toast(`${j.title}: ${j.ok ? 'done' : 'failed'}`, !j.ok); } }
  put($('#pop'), jobs.length ? jobs.map(j => h('div', {}, h('span', { style: 'display:inline-flex;gap:6px;align-items:center' }, h('span', { class: 'dot ' + (j.status === 'running' || j.status === 'waiting' ? 'run' : j.ok ? 'ok' : 'bad') }), j.title), j.output ? h('pre', { class: 'mono', style: 'margin:4px 0 0;white-space:pre-wrap' }, j.output.slice(0, 600)) : null)) : [h('div', { class: 'muted' }, 'No tasks yet.')]);
  if (changed) { await refresh().catch(() => {}); render(); }
  clearTimeout(pollTimer); pollTimer = running.length ? setTimeout(() => pollJobs(false), 700) : null; // idle: no more requests until a job is started or the tab is focused again
}
addEventListener('focus', () => { if (!pollTimer) pollJobs(false); });
$('#tray').onclick = () => { $('#pop').hidden = !$('#pop').hidden; };
async function startJob(path, body) { const j = await api(path, body); closeSheet(); toast('Started: ' + j.title); pollJobs(false); return j; }
const fail = e => toast(e.message, true);

/* ---------- sheet ---------- */
let lastFocus = null;
function openSheet(title, ...body) { lastFocus = document.activeElement; const s = $('#sheet'); put(s, h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('h2', { id: 'sheetT' }, title), h('button', { class: 'ibtn', 'aria-label': 'Close', onclick: closeSheet }, '✕')), ...body); s.hidden = false; $('#back').hidden = false; (s.querySelector('input,select') || s).focus?.(); }
function closeSheet() { if ($('#sheet').hidden) return; $('#sheet').hidden = true; $('#back').hidden = true; lastFocus?.focus?.(); }
$('#back').onclick = closeSheet;

/* ---------- import: a GitHub repository, a local folder or Markdown files ---------- */
// A local path pasted into the GitHub box belongs on another tab; everything else is parsed by the server (the shared import package).
const localKind = t => (/^(\.{0,2}\/|~\/|[a-zA-Z]:\\)/.test(t) || /\.md$/i.test(t) ? (/\.md$/i.test(t) ? 'files' : 'folder') : null);
function importSheet() {
  let mode = 'repo', t, ready = null; const sel = []; let browsePath = home; const panes = {};
  const tabsEl = h('div', { class: 'tabs', role: 'tablist', style: 'margin:0' }), go = h('button', { class: 'btn pri', disabled: true }, 'Import');
  const set = v => { ready = v; go.disabled = !v; };
  const field = (id, lbl, ph, help) => { const i = h('input', { type: 'text', id, autocomplete: 'off', spellcheck: 'false', placeholder: ph, 'aria-label': lbl }); return [h('label', {}, lbl, i, help ? h('span', { class: 'muted' }, help) : null), i]; };
  const [repoL, repoI] = field('src', 'GitHub repository', 'https://github.com/owner/repo', 'Paste the address from your browser: a repository, a folder (…/tree/main/skills), a commit or a file. owner/repo works too.');
  const ref = h('input', { type: 'text', id: 'ref', placeholder: 'default branch', 'aria-label': 'Branch, tag or commit' }), sub = h('input', { type: 'text', id: 'sub', placeholder: 'whole repository', 'aria-label': 'Folder in the repository' }), repoOut = h('div', { 'aria-live': 'polite' });
  const known = nm => state.sources.find(s => s.kind === 'github' && s.location === nm);
  const checkRepo = async () => {
    const v = repoI.value.trim(); set(null); if (!v) return put(repoOut);
    const local = localKind(v);
    if (local) { pickMode(local); panes[local].inp.value = v; repoI.value = ''; put(repoOut); return ({ folder: checkFolder, files: addFile })[local](); }
    const body = { type: 'github', value: v, ref: ref.value.trim(), sub: sub.value.trim() }, key = JSON.stringify(body);
    let p; try { p = await api('preview', body); } catch (e) { return put(repoOut, warn(e.message, true)); }
    if (key !== JSON.stringify({ type: 'github', value: repoI.value.trim(), ref: ref.value.trim(), sub: sub.value.trim() })) return;
    const ns = p.name + (p.sub ? '/' + p.sub : ''), k = known(ns);
    put(repoOut, card(h('div', { class: 'muted' }, 'Namespace'), h('div', {}, h('span', { class: 'badge mono' }, ns, copyBtn(ns))), h('div', { class: 'muted', style: 'margin-top:8px' }, p.ambiguous ? 'The branch, tag or commit and the folder are matched against GitHub when you import.' : `Branch, tag or commit: ${p.ref || 'default branch'} · Folder: ${p.sub || 'whole repository'}`), runs('nib import ' + sh('github:' + p.spec))),
      k ? warn(`${label(k)} is already in this catalog (${k.status}${k.commit ? ' at ' + k.commit.slice(0, 7) : ''}). Importing it again changes nothing unless the commit moved. Use Update on the source to refresh it.`) : null,
      warn('The skills are listed under this namespace once the import finishes.'));
    set({ path: 'import', body });
  };
  repoI.oninput = ref.oninput = sub.oninput = () => { clearTimeout(t); t = setTimeout(checkRepo, 300); };
  panes.repo = h('div', { style: 'display:grid;gap:12px' }, repoL, repoOut, h('details', {}, h('summary', {}, 'Advanced (branch, tag, commit or folder)'), h('div', { style: 'display:grid;gap:10px;margin-top:10px' }, h('label', {}, 'Branch, tag or commit', ref), h('label', {}, 'Folder in the repository', sub), h('p', { class: 'muted', style: 'margin:0' }, 'A commit pins the source. Without a ref it follows the default branch. Private repositories read the GITHUB_TOKEN variable of the shell that started nib ui.')))); panes.repo.inp = repoI;

  function browser(kind, onUse) {
    const box = h('div', { class: 'card', style: 'margin:0' });
    box.draw = async () => {
      let d; try { d = await api('browse?path=' + encodeURIComponent(browsePath)); } catch (e) { return put(box, warn(e.message, true), h('button', { class: 'btn sm', onclick: () => { browsePath = home; box.draw(); } }, 'Back to home')); }
      browsePath = d.path; const parts = d.path.split('/').filter(Boolean), crumbs = [h('button', { class: 'btn sm', onclick: () => { browsePath = '/'; box.draw(); } }, '/'), ...parts.map((x, i) => h('button', { class: 'btn sm', onclick: () => { browsePath = '/' + parts.slice(0, i + 1).join('/'); box.draw(); } }, x))];
      const rows = d.entries.filter(e => e.type === 'dir' || kind === 'files').map(e => {
        const full = d.path + '/' + e.name;
        if (e.type === 'dir') return h('li', {}, h('button', { class: 'btn sm', style: 'width:100%;text-align:left', onclick: () => { browsePath = full; box.draw(); } }, e.name + '/', e.skill ? h('span', { class: 'badge', style: 'margin-left:8px' }, 'skill') : null));
        return h('li', {}, h('label', { style: 'flex-direction:row;gap:8px;align-items:center;font-weight:400' }, h('input', { type: 'checkbox', checked: sel.includes(full), disabled: e.tooBig, onchange: ev => { const i = sel.indexOf(full); if (ev.target.checked && i < 0) sel.push(full); else if (i >= 0) sel.splice(i, 1); checkFiles(); } }), h('span', { class: 'mono' }, e.name), h('span', { class: 'muted' }, e.tooBig ? `${fmtB(e.size)} · larger than 1 MiB` : fmtB(e.size))));
      });
      put(box, h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px' }, crumbs), h('ul', { style: 'list-style:none;margin:0;padding:0;display:grid;gap:4px;max-height:220px;overflow:auto' }, rows.length ? rows : h('li', { class: 'muted' }, 'Nothing to pick here.')),
        h('div', { class: 'row', style: 'margin-top:8px' }, kind === 'folder' ? h('button', { class: 'btn pri sm', onclick: () => { onUse(d.path); box.hidden = true; } }, 'Use this folder') : h('button', { class: 'btn sm', onclick: () => { box.hidden = true; } }, 'Done')));
    };
    box.hidden = true; return box;
  }

  const [folderL, folderI] = field('fpath', 'Local folder', '~/work/skills', 'A folder that holds skills. Every folder inside it with a SKILL.md file becomes a skill.');
  const folderOut = h('div', { 'aria-live': 'polite' }), folderB = browser('folder', p => { folderI.value = tilde(p); checkFolder(); });
  const checkFolder = async () => {
    const v = folderI.value.trim(); set(null); if (!v) return put(folderOut);
    let d; try { d = await api('preview', { type: 'folder', path: v }); } catch (e) { return put(folderOut, warn(e.message, true)); }
    if (folderI.value.trim() !== v) return;
    put(folderOut, card(h('div', { class: 'muted' }, 'Namespace'), h('div', {}, h('span', { class: 'badge mono' }, v, copyBtn(v))), runs('nib import ' + q(v))),
      d.already[0]?.imported ? warn('This folder is already in the catalog. Importing it again reads it from disk and updates what changed.') : null,
      d.skills.length ? card(h('strong', {}, `${d.skills.length} skill${d.skills.length === 1 ? '' : 's'} found`), h('pre', {}, d.skills.map(s => `${s.name}  ${s.files} file${s.files === 1 ? '' : 's'}`).join('\n'))) : warn(d.error || 'No skills found. A skill is a folder with a SKILL.md file. To import single Markdown files, use the Markdown files tab.', true),
      d.skipped.length ? card(h('strong', {}, `${d.skipped.length} file${d.skipped.length === 1 ? '' : 's'} skipped`), h('pre', {}, d.skipped.slice(0, 20).map(s => `${s.path}  ${s.reason}`).join('\n'))) : null);
    if (d.skills.length) set({ path: 'import', body: { type: 'folder', path: v } });
  };
  folderI.oninput = () => { clearTimeout(t); t = setTimeout(checkFolder, 300); };
  panes.folder = h('div', { style: 'display:grid;gap:12px' }, folderL, h('div', {}, h('button', { class: 'btn', onclick: () => { folderB.hidden = false; folderB.draw(); } }, 'Browse…')), folderB, folderOut); panes.folder.inp = folderI;

  const [fileL, fileI] = field('mpath', 'Markdown file', '~/notes/conventions.md', 'Each file becomes one skill, named after the file. Add several files to import them together.');
  const filesOut = h('div', { 'aria-live': 'polite' }), filesB = browser('files', () => {});
  const addFile = () => { const v = fileI.value.trim(); if (!v) return; const abs = v.replace(/^~(?=$|\/)/, home); if (!/\.md$/i.test(abs)) return put(filesOut, warn('Only Markdown (.md) files can be imported. To import a folder, use the Local folder tab.', true)); if (!sel.includes(abs)) sel.push(abs); fileI.value = ''; checkFiles(); };
  const checkFiles = async () => {
    set(null); if (!sel.length) return put(filesOut);
    let d; try { d = await api('preview', { type: 'files', paths: sel }); } catch (e) { return put(filesOut, warn(e.message, true)); }
    const bad = new Map(d.skipped.map(s => [s.path, s.reason])), seenAlready = new Map(d.already.map(a => [a.origin, a.imported]));
    const rows = sel.map(p => h('tr', {}, h('td', {}, h('strong', {}, p.split('/').pop().replace(/\.md$/i, '')), h('div', { class: 'mono muted' }, tilde(p))), h('td', {}, bad.get(p.split('/').pop()) ? 'Skipped: ' + bad.get(p.split('/').pop()) : seenAlready.get(p) ? 'Already imported' : 'New'), h('td', {}, h('button', { class: 'btn sm', 'aria-label': 'Remove from the list', onclick: () => { sel.splice(sel.indexOf(p), 1); checkFiles(); } }, '✕'))));
    put(filesOut, card(h('strong', {}, `${sel.length} file${sel.length === 1 ? '' : 's'} selected`), h('div', { class: 'tw', style: 'margin-top:8px' }, h('table', { style: 'min-width:0' }, h('tbody', {}, rows))), d.error ? warn(d.error, true) : null, runs('nib import ' + sel.map(tilde).map(q).join(' '))));
    if (d.skills.length) set({ path: 'import', body: { type: 'files', paths: [...sel] } });
  };
  fileI.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFile(); } });
  panes.files = h('div', { style: 'display:grid;gap:12px' }, fileL, h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'btn', onclick: addFile }, 'Add file'), h('button', { class: 'btn', onclick: () => { filesB.hidden = false; filesB.draw(); } }, 'Browse…')), filesB, filesOut); panes.files.inp = fileI;

  const MODES = [['repo', 'GitHub repository'], ['folder', 'Local folder'], ['files', 'Markdown files']];
  const checks = { repo: checkRepo, folder: checkFolder, files: checkFiles };
  function pickMode(m) { mode = m; set(null); put(tabsEl, MODES.map(([id, l]) => h('button', { role: 'tab', 'aria-selected': String(id === m), onclick: () => { pickMode(id); checks[id](); panes[id].inp.focus(); } }, l))); for (const [id] of MODES) panes[id].hidden = id !== m; }
  go.onclick = () => { if (ready) startJob(ready.path, ready.body).catch(fail); };
  openSheet('Import skills', tabsEl, h('p', { class: 'muted', style: 'margin:0' }, 'Pick where the skills are. They are listed in the catalog under that source.'), panes.repo, panes.folder, panes.files, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'), go));
  pickMode('repo'); repoI.focus();
}
function removeSheet(s) {
  const name = label(s), inp = h('input', { type: 'text', id: 'confirm', autocomplete: 'off', 'aria-label': 'Type the namespace to confirm' }), ok = h('button', { class: 'btn dng', disabled: true, 'aria-disabled': 'true', onclick: () => startJob('remove', { key: s.key }).catch(fail) }, 'Remove source');
  inp.oninput = () => { const m = inp.value === name; ok.disabled = !m; ok.setAttribute('aria-disabled', String(!m)); };
  openSheet('Remove ' + name, h('p', {}, `This removes the source and all ${s.skills.length} skill${s.skills.length === 1 ? '' : 's'} under it from this project's catalog (nib remove). The original files are not touched.`), h('p', {}, 'Type ', h('span', { class: 'badge mono' }, name, copyBtn(name)), ' to confirm.'), inp, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'), ok));
}
function updateSheet(s) {
  const force = h('input', { type: 'checkbox', id: 'force' }), prune = h('input', { type: 'checkbox', id: 'prune' });
  openSheet('Update ' + label(s), h('p', {}, s.kind !== 'github' ? 'Re-reads the local source from disk (nib update).' : s.status === 'pinned' ? `Pinned at ${(s.commit ?? '').slice(0, 7)}. Updating needs "Force" to re-read it.` : `Follows ${s.ref || 'the default branch'}, currently at ${(s.commit ?? '').slice(0, 7)} (nib update).`),
    h('details', {}, h('summary', {}, 'Advanced (force, prune)'), h('label', { style: 'flex-direction:row;gap:8px;margin-top:8px' }, force, 'Force a re-read of a pinned source'), h('label', { style: 'flex-direction:row;gap:8px;margin-top:6px' }, prune, 'Remove skills no longer provided upstream')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'), h('button', { class: 'btn pri', onclick: () => startJob('update', { key: s.key, force: force.checked, prune: prune.checked }).catch(fail) }, 'Update')));
}
async function skillSheet(k) {
  const pre = h('pre', {}, 'Loading…'); openSheet(k.name, h('div', {}, h('span', { class: 'badge mono' }, label(k.src), copyBtn(label(k.src)))), h('p', { class: 'muted' }, k.description || 'No description in the front matter.'), pre);
  try { const d = await api(`sections?source=${encodeURIComponent(k.src.key)}&skill=${encodeURIComponent(k.id)}`); pre.textContent = d.sections.map(s => `${s.ref}  ${s.title}  ${fmtB(s.bytes)}`).join('\n'); } catch (e) { pre.textContent = e.message; }
}

/* ---------- views ---------- */
const HELP = [
  ['Namespace', 'The source a skill came from: owner/repo for a GitHub import, the folder for a local one, the file for a Markdown file. Two sources can offer a skill with the same name; the namespace tells them apart.'],
  ['Section', 'A heading-delimited piece of a skill. nib delivers sections verbatim, never rewritten.'],
  ['Pinned / floating', 'A pinned source stays at one commit until you force an update. A floating source follows its default branch or ref.'],
  ['Fail-open', 'When nothing matches or the catalog is unusable, nib gives more (an outline or source paths) instead of guessing.'],
  ['Launch profile', 'A way to start using the catalog from an agent: a project hook or an MCP entry. A profile is not a connected agent; nib cannot see whether an agent is running.'],
  ['Quick start test', 'Local checks that nib returns sections and the hook answers. They do not run an agent or show it followed the text.'],
  ['Bytes', 'Sizes are bytes counted in one run. They are not model tokens and not a quality measure.'] ];
const shelf = () => h('details', { class: 'shelf', open: ls.get('nib-help') === '1', ontoggle: e => ls.set('nib-help', e.target.open ? '1' : '0') }, h('summary', {}, 'Help & concepts'), h('dl', {}, HELP.flatMap(([t, d]) => [h('dt', {}, t), h('dd', {}, d)])), h('p', {}, 'Layout follows the dashboard-design standard by @kalahroudi (Apache-2.0).'));
const head = (t, s) => [h('h1', {}, t), h('p', { class: 'lede' }, s), state.problem ? warn('The catalog could not be read: ' + state.problem, true) : null];
const tabBar = (pg, items) => h('div', { class: 'tabs', role: 'tablist' }, items.map(([id, l]) => h('button', { role: 'tab', 'aria-selected': String(tabs[pg] === id), onclick: () => { tabs[pg] = id; render(); } }, l)));

let nsKey = 'all', toggled = new Map(), grid = { q: '', page: 1, limit: 25 };
/* Searchable dropdown: a button opens a panel with a search box and a listbox. Arrows move, Enter picks, Esc closes. */
function nsPicker(onPick, counts) {
  const items = [['all', 'All namespaces'], ...state.sources.map(s => [s.key, label(s)])]; let act = 0, shown = items;
  const cur = nsKey === 'all' ? 'All namespaces' : label(state.sources.find(s => s.key === nsKey) ?? { location: nsKey });
  const btn = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': 'Namespace filter' }, h('span', { class: 'muted' }, 'Namespace'), h('span', { class: 'v' }, cur), icon('chev'));
  const inp = h('input', { type: 'search', id: 'nsq', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'nslist', 'aria-label': 'Search namespaces', placeholder: 'Search namespaces', autocomplete: 'off' });
  const list = h('ul', { id: 'nslist', role: 'listbox', 'aria-label': 'Namespaces' }), panel = h('div', { class: 'cbp', hidden: true }, inp, list), box = h('div', { class: 'cb' }, btn, panel);
  const shut = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }, pick = v => { shut(); onPick(v); };
  const draw = () => { const f = inp.value.trim().toLowerCase(); shown = items.filter(([, l]) => !f || l.toLowerCase().includes(f)); act = Math.min(act, Math.max(0, shown.length - 1));
    put(list, shown.length ? shown.map(([v, l], i) => h('li', { id: 'nso' + i, role: 'option', class: i === act ? 'act' : '', 'aria-selected': String(v === nsKey), onmousedown: e => { e.preventDefault(); pick(v); }, onmousemove: () => { if (act !== i) { act = i; draw(); } } }, h('span', { class: 'mono' }, l), h('b', {}, String(counts[v] ?? 0)))) : [h('li', { class: 'none', role: 'option', 'aria-disabled': 'true' }, 'No namespace matches')]);
    inp.setAttribute('aria-activedescendant', shown.length ? 'nso' + act : ''); list.querySelector('.act')?.scrollIntoView({ block: 'nearest' }); };
  btn.onclick = () => { if (!panel.hidden) return shut(); panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); inp.value = ''; act = Math.max(0, items.findIndex(([v]) => v === nsKey)); draw(); inp.focus(); };
  inp.oninput = () => { act = 0; draw(); };
  inp.onkeydown = e => { if (e.key === 'ArrowDown') { e.preventDefault(); act = Math.min(shown.length - 1, act + 1); draw(); } else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(0, act - 1); draw(); } else if (e.key === 'Enter') { e.preventDefault(); if (shown.length) pick(shown[act][0]); } else if (e.key === 'Escape') { e.stopPropagation(); shut(); btn.focus(); } };
  return box;
}
addEventListener('mousedown', e => document.querySelectorAll('.cbp').forEach(p => { if (!p.parentNode.contains(e.target)) { p.hidden = true; p.previousSibling.setAttribute('aria-expanded', 'false'); } }));

function catalogView() {
  const out = h('div', {}, head('Catalog', 'Skills in this project, grouped under the source they came from.'), tabBar('catalog', [['skills', 'Skills'], ['sources', 'Sources']]));
  if (!state.sources.length) { out.append(h('div', { class: 'empty' }, h('p', {}, 'No skills yet.'), h('button', { class: 'btn pri', onclick: importSheet }, 'Import skills'))); return out; }
  if (tabs.catalog === 'sources') {
    out.append(h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, ['Namespace', 'Kind', 'Status', 'Commit', 'Skills', 'Actions'].map(x => h('th', {}, x)))), h('tbody', {}, state.sources.map(s => h('tr', {}, h('td', { class: 'mono' }, label(s), copyBtn(label(s))), h('td', {}, s.kind), h('td', {}, s.status),
      h('td', { class: 'mono' }, s.commit ? [s.commit.slice(0, 7), copyBtn(s.commit)] : '-'), h('td', { class: 'n' }, String(s.skills.length)), h('td', {}, h('button', { class: 'btn sm', onclick: () => updateSheet(s) }, 'Update'), ' ', h('button', { class: 'btn sm', onclick: () => removeSheet(s) }, 'Remove'))))))));
    return out;
  }
  const f = grid.q, base = allSkills().filter(k => !f || (k.name + ' ' + k.description + ' ' + label(k.src)).toLowerCase().includes(f));
  const counts = { all: base.length }; for (const s of state.sources) counts[s.key] = base.filter(k => k.src.key === s.key).length;
  if (nsKey !== 'all' && !state.sources.some(s => s.key === nsKey)) nsKey = 'all';
  const list = base.filter(k => nsKey === 'all' || k.src.key === nsKey);
  /* Groups are collapsed by default. A text search or a chosen namespace opens them so the matches are visible; a click always wins. */
  const isOpen = key => toggled.has(key) ? toggled.get(key) : !!(grid.q || nsKey !== 'all');
  const entries = []; for (const s of state.sources) { const mine = list.filter(k => k.src.key === s.key); if (!mine.length) continue; entries.push({ g: s, total: mine.length }); if (isOpen(s.key)) mine.forEach(k => entries.push({ k })); }
  const pages = Math.max(1, Math.ceil(entries.length / grid.limit)); grid.page = Math.min(grid.page, pages);
  const from = (grid.page - 1) * grid.limit, slice = entries.slice(from, from + grid.limit);
  if (slice[0]?.k) slice.unshift({ g: slice[0].k.src, total: counts[slice[0].k.src.key] });
  const groups = entries.filter(e => e.g).map(e => e.g.key), allOpen = groups.length > 0 && groups.every(isOpen);
  const search = h('input', { type: 'search', id: 'f', placeholder: 'Search skills, descriptions or namespaces', 'aria-label': 'Filter skills', value: grid.q }); let t;
  search.oninput = e => { clearTimeout(t); t = setTimeout(() => { grid.q = e.target.value.trim().toLowerCase(); grid.page = 1; render(false, 'f'); }, 300); };
  out.append(h('div', { class: 'bar' }, search, nsPicker(v => { nsKey = v; grid.page = 1; render(); }, counts), h('button', { class: 'btn', onclick: () => { grid = { q: '', page: 1, limit: 25 }; nsKey = 'all'; toggled.clear(); render(); } }, 'Reset'), h('button', { class: 'btn', onclick: () => { groups.forEach(g => toggled.set(g, !allOpen)); render(); } }, allOpen ? 'Collapse all' : 'Expand all'), h('button', { class: 'btn pri', onclick: importSheet }, 'Import…')));
  const rows = [];
  for (const e of slice) {
    if (e.g) {
      const s = e.g, open = isOpen(s.key);
      rows.push(h('tr', { class: 'grp' }, h('td', { colspan: 5 }, h('div', { class: 'gt' },
        h('button', { class: 'tog', 'aria-expanded': String(open), onclick: () => { toggled.set(s.key, !open); render(); } }, icon('chev'), h('span', { class: 'mono' }, label(s))),
        copyBtn(label(s)), h('span', { class: 'badge' }, s.kind === 'dir' ? 'folder' : s.kind), h('span', { class: 'badge' }, h('span', { class: 'dot ' + (s.status === 'pinned' ? 'ok' : '') }), s.status), s.commit ? h('span', { class: 'mono muted' }, s.commit.slice(0, 7), copyBtn(s.commit)) : null,
        h('span', { class: 'muted' }, `${e.total} skill${e.total === 1 ? '' : 's'}`), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => updateSheet(s) }, 'Update'), h('button', { class: 'btn sm', onclick: () => removeSheet(s) }, 'Remove')))));
    } else {
      const k = e.k;
      rows.push(h('tr', { class: 'sk' }, h('td', {}, h('strong', {}, k.name), h('div', { class: 'muted', style: 'font-size:12px' }, k.description)), h('td', { class: 'n' }, String(k.files)), h('td', { class: 'n' }, String(k.modules)), h('td', {}, h('span', { class: 'mono muted' }, `${k.src.kind === 'github' ? k.src.location : k.src.location.split('/').pop()}:${k.id}`)),
        h('td', {}, h('button', { class: 'btn sm', onclick: () => skillSheet(k) }, 'Sections'), ' ', h('button', { class: 'btn sm', onclick: () => { sq = k.name; nsKey = 'all'; go('search'); } }, 'Search'))));
    }
  }
  out.append(h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, ['Skill', 'Files', 'Modules', 'Reference', 'Actions'].map(x => h('th', {}, x)))), h('tbody', {}, rows.length ? rows : [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No skills match this filter.'))]))),
    h('div', { class: 'pager' }, h('span', {}, entries.length ? `Showing ${from + 1} - ${from + Math.min(grid.limit, entries.length - from)} of ${entries.length} rows (${groups.length} namespace${groups.length === 1 ? '' : 's'}, ${list.length} skill${list.length === 1 ? '' : 's'})` : 'Showing 0'),
      h('span', { class: 'g' }, h('button', { class: 'btn sm', disabled: grid.page <= 1, 'aria-label': 'Previous page', onclick: () => { grid.page--; render(); } }, '‹'), `Page ${grid.page} of ${pages}`, h('button', { class: 'btn sm', disabled: grid.page >= pages, 'aria-label': 'Next page', onclick: () => { grid.page++; render(); } }, '›'),
        h('select', { id: 'lim', 'aria-label': 'Rows per page', onchange: e => { grid.limit = +e.target.value; grid.page = 1; render(); } }, [25, 50, 100].map(n => h('option', { value: n, selected: n === grid.limit }, `Limit ${n}`))))));
  return out;
}

let sq = '';
function searchView() {
  const inp = h('input', { type: 'search', id: 'q', placeholder: 'What do you need to know? e.g. how should I write a commit message', 'aria-label': 'Search the catalog', value: sq }), res = h('div'), picker = h('div'); let t, seq = 0;
  const counts = { all: allSkills().length }; for (const s of state.sources) counts[s.key] = s.skills.length;
  const drawPicker = () => put(picker, nsPicker(v => { nsKey = v; drawPicker(); run(); }, counts));
  async function run() {
    const text = inp.value.trim(); sq = inp.value; if (!text) return put(res, h('div', { class: 'empty' }, 'Type a question to see the sections an agent would receive.'));
    const mine = ++seq; put(res, skel(3));
    let d; try { d = await api('search?q=' + encodeURIComponent(text) + (nsKey !== 'all' ? '&ns=' + encodeURIComponent(nsKey) : '') + '&k=6'); } catch (e) { return mine === seq && put(res, h('div', { class: 'empty' }, e.message)); }
    if (mine !== seq) return;
    put(res, h('p', { class: 'muted' }, d.failOpen ? `Fail-open: ${d.failOpen.reason}` : `${d.sections.length} section${d.sections.length === 1 ? '' : 's'} delivered, ${fmtB(d.deliveredBytes)}; ${fmtB(d.notLoadedBytes)} left in the outline (this run's bytes, from nib ask).`),
      d.sections.map(s => card(h('div', { class: 'hit' }, h('span', { class: 'badge' }, '#' + s.rank), h('span', { class: 't' }, `${s.skill} › ${s.title}`), h('span', { class: 'sp' }), h('span', { class: 'muted' }, `${fmtB(s.bytes)} · score ${s.score.toFixed(2)}`)), h('div', { class: 'mono muted' }, s.ref, copyBtn(s.ref)), h('pre', {}, s.text))));
  }
  inp.oninput = () => { clearTimeout(t); t = setTimeout(run, 300); }; drawPicker(); if (sq) run(); else put(res, h('div', { class: 'empty' }, 'Type a question to see the sections an agent would receive.'));
  return h('div', {}, head('Quick search', 'Runs the same search as nib ask and shows the sections an agent would receive, verbatim. Narrow it to one namespace.'), h('div', { class: 'bar' }, inp, picker), res);
}

function installView() {
  const out = h('div', {}, head('Install', 'Launch profiles are ways to start using this catalog from an agent. A profile is a configuration, not a connected agent.'), tabBar('install', [['claude', 'Claude Code'], ['mcp', 'MCP client']]));
  if (tabs.install === 'mcp') {
    const snip = JSON.stringify({ mcpServers: { skillnib: { command: 'nib', args: ['mcp', '--store', state.project + '/.nib'] } } }, null, 2), cli = `claude mcp add skillnib -- nib mcp --store ${state.project}/.nib`;
    out.append(warn('You paste this into your MCP client (Claude Desktop, Cursor). This page cannot install it or tell whether the client picked it up.'), card(h('strong', {}, 'MCP server entry'), copyBtn(snip), h('pre', {}, snip)), card(h('strong', {}, 'Claude Code CLI alternative'), copyBtn(cli), h('pre', {}, cli)));
    return out;
  }
  const none = !state.sources.length;
  out.append(card(h('div', { style: 'display:flex;gap:8px;align-items:center' }, h('span', { class: 'dot ' + (state.claudeWired ? 'ok' : '') }), h('strong', {}, 'Claude Code project hook'), h('span', { class: 'muted' }, state.claudeWired ? 'wired: settings call nib hook claude' : 'not wired')),
    h('p', { class: 'muted' }, 'Runs nib init claude for this project: a hook that adds sections to each prompt (auto) or a rules file the agent follows to run nib ask (ask). It also hides the native copies of imported project skills. Preview lists every file first.'), h('button', { class: 'btn pri', disabled: none, onclick: installSheet }, 'Set up…'), none ? h('span', { class: 'muted' }, ' Import skills first.') : null));
  return out;
}
function installSheet() {
  const mode = h('select', { id: 'mode', 'aria-label': 'Mode' }, h('option', { value: 'auto' }, 'auto: hook adds sections to every prompt'), h('option', { value: 'ask' }, 'ask: agent runs nib ask when it needs a skill')), log = h('pre', { style: 'display:none' });
  const run = async (extra, preview) => { try { const j = await api('install', { mode: mode.value, ...extra }); if (!preview) { closeSheet(); toast('Started: ' + j.title); return pollJobs(false); } log.style.display = ''; log.textContent = 'Running…'; for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 250)); const { jobs } = await api('jobs'), me = jobs.find(x => x.id === j.id); if (me && me.status !== 'running') { log.textContent = me.output || '(no output)'; break; } } } catch (e) { fail(e); } };
  openSheet('Set up Claude Code', h('label', {}, 'Mode', mode), h('details', {}, h('summary', {}, 'Advanced (preview and undo)'), h('p', { class: 'muted' }, 'Preview writes nothing. Undo removes what nib init recorded.'), h('button', { class: 'btn', onclick: () => run({ dryRun: true }, true) }, 'Preview changes'), ' ', h('button', { class: 'btn', onclick: () => run({ undo: true }) }, 'Undo wiring')), log,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'), h('button', { class: 'btn pri', onclick: () => run({}) }, 'Install')));
}

function compareView() {
  const inp = h('input', { type: 'text', id: 'qc', value: ls.get('nib-cmp') ?? 'undo the last deploy', 'aria-label': 'Ask to compare', style: 'flex:1;min-width:200px' }), kSel = h('select', { id: 'kc', 'aria-label': 'Sections to return' }, [3, 4, 6, 8].map(n => h('option', { value: n, selected: n === 4 }, 'top ' + n))), out = h('div'), strip = h('div');
  const cmd = (extra = []) => `nib ask ${q(inp.value)} --k ${kSel.value} --json${extra.length ? ' ' + extra.join(' ') : ''}`;
  // One toggle: on -> turn off; off -> turn on with the last settings, or ask for them the first time.
  const toggle = e => async () => {
    try {
      if (e.on) return await startJob('embed', { action: 'off' });
      const url = ls.get('nib-eurl'); if (!url) return embedSheet(e);
      await startJob('embed', { action: 'on', url, model: ls.get('nib-emodel') ?? '' });
    } catch (x) { fail(x); }
  };
  async function drawStrip() {
    let e; try { e = await api('embed'); } catch (x) { return put(strip, warn(x.message, true)); }
    if (e.on && e.url) { ls.set('nib-eurl', e.url); ls.set('nib-emodel', e.model ?? ''); }
    put(strip, card(h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('span', { class: 'dot ' + (e.on ? 'ok' : 'bad') }), h('strong', {}, e.on ? 'Embeddings on' : 'Embeddings off'), h('span', { class: 'sp' }), h('button', { class: 'btn', type: 'button', onclick: toggle(e) }, e.on ? 'Turn off' : 'Turn on'), h('button', { class: 'btn', type: 'button', onclick: () => embedSheet(e) }, 'Settings')), e.on && /out of date|not built|unusable/.test(e.output) ? h('p', { class: 'banner' }, 'The embedding index is not current, so the embeddings side uses BM25. It updates by itself after an import, update or remove; ', h('button', { class: 'btn', type: 'button', onclick: async () => { try { await startJob('embed', { action: 'build' }); } catch (x) { fail(x); } } }, 'update it now')) : null, h('pre', {}, e.output)));
  }
  function embedSheet(e) {
    const url = h('input', { type: 'text', value: ls.get('nib-eurl') ?? '', placeholder: 'http://127.0.0.1:PORT/v1', 'aria-label': 'Embeddings server URL' }), model = h('input', { type: 'text', value: ls.get('nib-emodel') ?? '', placeholder: 'optional: the server uses its own model if empty', 'aria-label': 'Model name' });
    const act = (a, body = {}) => async () => { try { await startJob('embed', { action: a, ...body }); } catch (x) { fail(x); } };
    openSheet('Embeddings (experimental)', h('p', { class: 'muted' }, 'Skill text and your asks are sent to the server below, and nowhere else. The server needs the OpenAI /v1/embeddings shape. If it needs a key, start nib ui with NIB_EMBED_KEY set in the environment.'),
      e.on ? h('p', { class: 'muted' }, 'Embeddings are on. Turning them off keeps the index file; turning them on again re-uses it.') : [h('label', {}, 'Server URL', url), h('label', {}, 'Model name', model), ...runs(`nib embed on --url ${q(url.value || 'URL')}${model.value ? ' --model ' + q(model.value) : ''}`)],
      ...runs('nib embed build'),
      h('div', { class: 'row' }, e.on ? h('button', { class: 'btn', onclick: act('off') }, 'Turn off') : h('button', { class: 'btn', onclick: () => { if (!url.value.trim()) return toast('Enter the server URL', true); ls.set('nib-eurl', url.value); ls.set('nib-emodel', model.value); act('on', { url: url.value, model: model.value })(); } }, 'Turn on'),
        h('button', { class: 'btn pri', disabled: !e.on, onclick: act('build') }, 'Build index')));
  }
  const pane = (title, command, side, d, only) => {
    if (!side) return h('div', {}, h('h2', {}, title), card(h('div', { class: 'muted' }, 'Embeddings are off, so there is nothing to compare. Set them up above.')));
    const del = side.delivery, secs = del?.sections ?? [];
    return h('div', {}, h('h2', {}, title), h('div', { class: 'mono muted' }, command, copyBtn(command)),
      side.notice ? warn(side.notice) : null,
      del ? h('p', { class: 'muted' }, `${del.failOpen ? 'Fail-open: ' + del.failOpen.reason : secs.length + ' section' + (secs.length === 1 ? '' : 's') + ', ' + fmtB(secs.reduce((n, s) => n + s.bytes, 0))} · retriever ${del.retriever?.name ?? 'none'}`) : warn('The CLI did not return JSON (exit ' + side.code + ').', true),
      secs.map(s => h('details', { class: 'card' }, h('summary', { class: 'hit' }, h('span', { class: 'badge' }, '#' + s.rank), h('span', { class: 't' }, `${s.skill} › ${s.title}`), only.includes(s.ref) ? h('span', { class: 'badge', style: 'border-color:var(--accent)' }, 'only here') : null, h('span', { class: 'sp' }), h('span', { class: 'muted' }, fmtB(s.bytes))), h('div', { class: 'mono muted' }, s.ref, copyBtn(s.ref)), h('pre', {}, s.text))));
  };
  let seq = 0;
  async function run() {
    const text = inp.value.trim(); if (!text) return put(out, h('div', { class: 'empty' }, 'Type an ask to see what each retriever returns.'));
    ls.set('nib-cmp', inp.value); const mine = ++seq; put(out, skel(3)); runB.disabled = true;
    let d; try { d = await api('compare?q=' + encodeURIComponent(text) + '&k=' + kSel.value); } catch (e) { runB.disabled = false; return mine === seq && put(out, h('div', { class: 'empty' }, e.message)); }
    runB.disabled = false; if (mine !== seq) return;
    const summary = !d.embedOn ? null : d.usedEmbeddings ? `Shared ${d.shared.length} · only BM25 ${d.onlyBm25.length} · only embeddings ${d.onlyEmbed.length}` : null;
    put(out, d.embedOn && !d.usedEmbeddings ? warn('The embeddings side did not use embeddings' + (d.embed?.notice ? ': ' + d.embed.notice : '') + '. Its results are BM25.', true) : null, summary ? h('p', {}, h('strong', {}, summary)) : null,
      h('div', { class: 'cmp' }, pane('BM25 (default)', cmd(['--no-embed']), d.bm25, d, d.onlyBm25), pane('BM25 + embeddings', cmd(), d.embedOn ? d.embed : null, d, d.onlyEmbed)));
  }
  const runB = h('button', { class: 'btn pri', onclick: run }, 'Compare'); inp.onkeydown = e => { if (e.key === 'Enter') run(); };
  drawStrip(); put(out, h('div', { class: 'empty' }, 'Type an ask and press Compare. Both sides run through the nib CLI.'));
  return h('div', {}, head('Compare retrievers', 'Runs your text through nib ask twice, once BM25-only and once with embeddings, and shows the sections each returns, verbatim, side by side.'), strip, h('div', { class: 'bar' }, inp, kSel, runB), out);
}

function quickView() {
  const inp = h('input', { type: 'text', id: 'qp', value: ls.get('nib-qs') ?? 'write a commit message', 'aria-label': 'Test prompt', style: 'flex:1;min-width:200px' }), out = h('div');
  const run = h('button', { class: 'btn pri', onclick: async () => {
    ls.set('nib-qs', inp.value); put(out, skel(3)); run.disabled = true;
    try {
      const d = await api('quickstart', { prompt: inp.value });
      put(out, d.steps.map(s => card(h('div', { style: 'display:flex;gap:8px;align-items:center' }, h('span', { class: 'dot ' + (s.ok ? 'ok' : 'bad') }), h('strong', {}, s.label), h('span', { class: 'muted' }, s.ok ? 'passed' : 'needs attention')), h('div', { class: 'muted' }, s.detail),
        s.sections?.length ? h('pre', {}, s.sections.map(x => `${x.ref}  ${fmtB(x.bytes)}`).join('\n')) : null, s.output ? h('pre', {}, s.output) : null)), warn(d.summary));
    } catch (e) { put(out, h('div', { class: 'empty' }, e.message)); } finally { run.disabled = false; }
  } }, 'Run test');
  return h('div', {}, head('Quick start test', 'Checks that this project can deliver skill sections: the catalog, nib ask, the hook and the wiring.'), h('div', { class: 'bar' }, inp, run), out);
}

function render(skeleton, refocus) {
  drawNav(); const main = $('#main'), keep = main.scrollTop;
  const draw = () => { if (!state) return; put(main, { catalog: catalogView, search: searchView, install: installView, compare: compareView, quickstart: quickView }[page](), shelf()); if (refocus) { const el = $('#' + refocus); el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); } main.scrollTop = skeleton ? 0 : keep; };
  if (skeleton) { put(main, h('h1', {}, PAGES.find(p => p[0] === page)[1]), skel(5)); (state ? Promise.resolve() : refresh()).then(draw).catch(e => put(main, h('div', { class: 'empty' }, e.message))); } else draw();
}
refresh().then(() => { render(); pollJobs(true); }).catch(e => { $('#main').textContent = e.message; });
