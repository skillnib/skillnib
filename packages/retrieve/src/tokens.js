// Tokenizer and stopword list fixed by research C1/C2 (tools/research/c1/retrieval/common.mjs on branch v1).
export const STOPWORDS = Object.freeze('a an and are as at be but by for from has have how i if in is it its of on or our so that the their then there this to was we what when which with you your do does can should would about into'.split(' '));
const STOP = new Set(STOPWORDS);
export const TOKENIZER = 'lower-a-z0-9-min2-v1';
export const tokenize = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !STOP.has(t));
