import { normalizeSummary } from './core.js';
import { getApiTarget } from './providers.js';

const headers = config => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` });
const hints = { 401: '連線碼無效，請從後端預覽頁重新複製。', 403: '後端拒絕呢個來源。', 409: '後端正在處理另一份摘要，請稍後再試。', 429: '請求太頻密，請稍後再試。', 503: '後端未設定 API Key，請喺後端設定。' };

export async function connectBackend(config, fetcher = fetch) {
  const { base } = getApiTarget(config);
  const response = await fetcher(`${base}/api/connection`, { method: 'POST', headers: headers(config), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(hints[response.status] || '未能連接後端。');
  return response.json();
}

export async function getLocalSession(base, fetcher = fetch) {
  getApiTarget({ endpoint: base });
  const response = await fetcher(`${base}/api/session`, { method: 'POST', headers: { 'X-ClipBrief-UI': '1' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('未能連接本機後端，請確認服務已啟動。');
  return response.json();
}

export async function summarize(video, config, options, { signal, onProgress = () => {}, fetcher = fetch } = {}) {
  if (!config.token) throw new Error('請先連接本機後端。');
  const timeout = AbortSignal.timeout(1800000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetcher(getApiTarget(config).url, {
    method: 'POST', headers: headers(config), credentials: 'omit', redirect: 'error', signal: combined,
    body: JSON.stringify({ video: { title: video.title, segments: video.segments.map(({ start, text }) => ({ start, text })) }, options: { language: options.language, length: options.length } })
  });
  if (!response.ok) throw new Error(hints[response.status] || `後端未能處理摘要（${response.status}）。`);
  if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) throw new Error('後端回應格式無效。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', size = 0;
  try {
    while (true) {
      combined.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1000000) throw new Error('後端回應太大。');
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'progress') onProgress(event.progress);
        if (event.type === 'error') throw new Error(String(event.message || '後端生成失敗。').slice(0, 300));
        if (event.type === 'result') return normalizeSummary(event.summary, video.segments);
      }
    }
    throw new Error('後端連線中斷，未收到完整摘要。');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
