import { extractVideo } from './extractor.js';
import { openYouTubeTranscript } from './transcript-shortcut.js';
import { normalizeSegments, parseCaptions, transcriptLength } from './core.js';

export async function captureVideo(api, tab, { onProgress = () => {} } = {}) {
  const url = new URL(tab.url);
  const youtube = url.protocol === 'https:' && ['youtube.com', 'www.youtube.com'].includes(url.hostname) && url.pathname === '/watch' && !!url.searchParams.get('v');
  const extract = async (transcriptOnly = false) => {
    const [injection] = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: extractVideo, args: [{ transcriptOnly, expectedVideoId: youtube ? url.searchParams.get('v') : '' }] });
    const data = injection?.result;
    if (!data) throw new Error('未能讀取頁面，請重新按工具列嘅片刻圖示再試。');
    if (data.url !== tab.url) throw new Error('影片已切換，請喺新影片再按「片刻摘要」。');
    return data;
  };
  const parse = data => data.raw ? parseCaptions(data.raw) : normalizeSegments(data.segments);
  let data = await extract(), segments;
  try { segments = parse(data); } catch (error) { if (!youtube) throw error; segments = []; }
  if (youtube && transcriptLength(segments) < 40) {
    onProgress('正在自動打開 YouTube 轉錄稿並讀取字幕…');
    const [opened] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: openYouTubeTranscript, args: [url.searchParams.get('v'), { waitForRows: true }] });
    if (opened?.result?.status === 'navigated') throw new Error('影片已切換，請喺新影片再按「片刻摘要」。');
    if (opened?.result?.status === 'opened') {
      const transcript = await extract(true), captured = parse(transcript);
      if (transcriptLength(captured) > transcriptLength(segments)) {
        data = transcript; segments = captured;
        data.source = 'YouTube 自動擷取嘅轉錄稿';
        data.note = '已自動擷取頁面載入嘅轉錄稿，可以生成摘要。請確認字幕已包含完整影片。';
      }
    } else data.note = '未能自動取得轉錄稿。影片可能未提供字幕或 YouTube 未能載入；可以重試，或貼上／匯入字幕。';
  }
  // Detect a navigation even if it happens between separate script injections.
  const latest = await api.tabs.get(tab.id);
  if (latest.url !== tab.url) throw new Error('影片已切換，請喺新影片再按「片刻摘要」。');
  return { ...data, segments };
}
