import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extractVideo, seekVideo } from '../extractor.js';
import { parseCaptions } from '../core.js';

function fixture(url, extra = {}) {
  const parsed = new URL(url);
  return {
    URL, AbortSignal, setTimeout, location: { href: url, hostname: parsed.hostname, origin: parsed.origin, pathname: parsed.pathname }, window: {},
    document: { title: 'Fixture video', querySelector: () => null, querySelectorAll: () => [] },
    fetch: async () => { throw new Error('Unexpected network request'); }, ...extra
  };
}
const run = context => vm.runInNewContext(`(${extractVideo.toString()})()`, context);

test('transcript-only retry reads visible panel rows and timestamps without fetching captions', async () => {
  const context = fixture('https://www.youtube.com/watch?v=abc');
  const row = { getClientRects: () => [1], querySelector: selector => ({ textContent: selector === '.segment-timestamp' ? '1:34' : '自動取得字幕' }) };
  const panel = { getAttribute: () => 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED', closest: () => null, getClientRects: () => [1], querySelectorAll: () => [row] };
  context.document.querySelectorAll = selector => selector.startsWith('ytd-engagement-panel') ? [panel] : [];
  const result = await vm.runInNewContext(`(${extractVideo.toString()})({transcriptOnly:true,expectedVideoId:'abc'})`, context);
  assert.equal(result.segments[0].start, 94); assert.equal(result.segments[0].text, '自動取得字幕');
});

test('modern PAmodern_transcript_view reads text and timestamps and ignores hidden legacy transcripts', async () => {
  const context = fixture('https://www.youtube.com/watch?v=04fjBk7KqII');
  const makeRow = (time, text) => ({
    getClientRects: () => [1],
    querySelector: selector => selector === '.ytwTranscriptSegmentViewModelTimestamp' ? { textContent: time } : selector === 'span.ytAttributedStringHost[role="text"]' ? { textContent: text } : null
  });
  const rows = [makeRow('0:00', '新版字幕開始'), makeRow('16:24', '新版字幕結尾'), makeRow('1:99', '無效時間仍保留文字')];
  const panel = { getAttribute: () => 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED', closest: () => null, getClientRects: () => [1], querySelectorAll: selector => selector.includes('transcript-segment-view-model') ? rows : [] };
  const hidden = { ...panel, getAttribute: () => 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN', querySelectorAll: () => { throw new Error('Must not read hidden legacy panel'); } };
  context.document.querySelectorAll = selector => selector.includes('PAmodern_transcript_view') ? [hidden, panel] : [];
  // An already-open modern transcript must win over a slow/blocked caption URL.
  context.window.ytInitialPlayerResponse = { videoDetails: { videoId: '04fjBk7KqII' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=04fjBk7KqII' }] } } };
  const result = await run(context);
  assert.equal(result.segments.length, 3); assert.equal(result.segments[0].start, 0);
  assert.equal(result.segments[1].start, 984); assert.equal(result.segments[1].text, '新版字幕結尾');
  assert.equal(result.segments[2].start, null); assert.equal(result.raw, '');
});

test('serialized extractor reads native cues and restores disabled track mode', async () => {
  const track = { kind: 'subtitles', mode: 'disabled', language: 'zh', cues: [{ startTime: 12, text: '  Test caption  ' }] };
  const video = { clientWidth: 600, clientHeight: 300, duration: 240, textTracks: [track] };
  const context = fixture('https://course.example/lesson');
  context.setTimeout = callback => { callback(); return 1; };
  context.document.querySelectorAll = selector => selector === 'video' ? [video] : [];
  const result = await run(context);
  assert.equal(result.segments[0].start, 12); assert.equal(result.segments[0].text, 'Test caption'); assert.equal(track.mode, 'disabled');
});
test('YouTube adapter reads captions only for current video identity', async () => {
  const context = fixture('https://www.youtube.com/watch?v=abc'); let calls = 0;
  context.window.ytInitialPlayerResponse = { videoDetails: { videoId: 'abc' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'zh', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc' }] } } };
  context.fetch = async (url, options) => { calls++; assert.match(url, /timedtext/); assert.equal(options.credentials, 'include'); return new Response('{"events":[{"tStartMs":1000,"segs":[{"utf8":"字幕"}]}]}'); };
  assert.equal(parseCaptions((await run(context)).raw)[0].start, 1);
  context.window.ytInitialPlayerResponse.videoDetails.videoId = 'stale';
  assert.equal((await run(context)).raw, ''); assert.equal(calls, 1);
});
test('YouTube adapter rejects arbitrary caption origins', async () => {
  const context = fixture('https://www.youtube.com/watch?v=abc'); let calls = 0;
  context.window.ytInitialPlayerResponse = { videoDetails: { videoId: 'abc' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://attacker.example/collect' }] } } };
  context.fetch = async () => { calls++; return new Response('Bad'); };
  assert.equal((await run(context)).raw, ''); assert.equal(calls, 0);
});
test('Bilibili uses correct part cid and public subtitle URL without API secrets', async () => {
  const context = fixture('https://www.bilibili.com/video/BV123?p=2'); const calls = [];
  context.window.__INITIAL_STATE__ = { cid: 10, videoData: { bvid: 'BV123', pages: [{ page: 1, cid: 10 }, { page: 2, cid: 20 }] } };
  context.fetch = async (url, options) => { calls.push({ url, options }); return new Response(calls.length === 1 ? '{"data":{"subtitle":{"subtitles":[{"lan":"zh","subtitle_url":"https://aisubtitle.hdslb.com/subtitle.json"}]}}}' : '{"body":[{"from":2,"content":"第二部分"}]}'); };
  const result = await run(context); assert.match(calls[0].url, /cid=20/); assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(parseCaptions(result.raw)[0].text, '第二部分');
});
test('navigation during extraction fails instead of attaching old captions to new video', async () => {
  const context = fixture('https://www.youtube.com/watch?v=abc');
  context.window.ytInitialPlayerResponse = { videoDetails: { videoId: 'abc' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc' }] } } };
  context.fetch = async () => { context.location.href = 'https://www.youtube.com/watch?v=new'; return new Response(''); };
  await assert.rejects(run(context), /已切換/);
});
test('seeking does not target a newly navigated video', () => {
  const context = fixture('https://www.youtube.com/watch?v=new');
  const result = vm.runInNewContext(`(${seekVideo.toString()})(12, 'https://www.youtube.com/watch?v=old')`, context);
  assert.equal(result.ok, false); assert.match(result.reason, /已切換/);
});
