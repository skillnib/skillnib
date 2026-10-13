import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, handleLine, TOOLS } from '../src/index.js';

const h = createHandler({ version: '9.9.9', search: async (q, k) => `found ${q} ${k}`, get: async ref => (ref === 'a/SKILL.md#m1' ? 'body' : null) });
const call = (method, params, id = 1) => h({ jsonrpc: '2.0', id, method, params });

test('[tap-mcp R1] handshake: version negotiation, tools capability only, notifications silent, ping, unknown method, parse error', async () => {
  let r = await call('initialize', { protocolVersion: '2025-03-26' });
  assert.deepEqual(r.result, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'skillnib', version: '9.9.9' } });
  assert.equal((await call('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');
  assert.equal(await h({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await h({ jsonrpc: '2.0', method: 'whatever/else' }), null);
  assert.deepEqual((await call('ping')).result, {});
  assert.equal((await call('nope')).error.code, -32601);
  assert.deepEqual(await handleLine(h, '{not json'), { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  assert.equal((await call('tools/list')).id, 1); // answered before initialize: the handler is stateless
  assert.equal(await handleLine(h, '   '), null);
  assert.equal((await h([])).error.code, -32600);
});

test('[tap-mcp R2] tools/list returns exactly search and get with schemas and the untrusted-content warning', async () => {
  const { tools } = (await call('tools/list')).result;
  assert.deepEqual(tools.map(t => t.name), ['search', 'get']); assert.deepEqual(tools, TOOLS);
  const [s, g] = tools;
  assert.deepEqual(s.inputSchema.required, ['query']); assert.equal(s.inputSchema.properties.k.minimum, 1); assert.equal(s.inputSchema.properties.k.maximum, 12); assert.equal(s.inputSchema.properties.query.type, 'string');
  assert.deepEqual(g.inputSchema.required, ['ref']);
  for (const t of tools) { assert.match(t.description, /verbatim/); assert.match(t.description, /untrusted/i); }
});

test('[tap-mcp R3] search returns the callback text; bad params are invalid-params errors', async () => {
  assert.deepEqual((await call('tools/call', { name: 'search', arguments: { query: ' hello ', k: 2 } })).result, { content: [{ type: 'text', text: 'found hello 2' }] });
  assert.equal((await call('tools/call', { name: 'search', arguments: { query: 'x' } })).result.content[0].text, 'found x 4');
  for (const args of [{}, { query: '' }, { query: 3 }, { query: 'x', k: 0 }, { query: 'x', k: 13 }, { query: 'x', k: 1.5 }, { query: 'x', k: '2' }]) assert.equal((await call('tools/call', { name: 'search', arguments: args })).error.code, -32602, JSON.stringify(args));
  assert.equal((await call('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
});

test('[tap-mcp R4] get returns the text; an unknown reference is an isError result that points to search', async () => {
  assert.deepEqual((await call('tools/call', { name: 'get', arguments: { ref: 'a/SKILL.md#m1' } })).result, { content: [{ type: 'text', text: 'body' }] });
  const r = (await call('tools/call', { name: 'get', arguments: { ref: 'zzz' } })).result;
  assert.equal(r.isError, true); assert.match(r.content[0].text, /search tool/);
  assert.equal((await call('tools/call', { name: 'get', arguments: {} })).error.code, -32602);
});

test('[tap-mcp R5] a throwing callback becomes an isError result and the handler keeps working', async () => {
  const bad = createHandler({ version: '1', search: async () => { throw new Error('catalog is broken'); }, get: async () => { throw new Error('catalog is broken'); } });
  for (const [name, arguments_] of [['search', { query: 'x' }], ['get', { ref: 'x' }]]) {
    const r = await bad({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name, arguments: arguments_ } });
    assert.deepEqual(r.result, { content: [{ type: 'text', text: 'catalog is broken' }], isError: true });
  }
  assert.deepEqual((await bad({ jsonrpc: '2.0', id: 6, method: 'ping' })).result, {});
});
