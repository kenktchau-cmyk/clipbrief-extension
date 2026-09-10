import { formatTime, normalizeSegments, parseCaptions, transcriptLength, chunkTranscript, summaryMarkdown } from './core.js';
import { extractVideo, seekVideo } from './extractor.js';
import { summarize, connectBackend, getLocalSession } from './api.js';
import { demoVideo, demoSummary } from './demo.js';
import { REQUEST_PREFIX, HANDLED_PREFIX, isSupportedVideoUrl } from './video-button-bridge.js';
import { DEFAULT_CONFIG, getApiTarget, restoreConfig } from './providers.js';

const $ = id => document.getElementById(id);
const extension = !!globalThis.chrome?.runtime?.id;
let config = { ...DEFAULT_CONFIG };
let video = null, summary = null, isDemo = false, busy = false, dirty = false;
let summaryIsDemo = false;
let length = 'standard', controller = null;
let panelWindowId = null, queuedVideoRequest = null, handledRequestId = null, latestRequestTime = 0;

function receiveVideoRequest(request) {
  if (!request || request.windowId !== panelWindowId || !Number.isInteger(request.tabId) || typeof request.id !== 'string' || request.id === handledRequestId || request.id === queuedVideoRequest?.id || !isSupportedVideoUrl(request.url)) return;
  if (!Number.isFinite(request.createdAt) || request.createdAt <= latestRequestTime || Date.now() - request.createdAt > 60000 || request.createdAt > Date.now() + 1000) return;
  latestRequestTime = request.createdAt;
  queuedVideoRequest = request;
  drainVideoRequest();
}

async function drainVideoRequest() {
  // Finish existing work and let the user finish editing settings before changing videos.
  if (!queuedVideoRequest || busy || $('settings').open) return;
  const request = queuedVideoRequest;
  queuedVideoRequest = null; handledRequestId = request.id; busy = true;
  try {
    await chrome.storage.session.set({ [`${HANDLED_PREFIX}${panelWindowId}`]: request.id });
    await capture(request);
  } catch { busy = false; notice('未能載入所選影片，請按「擷取目前影片」重試。', 'error'); refresh(); }
}

function optionalApiOrigins(origins) {
  const required = chrome.runtime.getManifest().host_permissions ?? [];
  return origins.filter(origin => !required.includes(origin));
}

