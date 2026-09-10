import test from 'node:test';
import assert from 'node:assert/strict';
import { captureVideo } from '../capture.js';
import { extractVideo } from '../extractor.js';
import { openYouTubeTranscript } from '../transcript-shortcut.js';

const tab = { id: 42, url: 'https://www.youtube.com/watch?v=video' };
const segments = [{ start: 12, text: '自動擷取嘅影片字幕，包含內容及時間標記。'.repeat(4) }];
function fixture({ direct = false, unavailable = false, changed = false, invalidRaw = false } = {}) {
  const calls = [], progress = [];
  const api = { tabs: { get: async () => ({ ...tab, url: changed ? tab.url + 'other' : tab.url }) }, scripting: { executeScript: async options => {
    calls.push(options); assert.equal(options.target.tabId, 42);
    if (options.func === openYouTubeTranscript) return [{ result: { status: unavailable ? 'unavailable' : 'opened' } }];
    assert.equal(options.func, extractVideo);
    const retry = options.args[0].transcriptOnly;
    return [{ result: { url: tab.url, title: '影片', raw: invalidRaw && !retry ? '{invalid JSON}' : '', segments: direct || retry ? segments : [], source: '字幕', note: '' } }];
  } } };
  return { api, calls, progress, options: { onProgress: text => progress.push(text) } };
}

test('readable subtitles are returned directly without opening the transcript UI', async () => {
  const f = fixture({ direct: true }); const data = await captureVideo(f.api, tab, f.options);
  assert.deepEqual(data.segments, segments); assert.equal(f.calls.length, 1); assert.equal(f.progress.length, 0);
});

test('missing direct captions automatically open transcript and re-extract without repeated caption requests', async () => {
  const f = fixture(); const data = await captureVideo(f.api, tab, f.options);
  assert.deepEqual(data.segments, segments); assert.match(data.source, /自動擷取/);
  assert.equal(f.calls.length, 3); assert.equal(f.calls[1].world, undefined);
  assert.equal(f.calls[1].args[1].waitForRows, true); assert.equal(f.calls[2].args[0].transcriptOnly, true);
  assert.equal(f.progress.length, 1);
});

test('unavailable transcript keeps manual fallback without pretending subtitles were found', async () => {
  const f = fixture({ unavailable: true }); const data = await captureVideo(f.api, tab, f.options);
  assert.equal(data.segments.length, 0); assert.match(data.note, /未能自動取得/); assert.equal(f.calls.length, 2);
});

test('navigation between opening and capture cannot attach transcript to the previous video', async () => {
  const f = fixture({ changed: true }); await assert.rejects(captureVideo(f.api, tab, f.options), /影片已切換/);
});
