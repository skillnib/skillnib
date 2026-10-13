import { gzipSync } from 'node:zlib';

export const SHA = 'a'.repeat(40);
const pad = (b, n) => Buffer.concat([b, Buffer.alloc((n - (b.length % n)) % n)]);
export function tarEntry(name, content = '', flag = '0', link = '') {
  const h = Buffer.alloc(512), body = Buffer.from(content);
  h.write(name.slice(0, 100), 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148);
  h.write(flag, 156); h.write(link, 157); h.write('ustar\0' + '00', 257);
  let sum = 0; for (const x of h) sum += x; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, pad(body, 512)]);
}
export function tarball(files, extra = []) {
  const top = `acme-skills-${SHA.slice(0, 7)}/`;
  const parts = [tarEntry('pax_global_header', `52 comment=${SHA}\n`.padEnd(52, ' ').slice(0, 51) + '\n', 'g'), tarEntry(top, '', '5')];
  for (const [p, c] of Object.entries(files)) parts.push(tarEntry(top + p, c));
  for (const [p, flag, link] of extra) parts.push(tarEntry(top + p, '', flag, link));
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

// Fake GitHub: { repos: { 'acme/skills': { refs: { HEAD: sha, main: sha }, files } } }
export function fakeFetch(world, log = []) {
  return async (url, init = {}) => {
    log.push({ url, headers: init.headers });
    const m = /api\.github\.com\/repos\/([^/]+)\/([^/]+)(?:\/(commits|tarball)\/(.+))?$/.exec(url);
    const repo = m && world.repos[`${m[1]}/${m[2]}`];
    const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
    if (world.rateLimited) return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
    if (world.badToken) return json(401, { message: 'Bad credentials' });
    if (world.down) throw new Error(world.down);
    if (!repo) return json(404, { message: 'Not Found' });
    if (!m[3]) return json(200, { full_name: `${m[1]}/${m[2]}` });
    if (m[3] === 'commits') { const sha = repo.refs[decodeURIComponent(m[4])]; return sha ? json(200, { sha }) : json(422, { message: 'No commit found' }); }
    return new Response(tarball(repo.files, repo.extra), { status: 200 });
  };
}