function notice(message = '', kind = '') { $('notice').textContent = message; $('notice').className = `notice ${kind}`; $('notice').hidden = !message; }
function refresh() {
  const count = transcriptLength(video?.segments ?? []);
  $('generate').disabled = busy || dirty || count < 40;
  $('generate-label').textContent = isDemo ? '用我的 AI 試摘要' : '生成影片摘要';
  $('ai-status').textContent = `${config.model} · ${config.token ? '已連接後端 · 金鑰留喺後端' : '尚未連接後端'}`;
  for (const id of ['capture', 'apply-transcript', 'subtitle-file', 'demo', 'language', 'transcript', 'settings-open']) $(id).disabled = busy;
  document.querySelectorAll('[data-length]').forEach(el => { el.disabled = busy; });
  $('cancel').hidden = !controller;
  $('generate').hidden = !!controller;
  $('transcript-count').textContent = count ? `${count.toLocaleString()} 字元 · ${video.segments.length.toLocaleString()} 段${dirty ? ' · 有未套用修改' : ''}` : '';
  if (count >= 40) {
    try {
      const chunks = chunkTranscript(video.segments);
      const calls = chunks.length > 1 ? chunks.length + 1 : 1;
      const host = new URL(config.endpoint).host;
      $('send-note').textContent = `按下生成，會經本機後端 ${host} 將${isDemo ? '示範' : '影片'}標題同字幕交畀已設定嘅 AI · 預計 ${calls} 次 AI 請求`;
    } catch (error) { $('generate').disabled = true; $('send-note').textContent = error.message; }
  } else $('send-note').textContent = '準備好字幕，再交畀你選擇嘅 AI 整理。';
  drainVideoRequest();
}
function clearResults() { summary = null; $('results').hidden = true; }
function renderVideo() {
  $('video-title').textContent = video?.title || '由一條影片開始';
  $('video-site').textContent = video?.site || '目前分頁';
  $('video-duration').textContent = video?.duration ? formatTime(video.duration) : '片刻';
  $('video-state').textContent = isDemo ? '示範內容' : video?.segments.length ? '字幕已就緒' : '未有字幕';
  $('video-hint').textContent = video?.source || '未發現可讀字幕，可以喺下方貼上或匯入。';
  $('source-label').textContent = video?.source || '支援純文字、SRT、VTT 及字幕 JSON。';
  $('transcript').value = (video?.segments ?? []).map(s => `${s.start !== null ? `[${formatTime(s.start)}] ` : ''}${s.text}`).join('\n');
  dirty = false; refresh();
}
function selectTab(name) {
  for (const button of document.querySelectorAll('[data-tab]')) {
    const selected = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    $(`${button.dataset.tab}-panel`).hidden = !selected;
  }
}
function renderSummary(result, sample = isDemo) {
  summary = result;
  summaryIsDemo = sample;
  $('brief').textContent = result.brief;
  $('points').replaceChildren(...result.keyPoints.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  $('chapter-count').textContent = String(result.chapters.length);
  const nodes = result.chapters.map(chapter => {
    const row = document.createElement('div'); row.className = 'chapter';
    const button = document.createElement('button'); button.textContent = formatTime(chapter.start);
    button.setAttribute('aria-label', `跳到 ${formatTime(chapter.start)} ${chapter.title}`);
    button.addEventListener('click', () => jump(chapter.start));
    const text = document.createElement('div'), title = document.createElement('h3'), description = document.createElement('p');
    title.textContent = chapter.title; description.textContent = chapter.description;
    text.append(title, description); row.append(button, text); return row;
  });
  if (!nodes.length) { const p = document.createElement('p'); p.className = 'timeline-hint'; p.textContent = '未有可核對嘅時間標記，所以呢份摘要冇時間軸。'; nodes.push(p); }
  $('chapters').replaceChildren(...nodes);
  $('result-badge').textContent = sample ? '內置示範' : isDemo ? 'AI 實測' : '已完成';
  $('results').hidden = false; selectTab('summary');
}

async function capture(source = null) {
  if (!extension) return notice('呢個係介面預覽。請將擴充功能載入 Chrome，再喺影片頁按工具列圖示。');
  busy = true; isDemo = false; video = null; clearResults(); renderVideo(); notice('正在讀取目前影片嘅字幕…');
  try {
    const tab = source ? await chrome.tabs.get(source.tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id) throw new Error('請先開啟影片分頁。');
    if (source && (tab.windowId !== source.windowId || tab.url !== source.url)) throw new Error('你撳選嘅影片頁面已切換，請喺新影片再按「片刻摘要」。');
    if (tab.url && !/^https?:/.test(tab.url)) throw new Error('呢個頁面唔支援擷取。請開啟一般影片網站，再按工具列嘅片刻圖示。');
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: extractVideo });
    if (!injection?.result) throw new Error('未能讀取頁面，請重新按工具列嘅片刻圖示再試。');
    const data = injection.result;
    if (source && data.url !== source.url) throw new Error('影片已切換，請再按影片下方嘅「片刻摘要」。');
    const segments = data.raw ? parseCaptions(data.raw) : normalizeSegments(data.segments);
    video = { title: String(data.title || '未命名影片').slice(0, 500), url: data.url, duration: data.duration, site: data.site, source: data.source, segments, tabId: tab.id };
    renderVideo();
    if (transcriptLength(segments) >= 40) notice(data.note || '字幕已就緒。你可以先喺下方檢視，再生成摘要。', 'success');
    else { notice(data.note || '未讀到足夠字幕，請貼上或匯入逐字稿。'); $('transcript-details').open = true; }
  } catch (error) {
    const message = /Cannot access|Missing host permission|Cannot script|No tab with id/i.test(error.message) ? '未有呢個分頁嘅存取權。請喺影片分頁重新按 Chrome 工具列嘅片刻圖示，再擷取。' : error.message;
    notice(message, 'error'); $('transcript-details').open = true;
  } finally { busy = false; refresh(); }
}

function applyTranscript() {
  try {
    const segments = parseCaptions($('transcript').value);
    chunkTranscript(segments); // Reject empty/oversized input before any API request.
    if (!video || isDemo) video = { title: '手動提供嘅影片字幕', url: '', duration: 0, site: '手動字幕', segments: [] };
    isDemo = false; video = { ...video, segments, source: '你提供嘅字幕' };
    clearResults(); renderVideo(); notice('字幕已套用，可以生成摘要。', 'success');
  } catch (error) { notice(error.message, 'error'); }
}

