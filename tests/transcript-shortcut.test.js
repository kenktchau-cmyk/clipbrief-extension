import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { registerTranscriptShortcut, openYouTubeTranscript, TRANSCRIPT_COMMAND } from '../transcript-shortcut.js';

test('shortcut manifest registers a customizable command and injection only targets the invoking YouTube tab', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.commands[TRANSCRIPT_COMMAND].suggested_key.default, 'Alt+Shift+T');
  const injections = []; let listener;
  const api = { commands: { onCommand: { addListener: value => { listener = value; } } }, tabs: { query: async () => [{ id: 8, url: 'https://www.youtube.com/watch?v=current' }] }, scripting: { executeScript: async value => injections.push(value) } };
  registerTranscriptShortcut(api);
  await listener('unrelated', { id: 2, url: 'https://www.youtube.com/watch?v=a' });
  for (const url of ['https://youtube.com.evil.test/watch?v=a', 'https://www.bilibili.com/video/BV123', 'https://www.youtube.com/shorts/a', 'https://www.youtube.com/watch', 'chrome://extensions']) await listener(TRANSCRIPT_COMMAND, { id: 2, url });
  assert.equal(injections.length, 0);
  await listener(TRANSCRIPT_COMMAND, { id: 42, url: 'https://www.youtube.com/watch?v=invoking' });
  assert.deepEqual(injections[0].target, { tabId: 42 }); assert.deepEqual(injections[0].args, ['invoking']);
  assert.equal(injections[0].func, openYouTubeTranscript);
  await listener(TRANSCRIPT_COMMAND);
  assert.equal(injections[1].target.tabId, 8);
});

function fixture({ alreadyOpen = false, unavailable = false, changeVideo = false, label = '顯示轉錄稿', semanticSection = true, modern = false } = {}) {
  let open = alreadyOpen, expanded = false, clicks = 0, expands = 0, scrolls = 0, notice;
  const visible = { closest: () => null, getClientRects: () => [1], getAttribute: () => null };
  const button = { ...visible, textContent: label, click: () => { clicks++; open = true; } };
  const expand = { ...visible, click: () => { expands++; expanded = true; } };
  const panel = { ...visible, scrollIntoView: () => { scrolls++; }, querySelectorAll: selector => !modern || selector.includes('transcript-segment-view-model') ? [{ querySelector: textSelector => !modern || textSelector === 'span.ytAttributedStringHost[role="text"]' ? { textContent: '字幕已載入' } : null }] : [] };
  const section = { querySelectorAll: () => [button] };
  const description = {
    querySelector: selector => selector === '#expand' ? expand : expanded && !unavailable && semanticSection ? section : null,
    querySelectorAll: () => expanded && !unavailable ? [button] : []
  };
  const location = { href: 'https://www.youtube.com/watch?v=original' };
  const listeners = new Map(), timers = [];
  const context = {
    URL, location, getComputedStyle: () => ({ visibility: 'visible' }),
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    document: {
      querySelectorAll: selector => open && (!modern || selector.includes('PAmodern_transcript_view')) ? [panel] : [], querySelector: () => description,
      createElement: () => { notice = { style: {}, setAttribute() {}, remove() { this.removed = true; } }; return notice; }, body: { append() {} }
    },
    setTimeout: (fn, ms) => {
      if (ms === 250) { if (changeVideo) location.href = 'https://www.youtube.com/watch?v=other'; fn(); }
      else timers.push(fn);
      return 1;
    }, clearTimeout() {},
    fetch: () => assert.fail('Opening the transcript must not make an AI request')
  };
  return { context, timers, stats: () => ({ clicks, expands, scrolls, notice, listeners }) };
}
const run = context => vm.runInNewContext(`(${openYouTubeTranscript.toString()})('original')`, context);

test('automatic capture waits for transcript rows without scrolling away from the video', async () => {
  const f = fixture();
  assert.equal((await vm.runInNewContext(`(${openYouTubeTranscript.toString()})('original',{waitForRows:true})`, f.context)).status, 'opened');
  assert.equal(f.stats().clicks, 1); assert.equal(f.stats().scrolls, 0);
});

test('automatic opening recognizes modern transcript panels and waits for their text rows', async () => {
  const f = fixture({ modern: true, semanticSection: false, label: '字幕記錄' });
  assert.equal((await vm.runInNewContext(`(${openYouTubeTranscript.toString()})('original',{waitForRows:true})`, f.context)).status, 'opened');
  assert.equal(f.stats().clicks, 1); assert.equal(f.stats().expands, 1);
});

test('serialized shortcut expands the description then opens its transcript exactly once', async () => {
  const f = fixture(); assert.equal((await run(f.context)).status, 'opened');
  assert.equal(f.stats().clicks, 1); assert.equal(f.stats().expands, 1); assert.equal(f.stats().scrolls, 1);
  assert.match(f.stats().notice.textContent, /已打開/);
  f.timers[0](); assert.equal(f.stats().notice.removed, true); assert.equal(f.stats().listeners.size, 0);
});

test('already-open transcript scrolls into view without clicking or collapsing it', async () => {
  const f = fixture({ alreadyOpen: true }); assert.equal((await run(f.context)).status, 'opened');
  assert.equal(f.stats().clicks, 0); assert.equal(f.stats().expands, 0); assert.equal(f.stats().scrolls, 1);
});

test('missing transcripts have bounded retries and a visible fallback; unrelated buttons are ignored', async () => {
  for (const config of [{ unavailable: true }, { semanticSection: false, label: 'Subscribe' }]) {
    const f = fixture(config); assert.equal((await run(f.context)).status, 'unavailable');
    assert.equal(f.stats().clicks, 0); assert.equal(f.stats().expands, 1); assert.match(f.stats().notice.textContent, /未搵到轉錄稿/);
  }
  for (const label of ['Show transcript', '顯示轉錄稿', '显示转录稿']) {
    const f = fixture({ semanticSection: false, label }); assert.equal((await run(f.context)).status, 'opened');
  }
});

test('navigation cancels opening and repeated shortcut presses do not start concurrent work', async () => {
  const f = fixture({ changeVideo: true }); assert.equal((await run(f.context)).status, 'navigated');
  assert.equal(f.stats().clicks, 0); assert.equal(f.stats().notice.removed, true);
  const busy = fixture(); busy.context.window.__clipbriefTranscriptShortcut = { videoId: 'original', running: true };
  assert.equal((await run(busy.context)).status, 'busy'); assert.equal(busy.stats().clicks, 0);
  const changed = fixture(); changed.context.location.href = 'https://www.youtube.com/watch?v=other';
  assert.equal((await run(changed.context)).status, 'navigated'); assert.equal(changed.stats().expands, 0);
});
