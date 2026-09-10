import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { chunkTranscript, MAX_TRANSCRIPT } from '../core.js';
import { summarize } from './summarizer.js';
import { DEFAULT_CONFIG, validateProviderConfig, publicProviderConfig } from './ai-provider.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new Set(['panel.html', 'panel.css', 'panel.js', 'api.js', 'providers.js', 'core.js', 'extractor.js', 'demo.js', 'video-button-bridge.js', 'action-bars-preview.html', 'action-bars-preview.css', 'action-bars-preview.js', 'action-button.js', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png']);
for (const asset of ['setup.html', 'setup.css', 'setup.js', 'inline-summary.js', 'comments-preview.html', 'comments-preview.css', 'comments-preview.js']) assets.add(asset);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
const MAX_BODY = 1500000;
const extensionOrigin = value => /^chrome-extension:\/\/[a-p]{32}$/.test(value || '');
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const fail = (status, message) => Object.assign(new Error(message), { status });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));

export function validatePayload(payload) {
  if (!exactKeys(payload, ['video', 'options']) || !exactKeys(payload.video, ['title', 'segments']) || !exactKeys(payload.options, ['language', 'length'])) throw fail(400, '摘要資料格式無效。');
  const { video, options } = payload;
  if (typeof video.title !== 'string' || video.title.length > 500 || !Array.isArray(video.segments) || !video.segments.length || video.segments.length > 20000) throw fail(400, '影片資料無效或太長。');
  let length = 0;
  for (const s of video.segments) {
    if (!exactKeys(s, ['start', 'text']) || typeof s.text !== 'string' || !(s.start === null || typeof s.start === 'number' && Number.isFinite(s.start) && s.start >= 0 && s.start < 1e8)) throw fail(400, '字幕格式無效。');
    length += s.text.length;
  }
  if (length < 40 || length > MAX_TRANSCRIPT) throw fail(400, '字幕須介乎 40 至 180,000 字元。');
  if (!['zh-Hant', 'yue', 'en'].includes(options.language) || !['short', 'standard', 'detailed'].includes(options.length)) throw fail(400, '摘要選項無效。');
  chunkTranscript(video.segments);
  return { video, options };
}

async function readJson(req, limit = MAX_BODY) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, '請使用 JSON。');
  if (Number(req.headers['content-length']) > limit) throw fail(413, '請求內容太大。');
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw fail(413, '請求內容太大。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'JSON 格式無效。'); }
}

