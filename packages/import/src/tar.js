// Minimal tar reader for GitHub archives (ustar + pax + GNU long names). Entries are untrusted data.
const dec = new TextDecoder();
const str = (b, o, n) => dec.decode(b.subarray(o, o + n)).replace(/\0.*$/s, '');
const oct = (b, o, n) => parseInt(str(b, o, n).trim() || '0', 8);

function paxRecords(bytes) {
  const out = {}; let i = 0;
  while (i < bytes.length) {
    const sp = bytes.indexOf(0x20, i); if (sp < 0) break;
    const len = parseInt(dec.decode(bytes.subarray(i, sp)), 10); if (!(len > 0)) break;
    const rec = dec.decode(bytes.subarray(sp + 1, i + len - 1)), eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

// Calls onEntry({ path, size, type, data? }) for every entry; `wantData(path, size, type)` decides whether bytes are kept.
export function readTar(bytes, wantData) {
  const entries = []; let off = 0, longName = null, pax = {};
  while (off + 512 <= bytes.length) {
    const h = bytes.subarray(off, off + 512);
    if (h.every(x => x === 0)) break;
    let name = str(h, 0, 100); const prefix = str(h, 345, 155), flag = String.fromCharCode(h[156] || 0x30), size = oct(h, 124, 12);
    if (prefix) name = prefix + '/' + name;
    const body = off + 512, next = body + Math.ceil(size / 512) * 512;
    if (next > bytes.length + 511) throw new Error('truncated archive');
    if (flag === 'x') { pax = paxRecords(bytes.subarray(body, body + size)); }
    else if (flag === 'g') { /* global header: ignored */ }
    else if (flag === 'L') { longName = str(bytes, body, size); }
    else {
      const path = pax.path ?? longName ?? name, real = pax.size ? Number(pax.size) : size;
      const type = flag === '0' || flag === '\0' || flag === '7' ? 'file' : flag === '5' ? 'dir' : flag === '2' || flag === '1' ? 'symlink' : 'other';
      const e = { path, size: real, type };
      if (type === 'file' && wantData(path, real)) e.data = bytes.slice(body, body + real);
      entries.push(e); pax = {}; longName = null;
    }
    off = next;
  }
  return entries;
}
