import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const context = vm.createContext({ URL });
vm.runInContext(await readFile(new URL('../inline-summary.js', import.meta.url), 'utf8'), context);

test('inline summary follows video identity, ignores timestamp changes and distinguishes Bilibili parts', () => {
  const id = context.clipBriefInlineIdentity;
  assert.equal(id('https://www.youtube.com/watch?v=abc&t=12'), id('https://youtube.com/watch?v=abc'));
  assert.notEqual(id('https://www.youtube.com/watch?v=abc'), id('https://www.youtube.com/watch?v=other'));
  assert.notEqual(id('https://www.bilibili.com/video/BVabc/?p=1'), id('https://www.bilibili.com/video/BVabc/?p=2'));
  for (const value of ['https://youtube.com.evil.example/watch?v=abc', 'https://www.youtube.com/', 'https://www.bilibili.com/', 'javascript:alert(1)']) assert.equal(id(value), '');
});

test('inline summary rejects missing content and bounds untrusted output and invalid timestamps', () => {
  const normalize = context.clipBriefInlineData;
  assert.equal(normalize({ brief: '', keyPoints: [] }), null);
  const data = normalize({ brief: '<script>literal text</script>' + 'x'.repeat(8000), keyPoints: ['valid', null, 3], chapters: [{ start: NaN, title: 'bad' }, { start: -1, title: 'bad' }, { start: null, title: 'bad' }, { start: 94, title: '<img onerror=literal>' }] });
  assert.equal(data.brief.length, 6000); assert.equal(data.keyPoints.length, 1); assert.equal(data.chapters.length, 1); assert.equal(data.chapters[0].start, 94);
  assert.equal(data.chapters[0].title, '<img onerror=literal>'); // Renderers must use textContent, preserving text without HTML execution.
});