async function generate() {
  if (busy || dirty || !video) return;
  if (!config.token) { openSettings(); return; }
  busy = true; refresh();
  try {
    const granted = !extension || await chrome.permissions.contains({ origins: [getApiTarget(config).origin] });
    if (!granted) { notice('請重新儲存後端設定並授權網址。'); openSettings(); return; }
    busy = true; controller = new AbortController(); clearResults(); refresh(); notice();
    config.model = (await connectBackend(config)).model;
    $('progress').hidden = false;
    const result = await summarize(video, config, { language: $('language').value, length }, {
      signal: controller.signal,
      onProgress({ step, total, label }) { $('progress-fill').style.width = `${Math.round((step - .5) / total * 100)}%`; $('progress-text').textContent = `${label}（${step}/${total}）`; }
    });
    controller.signal.throwIfAborted();
    renderSummary(result, false); notice(`${config.model} 已完成${isDemo ? '示範字幕嘅真實 AI 摘要' : '影片摘要'}，可以複製或匯出。`, 'success');
    if (extension && video.tabId && !isDemo && isSupportedVideoUrl(video.url)) {
      try {
        const resultOnPage = await chrome.tabs.sendMessage(video.tabId, { type: 'clipbrief:show-inline-summary', url: video.url, summary: result }, { frameId: 0 });
        if (resultOnPage?.ok) notice(resultOnPage.placed ? '摘要同時間軸已顯示喺留言區最頂。' : '摘要已就緒，留言區載入後會自動顯示喺最頂。', 'success');
      } catch { notice('摘要已完成。重新整理影片頁再生成，即可顯示喺留言區最頂。', 'success'); }
    }
  } catch (error) { notice(error.name === 'AbortError' ? '已取消生成。供應商可能仍會計算已送出請求嘅費用。' : error instanceof TypeError ? '連唔到本機後端，請確認後端服務已啟動。' : error.message, error.name === 'AbortError' ? '' : 'error'); }
  finally { controller = null; busy = false; $('progress').hidden = true; refresh(); }
}

async function jump(seconds) {
  if (isDemo) return notice(`示範跳轉：${formatTime(seconds)}。載入真實影片後可以直接定位。`, 'success');
  if (!extension || !video?.tabId) return notice('手動字幕未連接影片分頁；你可以根據時間自行定位。');
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: video.tabId }, world: 'MAIN', func: seekVideo, args: [seconds, video.url] });
    if (!result?.result?.ok) throw new Error(result?.result?.reason || '未能跳轉影片。');
    notice(`已跳到 ${formatTime(seconds)}。`, 'success');
  } catch { notice('未能跳轉。影片可能已切換或關閉，請重新擷取。', 'error'); }
}

function openSettings() {
  $('endpoint').value = config.endpoint; $('model').value = config.model; $('connection-token').value = config.token;
  $('backend-setup').href = `${getApiTarget(config).base}/setup.html`;
  $('copy-connection').hidden = extension || !config.token;
  $('settings-submit').textContent = extension ? '連接並儲存後端 ↗' : '檢查後端連線 ↗';
  $('settings-error').textContent = ''; $('settings').showModal();
}
async function saveSettings(event) {
  event.preventDefault();
  const submit = $('settings-form').querySelector('[type=submit]');
  try {
    const endpoint = $('endpoint').value.trim();
    const next = { ...DEFAULT_CONFIG, endpoint, token: $('connection-token').value.trim() };
    if (!/^[a-f0-9]{64}$/.test(next.token)) throw new Error('請貼上後端預覽頁提供嘅連線碼。');
    const { origin } = getApiTarget(next);
    // Request immediately inside the submit user gesture, before any async storage call.
    const permission = extension ? chrome.permissions.request({ origins: [origin] }) : Promise.resolve(true);
    submit.disabled = true;
    if (!await permission) throw new Error('未獲後端網址授權，設定未儲存。');
    const status = await connectBackend(next);
    next.model = status.model;
    if (extension) {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await chrome.storage.local.set({ settings: next });
      await chrome.storage.session.remove('apiKey');
    }
    const previousOrigin = getApiTarget(config).origin;
    config = next;
    if (extension && previousOrigin !== origin && optionalApiOrigins([previousOrigin]).length) await chrome.permissions.remove({ origins: [previousOrigin] });
    $('settings').close(); refresh(); notice('後端已連接。API Key 由後端保管。', 'success');
  } catch (error) { $('settings-error').textContent = error instanceof TypeError ? '連唔到後端，請確認服務已啟動。' : error.message; }
  finally { submit.disabled = false; }
}

async function forget() {
  try {
    if (extension) {
      await chrome.storage.local.remove('settings'); await chrome.storage.session.remove('apiKey');
      const granted = await chrome.permissions.getAll();
      const removable = optionalApiOrigins(granted.origins ?? []);
      if (removable.length) await chrome.permissions.remove({ origins: removable });
    }
    config = { ...DEFAULT_CONFIG };
    $('connection-token').value = ''; $('settings').close(); refresh(); notice('已清除本頁連線設定。後端金鑰仍由後端保管。', 'success');
  } catch (error) { $('settings-error').textContent = error.message; }
}

