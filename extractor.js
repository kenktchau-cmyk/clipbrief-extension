// This entire function is serialized by chrome.scripting; keep helpers inside it.
// Runs in the page world. It never receives API configuration or secrets.
export async function extractVideo({ transcriptOnly = false, expectedVideoId = '' } = {}) {
  const originalUrl = location.href;
  const host = location.hostname;
  const isYouTube = /(^|\.)youtube\.com$/.test(host);
  const isBilibili = /(^|\.)bilibili\.com$/.test(host);
  if (expectedVideoId && new URL(originalUrl).searchParams.get('v') !== expectedVideoId) throw new Error('影片頁面已切換，請重新擷取。');
  const site = isYouTube ? 'YouTube' : isBilibili ? 'Bilibili' : host;
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const video = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content;
  const title = clean(document.querySelector(isYouTube ? 'ytd-watch-metadata h1' : isBilibili ? '.video-title' : 'h1')?.textContent || meta('og:title') || document.title).slice(0, 500);
  const result = { title, url: originalUrl, site, duration: Number.isFinite(video?.duration) ? video.duration : 0, segments: [], raw: '', source: '', hasVideo: !!video, note: '' };
  const finish = () => {
    if (location.href !== originalUrl) throw new Error('影片頁面已切換，請重新擷取。');
    return result;
  };
  const read = async (address, credentials = 'omit') => {
    const url = new URL(address, originalUrl);
    const allowed = url.origin === location.origin ||
      (isYouTube && /(^|\.)youtube\.com$/.test(url.hostname)) ||
      (isBilibili && /(^|\.)(bilibili\.com|hdslb\.com)$/.test(url.hostname));
    if (!allowed || !['https:', 'http:'].includes(url.protocol)) throw new Error('Caption origin rejected');
    const response = await fetch(url.href, { credentials, redirect: 'error', signal: AbortSignal.timeout(6500) });
    if (!response.ok) throw new Error('Caption request failed');
    if (Number(response.headers.get('content-length')) > 1440000) throw new Error('Caption too large');
    const text = await response.text();
    if (text.length > 1440000) throw new Error('Caption too large');
    return text;
  };
  const rank = tracks => [...tracks].sort((a, b) => {
    const score = t => (/^(zh|yue)/.test(t.languageCode ?? t.lan ?? t.language ?? '') ? 0 : /^en/.test(t.languageCode ?? t.lan ?? t.language ?? '') ? 2 : 4) + (t.kind === 'asr' ? 1 : 0);
    return score(a) - score(b);
  });

  // Native text tracks are usable on standard HTML5 players without site adapters.
  if (!transcriptOnly && video?.textTracks) {
    const tracks = [...video.textTracks].filter(t => ['subtitles', 'captions'].includes(t.kind));
    for (const track of rank(tracks).slice(0, 2)) {
      const mode = track.mode;
      try {
        if (mode === 'disabled') { track.mode = 'hidden'; await new Promise(resolve => setTimeout(resolve, 700)); }
        if (track.cues?.length) {
          result.segments = [...track.cues].map(c => ({ start: c.startTime, text: clean(c.text) }));
          result.source = `影片字幕 · ${track.label || track.language || 'HTML5'}`;
          return finish();
        }
      } catch { /* Fall through to site-specific captions. */ }
      finally { track.mode = mode; }
    }
  }

  if (isYouTube) {
    const id = new URL(originalUrl).searchParams.get('v') || location.pathname.split('/').at(-1);
    const readTranscript = () => {
      // YouTube currently serves both Polymer transcripts and the modern view-model UI.
      const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"], ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
      for (const panel of panels) {
        if (panel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN' || panel.closest('[hidden], [aria-hidden="true"]') || !panel.getClientRects().length) continue;
        const rows = [...panel.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model')].filter(row => row.getClientRects().length);
        const time = value => {
          const text = clean(value);
          if (!/^\d+(?::\d{2}){1,2}$/.test(text)) return null;
          const parts = text.split(':').map(Number);
          return parts.slice(1).some(part => part >= 60) ? null : parts.reduce((total, part) => total * 60 + part, 0);
        };
        const segments = rows.map(row => ({
          start: time((row.querySelector('.segment-timestamp') || row.querySelector('.ytwTranscriptSegmentViewModelTimestamp'))?.textContent),
          text: clean((row.querySelector('.segment-text') || row.querySelector('span.ytAttributedStringHost[role="text"]'))?.textContent)
        })).filter(segment => segment.text);
        if (segments.length) {
          result.segments = segments;
          result.source = 'YouTube 字幕記錄';
          result.note = '來自頁面目前載入嘅字幕記錄，請確認已包含完整影片。';
          return true;
        }
      }
      return false;
    };
    // Already-open transcripts should not wait for a timed-text request to fail.
    if (readTranscript()) return finish();
    let player;
    try { player = document.querySelector('#movie_player')?.getPlayerResponse?.(); } catch { /* Not all players expose this. */ }
    if (player?.videoDetails?.videoId !== id) player = window.ytInitialPlayerResponse;
    if (!transcriptOnly && player?.videoDetails?.videoId === id) {
      const tracks = rank(player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
      for (const track of tracks.slice(0, 2)) {
        try {
          const raw = await read(track.baseUrl, 'include');
          if (raw.trim() && !raw.trim().startsWith('<!DOCTYPE')) {
            result.raw = raw; result.source = `YouTube ${track.kind === 'asr' ? '自動字幕' : '字幕'} · ${track.languageCode}`;
            return finish();
          }
        } catch { /* Timed text may require opening the transcript in the player. */ }
      }
    }
    if (readTranscript()) return finish();
    result.note = '未讀到可用嘅 YouTube 轉錄稿。影片可能未提供字幕，或頁面未載入完成；可以重試或貼上字幕。';
  } else if (isBilibili) {
    // Bilibili's player metadata is not a public, stable API; this is best effort.
    const state = window.__INITIAL_STATE__;
    const data = state?.videoData;
    const bvid = location.pathname.match(/\/video\/(BV[\w]+)/)?.[1];
    const part = Number(new URL(originalUrl).searchParams.get('p') || 1);
    const page = data?.pages?.find(p => p.page === part);
    const cid = page?.cid ?? (part === 1 ? state?.cid ?? data?.cid : null);
    if (bvid && data?.bvid === bvid && cid) {
      try {
        const info = JSON.parse(await read(`https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`, 'include'));
        const subtitles = rank(info.data?.subtitle?.subtitles ?? []);
        if (subtitles.length) {
          result.raw = await read(subtitles[0].subtitle_url);
          result.source = `Bilibili 字幕 · ${subtitles[0].lan_doc || subtitles[0].lan}`;
          return finish();
        }
      } catch { /* Login, CORS, API changes or absent subtitles: offer manual input. */ }
    }
    result.note = 'Bilibili 字幕可能需要登入或受播放器限制。請先開啟 CC 字幕再重試，或貼上字幕。';
  }

  // Same-origin VTT/SRT files are a final fallback when native cues are not loaded.
  for (const track of [...(!transcriptOnly && video?.querySelectorAll('track[kind="subtitles"],track[kind="captions"]') || [])].slice(0, 2)) {
    try {
      const raw = await read(track.src);
      if (raw.trim()) { result.raw = raw; result.source = `字幕檔 · ${track.srclang || 'HTML5'}`; return finish(); }
    } catch { /* No readable caption track. */ }
  }
  result.note ||= result.hasVideo ? '未發現可讀字幕。可貼上逐字稿或匯入 SRT / VTT；暫不支援直接聽取音訊。' : '未喺頁面主框架發現影片。跨網站嵌入影片可開啟原始影片頁，或直接貼上逐字稿。';
  return finish();
}

export function seekVideo(seconds, expectedUrl) {
  if (location.href !== expectedUrl) return { ok: false, reason: '影片頁面已切換，請重新擷取。' };
  const videos = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const video = videos[0];
  if (!video || !Number.isFinite(seconds) || seconds < 0) return { ok: false, reason: '未搵到可跳轉嘅影片。' };
  try { video.currentTime = Number.isFinite(video.duration) ? Math.min(seconds, video.duration) : seconds; return { ok: true }; }
  catch { return { ok: false, reason: '播放器暫時未能跳轉。' }; }
}
