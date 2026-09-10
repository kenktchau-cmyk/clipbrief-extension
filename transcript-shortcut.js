export const TRANSCRIPT_COMMAND = 'open-youtube-transcript';

export function registerTranscriptShortcut(api) {
  const listener = async (command, tab) => {
    if (command !== TRANSCRIPT_COMMAND) return;
    try {
      const target = tab?.id !== undefined ? tab : (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      if (!Number.isInteger(target?.id)) return;
      const url = new URL(target.url || '');
      if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com'].includes(url.hostname) || url.pathname !== '/watch' || !url.searchParams.get('v')) return;
      await api.scripting.executeScript({ target: { tabId: target.id }, func: openYouTubeTranscript, args: [url.searchParams.get('v')] });
    } catch { console.warn('ClipBrief: could not open transcript. Refresh the YouTube tab and try again.'); }
  };
  api.commands.onCommand.addListener(listener);
  return listener;
}

// Self-contained: Chrome serializes this function into the tab's isolated world.
export async function openYouTubeTranscript(expectedVideoId, { waitForRows = false } = {}) {
  const currentVideo = () => {
    const url = new URL(location.href);
    return url.protocol === 'https:' && ['www.youtube.com', 'youtube.com'].includes(url.hostname) && url.pathname === '/watch' ? url.searchParams.get('v') : null;
  };
  if (!expectedVideoId || currentVideo() !== expectedVideoId) return { status: 'navigated' };
  const slot = '__clipbriefTranscriptShortcut';
  const previous = window[slot];
  if (previous?.videoId === expectedVideoId && previous.running) {
    if (!waitForRows) return { status: 'busy' };
    for (let attempt = 0; attempt < 48 && previous.running && window[slot] === previous; attempt++) {
      if (currentVideo() !== expectedVideoId) return { status: 'navigated' };
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (previous.running && window[slot] === previous) return { status: 'busy' };
  }
  previous?.cleanup?.();
  const state = { videoId: expectedVideoId, running: true };
  window[slot] = state;
  const visible = element => element && !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
  const panelSelector = 'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"], ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const getPanel = () => [...document.querySelectorAll(panelSelector)].find(panel => panel.getAttribute('visibility') !== 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN' && visible(panel));
  const notice = document.createElement('div');
  notice.id = 'clipbrief-transcript-status';
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  Object.assign(notice.style, { position: 'fixed', bottom: '24px', left: '24px', zIndex: '2147483647', padding: '12px 18px', borderRadius: '12px', background: '#24463b', color: '#fff', font: '14px/1.6 system-ui, sans-serif', maxWidth: 'min(420px, calc(100vw - 48px))', boxShadow: '0 4px 20px #0003', pointerEvents: 'none' });
  notice.textContent = waitForRows ? '片刻：正在自動讀取轉錄稿…' : '片刻：正在打開轉錄稿…';
  document.body.append(notice);
  let noticeTimer;
  const onNavigation = () => { if (currentVideo() !== expectedVideoId) state.cleanup(); };
  state.cleanup = () => {
    clearTimeout(noticeTimer); notice.remove();
    window.removeEventListener('yt-navigate-start', onNavigation);
    window.removeEventListener('yt-navigate-finish', onNavigation);
    window.removeEventListener('popstate', onNavigation);
    if (window[slot] === state) delete window[slot];
  };
  window.addEventListener('yt-navigate-start', onNavigation);
  window.addEventListener('yt-navigate-finish', onNavigation);
  window.addEventListener('popstate', onNavigation);
  const finish = (status, text) => {
    state.running = false;
    if (currentVideo() !== expectedVideoId || window[slot] !== state) { state.cleanup(); return { status: 'navigated' }; }
    notice.textContent = text;
    noticeTimer = setTimeout(state.cleanup, status === 'opened' ? 2500 : 7000);
    return { status };
  };
  const clicked = new Set(); let expanded = false, lastRowCount = 0, stableRows = 0;
  try {
    for (let attempt = 0; attempt < 48; attempt++) {
      if (currentVideo() !== expectedVideoId || window[slot] !== state) { state.cleanup(); return { status: 'navigated' }; }
      const panel = getPanel();
      if (panel) {
        const rows = [...panel.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model')].filter(row => (row.querySelector('.segment-text') || row.querySelector('span.ytAttributedStringHost[role="text"]'))?.textContent?.trim());
        stableRows = rows.length && rows.length === lastRowCount ? stableRows + 1 : 0;
        lastRowCount = rows.length;
        const ready = !waitForRows || stableRows >= 2;
        if (ready) {
          if (!waitForRows) panel.scrollIntoView({ behavior: 'instant', block: 'nearest' });
          return finish('opened', waitForRows ? '片刻：轉錄稿已載入，正在擷取字幕。' : '片刻：已打開轉錄稿。');
        }
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      // Only the current video's description is eligible, never comments or recommendations.
      const description = document.querySelector('ytd-watch-metadata #description') || document.querySelector('ytd-video-secondary-info-renderer #description');
      if (description) {
        const section = description.querySelector('ytd-video-description-transcript-section-renderer');
        const transcriptButton = [...(section || description).querySelectorAll('button, [role="button"]')].find(button => {
          if (clicked.has(button) || button.disabled || button.getAttribute('aria-disabled') === 'true' || !visible(button)) return false;
          const label = (button.getAttribute('aria-label') || button.textContent || '').trim().replace(/\s+/g, ' ');
          return section || /^(?:show transcript|顯示轉錄稿|显示转录稿|顯示逐字稿|显示文字稿|顯示文字稿|字幕記錄|字幕记录|顯示字幕記錄|显示字幕记录)$/i.test(label);
        });
        if (transcriptButton) { clicked.add(transcriptButton); transcriptButton.click(); }
        else if (!expanded) {
          const expand = description.querySelector('#expand');
          if (visible(expand)) { expanded = true; expand.click(); }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return finish('unavailable', '片刻：未搵到轉錄稿。影片可能未提供字幕，或 YouTube 版面已更新；可試吓手動展開影片說明。');
  } catch { return finish('error', '片刻：未能打開轉錄稿，請重新整理影片頁面再試。'); }
}