$('capture').addEventListener('click', () => capture());
$('generate').addEventListener('click', generate);
$('cancel').addEventListener('click', () => controller?.abort());
$('apply-transcript').addEventListener('click', applyTranscript);
$('transcript').addEventListener('input', () => { dirty = true; clearResults(); refresh(); });
$('subtitle-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 1440000) throw new Error('字幕檔太大，請控制在 1.4 MB 以內。');
    $('transcript').value = await file.text(); dirty = true; clearResults(); refresh(); applyTranscript();
  } catch (error) { notice(error.message, 'error'); }
  finally { event.target.value = ''; }
});
document.querySelectorAll('[data-length]').forEach(button => button.addEventListener('click', () => {
  length = button.dataset.length;
  document.querySelectorAll('[data-length]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
}));
const tabs = [...document.querySelectorAll('[data-tab]')];
tabs.forEach((button, i) => {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
  button.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = tabs[e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; selectTab(next.dataset.tab); next.focus(); } });
});
$('settings-open').addEventListener('click', openSettings);
$('endpoint').addEventListener('input', () => {
  try { $('backend-setup').href = `${getApiTarget({ endpoint: $('endpoint').value.trim() }).base}/setup.html`; }
  catch { $('backend-setup').removeAttribute('href'); }
});
$('copy-connection').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(config.token); $('settings-error').textContent = '連線碼已複製，可以貼到 Chrome 擴充功能。'; }
  catch { $('settings-error').textContent = '未能複製；請手動選取連線碼欄位再複製。'; }
});
$('settings-close').addEventListener('click', () => $('settings').close());
$('settings').addEventListener('close', () => { $('connection-token').value = ''; drainVideoRequest(); });
$('settings-form').addEventListener('submit', saveSettings);
$('forget-key').addEventListener('click', forget);
$('demo').addEventListener('click', () => {
  isDemo = true; video = structuredClone(demoVideo); clearResults(); renderVideo(); renderSummary(structuredClone(demoSummary));
  notice('呢份係內置示範，唔係從你目前影片生成。', 'success');
});
$('copy').addEventListener('click', async () => {
  if (!summary) return;
  try { await navigator.clipboard.writeText(exportNote() + summaryMarkdown(video, summary)); notice('摘要已複製。', 'success'); }
  catch { notice('剪貼簿未獲授權，請改用匯出 Markdown。', 'error'); }
});
$('download').addEventListener('click', () => {
  if (!summary) return;
  const text = exportNote() + summaryMarkdown(video, summary);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${video.title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 70) || 'ClipBrief'}.md`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
});

function exportNote() {
  if (summaryIsDemo) return '> 片刻內置示範（非實際 AI 輸出）\n\n';
  return isDemo ? '> AI 根據片刻內置示範字幕生成；唔係目前網站影片嘅摘要。\n\n' : '';
}

async function initialize() {
  if (extension) {
    try {
      const local = await chrome.storage.local.get('settings');
      config = restoreConfig(local.settings);
      await chrome.storage.local.set({ settings: config });
      await chrome.storage.session.remove('apiKey');
      getApiTarget(config);
    } catch { config = { ...DEFAULT_CONFIG }; notice('設定未能載入，請重新連接後端。', 'error'); }
  } else {
    $('preview-banner').hidden = false;
    try {
      const session = await getLocalSession(location.origin);
      if (session.ready) config = { ...DEFAULT_CONFIG, endpoint: location.origin, token: session.token, model: session.model };
      else notice('本機後端已啟動，請喺後端設定 Google Key。');
    } catch { notice('未能連接本機後端，請確認服務已啟動。'); }
  }
  refresh();
  if (new URLSearchParams(location.search).has('demo')) $('demo').click();
  if (extension) {
    try {
      panelWindowId = (await chrome.windows.getCurrent()).id;
      const requestKey = `${REQUEST_PREFIX}${panelWindowId}`;
      const handledKey = `${HANDLED_PREFIX}${panelWindowId}`;
      handledRequestId = (await chrome.storage.session.get(handledKey))[handledKey] || null;
      // Listen before reading: handles both an already-open panel and its first load.
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session' && changes[requestKey]?.newValue) receiveVideoRequest(changes[requestKey].newValue);
      });
      receiveVideoRequest((await chrome.storage.session.get(requestKey))[requestKey]);
    } catch { notice('未能自動載入所選影片，可以按「擷取目前影片」。'); }
  }
}
initialize();
