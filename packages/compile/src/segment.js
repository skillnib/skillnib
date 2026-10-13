// H2/H3 segmenter validated in research C2, made exactly lossless: whitespace-only fragments are joined, never dropped.
export const SEGMENTER = { name: 'h2-h3', version: 1 };
export const LIMIT = 6144;

const encoder = new TextEncoder();
export const byteLength = text => encoder.encode(text).length;
const blank = lines => lines.every(l => l.trim() === '');

// Lines keep their own endings (\n or \r\n) so joining them reproduces the text exactly.
const toLines = text => text.match(/[^\n]*\n|[^\n]+/g) ?? [];

// Split into chunks starting at lines matching `re` outside fenced code. The first chunk holds whatever precedes
// the first match and has headed=false when it is not itself started by a match.
function splitAt(lines, re) {
  const chunks = [{ lines: [], headed: false }];
  let fence = null;
  for (const line of lines) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence) : f[1];
    if (!fence && !f && re.test(line)) chunks.push({ lines: [line], headed: true });
    else chunks[chunks.length - 1].lines.push(line);
  }
  return chunks.filter(c => c.lines.length);
}

const headingOf = (lines, re) => (lines.find(l => re.test(l)) ?? '').trim();

// Returns [{ kind, title, parent?, text }] whose texts concatenate to `text` exactly (for non-blank text).
export function segment(text) {
  if (text.trim() === '') return [];
  const out = [];
  let h2 = splitAt(toLines(text), /^## /);
  // a whitespace-only preamble joins the following section instead of becoming its own module
  if (h2.length > 1 && !h2[0].headed && blank(h2[0].lines)) h2 = [{ lines: [...h2[0].lines, ...h2[1].lines], headed: true }, ...h2.slice(2)];
  for (const c of h2) {
    const joined = c.lines.join('');
    if (!c.headed) { out.push({ kind: 'preamble', title: '(preamble)', text: joined }); continue; }
    const title = headingOf(c.lines, /^## /);
    if (byteLength(joined) <= LIMIT) { out.push({ kind: 'h2', title, text: joined }); continue; }
    const h3 = splitAt(c.lines, /^### /);
    if (h3.length === 1) { out.push({ kind: 'h2', title, text: joined }); continue; }
    for (const s of h3) {
      if (s.headed) out.push({ kind: 'h3', title: headingOf(s.lines, /^### /), parent: title, text: s.lines.join('') });
      else out.push({ kind: 'h2-lead', title, text: s.lines.join('') });
    }
  }
  return out;
}
