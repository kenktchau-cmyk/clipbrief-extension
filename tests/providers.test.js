import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, GEMMA_MODEL, GOOGLE_API_BASE, getApiTarget, buildApiRequest, readCompletion, restoreConfig } from '../server/ai-provider.js';
import { summarize } from '../server/summarizer.js';
import { demoVideo } from '../demo.js';

const config = { ...DEFAULT_CONFIG, key: 'synthetic-google-test-key' };
const messages = [{ role: 'system', content: 'Summarize safely as JSON.' }, { role: 'user', content: 'Untrusted transcript.' }];

test('Gemma preset uses the exact requested model and no embedded key', () => {
  assert.equal(DEFAULT_CONFIG.model, 'gemma-4-26b-a4b-it');
  assert.equal(DEFAULT_CONFIG.key, ''); assert.equal(DEFAULT_CONFIG.remember, false);
  assert.deepEqual(getApiTarget(config), { url: `${GOOGLE_API_BASE}/models/${GEMMA_MODEL}:generateContent`, origin: 'https://generativelanguage.googleapis.com/*' });
});
test('Google credentials cannot be redirected through a custom endpoint or model path', () => {
  for (const endpoint of ['https://attacker.example/v1beta', 'https://generativelanguage.googleapis.com.evil.test/v1beta', GOOGLE_API_BASE + '?key=x']) assert.throws(() => getApiTarget({ ...config, endpoint }), /官方/);
  for (const model of ['../other', 'gemma?key=x', 'gemma#x', 'a/b', '']) assert.throws(() => getApiTarget({ ...config, model }), /模型/);
  assert.equal(getApiTarget({ ...config, model: `models/${GEMMA_MODEL}` }).url, getApiTarget(config).url);
});
test('native Google request authenticates by header, separates instructions, and disables thinking for Gemma', () => {
  const request = buildApiRequest(config, messages);
  assert.equal(request.headers['x-goog-api-key'], config.key); assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.body.systemInstruction.parts[0].text, messages[0].content);
  assert.equal(request.body.contents[0].role, 'user');
  assert.equal(request.body.contents[0].parts[0].text, messages[1].content);
  assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(request.body.generationConfig.responseMimeType, undefined);
  assert.ok(!request.url.includes(config.key)); assert.ok(!JSON.stringify(request.body).includes(config.key));
});
test('Google JSON mode is explicitly opt-in and maps to responseMimeType', () => {
  const request = buildApiRequest({ ...config, jsonMode: true }, messages);
  assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(request.body.response_format, undefined);
});
test('Google responses exclude thinking and reject blocked or truncated text', () => {
  const response = { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'Internal thought' }, { text: '{"brief":' }, { text: '"Answer"}' }] } }] };
  assert.equal(readCompletion(config, response), '{"brief":"Answer"}');
  assert.throws(() => readCompletion(config, { promptFeedback: { blockReason: 'SAFETY' } }), /未能處理/);
  assert.throws(() => readCompletion(config, { candidates: [{ finishReason: 'MAX_TOKENS' }] }), /未完成/);
  assert.throws(() => readCompletion(config, { candidates: [{ finishReason: 'SAFETY' }] }), /未能完成/);
  assert.throws(() => readCompletion(config, { candidates: [] }), /未有回傳/);
});
test('upgrade keeps old OpenAI configurations and session versus remembered key behavior', () => {
  const saved = { endpoint: 'https://custom.example/v1', model: 'old-model', key: 'saved-key', remember: false, jsonMode: true };
  const restored = restoreConfig(saved, 'session-key');
  assert.equal(restored.provider, 'openai'); assert.equal(restored.key, 'session-key'); assert.equal(restored.model, 'old-model');
  assert.equal(restoreConfig({ ...saved, remember: true }, 'session-key').key, 'saved-key');
  assert.equal(restoreConfig(saved).key, ''); assert.equal(restoreConfig(null).provider, 'google');
});
test('full summary flow accepts Google candidates through the existing schema validator', async () => {
  let calls = 0;
  const result = await summarize(demoVideo, config, { language: 'yue', length: 'short' }, { fetcher: async (url, options) => {
    calls++; assert.equal(url, getApiTarget(config).url); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body); assert.match(body.systemInstruction.parts[0].text, /香港粵語/);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ brief: '減少干擾有助專注。', keyPoints: ['關閉通知。'], chapters: [{ start: 94, title: '減少干擾', description: '' }] }) }] } }] }));
  } });
  assert.equal(calls, 1); assert.equal(result.chapters[0].start, 94); assert.equal(result.keyPoints.length, 1);
});

