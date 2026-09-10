import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createBackend } from '../server/app.js';
import { summarize as clientSummary, connectBackend } from '../api.js';
import { restoreConfig, getApiTarget } from '../providers.js';
import { saveBackendKey } from '../server/key-store.js';

test('model lookup is restricted to own UI and never saves draft credentials; same-service model changes reuse saved key', async t => {
  const current = { provider: 'openai', endpoint: 'https://example.test/v1', model: 'old', key: 'synthetic-model-key', jsonMode: false };
  let calls = 0, saves = 0;
  const { endpoint } = await setup(t, { providerConfig: current, runModels: async config => { calls++; assert.equal(config.key, current.key); return { models: [{ id: 'new', name: 'New' }], truncated: false }; }, saveConfig: async config => { saves++; assert.equal(config.key, current.key); assert.equal(config.model, 'new'); return { storage: 'memory' }; } });
  const hdrs = { ...headers, Origin: endpoint, 'X-ClipBrief-UI': '1' };
  const query = { provider: current.provider, endpoint: current.endpoint, key: '' };
  const request = (path, body, h = hdrs) => fetch(endpoint + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  for (const h of [headers, { ...hdrs, Origin: `chrome-extension://${'a'.repeat(32)}` }, { ...hdrs, Authorization: '' }]) assert.ok([401, 403].includes((await request('/api/models', query, h)).status));
  assert.equal(calls, 0);
  assert.equal((await request('/api/models', { ...query, endpoint: 'https://other.test/v1' })).status, 400);
  assert.equal((await request('/api/models', { ...query, model: 'forbidden' })).status, 400);
  const response = await request('/api/models', query); assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(current.key));
  assert.equal(calls, 1); assert.equal(saves, 0);
  assert.equal((await connectBackend({ endpoint, token })).model, 'old');
  assert.equal((await request('/api/provider', { ...query, model: 'new', jsonMode: false })).status, 200);
  assert.equal(saves, 1); assert.equal((await connectBackend({ endpoint, token })).model, 'new');
});

const token = 'a'.repeat(64), key = 'synthetic-upstream-secret';
const video = { title: 'Test', segments: [{ start: 0, text: '字幕內容'.repeat(30) }] };
const options = { language: 'yue', length: 'short' };
const summary = { brief: '測試摘要', keyPoints: ['測試重點'], chapters: [{ start: 0, title: '開場', description: '' }] };
const payload = () => ({ video: structuredClone(video), options: { ...options } });
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
async function setup(t, overrides = {}) {
  const server = createBackend({ key, token, runSummary: async () => summary, ...overrides });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return { endpoint, server, post: (body = payload(), extra = {}) => fetch(`${endpoint}/api/summarize`, { method: 'POST', headers, body: JSON.stringify(body), ...extra }) };
}

test('frontend drops legacy provider credentials and allows only local backend destinations', () => {
  const old = { provider: 'google', endpoint: 'https://generativelanguage.googleapis.com', key, remember: true };
  assert.equal(restoreConfig(old).token, '');
  assert.ok(!JSON.stringify(restoreConfig(old)).includes(key));
  assert.ok(!('key' in restoreConfig({ provider: 'backend', endpoint: 'http://localhost:4173', token, key })));
  for (const endpoint of ['https://evil.example', 'http://localhost.evil.example', 'http://a:b@localhost', 'http://localhost?key=x', 'http://localhost/api']) assert.throws(() => getApiTarget({ endpoint }));
});

