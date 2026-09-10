export const REQUEST_PREFIX = 'clipbrief.videoRequest.';
export const HANDLED_PREFIX = 'clipbrief.handledRequest.';

export function isSupportedVideoUrl(input) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:') return false;
    if (['youtube.com', 'www.youtube.com'].includes(url.hostname)) return url.pathname === '/watch' && !!url.searchParams.get('v');
    if (['bilibili.com', 'www.bilibili.com'].includes(url.hostname)) return /^\/video\/(?:BV[\w]+|av\d+)(?:\/|$)/i.test(url.pathname);
    return false;
  } catch { return false; }
}

export function registerVideoButton(api) {
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'clipbrief:open-video') return;
    const tab = sender.tab;
    // The browser supplies the target. Never trust a tab ID or URL in message data.
    if (sender.id !== api.runtime.id || sender.frameId !== 0 || !Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId) || !isSupportedVideoUrl(sender.url)) {
      sendResponse({ ok: false, error: '請喺 YouTube 或 Bilibili 影片頁使用呢個按鈕。' });
      return;
    }
    try {
      // Must happen synchronously in the click message handler, before storage I/O.
      const opening = api.sidePanel.open({ windowId: tab.windowId });
      const request = { id: crypto.randomUUID(), tabId: tab.id, windowId: tab.windowId, url: sender.url, createdAt: Date.now() };
      opening.then(() => api.storage.session.set({ [`${REQUEST_PREFIX}${tab.windowId}`]: request }))
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, error: '未能開啟片刻。請重新按一次，或用 Chrome 工具列嘅片刻圖示。' }));
    } catch {
      sendResponse({ ok: false, error: '未能開啟片刻。請用 Chrome 工具列嘅片刻圖示。' });
    }
    return true;
  });
}
