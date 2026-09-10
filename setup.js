import { getLocalSession } from './api.js';
const $ = id => document.getElementById(id);
let token = '';
const googleBase = 'https://generativelanguage.googleapis.com/v1beta';
const status = (id, text, error = false) => { $(id).textContent = text; $(id).classList.toggle('error', error); };
const authHeaders = () => ({ 'Content-Type': 'application/json', 'X-ClipBrief-UI': '1', Authorization: `Bearer ${token}` });
function providerFields(reset = false) {
  const google = $('provider').value === 'google';
  $('api-endpoint').readOnly = google;
  document.querySelector('.help-link').hidden = !google;
  $('provider-help').textContent = google ? 'Google 使用原生 Gemini API，可自行填入 Gemma 或 Gemini 模型 ID。' : '使用 Chat Completions 格式。自訂服務請填入供應商提供嘅 API 基底網址及模型 ID；切換供應商時需重新輸入對應 Key。';
  if (reset) {
    $('api-endpoint').value = google ? googleBase : $('provider').value === 'openai' ? 'https://api.openai.com/v1' : '';
    $('api-model').value = google ? 'gemma-4-26b-a4b-it' : '';
    $('google-key').value = ''; $('json-mode').checked = false;
  }
}
async function initialize() {
  try {
    const session = await getLocalSession(location.origin); token = session.token;
    const response = await fetch('/api/settings', { method: 'POST', headers: authHeaders(), credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('Settings unavailable');
    const settings = await response.json();
    $('provider').value = settings.provider === 'google' ? 'google' : settings.endpoint === 'https://api.openai.com/v1' ? 'openai' : 'custom';
    $('api-endpoint').value = settings.endpoint; $('api-model').value = settings.model; $('json-mode').checked = settings.jsonMode;
    $('current-model').textContent = settings.model;
    providerFields();
    status('key-status', session.ready ? '後端已有設定。更新供應商或模型時，請重新輸入對應 API Key。' : '未設定 API Key，請喺下方輸入。');
    $('save-key').disabled = false; $('copy-token').disabled = !session.ready;
  } catch { status('key-status', '未能連接本機後端。請先啟動最新版後端，再重新載入呢頁。', true); }
}
$('provider').addEventListener('change', () => providerFields(true));
$('key-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!token) return;
  const config = { provider: $('provider').value === 'google' ? 'google' : 'openai', endpoint: $('api-endpoint').value.trim(), model: $('api-model').value.trim(), key: $('google-key').value.trim(), jsonMode: $('json-mode').checked };
  if (!config.key || (config.provider === 'google' && !/^AIza[\w-]{35}$/.test(config.key))) { status('save-status', '請填入所選供應商嘅有效 API Key。', true); return; }
  $('google-key').value = ''; $('save-key').disabled = true; status('save-status', '正在安全保存供應商設定…');
  try {
    const pending = fetch('/api/provider', { method: 'POST', headers: authHeaders(), body: JSON.stringify(config), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
    config.key = '';
    const response = await pending, result = await response.json();
    if (!response.ok) throw new Error(result.error || '後端未能保存設定。');
    status('save-status', result.storage === 'windows-encrypted' ? '供應商設定同 Key 已加密儲存喺本機後端，立即生效。' : '設定已保留喺後端記憶體，後端關閉後需重新輸入。');
    status('key-status', '設定已保存。可以複製連線碼，或者生成摘要測試模型權限。');
    $('current-model').textContent = result.model; $('copy-token').disabled = false;
  } catch (error) { status('save-status', error instanceof TypeError || error.name === 'TimeoutError' ? '連線未完成。請重新載入頁面確認設定狀態。' : error.message, true); }
  finally { config.key = ''; $('google-key').value = ''; $('save-key').disabled = false; }
});
$('copy-token').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(token); status('copy-status', '已複製，請貼到 Chrome 片刻插件嘅後端設定。'); }
  catch { status('copy-status', '未獲剪貼簿權限，請容許呢個本機頁面使用剪貼簿後再試。', true); }
});
window.addEventListener('pagehide', () => { $('google-key').value = ''; token = ''; });
initialize();