test('all public static routes exclude backend code, secrets, artifacts and traversal', async t => {
  const { endpoint } = await setup(t);
  for (const path of ['/server/app.js', '/server/.secrets/google-key.dpapi', '/.env', '/.git/config', '/README.md', '/artifacts/preview.stdout.log', '/%2e%2e/server/app.js', '/%2e%2e%5cserver%5capp.js']) {
    const response = await fetch(endpoint + path); assert.equal(response.status, 404, path);
    assert.ok(!(await response.text()).includes(key));
  }
  const response = await fetch(endpoint + '/panel.html'); assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('session pairing requires exact UI origin and custom header; never returns Google key', async t => {
  const { endpoint } = await setup(t);
  for (const extra of [{}, { Origin: endpoint }, { Origin: 'https://evil.example', 'X-ClipBrief-UI': '1' }, { Origin: `chrome-extension://${'a'.repeat(32)}`, 'X-ClipBrief-UI': '1' }]) {
    const response = await fetch(endpoint + '/api/session', { method: 'POST', headers: extra }); assert.equal(response.status, 403);
  }
  const response = await fetch(endpoint + '/api/session', { method: 'POST', headers: { Origin: endpoint, 'X-ClipBrief-UI': '1' } });
  assert.equal(response.status, 200); const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ['model', 'ready', 'token']); assert.equal(data.token, token);
  assert.ok(!JSON.stringify(data).includes(key));
});

test('backend rejects unauthenticated requests, hostile Origin and DNS rebinding Host', async t => {
  let calls = 0;
  const { endpoint, post } = await setup(t, { runSummary: async () => { calls++; return summary; } });
  assert.equal((await post(payload(), { headers: { 'Content-Type': 'application/json' } })).status, 401);
  const hostile = await post(payload(), { headers: { ...headers, Origin: 'https://evil.example' } });
  assert.equal(hostile.status, 403); assert.equal(hostile.headers.get('access-control-allow-origin'), null);
  const status = await new Promise((resolve, reject) => {
    const req = http.get(endpoint + '/panel.html', { headers: { Host: 'rebound.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(status, 403); assert.equal(calls, 0);
});

test('authenticated extension CORS works but cannot change model, endpoint or send upstream credentials', async t => {
  const { post } = await setup(t);
  for (const [field, value] of [['config', { key }], ['model', 'evil'], ['endpoint', 'https://evil.example'], ['key', key]]) {
    assert.equal((await post({ ...payload(), [field]: value })).status, 400);
  }
  for (const data of [{ ...payload(), video: { ...video, url: 'https://evil.example' } }, { ...payload(), options: { language: 'bad', length: 'short' } }, { ...payload(), video: { ...video, segments: [{ start: -1, text: 'x'.repeat(40) }] } }, { ...payload(), video: { ...video, segments: [{ start: 0, text: 'x'.repeat(180001) }] } }]) assert.equal((await post(data)).status, 400);
  const origin = `chrome-extension://${'a'.repeat(32)}`;
  const response = await post(payload(), { headers: { ...headers, Origin: origin } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), origin);
  await response.text();
});

test('real local client/server boundary streams progress and uses upstream key only server-side', async t => {
  const { endpoint } = await setup(t, { runSummary: async (received, config, opts, { onProgress }) => {
    assert.deepEqual(received, video); assert.deepEqual(opts, options);
    assert.equal(config.key, key); assert.equal(config.model, 'gemma-4-26b-a4b-it');
    onProgress({ step: 1, total: 1, label: '處理中' }); return summary;
  } });
  const progress = [];
  const config = { endpoint, token, key: 'must-never-leave-the-client', model: 'client-override' };
  const result = await clientSummary({ ...video, url: 'do-not-send', tabId: 99 }, config, options, { onProgress: event => progress.push(event), fetcher: (url, init) => {
    assert.equal(url, endpoint + '/api/summarize'); assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.headers['x-goog-api-key'], undefined);
    assert.ok(!JSON.stringify(init).includes(config.key)); assert.ok(!init.body.includes(config.model)); assert.ok(!init.body.includes('do-not-send'));
    return fetch(url, init);
  } });
  assert.deepEqual(result, summary); assert.equal(progress.length, 1);
  assert.equal((await connectBackend(config)).ready, true);
});

test('missing server key disables connection and generation', async t => {
  const { endpoint, post } = await setup(t, { key: '' });
  assert.equal((await post()).status, 503);
  await assert.rejects(connectBackend({ endpoint, token }), /後端未設定/);
});

test('upstream error details are redacted and job rate limits apply', async t => {
  const { post } = await setup(t, { maxJobsPerHour: 1, runSummary: async () => { throw new Error(`private ${key}`); } });
  const response = await post(), body = await response.text();
  assert.ok(!body.includes(key)); assert.match(body, /後端未能完成摘要/);
  assert.equal((await post()).status, 429);
});

test('cancelling the client aborts upstream work and simultaneous jobs are rejected', async t => {
  let finish;
  const aborted = new Promise(resolve => { finish = resolve; });
  const { post } = await setup(t, { runSummary: (_video, _config, _options, { signal, onProgress }) => new Promise((resolve, reject) => {
    onProgress({ step: 1, total: 1, label: 'waiting' });
    signal.addEventListener('abort', () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
  }) });
  const controller = new AbortController();
  const response = await post(payload(), { signal: controller.signal });
  const reader = response.body.getReader(); await reader.read();
  assert.equal((await post()).status, 409);
  controller.abort(); await reader.cancel().catch(() => {});
  await Promise.race([aborted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Upstream did not abort')), 3000); timer.unref(); })]);
});

test('key setup is limited to authenticated same-origin UI and never returns the saved key', async t => {
  const synthetic = 'AIza' + 'k'.repeat(35); let saved = '';
  const { endpoint } = await setup(t, { key: '', saveKey: async value => { saved = value; return { storage: 'windows-encrypted' }; } });
  const body = JSON.stringify({ key: synthetic });
  for (const hdrs of [headers, { ...headers, Origin: endpoint }, { ...headers, Origin: `chrome-extension://${'a'.repeat(32)}`, 'X-ClipBrief-UI': '1' }, { Origin: endpoint, 'X-ClipBrief-UI': '1', 'Content-Type': 'application/json' }]) {
    const response = await fetch(endpoint + '/api/key', { method: 'POST', body, headers: hdrs });
    assert.ok([401,403].includes(response.status));
  }
  assert.equal(saved, '');
  const response = await fetch(endpoint + '/api/key', { method: 'POST', body, headers: { ...headers, Origin: endpoint, 'X-ClipBrief-UI': '1' } });
  assert.equal(response.status, 200); assert.equal(saved, synthetic);
  const result = await response.json(); assert.equal(result.storage, 'windows-encrypted'); assert.ok(!JSON.stringify(result).includes(synthetic));
  assert.equal((await connectBackend({ endpoint, token })).ready, true);
});

test('failed key persistence preserves the previous working configuration and redacts errors', async t => {
  const { endpoint, post } = await setup(t, { saveKey: async value => { throw new Error(value); }, runSummary: async (_video, config) => { assert.equal(config.key, key); return summary; } });
  const synthetic = 'AIza' + 'k'.repeat(35);
  const response = await fetch(endpoint + '/api/key', { method: 'POST', headers: { ...headers, Origin: endpoint, 'X-ClipBrief-UI': '1' }, body: JSON.stringify({ key: synthetic }) });
  assert.equal(response.status, 500); assert.ok(!(await response.text()).includes(synthetic));
  const generated = await post(); assert.equal(generated.status, 200); assert.match(await generated.text(), /測試摘要/);
});

test('key setup rejects extra parameters, invalid keys and oversized input before writing', async t => {
  let calls = 0;
  const { endpoint } = await setup(t, { saveKey: async () => { calls++; return { storage: 'memory' }; } });
  for (const body of [{ key: 'invalid' }, { key: 'AIza' + 'k'.repeat(35), endpoint: 'https://evil.example' }, { key: 'a'.repeat(2000) }]) {
    const response = await fetch(endpoint + '/api/key', { method: 'POST', headers: { ...headers, Origin: endpoint, 'X-ClipBrief-UI': '1' }, body: JSON.stringify(body) });
    assert.ok([400,413].includes(response.status));
  }
  assert.equal(calls, 0);
});

test('non-Windows setup uses backend memory instead of a plaintext credential file', async () => {
  assert.deepEqual(await saveBackendKey('AIza' + 'k'.repeat(35), { platform: 'linux' }), { storage: 'memory' });
  await assert.rejects(saveBackendKey('invalid', { platform: 'linux' }));
});

test('custom API settings are stored server-side, used for summaries and returned without credentials', async t => {
  const custom = { provider: 'openai', endpoint: 'https://custom.example/v1', model: 'organization/model', key: 'synthetic-custom-key', jsonMode: false };
  let saved;
  const { endpoint, post } = await setup(t, { saveConfig: async config => { saved = { ...config }; return { storage: 'memory' }; }, runSummary: async (_video, config) => { assert.equal(config.key, custom.key); assert.equal(config.model, custom.model); assert.equal(config.endpoint, custom.endpoint); return summary; } });
  const hdrs = { ...headers, Origin: endpoint, 'X-ClipBrief-UI': '1' };
  const response = await fetch(endpoint + '/api/provider', { method: 'POST', headers: hdrs, body: JSON.stringify(custom) });
  assert.equal(response.status, 200); assert.deepEqual(saved, custom); assert.ok(!(await response.text()).includes(custom.key));
  const settings = await fetch(endpoint + '/api/settings', { method: 'POST', headers: hdrs });
  const publicData = await settings.json(); assert.equal(publicData.model, custom.model); assert.equal(publicData.key, undefined);
  assert.equal((await connectBackend({ endpoint, token })).model, custom.model);
  const generated = await post(); assert.match(await generated.text(), /測試摘要/);
});

test('provider settings reject extension writes, remote cleartext, credential URLs and Google endpoint redirection', async t => {
  let calls = 0;
  const { endpoint } = await setup(t, { saveConfig: async () => { calls++; return { storage: 'memory' }; } });
  const base = { provider: 'openai', endpoint: 'https://provider.example/v1', model: 'model', key: 'synthetic-key' };
  const request = (data, origin = endpoint) => fetch(endpoint + '/api/provider', { method: 'POST', headers: { ...headers, Origin: origin, 'X-ClipBrief-UI': '1' }, body: JSON.stringify(data) });
  assert.equal((await request(base, `chrome-extension://${'a'.repeat(32)}`)).status, 403);
  for (const config of [{ ...base, endpoint: 'http://remote.example/v1' }, { ...base, endpoint: 'https://key:secret@remote.example/v1' }, { ...base, provider: 'google', key: 'AIza' + 'k'.repeat(35) }, { ...base, key: 'bad\nheader' }, { ...base, additional: true }]) assert.equal((await request(config)).status, 400);
  assert.equal(calls, 0);
});

test('a failed provider switch retains the previous model and key', async t => {
  const { endpoint } = await setup(t, { saveConfig: async () => { throw new Error('synthetic-private-detail'); } });
  const response = await fetch(endpoint + '/api/provider', { method: 'POST', headers: { ...headers, Origin: endpoint, 'X-ClipBrief-UI': '1' }, body: JSON.stringify({ provider: 'openai', endpoint: 'https://provider.example/v1', model: 'new-model', key: 'synthetic-key' }) });
  assert.equal(response.status, 500); assert.ok(!(await response.text()).includes('synthetic-private-detail'));
  assert.equal((await connectBackend({ endpoint, token })).model, 'gemma-4-26b-a4b-it');
});
