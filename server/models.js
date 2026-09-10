import { GOOGLE_API_BASE, getApiTarget, validateProviderConfig } from './ai-provider.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const service = config => `${config.provider}:${getApiTarget({ ...config, model: 'model' }).url}`;

// A saved credential belongs to one exact API service, including its base path.
export function resolveProviderConfig(input, current) {
  let key = input.key;
  if (key === '' || key === undefined) {
    if (!current.key || service(input) !== service(current)) throw new Error('呢個 API 需要輸入對應嘅 Key，唔會沿用其他服務嘅金鑰。');
    key = current.key;
  }
  return validateProviderConfig({ ...input, key });
}

async function readCatalog(response) {
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw fail(502, 'API 拒絕讀取模型，請檢查 Key 同帳戶權限。');
    if ([404, 405].includes(response.status)) throw fail(502, '呢個 API 未提供模型清單，請手動輸入模型 ID。');
    throw fail(502, `模型清單 API 回應 ${response.status}，請稍後再試或手動輸入。`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw fail(502, 'API 未回傳模型清單。');
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw fail(502, '模型清單太大，請手動輸入模型 ID。');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail(502, '模型清單格式不相容，請手動輸入模型 ID。'); }
  } finally { await reader.cancel().catch(() => {}); }
}

export async function listModels(config, { fetcher = fetch, signal, timeoutMs = 20000 } = {}) {
  const google = config.provider === 'google';
  const base = google ? `${GOOGLE_API_BASE}/models` : getApiTarget(config).url.replace(/\/chat\/completions$/, '/models');
  const headers = google ? { 'x-goog-api-key': config.key } : { Authorization: `Bearer ${config.key}` };
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const models = new Map(), cursors = new Set(); let cursor = '', truncated = false;
  try {
    for (let page = 0; page < 10; page++) {
      const url = new URL(base);
      if (google) { url.searchParams.set('pageSize', '1000'); if (cursor) url.searchParams.set('pageToken', cursor); }
      const response = await fetcher(url.href, { method: 'GET', headers, credentials: 'omit', redirect: 'error', signal: requestSignal });
      const data = await readCatalog(response);
      const items = google ? data?.models : data?.data;
      if (!Array.isArray(items)) throw fail(502, '模型清單格式不相容，請手動輸入模型 ID。');
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (google && (!Array.isArray(item.supportedGenerationMethods) || !item.supportedGenerationMethods.includes('generateContent'))) continue;
        const modalities = item.architecture?.output_modalities;
        if (!google && Array.isArray(modalities) && !modalities.includes('text')) continue;
        const id = google ? (typeof item.name === 'string' ? item.name.replace(/^models\//, '') : '') : item.id;
        if (typeof id !== 'string' || !/^[\w./:-]{1,160}$/.test(id)) continue;
        if (google && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) continue;
        if (models.size >= 5000 && !models.has(id)) { truncated = true; break; }
        const label = google ? item.displayName : item.name;
        models.set(id, { id, name: typeof label === 'string' ? label.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) : id });
      }
      cursor = google ? data.nextPageToken : '';
      if (!cursor || truncated) break;
      if (typeof cursor !== 'string' || cursor.length > 4096 || cursors.has(cursor)) throw fail(502, '模型清單分頁無效，請手動輸入模型 ID。');
      cursors.add(cursor);
      if (page === 9) truncated = true;
    }
    requestSignal.throwIfAborted();
    return { models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)), truncated };
  } catch (error) {
    if (error.status) throw error;
    if (requestSignal.aborted) throw fail(504, '讀取模型清單已取消或逾時，可以重試或手動輸入。');
    throw fail(502, '未能讀取模型清單，請檢查 API 網址，或者手動輸入模型 ID。');
  }
}
