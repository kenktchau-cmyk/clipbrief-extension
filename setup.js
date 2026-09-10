import { getLocalSession } from './api.js';
import { validateEndpoint } from './core.js';
const $ = id => document.getElementById(id);
let token = '';
let savedSettings = null, lookup = null, revision = 0, saving = false;
const googleBase = 'https://generativelanguage.googleapis.com/v1beta';
const status = (id, text, error = false) => { $(id).textContent = text; $(id).classList.toggle('error', error); };
const authHeaders = () => ({ 'Content-Type': 'application/json', 'X-ClipBrief-UI': '1', Authorization: `Bearer ${token}` });
const provider = () => $('provider').value === 'google' ? 'google' : 'openai';
function canReuseKey() {
  if (!savedSettings?.ready || savedSettings.provider !== provider()) return false;
  try {
    return provider() === 'google' ? $('api-endpoint').value.trim().replace(/\/+$/, '') === googleBase : validateEndpoint($('api-endpoint').value.trim()).url === validateEndpoint(savedSettings.endpoint).url;
  } catch { return false; }
}
function keyHint() {
  const reuse = canReuseKey();
  $('google-key').required = !reuse;
  $('google-key').placeholder = reuse ? '留空沿用後端已儲存嘅 Key' : '貼上所選供應商嘅 API Key';
}
function manualModel() {
  $('api-model').readOnly = !!$('available-models').value;
  $('model-label').textContent = $('available-models').value ? '已選模型 ID' : '模型 ID（手動輸入）';
}
function resetModels() {
  revision++; lookup?.abort(); lookup = null;
  $('available-models').replaceChildren(new Option('手動輸入模型 ID…', ''));
  manualModel(); keyHint(); $('load-models').disabled = !token || saving;
  status('models-status', '按「讀取可用模型」，由你嘅 API 取得清單。');
}
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
  keyHint();
}
async function initialize() {
  try {
    const session = await getLocalSession(location.origin); token = session.token;
    const response = await fetch('/api/settings', { method: 'POST', headers: authHeaders(), credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('Settings unavailable');
    const settings = await response.json(); savedSettings = settings;
    $('provider').value = settings.provider === 'google' ? 'google' : settings.endpoint === 'https://api.openai.com/v1' ? 'openai' : 'custom';
    $('api-endpoint').value = settings.endpoint; $('api-model').value = settings.model; $('json-mode').checked = settings.jsonMode;
    $('current-model').textContent = settings.model;
    providerFields();
    status('key-status', session.ready ? '後端已有設定。同一 API 可留空 Key，直接讀取清單或更換模型。' : '未設定 API Key，請喺下方輸入。');
    $('save-key').disabled = false; $('load-models').disabled = false; $('copy-token').disabled = !session.ready;
  } catch { status('key-status', '未能連接本機後端。請先啟動最新版後端，再重新載入呢頁。', true); }
}
$('provider').addEventListener('change', () => { providerFields(true); resetModels(); });
for (const id of ['api-endpoint', 'google-key']) $(id).addEventListener('input', resetModels);
$('available-models').addEventListener('change', () => {
  if ($('available-models').value) $('api-model').value = $('available-models').value;
  manualModel();
});
$('load-models').addEventListener('click', async () => {
  if (!token || saving) return;
  const config = { provider: provider(), endpoint: $('api-endpoint').value.trim(), key: $('google-key').value.trim() };
  if (!config.key && !canReuseKey()) { status('models-status', '請先填入呢個 API 嘅 Key。', true); $('google-key').focus(); return; }
  lookup?.abort(); const controller = new AbortController(); lookup = controller;
  const currentRevision = ++revision;
  $('load-models').disabled = true; status('models-status', '正在由後端讀取模型清單…');
  try {
    const pending = fetch('/api/models', { method: 'POST', headers: authHeaders(), body: JSON.stringify(config), credentials: 'omit', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
    config.key = '';
    const response = await pending, result = await response.json();
    if (revision !== currentRevision) return;
    if (!response.ok) throw new Error(result.error || '未能讀取模型清單。');
    const entered = $('api-model').value.trim();
    const selected = provider() === 'google' ? entered.replace(/^models\//, '') : entered;
    const options = [new Option('手動輸入模型 ID…', '')];
    for (const model of result.models) options.push(new Option(model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id, model.id));
    $('available-models').replaceChildren(...options);
    $('available-models').value = result.models.some(model => model.id === selected) ? selected : '';
    if ($('available-models').value) $('api-model').value = selected;
    manualModel();
    status('models-status', result.models.length ? `已讀取 ${result.models.length} 個模型${result.truncated ? '（部分清單）' : ''}，請揀選後儲存。` : 'API 未列出適用模型，可以手動輸入模型 ID。');
  } catch (error) {
    if (revision === currentRevision) {
      $('available-models').replaceChildren(new Option('手動輸入模型 ID…', '')); manualModel();
      status('models-status', error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name) ? '讀取失敗或逾時，可以重試或者手動輸入模型 ID。' : error.message, true);
    }
  } finally { config.key = ''; if (revision === currentRevision) { lookup = null; $('load-models').disabled = false; } }
});
$('key-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!token) return;
  const config = { provider: $('provider').value === 'google' ? 'google' : 'openai', endpoint: $('api-endpoint').value.trim(), model: $('api-model').value.trim(), key: $('google-key').value.trim(), jsonMode: $('json-mode').checked };
  if ((!config.key && !canReuseKey()) || (config.key && config.provider === 'google' && !/^AIza[\w-]{35}$/.test(config.key))) { status('save-status', '請填入所選供應商嘅有效 API Key。', true); return; }
  saving = true; revision++; lookup?.abort(); lookup = null;
  for (const id of ['provider', 'api-endpoint', 'api-model', 'google-key', 'json-mode', 'available-models', 'load-models']) $(id).disabled = true;
  $('google-key').value = ''; $('save-key').disabled = true; status('save-status', '正在安全保存供應商設定…');
  try {
    const pending = fetch('/api/provider', { method: 'POST', headers: authHeaders(), body: JSON.stringify(config), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
    config.key = '';
    const response = await pending, result = await response.json();
    if (!response.ok) throw new Error(result.error || '後端未能保存設定。');
    savedSettings = result; keyHint();
    status('save-status', result.storage === 'windows-encrypted' ? '供應商設定同 Key 已加密儲存喺本機後端，立即生效。' : '設定已保留喺後端記憶體，後端關閉後需重新輸入。');
    status('key-status', '設定已保存。可以複製連線碼，或者生成摘要測試模型權限。');
    $('current-model').textContent = result.model; $('copy-token').disabled = false;
  } catch (error) { status('save-status', error instanceof TypeError || error.name === 'TimeoutError' ? '連線未完成。請重新載入頁面確認設定狀態。' : error.message, true); }
  finally {
    config.key = ''; $('google-key').value = ''; $('save-key').disabled = false; saving = false;
    for (const id of ['provider', 'api-endpoint', 'api-model', 'google-key', 'json-mode', 'available-models', 'load-models']) $(id).disabled = false;
    keyHint();
  }
});
$('copy-token').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(token); status('copy-status', '已複製，請貼到 Chrome 片刻插件嘅後端設定。'); }
  catch { status('copy-status', '未獲剪貼簿權限，請容許呢個本機頁面使用剪貼簿後再試。', true); }
});
window.addEventListener('pagehide', () => { revision++; lookup?.abort(); $('google-key').value = ''; token = ''; });
initialize();
