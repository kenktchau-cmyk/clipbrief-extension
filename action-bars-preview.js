const fixtureScopes = [
  { root: document.getElementById('youtube-fixture'), href: 'https://www.youtube.com/watch?v=preview', label: 'YouTube' },
  { root: document.getElementById('bilibili-fixture'), href: 'https://www.bilibili.com/video/BVpreview/', label: 'Bilibili' }
];
const updates = new EventTarget();
const count = () => {
  const values = fixtureScopes.map(({ root, label }) => `${label}：${root.querySelectorAll('#clipbrief-video-action').length} 個按鈕`);
  const target = document.getElementById('button-count');
  if (target.textContent !== values.join(' · ')) target.textContent = values.join(' · ');
};
fixtureScopes.forEach(({ root, href, label }) => {
  // A scoped DOM facade lets the production factory run unchanged against each fixture.
  const doc = { createElement: tag => document.createElement(tag), getElementById: id => root.querySelector(`#${id}`), querySelectorAll: selector => root.querySelectorAll(selector), documentElement: root };
  installClipBriefButton({ doc, loc: { href }, events: updates, runtime: {
    id: 'local-preview-only',
    async sendMessage(message) {
      if (message.type !== 'clipbrief:open-video') return { ok: false };
      document.getElementById('preview-status').textContent = `${label} 按鈕已回應：已打開示範側邊欄，冇傳送字幕或 API Key。`;
      const iframe = document.getElementById('sidebar-frame');
      if (!iframe.getAttribute('src')) iframe.src = 'panel.html?demo=1';
      document.getElementById('sidebar-preview').hidden = false;
      return { ok: true };
    }
  } });
});
document.getElementById('theme').addEventListener('click', () => {
  const dark = document.getElementById('youtube-fixture').classList.toggle('dark');
  document.getElementById('theme').textContent = dark ? '切換淺色示意' : '切換深色示意';
});
document.getElementById('close-sidebar').addEventListener('click', () => { document.getElementById('sidebar-preview').hidden = true; });
document.getElementById('remount').addEventListener('click', () => {
  fixtureScopes.forEach(({ root }) => {
    const bar = root.querySelector('#top-level-buttons-computed,.video-toolbar-left');
    const replacement = bar.cloneNode(true);
    replacement.querySelector('#clipbrief-video-action')?.remove();
    bar.replaceWith(replacement);
  });
  document.getElementById('preview-status').textContent = '已模擬網站重新建立操作列，按鈕會自動補回。';
});
new MutationObserver(count).observe(document.querySelector('main'), { childList: true, subtree: true });
count();
