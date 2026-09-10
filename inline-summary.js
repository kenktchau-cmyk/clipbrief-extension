// Classic isolated-world content script; receives only a finished summary, never API settings.
function clipBriefInlineIdentity(raw) {
  try {
    const url = new URL(raw), host = url.hostname.replace(/^www\./, '');
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    if (host === 'youtube.com' && url.pathname === '/watch' && url.searchParams.get('v')) return `youtube:${url.searchParams.get('v')}`;
    if (host === 'bilibili.com' && /^\/video\/(BV[\w]+|av\d+)\/?$/i.test(url.pathname)) return `bilibili:${url.pathname.replace(/\/$/, '')}:p${url.searchParams.get('p') || '1'}`;
  } catch {}
  return '';
}
function clipBriefInlineData(data) {
  if (!data || typeof data.brief !== 'string' || !data.brief.trim() || !Array.isArray(data.keyPoints) || !data.keyPoints.some(p => typeof p === 'string' && p.trim())) return null;
  return { brief: data.brief.slice(0, 6000), keyPoints: data.keyPoints.filter(p => typeof p === 'string' && p.trim()).slice(0, 12).map(p => p.slice(0, 2000)), chapters: (Array.isArray(data.chapters) ? data.chapters : []).filter(c => c && typeof c.start === 'number' && Number.isFinite(c.start) && c.start >= 0 && c.start < 1e8 && typeof c.title === 'string').slice(0, 12).map(c => ({ start: c.start, title: c.title.slice(0, 200), description: typeof c.description === 'string' ? c.description.slice(0, 600) : '' })) };
}
function installClipBriefInlineSummary({ doc = document, loc = location, runtime = globalThis.chrome?.runtime, Observer = MutationObserver, events = window } = {}) {
  const marker = 'clipbrief-inline-summary';
  doc.getElementById(marker)?.remove();
  const host = doc.createElement('section'); host.id = marker;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{display:block!important;width:100%!important;margin:24px 0!important;box-sizing:border-box!important;color:var(--yt-spec-text-primary,#20382e);font:14px/1.7 Arial,"Microsoft JhengHei",sans-serif;text-align:start}
    *{box-sizing:border-box}.card{border:1px solid var(--yt-spec-10-percent-layer,#dce5dc);border-radius:16px;background:var(--yt-spec-base-background,#fbfcf8);overflow:hidden}details>summary{cursor:pointer;display:flex;gap:10px;align-items:center;padding:18px 22px;list-style:none;font-weight:700;font-size:16px}summary::-webkit-details-marker{display:none}.logo{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:#244d3c;color:#fff}.badge{font-size:11px;font-weight:400;margin-inline-start:auto;opacity:.65}.chevron{font-size:12px;opacity:.6}details[open] .chevron{transform:rotate(180deg)}.body{padding:0 22px 20px}.brief{margin:0 0 20px;opacity:.85}.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:28px}h3{font-size:13px;letter-spacing:.5px;margin:0 0 12px}ol{margin:0;padding-inline-start:22px}li{padding:0 0 9px 4px}.chapter{display:grid;grid-template-columns:64px 1fr;gap:10px;margin-bottom:12px}.time{border:0;border-radius:7px;background:#e7f1e8;color:#28583f;cursor:pointer;font:600 12px/1.5 monospace;padding:7px;align-self:start}.time:hover{background:#d3e7d8}.time:focus-visible,summary:focus-visible{outline:2px solid #548c6a;outline-offset:3px}.chapter strong{display:block;font-size:13px}.chapter p{font-size:12px;margin:2px 0 0;opacity:.65}.foot{font-size:11px;opacity:.58;margin:15px 0 0}.feedback{font-size:12px;color:#478965;margin:12px 0 0}.empty{opacity:.6;font-size:12px}:host([data-dark]) .card{background:#191c19;border-color:#3b443d;color:#e5ede5}:host([data-dark]) .time{background:#284535;color:#c3e6ce}
  </style><article class="card" aria-label="片刻影片摘要"><details open><summary><span class="logo" aria-hidden="true">✦</span>影片重點摘要<span class="badge">片刻 · AI 字幕摘要</span><span class="chevron" aria-hidden="true">⌃</span></summary><div class="body"><p class="brief"></p><div class="columns"><section><h3>值得記低</h3><ol class="points"></ol></section><section><h3>影片時間軸</h3><div class="chapters"></div></section></div><p class="feedback" role="status"></p><p class="foot">只喺你嘅瀏覽器顯示，唔會發布成留言。AI 摘要請對照原片。</p></div></details></article>`;
  const $ = selector => shadow.querySelector(selector);
  let identity = '', timer = null, disposed = false;
  const time = n => { const s = Math.floor(n), m = Math.floor(s / 60); return s >= 3600 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
  function reconcile() {
    if (!identity) return;
    if (clipBriefInlineIdentity(loc.href) !== identity) { identity = ''; host.remove(); return; }
    const selectors = identity.startsWith('youtube:') ? ['ytd-watch-flexy ytd-comments#comments', 'ytd-comments#comments', 'ytd-comments'] : ['bili-comments', '#commentapp', '#comment', '.comment-container', '.comment-common'];
    const target = selectors.flatMap(selector => [...doc.querySelectorAll(selector)]).find(node => node.getClientRects().length && !node.closest('[hidden]'));
    if (target?.parentNode && (host.parentNode !== target.parentNode || host.nextSibling !== target)) target.before(host);
    const dark = doc.documentElement.hasAttribute('dark') || doc.documentElement.classList.contains('dark');
    if (host.hasAttribute('data-dark') !== dark) host.toggleAttribute('data-dark', dark);
  }
  function show(data, url) {
    const expected = clipBriefInlineIdentity(url), current = clipBriefInlineIdentity(loc.href), safe = clipBriefInlineData(data);
    if (!safe || !expected || expected !== current) return { ok: false, reason: '影片已切換或摘要格式無效。' };
    identity = current;
    $('.brief').textContent = safe.brief; $('.feedback').textContent = '';
    $('.points').replaceChildren(...safe.keyPoints.map(text => { const li = doc.createElement('li'); li.textContent = text; return li; }));
    $('.chapters').replaceChildren(...safe.chapters.map(chapter => {
      const row = doc.createElement('div'); row.className = 'chapter';
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'time'; button.textContent = time(chapter.start); button.setAttribute('aria-label', `跳到 ${time(chapter.start)} ${chapter.title}`);
      button.addEventListener('click', () => {
        if (clipBriefInlineIdentity(loc.href) !== identity) { reconcile(); return; }
        if (doc.querySelector('#movie_player.ad-showing')) { $('.feedback').textContent = '請等廣告播放完再跳轉。'; return; }
        const video = [...doc.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
        if (!video) { $('.feedback').textContent = '未搵到播放器，請稍後再試。'; return; }
        try { video.currentTime = chapter.start; $('.feedback').textContent = `已跳到 ${time(chapter.start)}。`; } catch { $('.feedback').textContent = '播放器暫時未能跳轉。'; }
      });
      const text = doc.createElement('div'), heading = doc.createElement('strong'), description = doc.createElement('p');
      heading.textContent = chapter.title; description.textContent = chapter.description; text.append(heading, description); row.append(button, text); return row;
    }));
    if (!safe.chapters.length) { const note = doc.createElement('p'); note.className = 'empty'; note.textContent = '字幕未有可核對嘅時間標記。'; $('.chapters').append(note); }
    reconcile(); return { ok: true, placed: host.isConnected };
  }
  function schedule() { if (timer === null && !disposed) timer = setTimeout(() => { timer = null; reconcile(); }, 120); }
  const observer = new Observer(schedule); observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'dark', 'class'] });
  const navigation = ['yt-navigate-start', 'yt-navigate-finish', 'popstate', 'pageshow']; navigation.forEach(name => events.addEventListener(name, schedule));
  const listener = (message, sender, respond) => {
    if (message?.type !== 'clipbrief:show-inline-summary') return;
    if (!runtime?.id || sender?.id !== runtime.id) { respond({ ok: false }); return; }
    respond(show(message.summary, message.url));
  };
  runtime?.onMessage?.addListener(listener);
  return { show, dispose() { disposed = true; observer.disconnect(); clearTimeout(timer); navigation.forEach(name => events.removeEventListener(name, schedule)); runtime?.onMessage?.removeListener(listener); host.remove(); } };
}
if (globalThis.chrome?.runtime?.id && !globalThis.__clipBriefInline) globalThis.__clipBriefInline = installClipBriefInlineSummary();
