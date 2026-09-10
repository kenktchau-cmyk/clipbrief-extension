// Classic content script. The factory is also used by the local action-bar preview.
// It has no access to API keys, settings, captions, or the AI provider.
function installClipBriefButton({ doc = document, loc = location, runtime = globalThis.chrome?.runtime, Observer = MutationObserver, events = window } = {}) {
  if (!runtime?.id) return () => {};
  const marker = 'clipbrief-video-action';
  doc.getElementById(marker)?.remove();
  const host = doc.createElement('span'); host.id = marker;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host{display:inline-flex!important;vertical-align:middle!important;flex:0 0 auto!important;align-self:center!important;margin-inline-start:8px!important;line-height:normal!important}
      button{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 13px;border:0;border-radius:18px;background:var(--yt-spec-badge-chip-background,rgba(0,0,0,.05));color:var(--yt-spec-text-primary,#0f0f0f);font:500 14px/1.2 "Roboto","Arial","Microsoft JhengHei",sans-serif;white-space:nowrap;cursor:pointer;transition:background .15s,color .15s}
      button:hover{background:var(--yt-spec-button-chip-background-hover,rgba(0,0,0,.10))}
      button:focus-visible{outline:2px solid #3c8766;outline-offset:3px}
      button:disabled{cursor:progress;opacity:.65}
      svg{width:20px;height:20px;flex:none}
      :host([data-site="bilibili"]){margin-inline-start:24px!important}
      :host([data-site="bilibili"]) button{height:36px;padding:0;background:transparent;border-radius:5px;color:var(--text2,#61666d);font:500 14px/1.2 "PingFang SC","Microsoft YaHei",sans-serif;gap:8px}
      :host([data-site="bilibili"]) svg{width:28px;height:28px}
      :host([data-site="bilibili"]) button:hover{color:#27634b}
      .status{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      @media(prefers-reduced-motion:reduce){button{transition:none}}
    </style>
    <button type="button" title="用片刻整理呢條影片" aria-label="片刻摘要：開啟側邊欄並讀取呢條影片嘅字幕">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 3 2.1 6.9L19 12l-6.9 2.1L10 21l-2.1-6.9L1 12l6.9-2.1L10 3Z"/><path d="m20 2 .8 2.2L23 5l-2.2.8L20 8l-.8-2.2L17 5l2.2-.8L20 2Z"/></svg>
      <span class="label">片刻摘要</span>
    </button><span class="status" role="status" aria-live="polite"></span>`;
  const button = shadow.querySelector('button'), label = shadow.querySelector('.label'), status = shadow.querySelector('.status');
  let timer = null, feedbackTimer = null, disposed = false, lastUrl = '';
  const reset = () => { clearTimeout(feedbackTimer); label.textContent = '片刻摘要'; status.textContent = ''; button.title = '用片刻整理呢條影片'; };
  button.addEventListener('click', async event => {
    // Prevent synthetic page events from requesting access or opening browser UI.
    if (!event.isTrusted || button.disabled) return;
    event.preventDefault(); event.stopPropagation();
    reset(); button.disabled = true;
    try {
      // Send while the click still has user activation; never await before this.
      const response = await runtime.sendMessage({ type: 'clipbrief:open-video' });
      if (!response?.ok) throw new Error(response?.error || '未能開啟片刻，請用 Chrome 工具列圖示。');
      status.textContent = '已開啟片刻，正在讀取字幕。';
    } catch (error) {
      label.textContent = '請重試';
      button.title = /Extension context invalidated/i.test(error.message) ? '擴充功能已更新，請重新整理影片頁面。' : error.message;
      status.textContent = button.title;
      feedbackTimer = setTimeout(reset, 6000);
    } finally { button.disabled = false; }
  });

  function reconcile() {
    if (disposed) return;
    const url = new URL(loc.href);
    const youtube = ['youtube.com', 'www.youtube.com'].includes(url.hostname) && url.pathname === '/watch' && url.searchParams.has('v');
    const bilibili = ['bilibili.com', 'www.bilibili.com'].includes(url.hostname) && /^\/video\/(?:BV[\w]+|av\d+)(?:\/|$)/i.test(url.pathname);
    if (!youtube && !bilibili) { host.remove(); return; }
    const selectors = youtube ? ['ytd-watch-metadata #top-level-buttons-computed', 'ytd-video-primary-info-renderer #top-level-buttons-computed'] : ['.video-toolbar-left', '.video-toolbar .ops'];
    const bar = selectors.flatMap(selector => [...doc.querySelectorAll(selector)]).find(element => element.getClientRects().length && !element.closest('[hidden]'));
    if (!bar) { host.remove(); return; }
    if (lastUrl !== loc.href) { lastUrl = loc.href; reset(); }
    host.dataset.site = youtube ? 'youtube' : 'bilibili';
    if (host.parentElement !== bar) bar.append(host);
  }
  function schedule() { if (timer === null && !disposed) timer = setTimeout(() => { timer = null; reconcile(); }, 120); }
  const observer = new Observer(schedule);
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  const navigationEvents = ['yt-navigate-finish', 'yt-page-data-updated', 'popstate', 'pageshow'];
  navigationEvents.forEach(name => events.addEventListener(name, schedule));
  reconcile();
  return () => { disposed = true; observer.disconnect(); clearTimeout(timer); clearTimeout(feedbackTimer); navigationEvents.forEach(name => events.removeEventListener(name, schedule)); host.remove(); };
}

if (globalThis.chrome?.runtime?.id) installClipBriefButton();