export function createBackend({ key = '', providerConfig = null, token = randomBytes(32).toString('hex'), runSummary = summarize, maxJobsPerHour = 30, saveKey = null, saveConfig = null } = {}) {
  const config = providerConfig ? validateProviderConfig(providerConfig) : { ...DEFAULT_CONFIG, key };
  const expectedToken = Buffer.from(`Bearer ${token}`);
  const authorized = req => {
    const actual = Buffer.from(req.headers.authorization || '');
    return actual.length === expectedToken.length && timingSafeEqual(actual, expectedToken);
  };
  let active = false, updatingKey = false, recent = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:*; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
    try {
      const port = server.address()?.port;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return json(res, 403, { error: '來源無效。' });
      const origin = req.headers.origin;
      const sameOrigin = origin === `http://${req.headers.host}`;
      const ownUi = sameOrigin && req.headers['x-clipbrief-ui'] === '1';
      if (origin && !sameOrigin && !extensionOrigin(origin)) return json(res, 403, { error: '來源無效。' });
      const path = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (path.startsWith('/api/')) {
        if (origin && (sameOrigin || extensionOrigin(origin))) {
          res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        }
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'POST');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ClipBrief-UI');
          res.writeHead(204).end(); return;
        }
        if (req.method !== 'POST') return json(res, 405, { error: '請使用 POST。' });
        if (path === '/api/session') {
          if (!ownUi) return json(res, 403, { error: '請喺本機預覽頁取得連線碼。' });
          return json(res, 200, { token, model: config.model, ready: !!config.key });
        }
        if (!authorized(req)) return json(res, 401, { error: '連線碼無效。' });
        if (path === '/api/settings') {
          if (!ownUi) return json(res, 403, { error: '只可喺本機後端設定頁讀取供應商設定。' });
          return json(res, 200, publicProviderConfig(config));
        }
        if (path === '/api/provider') {
          if (!ownUi) return json(res, 403, { error: '只可喺本機後端設定頁修改供應商。' });
          if (!saveConfig) return json(res, 503, { error: '後端未啟用供應商設定。' });
          const payload = await readJson(req, 8192);
          if (!exactKeys(payload, ['provider', 'endpoint', 'model', 'key', 'jsonMode'])) throw fail(400, '供應商資料格式無效。');
          let next;
          try { next = validateProviderConfig(payload); } catch (error) { throw fail(400, error.message); }
          if (active || updatingKey) return json(res, 409, { error: '後端忙碌中，請稍後再設定。' });
          updatingKey = true;
          try {
            const saved = await saveConfig(next);
            Object.assign(config, next);
            return json(res, 200, { ...publicProviderConfig(config), storage: saved.storage });
          } catch { return json(res, 500, { error: '未能安全保存設定，原有供應商及 Key 未有更改。' }); }
          finally { payload.key = ''; next.key = ''; updatingKey = false; }
        }
        if (path === '/api/key') {
          if (!ownUi) return json(res, 403, { error: '只可喺本機後端設定頁修改金鑰。' });
          if (!saveKey) return json(res, 503, { error: '後端未啟用金鑰設定。' });
          const payload = await readJson(req, 1024);
          if (!exactKeys(payload, ['key']) || typeof payload.key !== 'string' || !/^AIza[\w-]{35}$/.test(payload.key)) return json(res, 400, { error: 'Google API Key 格式無效。' });
          if (active || updatingKey) return json(res, 409, { error: '後端忙碌中，請稍後再設定。' });
          updatingKey = true;
          try {
            const result = await saveKey(payload.key);
            config.key = payload.key;
            return json(res, 200, { ready: true, model: config.model, storage: result.storage });
          } catch { return json(res, 500, { error: '未能安全保存金鑰，原有設定未有更改。' }); }
          finally { payload.key = ''; updatingKey = false; }
        }
        if (path === '/api/connection') return json(res, config.key ? 200 : 503, { model: config.model, ready: !!config.key });
        if (path !== '/api/summarize') return json(res, 404, { error: '找不到服務。' });
        if (!config.key) return json(res, 503, { error: '請喺後端設定 API Key。' });
        const { video, options } = validatePayload(await readJson(req));
        if (active || updatingKey) return json(res, 409, { error: '後端忙碌中。' });
        recent = recent.filter(time => Date.now() - time < 3600000);
        if (recent.length >= maxJobsPerHour) return json(res, 429, { error: '請求太頻密。' });
        active = true; recent.push(Date.now());
        const controller = new AbortController();
        const abort = () => controller.abort();
        res.on('close', abort);
        const write = event => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' }); res.flushHeaders();
        try {
          const summary = await runSummary(video, config, options, { signal: controller.signal, onProgress: progress => write({ type: 'progress', progress }) });
          controller.signal.throwIfAborted(); write({ type: 'result', summary });
        } catch (error) {
          // Never forward raw exceptions, upstream bodies, URLs or credentials to clients/logs.
          const status = /^API 錯誤 (\d{3})/.exec(error.message || '')?.[1];
          const message = status ? `AI API 回應 ${status}，請喺後端檢查金鑰、模型權限或額度。` : error.name === 'AbortError' ? '已取消生成。' : '後端未能完成摘要，請稍後再試或縮短字幕。';
          write({ type: 'error', message });
        } finally { res.off('close', abort); active = false; if (!res.destroyed) res.end(); }
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
      const file = decodeURIComponent(path === '/' ? '/panel.html' : path).slice(1);
      if (!assets.has(file)) return json(res, 404, { error: 'Not found' });
      const content = await readFile(resolve(root, file));
      res.writeHead(200, { 'Content-Type': mime[extname(file)] }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : '後端暫時無法處理。' });
      else if (!res.destroyed) res.end();
    }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  return server;
}
