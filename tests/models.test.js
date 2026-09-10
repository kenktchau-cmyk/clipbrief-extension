import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels, resolveProviderConfig } from '../server/models.js';
import { GOOGLE_API_BASE } from '../server/ai-provider.js';

const google = { provider: 'google', endpoint: GOOGLE_API_BASE, model: 'gemma', key: 'AIza' + 'k'.repeat(35) };
const custom = { provider: 'openai', endpoint: 'https://example.test/api/v1', model: 'model', key: 'synthetic-secret', jsonMode: false };
const reply = data => new Response(JSON.stringify(data));

test('Google lists all pages, filters generation methods, deduplicates and keeps credentials out of URLs', async () => {
  let calls = 0;
  const result = await listModels(google, { fetcher: async (url, init) => {
    const target = new URL(url); assert.equal(target.origin, 'https://generativelanguage.googleapis.com');
    assert.equal(target.pathname, '/v1beta/models'); assert.equal(target.searchParams.get('pageSize'), '1000');
    assert.equal(init.headers['x-goog-api-key'], google.key); assert.ok(!url.includes(google.key));
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    if (++calls === 1) return reply({ models: [{ name: 'models/gemma', displayName: 'Gemma', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'page&2' });
    assert.equal(target.searchParams.get('pageToken'), 'page&2');
    return reply({ models: [{ name: 'models/gemma', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini', supportedGenerationMethods: ['generateContent'] }] });
  } });
  assert.equal(calls, 2); assert.deepEqual(result.models.map(m => m.id), ['gemini', 'gemma']); assert.equal(result.truncated, false);
});

test('OpenAI-compatible bases and completion URLs map to authenticated models endpoint', async () => {
  for (const endpoint of ['https://example.test/api/v1', 'https://example.test/api/v1/', 'https://example.test/api/v1/chat/completions']) {
    const result = await listModels({ ...custom, endpoint }, { fetcher: async (url, init) => {
      assert.equal(url, 'https://example.test/api/v1/models'); assert.equal(init.headers.Authorization, `Bearer ${custom.key}`);
      return reply({ data: [{ id: 'org/chat', name: 'Chat' }, { id: 'org/chat' }, { id: 'invalid id' }, null, { id: 'image', architecture: { output_modalities: ['image'] } }, { id: 'unknown-capability' }] });
    } });
    assert.deepEqual(result.models.map(m => m.id), ['org/chat', 'unknown-capability']);
  }
});

test('saved credentials can only be reused for the same provider and canonical API path', () => {
  assert.equal(resolveProviderConfig({ ...custom, endpoint: custom.endpoint + '/chat/completions', key: '', model: 'other' }, custom).key, custom.key);
  assert.equal(resolveProviderConfig({ ...google, key: undefined, model: 'gemini' }, google).key, google.key);
  for (const endpoint of ['https://other.test/api/v1', 'https://example.test/other', 'https://user:pass@example.test/api/v1', 'https://example.test/api/v1?key=x']) assert.throws(() => resolveProviderConfig({ ...custom, endpoint, key: '' }, custom));
  assert.throws(() => resolveProviderConfig({ ...google, key: '' }, custom));
  assert.throws(() => resolveProviderConfig({ ...custom, key: null }, custom));
  assert.throws(() => resolveProviderConfig({ ...custom, key: '' }, { ...custom, key: '' }));
  assert.equal(resolveProviderConfig({ ...custom, endpoint: 'https://other.test/v1', key: 'new-explicit-key' }, custom).key, 'new-explicit-key');
});

test('unsupported, forbidden, malformed and failed catalogs return safe errors', async () => {
  for (const fetcher of [async () => new Response(custom.key, { status: 401 }), async () => new Response(custom.key, { status: 404 }), async () => new Response(custom.key), async () => reply({ private: custom.key }), async () => { throw new Error(custom.key); }]) {
    await assert.rejects(listModels(custom, { fetcher }), error => error.status === 502 && !error.message.includes(custom.key));
  }
  assert.deepEqual(await listModels(custom, { fetcher: async () => reply({ data: [] }) }), { models: [], truncated: false });
});

test('catalog limits stop oversized bodies, repeated page tokens and excessive entries', async () => {
  await assert.rejects(listModels(custom, { fetcher: async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)) }), /太大/);
  await assert.rejects(listModels(google, { fetcher: async () => reply({ models: [], nextPageToken: 'repeat' }) }), /分頁/);
  const result = await listModels(custom, { fetcher: async () => reply({ data: Array.from({ length: 5001 }, (_, i) => ({ id: 'model-' + i })) }) });
  assert.equal(result.models.length, 5000); assert.equal(result.truncated, true);
});

test('client cancellation propagates to model requests without leaking upstream errors', async () => {
  const controller = new AbortController();
  const result = listModels(custom, { signal: controller.signal, fetcher: async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error(custom.key)), { once: true }); controller.abort();
  }) });
  await assert.rejects(result, error => error.status === 504 && !error.message.includes(custom.key));
});
